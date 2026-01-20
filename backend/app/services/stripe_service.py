import stripe
from sqlalchemy.orm import Session
from app.models.user import User
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)

from app.core.config import settings

# Configure Stripe
stripe.api_key = settings.stripe_secret_key
WEBHOOK_SECRET = settings.stripe_webhook_secret

# Map tier names to Stripe Price IDs
TIER_TO_PRICE_ID = {
    "Amateur": settings.stripe_amateur_price_id,
    "Pro": settings.stripe_pro_price_id,
    "Power User": settings.stripe_power_user_price_id,
}

# Reverse mapping: Price ID to tier name
PRICE_ID_TO_TIER = {v: k for k, v in TIER_TO_PRICE_ID.items()}


def get_or_create_stripe_customer(db: Session, user: User) -> str:
    """
    Returns existing Stripe customer ID or creates a new one.
    """
    if user.stripe_customer_id:
        return user.stripe_customer_id

    customer = stripe.Customer.create(
        email=user.email,
        name=user.full_name,
        metadata={"user_id": str(user.id)}
    )

    user.stripe_customer_id = customer.id
    db.add(user)
    db.commit()

    logger.info(f"Created Stripe customer {customer.id} for user {user.id}")
    return customer.id


def create_checkout_session(
    db: Session,
    tier_name: str,
    user: User,
    success_url: str,
    cancel_url: str
) -> tuple[str | None, str | None]:
    """
    Creates a Stripe Checkout Session for subscription.
    Returns (checkout_url, error_message).
    """
    if not stripe.api_key:
        return None, "Stripe API key is missing."

    price_id = TIER_TO_PRICE_ID.get(tier_name)
    if not price_id:
        return None, f"Invalid tier: {tier_name}. Must be Amateur, Pro, or Power User."

    try:
        customer_id = get_or_create_stripe_customer(db, user)

        session = stripe.checkout.Session.create(
            customer=customer_id,
            payment_method_types=['card'],
            line_items=[{
                'price': price_id,
                'quantity': 1,
            }],
            mode='subscription',
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "user_id": str(user.id),
                "requested_tier": tier_name
            },
            subscription_data={
                "metadata": {
                    "user_id": str(user.id),
                    "tier": tier_name
                }
            }
        )
        return session.url, None

    except stripe.error.StripeError as e:
        logger.error(f"Stripe Checkout Session Creation Failed: {e}")
        return None, str(e.user_message if hasattr(e, 'user_message') else e)


def create_billing_portal_session(user: User, return_url: str) -> tuple[str | None, str | None]:
    """
    Creates a Stripe Billing Portal session for subscription management.
    Returns (portal_url, error_message).
    """
    if not user.stripe_customer_id:
        return None, "No billing account found. Please subscribe first."

    try:
        session = stripe.billing_portal.Session.create(
            customer=user.stripe_customer_id,
            return_url=return_url
        )
        return session.url, None

    except stripe.error.StripeError as e:
        logger.error(f"Billing Portal Session Failed: {e}")
        return None, str(e.user_message if hasattr(e, 'user_message') else e)


def fulfill_subscription(db: Session, user_id: int, tier_name: str, subscription_id: str = None) -> bool:
    """
    Updates the user's tier in the database after successful subscription.
    """
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        logger.error(f"Fulfillment failed: User ID {user_id} not found.")
        return False

    user.current_tier = tier_name
    user.tier_expiry_date = None  # Managed by Stripe subscription
    user.uploads_this_period = 0
    user.subscription_status = "active"

    if subscription_id:
        user.stripe_subscription_id = subscription_id

    db.add(user)
    db.commit()

    logger.info(f"Fulfillment SUCCESS: User {user.id} subscribed to {tier_name}.")
    return True


def cancel_subscription(db: Session, user_id: int) -> bool:
    """
    Downgrades user to Free tier when subscription is canceled.
    """
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        logger.error(f"Cancellation failed: User ID {user_id} not found.")
        return False

    user.current_tier = "Free"
    user.subscription_status = "canceled"
    user.stripe_subscription_id = None
    user.uploads_this_period = 0

    db.add(user)
    db.commit()

    logger.info(f"User {user.id} subscription canceled, downgraded to Free.")
    return True


def handle_webhook_event(db: Session, payload: bytes, sig_header: str) -> tuple[str, int]:
    """
    Verifies signature and processes Stripe webhook events.
    Returns (message, status_code).
    """
    if not WEBHOOK_SECRET:
        return "Webhook secret not configured.", 500

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, WEBHOOK_SECRET)
    except ValueError:
        logger.error("Stripe Webhook Error: Invalid payload")
        return "Invalid payload", 400
    except stripe.error.SignatureVerificationError:
        logger.error("Stripe Webhook Error: Invalid signature")
        return "Invalid signature", 400

    event_type = event['type']
    data = event['data']['object']

    if event_type == 'checkout.session.completed':
        # Initial subscription created
        user_id = data['metadata'].get('user_id')
        tier_name = data['metadata'].get('requested_tier')
        subscription_id = data.get('subscription')

        # Idempotency: Skip if already processed
        if subscription_id:
            existing = db.query(User).filter(
                User.stripe_subscription_id == subscription_id,
                User.subscription_status == "active"
            ).first()
            if existing:
                logger.info(f"Checkout {subscription_id} already processed, skipping")
                return "Already processed", 200

        if not user_id or not tier_name:
            logger.error("Missing user_id or requested_tier in checkout metadata")
            return "Missing fulfillment data", 400

        if fulfill_subscription(db, int(user_id), tier_name, subscription_id):
            return f"User {user_id} subscribed to {tier_name}", 200
        return "Fulfillment failed", 500

    elif event_type == 'customer.subscription.updated':
        # Subscription changed (upgrade/downgrade/renewal)
        status = data['status']
        customer_id = data['customer']

        user = db.query(User).filter(User.stripe_customer_id == customer_id).first()
        if not user:
            logger.warning(f"No user found for customer {customer_id}")
            return "User not found", 200

        # Update subscription status
        user.subscription_status = status

        # Track subscription period end
        current_period_end = data.get('current_period_end')
        if current_period_end:
            user.tier_expiry_date = datetime.fromtimestamp(current_period_end, tz=timezone.utc)

        # Check if tier changed (upgrade/downgrade)
        if data.get('items', {}).get('data'):
            price_id = data['items']['data'][0]['price']['id']
            new_tier = PRICE_ID_TO_TIER.get(price_id)
            if new_tier and new_tier != user.current_tier:
                user.current_tier = new_tier
                user.uploads_this_period = 0
                logger.info(f"User {user.id} changed tier to {new_tier}")

        db.commit()
        return f"Subscription updated for user {user.id}", 200

    elif event_type == 'customer.subscription.deleted':
        # Subscription canceled
        customer_id = data['customer']

        user = db.query(User).filter(User.stripe_customer_id == customer_id).first()
        if user:
            cancel_subscription(db, user.id)
            return f"User {user.id} subscription canceled", 200

        return "User not found", 200

    elif event_type == 'invoice.payment_failed':
        # Payment failed - mark subscription as past_due
        customer_id = data['customer']

        user = db.query(User).filter(User.stripe_customer_id == customer_id).first()
        if user:
            user.subscription_status = "past_due"
            db.commit()
            logger.warning(f"Payment failed for user {user.id}")

        return "Payment failure recorded", 200

    elif event_type == 'invoice.paid':
        # Payment succeeded - recover from past_due, reset usage on renewal
        customer_id = data['customer']
        billing_reason = data.get('billing_reason')

        user = db.query(User).filter(User.stripe_customer_id == customer_id).first()
        if user:
            # Recover from past_due
            if user.subscription_status == "past_due":
                user.subscription_status = "active"

            # Reset usage on renewal (not initial subscription)
            if billing_reason == 'subscription_cycle':
                user.uploads_this_period = 0
                logger.info(f"User {user.id} billing cycle reset")

            db.commit()

        return "Invoice paid processed", 200

    else:
        logger.info(f"Unhandled webhook event: {event_type}")

    return "Event received", 200
