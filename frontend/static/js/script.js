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
            // Skip validation after fresh login - just show the upload section
            window.photoProcessor.showUploadSection();
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
            'app': this.showApp.bind(this)
        };
        
        // Listen for hash changes
        window.addEventListener('hashchange', () => this.handleRouteChange());
        
        // Handle initial route
        window.addEventListener('DOMContentLoaded', () => this.handleRouteChange());
    }
    
    handleRouteChange() {
        const hash = window.location.hash.slice(1); // Remove #
        const route = hash.toLowerCase();
        
        // Check if user is authenticated for protected routes
        const token = localStorage.getItem('auth_token');
        const protectedRoutes = ['analytics', 'app'];
        
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
            // Default to app if authenticated
            this.showApp();
        } else {
            // Default to home if not authenticated
            this.showHome();
        }
    }
    
    showHome() {
        // Check if already authenticated
        const token = localStorage.getItem('auth_token');
        if (token && window.photoProcessor) {
            // If authenticated, show app instead
            window.location.hash = 'app';
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
        showAppSection();
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

// Handle authentication form submissions
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

    // Basic validation
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
        // Call real authentication API
        const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost';
        const apiBase = isDevelopment ? 
            `${window.location.protocol}//${window.location.hostname}:8000/api` : 
            `${window.location.protocol}//${window.location.host}/api`;
        
        const response = await fetch(`${apiBase}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email,
                password: password
            })
        });

        const result = await response.json();

        if (response.ok) {
            // Track successful login
            if (window.analyticsDashboard) {
                window.analyticsDashboard.trackEngagement('success_action', 'login_success', {
                    user_id: result.user?.id,
                    login_method: 'email'
                });
            }
            
            // Store auth token
            localStorage.setItem('auth_token', result.token);
            
            // Store user info
            localStorage.setItem('user_info', JSON.stringify(result.user));

            // Hide modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('signInModal'));
            modal.hide();

            // Clear form
            form.reset();

            // Navigate to app
            window.location.hash = 'app';
            showAppSection();

            showNotification(result.message || 'Welcome back!', 'success');
        } else {
            showNotification(result.detail || 'Login failed. Please check your credentials.', 'error');
        }
    } catch (error) {
        console.error('Login error:', error);
        showNotification('Network error. Please check your connection and try again.', 'error');
    } finally {
        // Restore button
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

    // Validation
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

    // Show loading state
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Creating Account...';

    try {
        // Call real registration API
        const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost';
        const apiBase = isDevelopment ? 
            `${window.location.protocol}//${window.location.hostname}:8000/api` : 
            `${window.location.protocol}//${window.location.host}/api`;
            
        const response = await fetch(`${apiBase}/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email,
                password: password,
                full_name: name,
                confirm_password: password
            })
        });

        const result = await response.json();

        if (response.ok) {
            // Track successful account creation
            if (window.analyticsDashboard) {
                window.analyticsDashboard.trackEngagement('success_action', 'account_created', {
                    user_id: result.user?.id,
                    signup_method: 'email'
                });
            }
            
            // Store auth token
            localStorage.setItem('auth_token', result.token);
            
            // Store user info
            localStorage.setItem('user_info', JSON.stringify(result.user));

            // Hide modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('createAccountModal'));
            modal.hide();

            // Clear form
            form.reset();

            // Navigate to app
            window.location.hash = 'app';
            showAppSection();

            showNotification(result.message || 'Account created successfully!', 'success');
        } else {
            showNotification(result.detail || 'Failed to create account. Please try again.', 'error');
        }
    } catch (error) {
        console.error('Registration error:', error);
        showNotification('Network error. Please check your connection and try again.', 'error');
    } finally {
        // Restore button
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

    // Auto-remove after 4 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 4000);
}

// Check authentication status on page load
function checkAuthOnLoad() {
    const token = localStorage.getItem('auth_token');
    if (token) {
        // User is authenticated, show app section
        showAppSection();
    } else {
        // User is not authenticated, show landing page
        showLandingPage();
    }
}

class PhotoProcessor {
    constructor() {
        // In development, frontend runs on 5173 and backend on 8000
        // In production, both will be served from the same domain
        const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost';
        if (isDevelopment) {
            this.apiBase = window.location.protocol + '//' + window.location.hostname + ':8000/api';
        } else {
            // Production deployment will serve everything from the same port
            this.apiBase = window.location.protocol + '//' + window.location.host + '/api';
        }
        this.selectedFiles = [];
        this.currentJobId = null;
        this.groupedPhotos = [];
        this.filteredGroups = [];
        this.selectedGroups = [];
        this.modalSelectedFiles = []; // For upload more modal
        this.currentFilter = 'all';
        this.currentSort = 'bib-asc';
        this.searchTerm = '';
        this.confidenceFilter = 0;
        this.photoCountFilter = 1;
        
        // Processing state for warnings
        this.isActivelyProcessing = false;
        this.beforeUnloadHandler = null;
        
        // Initialize authentication from localStorage
        const storedToken = localStorage.getItem('auth_token');
        this.authToken = storedToken || null;
        this.isAuthenticated = !!storedToken;
        this.isEditMode = false; // For inline labeling
        this.zoomLevel = 1;
        this.panX = 0;
        this.panY = 0;
        this.currentLightboxGroup = null;
        this.currentPhotoIndex = 0;

        this.initializeEventListeners();
        this.initializeSearchAndFilters();

        // Initialize authentication and UI
        this.initializeApp();
    }

    // Authentication Methods
    async checkAuthStatus() {
        const token = localStorage.getItem('auth_token');
        if (!token) {
            this.showLoginScreen();
            return false;
        }

        // First, assume the token is valid if it exists (optimistic approach)
        this.isAuthenticated = true;
        this.authToken = token;
        
        // Update StateManager auth state immediately
        if (window.stateManager) {
            const userInfo = localStorage.getItem('user_info');
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
        
        showAppSection();
        
        // Then validate in the background (non-blocking)
        try {
            const response = await fetch(`${this.apiBase}/auth/validate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                if (data.valid) {
                    // Token is valid, update user info if available
                    if (data.user) {
                        localStorage.setItem('user_info', JSON.stringify(data.user));
                        if (window.stateManager) {
                            window.stateManager.set('auth.user', data.user);
                        }
                    }
                    
                    // Check for recent completed jobs and restore if found
                    await this.checkAndRestoreRecentJob();
                    
                    return true;
                }
            }
            
            // Only clear auth if we got a definitive rejection (401/403)
            if (response.status === 401 || response.status === 403) {
                console.warn('Token validation failed, logging out');
                localStorage.removeItem('auth_token');
                localStorage.removeItem('user_info');
                this.isAuthenticated = false;
                this.authToken = null;
                
                // Clear StateManager auth state
                if (window.stateManager) {
                    window.stateManager.set('auth.isAuthenticated', false);
                    window.stateManager.set('auth.token', null);
                    window.stateManager.set('auth.user', null);
                }
                
                this.showLoginScreen();
                return false;
            }
        } catch (error) {
            // Network error or server down - keep user logged in
            console.warn('Auth validation failed (network error), keeping user logged in:', error);
        }
        
        return true;
    }

    showLoginScreen() {
        // Make sure we're on the landing page, not showing API response
        showLandingPage();
    }

    showProcessingWarning() {
        // Add warning banner if not already present
        let warningBanner = document.getElementById('processing-warning-banner');
        if (!warningBanner) {
            warningBanner = document.createElement('div');
            warningBanner.id = 'processing-warning-banner';
            warningBanner.className = 'alert alert-warning alert-dismissible d-flex align-items-center position-fixed';
            warningBanner.style.cssText = 'top: 80px; left: 50%; transform: translateX(-50%); z-index: 1060; max-width: 600px;';
            warningBanner.innerHTML = `
                <i class="fas fa-exclamation-triangle me-2"></i>
                <div>
                    <strong>Processing in Progress</strong><br>
                    Don't close or reload this page! Your photos are being processed.
                </div>
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            `;
            document.body.appendChild(warningBanner);
        }
        
        // Add beforeunload warning
        this.beforeUnloadHandler = (e) => {
            if (this.isActivelyProcessing) {
                const message = 'Photo processing is still in progress. Leaving now will lose your work.';
                e.preventDefault();
                e.returnValue = message;
                return message;
            }
        };
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
        
        this.isActivelyProcessing = true;
        console.log('Processing warning activated');
    }

    hideProcessingWarning() {
        // Remove warning banner
        const warningBanner = document.getElementById('processing-warning-banner');
        if (warningBanner) {
            warningBanner.remove();
        }
        
        // Remove beforeunload warning
        if (this.beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this.beforeUnloadHandler);
            this.beforeUnloadHandler = null;
        }
        
        this.isActivelyProcessing = false;
        console.log('Processing warning deactivated');
    }

    async checkAndRestoreRecentJob() {
        try {
            // Check if StateManager has a recent completed job
            if (!window.stateManager || !window.stateManager.hasRecentCompletedJob()) {
                console.log('No recent completed job found in localStorage');
                return;
            }

            const lastJobId = window.stateManager.get('processing.lastCompletedJobId');
            const lastCompleted = window.stateManager.get('processing.lastCompletedAt');
            
            console.log(`Found recent completed job: ${lastJobId} completed at ${lastCompleted}`);
            
            // Fetch the job results from the server
            const response = await fetch(`${this.apiBase}/process/results/${lastJobId}`, {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (response.ok) {
                const results = await response.json();
                console.log('Successfully restored job results:', results);
                
                // Update current state
                this.currentJobId = lastJobId;
                window.stateManager.set('processing.currentJobId', lastJobId);
                window.stateManager.set('photos.groupedPhotos', results.groups || []);
                
                // Show results section instead of upload section
                this.groupedPhotos = results.groups || [];
                this.showResultsSection();
                
                // Show restoration notification
                showNotification(`Restored your previous session (${results.groups?.length || 0} photo groups)`, 'info');
                
            } else {
                console.warn('Failed to restore job results, clearing saved state');
                window.stateManager.clearCompletedJob();
            }
            
        } catch (error) {
            console.error('Error restoring recent job:', error);
            // Clear invalid state
            if (window.stateManager) {
                window.stateManager.clearCompletedJob();
            }
        }
    }

    showMainContent() {
        document.getElementById('login-section').classList.add('d-none');
        document.getElementById('main-content').classList.remove('d-none');
        
        // Load user quota when showing main content
        this.loadUserQuota();
    }

    initializeLoginForm() {
        const loginForm = document.getElementById('loginForm');
        if (loginForm && !loginForm.hasEventListener) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
            loginForm.hasEventListener = true;
        }
    }

    async handleLogin(e) {
        e.preventDefault();

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const submitBtn = e.target.querySelector('button[type="submit"]');

        // Show loading state
        const originalText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Signing In...';

        try {
            const response = await fetch(`${this.apiBase}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
            });

            if (response.ok) {
                const result = await response.json();
                localStorage.setItem('auth_token', result.token);
                this.authToken = result.token;
                this.isAuthenticated = true;
                this.showMainContent();
                this.showSuccess(result.message);
            } else {
                const error = await response.json();
                this.showError(error.detail || 'Login failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showError('Login failed. Please try again.');
        } finally {
            // Restore button state
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    }

    async initializeApp() {
        // Prevent multiple initialization calls
        if (this.initializationInProgress) {
            return;
        }
        this.initializationInProgress = true;
        
        try {
            // Check if we have a stored token
            const token = localStorage.getItem('auth_token');
            
            if (token) {
                this.authToken = token;
                
                const isValid = await this.checkAuthStatus();
                if (!isValid) {
                    this.showLoginScreen();
                } else {
                    // Update StateManager auth state if it exists
                    try {
                        if (window.stateManager && window.stateManager.state && window.stateManager.state.auth) {
                            window.stateManager.state.auth.isAuthenticated = true;
                            window.stateManager.state.auth.token = token;
                        }
                    } catch (error) {
                        console.log('StateManager not available or not properly initialized:', error);
                    }
                }
            } else {
                this.showLoginScreen();
            }
        } finally {
            this.initializationInProgress = false;
        }
    }

    async logout() {
        try {
            // Call backend logout if we have a token
            if (this.authToken) {
                await fetch(`${this.apiBase}/auth/logout`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.authToken}`
                    },
                    credentials: 'include'
                });
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            // Always clear local session regardless of backend response
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user_info');
            this.authToken = null;
            this.isAuthenticated = false;
            this.resetApp();
            this.showLoginScreen();
            this.showSuccess('Successfully logged out!');
        }
    }

    initializeEventListeners() {
        // File upload events
        const uploadArea = document.getElementById('upload-area');
        const fileInput = document.getElementById('file-input');
        const folderInput = document.getElementById('folder-input');
        const uploadBtn = document.getElementById('upload-btn');
        const chooseFilesBtn = document.getElementById('choose-files-btn');
        const chooseFolderBtn = document.getElementById('choose-folder-btn');

        // Drag and drop events
        uploadArea.addEventListener('click', (e) => {
            if (e.target === uploadArea || e.target.closest('.upload-content')) {
                // Only trigger file input if clicking the upload area itself, not buttons
                if (!e.target.closest('button')) {
                    fileInput.click();
                }
            }
        });
        uploadArea.addEventListener('dragover', this.handleDragOver.bind(this));
        uploadArea.addEventListener('dragleave', this.handleDragLeave.bind(this));
        uploadArea.addEventListener('drop', this.handleDrop.bind(this));

        // Button events
        chooseFilesBtn.addEventListener('click', () => fileInput.click());
        chooseFolderBtn.addEventListener('click', () => folderInput.click());

        // File input change events
        fileInput.addEventListener('change', async (e) => await this.handleFileSelect(e.target.files, false));
        folderInput.addEventListener('change', async (e) => await this.handleFileSelect(e.target.files, true));

        // Upload button
        uploadBtn.addEventListener('click', this.uploadFiles.bind(this));

        // Clear files and add more buttons
        document.getElementById('clear-files-btn').addEventListener('click', this.clearAllFiles.bind(this));
        document.getElementById('add-more-btn').addEventListener('click', () => fileInput.click());

        // Reset button
        document.getElementById('reset-btn').addEventListener('click', this.resetApp.bind(this));

        // Upload more button (only available in results section)
        document.addEventListener('click', (e) => {
            if (e.target.id === 'upload-more-btn') {
                this.showUploadMoreModal();
            }
        });

        // Modal event listeners
        this.initializeModalEventListeners();

        // Download All button (simplified)
        document.getElementById('download-all-btn').addEventListener('click', this.downloadAllPhotos.bind(this));

        // Simplified - no bulk selection needed
    }

    initializeBulkSelection() {
        document.getElementById('selectAllGroups').addEventListener('change', (e) => {
            if (e.target.checked) {
                this.selectAllGroups();
            } else {
                this.selectNone();
            }
        });

        document.getElementById('selectDetectedBtn').addEventListener('click', () => {
            this.selectDetectedGroups();
        });

        document.getElementById('selectUnknownBtn').addEventListener('click', () => {
            this.selectUnknownGroups();
        });

        document.getElementById('selectNoneBtn').addEventListener('click', () => {
            this.selectNone();
        });

        // Export options change handlers
        document.getElementById('exportFormat').addEventListener('change', () => {
            this.updateExportPreview();
        });

        document.getElementById('filenamePattern').addEventListener('change', () => {
            this.updateExportPreview();
        });
    }

    selectAllGroups() {
        const groupsToShow = this.filteredGroups.length > 0 ? this.filteredGroups : this.groupedPhotos;
        this.selectedGroups = groupsToShow.map(group => group.bib_number);
        this.updateSelectionUI();
        this.updateExportPreview();
    }

    selectDetectedGroups() {
        const groupsToShow = this.filteredGroups.length > 0 ? this.filteredGroups : this.groupedPhotos;
        this.selectedGroups = groupsToShow
            .filter(group => group.bib_number !== 'unknown')
            .map(group => group.bib_number);
        this.updateSelectionUI();
        this.updateExportPreview();
    }

    selectUnknownGroups() {
        const groupsToShow = this.filteredGroups.length > 0 ? this.filteredGroups : this.groupedPhotos;
        this.selectedGroups = groupsToShow
            .filter(group => group.bib_number === 'unknown')
            .map(group => group.bib_number);
        this.updateSelectionUI();
        this.updateExportPreview();
    }

    selectNone() {
        this.selectedGroups = [];
        document.getElementById('selectAllGroups').checked = false;
        this.updateSelectionUI();
        this.updateExportPreview();
    }

    updateSelectionUI() {
        // Update checkboxes in export groups
        document.querySelectorAll('.export-checkbox input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = this.selectedGroups.includes(checkbox.value);
            const label = checkbox.closest('.export-checkbox');
            if (checkbox.checked) {
                label.classList.add('selected');
            } else {
                label.classList.remove('selected');
            }
        });

        // Update selection count
        const count = this.selectedGroups.length;
        document.getElementById('selectionCount').textContent = `${count} group${count !== 1 ? 's' : ''} selected`;
        document.getElementById('exportBtnCount').textContent = count;

        // Update select all checkbox
        const groupsToShow = this.filteredGroups.length > 0 ? this.filteredGroups : this.groupedPhotos;
        const allSelected = groupsToShow.length > 0 && this.selectedGroups.length === groupsToShow.length;
        document.getElementById('selectAllGroups').checked = allSelected;

        // Enable/disable export button
        document.getElementById('export-btn').disabled = this.selectedGroups.length === 0;
    }

    updateExportPreview() {
        const selectedGroupData = this.groupedPhotos.filter(group => 
            this.selectedGroups.includes(group.bib_number)
        );

        const exportPreview = document.getElementById('exportPreview');
        const exportPreviewList = document.getElementById('exportPreviewList');
        const exportPhotoCount = document.getElementById('exportPhotoCount');

        if (selectedGroupData.length === 0) {
            exportPreview.style.display = 'none';
            return;
        }

        exportPreview.style.display = 'block';

        const totalPhotos = selectedGroupData.reduce((sum, group) => sum + group.count, 0);
        exportPhotoCount.textContent = totalPhotos;

        exportPreviewList.innerHTML = selectedGroupData.map(group => `
            <div class="d-flex justify-content-between align-items-center mb-1">
                <small class="text-muted">
                    ${group.bib_number === 'unknown' ? 'Unknown' : `Bib #${group.bib_number}`}
                </small>
                <small class="badge bg-secondary">${group.count}</small>
            </div>
        `).join('');
    }

    initializeSearchAndFilters() {
        // Search input - only initialize if elements exist
        const searchInput = document.getElementById('searchBib');
        const clearSearchBtn = document.getElementById('clearSearchBtn');
        const searchSuggestions = document.getElementById('searchSuggestions');

        if (searchInput && clearSearchBtn && searchSuggestions) {
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value.toLowerCase();
                this.showSearchSuggestions();
                this.applyFilters();
            });

            searchInput.addEventListener('focus', () => {
                if (this.searchTerm === '') {
                    this.showSearchSuggestions();
                }
            });

            searchInput.addEventListener('blur', () => {
                // Delay hiding suggestions to allow clicking
                setTimeout(() => {
                    searchSuggestions.classList.remove('show');
                }, 150);
            });

            clearSearchBtn.addEventListener('click', () => {
                searchInput.value = '';
                this.searchTerm = '';
                this.applyFilters();
                searchSuggestions.classList.remove('show');
            });
        }

        // Filter buttons - only initialize if they exist
        const filterAll = document.getElementById('filterAll');
        const filterDetected = document.getElementById('filterDetected');
        const filterUnknown = document.getElementById('filterUnknown');

        if (filterAll) filterAll.addEventListener('click', () => this.setFilter('all'));
        if (filterDetected) filterDetected.addEventListener('click', () => this.setFilter('detected'));
        if (filterUnknown) filterUnknown.addEventListener('click', () => this.setFilter('unknown'));

        // Sort dropdown
        document.querySelectorAll('[data-sort]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.setSort(e.target.dataset.sort);
            });
        });

        // Advanced filters - only initialize if elements exist
        const showAdvancedBtn = document.getElementById('showAdvancedFilters');
        const hideAdvancedBtn = document.getElementById('toggleAdvancedFilters');
        const advancedFilters = document.getElementById('advancedFilters');

        if (showAdvancedBtn && hideAdvancedBtn && advancedFilters) {
            showAdvancedBtn.addEventListener('click', () => {
                advancedFilters.style.display = 'block';
                showAdvancedBtn.style.display = 'none';
            });

            hideAdvancedBtn.addEventListener('click', () => {
                advancedFilters.style.display = 'none';
                showAdvancedBtn.style.display = 'block';
            });
        }

        // Range sliders - only initialize if elements exist
        const confidenceRange = document.getElementById('confidenceRange');
        const photoCountRange = document.getElementById('photoCountRange');
        const confidenceValue = document.getElementById('confidenceValue');
        const photoCountValue = document.getElementById('photoCountValue');

        if (confidenceRange && confidenceValue) {
            confidenceRange.addEventListener('input', (e) => {
                this.confidenceFilter = parseInt(e.target.value);
                confidenceValue.textContent = `${this.confidenceFilter}%+`;
                this.applyFilters();
            });
        }

        if (photoCountRange && photoCountValue) {
            photoCountRange.addEventListener('input', (e) => {
                this.photoCountFilter = parseInt(e.target.value);
                photoCountValue.textContent = `${this.photoCountFilter}+`;
                this.applyFilters();
            });
        }
    }

    showSearchSuggestions() {
        const searchSuggestions = document.getElementById('searchSuggestions');
        if (!searchSuggestions) return; // Exit if element doesn't exist

        const bibNumbers = this.groupedPhotos
            .map(group => group.bib_number)
            .filter(bib => bib !== 'unknown')
            .filter(bib => this.searchTerm === '' || bib.toLowerCase().includes(this.searchTerm))
            .slice(0, 8);

        if (bibNumbers.length === 0 && this.searchTerm === '') {
            searchSuggestions.classList.remove('show');
            return;
        }

        searchSuggestions.innerHTML = bibNumbers.map(bib => `
            <div class="suggestion-item" onclick="photoProcessor.selectSuggestion('${bib}')">
                Bib #${bib}
            </div>
        `).join('');

        if (bibNumbers.length > 0) {
            searchSuggestions.classList.add('show');
        } else {
            searchSuggestions.classList.remove('show');
        }
    }

    selectSuggestion(bibNumber) {
        const searchInput = document.getElementById('searchBib');
        const searchSuggestions = document.getElementById('searchSuggestions');

        if (searchInput) {
            searchInput.value = bibNumber;
            this.searchTerm = bibNumber.toLowerCase();
            this.applyFilters();
        }

        if (searchSuggestions) {
            searchSuggestions.classList.remove('show');
        }
    }

    setFilter(filter) {
        // Update button states
        document.querySelectorAll('.filter-btn').forEach(btn => {
            if (btn.id === `filter${filter.charAt(0).toUpperCase() + filter.slice(1)}` || 
                (filter === 'all' && btn.id === 'filterAll')) {
                btn.classList.add('active');
                btn.classList.remove('btn-outline-primary', 'btn-outline-success', 'btn-outline-warning');
                if (filter === 'all') btn.classList.add('btn-primary');
                else if (filter === 'detected') btn.classList.add('btn-success');
                else if (filter === 'unknown') btn.classList.add('btn-warning');
            } else {
                btn.classList.remove('active', 'btn-primary', 'btn-success', 'btn-warning');
                if (btn.id === 'filterAll') btn.classList.add('btn-outline-primary');
                else if (btn.id === 'filterDetected') btn.classList.add('btn-outline-success');
                else if (btn.id === 'filterUnknown') btn.classList.add('btn-outline-warning');
            }
        });

        this.currentFilter = filter;
        this.applyFilters();
    }

    setSort(sortType) {
        this.currentSort = sortType;
        this.applyFilters();

        // Update dropdown button text
        const sortLabels = {
            'bib-asc': 'Bib A-Z',
            'bib-desc': 'Bib Z-A',
            'count-desc': 'Most Photos',
            'count-asc': 'Least Photos',
            'confidence-desc': 'High Confidence',
            'confidence-asc': 'Low Confidence'
        };

        document.getElementById('sortDropdown').innerHTML = `
            <i class="fas fa-sort me-1"></i>${sortLabels[sortType]}
        `;
    }

    applyFilters() {
        if (!this.groupedPhotos || this.groupedPhotos.length === 0) {
            this.filteredGroups = [];
            this.updateResultsCount(0);
            return;
        }

        let filtered = [...this.groupedPhotos];

        // Apply search filter
        if (this.searchTerm) {
            filtered = filtered.filter(group => 
                group.bib_number.toLowerCase().includes(this.searchTerm)
            );
        }

        // Apply category filter
        if (this.currentFilter !== 'all') {
            if (this.currentFilter === 'detected') {
                filtered = filtered.filter(group => group.bib_number !== 'unknown');
            } else if (this.currentFilter === 'unknown') {
                filtered = filtered.filter(group => group.bib_number === 'unknown');
            }
        }

        // Apply confidence filter
        if (this.confidenceFilter > 0) {
            filtered = filtered.filter(group => {
                if (group.bib_number === 'unknown') return false;
                const avgConfidence = this.getGroupAverageConfidence(group);
                return avgConfidence >= (this.confidenceFilter / 100);
            });
        }

        // Apply photo count filter
        if (this.photoCountFilter > 1) {
            filtered = filtered.filter(group => group.count >= this.photoCountFilter);
        }

        // Apply sorting
        filtered.sort((a, b) => {
            switch (this.currentSort) {
                case 'bib-asc':
                    if (a.bib_number === 'unknown') return 1;
                    if (b.bib_number === 'unknown') return -1;
                    return a.bib_number.localeCompare(b.bib_number, undefined, { numeric: true });
                case 'bib-desc':
                    if (a.bib_number === 'unknown') return 1;
                    if (b.bib_number === 'unknown') return -1;
                    return b.bib_number.localeCompare(a.bib_number, undefined, { numeric: true });
                case 'count-desc':
                    return b.count - a.count;
                case 'count-asc':
                    return a.count - b.count;
                case 'confidence-desc':
                    const confA = this.getGroupAverageConfidence(a);
                    const confB = this.getGroupAverageConfidence(b);
                    return confB - confA;
                case 'confidence-asc':
                    const confA2 = this.getGroupAverageConfidence(a);
                    const confB2 = this.getGroupAverageConfidence(b);
                    return confA2 - confB2;
                default:
                    return 0;
            }
        });

        this.filteredGroups = filtered;
        this.updateResultsCount(filtered.length);
        this.displayFilteredPhotoGroups();
    }

    getGroupAverageConfidence(group) {
        const photosWithConfidence = group.photos.filter(photo => photo.detection_result);
        if (photosWithConfidence.length === 0) return 0;

        const totalConfidence = photosWithConfidence.reduce((sum, photo) => 
            sum + photo.detection_result.confidence, 0);
        return totalConfidence / photosWithConfidence.length;
    }

    updateResultsCount(count) {
        const total = this.groupedPhotos.length;
        const resultsCount = document.getElementById('resultsCount');

        if (count === total) {
            resultsCount.textContent = `Showing all ${total} groups`;
        } else {
            resultsCount.textContent = `Showing ${count} of ${total} groups`;
        }
    }

    displayFilteredPhotoGroups() {
        const photoGroupsDiv = document.getElementById('photo-groups');
        const groupsToShow = this.filteredGroups.length > 0 ? this.filteredGroups : this.groupedPhotos;

        console.log('Displaying groups:', groupsToShow);

        if (groupsToShow.length === 0) {
            photoGroupsDiv.innerHTML = `
                <div class="col-12 text-center py-5">
                    <i class="fas fa-search fa-3x text-muted mb-3"></i>
                    <h5 class="text-muted">No groups found</h5>
                    <p class="text-muted">Try adjusting your search or filters</p>
                </div>
            `;
            return;
        }

        photoGroupsDiv.innerHTML = groupsToShow.map(group => `
            <div class="col-lg-4 col-md-6 mb-4 fade-in-up">
                <div class="card photo-group-card">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <h5 class="card-title mb-0">
                                <i class="fas fa-user me-2"></i>
                                ${group.bib_number === 'unknown' ? 'Unknown Bib' : `Bib #${group.bib_number}`}
                            </h5>
                            <span class="badge bg-secondary">${group.count} photo${group.count !== 1 ? 's' : ''}</span>
                        </div>
                        <p class="text-muted small mb-3">
                            <i class="fas fa-mouse-pointer me-1"></i>
                            Click photos to view full size
                        </p>

                        <div class="photo-grid">
                            ${group.photos.slice(0, 4).map((photo, index) => `
                                <div class="photo-item" onclick="photoProcessor.showPhotoModal('${photo.id}', '${photo.filename}', '${group.bib_number}')">
                                    <img src="${this.getImageUrl(photo.id)}" 
                                         alt="${photo.filename}" 
                                         style="width: 100%; height: 100%; object-fit: cover; border-radius: var(--border-radius);"
                                         onerror="console.error('Failed to load image:', this.src); this.style.display='none'; this.nextElementSibling.style.display='flex';">
                                    <div class="photo-placeholder" style="display: none;">
                                        <i class="fas fa-image fa-2x"></i>
                                    </div>
                                    <div class="hover-overlay">
                                        <i class="fas fa-expand-alt me-1"></i>
                                        ${group.bib_number === 'unknown' ? 'View & Label' : 'View'}
                                    </div>
                                    ${photo.detection_result && photo.detection_result.confidence > 0 ? `
                                        <div class="confidence-badge ${this.getConfidenceClass(photo.detection_result.confidence)}">
                                            ${Math.round((photo.detection_result.confidence / 1.5) * 100)}%
                                        </div>
                                    ` : ''}
                                    ${group.count > 4 && index === 3 ? `
                                        <div class="more-photos-overlay">
                                            <div class="more-photos-text">
                                                <i class="fas fa-plus-circle mb-1"></i>
                                                <div>+${group.count - 4} more</div>
                                            </div>
                                        </div>
                                    ` : ''}
                                </div>
                            `).join('')}
                        </div>

                    </div>
                </div>
            </div>
        `).join('');
    }

    // Drag and Drop Handlers
    handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('upload-area').classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('upload-area').classList.remove('dragover');
    }

    async handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('upload-area').classList.remove('dragover');

        const files = Array.from(e.dataTransfer.files).filter(file => 
            file.type.startsWith('image/')
        );

        await this.handleFileSelect(files);
    }

    // File Selection Handler
    async handleFileSelect(files, isFolder = false) {
        // Clear any previous completed job state when starting new upload
        if (window.stateManager) {
            window.stateManager.clearCompletedJob();
            console.log('Cleared previous job state for new upload');
        }
        
        const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
        const SUPPORTED_FORMATS = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        const COMPRESS_THRESHOLD = 4 * 1024 * 1024; // Compress files larger than 4MB

        const invalidFiles = [];
        const toProcess = [];
        
        // First pass: filter invalid files
        Array.from(files).forEach(file => {
            if (!SUPPORTED_FORMATS.includes(file.type)) {
                invalidFiles.push(file.name);
            } else {
                toProcess.push(file);
            }
        });

        // Show compression progress if needed
        const needsCompression = toProcess.some(file => file.size > COMPRESS_THRESHOLD);
        let progressModal = null;
        
        if (needsCompression && toProcess.length > 0) {
            progressModal = this.showCompressionProgress(toProcess.length);
        }

        // Process files with compression
        const processedFiles = [];
        let processedCount = 0;
        
        for (const file of toProcess) {
            try {
                let finalFile = file;
                
                // Compress if file is larger than threshold
                if (file.size > COMPRESS_THRESHOLD) {
                    const options = {
                        maxSizeMB: 4,
                        maxWidthOrHeight: 4000,
                        useWebWorker: true,
                        fileType: file.type,
                        preserveExif: true,
                        initialQuality: 0.9
                    };
                    
                    console.log(`Compressing ${file.name}: ${(file.size / 1024 / 1024).toFixed(1)}MB`);
                    finalFile = await imageCompression(file, options);
                    
                    // Preserve original filename
                    finalFile = new File([finalFile], file.name, { type: finalFile.type });
                    console.log(`Compressed to: ${(finalFile.size / 1024 / 1024).toFixed(1)}MB`);
                }
                
                processedFiles.push(finalFile);
                processedCount++;
                
                // Update progress
                if (progressModal) {
                    this.updateCompressionProgress(processedCount, toProcess.length);
                }
                
            } catch (error) {
                console.error(`Failed to process ${file.name}:`, error);
                invalidFiles.push(file.name);
            }
        }

        // Hide progress modal
        if (progressModal) {
            this.hideCompressionProgress();
        }

        // Add to existing files instead of replacing
        this.selectedFiles = [...this.selectedFiles, ...processedFiles];

        // Remove duplicates based on file name and size
        this.selectedFiles = this.selectedFiles.filter((file, index, self) =>
            index === self.findIndex(f => f.name === file.name && f.size === file.size)
        );

        this.displaySelectedFiles();

        // Show feedback messages
        if (processedFiles.length > 0) {
            const compressionNote = needsCompression ? ' (compressed for optimal upload)' : '';
            this.showSuccess(`Added ${processedFiles.length} photos${isFolder ? ' from folder' : ''}${compressionNote}`);
        }

        if (invalidFiles.length > 0) {
            this.showError(`${invalidFiles.length} files skipped (unsupported or processing failed)`);
        }
    }

    async displaySelectedFiles() {
        const selectedFilesDiv = document.getElementById('selected-files');
        const fileListDiv = document.getElementById('file-list');
        const fileCountSpan = document.getElementById('file-count');

        if (this.selectedFiles.length === 0) {
            selectedFilesDiv.classList.add('d-none');
            return;
        }

        selectedFilesDiv.classList.remove('d-none');
        fileCountSpan.textContent = this.selectedFiles.length;

        // Check quota and add warning if needed
        const quotaCheck = await this.checkUploadQuota(this.selectedFiles.length);
        let warningHtml = '';
        
        if (!quotaCheck.canUpload) {
            warningHtml = `
                <div class="alert alert-danger mt-3 mb-3">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    ${quotaCheck.message}
                </div>
            `;
            // Disable upload button
            document.getElementById('upload-btn').disabled = true;
        } else {
            // Check if approaching limit (within 10 photos)
            const quota = await this.loadUserQuota();
            if (quota && quota.photos_remaining <= 10 && quota.photos_remaining > 0) {
                warningHtml = `
                    <div class="alert alert-warning mt-3 mb-3">
                        <i class="fas fa-exclamation-circle me-2"></i>
                        Warning: Only ${quota.photos_remaining} photos remaining this month.
                    </div>
                `;
            }
            // Enable upload button
            document.getElementById('upload-btn').disabled = false;
        }

        fileListDiv.innerHTML = warningHtml + this.selectedFiles.map((file, index) => `
            <div class="file-item">
                <div class="file-info">
                    <i class="fas fa-image file-icon"></i>
                    <div class="file-details">
                        <h6>${file.name}</h6>
                        <div class="file-size">${this.formatFileSize(file.size)}</div>
                    </div>
                </div>
                <button class="remove-file" onclick="photoProcessor.removeFile(${index})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');
    }

    removeFile(index) {
        this.selectedFiles.splice(index, 1);
        this.displaySelectedFiles();
    }

    clearAllFiles() {
        this.selectedFiles = [];
        this.displaySelectedFiles();
        this.showSuccess('All files cleared');
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Helper method for authenticated API calls
    getAuthHeaders(includeContentType = true) {
        const headers = {};
        if (includeContentType) {
            headers['Content-Type'] = 'application/json';
        }
        // Get token from localStorage if this.authToken is not set
        const token = this.authToken || localStorage.getItem('auth_token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }

    // Helper method to download files with authentication
    async downloadAuthenticatedFile(url, filename) {
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: this.getAuthHeaders(false),
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`Download failed: ${response.statusText}`);
            }

            // Get the blob from response
            const blob = await response.blob();
            
            // Create a temporary URL for the blob
            const blobUrl = window.URL.createObjectURL(blob);
            
            // Create a temporary anchor element and trigger download
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = filename || 'download.zip';
            document.body.appendChild(link);
            link.click();
            
            // Cleanup
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
            
        } catch (error) {
            console.error('Download failed:', error);
            throw error;
        }
    }

    getImageUrl(photoId) {
        const token = this.authToken || localStorage.getItem('auth_token');
        if (token) {
            return `${this.apiBase}/upload/serve/${photoId}/view?token=${encodeURIComponent(token)}`;
        }
        return `${this.apiBase}/upload/serve/${photoId}`;
    }

    // Get current user quota
    async loadUserQuota() {
        try {
            console.log('🔄 Loading user quota...');
            console.log('🔐 Current authToken:', this.authToken ? `${this.authToken.substring(0, 20)}...` : 'NULL');
            
            // Check localStorage token as well
            const storedToken = localStorage.getItem('auth_token');
            console.log('🔐 Stored token:', storedToken ? `${storedToken.substring(0, 20)}...` : 'NULL');
            
            const headers = this.getAuthHeaders();
            console.log('🔐 Request headers:', headers);
            
            const response = await fetch(`${this.apiBase}/users/me/quota`, {
                headers: headers,
                credentials: 'include'
            });

            console.log('📊 Quota response status:', response.status);
            if (response.ok) {
                const data = await response.json();
                console.log('✅ Quota data received:', data);
                this.updateQuotaDisplay(data.quota);
                return data.quota;
            } else {
                console.error('❌ Quota request failed:', response.status, response.statusText);
            }
        } catch (error) {
            console.error('Failed to load quota:', error);
        }
        return null;
    }

    // Update quota display in UI
    updateQuotaDisplay(quota) {
        const quotaStatus = document.getElementById('quota-status');
        const quotaText = document.getElementById('quota-text');
        const quotaProgress = document.getElementById('quota-progress');

        if (!quota) {
            quotaStatus.classList.add('d-none');
            return;
        }

        const remaining = quota.photos_remaining;
        const used = quota.photos_used_this_month;
        const total = quota.monthly_photo_limit;
        const percentage = (used / total) * 100;

        quotaText.textContent = `${remaining.toLocaleString()} photos remaining this month (${used.toLocaleString()}/${total.toLocaleString()})`;
        quotaProgress.style.width = `${percentage}%`;

        // Update progress bar color based on usage
        quotaProgress.className = 'progress-bar';
        if (percentage >= 90) {
            quotaProgress.classList.add('bg-danger');
            quotaStatus.className = 'alert alert-danger mb-4';
        } else if (percentage >= 75) {
            quotaProgress.classList.add('bg-warning');
            quotaStatus.className = 'alert alert-warning mb-4';
        } else {
            quotaProgress.classList.add('bg-success');
            quotaStatus.className = 'alert alert-info mb-4';
        }

        quotaStatus.classList.remove('d-none');
    }

    // Check if user can upload the specified number of photos
    async checkUploadQuota(photoCount) {
        const quota = await this.loadUserQuota();
        if (!quota) return { canUpload: true, message: '' };

        const remaining = quota.photos_remaining;
        if (photoCount > remaining) {
            return {
                canUpload: false,
                message: `Cannot upload ${photoCount} photos. Only ${remaining} photos remaining this month.`
            };
        }

        return { canUpload: true, message: '' };
    }

    // File Upload
    async uploadFiles() {
        if (this.selectedFiles.length === 0) return;

        // Check quota before upload
        const quotaCheck = await this.checkUploadQuota(this.selectedFiles.length);
        if (!quotaCheck.canUpload) {
            this.showError(quotaCheck.message);
            return;
        }

        const formData = new FormData();
        this.selectedFiles.forEach(file => {
            formData.append('files', file);
        });

        try {
            // Debug authentication state
            console.log('🔐 Upload: Debugging authentication state...');
            console.log('🔐 Upload: this.authToken:', this.authToken ? `${this.authToken.substring(0, 20)}...` : 'NULL');
            console.log('🔐 Upload: localStorage token:', localStorage.getItem('auth_token') ? `${localStorage.getItem('auth_token').substring(0, 20)}...` : 'NULL');
            console.log('🔐 Upload: this.isAuthenticated:', this.isAuthenticated);
            
            const headers = this.getAuthHeaders(false);
            console.log('🔐 Upload: Request headers:', headers);
            
            document.getElementById('upload-btn').disabled = true;
            document.getElementById('upload-btn').innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Uploading...';

            const response = await fetch(`${this.apiBase}/upload/photos`, {
                method: 'POST',
                headers: headers, // Don't include Content-Type for FormData
                credentials: 'include',
                body: formData
            });

            if (response.status === 402) {
                // Payment Required - quota exceeded
                const error = await response.json();
                throw new Error(error.detail || 'Monthly photo limit exceeded');
            }

            if (!response.ok) {
                // Debug the actual error response
                console.log('❌ Upload failed with status:', response.status, response.statusText);
                try {
                    const errorData = await response.json();
                    console.log('❌ Upload error details:', errorData);
                    throw new Error(`Upload failed: ${errorData.detail || response.statusText}`);
                } catch (parseError) {
                    console.log('❌ Could not parse error response:', parseError);
                    throw new Error(`Upload failed: ${response.statusText}`);
                }
            }

            const result = await response.json();
            
            // Track successful upload
            if (window.analyticsDashboard) {
                window.analyticsDashboard.trackEngagement('success_action', 'photos_uploaded', {
                    photo_count: this.selectedFiles.length,
                    upload_size_mb: this.selectedFiles.reduce((total, file) => total + file.size, 0) / (1024 * 1024)
                });
            }
            
            // Update quota display with new information
            if (result.quota_info) {
                this.updateQuotaDisplay(result.quota_info);
            }
            
            this.showProcessingSection();
            this.showProcessingWarning(); // Show warning during active processing
            this.startProcessing(result.photo_ids);

        } catch (error) {
            console.error('🔐 Upload error:', error);
            if (error.message.includes('quota') || error.message.includes('limit')) {
                this.showError(`Quota exceeded: ${error.message}`);
            } else {
                this.showError('Upload failed. Please try again.');
            }
            document.getElementById('upload-btn').disabled = false;
            document.getElementById('upload-btn').innerHTML = '<i class="fas fa-upload me-2"></i>Upload Photos';
        }
    }

    // Processing
    async startProcessing(photoIds) {
        try {
            const response = await fetch(`${this.apiBase}/process/start`, {
                method: 'POST',
                headers: this.getAuthHeaders(true),
                credentials: 'include',
                body: JSON.stringify(photoIds)
            });

            if (!response.ok) {
                throw new Error(`Processing failed: ${response.statusText}`);
            }

            const job = await response.json();
            this.currentJobId = job.job_id;
            this.pollProcessingStatus();

        } catch (error) {
            console.error('Processing error:', error);
            this.showError('Processing failed. Please try again.');
        }
    }

    async pollProcessingStatus() {
        if (!this.currentJobId) return;

        try {
            const response = await fetch(`${this.apiBase}/process/status/${this.currentJobId}`, {
                headers: this.getAuthHeaders(true),
                credentials: 'include'
            });
            
            if (response.status === 404) {
                // Job not found - likely server restarted and lost job data
                console.warn(`Job ${this.currentJobId} not found (404). Server may have restarted.`);
                this.showError('Processing job was lost due to server restart. Please upload your photos again.');
                this.resetApp();
                return;
            }
            
            if (!response.ok) throw new Error(`Status check failed: ${response.statusText}`);

            const job = await response.json();
            this.updateProgress(job);

            if (job.status === 'completed') {
                // Update progress to show completion
                const progressText = document.getElementById('progress-text');
                if (progressText) {
                    progressText.textContent = 'Processing complete! Loading results...';
                }
                // Add a small delay to ensure backend results are ready
                setTimeout(() => this.fetchResults(), 500);
            } else if (job.status === 'failed') {
                this.showError('Processing failed. Please try again.');
                this.resetApp();
            } else {
                setTimeout(() => this.pollProcessingStatus(), 500);
            }

        } catch (error) {
            console.error('Status check error:', error);
            // Don't retry indefinitely - stop after certain conditions
            if (error.message.includes('404') || error.message.includes('not found')) {
                console.warn('Stopping polling due to job not found');
                this.showError('Processing job not found. Please upload your photos again.');
                this.resetApp();
            } else {
                // Continue polling for other errors, but with longer delay
                setTimeout(() => this.pollProcessingStatus(), 2000);
            }
        }
    }

    updateProgress(job) {
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');

        // Smooth progress bar transitions
        progressBar.style.transition = 'width 0.3s ease-in-out';
        progressBar.style.width = `${job.progress}%`;

        // Enhanced progress text with phases
        let statusText = '';
        if (job.progress === 0 || job.completed_photos === 0) {
            statusText = 'Initializing photo processing...';
        } else if (job.progress < 100 && job.status === 'processing') {
            const currentPhoto = Math.min(job.completed_photos + 1, job.total_photos);
            statusText = `Processing photo ${currentPhoto} of ${job.total_photos} (${job.progress}%)`;
        } else if (job.progress >= 95 && job.status === 'processing') {
            statusText = 'Finalizing results and organizing photos...';
        } else {
            statusText = `Processing... ${job.completed_photos}/${job.total_photos} photos (${job.progress}%)`;
        }

        progressText.textContent = statusText;
    }

    async fetchResults(retryCount = 0) {
        try {
            const response = await fetch(`${this.apiBase}/process/results/${this.currentJobId}`, {
                headers: this.getAuthHeaders(true),
                credentials: 'include'
            });
            if (!response.ok) {
                // Handle 404 job not found
                if (response.status === 404) {
                    console.warn(`Job ${this.currentJobId} not found when fetching results (404). Server may have restarted.`);
                    this.showError('Processing job was lost due to server restart. Please upload your photos again.');
                    this.resetApp();
                    return;
                }
                
                // If results aren't ready yet and we haven't retried too many times, try again
                if (response.status === 400 && retryCount < 3) {
                    console.log(`Results not ready yet, retrying in 1 second... (attempt ${retryCount + 1})`);
                    // Update progress text to show retry
                    const progressText = document.getElementById('progress-text');
                    if (progressText) {
                        progressText.textContent = `Finalizing results... (attempt ${retryCount + 1})`;
                    }
                    setTimeout(() => this.fetchResults(retryCount + 1), 1000);
                    return;
                }
                throw new Error(`Results fetch failed: ${response.statusText}`);
            }

            this.groupedPhotos = await response.json();
            console.log('Grouped photos received:', this.groupedPhotos);
            
            // Track successful processing completion
            if (window.analyticsDashboard) {
                const totalPhotos = Object.values(this.groupedPhotos).reduce((sum, group) => sum + group.length, 0);
                const detectedPhotos = Object.keys(this.groupedPhotos).filter(key => key !== 'unknown').length > 0 
                    ? Object.keys(this.groupedPhotos).filter(key => key !== 'unknown').reduce((sum, key) => sum + this.groupedPhotos[key].length, 0) 
                    : 0;
                const unknownPhotos = this.groupedPhotos.unknown ? this.groupedPhotos.unknown.length : 0;
                
                window.analyticsDashboard.trackEngagement('success_action', 'processing_completed', {
                    total_photos: totalPhotos,
                    detected_photos: detectedPhotos,
                    unknown_photos: unknownPhotos,
                    detection_accuracy: totalPhotos > 0 ? (detectedPhotos / totalPhotos * 100).toFixed(1) : 0,
                    job_id: this.currentJobId
                });
            }
            
            // Save job completion state to localStorage for persistence
            if (window.stateManager && this.currentJobId) {
                window.stateManager.markJobCompleted(this.currentJobId, 'completed');
                console.log(`Job ${this.currentJobId} completion state saved to localStorage`);
            }
            
            // Hide processing warning since job is now completed
            this.hideProcessingWarning();
            
            this.showResultsSection();

        } catch (error) {
            console.error('Results fetch error:', error);

            // If this is the first attempt, try once more after a delay
            if (retryCount === 0) {
                console.log('Retrying results fetch after 2 seconds...');
                // Update progress text to show retry
                const progressText = document.getElementById('progress-text');
                if (progressText) {
                    progressText.textContent = 'Retrying to fetch results...';
                }
                setTimeout(() => this.fetchResults(1), 2000);
            } else {
                this.hideProcessingWarning(); // Hide warning if error occurs
                this.showError('Failed to fetch results. Please try again.');
            }
        }
    }

    // UI Section Management
    showProcessingSection() {
        document.getElementById('upload-section').classList.add('d-none');
        document.getElementById('processing-section').classList.remove('d-none');
        document.getElementById('results-section').classList.add('d-none');
    }

    showResultsSection() {
        document.getElementById('upload-section').classList.add('d-none');
        document.getElementById('processing-section').classList.add('d-none');
        document.getElementById('results-section').classList.remove('d-none');

        this.displayResults();
    }

    showUploadSection() {
        document.getElementById('upload-section').classList.remove('d-none');
        document.getElementById('processing-section').classList.add('d-none');
        document.getElementById('results-section').classList.add('d-none');
    }

    // Results Display - Simplified
    displayResults() {
        this.updateStatsCards();
        this.displayPhotoGroups();
        // No complex export controls needed - just simple download all button
    }

    updateStatsCards() {
        const totalPhotos = this.groupedPhotos.reduce((sum, group) => sum + group.count, 0);
        const detectedPhotos = this.groupedPhotos
            .filter(group => group.bib_number !== 'unknown')
            .reduce((sum, group) => sum + group.count, 0);
        const unknownPhotos = this.groupedPhotos.find(group => group.bib_number === 'unknown')?.count || 0;

        document.getElementById('total-photos').textContent = totalPhotos;
        document.getElementById('detected-photos').textContent = detectedPhotos;
        document.getElementById('unknown-photos').textContent = unknownPhotos;
    }

    displayPhotoGroups() {
        // Initialize filters and show all groups
        this.applyFilters();
    }

    displayExportControls() {
        const exportGroupsDiv = document.getElementById('export-groups');
        const groupsToShow = this.filteredGroups.length > 0 ? this.filteredGroups : this.groupedPhotos;

        exportGroupsDiv.innerHTML = groupsToShow.map(group => `
            <div class="col-md-6 mb-2">
                <label class="export-checkbox ${this.selectedGroups.includes(group.bib_number) ? 'selected' : ''}">
                    <input type="checkbox" value="${group.bib_number}" ${this.selectedGroups.includes(group.bib_number) ? 'checked' : ''} onchange="photoProcessor.toggleGroupSelection('${group.bib_number}')">
                    <div class="export-info">
                        <h6>${group.bib_number === 'unknown' ? 'Unknown Bib' : `Bib #${group.bib_number}`}</h6>
                        <small>${group.count} photos • ${group.bib_number !== 'unknown' ? Math.round(this.getGroupAverageConfidence(group) * 100) + '% confidence' : 'No detection'}</small>
                    </div>
                </label>
            </div>
        `).join('');

        // Update selection UI after rendering
        this.updateSelectionUI();
        this.updateExportPreview();
    }

    getConfidenceClass(confidence) {
        if (confidence >= 0.8) return 'confidence-high';
        if (confidence >= 0.6) return 'confidence-medium';
        return 'confidence-low';
    }

    // Export Functions
    toggleGroupSelection(bibNumber) {
        const index = this.selectedGroups.indexOf(bibNumber);
        if (index > -1) {
            this.selectedGroups.splice(index, 1);
        } else {
            this.selectedGroups.push(bibNumber);
        }

        this.updateSelectionUI();
        this.updateExportPreview();
    }

    async exportPhotos() {
        if (this.selectedGroups.length === 0) return;

        const selectedPhotos = this.groupedPhotos
            .filter(group => this.selectedGroups.includes(group.bib_number))
            .flatMap(group => group.photos);

        const photoIds = selectedPhotos.map(photo => photo.id);

        // Get export options
        const exportFormat = document.getElementById('exportFormat').value;
        const filenamePattern = document.getElementById('filenamePattern').value;

        try {
            // Show progress
            this.showExportProgress('Preparing export...');

            document.getElementById('export-btn').disabled = true;
            document.getElementById('export-btn').innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Creating Export...';

            const exportData = {
                photo_ids: photoIds,
                export_options: {
                    format: exportFormat,
                    filename_pattern: filenamePattern,
                    group_data: this.groupedPhotos.filter(group => 
                        this.selectedGroups.includes(group.bib_number)
                    )
                }
            };

            const response = await fetch(`${this.apiBase}/download/export`, {
                method: 'POST',
                headers: this.getAuthHeaders(true),
                credentials: 'include',
                body: JSON.stringify(exportData)
            });

            if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);

            const result = await response.json();

            // Update progress
            this.updateExportProgress(75, 'Generating ZIP file...');

            // Simulate additional progress steps
            setTimeout(async () => {
                this.updateExportProgress(100, 'Download ready!');

                // Download the file with authentication
                const downloadUrl = `${this.apiBase}/download/file/${result.export_id}`;
                await this.downloadAuthenticatedFile(downloadUrl, `tag_photos_${result.export_id}.zip`);

                this.showSuccess(`Successfully exported ${photoIds.length} photos from ${this.selectedGroups.length} groups!`);

                // Hide progress after a delay
                setTimeout(() => {
                    this.hideExportProgress();
                }, 2000);
            }, 1000);

        } catch (error) {
            console.error('Export error:', error);
            this.showError('Export failed. Please try again.');
            this.hideExportProgress();
        } finally {
            document.getElementById('export-btn').disabled = false;
            document.getElementById('export-btn').innerHTML = `<i class="fas fa-file-archive me-2"></i>Export Selected (<span id="exportBtnCount">${this.selectedGroups.length}</span>)`;
        }
    }

    async downloadAllPhotos() {
        // Track download initiation
        if (window.analyticsDashboard) {
            window.analyticsDashboard.trackEngagement('success_action', 'download_initiated', {
                download_type: 'all_photos'
            });
        }
        
        // Get all photos from all groups
        const allPhotos = this.groupedPhotos.flatMap(group => group.photos);
        const photoIds = allPhotos.map(photo => photo.id);

        if (photoIds.length === 0) {
            this.showError('No photos to download.');
            return;
        }

        try {
            // Show progress
            this.showExportProgress('Preparing download...');

            const downloadBtn = document.getElementById('download-all-btn');
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Creating ZIP...';

            const exportData = {
                photo_ids: photoIds,
                format: 'zip'
            };

            const response = await fetch(`${this.apiBase}/download/export`, {
                method: 'POST',
                headers: this.getAuthHeaders(true),
                credentials: 'include',
                body: JSON.stringify(exportData)
            });

            if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);
            const result = await response.json();

            // Show completion and download
            setTimeout(async () => {
                this.updateExportProgress(100, 'Download ready!');

                // Download the file with authentication
                const downloadUrl = `${this.apiBase}/download/file/${result.export_id}`;
                await this.downloadAuthenticatedFile(downloadUrl, `tag_photos_${result.export_id}.zip`);

                // Track successful download completion
                if (window.analyticsDashboard) {
                    window.analyticsDashboard.trackEngagement('success_action', 'download_completed', {
                        download_type: 'all_photos',
                        photo_count: photoIds.length,
                        export_id: result.export_id
                    });
                }

                this.showSuccess(`Successfully downloaded ${photoIds.length} photos organized by bib number!`);

                // Hide progress after a delay
                setTimeout(() => {
                    this.hideExportProgress();
                }, 2000);

            }, 1000);
        } catch (error) {
            console.error('Download error:', error);
            this.showError('Download failed. Please try again.');
            this.hideExportProgress();
        } finally {
            const downloadBtn = document.getElementById('download-all-btn');
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = '<i class="fas fa-download me-2"></i>Download All Photos as ZIP';
        }
    }

    showExportProgress(message) {
        const progress = document.getElementById('exportProgress');
        const progressBar = progress.querySelector('.progress-bar');
        progress.style.display = 'block';
        progressBar.style.width = '25%';
        progressBar.innerHTML = `<small>${message}</small>`;
    }

    updateExportProgress(percent, message) {
        const progressBar = document.querySelector('#exportProgress .progress-bar');
        progressBar.style.width = `${percent}%`;
        progressBar.innerHTML = `<small>${message}</small>`;
    }

    hideExportProgress() {
        document.getElementById('exportProgress').style.display = 'none';
    }

    // Utility Functions
    resetApp() {
        this.selectedFiles = [];
        this.currentJobId = null;
        this.groupedPhotos = [];
        this.selectedGroups = [];

        // Clear completed job state from localStorage
        if (window.stateManager) {
            window.stateManager.clearCompletedJob();
            console.log('Cleared completed job state - starting fresh');
        }
        
        // Hide any processing warnings
        this.hideProcessingWarning();

        document.getElementById('file-input').value = '';
        document.getElementById('upload-btn').disabled = false;
        document.getElementById('upload-btn').innerHTML = '<i class="fas fa-upload me-2"></i>Upload Photos';

        this.showUploadSection();
    }

    showCompressionProgress(totalFiles) {
        // Create a progress modal for compression
        const progressHtml = `
            <div id="compressionProgressModal" class="modal fade" data-bs-backdrop="static" data-bs-keyboard="false">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-body text-center p-4">
                            <h5 class="mb-3">Optimizing Photos for Upload</h5>
                            <div class="progress mb-3" style="height: 25px;">
                                <div id="compressionProgressBar" class="progress-bar progress-bar-striped progress-bar-animated" 
                                     role="progressbar" style="width: 0%">
                                    <span id="compressionProgressText">0 / ${totalFiles}</span>
                                </div>
                            </div>
                            <p class="text-muted mb-0">Compressing large images for faster upload...</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Add modal to body if not exists
        if (!document.getElementById('compressionProgressModal')) {
            document.body.insertAdjacentHTML('beforeend', progressHtml);
        }
        
        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('compressionProgressModal'));
        modal.show();
        
        return modal;
    }
    
    updateCompressionProgress(current, total) {
        const progressBar = document.getElementById('compressionProgressBar');
        const progressText = document.getElementById('compressionProgressText');
        
        if (progressBar && progressText) {
            const percentage = Math.round((current / total) * 100);
            progressBar.style.width = `${percentage}%`;
            progressText.textContent = `${current} / ${total}`;
        }
    }
    
    hideCompressionProgress() {
        const modalEl = document.getElementById('compressionProgressModal');
        if (modalEl) {
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) {
                modal.hide();
            }
            // Clean up modal after hiding
            setTimeout(() => {
                if (modalEl.parentNode) {
                    modalEl.parentNode.removeChild(modalEl);
                }
            }, 500);
        }
    }

    showError(message) {
        // You can enhance this with a proper modal or toast notification
        alert(message);
    }

    showSuccess(message) {
        // Create a temporary success message
        const successDiv = document.createElement('div');
        successDiv.className = 'alert alert-success alert-dismissible fade show position-fixed';
        successDiv.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
        successDiv.innerHTML = `
            <i class="fas fa-check-circle me-2"></i>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;

        document.body.appendChild(successDiv);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.remove();
            }
        }, 3000);
    }

    // Modal Event Listeners
    initializeModalEventListeners() {
        const modalUploadArea = document.getElementById('modal-upload-area');
        const modalFileInput = document.getElementById('modal-file-input');
        const modalFolderInput = document.getElementById('modal-folder-input');
        const modalChooseFilesBtn = document.getElementById('modal-choose-files-btn');
        const modalChooseFolderBtn = document.getElementById('modal-choose-folder-btn');
        const modalClearBtn = document.getElementById('modal-clear-files-btn');
        const modalUploadBtn = document.getElementById('modal-upload-btn');

        // Modal drag and drop
        modalUploadArea.addEventListener('click', (e) => {
            if (!e.target.closest('button')) {
                modalFileInput.click();
            }
        });
        modalUploadArea.addEventListener('dragover', this.handleModalDragOver.bind(this));
        modalUploadArea.addEventListener('dragleave', this.handleModalDragLeave.bind(this));
        modalUploadArea.addEventListener('drop', this.handleModalDrop.bind(this));

        // Modal button events
        modalChooseFilesBtn.addEventListener('click', () => modalFileInput.click());
        modalChooseFolderBtn.addEventListener('click', () => modalFolderInput.click());
        modalClearBtn.addEventListener('click', this.clearModalFiles.bind(this));
        modalUploadBtn.addEventListener('click', this.uploadMoreFiles.bind(this));

        // Modal file input events
        modalFileInput.addEventListener('change', (e) => this.handleModalFileSelect(e.target.files, false));
        modalFolderInput.addEventListener('change', (e) => this.handleModalFileSelect(e.target.files, true));
    }

    // Modal Upload More Functions
    showUploadMoreModal() {
        this.modalSelectedFiles = [];
        this.displayModalSelectedFiles();
        const modal = new bootstrap.Modal(document.getElementById('uploadMoreModal'));
        modal.show();
    }

    handleModalDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('modal-upload-area').classList.add('dragover');
    }

    handleModalDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('modal-upload-area').classList.remove('dragover');
    }

    handleModalDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('modal-upload-area').classList.remove('dragover');

        const files = Array.from(e.dataTransfer.files).filter(file => 
            file.type.startsWith('image/')
        );

        this.handleModalFileSelect(files);
    }

    handleModalFileSelect(files, isFolder = false) {
        const imageFiles = Array.from(files).filter(file => 
            file.type.startsWith('image/')
        );

        this.modalSelectedFiles = [...this.modalSelectedFiles, ...imageFiles];

        // Remove duplicates
        this.modalSelectedFiles = this.modalSelectedFiles.filter((file, index, self) =>
            index === self.findIndex(f => f.name === file.name && f.size === file.size)
        );

        this.displayModalSelectedFiles();

        if (imageFiles.length > 0) {
            this.showSuccess(`Added ${imageFiles.length} additional photos`);
        }
    }

    async displayModalSelectedFiles() {
        const selectedFilesDiv = document.getElementById('modal-selected-files');
        const fileListDiv = document.getElementById('modal-file-list');
        const fileCountSpan = document.getElementById('modal-file-count');
        const uploadBtn = document.getElementById('modal-upload-btn');

        if (this.modalSelectedFiles.length === 0) {
            selectedFilesDiv.classList.add('d-none');
            uploadBtn.disabled = true;
            return;
        }

        selectedFilesDiv.classList.remove('d-none');
        fileCountSpan.textContent = this.modalSelectedFiles.length;

        // Check quota for modal files
        const quotaCheck = await this.checkUploadQuota(this.modalSelectedFiles.length);
        let warningHtml = '';
        
        if (!quotaCheck.canUpload) {
            warningHtml = `
                <div class="alert alert-danger mt-3 mb-3">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    ${quotaCheck.message}
                </div>
            `;
            uploadBtn.disabled = true;
        } else {
            // Check if approaching limit
            const quota = await this.loadUserQuota();
            if (quota && quota.photos_remaining <= 10 && quota.photos_remaining > 0) {
                warningHtml = `
                    <div class="alert alert-warning mt-3 mb-3">
                        <i class="fas fa-exclamation-circle me-2"></i>
                        Warning: Only ${quota.photos_remaining} photos remaining this month.
                    </div>
                `;
            }
            uploadBtn.disabled = false;
        }

        fileListDiv.innerHTML = warningHtml + this.modalSelectedFiles.map((file, index) => `
            <div class="file-item">
                <div class="file-info">
                    <i class="fas fa-image file-icon"></i>
                    <div class="file-details">
                        <h6>${file.name}</h6>
                        <div class="file-size">${this.formatFileSize(file.size)}</div>
                    </div>
                </div>
                <button class="remove-file" onclick="photoProcessor.removeModalFile(${index})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');
    }

    removeModalFile(index) {
        this.modalSelectedFiles.splice(index, 1);
        this.displayModalSelectedFiles();
    }

    clearModalFiles() {
        this.modalSelectedFiles = [];
        this.displayModalSelectedFiles();
    }

    async uploadMoreFiles() {
        if (this.modalSelectedFiles.length === 0) return;

        // Check quota before upload
        const quotaCheck = await this.checkUploadQuota(this.modalSelectedFiles.length);
        if (!quotaCheck.canUpload) {
            this.showError(quotaCheck.message);
            return;
        }

        const formData = new FormData();
        this.modalSelectedFiles.forEach(file => {
            formData.append('files', file);
        });

        try {
            const modalUploadBtn = document.getElementById('modal-upload-btn');
            modalUploadBtn.disabled = true;
            modalUploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Processing...';

            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('uploadMoreModal'));
            modal.hide();

            // Upload new photos
            const response = await fetch(`${this.apiBase}/upload/photos`, {
                method: 'POST',
                headers: this.getAuthHeaders(false), // Don't include Content-Type for FormData
                credentials: 'include',
                body: formData
            });

            if (response.status === 402) {
                // Payment Required - quota exceeded
                const error = await response.json();
                throw new Error(error.detail || 'Monthly photo limit exceeded');
            }

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            const result = await response.json();
            
            // Update quota display with new information
            if (result.quota_info) {
                this.updateQuotaDisplay(result.quota_info);
            }

            // Process new photos
            const processResponse = await fetch(`${this.apiBase}/process/start`, {
                method: 'POST',
                headers: this.getAuthHeaders(true),
                credentials: 'include',
                body: JSON.stringify(result.photo_ids)
            });

            if (!processResponse.ok) {
                throw new Error(`Processing failed: ${processResponse.statusText}`);
            }

            const job = await processResponse.json();

            // Show processing notification
            this.showSuccess(`Processing ${this.modalSelectedFiles.length} additional photos...`);

            // Poll for completion and merge results
            this.pollAdditionalProcessing(job.job_id);

        } catch (error) {
            console.error('Upload more error:', error);
            if (error.message.includes('quota') || error.message.includes('limit')) {
                this.showError(`Quota exceeded: ${error.message}`);
            } else {
                this.showError('Failed to upload additional photos. Please try again.');
            }
        }
    }

    async pollAdditionalProcessing(jobId) {
        try {
            const response = await fetch(`${this.apiBase}/process/status/${jobId}`, {
                headers: this.getAuthHeaders(true),
                credentials: 'include'
            });
            if (!response.ok) throw new Error(`Status check failed: ${response.statusText}`);

            const job = await response.json();

            if (job.status === 'completed') {
                // Fetch new results
                const resultsResponse = await fetch(`${this.apiBase}/process/results/${jobId}`, {
                    headers: this.getAuthHeaders(true),
                    credentials: 'include'
                });
                if (!resultsResponse.ok) throw new Error(`Results fetch failed: ${resultsResponse.statusText}`);

                const newGroupedPhotos = await resultsResponse.json();

                // Merge with existing results
                this.mergeGroupedPhotos(newGroupedPhotos);
                this.displayResults();
                this.showSuccess('Additional photos processed and merged!');

            } else if (job.status === 'failed') {
                this.showError('Processing additional photos failed.');
            } else {
                setTimeout(() => this.pollAdditionalProcessing(jobId), 2000);
            }

        } catch (error) {
            console.error('Additional processing error:', error);
            setTimeout(() => this.pollAdditionalProcessing(jobId), 2000);
        }
    }

    mergeGroupedPhotos(newGroupedPhotos) {
        // Merge new grouped photos with existing ones
        newGroupedPhotos.forEach(newGroup => {
            const existingGroupIndex = this.groupedPhotos.findIndex(
                group => group.bib_number === newGroup.bib_number
            );

            if (existingGroupIndex >= 0) {
                // Add photos to existing group
                this.groupedPhotos[existingGroupIndex].photos.push(...newGroup.photos);
                this.groupedPhotos[existingGroupIndex].count += newGroup.count;
            } else {
                // Add new group
                this.groupedPhotos.push(newGroup);
            }
        });
    }

    // Enhanced Photo Modal Functions
    showPhotoModal(photoId, filename, groupBibNumber = null) {
        // Track photo modal open
        if (window.analyticsDashboard) {
            window.analyticsDashboard.trackEngagement('click', 'photo_modal_open', {
                photo_id: photoId,
                group_bib: groupBibNumber,
                source: groupBibNumber === 'unknown' ? 'unknown_photos' : 'detected_photos'
            });
        }
        
        // Sort groups by bib number before creating flat list for logical navigation
        const sortedGroups = [...this.groupedPhotos].sort((a, b) => {
            // Put 'unknown' group at the end
            if (a.bib_number === 'unknown') return 1;
            if (b.bib_number === 'unknown') return -1;
            
            // Sort numeric bib numbers
            return parseInt(a.bib_number) - parseInt(b.bib_number);
        });

        // Create a flat list of all photos from sorted groups for navigation
        this.allPhotosFlat = [];
        sortedGroups.forEach(group => {
            group.photos.forEach(photo => {
                this.allPhotosFlat.push({
                    ...photo,
                    groupBibNumber: group.bib_number,
                    groupCount: group.count
                });
            });
        });
        
        console.log('🔍 DEBUG: Built allPhotosFlat array with', this.allPhotosFlat.length, 'photos');
        console.log('🔍 DEBUG: Groups in sorted order:', sortedGroups.map(g => `${g.bib_number} (${g.photos.length} photos)`));

        // Find the current photo index in the flat list
        this.currentPhotoIndex = this.allPhotosFlat.findIndex(photo => photo.id === photoId);
        
        if (this.currentPhotoIndex === -1) {
            console.error('Photo not found in flat list:', photoId);
            return;
        }

        console.log('Opening photo modal for:', photoId, 'Group:', groupBibNumber);
        
        this.initializeLightbox();
        this.showPhotoInLightbox(this.currentPhotoIndex);

        const modal = new bootstrap.Modal(document.getElementById('photoModal'), {
            focus: false  // Disable Bootstrap focus management
        });
        modal.show();

        // Show the fixed metadata panel
        this.showFixedMetadataPanel();

        // Initialize keyboard navigation
        this.initializeLightboxKeyboard();
    }

    showFixedMetadataPanel() {
        console.log('Showing fixed metadata panel');
        const metadataPanel = document.getElementById('photoMetadata');
        if (metadataPanel) {
            console.log('Panel element found, current classes:', metadataPanel.className);
            
            // Remove any hiding classes and show the panel
            metadataPanel.classList.remove('d-none', 'photo-metadata-hidden');
            
            // Explicitly ensure pointer events are enabled
            metadataPanel.style.pointerEvents = 'auto';
            
            // Add body class for CSS targeting (replaces :has() selector)
            document.body.classList.add('metadata-panel-visible');
            document.body.classList.remove('metadata-panel-hidden');
            
            console.log('Panel shown, final classes:', metadataPanel.className);
            console.log('Panel pointer events:', metadataPanel.style.pointerEvents);
        } else {
            console.error('photoMetadata panel not found!');
        }
    }

    hideFixedMetadataPanel() {
        console.log('Hiding fixed metadata panel');
        const metadataPanel = document.getElementById('photoMetadata');
        if (metadataPanel) {
            // Add the hiding class for smooth animation
            metadataPanel.classList.add('photo-metadata-hidden');
            
            // Add body class for CSS targeting (replaces :has() selector)
            document.body.classList.add('metadata-panel-hidden');
            document.body.classList.remove('metadata-panel-visible');
        }
    }

    setupModalEventListeners() {
        const modalElement = document.getElementById('photoModal');
        
        // Remove any stray photoMetadata elements inside the modal
        this.cleanupModalPhotoMetadata();
        
        // Remove existing listeners to prevent duplicates
        modalElement.removeEventListener('shown.bs.modal', this.handleModalShown);
        modalElement.removeEventListener('hidden.bs.modal', this.handleModalHidden);
        
        // Bind the context for the event handlers
        this.handleModalShown = this.handleModalShown.bind(this);
        this.handleModalHidden = this.handleModalHidden.bind(this);
        
        // Add event listeners
        modalElement.addEventListener('shown.bs.modal', this.handleModalShown);
        modalElement.addEventListener('hidden.bs.modal', this.handleModalHidden);
    }

    cleanupModalPhotoMetadata() {
        // Remove any photoMetadata elements that might exist inside the modal
        const modalElement = document.getElementById('photoModal');
        if (modalElement) {
            const strayElements = modalElement.querySelectorAll('[id*="photoMetadata"], .photoMetadata');
            strayElements.forEach(element => {
                console.log('Removing stray photoMetadata element from modal:', element);
                element.remove();
            });
        }
    }

    handleModalShown() {
        console.log('Photo modal shown, ensuring metadata panel is visible');
        this.showFixedMetadataPanel();
    }

    handleModalHidden() {
        console.log('Photo modal hidden, hiding metadata panel');
        this.hideFixedMetadataPanel();
    }

    initializeLightbox() {
        const modal = document.getElementById('photoModal');

        // Add Bootstrap modal event listeners for fixed metadata panel
        this.setupModalEventListeners();

        // Navigation buttons
        document.getElementById('prevPhotoBtn').onclick = () => this.previousPhoto();
        document.getElementById('nextPhotoBtn').onclick = () => this.nextPhoto();

        // Zoom controls
        document.getElementById('zoomInBtn').onclick = () => this.zoomIn();
        document.getElementById('zoomOutBtn').onclick = () => this.zoomOut();
        document.getElementById('zoomResetBtn').onclick = () => this.resetZoom();

        // Fullscreen toggle
        document.getElementById('fullscreenBtn').onclick = () => this.toggleFullscreen();

        // Download button
        document.getElementById('downloadPhotoBtn').onclick = () => this.downloadCurrentPhoto();

        // Initialize inline labeling
        this.initializeInlineLabeling();

        // Initialize edit button
        document.getElementById('editBibBtn').onclick = () => this.enableEditMode();

        // Initialize thumbnails
        this.createThumbnailStrip();

        // Initialize zoom functionality
        this.initializeZoom();

        // Reset zoom
        this.zoomLevel = 1;
        this.panX = 0;
        this.panY = 0;
    }

    showPhotoInLightbox(index) {
        if (!this.allPhotosFlat || index < 0 || index >= this.allPhotosFlat.length) {
            console.log('🔍 DEBUG: showPhotoInLightbox failed - invalid index:', index, 'array length:', this.allPhotosFlat?.length);
            return;
        }

        this.currentPhotoIndex = index;
        const photo = this.allPhotosFlat[index];
        console.log('🔍 DEBUG: Showing photo', index + 1, 'of', this.allPhotosFlat.length, '- Group:', photo.groupBibNumber, 'ID:', photo.id);

        // Show loading spinner
        document.getElementById('photoLoader').style.display = 'block';

        // Update image
        const modalImage = document.getElementById('modalPhotoImage');
        modalImage.onload = () => {
            document.getElementById('photoLoader').style.display = 'none';
        };
        modalImage.src = this.getImageUrl(photo.id);
        modalImage.alt = photo.filename;

        // Update metadata
        document.getElementById('photoModalLabel').textContent = `${photo.groupBibNumber === 'unknown' ? 'Unknown Bib' : `Bib #${photo.groupBibNumber}`}`;
        document.getElementById('photoPosition').textContent = `${index + 1} of ${this.allPhotosFlat.length}`;
        
        // Update category badge
        const categoryBadge = document.getElementById('photoCategory');
        const isUnknown = photo.groupBibNumber === 'unknown' || 
                         !photo.detection_result || 
                         photo.detection_result.bib_number === 'unknown';
        if (isUnknown) {
            categoryBadge.textContent = 'Unknown';
            categoryBadge.className = 'badge bg-warning text-dark';
        } else {
            categoryBadge.textContent = 'Detected';
            categoryBadge.className = 'badge bg-info';
        }
        
        document.getElementById('photoFilename').textContent = photo.filename;
        document.getElementById('photoBibNumber').textContent = photo.groupBibNumber === 'unknown' ? 'Unknown' : photo.groupBibNumber;

        // Update confidence
        if (photo.detection_result) {
            const confidence = Math.round((photo.detection_result.confidence / 1.5) * 100);
            document.getElementById('photoConfidence').textContent = `${confidence}%`;
            document.getElementById('photoConfidenceDetail').textContent = `${confidence}%`;

            // Update confidence badge color
            const badge = document.getElementById('photoConfidence');
            badge.className = 'badge ' + this.getConfidenceBadgeClass(photo.detection_result.confidence);
        } else {
            document.getElementById('photoConfidence').textContent = 'N/A';
            document.getElementById('photoConfidenceDetail').textContent = 'Not detected';
            document.getElementById('photoConfidence').className = 'badge bg-secondary';
        }

        // Update navigation buttons
        document.getElementById('prevPhotoBtn').disabled = index === 0;
        document.getElementById('nextPhotoBtn').disabled = index === this.allPhotosFlat.length - 1;

        // Show/hide inline labeling for unknown photos
        this.updateInlineLabeling(photo);

        // Update thumbnail selection
        this.updateThumbnailSelection();

        // Reset zoom
        this.resetZoom();
    }

    initializeInlineLabeling() {
        console.log('initializeInlineLabeling called');

        const input = document.getElementById('inlineBibInput');

        console.log('Inline labeling input found:', !!input, 'disabled:', input?.disabled);

        if (!input) {
            console.error('Could not find inline labeling input');
            return;
        }

        // Ensure input is always enabled and clickable before setting up events
        input.disabled = false;
        input.style.pointerEvents = 'auto';
        input.style.cursor = 'text';

        // Remove any existing event listeners to prevent duplicates
        const newInput = input.cloneNode(true);
        input.parentNode.replaceChild(newInput, input);
        const freshInput = document.getElementById('inlineBibInput');
        
        // Ensure cloned input maintains clickable state and priority focus
        freshInput.disabled = false;
        freshInput.style.pointerEvents = 'auto';
        freshInput.style.cursor = 'text';
        freshInput.tabIndex = 1; // Higher priority than modal elements

        // Input keyboard events
        freshInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.saveInlineLabel();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.cancelInlineLabel();
            }
        });

        // Allow numbers and "unknown" - use input event for validation
        freshInput.addEventListener('input', (e) => {
            const value = e.target.value;
            // Allow "unknown" (case insensitive) or pure numbers
            if (value.toLowerCase() === 'unknown' || value.toLowerCase().startsWith('unkn')) {
                // Allow typing "unknown"
                return;
            } else {
                // For other values, only allow numbers
                const numericValue = value.replace(/[^0-9]/g, '');
                if (value !== numericValue) {
                    e.target.value = numericValue;
                }
            }
        });

        // Allow typing "unknown" and numbers on keypress
        freshInput.addEventListener('keypress', (e) => {
            const char = String.fromCharCode(e.which);
            const currentValue = e.target.value.toLowerCase();
            
            // Allow control keys
            if (e.ctrlKey || e.metaKey || e.which === 8 || e.which === 0) {
                return;
            }
            
            // If typing "unknown", allow relevant letters
            if (currentValue.startsWith('unkn') || 'unknown'.startsWith(currentValue + char.toLowerCase())) {
                return;
            }
            
            // Otherwise, only allow numbers
            if (!/[0-9]/.test(char)) {
                e.preventDefault();
            }
        });

        // Simple click handler - focus management no longer needed
        freshInput.addEventListener('click', (e) => {
            freshInput.focus();
        });

        // Input event handlers
        freshInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeLightbox();
            }
        });
        
        // Add event listener for "No Bib Visible" button
        const noBibBtn = document.getElementById('noBibVisibleBtn');
        if (noBibBtn) {
            noBibBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.saveInlineLabelAsNoBib();
            });
        }
        
        // Removed infinite loop focus fix that was causing console spam

        // Inline labeling initialized
    }

    updateInlineLabeling(photo) {
        const staticContainer = document.getElementById('photoBibNumberContainer');
        const staticDisplay = document.getElementById('photoBibNumber');
        const editBtn = document.getElementById('editBibBtn'); 
        const inlineContainer = document.getElementById('inlineLabelContainer');

        if (!staticContainer || !staticDisplay || !editBtn || !inlineContainer) {
            console.error('Missing DOM elements for inline labeling');
            return;
        }

        const isUnknown = photo.groupBibNumber === 'unknown' || 
                         (photo.detection_result && photo.detection_result.bib_number === 'unknown');

        // Always show the enhanced inline labeling interface for ALL photos
        // This ensures consistent UI between unknown and labeled photos
        staticContainer.classList.add('d-none');
        inlineContainer.classList.remove('d-none');
        this.setupEnhancedInlineLabeling(photo);
    }

    setupEnhancedInlineLabeling(photo) {
        const inlineContainer = document.getElementById('inlineLabelContainer');
        
        // Determine the current bib number for pre-filling
        let currentBibNumber = '';
        let detectionNote = '';
        
        if (photo.detection_result && photo.detection_result.bib_number && photo.detection_result.bib_number !== 'unknown') {
            currentBibNumber = photo.detection_result.bib_number;
            const confidence = Math.round((photo.detection_result.confidence / 1.5) * 100);
            detectionNote = `<div class="detection-note mb-2">
                <small class="text-info">
                    <i class="fas fa-robot me-1"></i>
                    AI detected: Bib #${currentBibNumber} (${confidence}% confidence)
                </small>
            </div>`;
        } else if (this.currentLightboxGroup && this.currentLightboxGroup.bib_number !== 'unknown') {
            currentBibNumber = this.currentLightboxGroup.bib_number;
        }
        
        // Create compact horizontal labeling interface
        const compactDetectionNote = detectionNote ? 
            detectionNote.replace('<div class="detection-note mb-2">', '<span class="detection-inline">').replace('</div>', '</span>') : '';
        
        inlineContainer.innerHTML = `
            <div class="inline-labeling-form">
                <span class="labeling-icon"><i class="fas fa-tag"></i></span>
                <span class="labeling-text">Label:</span>
                <div class="d-flex gap-2">
                    <input type="text" 
                           class="form-control" 
                           id="inlineBibInput" 
                           placeholder="Bib #" 
                           maxlength="6" 
                           pattern="[0-9]{1,6}"
                           autocomplete="off"
                           spellcheck="false"
                           value="${currentBibNumber}">
                    <button type="button" 
                            class="btn btn-outline-secondary btn-sm" 
                            id="noBibVisibleBtn"
                            title="Mark as no bib visible">
                        <i class="fas fa-eye-slash"></i> No Bib
                    </button>
                </div>
                ${compactDetectionNote}
            </div>
        `;
        
        // Re-initialize event listeners for the new elements after DOM update
        setTimeout(() => {
            this.initializeInlineLabeling();
            
            // Focus and select the input, ensuring it's enabled and clickable
            const input = document.getElementById('inlineBibInput');
            if (input) {
                input.disabled = false;
                input.style.pointerEvents = 'auto';
                input.style.cursor = 'text';
                
                // Input is ready for user interaction
                
                // Force focus and select
                input.focus();
                if (currentBibNumber) {
                    input.select();
                }
                // Input setup complete
                
                // Input is ready for interaction
            }
        }, 50);
    }

    enableEditMode() {
        
        if (!this.currentLightboxGroup || this.currentPhotoIndex < 0) return;

        const photo = this.currentLightboxGroup.photos[this.currentPhotoIndex];

        // Switch to edit mode
        this.isEditMode = true;
        
        // Trigger the UI update using the existing updateInlineLabeling function
        // The setupEnhancedInlineLabeling function will handle pre-filling and focus
        this.updateInlineLabeling(photo);
    }

    async saveInlineLabel() {
        const input = document.getElementById('inlineBibInput');
        if (!input) {
            console.error('Inline bib input not found');
            return;
        }

        const bibNumber = input.value.trim();

        if (!bibNumber || !this.validateBibNumber(bibNumber)) {
            this.showError('Please enter a valid bib number (1-6 digits, 1-99999)');
            input.focus();
            return;
        }

        if (!this.allPhotosFlat || this.currentPhotoIndex < 0 || this.currentPhotoIndex >= this.allPhotosFlat.length) {
            this.showError('No photo selected for labeling');
            return;
        }

        const photo = this.allPhotosFlat[this.currentPhotoIndex];

        // Store the original photo state before making changes
        const wasEditingDetectedPhoto = this.isEditMode;
        const wasUnknownPhoto = photo.groupBibNumber === 'unknown' || 
                               !photo.detection_result || 
                               photo.detection_result.bib_number === 'unknown';

        try {
            // Show loading state in input but keep it enabled to maintain clickability
            input.style.opacity = '0.6';
            input.value = 'Saving...';

            console.log(`Attempting to label photo ${photo.id} as bib #${bibNumber}`);

            // Save the label with timeout protection
            await Promise.race([
                this.labelPhoto(photo.id, bibNumber),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Save timeout')), 10000))
            ]);

            // Show success
            this.showSuccess(`Photo labeled as Bib #${bibNumber}`);

            // Refresh data with timeout protection
            await Promise.race([
                this.refreshAfterLabeling(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Refresh timeout')), 8000))
            ]);

            // Smart navigation based on original photo state, not current isEditMode
            if (wasEditingDetectedPhoto) {
                // For editing detected photos: stay in current photo, just refresh display
                this.isEditMode = false;
                const staticContainer = document.getElementById('photoBibNumberContainer');
                const inlineContainer = document.getElementById('inlineLabelContainer');
                if (staticContainer && inlineContainer) {
                    staticContainer.classList.remove('d-none');
                    inlineContainer.classList.add('d-none');
                }
                console.log('Staying on current photo after editing detected photo');
            } else if (wasUnknownPhoto) {
                // For unknown photos: advance to next unknown for rapid labeling
                console.log('Advancing to next unknown photo after labeling');
                this.advanceToNextUnknownPhoto();
            } else {
                // Fallback: stay on current photo
                console.log('Staying on current photo (fallback case)');
            }
            
            // CRITICAL: Restore input field state after successful completion
            // This was missing, causing the "Saving..." text to remain stuck
            input.disabled = false;
            input.style.opacity = '1';
            input.style.pointerEvents = 'auto';
            
            // Clear the input for unknown photos (ready for next), or restore for detected photos
            if (wasUnknownPhoto && !wasEditingDetectedPhoto) {
                input.value = ''; // Clear for next unknown photo
                input.focus(); // Keep focus for rapid labeling
            } else {
                input.value = bibNumber; // Show the saved value for detected photos
                input.blur(); // Remove focus since we're done editing
            }
            
            console.log('Input field restored after successful save');

        } catch (error) {
            console.error('Failed to label photo:', error);
            
            // Handle timeout vs other errors differently
            let errorMessage;
            if (error.message === 'Save timeout') {
                errorMessage = 'Save operation timed out. Please try again.';
            } else if (error.message === 'Refresh timeout') {
                errorMessage = 'Save completed but refresh timed out. Photo may still be labeled correctly.';
            } else {
                errorMessage = `Failed to label photo: ${error.message}`;
            }
            
            this.showError(errorMessage);
            
            // CRITICAL: Always restore input field state on any error
            // This ensures the input never remains stuck in "Saving..." state
            input.disabled = false;
            input.style.opacity = '1';
            input.value = bibNumber; // Restore the user's input
            input.style.pointerEvents = 'auto';
            input.focus();
            
            console.log('Input field fully restored after error:', error.message);
        }
    }

    async saveInlineLabelAsNoBib() {
        const input = document.getElementById('inlineBibInput');
        if (!input) {
            console.error('Inline bib input not found');
            return;
        }

        if (!this.allPhotosFlat || this.currentPhotoIndex < 0 || this.currentPhotoIndex >= this.allPhotosFlat.length) {
            this.showError('No photo selected for labeling');
            return;
        }

        const photo = this.allPhotosFlat[this.currentPhotoIndex];
        const bibNumber = 'unknown'; // Special value for "no bib visible"

        // Store the original photo state before making changes
        const wasEditingDetectedPhoto = this.isEditMode;
        const wasUnknownPhoto = photo.groupBibNumber === 'unknown' || 
                               !photo.detection_result || 
                               photo.detection_result.bib_number === 'unknown';

        try {
            // Show loading state in input
            input.style.opacity = '0.6';
            input.value = 'No bib visible...';

            console.log(`Marking photo ${photo.id} as no bib visible`);

            // Save the label with timeout protection
            await Promise.race([
                this.labelPhoto(photo.id, bibNumber),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Save timeout')), 10000))
            ]);

            // Show success
            this.showSuccess('Photo marked as "no bib visible"');

            // Refresh data with timeout protection
            await Promise.race([
                this.refreshAfterLabeling(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Refresh timeout')), 8000))
            ]);

            // Smart navigation based on original photo state
            if (wasEditingDetectedPhoto) {
                // For editing detected photos: stay in current photo, just refresh display
                this.isEditMode = false;
                const staticContainer = document.getElementById('photoBibNumberContainer');
                const inlineContainer = document.getElementById('inlineLabelContainer');
                if (staticContainer && inlineContainer) {
                    staticContainer.classList.remove('d-none');
                    inlineContainer.classList.add('d-none');
                }
                console.log('Staying on current photo after editing detected photo');
            } else if (wasUnknownPhoto) {
                // For unknown photos: advance to next unknown for rapid labeling
                console.log('Advancing to next unknown photo after marking as no bib visible');
                this.advanceToNextUnknownPhoto();
            } else {
                // Fallback: stay on current photo
                console.log('Staying on current photo (fallback case)');
            }
            
            // Restore input field state after successful completion
            input.disabled = false;
            input.style.opacity = '1';
            input.style.pointerEvents = 'auto';
            
            // Clear the input for unknown photos, or show "No Bib" for detected photos
            if (wasUnknownPhoto && !wasEditingDetectedPhoto) {
                input.value = ''; // Clear for next unknown photo
                input.focus(); // Keep focus for rapid labeling
            } else {
                input.value = 'No Bib'; // Show the saved state for detected photos
                input.blur(); // Remove focus since we're done editing
            }
            
            console.log('Input field restored after successful no bib save');

        } catch (error) {
            console.error('Failed to mark photo as no bib visible:', error);
            
            // Handle timeout vs other errors differently
            let errorMessage;
            if (error.message === 'Save timeout') {
                errorMessage = 'Save operation timed out. Please try again.';
            } else if (error.message === 'Refresh timeout') {
                errorMessage = 'Save completed but refresh timed out. Photo may still be labeled correctly.';
            } else {
                errorMessage = `Failed to mark photo: ${error.message}`;
            }
            
            this.showError(errorMessage);
            
            // Always restore input field state on any error
            input.disabled = false;
            input.style.opacity = '1';
            input.value = ''; // Clear the input on error
            input.style.pointerEvents = 'auto';
            input.focus();
            
            console.log('Input field fully restored after error:', error.message);
        }
    }

    cancelInlineLabel() {
        const input = document.getElementById('inlineBibInput');
        const staticContainer = document.getElementById('photoBibNumberContainer');
        const inlineContainer = document.getElementById('inlineLabelContainer');

        input.value = '';
        input.blur();

        // If we were in edit mode, go back to static display
        if (this.isEditMode) {
            this.isEditMode = false;
            staticContainer.classList.remove('d-none');
            inlineContainer.classList.add('d-none');
        }
        // For unknown photos, keep the inline input visible
    }

    advanceToNextUnknownPhoto() {
        if (!this.allPhotosFlat) return;

        // Find next unknown photo in the flat list starting from current position
        for (let i = this.currentPhotoIndex + 1; i < this.allPhotosFlat.length; i++) {
            const photo = this.allPhotosFlat[i];
            if (photo.groupBibNumber === 'unknown' || !photo.detection_result || photo.detection_result.bib_number === 'unknown') {
                this.showPhotoInLightbox(i);
                return;
            }
        }

        // If no more unknown photos found, show success message
        this.showSuccess('All photos have been labeled! 🎉');

        // Close modal after a brief delay
        setTimeout(() => {
            const modal = bootstrap.Modal.getInstance(document.getElementById('photoModal'));
            if (modal) modal.hide();
        }, 1500);
    }

    createThumbnailStrip() {
        const container = document.getElementById('thumbnailContainer');
        container.innerHTML = '';

        // Show thumbnails for all photos, but highlight current group
        const currentPhoto = this.allPhotosFlat[this.currentPhotoIndex];
        const currentGroupPhotos = this.allPhotosFlat.filter(photo => photo.groupBibNumber === currentPhoto.groupBibNumber);

        currentGroupPhotos.forEach((photo, localIndex) => {
            const globalIndex = this.allPhotosFlat.findIndex(p => p.id === photo.id);
            
            const thumbnailDiv = document.createElement('div');
            thumbnailDiv.className = 'thumbnail-item';
            thumbnailDiv.onclick = () => this.showPhotoInLightbox(globalIndex);

            const img = document.createElement('img');
            img.src = this.getImageUrl(photo.id);
            img.alt = photo.filename;

            thumbnailDiv.appendChild(img);
            container.appendChild(thumbnailDiv);
        });
    }

    updateThumbnailSelection() {
        const thumbnails = document.querySelectorAll('.thumbnail-item');
        const currentPhoto = this.allPhotosFlat[this.currentPhotoIndex];
        
        thumbnails.forEach((thumb) => {
            thumb.classList.remove('active');
        });
        
        // Find and highlight the current photo's thumbnail
        const currentPhotoThumbnails = Array.from(thumbnails);
        const currentGroupPhotos = this.allPhotosFlat.filter(photo => photo.groupBibNumber === currentPhoto.groupBibNumber);
        const localIndex = currentGroupPhotos.findIndex(photo => photo.id === currentPhoto.id);
        
        if (currentPhotoThumbnails[localIndex]) {
            currentPhotoThumbnails[localIndex].classList.add('active');
        }
    }

    previousPhoto() {
        console.log('🔍 DEBUG: previousPhoto called, current index:', this.currentPhotoIndex, 'total photos:', this.allPhotosFlat?.length);
        if (this.currentPhotoIndex > 0) {
            this.showPhotoInLightbox(this.currentPhotoIndex - 1);
        } else {
            console.log('🔍 DEBUG: Already at first photo');
        }
    }

    nextPhoto() {
        console.log('🔍 DEBUG: nextPhoto called, current index:', this.currentPhotoIndex, 'total photos:', this.allPhotosFlat?.length);
        if (this.currentPhotoIndex < this.allPhotosFlat.length - 1) {
            this.showPhotoInLightbox(this.currentPhotoIndex + 1);
        } else {
            console.log('🔍 DEBUG: Already at last photo');
        }
    }

    initializeZoom() {
        const modalImage = document.getElementById('modalPhotoImage');
        const photoContainer = document.getElementById('photoContainer');

        // Mouse wheel zoom
        photoContainer.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            this.adjustZoom(delta);
        });

        // Touch zoom (pinch)
        let initialDistance = 0;
        let initialZoom = 1;

        photoContainer.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                initialDistance = this.getTouchDistance(e.touches);
                initialZoom = this.zoomLevel;
            }
        });

        photoContainer.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const currentDistance = this.getTouchDistance(e.touches);
                const scale = currentDistance / initialDistance;
                this.zoomLevel = Math.max(0.5, Math.min(5, initialZoom * scale));
                this.applyZoom();
            }
        });

        // Drag to pan when zoomed
        let isDragging = false;
        let lastX = 0;
        let lastY = 0;

        modalImage.addEventListener('mousedown', (e) => {
            if (this.zoomLevel > 1) {
                e.preventDefault();
                isDragging = true;
                lastX = e.clientX;
                lastY = e.clientY;
                modalImage.classList.add('dragging');
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                e.preventDefault();
                const deltaX = e.clientX - lastX;
                const deltaY = e.clientY - lastY;
                this.panX += deltaX;
                this.panY += deltaY;
                this.applyZoom();
                lastX = e.clientX;
                lastY = e.clientY;
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                modalImage.classList.remove('dragging');
            }
        });
    }

    getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    adjustZoom(delta) {
        this.zoomLevel = Math.max(0.5, Math.min(5, this.zoomLevel + delta));
        this.applyZoom();
    }

    zoomIn() {
        this.adjustZoom(0.2);
    }

    zoomOut() {
        this.adjustZoom(-0.2);
    }

    resetZoom() {
        this.zoomLevel = 1;
        this.panX = 0;
        this.panY = 0;
        this.applyZoom();
    }

    applyZoom() {
        const modalImage = document.getElementById('modalPhotoImage');
        modalImage.style.transform = `scale(${this.zoomLevel}) translate(${this.panX / this.zoomLevel}px, ${this.panY / this.zoomLevel}px)`;

        if (this.zoomLevel > 1) {
            modalImage.classList.add('zoomed');
        } else {
            modalImage.classList.remove('zoomed');
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.getElementById('photoModal').requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    downloadCurrentPhoto() {
        if (this.currentLightboxGroup && this.currentPhotoIndex >= 0) {
            const photo = this.currentLightboxGroup.photos[this.currentPhotoIndex];
            window.open(this.getImageUrl(photo.id), '_blank');
        }
    }

    initializeLightboxKeyboard() {
        // Remove any existing listener to prevent duplicates
        if (this.lightboxKeyboardHandler) {
            document.removeEventListener('keydown', this.lightboxKeyboardHandler);
        }
        
        // Bind and store the handler for future removal
        this.lightboxKeyboardHandler = this.handleLightboxKeyboard.bind(this);
        document.addEventListener('keydown', this.lightboxKeyboardHandler);
    }

    handleLightboxKeyboard(e) {
        const modal = document.getElementById('photoModal');
        if (!modal.classList.contains('show')) return;

        // Check if we're in an input field
        const isInputFocused = document.activeElement && 
            (document.activeElement.tagName === 'INPUT' || 
             document.activeElement.tagName === 'TEXTAREA' ||
             document.activeElement.id === 'inlineBibInput');

        // For input fields: allow arrow keys for navigation, but block other keys that interfere with typing
        if (isInputFocused) {
            // Allow arrow keys for photo navigation even in input fields
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                // Continue to handle arrow keys below
            } else if (e.key === 'Enter' || e.key === 'Escape') {
                // Allow Enter and Escape to be handled by input event listeners
                return;
            } else {
                // Block all other keys to prevent interference with typing
                return;
            }
        }

        switch(e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                this.previousPhoto();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.nextPhoto();
                break;
            case 'Escape':
                bootstrap.Modal.getInstance(modal).hide();
                break;
            case '+':
            case '=':
                e.preventDefault();
                this.zoomIn();
                break;
            case '-':
                e.preventDefault();
                this.zoomOut();
                break;
            case '0':
                e.preventDefault();
                this.resetZoom();
                break;
            case 'f':
            case 'F11':
                e.preventDefault();
                this.toggleFullscreen();
                break;
        }
    }

    getConfidenceBadgeClass(confidence) {
        if (confidence >= 0.8) return 'bg-success';
        if (confidence >= 0.6) return 'bg-warning';
        return 'bg-danger';
    }


    showManualLabelModal() {
        const unknownGroup = this.groupedPhotos.find(group => group.bib_number === 'unknown');
        if (!unknownGroup || unknownGroup.photos.length === 0) {
            this.showError('No unknown photos found.');
            return;
        }

        const container = document.getElementById('unknown-photos-container');
        container.innerHTML = unknownGroup.photos.map(photo => `
            <div class="col-md-4 mb-3">
                <div class="card">
                    <img src="${this.getImageUrl(photo.id)}" 
                         class="card-img-top" 
                         style="height: 150px; object-fit: cover;"
                         alt="${photo.filename}">
                    <div class="card-body p-2">
                        <small class="text-muted d-block mb-2">${photo.filename}</small>
                        <div class="input-group input-group-sm mb-2">
                            <input type="text" 
                                   class="form-control manual-label-input" 
                                   data-photo-id="${photo.id}"
                                   placeholder="Bib #" 
                                   pattern="[0-9]+"
                                   title="Enter bib number (numbers only)">
                            <button class="btn btn-outline-success btn-sm" 
                                    type="button" 
                                    onclick="photoProcessor.applyLabelToPhoto('${photo.id}', this)">
                                <i class="fas fa-check"></i>
                            </button>
                        </div>
                        <button class="btn btn-outline-secondary btn-sm w-100" 
                                type="button" 
                                onclick="photoProcessor.applyNoBibToPhoto('${photo.id}', this)"
                                title="Mark as no bib visible">
                            <i class="fas fa-eye-slash"></i> No Bib Visible
                        </button>
                    </div>
                </div>
            </div>
        `).join('');

        // Add existing bib numbers as datalist for autocomplete
        const existingBibs = [...new Set(this.groupedPhotos
            .filter(group => group.bib_number !== 'unknown')
            .map(group => group.bib_number)
            .sort((a, b) => parseInt(a) - parseInt(b))
        )];

        if (existingBibs.length > 0) {
            const datalist = document.createElement('datalist');
            datalist.id = 'existing-bibs';
            datalist.innerHTML = existingBibs.map(bib => `<option value="${bib}"></option>`).join('');
            document.body.appendChild(datalist);

            // Add datalist to all inputs
            container.querySelectorAll('.manual-label-input').forEach(input => {
                input.setAttribute('list', 'existing-bibs');
            });
        }

        const modal = new bootstrap.Modal(document.getElementById('manualLabelModal'));
        modal.show();
    }

    async applyLabelToPhoto(photoId, buttonElement) {
        const input = buttonElement.parentElement.querySelector('.manual-label-input');
        const bibNumber = input.value.trim();

        if (!bibNumber) {
            this.showError('Please enter a bib number.');
            input.focus();
            return;
        }

        if (!/^\d+$/.test(bibNumber)) {
            this.showError('Bib number must contain only numbers.');
            input.focus();
            return;
        }

        try {
            buttonElement.disabled = true;
            buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

            const response = await fetch(`${this.apiBase}/process/manual-label`, {
                method: 'PUT',
                headers: this.getAuthHeaders(),
                credentials: 'include',
                body: JSON.stringify({
                    photo_id: photoId,
                    bib_number: bibNumber
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to label photo');
            }

            // Success - remove the photo from the unknown group and refresh display
            input.parentElement.parentElement.parentElement.remove();

            // Refresh the grouped photos from backend
            await this.refreshGroupedPhotos();

            this.showSuccess(`Photo labeled as bib #${bibNumber}!`);

        } catch (error) {
            console.error('Manual labeling error:', error);
            this.showError(`Failed to label photo: ${error.message}`);
        } finally {
            buttonElement.disabled = false;
            buttonElement.innerHTML = '<i class="fas fa-check"></i>';
        }
    }

    async applyNoBibToPhoto(photoId, buttonElement) {
        try {
            buttonElement.disabled = true;
            buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Marking...';

            const response = await fetch(`${this.apiBase}/process/manual-label`, {
                method: 'PUT',
                headers: this.getAuthHeaders(),
                credentials: 'include',
                body: JSON.stringify({
                    photo_id: photoId,
                    bib_number: 'unknown'  // Special value for "no bib visible"
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to mark photo');
            }

            // Success - remove the photo from the unknown group and refresh display
            buttonElement.closest('.col-md-3').remove();

            // Refresh the grouped photos from backend
            await this.refreshGroupedPhotos();

            this.showSuccess('Photo marked as "no bib visible"!');

        } catch (error) {
            console.error('No bib marking error:', error);
            this.showError(`Failed to mark photo: ${error.message}`);
        } finally {
            buttonElement.disabled = false;
            buttonElement.innerHTML = '<i class="fas fa-eye-slash"></i> No Bib Visible';
        }
    }

    async refreshGroupedPhotos() {
        if (!this.currentJobId) return;

        try {
            const response = await fetch(`${this.apiBase}/process/results/${this.currentJobId}`, {
                headers: this.getAuthHeaders(true),
                credentials: 'include'
            });
            if (response.ok) {
                this.groupedPhotos = await response.json();
                this.displayResults();
            }
        } catch (error) {
            console.error('Failed to refresh grouped photos:', error);
        }
    }

    showFeedbackModal() {
        // Track feedback modal open
        if (window.analyticsDashboard) {
            window.analyticsDashboard.trackEngagement('modal_open', 'feedback_modal');
        }
        
        // Reset form
        document.getElementById('feedbackForm').reset();
        document.getElementById('charCount').textContent = '0';

        // Auto-fill system information
        const systemInfo = this.getSystemInfo();
        document.getElementById('systemInfo').textContent = systemInfo;

        // Set up character counter
        const description = document.getElementById('feedbackDescription');
        const charCount = document.getElementById('charCount');

        description.addEventListener('input', function() {
            charCount.textContent = this.value.length;
        });

        // Set up form submission
        document.getElementById('submitFeedbackBtn').onclick = this.submitFeedback.bind(this);

        const modal = new bootstrap.Modal(document.getElementById('feedbackModal'));
        modal.show();
    }

    getSystemInfo() {
        const nav = navigator;
        const screen = window.screen;

        return `Browser: ${nav.userAgent} | Screen: ${screen.width}x${screen.height} | Language: ${nav.language} | Platform: ${nav.platform}`;
    }

    async submitFeedback() {
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
            system_info: this.getSystemInfo()
        };

        try {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Sending...';

            const response = await fetch(`${this.apiBase}/feedback/submit`, {
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

            const result = await response.json();

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

            this.showSuccess('Thank you for your feedback! We appreciate your input and will review it soon.');

        } catch (error) {
            console.error('Feedback submission error:', error);
            this.showError(`Failed to submit feedback: ${error.message}`);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane me-2"></i>Send Feedback';
        }
    }

    // Unknown Photos Page Methods
    showUnknownPhotosPage() {
        document.getElementById('results-section').classList.add('d-none');
        document.getElementById('unknown-photos-section').classList.remove('d-none');
        this.displayUnknownPhotos();
    }

    showMainResults() {
        document.getElementById('unknown-photos-section').classList.add('d-none');
        document.getElementById('results-section').classList.remove('d-none');
    }

    displayUnknownPhotos() {
        const unknownGroup = this.groupedPhotos.find(group => group.bib_number === 'unknown');
        const unknownPhotos = unknownGroup ? unknownGroup.photos : [];

        document.getElementById('unknown-count-display').textContent = unknownPhotos.length;

        if (unknownPhotos.length === 0) {
            document.getElementById('unknown-photos-grid').classList.add('d-none');
            document.getElementById('no-unknown-message').classList.remove('d-none');
            return;
        }

        document.getElementById('unknown-photos-grid').classList.remove('d-none');
        document.getElementById('no-unknown-message').classList.add('d-none');

        const gridHtml = unknownPhotos.map(photo => `
            <div class="col-lg-3 col-md-4 col-sm-6 mb-4">
                <div class="card h-100 unknown-photo-card" data-photo-id="${photo.id}">
                    <div class="position-relative">
                        <img src="${this.getImageUrl(photo.id)}" 
                             class="card-img-top" 
                             style="height: 200px; object-fit: cover; cursor: pointer;"
                             onclick="photoProcessor.showPhotoModal('${photo.id}', '${photo.filename}', 'unknown')"
                             loading="lazy">

                        <!-- Edit button -->
                        <div class="position-absolute top-0 end-0 p-2">
                            <button class="btn btn-primary btn-sm" 
                                    onclick="photoProcessor.showSinglePhotoLabelModal('${photo.id}')"
                                    title="Label this photo">
                                <i class="fas fa-tag"></i>
                            </button>
                        </div>
                    </div>

                    <div class="card-body p-2">
                        <p class="card-text small text-muted mb-1" title="${photo.filename}">
                            ${photo.filename.length > 20 ? photo.filename.substring(0, 20) + '...' : photo.filename}
                        </p>
                        <small class="text-warning">
                            <i class="fas fa-question-circle me-1"></i>
                            No bib detected
                        </small>
                    </div>
                </div>
            </div>
        `).join('');

        document.getElementById('unknown-photos-grid').innerHTML = gridHtml;

    }

    // Selection Management

    // Manual Labeling Methods
    currentPhotoToLabel = null;

    showSinglePhotoLabelModal(photoId) {
        this.currentPhotoToLabel = photoId;
        const photo = this.findPhotoById(photoId);

        if (!photo) return;

        // Set up modal content
        document.getElementById('labelPhotoPreview').src = this.getImageUrl(photoId);
        document.getElementById('labelPhotoFilename').textContent = photo.filename;
        document.getElementById('manualBibNumber').value = '';

        // Set current status
        const statusEl = document.getElementById('currentPhotoStatus');
        if (photo.detection_result && photo.detection_result.bib_number && photo.detection_result.bib_number !== 'unknown') {
            statusEl.innerHTML = `Currently labeled as Bib #${photo.detection_result.bib_number}`;
            statusEl.parentElement.className = 'alert alert-info mb-0';
        } else {
            statusEl.innerHTML = 'No bib number detected';
            statusEl.parentElement.className = 'alert alert-warning mb-0';
        }

        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('manualLabelModal'));
        modal.show();

        // Set up event listener
        this.setupSingleLabelEventListener();
    }

    setupSingleLabelEventListener() {
        const btn = document.getElementById('apply-single-label-btn');
        const input = document.getElementById('manualBibNumber');

        // Remove existing listeners
        btn.replaceWith(btn.cloneNode(true));
        const newBtn = document.getElementById('apply-single-label-btn');

        newBtn.addEventListener('click', () => this.applySingleLabel());

        // Allow Enter key to submit
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.applySingleLabel();
            }
        });
    }

    async applySingleLabel() {
        const bibNumber = document.getElementById('manualBibNumber').value.trim();

        if (!bibNumber || !this.validateBibNumber(bibNumber)) {
            this.showError('Please enter a valid bib number (1-6 digits, 1-99999)');
            return;
        }

        try {
            await this.labelPhoto(this.currentPhotoToLabel, bibNumber);

            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('manualLabelModal'));
            modal.hide();

            this.showSuccess(`Photo labeled as Bib #${bibNumber}`);

            // Refresh displays
            await this.refreshAfterLabeling();

        } catch (error) {
            this.showError(`Failed to label photo: ${error.message}`);
        }
    }


    // Helper Methods
    validateBibNumber(bibNumber) {
        // Allow "unknown" as a special case for "no bib visible"
        if (bibNumber.toLowerCase() === 'unknown') {
            return true;
        }
        // Standard numeric validation
        const num = parseInt(bibNumber);
        return /^\d{1,6}$/.test(bibNumber) && num >= 1 && num <= 99999;
    }

    findPhotoById(photoId) {
        for (const group of this.groupedPhotos) {
            const photo = group.photos.find(p => p.id === photoId);
            if (photo) return photo;
        }
        return null;
    }

    async labelPhoto(photoId, bibNumber) {
        // Track manual labeling action
        if (window.analyticsDashboard) {
            window.analyticsDashboard.trackEngagement('success_action', 'manual_label_applied', {
                photo_id: photoId,
                bib_number: bibNumber,
                action_type: 'manual_correction'
            });
        }
        
        const response = await fetch(`${this.apiBase}/process/manual-label`, {
            method: 'PUT',
            headers: this.getAuthHeaders(),
            credentials: 'include',
            body: JSON.stringify({
                photo_id: photoId,
                bib_number: bibNumber
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to label photo');
        }

        return await response.json();
    }

    async refreshAfterLabeling() {
        // Refresh the grouped photos data
        if (this.currentJobId) {
            try {
                const response = await fetch(`${this.apiBase}/process/results/${this.currentJobId}`, {
                    headers: this.getAuthHeaders(true),
                    credentials: 'include'
                });
                if (response.ok) {
                    this.groupedPhotos = await response.json();
                    this.updateStatsCards();
                    this.displayResults();

                    // If we're on unknown photos page, refresh it
                    if (!document.getElementById('unknown-photos-section').classList.contains('d-none')) {
                        this.displayUnknownPhotos();
                    }
                }
            } catch (error) {
                console.error('Failed to refresh data:', error);
            }
        }
    }

}

// Initialize the application with error handling
let photoProcessor;
try {
    photoProcessor = new PhotoProcessor();
    // Make it globally accessible for onclick handlers
    window.photoProcessor = photoProcessor;
    console.log('PhotoProcessor initialized successfully');
} catch (error) {
    console.error('Failed to initialize PhotoProcessor:', error);
    // Still assign a basic object to prevent undefined errors
    window.photoProcessor = {
        isAuthenticated: false,
        authToken: null,
        initializeApp: () => console.log('PhotoProcessor not fully initialized')
    };
}

// Profile functionality - CREATE NEW WORKING MODAL
async function showProfileModal() {
    // Track profile modal open
    if (window.analyticsDashboard) {
        window.analyticsDashboard.trackEngagement('modal_open', 'profile_modal');
    }
    console.log('showProfileModal called - creating new working modal');
    
    // Remove any existing custom modals
    const existingCustomModal = document.getElementById('customProfileModal');
    if (existingCustomModal) {
        existingCustomModal.remove();
    }
    
    // Create completely new modal structure
    const modalBackdrop = document.createElement('div');
    modalBackdrop.id = 'customProfileModal';
    modalBackdrop.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background-color: rgba(0, 0, 0, 0.5);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    
    // Create modal dialog
    const modalDialog = document.createElement('div');
    modalDialog.style.cssText = `
        background-color: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        width: 600px;
        max-width: 90vw;
        max-height: 90vh;
        overflow: auto;
        position: relative;
    `;
    
    // Create modal content with loading message first
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
    
    // Add close functionality
    const closeBtn = document.getElementById('customModalClose');
    const closeModal = () => {
        modalBackdrop.remove();
    };
    
    closeBtn.addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) {
            closeModal();
        }
    });
    
    // Load profile data
    try {
        await loadCustomProfileData();
    } catch (error) {
        console.error('Error loading profile data:', error);
        const contentDiv = document.getElementById('customModalContent');
        if (contentDiv) {
            contentDiv.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #dc3545;">
                    <h5>Error Loading Profile</h5>
                    <p>Unable to load profile data. Please try again later.</p>
                    <button onclick="this.closest('#customProfileModal').remove()" style="padding: 8px 16px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
                </div>
            `;
        }
    }
}

async function loadCustomProfileData() {
    try {
        // Load all data in parallel
        const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost';
        const apiBase = isDevelopment ? 
            `${window.location.protocol}//${window.location.hostname}:8000/api` : 
            `${window.location.protocol}//${window.location.host}/api`;
            
        const [quotaResponse, statsResponse, timelineResponse] = await Promise.all([
            fetch(`${apiBase}/users/me/quota`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
            }),
            fetch(`${apiBase}/users/me/stats`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
            }),
            fetch(`${apiBase}/users/me/timeline?days=7`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
            })
        ]);

        if (!quotaResponse.ok || !statsResponse.ok || !timelineResponse.ok) {
            throw new Error('Failed to load profile data');
        }

        const quotaData = await quotaResponse.json();
        const statsData = await statsResponse.json();
        const timelineData = await timelineResponse.json();

        // Update modal content
        updateCustomModalContent(quotaData, statsData, timelineData);
        
    } catch (error) {
        console.error('Error loading custom profile data:', error);
        throw error;
    }
}

function updateCustomModalContent(quotaData, statsData, timelineData) {
    const contentDiv = document.getElementById('customModalContent');
    if (!contentDiv) return;
    
    const user = statsData.user;
    const quota = quotaData.quota;
    const stats = statsData.stats;
    const timeline = timelineData.timeline;
    
    contentDiv.innerHTML = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <!-- Tabs -->
            <div style="display: flex; border-bottom: 1px solid #dee2e6; margin-bottom: 20px;">
                <button onclick="showCustomTab('quota')" id="quotaTab" style="padding: 10px 20px; border: none; background: none; border-bottom: 2px solid #007bff; color: #007bff; cursor: pointer; font-weight: 500;">Quota</button>
                <button onclick="showCustomTab('account')" id="accountTab" style="padding: 10px 20px; border: none; background: none; border-bottom: 2px solid transparent; color: #666; cursor: pointer;">Account</button>
                <button onclick="showCustomTab('activity')" id="activityTab" style="padding: 10px 20px; border: none; background: none; border-bottom: 2px solid transparent; color: #666; cursor: pointer;">Recent Activity</button>
            </div>
            
            <!-- Quota Tab -->
            <div id="quotaContent">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                    <h5 style="margin: 0 0 10px 0;">Monthly Photo Quota</h5>
                    <div style="font-size: 32px; font-weight: bold; margin-bottom: 5px;">
                        ${quota.photos_used_this_month}/${quota.monthly_photo_limit}
                    </div>
                    <div style="background: rgba(255,255,255,0.3); border-radius: 10px; height: 8px; margin-bottom: 10px;">
                        <div style="background: ${quota.photos_used_this_month >= quota.monthly_photo_limit ? '#ff6b6b' : '#4ecdc4'}; height: 8px; border-radius: 10px; width: ${Math.min(100, (quota.photos_used_this_month / quota.monthly_photo_limit) * 100)}%; transition: width 0.3s ease;"></div>
                    </div>
                    <p style="margin: 0; opacity: 0.9;">${Math.max(0, quota.monthly_photo_limit - quota.photos_used_this_month)} photos remaining this month</p>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #28a745;">${stats.total_photos_uploaded || 0}</div>
                        <div style="color: #666; font-size: 14px;">Total Photos Uploaded</div>
                    </div>
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center;">
                        <div style="font-size: 24px; font-weight: bold; color: #17a2b8;">${stats.total_processing_jobs || 0}</div>
                        <div style="color: #666; font-size: 14px;">Processing Jobs</div>
                    </div>
                </div>
            </div>
            
            <!-- Account Tab -->
            <div id="accountContent" style="display: none;">
                <div style="space-y: 15px;">
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; font-weight: 500; margin-bottom: 5px; color: #333;">Email</label>
                        <input type="email" value="${user.email}" readonly style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; background: #f8f9fa;">
                    </div>
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; font-weight: 500; margin-bottom: 5px; color: #333;">Full Name</label>
                        <input type="text" id="customFullName" value="${user.full_name || ''}" style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px;">
                    </div>
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; font-weight: 500; margin-bottom: 5px; color: #333;">Member Since</label>
                        <input type="text" value="${new Date(user.created_at).toLocaleDateString()}" readonly style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; background: #f8f9fa;">
                    </div>
                    <div style="text-align: right;">
                        <button onclick="updateCustomProfile()" style="padding: 8px 20px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Save Changes</button>
                    </div>
                </div>
            </div>
            
            <!-- Activity Tab -->
            <div id="activityContent" style="display: none;">
                ${timeline.length > 0 ? `
                    <div style="max-height: 300px; overflow-y: auto;">
                        ${timeline.map(item => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #eee;">
                                <div>
                                    <div style="font-weight: 500;">${item.action_display}</div>
                                    <div style="font-size: 12px; color: #666;">${new Date(item.created_at).toLocaleString()}</div>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-size: 14px; color: ${item.success ? '#28a745' : '#dc3545'};">
                                        ${item.success ? '✓' : '✗'}
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : `
                    <div style="text-align: center; padding: 40px; color: #666;">
                        <p>No recent activity found.</p>
                    </div>
                `}
            </div>
        </div>
    `;
}

function showCustomTab(tabName) {
    // Hide all content
    const contents = ['quotaContent', 'accountContent', 'activityContent'];
    contents.forEach(contentId => {
        const element = document.getElementById(contentId);
        if (element) element.style.display = 'none';
    });
    
    // Reset all tab styles
    const tabs = ['quotaTab', 'accountTab', 'activityTab'];
    tabs.forEach(tabId => {
        const element = document.getElementById(tabId);
        if (element) {
            element.style.borderBottomColor = 'transparent';
            element.style.color = '#666';
        }
    });
    
    // Show selected content and style active tab
    const contentElement = document.getElementById(tabName + 'Content');
    const tabElement = document.getElementById(tabName + 'Tab');
    
    if (contentElement) contentElement.style.display = 'block';
    if (tabElement) {
        tabElement.style.borderBottomColor = '#007bff';
        tabElement.style.color = '#007bff';
    }
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
            body: JSON.stringify({
                full_name: fullNameInput.value
            })
        });
        
        if (response.ok) {
            // Show success message
            const button = event.target;
            const originalText = button.textContent;
            button.textContent = 'Saved!';
            button.style.backgroundColor = '#28a745';
            
            setTimeout(() => {
                button.textContent = originalText;
                button.style.backgroundColor = '#007bff';
            }, 2000);
        } else {
            throw new Error('Failed to update profile');
        }
    } catch (error) {
        console.error('Error updating profile:', error);
        alert('Error updating profile. Please try again.');
    }
}

// Make profile functions globally accessible
window.showProfileModal = showProfileModal;
window.showCustomTab = showCustomTab;
window.updateCustomProfile = updateCustomProfile;

// Placeholder functions for future features
function showChangePasswordModal() {
    alert('Change password feature coming soon!');
}

function editProfile() {
    alert('Edit profile feature coming soon!');
}

// Keep existing duplicate assignments for backward compatibility
window.logout = logout;
window.showProfileModal = showProfileModal;
window.showChangePasswordModal = showChangePasswordModal;
window.editProfile = editProfile;

// Check authentication status when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded'); // Debug log
    checkAuthOnLoad();

    // Set up authentication form handlers
    const signInForm = document.getElementById('signInForm');
    const createAccountForm = document.getElementById('createAccountForm');

    console.log('Sign In Form found:', !!signInForm); // Debug log
    console.log('Create Account Form found:', !!createAccountForm); // Debug log

    if (signInForm) {
        signInForm.addEventListener('submit', handleSignIn);
        console.log('Sign In event listener attached'); // Debug log
    }

    if (createAccountForm) {
        createAccountForm.addEventListener('submit', handleCreateAccount);
        console.log('Create Account event listener attached'); // Debug log
    }
});