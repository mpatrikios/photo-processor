import logging
import os
import io
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from sqlalchemy.orm import Session
from google.cloud import storage

from app.api.auth import get_current_user
from app.core.config import settings
from app.models.schemas import PhotoInfo, ProcessingStatus
from app.models.user import User
from database import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

# CONFIGURATION
BUCKET_NAME = settings.bucket_name
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tiff", ".bmp"}

# Initialize GCS Client
try:
    if BUCKET_NAME:
        storage_client = storage.Client()
        bucket = storage_client.bucket(BUCKET_NAME)
    else:
        bucket = None
except Exception as e:
    bucket = None

# --- HELPERS ---

def find_photo_by_id(db: Session, user_id: int, photo_id: str):
    from app.models.processing import PhotoDB
    return db.query(PhotoDB).filter(PhotoDB.photo_id == photo_id, PhotoDB.user_id == user_id).first()

def find_photo_in_storage(user_id: int, photo_db):
    if not photo_db or not photo_db.file_extension:
        return None, None, None, None
    
    filename = f"{photo_db.photo_id}{photo_db.file_extension}"
    blob_path = f"{user_id}/{filename}"
    
    if bucket:
        blob = bucket.blob(blob_path)
        if blob.exists():
            return 'gcs', blob_path, filename, blob
    
    local_path = os.path.join(settings.upload_dir, str(user_id), filename)
    if os.path.exists(local_path):
        return 'local', local_path, filename, None
    
    return None, None, None, None

# --- ROUTES ---

@router.get("/serve/{photo_id}/view")
async def serve_photo_with_token(
    photo_id: str, 
    token: str, 
    db: Session = Depends(get_db)
):
    """
    Unified Serve Route:
    Matches /api/upload/serve/{photo_id}/view?token=...
    """
    from app.services.auth_service import auth_service

    # 1. Verify token
    user = auth_service.get_user_from_token(db, token)
    if not user:
        raise HTTPException(status_code=403, detail="Invalid token")

    # 2. Look up photo in database
    photo_db = find_photo_by_id(db, user.id, photo_id)
    if not photo_db:
        raise HTTPException(status_code=404, detail="Photo record not found")
    
    # 3. Find in storage (GCS or Local)
    storage_type, path, filename, blob = find_photo_in_storage(user.id, photo_db)
    
    if not filename:
        raise HTTPException(status_code=404, detail="Photo file not found in storage")
    
    # 4. Handle GCS (Signed URL)
    if storage_type == 'gcs' and blob:
        try:
            from google.auth import default
            from google.auth.transport import requests as google_requests
            
            credentials, _ = default()
            auth_request = google_requests.Request()
            credentials.refresh(auth_request)
            
            signed_url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(minutes=15),
                method="GET",
                service_account_email=getattr(credentials, 'service_account_email', None),
                access_token=getattr(credentials, 'token', None),
            )
            return RedirectResponse(url=signed_url)
        except Exception as e:
            # Fallback to streaming if signing fails
            return StreamingResponse(io.BytesIO(blob.download_as_bytes()), media_type="image/jpeg")
    
    # 5. Handle Local fallback
    elif storage_type == 'local':
        return FileResponse(path, media_type="image/jpeg")
    
    raise HTTPException(status_code=404)