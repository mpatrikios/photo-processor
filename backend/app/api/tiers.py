import logging
from fastapi import APIRouter
from app.services.tier_service import TIER_CONFIGS

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/")
async def get_tiers():
    """
    Get all available tier configurations.
    Public endpoint - no authentication required for pricing display.
    
    Returns tier data formatted for frontend consumption.
    """
    # Transform backend tier config to frontend-friendly format
    frontend_tiers = {}
    
    for tier_name, config in TIER_CONFIGS.items():
        # Handle custom pricing (-1) for Enterprise tier
        price_cents = config["price_cents"]
        price = None if price_cents == -1 else price_cents / 100.0

        frontend_tiers[tier_name] = {
            "name": tier_name,
            "price": price,
            "maxUploads": config["max_uploads"],
            "features": transform_features(tier_name, config),
            "isEnterprise": tier_name == "Enterprise"
        }
    
    return frontend_tiers


def transform_features(tier_name: str, config: dict) -> list:
    """
    Transform backend feature codes to structured frontend data.
    Returns structured objects that frontend formats (no HTML in API responses).
    """
    features = []

    # Add upload limit as first feature (structured data, frontend formats)
    max_uploads = config["max_uploads"]
    if tier_name == "Enterprise":
        features.append({"value": "Unlimited", "unit": "Photos/Month", "emphasis": True})
    else:
        features.append({"value": max_uploads, "unit": "Photos/Month", "emphasis": True})

    # Transform backend feature codes to display strings
    feature_map = {
        "standard_support": "Standard support",
        "priority_support": "Priority support",
        "export_csv": "CSV export",
        "unlimited_photos": "Unlimited photos",
        "custom_solutions": "Custom solutions"
    }

    backend_features = config.get("features", [])
    for feature_code in backend_features:
        if feature_code in feature_map:
            features.append(feature_map[feature_code])
        else:
            # Log warning for unmapped feature
            logger.warning("Unmapped feature code '%s' in tier '%s'", feature_code, tier_name)

            # Fallback: convert snake_case to Title Case
            fallback_name = feature_code.replace("_", " ").title()
            features.append(fallback_name)

    return features