/**
 * TierDisplay - Component for showing user's current tier status and usage
 * Displays tier limits, usage, and upgrade options
 */


class TierDisplay {
    constructor(container, userData) {
        this.container = container;
        this.userData = userData;
    }

    async render() {
        if (!this.userData) {
            this.container.innerHTML = '<div class="tier-display-loading">Loading tier information...</div>';
            return;
        }

        const currentTier = this.userData.current_tier || 'Trial';
        const uploadsThisPeriod = this.userData.uploads_this_period || 0;
        const tierExpiry = this.userData.tier_expiry_date;
        
        // Get tier config from StateManager (API data)
        let tierConfig = null;
        if (window.stateManager) {
            try {
                await window.stateManager.loadTiers();
                tierConfig = window.stateManager.getTier(currentTier);
            } catch (error) {
                console.error('Failed to load tier config:', error);
            }
        }
        
        if (!tierConfig) {
            this.container.innerHTML = '<div class="tier-display-error">Unable to load tier information</div>';
            return;
        }
        
        const usagePercentage = (uploadsThisPeriod / tierConfig.maxUploads) * 100;
        const isExpiringSoon = this.isExpiringSoon(tierExpiry);

        this.container.innerHTML = `
            <div class="tier-display">
                <div class="tier-header">
                    <div class="tier-info">
                        <h3 class="tier-name">${currentTier} Plan</h3>
                        ${this.renderTierBadge(currentTier)}
                    </div>
                    ${this.renderUpgradeButton(currentTier)}
                </div>

                <div class="tier-usage">
                    <div class="usage-bar-container">
                        <div class="usage-bar">
                            <div class="usage-fill" style="width: ${Math.min(usagePercentage, 100)}%"></div>
                        </div>
                        <div class="usage-text">
                            <span class="current">${uploadsThisPeriod.toLocaleString()}</span> / 
                            <span class="limit">${tierConfig.maxUploads.toLocaleString()}</span> uploads used
                        </div>
                    </div>
                    
                    ${isExpiringSoon ? this.renderExpiryWarning(tierExpiry) : ''}
                </div>

                <div class="tier-features">
                    <h4>Your Plan Features:</h4>
                    <ul>
                        ${tierConfig.features.map(feature => `<li>${feature}</li>`).join('')}
                    </ul>
                </div>
            </div>
        `;

        this.bindEvents();
    }


    renderTierBadge(tier) {
        const badgeClass = tier.toLowerCase();
        return `<span class="tier-badge ${badgeClass}">${tier}</span>`;
    }

    renderUpgradeButton(currentTier) {
        if (currentTier === 'Pro') {
            return '<span class="tier-status">Premium Plan ✨</span>';
        }
        return '<button class="btn btn-upgrade" id="upgrade-tier-btn">Upgrade Plan</button>';
    }

    renderExpiryWarning(expiryDate) {
        const daysUntilExpiry = this.getDaysUntilExpiry(expiryDate);
        return `
            <div class="expiry-warning">
                <i class="icon-warning"></i>
                Your plan expires in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? 's' : ''}
            </div>
        `;
    }

    isExpiringSoon(expiryDate) {
        if (!expiryDate) return false;
        const days = this.getDaysUntilExpiry(expiryDate);
        return days <= 7 && days > 0;
    }

    getDaysUntilExpiry(expiryDate) {
        if (!expiryDate) return null;
        const expiry = new Date(expiryDate);
        const now = new Date();
        const diffTime = expiry - now;
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    bindEvents() {
        const upgradeBtn = this.container.querySelector('#upgrade-tier-btn');
        if (upgradeBtn) {
            upgradeBtn.addEventListener('click', () => {
                // Trigger pricing modal or page
                if (typeof showPricingModal === 'function') {
                    showPricingModal();
                } else {
                    window.location.hash = '#pricing';
                }
            });
        }
    }

    async update(userData) {
        this.userData = userData;
        await this.render();
    }
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TierDisplay };
}