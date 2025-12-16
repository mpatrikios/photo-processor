/**
 * UploadManager - Complete upload workflow manager
 * Coordinates FileSelector, FileList, and UploadService
 * Provides unified upload experience and eliminates upload duplication
 */

import { BaseComponent } from '../BaseComponent.js';
import { FileSelector } from './FileSelector.js';
import { FileList } from './FileList.js';

export class UploadManager extends BaseComponent {
    constructor(containerSelector, options = {}) {
        super(containerSelector, {
            name: 'UploadManager',
            showQuotaInfo: true,
            showUploadButton: true,
            showClearButton: true,
            autoUpload: false,
            uploadButtonText: 'Upload Photos',
            clearButtonText: 'Clear All',
            ...options
        });

        // Child components
        this.fileSelector = null;
        this.fileList = null;

        // Upload state
        this.isUploading = false;
        this.quotaInfo = null;

        // Elements
        this.uploadButton = null;
        this.clearButton = null;
        this.quotaDisplay = null;
    }

    async onRender() {
        if (!this.element) {
            throw new Error('Container element required for UploadManager');
        }

        // Create upload manager UI
        this.createUploadUI();

        // Initialize child components
        await this.initializeComponents();

        this.log('Upload manager rendered');
    }

    /**
     * Create upload manager UI
     * @private
     */
    createUploadUI() {
        const html = `
            <div class="upload-manager">
                ${this.options.showQuotaInfo ? this.createQuotaInfoHTML() : ''}
                
                <div class="file-selector-container mb-4">
                    <!-- FileSelector will be mounted here -->
                </div>
                
                <div class="file-list-container">
                    <!-- FileList will be mounted here -->
                </div>
                
                ${this.createControlsHTML()}
            </div>
        `;

        this.setHTML(html);

        // Cache element references
        this.uploadButton = this.$('#upload-btn');
        this.clearButton = this.$('#clear-btn');
        this.quotaDisplay = this.$('.quota-display');
    }

    /**
     * Create quota info HTML
     * @private
     */
    createQuotaInfoHTML() {
        return `
            <div class="quota-info mb-3">
                <div class="quota-display">
                    <div class="d-flex justify-content-between align-items-center text-muted small">
                        <span>Upload quota: <span class="quota-text">Checking...</span></span>
                        <button type="button" class="btn btn-link btn-sm p-0 quota-refresh" title="Refresh quota">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                    </div>
                    <div class="quota-warning mt-2 d-none">
                        <!-- Quota warnings will appear here -->
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Create controls HTML
     * @private
     */
    createControlsHTML() {
        if (!this.options.showUploadButton && !this.options.showClearButton) {
            return '';
        }

        return `
            <div class="upload-controls mt-3 d-flex gap-2 justify-content-center">
                ${this.options.showUploadButton ? `
                    <button type="button" 
                            id="upload-btn" 
                            class="btn btn-primary"
                            disabled>
                        <i class="fas fa-upload me-2"></i>${this.options.uploadButtonText}
                    </button>
                ` : ''}
                ${this.options.showClearButton ? `
                    <button type="button" 
                            id="clear-btn" 
                            class="btn btn-outline-secondary"
                            disabled>
                        <i class="fas fa-trash me-2"></i>${this.options.clearButtonText}
                    </button>
                ` : ''}
            </div>
        `;
    }

    /**
     * Initialize child components
     * @private
     */
    async initializeComponents() {
        // Initialize FileSelector
        const fileSelectorContainer = this.$('.file-selector-container');
        if (fileSelectorContainer) {
            this.fileSelector = new FileSelector(fileSelectorContainer, {
                maxFiles: 50,
                maxFileSize: 10 * 1024 * 1024, // 10MB
                multiple: true,
                allowFolders: true
            });

            if (this.services) {
                this.fileSelector.setServices(this.services);
            }

            await this.fileSelector.initialize();
            this.addChild('fileSelector', this.fileSelector);
        }

        // Initialize FileList
        const fileListContainer = this.$('.file-list-container');
        if (fileListContainer) {
            this.fileList = new FileList(fileListContainer, {
                showProgress: true,
                showRemoveButtons: true,
                emptyMessage: 'No photos selected. Use the area above to select photos.'
            });

            if (this.services) {
                this.fileList.setServices(this.services);
            }

            await this.fileList.initialize();
            this.addChild('fileList', this.fileList);
        }

        this.log('Upload manager components initialized');
    }

    setupEventListeners() {
        // Upload button
        if (this.uploadButton) {
            this.addEventListener(this.uploadButton, 'click', this.handleUpload);
        }

        // Clear button
        if (this.clearButton) {
            this.addEventListener(this.clearButton, 'click', this.handleClear);
        }

        // Quota refresh button
        const quotaRefreshBtn = this.$('.quota-refresh');
        if (quotaRefreshBtn) {
            this.addEventListener(quotaRefreshBtn, 'click', this.refreshQuota);
        }

        // File list events
        this.on('filelist:updated', this.handleFileListUpdate);
        this.on('filelist:cleared', this.handleFileListCleared);
        this.on('files:selected', this.handleFilesSelected);

        // Upload service events
        this.on('upload:started', this.handleUploadStarted);
        this.on('upload:progress', this.handleUploadProgress);
        this.on('upload:completed', this.handleUploadCompleted);
        this.on('upload:error', this.handleUploadError);
        this.on('upload:quota:checked', this.handleQuotaUpdate);

        // Auto-refresh quota on initialization
        this.setTimeout(() => this.refreshQuota(), 1000);
    }

    /**
     * Handle file list update
     * @private
     */
    handleFileListUpdate = (data) => {
        this.updateControlStates();
        this.refreshQuota();
        
        this.emit('upload:files:updated', {
            files: data.files,
            count: data.count,
            canUpload: this.canUpload()
        });
    };

    /**
     * Handle file list cleared
     * @private
     */
    handleFileListCleared = (data) => {
        this.updateControlStates();
        
        this.emit('upload:files:cleared', data);
    };

    /**
     * Handle files selected
     * @private
     */
    handleFilesSelected = (data) => {
        this.log('Files selected through manager', data);
        
        if (this.options.autoUpload && data.result && data.result.valid && data.result.valid.length > 0) {
            // Auto-upload if enabled and valid files were selected
            this.setTimeout(() => this.startUpload(), 500);
        }
    };

    /**
     * Handle upload button click
     * @private
     */
    handleUpload = async (event) => {
        event.preventDefault();
        await this.startUpload();
    };

    /**
     * Handle clear button click
     * @private
     */
    handleClear = (event) => {
        event.preventDefault();
        this.clearFiles();
    };

    /**
     * Handle upload started
     * @private
     */
    handleUploadStarted = (data) => {
        this.isUploading = true;
        this.updateControlStates();
        this.updateUploadButton(true);
        
        // Pass to file list
        if (this.fileList) {
            this.fileList.setUploading(true);
        }

        this.emit('upload:manager:started', data);
    };

    /**
     * Handle upload progress
     * @private
     */
    handleUploadProgress = (data) => {
        // Update upload button with progress
        this.updateUploadButton(true, `Uploading... ${data.percentage || 0}%`);
        
        // Pass to file list
        if (this.fileList) {
            this.fileList.updateUploadProgress(data);
        }
    };

    /**
     * Handle upload completed
     * @private
     */
    handleUploadCompleted = (data) => {
        this.isUploading = false;
        this.updateControlStates();
        this.updateUploadButton(false);
        
        // Clear file list
        if (this.fileList) {
            this.fileList.clearFiles();
        }

        // Refresh quota
        this.setTimeout(() => this.refreshQuota(), 1000);

        this.emit('upload:manager:completed', data);
        
        this.log('Upload completed via manager', data);
    };

    /**
     * Handle upload error
     * @private
     */
    handleUploadError = (data) => {
        this.isUploading = false;
        this.updateControlStates();
        this.updateUploadButton(false);
        
        // Stop file list upload state
        if (this.fileList) {
            this.fileList.setUploading(false);
        }

        this.emit('upload:manager:error', data);
        
        this.error('Upload failed via manager', data.error);
    };

    /**
     * Handle quota update
     * @private
     */
    handleQuotaUpdate = (data) => {
        this.quotaInfo = data;
        this.updateQuotaDisplay();
        this.updateControlStates();
    };

    /**
     * Start upload process
     */
    async startUpload() {
        if (this.isUploading || !this.canUpload()) {
            return;
        }

        const uploadService = this.getService('uploadService');
        if (!uploadService) {
            this.error('UploadService not available');
            return;
        }

        try {
            this.log('Starting upload via manager');
            
            const result = await uploadService.uploadFiles({
                onProgress: (progress) => {
                    this.emit('upload:progress', progress);
                }
            });

            this.log('Upload successful', result);

        } catch (error) {
            this.error('Upload failed:', error);
        }
    }

    /**
     * Clear all files
     */
    clearFiles() {
        if (this.fileList) {
            this.fileList.clearFiles();
        }

        // Also clear from upload service
        const uploadService = this.getService('uploadService');
        if (uploadService) {
            uploadService.clearAllFiles();
        }

        this.log('Files cleared via manager');
    }

    /**
     * Refresh quota information
     */
    async refreshQuota() {
        const uploadService = this.getService('uploadService');
        if (!uploadService) {
            return;
        }

        try {
            this.quotaInfo = await uploadService.refreshQuota();
            this.updateQuotaDisplay();
            this.updateControlStates();
        } catch (error) {
            this.warn('Failed to refresh quota:', error);
        }
    }

    /**
     * Update quota display
     * @private
     */
    updateQuotaDisplay() {
        if (!this.quotaDisplay || !this.quotaInfo) {
            return;
        }

        const quotaText = this.quotaDisplay.querySelector('.quota-text');
        const quotaWarning = this.quotaDisplay.querySelector('.quota-warning');

        if (quotaText) {
            if (this.quotaInfo.limit === Infinity) {
                quotaText.textContent = 'Unlimited';
            } else {
                quotaText.textContent = `${this.quotaInfo.remaining} of ${this.quotaInfo.limit} remaining`;
            }
        }

        if (quotaWarning) {
            if (!this.quotaInfo.canUpload && this.quotaInfo.message) {
                quotaWarning.innerHTML = `
                    <div class="alert alert-warning alert-sm mb-0">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        ${this.quotaInfo.message}
                    </div>
                `;
                quotaWarning.classList.remove('d-none');
            } else {
                quotaWarning.classList.add('d-none');
            }
        }
    }

    /**
     * Update control button states
     * @private
     */
    updateControlStates() {
        const hasFiles = this.fileList ? this.fileList.getFileCount() > 0 : false;
        const canUpload = this.canUpload() && hasFiles;

        if (this.uploadButton) {
            this.uploadButton.disabled = !canUpload || this.isUploading;
        }

        if (this.clearButton) {
            this.clearButton.disabled = !hasFiles || this.isUploading;
        }

        // Update file selector state
        if (this.fileSelector) {
            this.fileSelector.setEnabled(!this.isUploading);
        }
    }

    /**
     * Update upload button state
     * @private
     */
    updateUploadButton(uploading, text = null) {
        if (!this.uploadButton) return;

        if (uploading) {
            this.uploadButton.dataset.originalText = this.uploadButton.innerHTML;
            this.uploadButton.innerHTML = `
                <i class="fas fa-spinner fa-spin me-2"></i>
                ${text || 'Uploading...'}
            `;
            this.uploadButton.disabled = true;
        } else {
            this.uploadButton.innerHTML = this.uploadButton.dataset.originalText || 
                `<i class="fas fa-upload me-2"></i>${this.options.uploadButtonText}`;
            delete this.uploadButton.dataset.originalText;
            this.updateControlStates();
        }
    }

    /**
     * Check if upload is possible
     */
    canUpload() {
        if (this.isUploading) return false;
        
        if (this.quotaInfo && !this.quotaInfo.canUpload) {
            return false;
        }

        const hasFiles = this.fileList ? this.fileList.getFileCount() > 0 : false;
        return hasFiles;
    }

    /**
     * Get upload manager status
     */
    getStatus() {
        return {
            isUploading: this.isUploading,
            fileCount: this.fileList ? this.fileList.getFileCount() : 0,
            canUpload: this.canUpload(),
            quotaInfo: this.quotaInfo,
            hasQuotaWarning: this.quotaInfo && !this.quotaInfo.canUpload
        };
    }

    /**
     * Get selected files summary
     */
    getFilesSummary() {
        return this.fileList ? this.fileList.getSummary() : null;
    }

    /**
     * Set services and propagate to children
     */
    setServices(services) {
        super.setServices(services);

        if (this.fileSelector) {
            this.fileSelector.setServices(services);
        }

        if (this.fileList) {
            this.fileList.setServices(services);
        }
    }

    /**
     * Static helper to create upload manager
     */
    static create(containerSelector, options = {}) {
        const manager = new UploadManager(containerSelector, options);
        return manager;
    }

    /**
     * Static helper to create and initialize upload manager
     */
    static async createAndInitialize(containerSelector, options = {}) {
        const manager = new UploadManager(containerSelector, options);
        await manager.initialize();
        return manager;
    }
}