from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

Base = declarative_base()

# Use DATABASE_URL from settings (supports both SQLite and PostgreSQL)
DATABASE_URL = settings.database_url

# Configure engine based on database type
if DATABASE_URL.startswith("postgresql://"):
    # PostgreSQL configuration (production)
    # QueuePool with conservative settings for Cloud Run
    # - pool_size=5: base connections per instance
    # - max_overflow=10: additional connections under load (15 total max)
    # - pool_pre_ping=True: validates connections before use (handles Cloud SQL restarts)
    # - pool_recycle=1800: refresh connections every 30min (prevents stale connections)
    engine = create_engine(
        DATABASE_URL,
        pool_size=5,
        max_overflow=10,
        pool_timeout=30,
        pool_recycle=1800,
        pool_pre_ping=True,
        connect_args={
            "sslmode": "require",
            "connect_timeout": 10,
        }
    )
elif DATABASE_URL.startswith("sqlite://"):
    # SQLite configuration (development only)
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        echo=settings.debug  # Show SQL queries in debug mode
    )
else:
    raise ValueError(
        f"Unsupported database URL: {DATABASE_URL}. "
        "Supported formats: sqlite:/// or postgresql://"
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def create_tables():
    Base.metadata.create_all(bind=engine)
    
def get_db_info():
    """Returns database connection info for logging."""
    if DATABASE_URL.startswith("postgresql://"):
        db_type = "PostgreSQL (Cloud SQL)"
        # Extract host info without exposing credentials
        try:
            host_part = DATABASE_URL.split("@")[1].split("/")[0]
            db_name = DATABASE_URL.split("/")[-1]
            db_path = f"Host: {host_part}, Database: {db_name}"
        except:
            db_path = "PostgreSQL Cloud Database"
        database_size_mb = 0  # Cannot easily get size for remote PostgreSQL
    elif DATABASE_URL.startswith("sqlite://"):
        db_type = "SQLite (Development)"
        db_path = DATABASE_URL.replace("sqlite:///", "")
        # Get SQLite file size
        import os
        try:
            if os.path.exists(db_path):
                size_bytes = os.path.getsize(db_path)
                database_size_mb = round(size_bytes / (1024 * 1024), 2)
            else:
                database_size_mb = 0
        except Exception:
            database_size_mb = 0
    else:
        db_type = "Unknown"
        db_path = "Unknown database type"
        database_size_mb = 0
    
    return {
        "database_type": db_type,
        "database_path": db_path,
        "database_url_hidden": "***HIDDEN***",  # Never expose credentials
        "database_size_mb": database_size_mb,
        "environment": settings.environment
    }