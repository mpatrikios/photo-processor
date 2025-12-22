import logging
import os
import uuid
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from google.cloud import storage  # NEW: Import Google Cloud Storage

from app.api.auth import get_current_user
from app.core.config import settings
from app.models.schemas import PhotoInfo, ProcessingStatus, UploadResponse
from app.models.usage import ActionType
from app.models.user import User
from app.services.usage_tracker import usage_tracker
from database import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

# CONFIGURATION
# We default to the prod bucket, but this can be overridden by env vars
BUCKET_NAME = os.environ.get("BUCKET_NAME", "tagsort-uploads-prod")
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tiff", ".bmp"}
MAX_FILE_SIZE = settings.get_max_file_size_bytes()

# Initialize GCS Client once (reuse connection)
try:
    storage_client = storage.Client()
    bucket = storage_client.bucket(BUCKET_NAME)
except Exception as e:
    logger.warning(f"⚠️ Could not connect to Google Cloud Storage: {e}")
    bucket = None


def get_file_extension(filename: str) -> str:
    return os.path.splitext(filename.lower())[1]


def is_allowed_file(filename: str) -> bool:
    return get_file_extension(filename) in ALLOWED_EXTENSIONS


def get_gcs_url(user_id: int, filename: str) -> str:
    """Helper to generate the public URL for a file"""
    return f"https://storage.googleapis.com/{BUCKET_NAME}/{user_id}/{filename}"


@router.post("/photos", response_model=UploadResponse)
async def upload_photos(
    request: Request,
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not bucket:
        raise HTTPException(status_code=500, detail="Storage service unavailable")

    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    # Check quota before processing
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

        # Generate ID and Name
        photo_id = str(uuid.uuid4())
        file_extension = get_file_extension(file.filename)
        new_filename = f"{photo_id}{file_extension}"
        
        # Define Path: user_id/filename (keeps bucket organized)
        blob_path = f"{current_user.id}/{new_filename}"
        blob = bucket.blob(blob_path)

        try:
            # Check file size (Read into memory to check size, then upload)
            # Note: For massive files, we might want to stream, but for photos, this is fine.
            file.file.seek(0, 2)  # Go to end
            file_size_bytes = file.file.tell()
            file.file.seek(0)  # Reset to beginning

            if file_size_bytes > MAX_FILE_SIZE:
                raise HTTPException(
                    status_code=400,
                    detail=f"File {file.filename} exceeds maximum size of {settings.max_file_size_mb}MB",
                )

            # Upload to Google Cloud
            blob.upload_from_file(
                file.file, 
                content_type=file.content_type
            )

            # Calculate stats
            file_size_mb = file_size_bytes / (1024 * 1024)
            total_file_size_mb += file_size_mb
            photo_ids.append(photo_id)

        except HTTPException as he:
            raise he
        except Exception as e:
            logger.error(f"Failed to upload {file.filename} to GCS: {str(e)}")
            raise HTTPException(
                status_code=500, detail=f"Failed to upload file {file.filename}"
            )

    # Use quota after successful upload
    try:
        usage_tracker.use_quota(db, current_user.id, ActionType.UPLOAD, photo_count)

        usage_tracker.log_action(
            db=db,
            user_id=current_user.id,
            action_type=ActionType.UPLOAD,
            photo_count=photo_count,
            file_size_mb=total_file_size_mb,
            success=True,
        )

        current_user.increment_photos_uploaded(photo_count)
        db.commit()

    except Exception as e:
        logger.error(f"⚠️ Failed to update quota/usage: {str(e)}")

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
    """Returns the Public URL of the photo stored in GCS"""
    
    # We have to guess the extension since we don't store it in the DB in this endpoint context
    # In a perfect world, you'd look up the extension in the DB.
    # For now, we check if the blob exists.
    
    found_blob = None
    found_filename = None

    for ext in ALLOWED_EXTENSIONS:
        test_filename = f"{photo_id}{ext}"
        blob_path = f"{current_user.id}/{test_filename}"
        blob = bucket.blob(blob_path)
        if blob.exists():
            found_blob = blob
            found_filename = test_filename
            break
    
    if not found_blob:
        raise HTTPException(status_code=404, detail="Photo not found")

    return PhotoInfo(
        id=photo_id,
        filename=found_filename,
        original_path=get_gcs_url(current_user.id, found_filename), # Return GCS URL
        status=ProcessingStatus.PENDING,
    )


@router.get("/serve/{photo_id}")
async def serve_photo(photo_id: str, current_user: User = Depends(get_current_user)):
    """Redirects to the GCS public URL"""
    
    # Locate the file in GCS
    found_filename = None
    for ext in ALLOWED_EXTENSIONS:
        test_filename = f"{photo_id}{ext}"
        blob_path = f"{current_user.id}/{test_filename}"
        blob = bucket.blob(blob_path)
        if blob.exists():
            found_filename = test_filename
            break

    if not found_filename:
        raise HTTPException(status_code=404, detail="Photo not found")

    # REDIRECT to the Cloud Storage URL
    # This relieves your server from streaming data and is much faster
    return RedirectResponse(url=get_gcs_url(current_user.id, found_filename))


@router.get("/serve/{photo_id}/view")
async def serve_photo_with_token(
    photo_id: str, token: str, db: Session = Depends(get_db)
):
    """Serve photo file by ID with token authentication (Redirects to GCS)"""
    from app.services.auth_service import auth_service

    # Verify token
    user = auth_service.get_user_from_token(db, token)
    if not user:
        raise HTTPException(status_code=403, detail="Invalid token")

    # Locate in GCS
    found_filename = None
    for ext in ALLOWED_EXTENSIONS:
        test_filename = f"{photo_id}{ext}"
        blob_path = f"{user.id}/{test_filename}"
        blob = bucket.blob(blob_path)
        if blob.exists():
            found_filename = test_filename
            break

    if not found_filename:
        raise HTTPException(status_code=404, detail="Photo not found")

    return RedirectResponse(url=get_gcs_url(user.id, found_filename))