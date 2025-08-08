from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from dotenv import load_dotenv

from app.api import upload, process, download, feedback, auth

# Load environment variables from .env file
env_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=env_path)

# Debug: Print Google Cloud credentials path
google_creds = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
if google_creds:
    print(f"✅ Google Cloud credentials loaded: {google_creds}")
    if os.path.exists(google_creds):
        print("✅ Credentials file exists")
    else:
        print("❌ Credentials file not found")
else:
    print("❌ GOOGLE_APPLICATION_CREDENTIALS not set")

app = FastAPI(title="Photo Processor API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # Set to False when using allow_origins=["*"]
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
    from app.api.auth import active_sessions
    return {
        "auth_system": "active",
        "active_sessions": len(active_sessions),
        "demo_users": ["admin", "user"]
    }