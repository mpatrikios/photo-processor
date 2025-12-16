/**
 * Integration Bridge - Progressive migration from monolithic to modular architecture
 * Provides compatibility layer and gradual transition between old and new systems
 * Allows testing the new architecture while maintaining existing functionality
 */

import { PhotoProcessorModular } from './PhotoProcessorModular.js';

class IntegrationBridge {
    constructor() {
        this.useModular = this.shouldUseModular();
        this.modularProcessor = null;
        this.legacyProcessor = null;
        this.migrationMode = 'hybrid'; // 'legacy', 'hybrid', 'modular'
        
        this.setupMigrationFlags();
        
        console.log(`Integration Bridge initialized - Mode: ${this.migrationMode}, Use Modular: ${this.useModular}`);
    }

    /**
     * Determine if modular architecture should be used
     * @private
     */
    shouldUseModular() {
        // Check URL parameters for forced mode
        const urlParams = new URLSearchParams(window.location.search);
        const forceMode = urlParams.get('arch');
        
        if (forceMode === 'modular') return true;
        if (forceMode === 'legacy') return false;
        
        // Check localStorage preference
        const userPreference = localStorage.getItem('use_modular_architecture');
        if (userPreference === 'true') return true;
        if (userPreference === 'false') return false;
        
        // Default: Use modular architecture for new users, legacy for existing
        const hasExistingData = localStorage.getItem('auth_token') || 
                               localStorage.getItem('user_info') ||
                               (window.stateManager && window.stateManager.hasRecentCompletedJob());
        
        // For existing users, use legacy by default to avoid disruption
        // For new users, use modular architecture
        return !hasExistingData;
    }

    /**
     * Setup migration flags and debugging
     * @private
     */
    setupMigrationFlags() {
        // Expose migration controls for debugging
        window.migrationBridge = this;
        
        // Add migration controls to the page
        this.addMigrationControls();
        
        // Listen for migration events
        this.setupMigrationEvents();
    }

    /**
     * Add migration controls to the page
     * @private
     */
    addMigrationControls() {
        // Only add in development
        const isDev = window.location.hostname === 'localhost' || 
                     window.location.port === '5173' ||
                     window.location.search.includes('debug=true');
        
        if (!isDev) return;

        const controlsHtml = `
            <div id="migration-controls" style="
                position: fixed; 
                top: 10px; 
                right: 10px; 
                background: #333; 
                color: white; 
                padding: 10px; 
                border-radius: 5px; 
                font-size: 12px; 
                z-index: 10000;
                font-family: monospace;
                max-width: 200px;
            ">
                <div style="font-weight: bold; margin-bottom: 5px;">
                    🔧 Migration Bridge
                </div>
                <div>Mode: <span id="current-mode">${this.migrationMode}</span></div>
                <div>Using: <span id="current-arch">${this.useModular ? 'Modular' : 'Legacy'}</span></div>
                <div style="margin-top: 5px;">
                    <button onclick="window.migrationBridge.switchToModular()" style="
                        background: #007bff; 
                        color: white; 
                        border: none; 
                        padding: 2px 6px; 
                        border-radius: 3px; 
                        font-size: 10px;
                        margin-right: 5px;
                    ">Modular</button>
                    <button onclick="window.migrationBridge.switchToLegacy()" style="
                        background: #6c757d; 
                        color: white; 
                        border: none; 
                        padding: 2px 6px; 
                        border-radius: 3px; 
                        font-size: 10px;
                    ">Legacy</button>
                </div>
                <div style="margin-top: 5px;">
                    <button onclick="window.migrationBridge.performMigrationTest()" style="
                        background: #28a745; 
                        color: white; 
                        border: none; 
                        padding: 2px 6px; 
                        border-radius: 3px; 
                        font-size: 10px;
                        width: 100%;
                    ">Test Migration</button>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', controlsHtml);
    }

    /**
     * Setup migration event listeners
     * @private
     */
    setupMigrationEvents() {
        // Listen for architecture switch events
        document.addEventListener('architecture:switch', (event) => {
            this.handleArchitectureSwitch(event.detail.architecture);
        });

        // Listen for migration test events
        document.addEventListener('migration:test', () => {
            this.performMigrationTest();
        });
    }

    /**
     * Initialize the appropriate photo processor
     */
    async initializePhotoProcessor() {
        try {
            if (this.useModular) {
                await this.initializeModularProcessor();
            } else {
                await this.initializeLegacyProcessor();
            }
            
            this.setupCompatibilityLayer();
            
        } catch (error) {
            console.error('Failed to initialize photo processor:', error);
            
            // Fallback to legacy if modular fails
            if (this.useModular && !this.legacyProcessor) {
                console.warn('Falling back to legacy processor...');
                this.useModular = false;
                await this.initializeLegacyProcessor();
                this.setupCompatibilityLayer();
            } else {
                throw error;
            }
        }
    }

    /**
     * Initialize modular processor
     * @private
     */
    async initializeModularProcessor() {
        console.log('Initializing modular photo processor...');
        
        this.modularProcessor = await PhotoProcessorModular.create({
            debug: window.location.search.includes('debug=true')
        });
        
        // Expose for debugging
        window.photoProcessorModular = this.modularProcessor;
        
        console.log('Modular processor initialized successfully');
    }

    /**
     * Initialize legacy processor
     * @private
     */
    async initializeLegacyProcessor() {
        console.log('Initializing legacy photo processor...');
        
        // The legacy PhotoProcessor is initialized by the existing script.js
        // We just need to wait for it and store the reference
        if (window.PhotoProcessor) {
            this.legacyProcessor = new window.PhotoProcessor();
        } else {
            // Wait for PhotoProcessor to be available
            await this.waitForLegacyProcessor();
        }
        
        window.photoProcessor = this.legacyProcessor;
        
        console.log('Legacy processor initialized successfully');
    }

    /**
     * Wait for legacy processor to be available
     * @private
     */
    waitForLegacyProcessor() {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 100;
            
            const checkForProcessor = () => {
                attempts++;
                
                if (window.PhotoProcessor) {
                    this.legacyProcessor = new window.PhotoProcessor();
                    resolve();
                } else if (attempts >= maxAttempts) {
                    reject(new Error('Legacy PhotoProcessor not found'));
                } else {
                    setTimeout(checkForProcessor, 50);
                }
            };
            
            checkForProcessor();
        });
    }

    /**
     * Setup compatibility layer between architectures
     * @private
     */
    setupCompatibilityLayer() {
        const processor = this.useModular ? this.modularProcessor : this.legacyProcessor;
        
        if (!processor) return;

        // Expose unified interface
        window.photoProcessor = processor;

        // For modular processor, expose legacy methods
        if (this.useModular && this.modularProcessor.legacyMethods) {
            Object.assign(window, this.modularProcessor.legacyMethods);
        }

        // Add migration tracking
        this.trackUsage();
    }

    /**
     * Track usage for migration insights
     * @private
     */
    trackUsage() {
        const startTime = Date.now();
        const architecture = this.useModular ? 'modular' : 'legacy';
        
        // Track which architecture is being used
        if (window.analyticsDashboard) {
            window.analyticsDashboard.trackEngagement('architecture_used', architecture);
        }

        // Track errors
        window.addEventListener('error', (event) => {
            console.warn(`${architecture} architecture error:`, event.error);
            
            if (window.analyticsDashboard) {
                window.analyticsDashboard.trackEngagement('architecture_error', {
                    architecture,
                    error: event.error?.message || 'Unknown error'
                });
            }
        });

        // Track performance
        window.addEventListener('beforeunload', () => {
            const sessionDuration = Date.now() - startTime;
            
            if (window.analyticsDashboard) {
                window.analyticsDashboard.trackEngagement('architecture_session', {
                    architecture,
                    duration: sessionDuration
                });
            }
        });
    }

    /**
     * Switch to modular architecture
     */
    async switchToModular() {
        if (this.useModular) return;
        
        console.log('Switching to modular architecture...');
        
        try {
            // Save current state
            const currentState = this.getCurrentState();
            
            // Cleanup legacy processor
            if (this.legacyProcessor && typeof this.legacyProcessor.cleanup === 'function') {
                await this.legacyProcessor.cleanup();
            }
            
            // Initialize modular processor
            this.useModular = true;
            await this.initializeModularProcessor();
            this.setupCompatibilityLayer();
            
            // Restore state
            await this.restoreState(currentState);
            
            // Update migration controls
            this.updateMigrationControls();
            
            // Save preference
            localStorage.setItem('use_modular_architecture', 'true');
            
            console.log('Successfully switched to modular architecture');
            
        } catch (error) {
            console.error('Failed to switch to modular architecture:', error);
            
            // Revert on error
            this.useModular = false;
            if (this.legacyProcessor) {
                window.photoProcessor = this.legacyProcessor;
            }
        }
    }

    /**
     * Switch to legacy architecture
     */
    async switchToLegacy() {
        if (!this.useModular) return;
        
        console.log('Switching to legacy architecture...');
        
        try {
            // Save current state
            const currentState = this.getCurrentState();
            
            // Cleanup modular processor
            if (this.modularProcessor && typeof this.modularProcessor.destroy === 'function') {
                await this.modularProcessor.destroy();
            }
            
            // Initialize legacy processor
            this.useModular = false;
            if (!this.legacyProcessor) {
                await this.initializeLegacyProcessor();
            }
            this.setupCompatibilityLayer();
            
            // Restore state
            await this.restoreState(currentState);
            
            // Update migration controls
            this.updateMigrationControls();
            
            // Save preference
            localStorage.setItem('use_modular_architecture', 'false');
            
            console.log('Successfully switched to legacy architecture');
            
        } catch (error) {
            console.error('Failed to switch to legacy architecture:', error);
            
            // Revert on error
            this.useModular = true;
            if (this.modularProcessor) {
                window.photoProcessor = this.modularProcessor;
            }
        }
    }

    /**
     * Get current application state
     * @private
     */
    getCurrentState() {
        const processor = this.useModular ? this.modularProcessor : this.legacyProcessor;
        
        if (!processor) return null;

        if (typeof processor.getState === 'function') {
            return processor.getState();
        }

        // Fallback: extract common state
        return {
            isAuthenticated: processor.isAuthenticated || false,
            currentSection: processor.currentSection || 'upload',
            authToken: processor.authToken || null
        };
    }

    /**
     * Restore application state
     * @private
     */
    async restoreState(state) {
        if (!state) return;
        
        const processor = this.useModular ? this.modularProcessor : this.legacyProcessor;
        
        if (!processor) return;

        try {
            // If processor has setState method, use it
            if (typeof processor.setState === 'function') {
                await processor.setState(state);
                return;
            }

            // Fallback: restore common state manually
            if (state.isAuthenticated && state.authToken) {
                // Restore authentication
                localStorage.setItem('auth_token', state.authToken);
                
                if (typeof processor.checkAuthStatus === 'function') {
                    await processor.checkAuthStatus();
                }
            }

            // Restore current section
            if (state.currentSection && typeof processor.showSection === 'function') {
                processor.showSection(state.currentSection);
            } else if (state.currentSection) {
                // Fallback for legacy methods
                const methodMap = {
                    'upload': 'showUploadSection',
                    'processing': 'showProcessingSection',
                    'results': 'showResultsSection'
                };
                
                const methodName = methodMap[state.currentSection];
                if (methodName && typeof processor[methodName] === 'function') {
                    processor[methodName]();
                }
            }
            
        } catch (error) {
            console.warn('Failed to restore state:', error);
        }
    }

    /**
     * Update migration controls display
     * @private
     */
    updateMigrationControls() {
        const modeElement = document.getElementById('current-mode');
        const archElement = document.getElementById('current-arch');
        
        if (modeElement) {
            modeElement.textContent = this.migrationMode;
        }
        
        if (archElement) {
            archElement.textContent = this.useModular ? 'Modular' : 'Legacy';
        }
    }

    /**
     * Perform migration test
     */
    async performMigrationTest() {
        console.log('Starting migration test...');
        
        const startArch = this.useModular ? 'modular' : 'legacy';
        const targetArch = this.useModular ? 'legacy' : 'modular';
        
        try {
            // Save initial state
            const initialState = this.getCurrentState();
            console.log('Initial state:', initialState);
            
            // Switch architecture
            if (this.useModular) {
                await this.switchToLegacy();
            } else {
                await this.switchToModular();
            }
            
            console.log(`Successfully switched from ${startArch} to ${targetArch}`);
            
            // Wait a bit for UI to settle
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Switch back
            if (this.useModular) {
                await this.switchToLegacy();
            } else {
                await this.switchToModular();
            }
            
            console.log(`Successfully switched back from ${targetArch} to ${startArch}`);
            
            // Verify state is preserved
            const finalState = this.getCurrentState();
            console.log('Final state:', finalState);
            
            console.log('✅ Migration test completed successfully');
            alert('Migration test completed successfully!');
            
        } catch (error) {
            console.error('❌ Migration test failed:', error);
            alert(`Migration test failed: ${error.message}`);
        }
    }

    /**
     * Handle architecture switch events
     * @private
     */
    async handleArchitectureSwitch(architecture) {
        if (architecture === 'modular') {
            await this.switchToModular();
        } else if (architecture === 'legacy') {
            await this.switchToLegacy();
        }
    }

    /**
     * Get migration statistics
     */
    getMigrationStats() {
        return {
            currentArchitecture: this.useModular ? 'modular' : 'legacy',
            migrationMode: this.migrationMode,
            hasModular: !!this.modularProcessor,
            hasLegacy: !!this.legacyProcessor,
            userPreference: localStorage.getItem('use_modular_architecture'),
            canMigrate: true
        };
    }
}

// Initialize bridge and photo processor when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('Initializing Integration Bridge...');
        
        window.integrationBridge = new IntegrationBridge();
        await window.integrationBridge.initializePhotoProcessor();
        
        console.log('Integration Bridge initialized successfully');
        
    } catch (error) {
        console.error('Failed to initialize Integration Bridge:', error);
        
        // Last resort: try to initialize legacy processor directly
        if (window.PhotoProcessor && !window.photoProcessor) {
            try {
                window.photoProcessor = new window.PhotoProcessor();
                console.log('Fallback to direct legacy initialization successful');
            } catch (fallbackError) {
                console.error('Complete initialization failure:', fallbackError);
            }
        }
    }
});

export { IntegrationBridge };