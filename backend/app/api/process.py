from fastapi import APIRouter, HTTPException, Query, Depends
from typing import List, Optional, Dict
import uuid
from app.models.schemas import ProcessingJob, ProcessingStatus, GroupedPhotos, ManualLabelRequest
from app.services.detector import NumberDetector
from app.api.auth import get_current_user
from app.models.user import User
from sqlalchemy.orm import Session
from database import get_db
import asyncio
import time

router = APIRouter()

# Store jobs with user association
# Structure: {job_id: {"job": ProcessingJob, "user_id": int}}
jobs: Dict[str, dict] = {}
detector = NumberDetector()

@router.post("/start", response_model=ProcessingJob)
async def start_processing(
    photo_ids: List[str],
    debug: Optional[bool] = Query(True, description="Enable debug mode for detailed logging"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
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
    
    # Store job with user association
    jobs[job_id] = {
        "job": job,
        "user_id": current_user.id
    }
    
    asyncio.create_task(process_photos_async(job_id))
    
    return job

async def process_photos_async(job_id: str):
    job_data = jobs.get(job_id)
    if not job_data:
        return
    job = job_data["job"]
    job.status = ProcessingStatus.PROCESSING
    
    # ⏱️ Start timing the entire job for analytics
    job_start_time = time.time()
    print(f"⏱️ Starting photo processing job {job_id} with {job.total_photos} photos")
    
    try:
        job.progress = 1  # Show 1% for initialization
        
        # Parallel processing configuration
        BATCH_SIZE = 5  # Process 5 photos simultaneously
        semaphore = asyncio.Semaphore(BATCH_SIZE)
        total_photo_processing_time = 0
        completed_count = 0
        
        async def process_photo_with_semaphore(photo_id: str, index: int):
            async with semaphore:
                # ⏱️ Time individual photo processing for analytics
                photo_start_time = time.time()
                
                try:
                    await detector.process_photo(photo_id, debug_mode=job.debug_mode)
                    
                    photo_processing_time = time.time() - photo_start_time
                    print(f"⏱️ Photo {index+1}/{job.total_photos} processed in {photo_processing_time:.2f}s")
                    return photo_processing_time
                    
                except Exception as e:
                    print(f"❌ Failed to process photo {photo_id}: {e}")
                    return 0
        
        # Process photos in batches
        for batch_start in range(0, len(job.photo_ids), BATCH_SIZE):
            batch_end = min(batch_start + BATCH_SIZE, len(job.photo_ids))
            batch_photo_ids = job.photo_ids[batch_start:batch_end]
            
            # Create tasks for the current batch
            batch_tasks = [
                process_photo_with_semaphore(photo_id, batch_start + i)
                for i, photo_id in enumerate(batch_photo_ids)
            ]
            
            # Process batch in parallel
            batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)
            
            # Update timing and progress
            valid_times = [t for t in batch_results if isinstance(t, (int, float)) and t > 0]
            total_photo_processing_time += sum(valid_times)
            completed_count = batch_end
            
            # Update progress (1-95% range)
            job.completed_photos = completed_count
            job.progress = max(1, int((completed_count / job.total_photos) * 95))
        
        # Finalization phase
        job.progress = 95
        await asyncio.sleep(0.3)  # Brief finalization delay
        
        # Final completion
        job.progress = 100
        job.status = ProcessingStatus.COMPLETED
        
        # ⏱️ Calculate and log final timing statistics for analytics
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
async def get_processing_status(
    job_id: str,
    current_user: User = Depends(get_current_user)
):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job_data = jobs[job_id]
    # Verify user owns this job
    if job_data["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    return job_data["job"]

@router.get("/results/{job_id}")
async def get_processing_results(
    job_id: str,
    current_user: User = Depends(get_current_user)
):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job_data = jobs[job_id]
    # Verify user owns this job
    if job_data["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    job = job_data["job"]
    if job.status != ProcessingStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Processing not completed")
    
    return await detector.get_grouped_results(job.photo_ids)

@router.put("/manual-label")
async def manual_label_photo(
    request: ManualLabelRequest,
    current_user: User = Depends(get_current_user)
):
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