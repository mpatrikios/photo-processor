from pydantic import BaseModel
from typing import List, Optional
from enum import Enum

class ProcessingStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

class DetectionResult(BaseModel):
    bib_number: Optional[str]
    confidence: float
    bbox: Optional[List[int]] = None

class PhotoInfo(BaseModel):
    id: str
    filename: str
    original_path: str
    processed_path: Optional[str] = None
    detection_result: Optional[DetectionResult] = None
    status: ProcessingStatus = ProcessingStatus.PENDING

class UploadResponse(BaseModel):
    photo_ids: List[str]
    message: str

class ProcessingJob(BaseModel):
    job_id: str
    photo_ids: List[str]
    status: ProcessingStatus
    progress: int = 0
    completed_photos: int = 0
    total_photos: int
    debug_mode: bool = False

class GroupedPhotos(BaseModel):
    bib_number: str
    photos: List[PhotoInfo]
    count: int

class ExportRequest(BaseModel):
    photo_ids: List[str]
    format: str = "zip"

class ManualLabelRequest(BaseModel):
    photo_id: str
    bib_number: str

class FeedbackRequest(BaseModel):
    type: str  # bug, suggestion, improvement, general
    title: str
    description: str
    email: Optional[str] = None
    system_info: Optional[str] = None