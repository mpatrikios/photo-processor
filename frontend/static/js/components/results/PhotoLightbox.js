/**
 * PhotoLightbox - Full-screen photo viewing component
 * Provides navigation, zoom, editing, and metadata display
 * Eliminates duplication in photo viewing logic
 */

import { BaseComponent } from '../BaseComponent.js';
import { ModalComponent } from '../ModalComponent.js';
import { formatFileSize } from '../../utils/format.js';

export class PhotoLightbox extends ModalComponent {
    constructor(containerSelector, options = {}) {
        super(containerSelector, {
            name: 'PhotoLightbox',
            size: 'xl',
            backdrop: 'static',
            keyboard: true,
            showNavigation: true,
            showZoom: true,
            showMetadata: true,
            showEdit: true,
            showActions: true,
            enableKeyboardShortcuts: true,
            zoomLevels: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4],
            ...options
        });

        // Photo data and state
        this.photos = [];
        this.currentIndex = 0;
        this.currentPhoto = null;
        this.zoomLevel = 1;
        this.zoomPosition = { x: 0, y: 0 };
        this.isEditMode = false;
        this.isDragging = false;

        // UI elements
        this.photoContainer = null;
        this.photoImage = null;
        this.prevButton = null;
        this.nextButton = null;
        this.zoomInButton = null;
        this.zoomOutButton = null;
        this.resetZoomButton = null;
        this.editButton = null;
        this.metadataPanel = null;
        
        // Event handlers (bound for cleanup)
        this.handleKeydown = this.handleKeydown.bind(this);
        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseUp = this.handleMouseUp.bind(this);
        this.handleWheel = this.handleWheel.bind(this);
    }

    async onRender() {
        // Override ModalComponent's onRender to create custom lightbox
        if (!this.element) {
            throw new Error('Container element required for PhotoLightbox');
        }

        this.createLightboxModal();
        this.log('Photo lightbox rendered');
    }

    /**
     * Create lightbox modal structure
     * @private
     */
    createLightboxModal() {
        const html = `
            <div class="modal fade photo-lightbox-modal" tabindex="-1">
                <div class="modal-dialog modal-xl modal-fullscreen-lg-down">
                    <div class="modal-content bg-dark text-light">
                        <div class="modal-header border-secondary">
                            <div class="lightbox-title d-flex align-items-center">
                                <h5 class="modal-title mb-0">
                                    <span class="photo-title">Photo Viewer</span>
                                    <small class="photo-counter ms-2 text-muted">
                                        <!-- Photo counter will be updated here -->
                                    </small>
                                </h5>
                            </div>
                            
                            <div class="lightbox-actions">
                                <div class="btn-group btn-group-sm me-3">
                                    ${this.options.showZoom ? `
                                        <button type="button" class="btn btn-outline-light zoom-out-btn" title="Zoom Out">
                                            <i class="fas fa-search-minus"></i>
                                        </button>
                                        <button type="button" class="btn btn-outline-light reset-zoom-btn" title="Reset Zoom">
                                            <i class="fas fa-expand-arrows-alt"></i>
                                        </button>
                                        <button type="button" class="btn btn-outline-light zoom-in-btn" title="Zoom In">
                                            <i class="fas fa-search-plus"></i>
                                        </button>
                                    ` : ''}
                                </div>
                                
                                ${this.options.showActions ? `
                                    <div class="btn-group btn-group-sm me-3">
                                        ${this.options.showEdit ? `
                                            <button type="button" class="btn btn-outline-warning edit-photo-btn" title="Edit Photo">
                                                <i class="fas fa-edit"></i>
                                            </button>
                                        ` : ''}
                                        <button type="button" class="btn btn-outline-info download-photo-btn" title="Download">
                                            <i class="fas fa-download"></i>
                                        </button>
                                        <button type="button" class="btn btn-outline-danger delete-photo-btn" title="Delete">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </div>
                                ` : ''}
                                
                                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                            </div>
                        </div>
                        
                        <div class="modal-body p-0 position-relative">
                            <div class="lightbox-main d-flex h-100">
                                <div class="photo-display-area flex-grow-1 position-relative overflow-hidden">
                                    <div class="photo-container position-relative h-100 d-flex align-items-center justify-content-center">
                                        <img class="photo-image" 
                                             src="" 
                                             alt="Photo" 
                                             style="max-width: 100%; max-height: 100%; object-fit: contain; cursor: grab;">
                                        
                                        <div class="photo-loading position-absolute w-100 h-100 d-flex align-items-center justify-content-center d-none">
                                            <div class="spinner-border text-light" role="status">
                                                <span class="visually-hidden">Loading...</span>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    ${this.options.showNavigation ? `
                                        <button type="button" class="btn btn-dark btn-lg lightbox-nav lightbox-prev position-absolute top-50 start-0 translate-middle-y ms-2">
                                            <i class="fas fa-chevron-left"></i>
                                        </button>
                                        <button type="button" class="btn btn-dark btn-lg lightbox-nav lightbox-next position-absolute top-50 end-0 translate-middle-y me-2">
                                            <i class="fas fa-chevron-right"></i>
                                        </button>
                                    ` : ''}
                                </div>
                                
                                ${this.options.showMetadata ? `
                                    <div class="photo-metadata-panel bg-darker border-start border-secondary" style="width: 300px; min-height: 100%;">
                                        <div class="p-3">
                                            <div class="metadata-content">
                                                <!-- Metadata will be populated here -->
                                            </div>
                                        </div>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                        
                        <div class="modal-footer border-secondary">
                            <div class="lightbox-status d-flex align-items-center flex-grow-1">
                                <span class="zoom-level text-muted me-3">
                                    Zoom: <span class="zoom-percentage">100%</span>
                                </span>
                                <span class="photo-dimensions text-muted">
                                    <!-- Photo dimensions will be shown here -->
                                </span>
                            </div>
                            
                            <div class="lightbox-controls">
                                <button type="button" class="btn btn-outline-light btn-sm toggle-metadata-btn">
                                    <i class="fas fa-info-circle me-1"></i>
                                    <span class="toggle-text">Hide Info</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.setHTML(html);
        this.initializeModal();
        this.cacheElements();
    }

    /**
     * Cache DOM elements
     * @private
     */
    cacheElements() {
        this.photoContainer = this.$('.photo-container');
        this.photoImage = this.$('.photo-image');
        this.prevButton = this.$('.lightbox-prev');
        this.nextButton = this.$('.lightbox-next');
        this.zoomInButton = this.$('.zoom-in-btn');
        this.zoomOutButton = this.$('.zoom-out-btn');
        this.resetZoomButton = this.$('.reset-zoom-btn');
        this.editButton = this.$('.edit-photo-btn');
        this.metadataPanel = this.$('.photo-metadata-panel');
        this.photoLoading = this.$('.photo-loading');
    }

    setupEventListeners() {
        super.setupEventListeners();

        // Navigation buttons
        if (this.prevButton) {
            this.addEventListener(this.prevButton, 'click', () => this.previousPhoto());
        }
        if (this.nextButton) {
            this.addEventListener(this.nextButton, 'click', () => this.nextPhoto());
        }

        // Zoom controls
        if (this.zoomInButton) {
            this.addEventListener(this.zoomInButton, 'click', () => this.zoomIn());
        }
        if (this.zoomOutButton) {
            this.addEventListener(this.zoomOutButton, 'click', () => this.zoomOut());
        }
        if (this.resetZoomButton) {
            this.addEventListener(this.resetZoomButton, 'click', () => this.resetZoom());
        }

        // Action buttons
        if (this.editButton) {
            this.addEventListener(this.editButton, 'click', () => this.toggleEditMode());
        }

        const downloadBtn = this.$('.download-photo-btn');
        if (downloadBtn) {
            this.addEventListener(downloadBtn, 'click', () => this.downloadPhoto());
        }

        const deleteBtn = this.$('.delete-photo-btn');
        if (deleteBtn) {
            this.addEventListener(deleteBtn, 'click', () => this.deletePhoto());
        }

        // Metadata toggle
        const metadataToggle = this.$('.toggle-metadata-btn');
        if (metadataToggle) {
            this.addEventListener(metadataToggle, 'click', () => this.toggleMetadata());
        }

        // Photo interaction events
        if (this.photoImage) {
            this.addEventListener(this.photoImage, 'mousedown', this.handleMouseDown);
            this.addEventListener(this.photoImage, 'wheel', this.handleWheel, { passive: false });
            this.addEventListener(this.photoImage, 'load', this.handleImageLoad.bind(this));
        }

        // Keyboard shortcuts
        if (this.options.enableKeyboardShortcuts) {
            this.addEventListener(document, 'keydown', this.handleKeydown);
        }

        // Mouse events for dragging
        this.addEventListener(document, 'mousemove', this.handleMouseMove);
        this.addEventListener(document, 'mouseup', this.handleMouseUp);
    }

    /**
     * Handle keyboard shortcuts
     * @private
     */
    handleKeydown(event) {
        if (!this.isVisible) return;

        switch (event.key) {
            case 'ArrowLeft':
                event.preventDefault();
                this.previousPhoto();
                break;
            case 'ArrowRight':
                event.preventDefault();
                this.nextPhoto();
                break;
            case '=':
            case '+':
                event.preventDefault();
                this.zoomIn();
                break;
            case '-':
                event.preventDefault();
                this.zoomOut();
                break;
            case '0':
                event.preventDefault();
                this.resetZoom();
                break;
            case 'i':
                event.preventDefault();
                this.toggleMetadata();
                break;
            case 'e':
                if (this.options.showEdit) {
                    event.preventDefault();
                    this.toggleEditMode();
                }
                break;
        }
    }

    /**
     * Handle mouse down for dragging
     * @private
     */
    handleMouseDown(event) {
        if (this.zoomLevel <= 1) return;

        this.isDragging = true;
        this.dragStart = {
            x: event.clientX - this.zoomPosition.x,
            y: event.clientY - this.zoomPosition.y
        };

        this.photoImage.style.cursor = 'grabbing';
        event.preventDefault();
    }

    /**
     * Handle mouse move for dragging
     * @private
     */
    handleMouseMove(event) {
        if (!this.isDragging) return;

        this.zoomPosition = {
            x: event.clientX - this.dragStart.x,
            y: event.clientY - this.dragStart.y
        };

        this.updateImageTransform();
    }

    /**
     * Handle mouse up to stop dragging
     * @private
     */
    handleMouseUp() {
        if (this.isDragging) {
            this.isDragging = false;
            this.photoImage.style.cursor = this.zoomLevel > 1 ? 'grab' : '';
        }
    }

    /**
     * Handle mouse wheel for zooming
     * @private
     */
    handleWheel(event) {
        event.preventDefault();
        
        if (event.deltaY < 0) {
            this.zoomIn();
        } else {
            this.zoomOut();
        }
    }

    /**
     * Handle image load
     * @private
     */
    handleImageLoad() {
        this.hideLoading();
        this.updatePhotoDimensions();
        this.resetZoom();
    }

    /**
     * Open lightbox with photos
     */
    async open(photos, initialIndex = 0) {
        this.photos = Array.isArray(photos) ? photos : [photos];
        this.currentIndex = Math.max(0, Math.min(initialIndex, this.photos.length - 1));
        
        this.show();
        this.loadCurrentPhoto();
        this.updateUI();

        this.emit('lightbox:opened', {
            photoCount: this.photos.length,
            initialIndex: this.currentIndex
        });
    }

    /**
     * Load current photo
     * @private
     */
    loadCurrentPhoto() {
        if (!this.photos.length || !this.photoImage) return;

        this.currentPhoto = this.photos[this.currentIndex];
        
        this.showLoading();
        
        // Load high-resolution image
        const imageUrl = this.currentPhoto.url || this.currentPhoto.full_url || this.currentPhoto.thumbnail;
        this.photoImage.src = imageUrl;
        
        this.log('Loading photo', { 
            index: this.currentIndex, 
            id: this.currentPhoto.id 
        });
    }

    /**
     * Update UI elements
     * @private
     */
    updateUI() {
        this.updateCounter();
        this.updateNavigation();
        this.updateMetadata();
        this.updateZoomDisplay();
        this.updateTitle();
    }

    /**
     * Update photo counter
     * @private
     */
    updateCounter() {
        const counterElement = this.$('.photo-counter');
        if (counterElement) {
            counterElement.textContent = `${this.currentIndex + 1} of ${this.photos.length}`;
        }
    }

    /**
     * Update navigation buttons
     * @private
     */
    updateNavigation() {
        if (this.prevButton) {
            this.prevButton.disabled = this.currentIndex === 0;
        }
        if (this.nextButton) {
            this.nextButton.disabled = this.currentIndex === this.photos.length - 1;
        }
    }

    /**
     * Update metadata panel
     * @private
     */
    updateMetadata() {
        const metadataContent = this.$('.metadata-content');
        if (!metadataContent || !this.currentPhoto) return;

        const photo = this.currentPhoto;
        const html = `
            <div class="photo-metadata">
                <h6 class="text-primary mb-3">Photo Information</h6>
                
                <div class="metadata-section mb-3">
                    <label class="form-label small text-muted">Filename</label>
                    <div class="metadata-value small">${this.escapeHtml(photo.filename || 'Unknown')}</div>
                </div>
                
                ${photo.bib_number ? `
                    <div class="metadata-section mb-3">
                        <label class="form-label small text-muted">Bib Number</label>
                        <div class="metadata-value">
                            <span class="badge bg-primary">#${photo.bib_number}</span>
                        </div>
                    </div>
                ` : ''}
                
                ${photo.custom_label ? `
                    <div class="metadata-section mb-3">
                        <label class="form-label small text-muted">Custom Label</label>
                        <div class="metadata-value small">${this.escapeHtml(photo.custom_label)}</div>
                    </div>
                ` : ''}
                
                ${photo.file_size ? `
                    <div class="metadata-section mb-3">
                        <label class="form-label small text-muted">File Size</label>
                        <div class="metadata-value small">${formatFileSize(photo.file_size)}</div>
                    </div>
                ` : ''}
                
                ${photo.detected_confidence ? `
                    <div class="metadata-section mb-3">
                        <label class="form-label small text-muted">Detection Confidence</label>
                        <div class="metadata-value small">
                            ${Math.round(photo.detected_confidence * 100)}%
                            <div class="progress mt-1" style="height: 4px;">
                                <div class="progress-bar" style="width: ${photo.detected_confidence * 100}%"></div>
                            </div>
                        </div>
                    </div>
                ` : ''}
                
                ${photo.upload_date ? `
                    <div class="metadata-section mb-3">
                        <label class="form-label small text-muted">Upload Date</label>
                        <div class="metadata-value small">${new Date(photo.upload_date).toLocaleDateString()}</div>
                    </div>
                ` : ''}
                
                ${this.isEditMode ? this.createEditForm(photo) : ''}
            </div>
        `;

        metadataContent.innerHTML = html;
        
        if (this.isEditMode) {
            this.setupEditForm();
        }
    }

    /**
     * Create edit form HTML
     * @private
     */
    createEditForm(photo) {
        return `
            <div class="metadata-section mt-4">
                <h6 class="text-warning mb-3">Edit Photo</h6>
                
                <div class="mb-3">
                    <label class="form-label small">Bib Number</label>
                    <input type="text" 
                           class="form-control form-control-sm edit-bib-number" 
                           value="${photo.bib_number || ''}" 
                           placeholder="Enter bib number">
                </div>
                
                <div class="mb-3">
                    <label class="form-label small">Custom Label</label>
                    <input type="text" 
                           class="form-control form-control-sm edit-custom-label" 
                           value="${photo.custom_label || ''}" 
                           placeholder="Enter custom label">
                </div>
                
                <div class="d-flex gap-2">
                    <button type="button" class="btn btn-success btn-sm save-changes-btn">
                        <i class="fas fa-save me-1"></i>Save
                    </button>
                    <button type="button" class="btn btn-outline-secondary btn-sm cancel-edit-btn">
                        <i class="fas fa-times me-1"></i>Cancel
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Setup edit form events
     * @private
     */
    setupEditForm() {
        const saveBtn = this.$('.save-changes-btn');
        const cancelBtn = this.$('.cancel-edit-btn');

        if (saveBtn) {
            this.addEventListener(saveBtn, 'click', () => this.savePhotoChanges());
        }

        if (cancelBtn) {
            this.addEventListener(cancelBtn, 'click', () => this.toggleEditMode());
        }
    }

    /**
     * Update title
     * @private
     */
    updateTitle() {
        const titleElement = this.$('.photo-title');
        if (titleElement && this.currentPhoto) {
            const filename = this.currentPhoto.filename || `Photo ${this.currentPhoto.id}`;
            titleElement.textContent = filename;
        }
    }

    /**
     * Navigate to previous photo
     */
    previousPhoto() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.loadCurrentPhoto();
            this.updateUI();
            
            this.emit('lightbox:photo:changed', {
                index: this.currentIndex,
                photo: this.currentPhoto,
                direction: 'previous'
            });
        }
    }

    /**
     * Navigate to next photo
     */
    nextPhoto() {
        if (this.currentIndex < this.photos.length - 1) {
            this.currentIndex++;
            this.loadCurrentPhoto();
            this.updateUI();
            
            this.emit('lightbox:photo:changed', {
                index: this.currentIndex,
                photo: this.currentPhoto,
                direction: 'next'
            });
        }
    }

    /**
     * Zoom in
     */
    zoomIn() {
        const currentIndex = this.options.zoomLevels.indexOf(this.zoomLevel);
        if (currentIndex < this.options.zoomLevels.length - 1) {
            this.zoomLevel = this.options.zoomLevels[currentIndex + 1];
            this.updateImageTransform();
            this.updateZoomDisplay();
        }
    }

    /**
     * Zoom out
     */
    zoomOut() {
        const currentIndex = this.options.zoomLevels.indexOf(this.zoomLevel);
        if (currentIndex > 0) {
            this.zoomLevel = this.options.zoomLevels[currentIndex - 1];
            this.updateImageTransform();
            this.updateZoomDisplay();
        }
    }

    /**
     * Reset zoom to 100%
     */
    resetZoom() {
        this.zoomLevel = 1;
        this.zoomPosition = { x: 0, y: 0 };
        this.updateImageTransform();
        this.updateZoomDisplay();
    }

    /**
     * Update image transform
     * @private
     */
    updateImageTransform() {
        if (!this.photoImage) return;

        this.photoImage.style.transform = `scale(${this.zoomLevel}) translate(${this.zoomPosition.x}px, ${this.zoomPosition.y}px)`;
        this.photoImage.style.cursor = this.zoomLevel > 1 ? 'grab' : '';
    }

    /**
     * Update zoom display
     * @private
     */
    updateZoomDisplay() {
        const zoomElement = this.$('.zoom-percentage');
        if (zoomElement) {
            zoomElement.textContent = `${Math.round(this.zoomLevel * 100)}%`;
        }
    }

    /**
     * Update photo dimensions display
     * @private
     */
    updatePhotoDimensions() {
        const dimensionsElement = this.$('.photo-dimensions');
        if (dimensionsElement && this.photoImage) {
            const naturalWidth = this.photoImage.naturalWidth;
            const naturalHeight = this.photoImage.naturalHeight;
            dimensionsElement.textContent = `${naturalWidth} × ${naturalHeight}`;
        }
    }

    /**
     * Toggle edit mode
     */
    toggleEditMode() {
        this.isEditMode = !this.isEditMode;
        this.updateMetadata();
        
        if (this.editButton) {
            if (this.isEditMode) {
                this.editButton.classList.remove('btn-outline-warning');
                this.editButton.classList.add('btn-warning');
            } else {
                this.editButton.classList.remove('btn-warning');
                this.editButton.classList.add('btn-outline-warning');
            }
        }

        this.emit('lightbox:edit:toggled', { editMode: this.isEditMode });
    }

    /**
     * Save photo changes
     * @private
     */
    savePhotoChanges() {
        const bibNumberInput = this.$('.edit-bib-number');
        const customLabelInput = this.$('.edit-custom-label');

        if (!bibNumberInput || !customLabelInput || !this.currentPhoto) return;

        const updates = {
            bib_number: bibNumberInput.value.trim() || null,
            custom_label: customLabelInput.value.trim() || null
        };

        // Update current photo
        Object.assign(this.currentPhoto, updates);

        this.emit('lightbox:photo:updated', {
            photoId: this.currentPhoto.id,
            updates,
            photo: this.currentPhoto
        });

        // Exit edit mode and refresh metadata
        this.isEditMode = false;
        this.updateMetadata();

        this.log('Photo updated', { photoId: this.currentPhoto.id, updates });
    }

    /**
     * Download current photo
     */
    downloadPhoto() {
        if (!this.currentPhoto) return;

        const link = document.createElement('a');
        link.href = this.currentPhoto.url || this.currentPhoto.full_url;
        link.download = this.currentPhoto.filename || `photo_${this.currentPhoto.id}`;
        link.click();

        this.emit('lightbox:photo:downloaded', {
            photoId: this.currentPhoto.id,
            photo: this.currentPhoto
        });
    }

    /**
     * Delete current photo
     */
    deletePhoto() {
        if (!this.currentPhoto) return;

        this.emit('lightbox:photo:delete', {
            photoId: this.currentPhoto.id,
            photo: this.currentPhoto,
            index: this.currentIndex
        });
    }

    /**
     * Toggle metadata panel visibility
     */
    toggleMetadata() {
        if (!this.metadataPanel) return;

        const isVisible = !this.metadataPanel.classList.contains('d-none');
        const toggleBtn = this.$('.toggle-metadata-btn');
        const toggleText = this.$('.toggle-text');

        if (isVisible) {
            this.metadataPanel.classList.add('d-none');
            if (toggleText) toggleText.textContent = 'Show Info';
        } else {
            this.metadataPanel.classList.remove('d-none');
            if (toggleText) toggleText.textContent = 'Hide Info';
        }

        this.emit('lightbox:metadata:toggled', { visible: !isVisible });
    }

    /**
     * Show loading state
     * @private
     */
    showLoading() {
        this.photoLoading?.classList.remove('d-none');
    }

    /**
     * Hide loading state
     * @private
     */
    hideLoading() {
        this.photoLoading?.classList.add('d-none');
    }

    /**
     * Escape HTML for safe display
     * @private
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Get current photo
     */
    getCurrentPhoto() {
        return this.currentPhoto;
    }

    /**
     * Get current index
     */
    getCurrentIndex() {
        return this.currentIndex;
    }

    /**
     * Jump to specific photo by index
     */
    goToPhoto(index) {
        if (index >= 0 && index < this.photos.length) {
            this.currentIndex = index;
            this.loadCurrentPhoto();
            this.updateUI();
            
            this.emit('lightbox:photo:changed', {
                index: this.currentIndex,
                photo: this.currentPhoto,
                direction: 'jump'
            });
        }
    }

    /**
     * Static helper to create photo lightbox
     */
    static create(containerSelector, options = {}) {
        const lightbox = new PhotoLightbox(containerSelector, options);
        return lightbox;
    }

    /**
     * Static helper to create and initialize photo lightbox
     */
    static async createAndInitialize(containerSelector, options = {}) {
        const lightbox = new PhotoLightbox(containerSelector, options);
        await lightbox.initialize();
        return lightbox;
    }
}