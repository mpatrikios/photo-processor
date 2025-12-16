/**
 * FormComponent - Reusable form handling component
 * Provides validation, submission handling, and error display
 * Eliminates duplication between authentication forms and other forms
 */

import { BaseComponent } from './BaseComponent.js';
import { validateEmail, validateRequired } from '../utils/validation.js';

export class FormComponent extends BaseComponent {
    constructor(formSelector, options = {}) {
        super(formSelector, {
            name: 'FormComponent',
            validateOnSubmit: true,
            validateOnChange: options.validateOnChange || false,
            showValidationFeedback: true,
            preventDefaultSubmit: true,
            resetOnSuccess: options.resetOnSuccess || false,
            focusFirstError: true,
            ...options
        });

        // Form state
        this.isSubmitting = false;
        this.validationRules = new Map();
        this.customValidators = new Map();
        this.errors = new Map();

        // Default validation rules
        this.setupDefaultValidators();

        this.log('Form component created');
    }

    async onInitialize() {
        if (!this.element || this.element.tagName !== 'FORM') {
            throw new Error('FormComponent requires a form element');
        }

        // Setup form validation classes
        this.addClass('needs-validation');
        this.element.noValidate = true; // Disable browser validation

        this.log('Form component initialized');
    }

    setupEventListeners() {
        // Form submission
        this.addEventListener(this.element, 'submit', this.handleSubmit);

        // Field validation on change (if enabled)
        if (this.options.validateOnChange) {
            this.addEventListener(this.element, 'change', this.handleFieldChange);
            this.addEventListener(this.element, 'input', this.handleFieldInput);
        }

        // Reset form
        this.addEventListener(this.element, 'reset', this.handleReset);
    }

    /**
     * Setup default validation rules
     * @private
     */
    setupDefaultValidators() {
        // Required field validator
        this.addValidator('required', (value, field) => {
            const isValid = validateRequired(value);
            return {
                isValid,
                message: isValid ? '' : `${this.getFieldLabel(field)} is required`
            };
        });

        // Email validator
        this.addValidator('email', (value, field) => {
            if (!value) return { isValid: true, message: '' }; // Allow empty (use required for mandatory)
            
            const isValid = validateEmail(value);
            return {
                isValid,
                message: isValid ? '' : 'Please enter a valid email address'
            };
        });

        // Minimum length validator
        this.addValidator('minlength', (value, field, ruleValue) => {
            if (!value) return { isValid: true, message: '' };
            
            const minLength = parseInt(ruleValue);
            const isValid = value.length >= minLength;
            return {
                isValid,
                message: isValid ? '' : `${this.getFieldLabel(field)} must be at least ${minLength} characters`
            };
        });

        // Maximum length validator
        this.addValidator('maxlength', (value, field, ruleValue) => {
            if (!value) return { isValid: true, message: '' };
            
            const maxLength = parseInt(ruleValue);
            const isValid = value.length <= maxLength;
            return {
                isValid,
                message: isValid ? '' : `${this.getFieldLabel(field)} must be no more than ${maxLength} characters`
            };
        });

        // Pattern validator
        this.addValidator('pattern', (value, field, ruleValue) => {
            if (!value) return { isValid: true, message: '' };
            
            const pattern = new RegExp(ruleValue);
            const isValid = pattern.test(value);
            return {
                isValid,
                message: isValid ? '' : `${this.getFieldLabel(field)} format is invalid`
            };
        });

        // Confirmation field validator (e.g., password confirmation)
        this.addValidator('confirm', (value, field, ruleValue) => {
            const targetField = this.$(`[name="${ruleValue}"]`);
            if (!targetField) return { isValid: true, message: '' };
            
            const isValid = value === targetField.value;
            return {
                isValid,
                message: isValid ? '' : 'Fields do not match'
            };
        });
    }

    /**
     * Add custom validation rule
     */
    addValidationRule(fieldName, rules) {
        this.validationRules.set(fieldName, rules);
    }

    /**
     * Add custom validator function
     */
    addValidator(name, validatorFn) {
        this.customValidators.set(name, validatorFn);
    }

    /**
     * Handle form submission
     * @private
     */
    async handleSubmit(event) {
        if (this.options.preventDefaultSubmit) {
            event.preventDefault();
        }

        if (this.isSubmitting) {
            event.preventDefault();
            return;
        }

        this.log('Form submission started');

        try {
            // Validate form if enabled
            if (this.options.validateOnSubmit) {
                const isValid = await this.validateForm();
                if (!isValid) {
                    this.emit('form:validation:failed', { 
                        errors: Array.from(this.errors.entries()) 
                    });
                    return;
                }
            }

            // Clear any previous errors
            this.clearErrors();

            // Get form data
            const formData = this.getFormData();

            // Set submitting state
            this.setSubmitting(true);

            // Custom submission handling
            const result = await this.onSubmit(formData, event);

            // Handle successful submission
            await this.handleSubmitSuccess(result);

        } catch (error) {
            this.handleSubmitError(error);
        } finally {
            this.setSubmitting(false);
        }
    }

    /**
     * Handle field change for real-time validation
     * @private
     */
    async handleFieldChange(event) {
        const field = event.target;
        if (field.name) {
            await this.validateField(field);
        }
    }

    /**
     * Handle field input for real-time validation
     * @private
     */
    async handleFieldInput(event) {
        const field = event.target;
        if (field.name) {
            // Use debounced validation for input events
            this.debounce(() => this.validateField(field), 500)();
        }
    }

    /**
     * Handle form reset
     * @private
     */
    handleReset(event) {
        this.log('Form reset');
        
        this.clearErrors();
        this.clearValidationStates();
        
        this.emit('form:reset');
    }

    /**
     * Validate entire form
     */
    async validateForm() {
        this.errors.clear();
        let isFormValid = true;

        // Get all form fields
        const fields = this.$$('input, select, textarea');

        // Validate each field
        for (const field of fields) {
            if (field.name) {
                const isFieldValid = await this.validateField(field);
                if (!isFieldValid) {
                    isFormValid = false;
                }
            }
        }

        // Update form validation state
        this.removeClass('was-validated');
        this.addClass('was-validated');

        // Focus first error if enabled
        if (!isFormValid && this.options.focusFirstError) {
            this.focusFirstError();
        }

        this.log(`Form validation ${isFormValid ? 'passed' : 'failed'}`);
        return isFormValid;
    }

    /**
     * Validate individual field
     */
    async validateField(field) {
        const fieldName = field.name;
        const value = field.value;
        let isValid = true;
        let errorMessage = '';

        // Clear previous error
        this.errors.delete(fieldName);

        // Get validation rules for this field
        const rules = this.validationRules.get(fieldName) || this.getFieldRules(field);

        // Apply validation rules
        for (const [rule, ruleValue] of Object.entries(rules)) {
            const validator = this.customValidators.get(rule);
            if (validator) {
                const result = await validator(value, field, ruleValue);
                if (!result.isValid) {
                    isValid = false;
                    errorMessage = result.message;
                    break; // Stop at first error
                }
            }
        }

        // Custom field validation
        const customResult = await this.onValidateField(fieldName, value, field);
        if (customResult && !customResult.isValid) {
            isValid = false;
            errorMessage = customResult.message;
        }

        // Store error if validation failed
        if (!isValid) {
            this.errors.set(fieldName, errorMessage);
        }

        // Update field validation state
        this.updateFieldValidationState(field, isValid, errorMessage);

        return isValid;
    }

    /**
     * Get validation rules from field attributes
     * @private
     */
    getFieldRules(field) {
        const rules = {};

        // Required
        if (field.required) {
            rules.required = true;
        }

        // Email type
        if (field.type === 'email') {
            rules.email = true;
        }

        // Length constraints
        if (field.minLength) {
            rules.minlength = field.minLength;
        }
        if (field.maxLength) {
            rules.maxlength = field.maxLength;
        }

        // Pattern
        if (field.pattern) {
            rules.pattern = field.pattern;
        }

        // Custom data attributes
        if (field.dataset.confirm) {
            rules.confirm = field.dataset.confirm;
        }

        return rules;
    }

    /**
     * Update field validation visual state
     * @private
     */
    updateFieldValidationState(field, isValid, errorMessage) {
        if (!this.options.showValidationFeedback) {
            return;
        }

        // Remove existing validation classes
        field.classList.remove('is-valid', 'is-invalid');

        // Add validation class
        field.classList.add(isValid ? 'is-valid' : 'is-invalid');

        // Update feedback
        this.updateFieldFeedback(field, isValid, errorMessage);
    }

    /**
     * Update field feedback message
     * @private
     */
    updateFieldFeedback(field, isValid, errorMessage) {
        // Find or create feedback element
        let feedbackElement = field.parentNode.querySelector('.invalid-feedback');
        
        if (!isValid && errorMessage) {
            if (!feedbackElement) {
                feedbackElement = document.createElement('div');
                feedbackElement.className = 'invalid-feedback';
                field.parentNode.appendChild(feedbackElement);
            }
            feedbackElement.textContent = errorMessage;
        } else if (feedbackElement && isValid) {
            // Clear error message but keep element for valid feedback
            feedbackElement.textContent = '';
        }
    }

    /**
     * Get field label for error messages
     * @private
     */
    getFieldLabel(field) {
        // Try various methods to get field label
        const label = field.closest('.form-group')?.querySelector('label')?.textContent ||
                     field.dataset.label ||
                     field.placeholder ||
                     field.name ||
                     'Field';
        
        return label.replace(':', '').trim();
    }

    /**
     * Get form data as object
     */
    getFormData() {
        const formData = new FormData(this.element);
        const data = {};

        for (const [key, value] of formData.entries()) {
            // Handle multiple values (checkboxes, multi-select)
            if (data[key]) {
                if (Array.isArray(data[key])) {
                    data[key].push(value);
                } else {
                    data[key] = [data[key], value];
                }
            } else {
                data[key] = value;
            }
        }

        return data;
    }

    /**
     * Set form submitting state
     */
    setSubmitting(submitting) {
        this.isSubmitting = submitting;

        // Update submit buttons
        const submitButtons = this.$$('button[type="submit"], input[type="submit"]');
        submitButtons.forEach(button => {
            button.disabled = submitting;
            
            if (submitting) {
                button.dataset.originalText = button.innerHTML;
                button.innerHTML = `<i class="fas fa-spinner fa-spin me-2"></i>${button.dataset.loadingText || 'Processing...'}`;
            } else {
                button.innerHTML = button.dataset.originalText || button.innerHTML;
                delete button.dataset.originalText;
            }
        });

        // Update form state
        if (submitting) {
            this.addClass('is-submitting');
        } else {
            this.removeClass('is-submitting');
        }

        this.emit('form:submitting:changed', { submitting });
    }

    /**
     * Show form error
     */
    showError(message, fieldName = null) {
        if (fieldName) {
            // Field-specific error
            this.errors.set(fieldName, message);
            const field = this.$(`[name="${fieldName}"]`);
            if (field) {
                this.updateFieldValidationState(field, false, message);
            }
        } else {
            // General form error
            this.showGeneralError(message);
        }
    }

    /**
     * Show general form error
     * @private
     */
    showGeneralError(message) {
        // Find or create error container
        let errorContainer = this.$('.form-error');
        
        if (!errorContainer) {
            errorContainer = document.createElement('div');
            errorContainer.className = 'form-error alert alert-danger';
            this.element.insertBefore(errorContainer, this.element.firstChild);
        }

        errorContainer.innerHTML = `
            <i class="fas fa-exclamation-circle me-2"></i>
            ${message}
        `;
        this.show(errorContainer);
    }

    /**
     * Clear all errors
     */
    clearErrors() {
        this.errors.clear();

        // Clear general error
        const errorContainer = this.$('.form-error');
        if (errorContainer) {
            this.hide(errorContainer);
        }

        // Clear field errors
        this.$$('.is-invalid').forEach(field => {
            field.classList.remove('is-invalid');
            const feedback = field.parentNode.querySelector('.invalid-feedback');
            if (feedback) {
                feedback.textContent = '';
            }
        });
    }

    /**
     * Clear validation states
     */
    clearValidationStates() {
        this.removeClass('was-validated');
        this.$$('.is-valid, .is-invalid').forEach(field => {
            field.classList.remove('is-valid', 'is-invalid');
        });
    }

    /**
     * Focus first error field
     */
    focusFirstError() {
        const firstErrorField = this.$('.is-invalid');
        if (firstErrorField) {
            firstErrorField.focus();
        }
    }

    /**
     * Reset form
     */
    reset() {
        this.element.reset();
        this.clearErrors();
        this.clearValidationStates();
        this.emit('form:reset');
    }

    /**
     * Handle successful form submission
     * @private
     */
    async handleSubmitSuccess(result) {
        this.log('Form submission successful');

        if (this.options.resetOnSuccess) {
            this.reset();
        }

        // Custom success handling
        await this.onSubmitSuccess(result);

        this.emit('form:submit:success', { result });
    }

    /**
     * Handle form submission error
     * @private
     */
    handleSubmitError(error) {
        this.error('Form submission failed:', error);

        // Show error message
        const errorMessage = error.message || 'An error occurred while submitting the form';
        
        // Check if error has field-specific details
        if (error.details && typeof error.details === 'object') {
            Object.entries(error.details).forEach(([field, message]) => {
                this.showError(message, field);
            });
        } else {
            this.showGeneralError(errorMessage);
        }

        // Custom error handling
        this.onSubmitError(error);

        this.emit('form:submit:error', { error });
    }

    /**
     * Lifecycle hooks - override in subclasses
     */
    async onSubmit(formData, event) {
        // Override in subclasses
        return formData;
    }

    async onSubmitSuccess(result) {
        // Override in subclasses
    }

    onSubmitError(error) {
        // Override in subclasses
    }

    async onValidateField(fieldName, value, field) {
        // Override in subclasses for custom validation
        return { isValid: true, message: '' };
    }

    /**
     * Get form validation state
     */
    getValidationState() {
        return {
            isValid: this.errors.size === 0,
            errors: Object.fromEntries(this.errors),
            isSubmitting: this.isSubmitting
        };
    }

    /**
     * Static helper to create form from element
     */
    static fromElement(element, options = {}) {
        const form = new FormComponent(element, options);
        return form;
    }
}