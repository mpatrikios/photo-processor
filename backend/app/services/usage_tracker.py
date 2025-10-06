from sqlalchemy.orm import Session
from sqlalchemy import func, desc, and_
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
import json

from app.models.user import User
from app.models.usage import UsageLog, ProcessingJob, UserQuota, ActionType
from app.models.processing import ProcessingStatus


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
        user_agent: Optional[str] = None
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
            user_agent=user_agent
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
        metadata: Optional[dict] = None
    ) -> ProcessingJob:
        """
        Create a new processing job record.
        """
        job = ProcessingJob(
            user_id=user_id,
            job_id=job_id,
            total_photos=total_photos,
            total_file_size_mb=total_file_size_mb,
            job_metadata=json.dumps(metadata) if metadata else None
        )
        
        db.add(job)
        db.commit()
        db.refresh(job)
        
        return job

    def update_processing_job(
        self,
        db: Session,
        job_id: str,
        **updates
    ) -> Optional[ProcessingJob]:
        """
        Update a processing job with new information.
        """
        print(f"🔍 DEBUG [usage_tracker]: Looking for job {job_id} in database")
        job = db.query(ProcessingJob).filter(ProcessingJob.job_id == job_id).first()
        
        if not job:
            print(f"❌ DEBUG [usage_tracker]: Job {job_id} NOT FOUND in database!")
            # Let's check what jobs ARE in the database
            all_jobs = db.query(ProcessingJob.job_id).all()
            print(f"🔍 DEBUG [usage_tracker]: Jobs in database: {[j.job_id for j in all_jobs]}")
            return None
        
        print(f"✅ DEBUG [usage_tracker]: Job {job_id} found in database")
        print(f"🔍 DEBUG [usage_tracker]: Current job status: {job.status}")
        
        for key, value in updates.items():
            if hasattr(job, key):
                old_value = getattr(job, key)
                setattr(job, key, value)
                print(f"🔍 DEBUG [usage_tracker]: Set {key}: {old_value} -> {value}")
            else:
                print(f"⚠️ DEBUG [usage_tracker]: Job has no attribute '{key}', skipping")
        
        print(f"🔍 DEBUG [usage_tracker]: Committing changes for job {job_id}")
        db.commit()
        db.refresh(job)
        print(f"✅ DEBUG [usage_tracker]: Changes committed successfully")
        
        return job

    def get_or_create_user_quota(self, db: Session, user_id: int) -> UserQuota:
        """
        Get or create user quota record for the current month.
        """
        current_month = datetime.utcnow().strftime("%Y-%m")
        
        quota = db.query(UserQuota).filter(UserQuota.user_id == user_id).first()
        
        if not quota:
            # Create new quota record
            quota = UserQuota(
                user_id=user_id,
                current_month=current_month
            )
            db.add(quota)
            db.commit()
            db.refresh(quota)
        else:
            # Reset monthly usage if it's a new month
            quota.reset_monthly_usage(current_month)
            db.commit()
        
        return quota

    def check_user_quota(
        self,
        db: Session,
        user_id: int,
        action_type: ActionType,
        photo_count: int = 0
    ) -> tuple[bool, str]:
        """
        Check if user has quota available for the requested action.
        Returns (can_proceed, message).
        """
        quota = self.get_or_create_user_quota(db, user_id)
        
        if action_type == ActionType.UPLOAD:
            if not quota.can_upload_photos(photo_count):
                remaining = max(0, quota.monthly_photo_limit - quota.photos_used_this_month)
                return False, f"Monthly photo limit reached. {remaining} photos remaining this month."
        
        elif action_type == ActionType.PROCESS:
            if not quota.can_process():
                remaining = max(0, quota.monthly_processing_limit - quota.processing_used_this_month)
                return False, f"Monthly processing limit reached. {remaining} jobs remaining this month."
        
        elif action_type == ActionType.EXPORT:
            if not quota.can_export():
                remaining = max(0, quota.monthly_export_limit - quota.exports_used_this_month)
                return False, f"Monthly export limit reached. {remaining} exports remaining this month."
        
        return True, "OK"

    def use_quota(
        self,
        db: Session,
        user_id: int,
        action_type: ActionType,
        photo_count: int = 0
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

    def get_user_stats(self, db: Session, user_id: int, days: int = 30) -> dict:
        """
        Get comprehensive usage statistics for a user.
        """
        since_date = datetime.utcnow() - timedelta(days=days)
        
        # Get usage logs
        usage_logs = db.query(UsageLog).filter(
            UsageLog.user_id == user_id,
            UsageLog.created_at >= since_date
        ).all()
        
        # Get processing jobs
        processing_jobs = db.query(ProcessingJob).filter(
            ProcessingJob.user_id == user_id,
            ProcessingJob.created_at >= since_date
        ).all()
        
        # Get current quota
        quota = self.get_or_create_user_quota(db, user_id)
        
        # Calculate statistics
        stats = {
            "user_id": user_id,
            "period_days": days,
            "since_date": since_date.isoformat(),
            
            # Action counts
            "total_actions": len(usage_logs),
            "uploads": len([log for log in usage_logs if log.action_type == ActionType.UPLOAD]),
            "processes": len([log for log in usage_logs if log.action_type == ActionType.PROCESS]),
            "exports": len([log for log in usage_logs if log.action_type == ActionType.EXPORT]),
            "logins": len([log for log in usage_logs if log.action_type == ActionType.LOGIN]),
            
            # Photo statistics
            "total_photos_uploaded": sum(log.photo_count for log in usage_logs if log.action_type == ActionType.UPLOAD),
            "total_photos_processed": sum(log.photo_count for log in usage_logs if log.action_type == ActionType.PROCESS),
            
            # Processing statistics
            "total_processing_time_seconds": sum(
                job.total_processing_time_seconds or 0 for job in processing_jobs
            ),
            "average_processing_time_per_job": (
                sum(job.total_processing_time_seconds or 0 for job in processing_jobs) / len(processing_jobs)
                if processing_jobs else 0
            ),
            "average_photos_per_job": (
                sum(job.total_photos for job in processing_jobs) / len(processing_jobs)
                if processing_jobs else 0
            ),
            
            # Success rates
            "success_rate": (
                len([log for log in usage_logs if log.success]) / len(usage_logs)
                if usage_logs else 1.0
            ) * 100,
            
            # File size statistics
            "total_file_size_mb": sum(log.file_size_mb or 0 for log in usage_logs),
            
            # Processing job statistics
            "total_jobs": len(processing_jobs),
            "completed_jobs": len([job for job in processing_jobs if job.status == ProcessingStatus.COMPLETED]),
            "failed_jobs": len([job for job in processing_jobs if job.status == ProcessingStatus.FAILED]),
            
            # Current quota status
            "current_quota": quota.to_dict()
        }
        
        return stats

    def get_system_stats(self, db: Session, days: int = 30) -> dict:
        """
        Get system-wide usage statistics.
        """
        since_date = datetime.utcnow() - timedelta(days=days)
        
        # User statistics
        total_users = db.query(User).count()
        active_users = db.query(User).filter(User.is_active == True).count()
        new_users = db.query(User).filter(User.created_at >= since_date).count()
        
        # Activity statistics
        total_actions = db.query(UsageLog).filter(UsageLog.created_at >= since_date).count()
        unique_active_users = db.query(UsageLog.user_id).filter(
            UsageLog.created_at >= since_date
        ).distinct().count()
        
        # Photo statistics
        photos_uploaded = db.query(func.sum(UsageLog.photo_count)).filter(
            UsageLog.action_type == ActionType.UPLOAD,
            UsageLog.created_at >= since_date
        ).scalar() or 0
        
        photos_processed = db.query(func.sum(UsageLog.photo_count)).filter(
            UsageLog.action_type == ActionType.PROCESS,
            UsageLog.created_at >= since_date
        ).scalar() or 0
        
        # Processing job statistics
        total_jobs = db.query(ProcessingJob).filter(ProcessingJob.created_at >= since_date).count()
        completed_jobs = db.query(ProcessingJob).filter(
            ProcessingJob.created_at >= since_date,
            ProcessingJob.status == ProcessingStatus.COMPLETED
        ).count()
        
        # Success rates
        successful_actions = db.query(UsageLog).filter(
            UsageLog.created_at >= since_date,
            UsageLog.success == True
        ).count()
        
        return {
            "period_days": days,
            "since_date": since_date.isoformat(),
            
            # User metrics
            "total_users": total_users,
            "active_users": active_users,
            "new_users_period": new_users,
            "unique_active_users_period": unique_active_users,
            
            # Activity metrics
            "total_actions_period": total_actions,
            "photos_uploaded_period": photos_uploaded,
            "photos_processed_period": photos_processed,
            "total_jobs_period": total_jobs,
            "completed_jobs_period": completed_jobs,
            
            # Performance metrics
            "success_rate_period": (successful_actions / total_actions * 100) if total_actions > 0 else 100,
            "job_completion_rate": (completed_jobs / total_jobs * 100) if total_jobs > 0 else 100,
            
            # Averages
            "avg_photos_per_user": photos_uploaded / unique_active_users if unique_active_users > 0 else 0,
            "avg_jobs_per_user": total_jobs / unique_active_users if unique_active_users > 0 else 0
        }

    def get_user_activity_timeline(
        self, 
        db: Session, 
        user_id: int, 
        days: int = 7
    ) -> List[Dict[str, Any]]:
        """
        Get a timeline of user activity for the specified period.
        """
        since_date = datetime.utcnow() - timedelta(days=days)
        
        # Get usage logs
        logs = db.query(UsageLog).filter(
            UsageLog.user_id == user_id,
            UsageLog.created_at >= since_date
        ).order_by(desc(UsageLog.created_at)).all()
        
        # Get processing jobs
        jobs = db.query(ProcessingJob).filter(
            ProcessingJob.user_id == user_id,
            ProcessingJob.created_at >= since_date
        ).order_by(desc(ProcessingJob.created_at)).all()
        
        # Combine and sort timeline
        timeline = []
        
        for log in logs:
            timeline.append({
                "type": "action",
                "timestamp": log.created_at.isoformat(),
                "action": log.action_type.value,
                "success": log.success,
                "photo_count": log.photo_count,
                "processing_time": log.processing_time_seconds,
                "error_message": log.error_message
            })
        
        for job in jobs:
            timeline.append({
                "type": "job",
                "timestamp": job.created_at.isoformat(),
                "job_id": job.job_id,
                "status": job.status,
                "total_photos": job.total_photos,
                "photos_detected": job.photos_detected,
                "photos_unknown": job.photos_unknown,
                "processing_time": job.total_processing_time_seconds
            })
        
        # Sort by timestamp (newest first)
        timeline.sort(key=lambda x: x["timestamp"], reverse=True)
        
        return timeline

    def get_popular_hours(self, db: Session, days: int = 30) -> Dict[int, int]:
        """
        Get usage statistics by hour of day.
        Returns a dictionary with hour (0-23) as key and action count as value.
        """
        since_date = datetime.utcnow() - timedelta(days=days)
        
        # Query usage logs grouped by hour
        result = db.query(
            func.extract('hour', UsageLog.created_at).label('hour'),
            func.count(UsageLog.id).label('count')
        ).filter(
            UsageLog.created_at >= since_date
        ).group_by(
            func.extract('hour', UsageLog.created_at)
        ).all()
        
        # Convert to dictionary with all hours (0-23)
        hour_stats = {hour: 0 for hour in range(24)}
        for hour, count in result:
            hour_stats[int(hour)] = count
        
        return hour_stats


# Global instance
usage_tracker = UsageTracker()