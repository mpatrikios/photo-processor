"""
Service for managing persistent processing jobs.
Replaces in-memory job storage with database persistence.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.models.processing import PhotoDB, ProcessingStatus
from app.models.usage import ProcessingJob as ProcessingJobDB
from app.services.detector import NumberDetector
from database import get_db

logger = logging.getLogger(__name__)


class JobService:
    """
    Service for managing processing jobs with database persistence.
    """

    def __init__(self):
        self.detector = NumberDetector()
        # Keep a small cache for active jobs to reduce database queries
        self._active_jobs_cache: Dict[str, ProcessingJobDB] = {}

    def create_job(
        self, db: Session, user_id: int, photo_ids: List[str], debug: bool = False
    ) -> ProcessingJobDB:
        """
        Create a new processing job in the database.
        """
        job_id = str(uuid.uuid4())

        # Create job record
        job = ProcessingJobDB(
            job_id=job_id,
            user_id=user_id,
            total_photos=len(photo_ids),
            debug_mode=debug,
            status=ProcessingStatus.PENDING,
        )
        job.set_expiration(24)  # Expire after 24 hours

        db.add(job)
        db.flush()  # Get the ID

        # Create photo records
        for photo_id in photo_ids:
            photo = PhotoDB(
                photo_id=photo_id,
                user_id=user_id,
                processing_job_id=job.id,
                original_filename=f"{photo_id}.jpg",  # Will be updated when we have actual filename
                file_path=f"uploads/{user_id}/{photo_id}",  # Will be updated with actual path
                file_size_bytes=0,  # Will be updated
                file_extension=".jpg",  # Will be updated
                processing_status=ProcessingStatus.PENDING,
            )
            db.add(photo)

        db.commit()

        # Cache the job
        self._active_jobs_cache[job_id] = job

        logger.info(
            f"Created processing job {job_id} for user {user_id} with {len(photo_ids)} photos"
        )
        return job

    def get_job(
        self, db: Session, job_id: str, user_id: Optional[int] = None
    ) -> Optional[ProcessingJobDB]:
        """
        Get a processing job by ID with user isolation.
        SECURITY: For user-facing operations, user_id should always be provided.
        """
        # Check cache first
        if job_id in self._active_jobs_cache:
            cached_job = self._active_jobs_cache[job_id]
            # SECURITY: Always verify user_id when provided
            if user_id is not None and cached_job.user_id != user_id:
                logger.warning(
                    f"Security: User {user_id} attempted to access job {job_id} owned by user {cached_job.user_id}"
                )
                return None
            return cached_job

        # Query database with mandatory user filter for security
        query = db.query(ProcessingJobDB).filter(ProcessingJobDB.job_id == job_id)
        if user_id is not None:
            query = query.filter(ProcessingJobDB.user_id == user_id)

        job = query.first()

        # Update cache
        if job:
            self._active_jobs_cache[job_id] = job

        return job

    def update_job_progress(
        self, db: Session, job_id: str, progress: int, completed_photos: int
    ):
        """
        Update job progress in database and cache.
        """
        job = self.get_job(db, job_id)
        if job:
            job.progress = progress
            job.completed_photos = completed_photos
            job.updated_at = datetime.utcnow()

            if progress >= 100:
                job.status = ProcessingStatus.COMPLETED
                job.completed_at = datetime.utcnow()
                # Remove from cache when completed
                self._active_jobs_cache.pop(job_id, None)

            db.commit()

    def mark_job_failed(self, db: Session, job_id: str, error_message: str):
        """
        Mark a job as failed with error message.
        """
        job = self.get_job(db, job_id)
        if job:
            job.status = ProcessingStatus.FAILED
            job.error_message = error_message
            job.completed_at = datetime.utcnow()

            # Remove from cache
            self._active_jobs_cache.pop(job_id, None)

            db.commit()

    async def process_job_async(self, job_id: str):
        """
        Process a job asynchronously with database persistence.
        """
        # Get database session
        db_gen = get_db()
        db = next(db_gen)

        try:
            job = self.get_job(db, job_id)
            if not job:
                logger.error(f"Job {job_id} not found")
                return

            # Update job status
            job.status = ProcessingStatus.PROCESSING
            job.started_at = datetime.utcnow()
            db.commit()

            logger.info(
                f"Starting processing job {job_id} with {job.total_photos} photos"
            )

            # Get photos for this job
            photos = db.query(PhotoDB).filter(PhotoDB.processing_job_id == job.id).all()

            # Process photos in batches
            BATCH_SIZE = 5
            semaphore = asyncio.Semaphore(BATCH_SIZE)
            completed_count = 0

            async def process_photo_with_db(photo: PhotoDB):
                nonlocal completed_count

                async with semaphore:
                    try:
                        # Process the photo
                        detection_result = await self.detector.process_photo(
                            photo.photo_id, job.debug_mode
                        )

                        # Update photo record
                        if detection_result:
                            photo.set_detection_result(
                                detected_number=detection_result.bib_number,
                                confidence=detection_result.confidence,
                                method="auto_detection",
                                bbox=detection_result.bbox,
                            )
                            photo.processing_status = ProcessingStatus.COMPLETED
                        else:
                            photo.processing_status = ProcessingStatus.FAILED
                            photo.processing_error = "No detection result"

                        completed_count += 1

                        # Update job progress
                        progress = int((completed_count / len(photos)) * 100)
                        self.update_job_progress(db, job_id, progress, completed_count)

                        logger.info(
                            f"Processed photo {photo.photo_id} ({completed_count}/{len(photos)})"
                        )

                    except Exception as e:
                        logger.error(f"Failed to process photo {photo.photo_id}: {e}")
                        photo.processing_status = ProcessingStatus.FAILED
                        photo.processing_error = str(e)

                        completed_count += 1
                        progress = int((completed_count / len(photos)) * 100)
                        self.update_job_progress(db, job_id, progress, completed_count)

            # Process photos in batches
            tasks = [process_photo_with_db(photo) for photo in photos]
            await asyncio.gather(*tasks, return_exceptions=True)

            # Final job update
            job = self.get_job(db, job_id)
            if job:
                job.status = ProcessingStatus.COMPLETED
                job.completed_at = datetime.utcnow()
                job.progress = 100
                db.commit()

            logger.info(f"Completed processing job {job_id}")

        except Exception as e:
            logger.error(f"Job {job_id} failed: {e}")
            self.mark_job_failed(db, job_id, str(e))

        finally:
            db.close()

    def get_user_jobs(
        self, db: Session, user_id: int, limit: int = 10
    ) -> List[ProcessingJobDB]:
        """
        Get recent jobs for a user.
        """
        return (
            db.query(ProcessingJobDB)
            .filter(ProcessingJobDB.user_id == user_id)
            .order_by(ProcessingJobDB.created_at.desc())
            .limit(limit)
            .all()
        )

    def get_job_results(self, db: Session, job_id: str, user_id: int):
        """
        Get processing results for a job.
        """
        job = self.get_job(db, job_id, user_id)
        if not job or job.status != ProcessingStatus.COMPLETED:
            return None

        # Get all photos for this job
        photos = db.query(PhotoDB).filter(PhotoDB.processing_job_id == job.id).all()

        # Group by effective bib number
        grouped = {}
        for photo in photos:
            bib_number = photo.effective_bib_number or "unknown"
            if bib_number not in grouped:
                grouped[bib_number] = []

            grouped[bib_number].append(
                {
                    "id": photo.photo_id,
                    "filename": photo.original_filename,
                    "original_path": photo.file_path,
                    "detection_result": (
                        {
                            "bib_number": photo.detected_number,
                            "confidence": photo.confidence,
                            "bbox": photo.bbox,
                        }
                        if photo.detected_number
                        else None
                    ),
                    "manual_label": photo.manual_label,
                    "status": photo.processing_status.value,
                }
            )

        return grouped

    def update_manual_label(
        self, db: Session, photo_id: str, bib_number: str, user_id: int
    ) -> bool:
        """
        Update manual label for a photo.
        """
        photo = (
            db.query(PhotoDB)
            .filter(and_(PhotoDB.photo_id == photo_id, PhotoDB.user_id == user_id))
            .first()
        )

        if not photo:
            return False

        photo.manual_label = bib_number
        photo.manual_label_by = user_id
        photo.manual_label_at = datetime.utcnow()
        db.commit()

        return True

    def cleanup_expired_jobs(self, db: Session) -> int:
        """
        Clean up expired jobs and their associated data.
        """
        expired_jobs = (
            db.query(ProcessingJobDB)
            .filter(
                and_(
                    ProcessingJobDB.expires_at.isnot(None),
                    ProcessingJobDB.expires_at < datetime.utcnow(),
                )
            )
            .all()
        )

        count = 0
        for job in expired_jobs:
            # Delete associated photos
            db.query(PhotoDB).filter(PhotoDB.processing_job_id == job.id).delete()

            # Delete job
            db.delete(job)

            # Remove from cache
            self._active_jobs_cache.pop(job.job_id, None)

            count += 1

        if count > 0:
            db.commit()
            logger.info(f"Cleaned up {count} expired jobs")

        return count

    def recover_jobs_on_startup(self, db: Session) -> int:
        """
        Recover incomplete jobs on application startup.
        """
        # Find jobs that were processing when the server shut down
        stalled_jobs = (
            db.query(ProcessingJobDB)
            .filter(
                and_(
                    ProcessingJobDB.status == ProcessingStatus.PROCESSING,
                    ProcessingJobDB.started_at.isnot(None),
                    # Jobs older than 30 minutes are considered stalled
                    ProcessingJobDB.started_at
                    < datetime.utcnow() - timedelta(minutes=30),
                )
            )
            .all()
        )

        recovered_count = 0
        for job in stalled_jobs:
            if job.is_expired():
                # Mark expired jobs as failed
                job.status = ProcessingStatus.EXPIRED
                job.completed_at = datetime.utcnow()
                job.error_message = "Job expired during processing"
            else:
                # Reset to pending for retry
                job.status = ProcessingStatus.PENDING
                job.started_at = None
                job.progress = 0

                # Reset photo statuses
                # Reset photo statuses
                db.query(PhotoDB).filter(
                    and_(
                        # Force job.id to string to match the VARCHAR column in PostgreSQL
                        PhotoDB.processing_job_id == str(job.id), 
                        PhotoDB.processing_status == ProcessingStatus.PROCESSING,
                    )
                ).update({"processing_status": ProcessingStatus.PENDING})

                # Restart the job
                asyncio.create_task(self.process_job_async(job.job_id))

            recovered_count += 1

        if recovered_count > 0:
            db.commit()
            logger.info(f"Recovered {recovered_count} processing jobs on startup")

        return recovered_count


# Global job service instance
job_service = JobService()
