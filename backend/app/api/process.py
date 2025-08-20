from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
import uuid
from app.models.schemas import ProcessingJob, ProcessingStatus, GroupedPhotos, ManualLabelRequest
from app.services.detector import NumberDetector
import asyncio
import time

router = APIRouter()

jobs = {}
detector = NumberDetector()

@router.post("/start", response_model=ProcessingJob)
async def start_processing(photo_ids: List[str], debug: Optional[bool] = Query(True, description="Enable debug mode for detailed logging")):
    if not photo_ids:
        raise HTTPException(status_code=400, detail="No photo IDs provided")
    
    job_id = str(uuid.uuid4())
    job = ProcessingJob(
        job_id=job_id,
        photo_ids=photo_ids,
        status=ProcessingStatus.PENDING,
        total_photos=len(photo_ids),
        debug_mode=debug
    )
    
    jobs[job_id] = job
    
    asyncio.create_task(process_photos_async(job_id))
    
    return job

async def process_photos_async(job_id: str):
    job = jobs[job_id]
    job.status = ProcessingStatus.PROCESSING
    
    # ⏱️ Start timing the entire job
    job_start_time = time.time()
    print(f"⏱️ Starting photo processing job {job_id} with {job.total_photos} photos")
    
    try:
        # Add initialization phase
        await asyncio.sleep(0.2)  # Brief initialization delay
        job.progress = 1  # Show 1% for initialization
        
        total_photo_processing_time = 0
        
        for i, photo_id in enumerate(job.photo_ids):
            # Update progress at start of each photo processing
            job.completed_photos = i
            job.progress = max(1, int(((i + 0.5) / job.total_photos) * 95))  # 1-95% range
            
            # ⏱️ Time individual photo processing
            photo_start_time = time.time()
            
            await detector.process_photo(photo_id, debug_mode=job.debug_mode)
            
            photo_end_time = time.time()
            photo_processing_time = photo_end_time - photo_start_time
            total_photo_processing_time += photo_processing_time
            
            print(f"⏱️ Photo {i+1}/{job.total_photos} ({photo_id}) processed in {photo_processing_time:.2f}s")
            
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
        
        # ⏱️ Calculate and log final timing statistics
        job_end_time = time.time()
        total_job_time = job_end_time - job_start_time
        avg_photo_time = total_photo_processing_time / job.total_photos if job.total_photos > 0 else 0
        
        print(f"⏱️ Job {job_id} completed:")
        print(f"   • Total job time: {total_job_time:.2f}s")
        print(f"   • Total photo processing time: {total_photo_processing_time:.2f}s")
        print(f"   • Average time per photo: {avg_photo_time:.2f}s")
        print(f"   • Overhead time: {total_job_time - total_photo_processing_time:.2f}s")
        
    except Exception as e:
        job.status = ProcessingStatus.FAILED
        job_end_time = time.time()
        total_job_time = job_end_time - job_start_time
        print(f"⏱️ Processing failed for job {job_id} after {total_job_time:.2f}s: {str(e)}")

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
    
    # Validate bib number format (allow "unknown" as a special case)
    if request.bib_number.lower() != "unknown" and not detector._is_valid_bib_number(request.bib_number):
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