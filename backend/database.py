from sqlalchemy import create_engine, MetaData
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from pathlib import Path

# Database file path
DATABASE_DIR = Path(__file__).parent
DATABASE_URL = f"sqlite:///{DATABASE_DIR}/tag_photos.db"

# Create database directory if it doesn't exist
DATABASE_DIR.mkdir(exist_ok=True)

# Create engine with SQLite-specific settings
engine = create_engine(
    DATABASE_URL, 
    connect_args={"check_same_thread": False},  # Required for SQLite with FastAPI
    echo=False  # Set to True for SQL query logging during development
)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for all models
Base = declarative_base()

# Dependency to get database session
def get_db():
    """
    Database dependency for FastAPI endpoints.
    Provides a database session and ensures proper cleanup.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def create_tables():
    """
    Create all database tables.
    This will be called on startup to ensure tables exist.
    """
    Base.metadata.create_all(bind=engine)

def get_db_info():
    """
    Get database information for debugging.
    """
    db_path = DATABASE_DIR / "tag_photos.db"
    return {
        "database_url": DATABASE_URL,
        "database_path": str(db_path),
        "database_exists": db_path.exists(),
        "database_size_mb": round(db_path.stat().st_size / 1024 / 1024, 2) if db_path.exists() else 0
    }