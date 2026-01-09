/**
 * Centralized API Configuration
 * 
 * This file provides a single source of truth for API base URLs,
 * automatically detecting the environment and using appropriate endpoints.
 * 
 * Benefits:
 * - No more hardcoded URLs throughout the codebase
 * - Automatic environment detection (localhost vs production)
 * - Uses relative URLs in production for optimal routing
 * - Zero CORS issues with same-domain requests
 * - Future-proof - never need to update URLs again
 */

const CONFIG = {
    /**
     * API Base URL - automatically selects the correct endpoint:
     * - Development: Direct connection to local backend (localhost:8000)
     * - Production: Relative URL that uses Firebase rewrites to route to Cloud Run
     */
    API_BASE_URL: window.location.hostname === 'localhost' 
        ? 'http://localhost:8000/api' 
        : '/api',

    /**
     * Environment detection utilities
     */
    isDevelopment: () => window.location.hostname === 'localhost',
    isProduction: () => window.location.hostname !== 'localhost',

    /**
     * Common API endpoints for easy access
     */
    endpoints: {
        auth: {
            login: '/auth/login',
            register: '/auth/register',
            refresh: '/auth/refresh',
            logout: '/auth/logout',
            logoutAll: '/auth/logout-all',
            changePassword: '/auth/password/change',
            me: '/auth/me'
        },
        payment: {
            createCheckout: '/payment/create-checkout-session',
            customerPortal: '/payment/customer-portal',
            config: '/payment/config'
        },
        users: {
            profile: '/users/me/profile',
            email: '/users/me/email',
            quota: '/users/me/quota',
            stats: '/users/me/stats',
            subscription: '/users/me/subscription'
        }
    },

    /**
     * Get full URL for an endpoint
     * @param {string} endpoint - Endpoint path (e.g., '/auth/login')
     * @returns {string} Full URL
     */
    getUrl: (endpoint) => `${CONFIG.API_BASE_URL}${endpoint}`,

    /**
     * Get authentication headers for API requests
     * @returns {Object} Headers object with authorization
     */
    getAuthHeaders: () => {
        const token = localStorage.getItem('auth_token');
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    }
};

export default CONFIG;