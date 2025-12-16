/**
 * ComponentFactory - Factory for creating and managing UI components
 * Provides high-level component creation with templates and presets
 * Simplifies component instantiation and reduces boilerplate
 */

import { ComponentRegistry } from './ComponentRegistry.js';

export class ComponentFactory {
    constructor(componentRegistry = null) {
        this.registry = componentRegistry || ComponentRegistry.getInstance();
        this.presets = new Map();
        this.templates = new Map();
        
        this.setupBuiltinPresets();
    }

    /**
     * Setup built-in component presets
     * @private
     */
    setupBuiltinPresets() {
        // Authentication presets
        this.presets.set('auth-modal-signin', {
            type: 'SignInModal',
            options: {
                size: 'md',
                backdrop: 'static',
                showCreateAccountLink: true
            }
        });

        this.presets.set('auth-modal-create', {
            type: 'CreateAccountModal',
            options: {
                size: 'md',
                backdrop: 'static',
                showSignInLink: true
            }
        });

        this.presets.set('auth-manager', {
            type: 'AuthManager',
            options: {
                autoRefresh: true,
                showUserInfo: true,
                showSignOut: true
            }
        });

        // Upload presets
        this.presets.set('upload-manager-main', {
            type: 'UploadManager',
            options: {
                showQuotaInfo: true,
                showUploadButton: true,
                showClearButton: true,
                autoUpload: false
            }
        });

        this.presets.set('upload-manager-modal', {
            type: 'UploadManager',
            options: {
                showQuotaInfo: false,
                showUploadButton: false,
                showClearButton: true,
                autoUpload: true
            }
        });

        this.presets.set('file-selector-drag-drop', {
            type: 'FileSelector',
            options: {
                showDropZone: true,
                showFileInput: true,
                showFolderInput: true,
                allowFolders: true,
                multiple: true
            }
        });

        // Processing presets
        this.presets.set('processing-manager-full', {
            type: 'ProcessingManager',
            options: {
                showProgress: true,
                autoRestore: true,
                showRetryButton: true,
                showResetButton: true
            }
        });

        this.presets.set('processing-progress-simple', {
            type: 'ProcessingProgress',
            options: {
                showProgressBar: true,
                showPhotoCount: true,
                showTimeEstimate: true,
                showCancelButton: false
            }
        });

        // Results presets
        this.presets.set('photo-grid-detected', {
            type: 'PhotoGrid',
            options: {
                showLabels: true,
                showBibNumbers: true,
                showSelection: true,
                allowEdit: true,
                gridColumns: 4,
                photoSize: 'medium'
            }
        });

        this.presets.set('photo-grid-unknown', {
            type: 'PhotoGrid',
            options: {
                showLabels: true,
                showBibNumbers: false,
                showSelection: true,
                allowEdit: true,
                gridColumns: 6,
                photoSize: 'small'
            }
        });

        this.presets.set('photo-group-organized', {
            type: 'PhotoGroup',
            options: {
                showGroupHeaders: true,
                showGroupCounts: true,
                showGroupActions: true,
                allowGroupCollapse: true,
                sortGroups: 'bib_number',
                gridOptions: {
                    gridColumns: 3,
                    photoSize: 'medium',
                    showSelection: true
                }
            }
        });

        this.presets.set('photo-lightbox-full', {
            type: 'PhotoLightbox',
            options: {
                size: 'xl',
                showNavigation: true,
                showZoom: true,
                showMetadata: true,
                showEdit: true,
                enableKeyboardShortcuts: true
            }
        });

        this.presets.set('results-filters-complete', {
            type: 'ResultsFilters',
            options: {
                showSearch: true,
                showBibFilter: true,
                showLabelFilter: true,
                showConfidenceFilter: true,
                showSorting: true,
                showViewOptions: true,
                showStats: true
            }
        });

        this.presets.set('labeling-tools-full', {
            type: 'LabelingTools',
            options: {
                showInlineEdit: true,
                showBulkEdit: true,
                showQuickLabels: true,
                showLabelSuggestions: true,
                enableAutoSave: true,
                enableKeyboardShortcuts: true
            }
        });

        this.presets.set('batch-operations-full', {
            type: 'BatchOperationsComponent',
            options: {
                enableSelectionUI: true,
                enableToolbar: true,
                enableModals: true,
                autoHideToolbar: true
            }
        });
    }

    /**
     * Create component using preset
     */
    async createFromPreset(presetName, containerId, containerSelector, additionalOptions = {}) {
        const preset = this.presets.get(presetName);
        
        if (!preset) {
            throw new Error(`Unknown preset: ${presetName}`);
        }

        const options = { ...preset.options, ...additionalOptions };
        
        return await this.registry.createComponent(
            preset.type,
            containerId,
            containerSelector,
            options
        );
    }

    /**
     * Create component directly
     */
    async create(typeName, containerId, containerSelector, options = {}) {
        return await this.registry.createComponent(
            typeName,
            containerId,
            containerSelector,
            options
        );
    }

    /**
     * Create multiple components from configuration
     */
    async createFromConfig(config) {
        const components = {};
        const errors = [];

        for (const [key, componentConfig] of Object.entries(config)) {
            try {
                let component;
                
                if (componentConfig.preset) {
                    component = await this.createFromPreset(
                        componentConfig.preset,
                        componentConfig.id || key,
                        componentConfig.selector,
                        componentConfig.options || {}
                    );
                } else if (componentConfig.type) {
                    component = await this.create(
                        componentConfig.type,
                        componentConfig.id || key,
                        componentConfig.selector,
                        componentConfig.options || {}
                    );
                } else {
                    throw new Error(`Component config missing 'type' or 'preset': ${key}`);
                }

                components[key] = component;

            } catch (error) {
                errors.push({ key, error });
                console.error(`Failed to create component '${key}':`, error);
            }
        }

        return { components, errors };
    }

    /**
     * Create complete authentication system
     */
    async createAuthSystem(containerSelector) {
        const config = {
            authManager: {
                preset: 'auth-manager',
                selector: containerSelector
            },
            signInModal: {
                preset: 'auth-modal-signin',
                selector: 'body' // Modals are typically appended to body
            },
            createAccountModal: {
                preset: 'auth-modal-create',
                selector: 'body'
            }
        };

        return await this.createFromConfig(config);
    }

    /**
     * Create complete upload system
     */
    async createUploadSystem(containerSelector, isModal = false) {
        const preset = isModal ? 'upload-manager-modal' : 'upload-manager-main';
        
        const uploadManager = await this.createFromPreset(
            preset,
            'upload-system',
            containerSelector
        );

        return { uploadManager };
    }

    /**
     * Create complete processing system
     */
    async createProcessingSystem(containerSelector) {
        const processingManager = await this.createFromPreset(
            'processing-manager-full',
            'processing-system',
            containerSelector
        );

        return { processingManager };
    }

    /**
     * Create complete results system
     */
    async createResultsSystem(containerSelector, options = {}) {
        const {
            showFilters = true,
            showLabelingTools = true,
            showBatchOperations = true,
            photosType = 'detected', // 'detected' or 'unknown'
            useGrouping = true
        } = options;

        const config = {};

        // Add filters if requested
        if (showFilters) {
            config.filters = {
                preset: 'results-filters-complete',
                selector: `${containerSelector} .results-filters-container`,
                options: {
                    showConfidenceFilter: photosType === 'detected'
                }
            };
        }

        // Add labeling tools if requested
        if (showLabelingTools) {
            config.labelingTools = {
                preset: 'labeling-tools-full',
                selector: `${containerSelector} .labeling-tools-container`
            };
        }

        // Add photo display component
        if (useGrouping && photosType === 'detected') {
            config.photoDisplay = {
                preset: 'photo-group-organized',
                selector: `${containerSelector} .photos-container`
            };
        } else {
            const gridPreset = photosType === 'detected' ? 'photo-grid-detected' : 'photo-grid-unknown';
            config.photoDisplay = {
                preset: gridPreset,
                selector: `${containerSelector} .photos-container`
            };
        }

        // Add batch operations if requested
        if (showBatchOperations) {
            config.batchOperations = {
                preset: 'batch-operations-full',
                selector: containerSelector
            };
        }

        // Add lightbox for photo viewing
        config.photoLightbox = {
            preset: 'photo-lightbox-full',
            selector: 'body'
        };

        return await this.createFromConfig(config);
    }

    /**
     * Create analytics dashboard system
     */
    async createAnalyticsSystem(containerSelector, options = {}) {
        const {
            enableAutoRefresh = true,
            refreshInterval = 30000,
            enableExportFeatures = true,
            theme = 'default'
        } = options;

        const config = {};

        // Analytics dashboard component
        config.dashboard = {
            type: 'AnalyticsDashboardComponent',
            selector: containerSelector,
            options: {
                enableAutoRefresh,
                refreshInterval,
                enableExportFeatures,
                theme
            }
        };

        // Metric cards for individual metrics (if needed separately)
        config.metricCards = {
            type: 'MetricCardComponent',
            selector: `${containerSelector} .metric-cards-container`,
            options: {
                clickable: true,
                animateValue: true,
                showTrend: true
            },
            multiple: true // Allow multiple instances
        };

        return await this.createFromConfig(config);
    }

    /**
     * Create photo processing workflow
     */
    async createProcessingWorkflow(containersConfig) {
        const {
            uploadContainer,
            processingContainer,
            resultsContainer
        } = containersConfig;

        const workflow = {};

        // Create upload system
        if (uploadContainer) {
            const uploadSystem = await this.createUploadSystem(uploadContainer);
            workflow.upload = uploadSystem;
        }

        // Create processing system
        if (processingContainer) {
            const processingSystem = await this.createProcessingSystem(processingContainer);
            workflow.processing = processingSystem;
        }

        // Create results system
        if (resultsContainer) {
            const resultsSystem = await this.createResultsSystem(resultsContainer);
            workflow.results = resultsSystem;
        }

        // Setup workflow coordination
        this.setupWorkflowCoordination(workflow);

        return workflow;
    }

    /**
     * Setup coordination between workflow components
     * @private
     */
    setupWorkflowCoordination(workflow) {
        const eventBus = this.registry.eventBus;
        if (!eventBus) return;

        // Upload -> Processing coordination
        if (workflow.upload && workflow.processing) {
            eventBus.on('upload:manager:completed', (data) => {
                if (workflow.processing.processingManager) {
                    // Auto-start processing after upload
                    const photoIds = data.photos?.map(p => p.id) || [];
                    if (photoIds.length > 0) {
                        workflow.processing.processingManager.startProcessing(photoIds);
                    }
                }
            });
        }

        // Processing -> Results coordination
        if (workflow.processing && workflow.results) {
            eventBus.on('processing:manager:completed', (data) => {
                if (workflow.results.components && data.results) {
                    // Update results display
                    const { detected = [], unknown = [] } = data.results;
                    
                    if (workflow.results.photoDisplay) {
                        if (detected.length > 0) {
                            workflow.results.photoDisplay.setPhotos(detected);
                        } else if (unknown.length > 0) {
                            workflow.results.photoDisplay.setPhotos(unknown);
                        }
                    }
                }
            });
        }

        // Results filtering coordination
        if (workflow.results && workflow.results.filters && workflow.results.photoDisplay) {
            eventBus.on('filters:changed', (data) => {
                if (workflow.results.photoDisplay.applyFilter) {
                    workflow.results.photoDisplay.applyFilter(data.filterFunction);
                }
            });
        }

        // Photo lightbox coordination
        if (workflow.results && workflow.results.photoLightbox) {
            eventBus.on('photogrid:photo:clicked', (data) => {
                // Open lightbox when photo is clicked
                workflow.results.photoLightbox.open([data.photo], 0);
            });

            eventBus.on('photogroup:photo:clicked', (data) => {
                // Open lightbox when photo in group is clicked
                workflow.results.photoLightbox.open([data.photo], 0);
            });
        }
    }

    /**
     * Register custom preset
     */
    registerPreset(name, preset) {
        this.presets.set(name, preset);
    }

    /**
     * Get available presets
     */
    getAvailablePresets() {
        return Array.from(this.presets.keys());
    }

    /**
     * Get preset configuration
     */
    getPreset(name) {
        return this.presets.get(name);
    }

    /**
     * Create template from existing component
     */
    createTemplate(name, component) {
        const metadata = this.registry.getComponentMetadata(component._registryId);
        
        if (!metadata) {
            throw new Error('Component not found in registry');
        }

        const template = {
            type: metadata.type,
            options: { ...metadata.options },
            containerSelector: metadata.containerSelector
        };

        this.templates.set(name, template);
        return template;
    }

    /**
     * Create component from template
     */
    async createFromTemplate(templateName, containerId, containerSelector, optionOverrides = {}) {
        const template = this.templates.get(templateName);
        
        if (!template) {
            throw new Error(`Unknown template: ${templateName}`);
        }

        const options = { ...template.options, ...optionOverrides };
        
        return await this.registry.createComponent(
            template.type,
            containerId,
            containerSelector || template.containerSelector,
            options
        );
    }

    /**
     * Batch destroy components
     */
    async destroyComponents(componentIds) {
        const results = [];

        for (const componentId of componentIds) {
            try {
                await this.registry.destroyComponent(componentId);
                results.push({ componentId, success: true });
            } catch (error) {
                results.push({ componentId, success: false, error });
            }
        }

        return results;
    }

    /**
     * Clone component with modifications
     */
    async cloneComponent(sourceComponentId, newContainerSelector, optionOverrides = {}) {
        const sourceComponent = this.registry.getComponent(sourceComponentId);
        const metadata = this.registry.getComponentMetadata(sourceComponentId);

        if (!sourceComponent || !metadata) {
            throw new Error('Source component not found');
        }

        const newOptions = { ...metadata.options, ...optionOverrides };

        return await this.registry.createComponent(
            metadata.type,
            null, // Let registry generate new ID
            newContainerSelector,
            newOptions
        );
    }

    /**
     * Get factory statistics
     */
    getStats() {
        return {
            presets: {
                total: this.presets.size,
                names: Array.from(this.presets.keys())
            },
            templates: {
                total: this.templates.size,
                names: Array.from(this.templates.keys())
            },
            registry: this.registry.getStats()
        };
    }

    /**
     * Static helper to create factory with registry
     */
    static create(componentRegistry = null) {
        return new ComponentFactory(componentRegistry);
    }
}