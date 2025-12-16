/**
 * AuthManager - Authentication management component
 * Coordinates authentication flows and replaces global auth functions
 * Manages modal switching and auth state changes
 */

import { BaseComponent } from '../BaseComponent.js';
import { SignInModal } from './SignInModal.js';
import { CreateAccountModal } from './CreateAccountModal.js';

export class AuthManager extends BaseComponent {
    constructor(options = {}) {
        super(null, {
            name: 'AuthManager',
            required: false, // No specific DOM element required
            ...options
        });

        // Modal instances
        this.signInModal = null;
        this.createAccountModal = null;

        // Authentication state
        this.isAuthenticated = false;
        this.currentUser = null;
    }

    async onInitialize() {
        // Initialize modals
        await this.initializeModals();

        // Listen for auth service events
        this.setupAuthServiceEvents();

        // Listen for modal switching events
        this.setupModalSwitchingEvents();

        // Listen for auth state changes
        this.setupAuthStateEvents();

        this.log('AuthManager initialized');
    }

    /**
     * Initialize authentication modals
     * @private
     */
    async initializeModals() {
        try {
            // Initialize sign in modal
            this.signInModal = new SignInModal();
            if (this.services) {
                this.signInModal.setServices(this.services);
            }
            await this.signInModal.initialize();
            this.addChild('signInModal', this.signInModal);

            // Initialize create account modal
            this.createAccountModal = new CreateAccountModal();
            if (this.services) {
                this.createAccountModal.setServices(this.services);
            }
            await this.createAccountModal.initialize();
            this.addChild('createAccountModal', this.createAccountModal);

            this.log('Authentication modals initialized');

        } catch (error) {
            this.warn('Some authentication modals failed to initialize:', error);
            // Don't throw - continue with what we have
        }
    }

    /**
     * Setup auth service event listeners
     * @private
     */
    setupAuthServiceEvents() {
        // Listen for auth state changes from service
        this.on('auth:signin:success', this.handleAuthSuccess);
        this.on('auth:register:success', this.handleAuthSuccess);
        this.on('auth:logout:success', this.handleLogout);
        this.on('auth:session_expired', this.handleSessionExpired);
    }

    /**
     * Setup modal switching events
     * @private
     */
    setupModalSwitchingEvents() {
        // Listen for switch events from modals
        this.on('auth:switch:to_create_account', () => {
            this.showCreateAccountModal();
        });

        this.on('auth:switch:to_signin', () => {
            this.showSignInModal();
        });
    }

    /**
     * Setup auth state events
     * @private
     */
    setupAuthStateEvents() {
        const authService = this.getService('authService');
        if (authService) {
            // Update initial state
            this.isAuthenticated = authService.getIsAuthenticated();
            this.currentUser = authService.getCurrentUser();

            // Listen for state changes
            this.on('auth:state:changed', this.handleAuthStateChanged);
        }
    }

    /**
     * Show sign in modal
     */
    async showSignInModal() {
        this.log('Showing sign in modal');

        if (this.signInModal) {
            await this.signInModal.show();
        } else {
            this.warn('Sign in modal not available');
        }

        // Track analytics
        this.trackAuthEvent('signin_modal_shown');
    }

    /**
     * Show create account modal  
     */
    async showCreateAccountModal() {
        this.log('Showing create account modal');

        if (this.createAccountModal) {
            await this.createAccountModal.show();
        } else {
            this.warn('Create account modal not available');
        }

        // Track analytics
        this.trackAuthEvent('create_account_modal_shown');
    }

    /**
     * Perform logout
     */
    async logout() {
        const authService = this.getService('authService');
        if (!authService) {
            this.warn('AuthService not available for logout');
            return;
        }

        try {
            this.log('Performing logout');
            await authService.logout();
            
            // The handleLogout method will be called via event
        } catch (error) {
            this.error('Logout failed:', error);
        }
    }

    /**
     * Handle successful authentication
     * @private
     */
    handleAuthSuccess = (data) => {
        this.log('Authentication successful', data);

        this.isAuthenticated = true;
        this.currentUser = data.user;

        // Update UI state
        this.updateUIForAuthenticated();

        // Track analytics
        this.trackAuthEvent('authentication_success', {
            method: data.user ? 'signin' : 'register'
        });
    };

    /**
     * Handle logout
     * @private
     */
    handleLogout = () => {
        this.log('User logged out');

        this.isAuthenticated = false;
        this.currentUser = null;

        // Update UI state
        this.updateUIForUnauthenticated();

        // Track analytics
        this.trackAuthEvent('logout');
    };

    /**
     * Handle session expiration
     * @private
     */
    handleSessionExpired = () => {
        this.log('Session expired');

        this.isAuthenticated = false;
        this.currentUser = null;

        // Show notification
        this.showSessionExpiredNotification();

        // Update UI state
        this.updateUIForUnauthenticated();

        // Track analytics
        this.trackAuthEvent('session_expired');
    };

    /**
     * Handle auth state changes
     * @private
     */
    handleAuthStateChanged = (data) => {
        this.log('Auth state changed', data);

        this.isAuthenticated = data.isAuthenticated;
        this.currentUser = data.user;

        if (data.isAuthenticated) {
            this.updateUIForAuthenticated();
        } else {
            this.updateUIForUnauthenticated();
        }
    };

    /**
     * Update UI for authenticated state
     * @private
     */
    updateUIForAuthenticated() {
        // Show app section
        if (typeof window.showAppSection === 'function') {
            window.showAppSection();
        }

        // Update navigation elements
        this.updateNavigationForAuth(true);

        // Hide any open auth modals
        if (this.signInModal && this.signInModal.isVisible()) {
            this.signInModal.hide();
        }
        if (this.createAccountModal && this.createAccountModal.isVisible()) {
            this.createAccountModal.hide();
        }
    }

    /**
     * Update UI for unauthenticated state
     * @private
     */
    updateUIForUnauthenticated() {
        // Show landing page
        if (typeof window.showLandingPage === 'function') {
            window.showLandingPage();
        }

        // Update navigation elements
        this.updateNavigationForAuth(false);

        // Clear any app state
        this.clearAppState();
    }

    /**
     * Update navigation elements based on auth state
     * @private
     */
    updateNavigationForAuth(isAuthenticated) {
        // Update profile dropdown visibility
        const profileElements = document.querySelectorAll('.user-profile, .auth-required');
        const authElements = document.querySelectorAll('.auth-buttons, .auth-links');

        if (isAuthenticated) {
            profileElements.forEach(el => el.classList.remove('d-none'));
            authElements.forEach(el => el.classList.add('d-none'));

            // Update user display
            if (this.currentUser) {
                const userNameElements = document.querySelectorAll('.user-name');
                userNameElements.forEach(el => {
                    el.textContent = this.currentUser.name || this.currentUser.email;
                });
            }
        } else {
            profileElements.forEach(el => el.classList.add('d-none'));
            authElements.forEach(el => el.classList.remove('d-none'));
        }
    }

    /**
     * Clear application state on logout
     * @private
     */
    clearAppState() {
        // Reset PhotoProcessor state if it exists
        if (window.photoProcessor && typeof window.photoProcessor.resetApp === 'function') {
            window.photoProcessor.resetApp();
        }

        // Clear StateManager if it exists
        if (window.stateManager && typeof window.stateManager.logout === 'function') {
            window.stateManager.logout();
        }
    }

    /**
     * Show session expired notification
     * @private
     */
    showSessionExpiredNotification() {
        // Use NotificationComponent if available, otherwise simple alert
        if (typeof window.showNotification === 'function') {
            window.showNotification('Your session has expired. Please sign in again.', 'warning');
        } else {
            alert('Your session has expired. Please sign in again.');
        }
    }

    /**
     * Track authentication events
     * @private
     */
    trackAuthEvent(event, data = {}) {
        try {
            if (typeof window !== 'undefined' && window.analyticsDashboard) {
                window.analyticsDashboard.trackEngagement('auth_action', event, {
                    category: 'authentication',
                    ...data
                });
            }
        } catch (error) {
            this.warn('Analytics tracking failed:', error);
        }
    }

    /**
     * Get current authentication state
     */
    getAuthState() {
        return {
            isAuthenticated: this.isAuthenticated,
            user: this.currentUser,
            hasSignInModal: !!this.signInModal,
            hasCreateAccountModal: !!this.createAccountModal
        };
    }

    /**
     * Check if user is authenticated
     */
    isUserAuthenticated() {
        return this.isAuthenticated;
    }

    /**
     * Get current user
     */
    getCurrentUser() {
        return this.currentUser;
    }

    /**
     * Set services and propagate to child components
     */
    setServices(services) {
        super.setServices(services);

        // Update modals with services
        if (this.signInModal) {
            this.signInModal.setServices(services);
        }
        if (this.createAccountModal) {
            this.createAccountModal.setServices(services);
        }

        // Re-setup auth service events with new services
        this.setupAuthServiceEvents();
        this.setupAuthStateEvents();
    }

    /**
     * Static helper to create global auth manager
     */
    static async createGlobal(services = null, options = {}) {
        const authManager = new AuthManager(options);
        
        if (services) {
            authManager.setServices(services);
        }

        await authManager.initialize();

        // Make available globally to replace old functions
        if (typeof window !== 'undefined') {
            window.authManager = authManager;
            
            // Create global function replacements
            window.showSignInModal = () => authManager.showSignInModal();
            window.showCreateAccountModal = () => authManager.showCreateAccountModal();
            window.switchToCreateAccount = () => authManager.showCreateAccountModal();
            window.switchToSignIn = () => authManager.showSignInModal();
            window.logout = () => authManager.logout();
        }

        return authManager;
    }
}