# --- INSTRUCTIONS TO CREATE backend/app/services/tier_service.py ---

from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from app.models.user import User # Import the updated User model
import logging

logger = logging.getLogger(__name__)

TIER_CONFIGS = {
    "Trial": {
        "max_uploads": 100,  # Updated from 50 to 100 photos
        "duration_days": 3,
        "price_cents": 0,
        "is_paid": False,
        "max_file_size_mb": 10,
        "features": ["standard_support"]  # Simplified - removed basic_sorting
    },
    "Basic": {
        "max_uploads": 1000,
        "duration_days": 30,
        "price_cents": 999,  # $9.99
        "is_paid": True,
        "max_file_size_mb": 25,
        "features": ["export_csv"]  # Simplified - removed basic_sorting
    },
    "Pro": {
        "max_uploads": 5000,
        "duration_days": 30,
        "price_cents": 2999,  # $29.99
        "is_paid": True,
        "max_file_size_mb": 50,
        "features": ["priority_support", "export_csv", "advanced_sorting"]  # Simplified, advanced_sorting as coming soon
    }
}

class TierService:
    """Handles all logic related to user tiers, limits, and usage tracking."""

    @staticmethod
    def get_tier_info(tier_name: str) -> dict:
        """Returns the specific limits and properties for a given tier."""
        return TIER_CONFIGS.get(tier_name, TIER_CONFIGS["Trial"])

    @staticmethod
    def get_upload_limit(tier_name: str) -> int:
        """Returns the maximum allowed uploads for a tier."""
        return TierService.get_tier_info(tier_name)["max_uploads"]

    @staticmethod
    def is_tier_active(user: User) -> bool:
        """Checks if the user's current tier (trial or paid) is still active."""
        
        # Trial/Paid tier has no expiry date set (e.g., perpetual)
        if user.tier_expiry_date is None:
            # Check if the user is in a paid tier
            if user.current_tier in ["Basic", "Pro"]:
                return True
            
            # Check for a new user who just started their trial
            if user.current_tier == "Trial":
                # Check 3-day limit from creation date
                trial_duration = TIER_CONFIGS["Trial"]["duration_days"]
                trial_ends_at = user.created_at + timedelta(days=trial_duration)
                return datetime.now(timezone.utc) < trial_ends_at
            
            return False
            
        # Check against an explicit expiry date
        expiry_date = user.tier_expiry_date.replace(tzinfo=timezone.utc) if user.tier_expiry_date.tzinfo is None else user.tier_expiry_date
        return datetime.now(timezone.utc) < expiry_date

    @staticmethod
    def check_upload_allowed(user: User) -> bool:
        """
        Determines if the user is allowed to upload based on tier and usage.
        """
        if not TierService.is_tier_active(user):
            logger.warning(f"User {user.id} upload denied: Tier {user.current_tier} expired.")
            return False

        current_limit = TierService.get_upload_limit(user.current_tier)
        allowed = user.uploads_this_period < current_limit
        if not allowed:
            logger.warning(
                f"User {user.id} ({user.current_tier}) upload limit reached: "
                f"{user.uploads_this_period} / {current_limit}"
            )
        return allowed

    @staticmethod
    def get_user_tier(db: Session, user_id: int) -> dict:
        """
        Gets comprehensive tier information for a specific user.
        Returns tier config combined with user-specific data.
        """
        # Get user from database
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            # Return default/trial tier for non-existent users
            tier_config = TierService.get_tier_info("Trial")
            return {
                "tier_name": "Trial",
                "monthly_photo_limit": tier_config["max_uploads"],
                "features": tier_config["features"],
                "duration_days": tier_config["duration_days"],
                "price_cents": tier_config["price_cents"],
                "is_paid": tier_config["is_paid"],
                "tier_expiry_date": None,
                "is_active": False
            }
        
        # Get tier configuration for user's current tier
        tier_config = TierService.get_tier_info(user.current_tier)
        
        # Check if tier is active
        is_active = TierService.is_tier_active(user)
        
        return {
            "tier_name": user.current_tier,
            "monthly_photo_limit": tier_config["max_uploads"],
            "features": tier_config["features"],
            "duration_days": tier_config["duration_days"],
            "price_cents": tier_config["price_cents"],
            "is_paid": tier_config["is_paid"],
            "tier_expiry_date": user.tier_expiry_date.isoformat() if user.tier_expiry_date else None,
            "is_active": is_active
        }

    @staticmethod
    def increment_upload_count(db: Session, user: User, count: int = 1) -> None:
        """
        Increments the upload counter for the current billing period.
        Must be called AFTER a successful upload.
        """
        user.increment_uploads_this_period(count)
        db.add(user)
        # Commit will be handled by the caller's transaction (e.g., the upload route)


def get_tier_info(tier_name: str) -> dict:
    """
    Standalone function for external modules (e.g., stripe_service.py).
    Returns tier configuration including pricing and features.
    """
    return TierService.get_tier_info(tier_name)

# Instantiate the service for easy import
tier_service = TierService()