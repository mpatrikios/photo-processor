from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from typing import List
import uuid
import os
import shutil
from app.models.schemas import UploadResponse, PhotoInfo, ProcessingStatus

router = APIRouter()

UPLOAD_DIR = "uploads"
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tiff", ".bmp"}

# Ensure upload directory exists
os.makedirs(UPLOAD_DIR, exist_ok=True)

def get_file_extension(filename: str) -> str:
    return os.path.splitext(filename.lower())[1]

def is_allowed_file(filename: str) -> bool:
    return get_file_extension(filename) in ALLOWED_EXTENSIONS

@router.post("/photos", response_model=UploadResponse)
async def upload_photos(files: List[UploadFile] = File(...)):
    print(f"🔄 Upload endpoint called with {len(files) if files else 0} files")
    
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
    
    photo_ids = []
    
    for file in files:
        print(f"📁 Processing file: {file.filename}")
        
        if not is_allowed_file(file.filename):
            raise HTTPException(
                status_code=400, 
                detail=f"File {file.filename} has invalid extension. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
            )
        
        photo_id = str(uuid.uuid4())
        file_extension = get_file_extension(file.filename)
        new_filename = f"{photo_id}{file_extension}"
        file_path = os.path.join(UPLOAD_DIR, new_filename)
        
        print(f"💾 Saving to: {file_path}")
        
        try:
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            photo_ids.append(photo_id)
            print(f"✅ Saved file with ID: {photo_id}")
            
        except Exception as e:
            print(f"❌ Failed to save {file.filename}: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to save file {file.filename}: {str(e)}")
    
    print(f"🎉 Successfully uploaded {len(photo_ids)} photos")
    return UploadResponse(
        photo_ids=photo_ids,
        message=f"Successfully uploaded {len(photo_ids)} photos"
    )

@router.get("/photos/{photo_id}")
async def get_photo_info(photo_id: str):
    file_path = None
    for ext in ALLOWED_EXTENSIONS:
        test_path = os.path.join(UPLOAD_DIR, f"{photo_id}{ext}")
        if os.path.exists(test_path):
            file_path = test_path
            break
    
    if not file_path:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    return PhotoInfo(
        id=photo_id,
        filename=os.path.basename(file_path),
        original_path=file_path,
        status=ProcessingStatus.PENDING
    )

@router.get("/serve/{photo_id}")
async def serve_photo(photo_id: str):
    """Serve photo file by ID"""
    file_path = None
    for ext in ALLOWED_EXTENSIONS:
        test_path = os.path.join(UPLOAD_DIR, f"{photo_id}{ext}")
        if os.path.exists(test_path):
            file_path = test_path
            break
    
    if not file_path:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    return FileResponse(file_path, media_type="image/jpeg")

