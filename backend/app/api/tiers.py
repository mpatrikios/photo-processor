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
        frontend_tiers[tier_name] = {
            "name": tier_name,
            "price": config["price_cents"] / 100.0,  # Convert cents to dollars
            "maxUploads": config["max_uploads"],
            "features": transform_features(tier_name, config)
        }
    
    return frontend_tiers


def transform_features(tier_name: str, config: dict) -> list:
    """
    Transform backend feature codes to frontend display strings.
    """
    features = []
    
    # Add upload limit as first feature
    max_uploads = config["max_uploads"]
    if tier_name == "Trial":
        duration_days = config.get("duration_days", 3)
        features.append(f"{max_uploads} Photos ({duration_days} days)")
    else:
        features.append(f"{max_uploads:,} Photos/Month")
    
    # Transform backend feature codes to display strings
    feature_map = {
        "advanced_sorting": {"text": "Advanced sorting (coming soon!)", "style": "color: #6c757d; font-style: italic;"},
        "standard_support": "Standard support", 
        "priority_support": "Priority support",
        "export_csv": "CSV export",
        "raw_support": "RAW support",
        "ai_features": "AI features"
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