"""
Analytics and Business Intelligence API endpoints.
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import desc, func, Boolean
from sqlalchemy.orm import Session

from app.api.auth import get_current_user, require_admin
from app.models.analytics import (
    BusinessMetric,
    ConversionFunnel,
    ConversionStep,
    DetectionAccuracyLog,
    UserRetentionCohort,
)
from app.models.usage import ActionType
from app.models.usage import ProcessingJob
from app.models.usage import ProcessingJob as ProcessingJobDB
from app.models.usage import UsageLog
from app.models.user import User
from app.services.analytics_service import analytics_service
from database import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/daily-metrics")
async def get_daily_metrics(
    days: int = Query(30, description="Number of days to analyze"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get user-scoped metrics for dashboard. SECURITY: Only current user's data."""
    since_date = datetime.utcnow() - timedelta(days=days)
    
    # SECURITY: User-scoped processing job statistics for timing data
    job_stats = (
        db.query(
            func.count(ProcessingJob.id).label("total_jobs"),
            func.sum(ProcessingJob.total_processing_time_seconds).label("total_time")
        )
        .filter(
            ProcessingJob.user_id == current_user.id,  # SECURITY: User isolation
            ProcessingJob.created_at >= since_date,
            ProcessingJob.status == "completed"
        )
        .first()
    )
    
    # SECURITY: User-scoped photo count from PhotoDB table (matches accuracy calculation)
    from app.models.processing import PhotoDB
    total_processed_photos = db.query(func.count(PhotoDB.id)).filter(
        PhotoDB.user_id == current_user.id,
        PhotoDB.created_at >= since_date
    ).scalar() or 0
    
    # Calculate PRECISE AI accuracy using first-pass yield formula
    avg_detection_accuracy = await analytics_service.get_ai_first_pass_accuracy(db, current_user.id, days)
    
    # Calculate average processing time per photo using actual photo count
    avg_time_per_photo = (
        (job_stats.total_time / total_processed_photos) 
        if total_processed_photos and job_stats.total_time else 0
    )
    
    # DEBUG LOGGING for analytics endpoint
    logger.info(f"🔍 DAILY-METRICS DEBUG for user_id={current_user.id}: total_jobs={job_stats.total_jobs}, total_processed_photos={total_processed_photos}, total_time={job_stats.total_time}, avg_detection_accuracy={avg_detection_accuracy}%")
    
    # SECURITY: User-scoped daily trends only
    daily_trends = (
        db.query(
            func.date(ProcessingJob.created_at).label("date"),
            func.count(ProcessingJob.id).label("jobs"),
            func.sum(ProcessingJob.photos_processed).label("photos"),
            func.avg(ProcessingJob.average_time_per_photo).label("avg_time")
        )
        .filter(
            ProcessingJob.user_id == current_user.id,  # SECURITY: User isolation
            ProcessingJob.created_at >= since_date,
            ProcessingJob.status == "completed"
        )
        .group_by(func.date(ProcessingJob.created_at))
        .order_by(func.date(ProcessingJob.created_at))
        .all()
    )
    
    trends = [
        {
            "date": trend.date.isoformat(),
            "jobs": trend.jobs,
            "photos": trend.photos,
            "avg_time": round(trend.avg_time or 0, 3)
        }
        for trend in daily_trends
    ]
    
    return {
        "user_id": current_user.id,  # SECURITY: Make clear this is user-scoped
        "ai_first_pass_accuracy": avg_detection_accuracy,  # PRECISE: First-pass yield formula
        "average_processing_time_per_photo": round(avg_time_per_photo, 3),
        "trends": trends,
        "total_jobs": job_stats.total_jobs or 0,
        "total_processed_photos": total_processed_photos,  # FIXED: Use actual photo count from PhotoDB
        "period_days": days
    }

@router.get("/user/dashboard")
async def get_user_dashboard(
    days: int = Query(30, description="Number of days to analyze"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Simplified dashboard: Focuses only on Performance and Accuracy."""
    since_date = datetime.utcnow() - timedelta(days=days)

    # 1. Single Query for all Core Aggregates
    # We use conditional aggregation (func.filter) to do this in one pass
    stats = db.query(
        func.sum(ProcessingJob.photos_processed).label("total_processed"),
        func.sum(ProcessingJob.photos_detected).label("total_detected"),
        func.sum(ProcessingJob.total_processing_time_seconds).label("total_time"),
        # Subquery for Manual Label Stats (JSONB)
        db.query(func.count(UsageLog.id))
            .filter(
                UsageLog.user_id == current_user.id,
                UsageLog.action_type == ActionType.MANUAL_LABEL,
                UsageLog.created_at >= since_date,
                UsageLog.details['bib_number'].astext == "unknown"
            ).label("no_bibs"),
        db.query(func.count(UsageLog.id))
            .filter(
                UsageLog.user_id == current_user.id,
                UsageLog.action_type == ActionType.MANUAL_LABEL,
                UsageLog.created_at >= since_date,
                UsageLog.details['bib_number'].astext != "unknown",
                UsageLog.details['was_unknown'].astext.cast(Boolean) == False
            ).label("corrections")
    ).filter(
        ProcessingJob.user_id == current_user.id,
        ProcessingJob.created_at >= since_date,
        ProcessingJob.status == "completed"
    ).first()

    # Extraction with defaults
    processed = stats.total_processed or 0
    detected = stats.total_detected or 0
    time_sec = stats.total_time or 0
    no_bibs = stats.no_bibs or 0
    corrections = stats.corrections or 0

    # 2. Accuracy Math - PRECISE: Use first-pass yield formula
    accuracy = await analytics_service.get_ai_first_pass_accuracy(db, current_user.id, days)
    avg_speed_ms = (time_sec / processed * 1000) if processed > 0 else 0.0

    return {
        "performance": {
            "accuracy_percentage": round(accuracy, 2),
            "avg_speed_per_photo_ms": round(avg_speed_ms, 2),
            "throughput": {
                "total_processed": processed,
                "gemini_success": detected,
                "human_corrections": corrections
            }
        },
        "days_analyzed": days
    }


@router.get("/admin/users/analytics")
async def get_user_analytics(
    limit: int = Query(100, description="Max users"),
    sort_by: str = Query("activity", description="activity, photos, or jobs"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin view: One-trip query to get user list + aggregated stats."""
    
    # 1. Define the subquery for per-user aggregates to keep the main query clean
    job_stats_sub = (
        db.query(
            ProcessingJob.user_id,
            func.count(ProcessingJob.id).label("total_jobs"),
            func.sum(ProcessingJob.photos_processed).label("sum_processed"),
            func.avg(ProcessingJob.progress).label("avg_job_progress")
        )
        .group_by(ProcessingJob.user_id)
        .subquery()
    )

    # 2. Main Query: Join Users table with our Aggregate subquery
    query = db.query(
        User,
        job_stats_sub.c.total_jobs,
        job_stats_sub.c.sum_processed,
        job_stats_sub.c.avg_job_progress
    ).outerjoin(job_stats_sub, User.id == job_stats_sub.c.user_id)

    # 3. Dynamic Sorting
    if sort_by == "photos":
        query = query.order_by(desc(job_stats_sub.c.sum_processed))
    elif sort_by == "jobs":
        query = query.order_by(desc(job_stats_sub.c.total_jobs))
    else:  # activity
        query = query.order_by(desc(User.last_login))

    results = query.limit(limit).all()

    # 4. Map to clean response
    user_analytics = [
        {
            "user_id": u.id,
            "email": u.email,
            "full_name": u.full_name,
            "last_login": u.last_login.isoformat() if u.last_login else None,
            "stats": {
                "total_jobs": jobs or 0,
                "total_processed": processed or 0,
                "avg_progress": round(float(progress or 0), 2)
            }
        }
        for u, jobs, processed, progress in results
    ]

    return {"users": user_analytics, "count": len(user_analytics)}

@router.get("/admin/performance/detection")
async def get_detection_performance(
    days: int = Query(30, description="Number of days to analyze"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Get ML detection performance analytics."""

    since_date = datetime.utcnow() - timedelta(days=days)

    # Overall accuracy metrics
    accuracy_stats = (
        db.query(
            func.count(DetectionAccuracyLog.id).label("total"),
            func.count(DetectionAccuracyLog.id)
            .filter(DetectionAccuracyLog.is_correct is True)
            .label("correct"),
            func.avg(DetectionAccuracyLog.processing_time_ms).label("avg_time")
        )
        .filter(DetectionAccuracyLog.detected_at >= since_date)
        .first()
    )

    # Method breakdown
    method_stats = (
        db.query(
            DetectionAccuracyLog.detection_method,
            func.count(DetectionAccuracyLog.id).label("count"),
            func.avg(DetectionAccuracyLog.processing_time_ms).label("avg_time"),
            func.count(DetectionAccuracyLog.id)
            .filter(DetectionAccuracyLog.is_correct is True)
            .label("correct"),
        )
        .filter(DetectionAccuracyLog.detected_at >= since_date)
        .group_by(DetectionAccuracyLog.detection_method)
        .all()
    )

    # Daily trends
    daily_trends = (
        db.query(
            func.date(DetectionAccuracyLog.detected_at).label("date"),
            func.count(DetectionAccuracyLog.id).label("total"),
            func.count(DetectionAccuracyLog.id)
            .filter(DetectionAccuracyLog.is_correct is True)
            .label("correct"),
            func.avg(DetectionAccuracyLog.processing_time_ms).label("avg_time"),
        )
        .filter(DetectionAccuracyLog.detected_at >= since_date)
        .group_by(func.date(DetectionAccuracyLog.detected_at))
        .all()
    )

    overall_accuracy = 0
    if accuracy_stats.total and accuracy_stats.total > 0:
        overall_accuracy = (accuracy_stats.correct / accuracy_stats.total) * 100

    return {
        "overview": {
            "total_detections": accuracy_stats.total or 0,
            "accuracy_percentage": round(overall_accuracy, 2),
            "avg_processing_time_ms": round(accuracy_stats.avg_time or 0, 2)
        },
        "method_breakdown": [
            {
                "method": stat.detection_method,
                "count": stat.count,
                "accuracy_percentage": (
                    round((stat.correct / stat.count) * 100, 2) if stat.count > 0 else 0
                ),
                "avg_processing_time_ms": round(stat.avg_time or 0, 2),
            }
            for stat in method_stats
        ],
        "daily_trends": [
            {
                "date": trend.date.isoformat(),
                "total_detections": trend.total,
                "accuracy_percentage": (
                    round((trend.correct / trend.total) * 100, 2)
                    if trend.total > 0
                    else 0
                ),
                "avg_processing_time_ms": round(trend.avg_time or 0, 2),
            }
            for trend in daily_trends
        ],
    }


@router.get("/admin/business/kpis")
async def get_business_kpis(
    period: str = Query("monthly", description="Period: daily, weekly, monthly"),
    limit: int = Query(12, description="Number of periods to return"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Get key business performance indicators."""

    kpis = (
        db.query(BusinessMetric)
        .filter(BusinessMetric.period_type == period)
        .order_by(desc(BusinessMetric.date))
        .limit(limit)
        .all()
    )

    # Calculate growth rates
    kpi_data = []
    for i, kpi in enumerate(kpis):
        growth_rates = {}
        if i < len(kpis) - 1:
            prev_kpi = kpis[i + 1]
            # Calculate growth percentages
            if prev_kpi.total_users > 0:
                growth_rates["user_growth"] = (
                    (kpi.total_users - prev_kpi.total_users) / prev_kpi.total_users
                ) * 100
            if prev_kpi.total_photos_processed > 0:
                growth_rates["processing_growth"] = (
                    (kpi.total_photos_processed - prev_kpi.total_photos_processed)
                    / prev_kpi.total_photos_processed
                ) * 100
            if prev_kpi.revenue_usd > 0:
                growth_rates["revenue_growth"] = (
                    (kpi.revenue_usd - prev_kpi.revenue_usd) / prev_kpi.revenue_usd
                ) * 100

        kpi_dict = kpi.to_dict()
        kpi_dict["growth_rates"] = growth_rates
        kpi_data.append(kpi_dict)

    return {"period": period, "kpis": kpi_data}


@router.get("/admin/users/conversion-funnel")
async def get_conversion_funnel(
    days: int = Query(30, description="Number of days to analyze"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Get conversion funnel analysis."""

    since_date = datetime.utcnow() - timedelta(days=days)

    # Get conversion step counts
    funnel_data = {}
    for step in ConversionStep:
        count = (
            db.query(ConversionFunnel)
            .filter(
                ConversionFunnel.step == step,
                ConversionFunnel.completed_at >= since_date,
            )
            .count()
        )
        funnel_data[step.value] = count

    # Calculate conversion rates between steps
    conversion_rates = {}
    steps = list(ConversionStep)
    for i in range(len(steps) - 1):
        current_step = steps[i]
        next_step = steps[i + 1]

        current_count = funnel_data[current_step.value]
        next_count = funnel_data[next_step.value]

        rate = (next_count / current_count * 100) if current_count > 0 else 0
        conversion_rates[f"{current_step.value}_to_{next_step.value}"] = round(rate, 2)

    # Get average time between steps
    time_analysis = {}
    for step in ConversionStep:
        avg_time = (
            db.query(func.avg(ConversionFunnel.time_to_convert_seconds))
            .filter(
                ConversionFunnel.step == step,
                ConversionFunnel.completed_at >= since_date,
            )
            .scalar()
        )

        if avg_time:
            time_analysis[step.value] = {
                "avg_time_seconds": round(avg_time, 2),
                "avg_time_hours": round(avg_time / 3600, 2),
            }

    return {
        "funnel_counts": funnel_data,
        "conversion_rates": conversion_rates,
        "time_to_convert": time_analysis,
        "total_conversions": funnel_data.get(ConversionStep.FIRST_EXPORT.value, 0),
    }


@router.get("/admin/export/analytics-report")
async def export_analytics_report(
    format: str = Query("json", description="Export format: json, csv"),
    days: int = Query(30, description="Number of days to include"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Export comprehensive analytics report."""

    from app.services.export_service import export_service

    try:
        # Use the enhanced export service
        report_data = await export_service.export_business_report(db, format, days)

        if format.lower() == "csv":
            return Response(
                content=report_data,
                media_type="text/csv",
                headers={
                    "Content-Disposition": f"attachment; filename=business_report_{datetime.utcnow().strftime('%Y%m%d')}.csv"
                },
            )
        else:
            return Response(
                content=report_data,
                media_type="application/json",
                headers={
                    "Content-Disposition": f"attachment; filename=business_report_{datetime.utcnow().strftime('%Y%m%d')}.json"
                },
            )

    except Exception as e:
        logger.error(f"Export failed: {e}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")


@router.get("/admin/export/user-analytics")
async def export_user_analytics(
    format: str = Query("csv", description="Export format: json, csv"),
    days: int = Query(30, description="Number of days to include"),
    include_engagement: bool = Query(True, description="Include engagement metrics"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Export detailed user analytics data."""

    from app.services.export_service import export_service

    try:
        export_data = await export_service.export_user_analytics(
            db, format, days, include_engagement
        )

        media_type = "text/csv" if format.lower() == "csv" else "application/json"
        filename = (
            f"user_analytics_{datetime.utcnow().strftime('%Y%m%d')}.{format.lower()}"
        )

        return Response(
            content=export_data,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    except Exception as e:
        logger.error(f"User analytics export failed: {e}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")


@router.get("/admin/export/conversion-funnel")
async def export_conversion_funnel(
    format: str = Query("csv", description="Export format: json, csv"),
    days: int = Query(30, description="Number of days to include"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Export conversion funnel analysis."""

    from app.services.export_service import export_service

    try:
        export_data = await export_service.export_conversion_funnel(db, format, days)

        media_type = "text/csv" if format.lower() == "csv" else "application/json"
        filename = (
            f"conversion_funnel_{datetime.utcnow().strftime('%Y%m%d')}.{format.lower()}"
        )

        return Response(
            content=export_data,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    except Exception as e:
        logger.error(f"Conversion funnel export failed: {e}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")


@router.get("/admin/export/detection-accuracy")
async def export_detection_accuracy(
    format: str = Query("csv", description="Export format: json, csv"),
    days: int = Query(30, description="Number of days to include"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Export detection accuracy analysis."""

    from app.services.export_service import export_service

    try:
        export_data = await export_service.export_detection_accuracy_report(
            db, format, days
        )

        media_type = "text/csv" if format.lower() == "csv" else "application/json"
        filename = f"detection_accuracy_{datetime.utcnow().strftime('%Y%m%d')}.{format.lower()}"

        return Response(
            content=export_data,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    except Exception as e:
        logger.error(f"Detection accuracy export failed: {e}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")


@router.get("/admin/export/formats")
async def get_supported_export_formats(admin_user: User = Depends(require_admin)):
    """Get list of supported export formats."""

    from app.services.export_service import export_service

    return {
        "supported_formats": export_service.get_supported_formats(),
        "available_reports": [
            "business_report",
            "user_analytics",
            "system_metrics",
            "conversion_funnel",
            "detection_accuracy",
        ],
    }

# Helper functions
def get_user_growth_metrics(db: Session, days: int) -> Dict[str, Any]:
    """Calculate user growth metrics."""
    since_date = datetime.utcnow() - timedelta(days=days)

    # Daily user registrations
    daily_signups = (
        db.query(
            func.date(User.created_at).label("date"),
            func.count(User.id).label("signups"),
        )
        .filter(User.created_at >= since_date)
        .group_by(func.date(User.created_at))
        .all()
    )

    # Active users per day
    daily_active = (
        db.query(
            func.date(UsageLog.created_at).label("date"),
            func.count(func.distinct(UsageLog.user_id)).label("active_users"),
        )
        .filter(UsageLog.created_at >= since_date)
        .group_by(func.date(UsageLog.created_at))
        .all()
    )

    return {
        "daily_signups": [
            {"date": signup.date.isoformat(), "count": signup.signups}
            for signup in daily_signups
        ],
        "daily_active_users": [
            {"date": active.date.isoformat(), "count": active.active_users}
            for active in daily_active
        ],
        "total_new_users": sum(signup.signups for signup in daily_signups),
    }


def get_processing_performance_metrics(db: Session, days: int) -> Dict[str, Any]:
    """Calculate processing performance metrics."""
    since_date = datetime.utcnow() - timedelta(days=days)

    # Processing job statistics
    job_stats = (
        db.query(
            func.count(ProcessingJobDB.id).label("total_jobs"),
            func.avg(ProcessingJobDB.progress).label("avg_progress"),
            func.sum(ProcessingJobDB.total_photos).label("total_photos"),
            func.sum(ProcessingJobDB.completed_photos).label("completed_photos"),
        )
        .filter(ProcessingJobDB.created_at >= since_date)
        .first()
    )

    # Processing time trends
    time_trends = (
        db.query(
            func.date(ProcessingJobDB.created_at).label("date"),
            func.avg(ProcessingJobDB.progress).label("avg_progress"),
            func.count(ProcessingJobDB.id).label("job_count"),
        )
        .filter(ProcessingJobDB.created_at >= since_date)
        .group_by(func.date(ProcessingJobDB.created_at))
        .all()
    )

    return {
        "overview": {
            "total_jobs": job_stats.total_jobs or 0,
            "avg_progress": round(job_stats.avg_progress or 0, 2),
            "total_photos": job_stats.total_photos or 0,
            "completed_photos": job_stats.completed_photos or 0,
            "completion_rate": round(
                (
                    (job_stats.completed_photos / job_stats.total_photos * 100)
                    if job_stats.total_photos
                    else 0
                ),
                2,
            ),
        },
        "daily_trends": [
            {
                "date": trend.date.isoformat(),
                "avg_progress": round(trend.avg_progress or 0, 2),
                "job_count": trend.job_count,
            }
            for trend in time_trends
        ],
    }


# use stripe to get revenue metrics


