import asyncio
import json
import logging
import os
import uuid
from datetime import datetime
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from sqlalchemy import update

# --- FIX 1: Top-level imports to prevent NameError in Worker ---
from app.models.schemas import DetectionResult, ProcessingJob, ProcessingStatus
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
PROJECT = os.getenv('PROJECT', os.getenv('GOOGLE_CLOUD_PROJECT', 'tagsort'))
LOCATION = os.getenv('LOCATION', os.getenv('GCP_LOCATION', 'us-central1'))
QUEUE = os.getenv('QUEUE', 'photo-processing-queue')
# This must match your Cloud Run URL
SERVICE_URL = os.getenv('SERVICE_URL', os.getenv('BASE_URL', 'https://tagsort-api-486078451066.us-central1.run.app'))

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



@router.post("/start", response_model=ProcessingJob)
async def start_processing_with_tasks(
    photo_ids: List[str],
    debug: Optional[bool] = Query(True, description="Enable debug mode"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not photo_ids:
        raise HTTPException(status_code=400, detail="No photo IDs provided")

    job_id = str(uuid.uuid4())
    job = ProcessingJob(
        job_id=job_id,
        photo_ids=photo_ids,
        status=ProcessingStatus.PENDING,
        total_photos=len(photo_ids),
        debug_mode=debug,
    ) 

    # 1. Store in-memory
    jobs[job_id] = {"job": job, "user_id": current_user.id}

    # 2. Create DB record and get the integer ID
    processing_job_db = usage_tracker.create_processing_job(
        db=db, user_id=current_user.id, job_id=job_id, total_photos=len(photo_ids)
    )

    # 3. CRITICAL: Link existing PhotoDB records to this processing_job.id (integer)
    # This allows the worker to find them when updating progress
    from app.models.processing import PhotoDB
    db.query(PhotoDB).filter(
        PhotoDB.photo_id.in_(photo_ids),
        PhotoDB.user_id == current_user.id
    ).update({PhotoDB.processing_job_id: processing_job_db.id}, synchronize_session=False)
    db.commit()

    # 4. Update status
    job.status = ProcessingStatus.PROCESSING
    usage_tracker.update_processing_job(db=db, job_id=job_id, status="processing", started_at=datetime.utcnow())

    # 5. Queue Tasks in Batches (3 photos per task for optimal Gemini performance)
    if not task_client:
        logger.warning(f"🚫 FALLBACK TRIGGERED: Using async processing instead of Cloud Tasks")
        logger.warning(f"🔍 Fallback reason: task_client is None")
        logger.warning(f"🔍 This means either:")
        logger.warning(f"🔍   - Cloud Tasks library not installed (check requirements.txt)")
        logger.warning(f"🔍   - Client initialization failed (check credentials/project config)")
        logger.warning(f"🔍   - Service account lacks proper permissions")
        logger.warning(f"📊 Performance impact: Processing will be ~3x slower than Cloud Tasks")
        logger.info(f"🔄 Starting fallback processing for {len(photo_ids)} photos...")
        
        asyncio.create_task(process_photos_async_fallback(job_id, photo_ids, current_user.id, debug))
        return job
    
    # If we reach here, Cloud Tasks is available
    logger.info(f"🚀 Attempting direct Cloud Tasks enqueuing...")
    
    try:
        queue_path = task_client.queue_path(PROJECT, LOCATION, QUEUE)
        worker_url = f"{SERVICE_URL}/api/process/batch-worker"
        
        logger.info(f"🔍 Queue path created: {queue_path}")
        logger.info(f"🔍 Worker URL: {worker_url}")
        
    except Exception as path_error:
        logger.error(f"❌ Failed to create queue path: {path_error}")
        asyncio.create_task(process_photos_async_fallback(job_id, photo_ids, current_user.id, debug))
        return job
    
    # Group photos into batches of 3 for optimal Gemini rate limiting
    BATCH_SIZE = 3
    photo_batches = []
    for i in range(0, len(photo_ids), BATCH_SIZE):
        batch = photo_ids[i:i + BATCH_SIZE]
        photo_batches.append(batch)
    
    logger.info(f"🔄 Creating {len(photo_batches)} batch tasks ({BATCH_SIZE} photos each)")
    
    tasks_created = 0
    for batch_idx, photo_batch in enumerate(photo_batches):
        try:
            payload = {
                "photo_ids": photo_batch,  # Multiple photos per task
                "job_id": str(job_id),  # Ensure string
                "processing_job_id": int(processing_job_db.id),  # INTEGER ID for DB FK
                "user_id": int(current_user.id),  # Ensure int
                "batch_index": batch_idx + 1,
                "total_batches": len(photo_batches),
                "debug_mode": debug
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
            
            task_response = task_client.create_task(request={"parent": queue_path, "task": task})
            tasks_created += 1
            
            logger.info(f"✅ Created task {batch_idx + 1}/{len(photo_batches)}: {len(photo_batch)} photos")
            if batch_idx == 0:  # Log details for first task only
                logger.debug(f"🔍 Task details: {task_response.name}")
                
        except Exception as task_error:
            logger.error(f"❌ Failed to create task {batch_idx + 1}: {task_error}")
            logger.error(f"🔍 Task creation failed - this suggests OIDC/permission issues")
    
    if tasks_created == 0:
        logger.error(f"❌ No tasks were successfully created - falling back to async processing")
        asyncio.create_task(process_photos_async_fallback(job_id, photo_ids, current_user.id, debug))
        return job
    elif tasks_created < len(photo_batches):
        logger.warning(f"⚠️ Only {tasks_created}/{len(photo_batches)} tasks created successfully")
    else:
        logger.info(f"🎉 All {tasks_created} tasks created successfully - Cloud Tasks processing active!")

    return job


@router.post("/worker")
async def process_single_photo_worker(request: Request):
    """
    Cloud Tasks Worker Endpoint
    Each request handles exactly ONE photo for maximum reliability.
    """
    # Create a fresh database session for this specific photo task
    db = SessionLocal()
    try:
        payload = await request.json()
        photo_id = payload.get("photo_id")
        job_id = payload.get("job_id")
        user_id = payload.get("user_id")
        debug_mode = payload.get("debug_mode", False)
        
        if not all([photo_id, job_id, user_id]):
            return {"status": "error", "message": "Missing required payload fields"}
        
        # 1. Run detection (Gemini)
        detection_result = await detector.process_photo(
            photo_id, debug_mode=debug_mode, user_id=user_id
        )
        
        # 2. Save result to DB (updates status to 'completed' for this photo)
        await save_detection_to_database(photo_id, user_id, detection_result, job_id)
        
        # 3. Update the overall Job Progress (calculates % based on completed photos)
        await update_job_progress(job_id, db)
        
        return {"status": "success", "photo_id": photo_id}
            
    except Exception as e:
        logger.error(f"🔥 Worker failed for photo {photo_id if 'photo_id' in locals() else 'unknown'}: {e}")
        # Raising 500 tells Cloud Tasks to RETRY this specific photo automatically
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@router.post("/batch-worker")
async def process_batch_photos_worker(request: Request):
    """
    Optimized Cloud Tasks Batch Worker Endpoint
    Each request handles 3 photos in a single Gemini API call for 2-3x better performance.
    """
    db = SessionLocal()
    try:
        payload = await request.json()
        photo_ids = payload.get("photo_ids", [])
        job_id = payload.get("job_id")
        processing_job_id = payload.get("processing_job_id")
        user_id = payload.get("user_id")
        batch_index = payload.get("batch_index", 1)
        total_batches = payload.get("total_batches", 1)
        debug_mode = payload.get("debug_mode", False)
        
        if not all([photo_ids, job_id, processing_job_id, user_id]) or not isinstance(photo_ids, list):
            return {"status": "error", "message": "Missing or invalid payload fields"}
        
        logger.info(f"🔄 Batch worker {batch_index}/{total_batches}: Processing {len(photo_ids)} photos")
        
        # 1. Run batch detection with Gemini (2-3x faster than individual calls)
        batch_results = await detector.process_photo_batch(
            photo_ids, debug_mode=debug_mode, user_id=user_id
        )
        
        if not batch_results:
            return {"status": "error", "message": "Batch processing failed"}
        
        # 2. Save all results to database in a single transaction
        await save_batch_results_to_database(batch_results, user_id, processing_job_id)
        
        # 3. Update overall job progress (calculates % based on completed photos)
        await update_job_progress(job_id, db)
        
        successful_count = len([r for r in batch_results.values() if r.bib_number not in ["unknown", "error"]])
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


async def save_batch_results_to_database(batch_results: Dict[str, DetectionResult], user_id: int, processing_job_id: int):
    """Save multiple detection results using simple loop for reliability."""
    db_session = SessionLocal()
    try:
        from app.models.processing import PhotoDB, ProcessingStatus
        
        processed_time = datetime.utcnow()
        
        # Simple approach: update each photo individually in a transaction
        for photo_id, detection_result in batch_results.items():
            photo = db_session.query(PhotoDB).filter(
                PhotoDB.photo_id == str(photo_id),  # Force string cast
                PhotoDB.user_id == int(user_id)     # Force int cast
            ).first()
            
            if photo:
                if detection_result.bib_number and detection_result.bib_number not in ["unknown", "error"]:
                    # Successful detection
                    photo.detected_number = detection_result.bib_number
                    photo.confidence = detection_result.confidence
                    photo.detection_method = "gemini_flash_batch"
                    photo.processing_status = ProcessingStatus.COMPLETED
                    photo.processing_job_id = processing_job_id  # INTEGER FK
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
                    photo.processing_job_id = processing_job_id  # INTEGER FK
                    photo.processed_at = processed_time
            else:
                logger.warning(f"Photo {photo_id} not found for user {user_id}")
        
        db_session.commit()
        logger.info(f"✅ Batch results saved for {len(batch_results)} photos")
        
    except Exception as e:
        db_session.rollback()
        logger.error(f"❌ DB Save Failed: {e}")
        raise
    finally:
        db_session.close()


async def save_detection_to_database(photo_id: str, user_id: int, detection_result, processing_job_id):
    """Save detection result to PhotoDB table after OCR processing."""
    try:
        from app.models.processing import PhotoDB, ProcessingStatus
        
        # Handle both integer ID (new) and string job_id (legacy) for compatibility
        if isinstance(processing_job_id, str):
            # Legacy: lookup the integer ID from job_id
            db_session = SessionLocal()
            from app.models.usage import ProcessingJob as ProcessingJobDB
            processing_job = db_session.query(ProcessingJobDB).filter(ProcessingJobDB.job_id == processing_job_id).first()
            if processing_job:
                processing_job_id = processing_job.id
            else:
                logger.error(f"Job {processing_job_id} not found")
                return
            db_session.close()
        
        db_session = SessionLocal()
        try:
            # Check if photo record already exists
            existing_photo = db_session.query(PhotoDB).filter(
                PhotoDB.photo_id == str(photo_id),
                PhotoDB.user_id == int(user_id)
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
                    existing_photo.processing_job_id = processing_job_id  # INTEGER FK
                    existing_photo.processed_at = datetime.utcnow()
                else:
                    existing_photo.detected_number = "unknown"
                    existing_photo.confidence = 0.0
                    existing_photo.detection_method = "gemini_flash"
                    existing_photo.processing_status = ProcessingStatus.COMPLETED
                    existing_photo.processing_job_id = processing_job_id  # INTEGER FK
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
        from app.models.processing import PhotoDB
        
        # Get the processing job to find the integer ID
        from app.models.usage import ProcessingJob as ProcessingJobDB
        processing_job = db.query(ProcessingJobDB).filter(ProcessingJobDB.job_id == job_id).first()
        if not processing_job:
            logger.error(f"Job {job_id} not found in database")
            return
        
        # Get total photos and completed photos for this job using integer ID
        total_photos = db.query(PhotoDB).filter(PhotoDB.processing_job_id == processing_job.id).count()
        completed_photos = db.query(PhotoDB).filter(
            PhotoDB.processing_job_id == processing_job.id,
            PhotoDB.processing_status == ProcessingStatus.COMPLETED
        ).count()
        
        # Calculate detected vs unknown photos
        detected_photos = db.query(PhotoDB).filter(
            PhotoDB.processing_job_id == processing_job.id,
            PhotoDB.processing_status == ProcessingStatus.COMPLETED,
            PhotoDB.detected_number.isnot(None),
            PhotoDB.detected_number != 'unknown'
        ).count()
        
        unknown_photos = db.query(PhotoDB).filter(
            PhotoDB.processing_job_id == processing_job.id,
            PhotoDB.processing_status == ProcessingStatus.COMPLETED,
            PhotoDB.detected_number == 'unknown'
        ).count()
        
        if total_photos > 0:
            progress = int((completed_photos / total_photos) * 100)
            
            # Update in-memory job
            job_data = jobs.get(job_id)
            if job_data:
                job_data["job"].progress = progress
                job_data["job"].completed_photos = completed_photos
                
                # Check if job is complete
                if completed_photos >= total_photos:
                    job_data["job"].status = ProcessingStatus.COMPLETED
                    
                    # Calculate total processing time from creation to completion
                    from datetime import timezone
                    completed_at = datetime.now(timezone.utc)
                    total_processing_time = (completed_at - processing_job.created_at).total_seconds()
                    average_time_per_photo = total_processing_time / total_photos if total_photos > 0 else 0
                    
                    # Update database job status with complete photo statistics
                    logger.info(f"🔄 Updating job {job_id} with stats: processed={completed_photos}, detected={detected_photos}, unknown={unknown_photos}, time={total_processing_time:.2f}s")
                    usage_tracker.update_processing_job(
                        db=db,
                        job_id=job_id,
                        status="completed",
                        progress=100,
                        completed_at=completed_at,
                        photos_processed=completed_photos,
                        photos_detected=detected_photos,
                        photos_unknown=unknown_photos,
                        total_processing_time_seconds=total_processing_time,
                        average_time_per_photo=average_time_per_photo,
                    )
                    
                    logger.info(f"🎉 Job {job_id} completed: {completed_photos}/{total_photos} photos ({detected_photos} detected, {unknown_photos} unknown)")
                else:
                    # Update progress in database with current statistics
                    usage_tracker.update_processing_job(
                        db=db,
                        job_id=job_id,
                        progress=progress,
                        photos_processed=completed_photos,
                        photos_detected=detected_photos,
                        photos_unknown=unknown_photos,
                    )
            
        db.commit()
        
    except Exception as e:
        logger.error(f"Error updating job progress for {job_id}: {e}")


# Keep existing endpoints for compatibility
@router.get("/status/{job_id}")
async def get_processing_status(job_id: str, current_user: User = Depends(get_current_user)):
    """Get the current status of a processing job"""
    job_data = jobs.get(job_id)
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # SECURITY: Verify job belongs to current user
    if job_data["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied to job")
    
    return job_data["job"]


@router.get("/results/{job_id}")  
async def get_processing_results(job_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get the results of a completed processing job"""
    try:
        # Check if job exists and belongs to user
        job_data = jobs.get(job_id)
        if not job_data:
            raise HTTPException(status_code=404, detail="Job not found")
        
        # Verify job belongs to current user
        if job_data["user_id"] != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied to job")
        
        # Get the processing job to find the integer ID
        from app.models.processing import PhotoDB
        from app.models.usage import ProcessingJob as ProcessingJobDB
        
        processing_job = db.query(ProcessingJobDB).filter(
            ProcessingJobDB.job_id == job_id,
            ProcessingJobDB.user_id == current_user.id
        ).first()
        if not processing_job:
            logger.warning(f"Processing job {job_id} not found for user {current_user.id}")
            return {"unknown": []}
        
        photos = db.query(PhotoDB).filter(
            PhotoDB.processing_job_id == processing_job.id,
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
    Fallback async processing when Cloud Tasks is not available
    This is the original processing logic for compatibility
    """
    logger.info(f"🔄 Starting fallback async processing for {len(photo_ids)} photos")
    
    try:
        from database import SessionLocal
        db_session = SessionLocal()
        
        try:
            completed_count = 0
            
            for i, photo_id in enumerate(photo_ids):
                try:
                    logger.info(f"📸 Processing photo {i+1}/{len(photo_ids)}: {photo_id}")
                    
                    # Process single photo
                    detection_result = await detector.process_photo(
                        photo_id, debug_mode=debug_mode, user_id=user_id
                    )
                    
                    # Save to database
                    await save_detection_to_database(photo_id, user_id, detection_result, job_id)
                    
                    completed_count += 1
                    
                    # Update progress
                    progress = int((completed_count / len(photo_ids)) * 100)
                    job_data = jobs.get(job_id)
                    if job_data:
                        job_data["job"].progress = progress
                        job_data["job"].completed_photos = completed_count
                    
                    logger.info(f"✅ Photo {i+1}/{len(photo_ids)} completed ({progress}%)")
                    
                except Exception as e:
                    logger.error(f"❌ Failed to process photo {photo_id}: {e}")
            
            # Mark job as completed
            job_data = jobs.get(job_id)
            if job_data:
                job_data["job"].status = ProcessingStatus.COMPLETED
                job_data["job"].progress = 100
            
            # Update database
            usage_tracker.update_processing_job(
                db=db_session,
                job_id=job_id,
                status="completed",
                progress=100,
                completed_at=datetime.utcnow(),
            )
            
            db_session.commit()
            logger.info(f"🎉 Fallback processing completed: {completed_count}/{len(photo_ids)} photos")
            
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