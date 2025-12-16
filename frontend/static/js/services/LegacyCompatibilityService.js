/**
 * LegacyCompatibilityService - Bridge for global functions and legacy compatibility
 * Extracts global functions from script.js and provides service-based replacements
 * Maintains backward compatibility while enabling clean service architecture
 */

import { BaseService } from './BaseService.js';

export class LegacyCompatibilityService extends BaseService {
    constructor(eventBus, options = {}) {
        super(eventBus, {
            name: 'LegacyCompatibilityService',
            enableGlobalFunctions: true,
            enableStateSync: true,
            ...options
        });

        // Service dependencies
        this.authService = null;
        this.notificationService = null;
        this.routerService = null;
        this.stateManagerService = null;
        this.profileService = null;

        // Global function registry
        this.globalFunctions = new Map();
    }

    /**
     * Initialize compatibility service
     */
    async onInitialize() {
        // Get service dependencies
        this.authService = this.serviceContainer?.get('authService');
        this.notificationService = this.serviceContainer?.get('notificationService');
        this.routerService = this.serviceContainer?.get('routerService');
        this.stateManagerService = this.serviceContainer?.get('stateManagerService');
        this.profileService = this.serviceContainer?.get('profileService');

        // Setup global functions
        this.setupGlobalFunctions();

        // Setup event listeners for legacy compatibility
        this.setupLegacyEventHandlers();

        this.log('LegacyCompatibilityService initialized');
    }

    /**
     * Setup global functions for legacy compatibility
     * @private
     */
    setupGlobalFunctions() {
        // Notification functions
        this.registerGlobalFunction('showNotification', this.showNotification.bind(this));
        
        // Authentication functions
        this.registerGlobalFunction('logout', this.logout.bind(this));
        this.registerGlobalFunction('checkAuthOnLoad', this.checkAuthOnLoad.bind(this));
        
        // Navigation functions (for legacy compatibility)
        this.registerGlobalFunction('showLandingPage', this.showLandingPage.bind(this));
        this.registerGlobalFunction('showAppSection', this.showAppSection.bind(this));
        
        // State management functions
        this.registerGlobalFunction('getCurrentUser', this.getCurrentUser.bind(this));
        this.registerGlobalFunction('isAuthenticated', this.isAuthenticated.bind(this));

        this.log('Global functions registered', { 
            count: this.globalFunctions.size,
            functions: Array.from(this.globalFunctions.keys())
        });
    }

    /**
     * Register a global function for legacy compatibility
     * @private
     */
    registerGlobalFunction(name, implementation) {
        this.globalFunctions.set(name, implementation);
        
        if (this.options.enableGlobalFunctions && typeof window !== 'undefined') {
            window[name] = implementation;
        }
    }

    /**
     * Setup legacy event handlers
     * @private
     */
    setupLegacyEventHandlers() {
        // Handle auth state changes
        this.on('auth:signin:success', this.handleAuthSuccess.bind(this));
        this.on('auth:signout:success', this.handleAuthSignout.bind(this));
        this.on('auth:logout:success', this.handleAuthSignout.bind(this));

        // Handle notification requests
        this.on('notification:request', this.handleNotificationRequest.bind(this));
    }

    /**
     * Show notification (replaces global showNotification function)
     */
    showNotification(message, type = 'info') {
        if (this.notificationService) {
            return this.notificationService.show(message, type);
        }

        // Fallback to legacy implementation
        this.showNotificationFallback(message, type);
    }

    /**
     * Fallback notification implementation (from original script.js)
     * @private
     */
    showNotificationFallback(message, type = 'info') {
        const alertClass = type === 'error' ? 'alert-danger' : 
                          type === 'success' ? 'alert-success' : 'alert-info';
        const iconClass = type === 'error' ? 'fa-exclamation-triangle' : 
                         type === 'success' ? 'fa-check-circle' : 'fa-info-circle';

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

    /**
     * Logout function (delegates to AuthService)
     */
    async logout() {
        try {
            if (this.authService) {
                await this.authService.logout();
            } else {
                // Fallback to original implementation
                this.logoutFallback();
            }
        } catch (error) {
            this.error('Logout failed:', error);
            this.logoutFallback();
        }
    }

    /**
     * Fallback logout implementation (from original script.js)
     * @private
     */
    logoutFallback() {
        // Clear auth token and show landing page
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_info');
        
        // Navigate to home
        if (this.routerService) {
            this.routerService.navigateTo('home');
        } else {
            window.location.hash = '';
            this.showLandingPage();
        }

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
                this.log('StateManager auth state cleared after logout');
            } catch (error) {
                this.error('Failed to clear StateManager auth state:', error);
            }
        }

        // Emit event for other components
        this.emit('auth:logout:complete');
    }

    /**
     * Check authentication status on page load
     */
    async checkAuthOnLoad() {
        try {
            if (this.authService) {
                const isAuthenticated = this.authService.getIsAuthenticated();
                
                if (isAuthenticated) {
                    this.showAppSection();
                } else {
                    this.showLandingPage();
                }
                
                return isAuthenticated;
            } else {
                // Fallback to legacy implementation
                return this.checkAuthOnLoadFallback();
            }
        } catch (error) {
            this.error('Auth check failed:', error);
            this.showLandingPage();
            return false;
        }
    }

    /**
     * Fallback auth check implementation
     * @private
     */
    checkAuthOnLoadFallback() {
        const token = localStorage.getItem('auth_token');
        if (token) {
            // User is authenticated, show app section
            this.showAppSection();
            return true;
        } else {
            // User is not authenticated, show landing page
            this.showLandingPage();
            return false;
        }
    }

    /**
     * Show landing page
     */
    showLandingPage() {
        if (this.routerService) {
            this.routerService.navigateTo('home');
        } else {
            // Fallback to direct DOM manipulation
            this.showLandingPageDirect();
        }
    }

    /**
     * Direct landing page implementation
     * @private
     */
    showLandingPageDirect() {
        const landingPage = document.getElementById('landing-page');
        const appSection = document.getElementById('app-section');

        if (landingPage) {
            landingPage.classList.remove('d-none');
        }
        if (appSection) {
            appSection.classList.add('d-none');
        }
    }

    /**
     * Show app section
     */
    showAppSection() {
        if (this.routerService) {
            this.routerService.navigateTo('app');
        } else {
            // Fallback to direct DOM manipulation
            this.showAppSectionDirect();
        }
    }

    /**
     * Direct app section implementation
     * @private
     */
    showAppSectionDirect() {
        const landingPage = document.getElementById('landing-page');
        const appSection = document.getElementById('app-section');

        if (landingPage) {
            landingPage.classList.add('d-none');
        }
        if (appSection) {
            appSection.classList.remove('d-none');
        }
    }

    /**
     * Get current user
     */
    getCurrentUser() {
        if (this.profileService) {
            return this.profileService.getCurrentProfile();
        }

        if (this.authService) {
            return this.authService.getCurrentUser();
        }

        // Fallback to localStorage
        try {
            const userInfo = localStorage.getItem('user_info');
            return userInfo ? JSON.parse(userInfo) : null;
        } catch {
            return null;
        }
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        if (this.authService) {
            return this.authService.getIsAuthenticated();
        }

        // Fallback to token check
        return !!localStorage.getItem('auth_token');
    }

    /**
     * Handle authentication success
     * @private
     */
    handleAuthSuccess(data) {
        // Sync with any legacy state systems
        if (window.photoProcessor) {
            window.photoProcessor.isAuthenticated = true;
            window.photoProcessor.authToken = data.token;
        }

        // Update StateManager if available
        if (this.stateManagerService && this.options.enableStateSync) {
            try {
                this.stateManagerService.update({
                    'auth.isAuthenticated': true,
                    'auth.token': data.token,
                    'auth.user': data.user
                });
            } catch (error) {
                this.warn('Failed to update StateManagerService auth state:', error);
            }
        } else if (window.stateManager && this.options.enableStateSync) {
            // Legacy fallback
            try {
                window.stateManager.set('auth.isAuthenticated', true);
                window.stateManager.set('auth.token', data.token);
                window.stateManager.set('auth.user', data.user);
            } catch (error) {
                this.warn('Failed to update legacy StateManager auth state:', error);
            }
        }
    }

    /**
     * Handle authentication signout
     * @private
     */
    handleAuthSignout() {
        // Clear legacy state
        if (window.photoProcessor) {
            window.photoProcessor.isAuthenticated = false;
            window.photoProcessor.authToken = null;
        }

        // Update StateManager if available
        if (this.stateManagerService && this.options.enableStateSync) {
            try {
                this.stateManagerService.update({
                    'auth.isAuthenticated': false,
                    'auth.token': null,
                    'auth.user': null
                });
            } catch (error) {
                this.warn('Failed to clear StateManagerService auth state:', error);
            }
        } else if (window.stateManager && this.options.enableStateSync) {
            // Legacy fallback
            try {
                window.stateManager.set('auth.isAuthenticated', false);
                window.stateManager.set('auth.token', null);
                window.stateManager.set('auth.user', null);
            } catch (error) {
                this.warn('Failed to clear legacy StateManager auth state:', error);
            }
        }
    }

    /**
     * Handle notification requests
     * @private
     */
    handleNotificationRequest(data) {
        const { message, type = 'info' } = data;
        this.showNotification(message, type);
    }

    /**
     * Get compatibility statistics
     */
    getStats() {
        return {
            globalFunctions: {
                count: this.globalFunctions.size,
                functions: Array.from(this.globalFunctions.keys())
            },
            serviceConnections: {
                authService: !!this.authService,
                notificationService: !!this.notificationService,
                routerService: !!this.routerService,
                stateManagerService: !!this.stateManagerService,
                profileService: !!this.profileService
            },
            legacyState: {
                hasPhotoProcessor: !!window.photoProcessor,
                hasStateManager: !!window.stateManager,
                hasAuthToken: !!localStorage.getItem('auth_token')
            }
        };
    }

    /**
     * Cleanup global functions and listeners
     */
    async cleanup() {
        // Remove global functions if we created them
        if (this.options.enableGlobalFunctions && typeof window !== 'undefined') {
            for (const functionName of this.globalFunctions.keys()) {
                delete window[functionName];
            }
        }

        // Clear registries
        this.globalFunctions.clear();

        await super.cleanup();
    }
}