"""Add analytics tables for dashboard functionality

Revision ID: add_analytics_tables_20251226
Revises: 974d8cfe8afe
Create Date: 2025-12-26 15:45:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'add_analytics_tables_20251226'
down_revision: Union[str, Sequence[str], None] = '974d8cfe8afe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema to add analytics tables."""
    # Create conversion_funnel table
    op.create_table('conversion_funnel',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('step', sa.String(length=50), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_conversion_funnel_id'), 'conversion_funnel', ['id'], unique=False)
    op.create_index(op.f('ix_conversion_funnel_user_id'), 'conversion_funnel', ['user_id'], unique=False)
    op.create_index(op.f('ix_conversion_funnel_step'), 'conversion_funnel', ['step'], unique=False)
    op.create_index(op.f('ix_conversion_funnel_completed_at'), 'conversion_funnel', ['completed_at'], unique=False)

    # Create business_metrics table
    op.create_table('business_metrics',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('period_type', sa.String(length=20), nullable=False),
        sa.Column('total_users', sa.Integer(), nullable=True),
        sa.Column('active_users', sa.Integer(), nullable=True),
        sa.Column('total_photos_processed', sa.Integer(), nullable=True),
        sa.Column('revenue_usd', sa.Float(), nullable=True),
        sa.Column('avg_detection_accuracy', sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_business_metrics_id'), 'business_metrics', ['id'], unique=False)
    op.create_index(op.f('ix_business_metrics_date'), 'business_metrics', ['date'], unique=False)
    op.create_index(op.f('ix_business_metrics_period_type'), 'business_metrics', ['period_type'], unique=False)

    # Create detection_accuracy_logs table
    op.create_table('detection_accuracy_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('photo_id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('processing_job_id', sa.Integer(), nullable=True),
        sa.Column('detection_method', sa.String(length=30), nullable=False),
        sa.Column('processing_time_ms', sa.Float(), nullable=False),
        sa.Column('final_result', sa.String(length=20), nullable=True),
        sa.Column('manual_label', sa.String(length=20), nullable=True),
        sa.Column('is_correct', sa.Boolean(), nullable=True),
        sa.Column('detected_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['processing_job_id'], ['processing_jobs.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_detection_accuracy_logs_id'), 'detection_accuracy_logs', ['id'], unique=False)
    op.create_index(op.f('ix_detection_accuracy_logs_photo_id'), 'detection_accuracy_logs', ['photo_id'], unique=False)
    op.create_index(op.f('ix_detection_accuracy_logs_user_id'), 'detection_accuracy_logs', ['user_id'], unique=False)
    op.create_index(op.f('ix_detection_accuracy_logs_processing_job_id'), 'detection_accuracy_logs', ['processing_job_id'], unique=False)
    op.create_index(op.f('ix_detection_accuracy_logs_detection_method'), 'detection_accuracy_logs', ['detection_method'], unique=False)
    op.create_index(op.f('ix_detection_accuracy_logs_is_correct'), 'detection_accuracy_logs', ['is_correct'], unique=False)
    op.create_index(op.f('ix_detection_accuracy_logs_detected_at'), 'detection_accuracy_logs', ['detected_at'], unique=False)

    # Create user_retention_cohorts table
    op.create_table('user_retention_cohorts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('cohort_month', sa.String(length=7), nullable=False),
        sa.Column('user_count', sa.Integer(), nullable=False),
        sa.Column('month_0', sa.Float(), nullable=True),
        sa.Column('month_1', sa.Float(), nullable=True),
        sa.Column('month_2', sa.Float(), nullable=True),
        sa.Column('month_3', sa.Float(), nullable=True),
        sa.Column('month_6', sa.Float(), nullable=True),
        sa.Column('month_12', sa.Float(), nullable=True),
        sa.Column('last_updated', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_retention_cohorts_id'), 'user_retention_cohorts', ['id'], unique=False)
    op.create_index(op.f('ix_user_retention_cohorts_cohort_month'), 'user_retention_cohorts', ['cohort_month'], unique=False)


def downgrade() -> None:
    """Downgrade schema to remove analytics tables."""
    # Drop tables in reverse order
    op.drop_index(op.f('ix_user_retention_cohorts_cohort_month'), table_name='user_retention_cohorts')
    op.drop_index(op.f('ix_user_retention_cohorts_id'), table_name='user_retention_cohorts')
    op.drop_table('user_retention_cohorts')
    
    op.drop_index(op.f('ix_detection_accuracy_logs_detected_at'), table_name='detection_accuracy_logs')
    op.drop_index(op.f('ix_detection_accuracy_logs_is_correct'), table_name='detection_accuracy_logs')
    op.drop_index(op.f('ix_detection_accuracy_logs_detection_method'), table_name='detection_accuracy_logs')
    op.drop_index(op.f('ix_detection_accuracy_logs_processing_job_id'), table_name='detection_accuracy_logs')
    op.drop_index(op.f('ix_detection_accuracy_logs_user_id'), table_name='detection_accuracy_logs')
    op.drop_index(op.f('ix_detection_accuracy_logs_photo_id'), table_name='detection_accuracy_logs')
    op.drop_index(op.f('ix_detection_accuracy_logs_id'), table_name='detection_accuracy_logs')
    op.drop_table('detection_accuracy_logs')
    
    op.drop_index(op.f('ix_business_metrics_period_type'), table_name='business_metrics')
    op.drop_index(op.f('ix_business_metrics_date'), table_name='business_metrics')
    op.drop_index(op.f('ix_business_metrics_id'), table_name='business_metrics')
    op.drop_table('business_metrics')
    
    op.drop_index(op.f('ix_conversion_funnel_completed_at'), table_name='conversion_funnel')
    op.drop_index(op.f('ix_conversion_funnel_step'), table_name='conversion_funnel')
    op.drop_index(op.f('ix_conversion_funnel_user_id'), table_name='conversion_funnel')
    op.drop_index(op.f('ix_conversion_funnel_id'), table_name='conversion_funnel')
    op.drop_table('conversion_funnel')