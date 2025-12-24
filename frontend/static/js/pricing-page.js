/* --- INSTRUCTIONS TO CREATE frontend/static/js/pages/PricingPage.js --- */

// NOTE: Assumes BaseComponent, PricingCard, and eventBus are globally available or imported via ES modules.

const TIER_PLANS = [
    { name: 'Trial', price: 0.00, limit: '50 Photos (3 days)', aiFeatures: false },
    { name: 'Basic', price: 9.99, limit: '1,000 Photos/Month', aiFeatures: false },
    { name: 'Pro', price: 29.99, limit: '5,000 Photos/Month', aiFeatures: true }
];

const STRIPE_PUBLISHABLE_KEY = 'pk_test_********************'; 

class PricingPage {
    constructor(containerId, currentTier) {
        this.container = document.getElementById(containerId);
        this.currentTier = currentTier;
        this.stripe = null;
        this.elements = null;

        // 1. Initialize Stripe
        if (typeof Stripe !== 'undefined') {
            this.stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
        } else {
            console.error("Stripe.js failed to load.");
        }
        
        // 2. Set up the event listener from the PricingCard components
        if (typeof eventBus !== 'undefined') {
            eventBus.on('tier:selected', this.handleTierSelection.bind(this));
        }
    }

    render() {
        if (!this.container) return;

        this.container.innerHTML = ''; // Clear existing content

        const pricingHeader = document.createElement('div');
        pricingHeader.className = 'pricing-header';
        pricingHeader.innerHTML = `
            <h2>Choose Your Plan</h2>
            <p class="text-muted">Upgrade to unlock more storage and advanced AI features.</p>
        `;

        const pricingGrid = document.createElement('div');
        pricingGrid.id = 'pricing-grid';
        pricingGrid.className = 'pricing-grid';

        this.container.appendChild(pricingHeader);
        this.container.appendChild(pricingGrid);

        // Render each PricingCard
        TIER_PLANS.forEach(tier => {
            const cardContainer = document.createElement('div');
            pricingGrid.appendChild(cardContainer);
            
            // Assumes PricingCard class is globally available
            new PricingCard({
                element: cardContainer,
                tier: tier,
                currentTier: this.currentTier,
                eventBus: eventBus // Pass eventBus to the child component
            }).render();
        });
    }

    async handleTierSelection({ tierName, amount }) {
        if (!this.stripe) {
            console.error("Stripe not initialized.");
            return;
        }

        // 1. Call your backend to create a Payment Intent
        const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost';
        const apiBase = isDevelopment ? 
            `${window.location.protocol}//${window.location.hostname}:8000/api` : 
            'https://tagsort-api-486078451066.us-central1.run.app/api';
        const response = await fetch(`${apiBase}/payment/create-payment-intent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' /* + Auth Token */ },
            body: JSON.stringify({ 
                amount: amount, 
                tier_name: tierName 
            })
        });

        if (!response.ok) {
            const error = await response.json();
            alert(`Failed to start payment: ${error.detail}`);
            this.render(); // Go back to pricing cards
            return;
        }

        const { clientSecret } = await response.json();
        
        // 2. Transition: Show payment form container
        this.container.innerHTML = `
            <div id="payment-checkout-container" class="payment-checkout-container">
                <h3>Confirm Purchase: ${tierName} Plan ($${(amount / 100).toFixed(2)})</h3>
                <div id="payment-form-element"></div>
                <form id="payment-form">
                    <button id="submit-payment-btn" class="atom-button primary mt-4">Pay Now</button>
                    <div id="payment-message" class="text-danger mt-2"></div>
                </form>
            </div>
        `;

        // 3. Initialize/Update Stripe Elements
        this.elements = this.stripe.elements({ clientSecret }); 
        const paymentElement = this.elements.create('payment');
        paymentElement.mount('#payment-form-element');

        // 4. Handle Form Submission
        const formElement = document.getElementById('payment-form');
        formElement.addEventListener('submit', this.handlePaymentSubmission.bind(this));
    }

    async handlePaymentSubmission(e) {
        e.preventDefault();
        
        const submitBtn = document.getElementById('submit-payment-btn');
        const messageEl = document.getElementById('payment-message');
        
        submitBtn.disabled = true;
        messageEl.textContent = 'Processing...';

        const { error } = await this.stripe.confirmPayment({
            elements: this.elements,
            confirmParams: {
                return_url: window.location.origin + '/payment-success', 
            },
        });

        if (error) {
            // Display error to the user
            messageEl.textContent = error.message;
            submitBtn.disabled = false;
        } else {
            // Payment succeeded or user redirected. The webhook handles fulfillment.
            // The user is redirected by the confirmPayment call to /payment-success.
        }
    }
}