from fastapi import APIRouter, HTTPException
from typing import List
import uuid
from app.models.schemas import ProcessingJob, ProcessingStatus, GroupedPhotos, ManualLabelRequest
from app.services.detector import NumberDetector
import asyncio

router = APIRouter()

jobs = {}
detector = NumberDetector()

@router.post("/start", response_model=ProcessingJob)
async def start_processing(photo_ids: List[str]):
    if not photo_ids:
        raise HTTPException(status_code=400, detail="No photo IDs provided")
    
    job_id = str(uuid.uuid4())
    job = ProcessingJob(
        job_id=job_id,
        photo_ids=photo_ids,
        status=ProcessingStatus.PENDING,
        total_photos=len(photo_ids)
    )
    
    jobs[job_id] = job
    
    asyncio.create_task(process_photos_async(job_id))
    
    return job

async def process_photos_async(job_id: str):
    job = jobs[job_id]
    job.status = ProcessingStatus.PROCESSING
    
    try:
        # Add initialization phase
        await asyncio.sleep(0.2)  # Brief initialization delay
        job.progress = 1  # Show 1% for initialization
        
        for i, photo_id in enumerate(job.photo_ids):
            # Update progress at start of each photo processing
            job.completed_photos = i
            job.progress = max(1, int(((i + 0.5) / job.total_photos) * 95))  # 1-95% range
            
            await detector.process_photo(photo_id)
            
            # Add small delay to make progress visible and prevent overwhelming the system
            await asyncio.sleep(0.1)  # 100ms delay per photo for smoother UX
            
            # Update progress after completing each photo
            job.completed_photos = i + 1
            job.progress = max(1, int((job.completed_photos / job.total_photos) * 95))
        
        # Finalization phase
        job.progress = 95
        await asyncio.sleep(0.3)  # Brief finalization delay
        
        # Final completion
        job.progress = 100
        job.status = ProcessingStatus.COMPLETED
        
    except Exception as e:
        job.status = ProcessingStatus.FAILED
        print(f"Processing failed for job {job_id}: {str(e)}")

@router.get("/status/{job_id}", response_model=ProcessingJob)
async def get_processing_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return jobs[job_id]

@router.get("/results/{job_id}")
async def get_processing_results(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = jobs[job_id]
    if job.status != ProcessingStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Processing not completed")
    
    return await detector.get_grouped_results(job.photo_ids)

@router.put("/manual-label")
async def manual_label_photo(request: ManualLabelRequest):
    """Manually assign a bib number to a photo"""
    if not request.photo_id or not request.bib_number:
        raise HTTPException(status_code=400, detail="Photo ID and bib number are required")
    
    # Validate bib number format
    if not detector._is_valid_bib_number(request.bib_number):
        raise HTTPException(status_code=400, detail="Invalid bib number format")
    
    # Check if photo exists
    photo_path = detector._find_photo_path(request.photo_id)
    if not photo_path:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    # Update the detection result with manual label
    success = detector.update_manual_label(request.photo_id, request.bib_number)
    
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update photo label")
    
    return {"message": f"Photo {request.photo_id} successfully labeled as bib #{request.bib_number}", "photo_id": request.photo_id, "bib_number": request.bib_number}