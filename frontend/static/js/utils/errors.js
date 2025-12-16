/**
 * Error handling utilities for TagSort
 * Functions for consistent error handling and user feedback
 */

/**
 * Standard error types used throughout the application
 */
export const ErrorTypes = {
    NETWORK: 'network',
    VALIDATION: 'validation', 
    AUTHENTICATION: 'authentication',
    AUTHORIZATION: 'authorization',
    NOT_FOUND: 'not_found',
    SERVER: 'server',
    CLIENT: 'client',
    TIMEOUT: 'timeout',
    FILE_UPLOAD: 'file_upload',
    PROCESSING: 'processing',
    QUOTA_EXCEEDED: 'quota_exceeded'
};

/**
 * Application-specific error class
 */
export class AppError extends Error {
    constructor(message, type = ErrorTypes.CLIENT, code = null, details = null) {
        super(message);
        this.name = 'AppError';
        this.type = type;
        this.code = code;
        this.details = details;
        this.timestamp = new Date().toISOString();
    }
}

/**
 * Format error message for user display
 * @param {Error|AppError|string} error - Error to format
 * @returns {string} User-friendly error message
 */
export function formatErrorMessage(error) {
    if (typeof error === 'string') {
        return error;
    }
    
    if (error instanceof AppError) {
        return error.message;
    }
    
    // Handle fetch/network errors
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
        return 'Network error. Please check your connection and try again.';
    }
    
    // Handle timeout errors
    if (error.name === 'AbortError') {
        return 'Request timed out. Please try again.';
    }
    
    // Handle generic errors
    return error.message || 'An unexpected error occurred. Please try again.';
}

/**
 * Create error from HTTP response
 * @param {Response} response - Fetch response object
 * @param {object} data - Response data object
 * @returns {AppError} Formatted application error
 */
export function createErrorFromResponse(response, data = {}) {
    let type = ErrorTypes.SERVER;
    let message = 'An error occurred while processing your request.';
    
    switch (response.status) {
        case 400:
            type = ErrorTypes.VALIDATION;
            message = data.detail || 'Invalid request. Please check your input.';
            break;
        case 401:
            type = ErrorTypes.AUTHENTICATION;
            message = 'Please sign in to continue.';
            break;
        case 403:
            type = ErrorTypes.AUTHORIZATION;
            message = 'You do not have permission to perform this action.';
            break;
        case 404:
            type = ErrorTypes.NOT_FOUND;
            message = 'The requested resource was not found.';
            break;
        case 413:
            type = ErrorTypes.FILE_UPLOAD;
            message = 'File size too large. Please select smaller files.';
            break;
        case 422:
            type = ErrorTypes.VALIDATION;
            message = data.detail || 'Invalid data provided.';
            break;
        case 429:
            type = ErrorTypes.CLIENT;
            message = 'Too many requests. Please wait a moment and try again.';
            break;
        case 500:
        case 502:
        case 503:
        case 504:
            type = ErrorTypes.SERVER;
            message = 'Server error. Please try again later.';
            break;
        default:
            if (response.status >= 400 && response.status < 500) {
                type = ErrorTypes.CLIENT;
            } else {
                type = ErrorTypes.SERVER;
            }
    }
    
    return new AppError(message, type, response.status, data);
}

/**
 * Handle async operation with error catching
 * @param {Promise} promise - Promise to handle
 * @param {Function} onError - Optional error handler
 * @returns {Promise<[Error|null, any]>} Tuple of [error, result]
 */
export async function handleAsync(promise, onError = null) {
    try {
        const result = await promise;
        return [null, result];
    } catch (error) {
        const formattedError = error instanceof AppError ? error : new AppError(formatErrorMessage(error));
        
        if (onError && typeof onError === 'function') {
            onError(formattedError);
        }
        
        return [formattedError, null];
    }
}

/**
 * Retry async operation with exponential backoff
 * @param {Function} asyncFn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise} Result of async function
 */
export async function retryAsync(asyncFn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await asyncFn();
        } catch (error) {
            lastError = error;
            
            if (i === maxRetries) {
                break;
            }
            
            // Don't retry certain error types
            if (error instanceof AppError) {
                if ([ErrorTypes.AUTHENTICATION, ErrorTypes.AUTHORIZATION, ErrorTypes.VALIDATION].includes(error.type)) {
                    break;
                }
            }
            
            // Exponential backoff
            const delay = baseDelay * Math.pow(2, i);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
}

/**
 * Log error to console with context
 * @param {Error|AppError} error - Error to log
 * @param {string} context - Context where error occurred
 * @param {object} metadata - Additional metadata
 */
export function logError(error, context = '', metadata = {}) {
    const errorInfo = {
        message: error.message,
        type: error.type || 'unknown',
        code: error.code || null,
        context,
        timestamp: new Date().toISOString(),
        stack: error.stack,
        metadata
    };
    
    console.error('Application Error:', errorInfo);
    
    // In production, you might send this to an error tracking service
    // like Sentry, LogRocket, or your own logging endpoint
    if (typeof window !== 'undefined' && window.analytics) {
        try {
            window.analytics.track('Error Occurred', errorInfo);
        } catch (trackingError) {
            console.warn('Failed to track error:', trackingError);
        }
    }
}