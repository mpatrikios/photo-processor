from fastapi import APIRouter, HTTPException
from typing import List
import uuid
from app.models.schemas import ProcessingJob, ProcessingStatus, GroupedPhotos
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
        for i, photo_id in enumerate(job.photo_ids):
            await detector.process_photo(photo_id)
            job.completed_photos = i + 1
            job.progress = int((job.completed_photos / job.total_photos) * 100)
        
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