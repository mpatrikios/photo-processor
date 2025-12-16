/**
 * PhotoGroup - Photo grouping component by bib numbers
 * Displays photos organized by detected bib numbers with group controls
 * Eliminates duplication in bib number grouping logic
 */

import { BaseComponent } from '../BaseComponent.js';
import { PhotoGrid } from './PhotoGrid.js';

export class PhotoGroup extends BaseComponent {
    constructor(containerSelector, options = {}) {
        super(containerSelector, {
            name: 'PhotoGroup',
            showGroupHeaders: true,
            showGroupCounts: true,
            showGroupActions: true,
            allowGroupCollapse: true,
            allowGroupSelection: false,
            sortGroups: 'bib_number', // bib_number, count, name
            sortDirection: 'asc',
            gridOptions: {
                gridColumns: 4,
                photoSize: 'medium',
                showSelection: false
            },
            ...options
        });

        // Group data and state
        this.photoGroups = new Map(); // Map<groupKey, groupData>
        this.collapsedGroups = new Set();
        this.selectedGroups = new Set();
        this.photoGrids = new Map(); // Map<groupKey, PhotoGrid>

        // UI elements
        this.groupsContainer = null;
    }

    async onRender() {
        if (!this.element) {
            throw new Error('Container element required for PhotoGroup');
        }

        this.createGroupUI();
        this.updateDisplay();
        this.log('Photo group rendered');
    }

    /**
     * Create photo group UI
     * @private
     */
    createGroupUI() {
        const html = `
            <div class="photo-groups">
                <div class="photo-groups-container">
                    <!-- Groups will be rendered here -->
                </div>
                <div class="photo-groups-empty d-none">
                    <div class="text-center py-4">
                        <i class="fas fa-layer-group fa-3x text-muted mb-3"></i>
                        <h5 class="text-muted">No photo groups</h5>
                        <p class="text-muted mb-0">Groups will appear here once photos are organized</p>
                    </div>
                </div>
            </div>
        `;

        this.setHTML(html);

        // Cache element references
        this.groupsContainer = this.$('.photo-groups-container');
        this.emptyState = this.$('.photo-groups-empty');
    }

    setupEventListeners() {
        // Listen for photo-related events
        this.on('photos:grouped', this.handlePhotosGrouped);
        this.on('photos:ungrouped', this.handlePhotosUngrouped);
        this.on('group:updated', this.handleGroupUpdated);
    }

    /**
     * Handle photos grouped event
     * @private
     */
    handlePhotosGrouped = (data) => {
        this.setGroups(data.groups || data.photoGroups || {});
    };

    /**
     * Handle photos ungrouped event
     * @private
     */
    handlePhotosUngrouped = (data) => {
        if (data.groupKey) {
            this.removeGroup(data.groupKey);
        } else {
            this.clearGroups();
        }
    };

    /**
     * Handle group updated event
     * @private
     */
    handleGroupUpdated = (data) => {
        if (data.groupKey && data.photos) {
            this.updateGroup(data.groupKey, data.photos, data.metadata);
        }
    };

    /**
     * Set photo groups
     */
    setGroups(groups) {
        this.clearGroups();
        
        if (Array.isArray(groups)) {
            // Convert array to map
            groups.forEach((group, index) => {
                const key = group.key || group.bib_number || group.group_id || index.toString();
                this.photoGroups.set(key, group);
            });
        } else if (groups instanceof Map) {
            this.photoGroups = new Map(groups);
        } else if (typeof groups === 'object') {
            // Convert object to map
            Object.entries(groups).forEach(([key, group]) => {
                this.photoGroups.set(key, group);
            });
        }

        this.updateDisplay();
        this.emit('photogroup:groups:updated', {
            groupCount: this.photoGroups.size,
            totalPhotos: this.getTotalPhotoCount()
        });

        this.log('Photo groups updated', { count: this.photoGroups.size });
    }

    /**
     * Add or update a group
     */
    updateGroup(groupKey, photos, metadata = {}) {
        const existingGroup = this.photoGroups.get(groupKey);
        
        const groupData = {
            key: groupKey,
            photos: Array.isArray(photos) ? photos : [],
            ...metadata,
            ...existingGroup // Preserve existing metadata
        };

        this.photoGroups.set(groupKey, groupData);
        this.renderGroup(groupKey, groupData);

        this.emit('photogroup:group:updated', {
            groupKey,
            photoCount: groupData.photos.length
        });
    }

    /**
     * Remove a group
     */
    removeGroup(groupKey) {
        const removed = this.photoGroups.delete(groupKey);
        if (removed) {
            // Remove from UI
            const groupElement = this.$(`[data-group-key="${groupKey}"]`);
            if (groupElement) {
                groupElement.remove();
            }

            // Cleanup photo grid
            if (this.photoGrids.has(groupKey)) {
                const grid = this.photoGrids.get(groupKey);
                grid.destroy();
                this.photoGrids.delete(groupKey);
            }

            // Remove from selections and collapsed state
            this.selectedGroups.delete(groupKey);
            this.collapsedGroups.delete(groupKey);

            this.emit('photogroup:group:removed', { groupKey });
            this.checkEmptyState();
        }
    }

    /**
     * Clear all groups
     */
    clearGroups() {
        // Destroy all photo grids
        for (const grid of this.photoGrids.values()) {
            grid.destroy();
        }

        this.photoGroups.clear();
        this.photoGrids.clear();
        this.selectedGroups.clear();
        this.collapsedGroups.clear();

        if (this.groupsContainer) {
            this.groupsContainer.innerHTML = '';
        }

        this.emit('photogroup:groups:cleared');
        this.checkEmptyState();
    }

    /**
     * Update display based on current state
     * @private
     */
    updateDisplay() {
        if (this.photoGroups.size === 0) {
            this.showEmptyState();
        } else {
            this.showPhotoGroups();
        }
    }

    /**
     * Show empty state
     * @private
     */
    showEmptyState() {
        if (this.groupsContainer) {
            this.groupsContainer.innerHTML = '';
        }
        this.emptyState?.classList.remove('d-none');
    }

    /**
     * Show photo groups
     * @private
     */
    showPhotoGroups() {
        this.emptyState?.classList.add('d-none');
        
        if (!this.groupsContainer) return;

        // Sort groups
        const sortedGroups = this.getSortedGroups();
        
        // Render all groups
        this.groupsContainer.innerHTML = '';
        sortedGroups.forEach(([groupKey, groupData]) => {
            this.renderGroup(groupKey, groupData);
        });

        this.setupGroupEvents();
    }

    /**
     * Get sorted groups based on options
     * @private
     */
    getSortedGroups() {
        const groups = Array.from(this.photoGroups.entries());
        
        return groups.sort(([keyA, dataA], [keyB, dataB]) => {
            let valueA, valueB;
            
            switch (this.options.sortGroups) {
                case 'count':
                    valueA = dataA.photos?.length || 0;
                    valueB = dataB.photos?.length || 0;
                    break;
                case 'name':
                    valueA = (dataA.name || dataA.custom_label || keyA).toLowerCase();
                    valueB = (dataB.name || dataB.custom_label || keyB).toLowerCase();
                    break;
                case 'bib_number':
                default:
                    // Try to parse as numbers, fallback to string comparison
                    const numA = parseInt(keyA);
                    const numB = parseInt(keyB);
                    if (!isNaN(numA) && !isNaN(numB)) {
                        valueA = numA;
                        valueB = numB;
                    } else {
                        valueA = keyA.toLowerCase();
                        valueB = keyB.toLowerCase();
                    }
                    break;
            }
            
            const result = valueA < valueB ? -1 : valueA > valueB ? 1 : 0;
            return this.options.sortDirection === 'desc' ? -result : result;
        });
    }

    /**
     * Render individual group
     * @private
     */
    renderGroup(groupKey, groupData) {
        const isCollapsed = this.collapsedGroups.has(groupKey);
        const isSelected = this.selectedGroups.has(groupKey);
        const photoCount = groupData.photos?.length || 0;
        
        const groupHTML = `
            <div class="photo-group mb-4 ${isSelected ? 'border border-primary' : ''}" data-group-key="${groupKey}">
                ${this.options.showGroupHeaders ? this.createGroupHeaderHTML(groupKey, groupData, isCollapsed) : ''}
                
                <div class="photo-group-content ${isCollapsed ? 'd-none' : ''}">
                    <div class="photo-group-grid" data-grid-container="${groupKey}">
                        <!-- PhotoGrid will be mounted here -->
                    </div>
                    
                    ${this.options.showGroupActions && photoCount > 0 ? this.createGroupActionsHTML(groupKey, groupData) : ''}
                </div>
            </div>
        `;

        // Find or create group container
        let groupElement = this.$(`[data-group-key="${groupKey}"]`);
        if (groupElement) {
            groupElement.outerHTML = groupHTML;
        } else {
            this.groupsContainer.insertAdjacentHTML('beforeend', groupHTML);
        }

        // Initialize PhotoGrid for this group
        this.initializeGroupGrid(groupKey, groupData);
    }

    /**
     * Create group header HTML
     * @private
     */
    createGroupHeaderHTML(groupKey, groupData, isCollapsed) {
        const photoCount = groupData.photos?.length || 0;
        const displayName = this.getGroupDisplayName(groupKey, groupData);
        
        return `
            <div class="photo-group-header d-flex justify-content-between align-items-center p-3 bg-light border-bottom">
                <div class="group-info d-flex align-items-center">
                    ${this.options.allowGroupCollapse ? `
                        <button type="button" 
                                class="btn btn-sm btn-outline-secondary me-2 group-toggle-btn"
                                data-group-key="${groupKey}">
                            <i class="fas fa-chevron-${isCollapsed ? 'right' : 'down'}"></i>
                        </button>
                    ` : ''}
                    
                    ${this.options.allowGroupSelection ? `
                        <div class="form-check me-3">
                            <input class="form-check-input group-select-cb" 
                                   type="checkbox" 
                                   ${this.selectedGroups.has(groupKey) ? 'checked' : ''}
                                   data-group-key="${groupKey}">
                        </div>
                    ` : ''}
                    
                    <div class="group-title">
                        <h5 class="mb-0">${this.escapeHtml(displayName)}</h5>
                        ${this.options.showGroupCounts ? `
                            <small class="text-muted">${photoCount} photo${photoCount !== 1 ? 's' : ''}</small>
                        ` : ''}
                    </div>
                </div>
                
                <div class="group-header-actions">
                    <div class="btn-group btn-group-sm">
                        <button type="button" 
                                class="btn btn-outline-primary group-view-btn"
                                data-group-key="${groupKey}"
                                title="View group">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button type="button" 
                                class="btn btn-outline-secondary group-export-btn"
                                data-group-key="${groupKey}"
                                title="Export group">
                            <i class="fas fa-download"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Create group actions HTML
     * @private
     */
    createGroupActionsHTML(groupKey, groupData) {
        const photoCount = groupData.photos?.length || 0;
        
        return `
            <div class="photo-group-actions p-3 border-top bg-light">
                <div class="d-flex justify-content-between align-items-center">
                    <div class="group-stats text-muted small">
                        ${photoCount} photo${photoCount !== 1 ? 's' : ''} in this group
                    </div>
                    
                    <div class="group-action-buttons">
                        <div class="btn-group btn-group-sm">
                            <button type="button" 
                                    class="btn btn-outline-primary group-select-all-btn"
                                    data-group-key="${groupKey}">
                                <i class="fas fa-check-square me-1"></i>Select All
                            </button>
                            <button type="button" 
                                    class="btn btn-outline-secondary group-edit-btn"
                                    data-group-key="${groupKey}">
                                <i class="fas fa-edit me-1"></i>Edit Group
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Initialize PhotoGrid for a group
     * @private
     */
    async initializeGroupGrid(groupKey, groupData) {
        const gridContainer = this.$(`[data-grid-container="${groupKey}"]`);
        if (!gridContainer) return;

        // Destroy existing grid
        if (this.photoGrids.has(groupKey)) {
            const existingGrid = this.photoGrids.get(groupKey);
            existingGrid.destroy();
        }

        // Create new PhotoGrid
        const gridOptions = {
            ...this.options.gridOptions,
            emptyMessage: `No photos in this group`
        };

        const photoGrid = new PhotoGrid(gridContainer, gridOptions);
        
        if (this.services) {
            photoGrid.setServices(this.services);
        }

        await photoGrid.initialize();

        // Set photos for this group
        if (groupData.photos && groupData.photos.length > 0) {
            photoGrid.setPhotos(groupData.photos);
        }

        // Store reference
        this.photoGrids.set(groupKey, photoGrid);

        // Forward events with group context
        this.forwardGridEvents(groupKey, photoGrid);
    }

    /**
     * Forward PhotoGrid events with group context
     * @private
     */
    forwardGridEvents(groupKey, photoGrid) {
        photoGrid.on('photogrid:photo:clicked', (data) => {
            this.emit('photogroup:photo:clicked', {
                ...data,
                groupKey
            });
        });

        photoGrid.on('photogrid:selection:changed', (data) => {
            this.emit('photogroup:selection:changed', {
                ...data,
                groupKey
            });
        });

        photoGrid.on('photogrid:photo:edit', (data) => {
            this.emit('photogroup:photo:edit', {
                ...data,
                groupKey
            });
        });

        photoGrid.on('photogrid:photo:delete', (data) => {
            this.emit('photogroup:photo:delete', {
                ...data,
                groupKey
            });
        });
    }

    /**
     * Setup group event listeners
     * @private
     */
    setupGroupEvents() {
        // Toggle collapse buttons
        if (this.options.allowGroupCollapse) {
            const toggleButtons = this.$$('.group-toggle-btn');
            toggleButtons.forEach(btn => {
                this.addEventListener(btn, 'click', (event) => {
                    event.preventDefault();
                    const groupKey = btn.dataset.groupKey;
                    this.toggleGroup(groupKey);
                });
            });
        }

        // Group selection checkboxes
        if (this.options.allowGroupSelection) {
            const selectBoxes = this.$$('.group-select-cb');
            selectBoxes.forEach(cb => {
                this.addEventListener(cb, 'change', (event) => {
                    const groupKey = cb.dataset.groupKey;
                    if (event.target.checked) {
                        this.selectGroup(groupKey);
                    } else {
                        this.deselectGroup(groupKey);
                    }
                });
            });
        }

        // Action buttons
        const viewButtons = this.$$('.group-view-btn');
        viewButtons.forEach(btn => {
            this.addEventListener(btn, 'click', (event) => {
                event.preventDefault();
                const groupKey = btn.dataset.groupKey;
                this.handleGroupView(groupKey);
            });
        });

        const exportButtons = this.$$('.group-export-btn');
        exportButtons.forEach(btn => {
            this.addEventListener(btn, 'click', (event) => {
                event.preventDefault();
                const groupKey = btn.dataset.groupKey;
                this.handleGroupExport(groupKey);
            });
        });

        const selectAllButtons = this.$$('.group-select-all-btn');
        selectAllButtons.forEach(btn => {
            this.addEventListener(btn, 'click', (event) => {
                event.preventDefault();
                const groupKey = btn.dataset.groupKey;
                this.selectAllInGroup(groupKey);
            });
        });

        const editButtons = this.$$('.group-edit-btn');
        editButtons.forEach(btn => {
            this.addEventListener(btn, 'click', (event) => {
                event.preventDefault();
                const groupKey = btn.dataset.groupKey;
                this.handleGroupEdit(groupKey);
            });
        });
    }

    /**
     * Toggle group collapsed state
     */
    toggleGroup(groupKey) {
        const isCollapsed = this.collapsedGroups.has(groupKey);
        
        if (isCollapsed) {
            this.expandGroup(groupKey);
        } else {
            this.collapseGroup(groupKey);
        }
    }

    /**
     * Collapse group
     */
    collapseGroup(groupKey) {
        this.collapsedGroups.add(groupKey);
        
        const groupElement = this.$(`[data-group-key="${groupKey}"]`);
        if (groupElement) {
            const content = groupElement.querySelector('.photo-group-content');
            const toggleIcon = groupElement.querySelector('.group-toggle-btn i');
            
            if (content) content.classList.add('d-none');
            if (toggleIcon) toggleIcon.className = 'fas fa-chevron-right';
        }

        this.emit('photogroup:group:collapsed', { groupKey });
    }

    /**
     * Expand group
     */
    expandGroup(groupKey) {
        this.collapsedGroups.delete(groupKey);
        
        const groupElement = this.$(`[data-group-key="${groupKey}"]`);
        if (groupElement) {
            const content = groupElement.querySelector('.photo-group-content');
            const toggleIcon = groupElement.querySelector('.group-toggle-btn i');
            
            if (content) content.classList.remove('d-none');
            if (toggleIcon) toggleIcon.className = 'fas fa-chevron-down';
        }

        this.emit('photogroup:group:expanded', { groupKey });
    }

    /**
     * Select group
     */
    selectGroup(groupKey) {
        this.selectedGroups.add(groupKey);
        this.updateGroupSelection(groupKey, true);
        
        this.emit('photogroup:group:selected', {
            groupKey,
            selectedGroups: Array.from(this.selectedGroups)
        });
    }

    /**
     * Deselect group
     */
    deselectGroup(groupKey) {
        this.selectedGroups.delete(groupKey);
        this.updateGroupSelection(groupKey, false);
        
        this.emit('photogroup:group:deselected', {
            groupKey,
            selectedGroups: Array.from(this.selectedGroups)
        });
    }

    /**
     * Update group selection UI
     * @private
     */
    updateGroupSelection(groupKey, selected) {
        const groupElement = this.$(`[data-group-key="${groupKey}"]`);
        const checkbox = groupElement?.querySelector('.group-select-cb');
        
        if (groupElement) {
            if (selected) {
                groupElement.classList.add('border', 'border-primary');
            } else {
                groupElement.classList.remove('border', 'border-primary');
            }
        }
        
        if (checkbox) {
            checkbox.checked = selected;
        }
    }

    /**
     * Select all photos in group
     */
    selectAllInGroup(groupKey) {
        const photoGrid = this.photoGrids.get(groupKey);
        if (photoGrid) {
            // Update grid options to enable selection
            photoGrid.updateOptions({ selectionMode: 'multiple' });
            
            // Select all photos
            const groupData = this.photoGroups.get(groupKey);
            if (groupData && groupData.photos) {
                groupData.photos.forEach(photo => {
                    photoGrid.selectPhoto(photo.id, false);
                });
            }
        }

        this.emit('photogroup:group:select_all', { groupKey });
    }

    /**
     * Handle group view
     * @private
     */
    handleGroupView(groupKey) {
        const groupData = this.photoGroups.get(groupKey);
        
        this.emit('photogroup:group:view', {
            groupKey,
            groupData
        });
    }

    /**
     * Handle group export
     * @private
     */
    handleGroupExport(groupKey) {
        const groupData = this.photoGroups.get(groupKey);
        
        this.emit('photogroup:group:export', {
            groupKey,
            groupData
        });
    }

    /**
     * Handle group edit
     * @private
     */
    handleGroupEdit(groupKey) {
        const groupData = this.photoGroups.get(groupKey);
        
        this.emit('photogroup:group:edit', {
            groupKey,
            groupData
        });
    }

    /**
     * Get group display name
     * @private
     */
    getGroupDisplayName(groupKey, groupData) {
        if (groupData.custom_label) {
            return groupData.custom_label;
        }
        if (groupData.name) {
            return groupData.name;
        }
        if (groupData.bib_number) {
            return `Bib #${groupData.bib_number}`;
        }
        return `Group ${groupKey}`;
    }

    /**
     * Check and update empty state
     * @private
     */
    checkEmptyState() {
        if (this.photoGroups.size === 0) {
            this.showEmptyState();
        }
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
     * Get total photo count across all groups
     */
    getTotalPhotoCount() {
        let total = 0;
        for (const groupData of this.photoGroups.values()) {
            total += groupData.photos?.length || 0;
        }
        return total;
    }

    /**
     * Get group statistics
     */
    getStats() {
        const groups = Array.from(this.photoGroups.entries());
        
        return {
            groupCount: this.photoGroups.size,
            totalPhotos: this.getTotalPhotoCount(),
            selectedGroups: this.selectedGroups.size,
            collapsedGroups: this.collapsedGroups.size,
            largestGroup: groups.reduce((max, [key, data]) => {
                const count = data.photos?.length || 0;
                return count > max.count ? { key, count } : max;
            }, { key: null, count: 0 }),
            averageGroupSize: this.photoGroups.size > 0 ? 
                this.getTotalPhotoCount() / this.photoGroups.size : 0
        };
    }

    /**
     * Set services and propagate to photo grids
     */
    setServices(services) {
        super.setServices(services);

        for (const grid of this.photoGrids.values()) {
            grid.setServices(services);
        }
    }

    /**
     * Static helper to create photo group
     */
    static create(containerSelector, options = {}) {
        const group = new PhotoGroup(containerSelector, options);
        return group;
    }

    /**
     * Static helper to create and initialize photo group
     */
    static async createAndInitialize(containerSelector, options = {}) {
        const group = new PhotoGroup(containerSelector, options);
        await group.initialize();
        return group;
    }
}