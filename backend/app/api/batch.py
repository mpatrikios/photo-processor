"""
API endpoints for batch operations on photos.
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
import asyncio
import logging

from app.api.auth import get_current_user
from app.models.user import User
from app.models.processing import PhotoDB, BatchOperationDB, BatchOperationType, ProcessingStatus
from app.core.security import InputValidator
from database import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

# Request/Response Models
class BatchUpdateLabelsRequest(BaseModel):
    photo_ids: List[str] = Field(..., min_items=1, max_items=1000)
    bib_number: str = Field(..., min_length=1, max_length=6)

class BatchDeleteRequest(BaseModel):
    photo_ids: List[str] = Field(..., min_items=1, max_items=1000)
    confirm: bool = Field(default=False)

class BatchReprocessRequest(BaseModel):
    photo_ids: List[str] = Field(..., min_items=1, max_items=1000)
    force: bool = Field(default=False)

class BatchResponse(BaseModel):
    operation_id: int
    operation_type: str
    affected_count: int
    success_count: int
    error_count: int
    errors: Optional[List[str]] = None
    can_undo: bool = False

class UndoRequest(BaseModel):
    operation_id: int

@router.post("/update-labels", response_model=BatchResponse)
async def batch_update_labels(
    request: BatchUpdateLabelsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Update bib numbers for multiple photos at once.
    """
    # Validate bib number
    if not InputValidator.validate_bib_number(request.bib_number):
        raise HTTPException(status_code=400, detail="Invalid bib number format")
    
    # Validate photo IDs
    valid_photo_ids = []
    for photo_id in request.photo_ids:
        if InputValidator.validate_uuid(photo_id):
            valid_photo_ids.append(photo_id)
    
    if not valid_photo_ids:
        raise HTTPException(status_code=400, detail="No valid photo IDs provided")
    
    # Get photos owned by user
    photos = db.query(PhotoDB).filter(
        PhotoDB.photo_id.in_(valid_photo_ids),
        PhotoDB.user_id == current_user.id
    ).all()
    
    if not photos:
        raise HTTPException(status_code=404, detail="No photos found")
    
    # Create batch operation record
    batch_op = BatchOperationDB(
        user_id=current_user.id,
        operation_type=BatchOperationType.UPDATE_LABELS,
        operation_data={
            "photo_ids": [p.photo_id for p in photos],
            "new_bib_number": request.bib_number
        },
        affected_count=len(photos),
        can_undo=True
    )
    
    # Store undo data
    undo_data = []
    for photo in photos:
        undo_data.append({
            "photo_id": photo.photo_id,
            "old_manual_label": photo.manual_label,
            "old_detected_number": photo.detected_number
        })
    batch_op.undo_data = undo_data
    
    # Update photos
    success_count = 0
    errors = []
    
    for photo in photos:
        try:
            photo.manual_label = request.bib_number
            photo.manual_label_by = current_user.id
            photo.manual_label_at = datetime.utcnow()
            success_count += 1
        except Exception as e:
            errors.append(f"Photo {photo.photo_id}: {str(e)}")
    
    batch_op.success_count = success_count
    batch_op.error_count = len(errors)
    batch_op.errors = errors if errors else None
    batch_op.completed_at = datetime.utcnow()
    
    db.add(batch_op)
    db.commit()
    
    logger.info(f"Batch update labels: {success_count} photos updated for user {current_user.id}")
    
    return BatchResponse(
        operation_id=batch_op.id,
        operation_type=batch_op.operation_type.value,
        affected_count=batch_op.affected_count,
        success_count=success_count,
        error_count=len(errors),
        errors=errors[:10] if errors else None,  # Limit errors shown
        can_undo=True
    )

@router.post("/delete", response_model=BatchResponse)
async def batch_delete_photos(
    request: BatchDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Delete multiple photos at once.
    """
    if not request.confirm:
        raise HTTPException(status_code=400, detail="Must confirm deletion")
    
    # Validate photo IDs
    valid_photo_ids = []
    for photo_id in request.photo_ids:
        if InputValidator.validate_uuid(photo_id):
            valid_photo_ids.append(photo_id)
    
    # Get photos owned by user
    photos = db.query(PhotoDB).filter(
        PhotoDB.photo_id.in_(valid_photo_ids),
        PhotoDB.user_id == current_user.id
    ).all()
    
    if not photos:
        raise HTTPException(status_code=404, detail="No photos found")
    
    # Create batch operation record
    batch_op = BatchOperationDB(
        user_id=current_user.id,
        operation_type=BatchOperationType.DELETE_PHOTOS,
        operation_data={
            "photo_ids": [p.photo_id for p in photos]
        },
        affected_count=len(photos),
        can_undo=False  # Deletion cannot be undone
    )
    
    # Delete photos and files
    success_count = 0
    errors = []
    
    for photo in photos:
        try:
            # Delete physical file
            import os
            if os.path.exists(photo.file_path):
                os.remove(photo.file_path)
            
            # Delete database record
            db.delete(photo)
            success_count += 1
            
        except Exception as e:
            errors.append(f"Photo {photo.photo_id}: {str(e)}")
    
    batch_op.success_count = success_count
    batch_op.error_count = len(errors)
    batch_op.errors = errors if errors else None
    batch_op.completed_at = datetime.utcnow()
    
    db.add(batch_op)
    db.commit()
    
    logger.info(f"Batch delete: {success_count} photos deleted for user {current_user.id}")
    
    return BatchResponse(
        operation_id=batch_op.id,
        operation_type=batch_op.operation_type.value,
        affected_count=batch_op.affected_count,
        success_count=success_count,
        error_count=len(errors),
        errors=errors[:10] if errors else None,
        can_undo=False
    )

@router.post("/reprocess", response_model=BatchResponse)
async def batch_reprocess_photos(
    request: BatchReprocessRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Reprocess multiple photos for bib number detection.
    """
    # Validate photo IDs
    valid_photo_ids = []
    for photo_id in request.photo_ids:
        if InputValidator.validate_uuid(photo_id):
            valid_photo_ids.append(photo_id)
    
    # Get photos owned by user
    photos = db.query(PhotoDB).filter(
        PhotoDB.photo_id.in_(valid_photo_ids),
        PhotoDB.user_id == current_user.id
    ).all()
    
    if not photos:
        raise HTTPException(status_code=404, detail="No photos found")
    
    # Check if photos are already processing (unless forced)
    if not request.force:
        processing_photos = [p for p in photos if p.processing_status == ProcessingStatus.PROCESSING]
        if processing_photos:
            raise HTTPException(
                status_code=400,
                detail=f"{len(processing_photos)} photos are already being processed"
            )
    
    # Create batch operation record
    batch_op = BatchOperationDB(
        user_id=current_user.id,
        operation_type=BatchOperationType.REPROCESS,
        operation_data={
            "photo_ids": [p.photo_id for p in photos],
            "force": request.force
        },
        affected_count=len(photos),
        can_undo=False
    )
    
    # Reset processing status
    success_count = 0
    errors = []
    
    for photo in photos:
        try:
            photo.processing_status = ProcessingStatus.PENDING
            photo.processing_error = None
            photo.processed_at = None
            # Keep manual labels but reset detection results
            if not request.force and photo.manual_label:
                # Skip reprocessing if manually labeled (unless forced)
                continue
            photo.detected_number = None
            photo.confidence = None
            photo.detection_method = None
            photo.set_bbox(None)
            success_count += 1
            
        except Exception as e:
            errors.append(f"Photo {photo.photo_id}: {str(e)}")
    
    batch_op.success_count = success_count
    batch_op.error_count = len(errors)
    batch_op.errors = errors if errors else None
    batch_op.completed_at = datetime.utcnow()
    
    db.add(batch_op)
    db.commit()
    
    # Start reprocessing (create a new job)
    if success_count > 0:
        from app.services.job_service import job_service
        reprocess_job = job_service.create_job(
            db, current_user.id, 
            [p.photo_id for p in photos if p.processing_status == ProcessingStatus.PENDING],
            debug=False
        )
        asyncio.create_task(job_service.process_job_async(reprocess_job.job_id))
    
    logger.info(f"Batch reprocess: {success_count} photos queued for user {current_user.id}")
    
    return BatchResponse(
        operation_id=batch_op.id,
        operation_type=batch_op.operation_type.value,
        affected_count=batch_op.affected_count,
        success_count=success_count,
        error_count=len(errors),
        errors=errors[:10] if errors else None,
        can_undo=False
    )

@router.post("/undo/{operation_id}", response_model=Dict[str, Any])
async def undo_batch_operation(
    operation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Undo a batch operation if possible.
    """
    # Get the batch operation
    batch_op = db.query(BatchOperationDB).filter(
        BatchOperationDB.id == operation_id,
        BatchOperationDB.user_id == current_user.id,
        BatchOperationDB.can_undo == True,
        BatchOperationDB.undone_at.is_(None)
    ).first()
    
    if not batch_op:
        raise HTTPException(status_code=404, detail="Operation not found or cannot be undone")
    
    if not batch_op.undo_data:
        raise HTTPException(status_code=400, detail="No undo data available")
    
    # Perform undo based on operation type
    success_count = 0
    errors = []
    
    if batch_op.operation_type == BatchOperationType.UPDATE_LABELS:
        # Restore previous labels
        for undo_item in batch_op.undo_data:
            try:
                photo = db.query(PhotoDB).filter(
                    PhotoDB.photo_id == undo_item["photo_id"],
                    PhotoDB.user_id == current_user.id
                ).first()
                
                if photo:
                    photo.manual_label = undo_item.get("old_manual_label")
                    photo.manual_label_by = None
                    photo.manual_label_at = None
                    success_count += 1
                
            except Exception as e:
                errors.append(f"Photo {undo_item['photo_id']}: {str(e)}")
    
    # Mark operation as undone
    batch_op.undone_at = datetime.utcnow()
    
    db.commit()
    
    logger.info(f"Undid batch operation {operation_id}: {success_count} items restored")
    
    return {
        "message": f"Successfully undid operation: {success_count} items restored",
        "restored_count": success_count,
        "errors": errors[:10] if errors else None
    }

@router.get("/operations", response_model=List[Dict[str, Any]])
async def get_batch_operations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = 20
):
    """
    Get recent batch operations for the user.
    """
    operations = db.query(BatchOperationDB)\
                   .filter(BatchOperationDB.user_id == current_user.id)\
                   .order_by(BatchOperationDB.created_at.desc())\
                   .limit(limit)\
                   .all()
    
    return [op.to_dict() for op in operations]