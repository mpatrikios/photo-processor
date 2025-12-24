# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TagSort - Automatic event photo sorting by bib number detection using Gemini Flash AI. Features analytics dashboard, batch processing, and user authentication.

**Tech Stack**: FastAPI backend (Python) + Vanilla JavaScript frontend (Bootstrap 5)
**Note**: README mentions React/TypeScript/Tailwind but actual frontend is vanilla JS with Bootstrap

## Development Commands

```bash
# Setup (installs both npm and Python dependencies)
npm run install:all

# Development
npm run dev                 # Starts both frontend (:5173) and backend (:8000)
npm run dev:frontend        # Frontend only  
npm run dev:backend         # Backend only

# Production
npm run start              # Production backend

# Database
cd backend && alembic upgrade head  # Apply database migrations
cd backend && alembic revision --autogenerate -m "description"  # Create new migration

# Testing
python test_vision.py      # Test Google Vision API setup
# No formal test suite - manual testing required
```

## Architecture

### Core Processing Flow
1. Upload → UUID-named files in `uploads/` or Google Cloud Storage
2. Async processing with Gemini Flash AI only
3. Group by detected bib numbers (1-99999 range)
4. Export as organized ZIP
5. Analytics tracking and batch operations

### Backend Structure
**FastAPI Application** (`backend/main.py`)
- CORS middleware for frontend integration
- Rate limiting via SlowAPI
- Database initialization and model registration
- Gemini Flash AI configuration

**Core Services** (`backend/app/services/`)
- `detector.py:NumberDetector` - Gemini Flash AI bib number detection
- `analytics_service.py` - Processing metrics and performance tracking
- `job_service.py` - Async job management and status tracking
- `export_service.py` - ZIP file generation and download management
- `auth_service.py` - JWT authentication and user management

**API Endpoints** (`backend/app/api/`)
- `upload.py` - File upload with UUID naming
- `process.py` - Async detection jobs with progress tracking
- `download.py` - Export ZIP generation and serving
- `analytics.py` - Processing statistics and performance metrics
- `batch.py` - Bulk operations and batch processing
- `auth.py` - Authentication endpoints (login, register, refresh)

**Configuration** (`backend/app/core/`)
- `config.py` - Environment validation with Pydantic settings
- `security.py` - JWT handling, rate limiting, security headers
- `errors.py` - Global error handling and custom exceptions

### Frontend Structure
**Main Application** (`frontend/static/js/script.js:PhotoProcessor`)
- Drag & drop file uploads with progress tracking
- Real-time processing status polling
- Photo grouping, filtering, and export management
- Critical navigation: Separate workflows for detected vs unknown photos
- State tracking: `wasEditingDetectedPhoto` vs `wasUnknownPhoto`
- `saveInlineLabel()`: Timeout protection (10s save, 8s refresh)

**Additional Modules**
- `analytics-dashboard.js` - Processing metrics visualization
- `batch-operations.js` - Bulk processing interface
- `state-manager.js` - Centralized state management

### Database (SQLite/PostgreSQL)
**Models** (`backend/app/models/`)
- `user.py` - User authentication and profiles  
- `processing.py` - Job tracking and photo metadata
- `analytics.py` - Performance metrics and usage statistics
- `usage.py` - API usage tracking and rate limiting

**Database & Migrations** (`backend/alembic/`)
- **SQLite**: Development only (single-file, not scalable)
- **PostgreSQL**: Production (Google Cloud SQL recommended)
- **Alembic**: Database schema versioning with auto-generated migrations

### Key API Endpoints
- `POST /api/auth/login` - User authentication
- `POST /api/upload/photos` - Upload with UUID naming
- `POST /api/process/start` - Start async detection job
- `GET /api/process/status/{job_id}` - Poll every 2s for progress
- `POST /api/batch/process` - Bulk processing operations
- `GET /api/analytics/stats` - Processing statistics
- `POST /api/download/export` - Generate ZIP
- API docs: http://localhost:8000/docs

## Environment Configuration

**Required Environment Variables** (see `backend/.env.example`):
```bash
# Security (REQUIRED for production)
JWT_SECRET_KEY=your_secure_random_string_here

# Gemini Flash API (REQUIRED for image classification)
GEMINI_API_KEY=your_gemini_api_key_here

# Database (CRITICAL: Use PostgreSQL for production!)
DATABASE_URL=sqlite:///./tag_photos.db  # Development only
# DATABASE_URL=postgresql://user:pass@host:5432/db  # Local PostgreSQL
# DATABASE_URL=postgresql://user:pass@/dbname?host=/cloudsql/PROJECT:REGION:INSTANCE  # Cloud SQL

# API Configuration
API_HOST=0.0.0.0
API_PORT=8000
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

## PostgreSQL Production Migration

### Why PostgreSQL is Required for Production

**🚨 SQLite Limitations:**
- Single file, not suitable for multiple Cloud Run instances
- "Database is locked" errors under concurrent access
- No horizontal scaling, limited to single server
- No atomic transactions across multiple connections

**✅ PostgreSQL on Google Cloud SQL Benefits:**
- Managed service with automatic backups and scaling
- Supports multiple concurrent Cloud Run instances
- ACID compliance with full transaction support
- Connection pooling for optimal performance
- Built-in monitoring and alerting

### Migration Steps

#### 1. **Create Google Cloud SQL Instance**
```bash
# Create PostgreSQL instance (adjust as needed)
gcloud sql instances create tagsort-db \
    --database-version=POSTGRES_15 \
    --tier=db-f1-micro \
    --region=us-central1 \
    --root-password=YOUR_SECURE_PASSWORD

# Create application database
gcloud sql databases create tagsort --instance=tagsort-db

# Create application user
gcloud sql users create tagsort_user \
    --instance=tagsort-db \
    --password=YOUR_APP_PASSWORD
```

#### 2. **Update Environment Variables**
```bash
# For Cloud Run deployment, set these environment variables:
DATABASE_URL=postgresql://tagsort_user:YOUR_APP_PASSWORD@/tagsort?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_ID
ENVIRONMENT=production

# Alternative: Public IP connection (less secure)
# DATABASE_URL=postgresql://tagsort_user:YOUR_APP_PASSWORD@INSTANCE_IP:5432/tagsort
```

#### 3. **Run Database Migrations**
```bash
# Apply all migrations to new PostgreSQL database
cd backend && alembic upgrade head

# Verify migration success
cd backend && alembic current
```

#### 4. **Data Migration (if needed)**
```bash
# If migrating from existing SQLite, export data first
sqlite3 tag_photos.db .dump > data_backup.sql

# Then manually adapt and import into PostgreSQL
# (Schema will be created by Alembic, only migrate data if needed)
```

#### 5. **Test Connection**
```python
# Test script to verify database connection
python3 -c "
from backend.database import get_db_info
import json
print(json.dumps(get_db_info(), indent=2))
"
```

### Cloud Run Deployment Configuration

**Environment Variables for Cloud Run:**
```yaml
# In your Cloud Run service configuration
env:
  - name: DATABASE_URL
    value: "postgresql://user:pass@/dbname?host=/cloudsql/PROJECT:REGION:INSTANCE"
  - name: ENVIRONMENT  
    value: "production"
  - name: JWT_SECRET_KEY
    valueFrom:
      secretKeyRef:
        name: jwt-secret
        key: secret-key
```

**Cloud SQL Proxy Connection:**
- Cloud Run automatically handles Cloud SQL connections via socket
- Use `/cloudsql/PROJECT_ID:REGION:INSTANCE_ID` format in DATABASE_URL
- No need for Cloud SQL Proxy container in Cloud Run

## Gemini Flash API Setup

1. Visit [Google AI Studio](https://ai.google.dev/) 
2. Create a new API key for Gemini Flash
3. Add to `backend/.env`: `GEMINI_API_KEY=your_api_key_here`
4. Test: Run the application and try uploading photos

**Benefits of Gemini Flash:**
- ✅ Simpler setup (just API key, no service account)
- ✅ Better accuracy for bib number detection
- ✅ Faster processing times
- ✅ Cost-effective pricing
- ✅ Built-in image optimization

## Critical Implementation Details

### Security Features
- JWT-based authentication with refresh tokens
- Rate limiting (configurable per endpoint)
- CORS protection for frontend origins
- SQL injection protection via SQLAlchemy ORM
- Input validation with Pydantic models

### Error Handling & Resilience
- Gemini Flash error handling with retry logic
- Frontend timeout protection via `Promise.race()`
- Global error handling with user-friendly messages
- Graceful degradation when API unavailable
- Input field state always restored on success/error

### State Management
- SQLite database for development, PostgreSQL recommended for production
- In-memory job tracking with persistent metadata
- Frontend state management via `state-manager.js`
- Analytics data aggregation and caching

### Performance Optimizations
- Lazy Google Vision client initialization
- Async processing with background job queues
- Batch operations for bulk photo processing
- Database connection pooling
- Frontend polling optimization (2s intervals)

### Navigation Workflows
**Critical Pattern**: Separate workflows for detected vs unknown photos
- Store original photo state before `isEditMode` modification
- Use `wasEditingDetectedPhoto` and `wasUnknownPhoto` for navigation decisions
- Auto-advance for rapid unknown photo labeling workflow
- Timeout protection in save operations with state restoration

## Common Issues

**Backend connection refused**: Dependencies not installed
```bash
npm run install:backend  # Or manually setup venv + pip install -r requirements.txt
```

**Database errors**: Migrations not applied
```bash
cd backend && alembic upgrade head
```

**Port 5173 in use**:
```bash
lsof -ti:5173 | xargs kill -9
```

**JWT token errors**: Invalid or missing JWT_SECRET_KEY
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(32))"  # Generate new key
```

**Gemini API errors**: Invalid or missing GEMINI_API_KEY
```bash
# Check API key is set
echo $GEMINI_API_KEY
# Get new API key from: https://ai.google.dev/
```

### Files Not in Git
- `backend/.env` - Environment variables (use .env.example as template)
- `backend/tag_photos.db` - SQLite database (auto-created)
- `uploads/`, `processed/`, `exports/`, `temp/` - Runtime directories