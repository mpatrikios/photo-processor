/**
 * PhotoGrid - Reusable photo display grid component
 * Handles photo layout, selection, filtering, and interactions
 * Eliminates duplication between detected/unknown photo displays
 */

import { BaseComponent } from '../BaseComponent.js';
import { formatFileSize } from '../../utils/format.js';

export class PhotoGrid extends BaseComponent {
    constructor(containerSelector, options = {}) {
        super(containerSelector, {
            name: 'PhotoGrid',
            showSelection: false,
            showLabels: true,
            showBibNumbers: true,
            showFileInfo: false,
            allowEdit: false,
            allowDelete: false,
            gridColumns: 4,
            photoSize: 'medium', // small, medium, large
            selectionMode: 'none', // none, single, multiple
            ...options
        });

        // Photo data and state
        this.photos = [];
        this.selectedPhotos = new Set();
        this.filteredPhotos = [];
        this.currentFilter = null;

        // UI elements
        this.gridContainer = null;
        this.emptyState = null;
    }

    async onRender() {
        if (!this.element) {
            throw new Error('Container element required for PhotoGrid');
        }

        this.createGridUI();
        this.updateDisplay();
        this.log('Photo grid rendered');
    }

    /**
     * Create photo grid UI
     * @private
     */
    createGridUI() {
        const html = `
            <div class="photo-grid">
                <div class="photo-grid-container">
                    <!-- Photos will be rendered here -->
                </div>
                <div class="photo-grid-empty d-none">
                    <div class="text-center py-4">
                        <i class="fas fa-images fa-3x text-muted mb-3"></i>
                        <h5 class="text-muted">No photos to display</h5>
                        <p class="text-muted mb-0">Photos will appear here once loaded</p>
                    </div>
                </div>
            </div>
        `;

        this.setHTML(html);

        // Cache element references
        this.gridContainer = this.$('.photo-grid-container');
        this.emptyState = this.$('.photo-grid-empty');
    }

    setupEventListeners() {
        // Listen for photo-related events
        this.on('photos:updated', this.handlePhotosUpdated);
        this.on('photos:filtered', this.handlePhotosFiltered);
        this.on('photo:label:updated', this.handlePhotoLabelUpdated);
        
        // Selection events
        if (this.options.selectionMode !== 'none') {
            this.on('photo:selected', this.handlePhotoSelected);
            this.on('photo:deselected', this.handlePhotoDeselected);
        }
    }

    /**
     * Handle photos updated event
     * @private
     */
    handlePhotosUpdated = (data) => {
        this.setPhotos(data.photos || []);
    };

    /**
     * Handle photos filtered event
     * @private
     */
    handlePhotosFiltered = (data) => {
        this.applyFilter(data.filter, data.filteredPhotos);
    };

    /**
     * Handle photo label updated event
     * @private
     */
    handlePhotoLabelUpdated = (data) => {
        this.updatePhotoLabel(data.photoId, data.label);
    };

    /**
     * Handle photo selected event
     * @private
     */
    handlePhotoSelected = (data) => {
        this.selectPhoto(data.photoId, false); // Don't emit to avoid loops
    };

    /**
     * Handle photo deselected event
     * @private
     */
    handlePhotoDeselected = (data) => {
        this.deselectPhoto(data.photoId, false); // Don't emit to avoid loops
    };

    /**
     * Set photos to display
     */
    setPhotos(photos) {
        this.photos = Array.isArray(photos) ? photos : [];
        this.filteredPhotos = [...this.photos];
        this.selectedPhotos.clear();
        this.updateDisplay();

        this.emit('photogrid:photos:updated', {
            total: this.photos.length,
            displayed: this.filteredPhotos.length
        });

        this.log('Photos updated', { total: this.photos.length });
    }

    /**
     * Add photos to existing collection
     */
    addPhotos(newPhotos) {
        const photosArray = Array.isArray(newPhotos) ? newPhotos : [newPhotos];
        this.photos.push(...photosArray);
        
        // Apply current filter to new photos
        if (this.currentFilter) {
            const newFiltered = photosArray.filter(this.currentFilter);
            this.filteredPhotos.push(...newFiltered);
        } else {
            this.filteredPhotos.push(...photosArray);
        }

        this.updateDisplay();
        this.emit('photogrid:photos:added', { added: photosArray.length });
    }

    /**
     * Remove photos by IDs
     */
    removePhotos(photoIds) {
        const idsToRemove = new Set(Array.isArray(photoIds) ? photoIds : [photoIds]);
        
        this.photos = this.photos.filter(photo => !idsToRemove.has(photo.id));
        this.filteredPhotos = this.filteredPhotos.filter(photo => !idsToRemove.has(photo.id));
        
        // Remove from selection
        idsToRemove.forEach(id => this.selectedPhotos.delete(id));
        
        this.updateDisplay();
        this.emit('photogrid:photos:removed', { removed: idsToRemove.size });
    }

    /**
     * Apply filter to photos
     */
    applyFilter(filterFn, preFilteredPhotos = null) {
        if (preFilteredPhotos) {
            this.filteredPhotos = preFilteredPhotos;
        } else if (filterFn && typeof filterFn === 'function') {
            this.filteredPhotos = this.photos.filter(filterFn);
        } else {
            this.filteredPhotos = [...this.photos];
        }
        
        this.currentFilter = filterFn;
        this.updateDisplay();

        this.emit('photogrid:filtered', {
            total: this.photos.length,
            displayed: this.filteredPhotos.length
        });
    }

    /**
     * Clear filter and show all photos
     */
    clearFilter() {
        this.applyFilter(null);
    }

    /**
     * Update display based on current state
     * @private
     */
    updateDisplay() {
        if (!this.gridContainer) return;

        if (this.filteredPhotos.length === 0) {
            this.showEmptyState();
        } else {
            this.showPhotoGrid();
        }
    }

    /**
     * Show empty state
     * @private
     */
    showEmptyState() {
        this.gridContainer.innerHTML = '';
        this.emptyState?.classList.remove('d-none');
    }

    /**
     * Show photo grid
     * @private
     */
    showPhotoGrid() {
        this.emptyState?.classList.add('d-none');
        
        const gridClass = this.getGridClass();
        const photoHTML = this.filteredPhotos.map(photo => this.createPhotoHTML(photo)).join('');
        
        this.gridContainer.innerHTML = `
            <div class="row ${gridClass}">
                ${photoHTML}
            </div>
        `;

        this.setupPhotoEvents();
    }

    /**
     * Get CSS grid class based on options
     * @private
     */
    getGridClass() {
        const colSize = Math.floor(12 / this.options.gridColumns);
        return `row-cols-1 row-cols-sm-2 row-cols-md-${Math.min(3, this.options.gridColumns)} row-cols-lg-${this.options.gridColumns}`;
    }

    /**
     * Create HTML for individual photo
     * @private
     */
    createPhotoHTML(photo) {
        const isSelected = this.selectedPhotos.has(photo.id);
        const sizeClass = this.getPhotoSizeClass();
        
        return `
            <div class="col mb-4">
                <div class="photo-card card h-100 ${isSelected ? 'border-primary' : ''}" data-photo-id="${photo.id}">
                    ${this.options.showSelection ? this.createSelectionHTML(photo, isSelected) : ''}
                    
                    <div class="photo-container ${sizeClass} position-relative">
                        <img src="${this.escapeHtml(photo.thumbnail || photo.url)}" 
                             alt="Photo ${photo.id}" 
                             class="card-img-top photo-image"
                             loading="lazy"
                             style="object-fit: cover; width: 100%; height: 100%; cursor: pointer;">
                        
                        ${this.createPhotoOverlayHTML(photo)}
                    </div>
                    
                    ${this.createPhotoInfoHTML(photo)}
                </div>
            </div>
        `;
    }

    /**
     * Create selection checkbox HTML
     * @private
     */
    createSelectionHTML(photo, isSelected) {
        if (this.options.selectionMode === 'none') return '';

        return `
            <div class="photo-selection position-absolute top-0 start-0 p-2" style="z-index: 10;">
                <div class="form-check">
                    <input class="form-check-input photo-select-cb" 
                           type="${this.options.selectionMode === 'single' ? 'radio' : 'checkbox'}" 
                           ${isSelected ? 'checked' : ''}
                           data-photo-id="${photo.id}">
                </div>
            </div>
        `;
    }

    /**
     * Create photo overlay HTML (labels, bib numbers, actions)
     * @private
     */
    createPhotoOverlayHTML(photo) {
        let overlayHTML = '';

        // Bib number overlay
        if (this.options.showBibNumbers && photo.bib_number) {
            overlayHTML += `
                <div class="photo-bib-number position-absolute top-0 end-0 m-2">
                    <span class="badge bg-primary">#${photo.bib_number}</span>
                </div>
            `;
        }

        // Custom label overlay
        if (this.options.showLabels && photo.custom_label) {
            overlayHTML += `
                <div class="photo-label position-absolute bottom-0 start-0 m-2">
                    <span class="badge bg-secondary">${this.escapeHtml(photo.custom_label)}</span>
                </div>
            `;
        }

        // Action buttons overlay
        if (this.options.allowEdit || this.options.allowDelete) {
            overlayHTML += `
                <div class="photo-actions position-absolute bottom-0 end-0 m-2">
                    <div class="btn-group-vertical btn-group-sm">
                        ${this.options.allowEdit ? `
                            <button type="button" 
                                    class="btn btn-outline-light btn-sm photo-edit-btn" 
                                    data-photo-id="${photo.id}"
                                    title="Edit photo">
                                <i class="fas fa-edit"></i>
                            </button>
                        ` : ''}
                        ${this.options.allowDelete ? `
                            <button type="button" 
                                    class="btn btn-outline-danger btn-sm photo-delete-btn" 
                                    data-photo-id="${photo.id}"
                                    title="Delete photo">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }

        return overlayHTML;
    }

    /**
     * Create photo info HTML (file details, etc.)
     * @private
     */
    createPhotoInfoHTML(photo) {
        if (!this.options.showFileInfo) return '';

        return `
            <div class="card-body p-2">
                <div class="photo-info small text-muted">
                    <div class="photo-filename" title="${this.escapeHtml(photo.filename)}">
                        <i class="fas fa-file-image me-1"></i>
                        ${this.truncateFilename(photo.filename, 20)}
                    </div>
                    ${photo.file_size ? `
                        <div class="photo-size">
                            <i class="fas fa-weight me-1"></i>
                            ${formatFileSize(photo.file_size)}
                        </div>
                    ` : ''}
                    ${photo.detected_confidence ? `
                        <div class="detection-confidence">
                            <i class="fas fa-eye me-1"></i>
                            ${Math.round(photo.detected_confidence * 100)}% confidence
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Get photo size CSS class
     * @private
     */
    getPhotoSizeClass() {
        switch (this.options.photoSize) {
            case 'small': return 'photo-size-sm';
            case 'large': return 'photo-size-lg';
            default: return 'photo-size-md';
        }
    }

    /**
     * Setup photo event listeners
     * @private
     */
    setupPhotoEvents() {
        // Photo click events
        const photoImages = this.$$('.photo-image');
        photoImages.forEach(img => {
            this.addEventListener(img, 'click', (event) => {
                const photoId = img.closest('.photo-card').dataset.photoId;
                this.handlePhotoClick(photoId, event);
            });
        });

        // Selection events
        if (this.options.selectionMode !== 'none') {
            const selectInputs = this.$$('.photo-select-cb');
            selectInputs.forEach(input => {
                this.addEventListener(input, 'change', (event) => {
                    const photoId = input.dataset.photoId;
                    if (event.target.checked) {
                        this.selectPhoto(photoId);
                    } else {
                        this.deselectPhoto(photoId);
                    }
                });
            });
        }

        // Action buttons
        if (this.options.allowEdit) {
            const editButtons = this.$$('.photo-edit-btn');
            editButtons.forEach(btn => {
                this.addEventListener(btn, 'click', (event) => {
                    event.stopPropagation();
                    const photoId = btn.dataset.photoId;
                    this.handlePhotoEdit(photoId);
                });
            });
        }

        if (this.options.allowDelete) {
            const deleteButtons = this.$$('.photo-delete-btn');
            deleteButtons.forEach(btn => {
                this.addEventListener(btn, 'click', (event) => {
                    event.stopPropagation();
                    const photoId = btn.dataset.photoId;
                    this.handlePhotoDelete(photoId);
                });
            });
        }
    }

    /**
     * Handle photo click
     * @private
     */
    handlePhotoClick(photoId, event) {
        const photo = this.findPhoto(photoId);
        if (!photo) return;

        this.emit('photogrid:photo:clicked', {
            photo,
            photoId,
            event
        });

        this.log('Photo clicked', { photoId });
    }

    /**
     * Handle photo edit
     * @private
     */
    handlePhotoEdit(photoId) {
        const photo = this.findPhoto(photoId);
        if (!photo) return;

        this.emit('photogrid:photo:edit', {
            photo,
            photoId
        });

        this.log('Photo edit requested', { photoId });
    }

    /**
     * Handle photo delete
     * @private
     */
    handlePhotoDelete(photoId) {
        const photo = this.findPhoto(photoId);
        if (!photo) return;

        this.emit('photogrid:photo:delete', {
            photo,
            photoId
        });

        this.log('Photo delete requested', { photoId });
    }

    /**
     * Select photo
     */
    selectPhoto(photoId, emit = true) {
        if (this.options.selectionMode === 'none') return;

        if (this.options.selectionMode === 'single') {
            this.selectedPhotos.clear();
        }

        this.selectedPhotos.add(photoId);
        this.updatePhotoSelection(photoId, true);

        if (emit) {
            this.emit('photogrid:selection:changed', {
                photoId,
                selected: true,
                selectedPhotos: Array.from(this.selectedPhotos)
            });
        }
    }

    /**
     * Deselect photo
     */
    deselectPhoto(photoId, emit = true) {
        this.selectedPhotos.delete(photoId);
        this.updatePhotoSelection(photoId, false);

        if (emit) {
            this.emit('photogrid:selection:changed', {
                photoId,
                selected: false,
                selectedPhotos: Array.from(this.selectedPhotos)
            });
        }
    }

    /**
     * Clear all selections
     */
    clearSelection() {
        this.selectedPhotos.clear();
        this.updateAllPhotoSelections(false);

        this.emit('photogrid:selection:cleared');
    }

    /**
     * Update photo selection UI
     * @private
     */
    updatePhotoSelection(photoId, selected) {
        const photoCard = this.$(`[data-photo-id="${photoId}"]`);
        const checkbox = photoCard?.querySelector('.photo-select-cb');

        if (photoCard) {
            if (selected) {
                photoCard.classList.add('border-primary');
            } else {
                photoCard.classList.remove('border-primary');
            }
        }

        if (checkbox) {
            checkbox.checked = selected;
        }
    }

    /**
     * Update all photo selections UI
     * @private
     */
    updateAllPhotoSelections(selected) {
        const photoCards = this.$$('.photo-card');
        const checkboxes = this.$$('.photo-select-cb');

        photoCards.forEach(card => {
            if (selected) {
                card.classList.add('border-primary');
            } else {
                card.classList.remove('border-primary');
            }
        });

        checkboxes.forEach(cb => {
            cb.checked = selected;
        });
    }

    /**
     * Update photo label
     */
    updatePhotoLabel(photoId, newLabel) {
        const photo = this.findPhoto(photoId);
        if (!photo) return;

        photo.custom_label = newLabel;

        // Update UI if photo is currently displayed
        const photoCard = this.$(`[data-photo-id="${photoId}"]`);
        if (photoCard) {
            const labelElement = photoCard.querySelector('.photo-label .badge');
            if (labelElement && newLabel) {
                labelElement.textContent = newLabel;
                labelElement.parentElement.style.display = 'block';
            } else if (labelElement) {
                labelElement.parentElement.style.display = 'none';
            }
        }

        this.emit('photogrid:photo:label:updated', { photoId, label: newLabel });
    }

    /**
     * Find photo by ID
     * @private
     */
    findPhoto(photoId) {
        return this.photos.find(photo => photo.id === photoId);
    }

    /**
     * Truncate filename for display
     * @private
     */
    truncateFilename(filename, maxLength) {
        if (!filename || filename.length <= maxLength) return filename;
        const ext = filename.split('.').pop();
        const name = filename.substring(0, filename.lastIndexOf('.'));
        const truncated = name.substring(0, maxLength - ext.length - 3) + '...';
        return `${truncated}.${ext}`;
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
     * Get selected photos
     */
    getSelectedPhotos() {
        return this.photos.filter(photo => this.selectedPhotos.has(photo.id));
    }

    /**
     * Get grid statistics
     */
    getStats() {
        return {
            totalPhotos: this.photos.length,
            displayedPhotos: this.filteredPhotos.length,
            selectedPhotos: this.selectedPhotos.size,
            hasFilter: !!this.currentFilter,
            gridColumns: this.options.gridColumns,
            photoSize: this.options.photoSize
        };
    }

    /**
     * Update grid options
     */
    updateOptions(newOptions) {
        const oldOptions = { ...this.options };
        this.options = { ...this.options, ...newOptions };

        // Re-render if layout options changed
        if (oldOptions.gridColumns !== this.options.gridColumns ||
            oldOptions.photoSize !== this.options.photoSize ||
            oldOptions.showSelection !== this.options.showSelection) {
            this.updateDisplay();
        }
    }

    /**
     * Static helper to create photo grid
     */
    static create(containerSelector, options = {}) {
        const grid = new PhotoGrid(containerSelector, options);
        return grid;
    }

    /**
     * Static helper to create and initialize photo grid
     */
    static async createAndInitialize(containerSelector, options = {}) {
        const grid = new PhotoGrid(containerSelector, options);
        await grid.initialize();
        return grid;
    }
}