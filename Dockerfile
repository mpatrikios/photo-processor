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

# Copy the entrypoint script
COPY backend/entrypoint.sh /entrypoint.sh

# Make it executable
RUN chmod +x /entrypoint.sh

# Use ENTRYPOINT instead of CMD for proper migration handling
ENTRYPOINT ["/entrypoint.sh"]