import os
from dotenv import load_dotenv

# Load environment variables FIRST - before any other imports
env_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=env_path)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Import database setup and models
from database import create_tables, get_db_info
from app.models import user, usage  # Import models to register them with SQLAlchemy

from app.api import upload, process, download, feedback, auth, users

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

# Debug: Check JWT secret key
jwt_secret = os.getenv('JWT_SECRET_KEY')
if jwt_secret:
    print(f"✅ JWT_SECRET_KEY loaded: {jwt_secret[:10]}...")
else:
    print("❌ JWT_SECRET_KEY not set")

app = FastAPI(title="Photo Processor API", version="1.0.0")

# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    """Initialize database tables on startup."""
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
    db = SessionLocal()
    try:
        cleaned = auth_service.cleanup_expired_sessions(db)
        if cleaned > 0:
            print(f"🧹 Cleaned up {cleaned} expired sessions")
    finally:
        db.close()

# Configure CORS based on environment
allowed_origins = [
    "http://localhost:5173", 
    "http://localhost:8000", 
    "http://127.0.0.1:5173", 
    "http://127.0.0.1:8000"
]

# Add production and staging URLs if in cloud environment
if os.getenv('ENVIRONMENT') in ['production', 'staging']:
    # Add your Cloud Run URLs here once deployed
    allowed_origins.extend([
        "https://tagsort-production-*.a.run.app",
        "https://tagsort-staging-*.a.run.app",
        # Add your custom domain if you have one
        # "https://yourdomain.com"
    ])

# Add Replit deployment URLs
allowed_origins.extend([
    "https://photo-processor-2-mpatrikios1.replit.app",
    "https://*.replit.app",  # Allow all replit.app subdomains
    "https://*.replit.dev",  # Allow all replit.dev subdomains
])

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,  # Enable credentials for authentication
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Create required directories
upload_dir = os.path.join(os.path.dirname(__file__), "uploads")
processed_dir = os.path.join(os.path.dirname(__file__), "processed") 
exports_dir = os.path.join(os.path.dirname(__file__), "exports")

os.makedirs(upload_dir, exist_ok=True)
os.makedirs(processed_dir, exist_ok=True)
os.makedirs(exports_dir, exist_ok=True)

print(f"Created directories: {upload_dir}, {processed_dir}, {exports_dir}")

# Include API routers FIRST - before static file mounts
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(upload.router, prefix="/api/upload", tags=["upload"])
app.include_router(process.router, prefix="/api/process", tags=["process"])
app.include_router(download.router, prefix="/api/download", tags=["download"])
app.include_router(feedback.router, prefix="/api/feedback", tags=["feedback"])

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

@app.get("/")
async def root():
    return {"message": "Photo Processor API is running"}

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