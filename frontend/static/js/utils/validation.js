/**
 * Validation utility functions for TagSort
 * Pure functions for input validation
 */

/**
 * Validate bib number format
 * @param {string} bibNumber - Bib number to validate
 * @returns {boolean} True if valid bib number
 */
export function validateBibNumber(bibNumber) {
    // Allow "unknown" as a special case for "no bib visible"
    if (bibNumber.toLowerCase() === 'unknown') {
        return true;
    }
    
    // Standard numeric validation: 1-6 digits, range 1-99999
    const num = parseInt(bibNumber, 10);
    return /^\d{1,6}$/.test(bibNumber) && num >= 1 && num <= 99999;
}

/**
 * Validate email address format
 * @param {string} email - Email address to validate
 * @returns {boolean} True if valid email format
 */
export function validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Validate file type is an allowed image format
 * @param {File} file - File object to validate
 * @param {string[]} allowedTypes - Array of allowed MIME types
 * @returns {boolean} True if file type is allowed
 */
export function validateFileType(file, allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']) {
    return allowedTypes.includes(file.type);
}

/**
 * Validate file size is within limits
 * @param {File} file - File object to validate
 * @param {number} maxSizeMB - Maximum file size in megabytes
 * @returns {boolean} True if file size is within limits
 */
export function validateFileSize(file, maxSizeMB = 10) {
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    return file.size <= maxSizeBytes;
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {object} Validation result with isValid and reasons
 */
export function validatePassword(password) {
    const result = {
        isValid: true,
        reasons: []
    };
    
    if (password.length < 8) {
        result.isValid = false;
        result.reasons.push('Password must be at least 8 characters long');
    }
    
    if (!/[a-z]/.test(password)) {
        result.isValid = false;
        result.reasons.push('Password must contain at least one lowercase letter');
    }
    
    if (!/[A-Z]/.test(password)) {
        result.isValid = false;
        result.reasons.push('Password must contain at least one uppercase letter');
    }
    
    if (!/\d/.test(password)) {
        result.isValid = false;
        result.reasons.push('Password must contain at least one number');
    }
    
    return result;
}

/**
 * Validate that a string is not empty after trimming
 * @param {string} value - Value to validate
 * @returns {boolean} True if value is not empty
 */
export function validateRequired(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate a collection of files
 * @param {FileList|File[]} files - Files to validate
 * @param {object} options - Validation options
 * @returns {object} Validation result with valid/invalid files
 */
export function validateFiles(files, options = {}) {
    const {
        maxFiles = 50,
        maxSizeMB = 10,
        allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    } = options;
    
    const result = {
        valid: [],
        invalid: [],
        errors: []
    };
    
    const fileArray = Array.from(files);
    
    if (fileArray.length === 0) {
        result.errors.push('No files selected');
        return result;
    }
    
    if (fileArray.length > maxFiles) {
        result.errors.push(`Maximum ${maxFiles} files allowed`);
        return result;
    }
    
    fileArray.forEach((file, index) => {
        const fileErrors = [];
        
        if (!validateFileType(file, allowedTypes)) {
            fileErrors.push(`Invalid file type: ${file.type}`);
        }
        
        if (!validateFileSize(file, maxSizeMB)) {
            fileErrors.push(`File too large: ${file.name} (max ${maxSizeMB}MB)`);
        }
        
        if (fileErrors.length > 0) {
            result.invalid.push({ file, errors: fileErrors, index });
        } else {
            result.valid.push({ file, index });
        }
    });
    
    return result;
}