/**
 * BatchService - Business logic for bulk photo operations
 * Extracted from batch-operations.js UI/business logic separation
 * Handles API interactions and orchestration for bulk processing
 */

import { BaseService } from './BaseService.js';

export class BatchService extends BaseService {
    constructor(eventBus, options = {}) {
        super(eventBus, {
            name: 'BatchService',
            enableValidation: true,
            enableProgress: true,
            maxBatchSize: 1000,
            enableRetry: true,
            retryAttempts: 3,
            ...options
        });

        // Current batch operation state
        this.currentOperation = null;
        this.selectedPhotos = new Set();
        this.isSelectionMode = false;

        // Operation progress tracking
        this.operationProgress = {
            total: 0,
            completed: 0,
            failed: 0,
            inProgress: false
        };

        // Service dependencies
        this.apiService = null;
        this.stateManagerService = null;
        this.notificationService = null;
        this.processingService = null;
    }

    /**
     * Initialize batch service
     */
    async onInitialize() {
        // Get service dependencies
        this.apiService = this.serviceContainer?.get('apiService');
        this.stateManagerService = this.serviceContainer?.get('stateManagerService');
        this.notificationService = this.serviceContainer?.get('notificationService');
        this.processingService = this.serviceContainer?.get('processingService');

        // Setup event listeners
        this.setupEventListeners();

        // Restore state if available
        this.restoreState();

        this.log('BatchService initialized');
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        // Listen to batch operation requests
        this.on('batch:operation:request', this.handleBatchOperationRequest.bind(this));
        this.on('batch:selection:toggle', this.handleSelectionToggle.bind(this));
        this.on('batch:selection:clear', this.handleSelectionClear.bind(this));
        this.on('batch:selection:all', this.handleSelectAll.bind(this));

        // Listen to photo updates to update selection
        this.on('photos:groups:updated', this.handlePhotoGroupsUpdated.bind(this));
        this.on('photo:deleted', this.handlePhotoDeleted.bind(this));

        // Listen to state changes
        this.on('state:batch:selection:updated', this.handleStateSelectionUpdated.bind(this));
    }

    /**
     * Restore state from StateManagerService
     * @private
     */
    restoreState() {
        if (this.stateManagerService) {
            const batchState = this.stateManagerService.get('batch') || {};
            
            if (batchState.selectedPhotos) {
                this.selectedPhotos = new Set(batchState.selectedPhotos);
            }
            
            this.isSelectionMode = batchState.isSelectionMode || false;
            this.currentOperation = batchState.currentOperation || null;

            if (this.selectedPhotos.size > 0) {
                this.emitSelectionUpdate();
            }
        }
    }

    /**
     * Get current selection
     */
    getSelectedPhotos() {
        return Array.from(this.selectedPhotos);
    }

    /**
     * Get selection count
     */
    getSelectionCount() {
        return this.selectedPhotos.size;
    }

    /**
     * Check if in selection mode
     */
    isInSelectionMode() {
        return this.isSelectionMode;
    }

    /**
     * Toggle selection mode
     */
    toggleSelectionMode() {
        this.isSelectionMode = !this.isSelectionMode;
        
        if (!this.isSelectionMode) {
            this.clearSelection();
        }

        this.updateBatchState();
        this.emit('batch:mode:changed', { 
            isSelectionMode: this.isSelectionMode,
            selectedCount: this.selectedPhotos.size
        });

        this.log('Selection mode toggled', { isSelectionMode: this.isSelectionMode });
    }

    /**
     * Exit selection mode
     */
    exitSelectionMode() {
        this.isSelectionMode = false;
        this.clearSelection();
        this.currentOperation = null;

        this.updateBatchState();
        this.emit('batch:mode:exited');

        this.log('Selection mode exited');
    }

    /**
     * Toggle photo selection
     */
    togglePhotoSelection(photoId) {
        if (this.selectedPhotos.has(photoId)) {
            this.selectedPhotos.delete(photoId);
        } else {
            this.selectedPhotos.add(photoId);
        }

        this.updateBatchState();
        this.emitSelectionUpdate();

        this.log('Photo selection toggled', { photoId, selected: this.selectedPhotos.has(photoId) });
    }

    /**
     * Toggle group selection
     */
    toggleGroupSelection(groupData, selected = null) {
        if (!groupData?.photos) return;

        const photoIds = groupData.photos.map(photo => photo.id);
        
        // Determine if we should select or deselect
        const shouldSelect = selected !== null ? selected : 
            !photoIds.every(id => this.selectedPhotos.has(id));

        if (shouldSelect) {
            photoIds.forEach(id => this.selectedPhotos.add(id));
        } else {
            photoIds.forEach(id => this.selectedPhotos.delete(id));
        }

        this.updateBatchState();
        this.emitSelectionUpdate();

        this.log('Group selection toggled', { 
            groupKey: groupData.key, 
            photoCount: photoIds.length, 
            selected: shouldSelect 
        });
    }

    /**
     * Select all available photos
     */
    selectAll() {
        const photos = this.getAllAvailablePhotos();
        
        photos.forEach(photo => {
            this.selectedPhotos.add(photo.id);
        });

        this.updateBatchState();
        this.emitSelectionUpdate();

        this.log('All photos selected', { count: photos.length });
    }

    /**
     * Clear all selections
     */
    clearSelection() {
        this.selectedPhotos.clear();
        this.updateBatchState();
        this.emitSelectionUpdate();

        this.log('Selection cleared');
    }

    /**
     * Execute batch label update
     */
    async executeBatchUpdate(newBibNumber) {
        if (this.selectedPhotos.size === 0) {
            throw new Error('No photos selected for batch update');
        }

        if (!this.validateBibNumber(newBibNumber)) {
            throw new Error('Invalid bib number provided');
        }

        try {
            this.startBatchOperation('update_labels', this.selectedPhotos.size);

            const result = await this.apiService.post('/batch/update-labels', {
                photo_ids: this.getSelectedPhotos(),
                bib_number: newBibNumber
            });

            this.completeBatchOperation(result);

            // Emit success event
            this.emit('batch:update:success', {
                photoCount: result.success_count,
                bibNumber: newBibNumber
            });

            // Show notification
            if (this.notificationService) {
                this.notificationService.show(
                    `Updated ${result.success_count} photos successfully`,
                    'success'
                );
            }

            // Clear selection after successful operation
            this.exitSelectionMode();

            // Trigger photo refresh
            this.emit('batch:refresh:required');

            this.log('Batch update completed', result);
            return result;

        } catch (error) {
            this.failBatchOperation(error);
            
            const errorMessage = error.message || 'Unknown error during batch update';
            this.error('Batch update failed:', error);
            
            if (this.notificationService) {
                this.notificationService.show(`Update failed: ${errorMessage}`, 'error');
            }
            
            throw error;
        }
    }

    /**
     * Execute batch reprocessing
     */
    async executeBatchReprocess(force = false) {
        if (this.selectedPhotos.size === 0) {
            throw new Error('No photos selected for reprocessing');
        }

        try {
            this.startBatchOperation('reprocess', this.selectedPhotos.size);

            const result = await this.apiService.post('/batch/reprocess', {
                photo_ids: this.getSelectedPhotos(),
                force: force
            });

            this.completeBatchOperation(result);

            // Emit success event
            this.emit('batch:reprocess:success', {
                photoCount: result.success_count
            });

            // Show notification
            if (this.notificationService) {
                this.notificationService.show(
                    `Queued ${result.success_count} photos for reprocessing`,
                    'success'
                );
            }

            // Clear selection after successful operation
            this.exitSelectionMode();

            this.log('Batch reprocess completed', result);
            return result;

        } catch (error) {
            this.failBatchOperation(error);
            
            const errorMessage = error.message || 'Unknown error during reprocessing';
            this.error('Batch reprocess failed:', error);
            
            if (this.notificationService) {
                this.notificationService.show(`Reprocess failed: ${errorMessage}`, 'error');
            }
            
            throw error;
        }
    }

    /**
     * Execute batch deletion
     */
    async executeBatchDelete(confirmed = false) {
        if (this.selectedPhotos.size === 0) {
            throw new Error('No photos selected for deletion');
        }

        if (!confirmed) {
            throw new Error('Deletion must be explicitly confirmed');
        }

        try {
            this.startBatchOperation('delete', this.selectedPhotos.size);

            const result = await this.apiService.post('/batch/delete', {
                photo_ids: this.getSelectedPhotos(),
                confirm: true
            });

            this.completeBatchOperation(result);

            // Emit success event
            this.emit('batch:delete:success', {
                photoCount: result.success_count
            });

            // Show notification
            if (this.notificationService) {
                this.notificationService.show(
                    `Deleted ${result.success_count} photos successfully`,
                    'success'
                );
            }

            // Clear selection after successful operation
            this.exitSelectionMode();

            // Trigger photo refresh
            this.emit('batch:refresh:required');

            this.log('Batch delete completed', result);
            return result;

        } catch (error) {
            this.failBatchOperation(error);
            
            const errorMessage = error.message || 'Unknown error during deletion';
            this.error('Batch delete failed:', error);
            
            if (this.notificationService) {
                this.notificationService.show(`Delete failed: ${errorMessage}`, 'error');
            }
            
            throw error;
        }
    }

    /**
     * Validate bib number
     * @private
     */
    validateBibNumber(bibNumber) {
        const num = parseInt(bibNumber, 10);
        return !isNaN(num) && num >= 1 && num <= 99999;
    }

    /**
     * Get all available photos
     * @private
     */
    getAllAvailablePhotos() {
        if (!this.stateManagerService) return [];

        const groupedPhotos = this.stateManagerService.get('photos.groupedPhotos') || [];
        const allPhotos = [];

        // Flatten grouped photos
        if (Array.isArray(groupedPhotos)) {
            groupedPhotos.forEach(group => {
                if (group.photos) {
                    allPhotos.push(...group.photos);
                }
            });
        }

        return allPhotos;
    }

    /**
     * Start batch operation tracking
     * @private
     */
    startBatchOperation(operationType, totalCount) {
        this.currentOperation = operationType;
        this.operationProgress = {
            total: totalCount,
            completed: 0,
            failed: 0,
            inProgress: true,
            startTime: new Date()
        };

        this.updateBatchState();
        this.emit('batch:operation:started', {
            operation: operationType,
            total: totalCount
        });

        this.log('Batch operation started', { operation: operationType, total: totalCount });
    }

    /**
     * Complete batch operation
     * @private
     */
    completeBatchOperation(result) {
        this.operationProgress.completed = result.success_count || 0;
        this.operationProgress.failed = result.failed_count || 0;
        this.operationProgress.inProgress = false;
        this.operationProgress.endTime = new Date();

        this.emit('batch:operation:completed', {
            operation: this.currentOperation,
            progress: { ...this.operationProgress },
            result
        });

        this.currentOperation = null;
        this.updateBatchState();
    }

    /**
     * Fail batch operation
     * @private
     */
    failBatchOperation(error) {
        this.operationProgress.inProgress = false;
        this.operationProgress.endTime = new Date();
        this.operationProgress.error = error.message;

        this.emit('batch:operation:failed', {
            operation: this.currentOperation,
            progress: { ...this.operationProgress },
            error
        });

        this.currentOperation = null;
        this.updateBatchState();
    }

    /**
     * Update batch state in StateManagerService
     * @private
     */
    updateBatchState() {
        if (this.stateManagerService) {
            this.stateManagerService.update({
                'batch.selectedPhotos': this.getSelectedPhotos(),
                'batch.isSelectionMode': this.isSelectionMode,
                'batch.currentOperation': this.currentOperation
            });
        }
    }

    /**
     * Emit selection update event
     * @private
     */
    emitSelectionUpdate() {
        this.emit('batch:selection:updated', {
            selectedPhotos: this.getSelectedPhotos(),
            selectedCount: this.getSelectionCount(),
            isSelectionMode: this.isSelectionMode
        });
    }

    // Event Handlers

    /**
     * Handle batch operation requests
     * @private
     */
    async handleBatchOperationRequest(data) {
        const { operation, ...params } = data;

        try {
            switch (operation) {
                case 'update_labels':
                    await this.executeBatchUpdate(params.bibNumber);
                    break;
                case 'reprocess':
                    await this.executeBatchReprocess(params.force);
                    break;
                case 'delete':
                    await this.executeBatchDelete(params.confirmed);
                    break;
                default:
                    this.warn('Unknown batch operation requested:', operation);
            }
        } catch (error) {
            this.error('Batch operation request failed:', error);
        }
    }

    /**
     * Handle selection toggle
     * @private
     */
    handleSelectionToggle(data) {
        if (data.photoId) {
            this.togglePhotoSelection(data.photoId);
        } else if (data.groupData) {
            this.toggleGroupSelection(data.groupData, data.selected);
        }
    }

    /**
     * Handle selection clear
     * @private
     */
    handleSelectionClear() {
        this.clearSelection();
    }

    /**
     * Handle select all
     * @private
     */
    handleSelectAll() {
        this.selectAll();
    }

    /**
     * Handle photo groups update
     * @private
     */
    handlePhotoGroupsUpdated(data) {
        // Remove selections for photos that no longer exist
        const currentPhotos = new Set();
        
        if (data.groups) {
            data.groups.forEach(group => {
                if (group.photos) {
                    group.photos.forEach(photo => currentPhotos.add(photo.id));
                }
            });
        }

        // Remove selected photos that no longer exist
        const toRemove = [];
        for (const photoId of this.selectedPhotos) {
            if (!currentPhotos.has(photoId)) {
                toRemove.push(photoId);
            }
        }

        if (toRemove.length > 0) {
            toRemove.forEach(id => this.selectedPhotos.delete(id));
            this.updateBatchState();
            this.emitSelectionUpdate();
            this.log('Removed missing photos from selection', { count: toRemove.length });
        }
    }

    /**
     * Handle individual photo deletion
     * @private
     */
    handlePhotoDeleted(data) {
        if (data.photoId && this.selectedPhotos.has(data.photoId)) {
            this.selectedPhotos.delete(data.photoId);
            this.updateBatchState();
            this.emitSelectionUpdate();
        }
    }

    /**
     * Handle state selection updates (for external state changes)
     * @private
     */
    handleStateSelectionUpdated(data) {
        // Sync with external state changes
        if (data.value && Array.isArray(data.value)) {
            this.selectedPhotos = new Set(data.value);
            this.emitSelectionUpdate();
        }
    }

    /**
     * Get operation progress
     */
    getOperationProgress() {
        return { ...this.operationProgress };
    }

    /**
     * Get service statistics
     */
    getStats() {
        return {
            selection: {
                isSelectionMode: this.isSelectionMode,
                selectedCount: this.getSelectionCount(),
                currentOperation: this.currentOperation
            },
            progress: this.getOperationProgress(),
            limits: {
                maxBatchSize: this.options.maxBatchSize
            },
            operations: {
                retryEnabled: this.options.enableRetry,
                retryAttempts: this.options.retryAttempts
            }
        };
    }

    /**
     * Cleanup service
     */
    async cleanup() {
        // Clear any ongoing operations
        this.currentOperation = null;
        this.selectedPhotos.clear();
        this.isSelectionMode = false;

        // Reset progress
        this.operationProgress = {
            total: 0,
            completed: 0,
            failed: 0,
            inProgress: false
        };

        await super.cleanup();
    }
}