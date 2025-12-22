# Use the official Python image
FROM python:3.13-slim

# 1. Force Python to show logs immediately (critical for debugging)
ENV PYTHONUNBUFFERED=1

# 2. Set the working directory to the container root
WORKDIR /app

# 3. Install system dependencies
# - libpq-dev & gcc: For Postgres (psycopg2)
# - libgl1 & libglib2.0-0: REQUIRED for opencv-python to load
# - tesseract-ocr: REQUIRED for pytesseract to work
RUN apt-get update && apt-get install -y \
    libpq-dev \
    gcc \
    libgl1 \
    libglib2.0-0 \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# 4. Copy the ENTIRE project folder into /app
COPY . .

# 5. Install dependencies
RUN pip install --no-cache-dir -r backend/requirements.txt

# 6. Add paths to Python's search list
ENV PYTHONPATH=/app/backend:/app

# 7. Move into the backend folder to run the app
WORKDIR /app/backend

# 8. Start the Real App
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}