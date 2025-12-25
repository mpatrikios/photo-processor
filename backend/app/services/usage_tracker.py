import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.models.processing import ProcessingStatus
from app.models.usage import ActionType, ProcessingJob, UsageLog, UserQuota
from app.models.user import User
from app.tier_config import get_upload_limit_by_tier, get_tier_info

logger = logging.getLogger(__name__)

class UsageTracker:
    """
    Service for tracking and analyzing user usage patterns.
    """

    def __init__(self):
        pass

    def log_action(
        self,
        db: Session,
        user_id: int,
        action_type: ActionType,
        photo_count: int = 0,
        processing_time_seconds: Optional[float] = None,
        file_size_mb: Optional[float] = None,
        success: bool = True,
        error_message: Optional[str] = None,
        details: Optional[dict] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> UsageLog:
        """
        Log a user action to the usage tracking system.
        """
        usage_log = UsageLog(
            user_id=user_id,
            action_type=action_type,
            photo_count=photo_count,
            processing_time_seconds=processing_time_seconds,
            file_size_mb=file_size_mb,
            success=success,
            error_message=error_message,
            details=json.dumps(details) if details else None,
            ip_address=ip_address,
            user_agent=user_agent,
        )

        db.add(usage_log)
        db.commit()
        db.refresh(usage_log)

        return usage_log

    def create_processing_job(
        self,
        db: Session,
        user_id: int,
        job_id: str,
        total_photos: int = 0,
        total_file_size_mb: Optional[float] = None,
        metadata: Optional[dict] = None,
    ) -> ProcessingJob:
        """
        Create a new processing job record.
        """
        job = ProcessingJob(
            user_id=user_id,
            job_id=job_id,
            total_photos=total_photos,
            total_file_size_mb=total_file_size_mb,
            job_metadata=json.dumps(metadata) if metadata else None,
        )

        db.add(job)
        db.commit()
        db.refresh(job)

        return job

    def update_processing_job(
        self, db: Session, job_id: str, **updates
    ) -> Optional[ProcessingJob]:
        """
        Update a processing job with new information.
        """
        # Find job in database
        job = db.query(ProcessingJob).filter(ProcessingJob.job_id == job_id).first()

        if not job:
            logger.warning(f"Job {job_id} not found in database for update")
            return None

        # Job found, proceed with update

        for key, value in updates.items():
            if hasattr(job, key):
                getattr(job, key)
                setattr(job, key, value)
                # Attribute updated
            else:
                logger.warning(f"Job has no attribute '{key}', skipping")

        # Commit changes
        db.commit()
        db.refresh(job)
        logger.info(f"Job {job_id} updated successfully")

        return job

    def get_or_create_user_quota(self, db: Session, user_id: int) -> UserQuota:
        """
        Get or create user quota record for the current month, 
        ensuring limits are set based on the user's current tier.
        """
        current_month = datetime.utcnow().strftime("%Y-%m")

        # 1. Fetch the User object to get the tier information
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            logger.error(f"User ID {user_id} not found when fetching quota.")
            # Fallback for safety, but this shouldn't happen if auth works
            user_tier = "Trial"
        else:
            user_tier = user.current_tier 

        # 2. Determine the limit based on the user's tier
        tier_limit = get_upload_limit_by_tier(user_tier)
        
        # 3. Fetch the quota object
        quota = db.query(UserQuota).filter(UserQuota.user_id == user_id).first()

        if not quota:
            # Create new quota record
            quota = UserQuota(
                user_id=user_id, 
                current_month=current_month,
                # Set the limit based on the user's tier upon creation
                monthly_photo_limit=tier_limit 
            )
            db.add(quota)
            db.commit()
            db.refresh(quota)
        else:
            # A. Reset monthly usage if it's a new month (Original Logic)
            if quota.current_month != current_month:
                quota.reset_monthly_usage(current_month)
                # Ensure the limit is reset/updated if the tier changed *or* if a default was used before
                quota.monthly_photo_limit = tier_limit
                logger.info(f"Quota reset for {user_id}. Limit set to {tier_limit} ({user_tier} tier).")
            
            # B. CRITICAL: If the quota exists but the limit doesn't match the current tier (e.g., user just upgraded/downgraded), update it.
            elif quota.monthly_photo_limit != tier_limit:
                 quota.monthly_photo_limit = tier_limit
                 logger.info(f"Quota limit updated for {user_id} due to tier change. New limit: {tier_limit}.")

            db.commit()

        return quota

    def check_user_quota(
        self, db: Session, user_id: int, action_type: ActionType, photo_count: int = 0
    ) -> tuple[bool, str]:
        """
        Check if user has quota available for the requested action.
        Returns (can_proceed, message).
        """
        quota = self.get_or_create_user_quota(db, user_id)

        if action_type == ActionType.UPLOAD:
            if not quota.can_upload_photos(photo_count):
                remaining = max(
                    0, quota.monthly_photo_limit - quota.photos_used_this_month
                )
                return (
                    False,
                    f"Monthly photo limit reached. {remaining} photos remaining this month.",
                )

        elif action_type == ActionType.PROCESS:
            if not quota.can_process():
                remaining = max(
                    0, quota.monthly_processing_limit - quota.processing_used_this_month
                )
                return (
                    False,
                    f"Monthly processing limit reached. {remaining} jobs remaining this month.",
                )

        elif action_type == ActionType.EXPORT:
            if not quota.can_export():
                remaining = max(
                    0, quota.monthly_export_limit - quota.exports_used_this_month
                )
                return (
                    False,
                    f"Monthly export limit reached. {remaining} exports remaining this month.",
                )

        return True, "OK"

    def use_quota(
        self, db: Session, user_id: int, action_type: ActionType, photo_count: int = 0
    ) -> UserQuota:
        """
        Use quota for the specified action.
        """
        quota = self.get_or_create_user_quota(db, user_id)

        if action_type == ActionType.UPLOAD:
            quota.use_photos(photo_count)
        elif action_type == ActionType.PROCESS:
            quota.use_processing()
        elif action_type == ActionType.EXPORT:
            quota.use_export()

        db.commit()
        db.refresh(quota)

        return quota


# Global instance
usage_tracker = UsageTracker()

