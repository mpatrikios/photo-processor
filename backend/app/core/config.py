"""
Environment configuration and validation module.
Ensures all required environment variables are set and validates their values.
"""

import os
import secrets
from typing import List, Optional

from dotenv import load_dotenv
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings

# Load environment variables from .env file
load_dotenv()


class Settings(BaseSettings):
    """
    Application settings with validation.
    Values are loaded from environment variables.
    """

    # Security
    jwt_secret_key: str = Field(
        default_factory=lambda: secrets.token_urlsafe(32),
        description="JWT secret key for token signing",
    )
    jwt_algorithm: str = Field(default="HS256")
    jwt_access_token_expire_minutes: int = Field(default=60)
    jwt_refresh_token_expire_days: int = Field(default=7)

    # API Configuration
    api_host: str = Field(default="0.0.0.0")
    api_port: int = Field(default=8000)
    cors_origins: List[str] = Field(default=[
        "http://localhost:5173",                      # Local Development
        "http://localhost:8000",                      # Local Backend docs
        "https://tagsort-api-486078451066.web.app",   # 👈 ADD YOUR FIREBASE FRONTEND URL HERE
        "https://tagsort-api-486078451066.firebaseapp.com", 
        "https://tagsort.web.app",# 👈 AND THIS ONE
    ])

    # AI Vision APIs
    gemini_api_key: Optional[str] = Field(default=None, description="Gemini Flash API key")
    google_application_credentials: Optional[str] = Field(default=None)
    google_cloud_project: Optional[str] = Field(default=None)

    # Stripe Configuration
    stripe_secret_key: Optional[str] = Field(default=None)
    stripe_webhook_secret: Optional[str] = Field(default=None)
    stripe_publishable_key: Optional[str] = Field(default=None)

    # Database
    database_url: str = Field(default="sqlite:///./tag_photos.db")

    # Email Configuration
    admin_email: Optional[str] = Field(default=None)
    smtp_host: Optional[str] = Field(default=None)
    smtp_port: Optional[int] = Field(default=587)
    smtp_username: Optional[str] = Field(default=None)
    smtp_password: Optional[str] = Field(default=None)
    smtp_use_tls: bool = Field(default=True)

    # Application Settings
    environment: str = Field(default="development")
    debug: bool = Field(default=False)
    max_file_size_mb: int = Field(default=30)  # Increased for uncompressed race photos
    max_files_per_upload: int = Field(default=100)
    processing_timeout_seconds: int = Field(default=300)
    rate_limit_per_minute: int = Field(default=60)

    # Storage Configuration
    upload_dir: str = Field(default="uploads")
    export_dir: str = Field(default="exports")
    temp_dir: str = Field(default="temp")

    # Google Cloud Storage (optional)
    bucket_name: Optional[str] = Field(default=None, description="Google Cloud Storage bucket name")

    # AWS S3 (optional)
    aws_access_key_id: Optional[str] = Field(default=None)
    aws_secret_access_key: Optional[str] = Field(default=None)
    aws_s3_bucket: Optional[str] = Field(default=None)
    aws_region: str = Field(default="us-east-1")


    # Monitoring
    sentry_dsn: Optional[str] = Field(default=None)
    log_level: str = Field(default="INFO")
    log_file_path: Optional[str] = Field(default=None)

    @field_validator("jwt_secret_key")
    @classmethod
    def validate_jwt_secret(cls, v, info):
        """Ensure JWT secret is secure in production."""
        environment = (
            info.data.get("environment", "development") if info.data else "development"
        )
        if environment == "production":
            if not v or v == "CHANGE_THIS_TO_A_SECURE_RANDOM_STRING_IN_PRODUCTION":
                raise ValueError(
                    "JWT_SECRET_KEY must be set to a secure value in production! "
                    'Generate one with: python3 -c "import secrets; print(secrets.token_urlsafe(32))"'
                )
            if len(v) < 32:
                raise ValueError(
                    "JWT_SECRET_KEY must be at least 32 characters in production"
                )
        return v

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v):
        """Parse CORS origins from Cloud Run JSON array or comma-separated format."""
        if isinstance(v, str):
            v = v.strip()
            
            # Handle empty strings
            if not v:
                return ["http://localhost:5173"]  # Default for development
            
            # Handle Cloud Run JSON array format: ["url1", "url2", ...]
            if v.startswith("[") and v.endswith("]"):
                try:
                    import json
                    return json.loads(v)
                except json.JSONDecodeError:
                    # Fallback: strip brackets and parse as comma-separated
                    v = v.strip("[]").replace('"', '').replace("'", "")
            
            # Parse as comma-separated string: url1,url2,url3
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    @field_validator("database_url", mode="before")
    @classmethod
    def validate_database_url(cls, v: str, info):
        """Ensure production uses PostgreSQL and format is correct."""
        import os
        
        # Access environment safely from info.data if available, else os.environ
        env = info.data.get("environment") if info.data else os.getenv("ENVIRONMENT", "development")
        
        if env == "production":
            if "sqlite" in v:
                raise ValueError("SQLite is not allowed in production. Set DATABASE_URL to PostgreSQL.")
            
            # Cloud Run/SQLAlchemy fix: sqlalchemy requires 'postgresql://' not 'postgres://'
            if v.startswith("postgres://"):
                v = v.replace("postgres://", "postgresql://", 1)
                
        return v

    @field_validator("smtp_password")
    @classmethod
    def validate_smtp_password(cls, v, info):
        """Warn about SMTP password security."""
        if v and info.data and info.data.get("environment") == "production":
            if len(v) < 16:
                # Note: Short SMTP password - consider app-specific passwords
                pass
        return v

    @field_validator("environment")
    @classmethod
    def validate_environment(cls, v):
        """Validate environment value."""
        valid_environments = ["development", "staging", "production"]
        if v not in valid_environments:
            raise ValueError(
                f"ENVIRONMENT must be one of: {', '.join(valid_environments)}"
            )
        return v

    @field_validator("debug")
    @classmethod
    def validate_debug(cls, v, info):
        """Ensure debug is disabled in production."""
        if info.data and info.data.get("environment") == "production" and v:
            import logging

            logging.getLogger(__name__).warning(
                "DEBUG mode is enabled in production! This should be set to false."
            )
        return v

    model_config = {"env_file": ".env", "case_sensitive": False}

    def get_max_file_size_bytes(self) -> int:
        """Get maximum file size in bytes."""
        return self.max_file_size_mb * 1024 * 1024

    def is_production(self) -> bool:
        """Check if running in production environment."""
        return self.environment == "production"

    def is_development(self) -> bool:
        """Check if running in development environment."""
        return self.environment == "development"

    def get_jwt_secret_bytes(self) -> bytes:
        """Get JWT secret as bytes for signing."""
        return self.jwt_secret_key.encode("utf-8")

    def create_directories(self):
        """Create required directories if they don't exist."""
        for dir_path in [self.upload_dir, self.export_dir, self.temp_dir]:
            os.makedirs(dir_path, exist_ok=True)
            # Set secure permissions (owner only)
            os.chmod(dir_path, 0o700)

    def validate_google_vision_setup(self) -> bool:
        """Check if Google Vision API is properly configured."""
        if self.google_application_credentials:
            if not os.path.exists(self.google_application_credentials):
                import logging

                logging.getLogger(__name__).warning(
                    f"Google Cloud credentials file not found: {self.google_application_credentials}"
                )
                return False
            return True
        elif self.google_cloud_project:
            return True
        else:
            import logging

            logging.getLogger(__name__).info(
                "Google Cloud Vision not configured, will use Tesseract OCR only"
            )
            return False

    def get_smtp_config(self) -> Optional[dict]:
        """Get SMTP configuration if available."""
        if all([self.smtp_host, self.smtp_username, self.smtp_password]):
            return {
                "host": self.smtp_host,
                "port": self.smtp_port,
                "username": self.smtp_username,
                "password": self.smtp_password,
                "use_tls": self.smtp_use_tls,
                "admin_email": self.admin_email,
            }
        return None

    def print_startup_info(self):
        """Log configuration information on startup."""
        import logging

        logger = logging.getLogger(__name__)

        logger.info("=" * 50)
        logger.info("TagSort Configuration")
        logger.info("=" * 50)
        logger.info(f"Environment: {self.environment}")
        logger.info(f"Debug Mode: {self.debug}")
        logger.info(f"API: {self.api_host}:{self.api_port}")
        logger.info(f"CORS Origins: {', '.join(self.cors_origins)}")
        logger.info(f"Max File Size: {self.max_file_size_mb}MB")
        logger.info(f"Rate Limit: {self.rate_limit_per_minute} requests/minute")

        if self.gemini_api_key:
            logger.info("Gemini Flash API: Configured ✅")
        else:
            logger.error("Gemini Flash API: Not configured ❌")

        if self.get_smtp_config():
            logger.info("Email: Configured")
        else:
            logger.info("Email: Not configured")

        if self.is_production():
            logger.warning(
                "Running in PRODUCTION mode - ensure all security settings are configured!"
            )

        logger.info("=" * 50)


# Create global settings instance
settings = Settings()

# Validate critical settings on import
if settings.is_production():
    # In production, ensure critical security settings
    if not settings.jwt_secret_key or len(settings.jwt_secret_key) < 32:
        raise ValueError("Invalid JWT_SECRET_KEY for production environment")

    if settings.debug:
        import logging

        logging.getLogger(__name__).critical("Debug mode is ON in production!")

# Create required directories
settings.create_directories()
