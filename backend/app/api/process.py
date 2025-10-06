from fastapi import APIRouter, HTTPException, Query, Depends
from typing import List, Optional, Dict
import uuid
from app.models.schemas import ProcessingJob, ProcessingStatus, GroupedPhotos, ManualLabelRequest
from app.services.detector import NumberDetector
from app.api.auth import get_current_user
from app.models.user import User
from sqlalchemy.orm import Session
from database import get_db
from app.models.usage import ProcessingJob as ProcessingJobDB, ActionType
from app.models.processing import ProcessingStatus as ProcessingStatusDB
from app.services.usage_tracker import usage_tracker
from datetime import datetime
import asyncio
import time

router = APIRouter()

# Store jobs with user association
# Structure: {job_id: {"job": ProcessingJob, "user_id": int}}
jobs: Dict[str, dict] = {}
detector = NumberDetector()

def load_job_from_db(db: Session, job_id: str) -> Optional[dict]:
    """Load a job from database and convert to in-memory format"""
    db_job = db.query(ProcessingJobDB).filter(ProcessingJobDB.job_id == job_id).first()
    if not db_job:
        return None
    
    # Convert database job to in-memory ProcessingJob format
    job = ProcessingJob(
        job_id=db_job.job_id,
        photo_ids=[],  # We'll need to reconstruct this from detector results
        status=ProcessingStatus(db_job.status.lower()),  # Convert DB string to schema enum
        progress=95 if db_job.status == "completed" else 0,
        completed_photos=db_job.photos_processed or 0,
        total_photos=db_job.total_photos,
        debug_mode=True
    )
    
    return {
        "job": job,
        "user_id": db_job.user_id
    }

def sync_jobs_from_database():
    """Load all active jobs from database into memory on startup"""
    try:
        from database import SessionLocal
        db = SessionLocal()
        try:
            # Load jobs that are not completed or failed
            active_jobs = db.query(ProcessingJobDB).filter(
                ProcessingJobDB.status.in_(["pending", "processing"])
            ).all()
            
            loaded_count = 0
            for db_job in active_jobs:
                job_data = load_job_from_db(db, db_job.job_id)
                if job_data:
                    jobs[db_job.job_id] = job_data
                    loaded_count += 1
            
            print(f"📊 Loaded {loaded_count} active jobs from database into memory")
            
        finally:
            db.close()
    except Exception as e:
        print(f"⚠️ Failed to load jobs from database: {e}")
        # Don't crash the startup, just log the error

def cleanup_old_jobs():
    """Clean up completed jobs older than 24 hours from memory and database"""
    try:
        from database import SessionLocal
        from datetime import timedelta
        
        db = SessionLocal()
        try:
            cutoff_time = datetime.utcnow() - timedelta(hours=24)
            
            # Remove old completed jobs from database
            old_jobs = db.query(ProcessingJobDB).filter(
                ProcessingJobDB.status.in_(["completed", "failed"]),
                ProcessingJobDB.completed_at < cutoff_time
            ).all()
            
            removed_db_count = len(old_jobs)
            for job in old_jobs:
                db.delete(job)
            
            # Remove old jobs from memory
            job_ids_to_remove = []
            for job_id, job_data in jobs.items():
                if job_data["job"].status in [ProcessingStatus.COMPLETED, ProcessingStatus.FAILED]:
                    job_ids_to_remove.append(job_id)
            
            for job_id in job_ids_to_remove:
                del jobs[job_id]
            
            db.commit()
            print(f"🧹 Cleaned up {removed_db_count} old jobs from database, {len(job_ids_to_remove)} from memory")
            
        finally:
            db.close()
    except Exception as e:
        print(f"⚠️ Failed to cleanup old jobs: {e}")
        # Don't crash the startup, just log the error

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
    
    # Create processing job record in database
    db_job = usage_tracker.create_processing_job(
        db=db,
        user_id=current_user.id,
        job_id=job_id,
        total_photos=len(photo_ids)
    )
    
    # Log the action
    usage_tracker.log_action(
        db=db,
        user_id=current_user.id,
        action_type=ActionType.PROCESS,
        photo_count=len(photo_ids)
    )
    
    asyncio.create_task(process_photos_async(job_id))
    
    return job

async def process_photos_async(job_id: str):
    print(f"🚀 Starting async task for job {job_id}")
    
    job_data = jobs.get(job_id)
    if not job_data:
        print(f"❌ Job {job_id} not found in jobs dictionary")
        return
        
    job = job_data["job"]
    old_status = job.status
    job.status = ProcessingStatus.PROCESSING
    user_id = job_data["user_id"]
    
    print(f"▶️ Starting async processing for job {job_id}: {old_status} → {job.status}")
    print(f"▶️ Job details: {job.total_photos} photos, Progress: {job.progress}%, Completed: {job.completed_photos}")
    
    # Create fresh database session for async task
    db_session = None
    try:
        from database import SessionLocal
        db_session = SessionLocal()
        # Update database job status
        print(f"🔍 DEBUG: Updating job {job_id} to processing status")
        update_result = usage_tracker.update_processing_job(
            db=db_session,
            job_id=job_id,
            status="processing",  # Use string value
            started_at=datetime.utcnow()
        )
        if update_result:
            print(f"📊 Database job status updated to PROCESSING")
            print(f"🔍 DEBUG: Job {job_id} found and updated in database")
        else:
            print(f"❌ DEBUG: Job {job_id} NOT found in database for status update!")
    except Exception as db_error:
        print(f"⚠️ Database update failed (continuing anyway): {db_error}")
        print(f"🔍 DEBUG: Error details: {str(db_error)}")
        # Don't let database issues stop photo processing
    finally:
        if db_session:
            db_session.close()
    
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
                        user_id = job_data["user_id"]
                        await detector.process_photo(photo_id, debug_mode=job.debug_mode, user_id=user_id)
                        
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
                old_progress = job.progress
                job.progress = max(1, int((completed_count / job.total_photos) * 95))
                
                print(f"📊 Progress update - Batch completed: {completed_count}/{job.total_photos} photos ({old_progress}% → {job.progress}%)")
                print(f"📊 Job status: {job.status}, Progress: {job.progress}%, Completed: {job.completed_photos}")
            
            # Finalization phase
            job.progress = 95
            print(f"📊 Finalization phase: {job.progress}%")
            await asyncio.sleep(0.3)  # Brief finalization delay
            
            # Final completion
            job.progress = 100
            job.status = ProcessingStatus.COMPLETED
            print(f"📊 Job completed: {job.progress}%, Status: {job.status}")
        
    except Exception as e:
        job.status = ProcessingStatus.FAILED
        job_end_time = time.time()
        total_job_time = job_end_time - job_start_time
        print(f"⏱️ Processing failed for job {job_id} after {total_job_time:.2f}s: {str(e)}")
        return  # Exit early on processing failure
    
    # ⏱️ Calculate and log final timing statistics for analytics
    job_end_time = time.time()
    total_job_time = job_end_time - job_start_time
    avg_photo_time = total_photo_processing_time / job.total_photos if job.total_photos > 0 else 0
    
    # Note: Don't set database fields on the in-memory Pydantic model
    # These will be passed directly to the database update function
    
    # Update database job with timing metrics and detection counts
    db_session = None
    try:
        from database import SessionLocal
        db_session = SessionLocal()
        
        # Count detection results and unknown photos
        google_vision_count = 0  # TODO: Implement detection method tracking
        tesseract_count = 0     # TODO: Implement detection method tracking
        unknown_count = 0
        detected_count = 0
        
        print(f"🔍 DEBUG: Starting database update for job {job_id}")
        print(f"🔍 DEBUG: Job has {len(job.photo_ids)} photos to check")
        
        for photo_id in job.photo_ids:
            result = detector.results.get(photo_id)
            if result:
                if result.bib_number and result.bib_number != "unknown":
                    detected_count += 1
                    # Note: Detection method counting removed temporarily
                    # Will be re-implemented when detection_method is added to DetectionResult
                else:
                    unknown_count += 1
            else:
                unknown_count += 1
        
        # Log all values being passed to update
        print(f"🔍 DEBUG: Update values:")
        print(f"  - job_id: {job_id}")
        print(f"  - status: completed")
        print(f"  - completed_at: {datetime.utcnow()}")
        print(f"  - total_processing_time_seconds: {total_job_time}")
        print(f"  - average_time_per_photo: {avg_photo_time}")
        print(f"  - photos_processed: {job.completed_photos}")
        print(f"  - photos_detected: {detected_count}")
        print(f"  - photos_unknown: {unknown_count}")
        print(f"  - google_vision_detections: {google_vision_count}")
        print(f"  - tesseract_detections: {tesseract_count}")
        
        # Perform the update
        update_result = usage_tracker.update_processing_job(
            db=db_session,
            job_id=job_id,
            status="completed",  # Use string value
            completed_at=datetime.utcnow(),
            total_processing_time_seconds=total_job_time,
            average_time_per_photo=avg_photo_time,
            photos_processed=job.completed_photos,
            photos_detected=detected_count,
            photos_unknown=unknown_count,
            google_vision_detections=google_vision_count,
            tesseract_detections=tesseract_count
        )
        
        if update_result:
            print(f"✅ DEBUG: Update successful for job {job_id}")
        else:
            print(f"❌ DEBUG: Update returned None - job {job_id} may not exist in database")
        
        # Verify the update worked by querying the database
        from app.models.usage import ProcessingJob as ProcessingJobDB
        verification = db_session.query(ProcessingJobDB).filter(ProcessingJobDB.job_id == job_id).first()
        if verification:
            print(f"🔍 DEBUG: Database verification for job {job_id}:")
            print(f"  - Status in DB: {verification.status}")
            print(f"  - Photos processed in DB: {verification.photos_processed}")
            print(f"  - Processing time in DB: {verification.total_processing_time_seconds}")
            print(f"  - Completed at: {verification.completed_at}")
        else:
            print(f"❌ DEBUG: Job {job_id} not found in database during verification!")
        
        print(f"📊 Database job completed with {detected_count} detected, {unknown_count} unknown")
    except Exception as db_error:
        import traceback
        print(f"⚠️ Database completion update failed: {db_error}")
        print(f"🔍 DEBUG: Full traceback:")
        print(traceback.format_exc())
    finally:
        if db_session:
            db_session.close()
    
    print(f"⏱️ Job {job_id} completed:")
    print(f"   • Total job time: {total_job_time:.2f}s")
    print(f"   • Total photo processing time: {total_photo_processing_time:.2f}s")
    print(f"   • Average time per photo: {avg_photo_time:.2f}s")
    print(f"   • Overhead time: {total_job_time - total_photo_processing_time:.2f}s")

@router.get("/status/{job_id}", response_model=ProcessingJob)
async def get_processing_status(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # First try to find job in memory
    job_data = jobs.get(job_id)
    
    # If not in memory, try to load from database
    if not job_data:
        print(f"🔍 Job {job_id} not in memory, trying to load from database...")
        job_data = load_job_from_db(db, job_id)
        if job_data:
            # Add back to memory for future requests
            jobs[job_id] = job_data
            print(f"📊 Restored job {job_id} from database to memory")
    
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Verify user owns this job
    if job_data["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    job = job_data["job"]
    print(f"🔍 Status request for job {job_id}: Status={job.status}, Progress={job.progress}%, Completed={job.completed_photos}/{job.total_photos}")
    
    return job

@router.get("/results/{job_id}")
async def get_processing_results(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # First try to find job in memory
    job_data = jobs.get(job_id)
    
    # If not in memory, try to load from database
    if not job_data:
        print(f"🔍 Job {job_id} not in memory for results, trying to load from database...")
        job_data = load_job_from_db(db, job_id)
        if job_data:
            # Add back to memory for future requests
            jobs[job_id] = job_data
            print(f"📊 Restored job {job_id} from database to memory for results")
    
    if not job_data:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Verify user owns this job
    if job_data["user_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    job = job_data["job"]
    if job.status != ProcessingStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Processing not completed")
    
    return await detector.get_grouped_results(job.photo_ids, job_data["user_id"])

@router.put("/manual-label")
async def manual_label_photo(
    request: ManualLabelRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Manually assign a bib number to a photo"""
    if not request.photo_id or not request.bib_number:
        raise HTTPException(status_code=400, detail="Photo ID and bib number are required")
    
    # Validate bib number format (allow "unknown" as a special case)
    if request.bib_number.lower() != "unknown" and not detector._is_valid_bib_number(request.bib_number):
        raise HTTPException(status_code=400, detail="Invalid bib number format")
    
    # Check if photo exists
    photo_path = detector._find_photo_path(request.photo_id, current_user.id)
    if not photo_path:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    # Get the original detection result to see if it was previously detected
    original_result = detector.results.get(request.photo_id)
    was_unknown = not original_result or not original_result.bib_number or original_result.bib_number == "unknown"
    
    # Update the detection result with manual label
    success = detector.update_manual_label(request.photo_id, request.bib_number)
    
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update photo label")
    
    # Find the job this photo belongs to and update manual label count
    for job_id, job_data in jobs.items():
        if request.photo_id in job_data["job"].photo_ids and job_data["user_id"] == current_user.id:
            # Get current job from database to increment manual labels
            db_job = db.query(ProcessingJobDB).filter(ProcessingJobDB.job_id == job_id).first()
            if db_job:
                usage_tracker.update_processing_job(
                    db=db,
                    job_id=job_id,
                    manual_labels=db_job.manual_labels + 1
                )
            break
    
    # Log the manual labeling action
    usage_tracker.log_action(
        db=db,
        user_id=current_user.id,
        action_type=ActionType.MANUAL_LABEL,
        photo_count=1,
        details={"photo_id": request.photo_id, "bib_number": request.bib_number, "was_unknown": was_unknown}
    )
    
    return {"message": f"Photo {request.photo_id} successfully labeled as bib #{request.bib_number}", "photo_id": request.photo_id, "bib_number": request.bib_number}