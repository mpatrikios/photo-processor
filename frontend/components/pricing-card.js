/**
 * PricingCard - Atomic component for displaying tier pricing information
 * Follows CLAUDE.md modularity principles: single-purpose, reusable
 */

const TIER_PLANS = {
    'Trial': { name: 'Trial', price: 0.00, limit: '50 Photos (3 days)', features: ['Basic sorting', 'Standard support'] },
    'Basic': { name: 'Basic', price: 9.99, limit: '1,000 Photos/Month', features: ['Basic sorting', 'Priority support', 'CSV export'] },
    'Pro': { name: 'Pro', price: 29.99, limit: '5,000 Photos/Month', features: ['Advanced sorting', 'Priority support', 'CSV export', 'RAW support', 'AI features'] }
};

class PricingCard {
    constructor(container, tier, currentTier, onSelectTier) {
        this.container = container;
        this.tier = tier;
        this.currentTier = currentTier;
        this.onSelectTier = onSelectTier;
    }

    render() {
        const tierInfo = TIER_PLANS[this.tier];
        if (!tierInfo) {
            console.error(`Unknown tier: ${this.tier}`);
            return;
        }

        const isCurrentTier = this.tier === this.currentTier;
        const isTrial = this.tier === 'Trial';
        
        this.container.innerHTML = `
            <div class="pricing-card ${isCurrentTier ? 'current' : ''} ${isTrial ? 'trial' : ''}">
                <div class="pricing-card-header">
                    <h3 class="tier-name">${tierInfo.name}</h3>
                    ${isCurrentTier ? '<span class="current-badge">Current Plan</span>' : ''}
                </div>
                
                <div class="pricing-card-price">
                    <span class="price">$${tierInfo.price.toFixed(2)}</span>
                    ${!isTrial ? '<span class="period">/month</span>' : '<span class="period">free</span>'}
                </div>
                
                <div class="pricing-card-limit">
                    <p class="limit">${tierInfo.limit}</p>
                </div>
                
                <ul class="pricing-card-features">
                    ${tierInfo.features.map(feature => `<li>${feature}</li>`).join('')}
                </ul>
                
                <div class="pricing-card-footer">
                    ${this.renderButton(isCurrentTier, isTrial)}
                </div>
            </div>
        `;

        this.bindEvents();
    }

    renderButton(isCurrentTier, isTrial) {
        if (isCurrentTier) {
            return '<button class="pricing-btn current" disabled>Current Plan</button>';
        }
        
        if (isTrial) {
            return '<button class="pricing-btn trial" disabled>Free Trial</button>';
        }
        
        return `<button class="pricing-btn upgrade" data-tier="${this.tier}">Upgrade to ${this.tier}</button>`;
    }

    bindEvents() {
        const button = this.container.querySelector('.pricing-btn.upgrade');
        if (button && this.onSelectTier) {
            button.addEventListener('click', () => {
                this.onSelectTier(this.tier);
            });
        }
    }
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PricingCard, TIER_PLANS };
}