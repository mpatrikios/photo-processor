/**
 * PaymentForm - Modular Stripe payment integration component
 * Handles checkout session creation and redirects to Stripe Checkout
 * Follows CLAUDE.md security principles: environment-based configuration
 */

class PaymentForm {
    constructor(apiBaseUrl) {
        this.apiBaseUrl = apiBaseUrl;
        this.isProcessing = false;
        this.stripeConfig = null;
        this.initializeStripeConfig();
    }

    async initializeStripeConfig() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/payment/config`);
            if (response.ok) {
                this.stripeConfig = await response.json();
            } else {
                console.warn('Failed to load Stripe configuration from backend');
            }
        } catch (error) {
            console.warn('Failed to fetch Stripe config:', error);
        }
    }

    async createCheckoutSession(tierName) {
        if (this.isProcessing) {
            throw new Error('Payment already in progress');
        }

        const token = localStorage.getItem('auth_token');
        if (!token) {
            localStorage.setItem('pending_action', 'upgrade');
            localStorage.setItem('pending_tier', tierName);
            throw new Error('AUTHENTICATION_REQUIRED');
        }

        this.isProcessing = true;

        try {
            const response = await fetch(`${this.apiBaseUrl}/payment/create-checkout-session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    tier_name: tierName,
                    success_url: `${window.location.origin}/#payment-success&session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${window.location.origin}/#payment-cancelled`
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Server error: ${response.status}`);
            }

            const { sessionUrl } = await response.json();
            
            // Redirect to Stripe Checkout
            window.location.href = sessionUrl;
            
        } catch (error) {
            this.isProcessing = false;
            throw error;
        }
    }

    handleAuthenticationRequired() {
        // This should trigger the sign-in modal in the main app
        if (typeof showSignInModal === 'function') {
            showSignInModal();
        } else {
            window.location.href = '#signin';
        }
    }

    static getApiBaseUrl() {
        // Environment detection
        const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost';
        return isDevelopment ? 
            `${window.location.protocol}//${window.location.hostname}:8000/api` : 
            'https://tagsort-api-486078451066.us-central1.run.app/api';
    }
}

// Helper function to check payment status from URL
function checkPaymentStatusFromUrl() {
    const hash = window.location.hash;
    
    if (hash.includes('payment-success')) {
        const sessionId = new URLSearchParams(hash.split('&').slice(1).join('&')).get('session_id');
        handlePaymentSuccess(sessionId);
    } else if (hash.includes('payment-cancelled')) {
        handlePaymentCancelled();
    }
}

function handlePaymentSuccess(sessionId) {
    // Clear any stored pending actions
    localStorage.removeItem('pending_action');
    localStorage.removeItem('pending_tier');
    
    // Show success message using existing PhotoProcessor system
    if (window.photoProcessor) {
        window.photoProcessor.showSuccess('Payment successful! Your tier has been upgraded.');
    } else {
        alert('Payment successful! Your tier has been upgraded.');
    }
    
    // Refresh user data and redirect to main app
    window.location.hash = '#dashboard';
    
    // Refresh user quota to show new tier
    if (window.photoProcessor && window.photoProcessor.loadUserQuota) {
        window.photoProcessor.loadUserQuota();
    }
}

function handlePaymentCancelled() {
    // Show cancellation message using existing PhotoProcessor system  
    if (window.photoProcessor) {
        window.photoProcessor.showError('Payment was cancelled.');
    }
    
    // Return to pricing/dashboard
    window.location.hash = '#dashboard';
}

// Auto-check payment status on load
document.addEventListener('DOMContentLoaded', checkPaymentStatusFromUrl);
window.addEventListener('hashchange', checkPaymentStatusFromUrl);

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PaymentForm, checkPaymentStatusFromUrl, handlePaymentSuccess, handlePaymentCancelled };
}