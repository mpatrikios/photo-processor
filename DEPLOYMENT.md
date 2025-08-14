# Google Cloud Run Deployment Guide

This guide will help you deploy TagSort to Google Cloud Run with automatic CI/CD pipeline.

## Prerequisites

1. **Google Cloud Project** - [Create one here](https://console.cloud.google.com/projectcreate)
2. **GitHub Repository** - Your code should be in a GitHub repository
3. **Local Environment** - Google Cloud SDK installed locally

## One-Time Setup

### 1. Enable Google Cloud APIs

```bash
# Set your project ID
export PROJECT_ID="your-project-id"
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable artifactregistry.googleapis.com
gcloud services enable secretmanager.googleapis.com
```

### 2. Create Artifact Registry Repository

```bash
gcloud artifacts repositories create tagsort \
    --repository-format=docker \
    --location=us-central1 \
    --description="TagSort container images"
```

### 3. Create Service Account for GitHub Actions

```bash
# Create service account
gcloud iam service-accounts create github-actions-sa \
    --display-name="GitHub Actions Service Account"

# Grant necessary permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions-sa@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions-sa@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/artifactregistry.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions-sa@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountUser"

# Create and download key
gcloud iam service-accounts keys create github-actions-key.json \
    --iam-account="github-actions-sa@$PROJECT_ID.iam.gserviceaccount.com"
```

### 4. Set up GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions, and add:

- `GCP_PROJECT_ID`: Your Google Cloud project ID
- `GCP_SA_KEY`: Contents of the `github-actions-key.json` file

### 5. Create Application Secrets

```bash
# Generate JWT secret
export JWT_SECRET=$(openssl rand -base64 32)

# Create secrets in Secret Manager
gcloud secrets create tagsort-secrets --data-file=/dev/stdin <<EOF
{
  "database_url_staging": "sqlite:///./tagsort_staging.db",
  "database_url_production": "sqlite:///./tagsort_production.db", 
  "jwt_secret_staging": "$JWT_SECRET",
  "jwt_secret_production": "$JWT_SECRET"
}
EOF
```

### 6. Create Google Cloud Vision Service Account (Optional)

If you want to use Google Cloud Vision API:

```bash
# Create service account for Vision API
gcloud iam service-accounts create vision-api-sa \
    --display-name="Vision API Service Account"

# Grant Vision API permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:vision-api-sa@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/ml.admin"

# Create key for Vision API
gcloud iam service-accounts keys create service-account-key.json \
    --iam-account="vision-api-sa@$PROJECT_ID.iam.gserviceaccount.com"
```

Place the `service-account-key.json` file in your `backend/` directory.

## Deployment Workflow

### Automatic Deployments

1. **Staging**: Push to any branch (except main) → Auto-deploy to staging
2. **Production**: Push to `main` branch → Auto-deploy to production

### Manual Deployment

For local testing or manual deployments:

```bash
# Build and test locally
docker build -t tagsort .
docker run -p 8080:8080 tagsort

# Deploy to Cloud Run manually
gcloud run deploy tagsort-staging \
    --image=us-central1-docker.pkg.dev/$PROJECT_ID/tagsort/tagsort:latest \
    --platform=managed \
    --region=us-central1 \
    --allow-unauthenticated
```

## Environment URLs

After deployment, you'll have:

- **Staging**: `https://tagsort-staging-[hash].a.run.app`
- **Production**: `https://tagsort-production-[hash].a.run.app`

Update the CORS origins in `backend/main.py` with your actual URLs.

## Database Management

### Development
- Uses local SQLite database: `backend/tagsort.db`

### Staging/Production
- Uses separate SQLite databases for each environment
- Data persists between deployments using Cloud Run volumes
- For production workloads, consider migrating to Cloud SQL

## Monitoring & Logs

```bash
# View logs
gcloud run services logs read tagsort-production --region=us-central1

# Get service info
gcloud run services describe tagsort-production --region=us-central1
```

## Troubleshooting

### Common Issues

1. **Build Failures**: Check GitHub Actions logs in your repository
2. **CORS Errors**: Update allowed origins in `backend/main.py`
3. **Authentication Issues**: Verify JWT_SECRET_KEY is set correctly
4. **File Upload Issues**: Ensure sufficient memory/CPU limits in Cloud Run config

### Debug Commands

```bash
# Check deployment status
gcloud run services list

# View recent deployments
gcloud run revisions list --service=tagsort-production

# Check secrets
gcloud secrets versions list tagsort-secrets
```

## Cost Optimization

- **Staging**: Lower CPU/memory limits for cost savings
- **Production**: Scale based on expected traffic
- **Cold starts**: Consider minimum instances for better performance

## Security Notes

- All secrets are stored in Google Secret Manager
- Service accounts use minimal required permissions
- HTTPS enforced by default on Cloud Run
- Consider adding Cloud Identity-Aware Proxy for additional security

## Next Steps

1. Set up custom domain with Cloud DNS
2. Configure Cloud CDN for static assets
3. Set up monitoring with Cloud Monitoring
4. Consider migrating to Cloud SQL for production database