# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TagSort - Automatic event photo sorting by bib number detection using computer vision (Google Cloud Vision API + Tesseract OCR fallback).

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

### Key Components

**backend/app/services/detector.py:NumberDetector**
- Dual OCR strategy with confidence thresholds (Google >0.6, Tesseract >0.5)
- Bib validation: 1-6 digits, range 1-99999
- Lazy Google Vision client initialization

**frontend/static/js/script.js:PhotoProcessor**
- Critical navigation: Separate workflows for detected vs unknown photos
- `saveInlineLabel()`: Timeout protection (10s save, 8s refresh) 
- State tracking: `wasEditingDetectedPhoto` vs `wasUnknownPhoto`
- Auto-advance for rapid unknown photo labeling

### API Endpoints
- `POST /api/upload/photos` - Upload with UUID naming
- `POST /api/process/start` - Start async detection job
- `GET /api/process/status/{job_id}` - Poll every 2s for progress
- `POST /api/download/export` - Generate ZIP
- API docs: http://localhost:8000/docs

## Google Cloud Vision Setup

1. Enable Vision API in Google Cloud Console
2. Create service account with "Cloud Vision API User" role  
3. Download JSON key to `backend/service-account-key.json`
4. Add to `backend/.env`: `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`
5. Test: `python test_vision.py`

## Critical Implementation Details

### Error Handling
- Google Vision errors auto-fallback to Tesseract
- Frontend timeout protection via `Promise.race()`
- Input field state always restored on success/error

### State Management  
- All state in memory (no database)
- Jobs dictionary tracks async processing
- Frontend polls status every 2 seconds

### Common Issues

**Backend connection refused**: Dependencies not installed
```bash
npm run install:backend  # Or manually setup venv
```

**Port 5173 in use**:
```bash
lsof -ti:5173 | xargs kill -9
```

### Files Not in Git
- `backend/.env` - Environment variables
- `backend/service-account-key.json` - Google Cloud credentials
- `uploads/`, `processed/`, `exports/` - Runtime directories