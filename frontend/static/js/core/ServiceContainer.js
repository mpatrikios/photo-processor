/**
 * ServiceContainer - Dependency injection container for TagSort
 * Manages service instantiation, dependencies, and lifecycle
 */

export class ServiceContainer {
    constructor() {
        this.services = new Map();
        this.factories = new Map();
        this.singletons = new Map();
        this.dependencies = new Map();
        this.loading = new Set();
        this.debugMode = false;
    }

    /**
     * Register a service factory
     * @param {string} name - Service name
     * @param {Function} factory - Factory function that creates the service
     * @param {object} options - Registration options
     */
    register(name, factory, options = {}) {
        if (typeof factory !== 'function') {
            throw new Error(`Service factory for '${name}' must be a function`);
        }

        const config = {
            factory,
            singleton: options.singleton ?? true,
            dependencies: options.dependencies || [],
            lazy: options.lazy ?? true,
            tags: options.tags || []
        };

        this.factories.set(name, config);
        this.dependencies.set(name, config.dependencies);

        if (this.debugMode) {
            console.log(`[ServiceContainer] Registered service '${name}'`, {
                singleton: config.singleton,
                dependencies: config.dependencies,
                lazy: config.lazy
            });
        }

        // If not lazy, create the service immediately
        if (!config.lazy) {
            this.get(name);
        }
    }

    /**
     * Register a service instance directly
     * @param {string} name - Service name
     * @param {any} instance - Service instance
     */
    registerInstance(name, instance) {
        this.services.set(name, instance);
        
        if (this.debugMode) {
            console.log(`[ServiceContainer] Registered instance '${name}'`, instance);
        }
    }

    /**
     * Get a service instance
     * @param {string} name - Service name
     * @returns {any} Service instance
     */
    get(name) {
        // Check if we already have an instance
        if (this.services.has(name)) {
            return this.services.get(name);
        }

        // Check if it's a singleton we've already created
        if (this.singletons.has(name)) {
            return this.singletons.get(name);
        }

        // Check for circular dependencies
        if (this.loading.has(name)) {
            throw new Error(`Circular dependency detected for service '${name}'`);
        }

        // Get factory configuration
        const config = this.factories.get(name);
        if (!config) {
            throw new Error(`Service '${name}' not registered`);
        }

        try {
            this.loading.add(name);
            
            // Resolve dependencies
            const dependencies = this.resolveDependencies(config.dependencies);
            
            // Create service instance
            const instance = config.factory(...dependencies);
            
            if (this.debugMode) {
                console.log(`[ServiceContainer] Created service '${name}'`);
            }
            
            // Store the instance
            if (config.singleton) {
                this.singletons.set(name, instance);
            } else {
                this.services.set(name, instance);
            }
            
            return instance;
            
        } catch (error) {
            console.error(`[ServiceContainer] Failed to create service '${name}':`, error);
            throw error;
        } finally {
            this.loading.delete(name);
        }
    }

    /**
     * Resolve an array of dependency names to their instances
     * @private
     * @param {string[]} dependencyNames - Array of service names
     * @returns {any[]} Array of service instances
     */
    resolveDependencies(dependencyNames) {
        return dependencyNames.map(dep => this.get(dep));
    }

    /**
     * Check if a service is registered
     * @param {string} name - Service name
     * @returns {boolean} True if service is registered
     */
    has(name) {
        return this.factories.has(name) || this.services.has(name) || this.singletons.has(name);
    }

    /**
     * Remove a service and its instances
     * @param {string} name - Service name
     */
    remove(name) {
        this.factories.delete(name);
        this.services.delete(name);
        this.singletons.delete(name);
        this.dependencies.delete(name);
        
        if (this.debugMode) {
            console.log(`[ServiceContainer] Removed service '${name}'`);
        }
    }

    /**
     * Clear all services
     */
    clear() {
        this.factories.clear();
        this.services.clear();
        this.singletons.clear();
        this.dependencies.clear();
        this.loading.clear();
        
        if (this.debugMode) {
            console.log('[ServiceContainer] Cleared all services');
        }
    }

    /**
     * Get all services with a specific tag
     * @param {string} tag - Tag to search for
     * @returns {Map} Map of service names to instances
     */
    getByTag(tag) {
        const taggedServices = new Map();
        
        for (const [name, config] of this.factories) {
            if (config.tags.includes(tag)) {
                taggedServices.set(name, this.get(name));
            }
        }
        
        return taggedServices;
    }

    /**
     * Get list of all registered service names
     * @returns {string[]} Array of service names
     */
    getServiceNames() {
        const names = new Set([
            ...this.factories.keys(),
            ...this.services.keys(),
            ...this.singletons.keys()
        ]);
        return Array.from(names);
    }

    /**
     * Create a child container with inherited services
     * @returns {ServiceContainer} Child container
     */
    createChild() {
        const child = new ServiceContainer();
        
        // Copy parent factories
        for (const [name, config] of this.factories) {
            child.factories.set(name, { ...config });
        }
        
        // Copy parent dependencies
        for (const [name, deps] of this.dependencies) {
            child.dependencies.set(name, [...deps]);
        }
        
        child.debugMode = this.debugMode;
        
        if (this.debugMode) {
            console.log('[ServiceContainer] Created child container');
        }
        
        return child;
    }

    /**
     * Enable or disable debug logging
     * @param {boolean} enabled - Whether to enable debug mode
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
        if (enabled) {
            console.log('[ServiceContainer] Debug mode enabled');
        }
    }

    /**
     * Validate all registered services can be created
     * @returns {object} Validation result with errors
     */
    validate() {
        const result = {
            valid: true,
            errors: [],
            warnings: []
        };

        // Check for circular dependencies
        try {
            this.detectCircularDependencies();
        } catch (error) {
            result.valid = false;
            result.errors.push(error.message);
        }

        // Check that all dependencies exist
        for (const [name, deps] of this.dependencies) {
            for (const dep of deps) {
                if (!this.has(dep)) {
                    result.valid = false;
                    result.errors.push(`Service '${name}' depends on unregistered service '${dep}'`);
                }
            }
        }

        // Try to create all services (in a test environment)
        if (result.valid) {
            const backup = {
                services: new Map(this.services),
                singletons: new Map(this.singletons)
            };

            try {
                for (const name of this.factories.keys()) {
                    this.get(name);
                }
            } catch (error) {
                result.warnings.push(`Failed to create service during validation: ${error.message}`);
            } finally {
                // Restore original state
                this.services = backup.services;
                this.singletons = backup.singletons;
            }
        }

        return result;
    }

    /**
     * Detect circular dependencies in service configuration
     * @private
     */
    detectCircularDependencies() {
        const visited = new Set();
        const visiting = new Set();

        const visit = (name, path = []) => {
            if (visiting.has(name)) {
                throw new Error(`Circular dependency detected: ${[...path, name].join(' -> ')}`);
            }
            
            if (visited.has(name)) {
                return;
            }

            visiting.add(name);
            const deps = this.dependencies.get(name) || [];
            
            for (const dep of deps) {
                visit(dep, [...path, name]);
            }
            
            visiting.delete(name);
            visited.add(name);
        };

        for (const name of this.factories.keys()) {
            if (!visited.has(name)) {
                visit(name);
            }
        }
    }

    /**
     * Get dependency graph information
     * @returns {object} Dependency graph data
     */
    getDependencyGraph() {
        const graph = {
            nodes: [],
            edges: []
        };

        // Add nodes
        for (const name of this.factories.keys()) {
            const config = this.factories.get(name);
            graph.nodes.push({
                name,
                singleton: config.singleton,
                lazy: config.lazy,
                tags: config.tags
            });
        }

        // Add edges
        for (const [name, deps] of this.dependencies) {
            for (const dep of deps) {
                graph.edges.push({
                    from: dep,
                    to: name
                });
            }
        }

        return graph;
    }
}

// Create and export a singleton instance
export const serviceContainer = new ServiceContainer();