import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

Base = declarative_base()

# Get variables
db_user = os.getenv("DB_USER")
db_pass = os.getenv("DB_PASS")
db_name = os.getenv("DB_NAME")
db_host = os.getenv("DB_HOST")

# Logic: If Cloud Run provides a Host, use Postgres. Otherwise, use Local SQLite.
if db_host:
    # --- CLOUD RUN (PostgreSQL) ---
    # We don't need urllib anymore because your new password is simple!
    DATABASE_URL = f"postgresql+psycopg2://{db_user}:{db_pass}@/{db_name}?host={db_host}"
    
    engine = create_engine(
        DATABASE_URL,
        pool_size=5,
        max_overflow=2,
        pool_timeout=30,
        pool_recycle=1800,
    )
else:
    # --- LOCAL DEVELOPMENT (SQLite) ---
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    DATABASE_URL = f"sqlite:///{os.path.join(BASE_DIR, 'tag_photos.db')}"
    
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        echo=True
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
    return {
        "database_url": "HIDDEN",
        "database_path": DATABASE_URL if "sqlite" in DATABASE_URL else "Cloud SQL",
        "database_size_mb": 0.0  # Placeholder to prevent startup crash
    }