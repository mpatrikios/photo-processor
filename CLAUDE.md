# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TagSort - Automatic event photo sorting by bib number detection using computer vision (Google Cloud Vision API + Tesseract OCR fallback). Features analytics dashboard, batch processing, and user authentication.

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
1. Upload → UUID-named files in `uploads/`
2. Async processing with Google Vision API → Tesseract fallback
3. Group by detected bib numbers (1-99999 range)
4. Export as organized ZIP
5. Analytics tracking and batch operations

### Backend Structure
**FastAPI Application** (`backend/main.py`)
- CORS middleware for frontend integration
- Rate limiting via SlowAPI
- Database initialization and model registration
- Google Cloud credentials setup with fallback strategies

**Core Services** (`backend/app/services/`)
- `detector.py:NumberDetector` - Dual OCR with confidence scoring
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

**Migrations** (`backend/alembic/`)
- Database schema versioning with Alembic
- Auto-generated migrations for model changes

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

# Google Cloud Vision API
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
# OR for deployment:
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account"...}

# Database  
DATABASE_URL=sqlite:///./tag_photos.db  # Development
# DATABASE_URL=postgresql://user:pass@host:5432/db  # Production

# API Configuration
API_HOST=0.0.0.0
API_PORT=8000
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

## Google Cloud Vision Setup

1. Enable Vision API in Google Cloud Console
2. Create service account with "Cloud Vision API User" role
3. Download JSON key to `backend/service-account-key.json`
4. Add to `backend/.env`: `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`
5. Test: `python test_vision.py`

## Critical Implementation Details

### Security Features
- JWT-based authentication with refresh tokens
- Rate limiting (configurable per endpoint)
- CORS protection for frontend origins
- SQL injection protection via SQLAlchemy ORM
- Input validation with Pydantic models

### Error Handling & Resilience
- Google Vision errors auto-fallback to Tesseract
- Frontend timeout protection via `Promise.race()`
- Global error handling with user-friendly messages
- Graceful degradation when services unavailable
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

### Files Not in Git
- `backend/.env` - Environment variables (use .env.example as template)
- `backend/service-account-key.json` - Google Cloud credentials
- `backend/tag_photos.db` - SQLite database (auto-created)
- `uploads/`, `processed/`, `exports/`, `temp/` - Runtime directories