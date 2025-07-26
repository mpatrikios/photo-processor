#!/usr/bin/env python3
"""
Test script to verify Google Cloud Vision API setup
"""
import os
from dotenv import load_dotenv
from google.cloud import vision

# Load environment variables from .env file
load_dotenv('backend/.env')

def test_vision_api():
    try:
        # Initialize the client
        client = vision.ImageAnnotatorClient()
        print("✅ Google Cloud Vision API client initialized successfully!")
        
        # Test with a simple image (you can replace with a test image path)
        print("📸 Ready to process race photos with Google Cloud Vision!")
        print("🎯 Primary detection: Google Cloud Vision API")
        print("🔄 Fallback detection: Tesseract OCR")
        
        return True
        
    except Exception as e:
        print("❌ Google Cloud Vision API setup failed:")
        print(f"Error: {str(e)}")
        print("\n🔧 Troubleshooting:")
        print("1. Check that GOOGLE_APPLICATION_CREDENTIALS is set correctly")
        print("2. Verify the JSON file exists and has correct permissions")
        print("3. Ensure Cloud Vision API is enabled in your project")
        print("4. Check that the service account has 'Cloud Vision API User' role")
        
        return False

if __name__ == "__main__":
    print("🧪 Testing Google Cloud Vision API Setup...\n")
    
    # Check environment variable
    creds_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
    if not creds_path:
        print("❌ GOOGLE_APPLICATION_CREDENTIALS environment variable not set")
        print("💡 Make sure your .env file is configured correctly")
    else:
        print(f"📁 Credentials path: {creds_path}")
        if os.path.exists(creds_path):
            print("✅ Credentials file exists")
        else:
            print("❌ Credentials file not found")
    
    print()
    test_vision_api()