/**
 * Pricing Cards Manager - Centralized pricing logic for landing page and modal
 * Follows CLAUDE.md modularity principles: single-purpose, reusable
 */

import { PricingCard } from './pricing-card.js';

/**
 * Show the standalone upgrade modal with pricing cards
 * Uses Bootstrap modal directly - no Profile modal dependency
 */
export async function showStandaloneUpgradeModal() {
    const contentDiv = document.getElementById('upgradeModalContent');
    if (!contentDiv) {
        console.error('Upgrade modal content div not found');
        return;
    }

    try {
        // Show loading state
        contentDiv.innerHTML = `
            <div class="text-center py-4">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-2 text-muted">Loading pricing plans...</p>
            </div>
        `;

        // Load tier data and subscription data from backend API
        await window.stateManager.loadTiers();
        await window.stateManager.loadSubscription();

        // Get current user tier from StateManager
        const currentTier = window.stateManager.getCurrentTierName();

        // Render pricing cards grid (3+2 horizontal layout)
        contentDiv.innerHTML = `
            <div style="text-align: center; margin-bottom: 24px;">
                <p style="color: #6C757D; margin: 0;">Select the plan that fits your needs</p>
            </div>
            <div class="tier-options" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 16px;">
                <div id="standalone-free-card"></div>
                <div id="standalone-amateur-card"></div>
                <div id="standalone-pro-card"></div>
            </div>
            <div class="tier-options" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; max-width: 66%; margin: 0 auto;">
                <div id="standalone-power-user-card"></div>
                <div id="standalone-enterprise-card"></div>
            </div>
        `;

        // Create and render all 5 PricingCard components
        const freeCard = new PricingCard(
            document.getElementById('standalone-free-card'),
            'Free',
            currentTier,
            { layout: 'modal' }
        );

        const amateurCard = new PricingCard(
            document.getElementById('standalone-amateur-card'),
            'Amateur',
            currentTier,
            { layout: 'modal' }
        );

        const proCard = new PricingCard(
            document.getElementById('standalone-pro-card'),
            'Pro',
            currentTier,
            { layout: 'modal' }
        );

        const powerUserCard = new PricingCard(
            document.getElementById('standalone-power-user-card'),
            'Power User',
            currentTier,
            { layout: 'modal' }
        );

        const enterpriseCard = new PricingCard(
            document.getElementById('standalone-enterprise-card'),
            'Enterprise',
            currentTier,
            { layout: 'modal' }
        );

        freeCard.render();
        amateurCard.render();
        proCard.render();
        powerUserCard.render();
        enterpriseCard.render();

        // Show the Bootstrap modal
        const modalElement = document.getElementById('upgradeModal');
        if (modalElement) {
            const modal = new bootstrap.Modal(modalElement);
            modal.show();
        }
    } catch (error) {
        console.error('Failed to load upgrade modal:', error);
        contentDiv.innerHTML = `
            <div class="text-center text-danger py-4">
                <i class="fas fa-exclamation-triangle fa-2x mb-3"></i>
                <p>Unable to load pricing. Please try again.</p>
            </div>
        `;

        // Still show the modal with the error
        const modalElement = document.getElementById('upgradeModal');
        if (modalElement) {
            const modal = new bootstrap.Modal(modalElement);
            modal.show();
        }
    }
}

/**
 * Initialize pricing cards for the landing page
 * @param {string} containerId - The ID of the container element
 */
export async function initLandingPagePricing(containerId = 'pricing-cards-container') {
    try {
        // Check if we're on the landing page and container exists
        const pricingContainer = document.getElementById(containerId);
        
        if (pricingContainer) {
            
            // Load tier data from backend API
            await window.stateManager.loadTiers();
            
            // Get current user tier if logged in (for authentication state)
            const currentTier = null; // Will be detected by PricingCard if user is logged in
            
            // Create 5-card layout: Row 1 (Free, Amateur, Pro), Row 2 (Power User, Enterprise centered)
            pricingContainer.innerHTML = `
                <div class="row justify-content-center">
                    <div class="col-lg-4 col-md-6 mb-4" id="landing-free-card"></div>
                    <div class="col-lg-4 col-md-6 mb-4" id="landing-amateur-card"></div>
                    <div class="col-lg-4 col-md-6 mb-4" id="landing-pro-card"></div>
                </div>
                <div class="row justify-content-center">
                    <div class="col-lg-4 col-md-6 mb-4" id="landing-power-user-card"></div>
                    <div class="col-lg-4 col-md-6 mb-4" id="landing-enterprise-card"></div>
                </div>
            `;

            // Wait for DOM to update, then create cards
            setTimeout(() => {
                try {
                    const freeContainer = document.getElementById('landing-free-card');
                    const amateurContainer = document.getElementById('landing-amateur-card');
                    const proContainer = document.getElementById('landing-pro-card');
                    const powerUserContainer = document.getElementById('landing-power-user-card');
                    const enterpriseContainer = document.getElementById('landing-enterprise-card');

                    if (freeContainer && amateurContainer && proContainer && powerUserContainer && enterpriseContainer) {
                        const freeCard = new PricingCard(
                            freeContainer,
                            'Free',
                            currentTier,
                            { layout: 'landing', useBootstrapGrid: false }
                        );

                        const amateurCard = new PricingCard(
                            amateurContainer,
                            'Amateur',
                            currentTier,
                            { layout: 'landing', useBootstrapGrid: false }
                        );

                        const proCard = new PricingCard(
                            proContainer,
                            'Pro',
                            currentTier,
                            { layout: 'landing', useBootstrapGrid: false }
                        );

                        const powerUserCard = new PricingCard(
                            powerUserContainer,
                            'Power User',
                            currentTier,
                            { layout: 'landing', useBootstrapGrid: false }
                        );

                        const enterpriseCard = new PricingCard(
                            enterpriseContainer,
                            'Enterprise',
                            currentTier,
                            { layout: 'landing', useBootstrapGrid: false }
                        );

                        freeCard.render();
                        amateurCard.render();
                        proCard.render();
                        powerUserCard.render();
                        enterpriseCard.render();
                    } else {
                        console.error('Card containers not found after DOM update');
                    }
                } catch (innerError) {
                    console.error('Error creating pricing cards:', innerError);
                }
            }, 100);
        }
    } catch (error) {
        console.error('Failed to initialize landing page pricing:', error);
    }
}

/**
 * Show the upgrade modal with pricing cards
 * Uses the existing modal infrastructure
 */
export async function showUpgradeModal() {
    const contentDiv = document.getElementById('customModalContent');
    if (!contentDiv) return;
    
    try {
        // Load tier data from backend API (ensures data is cached)
        await window.stateManager.loadTiers();
        
        // Expand modal width for pricing cards
        const modalContent = document.querySelector('.modern-modal-content');
        if (modalContent) {
            modalContent.classList.add('modal-wide');
        }
        
        // Get current user tier from subscription data
        let currentTier = 'Free'; // Default fallback
        if (window.currentUserSubscription && window.currentUserSubscription.tier_name) {
            // Convert lowercase API response to title case to match tier names
            const tierName = window.currentUserSubscription.tier_name;
            currentTier = tierName.charAt(0).toUpperCase() + tierName.slice(1);
        }

        contentDiv.innerHTML = `
            <div class="upgrade-modal-content">
                <div style="text-align: center; margin-bottom: 32px;">
                    <h4 style="margin-bottom: 12px; color: #212529;">Choose Your Plan</h4>
                    <p style="color: #6C757D; margin: 0;">Select the plan that fits your needs</p>
                </div>

                <div class="tier-options" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                    <div id="modal-amateur-card"></div>
                    <div id="modal-pro-card"></div>
                </div>
                <div class="tier-options" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 32px;">
                    <div id="modal-power-user-card"></div>
                    <div id="modal-enterprise-card"></div>
                </div>

                <div style="text-align: center;">
                    <button data-back-to-profile class="modern-btn modern-btn-outline">
                        ← Back to Profile
                    </button>
                </div>
            </div>
        `;

        // Create PricingCard components for modal (all paid tiers)
        const amateurCard = new PricingCard(
            document.getElementById('modal-amateur-card'),
            'Amateur',
            currentTier,
            { layout: 'modal' }
        );

        const proCard = new PricingCard(
            document.getElementById('modal-pro-card'),
            'Pro',
            currentTier,
            { layout: 'modal' }
        );

        const powerUserCard = new PricingCard(
            document.getElementById('modal-power-user-card'),
            'Power User',
            currentTier,
            { layout: 'modal' }
        );

        const enterpriseCard = new PricingCard(
            document.getElementById('modal-enterprise-card'),
            'Enterprise',
            currentTier,
            { layout: 'modal' }
        );

        amateurCard.render();
        proCard.render();
        powerUserCard.render();
        enterpriseCard.render();
    } catch (error) {
        console.error('Failed to load upgrade modal:', error);
        
        // Fallback: Show error message in modal
        contentDiv.innerHTML = `
            <div class="upgrade-modal-content" style="text-align: center; padding: 40px;">
                <div style="color: #dc3545; margin-bottom: 20px;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 15px;"></i>
                    <h4>Unable to Load Pricing</h4>
                    <p>Please try again in a moment.</p>
                </div>
                <button data-back-to-profile class="modern-btn modern-btn-outline">
                    ← Back to Profile
                </button>
            </div>
        `;
    }
}