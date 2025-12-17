from enum import Enum
from typing import Dict, Any

class TierType(str, Enum):
    FREE = "free"
    BASIC = "basic"
    PRO = "pro"

# Define tier limits and features
TIER_CONFIGS = {
    TierType.FREE: {
        "monthly_photo_limit": 1000,
        "max_file_size_mb": 10,
        "storage_limit_gb": 1,
        "features": ["basic_sorting", "standard_support"],
        "duration_days": 30,
        "price_cents": 0
    },
    TierType.BASIC: {
        "monthly_photo_limit": 10000,
        "max_file_size_mb": 25,
        "storage_limit_gb": 10,
        "features": ["basic_sorting", "priority_support", "export_csv"],
        "duration_days": 30,
        "price_cents": 999
    },
    TierType.PRO: {
        "monthly_photo_limit": 30000,
        "max_file_size_mb": 50,
        "storage_limit_gb": 100,
        "features": ["advanced_sorting", "priority_support", "export_csv", "raw_support"],
        "duration_days": 30,
        "price_cents": 1999
    }
}

def get_tier_info(tier_name: str) -> Dict[str, Any]:
    """Get configuration for a specific tier."""
    # Default to FREE if tier not found or invalid
    try:
        tier_enum = TierType(tier_name.lower()) if tier_name else TierType.FREE
    except ValueError:
        tier_enum = TierType.FREE
        
    return TIER_CONFIGS.get(tier_enum, TIER_CONFIGS[TierType.FREE])

def get_upload_limit_by_tier(tier_name: str) -> int:
    """Helper to just get the photo count limit."""
    info = get_tier_info(tier_name)
    return info["monthly_photo_limit"]