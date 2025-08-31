from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse
from typing import List, Dict, Optional
import os
import zipfile
import uuid
from collections import defaultdict
from app.models.schemas import ExportRequest
from app.services.detector import NumberDetector
from app.api.process import detector as process_detector
from app.api.auth import get_current_user
from app.models.user import User
from sqlalchemy.orm import Session
from database import get_db

router = APIRouter()

EXPORT_DIR = "exports"
detector = NumberDetector()

# Store export metadata with user association
export_metadata: Dict[str, dict] = {}

@router.post("/export")
async def create_export(
    request: ExportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
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
        "path": zip_path
    }
    
    try:
        # Group photos by bib number with hybrid organization
        grouped_photos = await organize_photos_by_bib(request.photo_ids)
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for bib_number, photos in grouped_photos.items():
                folder_name = f"Bib_{bib_number}" if bib_number != "unknown" else "Unknown"
                
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
                        zipf.write(photo_path, arcname)
        
        return {"export_id": export_id, "download_url": f"/api/download/file/{export_id}"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create export: {str(e)}")

@router.get("/file/{export_id}")
async def download_export(
    export_id: str,
    current_user: User = Depends(get_current_user)
):
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
    
    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="Export file not found")
    
    return FileResponse(
        path=zip_path,
        filename=zip_filename,
        media_type="application/zip"
    )

def find_photo_path(photo_id: str) -> Optional[str]:
    extensions = [".jpg", ".jpeg", ".png", ".tiff", ".bmp"]
    
    for directory in ["processed", "uploads"]:
        for ext in extensions:
            path = os.path.join(directory, f"{photo_id}{ext}")
            if os.path.exists(path):
                return path
    
    return None

async def organize_photos_by_bib(photo_ids: List[str]) -> Dict[str, List[tuple]]:
    """Organize photos by bib number with numerical sorting"""
    grouped = defaultdict(list)
    
    
    for photo_id in photo_ids:
        photo_path = find_photo_path(photo_id)
        if not photo_path:
            continue
            
        # Get detection result from the processing detector instance
        detection_result = process_detector.results.get(photo_id)
        bib_number = "unknown"
        
        if detection_result and detection_result.bib_number:
            bib_number = detection_result.bib_number
        else:
            # Also check local detector instance as fallback
            fallback_result = detector.results.get(photo_id)
            if fallback_result and fallback_result.bib_number:
                bib_number = fallback_result.bib_number
        
        grouped[bib_number].append((photo_id, photo_path))
    
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