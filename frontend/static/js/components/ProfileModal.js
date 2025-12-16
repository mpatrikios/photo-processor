/**
 * ProfileModal - User profile and quota management modal component
 * Displays user information, quota usage, and statistics
 */

import { BaseComponent } from './BaseComponent.js';

export class ProfileModal extends BaseComponent {
    constructor(container, options = {}) {
        super(container, {
            name: 'ProfileModal',
            modalId: 'profileModal',
            autoRefreshQuota: true,
            ...options
        });

        this.modal = null;
        this.quotaService = null;
        this.authService = null;
        this.currentUser = null;
    }

    async onInitialize() {
        // Initialize Bootstrap modal
        this.modal = new bootstrap.Modal(document.getElementById(this.options.modalId));
        
        // Setup event listeners
        this.setupEventListeners();
        
        this.log('ProfileModal initialized');
    }

    /**
     * Set service dependencies
     */
    setServices(services) {
        super.setServices(services);
        this.quotaService = services.quotaService;
        this.authService = services.authService;

        // Subscribe to quota updates
        if (this.quotaService) {
            this.quotaService.onQuotaUpdated(this.handleQuotaUpdate.bind(this));
        }
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        // Modal show event
        const modalEl = document.getElementById(this.options.modalId);
        if (modalEl) {
            modalEl.addEventListener('show.bs.modal', this.handleModalShow.bind(this));
        }

        // Refresh button
        const refreshBtn = modalEl?.querySelector('[data-action="refresh-quota"]');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', this.handleRefreshQuota.bind(this));
        }
    }

    /**
     * Show the profile modal
     */
    async show() {
        try {
            this.modal.show();
        } catch (error) {
            this.error('Failed to show profile modal:', error);
        }
    }

    /**
     * Hide the profile modal
     */
    hide() {
        this.modal.hide();
    }

    /**
     * Handle modal show event
     * @private
     */
    async handleModalShow() {
        try {
            await this.loadProfileData();
        } catch (error) {
            this.error('Failed to load profile data:', error);
        }
    }

    /**
     * Load profile and quota data
     * @private
     */
    async loadProfileData() {
        try {
            // Load user data
            if (this.authService) {
                this.currentUser = this.authService.getCurrentUser();
                this.updateUserUI(this.currentUser);
            }

            // Load quota data
            if (this.quotaService) {
                await this.quotaService.loadQuotaData();
            }

        } catch (error) {
            this.error('Failed to load profile data:', error);
            this.showError('Failed to load profile information');
        }
    }

    /**
     * Update user information in UI
     * @private
     */
    updateUserUI(user) {
        if (!user) return;

        this.updateElement('profileUserName', user.full_name || user.name || 'Unknown');
        this.updateElement('profileUserEmail', user.email || '');
        this.updateElement('totalUploaded', user.total_photos_uploaded || 0);
        this.updateElement('totalProcessed', user.total_photos_processed || 0);
        this.updateElement('totalExports', user.total_exports || 0);
    }

    /**
     * Handle quota update event
     * @private
     */
    handleQuotaUpdate(data) {
        this.updateQuotaUI(data.quota);
    }

    /**
     * Update quota UI elements
     * @private
     */
    updateQuotaUI(quota) {
        if (!quota) return;

        // Update text values
        this.updateElement('quotaUsage', quota.current_usage || 0);
        this.updateElement('quotaLimit', quota.monthly_limit || 5000);
        this.updateElement('quotaRemaining', quota.remaining || quota.monthly_limit);

        // Update progress bar
        this.updateProgressBar(quota);

        // Update reset date
        this.updateResetDate(quota.reset_date);
    }

    /**
     * Update progress bar
     * @private
     */
    updateProgressBar(quota) {
        const progressBar = document.getElementById('quotaProgressBar');
        if (!progressBar) return;

        const percentage = quota.usage_percentage || 0;
        progressBar.style.width = `${percentage}%`;
        progressBar.setAttribute('aria-valuenow', percentage);

        // Update color based on usage
        progressBar.className = 'progress-bar';
        if (percentage >= 90) {
            progressBar.classList.add('bg-danger');
        } else if (percentage >= 75) {
            progressBar.classList.add('bg-warning');
        } else {
            progressBar.classList.add('bg-success');
        }
    }

    /**
     * Update reset date display
     * @private
     */
    updateResetDate(resetDate) {
        const resetDateEl = document.getElementById('quotaResetDate');
        if (!resetDateEl) return;

        if (resetDate) {
            try {
                const date = new Date(resetDate);
                resetDateEl.textContent = date.toLocaleDateString();
            } catch (e) {
                resetDateEl.textContent = 'Next month';
            }
        } else {
            resetDateEl.textContent = 'Next month';
        }
    }

    /**
     * Handle refresh quota button click
     * @private
     */
    async handleRefreshQuota(event) {
        const button = event.target;
        const originalContent = button.innerHTML;

        try {
            // Show loading state
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Refreshing...';

            // Refresh quota
            if (this.quotaService) {
                await this.quotaService.refreshQuota();
                this.showSuccess('Quota information updated');
            }

        } catch (error) {
            this.error('Failed to refresh quota:', error);
            this.showError('Failed to refresh quota information');
        } finally {
            // Restore button state
            button.disabled = false;
            button.innerHTML = originalContent;
        }
    }

    /**
     * Update element text content safely
     * @private
     */
    updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }

    /**
     * Show success message
     * @private
     */
    showSuccess(message) {
        this.emit('notification:show', { message, type: 'success' });
    }

    /**
     * Show error message
     * @private
     */
    showError(message) {
        this.emit('notification:show', { message, type: 'error' });
    }

    /**
     * Cleanup
     */
    async destroy() {
        if (this.modal) {
            this.modal.dispose();
        }
        await super.destroy();
    }
}