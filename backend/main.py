from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os
from dotenv import load_dotenv

from app.api import upload, process, download

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
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("uploads", exist_ok=True)
os.makedirs("processed", exist_ok=True)
os.makedirs("exports", exist_ok=True)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/processed", StaticFiles(directory="processed"), name="processed")

app.include_router(upload.router, prefix="/api/upload", tags=["upload"])
app.include_router(process.router, prefix="/api/process", tags=["process"])
app.include_router(download.router, prefix="/api/download", tags=["download"])

@app.get("/")
async def root():
    return {"message": "Photo Processor API is running"}

@app.get("/health")
async def health():
    return {"status": "healthy"}