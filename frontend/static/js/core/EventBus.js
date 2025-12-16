/**
 * EventBus - Centralized event system for TagSort
 * Enables loose coupling between components and services through event-driven communication
 */

export class EventBus {
    constructor() {
        this.events = new Map();
        this.onceEvents = new Set();
        this.anyListeners = new Set(); // For onAny listeners
        this.debugMode = false;
    }

    /**
     * Subscribe to an event
     * @param {string} eventName - Name of the event
     * @param {Function} handler - Event handler function
     * @param {object} options - Options for the subscription
     * @returns {Function} Unsubscribe function
     */
    on(eventName, handler, options = {}) {
        if (typeof handler !== 'function') {
            throw new Error('Event handler must be a function');
        }

        if (!this.events.has(eventName)) {
            this.events.set(eventName, []);
        }

        const subscription = {
            handler,
            context: options.context || null,
            once: options.once || false,
            id: this.generateId()
        };

        this.events.get(eventName).push(subscription);

        if (this.debugMode) {
            console.log(`[EventBus] Subscribed to '${eventName}'`, { id: subscription.id, once: subscription.once });
        }

        // Return unsubscribe function
        return () => this.off(eventName, subscription.id);
    }

    /**
     * Subscribe to an event that will only fire once
     * @param {string} eventName - Name of the event
     * @param {Function} handler - Event handler function
     * @param {object} options - Options for the subscription
     * @returns {Function} Unsubscribe function
     */
    once(eventName, handler, options = {}) {
        return this.on(eventName, handler, { ...options, once: true });
    }

    /**
     * Subscribe to all events
     * @param {Function} handler - Event handler function that receives (eventName, data)
     * @returns {Function} Unsubscribe function
     */
    onAny(handler) {
        if (typeof handler !== 'function') {
            throw new Error('Event handler must be a function');
        }

        this.anyListeners.add(handler);

        if (this.debugMode) {
            console.log('[EventBus] Subscribed to all events via onAny');
        }

        // Return unsubscribe function
        return () => this.offAny(handler);
    }

    /**
     * Unsubscribe from all events
     * @param {Function} handler - Handler function to remove
     */
    offAny(handler) {
        this.anyListeners.delete(handler);
        if (this.debugMode) {
            console.log('[EventBus] Unsubscribed from all events via offAny');
        }
    }

    /**
     * Unsubscribe from an event
     * @param {string} eventName - Name of the event
     * @param {string|Function} handlerOrId - Handler function or subscription ID
     */
    off(eventName, handlerOrId) {
        if (!this.events.has(eventName)) {
            return;
        }

        const handlers = this.events.get(eventName);
        
        if (typeof handlerOrId === 'string') {
            // Remove by ID
            const index = handlers.findIndex(sub => sub.id === handlerOrId);
            if (index !== -1) {
                handlers.splice(index, 1);
                if (this.debugMode) {
                    console.log(`[EventBus] Unsubscribed from '${eventName}' by ID:`, handlerOrId);
                }
            }
        } else if (typeof handlerOrId === 'function') {
            // Remove by handler function
            const index = handlers.findIndex(sub => sub.handler === handlerOrId);
            if (index !== -1) {
                handlers.splice(index, 1);
                if (this.debugMode) {
                    console.log(`[EventBus] Unsubscribed from '${eventName}' by handler`);
                }
            }
        }

        // Clean up empty event arrays
        if (handlers.length === 0) {
            this.events.delete(eventName);
        }
    }

    /**
     * Emit an event to all subscribers
     * @param {string} eventName - Name of the event
     * @param {any} data - Data to pass to event handlers
     * @param {object} options - Emit options
     */
    emit(eventName, data = null, options = {}) {
        const { async = false } = options;
        const specificHandlers = this.events.has(eventName) ? [...this.events.get(eventName)] : [];
        const anyHandlers = [...this.anyListeners];

        if (this.debugMode) {
            console.log(`[EventBus] Emitting '${eventName}' to ${specificHandlers.length} specific subscriber(s) and ${anyHandlers.length} onAny subscriber(s)`, data);
        }

        // Emit to specific event listeners
        for (const subscription of specificHandlers) {
            try {
                if (async) {
                    // Emit asynchronously
                    setTimeout(() => {
                        this.executeHandler(subscription, data, eventName);
                    }, 0);
                } else {
                    // Emit synchronously
                    this.executeHandler(subscription, data, eventName);
                }

                // Remove once handlers after execution
                if (subscription.once) {
                    this.off(eventName, subscription.id);
                }
            } catch (error) {
                console.error(`[EventBus] Error in event handler for '${eventName}':`, error);
                // Continue executing other handlers even if one fails
            }
        }

        // Emit to onAny listeners
        for (const handler of anyHandlers) {
            try {
                if (async) {
                    setTimeout(() => {
                        handler(eventName, data);
                    }, 0);
                } else {
                    handler(eventName, data);
                }
            } catch (error) {
                console.error(`[EventBus] Error in onAny handler for '${eventName}':`, error);
                // Continue executing other handlers even if one fails
            }
        }
    }

    /**
     * Execute a single event handler
     * @private
     */
    executeHandler(subscription, data, eventName) {
        if (subscription.context) {
            subscription.handler.call(subscription.context, data, eventName);
        } else {
            subscription.handler(data, eventName);
        }
    }

    /**
     * Emit an event asynchronously
     * @param {string} eventName - Name of the event
     * @param {any} data - Data to pass to event handlers
     */
    emitAsync(eventName, data = null) {
        this.emit(eventName, data, { async: true });
    }

    /**
     * Clear all event listeners
     */
    clear() {
        this.events.clear();
        this.onceEvents.clear();
        this.anyListeners.clear();
        if (this.debugMode) {
            console.log('[EventBus] Cleared all event listeners');
        }
    }

    /**
     * Remove all listeners for a specific event
     * @param {string} eventName - Name of the event to clear
     */
    clearEvent(eventName) {
        if (this.events.has(eventName)) {
            this.events.delete(eventName);
            if (this.debugMode) {
                console.log(`[EventBus] Cleared all listeners for '${eventName}'`);
            }
        }
    }

    /**
     * Get list of all registered events
     * @returns {string[]} Array of event names
     */
    getEvents() {
        return Array.from(this.events.keys());
    }

    /**
     * Get number of subscribers for an event
     * @param {string} eventName - Name of the event
     * @returns {number} Number of subscribers
     */
    getSubscriberCount(eventName) {
        return this.events.has(eventName) ? this.events.get(eventName).length : 0;
    }

    /**
     * Enable or disable debug logging
     * @param {boolean} enabled - Whether to enable debug mode
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
        if (enabled) {
            console.log('[EventBus] Debug mode enabled');
        }
    }

    /**
     * Generate unique ID for subscriptions
     * @private
     * @returns {string} Unique ID
     */
    generateId() {
        return `sub_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * Create a promise that resolves when a specific event is emitted
     * @param {string} eventName - Name of the event to wait for
     * @param {number} timeout - Optional timeout in milliseconds
     * @returns {Promise} Promise that resolves with event data
     */
    waitFor(eventName, timeout = null) {
        return new Promise((resolve, reject) => {
            let timeoutId = null;

            const unsubscribe = this.once(eventName, (data) => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                resolve(data);
            });

            if (timeout) {
                timeoutId = setTimeout(() => {
                    unsubscribe();
                    reject(new Error(`Timeout waiting for event '${eventName}'`));
                }, timeout);
            }
        });
    }

    /**
     * Create a filtered event listener that only responds to events matching a condition
     * @param {string} eventName - Name of the event
     * @param {Function} filter - Filter function that returns true/false
     * @param {Function} handler - Event handler function
     * @returns {Function} Unsubscribe function
     */
    onFiltered(eventName, filter, handler) {
        return this.on(eventName, (data, event) => {
            if (filter(data, event)) {
                handler(data, event);
            }
        });
    }
}

// Create and export a singleton instance
export const eventBus = new EventBus();