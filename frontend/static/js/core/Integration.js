/**
 * Integration - Service-Component integration layer
 * Coordinates communication between services and UI components
 * Provides centralized event routing and data flow management
 */

import { EventBus } from './EventBus.js';
import { ComponentRegistry } from './ComponentRegistry.js';
import { ComponentFactory } from './ComponentFactory.js';

export class Integration {
    constructor(options = {}) {
        this.options = {
            name: 'Integration',
            enableAutoRouting: true,
            enableStateSync: true,
            enableErrorRecovery: true,
            ...options
        };

        // Core dependencies
        this.eventBus = null;
        this.services = null;
        this.componentRegistry = null;
        this.componentFactory = null;

        // Integration state
        this.eventRoutes = new Map(); // eventName -> Set of handlers
        this.stateBindings = new Map(); // serviceState -> Set of components
        this.errorHandlers = new Map(); // errorType -> handler function

        // Active workflows
        this.workflows = new Map(); // workflowId -> workflow data

        // Performance tracking
        this.metrics = {
            eventsRouted: 0,
            stateUpdates: 0,
            errorsHandled: 0,
            workflowsExecuted: 0
        };
    }

    /**
     * Initialize integration layer
     */
    async initialize(eventBus, services, componentRegistry = null) {
        this.eventBus = eventBus;
        this.services = services;
        this.componentRegistry = componentRegistry || ComponentRegistry.getInstance();
        this.componentFactory = ComponentFactory.create(this.componentRegistry);

        // Initialize component registry with services
        await this.componentRegistry.initialize(this.services, this.eventBus);

        // Setup integration patterns
        this.setupServiceIntegration();
        this.setupComponentIntegration();
        this.setupErrorHandling();

        if (this.options.enableAutoRouting) {
            this.setupAutoRouting();
        }

        if (this.options.enableStateSync) {
            this.setupStateSync();
        }

        this.log('Integration layer initialized');
    }

    /**
     * Setup service integration patterns
     * @private
     */
    setupServiceIntegration() {
        // Auth service integration
        if (this.services.authService) {
            this.addEventRoute('auth:signin:success', this.handleAuthSuccess.bind(this));
            this.addEventRoute('auth:signout:success', this.handleAuthSignOut.bind(this));
            this.addEventRoute('auth:token:expired', this.handleTokenExpired.bind(this));
        }

        // Router service integration
        if (this.services.routerService) {
            this.addEventRoute('navigation:show_section', this.handleNavigationSection.bind(this));
            this.addEventRoute('navigation:auth_required', this.handleNavigationAuthRequired.bind(this));
        }

        // Upload service integration
        if (this.services.uploadService) {
            this.addEventRoute('upload:completed', this.handleUploadCompleted.bind(this));
            this.addEventRoute('upload:error', this.handleUploadError.bind(this));
            this.addEventRoute('upload:quota:exceeded', this.handleQuotaExceeded.bind(this));
        }

        // Processing service integration
        if (this.services.processingService) {
            this.addEventRoute('processing:completed', this.handleProcessingCompleted.bind(this));
            this.addEventRoute('processing:failed', this.handleProcessingFailed.bind(this));
            this.addEventRoute('processing:progress', this.handleProcessingProgress.bind(this));
        }

        // Export service integration
        if (this.services.exportService) {
            this.addEventRoute('export:completed', this.handleExportCompleted.bind(this));
            this.addEventRoute('export:failed', this.handleExportFailed.bind(this));
        }

        this.log('Service integration patterns setup');
    }

    /**
     * Setup component integration patterns
     * @private
     */
    setupComponentIntegration() {
        // Photo selection coordination
        this.addEventRoute('photogrid:selection:changed', this.handlePhotoSelectionChanged.bind(this));
        this.addEventRoute('photogroup:selection:changed', this.handlePhotoSelectionChanged.bind(this));

        // Photo editing coordination
        this.addEventRoute('photogrid:photo:edit', this.handlePhotoEditRequest.bind(this));
        this.addEventRoute('lightbox:photo:updated', this.handlePhotoUpdated.bind(this));
        this.addEventRoute('labeling:edit:saved', this.handlePhotoUpdated.bind(this));

        // Filtering coordination
        this.addEventRoute('filters:changed', this.handleFiltersChanged.bind(this));
        this.addEventRoute('sorting:changed', this.handleSortingChanged.bind(this));
        this.addEventRoute('view:changed', this.handleViewChanged.bind(this));

        // Navigation coordination
        this.addEventRoute('photogrid:photo:clicked', this.handlePhotoClicked.bind(this));
        this.addEventRoute('photogroup:photo:clicked', this.handlePhotoClicked.bind(this));

        // Bulk operations coordination
        this.addEventRoute('labeling:bulk:apply', this.handleBulkOperation.bind(this));

        this.log('Component integration patterns setup');
    }

    /**
     * Setup error handling
     * @private
     */
    setupErrorHandling() {
        this.errorHandlers.set('auth', this.handleAuthError.bind(this));
        this.errorHandlers.set('upload', this.handleUploadError.bind(this));
        this.errorHandlers.set('processing', this.handleProcessingError.bind(this));
        this.errorHandlers.set('export', this.handleExportError.bind(this));
        this.errorHandlers.set('component', this.handleComponentError.bind(this));

        // Global error handler
        this.eventBus.on('error', this.handleGlobalError.bind(this));

        this.log('Error handling setup');
    }

    /**
     * Setup automatic event routing
     * @private
     */
    setupAutoRouting() {
        // Listen to all events and route them
        this.eventBus.onAny((eventName, data) => {
            this.routeEvent(eventName, data);
        });

        this.log('Auto routing enabled');
    }

    /**
     * Setup state synchronization
     * @private
     */
    setupStateSync() {
        // Sync authentication state
        this.addStateBinding('auth:user', ['AuthManager']);
        this.addStateBinding('auth:token', ['AuthManager']);

        // Sync upload state
        this.addStateBinding('upload:quota', ['UploadManager']);
        this.addStateBinding('upload:files', ['FileList', 'UploadManager']);

        // Sync processing state
        this.addStateBinding('processing:job', ['ProcessingManager', 'ProcessingProgress']);
        this.addStateBinding('processing:results', ['PhotoGrid', 'PhotoGroup']);

        // Sync selection state
        this.addStateBinding('photos:selection', ['PhotoGrid', 'PhotoGroup', 'LabelingTools']);

        this.log('State synchronization setup');
    }

    /**
     * Add event route
     */
    addEventRoute(eventName, handler) {
        if (!this.eventRoutes.has(eventName)) {
            this.eventRoutes.set(eventName, new Set());
        }
        this.eventRoutes.get(eventName).add(handler);

        // Setup event listener
        this.eventBus.on(eventName, handler);
    }

    /**
     * Add state binding
     */
    addStateBinding(stateKey, componentTypes) {
        if (!this.stateBindings.has(stateKey)) {
            this.stateBindings.set(stateKey, new Set());
        }
        
        const binding = this.stateBindings.get(stateKey);
        componentTypes.forEach(type => binding.add(type));
    }

    /**
     * Route event to appropriate handlers
     * @private
     */
    routeEvent(eventName, data) {
        this.metrics.eventsRouted++;

        const handlers = this.eventRoutes.get(eventName);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data, eventName);
                } catch (error) {
                    this.handleError('event_routing', error, { eventName, data });
                }
            });
        }
    }

    /**
     * Sync state to components
     */
    syncState(stateKey, newState) {
        this.metrics.stateUpdates++;

        const componentTypes = this.stateBindings.get(stateKey);
        if (!componentTypes) return;

        for (const componentType of componentTypes) {
            const components = this.componentRegistry.getComponentsByType(componentType);
            
            components.forEach(component => {
                try {
                    if (typeof component.updateState === 'function') {
                        component.updateState(stateKey, newState);
                    } else {
                        // Emit state update event to component
                        component.emit(`state:${stateKey}`, newState);
                    }
                } catch (error) {
                    this.handleError('state_sync', error, { stateKey, componentType });
                }
            });
        }

        this.log('State synced', { stateKey, componentTypes: Array.from(componentTypes) });
    }

    /**
     * Create complete photo processing application
     */
    async createPhotoProcessingApp(containerConfig) {
        const {
            authContainer = '.auth-container',
            uploadContainer = '.upload-container',
            processingContainer = '.processing-container',
            resultsContainer = '.results-container'
        } = containerConfig;

        try {
            const app = {};

            // Create authentication system
            const authSystem = await this.componentFactory.createAuthSystem(authContainer);
            app.auth = authSystem;

            // Create main workflow
            const workflow = await this.componentFactory.createProcessingWorkflow({
                uploadContainer,
                processingContainer,
                resultsContainer
            });
            app.workflow = workflow;

            // Setup app-wide coordination
            this.setupApplicationCoordination(app);

            // Register workflow
            const workflowId = this.generateWorkflowId();
            this.workflows.set(workflowId, {
                id: workflowId,
                type: 'photo_processing',
                components: app,
                createdAt: new Date(),
                status: 'active'
            });

            this.metrics.workflowsExecuted++;
            this.log('Photo processing app created', { workflowId });

            return { app, workflowId };

        } catch (error) {
            this.handleError('app_creation', error, containerConfig);
            throw error;
        }
    }

    /**
     * Setup application-wide coordination
     * @private
     */
    setupApplicationCoordination(app) {
        // Authentication state management
        if (app.auth && app.auth.authManager) {
            this.eventBus.on('auth:signin:success', (data) => {
                this.syncState('auth:user', data.user);
                // Show upload section after login
                this.showSection('upload');
            });

            this.eventBus.on('auth:signout:success', () => {
                this.syncState('auth:user', null);
                // Hide all sections except auth after logout
                this.hideSection('upload');
                this.hideSection('processing');
                this.hideSection('results');
            });
        }

        // Upload to processing flow
        if (app.workflow && app.workflow.upload && app.workflow.processing) {
            this.eventBus.on('upload:manager:completed', async (data) => {
                // Hide upload, show processing
                this.hideSection('upload');
                this.showSection('processing');

                // Auto-start processing
                if (data.photos && data.photos.length > 0) {
                    const photoIds = data.photos.map(p => p.id);
                    await app.workflow.processing.processingManager.startProcessing(photoIds);
                }
            });
        }

        // Processing to results flow
        if (app.workflow && app.workflow.processing && app.workflow.results) {
            this.eventBus.on('processing:manager:completed', (data) => {
                // Hide processing, show results
                this.hideSection('processing');
                this.showSection('results');

                // Update results with data
                this.updateResults(data.results);
            });
        }

        this.log('Application coordination setup');
    }

    // Event handlers for service integration

    /**
     * Handle authentication success
     * @private
     */
    handleAuthSuccess(data) {
        this.syncState('auth:user', data.user);
        this.syncState('auth:token', data.token);
        
        // Enable authenticated features
        this.enableAuthenticatedComponents();
    }

    /**
     * Handle authentication sign out
     * @private
     */
    handleAuthSignOut() {
        this.syncState('auth:user', null);
        this.syncState('auth:token', null);
        
        // Disable authenticated features
        this.disableAuthenticatedComponents();
    }

    /**
     * Handle navigation section changes
     * @private
     */
    handleNavigationSection(data) {
        const { section } = data;
        
        // Update section visibility
        if (section === 'landing') {
            this.showSection('landing-page');
            this.hideSection('app-section');
        } else if (section === 'analytics') {
            this.hideSection('landing-page');
            this.hideSection('app-section');
            // Analytics will handle its own display
        } else {
            // App sections
            this.hideSection('landing-page');
            this.showSection('app-section');
            
            // Show specific app section
            const appSections = ['upload-section', 'processing-section', 'results-section'];
            appSections.forEach(sec => this.hideSection(sec.replace('-section', '')));
            this.showSection(section);
        }
    }

    /**
     * Handle navigation auth required
     * @private
     */
    handleNavigationAuthRequired(data) {
        this.showNotification('Please sign in to access this feature', 'warning');
    }

    /**
     * Handle token expiration
     * @private
     */
    handleTokenExpired() {
        this.handleAuthSignOut();
        this.showNotification('Session expired. Please sign in again.', 'warning');
    }

    /**
     * Handle upload completion
     * @private
     */
    handleUploadCompleted(data) {
        this.syncState('upload:files', data.files);
        this.showNotification(`${data.files.length} photos uploaded successfully`, 'success');
    }

    /**
     * Handle processing completion
     * @private
     */
    handleProcessingCompleted(data) {
        this.syncState('processing:results', data.results);
        this.showNotification('Processing completed successfully', 'success');
    }

    /**
     * Handle processing failure
     * @private
     */
    handleProcessingFailed(data) {
        this.showNotification(`Processing failed: ${data.error}`, 'error');
    }

    /**
     * Handle processing progress
     * @private
     */
    handleProcessingProgress(data) {
        this.syncState('processing:job', data);
    }

    /**
     * Handle quota exceeded
     * @private
     */
    handleQuotaExceeded(data) {
        this.showNotification('Upload quota exceeded. Please upgrade your plan.', 'warning');
    }

    /**
     * Handle photo selection changes
     * @private
     */
    handlePhotoSelectionChanged(data) {
        this.syncState('photos:selection', data.selectedPhotos);
    }

    /**
     * Handle photo edit requests
     * @private
     */
    handlePhotoEditRequest(data) {
        // Open lightbox in edit mode
        const lightboxes = this.componentRegistry.getComponentsByType('PhotoLightbox');
        if (lightboxes.length > 0) {
            lightboxes[0].open([data.photo], 0);
            lightboxes[0].toggleEditMode();
        }
    }

    /**
     * Handle photo updates
     * @private
     */
    handlePhotoUpdated(data) {
        // Broadcast photo update to all relevant components
        this.eventBus.emit('photo:updated', data);
    }

    /**
     * Handle photo clicks
     * @private
     */
    handlePhotoClicked(data) {
        // Open lightbox for photo viewing
        const lightboxes = this.componentRegistry.getComponentsByType('PhotoLightbox');
        if (lightboxes.length > 0) {
            lightboxes[0].open([data.photo], 0);
        }
    }

    /**
     * Handle filters changed
     * @private
     */
    handleFiltersChanged(data) {
        // Apply filters to photo display components
        const photoDisplays = [
            ...this.componentRegistry.getComponentsByType('PhotoGrid'),
            ...this.componentRegistry.getComponentsByType('PhotoGroup')
        ];

        photoDisplays.forEach(component => {
            if (typeof component.applyFilter === 'function') {
                component.applyFilter(data.filterFunction);
            }
        });
    }

    /**
     * Handle sorting changed
     * @private
     */
    handleSortingChanged(data) {
        // Apply sorting to photo display components
        const photoDisplays = [
            ...this.componentRegistry.getComponentsByType('PhotoGrid'),
            ...this.componentRegistry.getComponentsByType('PhotoGroup')
        ];

        photoDisplays.forEach(component => {
            if (typeof component.applySorting === 'function') {
                component.applySorting(data.sortFunction);
            }
        });
    }

    /**
     * Handle view changes
     * @private
     */
    handleViewChanged(data) {
        // Update view options for photo display components
        const photoDisplays = [
            ...this.componentRegistry.getComponentsByType('PhotoGrid'),
            ...this.componentRegistry.getComponentsByType('PhotoGroup')
        ];

        photoDisplays.forEach(component => {
            if (typeof component.updateOptions === 'function') {
                component.updateOptions(data.viewOptions);
            }
        });
    }

    /**
     * Handle bulk operations
     * @private
     */
    async handleBulkOperation(data) {
        try {
            // Execute bulk operation via appropriate service
            if (this.services.processingService) {
                await this.services.processingService.bulkUpdatePhotos(
                    data.photoIds,
                    data.updates,
                    data.action
                );
                
                // Broadcast success
                this.eventBus.emit('bulk:operation:success', {
                    photoIds: data.photoIds,
                    updates: data.updates,
                    action: data.action
                });
                
                this.showNotification(
                    `Bulk operation completed for ${data.photoIds.length} photos`,
                    'success'
                );
            }
        } catch (error) {
            this.handleError('bulk_operation', error, data);
        }
    }

    // Error handling methods

    /**
     * Handle global error
     * @private
     */
    handleGlobalError(error) {
        this.handleError('global', error);
    }

    /**
     * Handle authentication errors
     * @private
     */
    handleAuthError(error, data) {
        this.showNotification('Authentication error. Please try again.', 'error');
        this.disableAuthenticatedComponents();
    }

    /**
     * Handle upload errors
     * @private
     */
    handleUploadError(error, data) {
        this.showNotification(`Upload failed: ${error.message || 'Unknown error'}`, 'error');
    }

    /**
     * Handle processing errors
     * @private
     */
    handleProcessingError(error, data) {
        this.showNotification(`Processing failed: ${error.message || 'Unknown error'}`, 'error');
    }

    /**
     * Handle export completion
     * @private
     */
    handleExportCompleted(data) {
        this.syncState('export:results', data.results);
        this.showNotification('Export completed successfully', 'success');
    }

    /**
     * Handle export failure
     * @private
     */
    handleExportFailed(data) {
        this.showNotification(`Export failed: ${data.error}`, 'error');
    }

    /**
     * Handle export errors
     * @private
     */
    handleExportError(error, data) {
        this.showNotification(`Export failed: ${error.message || 'Unknown error'}`, 'error');
    }

    /**
     * Handle component errors
     * @private
     */
    handleComponentError(error, data) {
        this.log('Component error', { error, data });
        
        if (this.options.enableErrorRecovery) {
            this.recoverFromComponentError(error, data);
        }
    }

    /**
     * Handle any error
     * @private
     */
    handleError(type, error, data = null) {
        this.metrics.errorsHandled++;

        const handler = this.errorHandlers.get(type);
        if (handler) {
            try {
                handler(error, data);
            } catch (handlerError) {
                console.error('Error handler failed:', handlerError);
            }
        } else {
            // Default error handling
            console.error(`Unhandled ${type} error:`, error);
            this.showNotification('An error occurred. Please try again.', 'error');
        }
    }

    // Utility methods

    /**
     * Show UI section
     * @private
     */
    showSection(sectionName) {
        const section = document.querySelector(`#${sectionName}-section, .${sectionName}-section`);
        if (section) {
            section.classList.remove('d-none');
            section.style.display = '';
        }
    }

    /**
     * Hide UI section
     * @private
     */
    hideSection(sectionName) {
        const section = document.querySelector(`#${sectionName}-section, .${sectionName}-section`);
        if (section) {
            section.classList.add('d-none');
        }
    }

    /**
     * Show notification
     * @private
     */
    showNotification(message, type = 'info') {
        // Use NotificationService if available via event system
        this.eventBus.emit('notification:show', { message, type });
    }

    /**
     * Enable authenticated components
     * @private
     */
    enableAuthenticatedComponents() {
        const components = this.componentRegistry.getAllComponents();
        components.forEach(component => {
            if (typeof component.setAuthenticationState === 'function') {
                component.setAuthenticationState(true);
            }
        });
    }

    /**
     * Disable authenticated components
     * @private
     */
    disableAuthenticatedComponents() {
        const components = this.componentRegistry.getAllComponents();
        components.forEach(component => {
            if (typeof component.setAuthenticationState === 'function') {
                component.setAuthenticationState(false);
            }
        });
    }

    /**
     * Update results display
     * @private
     */
    updateResults(results) {
        if (!results) return;

        const { detected = [], unknown = [] } = results;

        // Update photo grids
        const photoGrids = this.componentRegistry.getComponentsByType('PhotoGrid');
        photoGrids.forEach(grid => {
            const gridType = grid.options.photoType || 'detected';
            if (gridType === 'detected' && detected.length > 0) {
                grid.setPhotos(detected);
            } else if (gridType === 'unknown' && unknown.length > 0) {
                grid.setPhotos(unknown);
            }
        });

        // Update photo groups
        const photoGroups = this.componentRegistry.getComponentsByType('PhotoGroup');
        if (photoGroups.length > 0 && detected.length > 0) {
            const groupedPhotos = this.groupPhotosByBibNumber(detected);
            photoGroups[0].setGroups(groupedPhotos);
        }
    }

    /**
     * Group photos by bib number
     * @private
     */
    groupPhotosByBibNumber(photos) {
        const groups = {};
        
        photos.forEach(photo => {
            const bibNumber = photo.bib_number || 'unknown';
            if (!groups[bibNumber]) {
                groups[bibNumber] = {
                    key: bibNumber,
                    bib_number: bibNumber,
                    photos: []
                };
            }
            groups[bibNumber].photos.push(photo);
        });

        return groups;
    }

    /**
     * Recover from component error
     * @private
     */
    recoverFromComponentError(error, data) {
        // Attempt to recreate failed component
        if (data && data.componentType && data.containerSelector) {
            setTimeout(async () => {
                try {
                    await this.componentFactory.create(
                        data.componentType,
                        null,
                        data.containerSelector,
                        data.options || {}
                    );
                    this.log('Component recovered from error', data);
                } catch (recoveryError) {
                    this.log('Component recovery failed', recoveryError);
                }
            }, 1000);
        }
    }

    /**
     * Generate workflow ID
     * @private
     */
    generateWorkflowId() {
        return `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    /**
     * Get integration statistics
     */
    getStats() {
        return {
            metrics: { ...this.metrics },
            routes: {
                total: this.eventRoutes.size,
                events: Array.from(this.eventRoutes.keys())
            },
            bindings: {
                total: this.stateBindings.size,
                states: Array.from(this.stateBindings.keys())
            },
            workflows: {
                active: this.workflows.size,
                list: Array.from(this.workflows.keys())
            },
            components: this.componentRegistry.getStats()
        };
    }

    /**
     * Cleanup integration layer
     */
    async cleanup() {
        // Destroy all workflows
        this.workflows.clear();

        // Clear event routes
        this.eventRoutes.clear();
        this.stateBindings.clear();

        // Cleanup components
        await this.componentRegistry.cleanup();

        this.log('Integration layer cleaned up');
    }

    /**
     * Logging helper
     * @private
     */
    log(...args) {
        if (this.options.debug) {
            console.log('[Integration]', ...args);
        }
    }
}