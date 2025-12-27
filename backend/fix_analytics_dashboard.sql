-- Analytics Dashboard Quick Fix Script
-- Creates missing analytics tables and marks migration as complete
-- Run via: psql "postgresql://postgres:password@localhost:5432/postgres" -f fix_analytics_dashboard.sql

BEGIN;

-- Create alembic_version table if it doesn't exist
CREATE TABLE IF NOT EXISTS alembic_version (
    version_num VARCHAR(32) NOT NULL PRIMARY KEY
);

-- Create conversion_funnel table
CREATE TABLE IF NOT EXISTS conversion_funnel (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    step VARCHAR(50) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_conversion_funnel_id ON conversion_funnel (id);
CREATE INDEX IF NOT EXISTS ix_conversion_funnel_user_id ON conversion_funnel (user_id);
CREATE INDEX IF NOT EXISTS ix_conversion_funnel_step ON conversion_funnel (step);
CREATE INDEX IF NOT EXISTS ix_conversion_funnel_completed_at ON conversion_funnel (completed_at);

-- Create business_metrics table
CREATE TABLE IF NOT EXISTS business_metrics (
    id SERIAL PRIMARY KEY,
    date TIMESTAMP WITH TIME ZONE NOT NULL,
    period_type VARCHAR(20) NOT NULL,
    total_users INTEGER DEFAULT 0,
    active_users INTEGER DEFAULT 0,
    total_photos_processed INTEGER DEFAULT 0,
    revenue_usd FLOAT DEFAULT 0.0,
    avg_detection_accuracy FLOAT DEFAULT 0.0
);

CREATE INDEX IF NOT EXISTS ix_business_metrics_id ON business_metrics (id);
CREATE INDEX IF NOT EXISTS ix_business_metrics_date ON business_metrics (date);
CREATE INDEX IF NOT EXISTS ix_business_metrics_period_type ON business_metrics (period_type);

-- Create detection_accuracy_logs table
CREATE TABLE IF NOT EXISTS detection_accuracy_logs (
    id SERIAL PRIMARY KEY,
    photo_id VARCHAR(36) NOT NULL,
    user_id INTEGER NOT NULL,
    processing_job_id INTEGER,
    detection_method VARCHAR(30) NOT NULL,
    processing_time_ms FLOAT NOT NULL,
    final_result VARCHAR(20),
    manual_label VARCHAR(20),
    is_correct BOOLEAN,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_detection_accuracy_logs_id ON detection_accuracy_logs (id);
CREATE INDEX IF NOT EXISTS ix_detection_accuracy_logs_photo_id ON detection_accuracy_logs (photo_id);
CREATE INDEX IF NOT EXISTS ix_detection_accuracy_logs_user_id ON detection_accuracy_logs (user_id);
CREATE INDEX IF NOT EXISTS ix_detection_accuracy_logs_processing_job_id ON detection_accuracy_logs (processing_job_id);
CREATE INDEX IF NOT EXISTS ix_detection_accuracy_logs_detection_method ON detection_accuracy_logs (detection_method);
CREATE INDEX IF NOT EXISTS ix_detection_accuracy_logs_is_correct ON detection_accuracy_logs (is_correct);
CREATE INDEX IF NOT EXISTS ix_detection_accuracy_logs_detected_at ON detection_accuracy_logs (detected_at);

-- Create user_retention_cohorts table
CREATE TABLE IF NOT EXISTS user_retention_cohorts (
    id SERIAL PRIMARY KEY,
    cohort_month VARCHAR(7) NOT NULL,
    user_count INTEGER NOT NULL,
    month_0 FLOAT DEFAULT 100.0,
    month_1 FLOAT,
    month_2 FLOAT,
    month_3 FLOAT,
    month_6 FLOAT,
    month_12 FLOAT,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_user_retention_cohorts_id ON user_retention_cohorts (id);
CREATE INDEX IF NOT EXISTS ix_user_retention_cohorts_cohort_month ON user_retention_cohorts (cohort_month);

-- Mark the analytics migration as complete in alembic tracking
INSERT INTO alembic_version (version_num) VALUES ('add_analytics_tables_20251226') 
ON CONFLICT (version_num) DO NOTHING;

-- Verify tables were created
SELECT 
    'Analytics tables created successfully!' as status,
    count(*) as total_tables
FROM information_schema.tables 
WHERE table_name IN (
    'conversion_funnel', 
    'business_metrics', 
    'detection_accuracy_logs', 
    'user_retention_cohorts'
);

COMMIT;

-- Success message
\echo 'Analytics Dashboard Quick Fix Complete!'
\echo 'Tables created: conversion_funnel, business_metrics, detection_accuracy_logs, user_retention_cohorts'
\echo 'Migration marked as complete in alembic_version'
\echo 'Analytics dashboard should now work!'