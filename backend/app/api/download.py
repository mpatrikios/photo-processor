import logging
import os
import uuid
import zipfile
from collections import defaultdict
from datetime import datetime
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.core.config import settings
from app.core.gcs import get_gcs_bucket, generate_signed_url
from app.models.processing import ExportDB, ExportStatus, PhotoDB
from app.models.schemas import ExportRequest
from app.models.user import User
from database import get_db

logger = logging.getLogger(__name__)

router = APIRouter()

EXPORT_DIR = "exports"


@router.post("/export")
async def create_export(
    request: ExportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not request.photo_ids:
        raise HTTPException(status_code=400, detail="No photo IDs provided")

    bucket = get_gcs_bucket()
    if not bucket:
        raise HTTPException(status_code=500, detail="Google Cloud Storage not configured")

    export_id = str(uuid.uuid4())
    zip_filename = f"tag_photos_{export_id}.zip"
    gcs_blob_path = f"{current_user.id}/exports/{zip_filename}"

    # Temporary local path for ZIP creation before GCS upload
    temp_dir = os.path.join(EXPORT_DIR, "temp")
    os.makedirs(temp_dir, exist_ok=True)
    temp_zip_path = os.path.join(temp_dir, f"{export_id}_{zip_filename}")

    # Create ExportDB record with CREATING status
    export_record = ExportDB(
        export_id=export_id,
        user_id=current_user.id,
        filename=zip_filename,
        file_path=gcs_blob_path,
        photo_count=len(request.photo_ids),
        status=ExportStatus.CREATING
    )
    db.add(export_record)
    db.commit()

    try:
        logger.info(f"Creating export {export_id} for user {current_user.id} with {len(request.photo_ids)} photos")

        # Group photos by bib number with hybrid organization
        grouped_photos, photos_missing = await organize_photos_by_bib(request.photo_ids, current_user.id, db)

        logger.info(f"Grouped photos into {len(grouped_photos)} groups: {list(grouped_photos.keys())}")

        files_added = 0
        total_size = 0

        # Create temporary ZIP file, downloading photos from GCS
        with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for bib_number, photos in grouped_photos.items():
                folder_name = (
                    f"Bib_{bib_number}" if bib_number != "unknown" else "Unknown"
                )
                logger.info(f"Processing folder '{folder_name}' with {len(photos)} photos")

                for i, (photo_id, blob_path, original_filename) in enumerate(photos, 1):
                    try:
                        # Download file from GCS
                        blob = bucket.blob(blob_path)
                        if not blob.exists():
                            logger.warning(f"Skipping photo {photo_id}: blob not found at {blob_path}")
                            continue

                        file_data = blob.download_as_bytes()
                        file_size = len(file_data)

                        # Get filename parts
                        name_part, ext = os.path.splitext(original_filename)

                        # Create hybrid filename: bibNumber_originalName_sequence.ext
                        if bib_number != "unknown":
                            if len(photos) > 1:
                                new_filename = f"{bib_number}_{name_part}_{i:03d}{ext}"
                            else:
                                new_filename = f"{bib_number}_{name_part}{ext}"
                        else:
                            if len(photos) > 1:
                                new_filename = f"unknown_{i:03d}{ext}"
                            else:
                                new_filename = f"unknown_{name_part}{ext}"

                        # Add to ZIP with folder structure
                        arcname = f"{folder_name}/{new_filename}"

                        logger.debug(f"Adding file: {blob_path} -> {arcname} ({file_size} bytes)")
                        zipf.writestr(arcname, file_data)

                        files_added += 1
                        total_size += file_size
                    except Exception as e:
                        logger.warning(f"Failed to download photo {photo_id} from {blob_path}: {e}")

        logger.info(f"Export {export_id} completed: {files_added} files added, total size: {total_size} bytes")

        zip_size = os.path.getsize(temp_zip_path) if os.path.exists(temp_zip_path) else 0
        logger.info(f"Temporary ZIP file created: {temp_zip_path}, size: {zip_size}")

        if not os.path.exists(temp_zip_path):
            export_record.status = ExportStatus.FAILED
            export_record.error_message = "Failed to create export file"
            db.commit()
            raise HTTPException(status_code=500, detail="Failed to create export file")

        try:
            blob = bucket.blob(gcs_blob_path)
            with open(temp_zip_path, 'rb') as zip_file:
                blob.upload_from_file(zip_file, content_type='application/zip')

            logger.info(f"ZIP uploaded to GCS: {gcs_blob_path}")

            # Update ExportDB record with success status
            export_record.status = ExportStatus.READY
            export_record.file_size_bytes = total_size
            export_record.completed_at = datetime.utcnow()
            export_record.set_expiration(days=7)
            db.commit()

        except Exception as e:
            logger.error(f"Failed to upload ZIP to GCS: {e}")
            export_record.status = ExportStatus.FAILED
            export_record.error_message = str(e)
            db.commit()
            raise HTTPException(status_code=500, detail=f"Failed to upload export: {str(e)}")

        finally:
            # Always clean up temporary file
            if os.path.exists(temp_zip_path):
                os.remove(temp_zip_path)
                logger.info(f"Cleaned up temporary ZIP file: {temp_zip_path}")

        return {
            "export_id": export_id,
            "download_url": f"/api/download/file/{export_id}",
            "files_included": files_added,
            "photos_missing": photos_missing,
            "total_size_bytes": total_size,
        }

    except HTTPException:
        raise
    except Exception as e:
        # Update export record with failure status
        export_record.status = ExportStatus.FAILED
        export_record.error_message = str(e)
        db.commit()
        raise HTTPException(
            status_code=500, detail=f"Failed to create export: {str(e)}"
        )


@router.get("/file/{export_id}")
async def download_export(
    export_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Return signed URL for ZIP download instead of streaming the file.
    Uses database for multi-instance Cloud Run compatibility.
    """

    # Query database for export record with user ownership check
    export_record = db.query(ExportDB).filter(
        ExportDB.export_id == export_id,
        ExportDB.user_id == current_user.id
    ).first()

    if not export_record:
        raise HTTPException(status_code=404, detail="Export not found")

    # Check if export is ready
    if export_record.status != ExportStatus.READY:
        if export_record.status == ExportStatus.CREATING:
            raise HTTPException(status_code=202, detail="Export is still being created")
        elif export_record.status == ExportStatus.EXPIRED:
            raise HTTPException(status_code=410, detail="Export has expired")
        else:
            raise HTTPException(status_code=500, detail=f"Export failed: {export_record.error_message}")

    # Check if export has expired
    if export_record.is_expired():
        export_record.status = ExportStatus.EXPIRED
        db.commit()
        raise HTTPException(status_code=410, detail="Export has expired")

    bucket = get_gcs_bucket()
    if not bucket:
        raise HTTPException(status_code=500, detail="Google Cloud Storage not configured")

    blob = bucket.blob(export_record.file_path)

    if not blob.exists():
        logger.error(f"Export {export_id} blob not found at {export_record.file_path}")
        raise HTTPException(status_code=404, detail="Export file not found")

    # Generate signed URL with Content-Disposition to force download
    signed_url = generate_signed_url(
        blob, method="GET", expires_minutes=15, download_filename=export_record.filename
    )
    if not signed_url:
        raise HTTPException(status_code=500, detail="Failed to generate download URL")

    # Track download
    export_record.mark_downloaded()
    db.commit()

    logger.info(f"Generated signed URL for export {export_id}")
    return {
        "signed_url": signed_url,
        "filename": export_record.filename,
        "expires_in_minutes": 15,
    }


async def organize_photos_by_bib(photo_ids: List[str], user_id: int, db: Session) -> tuple[Dict[str, List[tuple]], int]:
    """
    Organize photos by bib number with numerical sorting.

    Returns:
        Tuple of (grouped_photos, missing_count) where grouped_photos is a Dict
        with bib numbers as keys and list of (photo_id, photo_path) tuples as values.
    """
    grouped = defaultdict(list)
    missing_photos = []

    logger.info(f"Organizing {len(photo_ids)} photos for user {user_id}")

    # Batch query all photos at once (efficient)
    photo_records = db.query(PhotoDB).filter(
        PhotoDB.photo_id.in_(photo_ids),
        PhotoDB.user_id == user_id
    ).all()

    # Create lookup dict
    photo_map = {p.photo_id: p for p in photo_records}
    logger.info(f"Database query returned {len(photo_records)} photos for {len(photo_ids)} requested IDs")

    for photo_id in photo_ids:
        photo_record = photo_map.get(photo_id)

        if not photo_record:
            logger.warning(f"Photo {photo_id}: Not found in database for user {user_id}")
            missing_photos.append(photo_id)
            continue

        # Use stored file_path from database (this is a GCS blob path)
        blob_path = photo_record.file_path

        if not blob_path:
            logger.warning(f"Photo {photo_id}: No file_path stored in database")
            missing_photos.append(photo_id)
            continue

        # Get bib number: manual label takes priority over detected
        if photo_record.manual_label:
            bib_number = photo_record.manual_label
            logger.debug(f"Photo {photo_id}: Using manual label {bib_number}")
        elif photo_record.detected_number:
            bib_number = photo_record.detected_number
            logger.debug(f"Photo {photo_id}: Using detected number {bib_number}")
        else:
            bib_number = "unknown"
            logger.debug(f"Photo {photo_id}: No label found, using 'unknown'")

        grouped[bib_number].append((photo_id, blob_path, photo_record.original_filename))
        logger.debug(f"Photo {photo_id}: Added to group '{bib_number}' with blob_path {blob_path}")

    # Log summary
    found_count = sum(len(v) for v in grouped.values())
    if missing_photos:
        logger.warning(f"Export grouping: {len(photo_ids)} requested, {found_count} found, {len(missing_photos)} missing")
        logger.warning(f"Missing photo IDs (first 10): {missing_photos[:10]}")
    else:
        logger.info(f"Export grouping: {len(photo_ids)} requested, {found_count} found, 0 missing")

    # Sort bib numbers numerically (not alphabetically)
    sorted_grouped = {}

    # Separate numeric and non-numeric bib numbers
    numeric_bibs = []
    non_numeric_bibs = []

    for bib in grouped.keys():
        if bib == "unknown":
            non_numeric_bibs.append(bib)
        else:
            try:
                numeric_bibs.append((int(bib), bib))
            except ValueError:
                non_numeric_bibs.append(bib)

    # Sort numeric bibs by number, then add non-numeric
    numeric_bibs.sort(key=lambda x: x[0])
    sorted_bib_order = [bib for _, bib in numeric_bibs] + sorted(non_numeric_bibs)

    # Rebuild dictionary in sorted order
    for bib in sorted_bib_order:
        sorted_grouped[bib] = grouped[bib]

    return sorted_grouped, len(missing_photos)
