/**
 * FileList - File list display and management component
 * Shows selected files with remove capability and upload progress
 * Eliminates duplication between main file list and modal file list
 */

import { BaseComponent } from '../BaseComponent.js';
import { formatFileSize } from '../../utils/format.js';

export class FileList extends BaseComponent {
    constructor(containerSelector, options = {}) {
        super(containerSelector, {
            name: 'FileList',
            showProgress: true,
            showRemoveButtons: true,
            showFileInfo: true,
            allowReorder: false,
            emptyMessage: 'No files selected',
            ...options
        });

        // State
        this.files = [];
        this.uploadProgress = new Map();
        this.isUploading = false;
    }

    async onRender() {
        if (!this.element) {
            throw new Error('Container element required for FileList');
        }

        this.updateDisplay();
        this.log('File list rendered');
    }

    setupEventListeners() {
        // Listen for state changes to files
        this.on('state:files:selectedFiles:changed', this.handleStateFilesChanged);
        this.on('files:removed', this.handleFileRemoved);
        this.on('upload:progress', this.handleUploadProgress);
        this.on('upload:completed', this.handleUploadComplete);
    }

    /**
     * Handle state change for selected files
     * @private
     */
    handleStateFilesChanged = (data) => {
        const selectedFiles = data.value || [];
        this.log('State files changed received', { fileCount: selectedFiles.length });
        
        // Replace current files with state files
        this.files = [...selectedFiles];
        this.updateDisplay();
        
        this.emit('filelist:updated', { 
            files: this.files, 
            count: this.files.length 
        });
    };

    /**
     * Handle file removed event
     * @private
     */
    handleFileRemoved = (data) => {
        this.removeFile(data.index);
    };

    /**
     * Handle upload progress event
     * @private
     */
    handleUploadProgress = (data) => {
        this.updateUploadProgress(data);
    };

    /**
     * Handle upload complete event
     * @private
     */
    handleUploadComplete = (data) => {
        this.clearFiles();
        this.isUploading = false;
        this.updateDisplay();
    };

    /**
     * Add files to the list
     */
    addFiles(newFiles) {
        const filesArray = Array.isArray(newFiles) ? newFiles : [newFiles];
        
        // Add files and remove duplicates based on name and size
        const allFiles = [...this.files, ...filesArray];
        this.files = allFiles.filter((file, index, self) =>
            index === self.findIndex(f => f.name === file.name && f.size === file.size)
        );

        this.updateDisplay();
        this.emit('filelist:updated', { 
            files: this.files, 
            count: this.files.length 
        });
        
        this.log('Files added', { 
            added: filesArray.length, 
            total: this.files.length 
        });
    }

    /**
     * Remove file by index
     */
    removeFile(index) {
        if (index >= 0 && index < this.files.length) {
            const removedFile = this.files.splice(index, 1)[0];
            this.updateDisplay();
            
            this.emit('filelist:file:removed', { 
                file: removedFile, 
                index, 
                remaining: this.files.length 
            });
            
            this.log('File removed', { 
                fileName: removedFile.name, 
                remaining: this.files.length 
            });
        }
    }

    /**
     * Clear all files
     */
    clearFiles() {
        const clearedCount = this.files.length;
        this.files = [];
        this.uploadProgress.clear();
        this.updateDisplay();
        
        this.emit('filelist:cleared', { clearedCount });
        this.log('All files cleared', { clearedCount });
    }

    /**
     * Get current files
     */
    getFiles() {
        return [...this.files]; // Return copy to prevent external mutation
    }

    /**
     * Get file count
     */
    getFileCount() {
        return this.files.length;
    }

    /**
     * Update display
     * @private
     */
    updateDisplay() {
        if (!this.element) return;

        if (this.files.length === 0) {
            this.showEmptyState();
        } else {
            this.showFileList();
        }
    }

    /**
     * Show empty state
     * @private
     */
    showEmptyState() {
        this.setHTML(`
            <div class="file-list-empty text-center py-4">
                <i class="fas fa-images fa-2x text-muted mb-2"></i>
                <p class="text-muted mb-0">${this.options.emptyMessage}</p>
            </div>
        `);
    }

    /**
     * Show file list
     * @private
     */
    showFileList() {
        const totalSize = this.files.reduce((sum, file) => sum + file.size, 0);
        
        const html = `
            <div class="file-list">
                <div class="file-list-header d-flex justify-content-between align-items-center mb-3">
                    <div class="file-count">
                        <strong>${this.files.length}</strong> file${this.files.length !== 1 ? 's' : ''} selected
                    </div>
                    <div class="file-total-size text-muted">
                        Total: ${formatFileSize(totalSize)}
                    </div>
                </div>
                <div class="file-list-items">
                    ${this.files.map((file, index) => this.createFileItemHTML(file, index)).join('')}
                </div>
                ${this.isUploading ? this.createUploadProgressHTML() : ''}
            </div>
        `;

        this.setHTML(html);
        this.setupFileListEvents();
    }

    /**
     * Create HTML for individual file item
     * @private
     */
    createFileItemHTML(file, index) {
        const progress = this.uploadProgress.get(index);
        const hasProgress = progress && this.isUploading;

        return `
            <div class="file-item d-flex align-items-center p-2 border rounded mb-2" data-index="${index}">
                <div class="file-icon me-3">
                    <i class="fas fa-image text-primary"></i>
                </div>
                <div class="file-info flex-grow-1">
                    <div class="file-name fw-medium">${this.escapeHtml(file.name)}</div>
                    ${this.options.showFileInfo ? `
                        <div class="file-details text-muted small">
                            ${formatFileSize(file.size)} • ${file.type}
                        </div>
                    ` : ''}
                    ${hasProgress ? `
                        <div class="file-progress mt-1">
                            <div class="progress" style="height: 4px;">
                                <div class="progress-bar" 
                                     role="progressbar" 
                                     style="width: ${progress.percentage || 0}%"
                                     aria-valuenow="${progress.percentage || 0}" 
                                     aria-valuemin="0" 
                                     aria-valuemax="100">
                                </div>
                            </div>
                        </div>
                    ` : ''}
                </div>
                ${this.options.showRemoveButtons && !this.isUploading ? `
                    <button type="button" 
                            class="btn btn-sm btn-outline-danger file-remove-btn" 
                            data-index="${index}"
                            title="Remove file">
                        <i class="fas fa-times"></i>
                    </button>
                ` : ''}
            </div>
        `;
    }

    /**
     * Create upload progress HTML
     * @private
     */
    createUploadProgressHTML() {
        const totalProgress = this.calculateTotalProgress();
        
        return `
            <div class="upload-progress mt-3">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <span class="upload-status">
                        <i class="fas fa-cloud-upload-alt me-2"></i>
                        Uploading files...
                    </span>
                    <span class="upload-percentage">${totalProgress}%</span>
                </div>
                <div class="progress">
                    <div class="progress-bar progress-bar-striped progress-bar-animated" 
                         role="progressbar" 
                         style="width: ${totalProgress}%"
                         aria-valuenow="${totalProgress}" 
                         aria-valuemin="0" 
                         aria-valuemax="100">
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Setup file list event listeners
     * @private
     */
    setupFileListEvents() {
        // Remove button clicks
        const removeButtons = this.$$('.file-remove-btn');
        removeButtons.forEach(btn => {
            this.addEventListener(btn, 'click', (event) => {
                event.preventDefault();
                const index = parseInt(btn.dataset.index);
                this.removeFile(index);
            });
        });

        // File item clicks (for future functionality like preview)
        const fileItems = this.$$('.file-item');
        fileItems.forEach(item => {
            this.addEventListener(item, 'click', (event) => {
                if (!event.target.closest('.file-remove-btn')) {
                    const index = parseInt(item.dataset.index);
                    this.emit('filelist:file:clicked', { 
                        file: this.files[index], 
                        index 
                    });
                }
            });
        });
    }

    /**
     * Update upload progress
     */
    updateUploadProgress(progressData) {
        this.isUploading = true;
        
        // Update individual file progress if available
        if (progressData.fileIndex !== undefined) {
            this.uploadProgress.set(progressData.fileIndex, {
                percentage: progressData.percentage || 0,
                loaded: progressData.loaded || 0,
                total: progressData.total || 0
            });
        }

        // Update display
        this.updateDisplay();

        this.log('Upload progress updated', progressData);
    }

    /**
     * Calculate total upload progress
     * @private
     */
    calculateTotalProgress() {
        if (this.uploadProgress.size === 0) {
            return 0;
        }

        let totalLoaded = 0;
        let totalSize = 0;

        for (const [index, progress] of this.uploadProgress.entries()) {
            totalLoaded += progress.loaded || 0;
            totalSize += progress.total || (this.files[index]?.size || 0);
        }

        return totalSize > 0 ? Math.round((totalLoaded / totalSize) * 100) : 0;
    }

    /**
     * Set upload state
     */
    setUploading(uploading, progress = null) {
        this.isUploading = uploading;
        
        if (progress) {
            this.updateUploadProgress(progress);
        } else if (!uploading) {
            this.uploadProgress.clear();
            this.updateDisplay();
        }
    }

    /**
     * Escape HTML for safe display
     * @private
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Get file list summary
     */
    getSummary() {
        const totalSize = this.files.reduce((sum, file) => sum + file.size, 0);
        const fileTypes = [...new Set(this.files.map(f => f.type))];

        return {
            count: this.files.length,
            totalSize,
            totalSizeFormatted: formatFileSize(totalSize),
            averageSize: this.files.length > 0 ? totalSize / this.files.length : 0,
            fileTypes,
            isUploading: this.isUploading,
            uploadProgress: this.calculateTotalProgress()
        };
    }

    /**
     * Set empty message
     */
    setEmptyMessage(message) {
        this.options.emptyMessage = message;
        if (this.files.length === 0) {
            this.updateDisplay();
        }
    }

    /**
     * Enable/disable remove buttons
     */
    setRemoveEnabled(enabled) {
        this.options.showRemoveButtons = enabled;
        this.updateDisplay();
    }

    /**
     * Static helper to create file list
     */
    static create(containerSelector, options = {}) {
        const fileList = new FileList(containerSelector, options);
        return fileList;
    }

    /**
     * Static helper to create and initialize file list
     */
    static async createAndInitialize(containerSelector, options = {}) {
        const fileList = new FileList(containerSelector, options);
        await fileList.initialize();
        return fileList;
    }
}