/**
 * CreateAccountModal - Create account modal component
 * Replaces the global showCreateAccountModal function and handleCreateAccount logic
 * Integrates with AuthService for clean authentication flow
 */

import { ModalComponent } from '../ModalComponent.js';
import { FormComponent } from '../FormComponent.js';

export class CreateAccountModal extends ModalComponent {
    constructor(options = {}) {
        super('#createAccountModal', {
            name: 'CreateAccountModal',
            analyticsCategory: 'authentication',
            ...options
        });

        // Form component
        this.form = null;

        // Authentication state
        this.switchToSignIn = this.switchToSignIn.bind(this);
    }

    async onInitialize() {
        await super.onInitialize();

        // Initialize form component
        const formElement = this.$('#createAccountForm');
        if (formElement) {
            this.form = new FormComponent(formElement, {
                validateOnSubmit: true,
                validateOnChange: true, // More validation for registration
                resetOnSuccess: true
            });

            // Setup form validation rules
            this.setupFormValidation();

            // Inject services into form
            if (this.services) {
                this.form.setServices(this.services);
            }

            await this.form.initialize();
            this.log('Create account form initialized');
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

        // Name validation
        this.form.addValidationRule('name', {
            required: true,
            minlength: 2
        });

        // Email validation
        this.form.addValidationRule('email', {
            required: true,
            email: true
        });

        // Password validation
        this.form.addValidationRule('password', {
            required: true,
            minlength: 8
        });

        // Password confirmation validation
        this.form.addValidationRule('confirmPassword', {
            required: true,
            confirm: 'password'
        });

        // Add custom password strength validator
        this.form.addValidator('password-strength', (value) => {
            if (!value) return { isValid: true, message: '' };

            const hasUpper = /[A-Z]/.test(value);
            const hasLower = /[a-z]/.test(value);
            const hasNumber = /\d/.test(value);
            const hasLength = value.length >= 8;

            const isValid = hasUpper && hasLower && hasNumber && hasLength;
            
            if (!isValid) {
                const missing = [];
                if (!hasLength) missing.push('at least 8 characters');
                if (!hasUpper) missing.push('an uppercase letter');
                if (!hasLower) missing.push('a lowercase letter');
                if (!hasNumber) missing.push('a number');

                return {
                    isValid: false,
                    message: `Password must contain ${missing.join(', ')}`
                };
            }

            return { isValid: true, message: '' };
        });

        // Apply password strength validation
        this.form.addValidationRule('password', {
            required: true,
            minlength: 8,
            'password-strength': true
        });

        // Override form submission
        this.form.onSubmit = async (formData) => {
            return await this.handleCreateAccount(formData);
        };

        // Handle submission success
        this.form.onSubmitSuccess = async (result) => {
            await this.handleCreateAccountSuccess(result);
        };

        // Handle submission error
        this.form.onSubmitError = (error) => {
            this.handleCreateAccountError(error);
        };
    }

    /**
     * Setup switch to sign in link
     * @private
     */
    setupSwitchLink() {
        const switchLink = this.$('.switch-to-sign-in');
        if (switchLink) {
            this.addEventListener(switchLink, 'click', (event) => {
                event.preventDefault();
                this.switchToSignIn();
            });
        }
    }

    /**
     * Handle create account form submission
     * @private
     */
    async handleCreateAccount(formData) {
        const authService = this.getService('authService');
        if (!authService) {
            throw new Error('AuthService not available');
        }

        this.log('Attempting account creation', { 
            name: formData.name, 
            email: formData.email 
        });

        try {
            // Attempt account creation through service
            const result = await authService.createAccount({
                name: formData.name,
                email: formData.email,
                password: formData.password
            });
            
            this.log('Account creation successful', { user: result });
            return result;

        } catch (error) {
            this.log('Account creation failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Handle successful account creation
     * @private
     */
    async handleCreateAccountSuccess(result) {
        this.log('Handling account creation success');

        // Show success message before hiding modal
        this.showSuccessMessage('Account created successfully! Welcome to TagSort.');

        // Hide the modal after a brief delay
        this.setTimeout(async () => {
            await this.hide();

            // Emit success event
            this.emit('auth:register:success', { user: result });

            // Redirect to app section
            if (typeof window.showAppSection === 'function') {
                window.showAppSection();
            }

            // Update navigation hash
            if (window.location.hash !== '#app') {
                window.location.hash = 'app';
            }
        }, 1500);
    }

    /**
     * Handle account creation error
     * @private
     */
    handleCreateAccountError(error) {
        this.log('Handling account creation error', { error: error.message });

        // The FormComponent will handle displaying the error
        // We just need to emit the event for other components
        this.emit('auth:register:error', { error });

        // Focus first field for retry
        this.setTimeout(() => {
            const nameField = this.$('#createName');
            if (nameField) {
                nameField.focus();
            }
        }, 100);
    }

    /**
     * Show success message in modal
     * @private
     */
    showSuccessMessage(message) {
        const bodyElement = this.getBodyElement();
        if (bodyElement) {
            const successDiv = document.createElement('div');
            successDiv.className = 'alert alert-success mb-3';
            successDiv.innerHTML = `
                <i class="fas fa-check-circle me-2"></i>
                ${message}
            `;
            
            bodyElement.insertBefore(successDiv, bodyElement.firstChild);
        }
    }

    /**
     * Switch to sign in modal
     */
    async switchToSignIn() {
        this.log('Switching to sign in modal');

        // Hide this modal
        await this.hide();

        // Show sign in modal after transition
        this.setTimeout(() => {
            // Emit event so other components can handle the switch
            this.emit('auth:switch:to_signin');

            // Fallback to global function if event not handled
            if (typeof window.showSignInModal === 'function') {
                window.showSignInModal();
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
            const nameField = this.$('#createName');
            if (nameField) {
                nameField.focus();
            }
        }, 100);
    }

    /**
     * Override onAfterHide to clear form
     */
    onAfterHide() {
        super.onAfterHide();
        
        // Clear form errors and success messages
        if (this.form) {
            this.form.clearErrors();
        }

        // Clear success messages
        const successAlerts = this.$$('.alert-success');
        successAlerts.forEach(alert => alert.remove());
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
     * Static helper to show create account modal
     */
    static async show(services = null, options = {}) {
        const modal = new CreateAccountModal(options);
        
        if (services) {
            modal.setServices(services);
        }

        await modal.initialize();
        await modal.show();

        return modal;
    }
}