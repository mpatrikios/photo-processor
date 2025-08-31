"""
Analytics and Business Intelligence API endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, and_, or_, extract
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import json

from database import get_db
from app.api.auth import get_current_user, require_admin
from app.models.user import User
from app.models.usage import UsageLog, ActionType, ProcessingJob as UsageProcessingJob
from app.models.processing import ProcessingJobDB, PhotoDB
from app.models.analytics import (
    UserEngagement, ConversionFunnel, SystemMetric, BusinessMetric, 
    PerformanceBenchmark, UserRetentionCohort, DetectionAccuracyLog,
    EventType, ConversionStep, SystemMetricType, AlertRule, AlertHistory
)
from app.services.usage_tracker import usage_tracker

router = APIRouter()

# User-level analytics endpoints

@router.get("/user/dashboard")
async def get_user_dashboard(
    days: int = Query(30, description="Number of days to analyze"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get personalized analytics dashboard for the current user."""
    
    # Get basic user stats
    user_stats = usage_tracker.get_user_stats(db, current_user.id, days)
    
    # Get recent activity timeline
    timeline = usage_tracker.get_user_activity_timeline(db, current_user.id, 7)
    
    # Get detection accuracy for user's photos
    accuracy_stats = db.query(
        func.count(DetectionAccuracyLog.id).label('total'),
        func.count(DetectionAccuracyLog.id).filter(DetectionAccuracyLog.is_correct == True).label('correct'),
        func.avg(DetectionAccuracyLog.processing_time_ms).label('avg_time')
    ).filter(DetectionAccuracyLog.user_id == current_user.id).first()
    
    accuracy_percentage = 0
    if accuracy_stats.total and accuracy_stats.total > 0:
        accuracy_percentage = (accuracy_stats.correct / accuracy_stats.total) * 100
    
    # Get processing time trends (last 7 days)
    processing_trends = db.query(
        func.date(ProcessingJobDB.created_at).label('date'),
        func.avg(ProcessingJobDB.progress).label('avg_progress'),
        func.count(ProcessingJobDB.id).label('job_count')
    ).filter(
        ProcessingJobDB.user_id == current_user.id,
        ProcessingJobDB.created_at >= datetime.utcnow() - timedelta(days=7)
    ).group_by(func.date(ProcessingJobDB.created_at)).all()
    
    return {
        "user_stats": user_stats,
        "recent_activity": timeline[:10],  # Last 10 activities
        "detection_accuracy": {
            "percentage": round(accuracy_percentage, 2),
            "total_photos": accuracy_stats.total or 0,
            "avg_processing_time_ms": round(accuracy_stats.avg_time or 0, 2)
        },
        "processing_trends": [
            {
                "date": trend.date.isoformat(),
                "avg_progress": round(trend.avg_progress or 0, 2),
                "job_count": trend.job_count
            }
            for trend in processing_trends
        ]
    }

@router.get("/user/engagement")
async def get_user_engagement(
    session_id: Optional[str] = Query(None, description="Filter by session ID"),
    days: int = Query(7, description="Number of days to analyze"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get detailed user engagement metrics."""
    
    since_date = datetime.utcnow() - timedelta(days=days)
    
    query = db.query(UserEngagement).filter(
        UserEngagement.user_id == current_user.id,
        UserEngagement.timestamp >= since_date
    )
    
    if session_id:
        query = query.filter(UserEngagement.session_id == session_id)
    
    engagement_events = query.order_by(desc(UserEngagement.timestamp)).all()
    
    # Aggregate engagement statistics
    event_counts = {}
    for event in engagement_events:
        event_type = event.event_type.value
        event_counts[event_type] = event_counts.get(event_type, 0) + 1
    
    # Calculate session statistics
    unique_sessions = len(set(event.session_id for event in engagement_events))
    avg_session_duration = db.query(func.avg(UserEngagement.session_duration_seconds)).filter(
        UserEngagement.user_id == current_user.id,
        UserEngagement.timestamp >= since_date
    ).scalar() or 0
    
    return {
        "total_events": len(engagement_events),
        "unique_sessions": unique_sessions,
        "avg_session_duration_seconds": round(avg_session_duration, 2),
        "event_breakdown": event_counts,
        "recent_events": [event.to_dict() for event in engagement_events[:20]]
    }

# Admin/Business Intelligence endpoints

@router.get("/admin/dashboard")
async def get_admin_dashboard(
    days: int = Query(30, description="Number of days to analyze"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Get comprehensive business intelligence dashboard (admin only)."""
    
    # Get system-wide statistics
    system_stats = usage_tracker.get_system_stats(db, days)
    
    # Get user growth metrics
    user_growth = get_user_growth_metrics(db, days)
    
    # Get processing performance metrics
    processing_metrics = get_processing_performance_metrics(db, days)
    
    # Get revenue metrics (if applicable)
    revenue_metrics = get_revenue_metrics(db, days)
    
    # Get top users by activity
    top_users = get_top_users_by_activity(db, days)
    
    # Get recent alerts
    recent_alerts = db.query(AlertHistory).order_by(desc(AlertHistory.triggered_at)).limit(10).all()
    
    return {
        "overview": system_stats,
        "user_growth": user_growth,
        "processing_performance": processing_metrics,
        "revenue": revenue_metrics,
        "top_users": top_users,
        "recent_alerts": [
            {
                "id": alert.id,
                "rule_name": alert.rule.rule_name if alert.rule else "Unknown",
                "level": alert.alert_level.value,
                "value": alert.metric_value,
                "triggered_at": alert.triggered_at.isoformat(),
                "resolved": alert.resolved_at is not None
            }
            for alert in recent_alerts
        ]
    }

@router.get("/admin/users/analytics")
async def get_user_analytics(
    limit: int = Query(100, description="Maximum number of users to return"),
    sort_by: str = Query("activity", description="Sort by: activity, photos, revenue"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Get detailed user analytics for admin dashboard."""
    
    # Build query based on sorting preference
    if sort_by == "photos":
        users = db.query(User).order_by(desc(User.total_photos_uploaded)).limit(limit).all()
    elif sort_by == "revenue":
        # Future: order by revenue metrics
        users = db.query(User).order_by(desc(User.created_at)).limit(limit).all()
    else:  # activity
        users = db.query(User).order_by(desc(User.last_login)).limit(limit).all()
    
    user_analytics = []
    for user in users:
        # Get recent activity
        recent_logs = db.query(UsageLog).filter(
            UsageLog.user_id == user.id,
            UsageLog.created_at >= datetime.utcnow() - timedelta(days=30)
        ).count()
        
        # Get processing jobs
        job_stats = db.query(
            func.count(ProcessingJobDB.id).label('total_jobs'),
            func.avg(ProcessingJobDB.progress).label('avg_progress')
        ).filter(ProcessingJobDB.user_id == user.id).first()
        
        user_analytics.append({
            "user_id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "created_at": user.created_at.isoformat(),
            "last_login": user.last_login.isoformat() if user.last_login else None,
            "total_photos_uploaded": user.total_photos_uploaded,
            "total_photos_processed": user.total_photos_processed,
            "total_exports": user.total_exports,
            "recent_activity_count": recent_logs,
            "total_jobs": job_stats.total_jobs or 0,
            "avg_job_progress": round(job_stats.avg_progress or 0, 2)
        })
    
    return {
        "users": user_analytics,
        "total_count": len(users),
        "sort_by": sort_by
    }

@router.get("/admin/performance/detection")
async def get_detection_performance(
    days: int = Query(30, description="Number of days to analyze"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Get ML detection performance analytics."""
    
    since_date = datetime.utcnow() - timedelta(days=days)
    
    # Overall accuracy metrics
    accuracy_stats = db.query(
        func.count(DetectionAccuracyLog.id).label('total'),
        func.count(DetectionAccuracyLog.id).filter(DetectionAccuracyLog.is_correct == True).label('correct'),
        func.avg(DetectionAccuracyLog.processing_time_ms).label('avg_time'),
        func.avg(DetectionAccuracyLog.google_vision_confidence).label('avg_gv_confidence'),
        func.avg(DetectionAccuracyLog.tesseract_confidence).label('avg_tes_confidence')
    ).filter(DetectionAccuracyLog.detected_at >= since_date).first()
    
    # Method breakdown
    method_stats = db.query(
        DetectionAccuracyLog.detection_method,
        func.count(DetectionAccuracyLog.id).label('count'),
        func.avg(DetectionAccuracyLog.processing_time_ms).label('avg_time'),
        func.count(DetectionAccuracyLog.id).filter(DetectionAccuracyLog.is_correct == True).label('correct')
    ).filter(DetectionAccuracyLog.detected_at >= since_date).group_by(
        DetectionAccuracyLog.detection_method
    ).all()
    
    # Daily trends
    daily_trends = db.query(
        func.date(DetectionAccuracyLog.detected_at).label('date'),
        func.count(DetectionAccuracyLog.id).label('total'),
        func.count(DetectionAccuracyLog.id).filter(DetectionAccuracyLog.is_correct == True).label('correct'),
        func.avg(DetectionAccuracyLog.processing_time_ms).label('avg_time')
    ).filter(
        DetectionAccuracyLog.detected_at >= since_date
    ).group_by(func.date(DetectionAccuracyLog.detected_at)).all()
    
    overall_accuracy = 0
    if accuracy_stats.total and accuracy_stats.total > 0:
        overall_accuracy = (accuracy_stats.correct / accuracy_stats.total) * 100
    
    return {
        "overview": {
            "total_detections": accuracy_stats.total or 0,
            "accuracy_percentage": round(overall_accuracy, 2),
            "avg_processing_time_ms": round(accuracy_stats.avg_time or 0, 2),
            "avg_google_vision_confidence": round(accuracy_stats.avg_gv_confidence or 0, 2),
            "avg_tesseract_confidence": round(accuracy_stats.avg_tes_confidence or 0, 2)
        },
        "method_breakdown": [
            {
                "method": stat.detection_method,
                "count": stat.count,
                "accuracy_percentage": round((stat.correct / stat.count) * 100, 2) if stat.count > 0 else 0,
                "avg_processing_time_ms": round(stat.avg_time or 0, 2)
            }
            for stat in method_stats
        ],
        "daily_trends": [
            {
                "date": trend.date.isoformat(),
                "total_detections": trend.total,
                "accuracy_percentage": round((trend.correct / trend.total) * 100, 2) if trend.total > 0 else 0,
                "avg_processing_time_ms": round(trend.avg_time or 0, 2)
            }
            for trend in daily_trends
        ]
    }

@router.get("/admin/users/cohorts")
async def get_user_cohorts(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Get user retention cohort analysis."""
    
    cohorts = db.query(UserRetentionCohort).order_by(desc(UserRetentionCohort.cohort_month)).all()
    
    # Calculate cohort data if not exists or outdated
    if not cohorts or (datetime.utcnow() - cohorts[0].last_updated).days > 1:
        # Regenerate cohort data
        cohorts = await regenerate_cohort_data(db)
    
    return {
        "cohorts": [
            {
                "cohort_month": cohort.cohort_month,
                "user_count": cohort.user_count,
                "retention": {
                    "month_0": cohort.month_0,
                    "month_1": cohort.month_1,
                    "month_2": cohort.month_2,
                    "month_3": cohort.month_3,
                    "month_6": cohort.month_6,
                    "month_12": cohort.month_12
                },
                "avg_photos_uploaded": cohort.avg_photos_uploaded,
                "avg_revenue_per_user": cohort.avg_revenue_per_user
            }
            for cohort in cohorts
        ]
    }

@router.get("/admin/system/metrics")
async def get_system_metrics(
    metric_type: Optional[SystemMetricType] = Query(None, description="Filter by metric type"),
    hours: int = Query(24, description="Number of hours to analyze"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Get system performance metrics."""
    
    since_time = datetime.utcnow() - timedelta(hours=hours)
    
    query = db.query(SystemMetric).filter(SystemMetric.timestamp >= since_time)
    
    if metric_type:
        query = query.filter(SystemMetric.metric_type == metric_type)
    
    metrics = query.order_by(desc(SystemMetric.timestamp)).all()
    
    # Aggregate by metric type
    aggregated = {}
    for metric in metrics:
        type_key = metric.metric_type.value
        if type_key not in aggregated:
            aggregated[type_key] = {
                "values": [],
                "avg": 0,
                "min": float('inf'),
                "max": float('-inf'),
                "latest": None
            }
        
        aggregated[type_key]["values"].append({
            "timestamp": metric.timestamp.isoformat(),
            "value": metric.value,
            "unit": metric.unit
        })
        
        # Update aggregates
        aggregated[type_key]["min"] = min(aggregated[type_key]["min"], metric.value)
        aggregated[type_key]["max"] = max(aggregated[type_key]["max"], metric.value)
        if not aggregated[type_key]["latest"] or metric.timestamp > datetime.fromisoformat(aggregated[type_key]["latest"]["timestamp"].replace('Z', '+00:00')):
            aggregated[type_key]["latest"] = {
                "timestamp": metric.timestamp.isoformat(),
                "value": metric.value
            }
    
    # Calculate averages
    for type_key in aggregated:
        values = [v["value"] for v in aggregated[type_key]["values"]]
        aggregated[type_key]["avg"] = sum(values) / len(values) if values else 0
        aggregated[type_key]["count"] = len(values)
    
    return {
        "period_hours": hours,
        "metrics": aggregated
    }

@router.get("/admin/business/kpis")
async def get_business_kpis(
    period: str = Query("monthly", description="Period: daily, weekly, monthly"),
    limit: int = Query(12, description="Number of periods to return"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Get key business performance indicators."""
    
    kpis = db.query(BusinessMetric).filter(
        BusinessMetric.period_type == period
    ).order_by(desc(BusinessMetric.date)).limit(limit).all()
    
    # Calculate growth rates
    kpi_data = []
    for i, kpi in enumerate(kpis):
        growth_rates = {}
        if i < len(kpis) - 1:
            prev_kpi = kpis[i + 1]
            # Calculate growth percentages
            if prev_kpi.total_users > 0:
                growth_rates["user_growth"] = ((kpi.total_users - prev_kpi.total_users) / prev_kpi.total_users) * 100
            if prev_kpi.total_photos_processed > 0:
                growth_rates["processing_growth"] = ((kpi.total_photos_processed - prev_kpi.total_photos_processed) / prev_kpi.total_photos_processed) * 100
            if prev_kpi.revenue_usd > 0:
                growth_rates["revenue_growth"] = ((kpi.revenue_usd - prev_kpi.revenue_usd) / prev_kpi.revenue_usd) * 100
        
        kpi_dict = kpi.to_dict()
        kpi_dict["growth_rates"] = growth_rates
        kpi_data.append(kpi_dict)
    
    return {
        "period": period,
        "kpis": kpi_data
    }

@router.get("/admin/users/conversion-funnel")
async def get_conversion_funnel(
    days: int = Query(30, description="Number of days to analyze"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Get conversion funnel analysis."""
    
    since_date = datetime.utcnow() - timedelta(days=days)
    
    # Get conversion step counts
    funnel_data = {}
    for step in ConversionStep:
        count = db.query(ConversionFunnel).filter(
            ConversionFunnel.step == step,
            ConversionFunnel.completed_at >= since_date
        ).count()
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
        avg_time = db.query(func.avg(ConversionFunnel.time_to_convert_seconds)).filter(
            ConversionFunnel.step == step,
            ConversionFunnel.completed_at >= since_date
        ).scalar()
        
        if avg_time:
            time_analysis[step.value] = {
                "avg_time_seconds": round(avg_time, 2),
                "avg_time_hours": round(avg_time / 3600, 2)
            }
    
    return {
        "funnel_counts": funnel_data,
        "conversion_rates": conversion_rates,
        "time_to_convert": time_analysis,
        "total_conversions": funnel_data.get(ConversionStep.FIRST_EXPORT.value, 0)
    }

@router.get("/admin/export/analytics-report")
async def export_analytics_report(
    format: str = Query("json", description="Export format: json, csv"),
    days: int = Query(30, description="Number of days to include"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
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
                headers={"Content-Disposition": f"attachment; filename=business_report_{datetime.utcnow().strftime('%Y%m%d')}.csv"}
            )
        else:
            return Response(
                content=report_data,
                media_type="application/json",
                headers={"Content-Disposition": f"attachment; filename=business_report_{datetime.utcnow().strftime('%Y%m%d')}.json"}
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
    db: Session = Depends(get_db)
):
    """Export detailed user analytics data."""
    
    from app.services.export_service import export_service
    
    try:
        export_data = await export_service.export_user_analytics(
            db, format, days, include_engagement
        )
        
        media_type = "text/csv" if format.lower() == "csv" else "application/json"
        filename = f"user_analytics_{datetime.utcnow().strftime('%Y%m%d')}.{format.lower()}"
        
        return Response(
            content=export_data,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except Exception as e:
        logger.error(f"User analytics export failed: {e}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")

@router.get("/admin/export/system-metrics")
async def export_system_metrics(
    format: str = Query("csv", description="Export format: json, csv"),
    days: int = Query(7, description="Number of days to include"),
    metric_types: Optional[List[str]] = Query(None, description="Specific metric types to include"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Export system performance metrics."""
    
    from app.services.export_service import export_service
    
    try:
        export_data = await export_service.export_system_metrics(
            db, format, days, metric_types
        )
        
        media_type = "text/csv" if format.lower() == "csv" else "application/json"
        filename = f"system_metrics_{datetime.utcnow().strftime('%Y%m%d')}.{format.lower()}"
        
        return Response(
            content=export_data,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except Exception as e:
        logger.error(f"System metrics export failed: {e}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")

@router.get("/admin/export/conversion-funnel")
async def export_conversion_funnel(
    format: str = Query("csv", description="Export format: json, csv"),
    days: int = Query(30, description="Number of days to include"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Export conversion funnel analysis."""
    
    from app.services.export_service import export_service
    
    try:
        export_data = await export_service.export_conversion_funnel(db, format, days)
        
        media_type = "text/csv" if format.lower() == "csv" else "application/json"
        filename = f"conversion_funnel_{datetime.utcnow().strftime('%Y%m%d')}.{format.lower()}"
        
        return Response(
            content=export_data,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except Exception as e:
        logger.error(f"Conversion funnel export failed: {e}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")

@router.get("/admin/export/detection-accuracy")
async def export_detection_accuracy(
    format: str = Query("csv", description="Export format: json, csv"),
    days: int = Query(30, description="Number of days to include"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Export detection accuracy analysis."""
    
    from app.services.export_service import export_service
    
    try:
        export_data = await export_service.export_detection_accuracy_report(db, format, days)
        
        media_type = "text/csv" if format.lower() == "csv" else "application/json"
        filename = f"detection_accuracy_{datetime.utcnow().strftime('%Y%m%d')}.{format.lower()}"
        
        return Response(
            content=export_data,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except Exception as e:
        logger.error(f"Detection accuracy export failed: {e}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")

@router.get("/admin/export/formats")
async def get_supported_export_formats(
    admin_user: User = Depends(require_admin)
):
    """Get list of supported export formats."""
    
    from app.services.export_service import export_service
    
    return {
        "supported_formats": export_service.get_supported_formats(),
        "available_reports": [
            "business_report",
            "user_analytics", 
            "system_metrics",
            "conversion_funnel",
            "detection_accuracy"
        ]
    }

# Engagement tracking endpoints

@router.post("/engagement/track")
async def track_engagement_event(
    event_data: Dict[str, Any],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Track a user engagement event."""
    
    # Validate required fields
    required_fields = ["event_type", "session_id"]
    for field in required_fields:
        if field not in event_data:
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
    
    # Create engagement record
    engagement = UserEngagement(
        user_id=current_user.id,
        session_id=event_data["session_id"],
        event_type=EventType(event_data["event_type"]),
        page_path=event_data.get("page_path"),
        element_id=event_data.get("element_id"),
        element_class=event_data.get("element_class"),
        click_x=event_data.get("click_x"),
        click_y=event_data.get("click_y"),
        viewport_width=event_data.get("viewport_width"),
        viewport_height=event_data.get("viewport_height"),
        session_duration_seconds=event_data.get("session_duration_seconds"),
        time_on_page_seconds=event_data.get("time_on_page_seconds"),
        user_agent=event_data.get("user_agent"),
        referrer=event_data.get("referrer"),
        custom_data=event_data.get("custom_data")
    )
    
    db.add(engagement)
    db.commit()
    
    return {"status": "tracked", "event_id": engagement.id}

@router.post("/engagement/conversion")
async def track_conversion_event(
    step: ConversionStep,
    session_id: str,
    source: Optional[str] = None,
    medium: Optional[str] = None,
    campaign: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Track a conversion funnel step."""
    
    # Check if step already exists for this user
    existing = db.query(ConversionFunnel).filter(
        ConversionFunnel.user_id == current_user.id,
        ConversionFunnel.step == step
    ).first()
    
    if existing:
        return {"status": "already_tracked", "step": step.value}
    
    # Calculate time to convert from previous step
    time_to_convert = None
    previous_steps = list(ConversionStep)
    if step in previous_steps:
        step_index = previous_steps.index(step)
        if step_index > 0:
            previous_step = previous_steps[step_index - 1]
            previous_conversion = db.query(ConversionFunnel).filter(
                ConversionFunnel.user_id == current_user.id,
                ConversionFunnel.step == previous_step
            ).first()
            
            if previous_conversion:
                time_diff = datetime.utcnow() - previous_conversion.completed_at
                time_to_convert = time_diff.total_seconds()
    
    # Create conversion record
    conversion = ConversionFunnel(
        user_id=current_user.id,
        step=step,
        source=source,
        medium=medium,
        campaign=campaign,
        session_id=session_id,
        time_to_convert_seconds=time_to_convert
    )
    
    db.add(conversion)
    db.commit()
    
    return {
        "status": "tracked", 
        "step": step.value,
        "time_to_convert_seconds": time_to_convert
    }

# Helper functions

def get_user_growth_metrics(db: Session, days: int) -> Dict[str, Any]:
    """Calculate user growth metrics."""
    since_date = datetime.utcnow() - timedelta(days=days)
    
    # Daily user registrations
    daily_signups = db.query(
        func.date(User.created_at).label('date'),
        func.count(User.id).label('signups')
    ).filter(
        User.created_at >= since_date
    ).group_by(func.date(User.created_at)).all()
    
    # Active users per day
    daily_active = db.query(
        func.date(UsageLog.created_at).label('date'),
        func.count(func.distinct(UsageLog.user_id)).label('active_users')
    ).filter(
        UsageLog.created_at >= since_date
    ).group_by(func.date(UsageLog.created_at)).all()
    
    return {
        "daily_signups": [
            {"date": signup.date.isoformat(), "count": signup.signups}
            for signup in daily_signups
        ],
        "daily_active_users": [
            {"date": active.date.isoformat(), "count": active.active_users}
            for active in daily_active
        ],
        "total_new_users": sum(signup.signups for signup in daily_signups)
    }

def get_processing_performance_metrics(db: Session, days: int) -> Dict[str, Any]:
    """Calculate processing performance metrics."""
    since_date = datetime.utcnow() - timedelta(days=days)
    
    # Processing job statistics
    job_stats = db.query(
        func.count(ProcessingJobDB.id).label('total_jobs'),
        func.avg(ProcessingJobDB.progress).label('avg_progress'),
        func.sum(ProcessingJobDB.total_photos).label('total_photos'),
        func.sum(ProcessingJobDB.completed_photos).label('completed_photos')
    ).filter(ProcessingJobDB.created_at >= since_date).first()
    
    # Processing time trends
    time_trends = db.query(
        func.date(ProcessingJobDB.created_at).label('date'),
        func.avg(ProcessingJobDB.progress).label('avg_progress'),
        func.count(ProcessingJobDB.id).label('job_count')
    ).filter(
        ProcessingJobDB.created_at >= since_date
    ).group_by(func.date(ProcessingJobDB.created_at)).all()
    
    return {
        "overview": {
            "total_jobs": job_stats.total_jobs or 0,
            "avg_progress": round(job_stats.avg_progress or 0, 2),
            "total_photos": job_stats.total_photos or 0,
            "completed_photos": job_stats.completed_photos or 0,
            "completion_rate": round((job_stats.completed_photos / job_stats.total_photos * 100) if job_stats.total_photos else 0, 2)
        },
        "daily_trends": [
            {
                "date": trend.date.isoformat(),
                "avg_progress": round(trend.avg_progress or 0, 2),
                "job_count": trend.job_count
            }
            for trend in time_trends
        ]
    }

def get_revenue_metrics(db: Session, days: int) -> Dict[str, Any]:
    """Calculate revenue and business metrics."""
    # Placeholder for future premium features
    return {
        "total_revenue": 0.0,
        "monthly_recurring_revenue": 0.0,
        "average_revenue_per_user": 0.0,
        "subscription_count": 0,
        "churn_rate": 0.0,
        "note": "Revenue tracking will be implemented with premium features"
    }

def get_top_users_by_activity(db: Session, days: int, limit: int = 10) -> List[Dict[str, Any]]:
    """Get most active users by various metrics."""
    since_date = datetime.utcnow() - timedelta(days=days)
    
    # Most active by photo uploads
    top_uploaders = db.query(
        User.id, User.email, User.full_name,
        func.sum(UsageLog.photo_count).label('total_photos')
    ).join(UsageLog).filter(
        UsageLog.action_type == ActionType.UPLOAD,
        UsageLog.created_at >= since_date
    ).group_by(User.id).order_by(desc('total_photos')).limit(limit).all()
    
    # Most active by processing jobs
    top_processors = db.query(
        User.id, User.email, User.full_name,
        func.count(ProcessingJobDB.id).label('job_count')
    ).join(ProcessingJobDB).filter(
        ProcessingJobDB.created_at >= since_date
    ).group_by(User.id).order_by(desc('job_count')).limit(limit).all()
    
    return {
        "top_uploaders": [
            {
                "user_id": user.id,
                "email": user.email,
                "full_name": user.full_name,
                "total_photos": user.total_photos
            }
            for user in top_uploaders
        ],
        "top_processors": [
            {
                "user_id": user.id,
                "email": user.email,
                "full_name": user.full_name,
                "job_count": user.job_count
            }
            for user in top_processors
        ]
    }

async def regenerate_cohort_data(db: Session) -> List[UserRetentionCohort]:
    """Regenerate user retention cohort data."""
    # This would implement cohort analysis logic
    # For now, return empty list - full implementation would analyze user registration
    # months and calculate retention percentages
    return []

# System Monitoring & Alerting Endpoints

@router.get("/admin/monitoring/system-health")
async def get_system_health(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Get real-time system health metrics."""
    
    import psutil
    import os
    from pathlib import Path
    
    try:
        # System resource metrics
        cpu_percent = psutil.cpu_percent(interval=1)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        
        # Application-specific metrics
        upload_dir_size = sum(f.stat().st_size for f in Path("uploads").rglob('*') if f.is_file()) / (1024**2)  # MB
        export_dir_size = sum(f.stat().st_size for f in Path("exports").rglob('*') if f.is_file()) / (1024**2)  # MB
        
        # Database metrics
        db_file_size = Path("tag_photos.db").stat().st_size / (1024**2) if Path("tag_photos.db").exists() else 0
        
        # Active sessions and jobs
        from app.models.user import UserSession
        from app.models.processing import ProcessingJobDB
        
        active_sessions = db.query(UserSession).filter(UserSession.is_active == True).count()
        active_jobs = db.query(ProcessingJobDB).filter(ProcessingJobDB.status.in_(["pending", "processing"])).count()
        
        # Calculate queue size (photos waiting to be processed)
        queue_size = db.query(func.sum(ProcessingJobDB.total_photos)).filter(
            ProcessingJobDB.status == "pending"
        ).scalar() or 0
        
        # API response time (simulate - in production would track actual response times)
        import time
        start_time = time.time()
        db.execute("SELECT 1")
        db_response_time = (time.time() - start_time) * 1000  # Convert to ms
        
        health_metrics = {
            "timestamp": datetime.utcnow().isoformat(),
            "system_resources": {
                "cpu_percent": round(cpu_percent, 1),
                "memory_percent": round(memory.percent, 1),
                "memory_used_gb": round(memory.used / (1024**3), 2),
                "memory_total_gb": round(memory.total / (1024**3), 2),
                "disk_percent": round(disk.percent, 1),
                "disk_used_gb": round(disk.used / (1024**3), 2),
                "disk_total_gb": round(disk.total / (1024**3), 2)
            },
            "application_metrics": {
                "upload_storage_mb": round(upload_dir_size, 1),
                "export_storage_mb": round(export_dir_size, 1),
                "database_size_mb": round(db_file_size, 1),
                "active_sessions": active_sessions,
                "active_jobs": active_jobs,
                "processing_queue_size": int(queue_size),
                "db_response_time_ms": round(db_response_time, 2)
            },
            "health_status": "healthy"  # Will be determined by alert rules
        }
        
        # Record system metrics for trend analysis
        await analytics_service.record_system_metric(
            db, SystemMetricType.CPU_USAGE, "cpu_percent", cpu_percent, "percent"
        )
        await analytics_service.record_system_metric(
            db, SystemMetricType.MEMORY_USAGE, "memory_percent", memory.percent, "percent"
        )
        await analytics_service.record_system_metric(
            db, SystemMetricType.PROCESSING_QUEUE_SIZE, "queue_size", queue_size, "count"
        )
        await analytics_service.record_system_metric(
            db, SystemMetricType.ACTIVE_SESSIONS, "active_sessions", active_sessions, "count"
        )
        await analytics_service.record_system_metric(
            db, SystemMetricType.API_RESPONSE_TIME, "db_response_time", db_response_time, "ms"
        )
        
        return health_metrics
        
    except Exception as e:
        logger.error(f"System health check failed: {e}")
        return {
            "timestamp": datetime.utcnow().isoformat(),
            "health_status": "error",
            "error": str(e)
        }

@router.get("/admin/monitoring/alerts")
async def get_active_alerts(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Get active system alerts."""
    
    # Get recent alerts (last 24 hours)
    since_date = datetime.utcnow() - timedelta(hours=24)
    
    alerts = db.query(AlertHistory).join(AlertRule).filter(
        AlertHistory.triggered_at >= since_date,
        AlertHistory.resolved_at.is_(None)  # Only unresolved alerts
    ).order_by(desc(AlertHistory.triggered_at)).all()
    
    alert_data = []
    for alert in alerts:
        alert_data.append({
            "id": alert.id,
            "rule_name": alert.rule.rule_name,
            "alert_level": alert.alert_level.value,
            "metric_value": alert.metric_value,
            "threshold": alert.rule.threshold_value,
            "comparison": alert.rule.comparison_operator,
            "triggered_at": alert.triggered_at.isoformat(),
            "description": alert.rule.description,
            "context": alert.context_data
        })
    
    return {
        "alerts": alert_data,
        "total_active": len(alert_data),
        "critical_count": len([a for a in alert_data if a["alert_level"] == "critical"]),
        "error_count": len([a for a in alert_data if a["alert_level"] == "error"]),
        "warning_count": len([a for a in alert_data if a["alert_level"] == "warning"])
    }

@router.post("/admin/monitoring/alert-rules")
async def create_alert_rule(
    rule: dict,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Create a new alert rule."""
    
    try:
        new_rule = AlertRule(
            rule_name=rule["rule_name"],
            metric_type=SystemMetricType(rule["metric_type"]),
            threshold_value=rule["threshold_value"],
            comparison_operator=rule["comparison_operator"],
            alert_level=AlertLevel(rule["alert_level"]),
            description=rule.get("description"),
            cooldown_minutes=rule.get("cooldown_minutes", 30),
            email_enabled=rule.get("email_enabled", True),
            is_active=True
        )
        
        db.add(new_rule)
        db.commit()
        db.refresh(new_rule)
        
        return {
            "message": "Alert rule created successfully",
            "rule_id": new_rule.id,
            "rule_name": new_rule.rule_name
        }
    except Exception as e:
        logger.error(f"Failed to create alert rule: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to create alert rule: {str(e)}")

@router.get("/admin/monitoring/alert-rules")
async def get_alert_rules(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Get all alert rules."""
    
    rules = db.query(AlertRule).order_by(AlertRule.created_at.desc()).all()
    
    rule_data = []
    for rule in rules:
        rule_data.append({
            "id": rule.id,
            "rule_name": rule.rule_name,
            "metric_type": rule.metric_type.value,
            "threshold_value": rule.threshold_value,
            "comparison_operator": rule.comparison_operator,
            "alert_level": rule.alert_level.value,
            "description": rule.description,
            "cooldown_minutes": rule.cooldown_minutes,
            "is_active": rule.is_active,
            "trigger_count": rule.trigger_count,
            "last_triggered": rule.last_triggered.isoformat() if rule.last_triggered else None,
            "created_at": rule.created_at.isoformat()
        })
    
    return {
        "rules": rule_data,
        "total_count": len(rules),
        "active_count": len([r for r in rules if r.is_active])
    }

@router.put("/admin/monitoring/alert-rules/{rule_id}")
async def update_alert_rule(
    rule_id: int,
    updates: dict,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Update an existing alert rule."""
    
    rule = db.query(AlertRule).filter(AlertRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    
    # Update allowed fields
    allowed_fields = [
        "rule_name", "threshold_value", "comparison_operator", "alert_level",
        "description", "cooldown_minutes", "email_enabled", "slack_enabled", "is_active"
    ]
    
    for field, value in updates.items():
        if field in allowed_fields and hasattr(rule, field):
            if field == "alert_level":
                value = AlertLevel(value)
            setattr(rule, field, value)
    
    db.commit()
    db.refresh(rule)
    
    return {
        "message": "Alert rule updated successfully",
        "rule_id": rule.id
    }

@router.get("/admin/monitoring/performance-trends")
async def get_performance_trends(
    days: int = Query(7, description="Number of days to analyze"),
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Get system performance trends over time."""
    
    since_date = datetime.utcnow() - timedelta(days=days)
    
    # Get system metrics trends
    metrics_data = db.query(
        SystemMetric.metric_type,
        SystemMetric.metric_name,
        func.date(SystemMetric.timestamp).label('date'),
        func.avg(SystemMetric.value).label('avg_value'),
        func.max(SystemMetric.value).label('max_value'),
        func.min(SystemMetric.value).label('min_value'),
        func.count(SystemMetric.id).label('count')
    ).filter(
        SystemMetric.timestamp >= since_date
    ).group_by(
        SystemMetric.metric_type,
        SystemMetric.metric_name,
        func.date(SystemMetric.timestamp)
    ).order_by(SystemMetric.timestamp.desc()).all()
    
    # Organize data by metric type
    trends = {}
    for metric in metrics_data:
        metric_key = f"{metric.metric_type.value}_{metric.metric_name}"
        if metric_key not in trends:
            trends[metric_key] = {
                "metric_type": metric.metric_type.value,
                "metric_name": metric.metric_name,
                "data_points": []
            }
        
        trends[metric_key]["data_points"].append({
            "date": metric.date.isoformat(),
            "avg_value": round(metric.avg_value, 2),
            "max_value": round(metric.max_value, 2),
            "min_value": round(metric.min_value, 2),
            "sample_count": metric.count
        })
    
    return {
        "period_days": days,
        "trends": trends,
        "generated_at": datetime.utcnow().isoformat()
    }