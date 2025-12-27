import enum
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class ActionType(enum.Enum):
    """
    Enum for different types of user actions to track.
    """

    UPLOAD = "upload"
    PROCESS = "process"
    EXPORT = "export"
    LOGIN = "login"
    LOGOUT = "logout"
    REGISTER = "register"
    VIEW_PHOTOS = "view_photos"
    DELETE_PHOTOS = "delete_photos"
    MANUAL_LABEL = "manual_label"


class UsageLog(Base):
    """
    Log of user actions for analytics and usage tracking.
    """

    __tablename__ = "usage_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)  # Foreign key to users.id
    action_type = Column(Enum(ActionType), nullable=False, index=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Photo-related metrics
    photo_count = Column(Integer, default=0, nullable=False)
    processing_time_seconds = Column(Float, nullable=True)  # Time taken for processing
    file_size_mb = Column(Float, nullable=True)  # Total size of files involved

    # Additional metadata
    details = Column(Text, nullable=True)  # JSON string for additional details
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)

    # Success/failure tracking
    success = Column(Boolean, default=True, nullable=False)
    error_message = Column(Text, nullable=True)

    def to_dict(self) -> dict:
        """
        Convert usage log to dictionary for API responses.
        """
        return {
            "id": self.id,
            "user_id": self.user_id,
            "action_type": self.action_type.value if self.action_type else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "photo_count": self.photo_count,
            "processing_time_seconds": self.processing_time_seconds,
            "file_size_mb": self.file_size_mb,
            "details": self.details,
            "success": self.success,
            "error_message": self.error_message,
        }

    def __repr__(self) -> str:
        return f"<UsageLog(id={self.id}, user_id={self.user_id}, action={self.action_type}, success={self.success})>"


class ProcessingJob(Base):
    """
    Track photo processing jobs for detailed analytics and job management.
    """

    __tablename__ = "processing_jobs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    job_id = Column(
        String(255), unique=True, index=True, nullable=False
    )  # UUID from existing system

    # Job status and timing
    status = Column(String(20), default="pending", nullable=False, index=True)
    progress = Column(Integer, default=0, nullable=False)  # Percentage 0-100
    debug_mode = Column(Boolean, default=False, nullable=False)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)

    # Photo metrics
    total_photos = Column(Integer, default=0, nullable=False)
    photos_processed = Column(Integer, default=0, nullable=False)
    photos_detected = Column(Integer, default=0, nullable=False)
    photos_unknown = Column(Integer, default=0, nullable=False)

    # Processing metrics
    total_processing_time_seconds = Column(Float, nullable=True)
    average_time_per_photo = Column(Float, nullable=True)
    total_file_size_mb = Column(Float, nullable=True)

    # Detection accuracy metrics
    google_vision_detections = Column(Integer, default=0, nullable=False)
    tesseract_detections = Column(Integer, default=0, nullable=False)
    manual_labels = Column(Integer, default=0, nullable=False)

    # Error handling
    error_count = Column(Integer, default=0, nullable=False)
    error_message = Column(Text, nullable=True)

    # Additional metadata
    job_metadata = Column(Text, nullable=True)  # JSON string for additional job details

    # Relationships
    user = relationship("User", back_populates="processing_jobs")

    def start_processing(self) -> None:
        """
        Mark the job as started.
        """
        self.status = "processing"
        self.started_at = datetime.utcnow()

    def complete_processing(
        self, success: bool = True, error_message: Optional[str] = None
    ) -> None:
        """
        Mark the job as completed or failed.
        """
        self.status = "completed" if success else "failed"
        self.completed_at = datetime.utcnow()
        if error_message:
            self.error_message = error_message

        # Calculate processing time from upload start to completion (full user experience)
        if self.created_at:
            processing_time = (self.completed_at - self.created_at).total_seconds()
            self.total_processing_time_seconds = processing_time
            if self.total_photos > 0:
                self.average_time_per_photo = processing_time / self.total_photos

    def update_photo_counts(self, detected: int, unknown: int) -> None:
        """
        Update photo count statistics.
        """
        self.photos_detected = detected
        self.photos_unknown = unknown
        self.photos_processed = detected + unknown

    def add_detection(self, detection_type: str) -> None:
        """
        Increment detection counters.
        """
        if detection_type == "google_vision":
            self.google_vision_detections += 1
        elif detection_type == "tesseract":
            self.tesseract_detections += 1
        elif detection_type == "manual":
            self.manual_labels += 1

    def add_error(self, error_message: str) -> None:
        """
        Add an error to the job.
        """
        self.error_count += 1
        if self.error_message:
            self.error_message += f"\n{error_message}"
        else:
            self.error_message = error_message

    def is_expired(self) -> bool:
        """Check if the job has expired."""
        if not self.expires_at:
            return False
        return datetime.utcnow() > self.expires_at

    def set_expiration(self, hours: int = 24):
        """Set job expiration time."""
        self.expires_at = datetime.utcnow() + timedelta(hours=hours)

    def to_schema(self):
        """Convert to ProcessingJob schema for API responses."""
        from app.models.schemas import ProcessingJob

        return ProcessingJob(
            job_id=self.job_id,
            photo_ids=[],  # Will be populated by PhotoDB relationships later
            status=self.status,
            progress=self.progress,
            completed_photos=self.photos_processed,
            total_photos=self.total_photos,
            debug_mode=self.debug_mode,
        )

    def to_dict(self) -> dict:
        """
        Convert processing job to dictionary for API responses.
        """
        return {
            "id": self.id,
            "user_id": self.user_id,
            "job_id": self.job_id,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": (
                self.completed_at.isoformat() if self.completed_at else None
            ),
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "progress": self.progress,
            "debug_mode": self.debug_mode,
            "total_photos": self.total_photos,
            "photos_processed": self.photos_processed,
            "photos_detected": self.photos_detected,
            "photos_unknown": self.photos_unknown,
            "total_processing_time_seconds": self.total_processing_time_seconds,
            "average_time_per_photo": self.average_time_per_photo,
            "total_file_size_mb": self.total_file_size_mb,
            "google_vision_detections": self.google_vision_detections,
            "tesseract_detections": self.tesseract_detections,
            "manual_labels": self.manual_labels,
            "error_count": self.error_count,
            "error_message": self.error_message,
            "job_metadata": self.job_metadata,
        }

    def __repr__(self) -> str:
        return f"<ProcessingJob(id={self.id}, job_id='{self.job_id}', status={self.status}, user_id={self.user_id})>"


class UserQuota(Base):
    """
    Track user quotas and limits (for future premium features).
    """

    __tablename__ = "user_quotas"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, unique=True, nullable=False, index=True
    )  # Foreign key to users.id

    # Monthly limits
    monthly_photo_limit = Column(
        Integer, default=10000, nullable=False
    )  # Photos per month
    monthly_processing_limit = Column(
        Integer, default=100, nullable=False
    )  # Processing jobs per month
    monthly_export_limit = Column(
        Integer, default=50, nullable=False
    )  # Exports per month

    # Current month usage (reset monthly)
    current_month = Column(String(7), nullable=False, index=True)  # Format: "2024-01"
    photos_used_this_month = Column(Integer, default=0, nullable=False)
    processing_used_this_month = Column(Integer, default=0, nullable=False)
    exports_used_this_month = Column(Integer, default=0, nullable=False)

    # Dates
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    def reset_monthly_usage(self, current_month: str) -> None:
        """
        Reset monthly usage counters for a new month.
        """
        if self.current_month != current_month:
            self.current_month = current_month
            self.photos_used_this_month = 0
            self.processing_used_this_month = 0
            self.exports_used_this_month = 0

    def can_upload_photos(self, photo_count: int) -> bool:
        """
        Check if user can upload the specified number of photos.
        """
        return (self.photos_used_this_month + photo_count) <= self.monthly_photo_limit

    def can_process(self) -> bool:
        """
        Check if user can start a new processing job.
        """
        return self.processing_used_this_month < self.monthly_processing_limit

    def can_export(self) -> bool:
        """
        Check if user can perform an export.
        """
        return self.exports_used_this_month < self.monthly_export_limit

    def use_photos(self, photo_count: int) -> None:
        """
        Increment photos used this month.
        """
        self.photos_used_this_month += photo_count

    def use_processing(self) -> None:
        """
        Increment processing jobs used this month.
        """
        self.processing_used_this_month += 1

    def use_export(self) -> None:
        """
        Increment exports used this month.
        """
        self.exports_used_this_month += 1

    def to_dict(self) -> dict:
        """
        Convert quota to dictionary for API responses.
        """
        return {
            "user_id": self.user_id,
            "monthly_photo_limit": self.monthly_photo_limit,
            "monthly_processing_limit": self.monthly_processing_limit,
            "monthly_export_limit": self.monthly_export_limit,
            "current_month": self.current_month,
            "photos_used_this_month": self.photos_used_this_month,
            "processing_used_this_month": self.processing_used_this_month,
            "exports_used_this_month": self.exports_used_this_month,
            "photos_remaining": max(
                0, self.monthly_photo_limit - self.photos_used_this_month
            ),
            "processing_remaining": max(
                0, self.monthly_processing_limit - self.processing_used_this_month
            ),
            "exports_remaining": max(
                0, self.monthly_export_limit - self.exports_used_this_month
            ),
        }

    def __repr__(self) -> str:
        return f"<UserQuota(user_id={self.user_id}, month='{self.current_month}', photos={self.photos_used_this_month}/{self.monthly_photo_limit})>"
