/**
 * AuthService - Authentication service for TagSort
 * Handles user authentication, session management, and token lifecycle
 */

import { BaseService } from './BaseService.js';
import { AppError, ErrorTypes } from '../utils/errors.js';
import { validateEmail, validateRequired } from '../utils/validation.js';

export class AuthService extends BaseService {
    constructor(eventBus, apiService, stateManager, config = {}) {
        super(eventBus, {
            name: 'AuthService',
            tokenRefreshMargin: 5 * 60 * 1000, // Refresh 5 minutes before expiry
            sessionCheckInterval: 60 * 1000, // Check session every minute
            ...config
        });

        this.apiService = apiService;
        this.stateManager = stateManager;
        
        // Authentication state
        this.isAuthenticated = false;
        this.currentUser = null;
        this.token = null;
        this.refreshToken = null;
        this.tokenExpiresAt = null;
        
        // Session check timer
        this.sessionCheckTimer = null;
        
        // Bind methods
        this.handleTokenRefresh = this.handleTokenRefresh.bind(this);
    }

    async onInitialize() {
        // Restore authentication state from StateManager
        this.restoreAuthState();
        
        // Setup session monitoring
        this.setupSessionMonitoring();
        
        this.log('AuthService initialized', {
            isAuthenticated: this.isAuthenticated,
            hasUser: !!this.currentUser
        });
    }

    async onStart() {
        // Validate existing session if authenticated
        if (this.isAuthenticated && this.token) {
            try {
                await this.validateSession();
            } catch (error) {
                this.warn('Session validation failed, clearing auth state:', error);
                await this.logout();
            }
        }
    }

    async onStop() {
        // Clear session monitoring
        this.clearSessionMonitoring();
    }

    /**
     * Restore authentication state from StateManager
     * @private
     */
    restoreAuthState() {
        if (!this.stateManager) return;

        try {
            this.isAuthenticated = this.stateManager.get('auth.isAuthenticated') || false;
            this.currentUser = this.stateManager.get('auth.user') || null;
            this.token = this.stateManager.get('auth.token') || null;
            this.refreshToken = this.stateManager.get('auth.refreshToken') || null;
            this.tokenExpiresAt = this.stateManager.get('auth.tokenExpiresAt') || null;

            if (this.tokenExpiresAt && typeof this.tokenExpiresAt === 'string') {
                this.tokenExpiresAt = new Date(this.tokenExpiresAt);
            }

            this.log('Auth state restored from StateManager');
        } catch (error) {
            this.warn('Failed to restore auth state:', error);
            this.clearAuthState();
        }
    }

    /**
     * Update authentication state in StateManager
     * @private
     */
    updateAuthState() {
        if (!this.stateManager) return;

        try {
            this.stateManager.update({
                'auth.isAuthenticated': this.isAuthenticated,
                'auth.token': this.token,
                'auth.refreshToken': this.refreshToken,
                'auth.user': this.currentUser,
                'auth.tokenExpiresAt': this.tokenExpiresAt
            });
        } catch (error) {
            this.warn('Failed to update auth state in StateManager:', error);
        }
    }

    /**
     * Clear authentication state
     * @private
     */
    clearAuthState() {
        this.isAuthenticated = false;
        this.currentUser = null;
        this.token = null;
        this.refreshToken = null;
        this.tokenExpiresAt = null;
        
        this.updateAuthState();
    }

    /**
     * Sign in user with email and password
     * @param {string} email - User email
     * @param {string} password - User password
     * @returns {Promise<object>} User data
     */
    async signIn(email, password) {
        this.ensureReady();
        
        // Validate input
        this.validateRequired({ email, password }, ['email', 'password']);
        
        if (!validateEmail(email)) {
            throw new AppError('Invalid email format', ErrorTypes.VALIDATION);
        }

        try {
            this.log('Attempting user sign in');
            this.log('Login request payload:', { email: email.trim(), password: '[HIDDEN]' });
            
            const response = await this.apiService.post('/auth/login', {
                email: email.trim(),
                password
            });

            this.log('Raw API response received:', response);
            this.log('Response type:', typeof response);
            this.log('Response constructor:', response?.constructor?.name);
            this.log('Response is null/undefined:', response == null);
            this.log('Response === null:', response === null);
            this.log('Response === undefined:', response === undefined);

            // Process authentication response
            await this.processAuthResponse(response);
            
            this.emit('auth:signin:success', { user: this.currentUser });
            this.log('User signed in successfully');
            
            return this.currentUser;
            
        } catch (error) {
            this.error('Sign in failed - error details:', error);
            this.error('Error type:', error.constructor.name);
            this.error('Error message:', error.message);
            this.error('Error stack:', error.stack);
            
            this.emit('auth:signin:error', { error });
            throw error;
        }
    }

    /**
     * Create new user account
     * @param {object} userData - User registration data
     * @returns {Promise<object>} User data
     */
    async createAccount(userData) {
        this.ensureReady();
        
        // Validate required fields
        this.validateRequired(userData, ['name', 'email', 'password']);
        
        const { name, email, password } = userData;
        
        if (!validateEmail(email)) {
            throw new AppError('Invalid email format', ErrorTypes.VALIDATION);
        }

        if (password.length < 8) {
            throw new AppError('Password must be at least 8 characters long', ErrorTypes.VALIDATION);
        }

        try {
            this.log('Attempting to create user account');
            
            const response = await this.apiService.post('/auth/register', {
                full_name: name.trim(),
                email: email.trim(),
                password,
                confirm_password: password
            });

            // Process authentication response
            await this.processAuthResponse(response);
            
            this.emit('auth:register:success', { user: this.currentUser });
            this.log('User account created successfully');
            
            return this.currentUser;
            
        } catch (error) {
            this.emit('auth:register:error', { error });
            this.error('Account creation failed:', error);
            throw error;
        }
    }

    /**
     * Sign out current user
     * @returns {Promise<void>}
     */
    async logout() {
        try {
            this.log('Attempting user logout');
            
            // Call backend logout if we have a token
            if (this.token) {
                try {
                    await this.apiService.post('/auth/logout');
                } catch (error) {
                    this.warn('Backend logout failed (continuing anyway):', error);
                }
            }
            
            // Clear authentication state
            this.clearAuthState();
            
            // Clear session monitoring
            this.clearSessionMonitoring();
            
            this.emit('auth:logout:success');
            this.log('User logged out successfully');
            
        } catch (error) {
            this.emit('auth:logout:error', { error });
            this.error('Logout failed:', error);
            // Continue with local logout even if backend fails
            this.clearAuthState();
        }
    }

    /**
     * Validate current session
     * @returns {Promise<boolean>} True if session is valid
     */
    async validateSession() {
        if (!this.token) {
            return false;
        }

        try {
            const response = await this.apiService.post('/auth/validate');
            
            if (response && response.valid) {
                this.log('Session validation successful');
                return true;
            } else {
                this.warn('Session validation failed - invalid session');
                await this.logout();
                return false;
            }
            
        } catch (error) {
            this.warn('Session validation failed:', error);
            
            // If it's an auth error, logout
            if (error.type === ErrorTypes.AUTHENTICATION) {
                await this.logout();
            }
            
            return false;
        }
    }

    /**
     * Refresh authentication token
     * @returns {Promise<boolean>} True if refresh successful
     */
    async refreshAuthToken() {
        if (!this.refreshToken) {
            throw new AppError('No refresh token available', ErrorTypes.AUTHENTICATION);
        }

        try {
            this.log('Attempting token refresh');
            
            const response = await this.apiService.post('/auth/refresh', {}, {
                headers: {
                    'Authorization': `Bearer ${this.refreshToken}`
                }
            });

            // Update tokens
            this.token = response.access_token;
            this.refreshToken = response.refresh_token;
            this.tokenExpiresAt = new Date(Date.now() + response.expires_in * 1000);
            
            this.updateAuthState();
            
            this.emit('auth:token:refreshed');
            this.log('Token refresh successful');
            
            return true;
            
        } catch (error) {
            this.emit('auth:token:refresh_failed', { error });
            this.error('Token refresh failed:', error);
            
            // If refresh fails, logout user
            await this.logout();
            throw error;
        }
    }

    /**
     * Process authentication response from login/register
     * @private
     * @param {object} response - Auth response data
     */
    async processAuthResponse(response) {
        this.log('Processing auth response - typeof:', typeof response);
        this.log('Processing auth response - keys:', response ? Object.keys(response) : 'null');
        this.log('Processing auth response - full response:', JSON.stringify(response, null, 2));
        
        if (!response) {
            throw new AppError('No authentication response received', ErrorTypes.CLIENT);
        }

        // Handle different possible response formats from the backend
        let token, refreshToken, user, expiresIn;
        
        // Check for our backend's specific format first: {token: "...", user: {...}, message: "..."}
        if (response.token && response.user) {
            // TagSort backend format
            token = response.token;
            refreshToken = response.refresh_token || null; // Backend doesn't use refresh tokens yet
            user = response.user;
            expiresIn = response.expires_in || (7 * 24 * 60 * 60); // Default 7 days (backend default)
            this.log('Using TagSort backend format');
        } else if (response.access_token) {
            // Standard OAuth2 format
            token = response.access_token;
            refreshToken = response.refresh_token;
            user = response.user;
            expiresIn = response.expires_in;
            this.log('Using OAuth2 format');
        } else if (response.accessToken) {
            // camelCase format
            token = response.accessToken;
            refreshToken = response.refreshToken;
            user = response.user;
            expiresIn = response.expiresIn || (24 * 60 * 60);
            this.log('Using camelCase format');
        } else {
            // Check if the response itself is the user object with token
            if (response.id && (response.email || response.username)) {
                // Response is user object, check for token in localStorage or assume simple auth
                const storedToken = localStorage.getItem('auth_token');
                if (storedToken) {
                    token = storedToken;
                    user = response;
                    expiresIn = 24 * 60 * 60; // Default 24h
                    this.log('Using user object with stored token format');
                } else {
                    throw new AppError('Authentication response missing token', ErrorTypes.CLIENT);
                }
            } else {
                this.error('Unrecognized response format. Available keys:', Object.keys(response));
                throw new AppError('Invalid authentication response format', ErrorTypes.CLIENT);
            }
        }

        if (!token) {
            throw new AppError('Authentication token not found in response', ErrorTypes.CLIENT);
        }

        if (!user) {
            this.warn('User data not found in auth response, using minimal user object');
            user = { id: 'unknown', email: 'unknown' };
        }

        this.log('Auth response processed successfully:', {
            hasToken: !!token,
            hasRefreshToken: !!refreshToken,
            hasUser: !!user,
            expiresIn
        });

        this.isAuthenticated = true;
        this.token = token;
        this.refreshToken = refreshToken;
        this.currentUser = user;
        this.tokenExpiresAt = new Date(Date.now() + (expiresIn * 1000));
        
        // Update state
        this.updateAuthState();
        
        // Setup session monitoring
        this.setupSessionMonitoring();
        
        this.emit('auth:state:changed', { 
            isAuthenticated: true, 
            user: this.currentUser 
        });
    }

    /**
     * Setup session monitoring for token refresh
     * @private
     */
    setupSessionMonitoring() {
        this.clearSessionMonitoring();
        
        if (!this.isAuthenticated || !this.tokenExpiresAt) {
            return;
        }

        this.sessionCheckTimer = setInterval(async () => {
            try {
                await this.checkTokenRefresh();
            } catch (error) {
                this.error('Session monitoring error:', error);
            }
        }, this.config.sessionCheckInterval);

        this.log('Session monitoring started');
    }

    /**
     * Clear session monitoring
     * @private
     */
    clearSessionMonitoring() {
        if (this.sessionCheckTimer) {
            clearInterval(this.sessionCheckTimer);
            this.sessionCheckTimer = null;
            this.log('Session monitoring stopped');
        }
    }

    /**
     * Check if token needs refresh and refresh if necessary
     * @private
     */
    async checkTokenRefresh() {
        if (!this.isAuthenticated || !this.tokenExpiresAt) {
            return;
        }

        const now = new Date();
        const timeUntilExpiry = this.tokenExpiresAt.getTime() - now.getTime();
        
        // Refresh if token expires within the configured margin
        if (timeUntilExpiry <= this.config.tokenRefreshMargin && timeUntilExpiry > 0) {
            try {
                await this.refreshAuthToken();
            } catch (error) {
                // Token refresh will handle logout on failure
                this.clearSessionMonitoring();
            }
        } else if (timeUntilExpiry <= 0) {
            // Token has already expired
            this.warn('Token has expired, logging out');
            await this.logout();
        }
    }

    /**
     * Handle token refresh (for ApiService integration)
     */
    async handleTokenRefresh() {
        return await this.refreshAuthToken();
    }

    /**
     * Get current authentication headers
     * @returns {object} Auth headers
     */
    getAuthHeaders() {
        if (this.isAuthenticated && this.token) {
            return {
                'Authorization': `Bearer ${this.token}`
            };
        }
        return {};
    }

    /**
     * Get current user information
     * @returns {object|null} Current user or null
     */
    getCurrentUser() {
        return this.currentUser;
    }

    /**
     * Check if user is currently authenticated
     * @returns {boolean} True if authenticated
     */
    getIsAuthenticated() {
        return this.isAuthenticated;
    }

    /**
     * Alias for backward compatibility with RouterService
     */
    isAuthenticated() {
        return this.getIsAuthenticated();
    }

    /**
     * Get token expiration time
     * @returns {Date|null} Token expiration date or null
     */
    getTokenExpiresAt() {
        return this.tokenExpiresAt;
    }

    /**
     * Get authentication status information
     * @returns {object} Auth status object
     */
    getAuthStatus() {
        return {
            isAuthenticated: this.isAuthenticated,
            user: this.currentUser,
            tokenExpiresAt: this.tokenExpiresAt,
            hasRefreshToken: !!this.refreshToken
        };
    }

    /**
     * Check if token is about to expire
     * @param {number} marginMinutes - Minutes before expiry to consider "about to expire"
     * @returns {boolean} True if token expires soon
     */
    isTokenAboutToExpire(marginMinutes = 5) {
        if (!this.tokenExpiresAt) {
            return false;
        }

        const now = new Date();
        const timeUntilExpiry = this.tokenExpiresAt.getTime() - now.getTime();
        const margin = marginMinutes * 60 * 1000;
        
        return timeUntilExpiry <= margin && timeUntilExpiry > 0;
    }
}