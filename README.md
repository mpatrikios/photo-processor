# Race Photo Processor

An intelligent photo processing application that automatically detects and sorts race photos by bib numbers using Google Cloud Vision API and OpenCV.

## Features

- **Automatic Bib Number Detection**: Uses Google Cloud Vision API as primary method with Tesseract OCR fallback
- **Bulk Photo Upload**: Drag & drop interface for uploading multiple race photos
- **Real-time Processing**: Live progress tracking with async background processing
- **Smart Sorting**: Groups photos by detected bib numbers with confidence scoring
- **Organized Export**: Download sorted photos as ZIP files with organized folder structure
- **Modern UI**: Clean, responsive React interface with Tailwind CSS

## Tech Stack

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Python + FastAPI + OpenCV + Google Cloud Vision
- **Development**: NPM orchestration for both frontend and backend

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.8+
- Tesseract OCR
- Google Cloud Vision API (optional but recommended)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd photo-processor
   ```

2. **Install all dependencies**
   ```bash
   npm run install:all
   ```

3. **Install Tesseract OCR**
   ```bash
   # macOS
   brew install tesseract
   
   # Ubuntu/Debian
   sudo apt-get install tesseract-ocr
   ```

4. **Set up Google Cloud Vision (recommended)**
   - Follow instructions in `backend/setup_google_vision.md`
   - Create service account and download JSON key
   - Set environment variable or copy to backend directory

### Development

```bash
# Start both frontend and backend
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

### Production Build

```bash
npm run build
```

## Project Structure

```
photo-processor/
├── frontend/                 # React application
│   ├── src/
│   │   ├── components/       # UI components
│   │   ├── services/         # API client
│   │   └── types/           # TypeScript types
│   └── package.json
├── backend/                  # Python FastAPI
│   ├── app/
│   │   ├── api/             # REST endpoints
│   │   ├── core/            # CV processing
│   │   ├── models/          # Data models
│   │   └── services/        # Business logic
│   ├── requirements.txt
│   └── main.py
├── package.json             # NPM orchestration
└── README.md
```

## API Endpoints

- `POST /api/upload/photos` - Upload race photos
- `POST /api/process/start` - Start bib number detection
- `GET /api/process/status/{job_id}` - Check processing progress
- `GET /api/process/results/{job_id}` - Get grouped results
- `POST /api/download/export` - Create ZIP export
- `GET /api/download/file/{export_id}` - Download ZIP file

## Configuration

### Environment Variables

Create `backend/.env`:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
API_HOST=0.0.0.0
API_PORT=8000
```

### Google Cloud Vision Setup

1. Enable Cloud Vision API in Google Cloud Console
2. Create service account with Vision API permissions
3. Download JSON credentials
4. Set `GOOGLE_APPLICATION_CREDENTIALS` environment variable

See `backend/setup_google_vision.md` for detailed instructions.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details