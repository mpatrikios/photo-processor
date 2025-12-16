/**
 * UploadService - File upload service for TagSort
 * Handles file selection, validation, quota checking, and upload progress
 */

import { BaseService } from './BaseService.js';
import { AppError, ErrorTypes } from '../utils/errors.js';
import { validateFiles, validateFileType, validateFileSize } from '../utils/validation.js';
import { formatFileSize } from '../utils/format.js';

export class UploadService extends BaseService {
    constructor(eventBus, apiService, stateManager, config = {}) {
        super(eventBus, {
            name: 'UploadService',
            maxFiles: 10000, // Increased for race photography - typically thousands of photos
            maxFileSizeMB: 10,
            allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
            chunkSize: 5 * 1024 * 1024, // 5MB chunks for large uploads
            ...config
        });

        this.apiService = apiService;
        this.stateManager = stateManager;
        
        // Upload state
        this.selectedFiles = [];
        this.uploadProgress = new Map(); // Track progress per file
        this.isUploading = false;
        this.currentUploadId = null;
        
        // Quota information
        this.quotaInfo = null;
        this.lastQuotaCheck = null;
    }

    async onInitialize() {
        // Get quota service dependency
        this.quotaService = this.serviceContainer?.get('quotaService');
        this.log('UploadService initialized');
    }

    /**
     * Check quota availability before allowing uploads
     * @private
     */
    async checkQuotaAvailability(fileCount) {
        try {
            if (!this.quotaService) {
                this.warn('QuotaService not available, skipping quota check');
                return; // Allow upload if quota service not available
            }

            // Load latest quota information
            await this.quotaService.loadQuotaData();
            
            // Check if user has enough quota
            if (!this.quotaService.hasAvailableQuota(fileCount)) {
                const quotaInfo = this.quotaService.getQuotaInfo();
                const quotaStatus = this.quotaService.getQuotaStatus();
                
                this.quotaService.emitQuotaExceeded(fileCount);
                
                throw new AppError(
                    `Insufficient quota: ${quotaStatus.message}. You're trying to upload ${fileCount} photos but only have ${quotaInfo.remaining} remaining.`,
                    ErrorTypes.QUOTA_EXCEEDED
                );
            }
            
            this.log(`Quota check passed: ${fileCount} files, ${this.quotaService.getQuotaInfo()?.remaining} remaining`);
            
        } catch (error) {
            if (error.type === ErrorTypes.QUOTA_EXCEEDED) {
                throw error; // Re-throw quota errors
            }
            
            this.warn('Quota check failed, allowing upload:', error);
            // Don't block uploads if quota check fails for technical reasons
        }
    }

    /**
     * Handle file selection from input or drag & drop
     * @param {FileList|File[]} files - Files to select
     * @param {boolean} isFolder - Whether files are from folder selection
     * @returns {Promise<object>} Selection result with valid/invalid files
     */
    async selectFiles(files, isFolder = false) {
        this.ensureReady();

        try {
            this.log('Processing file selection', { count: files.length, isFolder });
            
            // Clear any previous completed job state when starting new upload
            if (this.stateManager) {
                this.stateManager.clearCompletedJob();
            }

            // Convert FileList to Array if needed
            const fileArray = Array.from(files);
            
            // Filter to only image files
            const imageFiles = fileArray.filter(file => 
                this.config.allowedTypes.includes(file.type.toLowerCase()) ||
                file.type.startsWith('image/')
            );
            
            if (imageFiles.length === 0) {
                this.emit('upload:files:none_valid', { totalFiles: fileArray.length });
                throw new AppError('No valid image files selected', ErrorTypes.VALIDATION);
            }

            // Check quota availability
            await this.checkQuotaAvailability(imageFiles.length);

            // Validate files
            const validation = validateFiles(imageFiles, {
                maxFiles: this.config.maxFiles - this.selectedFiles.length, // Account for existing files
                maxSizeMB: this.config.maxFileSizeMB,
                allowedTypes: this.config.allowedTypes
            });

            if (validation.errors.length > 0) {
                this.emit('upload:files:validation_error', { errors: validation.errors });
                throw new AppError(validation.errors[0], ErrorTypes.VALIDATION);
            }

            // Process valid files
            const validFiles = validation.valid.map(({ file }) => file);
            
            // Add to existing files instead of replacing
            const newFiles = [...this.selectedFiles, ...validFiles];
            
            // Remove duplicates based on file name and size
            this.selectedFiles = newFiles.filter((file, index, self) =>
                index === self.findIndex(f => f.name === file.name && f.size === file.size)
            );

            // Check quota
            await this.checkUploadQuota();

            const result = {
                totalSelected: fileArray.length,
                validSelected: validFiles.length,
                duplicatesRemoved: newFiles.length - this.selectedFiles.length,
                currentTotal: this.selectedFiles.length,
                invalidFiles: validation.invalid
            };

            this.emit('upload:files:selected', result);
            
            this.log('File selection completed', result);
            
            return result;

        } catch (error) {
            this.emit('upload:files:error', { error });
            this.error('File selection failed:', error);
            throw error;
        }
    }

    /**
     * Remove a file from the selection
     * @param {number} index - Index of file to remove
     */
    removeFile(index) {
        this.ensureReady();

        if (index >= 0 && index < this.selectedFiles.length) {
            const removedFile = this.selectedFiles.splice(index, 1)[0];
            
            this.emit('upload:files:removed', { 
                file: removedFile, 
                index, 
                remaining: this.selectedFiles.length 
            });
            
            this.log('File removed', { fileName: removedFile.name, remaining: this.selectedFiles.length });
        }
    }

    /**
     * Clear all selected files
     */
    clearAllFiles() {
        this.ensureReady();

        const clearedCount = this.selectedFiles.length;
        this.selectedFiles = [];
        this.uploadProgress.clear();
        
        this.emit('upload:files:cleared', { clearedCount });
        this.log('All files cleared', { clearedCount });
    }

    /**
     * Get current file selection
     * @returns {File[]} Array of selected files
     */
    getSelectedFiles() {
        return [...this.selectedFiles]; // Return copy to prevent external mutation
    }

    /**
     * Get file selection summary
     * @returns {object} Selection summary
     */
    getSelectionSummary() {
        const totalSize = this.selectedFiles.reduce((sum, file) => sum + file.size, 0);
        
        return {
            count: this.selectedFiles.length,
            totalSize,
            totalSizeFormatted: formatFileSize(totalSize),
            averageSize: this.selectedFiles.length > 0 ? totalSize / this.selectedFiles.length : 0,
            fileTypes: [...new Set(this.selectedFiles.map(f => f.type))]
        };
    }

    /**
     * Check upload quota and limits
     * @returns {Promise<object>} Quota check result
     */
    async checkUploadQuota() {
        this.ensureReady();

        try {
            // Cache quota check for 30 seconds
            const now = Date.now();
            if (this.lastQuotaCheck && (now - this.lastQuotaCheck) < 30000) {
                return this.quotaInfo;
            }

            this.log('Checking upload quota');
            
            const response = await this.apiService.get('/users/me/quota');
            
            this.quotaInfo = {
                canUpload: true,
                message: '',
                current: response.photos_uploaded || 0,
                limit: response.monthly_limit || 1000,
                remaining: (response.monthly_limit || 1000) - (response.photos_uploaded || 0),
                resetDate: response.reset_date ? new Date(response.reset_date) : null
            };

            // Check if upload would exceed quota
            const wouldUpload = this.selectedFiles.length;
            if (this.quotaInfo.remaining < wouldUpload) {
                this.quotaInfo.canUpload = false;
                this.quotaInfo.message = `Upload quota exceeded. You can upload ${this.quotaInfo.remaining} more photos this month.`;
            }

            this.lastQuotaCheck = now;
            
            this.emit('upload:quota:checked', this.quotaInfo);
            this.log('Quota check completed', this.quotaInfo);
            
            return this.quotaInfo;

        } catch (error) {
            this.warn('Quota check failed:', error);
            
            // Return permissive quota on error (don't block uploads)
            this.quotaInfo = {
                canUpload: true,
                message: 'Could not check quota limits',
                current: 0,
                limit: Infinity,
                remaining: Infinity,
                resetDate: null
            };
            
            return this.quotaInfo;
        }
    }

    /**
     * Upload selected files
     * @param {object} options - Upload options
     * @returns {Promise<object>} Upload result
     */
    async uploadFiles(options = {}) {
        this.ensureReady();

        if (this.selectedFiles.length === 0) {
            throw new AppError('No files selected for upload', ErrorTypes.VALIDATION);
        }

        if (this.isUploading) {
            throw new AppError('Upload already in progress', ErrorTypes.CLIENT);
        }

        // Check quota before upload
        const quotaCheck = await this.checkUploadQuota();
        if (!quotaCheck.canUpload) {
            throw new AppError(quotaCheck.message, ErrorTypes.VALIDATION);
        }

        const uploadId = this.generateUploadId();
        this.currentUploadId = uploadId;
        this.isUploading = true;

        try {
            this.log('Starting file upload', { 
                files: this.selectedFiles.length, 
                uploadId 
            });

            // Prepare form data
            const formData = new FormData();
            this.selectedFiles.forEach(file => {
                formData.append('files', file);
            });

            // Reset progress tracking
            this.uploadProgress.clear();
            this.selectedFiles.forEach((file, index) => {
                this.uploadProgress.set(index, { loaded: 0, total: file.size });
            });

            this.emit('upload:started', { 
                uploadId, 
                fileCount: this.selectedFiles.length,
                totalSize: this.getSelectionSummary().totalSize
            });

            // Upload with progress tracking
            const response = await this.apiService.upload('/upload/photos', formData, {
                onProgress: (progressEvent) => {
                    this.handleUploadProgress(uploadId, progressEvent);
                }
            });

            // Process upload response
            const result = {
                uploadId,
                success: true,
                photoIds: response.photo_ids || [],
                uploadedCount: response.uploaded_count || this.selectedFiles.length,
                message: response.message || 'Upload completed successfully'
            };

            this.emit('upload:completed', result);
            this.log('Upload completed successfully', result);

            // Clear selected files after successful upload
            this.selectedFiles = [];
            this.uploadProgress.clear();

            return result;

        } catch (error) {
            this.emit('upload:error', { uploadId, error });
            this.error('Upload failed:', error);
            throw error;

        } finally {
            this.isUploading = false;
            this.currentUploadId = null;
        }
    }

    /**
     * Cancel current upload
     */
    cancelUpload() {
        if (!this.isUploading || !this.currentUploadId) {
            return false;
        }

        try {
            // The ApiService will handle the actual request cancellation
            this.apiService.cancelAllRequests();
            
            this.isUploading = false;
            const uploadId = this.currentUploadId;
            this.currentUploadId = null;
            
            this.emit('upload:cancelled', { uploadId });
            this.log('Upload cancelled', { uploadId });
            
            return true;
            
        } catch (error) {
            this.error('Failed to cancel upload:', error);
            return false;
        }
    }

    /**
     * Handle upload progress updates
     * @private
     * @param {string} uploadId - Upload ID
     * @param {ProgressEvent} progressEvent - Progress event from fetch
     */
    handleUploadProgress(uploadId, progressEvent) {
        if (progressEvent.lengthComputable) {
            const progress = {
                uploadId,
                loaded: progressEvent.loaded,
                total: progressEvent.total,
                percentage: Math.round((progressEvent.loaded / progressEvent.total) * 100)
            };

            this.emit('upload:progress', progress);

            if (this.debugMode) {
                this.log('Upload progress', progress);
            }
        }
    }

    /**
     * Get current upload status
     * @returns {object} Upload status information
     */
    getUploadStatus() {
        return {
            isUploading: this.isUploading,
            uploadId: this.currentUploadId,
            selectedCount: this.selectedFiles.length,
            hasFiles: this.selectedFiles.length > 0,
            canUpload: !this.isUploading && this.selectedFiles.length > 0,
            quotaInfo: this.quotaInfo
        };
    }

    /**
     * Generate unique upload ID
     * @private
     * @returns {string} Upload ID
     */
    generateUploadId() {
        return `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get upload progress for all files
     * @returns {object} Progress information
     */
    getUploadProgress() {
        if (!this.isUploading) {
            return { percentage: 0, loaded: 0, total: 0 };
        }

        let totalLoaded = 0;
        let totalSize = 0;

        for (const progress of this.uploadProgress.values()) {
            totalLoaded += progress.loaded;
            totalSize += progress.total;
        }

        return {
            percentage: totalSize > 0 ? Math.round((totalLoaded / totalSize) * 100) : 0,
            loaded: totalLoaded,
            total: totalSize,
            formattedLoaded: formatFileSize(totalLoaded),
            formattedTotal: formatFileSize(totalSize)
        };
    }

    /**
     * Validate individual file
     * @param {File} file - File to validate
     * @returns {object} Validation result
     */
    validateFile(file) {
        const result = {
            valid: true,
            errors: []
        };

        if (!validateFileType(file, this.config.allowedTypes)) {
            result.valid = false;
            result.errors.push(`Invalid file type: ${file.type}. Allowed types: ${this.config.allowedTypes.join(', ')}`);
        }

        if (!validateFileSize(file, this.config.maxFileSizeMB)) {
            result.valid = false;
            result.errors.push(`File too large: ${formatFileSize(file.size)}. Maximum size: ${this.config.maxFileSizeMB}MB`);
        }

        return result;
    }

    /**
     * Get quota information
     * @returns {object|null} Current quota info
     */
    getQuotaInfo() {
        return this.quotaInfo;
    }

    /**
     * Force refresh quota information
     * @returns {Promise<object>} Updated quota info
     */
    async refreshQuota() {
        this.lastQuotaCheck = null;
        return await this.checkUploadQuota();
    }

    async onStop() {
        // Cancel any ongoing uploads
        this.cancelUpload();
        
        // Clear file selection
        this.clearAllFiles();
    }
}