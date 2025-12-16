/**
 * StateManagerService - Modern state management for TagSort
 * Replaces state-manager.js (604 lines) with event-driven, immutable state management
 * Integrates with service architecture and EventBus for reactive state updates
 */

import { BaseService } from './BaseService.js';

export class StateManagerService extends BaseService {
    constructor(eventBus, apiService, config = {}, options = {}) {
        // Handle flexible parameter order
        let actualConfig = config;
        let actualOptions = options;
        
        // If config looks like it's actually AppConfig object, use it properly
        if (config && typeof config === 'object' && config.apiBaseUrl) {
            actualConfig = config;
            actualOptions = options;
        } else if (typeof config === 'object' && !config.apiBaseUrl) {
            // If config doesn't look like AppConfig, treat it as options
            actualOptions = config;
            actualConfig = {};
        }

        // We will merge config properties into the options for BaseService
        const mergedOptions = {
            name: 'StateManagerService',
            enablePersistence: true,
            enableValidation: false,
            debug: false,
            periodicSaveInterval: 30000,
            persistenceKey: actualConfig.localStorageStateKey || 'tagsort_state', 
            stateVersion: actualConfig.stateVersion || '2.0',                     
            ...actualOptions
        };

        super(eventBus, mergedOptions);

        this.apiService = apiService; 
        this.appConfig = actualConfig; // Store the AppConfig separately
        this.authService = null;
    }

    /**
     * Initialize state manager service
     */
    async onInitialize() {
        // Get service dependencies  
        this.apiService = this.serviceContainer?.get('apiService');
        this.authService = this.serviceContainer?.get('authService');

        // Setup event listeners for state updates
        this.setupEventListeners();

        // Load state from storage
        if (this.options.enablePersistence) {
            await this.loadFromStorage();
        }

        // Setup periodic persistence
        this.setupPeriodicSave();

        // Setup state validation in development
        if (this.options.enableValidation && this.options.debug) {
            this.setupStateValidation();
        }

        this.log('StateManagerService initialized');
    }

    /**
     * Create initial state structure
     * @private
     */
    createInitialState() {
        return Object.freeze({
            // Application metadata
            meta: {
                version: this.options.stateVersion,
                lastUpdated: new Date().toISOString(),
                environment: this.getEnvironment()
            },

            // Authentication state
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
            
            // Processing state
            processing: {
                currentJobId: null,
                currentJobStatus: null,  // 'pending', 'processing', 'completed', 'failed'
                jobs: {},
                isProcessing: false,
                progress: 0,
                lastCompletedJobId: null,
                lastCompletedAt: null,
                lastJobStatus: null
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
            
            // UI State (transient - not persisted)
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
        });
    }

    /**
     * Create state validation schema
     * @private
     */
    createStateSchema() {
        return {
            auth: {
                type: 'object',
                required: ['isAuthenticated'],
                properties: {
                    isAuthenticated: { type: 'boolean' },
                    token: { type: ['string', 'null'] },
                    user: { type: ['object', 'null'] }
                }
            },
            processing: {
                type: 'object',
                required: ['isProcessing'],
                properties: {
                    isProcessing: { type: 'boolean' },
                    progress: { type: 'number', minimum: 0, maximum: 100 },
                    currentJobStatus: { 
                        type: ['string', 'null'], 
                        enum: ['pending', 'processing', 'completed', 'failed', null] 
                    }
                }
            }
        };
    }

    /**
     * Setup event listeners for state updates
     * @private
     */
    setupEventListeners() {
        // Auth events
        this.on('auth:signin:success', this.handleAuthSuccess.bind(this));
        this.on('auth:signout:success', this.handleAuthSignout.bind(this));
        this.on('auth:token:refreshed', this.handleTokenRefresh.bind(this));

        // Processing events
        this.on('processing:job:started', this.handleProcessingStarted.bind(this));
        this.on('processing:progress:updated', this.handleProcessingProgress.bind(this));
        this.on('processing:job:completed', this.handleProcessingCompleted.bind(this));
        this.on('processing:job:failed', this.handleProcessingFailed.bind(this));

        // File events
        this.on('files:selected', this.handleFilesSelected.bind(this));
        this.on('files:upload:progress', this.handleUploadProgress.bind(this));

        // Photo events
        this.on('photos:groups:updated', this.handlePhotoGroupsUpdated.bind(this));
        this.on('photos:filter:changed', this.handlePhotoFilterChanged.bind(this));
        this.on('photos:sort:changed', this.handlePhotoSortChanged.bind(this));

        // UI events
        this.on('ui:lightbox:opened', this.handleLightboxOpened.bind(this));
        this.on('ui:lightbox:closed', this.handleLightboxClosed.bind(this));
        this.on('ui:editmode:toggled', this.handleEditModeToggled.bind(this));

        // Batch events
        this.on('batch:selection:updated', this.handleBatchSelectionUpdated.bind(this));
        this.on('batch:operation:started', this.handleBatchOperationStarted.bind(this));
    }

    /**
     * Get state value by path (immutable)
     */
    get(path) {
        return this.getNestedValue(this.state, path);
    }

    /**
     * Set state value by path (creates new immutable state)
     */
    set(path, value) {
        const oldValue = this.get(path);
        
        // Skip if value hasn't changed
        if (oldValue === value) return;

        // Create new immutable state
        const newState = this.setNestedValueImmutable(this.state, path, value);
        this.state = Object.freeze(newState);

        // Track changes for persistence
        this.trackChange(path);

        // Emit specific state change event
        this.emitStateChange(path, value, oldValue);

        // Emit generic state update event
        this.emit('state:updated', { 
            path, 
            value, 
            oldValue, 
            timestamp: new Date().toISOString() 
        });

        // Validate state in development
        if (this.options.enableValidation && this.options.debug) {
            this.validateState();
        }

        this.log('State updated', { path, value: typeof value === 'object' ? '(object)' : value });
    }

    /**
     * Update multiple state values atomically
     */
    update(updates) {
        let newState = this.state;
        const changes = [];

        // Apply all updates to create new immutable state
        Object.entries(updates).forEach(([path, value]) => {
            const oldValue = this.getNestedValue(newState, path);
            if (oldValue !== value) {
                newState = this.setNestedValueImmutable(newState, path, value);
                changes.push({ path, value, oldValue });
                this.trackChange(path);
            }
        });

        // Only update if there were actual changes
        if (changes.length > 0) {
            this.state = Object.freeze(newState);

            // Emit change events for each update
            changes.forEach(({ path, value, oldValue }) => {
                this.emitStateChange(path, value, oldValue);
            });

            // Emit batch update event
            this.emit('state:batch_updated', { 
                changes, 
                timestamp: new Date().toISOString() 
            });

            this.log('State batch updated', { changeCount: changes.length });
        }
    }

    /**
     * Get nested value from object (immutable)
     * @private
     */
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => current?.[key], obj);
    }

    /**
     * Set nested value immutably
     * @private
     */
    setNestedValueImmutable(obj, path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();

        // Create new object structure
        const newObj = { ...obj };
        let current = newObj;

        // Navigate to parent and create new objects along the way
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            current[key] = { ...current[key] };
            current = current[key];
        }

        // Set the final value
        current[lastKey] = value;

        // Update metadata
        newObj.meta = {
            ...newObj.meta,
            lastUpdated: new Date().toISOString()
        };

        return newObj;
    }

    /**
     * Track changes for optimized persistence
     * @private
     */
    trackChange(path) {
        this.changesSinceLastSave.add(path);
        
        // Auto-save critical paths immediately
        const criticalPaths = [
            'auth.token', 
            'auth.user', 
            'processing.currentJobId',
            'processing.lastCompletedJobId'
        ];
        
        if (criticalPaths.includes(path)) {
            this.saveToStorage();
        }
    }

    /**
     * Emit specific state change events
     * @private
     */
    emitStateChange(path, value, oldValue) {
        // Emit path-specific events for fine-grained reactivity
        const eventName = `state:${path.replace(/\./g, ':')}:changed`;
        this.emit(eventName, { value, oldValue, path });

        // Emit section-level events for broader updates
        const section = path.split('.')[0];
        this.emit(`state:${section}:updated`, { 
            section, 
            path, 
            value, 
            oldValue,
            sectionState: this.get(section)
        });

        // Call legacy listeners for backward compatibility
        this.notifyLegacyListeners(path, value, oldValue);
    }

    /**
     * Setup periodic state persistence
     * @private
     */
    setupPeriodicSave() {
        if (!this.options.enablePersistence) return;

        this.persistenceTimer = setInterval(() => {
            if (this.changesSinceLastSave.size > 0) {
                this.saveToStorage();
            }
        }, this.options.periodicSaveInterval);
    }

    /**
     * Load state from localStorage
     */
    async loadFromStorage() {
        try {
            // Load individual auth items (legacy compatibility)
            const token = localStorage.getItem('auth_token');
            const refreshToken = localStorage.getItem('refresh_token');
            const userInfo = localStorage.getItem('user_info');
            const tokenExpiresAt = localStorage.getItem('token_expires_at');

            const updates = {};

            if (token) {
                updates['auth.token'] = token;
                updates['auth.isAuthenticated'] = true;
            }
            if (refreshToken) {
                updates['auth.refreshToken'] = refreshToken;
            }
            if (userInfo) {
                try {
                    updates['auth.user'] = JSON.parse(userInfo);
                } catch (e) {
                    this.warn('Failed to parse user info from storage');
                }
            }
            if (tokenExpiresAt) {
                try {
                    updates['auth.tokenExpiresAt'] = new Date(tokenExpiresAt);
                } catch (e) {
                    this.warn('Failed to parse token expiration from storage');
                }
            }

            // Load processing state
            const lastCompletedJobId = localStorage.getItem('last_completed_job_id');
            const currentJobId = localStorage.getItem('current_job_id');
            const currentJobStatus = localStorage.getItem('current_job_status');
            const lastCompletedAt = localStorage.getItem('last_completed_at');
            const lastJobStatus = localStorage.getItem('last_job_status');

            if (lastCompletedJobId) {
                updates['processing.lastCompletedJobId'] = lastCompletedJobId;
            }
            if (currentJobId) {
                updates['processing.currentJobId'] = currentJobId;
            }
            if (currentJobStatus) {
                updates['processing.currentJobStatus'] = currentJobStatus;
            }
            if (lastCompletedAt) {
                try {
                    updates['processing.lastCompletedAt'] = new Date(lastCompletedAt);
                } catch (e) {
                    this.warn('Failed to parse last completed date from storage');
                }
            }
            if (lastJobStatus) {
                updates['processing.lastJobStatus'] = lastJobStatus;
            }

            // Apply all updates atomically
            if (Object.keys(updates).length > 0) {
                this.update(updates);
                this.log('State loaded from storage', { itemsLoaded: Object.keys(updates).length });
            }

            // Clear changes tracking after loading
            this.changesSinceLastSave.clear();

        } catch (error) {
            this.error('Failed to load state from storage:', error);
        }
    }

    /**
     * Save state to localStorage
     */
    async saveToStorage() {
        if (!this.options.enablePersistence) return;

        try {
            const auth = this.get('auth');
            const processing = this.get('processing');

            // Save authentication state
            if (auth.token) {
                localStorage.setItem('auth_token', auth.token);
                if (auth.refreshToken) {
                    localStorage.setItem('refresh_token', auth.refreshToken);
                }
                if (auth.user) {
                    localStorage.setItem('user_info', JSON.stringify(auth.user));
                }
                if (auth.tokenExpiresAt) {
                    localStorage.setItem('token_expires_at', auth.tokenExpiresAt.toISOString());
                }
            } else {
                // Clear auth data when not authenticated
                ['auth_token', 'refresh_token', 'user_info', 'token_expires_at']
                    .forEach(key => localStorage.removeItem(key));
            }

            // Save processing state
            if (processing.lastCompletedJobId) {
                localStorage.setItem('last_completed_job_id', processing.lastCompletedJobId);
            } else {
                localStorage.removeItem('last_completed_job_id');
            }

            if (processing.currentJobId) {
                localStorage.setItem('current_job_id', processing.currentJobId);
            } else {
                localStorage.removeItem('current_job_id');
            }

            if (processing.currentJobStatus) {
                localStorage.setItem('current_job_status', processing.currentJobStatus);
            } else {
                localStorage.removeItem('current_job_status');
            }

            if (processing.lastCompletedAt) {
                localStorage.setItem('last_completed_at', processing.lastCompletedAt.toISOString());
            } else {
                localStorage.removeItem('last_completed_at');
            }

            if (processing.lastJobStatus) {
                localStorage.setItem('last_job_status', processing.lastJobStatus);
            } else {
                localStorage.removeItem('last_job_status');
            }

            // Clear changes tracking
            this.changesSinceLastSave.clear();

            this.log('State saved to storage');

        } catch (error) {
            this.error('Failed to save state to storage:', error);
        }
    }

    /**
     * Get API base URL based on environment
     * @private
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
     * Get current environment
     * @private
     */
    getEnvironment() {
        const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost';
        return isDevelopment ? 'development' : 'production';
    }

    // Public convenience methods for common operations

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return this.get('auth.isAuthenticated');
    }

    /**
     * Get current user
     */
    getCurrentUser() {
        return this.get('auth.user');
    }

    /**
     * Check if we have a recent completed job (within 24 hours)
     */
    hasRecentCompletedJob() {
        const lastCompleted = this.get('processing.lastCompletedAt');
        const lastJobId = this.get('processing.lastCompletedJobId');
        const lastStatus = this.get('processing.lastJobStatus');
        
        if (!lastCompleted || !lastJobId || lastStatus !== 'completed') {
            return false;
        }
        
        const now = new Date();
        const hoursSinceCompletion = (now - lastCompleted) / (1000 * 60 * 60);
        
        return hoursSinceCompletion < 24;
    }

    /**
     * Get recent completed job data
     */
    getRecentCompletedJob() {
        if (!this.hasRecentCompletedJob()) return null;

        return {
            jobId: this.get('processing.lastCompletedJobId'),
            completedAt: this.get('processing.lastCompletedAt'),
            status: this.get('processing.lastJobStatus')
        };
    }

    /**
     * Save completed job data
     */
    saveCompletedJob(jobId, results) {
        const updates = {
            'processing.lastCompletedJobId': jobId,
            'processing.lastCompletedAt': new Date(),
            'processing.lastJobStatus': 'completed'
        };

        // Store results if provided
        if (results) {
            updates['photos.groupedPhotos'] = results;
        }

        this.update(updates);
        this.log('Completed job saved', { jobId });
    }

    /**
     * Clear completed job data
     */
    clearCompletedJob() {
        this.update({
            'processing.lastCompletedJobId': null,
            'processing.lastCompletedAt': null,
            'processing.lastJobStatus': null,
            'photos.groupedPhotos': []
        });

        this.log('Completed job state cleared');
    }

    /**
     * Check if we have valid results to display
     */
    hasValidResults() {
        const photos = this.get('photos.groupedPhotos');
        return Array.isArray(photos) ? photos.length > 0 : Object.keys(photos || {}).length > 0;
    }

    // Event Handlers

    handleAuthSuccess(data) {
        this.update({
            'auth.isAuthenticated': true,
            'auth.token': data.token,
            'auth.user': data.user,
            'auth.refreshToken': data.refreshToken,
            'auth.tokenExpiresAt': data.expiresAt ? new Date(data.expiresAt) : null
        });
    }

    handleAuthSignout() {
        this.update({
            'auth.isAuthenticated': false,
            'auth.token': null,
            'auth.user': null,
            'auth.refreshToken': null,
            'auth.tokenExpiresAt': null
        });
    }

    handleTokenRefresh(data) {
        this.update({
            'auth.token': data.token,
            'auth.tokenExpiresAt': data.expiresAt ? new Date(data.expiresAt) : null
        });
    }

    handleProcessingStarted(data) {
        this.update({
            'processing.currentJobId': data.jobId,
            'processing.currentJobStatus': 'pending',
            'processing.isProcessing': true,
            'processing.progress': 0
        });
    }

    handleProcessingProgress(data) {
        this.update({
            'processing.progress': data.progress,
            'processing.currentJobStatus': 'processing'
        });
    }

    handleProcessingCompleted(data) {
        this.update({
            'processing.currentJobStatus': 'completed',
            'processing.isProcessing': false,
            'processing.progress': 100,
            'photos.groupedPhotos': data.results || []
        });

        // Save as completed job if we have a job ID
        const currentJobId = this.get('processing.currentJobId');
        if (currentJobId) {
            this.saveCompletedJob(currentJobId, data.results);
        }
    }

    handleProcessingFailed(data) {
        this.update({
            'processing.currentJobStatus': 'failed',
            'processing.isProcessing': false
        });
    }

    handleFilesSelected(data) {
        this.set('files.selectedFiles', data.files || []);
        this.set('files.totalFiles', (data.files || []).length);
    }

    handleUploadProgress(data) {
        const currentProgress = this.get('files.uploadProgress') || {};
        this.set('files.uploadProgress', {
            ...currentProgress,
            [data.fileId]: data.progress
        });
    }

    handlePhotoGroupsUpdated(data) {
        this.set('photos.groupedPhotos', data.groups || []);
    }

    handlePhotoFilterChanged(data) {
        this.update({
            'photos.currentFilter': data.filter,
            'photos.searchTerm': data.searchTerm || '',
            'photos.confidenceFilter': data.confidenceFilter || 0,
            'photos.photoCountFilter': data.photoCountFilter || 1
        });
    }

    handlePhotoSortChanged(data) {
        this.set('photos.currentSort', data.sort);
    }

    handleLightboxOpened(data) {
        this.update({
            'ui.lightbox.isOpen': true,
            'ui.lightbox.currentGroup': data.group,
            'ui.lightbox.currentPhotoIndex': data.photoIndex || 0
        });
    }

    handleLightboxClosed() {
        this.update({
            'ui.lightbox.isOpen': false,
            'ui.lightbox.currentGroup': null,
            'ui.lightbox.currentPhotoIndex': 0,
            'ui.lightbox.zoomLevel': 1,
            'ui.lightbox.panX': 0,
            'ui.lightbox.panY': 0
        });
    }

    handleEditModeToggled(data) {
        this.set('ui.isEditMode', data.isEditMode);
    }

    handleBatchSelectionUpdated(data) {
        this.update({
            'batch.selectedPhotos': data.selectedPhotos || [],
            'batch.isSelectionMode': data.isSelectionMode || false
        });
    }

    handleBatchOperationStarted(data) {
        this.set('batch.currentOperation', data.operation);
    }

    // Legacy compatibility methods

    /**
     * Subscribe to state changes (legacy compatibility)
     */
    subscribe(path, callback) {
        if (!this.legacyListeners.has(path)) {
            this.legacyListeners.set(path, new Set());
        }
        this.legacyListeners.get(path).add(callback);
        
        // Return unsubscribe function
        return () => {
            const listeners = this.legacyListeners.get(path);
            if (listeners) {
                listeners.delete(callback);
            }
        };
    }

    /**
     * Notify legacy listeners
     * @private
     */
    notifyLegacyListeners(path, value, oldValue) {
        const listeners = this.legacyListeners.get(path);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(value, oldValue);
                } catch (error) {
                    this.error('Legacy state listener error:', error);
                }
            });
        }
    }

    /**
     * Get full state (for debugging)
     */
    getFullState() {
        return JSON.parse(JSON.stringify(this.state));
    }

    /**
     * Setup state validation (development only)
     * @private
     */
    setupStateValidation() {
        // Validate state structure periodically in development
        setInterval(() => {
            this.validateState();
        }, 30000); // Every 30 seconds
    }

    /**
     * Validate current state against schema
     * @private
     */
    validateState() {
        // Simple validation - can be extended with a proper schema validator
        try {
            const auth = this.get('auth');
            if (typeof auth.isAuthenticated !== 'boolean') {
                this.warn('State validation failed: auth.isAuthenticated must be boolean');
            }

            const processing = this.get('processing');
            if (typeof processing.isProcessing !== 'boolean') {
                this.warn('State validation failed: processing.isProcessing must be boolean');
            }

            if (processing.progress < 0 || processing.progress > 100) {
                this.warn('State validation failed: processing.progress must be between 0-100');
            }

        } catch (error) {
            this.warn('State validation error:', error);
        }
    }

    /**
     * Get service statistics
     */
    getStats() {
        return {
            state: {
                version: this.get('meta.version'),
                lastUpdated: this.get('meta.lastUpdated'),
                environment: this.get('meta.environment')
            },
            persistence: {
                enabled: this.options.enablePersistence,
                changesSinceLastSave: this.changesSinceLastSave.size,
                interval: this.options.periodicSaveInterval
            },
            listeners: {
                legacyCount: Array.from(this.legacyListeners.values())
                    .reduce((total, listeners) => total + listeners.size, 0),
                paths: Array.from(this.legacyListeners.keys())
            },
            validation: {
                enabled: this.options.enableValidation,
                immutableState: this.options.enableImmutableState
            }
        };
    }

    /**
     * Cleanup service
     */
    async cleanup() {
        // Save final state
        if (this.options.enablePersistence) {
            await this.saveToStorage();
        }

        // Clear periodic save timer
        if (this.persistenceTimer) {
            clearInterval(this.persistenceTimer);
            this.persistenceTimer = null;
        }

        // Clear listeners
        this.legacyListeners.clear();
        this.changesSinceLastSave.clear();

        await super.cleanup();
    }

    /**
     * Static helper for legacy compatibility
     */
    static getInstance() {
        // Try to get from window first (legacy)
        if (typeof window !== 'undefined' && window.stateManager) {
            return window.stateManager;
        }
        return null;
    }
}