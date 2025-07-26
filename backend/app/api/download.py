from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from typing import List
import os
import zipfile
import uuid
from app.models.schemas import ExportRequest

router = APIRouter()

EXPORT_DIR = "exports"

@router.post("/export")
async def create_export(request: ExportRequest):
    if not request.photo_ids:
        raise HTTPException(status_code=400, detail="No photo IDs provided")
    
    export_id = str(uuid.uuid4())
    zip_filename = f"race_photos_{export_id}.zip"
    zip_path = os.path.join(EXPORT_DIR, zip_filename)
    
    try:
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for photo_id in request.photo_ids:
                photo_path = find_photo_path(photo_id)
                if photo_path and os.path.exists(photo_path):
                    arcname = os.path.basename(photo_path)
                    zipf.write(photo_path, arcname)
        
        return {"export_id": export_id, "download_url": f"/api/download/file/{export_id}"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create export: {str(e)}")

@router.get("/file/{export_id}")
async def download_export(export_id: str):
    zip_filename = f"race_photos_{export_id}.zip"
    zip_path = os.path.join(EXPORT_DIR, zip_filename)
    
    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="Export file not found")
    
    return FileResponse(
        path=zip_path,
        filename=zip_filename,
        media_type="application/zip"
    )

def find_photo_path(photo_id: str) -> str:
    extensions = [".jpg", ".jpeg", ".png", ".tiff", ".bmp"]
    
    for directory in ["processed", "uploads"]:
        for ext in extensions:
            path = os.path.join(directory, f"{photo_id}{ext}")
            if os.path.exists(path):
                return path
    
    return None