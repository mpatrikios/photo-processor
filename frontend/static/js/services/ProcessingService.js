/**
 * ProcessingService - Photo processing service for TagSort
 * Handles job management, progress polling, and results handling
 */

import { BaseService } from './BaseService.js';
import { AppError, ErrorTypes } from '../utils/errors.js';

export class ProcessingService extends BaseService {
    constructor(eventBus, apiService, stateManager, config = {}) {
        super(eventBus, {
            name: 'ProcessingService',
            pollInterval: 500, // Poll every 500ms during processing
            maxRetries: 5,
            retryDelay: 2000,
            maxPollTime: 10 * 60 * 1000, // Maximum 10 minutes polling
            ...config
        });

        this.apiService = apiService;
        this.stateManager = stateManager;
        
        // Processing state
        this.currentJobId = null;
        this.currentJobStatus = null;
        this.isProcessing = false;
        this.groupedPhotos = [];
        this.pollTimer = null;
        this.pollStartTime = null;
        this.retryCount = 0;
        this.lastProgress = 0;
        
        // Job tracking
        this.jobs = new Map(); // Track multiple jobs
    }

    async onInitialize() {
        // Restore processing state from StateManager
        this.restoreProcessingState();
        
        this.log('ProcessingService initialized', {
            hasCurrentJob: !!this.currentJobId,
            currentStatus: this.currentJobStatus
        });
    }

    async onStart() {
        // Check and potentially resume any active processing
        if (this.currentJobId && this.currentJobStatus !== 'completed') {
            try {
                await this.resumeProcessing();
            } catch (error) {
                this.warn('Failed to resume processing:', error);
                this.clearCurrentJob();
            }
        }
    }

    async onStop() {
        // Stop polling
        this.stopPolling();
        
        // Clear timers
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * Restore processing state from StateManager
     * @private
     */
    restoreProcessingState() {
        if (!this.stateManager) return;

        try {
            this.currentJobId = this.stateManager.get('processing.currentJobId');
            this.currentJobStatus = this.stateManager.get('processing.currentJobStatus');
            this.groupedPhotos = this.stateManager.get('photos.groupedPhotos') || [];

            if (this.currentJobId) {
                this.log('Restored processing state', {
                    jobId: this.currentJobId,
                    status: this.currentJobStatus,
                    photosCount: this.groupedPhotos.length
                });
            }
        } catch (error) {
            this.warn('Failed to restore processing state:', error);
            this.clearCurrentJob();
        }
    }

    /**
     * Update processing state in StateManager
     * @private
     */
    updateProcessingState() {
        if (!this.stateManager) return;

        try {
            this.stateManager.update({
                'processing.currentJobId': this.currentJobId,
                'processing.currentJobStatus': this.currentJobStatus,
                'photos.groupedPhotos': this.groupedPhotos
            });
        } catch (error) {
            this.warn('Failed to update processing state:', error);
        }
    }

    /**
     * Clear current job state
     * @private
     */
    clearCurrentJob() {
        this.currentJobId = null;
        this.currentJobStatus = null;
        this.isProcessing = false;
        this.groupedPhotos = [];
        this.retryCount = 0;
        this.lastProgress = 0;
        
        this.updateProcessingState();
    }

    /**
     * Start processing photos
     * @param {string[]} photoIds - Array of photo IDs to process
     * @param {object} options - Processing options
     * @returns {Promise<object>} Processing job info
     */
    async startProcessing(photoIds, options = {}) {
        this.ensureReady();

        if (!Array.isArray(photoIds) || photoIds.length === 0) {
            throw new AppError('No photo IDs provided for processing', ErrorTypes.VALIDATION);
        }

        if (this.isProcessing) {
            throw new AppError('Processing already in progress', ErrorTypes.CLIENT);
        }

        try {
            this.log('Starting photo processing', { count: photoIds.length });

            // Clear any previous completed job state
            if (this.stateManager) {
                this.stateManager.clearCompletedJob();
            }

            // Start processing job
            const response = await this.apiService.post('/process/start', photoIds, {
                params: {
                    debug: options.debug || false
                }
            });

            const job = {
                job_id: response.job_id,
                photo_ids: response.photo_ids || photoIds,
                status: response.status || 'pending',
                progress: response.progress || 0,
                total_photos: response.total_photos || photoIds.length,
                completed_photos: response.completed_photos || 0,
                started_at: new Date(),
                debug_mode: options.debug || false
            };

            // Update current job state
            this.currentJobId = job.job_id;
            this.currentJobStatus = job.status;
            this.isProcessing = true;
            this.retryCount = 0;
            this.lastProgress = 0;

            // Store job info
            this.jobs.set(job.job_id, job);

            // Update state
            this.updateProcessingState();

            // Start polling
            this.startPolling();

            this.emit('processing:started', { job });
            this.log('Processing started', { jobId: job.job_id });

            return job;

        } catch (error) {
            this.emit('processing:start:error', { error, photoIds });
            this.error('Failed to start processing:', error);
            throw error;
        }
    }

    /**
     * Resume processing an existing job
     * @returns {Promise<void>}
     */
    async resumeProcessing() {
        if (!this.currentJobId) {
            throw new AppError('No current job to resume', ErrorTypes.CLIENT);
        }

        try {
            this.log('Attempting to resume processing', { jobId: this.currentJobId });

            // Check job status
            const jobStatus = await this.checkJobStatus(this.currentJobId);
            
            if (jobStatus.status === 'completed') {
                this.log('Job completed while offline, fetching results');
                await this.fetchResults();
                return;
            }

            if (jobStatus.status === 'processing' || jobStatus.status === 'pending') {
                this.log('Resuming active processing job');
                this.isProcessing = true;
                this.currentJobStatus = jobStatus.status;
                this.updateProcessingState();
                this.startPolling();
                
                this.emit('processing:resumed', { jobId: this.currentJobId, status: jobStatus.status });
                return;
            }

            if (jobStatus.status === 'failed') {
                this.log('Job failed while offline');
                await this.handleJobFailure('Job failed while offline');
                return;
            }

        } catch (error) {
            if (error.type === ErrorTypes.NOT_FOUND) {
                this.warn('Job not found on server, clearing state');
                this.clearCurrentJob();
                throw new AppError('Processing job was lost. Please start over.', ErrorTypes.CLIENT);
            }
            throw error;
        }
    }

    /**
     * Start polling for job status
     * @private
     */
    startPolling() {
        this.stopPolling(); // Clear any existing timer
        
        this.pollStartTime = Date.now();
        this.pollProcessingStatus();
        
        this.log('Started status polling');
    }

    /**
     * Stop polling for job status
     * @private
     */
    stopPolling() {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * Poll processing status
     * @private
     */
    async pollProcessingStatus() {
        if (!this.currentJobId || !this.isProcessing) {
            return;
        }

        // Check for timeout
        if (this.pollStartTime && (Date.now() - this.pollStartTime) > this.config.maxPollTime) {
            this.warn('Polling timeout reached');
            await this.handleJobFailure('Processing timeout');
            return;
        }

        try {
            const jobStatus = await this.checkJobStatus(this.currentJobId);
            
            // Update progress if changed
            if (jobStatus.progress !== this.lastProgress) {
                this.lastProgress = jobStatus.progress;
                this.emit('processing:progress', {
                    jobId: this.currentJobId,
                    progress: jobStatus.progress,
                    completed_photos: jobStatus.completed_photos,
                    total_photos: jobStatus.total_photos,
                    status: jobStatus.status
                });
            }

            // Handle job completion
            if (jobStatus.status === 'completed') {
                this.log('Processing completed, fetching results');
                this.stopPolling();
                this.isProcessing = false;
                this.currentJobStatus = 'completed';
                
                // Small delay to ensure backend is ready
                setTimeout(() => this.fetchResults(), 500);
                return;
            }

            // Handle job failure
            if (jobStatus.status === 'failed') {
                this.stopPolling();
                await this.handleJobFailure('Processing failed');
                return;
            }

            // Continue polling if still processing
            if (jobStatus.status === 'processing' || jobStatus.status === 'pending') {
                this.pollTimer = setTimeout(() => {
                    this.pollProcessingStatus();
                }, this.config.pollInterval);
            }

            // Reset retry count on successful status check
            this.retryCount = 0;

        } catch (error) {
            this.handlePollingError(error);
        }
    }

    /**
     * Handle polling errors with retry logic
     * @private
     * @param {Error} error - Polling error
     */
    handlePollingError(error) {
        this.retryCount++;
        
        this.warn(`Status check error (attempt ${this.retryCount}):`, error);

        if (error.type === ErrorTypes.NOT_FOUND) {
            this.error('Job not found on server');
            this.stopPolling();
            this.handleJobFailure('Processing job was lost. Please start over.');
            return;
        }

        if (this.retryCount >= this.config.maxRetries) {
            this.error('Max polling retries exceeded');
            this.stopPolling();
            this.handleJobFailure('Failed to check processing status');
            return;
        }

        // Continue polling with longer delay on errors
        this.pollTimer = setTimeout(() => {
            this.pollProcessingStatus();
        }, this.config.retryDelay);
    }

    /**
     * Check job status
     * @param {string} jobId - Job ID to check
     * @returns {Promise<object>} Job status
     */
    async checkJobStatus(jobId) {
        try {
            const response = await this.apiService.get(`/process/status/${jobId}`);
            return response;
        } catch (error) {
            if (error.code === 404) {
                throw new AppError('Job not found', ErrorTypes.NOT_FOUND);
            }
            throw error;
        }
    }

    /**
     * Fetch processing results
     * @param {number} retryCount - Current retry count
     * @returns {Promise<void>}
     */
    async fetchResults(retryCount = 0) {
        if (!this.currentJobId) {
            throw new AppError('No current job to fetch results for', ErrorTypes.CLIENT);
        }

        try {
            this.log('Fetching processing results', { jobId: this.currentJobId, retryCount });

            const results = await this.apiService.get(`/process/results/${this.currentJobId}`);

            // Store results
            this.groupedPhotos = results;
            this.currentJobStatus = 'completed';
            
            // Update state
            this.updateProcessingState();

            // Mark job as completed in StateManager
            if (this.stateManager) {
                this.stateManager.markJobCompleted(this.currentJobId, 'completed');
            }

            // Calculate statistics
            const stats = this.calculateResultsStats(results);

            this.emit('processing:completed', {
                jobId: this.currentJobId,
                results: results,
                stats: stats
            });

            this.log('Results fetched successfully', {
                jobId: this.currentJobId,
                totalGroups: results.length,
                stats
            });

            // Clean up processing state
            this.isProcessing = false;

        } catch (error) {
            if (error.type === ErrorTypes.NOT_FOUND) {
                await this.handleJobFailure('Processing job was lost');
                return;
            }

            // Retry for server errors
            if (retryCount < this.config.maxRetries && error.code >= 500) {
                this.warn(`Results fetch failed, retrying (attempt ${retryCount + 1})`);
                
                this.emit('processing:results:retry', {
                    jobId: this.currentJobId,
                    retryCount: retryCount + 1,
                    error
                });

                setTimeout(() => {
                    this.fetchResults(retryCount + 1);
                }, this.config.retryDelay);
                return;
            }

            this.emit('processing:results:error', { jobId: this.currentJobId, error });
            this.error('Failed to fetch results:', error);
            
            await this.handleJobFailure('Failed to fetch processing results');
        }
    }

    /**
     * Handle job failure
     * @private
     * @param {string} reason - Failure reason
     */
    async handleJobFailure(reason) {
        this.log('Processing job failed', { jobId: this.currentJobId, reason });

        this.stopPolling();
        this.isProcessing = false;
        this.currentJobStatus = 'failed';
        
        // Mark job as failed in StateManager
        if (this.stateManager && this.currentJobId) {
            this.stateManager.markJobCompleted(this.currentJobId, 'failed');
        }

        this.emit('processing:failed', {
            jobId: this.currentJobId,
            reason
        });

        // Don't clear the job immediately - let UI decide what to do
    }

    /**
     * Refresh results for current job
     * @returns {Promise<object>} Updated results
     */
    async refreshResults() {
        this.ensureReady();

        if (!this.currentJobId) {
            throw new AppError('No current job to refresh results for', ErrorTypes.CLIENT);
        }

        try {
            this.log('Refreshing results', { jobId: this.currentJobId });

            const results = await this.apiService.get(`/process/results/${this.currentJobId}`);
            
            this.groupedPhotos = results;
            this.updateProcessingState();

            this.emit('processing:results:refreshed', {
                jobId: this.currentJobId,
                results
            });

            return results;

        } catch (error) {
            this.emit('processing:results:refresh_error', { error });
            this.error('Failed to refresh results:', error);
            throw error;
        }
    }

    /**
     * Apply manual label to a photo
     * @param {string} photoId - Photo ID
     * @param {string} bibNumber - Bib number to assign
     * @returns {Promise<object>} Label result
     */
    async applyManualLabel(photoId, bibNumber) {
        this.ensureReady();

        this.validateRequired({ photoId, bibNumber }, ['photoId', 'bibNumber']);

        try {
            this.log('Applying manual label', { photoId, bibNumber });

            const response = await this.apiService.put('/process/manual-label', {
                photo_id: photoId,
                bib_number: bibNumber
            });

            this.emit('processing:label:applied', {
                photoId,
                bibNumber,
                response
            });

            // Refresh results to get updated groupings
            await this.refreshResults();

            return response;

        } catch (error) {
            this.emit('processing:label:error', { photoId, bibNumber, error });
            this.error('Failed to apply manual label:', error);
            throw error;
        }
    }

    /**
     * Mark photo as having no visible bib
     * @param {string} photoId - Photo ID
     * @returns {Promise<object>} Label result
     */
    async markAsNoBib(photoId) {
        return this.applyManualLabel(photoId, 'unknown');
    }

    /**
     * Get recent completed jobs
     * @returns {Promise<object>} Recent jobs data
     */
    async getRecentJobs() {
        this.ensureReady();

        try {
            const response = await this.apiService.get('/process/recent-jobs');
            return response;
        } catch (error) {
            this.error('Failed to get recent jobs:', error);
            throw error;
        }
    }

    /**
     * Check and restore recent job if available
     * @returns {Promise<boolean>} True if job was restored
     */
    async checkAndRestoreRecentJob() {
        try {
            // Check if we have a recent completed job to restore
            if (this.stateManager && this.stateManager.hasRecentCompletedJob()) {
                const lastJobId = this.stateManager.get('processing.lastCompletedJobId');
                
                this.log('Attempting to restore recent job', { jobId: lastJobId });

                const results = await this.apiService.get(`/process/results/${lastJobId}`);
                
                // Restore job state
                this.currentJobId = lastJobId;
                this.currentJobStatus = 'completed';
                this.groupedPhotos = results;
                this.updateProcessingState();

                this.emit('processing:job:restored', {
                    jobId: lastJobId,
                    results
                });

                this.log('Recent job restored successfully', { jobId: lastJobId });
                return true;
            }
        } catch (error) {
            this.warn('Failed to restore recent job:', error);
        }

        return false;
    }

    /**
     * Calculate statistics from processing results
     * @private
     * @param {object[]} results - Processing results
     * @returns {object} Statistics
     */
    calculateResultsStats(results) {
        if (!Array.isArray(results)) {
            return { totalPhotos: 0, detectedPhotos: 0, unknownPhotos: 0, groups: 0 };
        }

        let totalPhotos = 0;
        let detectedPhotos = 0;
        let unknownPhotos = 0;

        for (const group of results) {
            const photoCount = group.photos ? group.photos.length : 0;
            totalPhotos += photoCount;

            if (group.bib_number === 'unknown' || group.bib_number === null) {
                unknownPhotos += photoCount;
            } else {
                detectedPhotos += photoCount;
            }
        }

        return {
            totalPhotos,
            detectedPhotos,
            unknownPhotos,
            groups: results.length,
            detectionRate: totalPhotos > 0 ? (detectedPhotos / totalPhotos * 100) : 0
        };
    }

    /**
     * Reset processing state (start over)
     */
    resetProcessing() {
        this.stopPolling();
        this.clearCurrentJob();
        
        // Clear completed job state from StateManager
        if (this.stateManager) {
            this.stateManager.clearCompletedJob();
            this.stateManager.set('processing.currentJobId', null);
            this.stateManager.set('processing.currentJobStatus', null);
        }

        this.emit('processing:reset');
        this.log('Processing state reset');
    }

    /**
     * Get current processing status
     * @returns {object} Processing status
     */
    getProcessingStatus() {
        return {
            isProcessing: this.isProcessing,
            currentJobId: this.currentJobId,
            currentJobStatus: this.currentJobStatus,
            hasResults: this.groupedPhotos.length > 0,
            resultCount: this.groupedPhotos.length,
            lastProgress: this.lastProgress,
            retryCount: this.retryCount,
            jobs: Array.from(this.jobs.values())
        };
    }

    /**
     * Get current results
     * @returns {object[]} Current grouped photos
     */
    getCurrentResults() {
        return [...this.groupedPhotos]; // Return copy to prevent mutation
    }

    /**
     * Get job information
     * @param {string} jobId - Job ID
     * @returns {object|null} Job information
     */
    getJob(jobId) {
        return this.jobs.get(jobId) || null;
    }
}