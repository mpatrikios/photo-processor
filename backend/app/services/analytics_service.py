"""
Analytics service for performance-first business intelligence.
"""
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import desc, func, or_, and_
from sqlalchemy.orm import Session

from app.models.analytics import (
    BusinessMetric,
    DetectionAccuracyLog,
    UserRetentionCohort,
    ConversionFunnel
)
from app.models.processing import PhotoDB, ProcessingStatus
from app.models.usage import ActionType, ProcessingJob, UsageLog
from app.models.user import User

logger = logging.getLogger(__name__)

class AnalyticsService:
    """
    Business Intelligence service optimized for ML performance and accuracy tracking.
    """

    async def record_detection_accuracy(
        self,
        db: Session,
        photo_id: str,
        user_id: int,
        job_id: int,
        detection_method: str,
        final_result: str,
        processing_time_ms: float,
        manual_label: Optional[str] = None,
        is_correct: Optional[bool] = None
    ):
        """Record ML performance. Called immediately after a job or human correction."""
        log = DetectionAccuracyLog(
            photo_id=photo_id,
            user_id=user_id,
            processing_job_id=job_id,
            detection_method=detection_method,
            processing_time_ms=processing_time_ms,
            final_result=final_result,
            manual_label=manual_label,
            is_correct=is_correct
        )
        db.add(log)
        db.commit()
        return log

    async def calculate_daily_business_metrics(self, db: Session, target_date: Optional[datetime] = None):
        """
        Calculates a 'Snapshot' for the dashboard. 
        Designed to run via a Cron Job at 11:59 PM.
        """
        if not target_date:
            target_date = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

        # 1. Total & New Users
        total_users = db.query(User).count()
        new_users = db.query(User).filter(User.created_at >= target_date).count()

        # 2. Daily Active Users (DAU)
        active_users = db.query(func.count(func.distinct(UsageLog.user_id)))\
            .filter(UsageLog.created_at >= target_date).scalar() or 0

        # 3. Processing Volume & Accuracy
        accuracy_stats = db.query(
            func.sum(ProcessingJob.photos_processed).label("total"),
            func.avg(DetectionAccuracyLog.is_correct.cast(func.Integer)).label("acc")
        ).filter(ProcessingJob.created_at >= target_date).first()

        # 4. Save the snapshot
        metric = BusinessMetric(
            date=target_date,
            period_type="daily",
            total_users=total_users,
            active_users=active_users,
            total_photos_processed=accuracy_stats.total or 0,
            avg_detection_accuracy=(accuracy_stats.acc or 0) * 100
        )
        db.add(metric)
        db.commit()
        return metric

    async def calculate_user_retention_cohorts(self, db: Session):
        """
        Calculates the retention heatmap. 
        Uses month-over-month active user tracking.
        """
        # Get cohorts (Month user joined)
        cohorts = db.query(
            func.to_char(User.created_at, 'YYYY-MM').label("month"),
            func.count(User.id).label("count")
        ).group_by("month").all()

        for cohort in cohorts:
            # How many of these users were active in Month 1, Month 2, etc.
            # This logic fetches the distinct user IDs for the cohort
            cohort_user_ids = db.query(User.id).filter(func.to_char(User.created_at, 'YYYY-MM') == cohort.month)
            
            # Update the Cohort Table (Simplified logic)
            existing = db.query(UserRetentionCohort).filter_by(cohort_month=cohort.month).first()
            if not existing:
                existing = UserRetentionCohort(cohort_month=cohort.month, user_count=cohort.count)
                db.add(existing)
            
            # Logic here would calculate the Month_1, Month_2 % based on UsageLog
            # ... calculation logic ...
            
        db.commit()

    async def get_ai_first_pass_accuracy(self, db: Session, user_id: int, days: int = 30) -> float:
        """
        Calculate AI accuracy using "Guilty Until Proven Innocent" logic for unknowns.
        
        AI Successes: Photos where AI detected a number AND user didn't change it
        AI Valid Silences: Photos where AI said "Unknown" AND user confirmed "No Bib"  
        Formula: (AI_Successes + AI_Valid_Silences) / Total_Photos * 100
        
        SECURITY: User-scoped queries only.
        PRODUCTION: Zero-division protection.
        """
        since_date = datetime.utcnow() - timedelta(days=days)
        
        # Total photos uploaded (fixed denominator)
        total_uploads = db.query(func.count(PhotoDB.id)).filter(
            PhotoDB.user_id == user_id,
            PhotoDB.created_at >= since_date
        ).scalar() or 0
        
        # Zero-division protection
        if total_uploads <= 0:
            return 0.0
        
        # AI Successes: Photos where AI detected a number AND user didn't manually relabel it
        ai_successes = db.query(func.count(PhotoDB.id)).filter(
            PhotoDB.user_id == user_id,
            PhotoDB.created_at >= since_date,
            PhotoDB.detected_number.isnot(None),
            PhotoDB.detected_number != 'unknown',
            or_(
                PhotoDB.manual_label.is_(None),
                PhotoDB.manual_label == PhotoDB.detected_number
            )
        ).scalar() or 0
        
        # AI Valid Silences: Photos where AI said "Unknown" AND user confirmed "No Bib"
        ai_valid_silences = db.query(func.count(PhotoDB.id)).filter(
            PhotoDB.user_id == user_id,
            PhotoDB.created_at >= since_date,
            PhotoDB.detected_number == 'unknown',
            PhotoDB.manual_label == 'unknown'
        ).scalar() or 0
        
        # Calculate accuracy: only proven AI successes count
        ai_correct_decisions = ai_successes + ai_valid_silences
        accuracy = (ai_correct_decisions / total_uploads) * 100
        
        # DEBUG LOGGING for analytics accuracy calculation
        logger.info(f"🔍 ACCURACY DEBUG for user_id={user_id}: total_uploads={total_uploads}, ai_successes={ai_successes}, ai_valid_silences={ai_valid_silences}, ai_correct_decisions={ai_correct_decisions}, calculated_accuracy={accuracy:.2f}%")
        
        return round(max(0.0, min(100.0, accuracy)), 2)  # Ensure 0-100% range
        

    def get_user_stats(self, db: Session, user_id: int, days: int = 30) -> dict:
        """
        Get comprehensive usage statistics for a user with user isolation.
        SECURITY: Only returns data for the specified user_id.
        """
        since_date = datetime.utcnow() - timedelta(days=days)

        # SECURITY: User-scoped queries only
        usage_logs = (
            db.query(UsageLog)
            .filter(UsageLog.user_id == user_id, UsageLog.created_at >= since_date)
            .all()
        )

        processing_jobs = (
            db.query(ProcessingJob)
            .filter(
                ProcessingJob.user_id == user_id, ProcessingJob.created_at >= since_date
            )
            .all()
        )

        # Calculate statistics with ZeroDivisionError protection
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
            "total_photos_uploaded": sum(
                log.photo_count for log in usage_logs if log.action_type == ActionType.UPLOAD
            ),
            "total_photos_processed": sum(
                log.photo_count for log in usage_logs if log.action_type == ActionType.PROCESS
            ),
            # Processing statistics with null safety
            "total_processing_time_seconds": sum(
                job.total_processing_time_seconds or 0 for job in processing_jobs
            ),
            "average_processing_time_per_job": (
                sum(job.total_processing_time_seconds or 0 for job in processing_jobs)
                / len(processing_jobs) if processing_jobs else 0.0
            ),
            "average_photos_per_job": (
                sum(job.total_photos for job in processing_jobs) 
                / len(processing_jobs) if processing_jobs else 0.0
            ),
            # Success rates with null safety
            "success_rate": (
                len([log for log in usage_logs if log.success]) / len(usage_logs) * 100
                if usage_logs else 100.0
            ),
            "total_file_size_mb": sum(log.file_size_mb or 0 for log in usage_logs),
            # Job statistics
            "total_jobs": len(processing_jobs),
            "completed_jobs": len([
                job for job in processing_jobs 
                if job.status == ProcessingStatus.COMPLETED
            ]),
            "failed_jobs": len([
                job for job in processing_jobs 
                if job.status == ProcessingStatus.FAILED
            ])
        }

        return stats

    def get_user_activity_timeline(self, db: Session, user_id: int, days: int = 7) -> List[Dict[str, Any]]:
        """
        Get user activity timeline with strict user isolation.
        SECURITY: Only returns activity for the specified user_id.
        """
        since_date = datetime.utcnow() - timedelta(days=days)

        # SECURITY: User-scoped queries only
        logs = (
            db.query(UsageLog)
            .filter(UsageLog.user_id == user_id, UsageLog.created_at >= since_date)
            .order_by(desc(UsageLog.created_at))
            .all()
        )

        jobs = (
            db.query(ProcessingJob)
            .filter(
                ProcessingJob.user_id == user_id, ProcessingJob.created_at >= since_date
            )
            .order_by(desc(ProcessingJob.created_at))
            .all()
        )

        # Combine timeline events
        timeline = []

        for log in logs:
            timeline.append({
                "type": "action",
                "timestamp": log.created_at.isoformat(),
                "action": log.action_type.value,
                "success": log.success,
                "photo_count": log.photo_count,
                "processing_time": log.processing_time_seconds,
                "error_message": log.error_message,
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
                "processing_time": job.total_processing_time_seconds,
            })

        # Sort by timestamp (newest first)
        timeline.sort(key=lambda x: x["timestamp"], reverse=True)
        return timeline

    def get_popular_hours(self, db: Session, user_id: int, days: int = 30) -> Dict[int, int]:
        """
        Get user-specific usage patterns by hour.
        SECURITY: Only analyzes activity for the specified user_id.
        """
        since_date = datetime.utcnow() - timedelta(days=days)

        # SECURITY: User-scoped query only
        result = (
            db.query(
                func.extract("hour", UsageLog.created_at).label("hour"),
                func.count(UsageLog.id).label("count"),
            )
            .filter(
                UsageLog.user_id == user_id,  # SECURITY: User isolation
                UsageLog.created_at >= since_date
            )
            .group_by(func.extract("hour", UsageLog.created_at))
            .all()
        )

        # Initialize all hours to 0
        hour_stats = {hour: 0 for hour in range(24)}
        for hour, count in result:
            hour_stats[int(hour)] = count

        return hour_stats

analytics_service = AnalyticsService()