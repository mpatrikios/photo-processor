import os

from dotenv import load_dotenv

# Load environment variables FIRST - before any other imports
env_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path=env_path)

import asyncio
import logging

from fastapi import FastAPI, Request, HTTPException, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded

from app.api import analytics, auth, batch, download, feedback, process_tasks, tiers, upload, users, payment, direct_upload
from app.core.config import settings
from app.core.errors import register_error_handlers
from app.core.security_middleware import SecurityHeaders, custom_rate_limit_handler, limiter
from app.models import (  # Import models to register them with SQLAlchemy
    processing,
    usage,
    user,
)

# Import database setup and models
from database import create_tables, get_db_info, get_db
from datetime import datetime

# Configure logger for this module
logger = logging.getLogger(__name__)

# Simplified startup for Gemini Flash - no complex credential management needed

# Security check for JWT
if settings.is_production():
    logger.info("✅ Running in PRODUCTION mode with secure JWT configuration")
else:
    logger.warning("⚠️  Running in DEVELOPMENT mode")

app = FastAPI(
    title="TagSort API",
    version="2.0.0",
    description="Secure photo processing API with bib number detection",
    docs_url="/docs",  # ALWAYS enable docs
    redoc_url="/redoc",
)

# Add rate limiter to app state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, custom_rate_limit_handler)

# Register error handlers
register_error_handlers(app)


async def schedule_periodic_cleanup():
    """
    Schedule periodic cleanup of expired data.
    """
    while True:
        try:
            # Wait 1 hour between cleanup runs
            await asyncio.sleep(3600)

            from app.services.auth_service import auth_service
            from app.services.job_service import job_service
            from database import SessionLocal

            db = SessionLocal()
            try:
                # Clean up expired jobs
                cleaned_jobs = job_service.cleanup_expired_jobs(db)
                if cleaned_jobs > 0:
                    logger.info(
                        f"Periodic cleanup: removed {cleaned_jobs} expired jobs"
                    )

                # Clean up expired sessions
                cleaned_sessions = auth_service.cleanup_expired_sessions(db)
                if cleaned_sessions > 0:
                    logger.info(
                        f"Periodic cleanup: removed {cleaned_sessions} expired sessions"
                    )

            except Exception as e:
                logger.error(f"Periodic cleanup failed: {e}")
            finally:
                db.close()

        except Exception as e:
            logger.error(f"Cleanup scheduler error: {e}")
            # Continue the loop even if there's an error


# Add security headers middleware
@app.middleware("http")
async def add_security_headers_middleware(request: Request, call_next):
    return await SecurityHeaders.add_security_headers(request, call_next)


# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    """Initialize database tables and configuration on startup."""
    # Enable SQL query logging for debugging
    logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)
    logger.info("🔍 SQL query logging enabled for analytics debugging")
    
    # Print configuration info
    settings.print_startup_info()

    logger.info("🔄 Database connection ready...")
    
    db_info = get_db_info()
    logger.info(f"✅ Database connected: {db_info['database_path']}")
    logger.info(f"📊 Database size: {db_info['database_size_mb']} MB")

    # Test AuthService singleton and JWT functionality
    from app.services.auth_service import auth_service

    logger.info("🧪 Testing AuthService functionality...")

    # Test token creation and verification
    test_token = auth_service.create_access_token(999)  # Test user ID
    logger.debug(f"🧪 Test token created: {test_token[:50]}...")

    test_result = auth_service.verify_token(test_token)
    if test_result:
        logger.info("✅ AuthService test PASSED - tokens work correctly")
    else:
        logger.error("❌ AuthService test FAILED - JWT not working properly")

    # Clean up expired sessions on startup
    from app.services.job_service import job_service
    from database import SessionLocal

    db = SessionLocal()
    try:
        # Ensure critical tables exist (self-healing approach)
        try:
            from database import Base, engine
            Base.metadata.create_all(bind=engine)
            logger.info("✅ Database tables verified/created")
        except Exception as e:
            logger.warning(f"⚠️ Table creation verification failed: {e}")

        # Clean up expired sessions
        try:
            cleaned_sessions = auth_service.cleanup_expired_sessions(db)
            if cleaned_sessions > 0:
                logger.info(f"🧹 Cleaned up {cleaned_sessions} expired sessions")
        except Exception as e:
            logger.warning(f"⚠️ Session cleanup failed: {e}")

        # Recover stalled processing jobs (gracefully handle missing tables)
        try:
            recovered_jobs = job_service.recover_jobs_on_startup(db)
            if recovered_jobs > 0:
                logger.info(f"🔄 Recovered {recovered_jobs} processing jobs")
        except Exception as e:
            logger.warning(f"⚠️ Job recovery skipped (tables may not exist yet): {e}")

        # Load active processing jobs into memory (gracefully handle missing tables)
        try:
            from app.api.process_tasks import cleanup_old_jobs, sync_jobs_from_database
            sync_jobs_from_database()
            cleanup_old_jobs()
            logger.info("🔄 Synced active jobs from database")
        except Exception as e:
            logger.warning(f"⚠️ Job sync skipped (tables may not exist yet): {e}")

        # Clean up expired jobs and exports (gracefully handle missing tables)
        try:
            cleaned_jobs = job_service.cleanup_expired_jobs(db)
            if cleaned_jobs > 0:
                logger.info(f"🧹 Cleaned up {cleaned_jobs} expired jobs")
        except Exception as e:
            logger.warning(f"⚠️ Job cleanup skipped (tables may not exist yet): {e}")

    finally:
        db.close()

    # Schedule periodic cleanup
    import asyncio

    asyncio.create_task(schedule_periodic_cleanup())


# Configure CORS from settings
allowed_origins = settings.cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create required directories with proper permissions
settings.create_directories()
logger.info(
    f"✅ Created directories: {settings.upload_dir}, {settings.export_dir}, {settings.temp_dir}"
)


# Define API route handlers FIRST - before static file mounts
@app.get("/health")
async def health_check(db: Session = Depends(get_db)):
    """Health check for monitoring"""
    try:
        # Check database connectivity
        db.execute(text("SELECT 1"))
        return {
            "status": "healthy",
            "timestamp": datetime.utcnow().isoformat(),
            "database": "connected"
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail="Service unhealthy")


@app.get("/auth-status")
async def auth_status():
    """Get authentication system status."""
    from app.models.user import User, UserSession
    from database import SessionLocal

    db = SessionLocal()
    try:
        total_users = db.query(User).count()
        active_users = db.query(User).filter(User.is_active.is_(True)).count()
        active_sessions = (
            db.query(UserSession).filter(UserSession.is_active.is_(True)).count()
        )

        return {
            "auth_system": "database",
            "total_users": total_users,
            "active_users": active_users,
            "active_sessions": active_sessions,
            "database_info": get_db_info(),
        }
    finally:
        db.close()


@app.get("/db-status")
async def database_status():
    """Get database status and information."""
    return {"status": "connected", "info": get_db_info()}


# Include API routers AFTER individual routes but before static file mounts
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(upload.router, prefix="/api/upload", tags=["upload"])
app.include_router(process_tasks.router, prefix="/api/process", tags=["process"])
app.include_router(download.router, prefix="/api/download", tags=["download"])
app.include_router(feedback.router, prefix="/api/feedback", tags=["feedback"])
app.include_router(batch.router, prefix="/api/batch", tags=["batch"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
app.include_router(payment.router, prefix="/api/payment", tags=["payment"])
app.include_router(tiers.router, prefix="/api/tiers", tags=["tiers"])
app.include_router(direct_upload.router, prefix="/api/direct-upload", tags=["direct-upload"])

# Secure file access with user isolation
from app.api import secure_files

app.include_router(secure_files.router, tags=["secure-files"])

# Mount upload/processed directories for serving files
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/processed", StaticFiles(directory="processed"), name="processed")

# Serve frontend static files LAST - so they don't override API routes
frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_path):
    app.mount(
        "/static",
        StaticFiles(directory=os.path.join(frontend_path, "static")),
        name="static",
    )
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

logger.info("✅ API routers registered:")
logger.info("  - /api/auth")
logger.info("  - /api/users")
logger.info("  - /api/upload")
logger.info("  - /api/process")
logger.info("  - /api/download")
logger.info("  - /api/feedback")
logger.info("  - /api/batch")
logger.info("  - /api/analytics")
logger.info("  - /api/payment")

if __name__ == "__main__":
    import uvicorn
    import os
    # Get the PORT from Cloud Run (defaults to 8080)
    port = int(os.environ.get("PORT", 8080))
    
    # ✅ CORRECT FastAPI startup
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
