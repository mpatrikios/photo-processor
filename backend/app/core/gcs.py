"""
Shared Google Cloud Storage utilities.
Singleton pattern to avoid 150-200ms overhead per client initialization.
"""

import logging
from datetime import timedelta
from functools import lru_cache
from typing import Optional

from google.cloud import storage

from app.core.config import settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_gcs_client() -> storage.Client:
    """Singleton GCS client to avoid 150-200ms overhead per initialization."""
    client = storage.Client()
    logger.info("GCS client initialized")
    return client


@lru_cache(maxsize=1)
def get_gcs_bucket() -> Optional[storage.Bucket]:
    """Get configured GCS bucket, or None if not configured."""
    if not settings.bucket_name:
        return None
    return get_gcs_client().bucket(settings.bucket_name)


def generate_signed_url(
    blob: storage.Blob,
    method: str = "GET",
    expires_minutes: int = 15,
    content_type: Optional[str] = None,
    download_filename: Optional[str] = None
) -> Optional[str]:
    """Generate a signed URL for GCS blob access."""
    try:
        from google.auth import default
        from google.auth.transport import requests as google_requests

        credentials, _ = default()
        auth_request = google_requests.Request()
        credentials.refresh(auth_request)

        kwargs = {
            "version": "v4",
            "expiration": timedelta(minutes=expires_minutes),
            "method": method,
            "service_account_email": getattr(credentials, 'service_account_email', None),
            "access_token": getattr(credentials, 'token', None),
        }
        if content_type:
            kwargs["content_type"] = content_type

        # Force browser to download instead of displaying inline
        if download_filename:
            kwargs["response_disposition"] = f'attachment; filename="{download_filename}"'

        return blob.generate_signed_url(**kwargs)
    except Exception as e:
        logger.error(f"Failed to generate signed URL: {e}")
        return None
