from fastapi import APIRouter, HTTPException
from typing import List
import json
import os
from datetime import datetime
from app.models.schemas import FeedbackRequest
from app.services.email_service import email_service

router = APIRouter()

FEEDBACK_DIR = "feedback"

@router.post("/submit")
async def submit_feedback(request: FeedbackRequest):
    """Submit user feedback (bug reports, suggestions, etc.)"""
    if not request.title or not request.description:
        raise HTTPException(status_code=400, detail="Title and description are required")
    
    # Create feedback directory if it doesn't exist
    os.makedirs(FEEDBACK_DIR, exist_ok=True)
    
    try:
        # Create feedback entry
        feedback_entry = {
            "id": datetime.now().strftime("%Y%m%d_%H%M%S_%f"),
            "timestamp": datetime.now().isoformat(),
            "type": request.type,
            "title": request.title,
            "description": request.description,
            "email": request.email,
            "system_info": request.system_info,
            "status": "new"
        }
        
        # Save to JSON file
        filename = f"feedback_{feedback_entry['id']}.json"
        filepath = os.path.join(FEEDBACK_DIR, filename)
        
        with open(filepath, 'w') as f:
            json.dump(feedback_entry, f, indent=2)
        
        # Also append to a consolidated log for easy viewing
        log_filepath = os.path.join(FEEDBACK_DIR, "feedback_log.jsonl")
        with open(log_filepath, 'a') as f:
            f.write(json.dumps(feedback_entry) + '\n')
        
        print(f"✅ New feedback received: {request.type} - {request.title}")
        
        # Send email notification (async, don't wait for it)
        try:
            email_sent = await email_service.send_feedback_notification(feedback_entry)
            if email_sent:
                print(f"📧 Email notification sent for feedback {feedback_entry['id']}")
            else:
                print(f"⚠️ Email notification failed for feedback {feedback_entry['id']}")
        except Exception as e:
            print(f"❌ Email notification error for feedback {feedback_entry['id']}: {str(e)}")
        
        return {
            "message": "Thank you for your feedback! We appreciate your input.",
            "feedback_id": feedback_entry['id']
        }
        
    except Exception as e:
        print(f"❌ Failed to save feedback: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit feedback")

@router.get("/list")
async def list_feedback():
    """List all feedback entries (for admin use)"""
    try:
        if not os.path.exists(FEEDBACK_DIR):
            return {"feedback": [], "count": 0}
        
        feedback_files = [f for f in os.listdir(FEEDBACK_DIR) if f.startswith("feedback_") and f.endswith(".json")]
        feedback_list = []
        
        for filename in sorted(feedback_files, reverse=True):  # Most recent first
            filepath = os.path.join(FEEDBACK_DIR, filename)
            try:
                with open(filepath, 'r') as f:
                    feedback_data = json.load(f)
                    # Don't include full system info in list view
                    summary = {
                        "id": feedback_data.get("id"),
                        "timestamp": feedback_data.get("timestamp"),
                        "type": feedback_data.get("type"),
                        "title": feedback_data.get("title"),
                        "email": feedback_data.get("email"),
                        "status": feedback_data.get("status", "new")
                    }
                    feedback_list.append(summary)
            except Exception as e:
                print(f"Error reading feedback file {filename}: {e}")
                continue
        
        return {
            "feedback": feedback_list,
            "count": len(feedback_list)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list feedback: {str(e)}")

@router.get("/stats")
async def feedback_stats():
    """Get feedback statistics"""
    try:
        if not os.path.exists(FEEDBACK_DIR):
            return {"total": 0, "by_type": {}}
        
        feedback_files = [f for f in os.listdir(FEEDBACK_DIR) if f.startswith("feedback_") and f.endswith(".json")]
        
        stats = {
            "total": len(feedback_files),
            "by_type": {"bug": 0, "suggestion": 0, "improvement": 0, "general": 0}
        }
        
        for filename in feedback_files:
            filepath = os.path.join(FEEDBACK_DIR, filename)
            try:
                with open(filepath, 'r') as f:
                    feedback_data = json.load(f)
                    feedback_type = feedback_data.get("type", "general")
                    if feedback_type in stats["by_type"]:
                        stats["by_type"][feedback_type] += 1
            except Exception:
                continue
        
        return stats
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get feedback stats: {str(e)}")

@router.get("/email-config")
async def check_email_config():
    """Check if email is properly configured"""
    return {
        "email_configured": email_service.is_configured(),
        "admin_email": email_service.admin_email if email_service.admin_email else "Not configured",
        "smtp_host": email_service.smtp_host,
        "smtp_port": email_service.smtp_port,
        "smtp_use_tls": email_service.smtp_use_tls
    }

@router.post("/test-email")
async def test_email():
    """Send a test email to verify configuration"""
    if not email_service.is_configured():
        raise HTTPException(status_code=400, detail="Email not configured")
    
    test_feedback = {
        "id": f"test_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
        "timestamp": datetime.now().isoformat(),
        "type": "general",
        "title": "Email Configuration Test",
        "description": "This is a test email to verify that feedback notifications are working correctly.",
        "email": "test@example.com",
        "system_info": "Test system information",
        "status": "test"
    }
    
    try:
        success = await email_service.send_feedback_notification(test_feedback)
        if success:
            return {"message": "Test email sent successfully!", "admin_email": email_service.admin_email}
        else:
            raise HTTPException(status_code=500, detail="Failed to send test email")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Email test failed: {str(e)}")