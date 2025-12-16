/**
 * script-minimal.js - Minimal legacy bootstrap for TagSort
 * Replaces the 4,551-line monolithic script.js with clean service-based architecture
 * Maintains backward compatibility while enabling modern modular development
 */

import { PhotoProcessorModular } from './PhotoProcessorModular.js';

// Global application instance
let photoProcessorApp = null;

/**
 * Initialize the application
 */
async function initializeApp() {
    try {
        console.log('Initializing TagSort Photo Processor...');
        
        // Create and initialize the modular application
        photoProcessorApp = await PhotoProcessorModular.create({
            enableLegacyCompatibility: true,
            enableErrorRecovery: true,
            debug: true
        });

        // Expose for legacy compatibility
        window.photoProcessor = photoProcessorApp.legacyMethods;
        window.photoProcessorModular = photoProcessorApp;

        // Expose StateManagerService for legacy compatibility
        const stateManagerService = photoProcessorApp.serviceContainer?.get('stateManagerService');
        if (stateManagerService) {
            // Create legacy wrapper that mimics the old stateManager API
            window.stateManager = {
                // Core methods
                get: (path) => stateManagerService.get(path),
                set: (path, value) => stateManagerService.set(path, value),
                update: (updates) => stateManagerService.update(updates),
                subscribe: (path, callback) => stateManagerService.subscribe(path, callback),
                
                // Job management methods
                hasRecentCompletedJob: () => stateManagerService.hasRecentCompletedJob(),
                getRecentCompletedJob: () => stateManagerService.getRecentCompletedJob(),
                saveCompletedJob: (jobId, results) => stateManagerService.saveCompletedJob(jobId, results),
                clearCompletedJob: () => stateManagerService.clearCompletedJob(),
                
                // Debug method
                getFullState: () => stateManagerService.getFullState(),
                
                // Direct access to service (for advanced use)
                _service: stateManagerService
            };
        }

        // Expose BatchService for legacy compatibility
        const batchService = photoProcessorApp.serviceContainer?.get('batchService');
        if (batchService) {
            // Create legacy wrapper that mimics the old BatchOperations API
            window.BatchOperations = class {
                constructor(stateManager) {
                    // For legacy compatibility - ignore the stateManager parameter
                    // since BatchService manages its own state
                }

                // Legacy methods that delegate to BatchService
                toggleSelectionMode() {
                    return batchService.toggleSelectionMode();
                }

                exitSelectionMode() {
                    return batchService.exitSelectionMode();
                }

                async executeBatchUpdate() {
                    // This would need additional UI integration for the bib number
                    console.warn('Legacy executeBatchUpdate called - use BatchService directly');
                }

                async reprocessSelected() {
                    return batchService.executeBatchReprocess(false);
                }

                async executeDelete() {
                    return batchService.executeBatchDelete(true);
                }

                // Properties
                get selectedPhotos() {
                    return new Set(batchService.getSelectedPhotos());
                }

                get isSelectionMode() {
                    return batchService.isInSelectionMode();
                }
            };
        }

        console.log('TagSort Photo Processor initialized successfully');

    } catch (error) {
        console.error('Failed to initialize TagSort Photo Processor:', error);
        
        // Fallback error display
        const errorMsg = 'Failed to initialize application. Please refresh the page.';
        if (window.showNotification) {
            window.showNotification(errorMsg, 'error');
        } else {
            alert(errorMsg);
        }
    }
}

/**
 * Legacy modal functions for backward compatibility
 * These delegate to the modular auth system
 */
function showSignInModal() {
    if (photoProcessorApp?.components?.auth?.signInModal) {
        photoProcessorApp.components.auth.signInModal.show();
    } else {
        // Fallback to DOM manipulation
        const modal = new bootstrap.Modal(document.getElementById('signInModal'));
        modal.show();
    }
}

function showCreateAccountModal() {
    if (photoProcessorApp?.components?.auth?.createAccountModal) {
        photoProcessorApp.components.auth.createAccountModal.show();
    } else {
        // Fallback to DOM manipulation
        const modal = new bootstrap.Modal(document.getElementById('createAccountModal'));
        modal.show();
    }
}

function switchToCreateAccount() {
    if (photoProcessorApp?.components?.auth?.authManager) {
        photoProcessorApp.components.auth.authManager.switchToCreateAccount();
    } else {
        // Fallback behavior
        showCreateAccountModal();
    }
}

function switchToSignIn() {
    if (photoProcessorApp?.components?.auth?.authManager) {
        photoProcessorApp.components.auth.authManager.switchToSignIn();
    } else {
        // Fallback behavior  
        showSignInModal();
    }
}

function showLandingPage() {
    if (photoProcessorApp?.showSection) {
        photoProcessorApp.showSection('landing');
    } else {
        // Direct DOM fallback
        const landingPage = document.getElementById('landing-page');
        const appSection = document.getElementById('app-section');
        if (landingPage) landingPage.classList.remove('d-none');
        if (appSection) appSection.classList.add('d-none');
    }
}

function showAppSection() {
    if (photoProcessorApp?.showSection) {
        photoProcessorApp.showSection('app');
    } else {
        // Direct DOM fallback
        const landingPage = document.getElementById('landing-page');
        const appSection = document.getElementById('app-section');
        if (landingPage) landingPage.classList.add('d-none');
        if (appSection) appSection.classList.remove('d-none');
    }
}

/**
 * Legacy authentication handlers
 * These delegate to the service-based auth system
 */
async function handleSignIn(event) {
    event.preventDefault();
    
    try {
        const form = event.target;
        const email = form.querySelector('#signInEmail')?.value?.trim();
        const password = form.querySelector('#signInPassword')?.value;

        if (!email || !password) {
            throw new Error('Please fill in all fields');
        }

        // Delegate to auth service
        const authService = photoProcessorApp?.serviceContainer?.get('authService');
        if (authService) {
            await authService.signIn(email, password);
        } else {
            throw new Error('Authentication service not available');
        }

    } catch (error) {
        console.error('Sign in failed:', error);
        
        // Show error notification
        if (window.showNotification) {
            window.showNotification(error.message || 'Sign in failed', 'error');
        } else {
            alert(error.message || 'Sign in failed');
        }
    }
}

async function handleCreateAccount(event) {
    event.preventDefault();
    
    try {
        const form = event.target;
        const email = form.querySelector('#createAccountEmail')?.value?.trim();
        const password = form.querySelector('#createAccountPassword')?.value;
        const confirmPassword = form.querySelector('#createAccountConfirmPassword')?.value;

        if (!email || !password || !confirmPassword) {
            throw new Error('Please fill in all fields');
        }

        if (password !== confirmPassword) {
            throw new Error('Passwords do not match');
        }

        // Delegate to auth service
        const authService = photoProcessorApp?.serviceContainer?.get('authService');
        if (authService) {
            await authService.signUp(email, password);
        } else {
            throw new Error('Authentication service not available');
        }

    } catch (error) {
        console.error('Create account failed:', error);
        
        // Show error notification
        if (window.showNotification) {
            window.showNotification(error.message || 'Account creation failed', 'error');
        } else {
            alert(error.message || 'Account creation failed');
        }
    }
}

/**
 * Global function registration for legacy compatibility
 */
function registerGlobalFunctions() {
    // Auth modal functions
    window.showSignInModal = showSignInModal;
    window.showCreateAccountModal = showCreateAccountModal;
    window.switchToCreateAccount = switchToCreateAccount;
    window.switchToSignIn = switchToSignIn;
    
    // Navigation functions
    window.showLandingPage = showLandingPage;
    window.showAppSection = showAppSection;

    // Note: Other global functions (logout, showNotification, etc.) 
    // are handled by LegacyCompatibilityService
}

/**
 * Setup form event listeners
 */
function setupFormEventListeners() {
    // Wait for DOM to be ready
    const signInForm = document.getElementById('signInForm');
    const createAccountForm = document.getElementById('createAccountForm');

    if (signInForm) {
        signInForm.addEventListener('submit', handleSignIn);
        console.log('Sign In event listener attached');
    }

    if (createAccountForm) {
        createAccountForm.addEventListener('submit', handleCreateAccount);
        console.log('Create Account event listener attached');
    }
}

/**
 * Setup data-action button listeners
 */
function setupDataActionListeners() {
    // Handle all buttons with data-action attributes
    document.querySelectorAll('[data-action]').forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            const action = e.target.getAttribute('data-action');
            
            switch (action) {
                case 'showSignInModal':
                    showSignInModal();
                    break;
                case 'showCreateAccountModal':
                    showCreateAccountModal();
                    break;
                case 'showLandingPage':
                    showLandingPage();
                    break;
                case 'showAppSection':
                    showAppSection();
                    break;
                default:
                    console.warn('Unknown action:', action);
            }
        });
    });
    
    console.log('Data-action listeners attached');
}

/**
 * Application cleanup
 */
window.addEventListener('beforeunload', async () => {
    if (photoProcessorApp && typeof photoProcessorApp.destroy === 'function') {
        try {
            await photoProcessorApp.destroy();
        } catch (error) {
            console.error('Cleanup error:', error);
        }
    }
});

/**
 * Initialize when DOM is ready
 */
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Register global functions for legacy compatibility
        registerGlobalFunctions();
        
        // Setup form event listeners
        setupFormEventListeners();
        
        // Setup data-action button listeners
        setupDataActionListeners();
        
        // Initialize the application
        await initializeApp();
        
        console.log('TagSort initialization complete');
        
    } catch (error) {
        console.error('Initialization error:', error);
    }
});

/**
 * Profile Modal Functions (Legacy Compatibility)
 */

/**
 * Show the profile modal (global function for HTML compatibility)
 */
async function showProfileModal() {
    try {
        // Try to use the modular ProfileModal component if available
        const profileModal = window.photoProcessorModular?.components?.profileModal;
        
        if (profileModal) {
            await profileModal.show();
        } else {
            // Fallback to simple modal show
            const modal = new bootstrap.Modal(document.getElementById('profileModal'));
            modal.show();
        }
        
    } catch (error) {
        console.error('Failed to show profile modal:', error);
    }
}

/**
 * Legacy exports for compatibility
 */
export {
    showSignInModal,
    showCreateAccountModal,
    switchToCreateAccount,
    switchToSignIn,
    showLandingPage,
    showAppSection,
    handleSignIn,
    handleCreateAccount
};