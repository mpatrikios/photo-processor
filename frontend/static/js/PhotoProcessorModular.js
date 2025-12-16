/**
 * PhotoProcessorModular - Modular photo processing application
 * Uses component architecture to replace the monolithic PhotoProcessor
 * Coordinates between services and UI components for clean separation of concerns
 */

import { Application } from './core/Application.js';
import { EventBus } from './core/EventBus.js';
import { ServiceContainer } from './core/ServiceContainer.js';
import { Integration } from './core/Integration.js';
import { ComponentFactory } from './core/ComponentFactory.js';

// Import services
import { AppConfig } from './config/AppConfig.js';
import { ApiService } from './services/ApiService.js';
import { AuthService } from './services/AuthService.js';
import { UploadService } from './services/UploadService.js';
import { ProcessingService } from './services/ProcessingService.js';
import { ExportService } from './services/ExportService.js';
import { RouterService } from './services/RouterService.js';
import { NotificationService } from './services/NotificationService.js';
import { ProfileService } from './services/ProfileService.js';
import { StateManagerService } from './services/StateManagerService.js';
import { BatchService } from './services/BatchService.js';
import { QuotaService } from './services/QuotaService.js';

export class PhotoProcessorModular extends Application {
    constructor(options = {}) {
        super({
            name: 'PhotoProcessorModular',
            version: '2.0.0',
            ...options
        });

        // Application state
        this.currentSection = 'auth'; // auth, upload, processing, results
        this.currentUser = null;
        this.currentJob = null;
        this.currentResults = null;
        this.isInitialized = false;

        // Component references
        this.components = {
            auth: null,
            upload: null,
            processing: null,
            results: null
        };

        // Integration layer
        this.integration = null;
        this.componentFactory = null;

        // Legacy support
        this.legacyMethods = {};
    }

    /**
     * Initialize the modular photo processor
     */
    async initialize() {
        try {
            // Initialize core application
            await super.initialize();

            // Initialize services
            await this.initializeServices();

            // Initialize integration layer
            await this.initializeIntegration();

            // Initialize components
            await this.initializeComponents();

            // Setup application flow
            this.setupApplicationFlow();

            // Setup legacy compatibility
            this.setupLegacyCompatibility();

            // Setup global functions for HTML compatibility
            this.setupGlobalFunctions();

            // Initialize based on current state
            await this.initializeAppState();

            this.isInitialized = true;
            console.log('[PhotoProcessorModular] PhotoProcessorModular initialized successfully');

        } catch (error) {
            console.error('[PhotoProcessorModular] Failed to initialize PhotoProcessorModular:', error);
            throw error;
        }
    }

    /**
     * Initialize services
     * @private
     */
    async initializeServices() {
        console.log('[PhotoProcessorModular] Starting service initialization...');
        
        // 1. SERVICES WITHOUT EXTERNAL SERVICE DEPENDENCIES (EventBus only)
        const routerService = new RouterService(this.eventBus);
        console.log('[PhotoProcessorModular] RouterService created');
        
        const notificationService = new NotificationService(this.eventBus, {
            enableBrowserNotifications: true,
            enableToasts: true,
            debug: AppConfig.debugMode || false
        });
        
        const profileService = new ProfileService(this.eventBus, {
            enableLocalStorage: true,
            enableValidation: true,
            debug: AppConfig.debugMode || false
        });

        // 4. REGISTER ALL SERVICES (as factory functions)
        this.serviceContainer.register('apiService', () => {
            const apiService = new ApiService(this.eventBus, {
                baseURL: AppConfig.apiBaseUrl 
            });
            console.log('[PhotoProcessorModular] Created ApiService:', {
                instance: !!apiService,
                methods: Object.getOwnPropertyNames(Object.getPrototypeOf(apiService)),
                hasPost: typeof apiService.post === 'function'
            });
            return apiService;
        });
        
        this.serviceContainer.register('stateManagerService', () => {
            const stateManagerService = new StateManagerService(
                this.eventBus, 
                this.serviceContainer.get('apiService'),         
                AppConfig,
                { 
                    enablePersistence: true,
                    enableValidation: AppConfig.debugMode || false,
                    debug: AppConfig.debugMode || false
                }          
            );
            stateManagerService.serviceContainer = this.serviceContainer;
            return stateManagerService;
        });
        
        this.serviceContainer.register('authService', () => {
            const apiService = this.serviceContainer.get('apiService');
            const stateManagerService = this.serviceContainer.get('stateManagerService');
            
            console.log('[PhotoProcessorModular] Creating AuthService with dependencies:', {
                apiService: !!apiService,
                apiServiceMethods: apiService ? Object.getOwnPropertyNames(Object.getPrototypeOf(apiService)) : 'null',
                stateManagerService: !!stateManagerService
            });
            
            const authService = new AuthService(
                this.eventBus, 
                apiService,
                stateManagerService
            );
            authService.serviceContainer = this.serviceContainer;
            return authService;
        }); 
        
        this.serviceContainer.register('uploadService', () => new UploadService(
            this.serviceContainer.get('apiService')
        ));
        
        this.serviceContainer.register('processingService', () => new ProcessingService(
            this.serviceContainer.get('apiService')
        ));
        
        this.serviceContainer.register('exportService', () => new ExportService(
            this.serviceContainer.get('apiService')
        ));

        this.serviceContainer.register('routerService', () => routerService);
        this.serviceContainer.register('notificationService', () => notificationService);
        this.serviceContainer.register('profileService', () => profileService);
        this.serviceContainer.register('batchService', () => {
            const batchService = new BatchService(this.eventBus);
            batchService.serviceContainer = this.serviceContainer;
            return batchService;
        });

        this.serviceContainer.register('quotaService', () => {
            const quotaService = new QuotaService(
                this.eventBus,
                this.serviceContainer.get('apiService')
            );
            quotaService.serviceContainer = this.serviceContainer;
            return quotaService;
        });

        console.log('[PhotoProcessorModular] Services registered:', this.serviceContainer.getServiceNames());
        console.log('[PhotoProcessorModular] BatchService available in container:', this.serviceContainer.has('batchService'));
    }


    /**
     * Initialize integration layer
     * @private
     */
    async initializeIntegration() {
        this.integration = new Integration({
            enableAutoRouting: true,
            enableStateSync: true,
            enableErrorRecovery: true
        });

        // Create services object for integration layer
        const servicesObject = {};
        for (const serviceName of this.serviceContainer.getServiceNames()) {
            servicesObject[serviceName] = this.serviceContainer.get(serviceName);
        }
        
        // Add EventBus to services for component access
        servicesObject.eventBus = this.eventBus;
        
        console.log('[PhotoProcessorModular] Services being passed to Integration:', Object.keys(servicesObject));
        console.log('[PhotoProcessorModular] BatchService available:', !!servicesObject.batchService);

        await this.integration.initialize(
            this.eventBus,
            servicesObject
        );

        // Initialize and start all services
        console.log('[PhotoProcessorModular] Initializing services...');
        for (const serviceName of this.serviceContainer.getServiceNames()) {
            try {
                const service = this.serviceContainer.get(serviceName);
                if (service && typeof service.initialize === 'function') {
                    await service.initialize();
                }
                if (service && typeof service.start === 'function') {
                    await service.start();
                }
                console.log(`[PhotoProcessorModular] ${serviceName} initialized and started`);
            } catch (error) {
                console.error(`[PhotoProcessorModular] Failed to initialize ${serviceName}:`, error);
            }
        }

        this.componentFactory = ComponentFactory.create(this.integration.componentRegistry);

        console.log('[PhotoProcessorModular] Integration layer initialized');
    }

    /**
     * Initialize components
     * @private
     */
    async initializeComponents() {
        try {
            // Create authentication system
            this.components.auth = await this.createAuthenticationSystem();

            // Create upload system
            this.components.upload = await this.createUploadSystem();

            // Create processing system
            this.components.processing = await this.createProcessingSystem();

            // Create results system
            this.components.results = await this.createResultsSystem();

            // Create analytics system
            this.components.analytics = await this.createAnalyticsSystem();

            console.log('[PhotoProcessorModular] Components initialized');

        } catch (error) {
            console.error('[PhotoProcessorModular] Failed to initialize components:', error);
            throw error;
        }
    }

    /**
     * Create authentication system
     * @private
     */
    async createAuthenticationSystem() {
        const authContainer = '#landing-page';
        
        const authSystem = await this.componentFactory.createAuthSystem(authContainer);

        // Setup authentication event handling
        this.eventBus.on('auth:signin:success', this.handleAuthSuccess.bind(this));
        this.eventBus.on('auth:signout:success', this.handleAuthSignOut.bind(this));
        this.eventBus.on('auth:token:expired', this.handleTokenExpired.bind(this));

        return authSystem;
    }

    /**
     * Create upload system
     * @private
     */
    async createUploadSystem() {
        const uploadContainer = '#upload-section';
        
        const uploadSystem = await this.componentFactory.createUploadSystem(uploadContainer);

        // Setup upload event handling
        this.eventBus.on('upload:manager:completed', this.handleUploadCompleted.bind(this));
        this.eventBus.on('upload:manager:error', this.handleUploadError.bind(this));

        return uploadSystem;
    }

    /**
     * Create processing system
     * @private
     */
    async createProcessingSystem() {
        const processingContainer = '#processing-section';
        
        const processingSystem = await this.componentFactory.createProcessingSystem(processingContainer);

        // Setup processing event handling
        this.eventBus.on('processing:manager:completed', this.handleProcessingCompleted.bind(this));
        this.eventBus.on('processing:manager:failed', this.handleProcessingFailed.bind(this));

        return processingSystem;
    }

    /**
     * Create results system
     * @private
     */
    async createResultsSystem() {
        // Note: Results system components will be created lazily when results section is shown
        // because their containers are inside the hidden #results-section
        console.log('[PhotoProcessorModular] Results system will be created when section becomes visible');
        
        // Setup results event handling
        this.eventBus.on('photogrid:photo:clicked', this.handlePhotoClicked.bind(this));
        this.eventBus.on('photogroup:photo:clicked', this.handlePhotoClicked.bind(this));
        this.eventBus.on('labeling:edit:saved', this.handlePhotoLabelUpdated.bind(this));

        // Return placeholder that will be replaced when results are shown
        return {
            initialized: false,
            components: null
        };
    }

    /**
     * Create the actual results system when section becomes visible
     * @private
     */
    async createActualResultsSystem() {
        if (this.components.results && this.components.results.initialized) {
            return this.components.results;
        }

        try {
            const resultsContainer = '#results-section';
            
            const resultsSystem = await this.componentFactory.createResultsSystem(resultsContainer, {
                showFilters: true,
                showLabelingTools: true,
                showBatchOperations: true,
                photosType: 'detected',
                useGrouping: true
            });

            // Replace the placeholder with actual system
            this.components.results = {
                initialized: true,
                components: resultsSystem
            };

            console.log('[PhotoProcessorModular] Results system created successfully');
            return this.components.results;

        } catch (error) {
            console.error('[PhotoProcessorModular] Failed to create results system:', error);
            // Return the placeholder to avoid breaking the app
            return this.components.results;
        }
    }

    /**
     * Create analytics system
     * @private
     */
    async createAnalyticsSystem() {
        const analyticsContainer = 'body'; // Analytics dashboard creates its own modal
        
        const analyticsSystem = await this.componentFactory.createAnalyticsSystem(analyticsContainer, {
            enableAutoRefresh: true,
            refreshInterval: 30000,
            enableExportFeatures: true
        });

        // Setup analytics event handling
        this.eventBus.on('analytics:show', () => {
            if (analyticsSystem?.dashboard) {
                analyticsSystem.dashboard.show();
            }
        });

        this.eventBus.on('analytics:hide', () => {
            if (analyticsSystem?.dashboard) {
                analyticsSystem.dashboard.hide();
            }
        });

        return analyticsSystem;
    }

    /**
     * Setup application flow
     * @private
     */
    setupApplicationFlow() {
        // Authentication flow
        this.eventBus.on('auth:signin:success', () => {
            this.checkAppStateAfterAuth();
        });

        // Upload to processing flow
        this.eventBus.on('upload:manager:completed', (data) => {
            this.transitionToProcessing(data.photos);
        });

        // Processing to results flow
        this.eventBus.on('processing:manager:completed', (data) => {
            this.transitionToResults(data.results);
        });

        // Router events
        this.eventBus.on('navigation:show_section', this.handleShowSection.bind(this));
        this.eventBus.on('navigation:restore_state', this.handleRestoreState.bind(this));
        this.eventBus.on('navigation:check_results', this.handleCheckResults.bind(this));

        console.log('[PhotoProcessorModular] Application flow setup');
    }

    /**
     * Setup legacy compatibility
     * @private
     */
    setupLegacyCompatibility() {
        // Create legacy method proxies for existing code
        this.legacyMethods = {
            showSignInModal: () => this.components.auth?.signInModal?.show(),
            showCreateAccountModal: () => this.components.auth?.createAccountModal?.show(),
            switchToCreateAccount: () => this.components.auth?.authManager?.switchToCreateAccount(),
            switchToSignIn: () => this.components.auth?.authManager?.switchToSignIn(),
            
            showUploadSection: () => this.showSection('upload'),
            showProcessingSection: () => this.showSection('processing'),
            showResultsSection: () => this.showSection('results'),
            
            checkAndRestoreRecentJob: () => this.checkAndRestoreRecentJob(),
            startProcessing: (files) => this.startProcessing(files),
            
            // Legacy properties
            get isAuthenticated() { return this.currentUser !== null; },
            get authToken() { return this.serviceContainer.get('authService')?.getToken(); },
            get currentJobId() { return this.currentJob?.job_id; },
            get groupedPhotos() { return this.currentResults?.groups || []; }
        };

        // Expose legacy methods globally for compatibility
        if (typeof window !== 'undefined') {
            window.photoProcessorModular = this;
            
            // Create legacy global functions
            Object.assign(window, {
                showSignInModal: this.legacyMethods.showSignInModal,
                showCreateAccountModal: this.legacyMethods.showCreateAccountModal,
                switchToCreateAccount: this.legacyMethods.switchToCreateAccount,
                switchToSignIn: this.legacyMethods.switchToSignIn
            });
        }

        console.log('[PhotoProcessorModular] Legacy compatibility setup');
    }

    /**
     * Setup global functions for legacy HTML compatibility
     * @private
     */
    setupGlobalFunctions() {
        // Global logout function for HTML onclick handlers
        window.logout = async () => {
            try {
                const authService = this.serviceContainer.get('authService');
                if (authService) {
                    await authService.logout();
                } else {
                    console.warn('AuthService not available for logout');
                    // Fallback: clear localStorage and redirect
                    localStorage.clear();
                    window.location.reload();
                }
            } catch (error) {
                console.error('Logout failed:', error);
                // Force logout by clearing storage and reloading
                localStorage.clear();
                window.location.reload();
            }
        };

        console.log('[PhotoProcessorModular] Global functions setup');
    }

    /**
     * Initialize application state based on current conditions
     * @private
     */
    async initializeAppState() {
        try {
            // For fresh app initialization, clear any stale auth data
            // This ensures users start at the auth page by default
            if (!sessionStorage.getItem('app_initialized')) {
                console.log('[PhotoProcessorModular] First load - clearing stale auth data');
                localStorage.removeItem('auth_token');
                localStorage.removeItem('user_info'); 
                localStorage.removeItem('tagsort-app-state-v2');
                sessionStorage.setItem('app_initialized', 'true');
            }
            
            // Check authentication status
            const authService = this.serviceContainer.get('authService');
            const isAuthenticated = authService.getIsAuthenticated();
            
            console.log('[PhotoProcessorModular] LocalStorage auth data:', {
                auth_token: localStorage.getItem('auth_token'),
                user_info: localStorage.getItem('user_info'),
                stateManagerData: localStorage.getItem('tagsort-app-state-v2')
            });
            console.log('[PhotoProcessorModular] Auth check - isAuthenticated:', isAuthenticated);
            console.log('[PhotoProcessorModular] Auth check - currentUser:', authService.getCurrentUser());

            if (!isAuthenticated) {
                console.log('[PhotoProcessorModular] User not authenticated, showing auth section');
                this.showSection('auth');
                return;
            }
            
            console.log('[PhotoProcessorModular] User authenticated, proceeding to app...');

            this.currentUser = authService.getCurrentUser();

            // Check for existing state to restore
            const stateManagerService = this.serviceContainer.get('stateManagerService');
            
            if (stateManagerService && stateManagerService.hasRecentCompletedJob()) {
                // Try to restore recent job
                await this.checkAndRestoreRecentJob();
            } else {
                // Let RouterService handle initial routing
                const routerService = this.serviceContainer.get('routerService');
                if (routerService) {
                    // RouterService will handle the initial route
                    routerService.handleRouteChange();
                } else {
                    // Fallback: Default to upload section for authenticated users
                    this.showSection('upload');
                }
            }

        } catch (error) {
            console.error('[PhotoProcessorModular] Failed to initialize app state:', error);
            this.showSection('auth');
        }
    }

    /**
     * Show specific section of the app
     */
    showSection(sectionName) {
        // Use RouterService if available
        const routerService = this.serviceContainer?.get('routerService');
        if (routerService) {
            routerService.navigateTo(sectionName);
            return;
        }

        // Fallback to direct DOM manipulation for legacy compatibility
        this.showSectionDirect(sectionName);
    }

    /**
     * Direct section showing (legacy compatibility)
     * @private
     */
    showSectionDirect(sectionName) {
        // Hide all sections
        const sections = ['landing-page', 'app-section', 'upload-section', 'processing-section', 'results-section'];
        sections.forEach(section => {
            const element = document.getElementById(section);
            if (element) {
                element.classList.add('d-none');
            }
        });

        // Show app section for authenticated views
        if (sectionName !== 'auth' && sectionName !== 'landing') {
            const appSection = document.getElementById('app-section');
            if (appSection) {
                appSection.classList.remove('d-none');
            }
        }

        // Show specific section
        let targetSection;
        switch (sectionName) {
            case 'auth':
            case 'landing':
                targetSection = document.getElementById('landing-page');
                break;
            case 'upload':
                targetSection = document.getElementById('upload-section');
                break;
            case 'processing':
                targetSection = document.getElementById('processing-section');
                break;
            case 'results':
                targetSection = document.getElementById('results-section');
                break;
            case 'analytics':
                // Analytics section is handled by analytics component
                this.eventBus.emit('analytics:show');
                return;
            case 'app':
                targetSection = document.getElementById('app-section');
                break;
        }

        if (targetSection) {
            targetSection.classList.remove('d-none');
            
            // If showing results section, create the actual results system now
            if (sectionName === 'results' && this.components.results && !this.components.results.initialized) {
                this.createActualResultsSystem().catch(error => {
                    console.error('[PhotoProcessorModular] Failed to create results system when section shown:', error);
                });
            }
        }

        this.currentSection = sectionName;

        console.log('[PhotoProcessorModular] Section changed to:', sectionName);
        this.eventBus.emit('section:changed', { section: sectionName });
    }

    /**
     * Handle show section events from RouterService
     * @private
     */
    handleShowSection(data) {
        const { section } = data;
        this.showSectionDirect(section);
    }

    /**
     * Handle restore state events from RouterService
     * @private
     */
    handleRestoreState() {
        this.checkAndRestoreRecentJob();
    }

    /**
     * Handle check results events from RouterService
     * @private
     */
    handleCheckResults() {
        // Let RouterService know if we have valid results
        const hasResults = this.currentResults && 
                          (Array.isArray(this.currentResults) ? this.currentResults.length > 0 : 
                           Object.keys(this.currentResults).length > 0);
        
        this.eventBus.emit('navigation:results_available', { hasResults });
    }

    /**
     * Check and restore recent job
     */
    async checkAndRestoreRecentJob() {
        try {
            const stateManagerService = this.serviceContainer.get('stateManagerService');
            if (!stateManagerService || !stateManagerService.hasRecentCompletedJob()) {
                this.showSection('upload');
                return false;
            }

            const savedJob = stateManagerService.getRecentCompletedJob();
            if (!savedJob) {
                this.showSection('upload');
                return false;
            }

            // Validate saved job
            const processingService = this.serviceContainer.get('processingService');
            const jobStatus = await processingService.getJobStatus(savedJob.jobId);

            if (jobStatus && jobStatus.status === 'completed' && jobStatus.results) {
                // Restore successful job
                this.currentJob = { job_id: savedJob.jobId };
                this.currentResults = jobStatus.results;
                
                this.showSection('results');
                this.updateResultsDisplay(jobStatus.results);
                
                console.log('[PhotoProcessorModular] Job restored successfully');
                return true;
            } else {
                // Clear invalid state
                stateManagerService.clearCompletedJob();
                this.showSection('upload');
                return false;
            }

        } catch (error) {
            console.error('[PhotoProcessorModular] Failed to restore recent job:', error);
            this.showSection('upload');
            return false;
        }
    }

    /**
     * Start processing uploaded photos
     */
    async startProcessing(photos) {
        try {
            if (!photos || photos.length === 0) {
                throw new Error('No photos provided for processing');
            }

            this.showSection('processing');

            const processingService = this.serviceContainer.get('processingService');
            const photoIds = photos.map(photo => photo.id);

            const job = await processingService.startProcessing(photoIds);
            this.currentJob = job;

            console.log('[PhotoProcessorModular] Processing started', { jobId: job.job_id, photoCount: photos.length });

        } catch (error) {
            console.error('[PhotoProcessorModular] Failed to start processing:', error);
            this.showError('Failed to start processing. Please try again.');
        }
    }

    /**
     * Update results display
     * @private
     */
    updateResultsDisplay(results) {
        if (!results) return;

        // Update photo display components
        const { detected = [] } = results;

        // Handle new lazy-loaded results system structure
        const resultsComponents = this.components.results?.initialized 
            ? this.components.results.components 
            : null;

        if (resultsComponents?.photoDisplay) {
            if (detected.length > 0) {
                // Group detected photos by bib number
                const groupedPhotos = this.groupPhotosByBibNumber(detected);
                resultsComponents.photoDisplay.setGroups(groupedPhotos);
            }
        }

        // Update available filter options
        if (resultsComponents?.filters) {
            const bibNumbers = [...new Set(detected.map(p => p.bib_number).filter(Boolean))];
            const labels = [...new Set(detected.map(p => p.custom_label).filter(Boolean))];
            
            resultsComponents.filters.setAvailableOptions({
                bibNumbers,
                labels
            });
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
                    photos: [],
                    count: 0
                };
            }
            groups[bibNumber].photos.push(photo);
            groups[bibNumber].count++;
        });

        return Object.values(groups);
    }

    // Event handlers

    /**
     * Handle authentication success
     * @private
     */
    handleAuthSuccess(data) {
        this.currentUser = data.user;
        this.checkAppStateAfterAuth();
    }

    /**
     * Handle authentication sign out
     * @private
     */
    handleAuthSignOut() {
        this.currentUser = null;
        this.currentJob = null;
        this.currentResults = null;
        this.showSection('auth');
    }

    /**
     * Handle token expiration
     * @private
     */
    handleTokenExpired() {
        this.handleAuthSignOut();
        this.showError('Your session has expired. Please sign in again.');
    }

    /**
     * Check app state after authentication
     * @private
     */
    async checkAppStateAfterAuth() {
        // Check for existing results or recent job
        const restored = await this.checkAndRestoreRecentJob();
        
        if (!restored) {
            // No existing state, show upload section
            this.showSection('upload');
        }
    }

    /**
     * Handle upload completion
     * @private
     */
    handleUploadCompleted(data) {
        this.transitionToProcessing(data.photos);
    }

    /**
     * Handle upload error
     * @private
     */
    handleUploadError(data) {
        this.showError(`Upload failed: ${data.error?.message || 'Unknown error'}`);
    }

    /**
     * Handle processing completion
     * @private
     */
    handleProcessingCompleted(data) {
        this.transitionToResults(data.results);
        
        // Save completed job state
        const stateManagerService = this.serviceContainer.get('stateManagerService');
        if (stateManagerService && this.currentJob) {
            stateManagerService.saveCompletedJob(this.currentJob.job_id, data.results);
        }
    }

    /**
     * Handle processing failure
     * @private
     */
    handleProcessingFailed(data) {
        this.showError(`Processing failed: ${data.error || 'Unknown error'}`);
        this.showSection('upload');
    }

    /**
     * Handle photo click for lightbox
     * @private
     */
    handlePhotoClicked(data) {
        // Photo lightbox is handled by the integration layer
        console.log('[PhotoProcessorModular] Photo clicked', data);
    }

    /**
     * Handle photo label updates
     * @private
     */
    handlePhotoLabelUpdated(data) {
        console.log('[PhotoProcessorModular] Photo label updated', data);
        // The integration layer handles propagating updates to all components
    }


    /**
     * Transition to processing section
     * @private
     */
    async transitionToProcessing(photos) {
        this.showSection('processing');
        
        // Start processing
        await this.startProcessing(photos);
    }

    /**
     * Transition to results section
     * @private
     */
    transitionToResults(results) {
        this.currentResults = results;
        this.showSection('results');
        this.updateResultsDisplay(results);
    }

    /**
     * Show error message
     * @private
     */
    showError(message) {
        // Use the NotificationService
        const notificationService = this.serviceContainer?.get('notificationService');
        if (notificationService) {
            notificationService.show(message, 'error');
        } else {
            // Fallback for early initialization errors
            console.error(message);
            alert(message);
        }
    }

    /**
     * Get current application state
     */
    getState() {
        return {
            currentSection: this.currentSection,
            currentUser: this.currentUser,
            currentJob: this.currentJob,
            currentResults: this.currentResults,
            isAuthenticated: !!this.currentUser,
            isInitialized: this.isInitialized
        };
    }

    /**
     * Clean up resources
     */
    async destroy() {
        try {
            // Cleanup integration layer
            if (this.integration) {
                await this.integration.cleanup();
            }

            // Cleanup components
            if (this.components) {
                for (const componentGroup of Object.values(this.components)) {
                    if (componentGroup && typeof componentGroup.destroy === 'function') {
                        await componentGroup.destroy();
                    }
                }
            }

            // Cleanup parent application
            await super.destroy();

            console.log('[PhotoProcessorModular] PhotoProcessorModular destroyed');

        } catch (error) {
            console.error('[PhotoProcessorModular] Error during cleanup:', error);
        }
    }

    /**
     * Create and initialize the modular photo processor
     */
    static async create(options = {}) {
        const processor = new PhotoProcessorModular(options);
        await processor.initialize();
        return processor;
    }
}