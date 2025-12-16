/**
 * ApiService - Centralized HTTP client for TagSort
 * Handles all API communication with automatic auth, error handling, and retries
 */

import { BaseService } from './BaseService.js';
import { AppError, ErrorTypes, createErrorFromResponse, retryAsync } from '../utils/errors.js';

export class ApiService extends BaseService {
    constructor(eventBus, config = {}) {
        super(eventBus, {
            name: 'ApiService',
            baseUrl: config.baseUrl || ApiService.getApiBaseUrl(),
            timeout: config.timeout || 30000,
            retryAttempts: config.retryAttempts || 3,
            retryDelay: config.retryDelay || 1000,
            ...config
        });

        // Request/Response interceptors
        this.requestInterceptors = [];
        this.responseInterceptors = [];
        
        // Active requests tracking
        this.activeRequests = new Map();
        
        // Setup default interceptors
        this.setupDefaultInterceptors();
    }

    async onInitialize() {
        this.log('API Service initialized', {
            baseUrl: this.config.baseUrl,
            timeout: this.config.timeout
        });
    }

    /**
     * Setup default request/response interceptors
     * @private
     */
    setupDefaultInterceptors() {
        // Default request interceptor - add auth headers
        this.addRequestInterceptor((config) => {
            // Add auth headers if available
            const authHeaders = this.getAuthHeaders();
            config.headers = {
                'Content-Type': 'application/json',
                ...authHeaders,
                ...config.headers
            };
            
            return config;
        });

        // Default response interceptor - handle auth errors
        this.addResponseInterceptor(
            (response) => response,
            async (error, originalConfig) => {
                // Handle 401/403 errors with token refresh
                if ((error.code === 401 || error.code === 403) && !originalConfig._retry) {
                    originalConfig._retry = true;
                    
                    try {
                        await this.refreshToken();
                        // Retry original request with new token
                        return this.request(originalConfig);
                    } catch (refreshError) {
                        this.emit('auth:session_expired');
                        throw refreshError;
                    }
                }
                
                throw error;
            }
        );
    }

    /**
     * Get auth headers from StateManager
     * @returns {object} Auth headers object
     */
    getAuthHeaders() {
        try {
            if (typeof window !== 'undefined' && window.stateManager) {
                return window.stateManager.getAuthHeaders();
            }
        } catch (error) {
            this.warn('Failed to get auth headers:', error);
        }
        return {};
    }

    /**
     * Refresh authentication token
     * @private
     */
    async refreshToken() {
        if (typeof window !== 'undefined' && window.stateManager) {
            const success = await window.stateManager.refreshToken();
            if (!success) {
                throw new AppError('Token refresh failed', ErrorTypes.AUTHENTICATION);
            }
        } else {
            throw new AppError('StateManager not available', ErrorTypes.CLIENT);
        }
    }

    /**
     * Add a request interceptor
     * @param {Function} onFulfilled - Success handler
     * @param {Function} onRejected - Error handler
     * @returns {number} Interceptor ID for removal
     */
    addRequestInterceptor(onFulfilled, onRejected = null) {
        const interceptor = { onFulfilled, onRejected };
        this.requestInterceptors.push(interceptor);
        return this.requestInterceptors.length - 1;
    }

    /**
     * Add a response interceptor
     * @param {Function} onFulfilled - Success handler
     * @param {Function} onRejected - Error handler
     * @returns {number} Interceptor ID for removal
     */
    addResponseInterceptor(onFulfilled, onRejected = null) {
        const interceptor = { onFulfilled, onRejected };
        this.responseInterceptors.push(interceptor);
        return this.responseInterceptors.length - 1;
    }

    /**
     * Remove a request interceptor
     * @param {number} interceptorId - ID returned from addRequestInterceptor
     */
    removeRequestInterceptor(interceptorId) {
        if (this.requestInterceptors[interceptorId]) {
            this.requestInterceptors[interceptorId] = null;
        }
    }

    /**
     * Remove a response interceptor
     * @param {number} interceptorId - ID returned from addResponseInterceptor
     */
    removeResponseInterceptor(interceptorId) {
        if (this.responseInterceptors[interceptorId]) {
            this.responseInterceptors[interceptorId] = null;
        }
    }

    /**
     * Main request method
     * @param {string|object} urlOrConfig - URL string or config object
     * @param {object} config - Request configuration
     * @returns {Promise<object>} Response data
     */
    async request(urlOrConfig, config = {}) {
        this.ensureReady();

        // Normalize config
        const requestConfig = typeof urlOrConfig === 'string' 
            ? { url: urlOrConfig, ...config }
            : { ...urlOrConfig };

        // Ensure URL is absolute
        if (!requestConfig.url.startsWith('http')) {
            requestConfig.url = `${this.config.baseUrl}${requestConfig.url}`;
        }

        // Apply request interceptors
        let processedConfig = requestConfig;
        for (const interceptor of this.requestInterceptors) {
            if (interceptor && interceptor.onFulfilled) {
                try {
                    processedConfig = await interceptor.onFulfilled(processedConfig);
                } catch (error) {
                    if (interceptor.onRejected) {
                        processedConfig = await interceptor.onRejected(error);
                    } else {
                        throw error;
                    }
                }
            }
        }

        const requestId = this.generateRequestId();
        
        try {
            // Track active request
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
            
            this.activeRequests.set(requestId, { controller, config: processedConfig });
            
            // Emit request start event
            this.emit('api:request:start', { 
                requestId, 
                url: processedConfig.url, 
                method: processedConfig.method || 'GET' 
            });

            // Prepare fetch options
            const fetchOptions = {
                method: processedConfig.method || 'GET',
                headers: processedConfig.headers || {},
                signal: controller.signal,
                ...processedConfig.fetchOptions
            };

            // Add body for POST/PUT/PATCH requests
            if (processedConfig.data && ['POST', 'PUT', 'PATCH'].includes(fetchOptions.method.toUpperCase())) {
                if (processedConfig.data instanceof FormData) {
                    fetchOptions.body = processedConfig.data;
                    // Remove Content-Type for FormData (let browser set it)
                    delete fetchOptions.headers['Content-Type'];
                } else {
                    fetchOptions.body = JSON.stringify(processedConfig.data);
                }
            }

            // Make the request with retry logic
            const response = await retryAsync(
                () => fetch(processedConfig.url, fetchOptions),
                this.config.retryAttempts,
                this.config.retryDelay
            );

            clearTimeout(timeoutId);
            
            // Parse response
            const responseData = await this.parseResponse(response);
            
            this.log('API Response parsed successfully:', {
                status: response.status,
                statusText: response.statusText,
                url: processedConfig.url,
                dataType: typeof responseData,
                dataPreview: typeof responseData === 'object' ? Object.keys(responseData) : responseData
            });
            
            // Create response object
            const responseObject = {
                data: responseData,
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                config: processedConfig
            };

            // Apply response interceptors
            let processedResponse = responseObject;
            for (const interceptor of this.responseInterceptors) {
                if (interceptor && interceptor.onFulfilled) {
                    try {
                        processedResponse = await interceptor.onFulfilled(processedResponse);
                    } catch (error) {
                        if (interceptor.onRejected) {
                            processedResponse = await interceptor.onRejected(error, processedConfig);
                        } else {
                            throw error;
                        }
                    }
                }
            }

            // Emit request success event
            this.emit('api:request:success', { 
                requestId, 
                url: processedConfig.url, 
                status: response.status 
            });

            return processedResponse.data;

        } catch (error) {
            let apiError = error;
            
            // Convert fetch errors to AppError
            if (!(error instanceof AppError)) {
                if (error.name === 'AbortError') {
                    apiError = new AppError('Request timed out', ErrorTypes.TIMEOUT);
                } else if (!navigator.onLine) {
                    apiError = new AppError('No internet connection', ErrorTypes.NETWORK);
                } else if (error instanceof Response) {
                    try {
                        const errorData = await error.json();
                        apiError = createErrorFromResponse(error, errorData);
                    } catch {
                        apiError = createErrorFromResponse(error);
                    }
                } else {
                    apiError = new AppError(
                        error.message || 'Network error occurred',
                        ErrorTypes.NETWORK
                    );
                }
            }

            // Apply response error interceptors
            for (const interceptor of this.responseInterceptors) {
                if (interceptor && interceptor.onRejected) {
                    try {
                        const result = await interceptor.onRejected(apiError, processedConfig);
                        // If interceptor returns a value, treat as successful response
                        if (result !== undefined) {
                            return result;
                        }
                    } catch (interceptorError) {
                        apiError = interceptorError;
                    }
                }
            }

            // Emit request error event
            this.emit('api:request:error', { 
                requestId, 
                url: processedConfig.url, 
                error: apiError 
            });

            throw apiError;

        } finally {
            // Cleanup
            this.activeRequests.delete(requestId);
        }
    }

    /**
     * Parse response based on content type
     * @private
     * @param {Response} response - Fetch response
     * @returns {Promise<any>} Parsed response data
     */
    async parseResponse(response) {
        const contentType = response.headers.get('Content-Type');
        
        if (!response.ok) {
            // For error responses, try to parse JSON error data
            try {
                const errorData = await response.json();
                throw createErrorFromResponse(response, errorData);
            } catch (jsonError) {
                throw createErrorFromResponse(response);
            }
        }

        if (!contentType) {
            return await response.text();
        }

        if (contentType.includes('application/json')) {
            return await response.json();
        } else if (contentType.includes('text/')) {
            return await response.text();
        } else if (contentType.includes('application/octet-stream') || contentType.includes('application/zip')) {
            return await response.blob();
        } else {
            return await response.arrayBuffer();
        }
    }

    /**
     * Convenience methods for different HTTP verbs
     */
    async get(url, config = {}) {
        return this.request(url, { ...config, method: 'GET' });
    }

    async post(url, data = null, config = {}) {
        return this.request(url, { ...config, method: 'POST', data });
    }

    async put(url, data = null, config = {}) {
        return this.request(url, { ...config, method: 'PUT', data });
    }

    async patch(url, data = null, config = {}) {
        return this.request(url, { ...config, method: 'PATCH', data });
    }

    async delete(url, config = {}) {
        return this.request(url, { ...config, method: 'DELETE' });
    }

    /**
     * Upload file with progress tracking
     * @param {string} url - Upload URL
     * @param {FormData} formData - Form data with file
     * @param {object} config - Request configuration
     * @returns {Promise<object>} Upload response
     */
    async upload(url, formData, config = {}) {
        if (!(formData instanceof FormData)) {
            throw new AppError('Upload data must be FormData', ErrorTypes.VALIDATION);
        }

        return this.request(url, {
            ...config,
            method: 'POST',
            data: formData,
            headers: {
                // Don't set Content-Type for FormData
                ...Object.fromEntries(
                    Object.entries(config.headers || {}).filter(([key]) => 
                        key.toLowerCase() !== 'content-type'
                    )
                )
            }
        });
    }

    /**
     * Download file with authentication
     * @param {string} url - Download URL
     * @param {string} filename - Optional filename
     * @param {object} config - Request configuration
     * @returns {Promise<Blob>} File blob
     */
    async download(url, filename = null, config = {}) {
        const blob = await this.request(url, {
            ...config,
            method: 'GET',
            headers: {
                ...config.headers
                // Don't set Accept header for downloads
            }
        });

        if (filename && typeof window !== 'undefined') {
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);
        }

        return blob;
    }

    /**
     * Cancel all active requests
     */
    cancelAllRequests() {
        this.log(`Cancelling ${this.activeRequests.size} active requests`);
        
        for (const [requestId, { controller }] of this.activeRequests) {
            controller.abort();
            this.emit('api:request:cancelled', { requestId });
        }
        
        this.activeRequests.clear();
    }

    /**
     * Cancel a specific request
     * @param {string} requestId - Request ID to cancel
     */
    cancelRequest(requestId) {
        const request = this.activeRequests.get(requestId);
        if (request) {
            request.controller.abort();
            this.activeRequests.delete(requestId);
            this.emit('api:request:cancelled', { requestId });
        }
    }

    /**
     * Get active requests count
     * @returns {number} Number of active requests
     */
    getActiveRequestsCount() {
        return this.activeRequests.size;
    }

    /**
     * Generate unique request ID
     * @private
     * @returns {string} Request ID
     */
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get API base URL based on environment
     * @static
     * @returns {string} API base URL
     */
    static getApiBaseUrl() {
        if (typeof window === 'undefined') {
            return 'http://localhost:8000/api';
        }

        const isDevelopment = window.location.port === '5173' || window.location.hostname === 'localhost';
        if (isDevelopment) {
            return `${window.location.protocol}//${window.location.hostname}:8000/api`;
        } else {
            return `${window.location.protocol}//${window.location.host}/api`;
        }
    }

    async onStop() {
        // Cancel all active requests
        this.cancelAllRequests();
    }
}