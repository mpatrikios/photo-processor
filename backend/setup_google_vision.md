# Google Cloud Vision API Setup

## 1. Create a Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Cloud Vision API:
   - Go to APIs & Services > Library
   - Search for "Cloud Vision API"
   - Click Enable

## 2. Create Service Account Credentials
1. Go to APIs & Services > Credentials
2. Click "Create Credentials" > "Service Account"
3. Fill in service account details
4. Grant roles: "Cloud Vision API User" or "Editor"
5. Click "Done"
6. Click on the created service account
7. Go to "Keys" tab
8. Click "Add Key" > "Create new key"
9. Choose JSON format
10. Download the JSON file

## 3. Set Up Environment
1. Copy the downloaded JSON file to your backend directory
2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
3. Edit `.env` and set:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/service-account-key.json
   ```

## 4. Alternative: Use Application Default Credentials
If you have gcloud CLI installed:
```bash
gcloud auth application-default login
```

## 5. Test the Setup
Start the backend server and upload a photo with visible bib numbers. Check the console logs to see if Google Vision API is being used.

## Pricing
- First 1,000 text detection requests per month: FREE
- Additional requests: $1.50 per 1,000 requests
- See [pricing details](https://cloud.google.com/vision/pricing)