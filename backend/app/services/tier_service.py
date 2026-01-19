from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.user import User # Import the updated User model
import logging

logger = logging.getLogger(__name__)

TIER_CONFIGS = {
    "Free": {
        "max_uploads": 100,
        "duration_days": None,  # No expiry for free tier
        "price_cents": 0,
        "is_paid": False,
        "max_file_size_mb": 10,
        "features": ["standard_support"]
    },
    "Amateur": {
        "max_uploads": 5000,
        "duration_days": 30,
        "price_cents": 2799,  # $27.99
        "is_paid": True,
        "max_file_size_mb": 25,
        "features": ["export_csv"]
    },
    "Pro": {
        "max_uploads": 15000,
        "duration_days": 30,
        "price_cents": 4999,  # $49.99
        "is_paid": True,
        "max_file_size_mb": 50,
        "features": ["priority_support", "export_csv"]
    },
    "Power User": {
        "max_uploads": 30000,
        "duration_days": 30,
        "price_cents": 8999,  # $89.99
        "is_paid": True,
        "max_file_size_mb": 100,
        "features": ["priority_support", "export_csv"]
    },
    "Enterprise": {
        "max_uploads": -1,  # Unlimited
        "duration_days": 30,
        "price_cents": 0,  # Contact us
        "is_paid": True,
        "max_file_size_mb": 500,
        "features": ["unlimited_photos", "custom_solutions"]
    }
}

class TierService:
    """Handles all logic related to user tiers, limits, and usage tracking."""

    @staticmethod
    def get_tier_info(tier_name: str) -> dict:
        """Returns the specific limits and properties for a given tier."""
        return TIER_CONFIGS.get(tier_name, TIER_CONFIGS["Free"])

    @staticmethod
    def get_upload_limit(tier_name: str) -> int:
        """Returns the maximum allowed uploads for a tier."""
        return TierService.get_tier_info(tier_name)["max_uploads"]

    @staticmethod
    def is_tier_active(user: User) -> bool:
        """Checks if the user's current tier is still active."""

        # Free tier is always active (no expiry)
        if user.current_tier == "Free":
            return True

        # Paid tiers with no expiry date set
        if user.tier_expiry_date is None:
            if user.current_tier in ["Amateur", "Pro", "Power User", "Enterprise"]:
                return True
            return False

        # Check against an explicit expiry date
        expiry_date = user.tier_expiry_date.replace(tzinfo=timezone.utc) if user.tier_expiry_date.tzinfo is None else user.tier_expiry_date
        return datetime.now(timezone.utc) < expiry_date

    @staticmethod
    def get_effective_tier(user: User) -> str:
        """
        Returns the user's effective tier, falling back to Free if paid tier expired.
        """
        if not TierService.is_tier_active(user):
            return "Free"
        return user.current_tier

    @staticmethod
    def check_upload_allowed(user: User) -> bool:
        """
        Determines if the user is allowed to upload based on tier and usage.
        Expired paid tiers fall back to Free tier limits.
        """
        effective_tier = TierService.get_effective_tier(user)
        if effective_tier != user.current_tier:
            logger.info(f"User {user.id} tier {user.current_tier} expired, using Free tier limits")

        current_limit = TierService.get_upload_limit(effective_tier)
        allowed = user.uploads_this_period < current_limit
        if not allowed:
            logger.warning(
                f"User {user.id} ({effective_tier}) upload limit reached: "
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
            # Return default Free tier for non-existent users
            tier_config = TierService.get_tier_info("Free")
            return {
                "tier_name": "Free",
                "monthly_photo_limit": tier_config["max_uploads"],
                "features": tier_config["features"],
                "duration_days": tier_config["duration_days"],
                "price_cents": tier_config["price_cents"],
                "is_paid": tier_config["is_paid"],
                "tier_expiry_date": None,
                "is_active": False
            }
        
        # Check if tier is active, use effective tier for limits
        is_active = TierService.is_tier_active(user)
        effective_tier = TierService.get_effective_tier(user)
        tier_config = TierService.get_tier_info(effective_tier)

        return {
            "tier_name": effective_tier,  # Show effective tier (Free if expired)
            "original_tier": user.current_tier if not is_active else None,  # Track expired tier
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