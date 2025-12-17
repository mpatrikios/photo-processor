# --- INSTRUCTIONS TO CREATE backend/app/services/tier_service.py ---

from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from app.models.user import User # Import the updated User model
import logging

logger = logging.getLogger(__name__)

# --- TIER DEFINITIONS ---
# Defines the limits and trial parameters for each tier.
TIER_LIMITS = {
    "Trial": {
        "max_uploads": 50,  # A reasonable limit for a trial
        "duration_days": 3,
        "is_paid": False
    },
    "Basic": {
        "max_uploads": 1000,
        "duration_days": 30, # Monthly billing cycle assumed
        "is_paid": True
    },
    "Pro": {
        "max_uploads": 5000,
        "duration_days": 30,
        "is_paid": True
    },
    "Enterprise": {
        "max_uploads": 9999999, # Effectively unlimited
        "duration_days": 365,
        "is_paid": True
    }
}

class TierService:
    """Handles all logic related to user tiers, limits, and usage tracking."""

    @staticmethod
    def get_tier_info(tier_name: str) -> dict:
        """Returns the specific limits and properties for a given tier."""
        return TIER_LIMITS.get(tier_name, TIER_LIMITS["Trial"])

    @staticmethod
    def get_upload_limit(tier_name: str) -> int:
        """Returns the maximum allowed uploads for a tier."""
        return TierService.get_tier_info(tier_name)["max_uploads"]

    @staticmethod
    def is_tier_active(user: User) -> bool:
        """Checks if the user's current tier (trial or paid) is still active."""
        
        # Trial/Paid tier has no expiry date set (e.g., perpetual)
        if user.tier_expiry_date is None:
            # Check if the user is in a basic tier or higher (paid tier)
            if user.current_tier in ["Basic", "Pro", "Enterprise"]:
                return True
            
            # Check for a new user who just started their trial
            if user.current_tier == "Trial":
                # Check 3-day limit from creation date
                trial_duration = TIER_LIMITS["Trial"]["duration_days"]
                trial_ends_at = user.created_at + timedelta(days=trial_duration)
                return datetime.now(timezone.utc) < trial_ends_at
            
            return False # Should not happen, but defaults to false
            
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
        
        # Enterprise or high limit tiers usually don't need strict enforcement
        if current_limit > 100000:
            return True

        allowed = user.uploads_this_period < current_limit
        if not allowed:
            logger.warning(
                f"User {user.id} ({user.current_tier}) upload limit reached: "
                f"{user.uploads_this_period} / {current_limit}"
            )
        return allowed

    @staticmethod
    def increment_upload_count(db: Session, user: User, count: int = 1) -> None:
        """
        Increments the upload counter for the current billing period.
        Must be called AFTER a successful upload.
        """
        user.increment_uploads_this_period(count)
        db.add(user)
        # Commit will be handled by the caller's transaction (e.g., the upload route)


# Instantiate the service for easy import
tier_service = TierService()