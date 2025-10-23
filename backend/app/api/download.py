import logging
import os
import uuid
import zipfile
from collections import defaultdict
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.api.process import detector as process_detector
from app.models.schemas import ExportRequest
from app.models.user import User
from app.services.detector import NumberDetector
from database import get_db

logger = logging.getLogger(__name__)

router = APIRouter()

EXPORT_DIR = "exports"
detector = NumberDetector()

# Store export metadata with user association
export_metadata: Dict[str, dict] = {}


@router.post("/export")
async def create_export(
    request: ExportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not request.photo_ids:
        raise HTTPException(status_code=400, detail="No photo IDs provided")

    export_id = str(uuid.uuid4())

    # Create user-specific export directory
    user_export_dir = os.path.join(EXPORT_DIR, str(current_user.id))
    os.makedirs(user_export_dir, exist_ok=True)

    zip_filename = f"tag_photos_{export_id}.zip"
    zip_path = os.path.join(user_export_dir, zip_filename)

    # Store metadata for access control
    export_metadata[export_id] = {
        "user_id": current_user.id,
        "filename": zip_filename,
        "path": zip_path,
    }

    try:
        logger.info(f"Creating export {export_id} for user {current_user.id} with {len(request.photo_ids)} photos")
        
        # Group photos by bib number with hybrid organization
        grouped_photos = await organize_photos_by_bib(request.photo_ids, current_user.id, db)
        
        logger.info(f"Grouped photos into {len(grouped_photos)} groups: {list(grouped_photos.keys())}")
        
        files_added = 0
        total_size = 0

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for bib_number, photos in grouped_photos.items():
                folder_name = (
                    f"Bib_{bib_number}" if bib_number != "unknown" else "Unknown"
                )
                logger.info(f"Processing folder '{folder_name}' with {len(photos)} photos")

                for i, (photo_id, photo_path) in enumerate(photos, 1):
                    if photo_path and os.path.exists(photo_path):
                        # Get original filename and extension
                        original_filename = os.path.basename(photo_path)
                        name_part, ext = os.path.splitext(original_filename)

                        # Create hybrid filename: bibNumber_originalName_sequence.ext
                        if bib_number != "unknown":
                            if len(photos) > 1:
                                new_filename = f"{bib_number}_{name_part}_{i:03d}{ext}"
                            else:
                                new_filename = f"{bib_number}_{name_part}{ext}"
                        else:
                            if len(photos) > 1:
                                new_filename = f"unknown_{i:03d}{ext}"
                            else:
                                new_filename = f"unknown_{name_part}{ext}"

                        # Add to ZIP with folder structure
                        arcname = f"{folder_name}/{new_filename}"
                        file_size = os.path.getsize(photo_path)
                        
                        logger.debug(f"Adding file: {photo_path} -> {arcname} ({file_size} bytes)")
                        zipf.write(photo_path, arcname)
                        
                        files_added += 1
                        total_size += file_size
                    else:
                        logger.warning(f"Skipping missing file: {photo_path} for photo_id: {photo_id}")

        logger.info(f"Export {export_id} completed: {files_added} files added, total size: {total_size} bytes")
        logger.info(f"ZIP file created at: {zip_path}, size: {os.path.getsize(zip_path) if os.path.exists(zip_path) else 'N/A'}")

        return {
            "export_id": export_id,
            "download_url": f"/api/download/file/{export_id}",
            "files_included": files_added,
            "total_size_bytes": total_size,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to create export: {str(e)}"
        )


@router.get("/file/{export_id}")
async def download_export(
    export_id: str, current_user: User = Depends(get_current_user)
):
    # Default filename in case it's not set elsewhere
    zip_filename = f"export_{export_id}.zip"
    
    # Check if export exists and user has access
    if export_id not in export_metadata:
        # Try to reconstruct path for backwards compatibility
        user_export_dir = os.path.join(EXPORT_DIR, str(current_user.id))
        zip_filename = f"tag_photos_{export_id}.zip"
        zip_path = os.path.join(user_export_dir, zip_filename)

        if not os.path.exists(zip_path):
            # Try legacy path without user directory
            legacy_path = os.path.join(EXPORT_DIR, zip_filename)
            if not os.path.exists(legacy_path):
                raise HTTPException(status_code=404, detail="Export not found")
            zip_path = legacy_path
    else:
        export_info = export_metadata[export_id]
        if export_info["user_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied")
        zip_path = export_info["path"]
        # Extract filename from path for proper download name
        zip_filename = os.path.basename(zip_path)

    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="Export file not found")

    return FileResponse(
        path=zip_path, filename=zip_filename, media_type="application/zip"
    )


def find_photo_path(photo_id: str, user_id: int = None) -> Optional[str]:
    """Find photo path, checking user-specific directories first."""
    extensions = [".jpg", ".jpeg", ".png", ".tiff", ".bmp"]
    
    # Check user-specific directories first (if user_id provided)
    if user_id:
        for directory in ["processed", "uploads"]:
            user_dir = os.path.join(directory, str(user_id))
            for ext in extensions:
                path = os.path.join(user_dir, f"{photo_id}{ext}")
                logger.debug(f"Checking user-specific path: {path}")
                if os.path.exists(path):
                    logger.info(f"Found photo at user-specific path: {path}")
                    return path
    
    # Fallback to global directories (legacy support)
    for directory in ["processed", "uploads"]:
        for ext in extensions:
            path = os.path.join(directory, f"{photo_id}{ext}")
            logger.debug(f"Checking global path: {path}")
            if os.path.exists(path):
                logger.info(f"Found photo at global path: {path}")
                return path

    logger.warning(f"Photo not found: {photo_id} (user_id: {user_id})")
    return None


async def organize_photos_by_bib(photo_ids: List[str], user_id: int, db: Session = None) -> Dict[str, List[tuple]]:
    """Organize photos by bib number with numerical sorting"""
    grouped = defaultdict(list)
    
    logger.info(f"Organizing {len(photo_ids)} photos for user {user_id}")
    
    # Debug: Check what directories exist
    for directory in ["processed", "uploads"]:
        user_dir = os.path.join(directory, str(user_id))
        if os.path.exists(user_dir):
            files = os.listdir(user_dir)
            logger.info(f"User directory {user_dir} exists with {len(files)} files")
        else:
            logger.warning(f"User directory {user_dir} does not exist")
            
        if os.path.exists(directory):
            files = os.listdir(directory)
            logger.info(f"Global directory {directory} exists with {len(files)} files")

    for photo_id in photo_ids:
        photo_path = find_photo_path(photo_id, user_id)
        if not photo_path:
            logger.warning(f"Photo path not found for photo_id: {photo_id}")
            continue

        # Get detection result from database instead of memory
        bib_number = "unknown"
        
        if db:
            from app.models.processing import PhotoDB
            
            # Query database for photo detection result
            photo_record = db.query(PhotoDB).filter(
                PhotoDB.photo_id == photo_id,
                PhotoDB.user_id == user_id
            ).first()
            
            if photo_record:
                # Check manual label first, then detected number
                if photo_record.manual_label:
                    bib_number = photo_record.manual_label
                    logger.debug(f"Photo {photo_id}: Using manual label {bib_number}")
                elif photo_record.detected_number:
                    bib_number = photo_record.detected_number
                    logger.debug(f"Photo {photo_id}: Using detected number {bib_number}")
                else:
                    logger.debug(f"Photo {photo_id}: No label found in database, using 'unknown'")
            else:
                logger.warning(f"Photo {photo_id}: Not found in database for user {user_id}")
        else:
            # Fallback to memory (old behavior)
            detection_result = process_detector.results.get(photo_id)
            if detection_result and detection_result.bib_number:
                bib_number = detection_result.bib_number
                logger.debug(f"Photo {photo_id}: Found bib number {bib_number} from memory")
            else:
                logger.debug(f"Photo {photo_id}: No detection result in memory, using 'unknown'")

        grouped[bib_number].append((photo_id, photo_path))
        logger.debug(f"Photo {photo_id}: Added to group '{bib_number}' with path {photo_path}")

    # Sort bib numbers numerically (not alphabetically)
    sorted_grouped = {}

    # Separate numeric and non-numeric bib numbers
    numeric_bibs = []
    non_numeric_bibs = []

    for bib in grouped.keys():
        if bib == "unknown":
            non_numeric_bibs.append(bib)
        else:
            try:
                numeric_bibs.append((int(bib), bib))
            except ValueError:
                non_numeric_bibs.append(bib)

    # Sort numeric bibs by number, then add non-numeric
    numeric_bibs.sort(key=lambda x: x[0])
    sorted_bib_order = [bib for _, bib in numeric_bibs] + sorted(non_numeric_bibs)

    # Rebuild dictionary in sorted order
    for bib in sorted_bib_order:
        sorted_grouped[bib] = grouped[bib]

    return sorted_grouped
