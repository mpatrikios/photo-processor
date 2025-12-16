/**
 * ExportService - Photo export and download service for TagSort
 * Handles ZIP generation, download management, and export progress tracking
 */

import { BaseService } from './BaseService.js';
import { AppError, ErrorTypes } from '../utils/errors.js';

export class ExportService extends BaseService {
    constructor(eventBus, apiService, stateManager, config = {}) {
        super(eventBus, {
            name: 'ExportService',
            progressSteps: 4, // Number of progress steps to show during export
            stepDuration: 800, // Duration per step in milliseconds
            ...config
        });

        this.apiService = apiService;
        this.stateManager = stateManager;
        
        // Export state
        this.isExporting = false;
        this.currentExportId = null;
        this.exportProgress = 0;
        this.exports = new Map(); // Track export history
    }

    async onInitialize() {
        this.log('ExportService initialized');
    }

    /**
     * Export selected photo groups as ZIP
     * @param {string[]} selectedGroups - Array of selected bib numbers
     * @param {object[]} groupedPhotos - All grouped photos data
     * @param {object} options - Export options
     * @returns {Promise<object>} Export result
     */
    async exportSelectedGroups(selectedGroups, groupedPhotos, options = {}) {
        this.ensureReady();

        this.validateRequired({ selectedGroups, groupedPhotos }, ['selectedGroups', 'groupedPhotos']);

        if (!Array.isArray(selectedGroups) || selectedGroups.length === 0) {
            throw new AppError('No groups selected for export', ErrorTypes.VALIDATION);
        }

        if (this.isExporting) {
            throw new AppError('Export already in progress', ErrorTypes.CLIENT);
        }

        const exportId = this.generateExportId();
        
        try {
            this.log('Starting group export', { 
                exportId, 
                groups: selectedGroups.length 
            });

            this.isExporting = true;
            this.currentExportId = exportId;
            this.exportProgress = 0;

            // Collect photo IDs from selected groups
            const photoIds = this.collectPhotoIds(selectedGroups, groupedPhotos);

            if (photoIds.length === 0) {
                throw new AppError('No photos found in selected groups', ErrorTypes.VALIDATION);
            }

            // Start progress simulation
            this.startProgressSimulation();

            this.emit('export:started', { 
                exportId, 
                selectedGroups,
                photoCount: photoIds.length 
            });

            // Create export request
            const exportData = {
                photo_ids: photoIds,
                format: options.format || 'zip',
                group_by: options.groupBy || 'bib_number',
                include_metadata: options.includeMetadata || false
            };

            const response = await this.apiService.post('/download/export', exportData);

            // Complete progress and download
            this.updateProgress(100, 'Download ready!');

            // Download the file
            const downloadUrl = `/download/file/${response.export_id}`;
            const filename = options.filename || `tag_photos_${response.export_id}.zip`;
            
            await this.downloadFile(downloadUrl, filename);

            const result = {
                exportId,
                serverExportId: response.export_id,
                photoCount: photoIds.length,
                groupCount: selectedGroups.length,
                filename,
                success: true
            };

            // Store export info
            this.exports.set(exportId, {
                ...result,
                timestamp: new Date(),
                selectedGroups,
                options
            });

            this.emit('export:completed', result);
            this.log('Group export completed', result);

            return result;

        } catch (error) {
            this.emit('export:error', { exportId, error });
            this.error('Group export failed:', error);
            throw error;

        } finally {
            this.isExporting = false;
            this.currentExportId = null;
            this.exportProgress = 0;
        }
    }

    /**
     * Export all photos as ZIP
     * @param {object[]} groupedPhotos - All grouped photos data
     * @param {object} options - Export options
     * @returns {Promise<object>} Export result
     */
    async exportAllPhotos(groupedPhotos, options = {}) {
        this.ensureReady();

        this.validateRequired({ groupedPhotos }, ['groupedPhotos']);

        if (!Array.isArray(groupedPhotos) || groupedPhotos.length === 0) {
            throw new AppError('No photos available for export', ErrorTypes.VALIDATION);
        }

        if (this.isExporting) {
            throw new AppError('Export already in progress', ErrorTypes.CLIENT);
        }

        const exportId = this.generateExportId();

        try {
            this.log('Starting full export', { exportId });

            this.isExporting = true;
            this.currentExportId = exportId;
            this.exportProgress = 0;

            // Collect all photo IDs
            const photoIds = this.collectAllPhotoIds(groupedPhotos);

            if (photoIds.length === 0) {
                throw new AppError('No photos found for export', ErrorTypes.VALIDATION);
            }

            // Start progress simulation
            this.startProgressSimulation();

            this.emit('export:started', { 
                exportId, 
                photoCount: photoIds.length,
                exportType: 'all'
            });

            // Create export request
            const exportData = {
                photo_ids: photoIds,
                format: options.format || 'zip',
                group_by: options.groupBy || 'bib_number',
                include_metadata: options.includeMetadata || false
            };

            const response = await this.apiService.post('/download/export', exportData);

            // Complete progress and download
            this.updateProgress(100, 'Download ready!');

            // Download the file
            const downloadUrl = `/download/file/${response.export_id}`;
            const filename = options.filename || `all_tag_photos_${response.export_id}.zip`;
            
            await this.downloadFile(downloadUrl, filename);

            const result = {
                exportId,
                serverExportId: response.export_id,
                photoCount: photoIds.length,
                groupCount: groupedPhotos.length,
                filename,
                success: true,
                exportType: 'all'
            };

            // Store export info
            this.exports.set(exportId, {
                ...result,
                timestamp: new Date(),
                options
            });

            this.emit('export:completed', result);
            this.log('Full export completed', result);

            return result;

        } catch (error) {
            this.emit('export:error', { exportId, error });
            this.error('Full export failed:', error);
            throw error;

        } finally {
            this.isExporting = false;
            this.currentExportId = null;
            this.exportProgress = 0;
        }
    }

    /**
     * Download a file with authentication
     * @param {string} url - Download URL (relative or absolute)
     * @param {string} filename - Filename for download
     * @param {object} options - Download options
     * @returns {Promise<Blob>} Downloaded file blob
     */
    async downloadFile(url, filename, options = {}) {
        this.ensureReady();

        try {
            this.log('Starting authenticated download', { url, filename });

            // Use ApiService download method which handles authentication
            const blob = await this.apiService.download(url, filename, options);

            this.emit('export:download:completed', { 
                url, 
                filename, 
                size: blob.size 
            });

            this.log('Download completed', { filename, size: blob.size });

            return blob;

        } catch (error) {
            this.emit('export:download:error', { url, filename, error });
            this.error('Download failed:', error);
            throw error;
        }
    }

    /**
     * Start progress simulation during export preparation
     * @private
     */
    startProgressSimulation() {
        const stepSize = 90 / this.config.progressSteps; // Reserve 10% for final completion
        let currentStep = 0;

        const progressMessages = [
            'Preparing export...',
            'Collecting photos...',
            'Creating ZIP archive...',
            'Finalizing download...'
        ];

        const updateStep = () => {
            if (currentStep < this.config.progressSteps && this.isExporting) {
                const progress = Math.min(90, (currentStep + 1) * stepSize);
                const message = progressMessages[currentStep] || 'Processing...';
                
                this.updateProgress(progress, message);
                currentStep++;

                // Schedule next step
                setTimeout(updateStep, this.config.stepDuration);
            }
        };

        // Start first step
        setTimeout(updateStep, 100);
    }

    /**
     * Update export progress
     * @private
     * @param {number} percentage - Progress percentage (0-100)
     * @param {string} message - Progress message
     */
    updateProgress(percentage, message = '') {
        this.exportProgress = Math.max(0, Math.min(100, percentage));
        
        this.emit('export:progress', {
            exportId: this.currentExportId,
            percentage: this.exportProgress,
            message
        });

        if (this.debugMode) {
            this.log('Export progress', { percentage: this.exportProgress, message });
        }
    }

    /**
     * Collect photo IDs from selected groups
     * @private
     * @param {string[]} selectedGroups - Selected bib numbers
     * @param {object[]} groupedPhotos - All grouped photos
     * @returns {string[]} Array of photo IDs
     */
    collectPhotoIds(selectedGroups, groupedPhotos) {
        const photoIds = [];
        
        for (const group of groupedPhotos) {
            if (selectedGroups.includes(group.bib_number) && group.photos) {
                for (const photo of group.photos) {
                    if (photo.photo_id) {
                        photoIds.push(photo.photo_id);
                    }
                }
            }
        }

        return photoIds;
    }

    /**
     * Collect all photo IDs from grouped photos
     * @private
     * @param {object[]} groupedPhotos - All grouped photos
     * @returns {string[]} Array of photo IDs
     */
    collectAllPhotoIds(groupedPhotos) {
        const photoIds = [];
        
        for (const group of groupedPhotos) {
            if (group.photos) {
                for (const photo of group.photos) {
                    if (photo.photo_id) {
                        photoIds.push(photo.photo_id);
                    }
                }
            }
        }

        return photoIds;
    }

    /**
     * Cancel current export
     * @returns {boolean} True if export was cancelled
     */
    cancelExport() {
        if (!this.isExporting || !this.currentExportId) {
            return false;
        }

        try {
            // Cancel any ongoing API requests
            this.apiService.cancelAllRequests();
            
            const exportId = this.currentExportId;
            this.isExporting = false;
            this.currentExportId = null;
            this.exportProgress = 0;
            
            this.emit('export:cancelled', { exportId });
            this.log('Export cancelled', { exportId });
            
            return true;
            
        } catch (error) {
            this.error('Failed to cancel export:', error);
            return false;
        }
    }

    /**
     * Get current export status
     * @returns {object} Export status information
     */
    getExportStatus() {
        return {
            isExporting: this.isExporting,
            exportId: this.currentExportId,
            progress: this.exportProgress,
            canExport: !this.isExporting,
            exportHistory: Array.from(this.exports.values()).slice(-10) // Last 10 exports
        };
    }

    /**
     * Get export history
     * @param {number} limit - Maximum number of exports to return
     * @returns {object[]} Array of export records
     */
    getExportHistory(limit = 10) {
        const exports = Array.from(this.exports.values());
        exports.sort((a, b) => b.timestamp - a.timestamp);
        return exports.slice(0, limit);
    }

    /**
     * Clear export history
     */
    clearExportHistory() {
        this.exports.clear();
        this.emit('export:history:cleared');
        this.log('Export history cleared');
    }

    /**
     * Get export information by ID
     * @param {string} exportId - Export ID
     * @returns {object|null} Export information
     */
    getExport(exportId) {
        return this.exports.get(exportId) || null;
    }

    /**
     * Generate unique export ID
     * @private
     * @returns {string} Export ID
     */
    generateExportId() {
        return `export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get download size estimate
     * @param {string[]} photoIds - Photo IDs to estimate
     * @returns {Promise<object>} Size estimate information
     */
    async getDownloadSizeEstimate(photoIds) {
        try {
            if (!Array.isArray(photoIds) || photoIds.length === 0) {
                return { estimatedSize: 0, photoCount: 0 };
            }

            // Simple estimation: average 2MB per photo
            const averagePhotoSize = 2 * 1024 * 1024; // 2MB in bytes
            const estimatedSize = photoIds.length * averagePhotoSize;

            return {
                photoCount: photoIds.length,
                estimatedSize,
                estimatedSizeMB: Math.round(estimatedSize / (1024 * 1024)),
                estimatedSizeGB: (estimatedSize / (1024 * 1024 * 1024)).toFixed(2)
            };

        } catch (error) {
            this.warn('Failed to estimate download size:', error);
            return { 
                estimatedSize: 0, 
                photoCount: photoIds.length || 0 
            };
        }
    }

    async onStop() {
        // Cancel any ongoing exports
        this.cancelExport();
        
        // Clear history
        this.clearExportHistory();
    }
}