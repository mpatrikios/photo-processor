"""
Secure Multi-Tenant File Management Service
Provides user-isolated file operations with strict security controls.
"""

import logging
import os
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


class SecureFileManager:
    """
    Multi-tenant file manager with strict user isolation.
    All file operations are scoped to specific users.
    """

    def __init__(self):
        self.base_upload_dir = Path(settings.upload_dir)
        self.base_processed_dir = Path("processed")
        self.base_export_dir = Path("exports")
        self.base_temp_dir = Path("temp")

        # Ensure base directories exist
        self._ensure_base_directories()

    def _ensure_base_directories(self):
        """Create base directories if they don't exist."""
        for directory in [
            self.base_upload_dir,
            self.base_processed_dir,
            self.base_export_dir,
            self.base_temp_dir,
        ]:
            directory.mkdir(mode=0o755, exist_ok=True)

    def _get_user_directory(self, base_dir: Path, user_id: int) -> Path:
        """
        Get user-specific directory with proper isolation.
        Creates directory if it doesn't exist with secure permissions.
        """
        user_dir = base_dir / str(user_id)
        user_dir.mkdir(mode=0o700, exist_ok=True)  # User-only access
        return user_dir

    def _validate_user_path(self, file_path: Path, user_id: int) -> bool:
        """
        Validate that a file path belongs to the specified user.
        Prevents path traversal and unauthorized access.
        """
        try:
            # Resolve any relative paths and symlinks
            resolved_path = file_path.resolve()

            # Check if path is within any of the user's allowed directories
            user_dirs = [
                self._get_user_directory(self.base_upload_dir, user_id),
                self._get_user_directory(self.base_processed_dir, user_id),
                self._get_user_directory(self.base_export_dir, user_id),
                self._get_user_directory(self.base_temp_dir, user_id),
            ]

            for user_dir in user_dirs:
                try:
                    resolved_path.relative_to(user_dir.resolve())
                    return True
                except ValueError:
                    continue

            return False
        except Exception as e:
            logger.error(f"Path validation error: {e}")
            return False

    def get_user_upload_dir(self, user_id: int) -> Path:
        """Get user's upload directory."""
        return self._get_user_directory(self.base_upload_dir, user_id)

    def get_user_processed_dir(
        self, user_id: int, job_id: Optional[str] = None
    ) -> Path:
        """Get user's processed directory, optionally scoped to a job."""
        user_dir = self._get_user_directory(self.base_processed_dir, user_id)
        if job_id:
            job_dir = user_dir / job_id
            job_dir.mkdir(mode=0o700, exist_ok=True)
            return job_dir
        return user_dir

    def get_user_export_dir(self, user_id: int) -> Path:
        """Get user's export directory."""
        return self._get_user_directory(self.base_export_dir, user_id)

    def get_user_temp_dir(self, user_id: int, job_id: Optional[str] = None) -> Path:
        """Get user's temporary directory, optionally scoped to a job."""
        user_dir = self._get_user_directory(self.base_temp_dir, user_id)
        if job_id:
            job_dir = user_dir / job_id
            job_dir.mkdir(mode=0o700, exist_ok=True)
            return job_dir
        return user_dir

    def save_user_file(
        self,
        user_id: int,
        file_data: bytes,
        filename: str,
        directory_type: str = "upload",
    ) -> Path:
        """
        Save a file to user's directory with security validation.

        Args:
            user_id: User ID for isolation
            file_data: File content as bytes
            filename: Original filename (will be sanitized)
            directory_type: "upload", "processed", "export", or "temp"

        Returns:
            Path to saved file
        """
        # Sanitize filename
        safe_filename = self._sanitize_filename(filename)

        # Get appropriate directory
        if directory_type == "upload":
            target_dir = self.get_user_upload_dir(user_id)
        elif directory_type == "processed":
            target_dir = self.get_user_processed_dir(user_id)
        elif directory_type == "export":
            target_dir = self.get_user_export_dir(user_id)
        elif directory_type == "temp":
            target_dir = self.get_user_temp_dir(user_id)
        else:
            raise ValueError(f"Invalid directory type: {directory_type}")

        # Create unique filename to prevent conflicts
        unique_filename = f"{uuid.uuid4().hex}_{safe_filename}"
        file_path = target_dir / unique_filename

        # Write file securely
        with open(file_path, "wb") as f:
            f.write(file_data)

        # Set secure permissions
        file_path.chmod(0o600)  # User read/write only

        logger.info(f"File saved securely: {file_path} for user {user_id}")
        return file_path

    def get_user_file(self, user_id: int, file_path: str) -> Optional[Path]:
        """
        Securely retrieve a file path for a user.
        Validates that the file belongs to the user.
        """
        path = Path(file_path)

        # Validate user ownership
        if not self._validate_user_path(path, user_id):
            logger.warning(
                f"Security: User {user_id} attempted to access unauthorized file: {file_path}"
            )
            return None

        if not path.exists():
            return None

        return path

    def delete_user_file(self, user_id: int, file_path: str) -> bool:
        """
        Securely delete a user's file.
        Validates ownership before deletion.
        """
        path = Path(file_path)

        # Validate user ownership
        if not self._validate_user_path(path, user_id):
            logger.warning(
                f"Security: User {user_id} attempted to delete unauthorized file: {file_path}"
            )
            return False

        try:
            if path.exists():
                path.unlink()
                logger.info(f"File deleted: {file_path} by user {user_id}")
                return True
        except Exception as e:
            logger.error(f"Error deleting file {file_path}: {e}")

        return False

    def list_user_files(
        self, user_id: int, directory_type: str = "upload", pattern: str = "*"
    ) -> List[Path]:
        """
        List files in user's directory.

        Args:
            user_id: User ID for isolation
            directory_type: "upload", "processed", "export", or "temp"
            pattern: Glob pattern for filtering
        """
        if directory_type == "upload":
            target_dir = self.get_user_upload_dir(user_id)
        elif directory_type == "processed":
            target_dir = self.get_user_processed_dir(user_id)
        elif directory_type == "export":
            target_dir = self.get_user_export_dir(user_id)
        elif directory_type == "temp":
            target_dir = self.get_user_temp_dir(user_id)
        else:
            raise ValueError(f"Invalid directory type: {directory_type}")

        try:
            return list(target_dir.glob(pattern))
        except Exception as e:
            logger.error(f"Error listing files for user {user_id}: {e}")
            return []

    def cleanup_user_temp_files(
        self, user_id: int, job_id: Optional[str] = None
    ) -> bool:
        """
        Clean up user's temporary files.
        If job_id provided, only cleans that job's temp files.
        """
        try:
            if job_id:
                temp_dir = self.get_user_temp_dir(user_id, job_id)
                if temp_dir.exists():
                    shutil.rmtree(temp_dir)
            else:
                temp_dir = self.get_user_temp_dir(user_id)
                # Clean all subdirectories but keep the user temp dir
                for item in temp_dir.iterdir():
                    if item.is_dir():
                        shutil.rmtree(item)
                    else:
                        item.unlink()

            logger.info(f"Temp files cleaned for user {user_id}, job {job_id}")
            return True
        except Exception as e:
            logger.error(f"Error cleaning temp files for user {user_id}: {e}")
            return False

    def get_user_storage_stats(self, user_id: int) -> Dict[str, Any]:
        """Get storage statistics for a user."""
        stats = {
            "user_id": user_id,
            "upload_count": 0,
            "upload_size_bytes": 0,
            "processed_count": 0,
            "processed_size_bytes": 0,
            "export_count": 0,
            "export_size_bytes": 0,
            "temp_count": 0,
            "temp_size_bytes": 0,
        }

        directories = [
            ("upload", self.get_user_upload_dir(user_id)),
            ("processed", self.get_user_processed_dir(user_id)),
            ("export", self.get_user_export_dir(user_id)),
            ("temp", self.get_user_temp_dir(user_id)),
        ]

        for dir_type, directory in directories:
            if directory.exists():
                for file_path in directory.rglob("*"):
                    if file_path.is_file():
                        stats[f"{dir_type}_count"] += 1
                        try:
                            stats[f"{dir_type}_size_bytes"] += file_path.stat().st_size
                        except OSError:
                            pass  # File might be deleted between listing and stat

        return stats

    @staticmethod
    def _sanitize_filename(filename: str) -> str:
        """
        Sanitize filename to prevent security issues.
        Removes path traversal attempts and dangerous characters.
        """
        # Remove path separators and dangerous characters
        unsafe_chars = ["/", "\\", "..", "<", ">", ":", '"', "|", "?", "*", "\0"]
        safe_name = filename

        for char in unsafe_chars:
            safe_name = safe_name.replace(char, "_")

        # Limit length
        if len(safe_name) > 255:
            name, ext = os.path.splitext(safe_name)
            safe_name = name[:250] + ext

        # Ensure not empty
        if not safe_name or safe_name.isspace():
            safe_name = "file"

        return safe_name


# Global instance
secure_file_manager = SecureFileManager()
