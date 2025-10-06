import os
from dotenv import load_dotenv

# Load environment variables FIRST - before any other imports
env_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=env_path)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

# Import database setup and models
from database import create_tables, get_db_info
from app.models import user, usage, analytics, processing  # Import models to register them with SQLAlchemy

from app.api import upload, process, download, feedback, auth, users, batch, analytics
from app.core.config import settings
from app.core.security import limiter, custom_rate_limit_handler, SecurityHeaders
from app.core.errors import register_error_handlers
import asyncio

# Set up Google Cloud credentials if available
def setup_google_credentials():
    # First try loading from environment variable (for deployment)
    credentials_json = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
    if credentials_json:
        # Create a temporary file for the credentials
        import tempfile
        import json

        try:
            # Parse the JSON to validate it
            credentials_data = json.loads(credentials_json)

            # Create a temporary file
            temp_file = tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json')
            json.dump(credentials_data, temp_file)
            temp_file.close()

            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = temp_file.name
            print(f"✅ Google Cloud credentials loaded from environment variable")
        except json.JSONDecodeError:
            print("❌ Invalid JSON in GOOGLE_APPLICATION_CREDENTIALS_JSON")
        except Exception as e:
            print(f"❌ Error setting up credentials from environment: {e}")
    else:
        # Fallback to local file (for development)
        service_account_path = os.path.join(os.path.dirname(__file__), "service-account-key.json")

        if os.path.exists(service_account_path):
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = service_account_path
            print(f"✅ Google Cloud credentials loaded: {service_account_path}")
        else:
            print("❌ Credentials file not found")

setup_google_credentials()

# Debug: Print environment variables
google_creds = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
if google_creds:
    print(f"✅ Google Cloud credentials loaded: {google_creds}")
    if os.path.exists(google_creds):
        print("✅ Credentials file exists")
    else:
        print("❌ Credentials file not found")
else:
    print("❌ GOOGLE_APPLICATION_CREDENTIALS not set")

# Security check for JWT
if settings.is_production():
    print("✅ Running in PRODUCTION mode with secure JWT configuration")
else:
    print("⚠️  Running in DEVELOPMENT mode")

app = FastAPI(
    title="TagSort API",
    version="2.0.0",
    description="Secure photo processing API with bib number detection",
    docs_url="/docs" if settings.debug else None,  # Disable docs in production
    redoc_url="/redoc" if settings.debug else None  # Disable redoc in production
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
            
            from database import SessionLocal
            from app.services.job_service import job_service
            from app.services.auth_service import auth_service
            
            db = SessionLocal()
            try:
                # Clean up expired jobs
                cleaned_jobs = job_service.cleanup_expired_jobs(db)
                if cleaned_jobs > 0:
                    logger.info(f"Periodic cleanup: removed {cleaned_jobs} expired jobs")
                
                # Clean up expired sessions
                cleaned_sessions = auth_service.cleanup_expired_sessions(db)
                if cleaned_sessions > 0:
                    logger.info(f"Periodic cleanup: removed {cleaned_sessions} expired sessions")
                    
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
    # Print configuration info
    settings.print_startup_info()
    
    print("🔄 Initializing database...")
    create_tables()

    db_info = get_db_info()
    print(f"✅ Database initialized: {db_info['database_path']}")
    print(f"📊 Database size: {db_info['database_size_mb']} MB")

    # Test AuthService singleton and JWT functionality
    from app.services.auth_service import auth_service
    print(f"🧪 Testing AuthService functionality...")

    # Test token creation and verification
    test_token = auth_service.create_access_token(999)  # Test user ID
    print(f"🧪 Test token created: {test_token[:50]}...")

    test_result = auth_service.verify_token(test_token)
    if test_result:
        print(f"✅ AuthService test PASSED - tokens work correctly")
    else:
        print(f"❌ AuthService test FAILED - JWT not working properly")

    # Clean up expired sessions on startup
    from database import SessionLocal
    from app.services.job_service import job_service
    
    db = SessionLocal()
    try:
        # Clean up expired sessions
        cleaned_sessions = auth_service.cleanup_expired_sessions(db)
        if cleaned_sessions > 0:
            print(f"🧹 Cleaned up {cleaned_sessions} expired sessions")
        
        # Recover stalled processing jobs
        recovered_jobs = job_service.recover_jobs_on_startup(db)
        if recovered_jobs > 0:
            print(f"🔄 Recovered {recovered_jobs} processing jobs")
        
        # Load active processing jobs into memory
        from app.api.process import sync_jobs_from_database, cleanup_old_jobs
        sync_jobs_from_database()
        cleanup_old_jobs()
        
        # Clean up expired jobs and exports
        cleaned_jobs = job_service.cleanup_expired_jobs(db)
        if cleaned_jobs > 0:
            print(f"🧹 Cleaned up {cleaned_jobs} expired jobs")
            
    finally:
        db.close()
    
    # Schedule periodic cleanup
    import asyncio
    asyncio.create_task(schedule_periodic_cleanup())

# Configure CORS from settings
allowed_origins = settings.cors_origins.copy()

# Add additional origins for specific environments
if settings.environment in ['production', 'staging']:
    allowed_origins.extend([
        "https://tagsort-production-*.a.run.app",
        "https://tagsort-staging-*.a.run.app",
    ])

# Add Replit URLs if needed
if os.getenv('REPL_OWNER'):
    allowed_origins.extend([
        "https://*.replit.app",
        "https://*.replit.dev",
    ])

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,  # Enable credentials for authentication
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Create required directories with proper permissions
settings.create_directories()
print(f"✅ Created directories: {settings.upload_dir}, {settings.export_dir}, {settings.temp_dir}")

# Define API route handlers FIRST - before static file mounts
@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.get("/auth-status")
async def auth_status():
    """Get authentication system status."""
    from database import SessionLocal
    from app.models.user import User, UserSession

    db = SessionLocal()
    try:
        total_users = db.query(User).count()
        active_users = db.query(User).filter(User.is_active == True).count()
        active_sessions = db.query(UserSession).filter(UserSession.is_active == True).count()

        return {
            "auth_system": "database",
            "total_users": total_users,
            "active_users": active_users,
            "active_sessions": active_sessions,
            "database_info": get_db_info()
        }
    finally:
        db.close()

@app.get("/db-status")
async def database_status():
    """Get database status and information."""
    return {
        "status": "connected",
        "info": get_db_info()
    }

# Include API routers AFTER individual routes but before static file mounts
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(upload.router, prefix="/api/upload", tags=["upload"])
app.include_router(process.router, prefix="/api/process", tags=["process"])
app.include_router(download.router, prefix="/api/download", tags=["download"])
app.include_router(feedback.router, prefix="/api/feedback", tags=["feedback"])
app.include_router(batch.router, prefix="/api/batch", tags=["batch"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])

# Mount upload/processed directories for serving files
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/processed", StaticFiles(directory="processed"), name="processed")

# Serve frontend static files LAST - so they don't override API routes
frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_path):
    app.mount("/static", StaticFiles(directory=os.path.join(frontend_path, "static")), name="static")
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

print("✅ API routers registered:")
print("  - /api/auth")
print("  - /api/users")
print("  - /api/upload") 
print("  - /api/process")
print("  - /api/download")
print("  - /api/feedback")
print("  - /api/batch")
print("  - /api/analytics")