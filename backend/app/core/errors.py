"""
Centralized error handling for the application.
Provides consistent error responses and logging.
"""

import logging
import traceback
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import Request, status
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.log_level),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

logger = logging.getLogger(__name__)


class AppError(Exception):
    """Base application error class."""

    def __init__(
        self,
        message: str,
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
        error_code: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ):
        self.message = message
        self.status_code = status_code
        self.error_code = error_code or "INTERNAL_ERROR"
        self.details = details or {}
        super().__init__(self.message)


class AuthenticationError(AppError):
    """Authentication related errors."""

    def __init__(
        self, message: str = "Authentication failed", details: Optional[Dict] = None
    ):
        super().__init__(
            message=message,
            status_code=status.HTTP_401_UNAUTHORIZED,
            error_code="AUTH_ERROR",
            details=details,
        )


class AuthorizationError(AppError):
    """Authorization related errors."""

    def __init__(self, message: str = "Access denied", details: Optional[Dict] = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_403_FORBIDDEN,
            error_code="AUTHORIZATION_ERROR",
            details=details,
        )


class ValidationError(AppError):
    """Input validation errors."""

    def __init__(
        self, message: str, field: Optional[str] = None, details: Optional[Dict] = None
    ):
        error_details = details or {}
        if field:
            error_details["field"] = field

        super().__init__(
            message=message,
            status_code=status.HTTP_400_BAD_REQUEST,
            error_code="VALIDATION_ERROR",
            details=error_details,
        )


class ResourceNotFoundError(AppError):
    """Resource not found errors."""

    def __init__(self, resource: str, identifier: str, details: Optional[Dict] = None):
        super().__init__(
            message=f"{resource} not found: {identifier}",
            status_code=status.HTTP_404_NOT_FOUND,
            error_code="NOT_FOUND",
            details=details or {"resource": resource, "identifier": identifier},
        )


class QuotaExceededError(AppError):
    """Quota exceeded errors."""

    def __init__(self, message: str, quota_info: Optional[Dict] = None):
        super().__init__(
            message=message,
            status_code=status.HTTP_403_FORBIDDEN,
            error_code="QUOTA_EXCEEDED",
            details=quota_info,
        )


class ProcessingError(AppError):
    """Photo processing errors."""

    def __init__(
        self,
        message: str,
        photo_id: Optional[str] = None,
        details: Optional[Dict] = None,
    ):
        error_details = details or {}
        if photo_id:
            error_details["photo_id"] = photo_id

        super().__init__(
            message=message,
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            error_code="PROCESSING_ERROR",
            details=error_details,
        )


class ErrorResponse:
    """Standardized error response format."""

    @staticmethod
    def create(
        error_code: str,
        message: str,
        status_code: int,
        details: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None,
    ) -> JSONResponse:
        """Create a standardized error response."""

        error_response = {
            "error": {
                "code": error_code,
                "message": message,
                "timestamp": datetime.utcnow().isoformat(),
            }
        }

        if details:
            error_response["error"]["details"] = details

        if request_id:
            error_response["error"]["request_id"] = request_id

        # In development, include more details
        if settings.is_development() and details:
            error_response["error"]["debug"] = details

        return JSONResponse(status_code=status_code, content=error_response)


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    """Handle application-specific errors."""

    # Log the error
    logger.error(
        f"AppError: {exc.error_code} - {exc.message}",
        extra={
            "status_code": exc.status_code,
            "details": exc.details,
            "path": request.url.path,
            "method": request.method,
        },
    )

    return ErrorResponse.create(
        error_code=exc.error_code,
        message=exc.message,
        status_code=exc.status_code,
        details=exc.details if settings.is_development() else None,
        request_id=request.headers.get("X-Request-ID"),
    )


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Handle FastAPI HTTP exceptions."""

    # Map status codes to error codes
    error_code_map = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        405: "METHOD_NOT_ALLOWED",
        409: "CONFLICT",
        413: "PAYLOAD_TOO_LARGE",
        429: "TOO_MANY_REQUESTS",
        500: "INTERNAL_ERROR",
        502: "BAD_GATEWAY",
        503: "SERVICE_UNAVAILABLE",
        504: "GATEWAY_TIMEOUT",
    }

    error_code = error_code_map.get(exc.status_code, "HTTP_ERROR")

    # Log errors (but not 4xx client errors in production)
    if exc.status_code >= 500 or settings.is_development():
        logger.error(
            f"HTTPException: {exc.status_code} - {exc.detail}",
            extra={"path": request.url.path, "method": request.method},
        )

    return ErrorResponse.create(
        error_code=error_code,
        message=str(exc.detail),
        status_code=exc.status_code,
        request_id=request.headers.get("X-Request-ID"),
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Handle request validation errors."""

    # Extract validation errors
    errors = []
    for error in exc.errors():
        field_path = " -> ".join(str(loc) for loc in error["loc"])
        errors.append(
            {"field": field_path, "message": error["msg"], "type": error["type"]}
        )

    logger.warning(
        f"Validation error on {request.url.path}",
        extra={"errors": errors, "method": request.method},
    )

    return ErrorResponse.create(
        error_code="VALIDATION_ERROR",
        message="Request validation failed",
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        details={"validation_errors": errors} if settings.is_development() else None,
        request_id=request.headers.get("X-Request-ID"),
    )


async def general_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handle unexpected exceptions."""

    # Log the full traceback
    logger.error(
        f"Unexpected error: {str(exc)}",
        extra={
            "path": request.url.path,
            "method": request.method,
            "traceback": traceback.format_exc(),
        },
        exc_info=True,
    )

    # In production, return a generic error message
    if settings.is_production():
        return ErrorResponse.create(
            error_code="INTERNAL_ERROR",
            message="An unexpected error occurred. Please try again later.",
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            request_id=request.headers.get("X-Request-ID"),
        )

    # In development, include more details
    return ErrorResponse.create(
        error_code="INTERNAL_ERROR",
        message=str(exc),
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        details={
            "type": type(exc).__name__,
            "traceback": traceback.format_exc().split("\n"),
        },
        request_id=request.headers.get("X-Request-ID"),
    )


def register_error_handlers(app):
    """Register all error handlers with the FastAPI app."""

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)

    # Only catch all exceptions in production
    if settings.is_production():
        app.add_exception_handler(Exception, general_exception_handler)


# Utility functions for common error patterns
def handle_service_error(
    operation: str, error: Exception, logger_instance, user_id: int = None
) -> None:
    """
    Standard error handling pattern for service operations.
    Logs error and raises appropriate HTTPException.
    """
    error_context = {"operation": operation}
    if user_id:
        error_context["user_id"] = user_id

    logger_instance.error(
        f"Service error in {operation}: {str(error)}", extra=error_context
    )

    # Don't expose internal errors to users
    if isinstance(
        error,
        (
            ValidationError,
            AuthenticationError,
            AuthorizationError,
            ResourceNotFoundError,
        ),
    ):
        raise error
    else:
        raise ProcessingError(f"Failed to {operation}")


def require_non_empty(value: str, field_name: str) -> str:
    """Validate that a field is not empty."""
    if not value or not value.strip():
        raise ValidationError(f"{field_name} is required", field=field_name)
    return value.strip()


def require_valid_id(id_value: str, resource_name: str) -> str:
    """Validate that an ID is properly formatted."""
    if not id_value or not id_value.strip():
        raise ValidationError(
            f"{resource_name} ID is required", field=f"{resource_name.lower()}_id"
        )
    return id_value.strip()
