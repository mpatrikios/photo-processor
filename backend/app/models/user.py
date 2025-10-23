from datetime import datetime, timezone

import bcrypt
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.security_config import BCRYPT_ROUNDS
from database import Base


class User(Base):
    """
    User model for authentication and account management.
    """

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    full_name = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_verified = Column(
        Boolean, default=False, nullable=False
    )  # For email verification
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_login = Column(DateTime(timezone=True), nullable=True)

    # Usage tracking fields
    total_photos_uploaded = Column(Integer, default=0, nullable=False)
    total_photos_processed = Column(Integer, default=0, nullable=False)
    total_exports = Column(Integer, default=0, nullable=False)

    # User preferences
    timezone = Column(String(50), default="UTC", nullable=False)
    notification_preferences = Column(Text, nullable=True)  # JSON string

    # Relationships
    processing_jobs = relationship(
        "ProcessingJob", back_populates="user", cascade="all, delete-orphan"
    )
    photos = relationship(
        "PhotoDB",
        foreign_keys="PhotoDB.user_id",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    exports = relationship(
        "ExportDB", back_populates="user", cascade="all, delete-orphan"
    )
    batch_operations = relationship(
        "BatchOperationDB", back_populates="user", cascade="all, delete-orphan"
    )
    user_sessions = relationship(
        "UserSession", back_populates="user", cascade="all, delete-orphan"
    )
    password_reset_tokens = relationship(
        "PasswordResetToken", back_populates="user", cascade="all, delete-orphan"
    )

    def set_password(self, password: str) -> None:
        """
        Hash and set the user's password using bcrypt with cost factor 12.
        """
        # Use configured cost factor for enhanced security
        salt = bcrypt.gensalt(rounds=BCRYPT_ROUNDS)
        self.password_hash = bcrypt.hashpw(password.encode("utf-8"), salt).decode(
            "utf-8"
        )

    def verify_password(self, password: str) -> bool:
        """
        Verify a password against the stored hash.
        """
        return bcrypt.checkpw(
            password.encode("utf-8"), self.password_hash.encode("utf-8")
        )

    def update_login_time(self) -> None:
        """
        Update the last login timestamp.
        """
        self.last_login = datetime.now(timezone.utc)

    def increment_photos_uploaded(self, count: int = 1) -> None:
        """
        Increment the total photos uploaded counter.
        """
        self.total_photos_uploaded += count

    def increment_photos_processed(self, count: int = 1) -> None:
        """
        Increment the total photos processed counter.
        """
        self.total_photos_processed += count

    def increment_exports(self, count: int = 1) -> None:
        """
        Increment the total exports counter.
        """
        self.total_exports += count

    def to_dict(self, include_sensitive: bool = False) -> dict:
        """
        Convert user to dictionary for API responses.
        """
        user_dict = {
            "id": self.id,
            "email": self.email,
            "full_name": self.full_name,
            "is_active": self.is_active,
            "is_verified": self.is_verified,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_login": self.last_login.isoformat() if self.last_login else None,
            "total_photos_uploaded": self.total_photos_uploaded,
            "total_photos_processed": self.total_photos_processed,
            "total_exports": self.total_exports,
            "timezone": self.timezone,
        }

        if include_sensitive:
            user_dict["notification_preferences"] = self.notification_preferences

        return user_dict

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email='{self.email}', active={self.is_active})>"


class UserSession(Base):
    """
    User session model for tracking active login sessions.
    """

    __tablename__ = "user_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String(255), unique=True, index=True, nullable=False)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at = Column(DateTime(timezone=True), nullable=False)
    last_used = Column(DateTime(timezone=True), nullable=True)
    ip_address = Column(String(45), nullable=True)  # IPv4 or IPv6
    user_agent = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    # Relationships
    user = relationship("User", back_populates="user_sessions")

    def is_expired(self) -> bool:
        """
        Check if the session is expired.
        """
        # Ensure expires_at is timezone-aware for comparison
        expires_at = self.expires_at.replace(tzinfo=timezone.utc) if self.expires_at.tzinfo is None else self.expires_at
        return datetime.now(timezone.utc) > expires_at

    def update_last_used(self) -> None:
        """
        Update the last used timestamp.
        """
        self.last_used = datetime.now(timezone.utc)

    def deactivate(self) -> None:
        """
        Deactivate the session (logout).
        """
        self.is_active = False

    def to_dict(self) -> dict:
        """
        Convert session to dictionary for API responses.
        """
        return {
            "id": self.id,
            "user_id": self.user_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "last_used": self.last_used.isoformat() if self.last_used else None,
            "is_active": self.is_active,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
        }

    def __repr__(self) -> str:
        return f"<UserSession(id={self.id}, user_id={self.user_id}, active={self.is_active})>"


class PasswordResetToken(Base):
    """
    Password reset token model for secure password recovery.
    Implements security best practices:
    - Time-limited tokens (expires in 1 hour)
    - Single use tokens
    - Secure random token generation
    - Token hash storage (not plaintext)
    """

    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String(255), unique=True, index=True, nullable=False)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    is_used = Column(Boolean, default=False, nullable=False)
    ip_address = Column(String(45), nullable=True)  # IP that requested reset
    user_agent = Column(Text, nullable=True)  # Browser info for security

    # Relationships
    user = relationship("User", back_populates="password_reset_tokens")

    def is_expired(self) -> bool:
        """Check if the token is expired."""
        # Ensure expires_at is timezone-aware for comparison
        expires_at = self.expires_at.replace(tzinfo=timezone.utc) if self.expires_at.tzinfo is None else self.expires_at
        return datetime.now(timezone.utc) > expires_at

    def is_valid(self) -> bool:
        """Check if the token is valid (not used and not expired)."""
        return not self.is_used and not self.is_expired()

    def mark_as_used(self) -> None:
        """Mark the token as used."""
        self.is_used = True
        self.used_at = datetime.now(timezone.utc)

    def __repr__(self) -> str:
        return f"<PasswordResetToken(id={self.id}, user_id={self.user_id}, used={self.is_used})>"
