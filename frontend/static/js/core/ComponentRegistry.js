/**
 * ComponentRegistry - Central registry for managing UI components
 * Provides component lifecycle management, dependency injection, and coordination
 * Eliminates component management duplication across the application
 */

import { EventBus } from './EventBus.js';

export class ComponentRegistry {
    constructor(options = {}) {
        this.options = {
            name: 'ComponentRegistry',
            autoCleanup: true,
            enableLifecycleEvents: true,
            ...options
        };

        // Component storage
        this.components = new Map(); // id -> component instance
        this.componentsByType = new Map(); // type -> Set of components
        this.componentHierarchy = new Map(); // parentId -> Set of childIds
        this.componentMetadata = new Map(); // id -> metadata

        // Services reference
        this.services = null;
        this.eventBus = null;

        // Component types mapping
        this.componentTypes = new Map();
        this.registerBuiltinTypes();

        // Lifecycle tracking
        this.initializationOrder = [];
        this.destroyedComponents = new Set();

        // Debug info
        this.creationStats = {
            total: 0,
            byType: new Map(),
            failures: 0
        };
    }

    /**
     * Register built-in component types
     * @private
     */
    registerBuiltinTypes() {
        // Foundation components
        this.componentTypes.set('BaseComponent', () => import('../components/BaseComponent.js'));
        this.componentTypes.set('ModalComponent', () => import('../components/ModalComponent.js'));
        this.componentTypes.set('FormComponent', () => import('../components/FormComponent.js'));

        // Authentication components
        this.componentTypes.set('AuthManager', () => import('../components/auth/AuthManager.js'));
        this.componentTypes.set('SignInModal', () => import('../components/auth/SignInModal.js'));
        this.componentTypes.set('CreateAccountModal', () => import('../components/auth/CreateAccountModal.js'));

        // Upload components
        this.componentTypes.set('UploadManager', () => import('../components/upload/UploadManager.js'));
        this.componentTypes.set('FileSelector', () => import('../components/upload/FileSelector.js'));
        this.componentTypes.set('FileList', () => import('../components/upload/FileList.js'));

        // Processing components
        this.componentTypes.set('ProcessingManager', () => import('../components/processing/ProcessingManager.js'));
        this.componentTypes.set('ProcessingProgress', () => import('../components/processing/ProcessingProgress.js'));

        // Results components
        this.componentTypes.set('PhotoGrid', () => import('../components/results/PhotoGrid.js'));
        this.componentTypes.set('PhotoGroup', () => import('../components/results/PhotoGroup.js'));
        this.componentTypes.set('PhotoLightbox', () => import('../components/results/PhotoLightbox.js'));
        this.componentTypes.set('ResultsFilters', () => import('../components/results/ResultsFilters.js'));
        this.componentTypes.set('LabelingTools', () => import('../components/results/LabelingTools.js'));
        this.componentTypes.set('BatchOperationsComponent', () => import('../components/BatchOperationsComponent.js'));
        
        // Analytics components
        this.componentTypes.set('AnalyticsDashboardComponent', () => import('../components/AnalyticsDashboardComponent.js'));
        this.componentTypes.set('MetricCardComponent', () => import('../components/MetricCardComponent.js'));
        this.componentTypes.set('ChartComponent', () => import('../components/charts/ChartComponent.js'));
    }

    /**
     * Initialize registry with services
     */
    async initialize(services, eventBus) {
        this.services = services;
        this.eventBus = eventBus || new EventBus();

        if (this.options.enableLifecycleEvents) {
            this.setupLifecycleEvents();
        }

        this.log('Component registry initialized');
    }

    /**
     * Setup lifecycle event listeners
     * @private
     */
    setupLifecycleEvents() {
        // Listen for global component events
        this.eventBus.on('component:created', this.handleComponentCreated.bind(this));
        this.eventBus.on('component:destroyed', this.handleComponentDestroyed.bind(this));
        this.eventBus.on('component:error', this.handleComponentError.bind(this));

        // Page lifecycle events
        window.addEventListener('beforeunload', this.handlePageUnload.bind(this));
        window.addEventListener('unload', this.cleanup.bind(this));
    }

    /**
     * Register a new component type
     */
    registerComponentType(typeName, importFunction) {
        this.componentTypes.set(typeName, importFunction);
        this.log('Component type registered', { typeName });
    }

    /**
     * Create a component instance
     */
    async createComponent(typeName, containerId, containerSelector, options = {}) {
        try {
            this.creationStats.total++;
            
            // Import component class
            const componentModule = await this.loadComponentType(typeName);
            const ComponentClass = componentModule[typeName];

            if (!ComponentClass) {
                throw new Error(`Component class '${typeName}' not found in module`);
            }

            // Create component instance
            const component = new ComponentClass(containerSelector, options);
            
            // Set component ID if not provided
            const componentId = containerId || this.generateComponentId(typeName);
            
            // Setup component metadata
            const metadata = {
                id: componentId,
                type: typeName,
                containerSelector,
                options: { ...options },
                createdAt: new Date(),
                parent: options.parent || null,
                children: new Set()
            };

            // Inject services (including EventBus)
            if (this.services) {
                component.setServices(this.services);
            }

            // Initialize component
            await component.initialize();

            // Register component
            this.registerComponent(componentId, component, metadata);

            // Update statistics
            const typeStats = this.creationStats.byType.get(typeName) || 0;
            this.creationStats.byType.set(typeName, typeStats + 1);

            this.log('Component created', { id: componentId, type: typeName });

            if (this.options.enableLifecycleEvents) {
                this.eventBus.emit('component:created', { 
                    id: componentId, 
                    type: typeName, 
                    component 
                });
            }

            return component;

        } catch (error) {
            this.creationStats.failures++;
            this.error('Failed to create component', { typeName, error });
            
            if (this.options.enableLifecycleEvents) {
                this.eventBus.emit('component:error', { 
                    typeName, 
                    phase: 'creation', 
                    error 
                });
            }
            
            throw error;
        }
    }

    /**
     * Load component type dynamically
     * @private
     */
    async loadComponentType(typeName) {
        const importFunction = this.componentTypes.get(typeName);
        
        if (!importFunction) {
            throw new Error(`Unknown component type: ${typeName}`);
        }

        try {
            return await importFunction();
        } catch (error) {
            throw new Error(`Failed to load component type '${typeName}': ${error.message}`);
        }
    }

    /**
     * Register component in registry
     * @private
     */
    registerComponent(componentId, component, metadata) {
        // Store component
        this.components.set(componentId, component);
        this.componentMetadata.set(componentId, metadata);

        // Update type tracking
        const typeComponents = this.componentsByType.get(metadata.type) || new Set();
        typeComponents.add(componentId);
        this.componentsByType.set(metadata.type, typeComponents);

        // Update hierarchy
        if (metadata.parent) {
            const siblings = this.componentHierarchy.get(metadata.parent) || new Set();
            siblings.add(componentId);
            this.componentHierarchy.set(metadata.parent, siblings);
        }

        // Track initialization order
        this.initializationOrder.push(componentId);

        // Set component reference for easy access
        component._registryId = componentId;
        component._registry = this;
    }

    /**
     * Generate unique component ID
     * @private
     */
    generateComponentId(typeName) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 4);
        return `${typeName.toLowerCase()}_${timestamp}_${random}`;
    }

    /**
     * Get component by ID
     */
    getComponent(componentId) {
        return this.components.get(componentId);
    }

    /**
     * Get components by type
     */
    getComponentsByType(typeName) {
        const componentIds = this.componentsByType.get(typeName) || new Set();
        return Array.from(componentIds).map(id => this.components.get(id)).filter(Boolean);
    }

    /**
     * Get component metadata
     */
    getComponentMetadata(componentId) {
        return this.componentMetadata.get(componentId);
    }

    /**
     * Get all components
     */
    getAllComponents() {
        return Array.from(this.components.values());
    }

    /**
     * Get component hierarchy
     */
    getComponentHierarchy(parentId = null) {
        if (parentId === null) {
            // Return root components
            const allIds = new Set(this.components.keys());
            const childIds = new Set();
            for (const children of this.componentHierarchy.values()) {
                for (const childId of children) {
                    childIds.add(childId);
                }
            }
            const rootIds = Array.from(allIds).filter(id => !childIds.has(id));
            return rootIds.map(id => ({
                id,
                component: this.components.get(id),
                metadata: this.componentMetadata.get(id),
                children: this.getComponentHierarchy(id)
            }));
        } else {
            // Return children of specific parent
            const childIds = this.componentHierarchy.get(parentId) || new Set();
            return Array.from(childIds).map(id => ({
                id,
                component: this.components.get(id),
                metadata: this.componentMetadata.get(id),
                children: this.getComponentHierarchy(id)
            }));
        }
    }

    /**
     * Destroy component
     */
    async destroyComponent(componentId, options = {}) {
        const component = this.components.get(componentId);
        const metadata = this.componentMetadata.get(componentId);

        if (!component || this.destroyedComponents.has(componentId)) {
            return;
        }

        try {
            // Destroy children first if cascade is enabled
            if (options.cascade !== false) {
                const children = this.componentHierarchy.get(componentId) || new Set();
                for (const childId of children) {
                    await this.destroyComponent(childId, options);
                }
            }

            // Destroy the component
            if (typeof component.destroy === 'function') {
                await component.destroy();
            }

            // Remove from registry
            this.unregisterComponent(componentId);

            this.log('Component destroyed', { id: componentId, type: metadata?.type });

            if (this.options.enableLifecycleEvents) {
                this.eventBus.emit('component:destroyed', { 
                    id: componentId, 
                    type: metadata?.type, 
                    component 
                });
            }

        } catch (error) {
            this.error('Failed to destroy component', { id: componentId, error });
            
            if (this.options.enableLifecycleEvents) {
                this.eventBus.emit('component:error', { 
                    componentId, 
                    phase: 'destruction', 
                    error 
                });
            }
        }
    }

    /**
     * Unregister component from registry
     * @private
     */
    unregisterComponent(componentId) {
        const metadata = this.componentMetadata.get(componentId);
        
        // Remove from main storage
        this.components.delete(componentId);
        this.componentMetadata.delete(componentId);

        // Update type tracking
        if (metadata) {
            const typeComponents = this.componentsByType.get(metadata.type);
            if (typeComponents) {
                typeComponents.delete(componentId);
                if (typeComponents.size === 0) {
                    this.componentsByType.delete(metadata.type);
                }
            }
        }

        // Update hierarchy
        this.componentHierarchy.delete(componentId);
        for (const children of this.componentHierarchy.values()) {
            children.delete(componentId);
        }

        // Mark as destroyed
        this.destroyedComponents.add(componentId);

        // Remove from initialization order
        const orderIndex = this.initializationOrder.indexOf(componentId);
        if (orderIndex !== -1) {
            this.initializationOrder.splice(orderIndex, 1);
        }
    }

    /**
     * Destroy all components
     */
    async destroyAllComponents() {
        const componentIds = Array.from(this.components.keys());
        
        for (const componentId of componentIds) {
            await this.destroyComponent(componentId, { cascade: false });
        }

        // Clear all data structures
        this.components.clear();
        this.componentsByType.clear();
        this.componentHierarchy.clear();
        this.componentMetadata.clear();
        this.initializationOrder = [];
        this.destroyedComponents.clear();

        this.log('All components destroyed');
    }

    /**
     * Update services for all components
     */
    updateServices(services) {
        this.services = services;

        for (const component of this.components.values()) {
            if (typeof component.setServices === 'function') {
                component.setServices(services);
            }
        }

        this.log('Services updated for all components');
    }

    /**
     * Broadcast event to all components
     */
    broadcastEvent(eventName, data) {
        for (const component of this.components.values()) {
            if (typeof component.emit === 'function') {
                component.emit(eventName, data);
            }
        }

        this.log('Event broadcasted to all components', { eventName });
    }

    /**
     * Find components by criteria
     */
    findComponents(criteria) {
        const results = [];

        for (const [componentId, component] of this.components.entries()) {
            const metadata = this.componentMetadata.get(componentId);
            
            let matches = true;

            // Check type
            if (criteria.type && metadata.type !== criteria.type) {
                matches = false;
            }

            // Check options
            if (criteria.options && matches) {
                for (const [key, value] of Object.entries(criteria.options)) {
                    if (metadata.options[key] !== value) {
                        matches = false;
                        break;
                    }
                }
            }

            // Check custom filter
            if (criteria.filter && matches && typeof criteria.filter === 'function') {
                matches = criteria.filter(component, metadata);
            }

            if (matches) {
                results.push({ id: componentId, component, metadata });
            }
        }

        return results;
    }

    /**
     * Get registry statistics
     */
    getStats() {
        const typeStats = {};
        for (const [type, count] of this.creationStats.byType.entries()) {
            typeStats[type] = {
                created: count,
                active: this.getComponentsByType(type).length
            };
        }

        return {
            total: {
                created: this.creationStats.total,
                active: this.components.size,
                destroyed: this.destroyedComponents.size,
                failures: this.creationStats.failures
            },
            byType: typeStats,
            hierarchy: {
                rootComponents: this.getComponentHierarchy().length,
                maxDepth: this.calculateMaxDepth()
            },
            memory: {
                componentsSize: this.components.size,
                metadataSize: this.componentMetadata.size,
                hierarchySize: this.componentHierarchy.size
            }
        };
    }

    /**
     * Calculate maximum hierarchy depth
     * @private
     */
    calculateMaxDepth(parentId = null, currentDepth = 0) {
        const children = this.componentHierarchy.get(parentId) || new Set();
        
        if (children.size === 0) {
            return currentDepth;
        }

        let maxDepth = currentDepth;
        for (const childId of children) {
            const childDepth = this.calculateMaxDepth(childId, currentDepth + 1);
            maxDepth = Math.max(maxDepth, childDepth);
        }

        return maxDepth;
    }

    /**
     * Handle component created event
     * @private
     */
    handleComponentCreated(data) {
        this.log('Component lifecycle: created', data);
    }

    /**
     * Handle component destroyed event
     * @private
     */
    handleComponentDestroyed(data) {
        this.log('Component lifecycle: destroyed', data);
    }

    /**
     * Handle component error event
     * @private
     */
    handleComponentError(data) {
        this.error('Component lifecycle: error', data);
    }

    /**
     * Handle page unload
     * @private
     */
    handlePageUnload() {
        if (this.options.autoCleanup) {
            // Cleanup will be called on unload
            this.log('Page unloading, cleanup scheduled');
        }
    }

    /**
     * Cleanup registry
     */
    async cleanup() {
        try {
            await this.destroyAllComponents();
            
            // Clear services reference
            this.services = null;
            this.eventBus = null;

            this.log('Registry cleanup completed');
        } catch (error) {
            this.error('Registry cleanup failed', error);
        }
    }

    /**
     * Enable debug mode
     */
    enableDebug() {
        this.debug = true;
        
        // Expose registry to global scope for debugging
        if (typeof window !== 'undefined') {
            window._componentRegistry = this;
        }

        this.log('Debug mode enabled');
    }

    /**
     * Logging helper
     * @private
     */
    log(...args) {
        if (this.debug || this.options.debug) {
            console.log('[ComponentRegistry]', ...args);
        }
    }

    /**
     * Error logging helper
     * @private
     */
    error(...args) {
        console.error('[ComponentRegistry]', ...args);
    }

    /**
     * Create singleton instance
     */
    static getInstance(options = {}) {
        if (!ComponentRegistry.instance) {
            ComponentRegistry.instance = new ComponentRegistry(options);
        }
        return ComponentRegistry.instance;
    }

    /**
     * Reset singleton instance (mainly for testing)
     */
    static resetInstance() {
        if (ComponentRegistry.instance) {
            ComponentRegistry.instance.cleanup();
            ComponentRegistry.instance = null;
        }
    }
}