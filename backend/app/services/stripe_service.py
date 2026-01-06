# --- INSTRUCTIONS TO CREATE backend/app/stripe_service.py ---
import stripe
import json
from sqlalchemy.orm import Session
from app.models.user import User
from datetime import datetime, timedelta, timezone # 
from app.services.tier_service import get_tier_info 
import logging

# Configure logger
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# --- Configuration ---
# Set the Stripe API key from settings
from app.core.config import settings

try:
    stripe.api_key = settings.stripe_secret_key
    WEBHOOK_SECRET = settings.stripe_webhook_secret
    
    if not stripe.api_key:
        print("WARNING: STRIPE_SECRET_KEY is not set in configuration.")
    if not WEBHOOK_SECRET:
        print("WARNING: STRIPE_WEBHOOK_SECRET is not set in configuration.")

except Exception as e:
    print(f"Error setting Stripe configuration: {e}")

# --- Service Function ---

def create_checkout_session(tier_name: str, user_id: int, user_email: str, success_url: str, cancel_url: str):
    """
    Creates a Stripe Checkout Session for hosted payment page.
    """
    if not stripe.api_key:
        return None, "Stripe API key is missing."

    # Get tier information to determine pricing
    tier_info = get_tier_info(tier_name)
    amount = tier_info.get("price_cents")
    
    if not amount or amount <= 0:
        return None, f"Invalid or free tier: {tier_name}"

    try:
        session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[{
                'price_data': {
                    'currency': 'usd',
                    'unit_amount': amount,
                    'product_data': {
                        'name': f'TagSort {tier_name.title()} Plan',
                        'description': f'Upgrade to {tier_name.title()} tier for enhanced features'
                    }
                },
                'quantity': 1,
            }],
            mode='payment',
            success_url=success_url,
            cancel_url=cancel_url,
            customer_email=user_email,
            metadata={
                "user_id": str(user_id),
                "user_email": user_email,
                "app_context": "TagSort_purchase",
                "requested_tier": tier_name
            }
        )
        return session.url, None
    except stripe.error.StripeError as e:
        logger.error(f"Stripe Checkout Session Creation Failed: {e}")
        return None, str(e.user_message if hasattr(e, 'user_message') else e)
    except Exception as e:
        logger.error(f"Unexpected error in Stripe service: {e}")
        return None, "An unexpected server error occurred."
    
def fulfill_subscription(db: Session, user_id: int, tier_name: str) -> bool:
    """
    Updates the user's tier in the database and resets their usage count.
    """
    user = db.query(User).filter(User.id == user_id).first()
    
    if not user:
        logger.error(f"Fulfillment failed: User ID {user_id} not found.")
        return False
    
    # 1. Look up the new tier's duration
    tier_info = get_tier_info(tier_name)
    duration_days = tier_info.get("duration_days", 30)
    
    # 2. Update user fields
    user.current_tier = tier_name
    user.tier_expiry_date = datetime.now(timezone.utc) + timedelta(days=duration_days)
    user.uploads_this_period = 0 # Reset usage counter for the new cycle
    
    db.add(user)
    db.commit()
    
    logger.info(f"Fulfillment SUCCESS: User {user.id} upgraded to {tier_name} until {user.tier_expiry_date.isoformat()}.")
    return True


def handle_webhook_event(db: Session, payload: bytes, sig_header: str) -> tuple[str, int]:
    """
    Verifies signature and processes the webhook event payload.
    Returns (message, status_code).
    """
    if not WEBHOOK_SECRET:
        return "Webhook secret not configured.", 500

    try:
        # 1. CONSTRUCT THE EVENT (Verifies the Signature)
        event = stripe.Webhook.construct_event(
            payload, sig_header, WEBHOOK_SECRET
        )
    except ValueError as e:
        # Invalid payload
        logger.error(f"Stripe Webhook Error: Invalid payload: {e}")
        return "Invalid payload", 400
    except stripe.error.SignatureVerificationError as e:
        # Invalid signature
        logger.error(f"Stripe Webhook Error: Invalid signature: {e}")
        return "Invalid signature", 400

    # 2. HANDLE THE EVENT
    event_type = event['type']
    data = event['data']
    
    # We primarily care about a successful checkout completion
    if event_type == 'checkout.session.completed':
        session = data['object']
        
        # Extract user ID and requested tier from metadata
        user_id = session['metadata'].get('user_id')
        requested_tier = session['metadata'].get('requested_tier') 

        if not user_id or not requested_tier:
            logger.error("Fulfillment data missing in metadata. Requires user_id and requested_tier.")
            return "Missing fulfillment data", 400
            
        try:
            # 3. FULFILLMENT: Update the user in your database
            user_id = int(user_id)
            if fulfill_subscription(db, user_id, requested_tier):
                return f"User {user_id} successfully fulfilled and upgraded to {requested_tier}.", 200
            else:
                return f"Fulfillment failed for user {user_id}. Database error.", 500
                
        except Exception as e:
            logger.exception(f"Error during fulfillment processing: {e}")
            return "Internal fulfillment error.", 500
            
    # For a recurring subscription model, you would watch for:
    elif event_type == 'customer.subscription.updated':
        # Logic to handle renewal or downgrade/upgrade
        pass
        
    elif event_type == 'customer.subscription.deleted':
        # Logic to downgrade user to 'Trial' or 'Free' tier
        pass
        
    else:
        # Handle other events or simply ignore them
        logger.info(f"Received unhandled event type: {event_type}")
        
    # Always return a 200 status for events we don't handle to prevent Stripe from retrying
    return "Event successfully received and handled (or ignored).", 200