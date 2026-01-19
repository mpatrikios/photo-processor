// TagSort - Main JavaScript

import CONFIG from './config.js';
import { PaymentForm } from '../../components/payment-form.js';
import { initLandingPagePricing, showUpgradeModal, showStandaloneUpgradeModal } from '../../components/pricing-cards-manager.js';
import { PhotoProcessor } from './photo-processor.js';
import { StateManager } from './state-manager.js';


// Global functions for modal and authentication handling
function showSignInModal() {
    // Track engagement
    if (window.analyticsDashboard) {
        window.analyticsDashboard.trackEngagement('modal_open', 'signInModal');
    }
    
    const modal = new bootstrap.Modal(document.getElementById('signInModal'));
    modal.show();

    // Attach event listener when modal is shown
    setTimeout(() => {
        const signInForm = document.getElementById('signInForm');
        if (signInForm) {
            // Remove any existing listeners
            signInForm.removeEventListener('submit', handleSignIn);
            // Add new listener
            signInForm.addEventListener('submit', handleSignIn);
        }
    }, 100);
}

function showCreateAccountModal() {
    // Track engagement
    if (window.analyticsDashboard) {
        window.analyticsDashboard.trackEngagement('modal_open', 'createAccountModal');
    }
    
    const modal = new bootstrap.Modal(document.getElementById('createAccountModal'));
    modal.show();

    // Attach event listener when modal is shown
    setTimeout(() => {
        const createAccountForm = document.getElementById('createAccountForm');
        if (createAccountForm) {
            // Remove any existing listeners
            createAccountForm.removeEventListener('submit', handleCreateAccount);
            // Add new listener
            createAccountForm.addEventListener('submit', handleCreateAccount);
        }
    }, 100);
}

function switchToCreateAccount() {
    // Hide sign in modal and show create account modal
    const signInModal = bootstrap.Modal.getInstance(document.getElementById('signInModal'));
    if (signInModal) signInModal.hide();

    setTimeout(() => {
        showCreateAccountModal();
    }, 300);
}

function switchToSignIn() {
    // Hide create account modal and show sign in modal  
    const createAccountModal = bootstrap.Modal.getInstance(document.getElementById('createAccountModal'));
    if (createAccountModal) createAccountModal.hide();

    setTimeout(() => {
        showSignInModal();
    }, 300);
}

function showLandingPage() {
    document.getElementById('landing-page').classList.remove('d-none');
    document.getElementById('app-section').classList.add('d-none');
}

function showAppSection() {
    document.getElementById('landing-page').classList.add('d-none');
    document.getElementById('app-section').classList.remove('d-none');
    
    // Update PhotoProcessor's auth token if it exists
    if (window.photoProcessor) {
        const token = localStorage.getItem('auth_token');
        if (token) {
            window.photoProcessor.authToken = token;
            window.photoProcessor.isAuthenticated = true;
            
            // Check if there are existing results to preserve
            if (AppRouter.hasValidResults()) {
                // Preserve existing results - show results section
                window.photoProcessor.showResultsSection();
            } else if (window.stateManager && window.stateManager.hasRecentCompletedJob()) {
                // Try to restore recent job instead of going to upload
                window.photoProcessor.checkAndRestoreRecentJob();
            } else {
                // No existing data - show upload section
                window.photoProcessor.showUploadSection();
            }
        }
    }
    
    // Update StateManager auth state
    if (window.stateManager) {
        const token = localStorage.getItem('auth_token');
        const userInfo = localStorage.getItem('user_info');
        if (token) {
            try {
                window.stateManager.set('auth.isAuthenticated', true);
                window.stateManager.set('auth.token', token);
                if (userInfo) {
                    window.stateManager.set('auth.user', JSON.parse(userInfo));
                }
            } catch (error) {
                console.error('Failed to update StateManager auth state:', error);
            }
        }
    }
}

// Simple routing system for the application
class AppRouter {
    constructor() {
        this.routes = {
            '': this.showHome.bind(this),
            'home': this.showHome.bind(this),
            'pricing': this.showPricing.bind(this),
            'analytics': this.showAnalytics.bind(this),
            'app': this.showApp.bind(this),
            'upload': this.showUpload.bind(this),
            'results': this.showResults.bind(this),
            'processing': this.showProcessing.bind(this)
        };
        
        // Track navigation to prevent infinite loops
        this._lastRoute = null;
        this._routeCount = 0;
        
        // Listen for hash changes
        window.addEventListener('hashchange', () => this.handleRouteChange());
    }
    
    /**
     * Helper method to check if PhotoProcessor has valid results to display
     * @returns {boolean} True if there are displayable results
     */
    hasValidResults() {
        return AppRouter.hasValidResults();
    }
    
    /**
     * Static helper to check if PhotoProcessor has valid results to display
     * @returns {boolean} True if there are displayable results
     */
    static hasValidResults() {
        if (!window.photoProcessor || !window.photoProcessor.groupedPhotos) {
            return false;
        }
        
        const results = window.photoProcessor.groupedPhotos;
        return Array.isArray(results) ? 
            results.length > 0 : 
            Object.keys(results).length > 0;
    }
    
    /**
     * Safely update URL without triggering navigation events
     * @param {string} hash - The hash to set (without #)
     */
    static safeReplaceState(hash) {
        try {
            if (window.location.hash !== `#${hash}`) {
                history.replaceState(null, null, `#${hash}`);
            }
        } catch (error) {
            console.warn(`Failed to update URL to #${hash}:`, error);
            // Gracefully degrade - the app will still work without URL updates
        }
    }
    
    handleRouteChange() {
        const hash = window.location.hash.slice(1); // Remove #
        const route = hash.toLowerCase();
        
        // Prevent infinite loops
        if (route === this._lastRoute) {
            this._routeCount++;
            if (this._routeCount > 3) {
                console.warn('Route loop detected, falling back to upload');
                if (route !== 'upload') {
                    this._routeCount = 0;
                    this._lastRoute = null;
                    window.location.hash = 'upload';
                    return;
                }
            }
        } else {
            this._routeCount = 0;
        }
        this._lastRoute = route;
        
        // Check if user is authenticated for protected routes
        const token = localStorage.getItem('auth_token');
        const protectedRoutes = ['analytics', 'app', 'upload', 'results', 'processing'];
        
        if (protectedRoutes.includes(route) && !token) {
            // Redirect to login if trying to access protected route
            window.location.hash = '';
            showLandingPage();
            return;
        }
        
        // Execute route handler
        if (this.routes[route]) {
            this.routes[route]();
        } else if (token) {
            // Default to smart routing based on current state
            this.showApp(); // This will determine the appropriate view without redirects
        } else {
            // Default to home if not authenticated
            this.showHome();
        }
    }
    
    showHome() {
        // Allow both authenticated and unauthenticated users to view landing page
        showLandingPage();
        updateLandingPageForAuthState();
    }

    showPricing() {
        // Show landing page and scroll to pricing section
        showLandingPage();
        updateLandingPageForAuthState();
        // Scroll to pricing section after a brief delay to ensure page is rendered
        setTimeout(() => {
            const pricingSection = document.getElementById('pricing');
            if (pricingSection) {
                pricingSection.scrollIntoView({ behavior: 'smooth' });
            }
        }, 100);
    }

    showAnalytics() {
        // Hide landing page and app section
        document.getElementById('landing-page').classList.add('d-none');
        document.getElementById('app-section').classList.add('d-none');
        
        // Show analytics dashboard
        if (window.analyticsDashboard) {
            window.analyticsDashboard.showDashboard();
        }
    }
    
    showApp() {
        // Legacy 'app' route - determine appropriate route without redirecting
        showAppSection();
        
        if (window.photoProcessor) {
            // Use the same logic as showAppSection() but don't trigger navigation
            const token = localStorage.getItem('auth_token');
            if (token) {
                // Let showAppSection handle the state determination
                // This avoids redirect loops while maintaining state restoration
                return;
            }
        }
    }
    
    showUpload() {
        showAppSection();
        // Ensure we show the upload section specifically
        if (window.photoProcessor) {
            window.photoProcessor.showUploadSection();
        }
    }
    
    showResults() {
        showAppSection();
        // Ensure we show the results section specifically
        if (window.photoProcessor) {
            // Check if we have results to show
            if (this.hasValidResults()) {
                window.photoProcessor.showResultsSection();
            } else if (window.stateManager && window.stateManager.hasRecentCompletedJob()) {
                // Try to restore recent job - this will call showResultsSection if successful
                window.photoProcessor.checkAndRestoreRecentJob();
            } else {
                // No results available - show upload section instead of redirecting
                // This prevents redirect loops
                window.photoProcessor.showUploadSection();
                // Update URL to reflect actual state
                AppRouter.safeReplaceState('upload');
            }
        }
    }
    
    showProcessing() {
        showAppSection();
        // Ensure we show the processing section specifically
        if (window.photoProcessor) {
            window.photoProcessor.showProcessingSection();
        }
    }
    
    navigateTo(route) {
        window.location.hash = route;
    }
}

// Router will be initialized in DOMContentLoaded

// ==========================================
// LANDING PAGE AUTH STATE FUNCTIONS
// ==========================================

/**
 * Update landing page UI based on authentication state
 */
function updateLandingPageForAuthState() {
    const token = localStorage.getItem('auth_token');
    if (token) {
        updateNavbarForAuthenticatedUser();
        updateHeroForAuthenticatedUser();
    }
}

/**
 * Update navbar for authenticated users viewing landing page
 * Replaces "Sign In / Start Trial" with "Go to App" + profile dropdown
 */
function updateNavbarForAuthenticatedUser() {
    const navButtons = document.querySelector('#navbarNav .d-flex.align-items-center');
    if (!navButtons) return;  // Parent already validated auth

    navButtons.innerHTML = `
        <button class="btn clean-btn-primary" onclick="window.location.hash='upload'">
            <i class="fas fa-images me-2"></i>Go to App
        </button>
        <div class="dropdown ms-2">
            <button class="btn clean-btn-ghost dropdown-toggle" data-bs-toggle="dropdown" aria-label="User menu">
                <i class="fas fa-user-circle"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
                <li><a class="dropdown-item" href="#" onclick="showProfileModal(); return false;">Profile</a></li>
                <li><a class="dropdown-item" href="#pricing">Pricing</a></li>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item text-danger" href="#" onclick="logout(); return false;">Sign Out</a></li>
            </ul>
        </div>
    `;
}

/**
 * Update hero CTAs for authenticated users viewing landing page
 * Replaces trial signup buttons with app navigation
 */
function updateHeroForAuthenticatedUser() {
    // Parent already validated auth
    const heroCTAs = document.querySelector('.hero-section .d-flex.gap-3');
    if (!heroCTAs) return;

    heroCTAs.innerHTML = `
        <button class="btn btn-danger btn-lg px-4 py-3" onclick="window.location.hash='results'">
            <i class="fas fa-images me-2"></i>
            Go to Your Photos
        </button>
        <a href="#pricing" class="btn btn-outline-dark btn-lg px-4 py-3">
            <i class="fas fa-tags me-2"></i>
            View Pricing
        </a>
    `;
}

// Keep only essential global functions for backwards compatibility
window.showSignInModal = showSignInModal;
window.showCreateAccountModal = showCreateAccountModal;
window.switchToCreateAccount = switchToCreateAccount;
window.switchToSignIn = switchToSignIn;
window.showLandingPage = showLandingPage;
window.showAppSection = showAppSection;
window.logout = logout;

function logout() {
    // Clear auth token
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_info');
    localStorage.removeItem('refresh_token');

    // Reset any app state
    if (window.photoProcessor) {
        window.photoProcessor.isAuthenticated = false;
        window.photoProcessor.authToken = null;
    }

    // Clear StateManager auth state using existing logout method
    if (window.stateManager) {
        window.stateManager.logout();
    }

    // Navigate to home and reload to reset landing page UI to guest state
    window.location.hash = '';
    window.location.reload();
}

// ==========================================
// 1. AUTHENTICATION & FORM HANDLING
// ==========================================

async function handleSignIn(event) {
    event.preventDefault();
    const form = event.target;

    const emailElement = document.getElementById('signInEmail');
    const passwordElement = document.getElementById('signInPassword');

    if (!emailElement || !passwordElement) {
        console.error('Form elements not found!');
        showNotification('Form error - please try again', 'error');
        return;
    }

    const email = emailElement.value.trim();
    const password = passwordElement.value;

    if (!email || !password) {
        showNotification('Please fill in all fields', 'error');
        return;
    }

    // Show loading state
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Signing In...';

    try {
        const apiBase = CONFIG.API_BASE_URL;
        
        const response = await fetch(`${apiBase}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const result = await response.json();

        if (response.ok) {
            // Track success
            if (window.analyticsDashboard) {
                window.analyticsDashboard.trackEngagement('success_action', 'login_success', {
                    user_id: result.user?.id,
                    login_method: 'email'
                });
            }
            
            // Store tokens properly using StateManager
            if (window.stateManager) {
                window.stateManager.login({
                    access_token: result.token,
                    refresh_token: result.refresh_token,
                    user: result.user,
                    expires_in: result.expires_in
                });
                
                window.stateManager.saveToStorage();
            } else {
                // Fallback to direct localStorage
                localStorage.setItem('auth_token', result.token);
                localStorage.setItem('user_info', JSON.stringify(result.user));
                if (result.refresh_token) {
                    localStorage.setItem('refresh_token', result.refresh_token);
                }
            }

            const modal = bootstrap.Modal.getInstance(document.getElementById('signInModal'));
            if (modal) modal.hide();
            
            form.reset();
            
            // Check for pending actions (like upgrade)
            const pendingAction = localStorage.getItem('pending_action');
            const pendingTier = localStorage.getItem('pending_tier');
            
            if (pendingAction === 'upgrade' && pendingTier) {
                // Clear pending action
                localStorage.removeItem('pending_action');
                localStorage.removeItem('pending_tier');
                
                // Stay on landing page and trigger upgrade
                showNotification(result.message || 'Welcome back!', 'success');
                setTimeout(() => {
                    handleUpgrade(pendingTier);
                }, 2000); // Increased delay to ensure login completes
            } else {
                // Normal login flow - go to upload page
                window.location.hash = 'upload';
                
                // Safety check for UI function
                if (typeof showAppSection === 'function') showAppSection();
                
                showNotification(result.message || 'Welcome back!', 'success');
            }
        } else {
            showNotification(result.detail || 'Login failed. Please check your credentials.', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showNotification('Network error. Please check your connection and try again.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

async function handleCreateAccount(event) {
    event.preventDefault();
    const form = event.target;
    const name = document.getElementById('createName').value.trim();
    const email = document.getElementById('createEmail').value.trim();
    const password = document.getElementById('createPassword').value;

    if (!name || !email || !password) {
        showNotification('Please fill in all fields', 'error');
        return;
    }

    if (name.length < 2) {
        showNotification('Full name must be at least 2 characters', 'error');
        return;
    }

    if (password.length < 8) {
        showNotification('Password must be at least 8 characters', 'error');
        return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Creating Account...';

    try {
        const apiBase = CONFIG.API_BASE_URL;
            
        const response = await fetch(`${apiBase}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, full_name: name, confirm_password: password })
        });

        const result = await response.json();

        if (response.ok) {
            if (window.analyticsDashboard) {
                window.analyticsDashboard.trackEngagement('success_action', 'account_created', {
                    user_id: result.user?.id
                });
            }
            
            // Store tokens properly using StateManager
            if (window.stateManager) {
                window.stateManager.login({
                    access_token: result.token,
                    refresh_token: result.refresh_token,
                    user: result.user,
                    expires_in: result.expires_in
                });
                
                window.stateManager.saveToStorage();
            } else {
                // Fallback to direct localStorage
                localStorage.setItem('auth_token', result.token);
                localStorage.setItem('user_info', JSON.stringify(result.user));
                if (result.refresh_token) {
                    localStorage.setItem('refresh_token', result.refresh_token);
                }
            }

            const modal = bootstrap.Modal.getInstance(document.getElementById('createAccountModal'));
            if (modal) modal.hide();

            form.reset();
            
            // Check for pending actions (like upgrade)
            const pendingAction = localStorage.getItem('pending_action');
            const pendingTier = localStorage.getItem('pending_tier');
            
            if (pendingAction === 'upgrade' && pendingTier) {
                // Clear pending action
                localStorage.removeItem('pending_action');
                localStorage.removeItem('pending_tier');
                
                // Stay on landing page and trigger upgrade
                showNotification(result.message || 'Account created successfully!', 'success');
                setTimeout(() => {
                    handleUpgrade(pendingTier);
                }, 2000); // Increased delay to ensure registration completes
            } else {
                // Normal registration flow - go to upload page
                window.location.hash = 'upload';
                
                if (typeof showAppSection === 'function') showAppSection();
                
                showNotification(result.message || 'Account created successfully!', 'success');
            }
        } else {
            showNotification(result.detail || 'Failed to create account.', 'error');
        }
    } catch (error) {
        console.error('Registration error:', error);
        showNotification('Network error.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

/**
 * Modern glassmorphism toast notification system
 * @param {string} message - The message to display
 * @param {string} type - Type of notification: 'success', 'error', 'info', 'warning'
 * @param {number} duration - Auto-dismiss duration in milliseconds (default: 4000)
 */
function showNotification(message, type = 'info', duration = 4000) {
    // Get or create the alert container
    let container = document.getElementById('alert-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'alert-container';
        document.body.appendChild(container);
    }

    // Icon mapping for different toast types
    const iconMap = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-triangle', 
        info: 'fa-info-circle',
        warning: 'fa-exclamation-triangle'
    };

    // Color mapping for icon colors
    const iconColorMap = {
        success: '#10b981',
        error: '#ef4444',
        info: '#3b82f6', 
        warning: '#f59e0b'
    };

    // Create the toast element
    const toast = document.createElement('div');
    toast.className = `modern-toast ${type}`;
    
    // Create unique ID for this toast
    const toastId = 'toast-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    toast.id = toastId;

    // Create toast content
    toast.innerHTML = `
        <div class="toast-content">
            <i class="fas ${iconMap[type]} toast-icon" style="color: ${iconColorMap[type]};"></i>
            <span class="toast-message">${message}</span>
        </div>
        <button class="toast-close" onclick="dismissToast('${toastId}')" aria-label="Close">
            <i class="fas fa-times"></i>
        </button>
        <div class="toast-progress"></div>
    `;

    // Add to container (newest on top)
    container.insertBefore(toast, container.firstChild);

    // Auto-dismiss after specified duration
    setTimeout(() => {
        dismissToast(toastId);
    }, duration);

    return toastId;
}

/**
 * Dismiss a specific toast with smooth animation
 * @param {string} toastId - ID of the toast to dismiss
 */
function dismissToast(toastId) {
    const toast = document.getElementById(toastId);
    if (!toast) return;

    // Add fade-out animation
    toast.classList.add('fade-out');
    
    // Remove from DOM after animation completes
    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
    }, 300); // Match animation duration
}

// Expose dismissToast globally for onclick handlers
window.dismissToast = dismissToast;

/**
 * Clear all toasts
 */
function clearAllToasts() {
    const container = document.getElementById('alert-container');
    if (container) {
        const toasts = container.querySelectorAll('.modern-toast');
        toasts.forEach(toast => {
            dismissToast(toast.id);
        });
    }
}

function checkAuthOnLoad() {
    const token = localStorage.getItem('auth_token');
    // Ensure these functions exist in your global scope or UI Controller
    if (token && typeof showAppSection === 'function') {
        showAppSection();
    } else if (typeof showLandingPage === 'function') {
        showLandingPage();
    }
}

// ==========================================
// 2. PROFILE MODAL FUNCTIONS
// ==========================================

async function showProfileModal() {
    if (window.analyticsDashboard) {
        window.analyticsDashboard.trackEngagement('modal_open', 'profile_modal');
    }
    
    // Remove existing
    const existingCustomModal = document.getElementById('customProfileModal');
    if (existingCustomModal) existingCustomModal.remove();
    
    // Create new modal structure with modern classes
    const modalBackdrop = document.createElement('div');
    modalBackdrop.id = 'customProfileModal';
    modalBackdrop.className = 'modern-modal';
    
    const modalDialog = document.createElement('div');
    modalDialog.className = 'modern-modal-content';
    
    // Loading State HTML
    modalDialog.innerHTML = `
        <div class="modern-modal-header">
            <h4 class="modern-modal-title">Profile</h4>
            <button id="customModalClose" class="modern-modal-close">&times;</button>
        </div>
        <div class="modern-modal-body">
            <div id="customModalContent">
                <div class="modern-loading">
                    <div class="modern-spinner"></div>
                    <div class="modern-loading-text">Loading profile data...</div>
                </div>
            </div>
        </div>
    `;
    
    modalBackdrop.appendChild(modalDialog);
    document.body.appendChild(modalBackdrop);
    
    // Close handlers
    const closeModal = () => modalBackdrop.remove();
    document.getElementById('customModalClose').addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) closeModal();
    });
    
    // Load Data
    try {
        await loadCustomProfileData();
        
        // Add event delegation at container level (survives innerHTML changes)
        setupModalEventDelegation();
        
    } catch (error) {
        console.error('Error loading profile:', error);
        const contentDiv = document.getElementById('customModalContent');
        if (contentDiv) {
            contentDiv.innerHTML = `
                <div class="modern-loading">
                    <div style="color: #dc3545; margin-bottom: 16px;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 12px;"></i>
                    </div>
                    <h5 style="color: #dc3545; margin-bottom: 8px;">Error Loading Profile</h5>
                    <p style="color: rgba(0,0,0,0.6); margin-bottom: 20px;">Unable to load profile data.</p>
                    <button onclick="this.closest('#customProfileModal').remove()" class="modern-btn modern-btn-primary">Close</button>
                </div>
            `;
        }
    }
}

async function loadCustomProfileData() {
    // Reset modal width when loading profile data
    const modalContent = document.querySelector('.modern-modal-content');
    if (modalContent) {
        modalContent.classList.remove('modal-wide');
    }
    
    const apiBase = CONFIG.API_BASE_URL;
    const headers = CONFIG.getAuthHeaders();

    const [quotaResponse, statsResponse] = await Promise.all([
        fetch(`${apiBase}/users/me/quota`, { headers }),
        fetch(`${apiBase}/users/me/stats`, { headers })
    ]);

    if (!quotaResponse.ok || !statsResponse.ok) {
        throw new Error('Failed to load profile data');
    }

    updateCustomModalContent(
        await quotaResponse.json(),
        await statsResponse.json()
    );
}

// Store current user subscription data globally for access in other functions
let currentUserSubscription = null;

/**
 * Humanize feature names for display
 * @param {string} featureName - Feature code from backend
 * @returns {string} Human-readable feature name
 */
function humanizeFeature(featureName) {
    const featureMap = {
        'standard_support': 'Standard Support',
        'priority_support': 'Priority Support',
        'export_csv': 'CSV Export',
        'unlimited_photos': 'Unlimited Photos',
        'custom_solutions': 'Custom Solutions'
    };

    return featureMap[featureName] || featureName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

async function updateCustomModalContent(quotaData, statsData) {
    const contentDiv = document.getElementById('customModalContent');
    if (!contentDiv) return;
    
    const { user, stats } = statsData;
    const { quota } = quotaData;
    
    // Load subscription data
    let subscriptionData = null;
    try {
        const apiBase = CONFIG.API_BASE_URL;
        
        const response = await fetch(`${apiBase}/users/me/subscription`, {
            headers: CONFIG.getAuthHeaders()
        });
        
        if (response.ok) {
            const result = await response.json();
            subscriptionData = result.subscription;
            // Store globally for access in showUpgradeModal and showStandaloneUpgradeModal
            currentUserSubscription = subscriptionData;
            window.currentUserSubscription = subscriptionData;
        }
    } catch (error) {
        console.error('Error loading subscription data:', error);
    }
    
    contentDiv.innerHTML = `
        <div>
            <div class="modern-tab-nav">
                <button data-tab="quota" id="quotaTab" class="modern-tab-button active">Quota</button>
                <button data-tab="account" id="accountTab" class="modern-tab-button">Account</button>
                <button data-tab="subscription" id="subscriptionTab" class="modern-tab-button">Subscription</button>
            </div>
            
            <div id="quotaContent">
                <div class="glass-card ${getQuotaCardClass(quota.photos_used_this_month, quota.monthly_photo_limit)}" style="padding: 24px;">
                    <h5>Monthly Photo Quota</h5>
                    <div style="font-size: 2rem; font-weight: 700; margin-bottom: 8px;">${quota.photos_used_this_month}/${quota.monthly_photo_limit}</div>
                    <div class="modern-progress">
                        <div class="modern-progress-bar ${getQuotaBarClass(quota.photos_used_this_month, quota.monthly_photo_limit)}" style="width: ${Math.min(100, (quota.photos_used_this_month / quota.monthly_photo_limit) * 100)}%;"></div>
                    </div>
                    <div style="font-size: 0.9rem; margin-top: 8px; opacity: 0.9;">${getQuotaStatusMessage(quota.photos_used_this_month, quota.monthly_photo_limit)}</div>
                </div>
                <div class="modern-stats-grid">
                    <div class="modern-stat-item">
                        <div class="modern-stat-value" style="color: #28a745;">${stats.total_photos_uploaded || 0}</div>
                        <div class="modern-stat-label">All-Time Uploads</div>
                    </div>
                    <div class="modern-stat-item">
                        <div class="modern-stat-value" style="color: #17a2b8;">${stats.total_processing_jobs || 0}</div>
                        <div class="modern-stat-label">All-Time Jobs</div>
                    </div>
                </div>
            </div>
            
            <div id="accountContent" style="display: none;">
                <div class="modern-form-field">
                    <label class="modern-form-label">Email</label>
                    <div style="display: flex; gap: 8px;">
                        <input type="email" id="customEmail" value="${user.email}" class="modern-form-input" style="flex: 1;">
                        <button onclick="showChangeEmailForm()" class="modern-btn modern-btn-secondary" style="white-space: nowrap;">Change</button>
                    </div>
                </div>
                <div class="modern-form-field">
                    <label class="modern-form-label">Full Name</label>
                    <input type="text" id="customFullName" value="${user.full_name || ''}" class="modern-form-input">
                </div>
                <div class="modern-form-field">
                    <label class="modern-form-label">Password</label>
                    <div style="display: flex; gap: 8px;">
                        <input type="password" value="••••••••" readonly class="modern-form-input" style="flex: 1;">
                        <button onclick="showChangePasswordForm()" class="modern-btn modern-btn-secondary" style="white-space: nowrap;">Change</button>
                    </div>
                </div>
                <div style="text-align: right; margin-top: 24px;">
                    <button onclick="updateCustomProfile()" class="modern-btn modern-btn-primary">Save Changes</button>
                </div>
            </div>
            
            <div id="subscriptionContent" style="display: none;">
                ${subscriptionData ? `
                    <div class="subscription-card-clean">
                        <div class="plan-label">Current Plan</div>
                        <div class="plan-name">${subscriptionData.tier_name.charAt(0).toUpperCase() + subscriptionData.tier_name.slice(1)}</div>
                        <div class="plan-limit">${subscriptionData.monthly_photo_limit.toLocaleString()} photos / month</div>
                        ${subscriptionData.features && subscriptionData.features.length > 0 ? `
                            <ul class="feature-list">
                                ${subscriptionData.features.map(feature => `
                                    <li class="feature-item">
                                        <div class="feature-icon">✓</div>
                                        ${humanizeFeature(feature)}
                                    </li>
                                `).join('')}
                            </ul>
                        ` : ''}
                        ${!subscriptionData.has_stripe_subscription ? `
                            <button class="upgrade-button" data-upgrade-plan>
                                View Plans
                            </button>
                        ` : ''}
                    </div>
                    ${subscriptionData.has_stripe_subscription ? `
                        <div style="text-align: center; margin-top: 16px;">
                            <button class="modern-btn modern-btn-outline" data-billing-portal>Manage Billing</button>
                        </div>
                    ` : ''}
                ` : `
                    <div class="modern-loading">
                        <div class="modern-loading-text">Loading subscription information...</div>
                    </div>
                `}
            </div>
        </div>
    `;
}

function showCustomTab(tabName) {
    ['quota', 'account', 'subscription'].forEach(name => {
        const content = document.getElementById(name + 'Content');
        const tab = document.getElementById(name + 'Tab');
        if (content) content.style.display = name === tabName ? 'block' : 'none';
        if (tab) {
            if (name === tabName) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        }
    });
}

function setupModalEventDelegation() {
    const modalContainer = document.getElementById('customModalContent');
    if (!modalContainer) return;
    
    // Remove any existing listeners to avoid duplicates
    modalContainer.removeEventListener('click', handleModalClicks);
    
    // Add single delegated event listener that handles all clicks
    modalContainer.addEventListener('click', handleModalClicks);
}

function handleModalClicks(e) {
    // Tab navigation
    if (e.target.dataset.tab) {
        e.preventDefault();
        showCustomTab(e.target.dataset.tab);
        return;
    }
    
    // Billing portal button
    if (e.target.hasAttribute('data-billing-portal')) {
        e.preventDefault();
        openBillingPortal();
        return;
    }
    
    // Upgrade plan button - close profile modal and open standalone upgrade modal
    if (e.target.hasAttribute('data-upgrade-plan')) {
        e.preventDefault();
        // Close the profile modal first
        const profileModal = document.getElementById('customProfileModal');
        if (profileModal) {
            profileModal.remove();
        }
        // Open the standalone upgrade modal
        showStandaloneUpgradeModal();
        return;
    }
    
    // Back to profile button
    if (e.target.hasAttribute('data-back-to-profile')) {
        e.preventDefault();
        // Reset modal width and reload the original profile modal content
        const modalContent = document.querySelector('.modern-modal-content');
        if (modalContent) {
            modalContent.classList.remove('modal-wide');
        }
        loadCustomProfileData().then(() => {
            // Re-establish event delegation after profile content reloads
            setupModalEventDelegation();
        });
        return;
    }
    
    // Upgrade tier buttons (from upgrade modal)
    if (e.target.hasAttribute('data-tier')) {
        e.preventDefault();
        const tierName = e.target.dataset.tier;
        if (tierName) {
            handleUpgrade(tierName);
        }
        return;
    }
}



async function updateCustomProfile() {
    const fullNameInput = document.getElementById('customFullName');
    if (!fullNameInput) return;
    
    try {
        const apiBase = CONFIG.API_BASE_URL;
            
        const formData = new FormData();
        formData.append('full_name', fullNameInput.value);
        
        const response = await fetch(`${apiBase}/users/me/profile`, {
            method: 'PUT',
            headers: CONFIG.getAuthHeaders(),
            body: formData
        });
        
        if (response.ok) {
            const button = event.target;
            const originalText = button.textContent;
            button.textContent = 'Saved!';
            button.style.backgroundColor = '#28a745';
            setTimeout(() => {
                button.textContent = originalText;
                button.style.backgroundColor = '#007bff';
            }, 2000);
        } else {
            throw new Error('Failed to update');
        }
    } catch (error) {
        showNotification('Error updating profile', 'error');
    }
}

// ==========================================
// 3. GLOBAL ASSIGNMENTS & PLACEHOLDERS
// ==========================================

// Quota Color Helper Functions
function getQuotaCardClass(used, limit) {
    const percentage = limit > 0 ? (used / limit) * 100 : 0;
    
    if (percentage <= 70) return 'modern-card-safe';
    if (percentage <= 90) return 'modern-card-warning';
    return 'modern-card-danger';
}

function getQuotaBarClass(used, limit) {
    const percentage = limit > 0 ? (used / limit) * 100 : 0;
    
    if (percentage <= 70) return 'safe';
    if (percentage <= 90) return 'warning';
    return 'danger';
}

function getQuotaStatusMessage(used, limit) {
    const percentage = limit > 0 ? (used / limit) * 100 : 0;
    const remaining = Math.max(0, limit - used);
    
    if (percentage <= 70) {
        return `You have ${remaining} photos remaining this month. Keep uploading!`;
    } else if (percentage <= 90) {
        return `You're approaching your limit. ${remaining} photos remaining.`;
    } else if (percentage < 100) {
        return `Almost at your limit! Only ${remaining} photos left.`;
    } else {
        return `You've reached your monthly limit. Consider upgrading your plan.`;
    }
}

// Email Change Functions
async function showChangeEmailForm() {
    const emailField = document.querySelector('#customEmail').parentElement;
    emailField.innerHTML = `
        <div class="modern-form-field">
            <label class="modern-form-label">New Email</label>
            <input type="email" id="newEmail" class="modern-form-input" placeholder="Enter new email">
        </div>
        <div class="modern-form-field">
            <label class="modern-form-label">Current Password</label>
            ${createPasswordField('emailChangePassword', 'Enter your current password', 'modern-form-input', 'current-password')}
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button onclick="cancelEmailChange()" class="modern-btn modern-btn-outline">Cancel</button>
            <button onclick="changeEmail()" class="modern-btn modern-btn-primary">Update Email</button>
        </div>
    `;
}

function cancelEmailChange() {
    location.reload(); // Simple way to reset the modal
}

async function changeEmail() {
    const newEmailInput = document.getElementById('newEmail');
    const passwordInput = document.getElementById('emailChangePassword');
    
    if (!newEmailInput.value || !passwordInput.value) {
        showNotification('Please fill in all fields', 'warning');
        return;
    }
    
    try {
        const apiBase = CONFIG.API_BASE_URL;
            
        const formData = new FormData();
        formData.append('new_email', newEmailInput.value);
        formData.append('password', passwordInput.value);
        
        const response = await fetch(`${apiBase}/users/me/email`, {
            method: 'PUT',
            headers: CONFIG.getAuthHeaders(),
            body: formData
        });
        
        if (response.ok) {
            showNotification('Email updated successfully!', 'success');
            document.getElementById('customProfileModal').remove();
            showProfileModal(); // Reload modal with updated data
        } else {
            const error = await response.json();
            showNotification(error.detail || 'Error updating email', 'error');
        }
    } catch (error) {
        showNotification('Error updating email', 'error');
    }
}

// Password Change Functions
async function showChangePasswordForm() {
    const passwordField = document.querySelector('#accountContent .modern-form-field:nth-child(3)');
    passwordField.innerHTML = `
        <label class="modern-form-label">Change Password</label>
        <div class="modern-form-field">
            ${createPasswordField('currentPassword', 'Current password', 'modern-form-input', 'current-password')}
        </div>
        <div class="modern-form-field">
            ${createPasswordField('newPassword', 'New password (min 8 characters)', 'modern-form-input', 'new-password')}
        </div>
        <div class="modern-form-field">
            ${createPasswordField('confirmPassword', 'Confirm new password', 'modern-form-input', 'new-password')}
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button onclick="cancelPasswordChange()" class="modern-btn modern-btn-outline">Cancel</button>
            <button onclick="changePassword()" class="modern-btn modern-btn-primary">Update Password</button>
        </div>
    `;
}

function cancelPasswordChange() {
    location.reload(); // Simple way to reset the modal
}

async function changePassword() {
    const currentInput = document.getElementById('currentPassword');
    const newInput = document.getElementById('newPassword');
    const confirmInput = document.getElementById('confirmPassword');
    
    if (!currentInput.value || !newInput.value || !confirmInput.value) {
        showNotification('Please fill in all fields', 'warning');
        return;
    }
    
    if (newInput.value !== confirmInput.value) {
        showNotification('New passwords do not match', 'warning');
        return;
    }
    
    if (newInput.value.length < 8) {
        showNotification('New password must be at least 8 characters long', 'warning');
        return;
    }
    
    try {
        const apiBase = CONFIG.API_BASE_URL;
            
        const response = await fetch(`${apiBase}/auth/password/change`, {
            method: 'POST',
            headers: {
                ...CONFIG.getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                old_password: currentInput.value,
                new_password: newInput.value
            })
        });
        
        if (response.ok) {
            showNotification('Password updated successfully!', 'success');
            document.getElementById('customProfileModal').remove();
        } else {
            const error = await response.json();
            showNotification(error.detail || 'Error updating password', 'error');
        }
    } catch (error) {
        showNotification('Error updating password', 'error');
    }
}

// Security Functions
async function logoutAllSessions() {
    if (!confirm('This will sign you out from all devices. Continue?')) return;
    
    try {
        const apiBase = CONFIG.API_BASE_URL;
            
        const response = await fetch(`${apiBase}/auth/logout-all`, {
            method: 'POST',
            headers: CONFIG.getAuthHeaders()
        });
        
        if (response.ok) {
            logout(); // Use existing logout function
        } else {
            showNotification('Error signing out from all devices', 'error');
        }
    } catch (error) {
        showNotification('Error signing out from all devices', 'error');
    }
}

// Subscription Functions

async function openBillingPortal() {
    try {
        const apiBase = CONFIG.API_BASE_URL;
            
        const response = await fetch(`${apiBase}/payment/customer-portal`, {
            method: 'POST',
            headers: CONFIG.getAuthHeaders()
        });
        
        if (response.ok) {
            const { url } = await response.json();
            window.open(url, '_blank');
        } else {
            showNotification('Error opening billing portal', 'error');
        }
    } catch (error) {
        showNotification('Error opening billing portal', 'error');
    }
}

// Legacy placeholders for compatibility
function showChangePasswordModal() { showChangePasswordForm(); }
function editProfile() { showProfileModal(); }

// Password field helper - creates consistent password input with toggle
function createPasswordField(inputId, placeholder, inputClass = 'modern-form-input', autocomplete = 'off') {
    return `
        <div class="password-input-wrapper">
            <input type="password" id="${inputId}" class="${inputClass}" placeholder="${placeholder}" autocomplete="${autocomplete}">
            <button type="button" class="password-toggle-btn" aria-label="Show password" onclick="togglePasswordVisibility('${inputId}', this)">
                <i class="fas fa-eye" aria-hidden="true"></i>
            </button>
        </div>
    `;
}

// Password visibility toggle with ARIA support
function togglePasswordVisibility(inputId, toggleBtn) {
    const input = document.getElementById(inputId);
    const icon = toggleBtn.querySelector('i');
    const isHidden = input.type === 'password';

    input.type = isHidden ? 'text' : 'password';
    icon.classList.replace(isHidden ? 'fa-eye' : 'fa-eye-slash', isHidden ? 'fa-eye-slash' : 'fa-eye');
    toggleBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
}

// Keep essential profile functions for modal interactions
window.showProfileModal = showProfileModal;
window.showCustomTab = showCustomTab;
window.showUpgradeModal = showUpgradeModal;
window.showStandaloneUpgradeModal = showStandaloneUpgradeModal;
window.togglePasswordVisibility = togglePasswordVisibility;

// ==========================================
// STRIPE CHECKOUT FUNCTIONS
// ==========================================

// Global payment form instance
let paymentForm = null;


/**
 * Initialize payment form with modular component
 */
function initializePaymentForm() {
    if (!paymentForm) {
        paymentForm = new PaymentForm(CONFIG.API_BASE_URL);
    }
}

/**
 * Handle upgrade button clicks using modular PaymentForm
 */
async function handleUpgrade(tierName) {
    if (!paymentForm) {
        initializePaymentForm();
    }

    try {
        await paymentForm.createCheckoutSession(tierName);
    } catch (error) {
        if (error.message === 'AUTHENTICATION_REQUIRED') {
            paymentForm.handleAuthenticationRequired();
        } else {
            console.error('Payment error:', error);
            // Use existing PhotoProcessor notification system
            if (window.photoProcessor) {
                window.photoProcessor.showError('Sorry, there was an error processing your request. Please try again.');
            } else {
                alert('Sorry, there was an error processing your request. Please try again.');
            }
        }
    }
}

/**
 * Handle successful payment return
 */
function handlePaymentSuccess() {
    // Get session ID from URL params or hash
    let sessionId = new URLSearchParams(window.location.search).get('session_id');
    
    // If not in search params, check hash
    if (!sessionId && window.location.hash.includes('session_id=')) {
        const hashParams = new URLSearchParams(window.location.hash.split('&').slice(1).join('&'));
        sessionId = hashParams.get('session_id');
    }
    
    if (sessionId) {
        // Show success message
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert alert-success alert-dismissible fade show';
        alertDiv.innerHTML = `
            <i class="fas fa-check-circle me-2"></i>
            <strong>Payment Successful!</strong> Your account has been upgraded. 
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        // Insert at the top of the app section
        const appSection = document.getElementById('app-section');
        if (appSection) {
            appSection.insertBefore(alertDiv, appSection.firstChild);
        }
        
        // Clear URL params
        window.history.replaceState({}, '', window.location.pathname);
        
        // Refresh user data to show new tier
        if (window.photoProcessor && window.photoProcessor.loadUserQuota) {
            window.photoProcessor.loadUserQuota();
        }
    }
}

/**
 * Handle cancelled payment return
 */
function handlePaymentCancelled() {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-info alert-dismissible fade show';
    alertDiv.innerHTML = `
        <i class="fas fa-info-circle me-2"></i>
        Payment was cancelled. You can try again anytime from the pricing page.
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // Insert at the top of the landing page
    const landingPage = document.getElementById('landing-page');
    if (landingPage) {
        landingPage.insertBefore(alertDiv, landingPage.firstChild);
    }
}

// Payment functions are now handled via event delegation
// Keeping for backwards compatibility only
window.handlePaymentSuccess = handlePaymentSuccess;
window.handlePaymentCancelled = handlePaymentCancelled;

// ==========================================
// SEAMLESS NAVBAR SCROLL BEHAVIOR
// ==========================================

/**
 * Initialize seamless navbar scroll behavior
 * Adds/removes 'scrolled' class based on scroll position
 */
function initializeSeamlessNavbar() {
    const navbar = document.querySelector('.seamless-navbar');
    if (!navbar) return;
    
    let isScrolled = false;
    const scrollThreshold = 100; // Pixels from top to trigger background change
    
    function handleScroll() {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        
        if (scrollTop > scrollThreshold && !isScrolled) {
            navbar.classList.add('scrolled');
            isScrolled = true;
        } else if (scrollTop <= scrollThreshold && isScrolled) {
            navbar.classList.remove('scrolled');
            isScrolled = false;
        }
    }
    
    // Throttle scroll events for better performance
    let ticking = false;
    function requestTick() {
        if (!ticking) {
            requestAnimationFrame(handleScroll);
            ticking = true;
            setTimeout(() => { ticking = false; }, 16); // ~60fps
        }
    }
    
    window.addEventListener('scroll', requestTick, { passive: true });
    
    // Check initial scroll position
    handleScroll();
}

// Navbar initialization handled internally


// ==========================================
// 4. APP INITIALIZATION (DOM LOADED)
// ==========================================
// Global Feedback Functions (accessible to all users)
// ==========================================

function showFeedbackModal() {
    // Track feedback modal open
    if (window.analyticsDashboard) {
        window.analyticsDashboard.trackEngagement('modal_open', 'feedback_modal');
    }
    
    // Reset form
    document.getElementById('feedbackForm').reset();
    document.getElementById('charCount').textContent = '0';
    
    // Auto-fill system information
    const systemInfo = getSystemInfo();
    document.getElementById('systemInfo').textContent = systemInfo;
    
    // Set up character counter
    const description = document.getElementById('feedbackDescription');
    const charCount = document.getElementById('charCount');
    description.addEventListener('input', function() {
        charCount.textContent = this.value.length;
    });
    
    // Set up form submission
    document.getElementById('submitFeedbackBtn').onclick = submitFeedback;
    
    const modal = new bootstrap.Modal(document.getElementById('feedbackModal'));
    modal.show();
}

function getSystemInfo() {
    const nav = navigator;
    const screen = window.screen;
    return `Browser: ${nav.userAgent} | Screen: ${screen.width}x${screen.height} | Language: ${nav.language} | Platform: ${nav.platform}`;
}

async function submitFeedback() {
    const form = document.getElementById('feedbackForm');
    const submitBtn = document.getElementById('submitFeedbackBtn');
    
    // Validate form
    if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return;
    }
    
    const feedbackData = {
        type: document.getElementById('feedbackType').value,
        title: document.getElementById('feedbackTitle').value.trim(),
        description: document.getElementById('feedbackDescription').value.trim(),
        email: document.getElementById('feedbackEmail').value.trim() || null,
        system_info: getSystemInfo()
    };
    
    try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Sending...';
        
        const response = await fetch(`${CONFIG.API_BASE_URL}/feedback/submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(feedbackData)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to submit feedback');
        }
        
        // Track successful feedback submission
        if (window.analyticsDashboard) {
            window.analyticsDashboard.trackEngagement('success_action', 'feedback_submitted', {
                feedback_type: feedbackData.type,
                feedback_category: feedbackData.type
            });
        }
        
        // Close modal and show success
        const modal = bootstrap.Modal.getInstance(document.getElementById('feedbackModal'));
        modal.hide();
        
        // Show success notification
        if (window.stateManager) {
            window.stateManager.addNotification('Thank you for your feedback! We appreciate your input and will review it soon.', 'success');
        } else {
            alert('Thank you for your feedback! We appreciate your input and will review it soon.');
        }
        
    } catch (error) {
        console.error('Feedback submission error:', error);
        
        // Show error notification
        if (window.stateManager) {
            window.stateManager.addNotification(`Failed to submit feedback: ${error.message}`, 'error');
        } else {
            alert(`Failed to submit feedback: ${error.message}`);
        }
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-paper-plane me-2"></i>Send Feedback';
    }
}

// Make functions globally accessible
window.showFeedbackModal = showFeedbackModal;
window.submitFeedback = submitFeedback;

// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Router FIRST (required by PhotoProcessor)
    const appRouter = new AppRouter();
    window.appRouter = appRouter;
    window.AppRouter = AppRouter;

    // 2. Initialize Classes with ES6 modules
    try {
        window.photoProcessor = new PhotoProcessor();

        // Initialize StateManager
        window.stateManager = new StateManager();

        // Initialize Landing Page Pricing after StateManager is ready
        await initLandingPagePricing();
    } catch (error) {
        console.error('Failed to initialize PhotoProcessor:', error);
        window.photoProcessor = {
            isAuthenticated: false,
            initializeApp: () => {}
        };
        
        // Still try to initialize pricing with fallback behavior
        try {
            await initLandingPagePricing();
        } catch (pricingError) {
            console.warn('Failed to initialize landing page pricing:', pricingError);
        }
    }

    // 3. Bind Auth Forms
    const signInForm = document.getElementById('signInForm');
    const createAccountForm = document.getElementById('createAccountForm');
    if (signInForm) signInForm.addEventListener('submit', handleSignIn);
    if (createAccountForm) createAccountForm.addEventListener('submit', handleCreateAccount);

    // 4. Handle payment result pages (both path and hash-based)
    const currentPath = window.location.pathname;
    const currentHash = window.location.hash;
    
    if (currentPath === '/payment/success' || currentHash.includes('payment-success')) {
        handlePaymentSuccess();
    } else if (currentPath === '/payment/cancelled' || currentHash.includes('payment-cancelled')) {
        handlePaymentCancelled();
    }

    // 5. Initialize seamless navbar scroll behavior
    initializeSeamlessNavbar();

    // 6. Initialize Payment Components
    initializePaymentForm();
    
    // 7. Add True Event Delegation for All Interactive Buttons
    document.addEventListener('click', (event) => {
        // Handle tier selection buttons (Basic/Pro/Trial)
        const tierButton = event.target.closest('.tier-choose-button');
        if (tierButton) {
            const tier = tierButton.dataset.tier;

            if (tier === 'Trial') {
                showCreateAccountModal();
            } else {
                handleUpgrade(tier);
            }
            return;
        }
        
        // Handle legacy upgrade buttons (if any remain)
        const upgradeButton = event.target.closest('[data-upgrade-btn]');
        if (upgradeButton) {
            const tier = upgradeButton.dataset.tier;
            if (tier) {
                handleUpgrade(tier);
            }
            return;
        }
        
        // Handle feedback navigation links
        const feedbackLink = event.target.closest('a[href="#feedback"]');
        if (feedbackLink) {
            event.preventDefault();
            showFeedbackModal();
            return;
        }
    });
    
    // 8. Add Event Delegation for Auth Buttons
    document.querySelectorAll('[data-signin-btn]').forEach(btn => {
        btn.addEventListener('click', showSignInModal);
    });
    
    document.querySelectorAll('[data-signup-btn]').forEach(btn => {
        btn.addEventListener('click', showCreateAccountModal);
    });
    
    document.querySelectorAll('[data-landing-btn]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.hash = 'home';  // Router handles showLandingPage + updateLandingPageForAuthState
        });
    });
    
    // 9. Initialize PhotoProcessor App Logic
    // Now that all dependencies are ready, initialize the app logic
    if (window.photoProcessor && typeof window.photoProcessor.initializeApp === 'function') {
        window.photoProcessor.initializeApp();
    }

    // 10. Check Auth & Handle Initial Route
    // We call this LAST to ensure PhotoProcessor is ready for the router
    if (typeof checkAuthOnLoad === 'function') {
        checkAuthOnLoad();
    }
    
    // Trigger initial route handling manually now that dependencies are ready
    if (window.appRouter) {
        window.appRouter.handleRouteChange();
    }
});