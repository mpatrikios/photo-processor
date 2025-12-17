"""
Security middleware and utilities for the application.
Includes rate limiting, input validation, and security headers.
"""

import html
import re
from typing import Optional

from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded

from app.core.config import settings


# Create rate limiter instance
def get_real_client_ip(request: Request) -> str:
    """
    Get the real client IP address, considering proxy headers.
    """
    # Check for proxy headers first
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        # Take the first IP in the chain (original client)
        return forwarded_for.split(",")[0].strip()

    # Check for other proxy headers
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()

    # Fallback to direct client IP
    if request.client:
        return request.client.host

    return "127.0.0.1"


# Initialize rate limiter with custom key function
limiter = Limiter(
    key_func=get_real_client_ip,
    default_limits=[f"{settings.rate_limit_per_minute}/minute"],
    headers_enabled=True,  # Include rate limit info in response headers
    swallow_errors=False,  # Don't hide rate limit errors
)


# Custom rate limit error handler
async def custom_rate_limit_handler(request: Request, exc: RateLimitExceeded):
    """
    Custom handler for rate limit exceeded errors.
    """
    response = JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={
            "detail": f"Rate limit exceeded: {exc.detail}",
            "error": "rate_limit_exceeded",
            "retry_after": request.headers.get("Retry-After", "60"),
        },
    )
    response.headers["Retry-After"] = request.headers.get("Retry-After", "60")
    return response


class InputValidator:
    """
    Input validation utilities to prevent injection attacks.
    """

    @staticmethod
    def sanitize_filename(filename: str) -> str:
        """
        Sanitize a filename to prevent path traversal and other attacks.
        """
        # Remove any path components
        filename = filename.replace("..", "").replace("/", "").replace("\\", "")

        # Remove control characters and non-printable characters
        filename = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", filename)

        # Limit filename length
        max_length = 255
        if len(filename) > max_length:
            name, ext = filename.rsplit(".", 1) if "." in filename else (filename, "")
            if ext:
                # Preserve extension
                max_name_length = max_length - len(ext) - 1
                filename = f"{name[:max_name_length]}.{ext}"
            else:
                filename = filename[:max_length]

        # Ensure filename is not empty
        if not filename:
            filename = "unnamed_file"

        return filename

    @staticmethod
    def sanitize_path_id(path_id: str) -> str:
        """
        Sanitize a path ID (like photo_id or job_id) to prevent injection.
        """
        # Only allow alphanumeric, hyphen, and underscore
        sanitized = re.sub(r"[^a-zA-Z0-9\-_]", "", path_id)

        # Limit length
        max_length = 100
        if len(sanitized) > max_length:
            sanitized = sanitized[:max_length]

        return sanitized

    @staticmethod
    def sanitize_html(text: str) -> str:
        """
        Sanitize text to prevent XSS attacks when displayed in HTML.
        """
        return html.escape(text)

    @staticmethod
    def validate_email(email: str) -> bool:
        """
        Validate email format.
        """
        email_pattern = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")
        return bool(email_pattern.match(email))

    @staticmethod
    def validate_bib_number(bib_number: str) -> bool:
        """
        Validate that a bib number is in the correct format.
        """
        # Bib numbers should be numeric, 1-6 digits
        if not bib_number.isdigit():
            return False

        try:
            num = int(bib_number)
            return 1 <= num <= 999999
        except ValueError:
            return False

    @staticmethod
    def validate_uuid(uuid_string: str) -> bool:
        """
        Validate UUID format.
        """
        uuid_pattern = re.compile(
            r"^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$",
            re.IGNORECASE,
        )
        return bool(uuid_pattern.match(uuid_string))


class SecurityHeaders:
    """
    Security headers middleware to prevent common attacks.
    """

    @staticmethod
    async def add_security_headers(request: Request, call_next):
        """
        Add security headers to all responses.
        """
        response = await call_next(request)

        # Prevent clickjacking
        response.headers["X-Frame-Options"] = "DENY"

        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # Enable XSS filter in browsers
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Content Security Policy (adjust as needed)
        if settings.is_production():
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline' cdn.jsdelivr.net; "
                "style-src 'self' 'unsafe-inline' cdn.jsdelivr.net; "
                "img-src 'self' data: blob:; "
                "font-src 'self' data: cdn.jsdelivr.net; "
                "connect-src 'self'"
            )

        # Strict Transport Security (HTTPS only)
        if settings.is_production():
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )

        # Referrer Policy
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Permissions Policy (formerly Feature Policy)
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), "
            "interest-cohort=()"  # Opt out of FLoC
        )

        return response


def validate_file_upload(filename: str, file_size: int) -> None:
    """
    Validate file upload parameters.
    Raises HTTPException if validation fails.
    """
    # Validate filename
    if not filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Filename is required"
        )

    # Check file size
    max_size = settings.get_max_file_size_bytes()
    if file_size > max_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File size exceeds maximum of {settings.max_file_size_mb}MB",
        )

    # Check file extension
    allowed_extensions = {".jpg", ".jpeg", ".png", ".tiff", ".bmp"}
    file_ext = filename.lower().split(".")[-1] if "." in filename else ""
    if f".{file_ext}" not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type not allowed. Allowed types: {', '.join(allowed_extensions)}",
        )


def validate_request_size(content_length: Optional[int]) -> None:
    """
    Validate the total request size.
    """
    if not content_length:
        return

    # Maximum request size (including all files and form data)
    max_request_size = (
        settings.max_files_per_upload * settings.get_max_file_size_bytes()
    )

    if content_length > max_request_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Total request size exceeds maximum allowed",
        )