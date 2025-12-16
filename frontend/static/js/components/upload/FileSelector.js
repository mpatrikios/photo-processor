/**
 * FileSelector - Unified file selection component
 * Handles drag & drop, file inputs, and validation
 * Eliminates duplication between main upload and modal upload
 */

import { BaseComponent } from '../BaseComponent.js';

export class FileSelector extends BaseComponent {
    constructor(containerSelector, options = {}) {
        super(containerSelector, {
            name: 'FileSelector',
            multiple: true,
            accept: 'image/*',
            allowFolders: true,
            showDropZone: true,
            showFileInput: true,
            showFolderInput: true,
            maxFiles: 50,
            maxFileSize: 10 * 1024 * 1024, // 10MB
            ...options
        });

        // File selection state
        this.isDragOver = false;
        this.fileInput = null;
        this.folderInput = null;
        this.dropZone = null;

        // Event handlers (bound for cleanup)
        this.handleDragOver = this.handleDragOver.bind(this);
        this.handleDragLeave = this.handleDragLeave.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
        this.handleFileSelect = this.handleFileSelect.bind(this);
        this.handleFolderSelect = this.handleFolderSelect.bind(this);
    }

    async onRender() {
        if (!this.element) {
            throw new Error('Container element required for FileSelector');
        }

        // Create file selector UI
        this.createFileSelectorUI();

        this.log('File selector rendered');
    }

    /**
     * Create file selector UI elements
     * @private
     */
    createFileSelectorUI() {
        const html = `
            <div class="file-selector">
                ${this.options.showDropZone ? this.createDropZoneHTML() : ''}
                ${this.options.showFileInput || this.options.showFolderInput ? this.createButtonsHTML() : ''}
                ${this.createInputsHTML()}
            </div>
        `;

        this.setHTML(html);

        // Cache element references
        this.dropZone = this.$('.drop-zone');
        this.fileInput = this.$('#file-input');
        this.folderInput = this.$('#folder-input');
    }

    /**
     * Create drop zone HTML
     * @private
     */
    createDropZoneHTML() {
        return `
            <div class="drop-zone border-2 border-dashed border-secondary rounded p-4 text-center bg-light">
                <div class="drop-zone-content">
                    <i class="fas fa-cloud-upload-alt fa-3x text-muted mb-3"></i>
                    <h5 class="text-muted">Drag & Drop Photos Here</h5>
                    <p class="text-muted mb-0">
                        or use the buttons below to select files
                        <br><small>Supports JPG, PNG, WebP images • Max ${this.options.maxFiles} files • Max ${Math.round(this.options.maxFileSize / (1024*1024))}MB each</small>
                    </p>
                </div>
                <div class="drop-zone-overlay position-absolute w-100 h-100 d-none align-items-center justify-content-center bg-primary bg-opacity-10 border-primary">
                    <div class="text-center">
                        <i class="fas fa-download fa-2x text-primary mb-2"></i>
                        <h6 class="text-primary">Drop files here</h6>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Create buttons HTML
     * @private
     */
    createButtonsHTML() {
        let buttonsHTML = '';
        
        if (this.options.showFileInput || this.options.showFolderInput) {
            buttonsHTML = '<div class="file-selector-buttons mt-3 d-flex gap-2 justify-content-center flex-wrap">';
            
            if (this.options.showFileInput) {
                buttonsHTML += `
                    <button type="button" class="btn btn-outline-primary" id="choose-files-btn">
                        <i class="fas fa-images me-2"></i>Choose Files
                    </button>
                `;
            }
            
            if (this.options.showFolderInput && this.options.allowFolders) {
                buttonsHTML += `
                    <button type="button" class="btn btn-outline-secondary" id="choose-folder-btn">
                        <i class="fas fa-folder-open me-2"></i>Choose Folder
                    </button>
                `;
            }
            
            buttonsHTML += '</div>';
        }
        
        return buttonsHTML;
    }

    /**
     * Create hidden inputs HTML
     * @private
     */
    createInputsHTML() {
        return `
            <input type="file" 
                   id="file-input" 
                   class="d-none" 
                   ${this.options.multiple ? 'multiple' : ''} 
                   accept="${this.options.accept}">
            ${this.options.allowFolders ? `
                <input type="file" 
                       id="folder-input" 
                       class="d-none" 
                       webkitdirectory 
                       ${this.options.multiple ? 'multiple' : ''} 
                       accept="${this.options.accept}">
            ` : ''}
        `;
    }

    setupEventListeners() {
        // Drag and drop events
        if (this.dropZone) {
            this.addEventListener(this.dropZone, 'dragover', this.handleDragOver);
            this.addEventListener(this.dropZone, 'dragleave', this.handleDragLeave);
            this.addEventListener(this.dropZone, 'drop', this.handleDrop);
        }

        // Button click events
        const chooseFilesBtn = this.$('#choose-files-btn');
        if (chooseFilesBtn && this.fileInput) {
            this.addEventListener(chooseFilesBtn, 'click', () => this.fileInput.click());
        }

        const chooseFolderBtn = this.$('#choose-folder-btn');
        if (chooseFolderBtn && this.folderInput) {
            this.addEventListener(chooseFolderBtn, 'click', () => this.folderInput.click());
        }

        // File input events
        if (this.fileInput) {
            this.addEventListener(this.fileInput, 'change', this.handleFileSelect);
        }

        if (this.folderInput) {
            this.addEventListener(this.folderInput, 'change', this.handleFolderSelect);
        }
    }

    /**
     * Handle drag over event
     * @private
     */
    handleDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        
        if (!this.isDragOver) {
            this.isDragOver = true;
            this.updateDropZoneState(true);
        }
    }

    /**
     * Handle drag leave event
     * @private
     */
    handleDragLeave(event) {
        event.preventDefault();
        event.stopPropagation();
        
        // Only update if we're actually leaving the drop zone
        if (!this.dropZone?.contains(event.relatedTarget)) {
            this.isDragOver = false;
            this.updateDropZoneState(false);
        }
    }

    /**
     * Handle drop event
     * @private
     */
    async handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        
        this.isDragOver = false;
        this.updateDropZoneState(false);

        const files = Array.from(event.dataTransfer.files);
        await this.processFiles(files, false);
    }

    /**
     * Handle file input selection
     * @private
     */
    async handleFileSelect(event) {
        const files = Array.from(event.target.files);
        await this.processFiles(files, false);
        
        // Clear input for re-selection
        event.target.value = '';
    }

    /**
     * Handle folder input selection
     * @private
     */
    async handleFolderSelect(event) {
        const files = Array.from(event.target.files);
        await this.processFiles(files, true);
        
        // Clear input for re-selection
        event.target.value = '';
    }

    /**
     * Process selected files
     * @private
     */
    async processFiles(files, isFolder) {
        if (files.length === 0) {
            return;
        }

        this.log('Processing files', { count: files.length, isFolder });

        try {
            // Use UploadService if available
            const uploadService = this.getService('uploadService');
            if (uploadService) {
                const result = await uploadService.selectFiles(files, isFolder);
                
                this.emit('files:selected', {
                    files,
                    isFolder,
                    result
                });
                
                this.log('Files processed via UploadService', result);
            } else {
                // Fallback to basic validation and emit
                const validatedFiles = this.validateFiles(files);
                
                this.emit('files:selected', {
                    files: validatedFiles.valid,
                    isFolder,
                    result: validatedFiles
                });
                
                this.log('Files processed with basic validation', validatedFiles);
            }

        } catch (error) {
            this.error('File processing failed:', error);
            
            this.emit('files:error', {
                files,
                isFolder,
                error
            });
        }
    }

    /**
     * Basic file validation (fallback when no UploadService)
     * @private
     */
    validateFiles(files) {
        const valid = [];
        const invalid = [];
        const errors = [];

        if (files.length > this.options.maxFiles) {
            errors.push(`Too many files selected. Maximum ${this.options.maxFiles} files allowed.`);
            return { valid: [], invalid: files, errors };
        }

        for (const file of files) {
            const fileErrors = [];

            // Check file type
            if (!file.type.startsWith('image/')) {
                fileErrors.push(`Invalid file type: ${file.type}`);
            }

            // Check file size
            if (file.size > this.options.maxFileSize) {
                const maxSizeMB = Math.round(this.options.maxFileSize / (1024 * 1024));
                fileErrors.push(`File too large: ${file.name} (max ${maxSizeMB}MB)`);
            }

            if (fileErrors.length > 0) {
                invalid.push({ file, errors: fileErrors });
            } else {
                valid.push(file);
            }
        }

        return { valid, invalid, errors };
    }

    /**
     * Update drop zone visual state
     * @private
     */
    updateDropZoneState(isDragOver) {
        if (!this.dropZone) return;

        const overlay = this.dropZone.querySelector('.drop-zone-overlay');
        const content = this.dropZone.querySelector('.drop-zone-content');

        if (isDragOver) {
            overlay?.classList.remove('d-none');
            overlay?.classList.add('d-flex');
            content?.classList.add('opacity-50');
            this.dropZone.classList.add('border-primary', 'bg-primary', 'bg-opacity-10');
        } else {
            overlay?.classList.remove('d-flex');
            overlay?.classList.add('d-none');
            content?.classList.remove('opacity-50');
            this.dropZone.classList.remove('border-primary', 'bg-primary', 'bg-opacity-10');
        }
    }

    /**
     * Enable/disable file selector
     */
    setEnabled(enabled) {
        const buttons = this.$$('.btn');
        buttons.forEach(btn => {
            btn.disabled = !enabled;
        });

        if (this.dropZone) {
            if (enabled) {
                this.dropZone.classList.remove('opacity-50');
                this.dropZone.style.pointerEvents = '';
            } else {
                this.dropZone.classList.add('opacity-50');
                this.dropZone.style.pointerEvents = 'none';
            }
        }

        this.log(`File selector ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Set loading state
     */
    setLoading(loading, message = 'Processing files...') {
        if (loading) {
            this.setEnabled(false);
            
            // Show loading overlay
            if (this.dropZone) {
                const overlay = this.dropZone.querySelector('.drop-zone-overlay');
                if (overlay) {
                    overlay.innerHTML = `
                        <div class="text-center">
                            <div class="spinner-border text-primary mb-2" role="status">
                                <span class="visually-hidden">Loading...</span>
                            </div>
                            <div class="text-primary">${message}</div>
                        </div>
                    `;
                    overlay.classList.remove('d-none');
                    overlay.classList.add('d-flex');
                }
            }
        } else {
            this.setEnabled(true);
            
            // Hide loading overlay
            if (this.dropZone) {
                const overlay = this.dropZone.querySelector('.drop-zone-overlay');
                if (overlay) {
                    overlay.classList.remove('d-flex');
                    overlay.classList.add('d-none');
                }
            }
        }
    }

    /**
     * Get file selector configuration
     */
    getConfig() {
        return {
            multiple: this.options.multiple,
            accept: this.options.accept,
            allowFolders: this.options.allowFolders,
            maxFiles: this.options.maxFiles,
            maxFileSize: this.options.maxFileSize
        };
    }

    /**
     * Update configuration
     */
    updateConfig(newOptions) {
        this.options = { ...this.options, ...newOptions };
        
        // Re-render if significant changes
        if (newOptions.showDropZone !== undefined || 
            newOptions.showFileInput !== undefined || 
            newOptions.showFolderInput !== undefined) {
            this.render();
        }
    }

    /**
     * Static helper to create file selector
     */
    static create(containerSelector, options = {}) {
        const selector = new FileSelector(containerSelector, options);
        return selector;
    }

    /**
     * Static helper to create and initialize file selector
     */
    static async createAndInitialize(containerSelector, options = {}) {
        const selector = new FileSelector(containerSelector, options);
        await selector.initialize();
        return selector;
    }
}