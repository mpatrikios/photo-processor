#!/bin/bash
set -e  # Exit on any error

echo "Starting TagSort API deployment..."

# 1. Run database migrations
echo "Running database migrations..."
cd /app/backend
alembic upgrade head

if [ $? -eq 0 ]; then
    echo "Database migrations completed successfully"
else
    echo "Database migrations failed"
    exit 1
fi

# 2. Start the FastAPI application
echo "Starting FastAPI application..."
cd /app
exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8080}