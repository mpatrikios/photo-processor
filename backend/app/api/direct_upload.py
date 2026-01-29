"""
Direct upload endpoints for Google Cloud Storage.
Eliminates the server proxy bottleneck by providing signed URLs for direct browser-to-GCS uploads.
"""

import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.core.config import settings
from app.core.gcs import get_gcs_bucket
from app.core.security_config import ALLOWED_EXTENSIONS
from app.models.processing import PhotoDB, ProcessingStatus
from app.models.schemas import (
    SignedUploadRequest,
    SignedUploadResponse,
    SignedUrlInfo,
    UploadCompletionRequest,
    UploadCompletionResponse,
    CompletedUpload
)
from app.models.usage import ActionType
from app.models.user import User
from app.services.usage_tracker import usage_tracker
from database import get_db

router = APIRouter()
logger = logging.getLogger(__name__)
MAX_FILE_SIZE = settings.get_max_file_size_bytes()


# Utility functions

def get_file_extension(filename: str) -> str:
    return os.path.splitext(filename.lower())[1]


def is_allowed_file(filename: str) -> bool:
    return get_file_extension(filename) in ALLOWED_EXTENSIONS


@router.post("/signed-urls", response_model=SignedUploadResponse)
async def get_signed_upload_urls(
    request: SignedUploadRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Step 1: Generate signed URLs for direct browser-to-GCS uploads.
    This replaces the slow server proxy method with fast direct uploads.
    """

    try:
        logger.info(f"User {current_user.id} requesting signed URLs for {len(request.files)} files")

        bucket = get_gcs_bucket()
        if not bucket:
            logger.error("GCS bucket not configured")
            raise HTTPException(
                status_code=500,
                detail="Google Cloud Storage not configured"
            )

        if not request.files:
            raise HTTPException(status_code=400, detail="No files specified")

        # Check quota before generating URLs
        photo_count = len(request.files)
        can_upload, quota_message = usage_tracker.check_user_quota(
            db, current_user.id, ActionType.UPLOAD, photo_count
        )

        if not can_upload:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=quota_message
            )

        signed_urls = []

        for file_info in request.files:
            # Validate file
            if not is_allowed_file(file_info.filename):
                raise HTTPException(
                    status_code=400,
                    detail=f"File {file_info.filename} has invalid extension. "
                           f"Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
                )

            if file_info.size > MAX_FILE_SIZE:
                raise HTTPException(
                    status_code=400,
                    detail=f"File {file_info.filename} exceeds maximum size "
                           f"of {settings.max_file_size_mb}MB",
                )

            # Generate unique photo ID and GCS filename
            photo_id = str(uuid.uuid4())
            file_extension = get_file_extension(file_info.filename)
            gcs_filename = f"{photo_id}{file_extension}"
            blob_path = f"{current_user.id}/{gcs_filename}"

            try:
                # Create blob reference
                blob = bucket.blob(blob_path)

                # Generate signed URL for PUT operation (valid for 15 minutes)
                from google.auth import default
                from google.auth.transport import requests as google_requests

                # Get the default credentials and service account email
                credentials, project_id = default()
                auth_request = google_requests.Request()
                credentials.refresh(auth_request)

                # For Cloud Run, use the default service account
                service_account_email = credentials.service_account_email if hasattr(credentials, 'service_account_email') else None

                signed_url = blob.generate_signed_url(
                    version="v4",
                    expiration=timedelta(minutes=15),
                    method="PUT",
                    content_type=file_info.content_type,
                    service_account_email=service_account_email,
                    access_token=credentials.token if hasattr(credentials, 'token') else None,
                )

                signed_urls.append(SignedUrlInfo(
                    photo_id=photo_id,
                    filename=file_info.filename,
                    gcs_filename=gcs_filename,
                    signed_url=signed_url,
                    expires_at=(datetime.utcnow() + timedelta(minutes=15)).isoformat(),
                    file_extension=file_extension,
                    content_type=file_info.content_type,
                    size=file_info.size
                ))

                logger.info(f"Generated signed URL for {file_info.filename} -> {photo_id}")

            except Exception as e:
                logger.error(f"Failed to generate signed URL for {file_info.filename}: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to generate signed URL for {file_info.filename}"
                )

        return SignedUploadResponse(
            signed_urls=signed_urls,
            expires_in_minutes=15,
            bucket_name=settings.bucket_name,
            message=f"Generated {len(signed_urls)} signed URLs for direct upload"
        )

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(f"Unexpected error in signed URL generation: {e}")
        raise HTTPException(
            status_code=500,
            detail="Internal server error during signed URL generation"
        )


@router.post("/complete", response_model=UploadCompletionResponse)
async def complete_upload(
    request: UploadCompletionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Step 3: Record successful direct uploads in the database.
    Called by frontend after files have been uploaded directly to GCS.
    """

    if not request.completed_uploads:
        raise HTTPException(status_code=400, detail="No completed uploads provided")

    bucket = get_gcs_bucket()
    successful_photos = []
    failed_photos = []
    total_file_size_mb = 0.0

    for upload in request.completed_uploads:
        try:
            # Optional: Verify the file actually exists in GCS
            blob_path = f"{current_user.id}/{upload.gcs_filename}"

            if bucket:
                blob = bucket.blob(blob_path)
                if not blob.exists():
                    logger.warning(f"File not found in GCS: {blob_path}")
                    failed_photos.append({
                        "photo_id": upload.photo_id,
                        "error": "File not found in Google Cloud Storage"
                    })
                    continue

            # Create database record using our optimized PhotoDB model
            photo_db = PhotoDB(
                photo_id=upload.photo_id,
                user_id=current_user.id,
                original_filename=upload.original_filename,
                file_path=blob_path,
                file_size_bytes=upload.size,
                file_extension=upload.file_extension,
                processing_status=ProcessingStatus.PENDING
            )

            db.add(photo_db)

            # Calculate stats
            file_size_mb = upload.size / (1024 * 1024)
            total_file_size_mb += file_size_mb

            successful_photos.append(upload.photo_id)

            logger.info(f"Recorded direct upload: {upload.photo_id}")

        except Exception as e:
            logger.error(f"Failed to record upload for {upload.photo_id}: {e}")
            failed_photos.append({
                "photo_id": upload.photo_id,
                "error": str(e)
            })

    # Commit successful uploads
    try:
        db.commit()

        # Update usage tracking
        if successful_photos:
            usage_tracker.use_quota(
                db, current_user.id, ActionType.UPLOAD, len(successful_photos)
            )

            usage_tracker.log_action(
                db=db,
                user_id=current_user.id,
                action_type=ActionType.UPLOAD,
                photo_count=len(successful_photos),
                file_size_mb=total_file_size_mb,
                success=True,
            )

            current_user.increment_photos_uploaded(len(successful_photos))
            db.commit()

    except Exception as e:
        logger.error(f"Database commit failed: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to record uploads")

    # Get updated quota info
    updated_quota = usage_tracker.get_or_create_user_quota(db, current_user.id)

    return UploadCompletionResponse(
        successful_uploads=len(successful_photos),
        failed_uploads=len(failed_photos),
        photo_ids=successful_photos,
        failed_photos=failed_photos,
        total_size_mb=total_file_size_mb,
        quota_info={
            "photos_used_this_month": updated_quota.photos_used_this_month,
            "monthly_photo_limit": updated_quota.monthly_photo_limit,
            "photos_remaining": max(
                0,
                updated_quota.monthly_photo_limit - updated_quota.photos_used_this_month,
            ),
            "current_month": updated_quota.current_month,
        },
        message=f"Successfully recorded {len(successful_photos)} uploads"
        + (f", {len(failed_photos)} failed" if failed_photos else "")
    )
