"""
Analytics service for advanced business intelligence and performance tracking.
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.models.analytics import (
    AlertHistory,
    AlertRule,
    BusinessMetric,
    DetectionAccuracyLog,
    SystemMetric,
    SystemMetricType,
    UserEngagement,
    UserRetentionCohort,
)
from app.models.processing import PhotoDB
from app.models.usage import ActionType
from app.models.usage import ProcessingJob as ProcessingJobDB
from app.models.usage import UsageLog
from app.models.user import User

logger = logging.getLogger(__name__)


class AnalyticsService:
    """
    Comprehensive analytics service for business intelligence.
    """

    def __init__(self):
        self.alert_rules = {}  # Cache for alert rules
        self.last_metrics_update = None

    # Real-time metrics collection

    async def record_system_metric(
        self,
        db: Session,
        metric_type: SystemMetricType,
        metric_name: str,
        value: float,
        unit: Optional[str] = None,
        endpoint: Optional[str] = None,
        user_id: Optional[int] = None,
        job_id: Optional[str] = None,
        metric_metadata: Optional[Dict] = None,
    ):
        """Record a system performance metric."""

        metric = SystemMetric(
            metric_type=metric_type,
            metric_name=metric_name,
            value=value,
            unit=unit,
            endpoint=endpoint,
            user_id=user_id,
            job_id=job_id,
            metric_metadata=metric_metadata,
        )

        db.add(metric)
        db.commit()

        # Check alert rules
        await self.check_alert_rules(db, metric)

        return metric

    async def record_detection_accuracy(
        self,
        db: Session,
        photo_id: str,
        user_id: int,
        processing_job_id: Optional[str],
        google_vision_result: Optional[str],
        google_vision_confidence: Optional[float],
        tesseract_result: Optional[str],
        tesseract_confidence: Optional[float],
        final_result: Optional[str],
        detection_method: str,
        processing_time_ms: float,
        image_dimensions: Optional[str] = None,
        file_size_bytes: Optional[int] = None,
        detection_metadata: Optional[Dict] = None,
    ):
        """Record detection accuracy data for ML performance tracking."""

        accuracy_log = DetectionAccuracyLog(
            photo_id=photo_id,
            user_id=user_id,
            processing_job_id=processing_job_id,
            google_vision_result=google_vision_result,
            google_vision_confidence=google_vision_confidence,
            tesseract_result=tesseract_result,
            tesseract_confidence=tesseract_confidence,
            final_result=final_result,
            detection_method=detection_method,
            processing_time_ms=processing_time_ms,
            image_dimensions=image_dimensions,
            file_size_bytes=file_size_bytes,
            detection_metadata=detection_metadata,
        )

        db.add(accuracy_log)
        db.commit()

        return accuracy_log

    # Business intelligence calculations

    async def calculate_daily_business_metrics(
        self, db: Session, target_date: datetime = None
    ):
        """Calculate and store daily business metrics."""

        if not target_date:
            target_date = datetime.utcnow().replace(
                hour=0, minute=0, second=0, microsecond=0
            )

        # Check if metrics already exist for this date
        existing = (
            db.query(BusinessMetric)
            .filter(
                BusinessMetric.date == target_date,
                BusinessMetric.period_type == "daily",
            )
            .first()
        )

        if existing:
            logger.info(f"Daily metrics already exist for {target_date.date()}")
            return existing

        # Calculate metrics for the day
        start_of_day = target_date
        end_of_day = start_of_day + timedelta(days=1)

        # User metrics
        total_users = db.query(User).filter(User.created_at <= end_of_day).count()
        new_users = (
            db.query(User)
            .filter(User.created_at >= start_of_day, User.created_at < end_of_day)
            .count()
        )

        active_users = (
            db.query(func.count(func.distinct(UsageLog.user_id)))
            .filter(
                UsageLog.created_at >= start_of_day, UsageLog.created_at < end_of_day
            )
            .scalar()
            or 0
        )

        # Processing metrics
        total_photos = (
            db.query(func.sum(UsageLog.photo_count))
            .filter(
                UsageLog.action_type == ActionType.PROCESS,
                UsageLog.created_at >= start_of_day,
                UsageLog.created_at < end_of_day,
            )
            .scalar()
            or 0
        )

        total_exports = (
            db.query(func.count(UsageLog.id))
            .filter(
                UsageLog.action_type == ActionType.EXPORT,
                UsageLog.created_at >= start_of_day,
                UsageLog.created_at < end_of_day,
            )
            .scalar()
            or 0
        )

        # Processing time
        total_processing_time = (
            db.query(func.sum(UsageLog.processing_time_seconds))
            .filter(
                UsageLog.action_type == ActionType.PROCESS,
                UsageLog.created_at >= start_of_day,
                UsageLog.created_at < end_of_day,
            )
            .scalar()
            or 0
        )

        # Detection accuracy
        accuracy_data = (
            db.query(
                func.count(DetectionAccuracyLog.id).label("total"),
                func.count(DetectionAccuracyLog.id)
                .filter(DetectionAccuracyLog.is_correct.is_(True))
                .label("correct"),
            )
            .filter(
                DetectionAccuracyLog.detected_at >= start_of_day,
                DetectionAccuracyLog.detected_at < end_of_day,
            )
            .first()
        )

        avg_detection_accuracy = 0
        if accuracy_data.total and accuracy_data.total > 0:
            avg_detection_accuracy = (accuracy_data.correct / accuracy_data.total) * 100

        # Average processing time per photo
        avg_processing_time = 0
        if total_photos > 0 and total_processing_time > 0:
            avg_processing_time = total_processing_time / total_photos

        # Create business metric record
        business_metric = BusinessMetric(
            date=target_date,
            period_type="daily",
            total_users=total_users,
            active_users=active_users,
            new_users=new_users,
            total_photos_processed=total_photos,
            total_processing_time_hours=total_processing_time / 3600,
            total_exports=total_exports,
            average_detection_accuracy=avg_detection_accuracy,
            average_processing_time_per_photo=avg_processing_time,
        )

        db.add(business_metric)
        db.commit()
        db.refresh(business_metric)

        logger.info(
            f"Calculated daily metrics for {target_date.date()}: {new_users} new users, {total_photos} photos processed"
        )

        return business_metric

    async def calculate_user_retention_cohorts(self, db: Session):
        """Calculate user retention cohorts for business analysis."""

        # Get all users grouped by registration month
        cohort_query = (
            db.query(
                func.date_trunc("month", User.created_at).label("cohort_month"),
                func.count(User.id).label("user_count"),
            )
            .group_by(func.date_trunc("month", User.created_at))
            .order_by("cohort_month")
            .all()
        )

        for cohort in cohort_query:
            cohort_month_str = cohort.cohort_month.strftime("%Y-%m")

            # Check if cohort already exists
            existing_cohort = (
                db.query(UserRetentionCohort)
                .filter(UserRetentionCohort.cohort_month == cohort_month_str)
                .first()
            )

            if (
                existing_cohort
                and (datetime.utcnow() - existing_cohort.last_updated).days < 1
            ):
                continue  # Skip if updated recently

            # Calculate retention percentages
            cohort_users = (
                db.query(User)
                .filter(
                    func.date_trunc("month", User.created_at) == cohort.cohort_month
                )
                .all()
            )

            user_ids = [user.id for user in cohort_users]

            # Calculate retention for each month offset
            retention_data = {}
            for month_offset in [1, 2, 3, 6, 12]:
                target_month = cohort.cohort_month + timedelta(days=30 * month_offset)
                start_of_month = target_month.replace(day=1)
                end_of_month = (start_of_month + timedelta(days=32)).replace(
                    day=1
                ) - timedelta(days=1)

                active_users = (
                    db.query(func.count(func.distinct(UsageLog.user_id)))
                    .filter(
                        UsageLog.user_id.in_(user_ids),
                        UsageLog.created_at >= start_of_month,
                        UsageLog.created_at <= end_of_month,
                    )
                    .scalar()
                    or 0
                )

                retention_percentage = (
                    (active_users / cohort.user_count * 100)
                    if cohort.user_count > 0
                    else 0
                )
                retention_data[f"month_{month_offset}"] = retention_percentage

            # Calculate average metrics for cohort
            avg_photos = (
                db.query(func.avg(User.total_photos_uploaded))
                .filter(User.id.in_(user_ids))
                .scalar()
                or 0
            )

            avg_jobs = (
                db.query(func.avg(func.count(ProcessingJobDB.id)))
                .filter(ProcessingJobDB.user_id.in_(user_ids))
                .scalar()
                or 0
            )

            # Create or update cohort record
            if existing_cohort:
                existing_cohort.user_count = cohort.user_count
                existing_cohort.month_1 = retention_data.get("month_1")
                existing_cohort.month_2 = retention_data.get("month_2")
                existing_cohort.month_3 = retention_data.get("month_3")
                existing_cohort.month_6 = retention_data.get("month_6")
                existing_cohort.month_12 = retention_data.get("month_12")
                existing_cohort.avg_photos_uploaded = avg_photos
                existing_cohort.avg_processing_jobs = avg_jobs
                existing_cohort.last_updated = datetime.utcnow()
            else:
                cohort_record = UserRetentionCohort(
                    cohort_month=cohort_month_str,
                    user_count=cohort.user_count,
                    month_1=retention_data.get("month_1"),
                    month_2=retention_data.get("month_2"),
                    month_3=retention_data.get("month_3"),
                    month_6=retention_data.get("month_6"),
                    month_12=retention_data.get("month_12"),
                    avg_photos_uploaded=avg_photos,
                    avg_processing_jobs=avg_jobs,
                )
                db.add(cohort_record)

        db.commit()
        logger.info("Updated user retention cohort analysis")

    # Alert system

    async def check_alert_rules(self, db: Session, metric: SystemMetric):
        """Check if any alert rules are triggered by this metric."""

        # Get active alert rules for this metric type
        rules = (
            db.query(AlertRule)
            .filter(
                AlertRule.metric_type == metric.metric_type, AlertRule.is_active == True
            )
            .all()
        )

        for rule in rules:
            # Check cooldown period
            if rule.last_triggered:
                cooldown_end = rule.last_triggered + timedelta(
                    minutes=rule.cooldown_minutes
                )
                if datetime.utcnow() < cooldown_end:
                    continue  # Still in cooldown

            # Evaluate threshold
            triggered = False
            if rule.comparison_operator == ">":
                triggered = metric.value > rule.threshold_value
            elif rule.comparison_operator == "<":
                triggered = metric.value < rule.threshold_value
            elif rule.comparison_operator == ">=":
                triggered = metric.value >= rule.threshold_value
            elif rule.comparison_operator == "<=":
                triggered = metric.value <= rule.threshold_value
            elif rule.comparison_operator == "==":
                triggered = metric.value == rule.threshold_value

            if triggered:
                await self.fire_alert(db, rule, metric)

    async def fire_alert(self, db: Session, rule: AlertRule, metric: SystemMetric):
        """Fire an alert and send notifications."""

        # Create alert history record
        alert = AlertHistory(
            rule_id=rule.id,
            metric_value=metric.value,
            alert_level=rule.alert_level,
            context_data=metric.metric_metadata,
        )

        db.add(alert)

        # Update rule
        rule.last_triggered = datetime.utcnow()
        rule.trigger_count += 1

        db.commit()

        # Send notifications
        await self.send_alert_notifications(rule, alert, metric)

        logger.warning(
            f"Alert fired: {rule.rule_name} - {metric.metric_name} = {metric.value}"
        )

    async def send_alert_notifications(
        self, rule: AlertRule, alert: AlertHistory, metric: SystemMetric
    ):
        """Send alert notifications via configured channels."""

        alert_message = f"""
        🚨 ALERT: {rule.rule_name}
        
        Metric: {metric.metric_name}
        Value: {metric.value} {metric.unit or ''}
        Threshold: {rule.comparison_operator} {rule.threshold_value}
        Level: {rule.alert_level.value.upper()}
        Time: {metric.timestamp.isoformat()}
        
        Endpoint: {metric.endpoint or 'N/A'}
        """

        # Email notification
        if rule.email_enabled:
            try:
                # Implementation would integrate with email service
                logger.info(f"Email alert sent for rule: {rule.rule_name}")
                alert.email_sent = True
            except Exception as e:
                logger.error(f"Failed to send email alert: {e}")

        # Slack notification
        if rule.slack_enabled:
            try:
                # Implementation would integrate with Slack webhook
                logger.info(f"Slack alert sent for rule: {rule.rule_name}")
                alert.slack_sent = True
            except Exception as e:
                logger.error(f"Failed to send Slack alert: {e}")

        # Webhook notification
        if rule.webhook_url:
            try:
                # Implementation would send HTTP POST to webhook
                logger.info(f"Webhook alert sent for rule: {rule.rule_name}")
                alert.webhook_sent = True
            except Exception as e:
                logger.error(f"Failed to send webhook alert: {e}")

    # Performance analysis

    def calculate_detection_performance_trends(
        self, db: Session, days: int = 30
    ) -> Dict[str, Any]:
        """Calculate detection performance trends over time."""

        since_date = datetime.utcnow() - timedelta(days=days)

        # Daily accuracy trends
        daily_accuracy = (
            db.query(
                func.date(DetectionAccuracyLog.detected_at).label("date"),
                func.count(DetectionAccuracyLog.id).label("total"),
                func.count(DetectionAccuracyLog.id)
                .filter(DetectionAccuracyLog.is_correct.is_(True))
                .label("correct"),
                func.avg(DetectionAccuracyLog.processing_time_ms).label("avg_time"),
            )
            .filter(DetectionAccuracyLog.detected_at >= since_date)
            .group_by(func.date(DetectionAccuracyLog.detected_at))
            .all()
        )

        # Method performance comparison
        method_performance = (
            db.query(
                DetectionAccuracyLog.detection_method,
                func.count(DetectionAccuracyLog.id).label("total"),
                func.count(DetectionAccuracyLog.id)
                .filter(DetectionAccuracyLog.is_correct.is_(True))
                .label("correct"),
                func.avg(DetectionAccuracyLog.processing_time_ms).label("avg_time"),
                func.avg(DetectionAccuracyLog.google_vision_confidence).label(
                    "avg_confidence"
                ),
            )
            .filter(DetectionAccuracyLog.detected_at >= since_date)
            .group_by(DetectionAccuracyLog.detection_method)
            .all()
        )

        # Confidence distribution analysis
        confidence_ranges = [
            (0.0, 0.5, "Low"),
            (0.5, 0.8, "Medium"),
            (0.8, 1.0, "High"),
        ]

        confidence_distribution = {}
        for min_conf, max_conf, label in confidence_ranges:
            count = (
                db.query(DetectionAccuracyLog)
                .filter(
                    DetectionAccuracyLog.detected_at >= since_date,
                    DetectionAccuracyLog.google_vision_confidence >= min_conf,
                    DetectionAccuracyLog.google_vision_confidence < max_conf,
                )
                .count()
            )
            confidence_distribution[label] = count

        return {
            "daily_trends": [
                {
                    "date": trend.date.isoformat(),
                    "total_detections": trend.total,
                    "accuracy_percentage": (
                        round((trend.correct / trend.total) * 100, 2)
                        if trend.total > 0
                        else 0
                    ),
                    "avg_processing_time_ms": round(trend.avg_time or 0, 2),
                }
                for trend in daily_accuracy
            ],
            "method_performance": [
                {
                    "method": method.detection_method,
                    "total_detections": method.total,
                    "accuracy_percentage": (
                        round((method.correct / method.total) * 100, 2)
                        if method.total > 0
                        else 0
                    ),
                    "avg_processing_time_ms": round(method.avg_time or 0, 2),
                    "avg_confidence": round(method.avg_confidence or 0, 2),
                }
                for method in method_performance
            ],
            "confidence_distribution": confidence_distribution,
        }

    def calculate_user_engagement_insights(
        self, db: Session, user_id: Optional[int] = None, days: int = 30
    ) -> Dict[str, Any]:
        """Calculate user engagement insights and patterns."""

        since_date = datetime.utcnow() - timedelta(days=days)

        query = db.query(UserEngagement).filter(UserEngagement.timestamp >= since_date)
        if user_id:
            query = query.filter(UserEngagement.user_id == user_id)

        engagement_events = query.all()

        if not engagement_events:
            return {"message": "No engagement data found", "insights": {}}

        # Event frequency analysis
        event_frequency = {}
        page_views = {}
        hourly_activity = {hour: 0 for hour in range(24)}

        for event in engagement_events:
            # Event type frequency
            event_type = event.event_type.value
            event_frequency[event_type] = event_frequency.get(event_type, 0) + 1

            # Page popularity
            if event.page_path:
                page_views[event.page_path] = page_views.get(event.page_path, 0) + 1

            # Hourly activity pattern
            hour = event.timestamp.hour
            hourly_activity[hour] += 1

        # Session analysis
        unique_sessions = len(set(event.session_id for event in engagement_events))
        avg_session_duration = (
            db.query(func.avg(UserEngagement.session_duration_seconds))
            .filter(UserEngagement.timestamp >= since_date)
            .scalar()
            or 0
        )

        # Find peak activity hours
        peak_hour = max(hourly_activity.items(), key=lambda x: x[1])

        return {
            "overview": {
                "total_events": len(engagement_events),
                "unique_sessions": unique_sessions,
                "avg_session_duration_minutes": round(avg_session_duration / 60, 2),
                "peak_activity_hour": peak_hour[0],
                "peak_activity_count": peak_hour[1],
            },
            "event_frequency": event_frequency,
            "popular_pages": dict(
                sorted(page_views.items(), key=lambda x: x[1], reverse=True)[:10]
            ),
            "hourly_activity": hourly_activity,
        }

    # Predictive analytics

    def predict_user_churn_risk(self, db: Session, user_id: int) -> Dict[str, Any]:
        """Predict user churn risk based on engagement patterns."""

        # Get user's recent activity
        recent_activity = (
            db.query(UsageLog)
            .filter(
                UsageLog.user_id == user_id,
                UsageLog.created_at >= datetime.utcnow() - timedelta(days=30),
            )
            .count()
        )

        # Get user's session patterns
        recent_sessions = (
            db.query(UserEngagement)
            .filter(
                UserEngagement.user_id == user_id,
                UserEngagement.timestamp >= datetime.utcnow() - timedelta(days=30),
            )
            .count()
        )

        # Simple churn risk calculation (can be enhanced with ML)
        risk_factors = []
        risk_score = 0

        # Factor 1: Low recent activity
        if recent_activity < 5:
            risk_factors.append("Low recent activity")
            risk_score += 30

        # Factor 2: No recent sessions
        if recent_sessions == 0:
            risk_factors.append("No recent engagement")
            risk_score += 40

        # Factor 3: No recent uploads
        recent_uploads = (
            db.query(UsageLog)
            .filter(
                UsageLog.user_id == user_id,
                UsageLog.action_type == ActionType.UPLOAD,
                UsageLog.created_at >= datetime.utcnow() - timedelta(days=14),
            )
            .count()
        )

        if recent_uploads == 0:
            risk_factors.append("No recent uploads")
            risk_score += 20

        # Determine risk level
        if risk_score >= 70:
            risk_level = "HIGH"
        elif risk_score >= 40:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"

        return {
            "user_id": user_id,
            "risk_score": min(risk_score, 100),
            "risk_level": risk_level,
            "risk_factors": risk_factors,
            "recent_activity_count": recent_activity,
            "recent_sessions_count": recent_sessions,
            "recommendation": self.get_retention_recommendation(
                risk_level, risk_factors
            ),
        }

    def get_retention_recommendation(
        self, risk_level: str, risk_factors: List[str]
    ) -> str:
        """Get personalized retention recommendations."""

        if risk_level == "HIGH":
            return "Send re-engagement email with tutorial or special offer"
        elif risk_level == "MEDIUM":
            if "No recent uploads" in risk_factors:
                return "Send tips for better photo organization workflow"
            else:
                return "Send newsletter with new features and use cases"
        else:
            return "User is actively engaged - send feature updates"

    # Data export and reporting

    async def generate_executive_report(
        self, db: Session, start_date: datetime, end_date: datetime
    ) -> Dict[str, Any]:
        """Generate comprehensive executive report."""

        # High-level KPIs
        total_users = db.query(User).filter(User.created_at <= end_date).count()
        new_users = (
            db.query(User)
            .filter(User.created_at >= start_date, User.created_at <= end_date)
            .count()
        )

        # User activity
        active_users = (
            db.query(func.count(func.distinct(UsageLog.user_id)))
            .filter(UsageLog.created_at >= start_date, UsageLog.created_at <= end_date)
            .scalar()
            or 0
        )

        # Processing metrics
        total_photos = (
            db.query(func.sum(ProcessingJobDB.total_photos))
            .filter(
                ProcessingJobDB.created_at >= start_date,
                ProcessingJobDB.created_at <= end_date,
            )
            .scalar()
            or 0
        )

        completed_jobs = (
            db.query(ProcessingJobDB)
            .filter(
                ProcessingJobDB.created_at >= start_date,
                ProcessingJobDB.created_at <= end_date,
                ProcessingJobDB.status == "completed",
            )
            .count()
        )

        total_jobs = (
            db.query(ProcessingJobDB)
            .filter(
                ProcessingJobDB.created_at >= start_date,
                ProcessingJobDB.created_at <= end_date,
            )
            .count()
        )

        # Calculate key ratios
        user_growth_rate = 0
        if total_users > new_users:
            user_growth_rate = (new_users / (total_users - new_users)) * 100

        job_success_rate = (
            (completed_jobs / total_jobs * 100) if total_jobs > 0 else 100
        )
        user_activation_rate = (
            (active_users / total_users * 100) if total_users > 0 else 0
        )

        period_days = (end_date - start_date).days

        return {
            "report_period": {
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "days": period_days,
            },
            "executive_summary": {
                "total_users": total_users,
                "new_users": new_users,
                "user_growth_rate_percent": round(user_growth_rate, 2),
                "active_users": active_users,
                "user_activation_rate_percent": round(user_activation_rate, 2),
                "total_photos_processed": total_photos,
                "photos_per_day": round(
                    total_photos / period_days if period_days > 0 else 0, 2
                ),
                "job_success_rate_percent": round(job_success_rate, 2),
            },
            "key_insights": self.generate_key_insights(db, start_date, end_date),
            "recommendations": self.generate_recommendations(db, start_date, end_date),
        }

    def generate_key_insights(
        self, db: Session, start_date: datetime, end_date: datetime
    ) -> List[str]:
        """Generate key business insights from the data."""

        insights = []

        # User growth insight
        new_users = (
            db.query(User)
            .filter(User.created_at >= start_date, User.created_at <= end_date)
            .count()
        )

        if new_users > 100:
            insights.append(f"Strong user growth with {new_users} new registrations")
        elif new_users < 10:
            insights.append(
                "User acquisition needs attention - consider marketing initiatives"
            )

        # Processing volume insight
        total_photos = (
            db.query(func.sum(ProcessingJobDB.total_photos))
            .filter(
                ProcessingJobDB.created_at >= start_date,
                ProcessingJobDB.created_at <= end_date,
            )
            .scalar()
            or 0
        )

        if total_photos > 10000:
            insights.append(
                f"High processing volume: {total_photos:,} photos processed"
            )

        # Peak usage insight
        peak_day = (
            db.query(
                func.date(UsageLog.created_at).label("date"),
                func.count(UsageLog.id).label("activity_count"),
            )
            .filter(UsageLog.created_at >= start_date, UsageLog.created_at <= end_date)
            .group_by(func.date(UsageLog.created_at))
            .order_by(desc("activity_count"))
            .first()
        )

        if peak_day:
            insights.append(
                f"Peak usage day: {peak_day.date.strftime('%Y-%m-%d')} with {peak_day.activity_count} activities"
            )

        return insights

    def generate_recommendations(
        self, db: Session, start_date: datetime, end_date: datetime
    ) -> List[str]:
        """Generate actionable business recommendations."""

        recommendations = []

        # Analyze user retention
        low_activity_users = (
            db.query(User)
            .filter(
                User.created_at < datetime.utcnow() - timedelta(days=7),
                User.last_login < datetime.utcnow() - timedelta(days=14),
            )
            .count()
        )

        if low_activity_users > 10:
            recommendations.append(
                f"Re-engage {low_activity_users} inactive users with email campaign"
            )

        # Analyze processing failures
        failed_jobs = (
            db.query(ProcessingJobDB)
            .filter(
                ProcessingJobDB.created_at >= start_date,
                ProcessingJobDB.status == "failed",
            )
            .count()
        )

        total_jobs = (
            db.query(ProcessingJobDB)
            .filter(ProcessingJobDB.created_at >= start_date)
            .count()
        )

        if total_jobs > 0 and (failed_jobs / total_jobs) > 0.1:
            recommendations.append(
                "High job failure rate - investigate processing pipeline"
            )

        # Analyze storage growth
        total_storage_mb = db.query(func.sum(PhotoDB.file_size_bytes)).scalar() or 0
        storage_gb = total_storage_mb / (1024**3)

        if storage_gb > 100:  # 100 GB threshold
            recommendations.append(
                "Consider implementing storage optimization or archival policy"
            )

        return recommendations


# Global analytics service instance
analytics_service = AnalyticsService()
