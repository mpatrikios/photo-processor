from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from typing import List, Dict, Optional
import os
import zipfile
import uuid
from collections import defaultdict
from app.models.schemas import ExportRequest
from app.services.detector import NumberDetector
from app.api.process import detector as process_detector

router = APIRouter()

EXPORT_DIR = "exports"
detector = NumberDetector()

@router.post("/export")
async def create_export(request: ExportRequest):
    if not request.photo_ids:
        raise HTTPException(status_code=400, detail="No photo IDs provided")
    
    export_id = str(uuid.uuid4())
    zip_filename = f"race_photos_{export_id}.zip"
    zip_path = os.path.join(EXPORT_DIR, zip_filename)
    
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
    
    print(f"🔍 DEBUG: Organizing {len(photo_ids)} photos for export")
    print(f"🔍 DEBUG: Local detector results: {len(detector.results)} photos")
    print(f"🔍 DEBUG: Process detector results: {len(process_detector.results)} photos")
    print(f"🔍 DEBUG: Photo IDs to export: {photo_ids[:3]}...")  # Show first 3 photo IDs
    print(f"🔍 DEBUG: Process detector keys: {list(process_detector.results.keys())[:3]}...")  # Show first 3 keys
    
    for photo_id in photo_ids:
        photo_path = find_photo_path(photo_id)
        if not photo_path:
            print(f"❌ DEBUG: Photo path not found for {photo_id}")
            continue
            
        # Get detection result from the processing detector instance
        detection_result = process_detector.results.get(photo_id)
        bib_number = "unknown"
        
        if detection_result and detection_result.bib_number:
            bib_number = detection_result.bib_number
            print(f"✅ DEBUG: Photo {photo_id} -> Bib #{bib_number}")
        else:
            print(f"❌ DEBUG: No detection result found for {photo_id}")
            print(f"❌ DEBUG: Detection result: {detection_result}")
            
            # Also check local detector instance as fallback
            fallback_result = detector.results.get(photo_id)
            if fallback_result and fallback_result.bib_number:
                bib_number = fallback_result.bib_number
                print(f"✅ DEBUG: Found in fallback detector: Photo {photo_id} -> Bib #{bib_number}")
        
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