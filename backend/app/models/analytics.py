"""
Optimized Analytics Models: Focused on ML Accuracy and Business KPIs.
"""
from enum import Enum

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base

class ConversionStep(str, Enum):
    """Key business milestones only."""
    ACCOUNT_CREATED = "account_created"
    FIRST_UPLOAD = "first_upload"
    FIRST_PROCESS = "first_process"
    FIRST_EXPORT = "first_export"

class ConversionFunnel(Base):
    """Simplified: Tracks only key milestones for business health."""
    __tablename__ = "conversion_funnel"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    step = Column(String(50), nullable=False, index=True) 
    completed_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    
    user = relationship("User")

class BusinessMetric(Base):
    """Daily/Monthly snapshots for the Admin Dashboard."""
    __tablename__ = "business_metrics"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(DateTime(timezone=True), nullable=False, index=True)
    period_type = Column(String(20), nullable=False, index=True) # daily, monthly

    total_users = Column(Integer, default=0)
    active_users = Column(Integer, default=0)
    total_photos_processed = Column(Integer, default=0)
    revenue_usd = Column(Float, default=0.0) # Updated via Stripe Webhook
    avg_detection_accuracy = Column(Float, default=0.0)

class DetectionAccuracyLog(Base):
    """
    CRITICAL: The source of truth for your Accuracy Score.
    This links AI guesses to human corrections.
    """
    __tablename__ = "detection_accuracy_logs"

    id = Column(Integer, primary_key=True, index=True)
    photo_id = Column(String(36), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    processing_job_id = Column(Integer, ForeignKey("processing_jobs.id"), index=True)

    detection_method = Column(String(30), nullable=False, index=True) # e.g. 'gemini-flash'
    processing_time_ms = Column(Float, nullable=False)
    
    final_result = Column(String(20), nullable=True) # AI guess
    manual_label = Column(String(20), nullable=True) # Ground truth
    is_correct = Column(Boolean, nullable=True, index=True) 

    detected_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    user = relationship("User")

class UserRetentionCohort(Base):
    """Pre-calculated retention heatmap."""
    __tablename__ = "user_retention_cohorts"

    id = Column(Integer, primary_key=True, index=True)
    cohort_month = Column(String(7), nullable=False, index=True) # "2024-01"
    user_count = Column(Integer, nullable=False)

    month_0 = Column(Float, default=100.0)
    month_1 = Column(Float)
    month_2 = Column(Float)
    month_3 = Column(Float)
    month_6 = Column(Float)
    month_12 = Column(Float)

    last_updated = Column(DateTime(timezone=True), server_default=func.now())