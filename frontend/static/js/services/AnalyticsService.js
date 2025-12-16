/**
 * AnalyticsService - Business logic for analytics dashboard
 * Extracted from analytics-dashboard.js to separate data logic from UI
 * Handles API interactions, data aggregation, and caching for analytics
 */

import { BaseService } from './BaseService.js';

export class AnalyticsService extends BaseService {
    constructor(eventBus, options = {}) {
        super(eventBus, {
            name: 'AnalyticsService',
            enableCaching: true,
            cacheTimeout: 300000, // 5 minutes
            enableAutoRefresh: true,
            refreshInterval: 30000, // 30 seconds
            enableDataValidation: true,
            maxRetryAttempts: 3,
            ...options
        });

        // Data cache
        this.cache = new Map();
        this.lastFetchTimes = new Map();

        // Auto-refresh state
        this.autoRefreshTimer = null;
        this.isAutoRefreshActive = false;

        // Available data endpoints
        this.endpoints = {
            dashboard: '/analytics/user/dashboard',
            users: '/analytics/user/analytics', 
            performance: '/analytics/user/performance',
            engagement: '/analytics/user/engagement',
            alerts: '/analytics/user/alerts'
        };

        // Service dependencies
        this.apiService = null;
        this.stateManagerService = null;
        this.authService = null;
    }

    /**
     * Initialize analytics service
     */
    async onInitialize() {
        // Get service dependencies
        this.apiService = this.serviceContainer?.get('apiService');
        this.stateManagerService = this.serviceContainer?.get('stateManagerService');
        this.authService = this.serviceContainer?.get('authService');

        // Setup event listeners
        this.setupEventListeners();

        // Initialize cache cleanup
        this.setupCacheCleanup();

        this.log('AnalyticsService initialized');
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        // Listen to analytics requests
        this.on('analytics:fetch:request', this.handleFetchRequest.bind(this));
        this.on('analytics:refresh:request', this.handleRefreshRequest.bind(this));
        this.on('analytics:cache:clear', this.handleCacheClear.bind(this));

        // Listen to auth changes
        this.on('auth:signin:success', this.handleAuthChange.bind(this));
        this.on('auth:signout:success', this.handleAuthChange.bind(this));

        // Listen to visibility changes for auto-refresh
        this.on('analytics:dashboard:shown', this.handleDashboardShown.bind(this));
        this.on('analytics:dashboard:hidden', this.handleDashboardHidden.bind(this));
    }

    /**
     * Setup cache cleanup timer
     * @private
     */
    setupCacheCleanup() {
        // Clean expired cache entries every minute
        setInterval(() => {
            this.cleanExpiredCache();
        }, 60000);
    }

    /**
     * Fetch dashboard overview data
     */
    async fetchDashboardData(options = {}) {
        const { forceRefresh = false, timeout = 30000 } = options;
        
        try {
            this.validateAuthentication();

            const cacheKey = 'dashboard_overview';
            
            // Check cache first
            if (!forceRefresh && this.isCacheValid(cacheKey)) {
                const cachedData = this.getCachedData(cacheKey);
                this.log('Returning cached dashboard data');
                this.emit('analytics:data:loaded', { 
                    type: 'dashboard', 
                    data: cachedData,
                    fromCache: true 
                });
                return cachedData;
            }

            this.emit('analytics:fetch:started', { type: 'dashboard' });

            const data = await this.fetchWithRetry(this.endpoints.dashboard, timeout);
            const transformedData = this.transformDashboardData(data);

            // Cache the results
            this.setCachedData(cacheKey, transformedData);

            this.emit('analytics:data:loaded', { 
                type: 'dashboard', 
                data: transformedData,
                fromCache: false 
            });

            this.log('Dashboard data fetched successfully');
            return transformedData;

        } catch (error) {
            this.handleFetchError('dashboard', error);
            throw error;
        }
    }

    /**
     * Fetch user analytics data
     */
    async fetchUserAnalytics(options = {}) {
        const { forceRefresh = false, timeRange = '30d' } = options;

        try {
            this.validateAuthentication();

            const cacheKey = `user_analytics_${timeRange}`;
            
            if (!forceRefresh && this.isCacheValid(cacheKey)) {
                const cachedData = this.getCachedData(cacheKey);
                this.emit('analytics:data:loaded', { 
                    type: 'users', 
                    data: cachedData,
                    fromCache: true 
                });
                return cachedData;
            }

            this.emit('analytics:fetch:started', { type: 'users' });

            const endpoint = `${this.endpoints.users}?timeRange=${timeRange}`;
            const data = await this.fetchWithRetry(endpoint);
            const transformedData = this.transformUserAnalyticsData(data);

            this.setCachedData(cacheKey, transformedData);

            this.emit('analytics:data:loaded', { 
                type: 'users', 
                data: transformedData,
                fromCache: false 
            });

            return transformedData;

        } catch (error) {
            this.handleFetchError('users', error);
            throw error;
        }
    }

    /**
     * Fetch performance data
     */
    async fetchPerformanceData(options = {}) {
        const { forceRefresh = false, metrics = ['processing_time', 'accuracy'] } = options;

        try {
            this.validateAuthentication();

            const cacheKey = `performance_${metrics.join('_')}`;
            
            if (!forceRefresh && this.isCacheValid(cacheKey)) {
                const cachedData = this.getCachedData(cacheKey);
                this.emit('analytics:data:loaded', { 
                    type: 'performance', 
                    data: cachedData,
                    fromCache: true 
                });
                return cachedData;
            }

            this.emit('analytics:fetch:started', { type: 'performance' });

            const endpoint = `${this.endpoints.performance}?metrics=${metrics.join(',')}`;
            const data = await this.fetchWithRetry(endpoint);
            const transformedData = this.transformPerformanceData(data);

            this.setCachedData(cacheKey, transformedData);

            this.emit('analytics:data:loaded', { 
                type: 'performance', 
                data: transformedData,
                fromCache: false 
            });

            return transformedData;

        } catch (error) {
            this.handleFetchError('performance', error);
            throw error;
        }
    }

    /**
     * Fetch engagement data
     */
    async fetchEngagementData(options = {}) {
        const { forceRefresh = false } = options;

        try {
            this.validateAuthentication();

            const cacheKey = 'engagement_data';
            
            if (!forceRefresh && this.isCacheValid(cacheKey)) {
                const cachedData = this.getCachedData(cacheKey);
                this.emit('analytics:data:loaded', { 
                    type: 'engagement', 
                    data: cachedData,
                    fromCache: true 
                });
                return cachedData;
            }

            this.emit('analytics:fetch:started', { type: 'engagement' });

            const data = await this.fetchWithRetry(this.endpoints.engagement);
            const transformedData = this.transformEngagementData(data);

            this.setCachedData(cacheKey, transformedData);

            this.emit('analytics:data:loaded', { 
                type: 'engagement', 
                data: transformedData,
                fromCache: false 
            });

            return transformedData;

        } catch (error) {
            this.handleFetchError('engagement', error);
            throw error;
        }
    }

    /**
     * Fetch alerts data
     */
    async fetchAlertsData(options = {}) {
        const { forceRefresh = false } = options;

        try {
            this.validateAuthentication();

            const cacheKey = 'alerts_data';
            
            if (!forceRefresh && this.isCacheValid(cacheKey)) {
                const cachedData = this.getCachedData(cacheKey);
                this.emit('analytics:data:loaded', { 
                    type: 'alerts', 
                    data: cachedData,
                    fromCache: true 
                });
                return cachedData;
            }

            this.emit('analytics:fetch:started', { type: 'alerts' });

            // For now, return placeholder alerts data
            // This can be extended when alerts API is implemented
            const transformedData = this.getPlaceholderAlertsData();

            this.setCachedData(cacheKey, transformedData);

            this.emit('analytics:data:loaded', { 
                type: 'alerts', 
                data: transformedData,
                fromCache: false 
            });

            return transformedData;

        } catch (error) {
            this.handleFetchError('alerts', error);
            throw error;
        }
    }

    /**
     * Track engagement event
     */
    async trackEngagement(event, data = {}) {
        try {
            if (!this.authService?.isAuthenticated()) {
                return; // Don't track for unauthenticated users
            }

            const trackingData = {
                event,
                timestamp: new Date().toISOString(),
                ...data
            };

            // Emit for real-time updates
            this.emit('analytics:engagement:tracked', trackingData);

            // Send to API (could be batched for performance)
            if (this.apiService) {
                await this.apiService.post('/analytics/events', trackingData);
            }

            this.log('Engagement tracked', { event, data });

        } catch (error) {
            this.warn('Failed to track engagement:', error);
        }
    }

    /**
     * Get analytics summary
     */
    async getAnalyticsSummary() {
        try {
            const [dashboard, users, performance] = await Promise.allSettled([
                this.fetchDashboardData(),
                this.fetchUserAnalytics(),
                this.fetchPerformanceData()
            ]);

            const summary = {
                dashboard: dashboard.status === 'fulfilled' ? dashboard.value : null,
                users: users.status === 'fulfilled' ? users.value : null,
                performance: performance.status === 'fulfilled' ? performance.value : null,
                lastUpdated: new Date().toISOString()
            };

            this.emit('analytics:summary:ready', summary);
            return summary;

        } catch (error) {
            this.error('Failed to get analytics summary:', error);
            throw error;
        }
    }

    /**
     * Validate user authentication
     * @private
     */
    validateAuthentication() {
        if (!this.authService?.isAuthenticated()) {
            throw new Error('User not authenticated for analytics');
        }
    }

    /**
     * Fetch data with retry logic
     * @private
     */
    async fetchWithRetry(endpoint, timeout = 30000, attempt = 1) {
        try {
            if (!this.apiService) {
                throw new Error('API service not available');
            }

            const response = await this.apiService.get(endpoint, { timeout });
            
            if (this.options.enableDataValidation) {
                this.validateResponseData(response, endpoint);
            }

            return response;

        } catch (error) {
            if (attempt < this.options.maxRetryAttempts) {
                this.log(`Fetch attempt ${attempt} failed, retrying...`, { endpoint, error: error.message });
                await this.sleep(1000 * attempt); // Exponential backoff
                return this.fetchWithRetry(endpoint, timeout, attempt + 1);
            }
            throw error;
        }
    }

    /**
     * Validate response data structure
     * @private
     */
    validateResponseData(data, endpoint) {
        if (!data || typeof data !== 'object') {
            throw new Error(`Invalid response data from ${endpoint}`);
        }

        // Add specific validation based on endpoint
        if (endpoint.includes('dashboard')) {
            if (!data.user_stats && !data.detection_accuracy) {
                this.warn('Dashboard data missing expected fields');
            }
        }
    }

    /**
     * Sleep utility for retry delays
     * @private
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Data Transformation Methods

    /**
     * Transform dashboard data for UI consumption
     * @private
     */
    transformDashboardData(data) {
        if (!data) return this.getPlaceholderDashboardData();

        const transformed = {
            metrics: {
                totalUsers: data.user_stats?.current_quota?.user_id || 0,
                photosProcessed: data.user_stats?.total_photos_processed || 0,
                accuracy: data.detection_accuracy?.percentage || 0,
                avgProcessingTime: data.detection_accuracy?.avg_processing_time_ms || 0
            },
            trends: {
                usersGrowth: this.calculateGrowthTrend(data.user_stats?.growth),
                photosGrowth: this.calculateGrowthTrend(data.processing_stats?.growth),
                accuracyTrend: this.calculateAccuracyTrend(data.detection_accuracy?.history),
                processingTimeTrend: this.calculateTimeTrend(data.processing_time?.history)
            },
            charts: {
                activityTrends: this.transformActivityTrends(data.activity_trends),
                processingMethods: this.transformProcessingMethods(data.processing_methods)
            },
            lastUpdated: new Date().toISOString()
        };

        return transformed;
    }

    /**
     * Transform user analytics data
     * @private
     */
    transformUserAnalyticsData(data) {
        if (!data) return { users: [], timeline: [], summary: {} };

        return {
            users: data.users || [],
            timeline: this.transformUserTimeline(data.timeline),
            summary: {
                totalUsers: data.summary?.total || 0,
                activeUsers: data.summary?.active || 0,
                newUsers: data.summary?.new || 0,
                retention: data.summary?.retention || 0
            },
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Transform performance data
     * @private
     */
    transformPerformanceData(data) {
        if (!data) return { metrics: {}, charts: {} };

        return {
            metrics: {
                avgProcessingTime: data.processing_time?.average || 0,
                peakProcessingTime: data.processing_time?.peak || 0,
                accuracy: data.accuracy?.current || 0,
                errorRate: data.errors?.rate || 0
            },
            charts: {
                performanceOverTime: this.transformPerformanceTimeline(data.timeline),
                accuracyDistribution: this.transformAccuracyDistribution(data.accuracy_distribution)
            },
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Transform engagement data
     * @private
     */
    transformEngagementData(data) {
        if (!data) return { events: [], patterns: {}, insights: [] };

        return {
            events: data.events || [],
            patterns: {
                peakUsage: data.patterns?.peak_usage || 'N/A',
                averageSession: data.patterns?.avg_session || 0,
                bounceRate: data.patterns?.bounce_rate || 0
            },
            insights: data.insights || [],
            lastUpdated: new Date().toISOString()
        };
    }

    // Helper transformation methods

    calculateGrowthTrend(growthData) {
        if (!growthData || !Array.isArray(growthData) || growthData.length < 2) {
            return { percentage: 0, direction: 'stable' };
        }

        const recent = growthData[growthData.length - 1];
        const previous = growthData[growthData.length - 2];
        
        const percentage = previous > 0 ? ((recent - previous) / previous) * 100 : 0;
        const direction = percentage > 0 ? 'up' : percentage < 0 ? 'down' : 'stable';

        return { percentage: Math.round(percentage * 100) / 100, direction };
    }

    calculateAccuracyTrend(accuracyHistory) {
        if (!accuracyHistory || accuracyHistory.length === 0) {
            return { current: 0, trend: 'stable' };
        }

        const current = accuracyHistory[accuracyHistory.length - 1];
        const previous = accuracyHistory.length > 1 ? accuracyHistory[accuracyHistory.length - 2] : current;
        
        const direction = current > previous ? 'improving' : current < previous ? 'declining' : 'stable';

        return { current, trend: direction };
    }

    calculateTimeTrend(timeHistory) {
        if (!timeHistory || timeHistory.length === 0) {
            return { current: 0, trend: 'stable' };
        }

        const current = timeHistory[timeHistory.length - 1];
        const previous = timeHistory.length > 1 ? timeHistory[timeHistory.length - 2] : current;
        
        const direction = current < previous ? 'improving' : current > previous ? 'declining' : 'stable';

        return { current, trend: direction };
    }

    transformActivityTrends(activityData) {
        if (!activityData || !Array.isArray(activityData)) {
            return [];
        }

        return activityData.map(item => ({
            date: item.date,
            value: item.count || item.value || 0,
            label: item.label || item.date
        }));
    }

    transformProcessingMethods(methodsData) {
        if (!methodsData) {
            return [];
        }

        return Object.entries(methodsData).map(([method, count]) => ({
            method,
            count,
            percentage: 0 // Will be calculated in UI
        }));
    }

    transformUserTimeline(timeline) {
        if (!timeline || !Array.isArray(timeline)) {
            return [];
        }

        return timeline.map(item => ({
            date: item.date,
            newUsers: item.new || 0,
            activeUsers: item.active || 0,
            totalUsers: item.total || 0
        }));
    }

    transformPerformanceTimeline(timeline) {
        if (!timeline || !Array.isArray(timeline)) {
            return [];
        }

        return timeline.map(item => ({
            timestamp: item.timestamp || item.date,
            processingTime: item.processing_time || 0,
            accuracy: item.accuracy || 0,
            requests: item.requests || 0
        }));
    }

    transformAccuracyDistribution(distribution) {
        if (!distribution) {
            return [];
        }

        return Object.entries(distribution).map(([range, count]) => ({
            range,
            count,
            percentage: 0 // Will be calculated in UI
        }));
    }

    // Placeholder data methods

    getPlaceholderDashboardData() {
        return {
            metrics: {
                totalUsers: 0,
                photosProcessed: 0,
                accuracy: 0,
                avgProcessingTime: 0
            },
            trends: {
                usersGrowth: { percentage: 0, direction: 'stable' },
                photosGrowth: { percentage: 0, direction: 'stable' },
                accuracyTrend: { current: 0, trend: 'stable' },
                processingTimeTrend: { current: 0, trend: 'stable' }
            },
            charts: {
                activityTrends: [],
                processingMethods: []
            },
            lastUpdated: new Date().toISOString()
        };
    }

    getPlaceholderAlertsData() {
        return {
            alerts: [],
            summary: {
                total: 0,
                critical: 0,
                warnings: 0,
                info: 0
            },
            lastUpdated: new Date().toISOString()
        };
    }

    // Cache Management

    isCacheValid(key) {
        if (!this.options.enableCaching) return false;
        
        const lastFetch = this.lastFetchTimes.get(key);
        if (!lastFetch) return false;
        
        return (Date.now() - lastFetch) < this.options.cacheTimeout;
    }

    getCachedData(key) {
        return this.cache.get(key);
    }

    setCachedData(key, data) {
        if (this.options.enableCaching) {
            this.cache.set(key, data);
            this.lastFetchTimes.set(key, Date.now());
        }
    }

    clearCache(pattern = null) {
        if (pattern) {
            // Clear specific cache entries matching pattern
            for (const key of this.cache.keys()) {
                if (key.includes(pattern)) {
                    this.cache.delete(key);
                    this.lastFetchTimes.delete(key);
                }
            }
        } else {
            // Clear all cache
            this.cache.clear();
            this.lastFetchTimes.clear();
        }

        this.log('Cache cleared', { pattern });
    }

    cleanExpiredCache() {
        const now = Date.now();
        const expiredKeys = [];

        for (const [key, lastFetch] of this.lastFetchTimes) {
            if ((now - lastFetch) > this.options.cacheTimeout) {
                expiredKeys.push(key);
            }
        }

        expiredKeys.forEach(key => {
            this.cache.delete(key);
            this.lastFetchTimes.delete(key);
        });

        if (expiredKeys.length > 0) {
            this.log('Cleaned expired cache entries', { count: expiredKeys.length });
        }
    }

    // Auto-refresh Management

    startAutoRefresh() {
        if (!this.options.enableAutoRefresh || this.isAutoRefreshActive) {
            return;
        }

        this.autoRefreshTimer = setInterval(() => {
            this.refreshActivePanels();
        }, this.options.refreshInterval);

        this.isAutoRefreshActive = true;
        this.log('Auto-refresh started');
        this.emit('analytics:autorefresh:started');
    }

    stopAutoRefresh() {
        if (this.autoRefreshTimer) {
            clearInterval(this.autoRefreshTimer);
            this.autoRefreshTimer = null;
        }

        this.isAutoRefreshActive = false;
        this.log('Auto-refresh stopped');
        this.emit('analytics:autorefresh:stopped');
    }

    async refreshActivePanels() {
        try {
            // Only refresh if user is authenticated
            if (!this.authService?.isAuthenticated()) {
                this.stopAutoRefresh();
                return;
            }

            // Refresh cached data
            await Promise.allSettled([
                this.fetchDashboardData({ forceRefresh: true }),
                this.fetchUserAnalytics({ forceRefresh: true }),
                this.fetchPerformanceData({ forceRefresh: true })
            ]);

            this.emit('analytics:autorefresh:completed');

        } catch (error) {
            this.warn('Auto-refresh failed:', error);
            this.emit('analytics:autorefresh:failed', { error });
        }
    }

    // Event Handlers

    handleFetchRequest(data) {
        const { type, options = {} } = data;

        switch (type) {
            case 'dashboard':
                return this.fetchDashboardData(options);
            case 'users':
                return this.fetchUserAnalytics(options);
            case 'performance':
                return this.fetchPerformanceData(options);
            case 'engagement':
                return this.fetchEngagementData(options);
            case 'alerts':
                return this.fetchAlertsData(options);
            default:
                this.warn('Unknown fetch request type:', type);
        }
    }

    async handleRefreshRequest(data = {}) {
        const { type = 'all' } = data;
        
        if (type === 'all') {
            await this.refreshActivePanels();
        } else {
            await this.handleFetchRequest({ type, options: { forceRefresh: true } });
        }
    }

    handleCacheClear(data = {}) {
        const { pattern } = data;
        this.clearCache(pattern);
    }

    handleAuthChange() {
        // Clear cache on auth changes
        this.clearCache();
        
        // Stop auto-refresh if user logs out
        if (!this.authService?.isAuthenticated()) {
            this.stopAutoRefresh();
        }
    }

    handleDashboardShown() {
        this.startAutoRefresh();
    }

    handleDashboardHidden() {
        this.stopAutoRefresh();
    }

    handleFetchError(type, error) {
        this.error(`Failed to fetch ${type} data:`, error);
        this.emit('analytics:fetch:failed', { type, error: error.message });
    }

    /**
     * Get service statistics
     */
    getStats() {
        return {
            cache: {
                enabled: this.options.enableCaching,
                size: this.cache.size,
                timeout: this.options.cacheTimeout
            },
            autoRefresh: {
                enabled: this.options.enableAutoRefresh,
                active: this.isAutoRefreshActive,
                interval: this.options.refreshInterval
            },
            endpoints: Object.keys(this.endpoints),
            retries: {
                maxAttempts: this.options.maxRetryAttempts
            }
        };
    }

    /**
     * Cleanup service
     */
    async cleanup() {
        // Stop auto-refresh
        this.stopAutoRefresh();

        // Clear cache
        this.clearCache();

        await super.cleanup();
    }
}