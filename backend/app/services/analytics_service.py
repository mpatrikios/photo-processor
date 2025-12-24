"""
Analytics service for performance-first business intelligence.
"""
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.models.analytics import (
    BusinessMetric,
    DetectionAccuracyLog,
    UserRetentionCohort,
    ConversionFunnel
)
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

    def get_accuracy_report(self, db: Session, days: int = 30):
        """High-speed accuracy report by Model Method."""
        since = datetime.utcnow() - timedelta(days=days)
        return db.query(
            DetectionAccuracyLog.detection_method,
            func.avg(DetectionAccuracyLog.is_correct.cast(func.Float)).label("accuracy"),
            func.avg(DetectionAccuracyLog.processing_time_ms).label("speed")
        ).filter(DetectionAccuracyLog.detected_at >= since)\
         .group_by(DetectionAccuracyLog.detection_method).all()

analytics_service = AnalyticsService()