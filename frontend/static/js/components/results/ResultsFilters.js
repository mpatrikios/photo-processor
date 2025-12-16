/**
 * ResultsFilters - Photo filtering and sorting component
 * Provides search, filter, and sort controls for photo results
 * Eliminates duplication in filtering logic across different views
 */

import { BaseComponent } from '../BaseComponent.js';

export class ResultsFilters extends BaseComponent {
    constructor(containerSelector, options = {}) {
        super(containerSelector, {
            name: 'ResultsFilters',
            showSearch: true,
            showBibFilter: true,
            showLabelFilter: true,
            showConfidenceFilter: true,
            showDateFilter: false,
            showSorting: true,
            showViewOptions: true,
            showStats: true,
            debounceMs: 300,
            ...options
        });

        // Filter state
        this.filters = {
            search: '',
            bibNumbers: [],
            labels: [],
            confidenceRange: [0, 100],
            dateRange: null,
            hasLabel: null, // null, true, false
            hasDetection: null // null, true, false
        };

        // Sort state
        this.sorting = {
            field: 'filename', // filename, bib_number, confidence, date
            direction: 'asc'
        };

        // View options
        this.viewOptions = {
            gridSize: 4,
            photoSize: 'medium',
            groupBy: 'none' // none, bib_number, label, confidence
        };

        // Available options for dropdowns
        this.availableBibNumbers = [];
        this.availableLabels = [];

        // UI elements
        this.searchInput = null;
        this.clearFiltersButton = null;
        this.filterStats = null;

        // Debounce timer
        this.debounceTimer = null;
    }

    async onRender() {
        if (!this.element) {
            throw new Error('Container element required for ResultsFilters');
        }

        this.createFiltersUI();
        this.updateFilterStats();
        this.log('Results filters rendered');
    }

    /**
     * Create filters UI
     * @private
     */
    createFiltersUI() {
        const html = `
            <div class="results-filters">
                <div class="filters-main">
                    <div class="row g-3">
                        ${this.options.showSearch ? this.createSearchHTML() : ''}
                        ${this.options.showBibFilter ? this.createBibFilterHTML() : ''}
                        ${this.options.showLabelFilter ? this.createLabelFilterHTML() : ''}
                        ${this.options.showConfidenceFilter ? this.createConfidenceFilterHTML() : ''}
                        ${this.options.showDateFilter ? this.createDateFilterHTML() : ''}
                    </div>
                    
                    <div class="filters-controls mt-3 d-flex justify-content-between align-items-center">
                        <div class="filter-actions">
                            <button type="button" class="btn btn-outline-secondary btn-sm clear-filters-btn">
                                <i class="fas fa-times me-1"></i>Clear All
                            </button>
                            
                            <div class="btn-group btn-group-sm ms-2">
                                <button type="button" class="btn btn-outline-info preset-filter-btn" data-preset="with-bib">
                                    With Bib #
                                </button>
                                <button type="button" class="btn btn-outline-warning preset-filter-btn" data-preset="without-bib">
                                    Without Bib #
                                </button>
                                <button type="button" class="btn btn-outline-success preset-filter-btn" data-preset="high-confidence">
                                    High Confidence
                                </button>
                            </div>
                        </div>
                        
                        ${this.options.showStats ? `
                            <div class="filter-stats text-muted small">
                                <span class="results-count"><!-- Will be populated --></span>
                            </div>
                        ` : ''}
                    </div>
                </div>
                
                ${this.options.showSorting || this.options.showViewOptions ? `
                    <div class="filters-secondary mt-3 pt-3 border-top">
                        <div class="row g-3 align-items-center">
                            ${this.options.showSorting ? this.createSortingHTML() : ''}
                            ${this.options.showViewOptions ? this.createViewOptionsHTML() : ''}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        this.setHTML(html);

        // Cache element references
        this.searchInput = this.$('#search-input');
        this.clearFiltersButton = this.$('.clear-filters-btn');
        this.filterStats = this.$('.filter-stats .results-count');
    }

    /**
     * Create search HTML
     * @private
     */
    createSearchHTML() {
        return `
            <div class="col-md-4">
                <label class="form-label small text-muted">Search Photos</label>
                <div class="input-group">
                    <span class="input-group-text">
                        <i class="fas fa-search"></i>
                    </span>
                    <input type="text" 
                           id="search-input" 
                           class="form-control" 
                           placeholder="Search by filename, bib number, or label..."
                           value="${this.filters.search}">
                </div>
            </div>
        `;
    }

    /**
     * Create bib number filter HTML
     * @private
     */
    createBibFilterHTML() {
        return `
            <div class="col-md-3">
                <label class="form-label small text-muted">Bib Numbers</label>
                <select id="bib-filter" class="form-select" multiple>
                    <option value="">All bib numbers</option>
                    ${this.availableBibNumbers.map(bib => 
                        `<option value="${bib}" ${this.filters.bibNumbers.includes(bib) ? 'selected' : ''}>${bib}</option>`
                    ).join('')}
                </select>
                <div class="form-text">Hold Ctrl/Cmd to select multiple</div>
            </div>
        `;
    }

    /**
     * Create label filter HTML
     * @private
     */
    createLabelFilterHTML() {
        return `
            <div class="col-md-3">
                <label class="form-label small text-muted">Labels</label>
                <select id="label-filter" class="form-select" multiple>
                    <option value="">All labels</option>
                    ${this.availableLabels.map(label => 
                        `<option value="${label}" ${this.filters.labels.includes(label) ? 'selected' : ''}>${label}</option>`
                    ).join('')}
                </select>
                <div class="form-text">Hold Ctrl/Cmd to select multiple</div>
            </div>
        `;
    }

    /**
     * Create confidence filter HTML
     * @private
     */
    createConfidenceFilterHTML() {
        return `
            <div class="col-md-2">
                <label class="form-label small text-muted">
                    Confidence Range
                    <span class="confidence-display">${this.filters.confidenceRange[0]}% - ${this.filters.confidenceRange[1]}%</span>
                </label>
                <div class="confidence-slider-container">
                    <input type="range" 
                           id="confidence-min" 
                           class="form-range" 
                           min="0" 
                           max="100" 
                           value="${this.filters.confidenceRange[0]}"
                           style="position: absolute; width: 100%;">
                    <input type="range" 
                           id="confidence-max" 
                           class="form-range" 
                           min="0" 
                           max="100" 
                           value="${this.filters.confidenceRange[1]}"
                           style="position: absolute; width: 100%;">
                </div>
            </div>
        `;
    }

    /**
     * Create date filter HTML
     * @private
     */
    createDateFilterHTML() {
        return `
            <div class="col-md-4">
                <label class="form-label small text-muted">Date Range</label>
                <div class="row g-1">
                    <div class="col">
                        <input type="date" id="date-from" class="form-control form-control-sm" placeholder="From">
                    </div>
                    <div class="col-auto d-flex align-items-center">
                        <span class="text-muted">to</span>
                    </div>
                    <div class="col">
                        <input type="date" id="date-to" class="form-control form-control-sm" placeholder="To">
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Create sorting HTML
     * @private
     */
    createSortingHTML() {
        return `
            <div class="col-md-4">
                <label class="form-label small text-muted">Sort By</label>
                <div class="input-group">
                    <select id="sort-field" class="form-select">
                        <option value="filename" ${this.sorting.field === 'filename' ? 'selected' : ''}>Filename</option>
                        <option value="bib_number" ${this.sorting.field === 'bib_number' ? 'selected' : ''}>Bib Number</option>
                        <option value="confidence" ${this.sorting.field === 'confidence' ? 'selected' : ''}>Confidence</option>
                        <option value="upload_date" ${this.sorting.field === 'upload_date' ? 'selected' : ''}>Upload Date</option>
                        <option value="file_size" ${this.sorting.field === 'file_size' ? 'selected' : ''}>File Size</option>
                    </select>
                    <button type="button" 
                            id="sort-direction" 
                            class="btn btn-outline-secondary"
                            title="Toggle sort direction">
                        <i class="fas fa-sort-${this.sorting.direction === 'asc' ? 'up' : 'down'}"></i>
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Create view options HTML
     * @private
     */
    createViewOptionsHTML() {
        return `
            <div class="col-md-6">
                <label class="form-label small text-muted">View Options</label>
                <div class="row g-2">
                    <div class="col-auto">
                        <select id="grid-size" class="form-select form-select-sm">
                            <option value="2" ${this.viewOptions.gridSize === 2 ? 'selected' : ''}>2 columns</option>
                            <option value="3" ${this.viewOptions.gridSize === 3 ? 'selected' : ''}>3 columns</option>
                            <option value="4" ${this.viewOptions.gridSize === 4 ? 'selected' : ''}>4 columns</option>
                            <option value="6" ${this.viewOptions.gridSize === 6 ? 'selected' : ''}>6 columns</option>
                        </select>
                    </div>
                    <div class="col-auto">
                        <select id="photo-size" class="form-select form-select-sm">
                            <option value="small" ${this.viewOptions.photoSize === 'small' ? 'selected' : ''}>Small</option>
                            <option value="medium" ${this.viewOptions.photoSize === 'medium' ? 'selected' : ''}>Medium</option>
                            <option value="large" ${this.viewOptions.photoSize === 'large' ? 'selected' : ''}>Large</option>
                        </select>
                    </div>
                    <div class="col-auto">
                        <select id="group-by" class="form-select form-select-sm">
                            <option value="none" ${this.viewOptions.groupBy === 'none' ? 'selected' : ''}>No grouping</option>
                            <option value="bib_number" ${this.viewOptions.groupBy === 'bib_number' ? 'selected' : ''}>By bib number</option>
                            <option value="label" ${this.viewOptions.groupBy === 'label' ? 'selected' : ''}>By label</option>
                            <option value="confidence" ${this.viewOptions.groupBy === 'confidence' ? 'selected' : ''}>By confidence</option>
                        </select>
                    </div>
                </div>
            </div>
            
            <div class="col-md-2">
                <label class="form-label small text-muted">&nbsp;</label>
                <div class="btn-group w-100">
                    <button type="button" 
                            class="btn btn-outline-secondary view-toggle-btn active" 
                            data-view="grid"
                            title="Grid view">
                        <i class="fas fa-th"></i>
                    </button>
                    <button type="button" 
                            class="btn btn-outline-secondary view-toggle-btn" 
                            data-view="list"
                            title="List view">
                        <i class="fas fa-list"></i>
                    </button>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        // Search input with debouncing
        if (this.searchInput) {
            this.addEventListener(this.searchInput, 'input', this.handleSearchInput.bind(this));
        }

        // Clear filters button
        if (this.clearFiltersButton) {
            this.addEventListener(this.clearFiltersButton, 'click', this.clearAllFilters.bind(this));
        }

        // Preset filter buttons
        const presetButtons = this.$$('.preset-filter-btn');
        presetButtons.forEach(btn => {
            this.addEventListener(btn, 'click', (event) => {
                const preset = event.target.dataset.preset;
                this.applyPresetFilter(preset);
            });
        });

        // Filter controls
        const bibFilter = this.$('#bib-filter');
        if (bibFilter) {
            this.addEventListener(bibFilter, 'change', this.handleBibFilterChange.bind(this));
        }

        const labelFilter = this.$('#label-filter');
        if (labelFilter) {
            this.addEventListener(labelFilter, 'change', this.handleLabelFilterChange.bind(this));
        }

        const confidenceMin = this.$('#confidence-min');
        const confidenceMax = this.$('#confidence-max');
        if (confidenceMin) {
            this.addEventListener(confidenceMin, 'input', this.handleConfidenceChange.bind(this));
        }
        if (confidenceMax) {
            this.addEventListener(confidenceMax, 'input', this.handleConfidenceChange.bind(this));
        }

        // Date filters
        const dateFrom = this.$('#date-from');
        const dateTo = this.$('#date-to');
        if (dateFrom) {
            this.addEventListener(dateFrom, 'change', this.handleDateFilterChange.bind(this));
        }
        if (dateTo) {
            this.addEventListener(dateTo, 'change', this.handleDateFilterChange.bind(this));
        }

        // Sorting controls
        const sortField = this.$('#sort-field');
        const sortDirection = this.$('#sort-direction');
        if (sortField) {
            this.addEventListener(sortField, 'change', this.handleSortFieldChange.bind(this));
        }
        if (sortDirection) {
            this.addEventListener(sortDirection, 'click', this.handleSortDirectionChange.bind(this));
        }

        // View options
        const gridSize = this.$('#grid-size');
        const photoSize = this.$('#photo-size');
        const groupBy = this.$('#group-by');
        
        if (gridSize) {
            this.addEventListener(gridSize, 'change', this.handleViewOptionChange.bind(this));
        }
        if (photoSize) {
            this.addEventListener(photoSize, 'change', this.handleViewOptionChange.bind(this));
        }
        if (groupBy) {
            this.addEventListener(groupBy, 'change', this.handleViewOptionChange.bind(this));
        }

        // View toggle buttons
        const viewToggleButtons = this.$$('.view-toggle-btn');
        viewToggleButtons.forEach(btn => {
            this.addEventListener(btn, 'click', (event) => {
                event.preventDefault();
                this.handleViewToggle(event.target.dataset.view);
            });
        });
    }

    /**
     * Handle search input with debouncing
     * @private
     */
    handleSearchInput(event) {
        clearTimeout(this.debounceTimer);
        
        this.debounceTimer = this.setTimeout(() => {
            this.filters.search = event.target.value.trim();
            this.emitFiltersChanged();
        }, this.options.debounceMs);
    }

    /**
     * Handle bib number filter change
     * @private
     */
    handleBibFilterChange(event) {
        const selectedOptions = Array.from(event.target.selectedOptions);
        this.filters.bibNumbers = selectedOptions
            .map(option => option.value)
            .filter(value => value !== '');
        
        this.emitFiltersChanged();
    }

    /**
     * Handle label filter change
     * @private
     */
    handleLabelFilterChange(event) {
        const selectedOptions = Array.from(event.target.selectedOptions);
        this.filters.labels = selectedOptions
            .map(option => option.value)
            .filter(value => value !== '');
        
        this.emitFiltersChanged();
    }

    /**
     * Handle confidence range change
     * @private
     */
    handleConfidenceChange() {
        const minSlider = this.$('#confidence-min');
        const maxSlider = this.$('#confidence-max');
        
        if (!minSlider || !maxSlider) return;

        let min = parseInt(minSlider.value);
        let max = parseInt(maxSlider.value);

        // Ensure min <= max
        if (min > max) {
            [min, max] = [max, min];
            minSlider.value = min;
            maxSlider.value = max;
        }

        this.filters.confidenceRange = [min, max];
        
        // Update display
        const display = this.$('.confidence-display');
        if (display) {
            display.textContent = `${min}% - ${max}%`;
        }

        this.emitFiltersChanged();
    }

    /**
     * Handle date filter change
     * @private
     */
    handleDateFilterChange() {
        const dateFrom = this.$('#date-from');
        const dateTo = this.$('#date-to');
        
        const fromValue = dateFrom?.value;
        const toValue = dateTo?.value;
        
        if (fromValue && toValue) {
            this.filters.dateRange = [fromValue, toValue];
        } else if (fromValue) {
            this.filters.dateRange = [fromValue, null];
        } else if (toValue) {
            this.filters.dateRange = [null, toValue];
        } else {
            this.filters.dateRange = null;
        }
        
        this.emitFiltersChanged();
    }

    /**
     * Handle sort field change
     * @private
     */
    handleSortFieldChange(event) {
        this.sorting.field = event.target.value;
        this.emitSortingChanged();
    }

    /**
     * Handle sort direction change
     * @private
     */
    handleSortDirectionChange(event) {
        event.preventDefault();
        
        this.sorting.direction = this.sorting.direction === 'asc' ? 'desc' : 'asc';
        
        // Update button icon
        const icon = event.target.querySelector('i');
        if (icon) {
            icon.className = `fas fa-sort-${this.sorting.direction === 'asc' ? 'up' : 'down'}`;
        }
        
        this.emitSortingChanged();
    }

    /**
     * Handle view option change
     * @private
     */
    handleViewOptionChange() {
        const gridSize = this.$('#grid-size');
        const photoSize = this.$('#photo-size');
        const groupBy = this.$('#group-by');
        
        if (gridSize) {
            this.viewOptions.gridSize = parseInt(gridSize.value);
        }
        if (photoSize) {
            this.viewOptions.photoSize = photoSize.value;
        }
        if (groupBy) {
            this.viewOptions.groupBy = groupBy.value;
        }
        
        this.emitViewOptionsChanged();
    }

    /**
     * Handle view toggle
     * @private
     */
    handleViewToggle(viewType) {
        // Update button states
        const buttons = this.$$('.view-toggle-btn');
        buttons.forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.view === viewType) {
                btn.classList.add('active');
            }
        });
        
        this.viewOptions.viewType = viewType;
        this.emitViewOptionsChanged();
    }

    /**
     * Apply preset filter
     * @private
     */
    applyPresetFilter(preset) {
        this.clearAllFilters();
        
        switch (preset) {
            case 'with-bib':
                this.filters.hasDetection = true;
                break;
            case 'without-bib':
                this.filters.hasDetection = false;
                break;
            case 'high-confidence':
                this.filters.confidenceRange = [80, 100];
                this.filters.hasDetection = true;
                break;
        }
        
        this.updateUI();
        this.emitFiltersChanged();
    }

    /**
     * Clear all filters
     */
    clearAllFilters() {
        this.filters = {
            search: '',
            bibNumbers: [],
            labels: [],
            confidenceRange: [0, 100],
            dateRange: null,
            hasLabel: null,
            hasDetection: null
        };
        
        this.updateUI();
        this.emitFiltersChanged();
    }

    /**
     * Update UI to reflect current filters
     * @private
     */
    updateUI() {
        // Update search input
        if (this.searchInput) {
            this.searchInput.value = this.filters.search;
        }
        
        // Update confidence sliders
        const minSlider = this.$('#confidence-min');
        const maxSlider = this.$('#confidence-max');
        const display = this.$('.confidence-display');
        
        if (minSlider) minSlider.value = this.filters.confidenceRange[0];
        if (maxSlider) maxSlider.value = this.filters.confidenceRange[1];
        if (display) {
            display.textContent = `${this.filters.confidenceRange[0]}% - ${this.filters.confidenceRange[1]}%`;
        }
        
        // Update filter dropdowns
        const bibFilter = this.$('#bib-filter');
        if (bibFilter) {
            Array.from(bibFilter.options).forEach(option => {
                option.selected = this.filters.bibNumbers.includes(option.value);
            });
        }
        
        const labelFilter = this.$('#label-filter');
        if (labelFilter) {
            Array.from(labelFilter.options).forEach(option => {
                option.selected = this.filters.labels.includes(option.value);
            });
        }
        
        // Update date filters
        const dateFrom = this.$('#date-from');
        const dateTo = this.$('#date-to');
        if (dateFrom && dateTo && this.filters.dateRange) {
            dateFrom.value = this.filters.dateRange[0] || '';
            dateTo.value = this.filters.dateRange[1] || '';
        }
    }

    /**
     * Set available filter options
     */
    setAvailableOptions(options) {
        if (options.bibNumbers) {
            this.availableBibNumbers = [...options.bibNumbers].sort((a, b) => {
                const numA = parseInt(a);
                const numB = parseInt(b);
                return isNaN(numA) || isNaN(numB) ? a.localeCompare(b) : numA - numB;
            });
        }
        
        if (options.labels) {
            this.availableLabels = [...options.labels].sort();
        }
        
        // Re-render dropdowns if already rendered
        if (this.isRendered) {
            this.render();
        }
    }

    /**
     * Update filter statistics
     */
    updateFilterStats(totalCount = 0, filteredCount = 0) {
        if (this.filterStats) {
            if (totalCount === filteredCount) {
                this.filterStats.textContent = `Showing all ${totalCount} photos`;
            } else {
                this.filterStats.textContent = `Showing ${filteredCount} of ${totalCount} photos`;
            }
        }
    }

    /**
     * Emit filters changed event
     * @private
     */
    emitFiltersChanged() {
        this.emit('filters:changed', {
            filters: { ...this.filters },
            filterFunction: this.createFilterFunction()
        });
        
        this.log('Filters changed', this.filters);
    }

    /**
     * Emit sorting changed event
     * @private
     */
    emitSortingChanged() {
        this.emit('sorting:changed', {
            sorting: { ...this.sorting },
            sortFunction: this.createSortFunction()
        });
        
        this.log('Sorting changed', this.sorting);
    }

    /**
     * Emit view options changed event
     * @private
     */
    emitViewOptionsChanged() {
        this.emit('view:changed', {
            viewOptions: { ...this.viewOptions }
        });
        
        this.log('View options changed', this.viewOptions);
    }

    /**
     * Create filter function based on current filters
     */
    createFilterFunction() {
        const filters = this.filters;
        
        return (photo) => {
            // Search filter
            if (filters.search) {
                const searchTerm = filters.search.toLowerCase();
                const searchableText = [
                    photo.filename,
                    photo.bib_number,
                    photo.custom_label
                ].filter(Boolean).join(' ').toLowerCase();
                
                if (!searchableText.includes(searchTerm)) {
                    return false;
                }
            }
            
            // Bib number filter
            if (filters.bibNumbers.length > 0) {
                if (!photo.bib_number || !filters.bibNumbers.includes(photo.bib_number.toString())) {
                    return false;
                }
            }
            
            // Label filter
            if (filters.labels.length > 0) {
                if (!photo.custom_label || !filters.labels.includes(photo.custom_label)) {
                    return false;
                }
            }
            
            // Confidence filter
            const confidence = (photo.detected_confidence || 0) * 100;
            if (confidence < filters.confidenceRange[0] || confidence > filters.confidenceRange[1]) {
                return false;
            }
            
            // Detection filter
            if (filters.hasDetection !== null) {
                const hasDetection = !!photo.bib_number;
                if (hasDetection !== filters.hasDetection) {
                    return false;
                }
            }
            
            // Label presence filter
            if (filters.hasLabel !== null) {
                const hasLabel = !!photo.custom_label;
                if (hasLabel !== filters.hasLabel) {
                    return false;
                }
            }
            
            // Date filter
            if (filters.dateRange) {
                const photoDate = new Date(photo.upload_date || photo.created_at);
                const fromDate = filters.dateRange[0] ? new Date(filters.dateRange[0]) : null;
                const toDate = filters.dateRange[1] ? new Date(filters.dateRange[1]) : null;
                
                if (fromDate && photoDate < fromDate) return false;
                if (toDate && photoDate > toDate) return false;
            }
            
            return true;
        };
    }

    /**
     * Create sort function based on current sorting
     */
    createSortFunction() {
        const sorting = this.sorting;
        
        return (a, b) => {
            let valueA, valueB;
            
            switch (sorting.field) {
                case 'filename':
                    valueA = (a.filename || '').toLowerCase();
                    valueB = (b.filename || '').toLowerCase();
                    break;
                case 'bib_number':
                    valueA = parseInt(a.bib_number) || 0;
                    valueB = parseInt(b.bib_number) || 0;
                    break;
                case 'confidence':
                    valueA = a.detected_confidence || 0;
                    valueB = b.detected_confidence || 0;
                    break;
                case 'upload_date':
                    valueA = new Date(a.upload_date || a.created_at || 0);
                    valueB = new Date(b.upload_date || b.created_at || 0);
                    break;
                case 'file_size':
                    valueA = a.file_size || 0;
                    valueB = b.file_size || 0;
                    break;
                default:
                    valueA = a[sorting.field] || '';
                    valueB = b[sorting.field] || '';
            }
            
            let result;
            if (valueA < valueB) result = -1;
            else if (valueA > valueB) result = 1;
            else result = 0;
            
            return sorting.direction === 'desc' ? -result : result;
        };
    }

    /**
     * Get current filters
     */
    getFilters() {
        return { ...this.filters };
    }

    /**
     * Get current sorting
     */
    getSorting() {
        return { ...this.sorting };
    }

    /**
     * Get current view options
     */
    getViewOptions() {
        return { ...this.viewOptions };
    }

    /**
     * Set filters programmatically
     */
    setFilters(newFilters) {
        this.filters = { ...this.filters, ...newFilters };
        this.updateUI();
        this.emitFiltersChanged();
    }

    /**
     * Set sorting programmatically
     */
    setSorting(newSorting) {
        this.sorting = { ...this.sorting, ...newSorting };
        this.render();
        this.emitSortingChanged();
    }

    /**
     * Set view options programmatically
     */
    setViewOptions(newViewOptions) {
        this.viewOptions = { ...this.viewOptions, ...newViewOptions };
        this.render();
        this.emitViewOptionsChanged();
    }

    /**
     * Static helper to create results filters
     */
    static create(containerSelector, options = {}) {
        const filters = new ResultsFilters(containerSelector, options);
        return filters;
    }

    /**
     * Static helper to create and initialize results filters
     */
    static async createAndInitialize(containerSelector, options = {}) {
        const filters = new ResultsFilters(containerSelector, options);
        await filters.initialize();
        return filters;
    }
}