"""
Secure File Access API with Multi-Tenant User Isolation
All file operations require user authentication and ownership verification.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.models.processing import ExportDB, PhotoDB
from app.models.user import User
from app.api.auth import get_current_user
from app.services.file_manager import secure_file_manager
from database import get_db

router = APIRouter(prefix="/api/files", tags=["secure-files"])
logger = logging.getLogger(__name__)


@router.get("/photos/{photo_id}/download")
async def download_photo(
    photo_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Securely download a photo file.
    SECURITY: Verifies photo belongs to requesting user.
    """
    # Verify photo ownership in database
    photo_record = (
        db.query(PhotoDB)
        .filter(PhotoDB.photo_id == photo_id, PhotoDB.user_id == current_user.id)
        .first()
    )

    if not photo_record:
        logger.warning(
            f"Security: User {current_user.id} attempted to access unauthorized photo: {photo_id}"
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found"
        )

    # Get secure file path
    file_path = secure_file_manager.get_user_file(
        user_id=current_user.id, file_path=photo_record.file_path
    )

    if not file_path or not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Photo file not found"
        )

    # Log access for security audit
    logger.info(
        f"Photo download: user={current_user.id}, photo={photo_id}, file={file_path}"
    )

    return FileResponse(
        path=str(file_path),
        media_type="image/jpeg",
        filename=photo_record.original_filename,
    )


@router.get("/exports/{export_id}/download")
async def download_export(
    export_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Securely download an export file.
    SECURITY: Verifies export belongs to requesting user.
    """
    # Verify export ownership in database
    export_record = (
        db.query(ExportDB)
        .filter(ExportDB.export_id == export_id, ExportDB.user_id == current_user.id)
        .first()
    )

    if not export_record:
        logger.warning(
            f"Security: User {current_user.id} attempted to access unauthorized export: {export_id}"
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Export not found"
        )

    # Construct secure file path
    user_export_dir = secure_file_manager.get_user_export_dir(current_user.id)
    file_path = user_export_dir / f"tag_photos_{export_id}.zip"

    # Validate path is within user's directory
    secure_path = secure_file_manager.get_user_file(
        user_id=current_user.id, file_path=str(file_path)
    )

    if not secure_path or not secure_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Export file not found"
        )

    # Log access for security audit
    logger.info(
        f"Export download: user={current_user.id}, export={export_id}, file={secure_path}"
    )

    return FileResponse(
        path=str(secure_path),
        media_type="application/zip",
        filename=f"tag_photos_{export_id}.zip",
    )


@router.get("/user/storage/stats")
async def get_user_storage_stats(current_user: User = Depends(get_current_user)):
    """
    Get current user's storage usage statistics.
    Only returns data for the authenticated user.
    """
    stats = secure_file_manager.get_user_storage_stats(current_user.id)

    # Add user info
    stats["user_email"] = current_user.email
    stats["user_name"] = current_user.full_name

    return stats


@router.delete("/user/temp/cleanup")
async def cleanup_user_temp_files(
    job_id: Optional[str] = None, current_user: User = Depends(get_current_user)
):
    """
    Clean up user's temporary files.
    If job_id provided, only cleans that specific job.
    """
    success = secure_file_manager.cleanup_user_temp_files(
        user_id=current_user.id, job_id=job_id
    )

    if success:
        message = f"Temporary files cleaned for user {current_user.id}"
        if job_id:
            message += f", job {job_id}"

        logger.info(message)
        return {"message": "Temporary files cleaned successfully"}
    else:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to clean temporary files",
        )


@router.get("/user/photos/list")
async def list_user_photos(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """
    List all photos for the current user.
    Returns only photos owned by the authenticated user.
    """
    # Query database with user filtering
    photos = (
        db.query(PhotoDB)
        .filter(PhotoDB.user_id == current_user.id)
        .order_by(PhotoDB.created_at.desc())
        .all()
    )

    # Build response with secure file info
    photo_list = []
    for photo in photos:
        # Verify file still exists
        file_path = secure_file_manager.get_user_file(
            user_id=current_user.id, file_path=photo.file_path
        )

        photo_info = {
            "photo_id": photo.photo_id,
            "original_filename": photo.original_filename,
            "detected_number": photo.detected_number,
            "confidence_score": photo.confidence_score,
            "created_at": photo.created_at.isoformat(),
            "file_exists": file_path is not None and file_path.exists(),
            "file_size_bytes": photo.file_size_bytes,
        }

        photo_list.append(photo_info)

    return {
        "user_id": current_user.id,
        "photo_count": len(photo_list),
        "photos": photo_list,
    }


@router.delete("/photos/{photo_id}")
async def delete_user_photo(
    photo_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Securely delete a user's photo.
    SECURITY: Verifies ownership before deletion.
    """
    # Verify photo ownership
    photo_record = (
        db.query(PhotoDB)
        .filter(PhotoDB.photo_id == photo_id, PhotoDB.user_id == current_user.id)
        .first()
    )

    if not photo_record:
        logger.warning(
            f"Security: User {current_user.id} attempted to delete unauthorized photo: {photo_id}"
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found"
        )

    # Delete file securely
    file_deleted = secure_file_manager.delete_user_file(
        user_id=current_user.id, file_path=photo_record.file_path
    )

    if file_deleted:
        # Remove database record
        db.delete(photo_record)
        db.commit()

        logger.info(f"Photo deleted: user={current_user.id}, photo={photo_id}")
        return {"message": "Photo deleted successfully"}
    else:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete photo file",
        )
