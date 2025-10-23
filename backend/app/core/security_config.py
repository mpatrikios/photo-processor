"""
Security configuration module for TagSort application.
Centralizes all security-related settings and constants.
"""

# Password Security Configuration
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
BCRYPT_ROUNDS = 12  # Cost factor for bcrypt hashing

# JWT Configuration
JWT_TOKEN_PREFIX = "Bearer"
JWT_HEADER_NAME = "Authorization"

# Rate Limiting
DEFAULT_RATE_LIMIT = "100/minute"
AUTH_RATE_LIMIT = "5/minute"  # Stricter for auth endpoints
UPLOAD_RATE_LIMIT = "30/minute"

# File Upload Security
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff"}
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10MB
MAX_FILES_PER_REQUEST = 100

# Session Security
SESSION_TIMEOUT_MINUTES = 60
REFRESH_TOKEN_EXPIRE_DAYS = 7
MAX_SESSIONS_PER_USER = 10

# Security Headers
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';",
}

# Input Validation
MAX_EMAIL_LENGTH = 255
MAX_NAME_LENGTH = 255
ALLOWED_TIMEZONE_PATTERN = r"^[A-Za-z]+/[A-Za-z_]+$"

# Audit Logging
SECURITY_EVENTS_TO_LOG = [
    "login_success",
    "login_failure",
    "password_change",
    "account_created",
    "account_deleted",
    "session_expired",
    "rate_limit_exceeded",
    "suspicious_activity",
]
