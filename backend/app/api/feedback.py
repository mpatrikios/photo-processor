import json
import os
from datetime import datetime
import logging

from fastapi import APIRouter, HTTPException

from app.models.schemas import FeedbackRequest
from app.services.email_service import email_service
router = APIRouter()

# Configure logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
router = APIRouter()

FEEDBACK_DIR = "feedback"


@router.post("/submit")
async def submit_feedback(request: FeedbackRequest):
    """Submit user feedback (bug reports, suggestions, etc.)"""
    if not request.title or not request.description:
        raise HTTPException(
            status_code=400, detail="Title and description are required"
        )

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
            "status": "new",
        }

        # Save to JSON file
        filename = f"feedback_{feedback_entry['id']}.json"
        filepath = os.path.join(FEEDBACK_DIR, filename)

        with open(filepath, "w") as f:
            json.dump(feedback_entry, f, indent=2)

        # Also append to a consolidated log for easy viewing
        log_filepath = os.path.join(FEEDBACK_DIR, "feedback_log.jsonl")
        with open(log_filepath, "a") as f:
            f.write(json.dumps(feedback_entry) + "\n")

        # Send email notification (async, don't wait for it)
        try:
            await email_service.send_feedback_notification(feedback_entry)
        except Exception as e:
            logger.exception(f"❌ Email notification error for feedback {feedback_entry['id']}: {str(e)}")

        return {
            "message": "Thank you for your feedback! We appreciate your input.",
            "feedback_id": feedback_entry["id"],
        }

    except KeyError as key_err:
        # Catching specific errors allows you to give better feedback
        logger.error(f"Data integrity error: Missing key {key_err} in feedback payload")
        raise HTTPException(status_code=422, detail="Incomplete feedback data")

    except Exception as e:
        # Catch-all for unexpected issues (Database down, etc.)
        # We log the stack trace but return a generic message to the user for security
        logger.exception("Unexpected error during feedback submission") 
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/list")
async def list_feedback():
    """List all feedback entries (for admin use)"""
    try:
        if not os.path.exists(FEEDBACK_DIR):
            return {"feedback": [], "count": 0}

        feedback_files = [
            f
            for f in os.listdir(FEEDBACK_DIR)
            if f.startswith("feedback_") and f.endswith(".json")
        ]
        feedback_list = []

        for filename in sorted(feedback_files, reverse=True):  # Most recent first
            filepath = os.path.join(FEEDBACK_DIR, filename)
            try:
                with open(filepath, "r") as f:
                    feedback_data = json.load(f)
                    # Don't include full system info in list view
                    summary = {
                        "id": feedback_data.get("id"),
                        "timestamp": feedback_data.get("timestamp"),
                        "type": feedback_data.get("type"),
                        "title": feedback_data.get("title"),
                        "email": feedback_data.get("email"),
                        "status": feedback_data.get("status", "new"),
                    }
                    feedback_list.append(summary)
            except Exception as e:
                logger.exception(f"Error reading feedback file {filename}: {e}")
                continue

        return {"feedback": feedback_list, "count": len(feedback_list)}

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to list feedback: {str(e)}"
        )


@router.get("/stats")
async def feedback_stats():
    """Get feedback statistics"""
    try:
        if not os.path.exists(FEEDBACK_DIR):
            return {"total": 0, "by_type": {}}

        feedback_files = [
            f
            for f in os.listdir(FEEDBACK_DIR)
            if f.startswith("feedback_") and f.endswith(".json")
        ]

        stats = {
            "total": len(feedback_files),
            "by_type": {"bug": 0, "suggestion": 0, "improvement": 0, "general": 0},
        }

        for filename in feedback_files:
            filepath = os.path.join(FEEDBACK_DIR, filename)
            try:
                with open(filepath, "r") as f:
                    feedback_data = json.load(f)
                    feedback_type = feedback_data.get("type", "general")
                    if feedback_type in stats["by_type"]:
                        stats["by_type"][feedback_type] += 1
            except Exception:
                continue

        return stats

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get feedback stats: {str(e)}"
        )
