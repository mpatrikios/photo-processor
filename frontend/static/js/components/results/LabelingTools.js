/**
 * LabelingTools - Photo labeling and editing component
 * Provides inline editing, bulk operations, and label management
 * Eliminates duplication in labeling logic across different contexts
 */

import { BaseComponent } from '../BaseComponent.js';
import { FormComponent } from '../FormComponent.js';

export class LabelingTools extends BaseComponent {
    constructor(containerSelector, options = {}) {
        super(containerSelector, {
            name: 'LabelingTools',
            showInlineEdit: true,
            showBulkEdit: true,
            showQuickLabels: true,
            showLabelSuggestions: true,
            enableAutoSave: true,
            autoSaveDelay: 2000,
            enableKeyboardShortcuts: true,
            quickLabels: ['Runner', 'Volunteer', 'Staff', 'Spectator'],
            ...options
        });

        // Labeling state
        this.activeEdits = new Map(); // photoId -> editData
        this.selectedPhotos = new Set();
        this.labelSuggestions = [];
        this.recentLabels = [];

        // Auto-save timers
        this.autoSaveTimers = new Map();

        // UI elements
        this.toolbar = null;
        this.bulkEditPanel = null;
        this.suggestionsPanel = null;

        // Event handlers (bound for cleanup)
        this.handleKeydown = this.handleKeydown.bind(this);
    }

    async onRender() {
        if (!this.element) {
            throw new Error('Container element required for LabelingTools');
        }

        this.createLabelingUI();
        this.log('Labeling tools rendered');
    }

    /**
     * Create labeling tools UI
     * @private
     */
    createLabelingUI() {
        const html = `
            <div class="labeling-tools">
                <div class="labeling-toolbar">
                    <div class="toolbar-content d-flex justify-content-between align-items-center p-3 bg-light border rounded">
                        <div class="toolbar-left d-flex align-items-center">
                            <span class="toolbar-title me-3">
                                <i class="fas fa-tags me-2"></i>
                                Labeling Tools
                            </span>
                            
                            ${this.options.showQuickLabels ? `
                                <div class="quick-labels me-3">
                                    <label class="form-label small text-muted me-2 mb-0">Quick:</label>
                                    <div class="btn-group btn-group-sm">
                                        ${this.options.quickLabels.map(label => `
                                            <button type="button" 
                                                    class="btn btn-outline-primary quick-label-btn"
                                                    data-label="${this.escapeHtml(label)}">
                                                ${this.escapeHtml(label)}
                                            </button>
                                        `).join('')}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                        
                        <div class="toolbar-right d-flex align-items-center">
                            <div class="selection-info me-3 text-muted small">
                                <span class="selected-count">0</span> selected
                            </div>
                            
                            ${this.options.showBulkEdit ? `
                                <button type="button" 
                                        class="btn btn-outline-secondary btn-sm bulk-edit-btn me-2"
                                        disabled>
                                    <i class="fas fa-edit me-1"></i>Bulk Edit
                                </button>
                            ` : ''}
                            
                            <div class="dropdown">
                                <button type="button" 
                                        class="btn btn-outline-secondary btn-sm dropdown-toggle"
                                        data-bs-toggle="dropdown">
                                    <i class="fas fa-cog me-1"></i>Options
                                </button>
                                <ul class="dropdown-menu">
                                    <li>
                                        <button class="dropdown-item auto-save-toggle" type="button">
                                            <i class="fas fa-save me-2"></i>
                                            Auto-save: <span class="auto-save-status">${this.options.enableAutoSave ? 'On' : 'Off'}</span>
                                        </button>
                                    </li>
                                    <li>
                                        <button class="dropdown-item clear-all-edits-btn" type="button">
                                            <i class="fas fa-undo me-2"></i>Cancel All Edits
                                        </button>
                                    </li>
                                    <li>
                                        <button class="dropdown-item save-all-btn" type="button">
                                            <i class="fas fa-save me-2"></i>Save All Changes
                                        </button>
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
                
                ${this.options.showBulkEdit ? this.createBulkEditHTML() : ''}
                ${this.options.showLabelSuggestions ? this.createSuggestionsHTML() : ''}
                
                <div class="active-edits-panel d-none">
                    <div class="card">
                        <div class="card-header">
                            <h6 class="mb-0">
                                <i class="fas fa-edit me-2"></i>
                                Active Edits (<span class="active-count">0</span>)
                            </h6>
                        </div>
                        <div class="card-body">
                            <div class="active-edits-list">
                                <!-- Active edits will be populated here -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.setHTML(html);

        // Cache element references
        this.toolbar = this.$('.labeling-toolbar');
        this.bulkEditPanel = this.$('.bulk-edit-panel');
        this.suggestionsPanel = this.$('.suggestions-panel');
        this.activeEditsPanel = this.$('.active-edits-panel');
    }

    /**
     * Create bulk edit HTML
     * @private
     */
    createBulkEditHTML() {
        return `
            <div class="bulk-edit-panel mt-3 d-none">
                <div class="card">
                    <div class="card-header">
                        <h6 class="mb-0">
                            <i class="fas fa-edit me-2"></i>
                            Bulk Edit Selected Photos
                        </h6>
                    </div>
                    <div class="card-body">
                        <form class="bulk-edit-form">
                            <div class="row g-3">
                                <div class="col-md-4">
                                    <label class="form-label">Bib Number</label>
                                    <input type="text" 
                                           class="form-control bulk-bib-input" 
                                           placeholder="Enter bib number">
                                </div>
                                
                                <div class="col-md-4">
                                    <label class="form-label">Custom Label</label>
                                    <input type="text" 
                                           class="form-control bulk-label-input" 
                                           placeholder="Enter custom label"
                                           list="label-suggestions">
                                    <datalist id="label-suggestions">
                                        ${this.recentLabels.map(label => 
                                            `<option value="${this.escapeHtml(label)}"></option>`
                                        ).join('')}
                                    </datalist>
                                </div>
                                
                                <div class="col-md-4">
                                    <label class="form-label">Action</label>
                                    <select class="form-select bulk-action-select">
                                        <option value="set">Set value</option>
                                        <option value="append">Append to existing</option>
                                        <option value="clear">Clear field</option>
                                    </select>
                                </div>
                            </div>
                            
                            <div class="mt-3">
                                <div class="d-flex justify-content-between align-items-center">
                                    <div class="bulk-preview text-muted small">
                                        <!-- Preview will be shown here -->
                                    </div>
                                    
                                    <div class="btn-group">
                                        <button type="button" class="btn btn-success bulk-apply-btn">
                                            <i class="fas fa-check me-1"></i>Apply Changes
                                        </button>
                                        <button type="button" class="btn btn-outline-secondary bulk-cancel-btn">
                                            <i class="fas fa-times me-1"></i>Cancel
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Create suggestions HTML
     * @private
     */
    createSuggestionsHTML() {
        return `
            <div class="suggestions-panel mt-3 d-none">
                <div class="card">
                    <div class="card-header">
                        <h6 class="mb-0">
                            <i class="fas fa-lightbulb me-2"></i>
                            Label Suggestions
                        </h6>
                    </div>
                    <div class="card-body">
                        <div class="suggestions-list">
                            <div class="text-muted small">No suggestions available</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        // Quick label buttons
        const quickLabelButtons = this.$$('.quick-label-btn');
        quickLabelButtons.forEach(btn => {
            this.addEventListener(btn, 'click', (event) => {
                const label = event.target.dataset.label;
                this.applyQuickLabel(label);
            });
        });

        // Bulk edit controls
        const bulkEditBtn = this.$('.bulk-edit-btn');
        if (bulkEditBtn) {
            this.addEventListener(bulkEditBtn, 'click', this.toggleBulkEdit.bind(this));
        }

        const bulkApplyBtn = this.$('.bulk-apply-btn');
        if (bulkApplyBtn) {
            this.addEventListener(bulkApplyBtn, 'click', this.applyBulkEdit.bind(this));
        }

        const bulkCancelBtn = this.$('.bulk-cancel-btn');
        if (bulkCancelBtn) {
            this.addEventListener(bulkCancelBtn, 'click', () => this.toggleBulkEdit(false));
        }

        // Bulk edit form changes
        const bulkForm = this.$('.bulk-edit-form');
        if (bulkForm) {
            this.addEventListener(bulkForm, 'input', this.updateBulkPreview.bind(this));
            this.addEventListener(bulkForm, 'change', this.updateBulkPreview.bind(this));
        }

        // Toolbar options
        const autoSaveToggle = this.$('.auto-save-toggle');
        if (autoSaveToggle) {
            this.addEventListener(autoSaveToggle, 'click', this.toggleAutoSave.bind(this));
        }

        const clearAllBtn = this.$('.clear-all-edits-btn');
        if (clearAllBtn) {
            this.addEventListener(clearAllBtn, 'click', this.clearAllEdits.bind(this));
        }

        const saveAllBtn = this.$('.save-all-btn');
        if (saveAllBtn) {
            this.addEventListener(saveAllBtn, 'click', this.saveAllEdits.bind(this));
        }

        // Selection events
        this.on('photos:selection:changed', this.handleSelectionChanged);
        
        // Photo edit events
        this.on('photo:edit:started', this.handlePhotoEditStarted);
        this.on('photo:edit:cancelled', this.handlePhotoEditCancelled);
        this.on('photo:edit:saved', this.handlePhotoEditSaved);

        // Keyboard shortcuts
        if (this.options.enableKeyboardShortcuts) {
            this.addEventListener(document, 'keydown', this.handleKeydown);
        }
    }

    /**
     * Handle keyboard shortcuts
     * @private
     */
    handleKeydown(event) {
        if (event.target.tagName.toLowerCase() === 'input' || 
            event.target.tagName.toLowerCase() === 'textarea') {
            return; // Don't interfere with input fields
        }

        switch (event.key) {
            case 'b':
                if (event.ctrlKey || event.metaKey) {
                    event.preventDefault();
                    this.toggleBulkEdit();
                }
                break;
            case 'Escape':
                event.preventDefault();
                this.clearAllEdits();
                break;
            case 's':
                if (event.ctrlKey || event.metaKey) {
                    event.preventDefault();
                    this.saveAllEdits();
                }
                break;
        }

        // Quick label shortcuts (1-9)
        const keyNum = parseInt(event.key);
        if (keyNum >= 1 && keyNum <= 9) {
            const quickLabels = this.options.quickLabels;
            if (keyNum <= quickLabels.length) {
                event.preventDefault();
                this.applyQuickLabel(quickLabels[keyNum - 1]);
            }
        }
    }

    /**
     * Handle selection changed event
     * @private
     */
    handleSelectionChanged = (data) => {
        this.selectedPhotos = new Set(data.selectedPhotos || []);
        this.updateSelectionDisplay();
        this.updateBulkEditState();
    };

    /**
     * Handle photo edit started event
     * @private
     */
    handlePhotoEditStarted = (data) => {
        this.startPhotoEdit(data.photoId, data.photo, data.field);
    };

    /**
     * Handle photo edit cancelled event
     * @private
     */
    handlePhotoEditCancelled = (data) => {
        this.cancelPhotoEdit(data.photoId);
    };

    /**
     * Handle photo edit saved event
     * @private
     */
    handlePhotoEditSaved = (data) => {
        this.savePhotoEdit(data.photoId, data.updates);
    };

    /**
     * Start inline edit for a photo
     */
    startPhotoEdit(photoId, photo, field = 'label') {
        const editData = {
            photoId,
            originalPhoto: { ...photo },
            field,
            startTime: Date.now(),
            isDirty: false
        };

        this.activeEdits.set(photoId, editData);
        this.updateActiveEditsDisplay();

        this.emit('labeling:edit:started', {
            photoId,
            photo,
            field,
            editData
        });

        this.log('Photo edit started', { photoId, field });
    }

    /**
     * Update photo edit
     */
    updatePhotoEdit(photoId, field, value) {
        const editData = this.activeEdits.get(photoId);
        if (!editData) return;

        const oldValue = editData.originalPhoto[field];
        editData.isDirty = value !== oldValue;
        editData.pendingChanges = { ...editData.pendingChanges, [field]: value };

        // Schedule auto-save if enabled
        if (this.options.enableAutoSave && editData.isDirty) {
            this.scheduleAutoSave(photoId);
        }

        this.updateActiveEditsDisplay();

        this.emit('labeling:edit:updated', {
            photoId,
            field,
            value,
            isDirty: editData.isDirty
        });
    }

    /**
     * Schedule auto-save for a photo edit
     * @private
     */
    scheduleAutoSave(photoId) {
        // Clear existing timer
        if (this.autoSaveTimers.has(photoId)) {
            clearTimeout(this.autoSaveTimers.get(photoId));
        }

        // Schedule new auto-save
        const timerId = this.setTimeout(() => {
            this.savePhotoEdit(photoId);
            this.autoSaveTimers.delete(photoId);
        }, this.options.autoSaveDelay);

        this.autoSaveTimers.set(photoId, timerId);
    }

    /**
     * Save photo edit
     */
    savePhotoEdit(photoId, forcedUpdates = null) {
        const editData = this.activeEdits.get(photoId);
        if (!editData) return;

        const updates = forcedUpdates || editData.pendingChanges || {};
        
        // Cancel auto-save timer
        if (this.autoSaveTimers.has(photoId)) {
            clearTimeout(this.autoSaveTimers.get(photoId));
            this.autoSaveTimers.delete(photoId);
        }

        // Add to recent labels if it's a label update
        if (updates.custom_label && !this.recentLabels.includes(updates.custom_label)) {
            this.recentLabels.unshift(updates.custom_label);
            this.recentLabels = this.recentLabels.slice(0, 10); // Keep last 10
        }

        this.activeEdits.delete(photoId);
        this.updateActiveEditsDisplay();

        this.emit('labeling:edit:saved', {
            photoId,
            updates,
            originalPhoto: editData.originalPhoto
        });

        this.log('Photo edit saved', { photoId, updates });
    }

    /**
     * Cancel photo edit
     */
    cancelPhotoEdit(photoId) {
        const editData = this.activeEdits.get(photoId);
        if (!editData) return;

        // Cancel auto-save timer
        if (this.autoSaveTimers.has(photoId)) {
            clearTimeout(this.autoSaveTimers.get(photoId));
            this.autoSaveTimers.delete(photoId);
        }

        this.activeEdits.delete(photoId);
        this.updateActiveEditsDisplay();

        this.emit('labeling:edit:cancelled', {
            photoId,
            originalPhoto: editData.originalPhoto
        });

        this.log('Photo edit cancelled', { photoId });
    }

    /**
     * Apply quick label to selected photos
     */
    applyQuickLabel(label) {
        if (this.selectedPhotos.size === 0) {
            this.warn('No photos selected for quick labeling');
            return;
        }

        const selectedArray = Array.from(this.selectedPhotos);
        
        this.emit('labeling:bulk:apply', {
            photoIds: selectedArray,
            updates: { custom_label: label },
            action: 'set'
        });

        this.log('Quick label applied', { label, count: selectedArray.length });
    }

    /**
     * Toggle bulk edit panel
     */
    toggleBulkEdit(show = null) {
        const isVisible = !this.bulkEditPanel?.classList.contains('d-none');
        const shouldShow = show !== null ? show : !isVisible;

        if (shouldShow && this.selectedPhotos.size === 0) {
            this.warn('No photos selected for bulk editing');
            return;
        }

        if (this.bulkEditPanel) {
            if (shouldShow) {
                this.bulkEditPanel.classList.remove('d-none');
                this.updateBulkPreview();
            } else {
                this.bulkEditPanel.classList.add('d-none');
            }
        }

        this.emit('labeling:bulk:toggled', { visible: shouldShow });
    }

    /**
     * Update bulk edit preview
     * @private
     */
    updateBulkPreview() {
        const previewElement = this.$('.bulk-preview');
        if (!previewElement) return;

        const selectedCount = this.selectedPhotos.size;
        const bibValue = this.$('.bulk-bib-input')?.value.trim();
        const labelValue = this.$('.bulk-label-input')?.value.trim();
        const action = this.$('.bulk-action-select')?.value;

        let preview = `Will affect ${selectedCount} photo${selectedCount !== 1 ? 's' : ''}`;

        if (bibValue || labelValue) {
            const changes = [];
            if (bibValue) {
                changes.push(`bib number: "${bibValue}"`);
            }
            if (labelValue) {
                changes.push(`label: "${labelValue}"`);
            }
            
            preview += ` - ${action} ${changes.join(', ')}`;
        }

        previewElement.textContent = preview;
    }

    /**
     * Apply bulk edit
     * @private
     */
    applyBulkEdit() {
        if (this.selectedPhotos.size === 0) return;

        const bibValue = this.$('.bulk-bib-input')?.value.trim();
        const labelValue = this.$('.bulk-label-input')?.value.trim();
        const action = this.$('.bulk-action-select')?.value;

        if (!bibValue && !labelValue) {
            this.warn('No changes specified for bulk edit');
            return;
        }

        const updates = {};
        if (bibValue) updates.bib_number = bibValue;
        if (labelValue) updates.custom_label = labelValue;

        const selectedArray = Array.from(this.selectedPhotos);

        this.emit('labeling:bulk:apply', {
            photoIds: selectedArray,
            updates,
            action
        });

        // Clear bulk edit form
        this.$('.bulk-bib-input').value = '';
        this.$('.bulk-label-input').value = '';
        this.updateBulkPreview();
        this.toggleBulkEdit(false);

        this.log('Bulk edit applied', { count: selectedArray.length, updates, action });
    }

    /**
     * Toggle auto-save
     * @private
     */
    toggleAutoSave() {
        this.options.enableAutoSave = !this.options.enableAutoSave;
        
        const statusElement = this.$('.auto-save-status');
        if (statusElement) {
            statusElement.textContent = this.options.enableAutoSave ? 'On' : 'Off';
        }

        this.emit('labeling:autosave:toggled', { enabled: this.options.enableAutoSave });
    }

    /**
     * Clear all active edits
     */
    clearAllEdits() {
        const editCount = this.activeEdits.size;
        
        // Cancel all auto-save timers
        for (const timerId of this.autoSaveTimers.values()) {
            clearTimeout(timerId);
        }
        this.autoSaveTimers.clear();

        // Clear all edits
        const cancelledEdits = Array.from(this.activeEdits.entries());
        this.activeEdits.clear();
        this.updateActiveEditsDisplay();

        this.emit('labeling:edits:cleared', { 
            count: editCount,
            cancelledEdits: cancelledEdits.map(([photoId, data]) => ({
                photoId,
                originalPhoto: data.originalPhoto
            }))
        });

        this.log('All edits cleared', { count: editCount });
    }

    /**
     * Save all active edits
     */
    saveAllEdits() {
        const editCount = this.activeEdits.size;
        if (editCount === 0) return;

        const editsToSave = Array.from(this.activeEdits.entries());
        
        for (const [photoId, editData] of editsToSave) {
            if (editData.pendingChanges && Object.keys(editData.pendingChanges).length > 0) {
                this.savePhotoEdit(photoId);
            } else {
                // No changes, just cancel
                this.cancelPhotoEdit(photoId);
            }
        }

        this.log('All edits saved', { count: editCount });
    }

    /**
     * Update selection display
     * @private
     */
    updateSelectionDisplay() {
        const countElement = this.$('.selected-count');
        if (countElement) {
            countElement.textContent = this.selectedPhotos.size;
        }
    }

    /**
     * Update bulk edit button state
     * @private
     */
    updateBulkEditState() {
        const bulkEditBtn = this.$('.bulk-edit-btn');
        if (bulkEditBtn) {
            bulkEditBtn.disabled = this.selectedPhotos.size === 0;
        }
    }

    /**
     * Update active edits display
     * @private
     */
    updateActiveEditsDisplay() {
        const activeCount = this.activeEdits.size;
        const activeCountElement = this.$('.active-count');
        const activeEditsList = this.$('.active-edits-list');
        
        if (activeCountElement) {
            activeCountElement.textContent = activeCount;
        }

        if (this.activeEditsPanel) {
            if (activeCount > 0) {
                this.activeEditsPanel.classList.remove('d-none');
            } else {
                this.activeEditsPanel.classList.add('d-none');
            }
        }

        if (activeEditsList) {
            if (activeCount === 0) {
                activeEditsList.innerHTML = '<div class="text-muted small">No active edits</div>';
            } else {
                const editsHTML = Array.from(this.activeEdits.entries()).map(([photoId, editData]) => {
                    const elapsed = Math.round((Date.now() - editData.startTime) / 1000);
                    const filename = editData.originalPhoto.filename || `Photo ${photoId}`;
                    
                    return `
                        <div class="active-edit-item d-flex justify-content-between align-items-center p-2 border-bottom">
                            <div class="edit-info">
                                <div class="edit-filename small fw-medium">${this.escapeHtml(filename)}</div>
                                <div class="edit-meta text-muted small">
                                    ${editData.field} • ${elapsed}s ago ${editData.isDirty ? '• unsaved' : ''}
                                </div>
                            </div>
                            <div class="edit-actions">
                                <button type="button" 
                                        class="btn btn-sm btn-success save-edit-btn"
                                        data-photo-id="${photoId}">
                                    <i class="fas fa-save"></i>
                                </button>
                                <button type="button" 
                                        class="btn btn-sm btn-outline-secondary cancel-edit-btn"
                                        data-photo-id="${photoId}">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');
                
                activeEditsList.innerHTML = editsHTML;
                
                // Setup event listeners for edit action buttons
                this.setupEditActionButtons();
            }
        }
    }

    /**
     * Setup event listeners for edit action buttons
     * @private
     */
    setupEditActionButtons() {
        const saveButtons = this.$$('.save-edit-btn');
        const cancelButtons = this.$$('.cancel-edit-btn');

        saveButtons.forEach(btn => {
            this.addEventListener(btn, 'click', (event) => {
                const photoId = event.target.dataset.photoId;
                this.savePhotoEdit(photoId);
            });
        });

        cancelButtons.forEach(btn => {
            this.addEventListener(btn, 'click', (event) => {
                const photoId = event.target.dataset.photoId;
                this.cancelPhotoEdit(photoId);
            });
        });
    }

    /**
     * Set label suggestions
     */
    setLabelSuggestions(suggestions) {
        this.labelSuggestions = suggestions || [];
        this.updateSuggestionsDisplay();
    }

    /**
     * Update suggestions display
     * @private
     */
    updateSuggestionsDisplay() {
        const suggestionsList = this.$('.suggestions-list');
        if (!suggestionsList) return;

        if (this.labelSuggestions.length === 0) {
            suggestionsList.innerHTML = '<div class="text-muted small">No suggestions available</div>';
            return;
        }

        const suggestionsHTML = this.labelSuggestions.map(suggestion => `
            <button type="button" 
                    class="btn btn-outline-secondary btn-sm me-2 mb-2 suggestion-btn"
                    data-label="${this.escapeHtml(suggestion)}">
                ${this.escapeHtml(suggestion)}
            </button>
        `).join('');

        suggestionsList.innerHTML = suggestionsHTML;

        // Setup suggestion button events
        const suggestionButtons = this.$$('.suggestion-btn');
        suggestionButtons.forEach(btn => {
            this.addEventListener(btn, 'click', (event) => {
                const label = event.target.dataset.label;
                this.applyQuickLabel(label);
            });
        });
    }

    /**
     * Get active edits count
     */
    getActiveEditsCount() {
        return this.activeEdits.size;
    }

    /**
     * Get selected photos count
     */
    getSelectedCount() {
        return this.selectedPhotos.size;
    }

    /**
     * Check if auto-save is enabled
     */
    isAutoSaveEnabled() {
        return this.options.enableAutoSave;
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
     * Static helper to create labeling tools
     */
    static create(containerSelector, options = {}) {
        const tools = new LabelingTools(containerSelector, options);
        return tools;
    }

    /**
     * Static helper to create and initialize labeling tools
     */
    static async createAndInitialize(containerSelector, options = {}) {
        const tools = new LabelingTools(containerSelector, options);
        await tools.initialize();
        return tools;
    }
}