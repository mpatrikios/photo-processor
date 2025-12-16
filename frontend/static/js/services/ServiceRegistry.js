/**
 * ServiceRegistry - Service registration and configuration for TagSort
 * Registers all services with the ServiceContainer and handles dependencies
 */

import { serviceContainer } from '../core/ServiceContainer.js';
import { eventBus } from '../core/EventBus.js';
import { ApiService } from './ApiService.js';
import { AuthService } from './AuthService.js';
import { UploadService } from './UploadService.js';
import { ProcessingService } from './ProcessingService.js';
import { ExportService } from './ExportService.js';

/**
 * Register all services with the service container
 * @param {object} config - Global configuration object
 */
export function registerServices(config = {}) {
    const {
        debugMode = false,
        apiBaseUrl = null,
        ...serviceConfigs
    } = config;

    // Enable debug mode on service container if requested
    if (debugMode) {
        serviceContainer.setDebugMode(true);
        eventBus.setDebugMode(true);
    }

    // 1. Register ApiService (no dependencies)
    serviceContainer.register('apiService', () => {
        return new ApiService(eventBus, {
            debugMode,
            baseUrl: apiBaseUrl,
            ...serviceConfigs.api
        });
    }, {
        singleton: true,
        lazy: false, // Create immediately as other services depend on it
        tags: ['core', 'startup']
    });

    // 2. Register AuthService (depends on ApiService)
    serviceContainer.register('authService', (apiService, stateManager) => {
        return new AuthService(eventBus, apiService, stateManager, {
            debugMode,
            ...serviceConfigs.auth
        });
    }, {
        dependencies: ['apiService', 'stateManager'],
        singleton: true,
        lazy: false,
        tags: ['core', 'startup']
    });

    // 3. Register UploadService (depends on ApiService)
    serviceContainer.register('uploadService', (apiService, stateManager) => {
        return new UploadService(eventBus, apiService, stateManager, {
            debugMode,
            ...serviceConfigs.upload
        });
    }, {
        dependencies: ['apiService', 'stateManager'],
        singleton: true,
        lazy: true,
        tags: ['feature']
    });

    // 4. Register ProcessingService (depends on ApiService)
    serviceContainer.register('processingService', (apiService, stateManager) => {
        return new ProcessingService(eventBus, apiService, stateManager, {
            debugMode,
            ...serviceConfigs.processing
        });
    }, {
        dependencies: ['apiService', 'stateManager'],
        singleton: true,
        lazy: true,
        tags: ['feature']
    });

    // 5. Register ExportService (depends on ApiService)
    serviceContainer.register('exportService', (apiService, stateManager) => {
        return new ExportService(eventBus, apiService, stateManager, {
            debugMode,
            ...serviceConfigs.export
        });
    }, {
        dependencies: ['apiService', 'stateManager'],
        singleton: true,
        lazy: true,
        tags: ['feature']
    });

    // Register StateManager as a service if it exists globally
    if (typeof window !== 'undefined' && window.stateManager) {
        serviceContainer.registerInstance('stateManager', window.stateManager);
    }

    // Register EventBus as a service (already done in Application.js, but ensure it's there)
    serviceContainer.registerInstance('eventBus', eventBus);

    console.log('[ServiceRegistry] All services registered successfully');
    
    // Validate service configuration
    const validation = serviceContainer.validate();
    if (!validation.valid) {
        console.error('[ServiceRegistry] Service validation failed:', validation.errors);
        throw new Error(`Service validation failed: ${validation.errors.join(', ')}`);
    }

    if (validation.warnings.length > 0) {
        console.warn('[ServiceRegistry] Service validation warnings:', validation.warnings);
    }

    console.log('[ServiceRegistry] Service validation passed');
}

/**
 * Get service instance from container
 * @param {string} serviceName - Name of the service
 * @returns {any} Service instance
 */
export function getService(serviceName) {
    return serviceContainer.get(serviceName);
}

/**
 * Check if a service is registered
 * @param {string} serviceName - Name of the service
 * @returns {boolean} True if service is registered
 */
export function hasService(serviceName) {
    return serviceContainer.has(serviceName);
}

/**
 * Get all registered service names
 * @returns {string[]} Array of service names
 */
export function getServiceNames() {
    return serviceContainer.getServiceNames();
}

/**
 * Get services by tag
 * @param {string} tag - Service tag
 * @returns {Map} Map of service names to instances
 */
export function getServicesByTag(tag) {
    return serviceContainer.getByTag(tag);
}

/**
 * Initialize and start core services
 * @param {object} config - Configuration object
 * @returns {Promise<void>}
 */
export async function initializeServices(config = {}) {
    try {
        console.log('[ServiceRegistry] Initializing services...');

        // Register all services
        registerServices(config);

        // Get core services that need startup
        const coreServices = serviceContainer.getByTag('core');
        
        // Initialize core services
        for (const [name, service] of coreServices) {
            if (typeof service.initialize === 'function') {
                console.log(`[ServiceRegistry] Initializing ${name}...`);
                await service.initialize();
            }
        }

        // Start core services
        for (const [name, service] of coreServices) {
            if (typeof service.start === 'function') {
                console.log(`[ServiceRegistry] Starting ${name}...`);
                await service.start();
            }
        }

        console.log('[ServiceRegistry] Core services initialized and started');

        // Emit event that services are ready
        eventBus.emit('services:ready', {
            coreServices: Array.from(coreServices.keys()),
            allServices: serviceContainer.getServiceNames()
        });

    } catch (error) {
        console.error('[ServiceRegistry] Service initialization failed:', error);
        throw error;
    }
}

/**
 * Stop all services gracefully
 * @returns {Promise<void>}
 */
export async function stopServices() {
    try {
        console.log('[ServiceRegistry] Stopping services...');

        // Get all services with startup tag
        const startupServices = serviceContainer.getByTag('startup');
        
        // Stop services in reverse order
        const serviceArray = Array.from(startupServices.entries()).reverse();
        
        for (const [name, service] of serviceArray) {
            if (typeof service.stop === 'function') {
                try {
                    console.log(`[ServiceRegistry] Stopping ${name}...`);
                    await service.stop();
                } catch (error) {
                    console.error(`[ServiceRegistry] Error stopping ${name}:`, error);
                }
            }
        }

        console.log('[ServiceRegistry] All services stopped');
        
        // Emit event that services are stopped
        eventBus.emit('services:stopped');

    } catch (error) {
        console.error('[ServiceRegistry] Error during service shutdown:', error);
    }
}

/**
 * Create service configuration with defaults
 * @param {object} userConfig - User-provided configuration
 * @returns {object} Complete service configuration
 */
export function createServiceConfig(userConfig = {}) {
    return {
        debugMode: userConfig.debugMode || false,
        apiBaseUrl: userConfig.apiBaseUrl || null,
        
        // Service-specific configurations
        api: {
            timeout: 30000,
            retryAttempts: 3,
            retryDelay: 1000,
            ...userConfig.api
        },
        
        auth: {
            tokenRefreshMargin: 5 * 60 * 1000, // 5 minutes
            sessionCheckInterval: 60 * 1000, // 1 minute
            ...userConfig.auth
        },
        
        upload: {
            maxFiles: 50,
            maxFileSizeMB: 10,
            allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
            chunkSize: 5 * 1024 * 1024, // 5MB
            ...userConfig.upload
        },
        
        processing: {
            pollInterval: 500,
            maxRetries: 5,
            retryDelay: 2000,
            maxPollTime: 10 * 60 * 1000, // 10 minutes
            ...userConfig.processing
        },
        
        export: {
            progressSteps: 4,
            stepDuration: 800,
            ...userConfig.export
        }
    };
}

/**
 * Get service container dependency graph
 * @returns {object} Dependency graph information
 */
export function getServiceDependencyGraph() {
    return serviceContainer.getDependencyGraph();
}

/**
 * Get service container status
 * @returns {object} Status information for all services
 */
export function getServiceStatus() {
    const status = {
        container: {
            serviceCount: serviceContainer.getServiceNames().length,
            isValid: serviceContainer.validate().valid
        },
        services: {}
    };

    // Get status for each registered service
    for (const serviceName of serviceContainer.getServiceNames()) {
        try {
            const service = serviceContainer.get(serviceName);
            if (service && typeof service.getStatus === 'function') {
                status.services[serviceName] = service.getStatus();
            } else {
                status.services[serviceName] = {
                    name: serviceName,
                    available: true,
                    hasStatusMethod: false
                };
            }
        } catch (error) {
            status.services[serviceName] = {
                name: serviceName,
                available: false,
                error: error.message
            };
        }
    }

    return status;
}

// Export service container and event bus for direct access
export { serviceContainer, eventBus };