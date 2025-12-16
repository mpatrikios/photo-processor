/**
 * AnalyticsDashboardComponent - Modern analytics dashboard UI component
 * Extracted from analytics-dashboard.js to separate presentation from business logic
 * Uses AnalyticsService for data operations and ChartComponent for visualizations
 */

import { BaseComponent } from './BaseComponent.js';
import { ChartComponent } from './charts/ChartComponent.js';

export class AnalyticsDashboardComponent extends BaseComponent {
    constructor(container, options = {}) {
        super(container, {
            name: 'AnalyticsDashboardComponent',
            enableAutoRefresh: true,
            refreshInterval: 30000,
            enableExportFeatures: true,
            theme: 'default',
            ...options
        });

        // Service dependencies
        this.analyticsService = null;
        this.routerService = null;
        this.authService = null;
        this.notificationService = null;

        // Component state
        this.isVisible = false;
        this.currentTab = 'overview-panel';
        this.autoRefreshTimer = null;
        this.modal = null;

        // Chart components
        this.charts = new Map();
    }

    /**
     * Initialize dashboard component
     */
    async onInitialize() {
        // Get service dependencies
        this.analyticsService = this.serviceContainer?.get('analyticsService');
        this.routerService = this.serviceContainer?.get('routerService');
        this.authService = this.serviceContainer?.get('authService');
        this.notificationService = this.serviceContainer?.get('notificationService');

        // Create dashboard UI
        this.createDashboardUI();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Initialize charts
        this.initializeCharts();

        this.log('AnalyticsDashboardComponent initialized');
    }

    /**
     * Create dashboard UI structure
     */
    createDashboardUI() {
        // Add dashboard navigation button if needed
        this.addDashboardButton();

        // Create main dashboard modal
        this.createDashboardModal();
    }

    /**
     * Add dashboard button to navigation
     * @private
     */
    addDashboardButton() {
        const navSection = document.querySelector('.position-absolute.top-0.end-0');
        if (!navSection) return;

        const existingButton = document.getElementById('analytics-dashboard-btn');
        if (existingButton) return; // Already exists

        const button = document.createElement('button');
        button.className = 'btn btn-outline-light btn-sm me-2';
        button.id = 'analytics-dashboard-btn';
        button.innerHTML = '<i class="fas fa-chart-line me-1"></i> Analytics';
        button.title = 'View analytics dashboard';
        
        button.addEventListener('click', () => {
            this.navigateToAnalytics();
        });
        
        // Insert before profile button
        const profileBtn = document.getElementById('profileBtn');
        if (profileBtn) {
            navSection.insertBefore(button, profileBtn);
        } else {
            navSection.appendChild(button);
        }
    }

    /**
     * Navigate to analytics via router
     * @private
     */
    navigateToAnalytics() {
        if (this.routerService) {
            this.routerService.navigate('analytics');
        } else {
            // Fallback to hash navigation
            window.location.hash = 'analytics';
        }
    }

    /**
     * Create dashboard modal structure
     * @private
     */
    createDashboardModal() {
        const modalHtml = `
            <div class="modal fade" id="analytics-dashboard-modal" tabindex="-1" aria-labelledby="analyticsDashboardLabel" aria-hidden="true">
                <div class="modal-dialog modal-fullscreen">
                    <div class="modal-content">
                        <div class="modal-header bg-dark text-white">
                            <h5 class="modal-title" id="analyticsDashboardLabel">
                                <i class="fas fa-chart-line me-2"></i>
                                Analytics Dashboard
                            </h5>
                            <div class="d-flex align-items-center">
                                <button type="button" class="btn btn-outline-light btn-sm me-3" id="back-to-app-btn">
                                    <i class="fas fa-arrow-left me-1"></i> Back to App
                                </button>
                                <div class="form-check form-switch me-3">
                                    <input class="form-check-input" type="checkbox" id="auto-refresh-toggle" checked>
                                    <label class="form-check-label text-white" for="auto-refresh-toggle">
                                        Auto Refresh (30s)
                                    </label>
                                </div>
                                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close" id="close-dashboard-btn"></button>
                            </div>
                        </div>
                        <div class="modal-body p-0">
                            <div class="container-fluid">
                                <!-- Dashboard Tabs -->
                                <nav class="nav nav-tabs border-bottom bg-light" id="dashboard-tabs">
                                    <a class="nav-link active" id="overview-tab" data-bs-toggle="tab" href="#overview-panel">
                                        <i class="fas fa-tachometer-alt me-1"></i> Overview
                                    </a>
                                    <a class="nav-link" id="users-tab" data-bs-toggle="tab" href="#users-panel">
                                        <i class="fas fa-users me-1"></i> Users
                                    </a>
                                    <a class="nav-link" id="performance-tab" data-bs-toggle="tab" href="#performance-panel">
                                        <i class="fas fa-chart-bar me-1"></i> Performance
                                    </a>
                                    <a class="nav-link" id="engagement-tab" data-bs-toggle="tab" href="#engagement-panel">
                                        <i class="fas fa-mouse-pointer me-1"></i> Engagement
                                    </a>
                                    <a class="nav-link" id="alerts-tab" data-bs-toggle="tab" href="#alerts-panel">
                                        <i class="fas fa-bell me-1"></i> Alerts
                                    </a>
                                </nav>
                                
                                <!-- Tab Content -->
                                <div class="tab-content p-4" id="dashboard-content">
                                    ${this.createOverviewPanel()}
                                    ${this.createUsersPanel()}
                                    ${this.createPerformancePanel()}
                                    ${this.createEngagementPanel()}
                                    ${this.createAlertsPanel()}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Add to document body
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Get modal instance
        this.modal = new bootstrap.Modal(document.getElementById('analytics-dashboard-modal'));
    }

    /**
     * Create overview panel HTML
     * @private
     */
    createOverviewPanel() {
        return `
            <!-- Overview Panel -->
            <div class="tab-pane fade show active" id="overview-panel">
                <!-- Export Controls -->
                <div class="d-flex justify-content-end mb-4">
                    <div class="dropdown">
                        <button class="btn btn-outline-primary dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                            <i class="fas fa-download me-2"></i>Export Data
                        </button>
                        <ul class="dropdown-menu">
                            <li><h6 class="dropdown-header">Business Reports</h6></li>
                            <li><a class="dropdown-item" href="#" data-export="business_report" data-format="json">📊 Business Report (JSON)</a></li>
                            <li><a class="dropdown-item" href="#" data-export="business_report" data-format="csv">📊 Business Report (CSV)</a></li>
                            <li><hr class="dropdown-divider"></li>
                            <li><h6 class="dropdown-header">Detailed Analytics</h6></li>
                            <li><a class="dropdown-item" href="#" data-export="user_analytics" data-format="csv">👥 User Analytics (CSV)</a></li>
                            <li><a class="dropdown-item" href="#" data-export="system_metrics" data-format="csv">⚡ System Metrics (CSV)</a></li>
                            <li><a class="dropdown-item" href="#" data-export="detection_accuracy" data-format="csv">🎯 Detection Accuracy (CSV)</a></li>
                        </ul>
                    </div>
                </div>
                
                <div class="row g-4">
                    <!-- KPI Cards -->
                    <div class="col-lg-3 col-md-6">
                        <div class="card border-0 shadow-sm">
                            <div class="card-body text-center">
                                <div class="d-flex align-items-center justify-content-between">
                                    <div>
                                        <h6 class="card-subtitle text-muted mb-1">Total Users</h6>
                                        <h3 class="card-title mb-0" id="total-users-metric">-</h3>
                                    </div>
                                    <i class="fas fa-users fa-2x text-primary opacity-75"></i>
                                </div>
                                <small class="text-success" id="users-growth">+0% this month</small>
                            </div>
                        </div>
                    </div>
                    
                    <div class="col-lg-3 col-md-6">
                        <div class="card border-0 shadow-sm">
                            <div class="card-body text-center">
                                <div class="d-flex align-items-center justify-content-between">
                                    <div>
                                        <h6 class="card-subtitle text-muted mb-1">Photos Processed</h6>
                                        <h3 class="card-title mb-0" id="photos-processed-metric">-</h3>
                                    </div>
                                    <i class="fas fa-images fa-2x text-success opacity-75"></i>
                                </div>
                                <small class="text-info" id="photos-growth">+0% this month</small>
                            </div>
                        </div>
                    </div>
                    
                    <div class="col-lg-3 col-md-6">
                        <div class="card border-0 shadow-sm">
                            <div class="card-body text-center">
                                <div class="d-flex align-items-center justify-content-between">
                                    <div>
                                        <h6 class="card-subtitle text-muted mb-1">Detection Accuracy</h6>
                                        <h3 class="card-title mb-0" id="accuracy-metric">-</h3>
                                    </div>
                                    <i class="fas fa-bullseye fa-2x text-warning opacity-75"></i>
                                </div>
                                <small class="text-muted" id="accuracy-trend">Based on recent jobs</small>
                            </div>
                        </div>
                    </div>
                    
                    <div class="col-lg-3 col-md-6">
                        <div class="card border-0 shadow-sm">
                            <div class="card-body text-center">
                                <div class="d-flex align-items-center justify-content-between">
                                    <div>
                                        <h6 class="card-subtitle text-muted mb-1">Avg Processing Time</h6>
                                        <h3 class="card-title mb-0" id="avg-processing-time-metric">-</h3>
                                    </div>
                                    <i class="fas fa-clock fa-2x text-info opacity-75"></i>
                                </div>
                                <small class="text-muted" id="processing-time-trend">Per photo average</small>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Charts Row -->
                <div class="row g-4 mt-3">
                    <div class="col-lg-8">
                        <div class="card border-0 shadow-sm">
                            <div class="card-header bg-white border-bottom">
                                <h6 class="mb-0">User Activity Trends</h6>
                            </div>
                            <div class="card-body">
                                <div id="activity-trends-chart-container"></div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="col-lg-4">
                        <div class="card border-0 shadow-sm">
                            <div class="card-header bg-white border-bottom">
                                <h6 class="mb-0">Processing Methods</h6>
                            </div>
                            <div class="card-body">
                                <div id="processing-methods-chart-container"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Create users panel HTML
     * @private
     */
    createUsersPanel() {
        return `
            <!-- Users Panel -->
            <div class="tab-pane fade" id="users-panel">
                <div class="row g-4">
                    <div class="col-12">
                        <div class="card border-0 shadow-sm">
                            <div class="card-header bg-white border-bottom d-flex justify-content-between align-items-center">
                                <h6 class="mb-0">User Analytics</h6>
                                <div class="btn-group btn-group-sm">
                                    <button class="btn btn-outline-primary" data-sort="activity">
                                        <i class="fas fa-chart-line me-1"></i> By Activity
                                    </button>
                                    <button class="btn btn-outline-primary" data-sort="photos">
                                        <i class="fas fa-images me-1"></i> By Photos
                                    </button>
                                </div>
                            </div>
                            <div class="card-body">
                                <div class="table-responsive">
                                    <table class="table table-hover" id="users-analytics-table">
                                        <thead>
                                            <tr>
                                                <th>User</th>
                                                <th>Photos Uploaded</th>
                                                <th>Jobs Created</th>
                                                <th>Success Rate</th>
                                                <th>Last Active</th>
                                                <th>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody id="users-analytics-tbody">
                                            <tr>
                                                <td colspan="6" class="text-center text-muted">
                                                    <i class="fas fa-spinner fa-spin me-2"></i>Loading user analytics...
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Create performance panel HTML
     * @private
     */
    createPerformancePanel() {
        return `
            <!-- Performance Panel -->
            <div class="tab-pane fade" id="performance-panel">
                <div class="row g-4">
                    <div class="col-lg-6">
                        <div class="card border-0 shadow-sm">
                            <div class="card-header bg-white border-bottom">
                                <h6 class="mb-0">Detection Performance Trends</h6>
                            </div>
                            <div class="card-body">
                                <div id="detection-performance-chart-container"></div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="col-lg-6">
                        <div class="card border-0 shadow-sm">
                            <div class="card-header bg-white border-bottom">
                                <h6 class="mb-0">Processing Time Distribution</h6>
                            </div>
                            <div class="card-body">
                                <div id="processing-time-chart-container"></div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="row g-4 mt-3">
                    <div class="col-12">
                        <div class="card border-0 shadow-sm">
                            <div class="card-header bg-white border-bottom">
                                <h6 class="mb-0">Processing Time Breakdown</h6>
                            </div>
                            <div class="card-body">
                                <div id="processing-time-breakdown" class="row g-3">
                                    <!-- Processing time metrics will be populated here -->
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Create engagement panel HTML
     * @private
     */
    createEngagementPanel() {
        return `
            <!-- Engagement Panel -->
            <div class="tab-pane fade" id="engagement-panel">
                <div class="row g-4">
                    <div class="col-lg-6">
                        <div class="card border-0 shadow-sm">
                            <div class="card-header bg-white border-bottom">
                                <h6 class="mb-0">User Engagement Patterns</h6>
                            </div>
                            <div class="card-body">
                                <div id="engagement-patterns-display">
                                    <div class="text-center text-muted">
                                        <i class="fas fa-chart-pie fa-3x mb-2"></i>
                                        <p>Engagement insights will appear here</p>
                                        <small>Based on user activity and session data</small>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="col-lg-6">
                        <div class="card border-0 shadow-sm">
                            <div class="card-header bg-white border-bottom">
                                <h6 class="mb-0">Conversion Funnel</h6>
                            </div>
                            <div class="card-body">
                                <div id="conversion-funnel">
                                    <div class="text-center text-muted">
                                        <i class="fas fa-chart-line fa-3x mb-2"></i>
                                        <p>No conversion data available</p>
                                        <small>Funnel metrics will appear after user activity</small>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Create alerts panel HTML
     * @private
     */
    createAlertsPanel() {
        return `
            <!-- Alerts Panel -->
            <div class="tab-pane fade" id="alerts-panel">
                <div class="row g-4">
                    <div class="col-12">
                        <div class="card border-0 shadow-sm">
                            <div class="card-header bg-white border-bottom">
                                <h6 class="mb-0">System Alerts & Notifications</h6>
                            </div>
                            <div class="card-body">
                                <div id="alerts-display">
                                    <div class="text-center text-muted">
                                        <i class="fas fa-bell fa-3x mb-2"></i>
                                        <p>No active alerts</p>
                                        <small>System monitoring and alerting coming soon</small>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        // Auto-refresh toggle
        const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
        autoRefreshToggle?.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.startAutoRefresh();
            } else {
                this.stopAutoRefresh();
            }
        });

        // Back to app button
        const backToAppBtn = document.getElementById('back-to-app-btn');
        backToAppBtn?.addEventListener('click', () => {
            this.navigateBackToApp();
        });

        // Close dashboard button
        const closeDashboardBtn = document.getElementById('close-dashboard-btn');
        closeDashboardBtn?.addEventListener('click', () => {
            this.navigateBackToApp();
        });

        // Tab switching
        const tabs = document.querySelectorAll('#dashboard-tabs .nav-link');
        tabs.forEach(tab => {
            tab.addEventListener('shown.bs.tab', (e) => {
                const targetPanel = e.target.getAttribute('href').substring(1);
                this.currentTab = targetPanel;
                this.loadPanelData(targetPanel);
            });
        });

        // User analytics sorting
        const sortButtons = document.querySelectorAll('[data-sort]');
        sortButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const sortBy = e.target.closest('[data-sort]').getAttribute('data-sort');
                this.loadUserAnalytics(sortBy);
            });
        });

        // Export controls
        const exportButtons = document.querySelectorAll('[data-export]');
        exportButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const reportType = e.target.getAttribute('data-export');
                const format = e.target.getAttribute('data-format');
                this.exportReport(reportType, format);
            });
        });

        // Modal events
        const modal = document.getElementById('analytics-dashboard-modal');
        modal?.addEventListener('shown.bs.modal', () => {
            this.handleDashboardShown();
        });
        
        modal?.addEventListener('hidden.bs.modal', () => {
            this.handleDashboardHidden();
        });

        // Analytics service events
        if (this.analyticsService) {
            this.analyticsService.on('analytics:data:loaded', this.handleDataLoaded.bind(this));
            this.analyticsService.on('analytics:fetch:failed', this.handleDataError.bind(this));
        }
    }

    /**
     * Initialize chart components
     * @private
     */
    initializeCharts() {
        const chartConfigs = [
            {
                id: 'activity-trends',
                container: 'activity-trends-chart-container',
                type: 'line',
                options: { width: 600, height: 200 }
            },
            {
                id: 'processing-methods',
                container: 'processing-methods-chart-container', 
                type: 'pie',
                options: { width: 300, height: 200 }
            },
            {
                id: 'detection-performance',
                container: 'detection-performance-chart-container',
                type: 'bar',
                options: { width: 400, height: 250 }
            },
            {
                id: 'processing-time',
                container: 'processing-time-chart-container',
                type: 'bar',
                options: { width: 400, height: 250 }
            }
        ];

        chartConfigs.forEach(config => {
            const container = document.getElementById(config.container);
            if (container) {
                const chart = new ChartComponent(container, {
                    chartType: config.type,
                    ...config.options
                });
                this.charts.set(config.id, chart);
            }
        });
    }

    /**
     * Navigate back to app
     * @private
     */
    navigateBackToApp() {
        if (this.routerService) {
            this.routerService.navigate('results');
        } else {
            // Fallback to hash navigation
            window.location.hash = 'results';
        }
        this.hide();
    }

    /**
     * Show dashboard
     */
    async show() {
        if (!this.modal) return;
        
        // Check authentication
        if (!this.authService?.isAuthenticated()) {
            this.notificationService?.showToast({
                type: 'error',
                message: 'Please log in to view analytics'
            });
            return;
        }

        this.modal.show();
    }

    /**
     * Hide dashboard  
     */
    hide() {
        if (this.modal) {
            this.modal.hide();
        }
    }

    /**
     * Handle dashboard shown
     * @private
     */
    async handleDashboardShown() {
        this.isVisible = true;
        
        // Notify analytics service
        if (this.analyticsService) {
            this.analyticsService.emit('analytics:dashboard:shown');
        }

        // Load initial data
        await this.loadAllData();
        
        // Start auto-refresh if enabled
        const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
        if (autoRefreshToggle?.checked) {
            this.startAutoRefresh();
        }

        this.emit('dashboard:shown');
    }

    /**
     * Handle dashboard hidden
     * @private
     */
    handleDashboardHidden() {
        this.isVisible = false;
        
        // Notify analytics service
        if (this.analyticsService) {
            this.analyticsService.emit('analytics:dashboard:hidden');
        }

        // Stop auto-refresh
        this.stopAutoRefresh();

        this.emit('dashboard:hidden');
    }

    /**
     * Load all dashboard data
     */
    async loadAllData() {
        if (!this.analyticsService) {
            this.showError('Analytics service not available');
            return;
        }

        try {
            // Load overview data first
            await this.loadOverviewData();
        } catch (error) {
            this.error('Failed to load dashboard data:', error);
            this.showError(error.message);
        }
    }

    /**
     * Load data for specific panel
     */
    async loadPanelData(panelId) {
        switch (panelId) {
            case 'overview-panel':
                await this.loadOverviewData();
                break;
            case 'users-panel':
                await this.loadUserAnalytics();
                break;
            case 'performance-panel':
                await this.loadPerformanceData();
                break;
            case 'engagement-panel':
                await this.loadEngagementData();
                break;
            case 'alerts-panel':
                await this.loadAlertsData();
                break;
        }
    }

    /**
     * Load overview data
     * @private
     */
    async loadOverviewData() {
        if (!this.analyticsService) return;

        try {
            const data = await this.analyticsService.fetchDashboardData();
            this.updateOverviewMetrics(data);
            this.updateOverviewCharts(data);
        } catch (error) {
            this.error('Failed to load overview data:', error);
            this.showNoDataMessage(error.message);
        }
    }

    /**
     * Load user analytics
     * @private
     */
    async loadUserAnalytics(sortBy = 'activity') {
        if (!this.analyticsService) return;

        try {
            const data = await this.analyticsService.fetchUserAnalytics({ sortBy });
            this.updateUserAnalyticsTable(data);
        } catch (error) {
            this.error('Failed to load user analytics:', error);
            this.showUserAnalyticsError(error.message);
        }
    }

    /**
     * Load performance data
     * @private
     */
    async loadPerformanceData() {
        if (!this.analyticsService) return;

        try {
            const data = await this.analyticsService.fetchPerformanceData();
            this.updatePerformanceCharts(data);
        } catch (error) {
            this.error('Failed to load performance data:', error);
        }
    }

    /**
     * Load engagement data
     * @private
     */
    async loadEngagementData() {
        if (!this.analyticsService) return;

        try {
            const data = await this.analyticsService.fetchEngagementData();
            this.updateEngagementVisualizations(data);
        } catch (error) {
            this.error('Failed to load engagement data:', error);
        }
    }

    /**
     * Load alerts data
     * @private
     */
    async loadAlertsData() {
        if (!this.analyticsService) return;

        try {
            const data = await this.analyticsService.fetchAlertsData();
            this.updateAlertsDisplay(data);
        } catch (error) {
            this.error('Failed to load alerts data:', error);
        }
    }

    // Update Methods

    /**
     * Update overview metrics display
     * @private
     */
    updateOverviewMetrics(data) {
        if (!data?.metrics) return;

        const { totalUsers, photosProcessed, accuracy, avgProcessingTime } = data.metrics;
        const { trends } = data;

        // Update metric values
        this.updateElement('total-users-metric', totalUsers?.toLocaleString() || '0');
        this.updateElement('photos-processed-metric', photosProcessed?.toLocaleString() || '0');
        this.updateElement('accuracy-metric', `${accuracy?.toFixed(1) || '0'}%`);
        
        // Convert milliseconds to seconds for display
        const avgTimeSeconds = avgProcessingTime / 1000;
        this.updateElement('avg-processing-time-metric', `${avgTimeSeconds?.toFixed(2) || '0'}s`);

        // Update trends
        if (trends) {
            this.updateTrendElement('users-growth', trends.usersGrowth);
            this.updateTrendElement('photos-growth', trends.photosGrowth);
            this.updateElement('accuracy-trend', trends.accuracyTrend?.trend || 'No data');
            this.updateElement('processing-time-trend', trends.processingTimeTrend?.trend || 'No data');
        }
    }

    /**
     * Update overview charts
     * @private
     */
    updateOverviewCharts(data) {
        if (!data?.charts) return;

        // Update activity trends chart
        const activityChart = this.charts.get('activity-trends');
        if (activityChart && data.charts.activityTrends) {
            activityChart.setData(data.charts.activityTrends);
        }

        // Update processing methods chart
        const methodsChart = this.charts.get('processing-methods');
        if (methodsChart && data.charts.processingMethods) {
            methodsChart.setData(data.charts.processingMethods);
        }
    }

    /**
     * Update performance charts
     * @private
     */
    updatePerformanceCharts(data) {
        if (!data?.charts) return;

        // Update detection performance chart
        const detectionChart = this.charts.get('detection-performance');
        if (detectionChart && data.charts.performanceOverTime) {
            detectionChart.setData(data.charts.performanceOverTime);
        }

        // Update processing time chart
        const timeChart = this.charts.get('processing-time');
        if (timeChart && data.charts.accuracyDistribution) {
            timeChart.setData(data.charts.accuracyDistribution);
        }

        // Update processing time breakdown
        if (data.metrics) {
            this.updateProcessingTimeBreakdown(data.metrics);
        }
    }

    /**
     * Update user analytics table
     * @private
     */
    updateUserAnalyticsTable(data) {
        const tbody = document.getElementById('users-analytics-tbody');
        if (!tbody) return;

        if (!data?.users?.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-muted">
                        No user data available
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = data.users.map(user => `
            <tr>
                <td>
                    <div class="d-flex align-items-center">
                        <div class="avatar-placeholder bg-primary text-white rounded-circle me-2" style="width: 32px; height: 32px; line-height: 32px; text-align: center; font-size: 12px;">
                            ${user.email?.charAt(0).toUpperCase() || 'U'}
                        </div>
                        <div>
                            <div class="fw-semibold">${user.email || 'Unknown'}</div>
                            <small class="text-muted">ID: ${user.id || 'N/A'}</small>
                        </div>
                    </div>
                </td>
                <td>${user.photosUploaded?.toLocaleString() || '0'}</td>
                <td>${user.jobsCreated?.toLocaleString() || '0'}</td>
                <td>
                    <span class="badge bg-${user.successRate > 80 ? 'success' : user.successRate > 60 ? 'warning' : 'danger'}">
                        ${user.successRate?.toFixed(1) || '0'}%
                    </span>
                </td>
                <td>${this.formatDate(user.lastActive)}</td>
                <td>
                    <span class="badge bg-${user.status === 'active' ? 'success' : 'secondary'}">
                        ${user.status || 'Unknown'}
                    </span>
                </td>
            </tr>
        `).join('');
    }

    /**
     * Update engagement visualizations
     * @private
     */
    updateEngagementVisualizations(data) {
        // Update engagement patterns
        const patternsDisplay = document.getElementById('engagement-patterns-display');
        if (patternsDisplay && data?.patterns) {
            // Show basic engagement metrics
            patternsDisplay.innerHTML = `
                <div class="row g-3">
                    <div class="col-12">
                        <div class="text-center mb-3">
                            <h6>Peak Usage Time</h6>
                            <p class="fs-5 text-primary">${data.patterns.peakUsage}</p>
                        </div>
                    </div>
                    <div class="col-6">
                        <div class="text-center">
                            <h6>Average Session</h6>
                            <p class="fs-6 text-info">${data.patterns.averageSession} min</p>
                        </div>
                    </div>
                    <div class="col-6">
                        <div class="text-center">
                            <h6>Bounce Rate</h6>
                            <p class="fs-6 text-warning">${data.patterns.bounceRate}%</p>
                        </div>
                    </div>
                </div>
            `;
        }

        // Update conversion funnel
        this.updateConversionFunnel(data);
    }

    /**
     * Update conversion funnel
     * @private
     */
    updateConversionFunnel(data) {
        const funnelContainer = document.getElementById('conversion-funnel');
        if (!funnelContainer) return;

        if (!data?.funnelSteps?.length) {
            funnelContainer.innerHTML = `
                <div class="text-center text-muted">
                    <i class="fas fa-chart-line fa-3x mb-2"></i>
                    <p>No conversion data available</p>
                    <small>Funnel metrics will appear after user activity</small>
                </div>
            `;
            return;
        }

        funnelContainer.innerHTML = data.funnelSteps.map(step => `
            <div class="d-flex align-items-center mb-3">
                <div class="flex-grow-1">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <span class="fw-semibold">${step.name}</span>
                        <span class="text-muted">${step.count?.toLocaleString()}</span>
                    </div>
                    <div class="progress" style="height: 8px;">
                        <div class="progress-bar bg-danger" 
                             style="width: ${step.percentage}%"
                             title="${step.percentage}% conversion"></div>
                    </div>
                </div>
                <div class="ms-2 text-muted" style="width: 45px;">
                    ${step.percentage?.toFixed(1)}%
                </div>
            </div>
        `).join('');
    }

    /**
     * Update processing time breakdown
     * @private
     */
    updateProcessingTimeBreakdown(metrics) {
        const breakdown = document.getElementById('processing-time-breakdown');
        if (!breakdown) return;

        const avgTimeMs = metrics.avgProcessingTime || 0;
        const totalPhotos = metrics.totalPhotos || 0;
        
        // Convert to different time units for better readability
        const avgTimeSeconds = avgTimeMs / 1000;
        const estimatedTotalSeconds = (avgTimeSeconds * totalPhotos);
        const estimatedTotalMinutes = estimatedTotalSeconds / 60;
        const estimatedTotalHours = estimatedTotalMinutes / 60;
        
        const breakdownMetrics = [
            {
                name: 'Average Per Photo',
                value: avgTimeSeconds > 0 ? `${avgTimeSeconds.toFixed(2)}s` : 'No data',
                icon: 'fas fa-image',
                color: avgTimeSeconds > 3 ? 'danger' : avgTimeSeconds > 1.5 ? 'warning' : 'success'
            },
            {
                name: 'Total Processing Time',
                value: estimatedTotalMinutes > 60 ? 
                    `${estimatedTotalHours.toFixed(1)}h` : 
                    `${estimatedTotalMinutes.toFixed(1)}m`,
                icon: 'fas fa-clock',
                color: 'info'
            },
            {
                name: 'Photos Analyzed',
                value: totalPhotos.toLocaleString(),
                icon: 'fas fa-chart-bar',
                color: 'primary'
            },
            {
                name: 'Processing Speed',
                value: avgTimeSeconds > 0 ? `${(3600 / avgTimeSeconds).toFixed(0)}/hour` : 'N/A',
                icon: 'fas fa-tachometer-alt',
                color: 'secondary'
            }
        ];
        
        breakdown.innerHTML = breakdownMetrics.map(metric => `
            <div class="col-lg-3 col-md-6">
                <div class="card border-0 shadow-sm h-100">
                    <div class="card-body text-center">
                        <i class="${metric.icon} fa-2x text-${metric.color} mb-2"></i>
                        <h6 class="card-subtitle text-muted mb-1">${metric.name}</h6>
                        <h4 class="card-title mb-0 text-${metric.color}">${metric.value}</h4>
                    </div>
                </div>
            </div>
        `).join('');
    }

    /**
     * Update alerts display
     * @private
     */
    updateAlertsDisplay(data) {
        const alertsDisplay = document.getElementById('alerts-display');
        if (!alertsDisplay) return;

        if (!data?.alerts?.length) {
            alertsDisplay.innerHTML = `
                <div class="text-center text-muted">
                    <i class="fas fa-bell fa-3x mb-2"></i>
                    <p>No active alerts</p>
                    <small>System monitoring and alerting coming soon</small>
                </div>
            `;
            return;
        }

        alertsDisplay.innerHTML = data.alerts.map(alert => `
            <div class="alert alert-${alert.severity || 'info'} d-flex align-items-center" role="alert">
                <i class="fas fa-${alert.severity === 'critical' ? 'exclamation-triangle' : 'info-circle'} me-2"></i>
                <div class="flex-grow-1">
                    <strong>${alert.title}</strong>
                    <div>${alert.message}</div>
                    <small class="text-muted">${this.formatDate(alert.timestamp)}</small>
                </div>
            </div>
        `).join('');
    }

    // Auto-refresh Management

    /**
     * Start auto-refresh
     * @private
     */
    startAutoRefresh() {
        if (this.autoRefreshTimer) {
            clearInterval(this.autoRefreshTimer);
        }

        this.autoRefreshTimer = setInterval(() => {
            if (this.isVisible && this.analyticsService) {
                this.log('Auto-refreshing analytics dashboard...');
                this.refreshCurrentPanel();
            }
        }, this.options.refreshInterval);

        this.log('Auto-refresh started');
    }

    /**
     * Stop auto-refresh
     * @private
     */
    stopAutoRefresh() {
        if (this.autoRefreshTimer) {
            clearInterval(this.autoRefreshTimer);
            this.autoRefreshTimer = null;
        }

        this.log('Auto-refresh stopped');
    }

    /**
     * Refresh current panel
     * @private
     */
    async refreshCurrentPanel() {
        await this.loadPanelData(this.currentTab);
    }

    // Export Functionality

    /**
     * Export analytics report
     */
    async exportReport(reportType, format) {
        try {
            if (!this.analyticsService) {
                throw new Error('Analytics service not available');
            }

            this.log(`Exporting ${reportType} as ${format}`);

            // Get appropriate data based on report type
            let data;
            switch (reportType) {
                case 'business_report':
                    data = await this.analyticsService.getAnalyticsSummary();
                    break;
                case 'user_analytics':
                    data = await this.analyticsService.fetchUserAnalytics();
                    break;
                case 'system_metrics':
                    data = await this.analyticsService.fetchPerformanceData();
                    break;
                case 'detection_accuracy':
                    data = await this.analyticsService.fetchDashboardData();
                    break;
                default:
                    throw new Error('Unknown report type');
            }

            // Generate and download file
            this.downloadReport(data, reportType, format);

            this.notificationService?.showToast({
                type: 'success',
                message: `${reportType} exported successfully`
            });

        } catch (error) {
            this.error('Export failed:', error);
            this.notificationService?.showToast({
                type: 'error',
                message: `Export failed: ${error.message}`
            });
        }
    }

    /**
     * Download report file
     * @private
     */
    downloadReport(data, reportType, format) {
        let content;
        let mimeType;
        let filename;

        if (format === 'json') {
            content = JSON.stringify(data, null, 2);
            mimeType = 'application/json';
            filename = `${reportType}_${this.formatDateForFilename()}.json`;
        } else if (format === 'csv') {
            content = this.convertToCSV(data);
            mimeType = 'text/csv';
            filename = `${reportType}_${this.formatDateForFilename()}.csv`;
        } else {
            throw new Error('Unsupported format');
        }

        // Create and trigger download
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Convert data to CSV format
     * @private
     */
    convertToCSV(data) {
        // Simple CSV conversion - can be enhanced for complex nested data
        if (!data || typeof data !== 'object') {
            return 'No data available';
        }

        // Flatten object for CSV
        const flattened = this.flattenObject(data);
        const headers = Object.keys(flattened);
        const values = Object.values(flattened);

        return headers.join(',') + '\n' + values.map(v => `"${v}"`).join(',');
    }

    /**
     * Flatten nested object for CSV export
     * @private
     */
    flattenObject(obj, prefix = '') {
        const flattened = {};
        
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const value = obj[key];
                const newKey = prefix ? `${prefix}.${key}` : key;
                
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    Object.assign(flattened, this.flattenObject(value, newKey));
                } else {
                    flattened[newKey] = Array.isArray(value) ? value.join(';') : value;
                }
            }
        }
        
        return flattened;
    }

    // Utility Methods

    /**
     * Update element content safely
     * @private
     */
    updateElement(id, content) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = content;
        }
    }

    /**
     * Update trend element with growth indicators
     * @private
     */
    updateTrendElement(id, trendData) {
        const element = document.getElementById(id);
        if (!element || !trendData) return;

        const { percentage, direction } = trendData;
        const icon = direction === 'up' ? 'fa-arrow-up' : direction === 'down' ? 'fa-arrow-down' : 'fa-minus';
        const colorClass = direction === 'up' ? 'text-success' : direction === 'down' ? 'text-danger' : 'text-muted';

        element.className = colorClass;
        element.innerHTML = `<i class="fas ${icon} me-1"></i>${percentage > 0 ? '+' : ''}${percentage}% this month`;
    }

    /**
     * Show error message in metrics
     * @private
     */
    showNoDataMessage(message) {
        // Update metrics to show error state
        this.updateElement('total-users-metric', 'Error');
        this.updateElement('photos-processed-metric', 'Error');
        this.updateElement('accuracy-metric', 'Error');
        this.updateElement('avg-processing-time-metric', 'Error');
        
        // Update trend messages
        this.updateElement('users-growth', message);
        this.updateElement('photos-growth', 'Check console for details');
        this.updateElement('processing-time-trend', 'Refresh to retry');
    }

    /**
     * Show error in user analytics table
     * @private
     */
    showUserAnalyticsError(message) {
        const tbody = document.getElementById('users-analytics-tbody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-danger">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        ${message}
                    </td>
                </tr>
            `;
        }
    }

    /**
     * Show general error message
     * @private
     */
    showError(message) {
        this.notificationService?.showToast({
            type: 'error',
            message: `Analytics Error: ${message}`
        });
    }

    /**
     * Format date for display
     * @private
     */
    formatDate(dateString) {
        if (!dateString) return 'Never';
        
        try {
            const date = new Date(dateString);
            return date.toLocaleString();
        } catch (error) {
            return 'Invalid date';
        }
    }

    /**
     * Format date for filename
     * @private
     */
    formatDateForFilename() {
        const now = new Date();
        return now.toISOString().split('T')[0]; // YYYY-MM-DD format
    }

    // Event Handlers

    /**
     * Handle data loaded from analytics service
     * @private
     */
    handleDataLoaded(data) {
        this.log('Analytics data loaded:', data.type);
        
        // Update UI based on data type
        if (data.type === 'dashboard' && this.currentTab === 'overview-panel') {
            this.updateOverviewMetrics(data.data);
            this.updateOverviewCharts(data.data);
        }
    }

    /**
     * Handle data fetch error
     * @private
     */
    handleDataError(data) {
        this.error('Analytics data fetch failed:', data.type, data.error);
        
        if (data.type === 'dashboard' && this.currentTab === 'overview-panel') {
            this.showNoDataMessage(data.error);
        }
    }

    /**
     * Cleanup dashboard component
     */
    async destroy() {
        // Stop auto-refresh
        this.stopAutoRefresh();

        // Destroy charts
        for (const chart of this.charts.values()) {
            if (chart && typeof chart.destroy === 'function') {
                await chart.destroy();
            }
        }
        this.charts.clear();

        // Remove modal from DOM
        const modal = document.getElementById('analytics-dashboard-modal');
        if (modal) {
            modal.remove();
        }

        // Remove dashboard button
        const button = document.getElementById('analytics-dashboard-btn');
        if (button) {
            button.remove();
        }

        await super.destroy();
    }
}