import sys
import os
from sqlalchemy import text, inspect

# 1. Setup path to import your app code
sys.path.append(os.path.abspath('backend'))

# 2. Import your database connection and models
try:
    # Adjust imports based on your likely file structure
    from database import engine, Base
    from app.models.processing import PhotoDB  # Import the model so it registers
    print("✅ Successfully imported database engine and models.")
except ImportError as e:
    print(f"❌ Error importing app modules: {e}")
    print("Make sure you are running this from the project root directory.")
    sys.exit(1)

def fix_database():
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    
    # CASE 1: Table doesn't exist at all
    if 'photos' not in tables:
        print("🛠  'photos' table missing. Creating it now...")
        Base.metadata.create_all(bind=engine)
        print("✅  Created 'photos' table successfully.")
        return

    # CASE 2: Table exists, check for column
    print("🔍  'photos' table exists. Checking columns...")
    columns = [c['name'] for c in inspector.get_columns('photos')]
    
    if 'file_extension' not in columns:
        print("⚠️  Missing 'file_extension' column. Adding it via raw SQL...")
        with engine.connect() as conn:
            # Add the column. We allow NULLs for existing records to be safe
            conn.execute(text("ALTER TABLE photos ADD COLUMN file_extension VARCHAR"))
            conn.commit()
        print("✅  Added 'file_extension' column.")
    else:
        print("✅  Database is already up to date!")

if __name__ == "__main__":
    fix_database()