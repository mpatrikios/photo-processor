"""
Database models for photo processing, jobs, and exports.
"""

from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional

from sqlalchemy import JSON, Boolean, Column, DateTime
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class ProcessingStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    EXPIRED = "expired"


class ExportStatus(str, Enum):
    CREATING = "creating"
    READY = "ready"
    EXPIRED = "expired"
    FAILED = "failed"


class BatchOperationType(str, Enum):
    UPDATE_LABELS = "update_labels"
    DELETE_PHOTOS = "delete_photos"
    REPROCESS = "reprocess"
    MOVE_GROUP = "move_group"


class PhotoDB(Base):
    """
    Persistent storage for individual photos and their detection results.
    """

    __tablename__ = "photos"


    id = Column(Integer, primary_key=True, index=True)
    photo_id = Column(String(36), unique=True, index=True, nullable=False)  # UUID
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    processing_job_id = Column(String(50), nullable=True) # Change from Integer to String

    # File information
    original_filename = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size_bytes = Column(Integer, nullable=False)
    file_extension = Column(String(10), nullable=False)

    # Detection results
    detected_number = Column(String(10), nullable=True, index=True)
    confidence = Column(Float, nullable=True)
    detection_method = Column(String(20), nullable=True)  # "google_vision", "tesseract"
    bbox_x = Column(Integer, nullable=True)
    bbox_y = Column(Integer, nullable=True)
    bbox_width = Column(Integer, nullable=True)
    bbox_height = Column(Integer, nullable=True)

    # Manual overrides
    manual_label = Column(String(10), nullable=True, index=True)
    manual_label_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    manual_label_at = Column(DateTime(timezone=True), nullable=True)

    # Processing status
    processing_status = Column(
        SQLEnum(ProcessingStatus), default=ProcessingStatus.PENDING, index=True
    )
    processing_error = Column(Text, nullable=True)
    processing_duration_seconds = Column(Float, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    processed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", foreign_keys=[user_id], back_populates="photos")
    manual_labeler = relationship("User", foreign_keys=[manual_label_by])

    @property
    def effective_bib_number(self) -> Optional[str]:
        """Get the effective bib number (manual label takes precedence)."""
        return self.manual_label or self.detected_number

    @property
    def bbox(self) -> Optional[Dict[str, int]]:
        """Get bounding box as dictionary."""
        if all(
            v is not None
            for v in [self.bbox_x, self.bbox_y, self.bbox_width, self.bbox_height]
        ):
            return {
                "x": self.bbox_x,
                "y": self.bbox_y,
                "width": self.bbox_width,
                "height": self.bbox_height,
            }
        return None

    def set_bbox(self, bbox: Optional[List[int]]):
        """Set bounding box from list [x, y, width, height]."""
        if bbox and len(bbox) == 4:
            self.bbox_x, self.bbox_y, self.bbox_width, self.bbox_height = bbox
        else:
            self.bbox_x = self.bbox_y = self.bbox_width = self.bbox_height = None

    def set_detection_result(
        self,
        detected_number: str,
        confidence: float,
        method: str,
        bbox: Optional[List[int]] = None,
    ):
        """Update detection results."""
        self.detected_number = detected_number
        self.confidence = confidence
        self.detection_method = method
        self.set_bbox(bbox)
        self.processed_at = datetime.utcnow()
        self.processing_status = ProcessingStatus.COMPLETED


class ExportDB(Base):
    """
    Persistent storage for photo exports.
    """

    __tablename__ = "exports"

    id = Column(Integer, primary_key=True, index=True)
    export_id = Column(String(36), unique=True, index=True, nullable=False)  # UUID
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Export details
    filename = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size_bytes = Column(Integer, nullable=True)
    photo_count = Column(Integer, nullable=False)

    # Configuration
    export_format = Column(String(10), default="zip")
    include_metadata = Column(Boolean, default=False)

    # Status
    status = Column(SQLEnum(ExportStatus), default=ExportStatus.CREATING, index=True)
    error_message = Column(Text, nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    last_downloaded_at = Column(DateTime(timezone=True), nullable=True)
    download_count = Column(Integer, default=0)

    # Relationships
    user = relationship("User", back_populates="exports")

    def is_expired(self) -> bool:
        """Check if the export has expired."""
        if not self.expires_at:
            return False
        return datetime.utcnow() > self.expires_at

    def set_expiration(self, days: int = 7):
        """Set export expiration time."""
        self.expires_at = datetime.utcnow() + timedelta(days=days)

    def mark_downloaded(self):
        """Mark export as downloaded."""
        self.last_downloaded_at = datetime.utcnow()
        self.download_count += 1


class BatchOperationDB(Base):
    """
    Track batch operations for audit and undo functionality.
    """

    __tablename__ = "batch_operations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # Operation details
    operation_type = Column(SQLEnum(BatchOperationType), nullable=False, index=True)
    operation_data = Column(JSON, nullable=False)  # Parameters and affected items

    # Results
    affected_count = Column(Integer, default=0)
    success_count = Column(Integer, default=0)
    error_count = Column(Integer, default=0)
    errors = Column(JSON, nullable=True)  # List of errors if any

    # Undo information
    can_undo = Column(Boolean, default=False)
    undo_data = Column(JSON, nullable=True)  # Data needed to reverse the operation
    undone_at = Column(DateTime(timezone=True), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    user = relationship("User", back_populates="batch_operations")

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "operation_type": self.operation_type.value,
            "affected_count": self.affected_count,
            "success_count": self.success_count,
            "error_count": self.error_count,
            "can_undo": self.can_undo,
            "created_at": self.created_at.isoformat(),
            "completed_at": (
                self.completed_at.isoformat() if self.completed_at else None
            ),
            "undone_at": self.undone_at.isoformat() if self.undone_at else None,
        }
