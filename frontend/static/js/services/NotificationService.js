/**
 * NotificationService - Centralized notification management
 * Extracted from global showNotification function in script.js
 * Provides unified notification display with multiple delivery methods
 */

import { BaseService } from './BaseService.js';

export class NotificationService extends BaseService {
    constructor(eventBus, options = {}) {
        super(eventBus, {
            name: 'NotificationService',
            enableToast: true,
            enableBrowserNotifications: false,
            enableAnalytics: true,
            toastDuration: 5000,
            maxNotifications: 5,
            ...options
        });

        // Active notifications
        this.activeNotifications = new Set();
        this.notificationQueue = [];
        this.notificationId = 0;

        // DOM elements
        this.toastContainer = null;
        
        // Browser notification permission
        this.browserNotificationPermission = 'default';
    }

    /**
     * Initialize notification service
     */
    async onInitialize() {
        // Create toast container
        this.createToastContainer();

        // Request browser notification permission if enabled
        if (this.options.enableBrowserNotifications) {
            await this.requestBrowserNotificationPermission();
        }

        // Setup event listeners
        this.on('notification:show', this.handleNotificationRequest.bind(this));
        this.on('notification:clear', this.handleClearNotifications.bind(this));

        this.log('NotificationService initialized');
    }

    /**
     * Create toast container in DOM
     * @private
     */
    createToastContainer() {
        // Check if container already exists
        this.toastContainer = document.getElementById('toast-container');
        
        if (!this.toastContainer) {
            this.toastContainer = document.createElement('div');
            this.toastContainer.id = 'toast-container';
            this.toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
            this.toastContainer.style.zIndex = '1055';
            document.body.appendChild(this.toastContainer);
        }
    }

    /**
     * Request browser notification permission
     * @private
     */
    async requestBrowserNotificationPermission() {
        if ('Notification' in window) {
            try {
                const permission = await Notification.requestPermission();
                this.browserNotificationPermission = permission;
                this.log('Browser notification permission:', permission);
            } catch (error) {
                this.warn('Failed to request notification permission:', error);
            }
        }
    }

    /**
     * Show notification
     */
    show(message, type = 'info', options = {}) {
        const {
            title = null,
            duration = this.options.toastDuration,
            persistent = false,
            actions = [],
            icon = null,
            showBrowser = false,
            data = null
        } = options;

        const notificationData = {
            id: ++this.notificationId,
            message,
            type,
            title,
            duration,
            persistent,
            actions,
            icon,
            showBrowser,
            data,
            timestamp: new Date()
        };

        try {
            // Show toast notification
            if (this.options.enableToast) {
                this.showToast(notificationData);
            }

            // Show browser notification if requested
            if (showBrowser && this.options.enableBrowserNotifications) {
                this.showBrowserNotification(notificationData);
            }

            // Track analytics
            if (this.options.enableAnalytics) {
                this.trackNotification(notificationData);
            }

            // Emit event
            this.emit('notification:shown', notificationData);

            this.log('Notification shown', { id: notificationData.id, type, message });

        } catch (error) {
            this.error('Failed to show notification:', error);
        }

        return notificationData.id;
    }

    /**
     * Show toast notification
     * @private
     */
    showToast(notificationData) {
        const { id, message, type, title, duration, persistent, actions } = notificationData;

        // Check notification limit
        if (this.activeNotifications.size >= this.options.maxNotifications) {
            this.clearOldestNotification();
        }

        // Create toast element
        const toast = document.createElement('div');
        toast.id = `toast-${id}`;
        toast.className = `toast align-items-center border-0 ${this.getToastClass(type)}`;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'assertive');
        toast.setAttribute('aria-atomic', 'true');

        // Toast content
        let toastHTML = `
            <div class="d-flex">
                <div class="toast-body">
                    ${this.getNotificationIcon(type)}
                    ${title ? `<strong>${this.escapeHtml(title)}</strong><br>` : ''}
                    ${this.escapeHtml(message)}
                </div>
                <button type="button" 
                        class="btn-close ${type === 'dark' ? 'btn-close-white' : ''} me-2 m-auto" 
                        data-bs-dismiss="toast" 
                        aria-label="Close"></button>
            </div>
        `;

        // Add actions if provided
        if (actions && actions.length > 0) {
            toastHTML += '<div class="toast-actions p-2 pt-0">';
            actions.forEach(action => {
                toastHTML += `
                    <button type="button" 
                            class="btn btn-sm btn-outline-${this.getActionButtonVariant(type)} me-2"
                            data-action="${action.action}"
                            data-toast-id="${id}">
                        ${this.escapeHtml(action.label)}
                    </button>
                `;
            });
            toastHTML += '</div>';
        }

        toast.innerHTML = toastHTML;

        // Add to container
        this.toastContainer.appendChild(toast);

        // Setup action listeners
        if (actions && actions.length > 0) {
            this.setupToastActions(toast, notificationData);
        }

        // Initialize Bootstrap toast
        const bsToast = new bootstrap.Toast(toast, {
            delay: persistent ? 0 : duration,
            autohide: !persistent
        });

        // Handle toast events
        toast.addEventListener('hidden.bs.toast', () => {
            this.handleToastHidden(id, toast);
        });

        // Show toast
        bsToast.show();

        // Track active notification
        this.activeNotifications.add(id);
    }

    /**
     * Show browser notification
     * @private
     */
    showBrowserNotification(notificationData) {
        if (this.browserNotificationPermission !== 'granted') {
            return;
        }

        const { message, title, icon, data } = notificationData;

        try {
            const notification = new Notification(title || 'TagSort', {
                body: message,
                icon: icon || '/favicon.ico',
                data: data,
                tag: 'tagsort-notification'
            });

            // Handle notification click
            notification.addEventListener('click', () => {
                window.focus();
                notification.close();
                this.emit('notification:clicked', notificationData);
            });

        } catch (error) {
            this.warn('Failed to show browser notification:', error);
        }
    }

    /**
     * Get toast CSS class for notification type
     * @private
     */
    getToastClass(type) {
        const typeMap = {
            'success': 'text-bg-success',
            'error': 'text-bg-danger',
            'warning': 'text-bg-warning',
            'info': 'text-bg-info',
            'primary': 'text-bg-primary',
            'secondary': 'text-bg-secondary',
            'dark': 'text-bg-dark',
            'light': 'text-bg-light'
        };

        return typeMap[type] || 'text-bg-info';
    }

    /**
     * Get notification icon
     * @private
     */
    getNotificationIcon(type) {
        const iconMap = {
            'success': '<i class="fas fa-check-circle me-2"></i>',
            'error': '<i class="fas fa-exclamation-circle me-2"></i>',
            'warning': '<i class="fas fa-exclamation-triangle me-2"></i>',
            'info': '<i class="fas fa-info-circle me-2"></i>',
            'primary': '<i class="fas fa-bell me-2"></i>',
            'secondary': '<i class="fas fa-bell me-2"></i>',
            'dark': '<i class="fas fa-bell me-2"></i>',
            'light': '<i class="fas fa-bell me-2"></i>'
        };

        return iconMap[type] || iconMap['info'];
    }

    /**
     * Get action button variant
     * @private
     */
    getActionButtonVariant(type) {
        const variantMap = {
            'success': 'success',
            'error': 'danger',
            'warning': 'warning',
            'info': 'info',
            'primary': 'primary',
            'secondary': 'secondary',
            'dark': 'light',
            'light': 'dark'
        };

        return variantMap[type] || 'primary';
    }

    /**
     * Setup toast action button listeners
     * @private
     */
    setupToastActions(toast, notificationData) {
        const actionButtons = toast.querySelectorAll('[data-action]');
        actionButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                const action = event.target.dataset.action;
                const toastId = parseInt(event.target.dataset.toastId);
                
                this.handleToastAction(action, toastId, notificationData);
                
                // Close toast after action
                const bsToast = bootstrap.Toast.getInstance(toast);
                if (bsToast) {
                    bsToast.hide();
                }
            });
        });
    }

    /**
     * Handle toast action click
     * @private
     */
    handleToastAction(action, toastId, notificationData) {
        this.emit('notification:action', {
            action,
            toastId,
            notificationData
        });

        this.log('Toast action executed', { action, toastId });
    }

    /**
     * Handle toast hidden event
     * @private
     */
    handleToastHidden(id, toastElement) {
        this.activeNotifications.delete(id);
        
        // Remove from DOM
        if (toastElement.parentNode) {
            toastElement.parentNode.removeChild(toastElement);
        }

        this.emit('notification:hidden', { id });
    }

    /**
     * Clear oldest notification
     * @private
     */
    clearOldestNotification() {
        const oldestId = Math.min(...this.activeNotifications);
        this.clearNotification(oldestId);
    }

    /**
     * Clear specific notification
     */
    clearNotification(id) {
        const toastElement = document.getElementById(`toast-${id}`);
        if (toastElement) {
            const bsToast = bootstrap.Toast.getInstance(toastElement);
            if (bsToast) {
                bsToast.hide();
            }
        }
    }

    /**
     * Clear all notifications
     */
    clearAll() {
        for (const id of this.activeNotifications) {
            this.clearNotification(id);
        }
    }

    /**
     * Handle notification request events
     * @private
     */
    handleNotificationRequest(data) {
        const { message, type = 'info', options = {} } = data;
        this.show(message, type, options);
    }

    /**
     * Handle clear notifications events
     * @private
     */
    handleClearNotifications(data) {
        if (data && data.id) {
            this.clearNotification(data.id);
        } else {
            this.clearAll();
        }
    }

    /**
     * Track notification for analytics
     * @private
     */
    trackNotification(notificationData) {
        if (window.analyticsDashboard) {
            window.analyticsDashboard.trackEngagement('notification_shown', {
                type: notificationData.type,
                hasTitle: !!notificationData.title,
                hasActions: notificationData.actions?.length > 0
            });
        }
    }

    /**
     * Escape HTML for safe display
     * @private
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Get notification statistics
     */
    getStats() {
        return {
            activeNotifications: this.activeNotifications.size,
            totalNotifications: this.notificationId,
            browserPermission: this.browserNotificationPermission,
            options: this.options
        };
    }

    /**
     * Static helper for legacy compatibility
     */
    static show(message, type = 'info', options = {}) {
        // Try to use service instance if available
        if (window.notificationService) {
            return window.notificationService.show(message, type, options);
        }

        // Fallback to console logging
        console.log(`[${type.toUpperCase()}] ${message}`);
        
        // Fallback to browser alert for errors
        if (type === 'error') {
            alert(message);
        }

        return null;
    }
}