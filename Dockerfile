# Use Python 3.11 slim image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements and install Python dependencies
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire application
COPY . /app/

# Create necessary directories
RUN mkdir -p uploads processed exports

# Set environment variables
ENV PYTHONPATH=/app/backend
ENV PORT=8080

# Expose port
EXPOSE 8080

# Create a startup script that serves both frontend and backend
RUN echo '#!/bin/bash\n\
# Start the FastAPI backend\n\
cd /app/backend && python -m uvicorn main:app --host 0.0.0.0 --port 8080' > /app/start.sh && \
chmod +x /app/start.sh

# Run the application
CMD ["/app/start.sh"]