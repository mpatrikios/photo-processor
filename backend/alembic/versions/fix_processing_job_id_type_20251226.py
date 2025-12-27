"""Fix processing_job_id column type from varchar to integer

Revision ID: fix_job_id_type_20251226
Revises: add_analytics_tables_20251226
Create Date: 2025-12-26 18:40:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'fix_job_id_type_20251226'
down_revision = 'add_analytics_tables_20251226'
branch_labels = None
depends_on = None


def upgrade():
    """
    Staff-level migration: Drop and recreate photos table with correct schema.
    
    Uses explicit DDL to ensure the table is created with the exact schema
    needed for production, maintaining consistency with the PhotoDB model.
    """
    # Drop the problematic table completely - clears transaction deadlock
    op.execute("DROP TABLE IF EXISTS photos CASCADE")
    
    # Recreate photos table with correct INTEGER processing_job_id
    # This DDL matches the PhotoDB SQLAlchemy model definition
    op.execute("""
        CREATE TABLE photos (
            id SERIAL PRIMARY KEY,
            photo_id VARCHAR(36) UNIQUE NOT NULL,
            user_id INTEGER NOT NULL REFERENCES users(id),
            processing_job_id INTEGER REFERENCES processing_jobs(id),
            
            -- File information
            original_filename VARCHAR(255) NOT NULL,
            file_path VARCHAR(500) NOT NULL,
            file_size_bytes INTEGER NOT NULL,
            file_extension VARCHAR(10) NOT NULL,
            
            -- Detection results
            detected_number VARCHAR(10),
            confidence FLOAT,
            detection_method VARCHAR(20),
            bbox_x INTEGER,
            bbox_y INTEGER,
            bbox_width INTEGER,
            bbox_height INTEGER,
            
            -- Manual overrides
            manual_label VARCHAR(10),
            manual_label_by INTEGER REFERENCES users(id),
            manual_label_at TIMESTAMP WITH TIME ZONE,
            
            -- Processing status
            processing_status VARCHAR(20) DEFAULT 'pending',
            processing_error TEXT,
            processing_duration_seconds FLOAT,
            
            -- Timestamps
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE,
            processed_at TIMESTAMP WITH TIME ZONE
        )
    """)
    
    # Create indexes for performance
    op.execute("CREATE INDEX idx_photos_user_id ON photos(user_id)")
    op.execute("CREATE INDEX idx_photos_processing_job_id ON photos(processing_job_id)")
    op.execute("CREATE INDEX idx_photos_detected_number ON photos(detected_number)")
    op.execute("CREATE INDEX idx_photos_manual_label ON photos(manual_label)")
    op.execute("CREATE INDEX idx_photos_processing_status ON photos(processing_status)")


def downgrade():
    """
    Revert processing_job_id column back to VARCHAR.
    """
    # Drop foreign key constraint
    op.drop_constraint('photos_processing_job_id_fkey', 'photos', type_='foreignkey')
    
    # Change column type back to VARCHAR
    op.alter_column('photos', 'processing_job_id',
                   existing_type=sa.Integer(),
                   type_=sa.VARCHAR(length=50),
                   nullable=True,
                   postgresql_using='processing_job_id::text')