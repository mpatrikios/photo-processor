/**
 * BaseService - Base class for all TagSort services
 * Provides common functionality for service classes
 */

export class BaseService {
    constructor(eventBus, options = {}) {
        if (!eventBus) {
            throw new Error('EventBus is required for all services');
        }
        
        this.eventBus = eventBus;
        this.options = {
            name: this.constructor.name,
            enabled: true,
            debugMode: false,
            enablePersistence: false,
            enableValidation: false,
            debug: false,
            periodicSaveInterval: 30000,
            ...options
        };
        
        // Backward compatibility - also expose as config
        this.config = this.options;
        
        // Service state
        this.isInitialized = false;
        this.isStarted = false;
        this.debugMode = this.options.debugMode || this.options.debug || false;
        
        // Event listeners cleanup
        this.eventListeners = [];
        
        // State management properties (for StateManagerService)
        this.state = this.createInitialState ? this.createInitialState() : {};
        this.changesSinceLastSave = new Set();
        this.persistenceTimer = null;
        this.legacyListeners = new Map();
        
        this.log('Service instance created');
    }

    /**
     * Initialize the service
     * Override in subclasses for custom initialization
     */
    async initialize() {
        if (this.isInitialized) {
            this.log('Service already initialized');
            return;
        }

        this.log('Initializing service');
        
        try {
            await this.onInitialize();
            this.isInitialized = true;
            this.emit('service:initialized', { service: this.config.name });
            this.log('Service initialized successfully');
        } catch (error) {
            this.error('Failed to initialize service:', error);
            throw error;
        }
    }

    /**
     * Start the service
     * Override in subclasses for custom startup logic
     */
    async start() {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (this.isStarted) {
            this.log('Service already started');
            return;
        }

        this.log('Starting service');

        try {
            await this.onStart();
            this.isStarted = true;
            this.emit('service:started', { service: this.config.name });
            this.log('Service started successfully');
        } catch (error) {
            this.error('Failed to start service:', error);
            throw error;
        }
    }

    /**
     * Stop the service
     * Override in subclasses for custom shutdown logic
     */
    async stop() {
        if (!this.isStarted) {
            this.log('Service already stopped');
            return;
        }

        this.log('Stopping service');

        try {
            await this.onStop();
            this.cleanup();
            this.isStarted = false;
            this.emit('service:stopped', { service: this.config.name });
            this.log('Service stopped successfully');
        } catch (error) {
            this.error('Error during service shutdown:', error);
            // Continue with cleanup even if onStop fails
            this.cleanup();
            this.isStarted = false;
        }
    }

    /**
     * Lifecycle hooks - override in subclasses
     */
    async onInitialize() {
        // Override in subclasses
    }

    async onStart() {
        // Override in subclasses
    }

    async onStop() {
        // Override in subclasses
    }

    /**
     * Emit an event through the event bus
     * @param {string} eventName - Name of the event
     * @param {any} data - Event data
     * @param {object} options - Emit options
     */
    emit(eventName, data = null, options = {}) {
        try {
            this.eventBus.emit(eventName, data, options);
            
            if (this.debugMode) {
                this.log(`Event emitted: ${eventName}`, data);
            }
        } catch (error) {
            this.error('Failed to emit event:', error);
        }
    }

    /**
     * Subscribe to an event
     * @param {string} eventName - Name of the event
     * @param {Function} handler - Event handler
     * @param {object} options - Subscription options
     * @returns {Function} Unsubscribe function
     */
    on(eventName, handler, options = {}) {
        try {
            const unsubscribe = this.eventBus.on(eventName, handler, options);
            
            // Track listeners for cleanup
            this.eventListeners.push({
                eventName,
                handler,
                unsubscribe
            });

            if (this.debugMode) {
                this.log(`Subscribed to event: ${eventName}`);
            }

            return unsubscribe;
        } catch (error) {
            this.error('Failed to subscribe to event:', error);
            return () => {}; // Return no-op function
        }
    }

    /**
     * Subscribe to an event that fires only once
     * @param {string} eventName - Name of the event
     * @param {Function} handler - Event handler
     * @param {object} options - Subscription options
     * @returns {Function} Unsubscribe function
     */
    once(eventName, handler, options = {}) {
        try {
            const unsubscribe = this.eventBus.once(eventName, handler, options);
            
            if (this.debugMode) {
                this.log(`Subscribed to event (once): ${eventName}`);
            }

            return unsubscribe;
        } catch (error) {
            this.error('Failed to subscribe to event (once):', error);
            return () => {}; // Return no-op function
        }
    }

    /**
     * Unsubscribe from an event
     * @param {string} eventName - Name of the event
     * @param {Function} handler - Event handler to remove
     */
    off(eventName, handler) {
        try {
            this.eventBus.off(eventName, handler);
            
            // Remove from tracked listeners
            this.eventListeners = this.eventListeners.filter(
                listener => !(listener.eventName === eventName && listener.handler === handler)
            );

            if (this.debugMode) {
                this.log(`Unsubscribed from event: ${eventName}`);
            }
        } catch (error) {
            this.error('Failed to unsubscribe from event:', error);
        }
    }

    /**
     * Create a promise that resolves when a specific event is emitted
     * @param {string} eventName - Name of the event to wait for
     * @param {number} timeout - Optional timeout in milliseconds
     * @returns {Promise} Promise that resolves with event data
     */
    waitFor(eventName, timeout = null) {
        return this.eventBus.waitFor(eventName, timeout);
    }

    /**
     * Get service status information
     * @returns {object} Service status
     */
    getStatus() {
        return {
            name: this.config.name,
            isInitialized: this.isInitialized,
            isStarted: this.isStarted,
            enabled: this.config.enabled,
            debugMode: this.debugMode,
            eventListeners: this.eventListeners.length
        };
    }

    /**
     * Enable or disable the service
     * @param {boolean} enabled - Whether to enable the service
     */
    setEnabled(enabled) {
        this.config.enabled = enabled;
        this.emit('service:enabled_changed', { 
            service: this.config.name, 
            enabled 
        });
        this.log(`Service ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Enable or disable debug mode
     * @param {boolean} enabled - Whether to enable debug mode
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
        this.log(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Cleanup resources
     * @private
     */
    cleanup() {
        // Remove all event listeners
        this.eventListeners.forEach(({ unsubscribe }) => {
            try {
                unsubscribe();
            } catch (error) {
                // Ignore cleanup errors
            }
        });
        this.eventListeners = [];

        this.log('Service cleanup completed');
    }

    /**
     * Logging methods
     */
    log(message, ...args) {
        if (this.debugMode) {
            console.log(`[${this.config.name}] ${message}`, ...args);
        }
    }

    warn(message, ...args) {
        console.warn(`[${this.config.name}] ${message}`, ...args);
    }

    error(message, ...args) {
        console.error(`[${this.config.name}] ${message}`, ...args);
    }

    /**
     * Helper method to handle async operations with error handling
     * @param {Function} asyncFn - Async function to execute
     * @param {string} operationName - Name of the operation for logging
     * @returns {Promise} Result of the async function
     */
    async handleAsync(asyncFn, operationName = 'operation') {
        try {
            this.log(`Starting ${operationName}`);
            const result = await asyncFn();
            this.log(`Completed ${operationName}`);
            return result;
        } catch (error) {
            this.error(`Failed ${operationName}:`, error);
            throw error;
        }
    }

    /**
     * Helper method to validate required parameters
     * @param {object} params - Parameters object
     * @param {string[]} required - Array of required parameter names
     * @throws {Error} If required parameters are missing
     */
    validateRequired(params, required) {
        const missing = required.filter(param => 
            params[param] === undefined || params[param] === null || params[param] === ''
        );
        
        if (missing.length > 0) {
            const error = new Error(`Missing required parameters: ${missing.join(', ')}`);
            this.error(error.message);
            throw error;
        }
    }

    /**
     * Helper method to check if service is ready for operations
     * @throws {Error} If service is not ready
     */
    ensureReady() {
        if (!this.config.enabled) {
            throw new Error(`Service ${this.config.name} is disabled`);
        }
        
        if (!this.isInitialized) {
            throw new Error(`Service ${this.config.name} is not initialized`);
        }
        
        if (!this.isStarted) {
            throw new Error(`Service ${this.config.name} is not started`);
        }
    }
}