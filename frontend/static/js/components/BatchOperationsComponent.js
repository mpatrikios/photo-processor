/**
 * BatchOperationsComponent - UI component for bulk photo operations
 * Extracted from batch-operations.js to separate UI from business logic
 * Handles user interface and user interactions for bulk photo selection and operations
 */

import { BaseComponent } from './BaseComponent.js';

export class BatchOperationsComponent extends BaseComponent {
    constructor(container, options = {}) {
        super(container, {
            name: 'BatchOperationsComponent',
            enableSelectionUI: true,
            enableToolbar: true,
            enableModals: true,
            autoHideToolbar: true,
            ...options
        });

        // UI state
        this.isSelectionMode = false;
        this.selectedCount = 0;
        this.isOperationInProgress = false;

        // DOM references
        this.toolbar = null;
        this.selectionButton = null;
        this.selectedCountElement = null;

        // Service dependencies
        this.batchService = null;
        this.notificationService = null;

        // Modal instances
        this.updateLabelsModal = null;
    }

    /**
     * Initialize component
     */
    async onInitialize() {
        console.log('[BatchOperationsComponent] Available services:', Object.keys(this.services));
        console.log('[BatchOperationsComponent] Looking for batchService...');
        
        // Get service dependencies
        this.batchService = this.getService('batchService');
        this.notificationService = this.getService('notificationService');

        console.log('[BatchOperationsComponent] BatchService found:', !!this.batchService);
        
        if (!this.batchService) {
            throw new Error('BatchService is required for BatchOperationsComponent');
        }

        // Setup event listeners
        this.setupEventListeners();

        // Initialize UI
        this.initializeUI();

        // Restore state from service
        this.restoreState();

        this.log('BatchOperationsComponent initialized');
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        // Listen to batch service events
        this.on('batch:mode:changed', this.handleModeChanged.bind(this));
        this.on('batch:mode:exited', this.handleModeExited.bind(this));
        this.on('batch:selection:updated', this.handleSelectionUpdated.bind(this));
        this.on('batch:operation:started', this.handleOperationStarted.bind(this));
        this.on('batch:operation:completed', this.handleOperationCompleted.bind(this));
        this.on('batch:operation:failed', this.handleOperationFailed.bind(this));

        // Listen to photo grid updates for checkbox management
        this.on('photos:groups:updated', this.handlePhotoGroupsUpdated.bind(this));
        this.on('ui:section:changed', this.handleSectionChanged.bind(this));
    }

    /**
     * Initialize UI elements
     * @private
     */
    initializeUI() {
        // Create batch toolbar
        if (this.options.enableToolbar) {
            this.createBatchToolbar();
        }

        // Add selection mode button to actions section
        this.addSelectionModeButton();

        // Initialize modal for label updates
        if (this.options.enableModals) {
            this.initializeUpdateLabelsModal();
        }
    }

    /**
     * Create batch operations toolbar
     * @private
     */
    createBatchToolbar() {
        const toolbar = document.createElement('div');
        toolbar.id = 'batch-toolbar';
        toolbar.className = 'batch-toolbar d-none';
        toolbar.innerHTML = `
            <div class="d-flex align-items-center gap-3 p-3 bg-light border rounded mb-3">
                <div class="flex-grow-1">
                    <span class="fw-bold text-primary">
                        <span id="selected-count">0</span> photos selected
                    </span>
                    <div class="progress mt-2 d-none" id="batch-progress" style="height: 4px;">
                        <div class="progress-bar" role="progressbar" style="width: 0%"></div>
                    </div>
                </div>
                
                <div class="btn-group" role="group">
                    <button type="button" class="btn btn-outline-primary btn-sm" id="batch-update-labels">
                        <i class="fas fa-edit me-1"></i> Update Labels
                    </button>
                    <button type="button" class="btn btn-outline-warning btn-sm" id="batch-reprocess">
                        <i class="fas fa-redo me-1"></i> Reprocess
                    </button>
                    <button type="button" class="btn btn-outline-danger btn-sm" id="batch-delete">
                        <i class="fas fa-trash me-1"></i> Delete
                    </button>
                </div>
                
                <div class="btn-group" role="group">
                    <button type="button" class="btn btn-outline-secondary btn-sm" id="select-all-button">
                        <i class="fas fa-check-double me-1"></i> Select All
                    </button>
                    <button type="button" class="btn btn-secondary btn-sm" id="cancel-selection">
                        <i class="fas fa-times me-1"></i> Cancel
                    </button>
                </div>
            </div>
        `;

        // Find insertion point (after filters section)
        const filtersSection = document.querySelector('.filters-section');
        if (filtersSection) {
            filtersSection.insertAdjacentElement('afterend', toolbar);
        } else {
            // Fallback to container
            this.container.insertBefore(toolbar, this.container.firstChild);
        }

        this.toolbar = toolbar;
        this.selectedCountElement = toolbar.querySelector('#selected-count');

        // Bind toolbar events
        this.bindToolbarEvents();
    }

    /**
     * Add selection mode button to actions section
     * @private
     */
    addSelectionModeButton() {
        const actionsSection = document.querySelector('.actions-section, .photo-actions');
        
        if (actionsSection && !document.getElementById('toggle-selection-mode')) {
            const selectionButton = document.createElement('button');
            selectionButton.type = 'button';
            selectionButton.id = 'toggle-selection-mode';
            selectionButton.className = 'btn btn-outline-secondary btn-sm';
            selectionButton.innerHTML = '<i class="fas fa-check-square me-1"></i> Select Photos';

            selectionButton.addEventListener('click', () => {
                this.toggleSelectionMode();
            });

            actionsSection.appendChild(selectionButton);
            this.selectionButton = selectionButton;
        }
    }

    /**
     * Bind toolbar events
     * @private
     */
    bindToolbarEvents() {
        if (!this.toolbar) return;

        // Update labels button
        const updateLabelsBtn = this.toolbar.querySelector('#batch-update-labels');
        updateLabelsBtn?.addEventListener('click', () => this.showUpdateLabelsModal());

        // Reprocess button
        const reprocessBtn = this.toolbar.querySelector('#batch-reprocess');
        reprocessBtn?.addEventListener('click', () => this.showReprocessConfirm());

        // Delete button
        const deleteBtn = this.toolbar.querySelector('#batch-delete');
        deleteBtn?.addEventListener('click', () => this.showDeleteConfirm());

        // Select all button
        const selectAllBtn = this.toolbar.querySelector('#select-all-button');
        selectAllBtn?.addEventListener('click', () => this.selectAll());

        // Cancel button
        const cancelBtn = this.toolbar.querySelector('#cancel-selection');
        cancelBtn?.addEventListener('click', () => this.exitSelectionMode());
    }

    /**
     * Initialize update labels modal
     * @private
     */
    initializeUpdateLabelsModal() {
        // Check if modal already exists
        if (document.getElementById('batch-update-modal')) {
            this.updateLabelsModal = bootstrap.Modal.getInstance(document.getElementById('batch-update-modal'));
            return;
        }

        const modalHtml = `
            <div class="modal fade" id="batch-update-modal" tabindex="-1">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Update Labels</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p>Update bib number for <span id="update-count">0</span> selected photos:</p>
                            <div class="mb-3">
                                <label for="batch-bib-number" class="form-label">New Bib Number</label>
                                <input type="number" class="form-control" id="batch-bib-number" 
                                       min="1" max="99999" placeholder="Enter bib number">
                                <div class="form-text">Enter a number between 1 and 99999</div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" id="confirm-batch-update">
                                <i class="fas fa-check me-1"></i> Update Labels
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        const modalElement = document.getElementById('batch-update-modal');
        this.updateLabelsModal = new bootstrap.Modal(modalElement);

        // Bind confirm button
        const confirmBtn = modalElement.querySelector('#confirm-batch-update');
        confirmBtn?.addEventListener('click', () => this.executeUpdateLabels());

        // Auto-focus input when modal opens
        modalElement.addEventListener('shown.bs.modal', () => {
            const bibInput = modalElement.querySelector('#batch-bib-number');
            bibInput?.focus();
        });

        // Handle Enter key in input
        const bibInput = modalElement.querySelector('#batch-bib-number');
        bibInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.executeUpdateLabels();
            }
        });
    }

    /**
     * Restore state from batch service
     * @private
     */
    restoreState() {
        if (this.batchService) {
            const stats = this.batchService.getStats();
            
            this.isSelectionMode = stats.selection.isSelectionMode;
            this.selectedCount = stats.selection.selectedCount;
            this.isOperationInProgress = stats.progress.inProgress;

            this.updateUI();
        }
    }

    /**
     * Toggle selection mode
     */
    toggleSelectionMode() {
        if (this.batchService) {
            this.batchService.toggleSelectionMode();
        }
    }

    /**
     * Exit selection mode
     */
    exitSelectionMode() {
        if (this.batchService) {
            this.batchService.exitSelectionMode();
        }
    }

    /**
     * Select all photos
     */
    selectAll() {
        if (this.batchService) {
            this.batchService.selectAll();
        }
    }

    /**
     * Show update labels modal
     */
    showUpdateLabelsModal() {
        if (this.selectedCount === 0) {
            this.showError('No photos selected');
            return;
        }

        // Update modal content with current count
        const updateCountElement = document.getElementById('update-count');
        if (updateCountElement) {
            updateCountElement.textContent = this.selectedCount;
        }

        // Clear previous input
        const bibInput = document.getElementById('batch-bib-number');
        if (bibInput) {
            bibInput.value = '';
        }

        if (this.updateLabelsModal) {
            this.updateLabelsModal.show();
        }
    }

    /**
     * Execute label update
     */
    async executeUpdateLabels() {
        const bibInput = document.getElementById('batch-bib-number');
        const bibNumber = bibInput?.value?.trim();

        if (!bibNumber) {
            this.showError('Please enter a bib number');
            return;
        }

        try {
            if (this.batchService) {
                await this.batchService.executeBatchUpdate(bibNumber);
                
                // Hide modal on success
                if (this.updateLabelsModal) {
                    this.updateLabelsModal.hide();
                }
            }
        } catch (error) {
            this.showError(error.message || 'Failed to update labels');
        }
    }

    /**
     * Show reprocess confirmation
     */
    showReprocessConfirm() {
        if (this.selectedCount === 0) {
            this.showError('No photos selected');
            return;
        }

        const confirmed = confirm(
            `Reprocess ${this.selectedCount} photos?\n\n` +
            `This will re-run OCR detection on the selected photos.`
        );

        if (confirmed) {
            this.executeReprocess();
        }
    }

    /**
     * Execute reprocessing
     */
    async executeReprocess() {
        try {
            if (this.batchService) {
                await this.batchService.executeBatchReprocess(false);
            }
        } catch (error) {
            this.showError(error.message || 'Failed to reprocess photos');
        }
    }

    /**
     * Show delete confirmation
     */
    showDeleteConfirm() {
        if (this.selectedCount === 0) {
            this.showError('No photos selected');
            return;
        }

        const confirmed = confirm(
            `⚠️ DELETE ${this.selectedCount} photos?\n\n` +
            `This action cannot be undone. The photos will be permanently removed from your account.`
        );

        if (confirmed) {
            this.executeDelete();
        }
    }

    /**
     * Execute deletion
     */
    async executeDelete() {
        try {
            if (this.batchService) {
                await this.batchService.executeBatchDelete(true);
            }
        } catch (error) {
            this.showError(error.message || 'Failed to delete photos');
        }
    }

    /**
     * Add selection checkboxes to photo groups
     */
    addSelectionCheckboxes() {
        const groupHeaders = document.querySelectorAll('.group-header');
        
        groupHeaders.forEach(header => {
            if (!header.querySelector('.group-checkbox')) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'form-check-input group-checkbox me-2';
                
                const groupKey = header.dataset.groupKey;
                checkbox.addEventListener('change', (event) => {
                    this.handleGroupSelection(groupKey, event.target.checked);
                });

                header.insertBefore(checkbox, header.firstChild);
            }
        });

        // Add photo-level checkboxes
        const photoCards = document.querySelectorAll('.photo-card[data-photo-id]');
        
        photoCards.forEach(card => {
            if (!card.querySelector('.photo-checkbox')) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'form-check-input photo-checkbox position-absolute';
                checkbox.style.cssText = 'top: 8px; right: 8px; z-index: 10;';
                
                const photoId = card.dataset.photoId;
                checkbox.addEventListener('change', (event) => {
                    this.handlePhotoSelection(photoId, event.target.checked);
                });

                card.appendChild(checkbox);
                card.classList.add('position-relative');
            }
        });
    }

    /**
     * Remove selection checkboxes
     */
    removeSelectionCheckboxes() {
        // Remove group checkboxes
        document.querySelectorAll('.group-checkbox').forEach(checkbox => {
            checkbox.remove();
        });

        // Remove photo checkboxes
        document.querySelectorAll('.photo-checkbox').forEach(checkbox => {
            checkbox.remove();
        });

        // Remove relative positioning
        document.querySelectorAll('.photo-card.position-relative').forEach(card => {
            card.classList.remove('position-relative');
        });
    }

    /**
     * Update checkbox states based on current selection
     */
    updateCheckboxStates() {
        if (!this.batchService) return;

        const selectedPhotos = new Set(this.batchService.getSelectedPhotos());

        // Update photo checkboxes
        document.querySelectorAll('.photo-checkbox').forEach(checkbox => {
            const photoCard = checkbox.closest('.photo-card');
            const photoId = photoCard?.dataset.photoId;
            
            if (photoId) {
                checkbox.checked = selectedPhotos.has(photoId);
            }
        });

        // Update group checkboxes
        document.querySelectorAll('.group-checkbox').forEach(checkbox => {
            const groupHeader = checkbox.closest('.group-header');
            const groupKey = groupHeader?.dataset.groupKey;
            
            if (groupKey) {
                const groupPhotos = document.querySelectorAll(`[data-group-key="${groupKey}"] .photo-card[data-photo-id]`);
                const groupPhotoIds = Array.from(groupPhotos).map(card => card.dataset.photoId);
                
                const allSelected = groupPhotoIds.length > 0 && groupPhotoIds.every(id => selectedPhotos.has(id));
                const someSelected = groupPhotoIds.some(id => selectedPhotos.has(id));
                
                checkbox.checked = allSelected;
                checkbox.indeterminate = !allSelected && someSelected;
            }
        });
    }

    /**
     * Handle group selection
     * @private
     */
    handleGroupSelection(groupKey, selected) {
        // Find group data
        const groupElement = document.querySelector(`[data-group-key="${groupKey}"]`);
        if (!groupElement) return;

        const photoElements = groupElement.querySelectorAll('.photo-card[data-photo-id]');
        const photos = Array.from(photoElements).map(el => ({
            id: el.dataset.photoId
        }));

        const groupData = { key: groupKey, photos };

        if (this.batchService) {
            this.batchService.toggleGroupSelection(groupData, selected);
        }
    }

    /**
     * Handle individual photo selection
     * @private
     */
    handlePhotoSelection(photoId, selected) {
        if (this.batchService) {
            // Get current selection state
            const currentlySelected = this.batchService.getSelectedPhotos().includes(photoId);
            
            // Only toggle if state is different
            if (currentlySelected !== selected) {
                this.batchService.togglePhotoSelection(photoId);
            }
        }
    }

    /**
     * Update UI state
     * @private
     */
    updateUI() {
        // Update toolbar visibility
        if (this.toolbar) {
            if (this.isSelectionMode && this.options.autoHideToolbar) {
                this.toolbar.classList.remove('d-none');
            } else if (this.options.autoHideToolbar) {
                this.toolbar.classList.add('d-none');
            }
        }

        // Update selection button
        if (this.selectionButton) {
            if (this.isSelectionMode) {
                this.selectionButton.innerHTML = '<i class="fas fa-times me-1"></i> Exit Selection';
                this.selectionButton.classList.remove('btn-outline-secondary');
                this.selectionButton.classList.add('btn-secondary');
            } else {
                this.selectionButton.innerHTML = '<i class="fas fa-check-square me-1"></i> Select Photos';
                this.selectionButton.classList.remove('btn-secondary');
                this.selectionButton.classList.add('btn-outline-secondary');
            }
        }

        // Update selected count
        if (this.selectedCountElement) {
            this.selectedCountElement.textContent = this.selectedCount;
        }

        // Update checkboxes
        if (this.isSelectionMode) {
            this.addSelectionCheckboxes();
            this.updateCheckboxStates();
        } else {
            this.removeSelectionCheckboxes();
        }

        // Update button states
        this.updateButtonStates();
    }

    /**
     * Update button states based on operation progress
     * @private
     */
    updateButtonStates() {
        if (!this.toolbar) return;

        const buttons = this.toolbar.querySelectorAll('button:not(#cancel-selection)');
        const hasSelection = this.selectedCount > 0;

        buttons.forEach(button => {
            button.disabled = this.isOperationInProgress || !hasSelection;
        });

        // Progress bar
        const progressBar = this.toolbar.querySelector('#batch-progress');
        if (progressBar) {
            if (this.isOperationInProgress) {
                progressBar.classList.remove('d-none');
                // Update progress if we have progress data
                if (this.batchService) {
                    const progress = this.batchService.getOperationProgress();
                    const percentage = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;
                    const progressBarFill = progressBar.querySelector('.progress-bar');
                    if (progressBarFill) {
                        progressBarFill.style.width = `${percentage}%`;
                    }
                }
            } else {
                progressBar.classList.add('d-none');
            }
        }
    }

    // Event Handlers

    /**
     * Handle mode change
     * @private
     */
    handleModeChanged(data) {
        this.isSelectionMode = data.isSelectionMode;
        this.selectedCount = data.selectedCount;
        this.updateUI();
    }

    /**
     * Handle mode exit
     * @private
     */
    handleModeExited() {
        this.isSelectionMode = false;
        this.selectedCount = 0;
        this.updateUI();
    }

    /**
     * Handle selection update
     * @private
     */
    handleSelectionUpdated(data) {
        this.selectedCount = data.selectedCount;
        this.updateUI();
    }

    /**
     * Handle operation started
     * @private
     */
    handleOperationStarted(data) {
        this.isOperationInProgress = true;
        this.updateUI();
    }

    /**
     * Handle operation completed
     * @private
     */
    handleOperationCompleted(data) {
        this.isOperationInProgress = false;
        this.updateUI();
    }

    /**
     * Handle operation failed
     * @private
     */
    handleOperationFailed(data) {
        this.isOperationInProgress = false;
        this.updateUI();
        this.showError(`Operation failed: ${data.error?.message || 'Unknown error'}`);
    }

    /**
     * Handle photo groups update
     * @private
     */
    handlePhotoGroupsUpdated() {
        // Refresh checkboxes when photo groups are updated
        if (this.isSelectionMode) {
            setTimeout(() => {
                this.addSelectionCheckboxes();
                this.updateCheckboxStates();
            }, 100);
        }
    }

    /**
     * Handle section change
     * @private
     */
    handleSectionChanged(data) {
        // Hide toolbar when not in results section
        if (this.toolbar && this.options.autoHideToolbar) {
            const showToolbar = data.section === 'results' && this.isSelectionMode;
            this.toolbar.classList.toggle('d-none', !showToolbar);
        }
    }

    /**
     * Show error message
     * @private
     */
    showError(message) {
        if (this.notificationService) {
            this.notificationService.show(message, 'error');
        } else {
            alert(message);
        }
    }

    /**
     * Destroy component
     */
    async destroy() {
        // Remove toolbar
        if (this.toolbar) {
            this.toolbar.remove();
        }

        // Remove selection mode button
        if (this.selectionButton) {
            this.selectionButton.remove();
        }

        // Remove checkboxes
        this.removeSelectionCheckboxes();

        // Dispose modals
        if (this.updateLabelsModal) {
            this.updateLabelsModal.dispose();
        }

        await super.destroy();
    }
}