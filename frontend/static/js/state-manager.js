/**
 * StateManager - Centralized state management for TagSort frontend
 * Replaces global variables with a structured state management system
 */

class StateManager {
    constructor() {
        // Initialize state
        this.state = {
            // Authentication
            auth: {
                isAuthenticated: false,
                token: null,
                user: null,
                tokenExpiresAt: null,
                refreshToken: null
            },
            
            // API Configuration
            api: {
                baseUrl: this.getApiBaseUrl(),
                requestTimeout: 30000,
                retryAttempts: 3
            },
            
            // File Management
            files: {
                selectedFiles: [],
                uploadProgress: {},
                totalFiles: 0
            },
            
            // Processing
            processing: {
                currentJobId: null,
                jobs: {},
                isProcessing: false,
                progress: 0
            },
            
            // Photo Groups
            photos: {
                groupedPhotos: [],
                filteredGroups: [],
                selectedGroups: [],
                currentFilter: 'all',
                currentSort: 'bib-asc',
                searchTerm: '',
                confidenceFilter: 0,
                photoCountFilter: 1
            },
            
            // UI State
            ui: {
                isEditMode: false,
                currentModal: null,
                lightbox: {
                    isOpen: false,
                    currentGroup: null,
                    currentPhotoIndex: 0,
                    zoomLevel: 1,
                    panX: 0,
                    panY: 0
                },
                notifications: []
            },
            
            // Batch Operations
            batch: {
                selectedPhotos: [],
                isSelectionMode: false,
                currentOperation: null
            }
        };
        
        // Event listeners for state changes
        this.listeners = {};
        
        // Initialize from localStorage
        this.loadFromStorage();
        
        // Setup periodic state persistence
        this.setupPeriodicSave();
        
        // Setup token refresh
        this.setupTokenRefresh();
        
        // Setup request interceptor
        this.setupRequestInterceptor();
    }
    
    /**
     * Get API base URL based on environment
     */
    getApiBaseUrl() {
        const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost';
        if (isDevelopment) {
            return `${window.location.protocol}//${window.location.hostname}:8000/api`;
        } else {
            return `${window.location.protocol}//${window.location.host}/api`;
        }
    }
    
    /**
     * Subscribe to state changes
     */
    subscribe(path, callback) {
        if (!this.listeners[path]) {
            this.listeners[path] = [];
        }
        this.listeners[path].push(callback);
        
        // Return unsubscribe function
        return () => {
            this.listeners[path] = this.listeners[path].filter(cb => cb !== callback);
        };
    }
    
    /**
     * Get state value by path
     */
    get(path) {
        return this.getNestedValue(this.state, path);
    }
    
    /**
     * Set state value by path and notify listeners
     */
    set(path, value) {
        const oldValue = this.get(path);
        this.setNestedValue(this.state, path, value);
        
        // Notify listeners
        if (this.listeners[path]) {
            this.listeners[path].forEach(callback => {
                try {
                    callback(value, oldValue);
                } catch (error) {
                    console.error('State listener error:', error);
                }
            });
        }
        
        // Save to localStorage for persistence
        this.saveToStorage();
    }
    
    /**
     * Update multiple state values at once
     */
    update(updates) {
        Object.entries(updates).forEach(([path, value]) => {
            this.set(path, value);
        });
    }
    
    /**
     * Helper to get nested object value
     */
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => current?.[key], obj);
    }
    
    /**
     * Helper to set nested object value
     */
    setNestedValue(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((current, key) => {
            if (!current[key]) current[key] = {};
            return current[key];
        }, obj);
        target[lastKey] = value;
    }
    
    /**
     * Load state from localStorage
     */
    loadFromStorage() {
        try {
            // Load authentication state
            const token = localStorage.getItem('auth_token');
            const refreshToken = localStorage.getItem('refresh_token');
            const userInfo = localStorage.getItem('user_info');
            const tokenExpiry = localStorage.getItem('token_expires_at');
            
            if (token) {
                this.state.auth.token = token;
                this.state.auth.refreshToken = refreshToken;
                this.state.auth.isAuthenticated = true;
                
                if (userInfo) {
                    this.state.auth.user = JSON.parse(userInfo);
                }
                
                if (tokenExpiry) {
                    this.state.auth.tokenExpiresAt = new Date(tokenExpiry);
                }
            }
            
            // Load UI preferences
            const savedFilter = localStorage.getItem('current_filter');
            if (savedFilter) {
                this.state.photos.currentFilter = savedFilter;
            }
            
            const savedSort = localStorage.getItem('current_sort');
            if (savedSort) {
                this.state.photos.currentSort = savedSort;
            }
            
        } catch (error) {
            console.error('Error loading state from localStorage:', error);
        }
    }
    
    /**
     * Save state to localStorage
     */
    saveToStorage() {
        try {
            // Save authentication state
            if (this.state.auth.token) {
                localStorage.setItem('auth_token', this.state.auth.token);
                if (this.state.auth.refreshToken) {
                    localStorage.setItem('refresh_token', this.state.auth.refreshToken);
                }
                if (this.state.auth.user) {
                    localStorage.setItem('user_info', JSON.stringify(this.state.auth.user));
                }
                if (this.state.auth.tokenExpiresAt) {
                    localStorage.setItem('token_expires_at', this.state.auth.tokenExpiresAt.toISOString());
                }
            } else {
                localStorage.removeItem('auth_token');
                localStorage.removeItem('refresh_token');
                localStorage.removeItem('user_info');
                localStorage.removeItem('token_expires_at');
            }
            
            // Save UI preferences
            localStorage.setItem('current_filter', this.state.photos.currentFilter);
            localStorage.setItem('current_sort', this.state.photos.currentSort);
            
        } catch (error) {
            console.error('Error saving state to localStorage:', error);
        }
    }
    
    /**
     * Setup periodic state saving
     */
    setupPeriodicSave() {
        // Auto-save every 30 seconds
        setInterval(() => {
            this.saveToStorage();
        }, 30000);
    }
    
    /**
     * Setup automatic token refresh
     */
    setupTokenRefresh() {
        setInterval(async () => {
            if (this.state.auth.isAuthenticated && this.state.auth.tokenExpiresAt) {
                const now = new Date();
                const expiresAt = new Date(this.state.auth.tokenExpiresAt);
                const minutesUntilExpiry = (expiresAt - now) / (1000 * 60);
                
                // Refresh if token expires in the next 5 minutes
                if (minutesUntilExpiry <= 5 && minutesUntilExpiry > 0) {
                    await this.refreshToken();
                }
            }
        }, 60000); // Check every minute
    }
    
    /**
     * Refresh authentication token
     */
    async refreshToken() {
        try {
            if (!this.state.auth.refreshToken) {
                throw new Error('No refresh token available');
            }
            
            const response = await fetch(`${this.state.api.baseUrl}/auth/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.state.auth.refreshToken}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.set('auth.token', data.access_token);
                this.set('auth.refreshToken', data.refresh_token);
                this.set('auth.tokenExpiresAt', new Date(Date.now() + data.expires_in * 1000));
                
                console.log('Token refreshed successfully');
                return true;
            } else {
                // Refresh failed, logout user
                this.logout();
                return false;
            }
        } catch (error) {
            console.error('Token refresh failed:', error);
            this.logout();
            return false;
        }
    }
    
    /**
     * Setup request interceptor for automatic auth headers
     */
    setupRequestInterceptor() {
        const originalFetch = window.fetch;
        
        window.fetch = async (url, options = {}) => {
            // Add auth header if authenticated
            if (this.state.auth.isAuthenticated && this.state.auth.token) {
                options.headers = {
                    ...options.headers,
                    'Authorization': `Bearer ${this.state.auth.token}`
                };
            }
            
            // Add request timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.state.api.requestTimeout);
            
            options.signal = controller.signal;
            
            try {
                const response = await originalFetch(url, options);
                clearTimeout(timeoutId);
                
                // Handle 401 responses (token expired)
                if (response.status === 401 && this.state.auth.isAuthenticated) {
                    // Try to refresh token
                    const refreshed = await this.refreshToken();
                    if (refreshed) {
                        // Retry the original request with new token
                        options.headers['Authorization'] = `Bearer ${this.state.auth.token}`;
                        return await originalFetch(url, options);
                    }
                }
                
                return response;
            } catch (error) {
                clearTimeout(timeoutId);
                throw error;
            }
        };
    }
    
    /**
     * Login user and update auth state
     */
    login(authData) {
        this.update({
            'auth.isAuthenticated': true,
            'auth.token': authData.access_token,
            'auth.refreshToken': authData.refresh_token,
            'auth.user': authData.user,
            'auth.tokenExpiresAt': new Date(Date.now() + authData.expires_in * 1000)
        });
    }
    
    /**
     * Logout user and clear auth state
     */
    logout() {
        this.update({
            'auth.isAuthenticated': false,
            'auth.token': null,
            'auth.refreshToken': null,
            'auth.user': null,
            'auth.tokenExpiresAt': null
        });
        
        // Clear processing state
        this.update({
            'processing.currentJobId': null,
            'processing.jobs': {},
            'processing.isProcessing': false,
            'photos.groupedPhotos': [],
            'batch.selectedPhotos': []
        });
    }
    
    /**
     * Reset application state (for new session)
     */
    reset() {
        this.state.files.selectedFiles = [];
        this.state.processing.currentJobId = null;
        this.state.processing.jobs = {};
        this.state.photos.groupedPhotos = [];
        this.state.batch.selectedPhotos = [];
        this.saveToStorage();
    }
    
    /**
     * Get current authentication headers
     */
    getAuthHeaders() {
        if (this.state.auth.isAuthenticated && this.state.auth.token) {
            return {
                'Authorization': `Bearer ${this.state.auth.token}`
            };
        }
        return {};
    }
    
    /**
     * Add notification to UI state
     */
    addNotification(message, type = 'info', duration = 4000) {
        const notification = {
            id: Date.now(),
            message,
            type,
            timestamp: new Date(),
            duration
        };
        
        const currentNotifications = this.get('ui.notifications') || [];
        this.set('ui.notifications', [...currentNotifications, notification]);
        
        // Auto-remove after duration
        if (duration > 0) {
            setTimeout(() => {
                this.removeNotification(notification.id);
            }, duration);
        }
        
        return notification.id;
    }
    
    /**
     * Remove notification
     */
    removeNotification(notificationId) {
        const currentNotifications = this.get('ui.notifications') || [];
        this.set('ui.notifications', currentNotifications.filter(n => n.id !== notificationId));
    }
    
    /**
     * Debug: Get full state
     */
    getFullState() {
        return JSON.parse(JSON.stringify(this.state));
    }
}

// Export global instance
if (typeof window !== 'undefined') {
    window.stateManager = new StateManager();
}