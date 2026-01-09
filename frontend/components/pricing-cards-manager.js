/**
 * Pricing Cards Manager - Centralized pricing logic for landing page and modal
 * Follows CLAUDE.md modularity principles: single-purpose, reusable
 */

import { PricingCard } from './pricing-card.js';

/**
 * Initialize pricing cards for the landing page
 * @param {string} containerId - The ID of the container element
 */
export async function initLandingPagePricing(containerId = 'pricing-cards-container') {
    try {
        // Check if we're on the landing page and container exists
        const pricingContainer = document.getElementById(containerId);
        console.log('Pricing container found:', !!pricingContainer);
        
        if (pricingContainer) {
            console.log('PricingCard available:', typeof PricingCard);
            
            // Load tier data from backend API
            await window.stateManager.loadTiers();
            
            // Get current user tier if logged in (for authentication state)
            const currentTier = null; // Will be detected by PricingCard if user is logged in
            
            // Create 3-card row layout: Trial, Basic, Pro
            pricingContainer.innerHTML = `
                <div class="row justify-content-center">
                    <div class="col-lg-4 col-md-6 mb-4" id="landing-trial-card"></div>
                    <div class="col-lg-4 col-md-6 mb-4" id="landing-basic-card"></div>
                    <div class="col-lg-4 col-md-6 mb-4" id="landing-pro-card"></div>
                </div>
            `;
            
            // Wait for DOM to update, then create cards
            setTimeout(() => {
                try {
                    const trialContainer = document.getElementById('landing-trial-card');
                    const basicContainer = document.getElementById('landing-basic-card');
                    const proContainer = document.getElementById('landing-pro-card');
                    
                    console.log('Trial container found:', !!trialContainer);
                    console.log('Basic container found:', !!basicContainer);
                    console.log('Pro container found:', !!proContainer);
                    
                    if (trialContainer && basicContainer && proContainer) {
                        const trialCard = new PricingCard(
                            trialContainer,
                            'Trial',
                            currentTier,
                            { layout: 'landing', useBootstrapGrid: false }
                        );
                        
                        const basicCard = new PricingCard(
                            basicContainer,
                            'Basic',
                            currentTier,
                            { layout: 'landing', useBootstrapGrid: false }
                        );
                        
                        const proCard = new PricingCard(
                            proContainer,
                            'Pro',
                            currentTier,
                            { layout: 'landing', useBootstrapGrid: false }
                        );
                        
                        console.log('Rendering Trial card...');
                        trialCard.render();
                        console.log('Rendering Basic card...');
                        basicCard.render();
                        console.log('Rendering Pro card...');
                        proCard.render();
                        
                        console.log('Landing page pricing initialized successfully');
                    } else {
                        console.error('Card containers not found after DOM update');
                    }
                } catch (innerError) {
                    console.error('Error creating pricing cards:', innerError);
                }
            }, 100);
        } else {
            console.log('Pricing container not found - likely not on landing page');
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
        // Load tier data from backend API
        const tierConfigs = await window.stateManager.loadTiers();
        
        // Expand modal width for pricing cards
        const modalContent = document.querySelector('.modern-modal-content');
        if (modalContent) {
            modalContent.classList.add('modal-wide');
        }
        
        // Get current user tier from subscription data
        let currentTier = 'Trial'; // Default fallback
        if (window.currentUserSubscription && window.currentUserSubscription.tier_name) {
            // Convert lowercase API response to title case to match tier names
            const tierName = window.currentUserSubscription.tier_name;
            currentTier = tierName.charAt(0).toUpperCase() + tierName.slice(1);
            console.log('Detected user tier:', tierName, '→', currentTier); // Debug log
        }
        
        console.log('Final currentTier for upgrade modal:', currentTier); // Debug log
    
        contentDiv.innerHTML = `
            <div class="upgrade-modal-content">
                <div style="text-align: center; margin-bottom: 32px;">
                    <h4 style="margin-bottom: 12px; color: #212529;">Choose Your Plan</h4>
                    <p style="color: #6C757D; margin: 0;">Select the plan that fits your needs</p>
                </div>
                
                <div class="tier-options" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 32px;">
                    <div id="modal-basic-card"></div>
                    <div id="modal-pro-card"></div>
                </div>
                
                <div style="text-align: center;">
                    <button data-back-to-profile class="modern-btn modern-btn-outline">
                        ← Back to Profile
                    </button>
                </div>
            </div>
        `;
        
        // Create PricingCard components for modal
        const basicCard = new PricingCard(
            document.getElementById('modal-basic-card'),
            'Basic',
            currentTier,
            { layout: 'modal' }
        );
        
        const proCard = new PricingCard(
            document.getElementById('modal-pro-card'),
            'Pro',
            currentTier,
            { layout: 'modal' }
        );
        
        basicCard.render();
        proCard.render();
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