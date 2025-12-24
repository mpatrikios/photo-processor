import logging
import os
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.orm import Session
from google.cloud import storage  # NEW: Import Google Cloud Storage

from app.api.auth import get_current_user
from app.core.config import settings
from app.models.schemas import PhotoInfo, ProcessingStatus
from app.models.user import User
from database import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

# CONFIGURATION FOR PHOTO SERVING
BUCKET_NAME = settings.bucket_name
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tiff", ".bmp"}

# Initialize GCS Client once (reuse connection)
try:
    if BUCKET_NAME:
        storage_client = storage.Client()
        bucket = storage_client.bucket(BUCKET_NAME)
        logger.info(f"✅ Connected to Google Cloud Storage bucket: {BUCKET_NAME}")
    else:
        logger.info("📁 No bucket configured - using local storage only")
        bucket = None
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


def find_photo_by_id(db: Session, user_id: int, photo_id: str):
    """Find photo record in database by photo_id and user_id"""
    from app.models.processing import PhotoDB
    return db.query(PhotoDB).filter(
        PhotoDB.photo_id == photo_id,
        PhotoDB.user_id == user_id
    ).first()


def find_photo_in_storage(user_id: int, photo_db):
    """Find photo in storage using database record"""
    if not photo_db or not photo_db.file_extension:
        return None, None, None, None
    
    filename = f"{photo_db.photo_id}{photo_db.file_extension}"
    blob_path = f"{user_id}/{filename}"
    
    # Check GCS first
    if bucket:
        try:
            blob = bucket.blob(blob_path)
            if blob.exists():
                return 'gcs', blob_path, filename, blob
        except Exception as e:
            logger.warning(f"Error checking GCS blob {blob_path}: {e}")
    
    # Check local storage
    local_upload_dir = os.path.join(settings.upload_dir, str(user_id))
    local_path = os.path.join(local_upload_dir, filename)
    if os.path.exists(local_path):
        return 'local', local_path, filename, None
    
    return None, None, None, None


# ❌ OLD SLOW UPLOAD ENDPOINT REMOVED ❌
# 
# The old proxy upload method (POST /api/upload/photos) has been replaced
# with fast direct uploads that bypass the server bottleneck.
#
# ✅ Use these new endpoints instead:
#   POST /api/direct-upload/signed-urls   - Get upload tickets
#   POST /api/direct-upload/complete      - Record completed uploads
#
# Benefits:
#   🚀 10x faster uploads (direct to Google Cloud)
#   ⏰ No token expiration issues
#   📈 Better server performance
#   🔧 O(1) database lookups with stored file extensions


@router.get("/photos/{photo_id}")
async def get_photo_info(photo_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Returns the Public URL of the photo stored in GCS"""
    
    # Look up photo in database
    photo_db = find_photo_by_id(db, current_user.id, photo_id)
    if not photo_db:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    filename = f"{photo_id}{photo_db.file_extension}"

    return PhotoInfo(
        id=photo_id,
        filename=filename,
        original_path=get_gcs_url(current_user.id, filename),
        status=photo_db.processing_status,
    )


@router.get("/debug/{photo_id}")
async def debug_photo(photo_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Debug endpoint to check photo database record and storage"""
    
    # Look up photo in database
    photo_db = find_photo_by_id(db, current_user.id, photo_id)
    if not photo_db:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    # Check storage
    storage_type, path, filename, blob = find_photo_in_storage(current_user.id, photo_db)
    
    return {
        "photo_id": photo_id,
        "database_record": {
            "file_path": photo_db.file_path,
            "file_extension": photo_db.file_extension,
            "original_filename": photo_db.original_filename,
        },
        "storage_check": {
            "storage_type": storage_type,
            "path": path,
            "filename": filename,
            "blob_exists": blob.exists() if blob else None,
        },
        "bucket_configured": bucket is not None,
        "bucket_name": BUCKET_NAME,
    }


@router.get("/serve/{photo_id}")
async def serve_photo(photo_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Serves photo using signed URLs for security and scalability"""
    from datetime import timedelta
    
    # Look up photo in database
    photo_db = find_photo_by_id(db, current_user.id, photo_id)
    if not photo_db:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    # Find photo in storage
    storage_type, path, filename, blob = find_photo_in_storage(current_user.id, photo_db)
    
    if not filename:
        raise HTTPException(status_code=404, detail="Photo not found in storage")
    
    # Handle GCS storage
    if storage_type == 'gcs' and blob:
        try:
            # Generate signed URL for GET operation (Cloud Run ADC compatible)
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
                method="GET",
                service_account_email=service_account_email,
                access_token=credentials.token if hasattr(credentials, 'token') else None,
            )
            return RedirectResponse(url=signed_url)
        except Exception as e:
            logger.error(f"Failed to generate signed URL: {e}")
            raise HTTPException(status_code=500, detail="Could not serve photo")
    
    # Handle local storage
    elif storage_type == 'local':
        return FileResponse(path, media_type="image/jpeg")
    
    raise HTTPException(status_code=404, detail="Photo not found in storage")


@router.get("/serve/{photo_id}/view")
async def serve_photo_with_token(
    photo_id: str, token: str, db: Session = Depends(get_db)
):
    """Serve photo file by ID with token authentication using signed URLs"""
    from datetime import timedelta
    from app.services.auth_service import auth_service

    # Verify token
    user = auth_service.get_user_from_token(db, token)
    if not user:
        raise HTTPException(status_code=403, detail="Invalid token")

    # Look up photo in database
    photo_db = find_photo_by_id(db, user.id, photo_id)
    if not photo_db:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    # Find photo in storage
    storage_type, path, filename, blob = find_photo_in_storage(user.id, photo_db)
    
    if not filename:
        raise HTTPException(status_code=404, detail="Photo not found in storage")
    
    # Handle GCS storage
    if storage_type == 'gcs' and blob:
        try:
            # Generate signed URL for GET operation (Cloud Run ADC compatible)
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
                method="GET",
                service_account_email=service_account_email,
                access_token=credentials.token if hasattr(credentials, 'token') else None,
            )
            return RedirectResponse(url=signed_url)
        except Exception as e:
            logger.error(f"Failed to generate signed URL: {e}")
            raise HTTPException(status_code=500, detail="Could not serve photo")
    
    # Handle local storage
    elif storage_type == 'local':
        return FileResponse(path, media_type="image/jpeg")
    
    raise HTTPException(status_code=404, detail="Photo not found in storage")