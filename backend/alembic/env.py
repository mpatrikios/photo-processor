from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

import os

from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Override database URL from environment
database_url = os.getenv('DATABASE_URL')
if database_url:
    config.set_main_option('sqlalchemy.url', database_url)

# add your model's MetaData object here
# for 'autogenerate' support
import sys

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

# Temporarily bypass models import to avoid Settings conflict
# from app.models import usage, user, analytics, processing  # Import models to register them
from sqlalchemy import MetaData

# Create a minimal metadata object for this migration
target_metadata = MetaData()

# We'll define the tables manually since we can't import models
from sqlalchemy import Table, Column, Integer, String, Boolean, DateTime, Float, ForeignKey
from sqlalchemy.sql import func

# Define analytics tables manually for migration
analytics_tables = [
    Table('conversion_funnel', target_metadata,
        Column('id', Integer, primary_key=True),
        Column('user_id', Integer, ForeignKey('users.id'), nullable=False),
        Column('step', String(50), nullable=False),
        Column('completed_at', DateTime(timezone=True), server_default=func.now()),
    ),
    
    Table('business_metrics', target_metadata,
        Column('id', Integer, primary_key=True),
        Column('date', DateTime(timezone=True), nullable=False),
        Column('period_type', String(20), nullable=False),
        Column('total_users', Integer),
        Column('active_users', Integer),
        Column('total_photos_processed', Integer),
        Column('revenue_usd', Float),
        Column('avg_detection_accuracy', Float),
    ),
    
    Table('detection_accuracy_logs', target_metadata,
        Column('id', Integer, primary_key=True),
        Column('photo_id', String(36), nullable=False),
        Column('user_id', Integer, ForeignKey('users.id'), nullable=False),
        Column('processing_job_id', Integer),
        Column('detection_method', String(30), nullable=False),
        Column('processing_time_ms', Float, nullable=False),
        Column('final_result', String(20)),
        Column('manual_label', String(20)),
        Column('is_correct', Boolean),
        Column('detected_at', DateTime(timezone=True), server_default=func.now()),
    ),
    
    Table('user_retention_cohorts', target_metadata,
        Column('id', Integer, primary_key=True),
        Column('cohort_month', String(7), nullable=False),
        Column('user_count', Integer, nullable=False),
        Column('month_0', Float),
        Column('month_1', Float),
        Column('month_2', Float),
        Column('month_3', Float),
        Column('month_6', Float),
        Column('month_12', Float),
        Column('last_updated', DateTime(timezone=True), server_default=func.now()),
    ),
]

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
