/**
 * BatchOperations - Frontend class for handling bulk photo operations
 */

class BatchOperations {
    constructor(stateManager) {
        this.state = stateManager;
        this.isSelectionMode = false;
        this.selectedPhotos = new Set();
        
        this.initializeUI();
        this.bindEvents();
    }
    
    /**
     * Initialize batch operations UI
     */
    initializeUI() {
        // Add batch operations toolbar to the page
        const toolbar = document.createElement('div');
        toolbar.id = 'batch-toolbar';
        toolbar.className = 'batch-toolbar d-none';
        toolbar.innerHTML = `
            <div class="d-flex align-items-center gap-3 p-3 bg-light border rounded">
                <div class="flex-grow-1">
                    <span class="fw-bold text-primary">
                        <span id="selected-count">0</span> photos selected
                    </span>
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
                
                <button type="button" class="btn btn-secondary btn-sm" id="cancel-selection">
                    <i class="fas fa-times me-1"></i> Cancel
                </button>
            </div>
        `;
        
        // Insert toolbar after the filters section
        const filtersSection = document.querySelector('.filters-section');
        if (filtersSection) {
            filtersSection.parentNode.insertBefore(toolbar, filtersSection.nextSibling);
        }
    }
    
    /**
     * Bind event listeners
     */
    bindEvents() {
        // Batch operation buttons
        document.getElementById('batch-update-labels')?.addEventListener('click', () => {
            this.showUpdateLabelsModal();
        });
        
        document.getElementById('batch-reprocess')?.addEventListener('click', () => {
            this.reprocessSelected();
        });
        
        document.getElementById('batch-delete')?.addEventListener('click', () => {
            this.showDeleteConfirmModal();
        });
        
        document.getElementById('cancel-selection')?.addEventListener('click', () => {
            this.exitSelectionMode();
        });
        
        // Add selection mode toggle button
        this.addSelectionModeButton();
    }
    
    /**
     * Add selection mode toggle button to the main UI
     */
    addSelectionModeButton() {
        const actionsSection = document.querySelector('.actions-section');
        if (actionsSection) {
            const button = document.createElement('button');
            button.className = 'btn btn-outline-secondary me-2';
            button.id = 'toggle-selection-mode';
            button.innerHTML = '<i class="fas fa-check-square me-1"></i> Select Multiple';
            
            button.addEventListener('click', () => {
                this.toggleSelectionMode();
            });
            
            actionsSection.insertBefore(button, actionsSection.firstChild);
        }
    }
    
    /**
     * Toggle selection mode on/off
     */
    toggleSelectionMode() {
        this.isSelectionMode = !this.isSelectionMode;
        this.state.set('batch.isSelectionMode', this.isSelectionMode);
        
        const toggleButton = document.getElementById('toggle-selection-mode');
        const toolbar = document.getElementById('batch-toolbar');
        
        if (this.isSelectionMode) {
            // Enter selection mode
            toggleButton.innerHTML = '<i class="fas fa-times me-1"></i> Exit Selection';
            toggleButton.className = 'btn btn-warning me-2';
            toolbar?.classList.remove('d-none');
            
            this.addSelectionCheckboxes();
            this.updateSelectedCount();
        } else {
            // Exit selection mode
            this.exitSelectionMode();
        }
    }
    
    /**
     * Exit selection mode
     */
    exitSelectionMode() {
        this.isSelectionMode = false;
        this.selectedPhotos.clear();
        this.state.set('batch.isSelectionMode', false);
        this.state.set('batch.selectedPhotos', []);
        
        const toggleButton = document.getElementById('toggle-selection-mode');
        const toolbar = document.getElementById('batch-toolbar');
        
        toggleButton.innerHTML = '<i class="fas fa-check-square me-1"></i> Select Multiple';
        toggleButton.className = 'btn btn-outline-secondary me-2';
        toolbar?.classList.add('d-none');
        
        this.removeSelectionCheckboxes();
    }
    
    /**
     * Add selection checkboxes to photo cards
     */
    addSelectionCheckboxes() {
        document.querySelectorAll('.photo-group-card').forEach(card => {
            const groupHeader = card.querySelector('.card-header');
            if (groupHeader && !groupHeader.querySelector('.group-checkbox')) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'form-check-input group-checkbox me-2';
                checkbox.addEventListener('change', (e) => {
                    this.toggleGroupSelection(card, e.target.checked);
                });
                
                groupHeader.insertBefore(checkbox, groupHeader.firstChild);
            }
        });
        
        // Add select all button
        this.addSelectAllButton();
    }
    
    /**
     * Remove selection checkboxes
     */
    removeSelectionCheckboxes() {
        document.querySelectorAll('.group-checkbox').forEach(checkbox => {
            checkbox.remove();
        });
        
        document.getElementById('select-all-button')?.remove();
    }
    
    /**
     * Add select all button
     */
    addSelectAllButton() {
        const toolbar = document.getElementById('batch-toolbar');
        if (toolbar && !document.getElementById('select-all-button')) {
            const selectAllDiv = document.createElement('div');
            selectAllDiv.innerHTML = `
                <button type="button" class="btn btn-outline-primary btn-sm" id="select-all-button">
                    <i class="fas fa-check-double me-1"></i> Select All
                </button>
            `;
            
            const buttonGroup = toolbar.querySelector('.btn-group');
            toolbar.insertBefore(selectAllDiv, buttonGroup);
            
            document.getElementById('select-all-button').addEventListener('click', () => {
                this.selectAll();
            });
        }
    }
    
    /**
     * Toggle selection for an entire photo group
     */
    toggleGroupSelection(groupCard, selected) {
        const groupData = this.getGroupDataFromCard(groupCard);
        if (!groupData) return;
        
        groupData.photos.forEach(photo => {
            if (selected) {
                this.selectedPhotos.add(photo.id);
            } else {
                this.selectedPhotos.delete(photo.id);
            }
        });
        
        this.updateSelectedCount();
        this.state.set('batch.selectedPhotos', Array.from(this.selectedPhotos));
    }
    
    /**
     * Select all photos
     */
    selectAll() {
        document.querySelectorAll('.group-checkbox').forEach(checkbox => {
            checkbox.checked = true;
            this.toggleGroupSelection(checkbox.closest('.photo-group-card'), true);
        });
    }
    
    /**
     * Update selected count display
     */
    updateSelectedCount() {
        const countElement = document.getElementById('selected-count');
        if (countElement) {
            countElement.textContent = this.selectedPhotos.size;
        }
        
        // Enable/disable batch operation buttons
        const hasSelection = this.selectedPhotos.size > 0;
        ['batch-update-labels', 'batch-reprocess', 'batch-delete'].forEach(id => {
            const button = document.getElementById(id);
            if (button) {
                button.disabled = !hasSelection;
            }
        });
    }
    
    /**
     * Show update labels modal for selected photos
     */
    async showUpdateLabelsModal() {
        if (this.selectedPhotos.size === 0) return;
        
        const modal = new bootstrap.Modal(document.getElementById('batch-update-modal') || this.createUpdateLabelsModal());
        modal.show();
    }
    
    /**
     * Create update labels modal
     */
    createUpdateLabelsModal() {
        const modalHtml = `
            <div class="modal fade" id="batch-update-modal" tabindex="-1">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Update Labels</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <p>Update bib number for <span id="update-count">${this.selectedPhotos.size}</span> selected photos:</p>
                            <div class="mb-3">
                                <label for="batch-bib-number" class="form-label">New Bib Number</label>
                                <input type="number" class="form-control" id="batch-bib-number" 
                                       min="1" max="99999" placeholder="Enter bib number">
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                            <button type="button" class="btn btn-primary" id="confirm-batch-update">
                                Update Labels
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Bind confirm button
        document.getElementById('confirm-batch-update').addEventListener('click', () => {
            this.executeBatchUpdate();
        });
        
        return document.getElementById('batch-update-modal');
    }
    
    /**
     * Execute batch label update
     */
    async executeBatchUpdate() {
        const bibNumber = document.getElementById('batch-bib-number').value;
        if (!bibNumber) {
            this.state.addNotification('Please enter a bib number', 'error');
            return;
        }
        
        try {
            const response = await fetch(`${this.state.api.baseUrl}/batch/update-labels`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    photo_ids: Array.from(this.selectedPhotos),
                    bib_number: bibNumber
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                this.state.addNotification(
                    `Updated ${result.success_count} photos successfully`, 
                    'success'
                );
                
                // Close modal and refresh view
                bootstrap.Modal.getInstance(document.getElementById('batch-update-modal')).hide();
                this.exitSelectionMode();
                
                // Trigger photo refresh
                if (window.photoProcessor) {
                    window.photoProcessor.refreshResults();
                }
            } else {
                const error = await response.json();
                this.state.addNotification(`Update failed: ${error.detail}`, 'error');
            }
        } catch (error) {
            this.state.addNotification('Network error during batch update', 'error');
        }
    }
    
    /**
     * Reprocess selected photos
     */
    async reprocessSelected() {
        if (this.selectedPhotos.size === 0) return;
        
        if (!confirm(`Reprocess ${this.selectedPhotos.size} photos? This will re-run OCR detection.`)) {
            return;
        }
        
        try {
            const response = await fetch(`${this.state.api.baseUrl}/batch/reprocess`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    photo_ids: Array.from(this.selectedPhotos),
                    force: false
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                this.state.addNotification(
                    `Queued ${result.success_count} photos for reprocessing`, 
                    'success'
                );
                this.exitSelectionMode();
            } else {
                const error = await response.json();
                this.state.addNotification(`Reprocess failed: ${error.detail}`, 'error');
            }
        } catch (error) {
            this.state.addNotification('Network error during reprocessing', 'error');
        }
    }
    
    /**
     * Show delete confirmation modal
     */
    showDeleteConfirmModal() {
        if (this.selectedPhotos.size === 0) return;
        
        const confirmed = confirm(
            `⚠️ DELETE ${this.selectedPhotos.size} photos?\n\n` +
            `This action cannot be undone. The photos will be permanently removed from your account.`
        );
        
        if (confirmed) {
            this.executeDelete();
        }
    }
    
    /**
     * Execute photo deletion
     */
    async executeDelete() {
        try {
            const response = await fetch(`${this.state.api.baseUrl}/batch/delete`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    photo_ids: Array.from(this.selectedPhotos),
                    confirm: true
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                this.state.addNotification(
                    `Deleted ${result.success_count} photos successfully`, 
                    'success'
                );
                
                this.exitSelectionMode();
                
                // Trigger photo refresh
                if (window.photoProcessor) {
                    window.photoProcessor.refreshResults();
                }
            } else {
                const error = await response.json();
                this.state.addNotification(`Delete failed: ${error.detail}`, 'error');
            }
        } catch (error) {
            this.state.addNotification('Network error during deletion', 'error');
        }
    }
    
    /**
     * Get operation history
     */
    async getOperationHistory() {
        try {
            const response = await fetch(`${this.state.api.baseUrl}/batch/operations`);
            
            if (response.ok) {
                return await response.json();
            } else {
                console.error('Failed to fetch operation history');
                return [];
            }
        } catch (error) {
            console.error('Error fetching operation history:', error);
            return [];
        }
    }
    
    /**
     * Undo a batch operation
     */
    async undoOperation(operationId) {
        try {
            const response = await fetch(`${this.state.api.baseUrl}/batch/undo/${operationId}`, {
                method: 'POST'
            });
            
            if (response.ok) {
                const result = await response.json();
                this.state.addNotification(result.message, 'success');
                
                // Refresh view
                if (window.photoProcessor) {
                    window.photoProcessor.refreshResults();
                }
            } else {
                const error = await response.json();
                this.state.addNotification(`Undo failed: ${error.detail}`, 'error');
            }
        } catch (error) {
            this.state.addNotification('Network error during undo', 'error');
        }
    }
    
    /**
     * Show operation history modal
     */
    async showOperationHistory() {
        const operations = await this.getOperationHistory();
        
        const modalHtml = `
            <div class="modal fade" id="operation-history-modal" tabindex="-1">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">Operation History</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="table-responsive">
                                <table class="table table-sm">
                                    <thead>
                                        <tr>
                                            <th>Operation</th>
                                            <th>Affected</th>
                                            <th>Success</th>
                                            <th>Errors</th>
                                            <th>Date</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${operations.map(op => `
                                            <tr>
                                                <td>${this.formatOperationType(op.operation_type)}</td>
                                                <td>${op.affected_count}</td>
                                                <td><span class="text-success">${op.success_count}</span></td>
                                                <td><span class="text-danger">${op.error_count}</span></td>
                                                <td>${new Date(op.created_at).toLocaleString()}</td>
                                                <td>
                                                    ${op.can_undo && !op.undone_at ? 
                                                        `<button class="btn btn-sm btn-outline-warning" onclick="window.batchOps.undoOperation(${op.id})">
                                                            <i class="fas fa-undo"></i> Undo
                                                        </button>` : 
                                                        op.undone_at ? '<span class="text-muted">Undone</span>' : '-'
                                                    }
                                                </td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Remove existing modal if present
        document.getElementById('operation-history-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        const modal = new bootstrap.Modal(document.getElementById('operation-history-modal'));
        modal.show();
    }
    
    /**
     * Format operation type for display
     */
    formatOperationType(type) {
        const typeMap = {
            'update_labels': 'Update Labels',
            'delete_photos': 'Delete Photos',
            'reprocess': 'Reprocess',
            'move_group': 'Move Group'
        };
        return typeMap[type] || type;
    }
    
    /**
     * Get group data from card element
     */
    getGroupDataFromCard(card) {
        // This would need to be integrated with the main PhotoProcessor class
        // to access the actual photo data
        const groupHeader = card.querySelector('.card-header h6');
        if (groupHeader) {
            const bibNumber = groupHeader.textContent.replace('Bib Number: ', '').trim();
            // Return mock data for now - would need integration with main app
            return {
                bib_number: bibNumber,
                photos: [] // Would be populated from main app state
            };
        }
        return null;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    if (window.stateManager) {
        window.batchOps = new BatchOperations(window.stateManager);
    }
});