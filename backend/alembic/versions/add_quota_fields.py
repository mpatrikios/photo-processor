"""Add monthly quota tracking fields to users table

Revision ID: 001_quota_fields
Revises: 
Create Date: 2025-12-16 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '001_quota_fields'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add quota tracking fields to users table"""
    # Add the new columns
    op.add_column('users', sa.Column('monthly_quota_limit', sa.Integer(), nullable=False, server_default='5000'))
    op.add_column('users', sa.Column('current_month_usage', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('quota_reset_date', sa.DateTime(timezone=True), nullable=True))
    
    # Remove server defaults after adding columns (so they only apply during creation)
    op.alter_column('users', 'monthly_quota_limit', server_default=None)
    op.alter_column('users', 'current_month_usage', server_default=None)


def downgrade() -> None:
    """Remove quota tracking fields from users table"""
    op.drop_column('users', 'quota_reset_date')
    op.drop_column('users', 'current_month_usage')
    op.drop_column('users', 'monthly_quota_limit')