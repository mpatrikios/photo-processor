/**
 * PaymentForm - Modular Stripe payment integration component
 * Handles checkout session creation and redirects to Stripe Checkout
 * Follows CLAUDE.md security principles: environment-based configuration
 */

import CONFIG from '../static/js/config.js';

export class PaymentForm {
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

    resetState() {
        this.isProcessing = false;
    }

    static getApiBaseUrl() {
        return CONFIG.API_BASE_URL;
    }
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PaymentForm };
}