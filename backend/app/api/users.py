from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.auth import get_current_user, require_admin
from app.models.user import User
from app.services.usage_tracker import usage_tracker
from app.services.analytics_service import analytics_service
from database import get_db

router = APIRouter()


@router.get("/me/stats")
async def get_my_usage_stats(
    days: int = Query(30, ge=1, le=365, description="Number of days to look back"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get detailed usage statistics for the current user."""

    stats = analytics_service.get_user_stats(db, current_user.id, days)

    return {
        "user": current_user.to_dict(),
        "stats": stats,
        "message": f"Usage statistics for the last {days} days",
    }


@router.get("/me/quota")
async def get_my_quota(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get current user's quota information."""

    quota = usage_tracker.get_or_create_user_quota(db, current_user.id)

    return {
        "user_id": current_user.id,
        "quota": quota.to_dict(),
        "message": "Current quota information",
    }


@router.get("/me/timeline")
async def get_my_activity_timeline(
    days: int = Query(7, ge=1, le=30, description="Number of days to look back"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get activity timeline for the current user."""

    timeline = analytics_service.get_user_activity_timeline(db, current_user.id, days)

    return {
        "user_id": current_user.id,
        "timeline": timeline,
        "period_days": days,
        "message": f"Activity timeline for the last {days} days",
    }


@router.get("/me/processing-jobs")
async def get_my_processing_jobs(
    limit: int = Query(10, ge=1, le=100, description="Number of jobs to return"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get recent processing jobs for the current user."""

    from app.models.usage import ProcessingJob

    jobs = (
        db.query(ProcessingJob)
        .filter(ProcessingJob.user_id == current_user.id)
        .order_by(ProcessingJob.created_at.desc())
        .limit(limit)
        .all()
    )

    return {
        "user_id": current_user.id,
        "jobs": [job.to_dict() for job in jobs],
        "total_jobs": len(jobs),
        "message": f"Last {len(jobs)} processing jobs",
    }


@router.put("/me/profile")
async def update_my_profile(
    full_name: Optional[str] = None,
    timezone: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update current user's profile information."""

    updated_fields = []

    if full_name is not None:
        if len(full_name.strip()) < 2:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Full name must be at least 2 characters long",
            )
        current_user.full_name = full_name.strip()
        updated_fields.append("full_name")

    if timezone is not None:
        # Basic timezone validation
        if len(timezone.strip()) > 0:
            current_user.timezone = timezone.strip()
            updated_fields.append("timezone")

    if updated_fields:
        db.commit()
        db.refresh(current_user)

    return {
        "user": current_user.to_dict(),
        "updated_fields": updated_fields,
        "message": (
            f"Profile updated: {', '.join(updated_fields)}"
            if updated_fields
            else "No changes made"
        ),
    }


@router.put("/me/email")
async def change_my_email(
    new_email: str,
    password: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change current user's email address."""
    
    # Verify password for security
    if not current_user.verify_password(password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect"
        )
    
    # Check if email is already taken
    existing_user = db.query(User).filter(User.email == new_email.lower().strip()).first()
    if existing_user and existing_user.id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email address is already in use"
        )
    
    # Update email
    current_user.email = new_email.lower().strip()
    db.commit()
    db.refresh(current_user)
    
    return {
        "user": current_user.to_dict(),
        "message": "Email address updated successfully"
    }


@router.get("/me/subscription")
async def get_my_subscription(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get current user's subscription information."""
    
    # Get user tier information
    from app.services.tier_service import tier_service
    
    tier_info = tier_service.get_user_tier(db, current_user.id)
    
    subscription_info = {
        "tier_name": tier_info.get("tier_name", "free"),
        "monthly_photo_limit": tier_info.get("monthly_photo_limit", 100),
        "features": tier_info.get("features", []),
        "is_premium": tier_info.get("tier_name", "free") != "free"
    }
    
    # Add Stripe subscription status if user has one
    if current_user.stripe_customer_id:
        subscription_info.update({
            "has_stripe_subscription": True,
            "manage_billing_url": "/api/payment/billing-portal"
        })
    else:
        subscription_info.update({
            "has_stripe_subscription": False,
            "manage_billing_url": None
        })
    
    return {
        "subscription": subscription_info,
        "message": "Subscription information retrieved successfully"
    }


@router.delete("/me/account")
async def delete_my_account(
    confirm_email: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete current user's account (soft delete)."""

    if confirm_email.lower() != current_user.email.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email confirmation does not match your account email",
        )

    # Soft delete - deactivate account
    current_user.is_active = False

    # Deactivate all sessions
    from app.services.auth_service import auth_service

    auth_service.logout_all_sessions(db, current_user)

    # Log account deletion
    from app.models.usage import ActionType

    usage_tracker.log_action(
        db=db,
        user_id=current_user.id,
        action_type=ActionType.LOGOUT,  # Using logout as closest action type
        details={"action": "account_deactivated"},
        success=True,
    )

    db.commit()

    return {"message": "Account has been deactivated successfully"}


# Admin endpoints (for future use)
@router.get("/stats/system")
async def get_system_stats(
    days: int = Query(30, ge=1, le=365, description="Number of days to look back"),
    admin_user: User = Depends(require_admin),  # SECURITY: Admin-only access
    db: Session = Depends(get_db),
):
    """Get system-wide usage statistics. ADMIN ONLY."""

    stats = usage_tracker.get_system_stats(db, days)

    return {"stats": stats, "message": f"System statistics for the last {days} days"}


@router.get("/stats/popular-hours")
async def get_popular_hours(
    days: int = Query(30, ge=1, le=365, description="Number of days to look back"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get usage statistics by hour of day."""

    hour_stats = analytics_service.get_popular_hours(db, current_user.id, days)  # SECURITY: User-scoped only

    # Convert to more readable format
    hourly_data = [
        {"hour": hour, "hour_display": f"{hour:02d}:00", "actions": count}
        for hour, count in sorted(hour_stats.items())
    ]

    return {
        "hourly_data": hourly_data,
        "period_days": days,
        "message": f"Usage by hour of day for the last {days} days",
    }
