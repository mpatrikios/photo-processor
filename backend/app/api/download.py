import logging
import os
import uuid
import zipfile
from collections import defaultdict
from datetime import timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from google.cloud import storage
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.api.process_tasks import detector as process_detector
from app.core.config import settings
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

# GCS Configuration (reusing pattern from upload.py)
BUCKET_NAME = settings.bucket_name

# Initialize GCS Client (reusing pattern from upload.py)
try:
    if BUCKET_NAME:
        storage_client = storage.Client()
        bucket = storage_client.bucket(BUCKET_NAME)
    else:
        bucket = None
except Exception as e:
    bucket = None


def generate_signed_download_url(blob, expires_minutes=15):
    """
    Reuse existing signed URL logic from upload.py:99-106
    """
    try:
        from google.auth import default
        from google.auth.transport import requests as google_requests
        
        credentials, _ = default()
        auth_request = google_requests.Request()
        credentials.refresh(auth_request)
        
        signed_url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=expires_minutes),
            method="GET",
            service_account_email=getattr(credentials, 'service_account_email', None),
            access_token=getattr(credentials, 'token', None),
        )
        return signed_url
    except Exception as e:
        logger.error(f"Failed to generate signed URL: {e}")
        return None


@router.post("/export")
async def create_export(
    request: ExportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not request.photo_ids:
        raise HTTPException(status_code=400, detail="No photo IDs provided")

    export_id = str(uuid.uuid4())

    zip_filename = f"tag_photos_{export_id}.zip"
    
    # GCS storage path
    gcs_blob_path = f"{current_user.id}/exports/{zip_filename}"
    
    # Temporary local path for ZIP creation before GCS upload
    temp_dir = os.path.join(EXPORT_DIR, "temp")
    os.makedirs(temp_dir, exist_ok=True)
    temp_zip_path = os.path.join(temp_dir, f"{export_id}_{zip_filename}")

    # Store metadata for access control
    export_metadata[export_id] = {
        "user_id": current_user.id,
        "filename": zip_filename,
        "gcs_blob_path": gcs_blob_path,
    }

    try:
        logger.info(f"Creating export {export_id} for user {current_user.id} with {len(request.photo_ids)} photos")
        
        # Group photos by bib number with hybrid organization
        grouped_photos = await organize_photos_by_bib(request.photo_ids, current_user.id, db)
        
        logger.info(f"Grouped photos into {len(grouped_photos)} groups: {list(grouped_photos.keys())}")
        
        files_added = 0
        total_size = 0

        # Create temporary ZIP file for GCS upload
        with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
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
        
        zip_size = os.path.getsize(temp_zip_path) if os.path.exists(temp_zip_path) else 0
        logger.info(f"Temporary ZIP file created: {temp_zip_path}, size: {zip_size}")

        # Upload ZIP to GCS (required - no fallback)
        if not bucket:
            raise HTTPException(status_code=500, detail="Google Cloud Storage not configured")
            
        if not os.path.exists(temp_zip_path):
            raise HTTPException(status_code=500, detail="Failed to create export file")
            
        try:
            blob = bucket.blob(gcs_blob_path)
            with open(temp_zip_path, 'rb') as zip_file:
                blob.upload_from_file(zip_file, content_type='application/zip')
            
            logger.info(f"✅ ZIP uploaded to GCS: {gcs_blob_path}")
            
        except Exception as e:
            logger.error(f"❌ Failed to upload ZIP to GCS: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to upload export: {str(e)}")
            
        finally:
            # Always clean up temporary file
            if os.path.exists(temp_zip_path):
                os.remove(temp_zip_path)
                logger.info(f"🧹 Cleaned up temporary ZIP file: {temp_zip_path}")
        
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
    """
    Return signed URL for ZIP download instead of streaming the file.
    Reuses existing signed URL logic from upload.py.
    """
    
    # Check if export exists and user has access
    if export_id not in export_metadata:
        raise HTTPException(status_code=404, detail="Export not found")
    
    export_info = export_metadata[export_id]
    if export_info["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    # GCS signed URL (production method)
    if bucket and "gcs_blob_path" in export_info:
        gcs_blob_path = export_info["gcs_blob_path"]
        blob = bucket.blob(gcs_blob_path)
        
        if blob.exists():
            # Generate signed URL using existing logic from upload.py
            signed_url = generate_signed_download_url(blob, expires_minutes=15)
            if signed_url:
                logger.info(f"✅ Generated signed URL for export {export_id}")
                return {
                    "signed_url": signed_url,
                    "filename": export_info["filename"],
                    "expires_in_minutes": 15,
                }
    
    # If we reach here, the file is not available
    logger.error(f"❌ Export {export_id} not found in GCS or failed to generate signed URL")
    raise HTTPException(status_code=404, detail="Export file not found or expired")


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
