/**
 * SignInModal - Sign in modal component
 * Replaces the global showSignInModal function and handleSignIn logic
 * Integrates with AuthService for clean authentication flow
 */

import { ModalComponent } from '../ModalComponent.js';
import { FormComponent } from '../FormComponent.js';

export class SignInModal extends ModalComponent {
    constructor(options = {}) {
        super('#signInModal', {
            name: 'SignInModal',
            analyticsCategory: 'authentication',
            ...options
        });

        // Form component
        this.form = null;

        // Authentication state
        this.switchToCreateAccount = this.switchToCreateAccount.bind(this);
    }

    async onInitialize() {
        await super.onInitialize();

        // Initialize form component
        const formElement = this.$('#signInForm');
        if (formElement) {
            this.form = new FormComponent(formElement, {
                validateOnSubmit: true,
                validateOnChange: false,
                resetOnSuccess: true
            });

            // Setup form validation rules
            this.setupFormValidation();

            // Inject services into form
            if (this.services) {
                this.form.setServices(this.services);
            }

            await this.form.initialize();
            this.log('Sign in form initialized');
        }

        // Setup modal-specific behavior
        this.setupSwitchLink();
    }

    /**
     * Setup form validation rules
     * @private
     */
    setupFormValidation() {
        if (!this.form) return;

        // Email validation
        this.form.addValidationRule('email', {
            required: true,
            email: true
        });

        // Password validation
        this.form.addValidationRule('password', {
            required: true,
            minlength: 1 // Just require something, server will validate properly
        });

        // Override form submission
        this.form.onSubmit = async (formData) => {
            return await this.handleSignIn(formData);
        };

        // Handle submission success
        this.form.onSubmitSuccess = async (result) => {
            await this.handleSignInSuccess(result);
        };

        // Handle submission error
        this.form.onSubmitError = (error) => {
            this.handleSignInError(error);
        };
    }

    /**
     * Setup switch to create account link
     * @private
     */
    setupSwitchLink() {
        const switchLink = this.$('.switch-to-create-account');
        if (switchLink) {
            this.addEventListener(switchLink, 'click', (event) => {
                event.preventDefault();
                this.switchToCreateAccount();
            });
        }
    }

    /**
     * Handle sign in form submission
     * @private
     */
    async handleSignIn(formData) {
        const authService = this.getService('authService');
        if (!authService) {
            throw new Error('AuthService not available');
        }

        this.log('Attempting sign in', { email: formData.email });

        try {
            // Attempt sign in through service
            const result = await authService.signIn(formData.email, formData.password);
            
            this.log('Sign in successful', { user: result });
            return result;

        } catch (error) {
            this.log('Sign in failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Handle successful sign in
     * @private
     */
    async handleSignInSuccess(result) {
        this.log('Handling sign in success');

        // Hide the modal
        await this.hide();

        // Emit success event
        this.emit('auth:signin:success', { user: result });

        // Redirect to app section
        if (typeof window.showAppSection === 'function') {
            window.showAppSection();
        }

        // Update navigation hash
        if (window.location.hash !== '#app') {
            window.location.hash = 'app';
        }
    }

    /**
     * Handle sign in error
     * @private
     */
    handleSignInError(error) {
        this.log('Handling sign in error', { error: error.message });

        // The FormComponent will handle displaying the error
        // We just need to emit the event for other components
        this.emit('auth:signin:error', { error });

        // Focus email field for retry
        this.setTimeout(() => {
            const emailField = this.$('#signInEmail');
            if (emailField) {
                emailField.focus();
            }
        }, 100);
    }

    /**
     * Switch to create account modal
     */
    async switchToCreateAccount() {
        this.log('Switching to create account modal');

        // Hide this modal
        await this.hide();

        // Show create account modal after transition
        this.setTimeout(() => {
            // Emit event so other components can handle the switch
            this.emit('auth:switch:to_create_account');

            // Fallback to global function if event not handled
            if (typeof window.showCreateAccountModal === 'function') {
                window.showCreateAccountModal();
            }
        }, 300);
    }

    /**
     * Override onAfterShow to focus first input
     */
    onAfterShow() {
        super.onAfterShow();
        
        // Focus first input field
        this.setTimeout(() => {
            const emailField = this.$('#signInEmail');
            if (emailField) {
                emailField.focus();
            }
        }, 100);
    }

    /**
     * Override onAfterHide to clear form
     */
    onAfterHide() {
        super.onAfterHide();
        
        // Clear form errors
        if (this.form) {
            this.form.clearErrors();
        }
    }

    /**
     * Set services and pass to child components
     */
    setServices(services) {
        super.setServices(services);
        
        if (this.form) {
            this.form.setServices(services);
        }
    }

    onDestroy() {
        // Destroy form component
        if (this.form) {
            this.form.destroy();
            this.form = null;
        }

        super.onDestroy();
    }

    /**
     * Static helper to show sign in modal
     */
    static async show(services = null, options = {}) {
        const modal = new SignInModal(options);
        
        if (services) {
            modal.setServices(services);
        }

        await modal.initialize();
        await modal.show();

        return modal;
    }
}