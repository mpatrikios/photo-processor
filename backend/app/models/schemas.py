from enum import Enum
from typing import List, Optional

from pydantic import BaseModel


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
    quota_info: Optional[dict] = None


# Direct Upload Schemas
class FileInfo(BaseModel):
    filename: str
    content_type: str
    size: int


class SignedUploadRequest(BaseModel):
    files: List[FileInfo]


class SignedUrlInfo(BaseModel):
    photo_id: str
    filename: str
    gcs_filename: str
    signed_url: str
    expires_at: str
    file_extension: str
    content_type: str
    size: int


class SignedUploadResponse(BaseModel):
    signed_urls: List[SignedUrlInfo]
    expires_in_minutes: int
    bucket_name: str
    message: str


class CompletedUpload(BaseModel):
    photo_id: str
    original_filename: str
    gcs_filename: str
    file_extension: str
    size: int


class UploadCompletionRequest(BaseModel):
    completed_uploads: List[CompletedUpload]


class UploadCompletionResponse(BaseModel):
    successful_uploads: int
    failed_uploads: int
    photo_ids: List[str]
    failed_photos: List[dict]
    total_size_mb: float
    quota_info: dict
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
