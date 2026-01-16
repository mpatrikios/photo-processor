import asyncio
import json
import logging
import os
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import update

# --- FIX 1: Top-level imports to prevent NameError in Worker ---
from app.models.schemas import DetectionResult, ProcessingJob, ProcessingStatus


# Request models for progressive processing
class StartProcessingRequest(BaseModel):
    photo_ids: List[str]
    expected_total: Optional[int] = None  # Total photos coming (for accurate progress %)
    upload_started_at: Optional[datetime] = None  # When user clicked upload (for full experience timing)


class AddBatchRequest(BaseModel):
    job_id: str
    photo_ids: List[str]


from app.models.usage import ProcessingJob as ProcessingJobDB
from app.models.user import User
from app.models.processing import PhotoDB
from app.api.auth import get_current_user
from app.services.usage_tracker import usage_tracker
from database import SessionLocal, get_db
from app.services.detector import NumberDetector

# Initialize
logger = logging.getLogger(__name__)
router = APIRouter()
detector = NumberDetector()

# --- FIX 2: Standardized Cloud Config ---
PROJECT = os.getenv('GOOGLE_CLOUD_PROJECT', 'tagsort').lower()
LOCATION = os.getenv('GCP_LOCATION', 'us-central1')
QUEUE = "photo-processing-queue"
# This must match your Cloud Run URL
SERVICE_URL = os.getenv('BASE_URL', 'https://tagsort-api-486078451066.us-central1.run.app')

# Import Cloud Tasks Client
try:
    from google.cloud import tasks_v2
    task_client = tasks_v2.CloudTasksClient()
    CLOUD_TASKS_AVAILABLE = True
    logger.info("✅ Cloud Tasks client initialized")
except Exception as e:
    CLOUD_TASKS_AVAILABLE = False
    task_client = None
    logger.error(f"❌ Cloud Tasks initialization failed: {e}")

# In-memory job store
jobs: Dict[str, dict] = {}

# Final diagnostic summary
logger.info(f"🔍 DIAGNOSTIC SUMMARY:")
logger.info(f"🔍 - CLOUD_TASKS_AVAILABLE: {CLOUD_TASKS_AVAILABLE}")
logger.info(f"🔍 - task_client initialized: {task_client is not None}")
logger.info(f"🔍 - PROJECT: {PROJECT}")
logger.info(f"🔍 - LOCATION: {LOCATION}")
logger.info(f"🔍 - QUEUE: {QUEUE}")
logger.info(f"🔍 - SERVICE_URL: {SERVICE_URL}")


def queue_batch_tasks(
    photo_ids: List[str], job_id: str, user_id: int, debug_mode: bool = False
) -> int:
    """
    Queue Cloud Tasks for a batch of photos. Reusable helper for /start and /add-batch.
    Returns the number of tasks successfully created.
    """
    if not task_client:
        logger.warning(f"🚫 Cloud Tasks not available, cannot queue tasks")
        return 0

    queue_path = task_client.queue_path(PROJECT, LOCATION, QUEUE)
    worker_url = f"{SERVICE_URL}/api/process/batch-worker"

    # Group photos into batches of 20 (processed concurrently within each batch)
    # Larger batches = fewer Cloud Tasks = fewer cold starts = better parallelism
    BATCH_SIZE = 20
    photo_batches = [photo_ids[i:i + BATCH_SIZE] for i in range(0, len(photo_ids), BATCH_SIZE)]

    logger.info(f"🔄 Queuing {len(photo_batches)} batch tasks for job {job_id[:8]}...")

    tasks_created = 0
    for batch_idx, photo_batch in enumerate(photo_batches):
        try:
            payload = {
                "photo_ids": photo_batch,
                "job_id": job_id,
                "user_id": user_id,
                "batch_index": batch_idx + 1,
                "total_batches": len(photo_batches),
                "debug_mode": debug_mode
            }
            task = {
                "http_request": {
                    "http_method": tasks_v2.HttpMethod.POST,
                    "url": worker_url,
                    "headers": {"Content-Type": "application/json"},
                    "body": json.dumps(payload).encode(),
                    "oidc_token": {
                        "service_account_email": "tagsort-web-sa@tagsort.iam.gserviceaccount.com",
                        "audience": SERVICE_URL,
                    },
                }
            }
            task_client.create_task(request={"parent": queue_path, "task": task})
            tasks_created += 1
            logger.info(f"✅ Created task {batch_idx + 1}/{len(photo_batches)}: {len(photo_batch)} photos")
        except Exception as task_error:
            logger.error(f"❌ Failed to create task {batch_idx + 1}: {task_error}")

    return tasks_created


@router.post("/start", response_model=ProcessingJob)
async def start_processing_with_tasks(
    request: StartProcessingRequest,
    debug: Optional[bool] = Query(None, description="Enable debug mode (overrides env var)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    photo_ids = request.photo_ids
    if not photo_ids:
        raise HTTPException(status_code=400, detail="No photo IDs provided")

    # Use environment variable if query param not provided
    if debug is None:
        debug = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")

    # Use expected_total for progress calculation (supports progressive processing)
    total_photos = request.expected_total or len(photo_ids)

    job_id = str(uuid.uuid4())
    job = ProcessingJob(
        job_id=job_id,
        photo_ids=photo_ids,
        status=ProcessingStatus.PENDING,
        total_photos=total_photos,
        debug_mode=debug,
    ) 

    # 1. Store in-memory
    jobs[job_id] = {"job": job, "user_id": current_user.id}

    # 2. Create DB record (use total_photos which includes expected_total for progressive processing)
    usage_tracker.create_processing_job(
        db=db, user_id=current_user.id, job_id=job_id, total_photos=total_photos,
        started_at=request.upload_started_at  # Full user experience timing from button click
    )

    # 3. CRITICAL: Link existing PhotoDB records to the processing job
    # This allows the worker to find them when updating progress
    from app.models.processing import PhotoDB
    from app.models.usage import ProcessingJob as ProcessingJobDB
    
    # Get the INTEGER primary key for this job_id 
    processing_job_record = db.query(ProcessingJobDB).filter(
        ProcessingJobDB.job_id == job_id,
        ProcessingJobDB.user_id == current_user.id
    ).first()
    
    if processing_job_record:
        # Use the INTEGER primary key instead of UUID string
        db.query(PhotoDB).filter(
            PhotoDB.photo_id.in_(photo_ids),
            PhotoDB.user_id == current_user.id
        ).update({PhotoDB.processing_job_id: processing_job_record.id}, synchronize_session=False)
        db.commit()

    # 4. Update status (keep started_at from create_processing_job - frontend timestamp)
    job.status = ProcessingStatus.PROCESSING
    usage_tracker.update_processing_job(db=db, job_id=job_id, status="processing")

    # 5. Queue Cloud Tasks for this batch
    tasks_created = queue_batch_tasks(photo_ids, job_id, current_user.id, debug)

    if tasks_created == 0:
        logger.warning(f"🚫 No Cloud Tasks created, using fallback async processing")
        asyncio.create_task(process_photos_async_fallback(job_id, photo_ids, current_user.id, debug))
    else:
        logger.info(f"🎉 {tasks_created} tasks queued successfully for job {job_id[:8]}...")

    return job


@router.post("/add-batch")
async def add_batch_to_job(
    request: AddBatchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Add more photos to an existing processing job (for progressive processing).
    Called by frontend after each upload batch completes.
    """
    job_id = request.job_id
    photo_ids = request.photo_ids

    if not photo_ids:
        raise HTTPException(status_code=400, detail="No photo IDs provided")

    # Verify job exists and belongs to user
    job_data = jobs.get(job_id)
    if not job_data:
        # Fallback: check database (handles multi-instance Cloud Run)
        db_job = db.query(ProcessingJobDB).filter(
            ProcessingJobDB.job_id == job_id,
            ProcessingJobDB.user_id == current_user.id
        ).first()
        if not db_job:
            raise HTTPException(status_code=404, detail="Job not found")

        # Restore to memory
        logger.info(f"🔄 Restoring job from database for add-batch: {job_id[:8]}...")
        job = ProcessingJob(
            job_id=db_job.job_id,
            photo_ids=[],
            status=ProcessingStatus(db_job.status) if db_job.status in [s.value for s in ProcessingStatus] else ProcessingStatus.PROCESSING,
            total_photos=db_job.total_photos or 0,
            progress=db_job.progress or 0
        )
        jobs[job_id] = {"job": job, "user_id": db_job.user_id}
        job_data = jobs[job_id]

    if job_data["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied to job")

    # Link photos to processing job in DB
    processing_job_record = db.query(ProcessingJobDB).filter(
        ProcessingJobDB.job_id == job_id,
        ProcessingJobDB.user_id == current_user.id
    ).first()

    if not processing_job_record:
        raise HTTPException(status_code=404, detail="Processing job record not found")

    db.query(PhotoDB).filter(
        PhotoDB.photo_id.in_(photo_ids),
        PhotoDB.user_id == current_user.id
    ).update({PhotoDB.processing_job_id: processing_job_record.id}, synchronize_session=False)
    db.commit()

    # Queue Cloud Tasks for new batch
    tasks_created = queue_batch_tasks(photo_ids, job_id, current_user.id, debug_mode=False)

    logger.info(f"📥 ADD-BATCH: Added {len(photo_ids)} photos to job {job_id[:8]}..., queued {tasks_created} tasks")

    return {"status": "ok", "added": len(photo_ids), "tasks_created": tasks_created}


@router.post("/batch-worker")
async def process_batch_photos_worker(request: Request):
    """
    Concurrent Cloud Tasks Batch Worker Endpoint
    Each request handles multiple photos with concurrent Gemini API calls (1 photo per prompt).
    """
    import time
    batch_start_time = time.time()

    db = SessionLocal()
    try:
        payload = await request.json()
        photo_ids = payload.get("photo_ids", [])
        job_id = payload.get("job_id")
        user_id = payload.get("user_id")
        batch_index = payload.get("batch_index", 1)
        total_batches = payload.get("total_batches", 1)
        debug_mode = payload.get("debug_mode", False)

        if not all([photo_ids, job_id, user_id]) or not isinstance(photo_ids, list):
            return {"status": "error", "message": "Missing or invalid payload fields"}

        logger.info(f"🔄 BATCH WORKER START: {batch_index}/{total_batches} processing {len(photo_ids)} photos")

        # ⏱️ TIMING: Gemini detection
        detection_start = time.time()
        batch_results = await detector.process_photo_batch(
            photo_ids, debug_mode=debug_mode, user_id=user_id
        )
        detection_time = (time.time() - detection_start) * 1000
        logger.info(f"⏱️ BATCH {batch_index}: Gemini detection took {detection_time:.0f}ms for {len(photo_ids)} photos")

        if not batch_results:
            logger.error(f"❌ BATCH FAILED: No results returned from detector")
            return {"status": "error", "message": "Batch processing failed"}

        # ⏱️ TIMING: Database save
        db_save_start = time.time()
        await save_batch_results_to_database(batch_results, user_id, job_id)
        db_save_time = (time.time() - db_save_start) * 1000
        logger.info(f"⏱️ BATCH {batch_index}: DB save took {db_save_time:.0f}ms")

        # ⏱️ TIMING: Job progress update
        progress_start = time.time()
        await update_job_progress(job_id, db)
        progress_time = (time.time() - progress_start) * 1000
        logger.info(f"⏱️ BATCH {batch_index}: Progress update took {progress_time:.0f}ms")

        successful_count = len([r for r in batch_results.values() if r.bib_number not in ["unknown", "error"]])

        total_batch_time = (time.time() - batch_start_time) * 1000
        logger.info(f"⏱️ BATCH {batch_index} TOTAL: {total_batch_time:.0f}ms (Detection: {detection_time:.0f}ms, DB: {db_save_time:.0f}ms, Progress: {progress_time:.0f}ms)")
        logger.info(f"✅ Batch {batch_index}/{total_batches}: {successful_count}/{len(photo_ids)} photos detected")

        return {
            "status": "success",
            "batch_index": batch_index,
            "processed_count": len(batch_results),
            "successful_count": successful_count
        }
            
    except Exception as e:
        logger.error(f"🔥 Batch worker failed for batch {batch_index if 'batch_index' in locals() else 'unknown'}: {e}")
        # Raising 500 tells Cloud Tasks to RETRY this batch automatically
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


async def save_batch_results_to_database(batch_results: Dict[str, DetectionResult], user_id: int, processing_job_id: str):
    """Save multiple detection results using simple loop for reliability."""
    db_session = SessionLocal()
    try:
        from app.models.processing import PhotoDB, ProcessingStatus
        from app.models.usage import ProcessingJob as ProcessingJobDB
        
        processed_time = datetime.utcnow()
        
        # Get the INTEGER primary key for this job_id 
        processing_job_record = db_session.query(ProcessingJobDB).filter(
            ProcessingJobDB.job_id == processing_job_id,
            ProcessingJobDB.user_id == user_id
        ).first()
        
        processing_job_pk = processing_job_record.id if processing_job_record else None
        
        # Simple approach: update each photo individually in a transaction
        for photo_id, detection_result in batch_results.items():
            photo = db_session.query(PhotoDB).filter(
                PhotoDB.photo_id == photo_id, 
                PhotoDB.user_id == user_id
            ).first()
            
            if photo:
                if detection_result.bib_number and detection_result.bib_number not in ["unknown", "error"]:
                    # Successful detection
                    photo.detected_number = detection_result.bib_number
                    photo.confidence = detection_result.confidence
                    photo.detection_method = "gemini_flash_batch"
                    photo.processing_status = ProcessingStatus.COMPLETED
                    photo.processing_job_id = processing_job_pk
                    photo.processed_at = processed_time
                    
                    # Add bounding box if available
                    if detection_result.bbox:
                        photo.bbox_x1 = detection_result.bbox[0]
                        photo.bbox_y1 = detection_result.bbox[1]
                        photo.bbox_x2 = detection_result.bbox[2]
                        photo.bbox_y2 = detection_result.bbox[3]
                else:
                    # Unknown/error detection
                    photo.detected_number = "unknown"
                    photo.confidence = 0.0
                    photo.detection_method = "gemini_flash_batch"
                    photo.processing_status = ProcessingStatus.COMPLETED
                    photo.processing_job_id = processing_job_pk
                    photo.processed_at = processed_time
            else:
                logger.warning(f"Photo {photo_id} not found for user {user_id}")
        
        db_session.commit()
        logger.info(f"✅ BATCH SAVED: {len(batch_results)} photos saved to database with job_pk={processing_job_pk}")
        
    except Exception as e:
        db_session.rollback()
        logger.error(f"❌ DB Save Failed: {e}")
        raise
    finally:
        db_session.close()


async def save_detection_to_database(photo_id: str, user_id: int, detection_result, processing_job_id: str):
    """Save detection result to PhotoDB table after OCR processing."""
    try:
        from app.models.processing import PhotoDB, ProcessingStatus
        from app.models.usage import ProcessingJob as ProcessingJobDB
        
        db_session = SessionLocal()
        try:
            # Get the INTEGER primary key for this job_id 
            processing_job_record = db_session.query(ProcessingJobDB).filter(
                ProcessingJobDB.job_id == processing_job_id,
                ProcessingJobDB.user_id == user_id
            ).first()
            
            processing_job_pk = processing_job_record.id if processing_job_record else None
            # Check if photo record already exists
            existing_photo = db_session.query(PhotoDB).filter(
                PhotoDB.photo_id == photo_id,
                PhotoDB.user_id == user_id
            ).first()
            
            if existing_photo:
                # Update existing record with detection results
                if detection_result.bib_number and detection_result.bib_number != "unknown":
                    existing_photo.detected_number = detection_result.bib_number
                    existing_photo.confidence = detection_result.confidence
                    existing_photo.detection_method = "gemini_flash"
                    if detection_result.bbox:
                        existing_photo.bbox_x1 = detection_result.bbox[0]
                        existing_photo.bbox_y1 = detection_result.bbox[1] 
                        existing_photo.bbox_x2 = detection_result.bbox[2]
                        existing_photo.bbox_y2 = detection_result.bbox[3]
                    existing_photo.processing_status = ProcessingStatus.COMPLETED
                    existing_photo.processing_job_id = processing_job_pk
                    existing_photo.processed_at = datetime.utcnow()
                else:
                    existing_photo.detected_number = "unknown"
                    existing_photo.confidence = 0.0
                    existing_photo.detection_method = "gemini_flash"
                    existing_photo.processing_status = ProcessingStatus.COMPLETED
                    existing_photo.processing_job_id = processing_job_pk
                    existing_photo.processed_at = datetime.utcnow()
                
                db_session.commit()
                logger.debug(f"Updated photo {photo_id} in database with detection results")
            else:
                logger.warning(f"Photo {photo_id} not found in database - skipping result save")
                
        except Exception as db_error:
            db_session.rollback()
            logger.error(f"Database error saving detection for {photo_id}: {db_error}")
            raise
        finally:
            db_session.close()
            
    except Exception as e:
        logger.error(f"Failed to save detection result for photo {photo_id}: {e}")
        raise


async def update_job_progress(job_id: str, db: Session):
    """Update job progress based on completed photos"""
    try:
        from app.models.processing import PhotoDB, ProcessingStatus
        from app.models.usage import ProcessingJob as ProcessingJobDB

        # Get job data from memory (has expected total from /start)
        job_data = jobs.get(job_id)
        if not job_data:
            logger.warning(f"❌ Job not found in memory: {job_id[:8]}...")
            return

        # Use expected_total from job (set at /start), not current linked count
        # This prevents premature completion when photos are still being linked via /add-batch
        expected_total = job_data["job"].total_photos

        # Get the INTEGER primary key for this job_id
        processing_job_record = db.query(ProcessingJobDB).filter(
            ProcessingJobDB.job_id == job_id
        ).first()

        if not processing_job_record:
            logger.warning(f"Processing job not found: {job_id}")
            return

        processing_job_pk = processing_job_record.id

        # Count completed photos (use expected_total for progress, not linked count)
        completed_photos = db.query(PhotoDB).filter(
            PhotoDB.processing_job_id == processing_job_pk,
            PhotoDB.processing_status == ProcessingStatus.COMPLETED
        ).count()

        logger.info(f"🔢 PROGRESS COUNT: {job_id[:8]}... {completed_photos}/{expected_total} photos completed")

        if expected_total > 0:
            progress = int((completed_photos / expected_total) * 100)

            old_progress = job_data["job"].progress
            old_status = job_data["job"].status

            job_data["job"].progress = progress
            job_data["job"].completed_photos = completed_photos

            logger.info(f"📊 UPDATING: {job_id[:8]}... progress {old_progress}→{progress}")

            # Check if job is complete using expected_total (not linked count)
            if completed_photos >= expected_total:
                job_data["job"].status = ProcessingStatus.COMPLETED
                completed_at = datetime.utcnow()
                # Calculate full user experience time from upload button click
                processing_time = None
                started = processing_job_record.started_at or processing_job_record.created_at
                if started:
                    # Handle timezone-aware vs naive datetime comparison
                    if started.tzinfo is not None:
                        started = started.replace(tzinfo=None)  # Make naive for comparison
                    processing_time = (completed_at - started).total_seconds()
                usage_tracker.update_processing_job(
                    db=db, job_id=job_id, status="completed",
                    progress=100, completed_at=completed_at,
                    total_processing_time_seconds=processing_time,
                )
                logger.info(f"🎉 JOB COMPLETED: {job_id[:8]}... {completed_photos}/{expected_total} in {processing_time:.1f}s" if processing_time else f"🎉 JOB COMPLETED: {job_id[:8]}... {completed_photos}/{expected_total}")
            else:
                usage_tracker.update_processing_job(db=db, job_id=job_id, progress=progress)
                logger.info(f"📈 PROGRESS: {job_id[:8]}... {progress}% ({completed_photos}/{expected_total})")

        db.commit()

    except Exception as e:
        logger.error(f"Error updating job progress for {job_id}: {e}")


# Keep existing endpoints for compatibility
@router.get("/status/{job_id}")
async def get_processing_status(job_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get the current status of a processing job with real-time database check"""
    logger.info(f"🔍 STATUS REQUEST: {job_id[:8]}... from user {current_user.id}")
    
    job_data = jobs.get(job_id)
    if not job_data:
        # Fallback: check database (handles multi-instance Cloud Run)
        db_job = db.query(ProcessingJobDB).filter(
            ProcessingJobDB.job_id == job_id,
            ProcessingJobDB.user_id == current_user.id
        ).first()
        if not db_job:
            logger.warning(f"❌ Job not found in memory or database: {job_id[:8]}...")
            raise HTTPException(status_code=404, detail="Job not found")

        # Restore to memory for faster subsequent polls
        logger.info(f"🔄 Restoring job from database: {job_id[:8]}...")
        job = ProcessingJob(
            job_id=db_job.job_id,
            photo_ids=[],
            status=ProcessingStatus(db_job.status) if db_job.status in [s.value for s in ProcessingStatus] else ProcessingStatus.PROCESSING,
            total_photos=db_job.total_photos or 0,
            progress=db_job.progress or 0
        )
        jobs[job_id] = {"job": job, "user_id": db_job.user_id}
        job_data = jobs[job_id]

    # SECURITY: Verify job belongs to current user
    if job_data["user_id"] != current_user.id:
        logger.warning(f"❌ Access denied to job {job_id[:8]}... for user {current_user.id}")
        raise HTTPException(status_code=403, detail="Access denied to job")
    
    # Log current in-memory state
    current_status = job_data["job"].status
    current_progress = job_data["job"].progress
    logger.info(f"📊 CURRENT STATE: {job_id[:8]}... status={current_status}, progress={current_progress}")
    
    # Real-time check: Update job status from database if still processing
    if current_status == ProcessingStatus.PROCESSING:
        logger.info(f"🔄 Job still processing, checking database for updates: {job_id[:8]}...")
        try:
            # Force update job progress from database
            await update_job_progress(job_id, db)
            
            # Check if status changed after update
            new_status = job_data["job"].status
            new_progress = job_data["job"].progress
            if new_status != current_status or new_progress != current_progress:
                logger.info(f"📈 STATUS CHANGE: {job_id[:8]}... {current_status}→{new_status}, {current_progress}→{new_progress}")
            else:
                logger.info(f"📊 NO CHANGE: {job_id[:8]}... still {current_status} at {current_progress}%")
            
            # Timeout protection: If job has been processing for more than 10 minutes, mark as failed
            from datetime import datetime, timedelta
            if hasattr(job_data["job"], 'created_at'):
                time_elapsed = datetime.utcnow() - job_data["job"].created_at
                if time_elapsed > timedelta(minutes=10):
                    logger.warning(f"⏰ TIMEOUT: {job_id[:8]}... after {time_elapsed.total_seconds():.1f}s")
                    job_data["job"].status = ProcessingStatus.FAILED
                    job_data["job"].progress = 0
                    
        except Exception as e:
            logger.error(f"❌ Failed to update job progress for {job_id[:8]}...: {e}")
    else:
        logger.info(f"✅ Job already completed: {job_id[:8]}... status={current_status}")
    
    # Ensure proper JSON serialization by converting to dict if it's a Pydantic model
    job_response = job_data["job"]
    if hasattr(job_response, 'dict'):
        job_response = job_response.dict()
    
    final_status = job_response.get('status', 'unknown')
    final_progress = job_response.get('progress', 0)
    logger.info(f"📤 RESPONSE: {job_id[:8]}... returning status={final_status}, progress={final_progress}")
    
    return job_response


@router.get("/results/{job_id}")  
async def get_processing_results(job_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get the results of a completed processing job"""
    try:
        # Check if job exists and belongs to user
        job_data = jobs.get(job_id)
        if not job_data:
            # Fallback: check database (handles multi-instance Cloud Run)
            db_job = db.query(ProcessingJobDB).filter(
                ProcessingJobDB.job_id == job_id,
                ProcessingJobDB.user_id == current_user.id
            ).first()
            if not db_job:
                raise HTTPException(status_code=404, detail="Job not found")

            # Restore to memory
            logger.info(f"🔄 Restoring job from database for results: {job_id[:8]}...")
            job = ProcessingJob(
                job_id=db_job.job_id,
                photo_ids=[],
                status=ProcessingStatus(db_job.status) if db_job.status in [s.value for s in ProcessingStatus] else ProcessingStatus.PROCESSING,
                total_photos=db_job.total_photos or 0,
                progress=db_job.progress or 0
            )
            jobs[job_id] = {"job": job, "user_id": db_job.user_id}
            job_data = jobs[job_id]

        # Verify job belongs to current user
        if job_data["user_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied to job")

        # Get all photos for this job from the database
        from app.models.processing import PhotoDB
        
        # Get the INTEGER primary key for this job_id 
        processing_job_record = db.query(ProcessingJobDB).filter(
            ProcessingJobDB.job_id == job_id,
            ProcessingJobDB.user_id == current_user.id
        ).first()
        
        if not processing_job_record:
            logger.warning(f"Processing job not found: {job_id}")
            return {"unknown": []}
            
        processing_job_pk = processing_job_record.id
        
        photos = db.query(PhotoDB).filter(
            PhotoDB.processing_job_id == processing_job_pk,
            PhotoDB.user_id == current_user.id
        ).all()
        
        if not photos:
            logger.warning(f"No photos found for job {job_id}, user {current_user.id}")
            return {"unknown": []}
        
        # Group photos by bib number
        grouped_photos = {}
        
        for photo in photos:
            # Get effective bib number (manual label takes precedence)
            bib_number = photo.manual_label or photo.detected_number or 'unknown'
            
            # Initialize group if not exists
            if bib_number not in grouped_photos:
                grouped_photos[bib_number] = []
            
            # Frontend will generate image URL using getImageUrl() method with JWT token
            photo_data = {
                "id": photo.photo_id,  # Frontend uses this with getImageUrl() for secure access
                "filename": photo.original_filename,
                "detected_number": photo.detected_number,
                "manual_label": photo.manual_label,
                "confidence": photo.confidence,
                "detection_method": photo.detection_method,
                "file_size_mb": round(photo.file_size_bytes / (1024 * 1024), 2) if photo.file_size_bytes else 0,
                "processing_status": photo.processing_status.value if photo.processing_status else "pending",
                "created_at": photo.created_at.isoformat() if photo.created_at else None,
                "processed_at": photo.processed_at.isoformat() if photo.processed_at else None
            }
            
            # Add bounding box if available
            if photo.bbox_x is not None and photo.bbox_y is not None:
                photo_data["bbox"] = {
                    "x": photo.bbox_x,
                    "y": photo.bbox_y, 
                    "width": photo.bbox_width,
                    "height": photo.bbox_height
                }
            
            grouped_photos[bib_number].append(photo_data)
        
        # Sort groups: numbered bibs first (sorted numerically), then unknown
        sorted_grouped = {}
        
        # Add numbered bibs first, sorted numerically
        numbered_bibs = []
        for bib in grouped_photos.keys():
            if bib != 'unknown':
                try:
                    # Try to convert to int for proper numeric sorting
                    numbered_bibs.append((int(bib), bib))
                except ValueError:
                    # Non-numeric bib, add as string
                    numbered_bibs.append((float('inf'), bib))
        
        # Sort by numeric value, then by string
        numbered_bibs.sort(key=lambda x: (x[0], x[1]))
        
        # Add sorted numbered groups
        for _, bib in numbered_bibs:
            sorted_grouped[bib] = grouped_photos[bib]
        
        # Add unknown group last
        if 'unknown' in grouped_photos:
            sorted_grouped['unknown'] = grouped_photos['unknown']
        
        logger.info(f"✅ Retrieved {len(photos)} photos in {len(sorted_grouped)} groups for job {job_id}")
        
        return sorted_grouped
        
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"❌ Failed to get results for job {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve results: {str(e)}")


async def process_photos_async_fallback(job_id: str, photo_ids: List[str], user_id: int, debug_mode: bool):
    """
    Fallback async processing when Cloud Tasks is not available.
    Uses concurrent batch processing for speed.
    """
    logger.info(f"🔄 Starting fallback async processing for {len(photo_ids)} photos")

    try:
        from database import SessionLocal
        db_session = SessionLocal()

        try:
            # Process all photos concurrently using batch method
            batch_results = await detector.process_photo_batch(
                photo_ids, debug_mode=debug_mode, user_id=user_id
            )

            # Save results to database
            await save_batch_results_to_database(batch_results, user_id, job_id)

            completed_count = len([r for r in batch_results.values() if r.bib_number not in ["unknown", "error"]])

            # Mark job as completed
            job_data = jobs.get(job_id)
            if job_data:
                job_data["job"].status = ProcessingStatus.COMPLETED
                job_data["job"].progress = 100
                job_data["job"].completed_photos = len(batch_results)

            # Update database with processing time
            completed_at = datetime.utcnow()
            # Fetch job record to get started_at for full user experience timing
            job_record = db_session.query(ProcessingJobDB).filter(ProcessingJobDB.job_id == job_id).first()
            processing_time = None
            if job_record and job_record.started_at:
                # Handle timezone-aware vs naive datetime comparison
                started = job_record.started_at
                if started.tzinfo is not None:
                    started = started.replace(tzinfo=None)  # Make naive for comparison
                processing_time = (completed_at - started).total_seconds()
            usage_tracker.update_processing_job(
                db=db_session,
                job_id=job_id,
                status="completed",
                progress=100,
                completed_at=completed_at,
                total_processing_time_seconds=processing_time,
            )

            db_session.commit()
            logger.info(f"🎉 Fallback processing completed: {completed_count}/{len(photo_ids)} photos detected in {processing_time:.1f}s" if processing_time else f"🎉 Fallback processing completed: {completed_count}/{len(photo_ids)} photos detected")

        finally:
            db_session.close()

    except Exception as e:
        logger.error(f"🔥 Fallback processing failed: {e}")

        # Mark job as failed
        job_data = jobs.get(job_id)
        if job_data:
            job_data["job"].status = ProcessingStatus.FAILED
            
def sync_jobs_from_database():
    """Load active jobs from DB into memory on startup."""
    db = SessionLocal()
    try:
        active_jobs = db.query(ProcessingJobDB).filter(
            ProcessingJobDB.status.in_(["pending", "processing"])
        ).all()
        for db_job in active_jobs:
            # Reconstruct the ProcessingJob object
            job = ProcessingJob(
                job_id=db_job.job_id,
                photo_ids=[], # We don't necessarily need the IDs for status tracking
                status=ProcessingStatus(db_job.status),
                total_photos=db_job.total_photos,
                progress=db_job.progress
            )
            jobs[db_job.job_id] = {"job": job, "user_id": db_job.user_id}
        logger.info(f"🔄 Synced {len(active_jobs)} active jobs from database")
    finally:
        db.close()

def cleanup_old_jobs():
    """Optional: Clear very old jobs from memory."""
    # (Implementation can be simple or empty for now)
    pass