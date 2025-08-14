#!/usr/bin/env python3
"""
Test script for Gmail SMTP configuration
Run this after setting up your Gmail App Password
"""

import os
import sys
import asyncio
from pathlib import Path

# Load environment variables FIRST
from dotenv import load_dotenv
env_path = Path(__file__).parent / "backend" / ".env"
load_dotenv(env_path)

# Add backend to path
backend_path = Path(__file__).parent / "backend"
sys.path.append(str(backend_path))

from app.services.email_service import email_service

async def test_email_config():
    """Test email configuration and send a test email"""
    
    print("🔧 Testing Gmail SMTP Configuration...")
    print("-" * 50)
    
    # Check if email is configured
    if not email_service.is_configured():
        print("❌ Email not configured!")
        print("\nMissing environment variables:")
        if not email_service.admin_email:
            print("  - ADMIN_EMAIL")
        if not email_service.smtp_username:
            print("  - SMTP_USERNAME") 
        if not email_service.smtp_password:
            print("  - SMTP_PASSWORD")
            
        print("\n📝 To fix this:")
        print("1. Edit backend/.env file")
        print("2. Replace 'your-gmail@gmail.com' with your actual Gmail address")
        print("3. Replace 'your-gmail-app-password' with your Gmail App Password")
        print("\n🔑 To create a Gmail App Password:")
        print("1. Go to https://myaccount.google.com/apppasswords")
        print("2. Select 'Mail' and generate a 16-character password")
        print("3. Use that password (not your regular Gmail password)")
        
        return False
    
    print("✅ Email configuration found:")
    print(f"  Admin Email: {email_service.admin_email}")
    print(f"  SMTP Host: {email_service.smtp_host}:{email_service.smtp_port}")
    print(f"  SMTP User: {email_service.smtp_username}")
    print(f"  TLS Enabled: {email_service.smtp_use_tls}")
    
    # Test feedback email
    print("\n📧 Sending test feedback email...")
    
    test_feedback = {
        "id": "test_email_20240101",
        "timestamp": "2024-01-01T12:00:00",
        "type": "general",
        "title": "Email Configuration Test",
        "description": "This is a test email to verify Gmail SMTP configuration is working correctly.",
        "email": "test@example.com",
        "system_info": "Test Environment"
    }
    
    try:
        success = await email_service.send_feedback_notification(test_feedback)
        
        if success:
            print("✅ Test email sent successfully!")
            print(f"📬 Check your inbox at: {email_service.admin_email}")
            print("\n🎉 Gmail configuration is working correctly!")
            return True
        else:
            print("❌ Failed to send test email")
            print("💡 This usually means:")
            print("  - Wrong Gmail App Password")
            print("  - 2FA not enabled on Gmail account")
            print("  - Incorrect email address")
            return False
            
    except Exception as e:
        print(f"❌ Email test failed with error: {str(e)}")
        print("\n💡 Common issues:")
        print("  - Gmail App Password not created or incorrect")
        print("  - 2-Factor Authentication not enabled")
        print("  - Less secure app access blocked")
        return False

if __name__ == "__main__":
    print("🧪 TagSort Email Configuration Test")
    print("=" * 50)
    
    # Run test
    result = asyncio.run(test_email_config())
    
    if result:
        print("\n🚀 Your feedback system is ready to use!")
    else:
        print("\n🔧 Please fix the configuration and run this test again.")
        print("Command: python test_email.py")
    
    print("\n" + "=" * 50)