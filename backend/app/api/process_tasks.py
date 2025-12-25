import asyncio
import json
import logging
import time
import uuid
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

# Initialize logger
logger = logging.getLogger(__name__)

# Import Cloud Tasks with fallback
try:
    from google.cloud import tasks_v2
    CLOUD_TASKS_AVAILABLE = True
except ImportError:
    CLOUD_TASKS_AVAILABLE = False
    logger.warning("Cloud Tasks not available - falling back to async processing")

from database import SessionLocal
from app.api.auth import get_current_user
from app.models.schemas import ManualLabelRequest, ProcessingJob, ProcessingStatus
from app.models.usage import ProcessingJob as ProcessingJobDB
from app.models.user import User
from app.services.detector import NumberDetector
from app.services.usage_tracker import usage_tracker
from database import get_db

logger = logging.getLogger(__name__)

router = APIRouter()
detector = NumberDetector()

# Store jobs with user association
# Structure: {job_id: {"job": ProcessingJob, "user_id": int}}
jobs: Dict[str, dict] = {}

# Initialize Cloud Tasks client with availability check
task_client = None
if CLOUD_TASKS_AVAILABLE:
    try:
        task_client = tasks_v2.CloudTasksClient()
        logger.info("✅ Cloud Tasks client initialized successfully")
    except Exception as e:
        logger.warning(f"⚠️ Could not initialize Cloud Tasks client: {e}")
        task_client = None
else:
    logger.warning("⚠️ Cloud Tasks library not available")

# Cloud Tasks Configuration
PROJECT = "tagsort"
LOCATION = "us-central1"
QUEUE = "photo-processing-queue"
SERVICE_URL = "https://tagsort-api-486078451066.us-central1.run.app"


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

    # 2. Create DB record
    usage_tracker.create_processing_job(
        db=db, user_id=current_user.id, job_id=job_id, total_photos=len(photo_ids)
    )

    # 3. CRITICAL: Link existing PhotoDB records to this job_id
    # This allows the worker to find them when updating progress
    from app.models.processing import PhotoDB
    db.query(PhotoDB).filter(
        PhotoDB.photo_id.in_(photo_ids),
        PhotoDB.user_id == current_user.id
    ).update({PhotoDB.processing_job_id: job_id}, synchronize_session=False)
    db.commit()

    # 4. Update status
    job.status = ProcessingStatus.PROCESSING
    usage_tracker.update_processing_job(db=db, job_id=job_id, status="processing", started_at=datetime.utcnow())

    # 5. Queue Tasks
    if not task_client:
        asyncio.create_task(process_photos_async_fallback(job_id, photo_ids, current_user.id, debug))
        return job

    queue_path = task_client.queue_path(PROJECT, LOCATION, QUEUE)
    worker_url = f"{SERVICE_URL}/api/process/worker"
    
    for i, photo_id in enumerate(photo_ids):
        payload = {
            "photo_id": photo_id,
            "job_id": job_id,
            "user_id": current_user.id,
            "photo_index": i + 1,
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
        task_client.create_task(request={"parent": queue_path, "task": task})

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


async def save_detection_to_database(photo_id: str, user_id: int, detection_result, processing_job_id: str):
    """Save detection result to PhotoDB table after OCR processing."""
    try:
        from app.models.processing import PhotoDB, ProcessingStatus
        
        db_session = SessionLocal()
        try:
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
                    existing_photo.status = ProcessingStatus.COMPLETED
                    existing_photo.processing_job_id = processing_job_id
                    existing_photo.processed_at = datetime.utcnow()
                else:
                    existing_photo.detected_number = "unknown"
                    existing_photo.confidence = 0.0
                    existing_photo.detection_method = "gemini_flash"
                    existing_photo.status = ProcessingStatus.COMPLETED
                    existing_photo.processing_job_id = processing_job_id
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
        
        # Get total photos and completed photos for this job
        total_photos = db.query(PhotoDB).filter(PhotoDB.processing_job_id == job_id).count()
        completed_photos = db.query(PhotoDB).filter(
            PhotoDB.processing_job_id == job_id,
            PhotoDB.status == "completed"
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
                    
                    # Update database job status
                    usage_tracker.update_processing_job(
                        db=db,
                        job_id=job_id,
                        status="completed",
                        progress=100,
                        completed_at=datetime.utcnow(),
                    )
                    
                    logger.info(f"🎉 Job {job_id} completed: {completed_photos}/{total_photos} photos")
                else:
                    # Update progress in database
                    usage_tracker.update_processing_job(
                        db=db,
                        job_id=job_id,
                        progress=progress,
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
        
        # Get all photos for this job from the database
        from app.models.processing import PhotoDB
        
        photos = db.query(PhotoDB).filter(
            PhotoDB.processing_job_id == job_id,
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