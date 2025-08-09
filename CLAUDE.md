# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The Race Photo Processor is a web application that automatically detects and sorts race photos by bib numbers using computer vision. It combines Google Cloud Vision API with Tesseract OCR for robust text detection.

### Technology Stack

**Backend**: Python FastAPI with async support
- Framework: FastAPI 0.104.1+ with Uvicorn ASGI server
- Computer Vision: Google Cloud Vision API (primary) + Tesseract OCR (fallback)
- Dependencies: opencv-python, pytesseract, pillow, google-cloud-vision
- File handling: python-multipart, aiofiles for async file operations

**Frontend**: Vanilla JavaScript with Bootstrap 5
- No build process - serves static files via Python HTTP server
- Bootstrap 5.3.2 + FontAwesome 6.4.0 (CDN)
- Custom CSS with CSS variables and modern styling

**Note**: The README.md incorrectly mentions React/TypeScript/Tailwind - the actual frontend uses vanilla JavaScript and Bootstrap 5.

## Development Commands

### Setup and Installation
```bash
# Install all dependencies (both npm and python)
npm run install:all

# Install only backend dependencies (creates venv and installs requirements.txt)
npm run install:backend

# Alternative: Manual setup
cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt

# Alternative: Using UV package manager
uv sync  # if using uv.lock
```

### Development Server
```bash
# IMPORTANT: Activate venv first if installing manually
cd backend && source venv/bin/activate && cd ..

# Start both frontend and backend in development mode
npm run dev

# Start individual services
npm run dev:frontend    # Frontend on http://localhost:5173
npm run dev:backend     # Backend API on http://localhost:8000
```

### Production
```bash
# Start production backend server
npm run start
# Or directly: cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### Testing and Validation
```bash
# Test Google Vision API setup
python test_vision.py

# No formal test suite currently configured
# When running code changes, manually test via:
# 1. Upload photos via frontend
# 2. Check processing works
# 3. Verify export functionality
```

## Architecture

### Backend Structure (`backend/`)
- `main.py`: FastAPI app entry point with CORS middleware and route registration
- `app/api/`: REST API endpoints
  - `upload.py`: File upload handling with UUID-based naming
  - `process.py`: Async photo processing jobs with status tracking
  - `download.py`: Export and ZIP file generation
- `app/services/detector.py`: Core computer vision logic with dual OCR approach
- `app/models/schemas.py`: Pydantic data models for API contracts

### Frontend Structure (`frontend/`)
- `index.html`: Single-page application with Bootstrap 5 components
- `static/js/script.js`: Main PhotoProcessor class handling:
  - Drag & drop file uploads
  - Real-time processing progress
  - Photo grouping and filtering
  - Export functionality with ZIP downloads
- `static/css/style.css`: Custom styling with CSS variables

### Key Classes and Components

**NumberDetector** (backend/app/services/detector.py):
- Lazy initialization of Google Vision client
- Dual detection strategy: Google Vision API → Tesseract fallback
- Confidence scoring and bounding box detection
- Bib number validation (1-6 digits, range 1-99999)

**PhotoProcessor** (frontend/static/js/script.js):
- Main frontend application class
- Handles file selection, upload, processing workflow
- Real-time status polling and UI updates
- Photo filtering, sorting, and export management
- **Critical Navigation Logic**: Separate workflows for detected vs unknown photos
  - `saveInlineLabel()`: Smart navigation with timeout protection (10s save, 8s refresh)
  - `advanceToNextUnknownPhoto()`: Auto-advances for rapid labeling workflow
  - State-based decision making: `wasEditingDetectedPhoto` vs `wasUnknownPhoto`

### Processing Pipeline
1. **Upload**: Files stored with UUID names in `uploads/` directory
2. **Processing**: Async job creation with background OCR detection
3. **Detection**: Google Vision API (primary) → Tesseract OCR (fallback)
4. **Grouping**: Photos organized by detected bib numbers
5. **Export**: ZIP file generation with organized folder structure

## Google Cloud Vision Setup

**Required for production use** (Tesseract OCR is fallback):

1. Create Google Cloud project and enable Vision API
2. Create service account with "Cloud Vision API User" role
3. Download JSON credentials to `backend/service-account-key.json`
4. Set environment variable:
   ```bash
   echo "GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json" > backend/.env
   ```
5. Test setup: `python test_vision.py`

**Pricing**: 1,000 requests/month free, then $1.50/1,000 requests

## Development URLs

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Documentation: http://localhost:8000/docs (FastAPI auto-generated)
- Health Check: http://localhost:8000/health

## File Structure and Storage

### Directory Layout
```
uploads/        # Original uploaded photos (UUID-named)
processed/      # Processed photos (currently unused)
exports/        # Generated ZIP files for download
backend/.env    # Environment variables (not in git)
backend/service-account-key.json  # Google Cloud credentials (not in git)
```

### File Naming Convention
- Uploaded files: `{uuid}.{original_extension}`
- Export files: `race_photos_{export_id}.zip`

## Common Development Tasks

### Adding New API Endpoints
1. Create endpoint in appropriate `app/api/` module
2. Add route to router with proper HTTP method and response model
3. Register router in `main.py` if new module
4. Update frontend API calls in `script.js`

### Modifying Detection Logic
- Primary logic in `NumberDetector` class (backend/app/services/detector.py)
- Confidence thresholds: Google Vision (>0.6), Tesseract (>0.5)
- Bib number validation in `_is_valid_bib_number()` method

### Frontend UI Changes
- Main layout in `index.html` with Bootstrap 5 components
- Custom styling in `static/css/style.css` using CSS variables
- JavaScript interactions in `PhotoProcessor` class

### Environment Configuration
- Backend: Uses `python-dotenv` to load `.env` file
- Frontend: Hardcoded API base URL (localhost:8000)
- CORS: Configured for localhost:5173 frontend

## Important Implementation Details

### Async Processing
- Backend uses FastAPI async/await throughout
- File uploads handled synchronously, processing asynchronously
- Job status tracked in memory (`jobs` dictionary in process.py)
- Frontend polls job status every 2 seconds during processing

### Error Handling and Timeout Protection
- Google Vision API errors fall back to Tesseract automatically
- File upload validates extensions and handles save errors
- Frontend shows user-friendly error messages for API failures
- **Critical**: Timeout protection in `saveInlineLabel()` using `Promise.race()`
  - Save operations: 10-second timeout with 'Save timeout' error
  - Refresh operations: 8-second timeout with 'Refresh timeout' error
  - Input field state always restored on success/error to prevent "Saving..." stuck state
- **Keyboard Navigation**: `handleLightboxKeyboard()` allows arrow keys even when input focused, blocks other interfering keys

### Performance Considerations
- No database - all state in memory (jobs, results)
- File storage on local filesystem
- Concurrent processing limited by Python GIL and opencv/tesseract

### Security Notes
- UUID-based file naming prevents path traversal
- File extension validation on upload
- CORS restricted to localhost origins
- No authentication system currently implemented

## Common Troubleshooting

### "ERR_CONNECTION_REFUSED" on Photo Upload
**Symptom**: Frontend loads but photo uploads fail with connection refused errors

**Root Cause**: Backend dependencies not installed (missing `uvicorn`, `fastapi`, etc.)

**Solution**:
```bash
# Option 1: Use npm script
npm run install:backend

# Option 2: Manual venv setup
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
npm run dev
```

### Port 5173 Already in Use
**Symptom**: Frontend fails to start with "Address already in use"

**Solution**:
```bash
# Kill existing process
lsof -ti:5173 | xargs kill -9
# Then restart
npm run dev
```

### Photo Navigation Issues
**Key Pattern**: The application separates detected photos (edit-in-place) from unknown photos (rapid labeling workflow). When modifying navigation logic:
- Always store original photo state before `isEditMode` is modified
- Use `wasEditingDetectedPhoto` and `wasUnknownPhoto` for navigation decisions
- Ensure input field state restoration in both success and error paths