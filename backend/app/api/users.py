from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.models.user import User
from app.services.usage_tracker import usage_tracker
from database import get_db

router = APIRouter()


@router.get("/me/stats")
async def get_my_usage_stats(
    days: int = Query(30, ge=1, le=365, description="Number of days to look back"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get detailed usage statistics for the current user."""

    stats = usage_tracker.get_user_stats(db, current_user.id, days)

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

    # Debug request headers
    print(f"🔍 Quota endpoint - Request headers:")
    for name, value in request.headers.items():
        if name.lower() in ["authorization", "content-type", "origin"]:
            print(f"🔍   {name}: {value}")

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

    timeline = usage_tracker.get_user_activity_timeline(db, current_user.id, days)

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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get system-wide usage statistics (requires admin access in future)."""

    # TODO: Add admin role check when roles are implemented
    # For now, any authenticated user can access system stats

    stats = usage_tracker.get_system_stats(db, days)

    return {"stats": stats, "message": f"System statistics for the last {days} days"}


@router.get("/stats/popular-hours")
async def get_popular_hours(
    days: int = Query(30, ge=1, le=365, description="Number of days to look back"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get usage statistics by hour of day."""

    hour_stats = usage_tracker.get_popular_hours(db, days)

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
