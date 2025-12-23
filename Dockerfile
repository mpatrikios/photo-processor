# Use Python 3.11-slim
FROM python:3.11-slim

# Force logs to show immediately
ENV PYTHONUNBUFFERED=1

# Set working directory to root
WORKDIR /app

# Install ONLY what is needed for Postgres
RUN apt-get update && apt-get install -y \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY backend/requirements.txt ./requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the app
COPY . .

# --- THE MAGIC FIX ---
# Add 'backend' to the search path so "import app" works
ENV PYTHONPATH=/app/backend:/app

# Start the app
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8080"]