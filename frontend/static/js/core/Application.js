/**
 * Application - Main application bootstrap for TagSort
 * Coordinates service container, event bus, and application lifecycle
 */

import { EventBus, eventBus } from './EventBus.js';
import { ServiceContainer, serviceContainer } from './ServiceContainer.js';
// Import all essential classes that are being instantiated in the bootstrap
import { ApiService } from '../services/ApiService.js';
import { AuthService } from '../services/AuthService.js';
import { AppConfig } from '../config/AppConfig.js';
import { StateManagerService } from '../services/StateManagerService.js';

export class Application {
    constructor() {
        this.eventBus = eventBus;
        this.serviceContainer = serviceContainer;
        this.isInitialized = false;
        this.isStarted = false;
        this.debugMode = false;
        this.version = '2.0.0';
        
        // Application lifecycle state
        this.state = 'created'; // created -> initializing -> initialized -> starting -> running -> stopping -> stopped
        
        // Bind event handlers
        this.handleUnload = this.handleUnload.bind(this);
        this.handleError = this.handleError.bind(this);
        this.handleUnhandledRejection = this.handleUnhandledRejection.bind(this);
        
        if (this.debugMode) {
            console.log('[Application] Application instance created');
        }
    }

    /**
     * Initialize the application
     * @param {object} config - Application configuration
     * @returns {Promise<void>}
     */
    async initialize(config = {}) {
        if (this.isInitialized) {
            console.warn('[Application] Application already initialized');
            return;
        }

        this.state = 'initializing';
        
        try {
            // Merge default config with provided config
            this.config = {
                debugMode: false,
                apiBaseUrl: AppConfig.apiBaseUrl,
                enableErrorTracking: true,
                enablePerformanceMonitoring: false,
                ...config
            };

            // Set debug mode
            this.setDebugMode(this.config.debugMode);

            // Setup error handling
            if (this.config.enableErrorTracking) {
                this.setupErrorHandling();
            }

            // Initialize event bus
            this.eventBus.setDebugMode(this.debugMode);

            // Initialize service container
            this.serviceContainer.setDebugMode(this.debugMode);

            // Register core and essential services
            this.registerCoreServices();
            this.registerEssentialServices();

            // Emit initialization event
            this.eventBus.emit('app:initializing', { config: this.config });

            // Validate service container
            const validation = this.serviceContainer.validate();
            if (!validation.valid) {
                throw new Error(`Service validation failed: ${validation.errors.join(', ')}`);
            }

            if (validation.warnings.length > 0 && this.debugMode) {
                console.warn('[Application] Service validation warnings:', validation.warnings);
            }

            this.isInitialized = true;
            this.state = 'initialized';

            // Emit initialized event
            this.eventBus.emit('app:initialized', { application: this });

            if (this.debugMode) {
                console.log('[Application] Application initialized successfully');
            }

        } catch (error) {
            this.state = 'error';
            console.error('[Application] Failed to initialize application:', error);
            throw error;
        }
    }

    /**
     * Start the application
     * @returns {Promise<void>}
     */
    async start() {
        if (!this.isInitialized) {
            throw new Error('Application must be initialized before starting');
        }

        if (this.isStarted) {
            console.warn('[Application] Application already started');
            return;
        }

        this.state = 'starting';

        try {
            // Emit starting event
            this.eventBus.emit('app:starting', { application: this });

            // Start services that need startup
            await this.startServices();

            // Setup routing
            await this.setupRouting();

            // Initialize UI components
            await this.initializeComponents();

            this.isStarted = true;
            this.state = 'running';

            // Emit started event
            this.eventBus.emit('app:started', { application: this });

            if (this.debugMode) {
                console.log('[Application] Application started successfully');
            }

        } catch (error) {
            this.state = 'error';
            console.error('[Application] Failed to start application:', error);
            throw error;
        }
    }

    /**
     * Stop the application gracefully
     * @returns {Promise<void>}
     */
    async stop() {
        if (!this.isStarted) {
            return;
        }

        this.state = 'stopping';

        try {
            // Emit stopping event
            this.eventBus.emit('app:stopping', { application: this });

            // Stop services
            await this.stopServices();

            // Clean up event listeners
            this.removeErrorHandling();

            this.isStarted = false;
            this.state = 'stopped';

            // Emit stopped event
            this.eventBus.emit('app:stopped', { application: this });

            if (this.debugMode) {
                console.log('[Application] Application stopped successfully');
            }

        } catch (error) {
            console.error('[Application] Error during application shutdown:', error);
        }
    }

    registerEssentialServices() {
        const apiService = new ApiService(this.eventBus, AppConfig.apiBaseUrl); // assuming dependencies
        this.serviceContainer.registerInstance('apiService', apiService);
        
        const stateManager = new StateManagerService(
            this.eventBus,       // 1. eventBus
            apiService,          // 2. apiService (dependency)
            AppConfig,           // 3. AppConfig (configuration source)
            { debug: true }      // 4. Optional local options object
        ); 
        this.serviceContainer.registerInstance('stateManager', stateManager);

        // Register AuthService, ensuring it gets its dependencies from the container
        const authService = new AuthService(
            this.eventBus,
            apiService, // Pass the instance directly
            this.serviceContainer.get('stateManager') // Assuming stateManager is needed
        );
        this.serviceContainer.registerInstance('authService', authService);
        
        // Now AuthService is guaranteed to exist before any legacy wrapper calls it.
    }

    /**
     * Register core services with the service container
     * @private
     */
    registerCoreServices() {
        // Register EventBus as a service
        this.serviceContainer.registerInstance('eventBus', this.eventBus);

        // Note: Other services will be registered by their respective modules
        // This follows the modular approach where each service registers itself
    }

    /**
     * Start services that require startup logic
     * @private
     */
    async startServices() {
        // Get all services with 'startup' tag and start them
        const startupServices = this.serviceContainer.getByTag('startup');
        
        for (const [name, service] of startupServices) {
            if (typeof service.start === 'function') {
                try {
                    await service.start();
                    if (this.debugMode) {
                        console.log(`[Application] Started service: ${name}`);
                    }
                } catch (error) {
                    console.error(`[Application] Failed to start service ${name}:`, error);
                }
            }
        }
    }

    /**
     * Stop services that require shutdown logic
     * @private
     */
    async stopServices() {
        // Get all services with 'startup' tag and stop them
        const startupServices = this.serviceContainer.getByTag('startup');
        
        for (const [name, service] of startupServices) {
            if (typeof service.stop === 'function') {
                try {
                    await service.stop();
                    if (this.debugMode) {
                        console.log(`[Application] Stopped service: ${name}`);
                    }
                } catch (error) {
                    console.error(`[Application] Failed to stop service ${name}:`, error);
                }
            }
        }
    }

    /**
     * Setup application routing
     * @private
     */
    async setupRouting() {
        // This will be implemented when we create the Router service
        // For now, we'll use the existing AppRouter
        if (typeof window !== 'undefined' && window.appRouter) {
            // Router is already setup
            return;
        }

        if (this.debugMode) {
            console.log('[Application] Routing setup complete');
        }
    }

    /**
     * Initialize UI components
     * @private
     */
    async initializeComponents() {
        // This will be implemented when we create component modules
        // For now, we'll work with existing components

        if (this.debugMode) {
            console.log('[Application] UI components initialized');
        }
    }

    /**
     * Setup error handling
     * @private
     */
    setupErrorHandling() {
        window.addEventListener('error', this.handleError);
        window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
        window.addEventListener('beforeunload', this.handleUnload);
    }

    /**
     * Remove error handling
     * @private
     */
    removeErrorHandling() {
        window.removeEventListener('error', this.handleError);
        window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
        window.removeEventListener('beforeunload', this.handleUnload);
    }

    /**
     * Handle global errors
     * @private
     */
    handleError(event) {
        console.error('[Application] Global error:', event.error);
        this.eventBus.emit('app:error', {
            type: 'error',
            error: event.error,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
        });
    }

    /**
     * Handle unhandled promise rejections
     * @private
     */
    handleUnhandledRejection(event) {
        console.error('[Application] Unhandled promise rejection:', event.reason);
        this.eventBus.emit('app:error', {
            type: 'unhandled_rejection',
            reason: event.reason
        });
    }

    /**
     * Handle page unload
     * @private
     */
    handleUnload(event) {
        if (this.isStarted) {
            this.eventBus.emit('app:unload');
            // Note: We can't use async/await here due to browser limitations
            // Services should handle their own cleanup on the unload event
        }
    }

    /**
     * Set debug mode for application and all subsystems
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
        
        if (this.eventBus) {
            this.eventBus.setDebugMode(enabled);
        }
        
        if (this.serviceContainer) {
            this.serviceContainer.setDebugMode(enabled);
        }
    }

    /**
     * Get application info
     */
    getInfo() {
        return {
            version: this.version,
            state: this.state,
            isInitialized: this.isInitialized,
            isStarted: this.isStarted,
            debugMode: this.debugMode,
            config: this.config,
            services: this.serviceContainer.getServiceNames(),
            events: this.eventBus.getEvents()
        };
    }

    /**
     * Get a service from the container
     * @param {string} serviceName - Name of the service
     * @returns {any} Service instance
     */
    getService(serviceName) {
        return this.serviceContainer.get(serviceName);
    }

    /**
     * Emit an application event
     * @param {string} eventName - Name of the event
     * @param {any} data - Event data
     */
    emit(eventName, data) {
        this.eventBus.emit(eventName, data);
    }

    /**
     * Subscribe to an application event
     * @param {string} eventName - Name of the event
     * @param {Function} handler - Event handler
     * @returns {Function} Unsubscribe function
     */
    on(eventName, handler) {
        return this.eventBus.on(eventName, handler);
    }
}

// Create and export singleton instance
export const app = new Application();