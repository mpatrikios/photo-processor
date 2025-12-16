/**
 * ProcessingProgress - Photo processing progress component
 * Displays job status, progress, and handles progress polling
 * Eliminates duplication in progress display logic
 */

import { BaseComponent } from '../BaseComponent.js';

export class ProcessingProgress extends BaseComponent {
    constructor(containerSelector, options = {}) {
        super(containerSelector, {
            name: 'ProcessingProgress',
            showProgressBar: true,
            showPhotoCount: true,
            showTimeEstimate: true,
            showCancelButton: false,
            animateProgress: true,
            ...options
        });

        // Processing state
        this.jobId = null;
        this.status = 'pending'; // pending, processing, completed, failed
        this.progress = 0;
        this.completedPhotos = 0;
        this.totalPhotos = 0;
        this.startTime = null;
        this.isVisible = false;

        // UI elements
        this.progressBar = null;
        this.progressText = null;
        this.photoCount = null;
        this.timeEstimate = null;
        this.cancelButton = null;
    }

    async onRender() {
        if (!this.element) {
            throw new Error('Container element required for ProcessingProgress');
        }

        this.createProgressUI();
        this.updateDisplay();
        this.log('Processing progress rendered');
    }

    /**
     * Create progress UI elements
     * @private
     */
    createProgressUI() {
        const html = `
            <div class="processing-progress ${this.isVisible ? '' : 'd-none'}">
                <div class="progress-header d-flex justify-content-between align-items-center mb-3">
                    <h5 class="progress-title mb-0">
                        <i class="fas fa-cog fa-spin me-2"></i>
                        Processing Photos
                    </h5>
                    ${this.options.showCancelButton ? `
                        <button type="button" 
                                class="btn btn-sm btn-outline-danger cancel-btn"
                                title="Cancel processing">
                            <i class="fas fa-times"></i>
                        </button>
                    ` : ''}
                </div>
                
                ${this.options.showProgressBar ? `
                    <div class="progress-container mb-3">
                        <div class="progress" style="height: 8px;">
                            <div class="progress-bar progress-bar-striped ${this.options.animateProgress ? 'progress-bar-animated' : ''}" 
                                 role="progressbar" 
                                 style="width: 0%"
                                 aria-valuenow="0" 
                                 aria-valuemin="0" 
                                 aria-valuemax="100">
                            </div>
                        </div>
                        <div class="progress-percentage text-center mt-2">
                            <span class="progress-text">Initializing...</span>
                        </div>
                    </div>
                ` : ''}
                
                <div class="progress-details">
                    ${this.options.showPhotoCount ? `
                        <div class="photo-count-info d-flex justify-content-between align-items-center mb-2">
                            <span class="photo-count text-muted">
                                <i class="fas fa-images me-2"></i>
                                <span class="completed-count">0</span> of <span class="total-count">0</span> photos
                            </span>
                            ${this.options.showTimeEstimate ? `
                                <span class="time-estimate text-muted">
                                    <i class="fas fa-clock me-2"></i>
                                    <span class="time-text">Calculating...</span>
                                </span>
                            ` : ''}
                        </div>
                    ` : ''}
                    
                    <div class="status-message text-muted small">
                        <span class="status-text">Starting photo processing...</span>
                    </div>
                </div>
            </div>
        `;

        this.setHTML(html);

        // Cache element references
        this.progressBar = this.$('.progress-bar');
        this.progressText = this.$('.progress-text');
        this.photoCount = this.$('.photo-count');
        this.timeEstimate = this.$('.time-estimate');
        this.cancelButton = this.$('.cancel-btn');
    }

    setupEventListeners() {
        // Cancel button
        if (this.cancelButton) {
            this.addEventListener(this.cancelButton, 'click', this.handleCancel);
        }

        // Listen for processing events
        this.on('processing:started', this.handleProcessingStarted);
        this.on('processing:progress', this.handleProcessingProgress);
        this.on('processing:completed', this.handleProcessingCompleted);
        this.on('processing:failed', this.handleProcessingFailed);
        this.on('processing:job:restored', this.handleJobRestored);
    }

    /**
     * Handle processing started
     * @private
     */
    handleProcessingStarted = (data) => {
        if (data.job) {
            this.jobId = data.job.job_id;
            this.status = 'processing';
            this.totalPhotos = data.job.total_photos || 0;
            this.completedPhotos = data.job.completed_photos || 0;
            this.progress = data.job.progress || 0;
            this.startTime = new Date();

            this.show();
            this.updateDisplay();

            this.log('Processing started', data);
        }
    };

    /**
     * Handle processing progress
     * @private
     */
    handleProcessingProgress = (data) => {
        if (data.jobId === this.jobId) {
            this.progress = data.progress || 0;
            this.completedPhotos = data.completed_photos || 0;
            this.totalPhotos = data.total_photos || this.totalPhotos;
            this.status = data.status || 'processing';

            this.updateDisplay();

            this.log('Processing progress updated', data);
        }
    };

    /**
     * Handle processing completed
     * @private
     */
    handleProcessingCompleted = (data) => {
        if (data.jobId === this.jobId) {
            this.status = 'completed';
            this.progress = 100;
            this.completedPhotos = this.totalPhotos;

            this.updateDisplay();

            // Hide after a delay to show completion
            this.setTimeout(() => {
                this.hide();
            }, 2000);

            this.log('Processing completed', data);
        }
    };

    /**
     * Handle processing failed
     * @private
     */
    handleProcessingFailed = (data) => {
        if (data.jobId === this.jobId) {
            this.status = 'failed';

            this.updateDisplay();

            // Hide after showing error
            this.setTimeout(() => {
                this.hide();
            }, 5000);

            this.log('Processing failed', data);
        }
    };

    /**
     * Handle job restored
     * @private
     */
    handleJobRestored = (data) => {
        this.jobId = data.jobId;
        this.status = 'completed';
        this.progress = 100;

        // Don't show progress for restored jobs
        this.log('Job restored', data);
    };

    /**
     * Handle cancel button click
     * @private
     */
    handleCancel = (event) => {
        event.preventDefault();
        this.cancelProcessing();
    };

    /**
     * Start processing display
     */
    startProcessing(jobData) {
        this.jobId = jobData.jobId || jobData.job_id;
        this.status = 'processing';
        this.totalPhotos = jobData.totalPhotos || jobData.total_photos || 0;
        this.completedPhotos = jobData.completedPhotos || jobData.completed_photos || 0;
        this.progress = jobData.progress || 0;
        this.startTime = new Date();

        this.show();
        this.updateDisplay();

        this.emit('processing:ui:started', { jobId: this.jobId });
        this.log('Processing started via UI', jobData);
    }

    /**
     * Update processing progress
     */
    updateProgress(progressData) {
        this.progress = Math.max(0, Math.min(100, progressData.progress || 0));
        this.completedPhotos = progressData.completed_photos || 0;
        this.totalPhotos = progressData.total_photos || this.totalPhotos;
        this.status = progressData.status || 'processing';

        this.updateDisplay();

        this.emit('processing:ui:progress', {
            jobId: this.jobId,
            progress: this.progress,
            completed: this.completedPhotos,
            total: this.totalPhotos
        });
    }

    /**
     * Complete processing
     */
    completeProcessing(results = null) {
        this.status = 'completed';
        this.progress = 100;
        this.completedPhotos = this.totalPhotos;

        this.updateDisplay();

        this.emit('processing:ui:completed', {
            jobId: this.jobId,
            results
        });

        // Auto-hide after completion
        this.setTimeout(() => {
            this.hide();
        }, 2000);

        this.log('Processing completed via UI');
    }

    /**
     * Fail processing
     */
    failProcessing(error = null) {
        this.status = 'failed';
        this.updateDisplay();

        this.emit('processing:ui:failed', {
            jobId: this.jobId,
            error
        });

        // Auto-hide after showing error
        this.setTimeout(() => {
            this.hide();
        }, 5000);

        this.log('Processing failed via UI', error);
    }

    /**
     * Cancel processing
     */
    cancelProcessing() {
        this.status = 'cancelled';
        this.updateDisplay();

        this.emit('processing:ui:cancelled', {
            jobId: this.jobId
        });

        // Request cancellation from processing service
        const processingService = this.getService('processingService');
        if (processingService && this.jobId) {
            processingService.cancelJob(this.jobId);
        }

        this.setTimeout(() => {
            this.hide();
        }, 1000);

        this.log('Processing cancelled via UI');
    }

    /**
     * Update display based on current state
     * @private
     */
    updateDisplay() {
        this.updateProgressBar();
        this.updateProgressText();
        this.updatePhotoCount();
        this.updateTimeEstimate();
        this.updateStatusMessage();
    }

    /**
     * Update progress bar
     * @private
     */
    updateProgressBar() {
        if (!this.progressBar) return;

        this.progressBar.style.width = `${this.progress}%`;
        this.progressBar.setAttribute('aria-valuenow', this.progress);

        // Update progress bar color based on status
        this.progressBar.className = 'progress-bar progress-bar-striped';
        
        if (this.status === 'completed') {
            this.progressBar.classList.add('bg-success');
            this.progressBar.classList.remove('progress-bar-animated');
        } else if (this.status === 'failed') {
            this.progressBar.classList.add('bg-danger');
            this.progressBar.classList.remove('progress-bar-animated');
        } else if (this.status === 'processing') {
            this.progressBar.classList.remove('bg-success', 'bg-danger');
            if (this.options.animateProgress) {
                this.progressBar.classList.add('progress-bar-animated');
            }
        }
    }

    /**
     * Update progress text
     * @private
     */
    updateProgressText() {
        if (!this.progressText) return;

        let text = '';
        
        switch (this.status) {
            case 'pending':
                text = 'Initializing...';
                break;
            case 'processing':
                if (this.progress >= 95) {
                    text = 'Finalizing results...';
                } else {
                    text = `Processing... ${Math.round(this.progress)}%`;
                }
                break;
            case 'completed':
                text = 'Processing complete!';
                break;
            case 'failed':
                text = 'Processing failed';
                break;
            case 'cancelled':
                text = 'Processing cancelled';
                break;
            default:
                text = `${Math.round(this.progress)}%`;
        }

        this.progressText.textContent = text;
    }

    /**
     * Update photo count display
     * @private
     */
    updatePhotoCount() {
        const completedElement = this.$('.completed-count');
        const totalElement = this.$('.total-count');

        if (completedElement) {
            completedElement.textContent = this.completedPhotos;
        }
        if (totalElement) {
            totalElement.textContent = this.totalPhotos;
        }
    }

    /**
     * Update time estimate
     * @private
     */
    updateTimeEstimate() {
        const timeTextElement = this.$('.time-text');
        if (!timeTextElement || !this.startTime || this.status !== 'processing') {
            return;
        }

        const elapsed = (Date.now() - this.startTime.getTime()) / 1000;
        const rate = this.completedPhotos / elapsed; // photos per second
        
        if (rate > 0 && this.completedPhotos > 0) {
            const remaining = this.totalPhotos - this.completedPhotos;
            const estimatedSeconds = remaining / rate;
            
            if (estimatedSeconds < 60) {
                timeTextElement.textContent = `${Math.round(estimatedSeconds)}s remaining`;
            } else {
                const minutes = Math.round(estimatedSeconds / 60);
                timeTextElement.textContent = `${minutes}m remaining`;
            }
        } else {
            timeTextElement.textContent = 'Calculating...';
        }
    }

    /**
     * Update status message
     * @private
     */
    updateStatusMessage() {
        const statusElement = this.$('.status-text');
        if (!statusElement) return;

        let message = '';

        switch (this.status) {
            case 'pending':
                message = 'Starting photo processing...';
                break;
            case 'processing':
                if (this.progress < 10) {
                    message = 'Analyzing photos with computer vision...';
                } else if (this.progress < 90) {
                    message = 'Detecting bib numbers in photos...';
                } else if (this.progress < 95) {
                    message = 'Organizing photos by bib number...';
                } else {
                    message = 'Finalizing results...';
                }
                break;
            case 'completed':
                message = 'All photos processed successfully! Loading results...';
                break;
            case 'failed':
                message = 'Processing failed. Please try again or contact support.';
                break;
            case 'cancelled':
                message = 'Processing was cancelled.';
                break;
        }

        statusElement.textContent = message;
    }

    /**
     * Show processing progress
     */
    show() {
        this.isVisible = true;
        this.removeClass('d-none');
        this.emit('processing:ui:shown');
    }

    /**
     * Hide processing progress
     */
    hide() {
        this.isVisible = false;
        this.addClass('d-none');
        this.emit('processing:ui:hidden');
    }

    /**
     * Reset processing state
     */
    reset() {
        this.jobId = null;
        this.status = 'pending';
        this.progress = 0;
        this.completedPhotos = 0;
        this.totalPhotos = 0;
        this.startTime = null;
        
        this.hide();
        this.updateDisplay();
        
        this.log('Processing progress reset');
    }

    /**
     * Get current processing status
     */
    getStatus() {
        return {
            jobId: this.jobId,
            status: this.status,
            progress: this.progress,
            completedPhotos: this.completedPhotos,
            totalPhotos: this.totalPhotos,
            isVisible: this.isVisible,
            startTime: this.startTime
        };
    }

    /**
     * Static helper to create processing progress
     */
    static create(containerSelector, options = {}) {
        const progress = new ProcessingProgress(containerSelector, options);
        return progress;
    }

    /**
     * Static helper to create and initialize processing progress
     */
    static async createAndInitialize(containerSelector, options = {}) {
        const progress = new ProcessingProgress(containerSelector, options);
        await progress.initialize();
        return progress;
    }
}