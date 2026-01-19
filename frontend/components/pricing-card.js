/**
 * PricingCard - Atomic component for displaying tier pricing information
 * Follows CLAUDE.md modularity principles: single-purpose, reusable
 */


class PricingCard {
    constructor(container, tier, currentTier, options = {}) {
        this.container = container;
        this.tier = tier;
        this.currentTier = currentTier;
        
        // Options for different layouts/contexts
        this.options = {
            layout: options.layout || 'modal', // 'modal' or 'landing'
            showPopularBadge: options.showPopularBadge !== false, // default true
            useBootstrapGrid: options.useBootstrapGrid || false,
            ...options
        };
    }

    render() {
        // Get tier info from StateManager (API data) or fallback to local config
        let tierInfo = null;

        if (window.stateManager) {
            tierInfo = window.stateManager.getTier(this.tier);
        }

        if (!tierInfo) {
            console.error(`Unknown tier: ${this.tier}`);
            return;
        }

        const isCurrentTier = this.tier === this.currentTier;
        const isFree = this.tier === 'Free';
        const isPro = this.tier === 'Pro';
        const isEnterprise = this.tier === 'Enterprise' || tierInfo.isEnterprise;

        if (this.options.layout === 'landing') {
            this.renderLandingCard(tierInfo, isCurrentTier, isFree, isPro, isEnterprise);
        } else {
            this.renderModalCard(tierInfo, isCurrentTier, isFree, isPro, isEnterprise);
        }

    }
    
    renderModalCard(tierInfo, isCurrentTier, isFree, isPro, isEnterprise) {
        // Determine price display: "Contact Us" for Enterprise, normal price otherwise
        const priceDisplay = isEnterprise ? 'Contact Us' : `$${tierInfo.price.toFixed(2)}`;

        this.container.innerHTML = `
            <div class="subscription-card-clean ${isCurrentTier ? 'current-tier' : ''}" style="margin-bottom: 0; ${isPro ? 'border: 2px solid var(--color-accent-primary);' : ''}">
                ${isPro && this.options.showPopularBadge ? '<div style="background: var(--color-accent-primary); color: white; text-align: center; padding: 8px; margin: -28px -28px 20px -28px; border-radius: 20px 20px 0 0; font-size: 0.85rem; font-weight: 600;">MOST POPULAR</div>' : ''}

                <div class="plan-name" style="color: ${isPro ? 'var(--color-accent-primary)' : '#212529'};">
                    ${tierInfo.name}
                </div>
                <div class="plan-limit" style="font-size: 1.5rem; font-weight: 700; color: ${isPro ? 'var(--color-accent-primary)' : '#495057'}; margin-bottom: 20px;">
                    ${priceDisplay}
                </div>

                <ul class="feature-list">
                    ${(tierInfo.features || []).map(feature => `
                        <li class="feature-item">
                            <div class="feature-icon">✓</div>
                            ${this.renderFeatureText(feature)}
                        </li>
                    `).join('')}
                </ul>

                ${isCurrentTier ? `
                    <div class="tier-action-element tier-current-badge">
                        Current Plan
                    </div>
                ` : `
                    <button class="tier-action-element tier-choose-button" data-tier="${this.tier}">
                        ${isEnterprise ? 'Contact Sales' : `Choose ${this.tier}`}
                    </button>
                `}
            </div>
        `;
    }
    
    renderLandingCard(tierInfo, isCurrentTier, isFree, isPro, isEnterprise) {
        const gridWrapper = this.options.useBootstrapGrid ?
            `<div class="col-lg-4 col-md-6 mb-4">` : '';
        const gridWrapperEnd = this.options.useBootstrapGrid ? `</div>` : '';

        // Determine price display: "Contact Us" for Enterprise, normal price otherwise
        const priceDisplay = isEnterprise ? 'Contact Us' : `$${tierInfo.price.toFixed(2)}`;
        const priceSubtext = isEnterprise ? 'for flexible plans' : (isFree ? 'free forever' : 'per month');

        this.container.innerHTML = `
            ${gridWrapper}
                <div class="card h-100 ${isPro && this.options.showPopularBadge ? 'border-primary' : 'border-0'} shadow">
                    ${isPro && this.options.showPopularBadge ?
                        '<div class="card-header text-center bg-primary text-white"><small class="fw-bold">MOST POPULAR</small></div>'
                        : ''}
                    <div class="card-body p-4 text-center">
                        <div class="mb-3">
                            <h3 class="fw-bold">${tierInfo.name}</h3>
                            <div class="display-6 fw-bold ${isPro ? 'text-danger' : 'text-primary'}">${priceDisplay}</div>
                            <small class="text-muted">${priceSubtext}</small>
                        </div>
                        <ul class="list-unstyled">
                            ${(tierInfo.features || []).map(feature =>
                                `<li class="mb-2"><i class="fas fa-check text-success me-2"></i>${this.renderFeatureText(feature)}</li>`
                            ).join('')}
                        </ul>

                        ${isCurrentTier ? `
                            <div class="tier-action-element tier-current-badge mt-3">
                                Current Plan
                            </div>
                        ` : `
                            <button class="btn ${isPro ? 'btn-danger' : 'btn-primary'} w-100 mt-3 tier-choose-button" data-tier="${this.tier}">
                                ${isEnterprise ? 'Contact Sales' : `Choose ${this.tier}`}
                            </button>
                        `}
                    </div>
                </div>
            ${gridWrapperEnd}
        `;
    }

    /**
     * Render feature text, supporting HTML for isHtml features with whitelist sanitization
     * @param {string|object} feature - Feature string or object with text/style/isHtml
     * @returns {string} HTML string for the feature
     */
    renderFeatureText(feature) {
        if (typeof feature === 'string') {
            return this.escapeHtml(feature);
        }
        if (typeof feature === 'object') {
            // For isHtml features, sanitize with whitelist (only <strong> allowed)
            if (feature.isHtml) {
                return this.sanitizeHtml(feature.text);
            }
            // For styled features (like "coming soon"), escape text but apply style
            if (feature.style) {
                return `<span style="${this.escapeHtml(feature.style)}">${this.escapeHtml(feature.text)}</span>`;
            }
            return this.escapeHtml(feature.text || '');
        }
        return '';
    }

    /**
     * Sanitize HTML with whitelist approach - only allows <strong> tags
     * @param {string} html - HTML string to sanitize
     * @returns {string} Sanitized HTML string
     */
    sanitizeHtml(html) {
        // Extract content, only preserving <strong> tags
        // Replace <strong> with placeholder, escape everything, then restore
        const strongPattern = /<strong>(.*?)<\/strong>/gi;
        const matches = [];
        // Use NUL-delimited placeholders to avoid collisions with user input
        const placeholderPrefix = '\x00STRONG_';
        const placeholderSuffix = '\x00';
        let sanitized = html.replace(strongPattern, (match, content) => {
            const index = matches.length;
            matches.push(this.escapeHtml(content));
            return `${placeholderPrefix}${index}${placeholderSuffix}`;
        });
        // Escape the rest
        sanitized = this.escapeHtml(sanitized);
        // Restore <strong> tags with escaped content
        matches.forEach((content, index) => {
            sanitized = sanitized.replace(
                `${placeholderPrefix}${index}${placeholderSuffix}`,
                `<strong>${content}</strong>`
            );
        });
        return sanitized;
    }

    /**
     * Escape HTML to prevent XSS for user-provided content
     * @param {string} text - Text to escape
     * @returns {string} Escaped HTML string
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }


}

// ES6 module exports
export { PricingCard };