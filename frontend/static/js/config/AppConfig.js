/**
 * @fileoverview Application Configuration Constants.
 * Centralizes all environment-specific and global constants for the modular application.
 */

export const AppConfig = {
    // --------------------------------------------------------------------
    // API & Environment Configuration
    // --------------------------------------------------------------------
    
    // The base URL for the backend API. 
    // This resolves the AppConfig.apiBaseUrl ReferenceError.
    apiBaseUrl: 'http://localhost:8000/api', 
    
    // Application version for caching and debugging
    version: '2025-12-15-modular', 
    
    // Set to true to enable extended console logging in core services
    debugMode: true, 

    // --------------------------------------------------------------------
    // Feature Configuration
    // --------------------------------------------------------------------

    // Maximum file size allowed for uploads (in MB)
    maxFileSizeMB: 20, 

    // Polling interval for processing jobs (in milliseconds)
    pollingIntervalMs: 5000, 

    // Timeout for general API requests (in milliseconds)
    requestTimeoutMs: 30000, 

    // Key used for state persistence in localStorage
    localStorageStateKey: 'tagsort-app-state-v2',

    // Default route to navigate to after initialization/login
    defaultRoute: '/dashboard'
};