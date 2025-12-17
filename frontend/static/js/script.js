// TagSort - Main JavaScript

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
            console.log('Sign In form listener attached in modal'); // Debug log
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
            console.log('Create Account form listener attached in modal'); // Debug log
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
                console.log('StateManager auth state updated after login');
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
        // Check if already authenticated
        const token = localStorage.getItem('auth_token');
        if (token && window.photoProcessor) {
            // If authenticated, show upload by default
            window.location.hash = 'upload';
            return;
        }
        showLandingPage();
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

// Initialize router
const appRouter = new AppRouter();
window.appRouter = appRouter;

// Make critical functions globally accessible IMMEDIATELY for onclick handlers
// This ensures they work even if PhotoProcessor initialization fails later
window.showSignInModal = showSignInModal;
window.showCreateAccountModal = showCreateAccountModal;
window.switchToCreateAccount = switchToCreateAccount;
window.switchToSignIn = switchToSignIn;
window.showLandingPage = showLandingPage;
window.showAppSection = showAppSection;
window.logout = logout;

function logout() {
    // Clear auth token and show landing page
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_info');
    
    // Navigate to home
    window.location.hash = '';
    showLandingPage();

    // Reset any app state
    if (window.photoProcessor) {
        window.photoProcessor.isAuthenticated = false;
        window.photoProcessor.authToken = null;
    }
    
    // Clear StateManager auth state
    if (window.stateManager) {
        try {
            window.stateManager.set('auth.isAuthenticated', false);
            window.stateManager.set('auth.token', null);
            window.stateManager.set('auth.user', null);
            console.log('StateManager auth state cleared after logout');
        } catch (error) {
            console.error('Failed to clear StateManager auth state:', error);
        }
    }
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
        const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost';
        const apiBase = isDevelopment ? 
            `${window.location.protocol}//${window.location.hostname}:8000/api` : 
            `${window.location.protocol}//${window.location.host}/api`;
        
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
            
            localStorage.setItem('auth_token', result.token);
            localStorage.setItem('user_info', JSON.stringify(result.user));

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
                    console.log('Triggering delayed upgrade for tier:', pendingTier);
                    console.log('Current auth token:', localStorage.getItem('auth_token'));
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
        const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost';
        const apiBase = isDevelopment ? 
            `${window.location.protocol}//${window.location.hostname}:8000/api` : 
            `${window.location.protocol}//${window.location.host}/api`;
            
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
            
            localStorage.setItem('auth_token', result.token);
            localStorage.setItem('user_info', JSON.stringify(result.user));

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
                    console.log('Triggering delayed upgrade for tier:', pendingTier);
                    console.log('Current auth token:', localStorage.getItem('auth_token'));
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

function showNotification(message, type = 'info') {
    const alertClass = type === 'error' ? 'alert-danger' : type === 'success' ? 'alert-success' : 'alert-info';
    const iconClass = type === 'error' ? 'fa-exclamation-triangle' : type === 'success' ? 'fa-check-circle' : 'fa-info-circle';

    const notification = document.createElement('div');
    notification.className = `alert ${alertClass} alert-dismissible fade show position-fixed`;
    notification.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    notification.innerHTML = `
        <i class="fas ${iconClass} me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    document.body.appendChild(notification);
    setTimeout(() => {
        if (notification.parentNode) notification.remove();
    }, 4000);
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
    
    // Create new modal structure
    const modalBackdrop = document.createElement('div');
    modalBackdrop.id = 'customProfileModal';
    modalBackdrop.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background-color: rgba(0, 0, 0, 0.5); z-index: 9999;
        display: flex; align-items: center; justify-content: center;
    `;
    
    const modalDialog = document.createElement('div');
    modalDialog.style.cssText = `
        background-color: white; border-radius: 12px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
        width: 420px; max-width: 95vw; max-height: 85vh;
        overflow: auto; position: relative;
    `;
    
    // Loading State HTML
    modalDialog.innerHTML = `
        <div style="padding: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #dee2e6; padding-bottom: 15px;">
                <h4 style="margin: 0; color: #333;">Profile</h4>
                <button id="customModalClose" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">&times;</button>
            </div>
            <div id="customModalContent">
                <div style="text-align: center; padding: 40px;">
                    <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #007bff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <p style="margin-top: 15px; color: #666;">Loading profile data...</p>
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
    } catch (error) {
        console.error('Error loading profile:', error);
        const contentDiv = document.getElementById('customModalContent');
        if (contentDiv) {
            contentDiv.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #dc3545;">
                    <h5>Error Loading Profile</h5>
                    <p>Unable to load profile data.</p>
                    <button onclick="this.closest('#customProfileModal').remove()" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
                </div>
            `;
        }
    }
}

async function loadCustomProfileData() {
    const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost';
    const apiBase = isDevelopment ? 
        `${window.location.protocol}//${window.location.hostname}:8000/api` : 
        `${window.location.protocol}//${window.location.host}/api`;
        
    const headers = { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` };

    const [quotaResponse, statsResponse, timelineResponse] = await Promise.all([
        fetch(`${apiBase}/users/me/quota`, { headers }),
        fetch(`${apiBase}/users/me/stats`, { headers }),
        fetch(`${apiBase}/users/me/timeline?days=7`, { headers })
    ]);

    if (!quotaResponse.ok || !statsResponse.ok || !timelineResponse.ok) {
        throw new Error('Failed to load profile data');
    }

    updateCustomModalContent(
        await quotaResponse.json(),
        await statsResponse.json(),
        await timelineResponse.json()
    );
}

function updateCustomModalContent(quotaData, statsData, timelineData) {
    const contentDiv = document.getElementById('customModalContent');
    if (!contentDiv) return;
    
    const { user, stats } = statsData;
    const { quota } = quotaData;
    const { timeline } = timelineData;
    
    contentDiv.innerHTML = `
        <div style="font-family: system-ui, -apple-system, sans-serif;">
            <div style="display: flex; border-bottom: 1px solid #dee2e6; margin-bottom: 20px;">
                <button onclick="showCustomTab('quota')" id="quotaTab" style="padding: 10px 20px; border: none; background: none; border-bottom: 2px solid #007bff; color: #007bff; cursor: pointer; font-weight: 500;">Quota</button>
                <button onclick="showCustomTab('account')" id="accountTab" style="padding: 10px 20px; border: none; background: none; border-bottom: 2px solid transparent; color: #666; cursor: pointer;">Account</button>
                <button onclick="showCustomTab('activity')" id="activityTab" style="padding: 10px 20px; border: none; background: none; border-bottom: 2px solid transparent; color: #666; cursor: pointer;">Activity</button>
            </div>
            
            <div id="quotaContent">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                    <h5 style="margin: 0 0 10px 0;">Monthly Photo Quota</h5>
                    <div style="font-size: 32px; font-weight: bold; margin-bottom: 5px;">${quota.photos_used_this_month}/${quota.monthly_photo_limit}</div>
                    <div style="background: rgba(255,255,255,0.3); border-radius: 10px; height: 8px; margin-bottom: 10px;">
                        <div style="background: ${quota.photos_used_this_month >= quota.monthly_photo_limit ? '#ff6b6b' : '#4ecdc4'}; height: 8px; border-radius: 10px; width: ${Math.min(100, (quota.photos_used_this_month / quota.monthly_photo_limit) * 100)}%;"></div>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div style="background: #f8f9fa; padding: 15px; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #28a745;">${stats.total_photos_uploaded || 0}</div>
                        <div style="color: #666; font-size: 14px;">Total Uploads</div>
                    </div>
                    <div style="background: #f8f9fa; padding: 15px; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #17a2b8;">${stats.total_processing_jobs || 0}</div>
                        <div style="color: #666; font-size: 14px;">Jobs Processed</div>
                    </div>
                </div>
            </div>
            
            <div id="accountContent" style="display: none;">
                <div style="margin-bottom: 15px;">
                    <label style="display: block; font-weight: 500; margin-bottom: 5px;">Email</label>
                    <input type="email" value="${user.email}" readonly style="width: 100%; padding: 8px; background: #f8f9fa; border: 1px solid #ddd;">
                </div>
                <div style="margin-bottom: 15px;">
                    <label style="display: block; font-weight: 500; margin-bottom: 5px;">Full Name</label>
                    <input type="text" id="customFullName" value="${user.full_name || ''}" style="width: 100%; padding: 8px; border: 1px solid #ddd;">
                </div>
                <div style="text-align: right;">
                    <button onclick="updateCustomProfile()" style="padding: 8px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Save</button>
                </div>
            </div>
            
            <div id="activityContent" style="display: none;">
                ${timeline.length > 0 ? `
                    <div style="max-height: 300px; overflow-y: auto;">
                        ${timeline.map(item => `
                            <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee;">
                                <div><div style="font-weight: 500;">${item.action_display}</div><div style="font-size: 12px; color: #666;">${new Date(item.created_at).toLocaleString()}</div></div>
                                <div>${item.success ? '✓' : '✗'}</div>
                            </div>
                        `).join('')}
                    </div>
                ` : '<div style="text-align: center; padding: 20px;">No recent activity.</div>'}
            </div>
        </div>
    `;
}

function showCustomTab(tabName) {
    ['quota', 'account', 'activity'].forEach(name => {
        const content = document.getElementById(name + 'Content');
        const tab = document.getElementById(name + 'Tab');
        if (content) content.style.display = name === tabName ? 'block' : 'none';
        if (tab) {
            tab.style.borderBottomColor = name === tabName ? '#007bff' : 'transparent';
            tab.style.color = name === tabName ? '#007bff' : '#666';
        }
    });
}

async function updateCustomProfile() {
    const fullNameInput = document.getElementById('customFullName');
    if (!fullNameInput) return;
    
    try {
        const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost';
        const apiBase = isDevelopment ? 
            `${window.location.protocol}//${window.location.hostname}:8000/api` : 
            `${window.location.protocol}//${window.location.host}/api`;
            
        const response = await fetch(`${apiBase}/users/me/profile`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ full_name: fullNameInput.value })
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
        alert('Error updating profile');
    }
}

// ==========================================
// 3. GLOBAL ASSIGNMENTS & PLACEHOLDERS
// ==========================================

// Helper Placeholders
function showChangePasswordModal() { alert('Coming soon!'); }
function editProfile() { alert('Coming soon!'); }

// Expose to window for HTML onClick events
window.showProfileModal = showProfileModal;
window.showCustomTab = showCustomTab;
window.updateCustomProfile = updateCustomProfile;
window.showChangePasswordModal = showChangePasswordModal;
window.editProfile = editProfile;
if (typeof logout !== 'undefined') window.logout = logout;

// ==========================================
// STRIPE CHECKOUT FUNCTIONS
// ==========================================

/**
 * Handle upgrade button clicks
 */
async function handleUpgrade(tierName) {
    // Check if user is authenticated
    const token = localStorage.getItem('auth_token');
    if (!token) {
        // Store the intended action for after login
        localStorage.setItem('pending_action', 'upgrade');
        localStorage.setItem('pending_tier', tierName);
        showSignInModal();
        return;
    }

    console.log('Starting upgrade for tier:', tierName);
    console.log('Using token:', token ? 'Token present' : 'No token');

    try {
        // Use the correct API base URL
        const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost';
        const apiBase = isDevelopment ? 
            `${window.location.protocol}//${window.location.hostname}:8000/api` : 
            `${window.location.protocol}//${window.location.host}/api`;

        const response = await fetch(`${apiBase}/payment/create-checkout-session`, {
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
            console.error('Server response:', response.status, errorData);
            throw new Error(`Failed to create checkout session: ${errorData.detail || response.statusText}`);
        }

        const { sessionUrl } = await response.json();
        
        // Redirect to Stripe Checkout
        window.location.href = sessionUrl;
        
    } catch (error) {
        console.error('Checkout error:', error);
        alert('Sorry, there was an error processing your request. Please try again.');
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

// Make functions globally available
window.handleUpgrade = handleUpgrade;
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

// Make function globally available
window.initializeSeamlessNavbar = initializeSeamlessNavbar;


// ==========================================
// 4. APP INITIALIZATION (DOM LOADED)
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded');

    // 1. Initialize PhotoProcessor Class
    try {
        if (typeof PhotoProcessor !== 'undefined') {
            window.photoProcessor = new PhotoProcessor();
            console.log('PhotoProcessor initialized successfully');
        } else {
            console.error('PhotoProcessor class not found! Check script load order.');
        }
    } catch (error) {
        console.error('Failed to initialize PhotoProcessor:', error);
        window.photoProcessor = {
            isAuthenticated: false,
            initializeApp: () => console.log('PhotoProcessor init failed')
        };
    }

    // 2. Initialize Pricing (if available)
    if (typeof PricingPage !== 'undefined') {
        const pricingPageApp = new PricingPage('app-container', 'Trial');
        pricingPageApp.render();
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

    // 6. Check Auth & Handle Initial Route
    // We call this LAST to ensure PhotoProcessor is ready for the router
    if (typeof checkAuthOnLoad === 'function') {
        checkAuthOnLoad();
    }
    
    // Trigger initial route handling manually now that dependencies are ready
    if (window.appRouter) {
        window.appRouter.handleRouteChange();
    }
});