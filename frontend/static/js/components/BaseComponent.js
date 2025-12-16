/**
 * BaseComponent - Foundation component class for TagSort
 * Provides common functionality for all UI components including lifecycle,
 * DOM manipulation, event handling, and service integration
 */

import { getElementById, querySelector, querySelectorAll, addClass, removeClass, 
         hasClass, setText, setHTML, showElement, hideElement, debounce } from '../utils/dom.js';

export class BaseComponent {
    constructor(elementOrSelector, options = {}) {
        // Configuration
        this.options = {
            name: this.constructor.name,
            autoRender: true,
            destroyOnUnmount: false,
            debounceDelay: 300,
            ...options
        };

        // Component state
        this.isInitialized = false;
        this.isMounted = false;
        this.isDestroyed = false;
        this.debugMode = options.debugMode || false;

        // Element reference
        this.element = this.resolveElement(elementOrSelector);
        if (!this.element && options.required !== false) {
            throw new Error(`Element not found for component ${this.options.name}: ${elementOrSelector}`);
        }

        // Component tracking
        this.children = new Map(); // Child components
        this.eventListeners = []; // Event listeners for cleanup
        this.timers = new Set(); // Timers for cleanup
        this.observers = new Set(); // Observers for cleanup

        // Services (injected via setServices)
        this.services = {};

        // Event bindings (bound to maintain context)
        this.handleDestroy = this.handleDestroy.bind(this);

        this.log('Component instance created');
    }

    /**
     * Resolve element from selector or element reference
     * @private
     */
    resolveElement(elementOrSelector) {
        if (typeof elementOrSelector === 'string') {
            return elementOrSelector.startsWith('#') 
                ? getElementById(elementOrSelector.substring(1))
                : querySelector(elementOrSelector);
        }
        return elementOrSelector instanceof Element ? elementOrSelector : null;
    }

    /**
     * Initialize the component
     * Override in subclasses for custom initialization
     */
    async initialize() {
        if (this.isInitialized || this.isDestroyed) {
            return;
        }

        this.log('Initializing component');

        try {
            // Setup lifecycle hooks
            this.setupLifecycleHooks();

            // Custom initialization
            await this.onInitialize();

            // Auto-render if enabled
            if (this.options.autoRender && this.element) {
                await this.render();
            }

            this.isInitialized = true;
            this.emit('component:initialized');
            this.log('Component initialized successfully');

        } catch (error) {
            this.error('Component initialization failed:', error);
            throw error;
        }
    }

    /**
     * Mount the component to the DOM
     */
    async mount(parentElement = null) {
        if (this.isMounted || this.isDestroyed) {
            return;
        }

        if (!this.isInitialized) {
            await this.initialize();
        }

        this.log('Mounting component');

        try {
            // Mount to parent if provided
            if (parentElement) {
                const parent = this.resolveElement(parentElement);
                if (parent && this.element) {
                    parent.appendChild(this.element);
                }
            }

            // Custom mounting logic
            await this.onMount();

            this.isMounted = true;
            this.emit('component:mounted');
            this.log('Component mounted successfully');

        } catch (error) {
            this.error('Component mounting failed:', error);
            throw error;
        }
    }

    /**
     * Unmount the component from the DOM
     */
    async unmount() {
        if (!this.isMounted || this.isDestroyed) {
            return;
        }

        this.log('Unmounting component');

        try {
            // Custom unmounting logic
            await this.onUnmount();

            // Remove from DOM if configured
            if (this.options.destroyOnUnmount && this.element && this.element.parentNode) {
                this.element.parentNode.removeChild(this.element);
            }

            this.isMounted = false;
            this.emit('component:unmounted');
            this.log('Component unmounted successfully');

        } catch (error) {
            this.error('Component unmounting failed:', error);
        }
    }

    /**
     * Render the component
     * Override in subclasses for custom rendering
     */
    async render() {
        if (this.isDestroyed || !this.element) {
            return;
        }

        this.log('Rendering component');

        try {
            // Custom rendering logic
            await this.onRender();

            // Setup event listeners after render
            this.setupEventListeners();

            this.emit('component:rendered');
            this.log('Component rendered successfully');

        } catch (error) {
            this.error('Component rendering failed:', error);
            throw error;
        }
    }

    /**
     * Destroy the component and cleanup resources
     */
    destroy() {
        if (this.isDestroyed) {
            return;
        }

        this.log('Destroying component');

        try {
            // Custom destruction logic
            this.onDestroy();

            // Cleanup resources
            this.cleanup();

            // Destroy child components
            for (const child of this.children.values()) {
                if (child && typeof child.destroy === 'function') {
                    child.destroy();
                }
            }
            this.children.clear();

            this.isDestroyed = true;
            this.emit('component:destroyed');
            this.log('Component destroyed successfully');

        } catch (error) {
            this.error('Component destruction failed:', error);
        }
    }

    /**
     * Lifecycle hooks - override in subclasses
     */
    async onInitialize() {
        // Override in subclasses
    }

    async onMount() {
        // Override in subclasses
    }

    async onUnmount() {
        // Override in subclasses
    }

    async onRender() {
        // Override in subclasses
    }

    onDestroy() {
        // Override in subclasses
    }

    /**
     * Setup event listeners
     * Override in subclasses to add specific listeners
     */
    setupEventListeners() {
        // Override in subclasses
    }

    /**
     * Setup lifecycle hooks
     * @private
     */
    setupLifecycleHooks() {
        // Listen for page unload to cleanup
        this.addEventListener(window, 'beforeunload', this.handleDestroy, false);
    }

    /**
     * Handle page unload
     * @private
     */
    handleDestroy() {
        this.destroy();
    }

    /**
     * Add event listener with automatic cleanup tracking
     */
    addEventListener(target, event, handler, options = {}) {
        const targetElement = this.resolveElement(target) || target;
        
        if (targetElement && typeof targetElement.addEventListener === 'function') {
            // Create bound handler to maintain context
            const boundHandler = typeof handler === 'string' 
                ? this[handler].bind(this)
                : handler.bind(this);

            targetElement.addEventListener(event, boundHandler, options);

            // Track for cleanup
            this.eventListeners.push({
                target: targetElement,
                event,
                handler: boundHandler,
                options
            });

            this.log(`Event listener added: ${event}`);
        } else {
            this.warn(`Cannot add event listener to invalid target:`, target);
        }
    }

    /**
     * Remove event listener
     */
    removeEventListener(target, event, handler) {
        const targetElement = this.resolveElement(target) || target;
        
        if (targetElement && typeof targetElement.removeEventListener === 'function') {
            targetElement.removeEventListener(event, handler);

            // Remove from tracking
            this.eventListeners = this.eventListeners.filter(listener => 
                !(listener.target === targetElement && 
                  listener.event === event && 
                  listener.handler === handler)
            );

            this.log(`Event listener removed: ${event}`);
        }
    }

    /**
     * Create debounced function
     */
    debounce(func, delay = this.options.debounceDelay) {
        return debounce(func.bind(this), delay);
    }

    /**
     * Set timer with automatic cleanup
     */
    setTimeout(callback, delay) {
        const timerId = setTimeout(callback.bind(this), delay);
        this.timers.add(timerId);
        return timerId;
    }

    /**
     * Set interval with automatic cleanup
     */
    setInterval(callback, interval) {
        const timerId = setInterval(callback.bind(this), interval);
        this.timers.add(timerId);
        return timerId;
    }

    /**
     * Clear timer
     */
    clearTimer(timerId) {
        clearTimeout(timerId);
        clearInterval(timerId);
        this.timers.delete(timerId);
    }

    /**
     * DOM Helper Methods
     */
    $(selector) {
        return this.element ? querySelector(selector, this.element) : null;
    }

    $$(selector) {
        return this.element ? querySelectorAll(selector, this.element) : [];
    }

    show() {
        if (this.element) showElement(this.element);
    }

    hide() {
        if (this.element) hideElement(this.element);
    }

    addClass(className) {
        if (this.element) addClass(this.element, className);
    }

    removeClass(className) {
        if (this.element) removeClass(this.element, className);
    }

    hasClass(className) {
        return this.element ? hasClass(this.element, className) : false;
    }

    setText(text) {
        if (this.element) setText(this.element, text);
    }

    setHTML(html) {
        if (this.element) setHTML(this.element, html);
    }

    /**
     * Service integration
     */
    setServices(services) {
        this.services = { ...services };
        this.log('Services injected:', Object.keys(services));
    }

    getService(serviceName) {
        return this.services[serviceName] || null;
    }

    hasService(serviceName) {
        return !!this.services[serviceName];
    }

    /**
     * Event emission (requires EventBus service)
     */
    emit(eventName, data = null) {
        const eventBus = this.getService('eventBus');
        if (eventBus) {
            eventBus.emit(eventName, {
                component: this.options.name,
                ...data
            });
        }
    }

    /**
     * Event subscription (requires EventBus service)
     */
    on(eventName, handler) {
        const eventBus = this.getService('eventBus');
        if (eventBus) {
            return eventBus.on(eventName, handler.bind(this));
        }
        return () => {}; // No-op unsubscribe
    }

    /**
     * Child component management
     */
    addChild(name, component) {
        if (component && typeof component.setServices === 'function') {
            component.setServices(this.services);
        }
        this.children.set(name, component);
        this.log(`Child component added: ${name}`);
    }

    getChild(name) {
        return this.children.get(name);
    }

    removeChild(name) {
        const child = this.children.get(name);
        if (child && typeof child.destroy === 'function') {
            child.destroy();
        }
        this.children.delete(name);
        this.log(`Child component removed: ${name}`);
    }

    /**
     * Component state management
     */
    getState() {
        return {
            name: this.options.name,
            isInitialized: this.isInitialized,
            isMounted: this.isMounted,
            isDestroyed: this.isDestroyed,
            hasElement: !!this.element,
            childCount: this.children.size,
            listenerCount: this.eventListeners.length
        };
    }

    /**
     * Cleanup resources
     * @private
     */
    cleanup() {
        // Remove all event listeners
        this.eventListeners.forEach(({ target, event, handler, options }) => {
            try {
                target.removeEventListener(event, handler, options);
            } catch (error) {
                // Ignore cleanup errors
            }
        });
        this.eventListeners = [];

        // Clear all timers
        this.timers.forEach(timerId => {
            clearTimeout(timerId);
            clearInterval(timerId);
        });
        this.timers.clear();

        // Disconnect observers
        this.observers.forEach(observer => {
            try {
                if (typeof observer.disconnect === 'function') {
                    observer.disconnect();
                }
            } catch (error) {
                // Ignore cleanup errors
            }
        });
        this.observers.clear();
    }

    /**
     * Logging methods
     */
    log(message, ...args) {
        if (this.debugMode) {
            console.log(`[${this.options.name}] ${message}`, ...args);
        }
    }

    warn(message, ...args) {
        console.warn(`[${this.options.name}] ${message}`, ...args);
    }

    error(message, ...args) {
        console.error(`[${this.options.name}] ${message}`, ...args);
    }

    /**
     * Static helper to create component instances
     */
    static create(elementOrSelector, options = {}) {
        const component = new this(elementOrSelector, options);
        return component;
    }

    /**
     * Static helper to create and initialize component
     */
    static async createAndInitialize(elementOrSelector, options = {}) {
        const component = new this(elementOrSelector, options);
        await component.initialize();
        return component;
    }
}