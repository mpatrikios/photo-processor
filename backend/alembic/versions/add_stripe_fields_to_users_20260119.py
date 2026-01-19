"""Add Stripe subscription fields to users table

Revision ID: add_stripe_fields_20260119
Revises: fix_job_id_type_20251226
Create Date: 2026-01-19 15:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'add_stripe_fields_20260119'
down_revision: Union[str, Sequence[str], None] = 'fix_job_id_type_20251226'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add Stripe subscription columns to users table."""
    op.add_column('users', sa.Column('stripe_customer_id', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('stripe_subscription_id', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('subscription_status', sa.String(length=50), nullable=True))

    # Create unique index on stripe_customer_id
    op.create_index(
        op.f('ix_users_stripe_customer_id'),
        'users',
        ['stripe_customer_id'],
        unique=True
    )


def downgrade() -> None:
    """Remove Stripe subscription columns from users table."""
    op.drop_index(op.f('ix_users_stripe_customer_id'), table_name='users')
    op.drop_column('users', 'subscription_status')
    op.drop_column('users', 'stripe_subscription_id')
    op.drop_column('users', 'stripe_customer_id')
