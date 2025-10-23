"""
Advanced analytics and business intelligence database models.
"""

from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict

from sqlalchemy import JSON, Boolean, Column, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class EventType(str, Enum):
    """Event types for user engagement tracking."""

    PAGE_VIEW = "page_view"
    CLICK = "click"
    SCROLL = "scroll"
    FORM_SUBMIT = "form_submit"
    FILE_DROP = "file_drop"
    MODAL_OPEN = "modal_open"
    MODAL_CLOSE = "modal_close"
    FEATURE_DISCOVERY = "feature_discovery"
    ERROR_ENCOUNTERED = "error_encountered"
    SUCCESS_ACTION = "success_action"


class ConversionStep(str, Enum):
    """Steps in the user conversion funnel."""

    LANDING_VIEW = "landing_view"
    SIGNUP_STARTED = "signup_started"
    ACCOUNT_CREATED = "account_created"
    FIRST_LOGIN = "first_login"
    FIRST_UPLOAD = "first_upload"
    FIRST_PROCESS = "first_process"
    FIRST_EXPORT = "first_export"
    REPEAT_USER = "repeat_user"


class SystemMetricType(str, Enum):
    """Types of system performance metrics."""

    API_RESPONSE_TIME = "api_response_time"
    PROCESSING_QUEUE_SIZE = "processing_queue_size"
    ACTIVE_SESSIONS = "active_sessions"
    MEMORY_USAGE = "memory_usage"
    CPU_USAGE = "cpu_usage"
    DISK_USAGE = "disk_usage"
    ERROR_RATE = "error_rate"
    DETECTION_ACCURACY = "detection_accuracy"


class AlertLevel(str, Enum):
    """Alert severity levels."""

    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class UserEngagement(Base):
    """
    Track detailed user engagement and behavior patterns.
    """

    __tablename__ = "user_engagement"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    session_id = Column(String(36), nullable=False, index=True)  # Browser session

    # Event details
    event_type = Column(SQLEnum(EventType), nullable=False, index=True)
    page_path = Column(String(200), nullable=True)
    element_id = Column(String(100), nullable=True)
    element_class = Column(String(100), nullable=True)

    # Interaction details
    click_x = Column(Integer, nullable=True)
    click_y = Column(Integer, nullable=True)
    viewport_width = Column(Integer, nullable=True)
    viewport_height = Column(Integer, nullable=True)

    # Timing data
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    session_duration_seconds = Column(Float, nullable=True)
    time_on_page_seconds = Column(Float, nullable=True)

    # Additional metadata
    user_agent = Column(Text, nullable=True)
    referrer = Column(String(500), nullable=True)
    custom_data = Column(JSON, nullable=True)

    # Relationships
    user = relationship("User")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "session_id": self.session_id,
            "event_type": self.event_type.value,
            "page_path": self.page_path,
            "element_id": self.element_id,
            "timestamp": self.timestamp.isoformat(),
            "session_duration_seconds": self.session_duration_seconds,
            "custom_data": self.custom_data,
        }


class ConversionFunnel(Base):
    """
    Track user progression through conversion steps.
    """

    __tablename__ = "conversion_funnel"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Conversion tracking
    step = Column(SQLEnum(ConversionStep), nullable=False, index=True)
    completed_at = Column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    # Context data
    source = Column(String(100), nullable=True)  # marketing source
    medium = Column(String(100), nullable=True)  # marketing medium
    campaign = Column(String(100), nullable=True)  # marketing campaign

    # Session info
    session_id = Column(String(36), nullable=True)
    time_to_convert_seconds = Column(Float, nullable=True)  # Time from previous step

    # Metadata
    additional_data = Column(JSON, nullable=True)

    # Relationships
    user = relationship("User")


class SystemMetric(Base):
    """
    Track system performance and health metrics.
    """

    __tablename__ = "system_metrics"

    id = Column(Integer, primary_key=True, index=True)

    # Metric identification
    metric_type = Column(SQLEnum(SystemMetricType), nullable=False, index=True)
    metric_name = Column(String(100), nullable=False, index=True)

    # Metric data
    value = Column(Float, nullable=False)
    unit = Column(String(20), nullable=True)  # seconds, bytes, percentage, count

    # Context
    endpoint = Column(String(100), nullable=True)  # For API metrics
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    job_id = Column(String(36), nullable=True)

    # Timing
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Additional context
    metric_metadata = Column(JSON, nullable=True)

    # Relationships
    user = relationship("User")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "metric_type": self.metric_type.value,
            "metric_name": self.metric_name,
            "value": self.value,
            "unit": self.unit,
            "timestamp": self.timestamp.isoformat(),
            "endpoint": self.endpoint,
            "metadata": self.metric_metadata,
        }


class BusinessMetric(Base):
    """
    Track business KPIs and revenue metrics.
    """

    __tablename__ = "business_metrics"

    id = Column(Integer, primary_key=True, index=True)

    # Time period
    date = Column(DateTime(timezone=True), nullable=False, index=True)
    period_type = Column(
        String(20), nullable=False, index=True
    )  # daily, weekly, monthly

    # User metrics
    total_users = Column(Integer, default=0)
    active_users = Column(Integer, default=0)
    new_users = Column(Integer, default=0)
    churned_users = Column(Integer, default=0)

    # Usage metrics
    total_photos_processed = Column(Integer, default=0)
    total_processing_time_hours = Column(Float, default=0.0)
    total_exports = Column(Integer, default=0)
    total_storage_gb = Column(Float, default=0.0)

    # Performance metrics
    average_detection_accuracy = Column(Float, default=0.0)
    average_processing_time_per_photo = Column(Float, default=0.0)
    system_uptime_percentage = Column(Float, default=100.0)

    # Business metrics (for future premium features)
    revenue_usd = Column(Float, default=0.0)
    subscription_count = Column(Integer, default=0)
    trial_conversions = Column(Integer, default=0)

    # Additional data
    business_metadata = Column(JSON, nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "date": self.date.isoformat(),
            "period_type": self.period_type,
            "total_users": self.total_users,
            "active_users": self.active_users,
            "new_users": self.new_users,
            "total_photos_processed": self.total_photos_processed,
            "average_detection_accuracy": self.average_detection_accuracy,
            "revenue_usd": self.revenue_usd,
        }


class PerformanceBenchmark(Base):
    """
    Track detection accuracy and performance benchmarks.
    """

    __tablename__ = "performance_benchmarks"

    id = Column(Integer, primary_key=True, index=True)

    # Benchmark identification
    benchmark_name = Column(String(100), nullable=False, index=True)
    model_version = Column(String(50), nullable=True)
    test_date = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Performance metrics
    total_test_photos = Column(Integer, nullable=False)
    correct_detections = Column(Integer, nullable=False)
    false_positives = Column(Integer, default=0)
    false_negatives = Column(Integer, default=0)
    accuracy_percentage = Column(Float, nullable=False)

    # Speed metrics
    average_processing_time_ms = Column(Float, nullable=True)
    google_vision_success_rate = Column(Float, nullable=True)
    tesseract_fallback_rate = Column(Float, nullable=True)

    # Test configuration
    test_image_types = Column(JSON, nullable=True)  # image formats tested
    test_conditions = Column(JSON, nullable=True)  # lighting, angles, etc.

    # Results breakdown
    detection_confidence_distribution = Column(JSON, nullable=True)
    error_analysis = Column(JSON, nullable=True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "benchmark_name": self.benchmark_name,
            "test_date": self.test_date.isoformat(),
            "accuracy_percentage": self.accuracy_percentage,
            "total_test_photos": self.total_test_photos,
            "average_processing_time_ms": self.average_processing_time_ms,
            "google_vision_success_rate": self.google_vision_success_rate,
            "tesseract_fallback_rate": self.tesseract_fallback_rate,
        }


class AlertRule(Base):
    """
    Define alerting rules for system monitoring.
    """

    __tablename__ = "alert_rules"

    id = Column(Integer, primary_key=True, index=True)

    # Rule definition
    rule_name = Column(String(100), nullable=False, unique=True)
    metric_type = Column(SQLEnum(SystemMetricType), nullable=False)
    threshold_value = Column(Float, nullable=False)
    comparison_operator = Column(String(10), nullable=False)  # >, <, >=, <=, ==

    # Alert configuration
    alert_level = Column(SQLEnum(AlertLevel), nullable=False)
    cooldown_minutes = Column(Integer, default=30)  # Prevent spam alerts
    is_active = Column(Boolean, default=True)

    # Notification settings
    email_enabled = Column(Boolean, default=True)
    slack_enabled = Column(Boolean, default=False)
    webhook_url = Column(String(500), nullable=True)

    # Metadata
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_triggered = Column(DateTime(timezone=True), nullable=True)
    trigger_count = Column(Integer, default=0)


class AlertHistory(Base):
    """
    Track fired alerts for analysis and debugging.
    """

    __tablename__ = "alert_history"

    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer, ForeignKey("alert_rules.id"), nullable=False, index=True)

    # Alert details
    triggered_at = Column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    metric_value = Column(Float, nullable=False)
    alert_level = Column(SQLEnum(AlertLevel), nullable=False)

    # Resolution
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    resolution_notes = Column(Text, nullable=True)

    # Notification tracking
    email_sent = Column(Boolean, default=False)
    slack_sent = Column(Boolean, default=False)
    webhook_sent = Column(Boolean, default=False)

    # Context data
    context_data = Column(JSON, nullable=True)

    # Relationships
    rule = relationship("AlertRule")
    resolver = relationship("User")


class UserSessionAnalytics(Base):
    """
    Enhanced user session tracking for analytics.
    """

    __tablename__ = "user_sessions_analytics"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    session_id = Column(String(36), unique=True, nullable=False, index=True)

    # Session timing
    started_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    last_activity_at = Column(DateTime(timezone=True), server_default=func.now())
    duration_seconds = Column(Float, nullable=True)

    # Session context
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)
    referrer = Column(String(500), nullable=True)
    utm_source = Column(String(100), nullable=True)
    utm_medium = Column(String(100), nullable=True)
    utm_campaign = Column(String(100), nullable=True)

    # Device information
    device_type = Column(String(20), nullable=True)  # desktop, mobile, tablet
    browser = Column(String(50), nullable=True)
    operating_system = Column(String(50), nullable=True)
    screen_resolution = Column(String(20), nullable=True)

    # Activity metrics
    page_views = Column(Integer, default=0)
    clicks = Column(Integer, default=0)
    photos_uploaded = Column(Integer, default=0)
    jobs_created = Column(Integer, default=0)
    exports_downloaded = Column(Integer, default=0)

    # Engagement quality
    bounce_session = Column(Boolean, default=False)  # Single page view < 30s
    converted = Column(Boolean, default=False)  # Completed meaningful action

    # Relationships
    user = relationship("User")

    def end_session(self):
        """Mark session as ended and calculate duration."""
        self.ended_at = datetime.utcnow()
        if self.started_at:
            self.duration_seconds = (self.ended_at - self.started_at).total_seconds()
            # Mark as bounce if duration < 30 seconds and minimal activity
            self.bounce_session = (
                self.duration_seconds < 30 and self.page_views <= 1 and self.clicks <= 1
            )

    def update_activity(self):
        """Update last activity timestamp."""
        self.last_activity_at = datetime.utcnow()

    def is_active(self, timeout_minutes: int = 30) -> bool:
        """Check if session is still active based on last activity."""
        if not self.last_activity_at:
            return False
        timeout = datetime.utcnow() - timedelta(minutes=timeout_minutes)
        return self.last_activity_at > timeout


class ABTestExperiment(Base):
    """
    A/B testing experiments for feature optimization.
    """

    __tablename__ = "ab_test_experiments"

    id = Column(Integer, primary_key=True, index=True)

    # Experiment definition
    experiment_name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    feature_flag = Column(String(100), nullable=False)

    # Experiment lifecycle
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=False)

    # Experiment configuration
    traffic_percentage = Column(Float, default=50.0)  # % of users in experiment
    variants = Column(JSON, nullable=False)  # List of variant configurations
    success_metric = Column(String(100), nullable=False)  # What defines success

    # Results
    total_participants = Column(Integer, default=0)
    control_conversions = Column(Integer, default=0)
    treatment_conversions = Column(Integer, default=0)
    statistical_significance = Column(Float, nullable=True)

    # Metadata
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    results_summary = Column(JSON, nullable=True)


class ABTestParticipant(Base):
    """
    Track individual user participation in A/B tests.
    """

    __tablename__ = "ab_test_participants"

    id = Column(Integer, primary_key=True, index=True)
    experiment_id = Column(
        Integer, ForeignKey("ab_test_experiments.id"), nullable=False, index=True
    )
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Assignment
    variant = Column(
        String(50), nullable=False
    )  # control, treatment_a, treatment_b, etc.
    assigned_at = Column(DateTime(timezone=True), server_default=func.now())

    # Conversion tracking
    converted = Column(Boolean, default=False)
    converted_at = Column(DateTime(timezone=True), nullable=True)
    conversion_value = Column(Float, nullable=True)

    # Session context
    session_id = Column(String(36), nullable=True)

    # Relationships
    experiment = relationship("ABTestExperiment")
    user = relationship("User")


class DetectionAccuracyLog(Base):
    """
    Track ML model accuracy and performance over time.
    """

    __tablename__ = "detection_accuracy_logs"

    id = Column(Integer, primary_key=True, index=True)

    # Detection context
    photo_id = Column(String(36), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    processing_job_id = Column(String(36), nullable=True)

    # Detection results
    google_vision_result = Column(String(20), nullable=True)
    google_vision_confidence = Column(Float, nullable=True)
    tesseract_result = Column(String(20), nullable=True)
    tesseract_confidence = Column(Float, nullable=True)
    final_result = Column(String(20), nullable=True)
    detection_method = Column(
        String(30), nullable=False
    )  # google_vision, tesseract, manual

    # Ground truth (for accuracy calculation)
    manual_label = Column(String(20), nullable=True)  # Human-verified correct answer
    is_correct = Column(Boolean, nullable=True)  # True if detection matches manual

    # Performance metrics
    processing_time_ms = Column(Float, nullable=False)
    image_dimensions = Column(String(20), nullable=True)  # "1920x1080"
    file_size_bytes = Column(Integer, nullable=True)

    # Quality metrics
    image_quality_score = Column(Float, nullable=True)  # Blur, exposure, etc.
    bib_visibility_score = Column(Float, nullable=True)  # How visible is the bib

    # Timestamp
    detected_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    # Additional context
    detection_metadata = Column(JSON, nullable=True)

    # Relationships
    user = relationship("User")

    def set_ground_truth(self, correct_label: str):
        """Set the ground truth and calculate accuracy."""
        self.manual_label = correct_label
        self.is_correct = (
            (self.final_result == correct_label) if self.final_result else False
        )


class RevenueEvent(Base):
    """
    Track revenue events for business intelligence.
    """

    __tablename__ = "revenue_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Event details
    event_type = Column(
        String(50), nullable=False, index=True
    )  # subscription, upgrade, usage_fee
    amount_usd = Column(Float, nullable=False)
    currency = Column(String(3), default="USD")

    # Transaction details
    transaction_id = Column(String(100), nullable=True, unique=True)
    payment_method = Column(String(50), nullable=True)
    status = Column(
        String(20), nullable=False, index=True
    )  # pending, completed, failed, refunded

    # Subscription context
    subscription_tier = Column(String(50), nullable=True)
    billing_period = Column(String(20), nullable=True)  # monthly, yearly

    # Timing
    event_date = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    period_start = Column(DateTime(timezone=True), nullable=True)
    period_end = Column(DateTime(timezone=True), nullable=True)

    # Additional context
    revenue_metadata = Column(JSON, nullable=True)

    # Relationships
    user = relationship("User")


class UserRetentionCohort(Base):
    """
    Track user retention by cohorts for business intelligence.
    """

    __tablename__ = "user_retention_cohorts"

    id = Column(Integer, primary_key=True, index=True)

    # Cohort definition
    cohort_month = Column(String(7), nullable=False, index=True)  # "2024-01"
    user_count = Column(Integer, nullable=False)

    # Retention data (percentage retained each month)
    month_0 = Column(Float, default=100.0)  # Always 100% in first month
    month_1 = Column(Float, nullable=True)
    month_2 = Column(Float, nullable=True)
    month_3 = Column(Float, nullable=True)
    month_6 = Column(Float, nullable=True)
    month_12 = Column(Float, nullable=True)

    # Additional metrics
    avg_photos_uploaded = Column(Float, nullable=True)
    avg_processing_jobs = Column(Float, nullable=True)
    avg_revenue_per_user = Column(Float, nullable=True)

    # Metadata
    last_updated = Column(DateTime(timezone=True), server_default=func.now())
    cohort_metadata = Column(JSON, nullable=True)

    def update_retention(self, month_offset: int, retention_percentage: float):
        """Update retention for a specific month offset."""
        if month_offset == 1:
            self.month_1 = retention_percentage
        elif month_offset == 2:
            self.month_2 = retention_percentage
        elif month_offset == 3:
            self.month_3 = retention_percentage
        elif month_offset == 6:
            self.month_6 = retention_percentage
        elif month_offset == 12:
            self.month_12 = retention_percentage

        self.last_updated = datetime.utcnow()
