/**
 * QuotaService - Manages user quota tracking and monitoring
 * Handles monthly usage limits, quota checking, and progress tracking
 */

import { BaseService } from './BaseService.js';
import { AppError, ErrorTypes } from '../utils/errors.js';

export class QuotaService extends BaseService {
    constructor(eventBus, apiService, options = {}) {
        super(eventBus, {
            name: 'QuotaService',
            refreshInterval: 300000, // 5 minutes
            enableAutoRefresh: true,
            ...options
        });

        this.apiService = apiService;
        this.quotaInfo = null;
        this.refreshTimer = null;
    }

    async onInitialize() {
        this.log('QuotaService initialized');
    }

    async onStart() {
        // Load initial quota data
        await this.loadQuotaData();

        // Setup auto-refresh if enabled
        if (this.options.enableAutoRefresh) {
            this.setupAutoRefresh();
        }

        this.log('QuotaService started');
    }

    async onStop() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    /**
     * Load quota data from API
     */
    async loadQuotaData() {
        try {
            const response = await this.apiService.get('/auth/quota');
            this.quotaInfo = response.quota;
            
            this.emit('quota:updated', { quota: this.quotaInfo });
            this.log('Quota data loaded', this.quotaInfo);
            
            return this.quotaInfo;
            
        } catch (error) {
            this.error('Failed to load quota data:', error);
            throw new AppError('Failed to load quota information', ErrorTypes.NETWORK);
        }
    }

    /**
     * Get current quota information
     */
    getQuotaInfo() {
        return this.quotaInfo;
    }

    /**
     * Check if user has available quota for specified number of photos
     */
    hasAvailableQuota(photoCount = 1) {
        if (!this.quotaInfo) {
            this.warn('Quota info not loaded, assuming quota available');
            return true;
        }

        return this.quotaInfo.remaining >= photoCount;
    }

    /**
     * Get quota status for display
     */
    getQuotaStatus() {
        if (!this.quotaInfo) {
            return {
                status: 'unknown',
                message: 'Quota information not available'
            };
        }

        const { usage_percentage, remaining, is_over_quota } = this.quotaInfo;

        if (is_over_quota) {
            return {
                status: 'exceeded',
                message: `Monthly quota exceeded. Resets ${this.getResetDateFormatted()}`,
                color: 'danger'
            };
        } else if (usage_percentage >= 90) {
            return {
                status: 'warning',
                message: `${remaining} photos remaining this month`,
                color: 'danger'
            };
        } else if (usage_percentage >= 75) {
            return {
                status: 'caution',
                message: `${remaining} photos remaining this month`,
                color: 'warning'
            };
        } else {
            return {
                status: 'good',
                message: `${remaining} photos remaining this month`,
                color: 'success'
            };
        }
    }

    /**
     * Get formatted reset date
     */
    getResetDateFormatted() {
        if (!this.quotaInfo?.reset_date) {
            return 'next month';
        }

        try {
            const resetDate = new Date(this.quotaInfo.reset_date);
            return resetDate.toLocaleDateString();
        } catch (e) {
            return 'next month';
        }
    }

    /**
     * Refresh quota information
     */
    async refreshQuota() {
        this.log('Refreshing quota data...');
        await this.loadQuotaData();
        this.emit('quota:refreshed', { quota: this.quotaInfo });
        return this.quotaInfo;
    }

    /**
     * Setup automatic quota refresh
     * @private
     */
    setupAutoRefresh() {
        this.refreshTimer = setInterval(async () => {
            try {
                await this.loadQuotaData();
            } catch (error) {
                this.warn('Auto-refresh failed:', error);
            }
        }, this.options.refreshInterval);

        this.log('Auto-refresh enabled', { interval: this.options.refreshInterval });
    }

    /**
     * Subscribe to quota events
     */
    onQuotaUpdated(callback) {
        return this.on('quota:updated', callback);
    }

    onQuotaRefreshed(callback) {
        return this.on('quota:refreshed', callback);
    }

    onQuotaExceeded(callback) {
        return this.on('quota:exceeded', callback);
    }

    /**
     * Emit quota exceeded event
     */
    emitQuotaExceeded(requestedCount) {
        this.emit('quota:exceeded', {
            quota: this.quotaInfo,
            requestedCount,
            message: `Cannot process ${requestedCount} photos. Only ${this.quotaInfo?.remaining || 0} photos remaining.`
        });
    }
}