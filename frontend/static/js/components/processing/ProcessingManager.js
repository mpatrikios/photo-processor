/**
 * ProcessingManager - Complete processing workflow manager
 * Coordinates ProcessingProgress and ProcessingService
 * Handles job restoration, progress tracking, and state management
 */

import { BaseComponent } from '../BaseComponent.js';
import { ProcessingProgress } from './ProcessingProgress.js';

export class ProcessingManager extends BaseComponent {
    constructor(containerSelector, options = {}) {
        super(containerSelector, {
            name: 'ProcessingManager',
            showProgress: true,
            autoRestore: true,
            showRetryButton: true,
            showResetButton: true,
            progressOptions: {},
            ...options
        });

        // Child components
        this.processingProgress = null;

        // Processing state
        this.currentJobId = null;
        this.isProcessing = false;
        this.lastError = null;

        // UI elements
        this.controlsContainer = null;
        this.retryButton = null;
        this.resetButton = null;
        this.errorDisplay = null;
    }

    async onRender() {
        if (!this.element) {
            throw new Error('Container element required for ProcessingManager');
        }

        this.createProcessingUI();
        await this.initializeComponents();

        this.log('Processing manager rendered');
    }

    /**
     * Create processing manager UI
     * @private
     */
    createProcessingUI() {
        const html = `
            <div class="processing-manager">
                ${this.options.showProgress ? '<div class="processing-progress-container"></div>' : ''}
                
                <div class="processing-error d-none">
                    <div class="alert alert-danger" role="alert">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        <span class="error-message"></span>
                        <div class="error-actions mt-2">
                            ${this.options.showRetryButton ? `
                                <button type="button" class="btn btn-sm btn-outline-danger retry-btn me-2">
                                    <i class="fas fa-redo me-1"></i>Retry
                                </button>
                            ` : ''}
                            ${this.options.showResetButton ? `
                                <button type="button" class="btn btn-sm btn-outline-secondary reset-btn">
                                    <i class="fas fa-refresh me-1"></i>Start Over
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
                
                <div class="processing-warning d-none">
                    <div class="alert alert-warning" role="alert">
                        <i class="fas fa-info-circle me-2"></i>
                        <strong>Processing in progress:</strong> Please keep this page open while your photos are being processed. 
                        Processing may take a few minutes depending on the number of photos.
                    </div>
                </div>
            </div>
        `;

        this.setHTML(html);

        // Cache element references
        this.errorDisplay = this.$('.processing-error');
        this.retryButton = this.$('.retry-btn');
        this.resetButton = this.$('.reset-btn');
        this.warningDisplay = this.$('.processing-warning');
    }

    /**
     * Initialize child components
     * @private
     */
    async initializeComponents() {
        if (this.options.showProgress) {
            const progressContainer = this.$('.processing-progress-container');
            if (progressContainer) {
                this.processingProgress = new ProcessingProgress(progressContainer, {
                    showCancelButton: true,
                    ...this.options.progressOptions
                });

                if (this.services) {
                    this.processingProgress.setServices(this.services);
                }

                await this.processingProgress.initialize();
                this.addChild('processingProgress', this.processingProgress);
            }
        }

        this.log('Processing manager components initialized');
    }

    async onInitialize() {
        // Auto-restore processing job if enabled
        if (this.options.autoRestore) {
            await this.checkAndRestoreJob();
        }
    }

    setupEventListeners() {
        // Control button events
        if (this.retryButton) {
            this.addEventListener(this.retryButton, 'click', this.handleRetry);
        }

        if (this.resetButton) {
            this.addEventListener(this.resetButton, 'click', this.handleReset);
        }

        // Processing service events
        this.on('processing:started', this.handleProcessingStarted);
        this.on('processing:progress', this.handleProcessingProgress);
        this.on('processing:completed', this.handleProcessingCompleted);
        this.on('processing:failed', this.handleProcessingFailed);
        this.on('processing:reset', this.handleProcessingReset);

        // Progress UI events
        this.on('processing:ui:cancelled', this.handleProcessingCancelled);
    }

    /**
     * Check and restore processing job if available
     * @private
     */
    async checkAndRestoreJob() {
        const processingService = this.getService('processingService');
        if (!processingService) {
            return;
        }

        try {
            const restored = await processingService.checkAndRestoreRecentJob();
            if (restored) {
                this.log('Processing job restored');
                this.emit('processing:manager:job_restored');
            }
        } catch (error) {
            this.warn('Failed to restore processing job:', error);
        }
    }

    /**
     * Start processing photos
     */
    async startProcessing(photoIds, options = {}) {
        if (this.isProcessing) {
            this.warn('Processing already in progress');
            return;
        }

        const processingService = this.getService('processingService');
        if (!processingService) {
            throw new Error('ProcessingService not available');
        }

        try {
            this.log('Starting processing', { count: photoIds.length });

            // Clear any previous errors
            this.clearError();

            // Start processing
            const job = await processingService.startProcessing(photoIds, options);
            
            this.currentJobId = job.job_id;
            this.isProcessing = true;

            // Show processing warning
            this.showProcessingWarning(true);

            this.emit('processing:manager:started', { job });
            return job;

        } catch (error) {
            this.error('Failed to start processing:', error);
            this.showError(error.message || 'Failed to start processing');
            throw error;
        }
    }

    /**
     * Stop/cancel current processing
     */
    async cancelProcessing() {
        if (!this.isProcessing || !this.currentJobId) {
            return;
        }

        const processingService = this.getService('processingService');
        if (processingService && typeof processingService.cancelJob === 'function') {
            try {
                await processingService.cancelJob(this.currentJobId);
            } catch (error) {
                this.warn('Failed to cancel processing:', error);
            }
        }

        this.resetProcessingState();
        this.emit('processing:manager:cancelled', { jobId: this.currentJobId });
    }

    /**
     * Reset processing state
     */
    resetProcessing() {
        const processingService = this.getService('processingService');
        if (processingService && typeof processingService.resetProcessing === 'function') {
            processingService.resetProcessing();
        }

        this.resetProcessingState();
        this.clearError();
        
        this.emit('processing:manager:reset');
        this.log('Processing reset via manager');
    }

    /**
     * Handle processing started event
     * @private
     */
    handleProcessingStarted = (data) => {
        this.currentJobId = data.job?.job_id;
        this.isProcessing = true;
        this.clearError();
        this.showProcessingWarning(true);
        
        this.emit('processing:manager:started', data);
        this.log('Processing started via service', data);
    };

    /**
     * Handle processing progress event
     * @private
     */
    handleProcessingProgress = (data) => {
        if (data.jobId === this.currentJobId) {
            this.emit('processing:manager:progress', data);
        }
    };

    /**
     * Handle processing completed event
     * @private
     */
    handleProcessingCompleted = (data) => {
        if (data.jobId === this.currentJobId) {
            this.isProcessing = false;
            this.showProcessingWarning(false);
            
            this.emit('processing:manager:completed', data);
            this.log('Processing completed via service', data);
        }
    };

    /**
     * Handle processing failed event
     * @private
     */
    handleProcessingFailed = (data) => {
        if (data.jobId === this.currentJobId) {
            this.isProcessing = false;
            this.lastError = data.error || data.reason;
            this.showProcessingWarning(false);
            this.showError(this.lastError || 'Processing failed');
            
            this.emit('processing:manager:failed', data);
            this.error('Processing failed via service', data);
        }
    };

    /**
     * Handle processing reset event
     * @private
     */
    handleProcessingReset = () => {
        this.resetProcessingState();
        this.clearError();
        
        this.emit('processing:manager:reset');
    };

    /**
     * Handle processing cancelled event
     * @private
     */
    handleProcessingCancelled = (data) => {
        if (data.jobId === this.currentJobId) {
            this.cancelProcessing();
        }
    };

    /**
     * Handle retry button click
     * @private
     */
    handleRetry = async (event) => {
        event.preventDefault();
        
        if (this.lastError) {
            this.clearError();
            
            // Emit retry event for parent components to handle
            this.emit('processing:manager:retry_requested', {
                lastError: this.lastError,
                jobId: this.currentJobId
            });
        }
    };

    /**
     * Handle reset button click
     * @private
     */
    handleReset = (event) => {
        event.preventDefault();
        this.resetProcessing();
    };

    /**
     * Show processing error
     */
    showError(message, actions = true) {
        if (!this.errorDisplay) return;

        const errorMessage = this.errorDisplay.querySelector('.error-message');
        const errorActions = this.errorDisplay.querySelector('.error-actions');

        if (errorMessage) {
            errorMessage.textContent = message;
        }

        if (errorActions) {
            errorActions.style.display = actions ? 'block' : 'none';
        }

        this.errorDisplay.classList.remove('d-none');
        this.lastError = message;

        this.log('Error displayed', { message, actions });
    }

    /**
     * Clear processing error
     */
    clearError() {
        if (this.errorDisplay) {
            this.errorDisplay.classList.add('d-none');
        }
        this.lastError = null;
    }

    /**
     * Show/hide processing warning
     */
    showProcessingWarning(show) {
        if (!this.warningDisplay) return;

        if (show) {
            this.warningDisplay.classList.remove('d-none');
        } else {
            this.warningDisplay.classList.add('d-none');
        }
    }

    /**
     * Reset processing state
     * @private
     */
    resetProcessingState() {
        this.currentJobId = null;
        this.isProcessing = false;
        this.showProcessingWarning(false);

        if (this.processingProgress) {
            this.processingProgress.reset();
        }
    }

    /**
     * Get processing status
     */
    getProcessingStatus() {
        const processingService = this.getService('processingService');
        const serviceStatus = processingService ? processingService.getProcessingStatus() : {};
        
        return {
            isProcessing: this.isProcessing,
            currentJobId: this.currentJobId,
            lastError: this.lastError,
            hasProgress: !!this.processingProgress,
            progressStatus: this.processingProgress ? this.processingProgress.getStatus() : null,
            serviceStatus
        };
    }

    /**
     * Check if processing is active
     */
    isProcessingActive() {
        return this.isProcessing;
    }

    /**
     * Get current job ID
     */
    getCurrentJobId() {
        return this.currentJobId;
    }

    /**
     * Set services and propagate to children
     */
    setServices(services) {
        super.setServices(services);

        if (this.processingProgress) {
            this.processingProgress.setServices(services);
        }
    }

    /**
     * Static helper to create processing manager
     */
    static create(containerSelector, options = {}) {
        const manager = new ProcessingManager(containerSelector, options);
        return manager;
    }

    /**
     * Static helper to create and initialize processing manager
     */
    static async createAndInitialize(containerSelector, options = {}) {
        const manager = new ProcessingManager(containerSelector, options);
        await manager.initialize();
        return manager;
    }
}