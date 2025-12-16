/**
 * ModalComponent - Reusable Bootstrap modal wrapper component
 * Eliminates duplication between SignIn/CreateAccount modals and provides
 * consistent modal behavior across the application
 */

import { BaseComponent } from './BaseComponent.js';

export class ModalComponent extends BaseComponent {
    constructor(modalSelector, options = {}) {
        super(modalSelector, {
            name: 'ModalComponent',
            autoRender: false, // Modals don't need auto-render
            ...options
        });

        this.options = {
            backdrop: options.backdrop !== undefined ? options.backdrop : true,
            keyboard: options.keyboard !== undefined ? options.keyboard : true,
            focus: options.focus !== undefined ? options.focus : true,
            closeOnEscape: options.closeOnEscape !== undefined ? options.closeOnEscape : true,
            destroyOnHide: options.destroyOnHide || false,
            trackAnalytics: options.trackAnalytics !== undefined ? options.trackAnalytics : true,
            analyticsCategory: options.analyticsCategory || 'modal',
            ...options
        };

        // Modal state
        this.isOpen = false;
        this.bootstrapModal = null;
        
        // Analytics tracking
        this.modalId = this.element ? this.element.id : 'unknown-modal';

        this.log('Modal component created for:', this.modalId);
    }

    async onInitialize() {
        if (!this.element) {
            throw new Error('Modal element not found');
        }

        // Initialize Bootstrap modal
        this.bootstrapModal = new bootstrap.Modal(this.element, {
            backdrop: this.options.backdrop,
            keyboard: this.options.keyboard,
            focus: this.options.focus
        });

        this.log('Bootstrap modal initialized');
    }

    setupEventListeners() {
        if (!this.element) return;

        // Bootstrap modal events
        this.addEventListener(this.element, 'show.bs.modal', this.handleModalShow);
        this.addEventListener(this.element, 'shown.bs.modal', this.handleModalShown);
        this.addEventListener(this.element, 'hide.bs.modal', this.handleModalHide);
        this.addEventListener(this.element, 'hidden.bs.modal', this.handleModalHidden);

        // Custom keyboard handling
        if (this.options.closeOnEscape) {
            this.addEventListener(this.element, 'keydown', this.handleKeydown);
        }
    }

    /**
     * Show the modal
     * @param {object} options - Show options
     */
    async show(options = {}) {
        if (this.isOpen || !this.bootstrapModal) {
            return;
        }

        try {
            this.log('Showing modal');

            // Track analytics
            this.trackAnalyticsEvent('modal_open');

            // Custom pre-show logic
            await this.onBeforeShow(options);

            // Show the modal
            this.bootstrapModal.show();

        } catch (error) {
            this.error('Failed to show modal:', error);
            throw error;
        }
    }

    /**
     * Hide the modal
     * @param {object} options - Hide options
     */
    async hide(options = {}) {
        if (!this.isOpen || !this.bootstrapModal) {
            return;
        }

        try {
            this.log('Hiding modal');

            // Custom pre-hide logic
            await this.onBeforeHide(options);

            // Hide the modal
            this.bootstrapModal.hide();

        } catch (error) {
            this.error('Failed to hide modal:', error);
            throw error;
        }
    }

    /**
     * Toggle modal visibility
     */
    async toggle() {
        if (this.isOpen) {
            await this.hide();
        } else {
            await this.show();
        }
    }

    /**
     * Handle modal show event
     * @private
     */
    handleModalShow(event) {
        this.log('Modal showing');
        this.emit('modal:showing', { modalId: this.modalId });
    }

    /**
     * Handle modal shown event
     * @private
     */
    handleModalShown(event) {
        this.isOpen = true;
        this.log('Modal shown');
        
        // Custom post-show logic
        this.onAfterShow();
        
        this.emit('modal:shown', { modalId: this.modalId });
    }

    /**
     * Handle modal hide event
     * @private
     */
    handleModalHide(event) {
        this.log('Modal hiding');
        this.emit('modal:hiding', { modalId: this.modalId });
    }

    /**
     * Handle modal hidden event
     * @private
     */
    handleModalHidden(event) {
        this.isOpen = false;
        this.log('Modal hidden');

        // Track analytics
        this.trackAnalyticsEvent('modal_close');

        // Custom post-hide logic
        this.onAfterHide();

        // Destroy if configured
        if (this.options.destroyOnHide) {
            this.destroy();
        }

        this.emit('modal:hidden', { modalId: this.modalId });
    }

    /**
     * Handle keyboard events
     * @private
     */
    handleKeydown(event) {
        if (event.key === 'Escape' && this.options.closeOnEscape && this.isOpen) {
            event.preventDefault();
            this.hide();
        }
    }

    /**
     * Lifecycle hooks for subclasses
     */
    async onBeforeShow(options) {
        // Override in subclasses
    }

    onAfterShow() {
        // Override in subclasses
    }

    async onBeforeHide(options) {
        // Override in subclasses
    }

    onAfterHide() {
        // Override in subclasses
    }

    /**
     * Track analytics events
     * @private
     */
    trackAnalyticsEvent(action, data = {}) {
        if (!this.options.trackAnalytics) {
            return;
        }

        try {
            // Use global analytics if available
            if (typeof window !== 'undefined' && window.analyticsDashboard) {
                window.analyticsDashboard.trackEngagement(
                    action,
                    this.modalId,
                    {
                        category: this.options.analyticsCategory,
                        modalId: this.modalId,
                        ...data
                    }
                );
            }
        } catch (error) {
            this.warn('Analytics tracking failed:', error);
        }
    }

    /**
     * Get modal title element
     */
    getTitleElement() {
        return this.$('.modal-title');
    }

    /**
     * Set modal title
     */
    setTitle(title) {
        const titleElement = this.getTitleElement();
        if (titleElement) {
            this.setText(titleElement, title);
        }
    }

    /**
     * Get modal body element
     */
    getBodyElement() {
        return this.$('.modal-body');
    }

    /**
     * Set modal body content
     */
    setBodyContent(content) {
        const bodyElement = this.getBodyElement();
        if (bodyElement) {
            if (typeof content === 'string') {
                this.setHTML(bodyElement, content);
            } else if (content instanceof Element) {
                bodyElement.innerHTML = '';
                bodyElement.appendChild(content);
            }
        }
    }

    /**
     * Get modal footer element
     */
    getFooterElement() {
        return this.$('.modal-footer');
    }

    /**
     * Set loading state
     */
    setLoading(loading, message = 'Loading...') {
        const bodyElement = this.getBodyElement();
        if (!bodyElement) return;

        if (loading) {
            // Add loading overlay
            const overlay = document.createElement('div');
            overlay.className = 'modal-loading-overlay d-flex align-items-center justify-content-center position-absolute w-100 h-100';
            overlay.style.cssText = 'top: 0; left: 0; background: rgba(255,255,255,0.8); z-index: 1050;';
            overlay.innerHTML = `
                <div class="text-center">
                    <div class="spinner-border text-primary" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <div class="mt-2">${message}</div>
                </div>
            `;
            
            bodyElement.style.position = 'relative';
            bodyElement.appendChild(overlay);
            
            // Disable form inputs
            this.$$('input, button, select, textarea').forEach(input => {
                input.disabled = true;
            });
            
        } else {
            // Remove loading overlay
            const overlay = bodyElement.querySelector('.modal-loading-overlay');
            if (overlay) {
                overlay.remove();
            }
            
            // Re-enable form inputs
            this.$$('input, button, select, textarea').forEach(input => {
                input.disabled = false;
            });
        }
    }

    /**
     * Show error in modal
     */
    showError(message, options = {}) {
        const errorElement = this.$('.modal-error') || this.createErrorElement();
        
        if (errorElement) {
            this.setHTML(errorElement, `
                <div class="alert alert-danger alert-dismissible" role="alert">
                    <i class="fas fa-exclamation-circle me-2"></i>
                    ${message}
                    ${options.dismissible !== false ? '<button type="button" class="btn-close" data-bs-dismiss="alert"></button>' : ''}
                </div>
            `);
            this.show(errorElement);
        }
    }

    /**
     * Clear error display
     */
    clearError() {
        const errorElement = this.$('.modal-error');
        if (errorElement) {
            this.hide(errorElement);
            errorElement.innerHTML = '';
        }
    }

    /**
     * Create error element if it doesn't exist
     * @private
     */
    createErrorElement() {
        const bodyElement = this.getBodyElement();
        if (!bodyElement) return null;

        let errorElement = this.$('.modal-error');
        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.className = 'modal-error mb-3';
            bodyElement.insertBefore(errorElement, bodyElement.firstChild);
        }
        
        return errorElement;
    }

    /**
     * Focus first input in modal
     */
    focusFirstInput() {
        const firstInput = this.$('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
        if (firstInput) {
            firstInput.focus();
        }
    }

    /**
     * Check if modal is currently open
     */
    isVisible() {
        return this.isOpen;
    }

    /**
     * Get modal size
     */
    getSize() {
        if (this.hasClass('modal-xl')) return 'xl';
        if (this.hasClass('modal-lg')) return 'lg';
        if (this.hasClass('modal-sm')) return 'sm';
        return 'default';
    }

    /**
     * Set modal size
     */
    setSize(size) {
        const modalDialog = this.$('.modal-dialog');
        if (!modalDialog) return;

        // Remove existing size classes
        modalDialog.classList.remove('modal-sm', 'modal-lg', 'modal-xl');
        
        // Add new size class
        if (size && size !== 'default') {
            modalDialog.classList.add(`modal-${size}`);
        }
    }

    onDestroy() {
        // Hide modal before destruction
        if (this.isOpen && this.bootstrapModal) {
            this.bootstrapModal.hide();
        }

        // Cleanup Bootstrap modal
        if (this.bootstrapModal && typeof this.bootstrapModal.dispose === 'function') {
            this.bootstrapModal.dispose();
        }

        this.bootstrapModal = null;
        this.log('Modal component destroyed');
    }

    /**
     * Static helper to create modal from existing element
     */
    static fromElement(element, options = {}) {
        const modal = new ModalComponent(element, options);
        return modal;
    }

    /**
     * Static helper to show a simple alert modal
     */
    static async alert(title, message, options = {}) {
        const alertHtml = `
            <div class="modal fade" tabindex="-1" role="dialog">
                <div class="modal-dialog" role="document">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${title}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p>${message}</p>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-primary" data-bs-dismiss="modal">OK</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = alertHtml;
        const modalElement = tempDiv.firstElementChild;
        document.body.appendChild(modalElement);

        const modal = new ModalComponent(modalElement, {
            destroyOnHide: true,
            ...options
        });

        await modal.initialize();
        await modal.show();

        return modal;
    }

    /**
     * Static helper to show confirmation modal
     */
    static async confirm(title, message, options = {}) {
        const confirmOptions = {
            confirmText: 'Confirm',
            cancelText: 'Cancel',
            confirmClass: 'btn-primary',
            cancelClass: 'btn-secondary',
            ...options
        };

        return new Promise((resolve, reject) => {
            const confirmHtml = `
                <div class="modal fade" tabindex="-1" role="dialog">
                    <div class="modal-dialog" role="document">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">${title}</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <p>${message}</p>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn ${confirmOptions.cancelClass}" data-bs-dismiss="modal">${confirmOptions.cancelText}</button>
                                <button type="button" class="btn ${confirmOptions.confirmClass}" id="confirm-action">${confirmOptions.confirmText}</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = confirmHtml;
            const modalElement = tempDiv.firstElementChild;
            document.body.appendChild(modalElement);

            const modal = new ModalComponent(modalElement, {
                destroyOnHide: true,
                ...options
            });

            // Handle confirm button
            modalElement.querySelector('#confirm-action').addEventListener('click', () => {
                modal.hide();
                resolve(true);
            });

            // Handle cancel/close
            modalElement.addEventListener('hidden.bs.modal', () => {
                resolve(false);
            });

            modal.initialize().then(() => {
                modal.show().catch(reject);
            });
        });
    }
}