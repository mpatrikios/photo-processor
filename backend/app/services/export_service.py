"""
Enhanced data export and reporting service.
"""

import csv
import io
import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.models.analytics import (
    ConversionFunnel,
    DetectionAccuracyLog,
    SystemMetric,
    UserEngagement,
)
from app.models.usage import ProcessingJob as ProcessingJobDB
from app.models.usage import UsageLog
from app.models.user import User


class ExportService:
    """
    Service for exporting analytics and business data in various formats.
    """

    def __init__(self):
        self.supported_formats = ["json", "csv", "excel"]

    async def export_user_analytics(
        self,
        db: Session,
        format: str = "csv",
        days: int = 30,
        include_engagement: bool = True,
    ) -> bytes:
        """Export comprehensive user analytics data."""

        since_date = datetime.utcnow() - timedelta(days=days)

        # Collect user data
        users_query = db.query(
            User.id,
            User.email,
            User.full_name,
            User.created_at,
            User.last_login,
            User.is_active,
            User.total_photos_uploaded,
            User.total_photos_processed,
            User.total_exports,
        ).order_by(User.created_at.desc())

        users_data = []
        for user in users_query.all():
            # Get recent activity metrics
            recent_activity = (
                db.query(func.count(UsageLog.id))
                .filter(UsageLog.user_id == user.id, UsageLog.created_at >= since_date)
                .scalar()
                or 0
            )

            # Get job success rate
            total_jobs = (
                db.query(ProcessingJobDB)
                .filter(ProcessingJobDB.user_id == user.id)
                .count()
            )

            completed_jobs = (
                db.query(ProcessingJobDB)
                .filter(
                    ProcessingJobDB.user_id == user.id,
                    ProcessingJobDB.status == "completed",
                )
                .count()
            )

            success_rate = (completed_jobs / total_jobs * 100) if total_jobs > 0 else 0

            user_data = {
                "user_id": user.id,
                "email": user.email,
                "full_name": user.full_name,
                "created_at": user.created_at.isoformat(),
                "last_login": user.last_login.isoformat() if user.last_login else None,
                "is_active": user.is_active,
                "total_photos_uploaded": user.total_photos_uploaded,
                "total_photos_processed": user.total_photos_processed,
                "total_exports": user.total_exports,
                "recent_activity_count": recent_activity,
                "total_processing_jobs": total_jobs,
                "job_success_rate": round(success_rate, 2),
                "account_age_days": (datetime.utcnow() - user.created_at).days,
            }

            if include_engagement:
                # Add engagement metrics
                engagement_count = (
                    db.query(UserEngagement)
                    .filter(
                        UserEngagement.user_id == user.id,
                        UserEngagement.timestamp >= since_date,
                    )
                    .count()
                )

                user_data["engagement_events"] = engagement_count

            users_data.append(user_data)

        return await self._format_data(users_data, format, "user_analytics")

    async def export_system_metrics(
        self,
        db: Session,
        format: str = "csv",
        days: int = 7,
        metric_types: Optional[List[str]] = None,
    ) -> bytes:
        """Export system performance metrics."""

        since_date = datetime.utcnow() - timedelta(days=days)

        query = db.query(SystemMetric).filter(SystemMetric.timestamp >= since_date)

        if metric_types:
            from app.models.analytics import SystemMetricType

            type_filters = [
                SystemMetricType(mt)
                for mt in metric_types
                if hasattr(SystemMetricType, mt.upper())
            ]
            if type_filters:
                query = query.filter(SystemMetric.metric_type.in_(type_filters))

        metrics = query.order_by(SystemMetric.timestamp.desc()).all()

        metrics_data = []
        for metric in metrics:
            metrics_data.append(
                {
                    "timestamp": metric.timestamp.isoformat(),
                    "metric_type": metric.metric_type.value,
                    "metric_name": metric.metric_name,
                    "value": metric.value,
                    "unit": metric.unit,
                    "endpoint": metric.endpoint,
                    "user_id": metric.user_id,
                    "job_id": metric.job_id,
                    "metadata": (
                        json.dumps(metric.metric_metadata)
                        if metric.metric_metadata
                        else None
                    ),
                }
            )

        return await self._format_data(metrics_data, format, "system_metrics")

    async def export_business_report(
        self, db: Session, format: str = "json", days: int = 30
    ) -> bytes:
        """Export comprehensive business intelligence report."""

        since_date = datetime.utcnow() - timedelta(days=days)
        end_date = datetime.utcnow()

        # Executive summary
        total_users = db.query(User).count()
        active_users = (
            db.query(func.count(func.distinct(UsageLog.user_id)))
            .filter(UsageLog.created_at >= since_date)
            .scalar()
            or 0
        )

        new_users = db.query(User).filter(User.created_at >= since_date).count()

        # Processing metrics
        total_jobs = (
            db.query(ProcessingJobDB)
            .filter(ProcessingJobDB.created_at >= since_date)
            .count()
        )

        completed_jobs = (
            db.query(ProcessingJobDB)
            .filter(
                ProcessingJobDB.created_at >= since_date,
                ProcessingJobDB.status == "completed",
            )
            .count()
        )

        total_photos = (
            db.query(func.sum(ProcessingJobDB.total_photos))
            .filter(ProcessingJobDB.created_at >= since_date)
            .scalar()
            or 0
        )

        # Detection accuracy
        accuracy_stats = (
            db.query(
                func.count(DetectionAccuracyLog.id).label("total"),
                func.count(DetectionAccuracyLog.id)
                .filter(DetectionAccuracyLog.is_correct == True)
                .label("correct"),
            )
            .filter(DetectionAccuracyLog.detected_at >= since_date)
            .first()
        )

        detection_accuracy = (
            (accuracy_stats.correct / accuracy_stats.total * 100)
            if accuracy_stats.total > 0
            else 0
        )

        # User engagement summary
        total_engagements = (
            db.query(UserEngagement)
            .filter(UserEngagement.timestamp >= since_date)
            .count()
        )

        # Top users by activity
        top_users = (
            db.query(
                User.id,
                User.email,
                User.full_name,
                func.count(UsageLog.id).label("activity_count"),
            )
            .join(UsageLog)
            .filter(UsageLog.created_at >= since_date)
            .group_by(User.id)
            .order_by(desc("activity_count"))
            .limit(10)
            .all()
        )

        # Performance trends (daily)
        daily_trends = (
            db.query(
                func.date(ProcessingJobDB.created_at).label("date"),
                func.count(ProcessingJobDB.id).label("jobs"),
                func.sum(ProcessingJobDB.total_photos).label("photos"),
                func.avg(ProcessingJobDB.progress).label("avg_progress"),
            )
            .filter(ProcessingJobDB.created_at >= since_date)
            .group_by(func.date(ProcessingJobDB.created_at))
            .order_by("date")
            .all()
        )

        # Compile comprehensive report
        report = {
            "report_metadata": {
                "generated_at": datetime.utcnow().isoformat(),
                "period_start": since_date.isoformat(),
                "period_end": end_date.isoformat(),
                "period_days": days,
                "report_version": "1.0",
            },
            "executive_summary": {
                "total_users": total_users,
                "active_users": active_users,
                "new_users": new_users,
                "user_growth_rate": (
                    round((new_users / (total_users - new_users) * 100), 2)
                    if total_users > new_users
                    else 0
                ),
                "user_activation_rate": (
                    round((active_users / total_users * 100), 2)
                    if total_users > 0
                    else 0
                ),
                "total_processing_jobs": total_jobs,
                "completed_jobs": completed_jobs,
                "job_success_rate": (
                    round((completed_jobs / total_jobs * 100), 2)
                    if total_jobs > 0
                    else 100
                ),
                "total_photos_processed": int(total_photos),
                "average_photos_per_job": (
                    round((total_photos / total_jobs), 1) if total_jobs > 0 else 0
                ),
                "detection_accuracy_percentage": round(detection_accuracy, 2),
                "total_engagement_events": total_engagements,
            },
            "user_insights": {
                "most_active_users": [
                    {
                        "user_id": user.id,
                        "email": user.email,
                        "full_name": user.full_name,
                        "activity_count": user.activity_count,
                    }
                    for user in top_users
                ]
            },
            "performance_trends": {
                "daily_processing": [
                    {
                        "date": trend.date.isoformat(),
                        "jobs_created": trend.jobs,
                        "photos_processed": int(trend.photos or 0),
                        "average_progress": round(trend.avg_progress or 0, 2),
                    }
                    for trend in daily_trends
                ]
            },
        }

        return await self._format_data(report, format, "business_report")

    async def export_conversion_funnel(
        self, db: Session, format: str = "csv", days: int = 30
    ) -> bytes:
        """Export conversion funnel analysis."""

        since_date = datetime.utcnow() - timedelta(days=days)

        # Get conversion data by step
        from app.models.analytics import ConversionStep

        funnel_data = []
        previous_count = None

        for step in ConversionStep:
            step_count = (
                db.query(ConversionFunnel)
                .filter(
                    ConversionFunnel.step == step,
                    ConversionFunnel.completed_at >= since_date,
                )
                .count()
            )

            # Calculate conversion rate from previous step
            conversion_rate = None
            if previous_count is not None and previous_count > 0:
                conversion_rate = round((step_count / previous_count * 100), 2)

            # Calculate average time to convert
            avg_time = (
                db.query(func.avg(ConversionFunnel.time_to_convert_seconds))
                .filter(
                    ConversionFunnel.step == step,
                    ConversionFunnel.completed_at >= since_date,
                )
                .scalar()
            )

            funnel_data.append(
                {
                    "step": step.value,
                    "step_order": list(ConversionStep).index(step) + 1,
                    "user_count": step_count,
                    "conversion_rate_from_previous": conversion_rate,
                    "average_time_to_convert_hours": (
                        round(avg_time / 3600, 2) if avg_time else None
                    ),
                    "drop_off_count": (
                        (previous_count - step_count) if previous_count else 0
                    ),
                }
            )

            previous_count = step_count

        return await self._format_data(funnel_data, format, "conversion_funnel")

    async def export_detection_accuracy_report(
        self, db: Session, format: str = "csv", days: int = 30
    ) -> bytes:
        """Export detailed detection accuracy analysis."""

        since_date = datetime.utcnow() - timedelta(days=days)

        accuracy_logs = (
            db.query(DetectionAccuracyLog)
            .filter(DetectionAccuracyLog.detected_at >= since_date)
            .order_by(DetectionAccuracyLog.detected_at.desc())
            .all()
        )

        accuracy_data = []
        for log in accuracy_logs:
            accuracy_data.append(
                {
                    "detected_at": log.detected_at.isoformat(),
                    "photo_id": log.photo_id,
                    "user_id": log.user_id,
                    "processing_job_id": log.processing_job_id,
                    "google_vision_result": log.google_vision_result,
                    "google_vision_confidence": log.google_vision_confidence,
                    "tesseract_result": log.tesseract_result,
                    "tesseract_confidence": log.tesseract_confidence,
                    "final_result": log.final_result,
                    "detection_method": log.detection_method,
                    "manual_label": log.manual_label,
                    "is_correct": log.is_correct,
                    "processing_time_ms": log.processing_time_ms,
                    "image_dimensions": log.image_dimensions,
                    "file_size_bytes": log.file_size_bytes,
                    "image_quality_score": log.image_quality_score,
                    "bib_visibility_score": log.bib_visibility_score,
                }
            )

        return await self._format_data(accuracy_data, format, "detection_accuracy")

    async def _format_data(self, data: Any, format: str, filename_prefix: str) -> bytes:
        """Format data according to specified format."""

        datetime.utcnow().strftime("%Y%m%d_%H%M%S")

        if format.lower() == "json":
            json_str = json.dumps(data, indent=2, default=str)
            return json_str.encode("utf-8")

        elif format.lower() == "csv":
            if isinstance(data, dict):
                # If it's a single dict, wrap it in a list
                data = [data]

            if not data:
                return b"No data available\n"

            output = io.StringIO()
            writer = csv.DictWriter(output, fieldnames=data[0].keys())
            writer.writeheader()
            writer.writerows(data)

            return output.getvalue().encode("utf-8")

        elif format.lower() == "excel":
            # For Excel, we'd need openpyxl or xlsxwriter
            # For now, return CSV format as fallback
            return await self._format_data(data, "csv", filename_prefix)

        else:
            raise ValueError(f"Unsupported format: {format}")

    def get_supported_formats(self) -> List[str]:
        """Return list of supported export formats."""
        return self.supported_formats.copy()

    async def schedule_automated_report(
        self,
        db: Session,
        report_type: str,
        frequency: str,  # daily, weekly, monthly
        format: str = "json",
        email_recipients: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Schedule automated report generation (placeholder for future implementation)."""

        # This would integrate with a task queue like Celery or similar
        # For now, return configuration that would be stored

        report_config = {
            "report_type": report_type,
            "frequency": frequency,
            "format": format,
            "email_recipients": email_recipients or [],
            "created_at": datetime.utcnow().isoformat(),
            "next_run": self._calculate_next_run(frequency),
            "status": "scheduled",
        }

        return report_config

    def _calculate_next_run(self, frequency: str) -> str:
        """Calculate next run time based on frequency."""
        now = datetime.utcnow()

        if frequency == "daily":
            next_run = now.replace(
                hour=6, minute=0, second=0, microsecond=0
            ) + timedelta(days=1)
        elif frequency == "weekly":
            # Next Monday at 6 AM
            days_until_monday = (7 - now.weekday()) % 7
            if days_until_monday == 0:  # Today is Monday
                days_until_monday = 7
            next_run = now.replace(
                hour=6, minute=0, second=0, microsecond=0
            ) + timedelta(days=days_until_monday)
        elif frequency == "monthly":
            # First day of next month at 6 AM
            if now.month == 12:
                next_run = now.replace(
                    year=now.year + 1,
                    month=1,
                    day=1,
                    hour=6,
                    minute=0,
                    second=0,
                    microsecond=0,
                )
            else:
                next_run = now.replace(
                    month=now.month + 1,
                    day=1,
                    hour=6,
                    minute=0,
                    second=0,
                    microsecond=0,
                )
        else:
            # Default to daily
            next_run = now + timedelta(days=1)

        return next_run.isoformat()


# Global export service instance
export_service = ExportService()
