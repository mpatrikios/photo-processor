# backend/app/api/payment.py ---

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
import logging

# Import the Stripe service function we created
from app.services.stripe_service import create_checkout_session, handle_webhook_event
# Import security components (assuming payment requires authentication)
from app.api.auth import get_current_user
from app.models.user import User
from database import get_db
from sqlalchemy.orm import Session
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

# --- Schema for Checkout Session Request ---
class CheckoutSessionRequest(BaseModel):
    """Schema for the data expected when creating a Checkout Session."""
    tier_name: str = Field(..., description="The name of the tier being purchased (e.g., basic, pro).")
    success_url: str = Field(..., description="URL to redirect to after successful payment")
    cancel_url: str = Field(..., description="URL to redirect to if payment is cancelled")


@router.post("/create-checkout-session", response_model=dict, status_code=200)
async def handle_create_checkout_session(
    request_data: CheckoutSessionRequest,
    # Requires an authenticated and active user to initiate payment
    current_user: User = Depends(get_current_user) 
):
    """
    Creates a Stripe Checkout Session and returns the session URL for redirect.
    """
    
    # Extract user information from User object
    user_id = current_user.id
    user_email = current_user.email
    
    logger.info(
        f"Attempting to create Checkout Session for User ID {user_id}, "
        f"Tier: {request_data.tier_name}"
    )

    # Call the Stripe Service to create the checkout session
    session_url, error_message = create_checkout_session(
        tier_name=request_data.tier_name,
        user_id=user_id,
        user_email=user_email,
        success_url=request_data.success_url,
        cancel_url=request_data.cancel_url
    )

    if session_url is None:
        logger.error(f"Failed to create Checkout Session for user {user_id}: {error_message}")
        raise HTTPException(
            status_code=400,
            detail=f"Payment processing failed: {error_message}"
        )
        
    # Return the session URL to redirect to
    return {"sessionUrl": session_url}

@router.get("/config", response_model=dict, status_code=200)
async def get_payment_config():
    """
    Returns public Stripe configuration for frontend.
    No authentication required - only returns public keys.
    """
    return {
        "stripe_publishable_key": settings.stripe_publishable_key
    }

@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Handles incoming Stripe webhook events (e.g., payment succeeded, subscription created).
    
    NOTE: This endpoint does NOT require standard authentication.
    Security is enforced via the Stripe-Signature header verification.
    """
    
    # 1. Get raw request body and signature
    # FastAPI requires this if you are using 'await request.body()'
    payload = await request.body() 
    sig_header = request.headers.get('stripe-signature')

    if not sig_header:
        logger.error("Webhook received without Stripe-Signature header.")
        raise HTTPException(status_code=400, detail="Missing Stripe signature header.")

    try:
        # 2. Delegate processing to the Stripe Service
        # The service handles signature verification and event processing
        response_message, status_code = handle_webhook_event(
            db=db,
            payload=payload, 
            sig_header=sig_header
        )
        
        if status_code != 200:
            logger.error(f"Stripe Webhook Processing Error: {response_message}")
            raise HTTPException(status_code=status_code, detail=response_message)
            
        return {"status": "success", "message": response_message}

    except Exception as e:
        # Catch any unexpected errors during processing
        logger.exception(f"Unhandled exception in Stripe webhook: {e}")
        # Stripe expects a 200 or 4xx to indicate success/failure, but we return 500 for internal errors
        raise HTTPException(status_code=500, detail="Internal server error during webhook processing.")