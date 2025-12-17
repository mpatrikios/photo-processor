import logging
import os
import shutil
import uuid
from typing import List, Dict, Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.core.config import settings
from app.models.schemas import PhotoInfo, ProcessingStatus, UploadResponse
from app.models.usage import ActionType
from app.models.user import User
from app.services.usage_tracker import usage_tracker
from database import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

UPLOAD_DIR = settings.upload_dir
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tiff", ".bmp"}
MAX_FILE_SIZE = settings.get_max_file_size_bytes()


def get_file_extension(filename: str) -> str:
    return os.path.splitext(filename.lower())[1]


def is_allowed_file(filename: str) -> bool:
    return get_file_extension(filename) in ALLOWED_EXTENSIONS


@router.post("/photos", response_model=UploadResponse)
async def upload_photos(
    request: Request,
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    # Check quota before processing any files
    photo_count = len(files)
    can_upload, quota_message = usage_tracker.check_user_quota(
        db, current_user.id, ActionType.UPLOAD, photo_count
    )

    if not can_upload:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=quota_message)

    # Get current quota for response
    usage_tracker.get_or_create_user_quota(db, current_user.id)

    photo_ids = []
    total_file_size_mb = 0

    for file in files:
        if not is_allowed_file(file.filename):
            raise HTTPException(
                status_code=400,
                detail=f"File {file.filename} has invalid extension. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
            )

        photo_id = str(uuid.uuid4())
        file_extension = get_file_extension(file.filename)
        new_filename = f"{photo_id}{file_extension}"

        # Create user-specific upload directory
        user_upload_dir = os.path.join(UPLOAD_DIR, str(current_user.id))
        os.makedirs(user_upload_dir, exist_ok=True)

        file_path = os.path.join(user_upload_dir, new_filename)

        try:
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            # Calculate file size and validate
            file_size_bytes = os.path.getsize(file_path)
            if file_size_bytes > MAX_FILE_SIZE:
                os.remove(file_path)  # Clean up the file
                raise HTTPException(
                    status_code=400,
                    detail=f"File {file.filename} exceeds maximum size of {settings.max_file_size_mb}MB",
                )

            file_size_mb = file_size_bytes / (1024 * 1024)
            total_file_size_mb += file_size_mb

            photo_ids.append(photo_id)

        except Exception as e:
            logger.error(f"Failed to save {file.filename}: {str(e)}")
            raise HTTPException(
                status_code=500, detail=f"Failed to save file {file.filename}: {str(e)}"
            )

    # Use quota after successful upload
    try:
        usage_tracker.use_quota(db, current_user.id, ActionType.UPLOAD, photo_count)

        # Log the upload action
        usage_tracker.log_action(
            db=db,
            user_id=current_user.id,
            action_type=ActionType.UPLOAD,
            photo_count=photo_count,
            file_size_mb=total_file_size_mb,
            success=True,
        )

        # Update user's total photos uploaded counter
        current_user.increment_photos_uploaded(photo_count)
        db.commit()

    except Exception as e:
        print(f"⚠️ Failed to update quota/usage: {str(e)}")
        # Continue with upload success, as photos are already saved

    # Get updated quota for response
    updated_quota = usage_tracker.get_or_create_user_quota(db, current_user.id)

    return UploadResponse(
        photo_ids=photo_ids,
        message=f"Successfully uploaded {len(photo_ids)} photos",
        quota_info={
            "photos_used_this_month": updated_quota.photos_used_this_month,
            "monthly_photo_limit": updated_quota.monthly_photo_limit,
            "photos_remaining": max(
                0,
                updated_quota.monthly_photo_limit
                - updated_quota.photos_used_this_month,
            ),
            "current_month": updated_quota.current_month,
        },
    )


@router.get("/photos/{photo_id}")
async def get_photo_info(photo_id: str, current_user: User = Depends(get_current_user)):
    # Check user's upload directory first
    user_upload_dir = os.path.join(UPLOAD_DIR, str(current_user.id))
    file_path = None

    for ext in ALLOWED_EXTENSIONS:
        test_path = os.path.join(user_upload_dir, f"{photo_id}{ext}")
        if os.path.exists(test_path):
            file_path = test_path
            break

    # SECURITY: No fallback to shared directories - user isolation required

    if not file_path:
        raise HTTPException(status_code=404, detail="Photo not found")

    return PhotoInfo(
        id=photo_id,
        filename=os.path.basename(file_path),
        original_path=file_path,
        status=ProcessingStatus.PENDING,
    )


@router.get("/serve/{photo_id}")
async def serve_photo(photo_id: str, current_user: User = Depends(get_current_user)):
    """Serve photo file by ID"""
    # Check user's upload directory first
    user_upload_dir = os.path.join(UPLOAD_DIR, str(current_user.id))
    file_path = None

    for ext in ALLOWED_EXTENSIONS:
        test_path = os.path.join(user_upload_dir, f"{photo_id}{ext}")
        if os.path.exists(test_path):
            file_path = test_path
            break

    # SECURITY: No fallback to shared directories - user isolation required

    if not file_path:
        raise HTTPException(status_code=404, detail="Photo not found")

    return FileResponse(file_path, media_type="image/jpeg")


@router.get("/serve/{photo_id}/view")
async def serve_photo_with_token(
    photo_id: str, token: str, db: Session = Depends(get_db)
):
    """Serve photo file by ID with token authentication for <img> tags"""
    from app.services.auth_service import auth_service

    # Verify token
    user = auth_service.get_user_from_token(db, token)
    if not user:
        raise HTTPException(status_code=403, detail="Invalid token")

    # Check user's upload directory first
    user_upload_dir = os.path.join(UPLOAD_DIR, str(user.id))
    file_path = None

    for ext in ALLOWED_EXTENSIONS:
        test_path = os.path.join(user_upload_dir, f"{photo_id}{ext}")
        if os.path.exists(test_path):
            file_path = test_path
            break

    # SECURITY: No fallback to shared directories - user isolation required

    if not file_path:
        raise HTTPException(status_code=404, detail="Photo not found")

    return FileResponse(file_path, media_type="image/jpeg")

