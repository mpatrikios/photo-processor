/**
 * AnalyticsDashboard - Real-time analytics and business intelligence dashboard
 */

class AnalyticsDashboard {
    constructor(stateManager) {
        this.state = stateManager;
        this.refreshInterval = null;
        this.charts = {};
        this.isVisible = false;
        
        this.initializeDashboard();
        this.bindEvents();
    }
    
    /**
     * Initialize dashboard UI
     */
    initializeDashboard() {
        // Add dashboard toggle button to main UI
        this.addDashboardButton();
        
        // Create dashboard modal
        this.createDashboardModal();
    }
    
    /**
     * Add dashboard button to the main navigation
     */
    addDashboardButton() {
        const navSection = document.querySelector('.position-absolute.top-0.end-0');
        if (navSection) {
            const button = document.createElement('button');
            button.className = 'btn btn-outline-light btn-sm me-2';
            button.id = 'analytics-dashboard-btn';
            button.innerHTML = '<i class="fas fa-chart-line me-1"></i> Analytics';
            button.title = 'View analytics dashboard';
            
            button.addEventListener('click', () => {
                this.showDashboard();
            });
            
            // Insert before profile button
            const profileBtn = document.getElementById('profileBtn');
            if (profileBtn) {
                navSection.insertBefore(button, profileBtn);
            }
        }
    }
    
    /**
     * Create analytics dashboard modal
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
                                <div class="form-check form-switch me-3">
                                    <input class="form-check-input" type="checkbox" id="auto-refresh-toggle" checked>
                                    <label class="form-check-label text-white" for="auto-refresh-toggle">
                                        Auto Refresh (30s)
                                    </label>
                                </div>
                                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
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
                                                    <li><a class="dropdown-item" href="#" onclick="window.analyticsDashboard?.exportReport('business_report', 'json')">📊 Business Report (JSON)</a></li>
                                                    <li><a class="dropdown-item" href="#" onclick="window.analyticsDashboard?.exportReport('business_report', 'csv')">📊 Business Report (CSV)</a></li>
                                                    <li><hr class="dropdown-divider"></li>
                                                    <li><h6 class="dropdown-header">Detailed Analytics</h6></li>
                                                    <li><a class="dropdown-item" href="#" onclick="window.analyticsDashboard?.exportReport('user_analytics', 'csv')">👥 User Analytics (CSV)</a></li>
                                                    <li><a class="dropdown-item" href="#" onclick="window.analyticsDashboard?.exportReport('system_metrics', 'csv')">⚡ System Metrics (CSV)</a></li>
                                                    <li><a class="dropdown-item" href="#" onclick="window.analyticsDashboard?.exportReport('conversion_funnel', 'csv')">🔄 Conversion Funnel (CSV)</a></li>
                                                    <li><a class="dropdown-item" href="#" onclick="window.analyticsDashboard?.exportReport('detection_accuracy', 'csv')">🎯 Detection Accuracy (CSV)</a></li>
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
                                                        <canvas id="activity-trends-chart" width="400" height="200"></canvas>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div class="col-lg-4">
                                                <div class="card border-0 shadow-sm">
                                                    <div class="card-header bg-white border-bottom">
                                                        <h6 class="mb-0">Processing Methods</h6>
                                                    </div>
                                                    <div class="card-body">
                                                        <canvas id="processing-methods-chart" width="200" height="200"></canvas>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    
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
                                    
                                    <!-- Performance Panel -->
                                    <div class="tab-pane fade" id="performance-panel">
                                        <div class="row g-4">
                                            <div class="col-lg-6">
                                                <div class="card border-0 shadow-sm">
                                                    <div class="card-header bg-white border-bottom">
                                                        <h6 class="mb-0">Detection Performance Trends</h6>
                                                    </div>
                                                    <div class="card-body">
                                                        <canvas id="detection-performance-chart" width="400" height="250"></canvas>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div class="col-lg-6">
                                                <div class="card border-0 shadow-sm">
                                                    <div class="card-header bg-white border-bottom">
                                                        <h6 class="mb-0">Processing Time Distribution</h6>
                                                    </div>
                                                    <div class="card-body">
                                                        <canvas id="processing-time-chart" width="400" height="250"></canvas>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div class="row g-4 mt-3">
                                            <div class="col-12">
                                                <div class="card border-0 shadow-sm">
                                                    <div class="card-header bg-white border-bottom">
                                                        <h6 class="mb-0">System Performance Metrics</h6>
                                                    </div>
                                                    <div class="card-body">
                                                        <div id="system-metrics-grid" class="row g-3">
                                                            <!-- System metrics will be populated here -->
                                                        </div>
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
                                    
                                    <!-- Engagement Panel -->
                                    <div class="tab-pane fade" id="engagement-panel">
                                        <div class="row g-4">
                                            <div class="col-lg-8">
                                                <div class="card border-0 shadow-sm">
                                                    <div class="card-header bg-white border-bottom">
                                                        <h6 class="mb-0">User Engagement Heatmap</h6>
                                                    </div>
                                                    <div class="card-body">
                                                        <div id="engagement-heatmap" style="height: 300px;">
                                                            <div class="d-flex align-items-center justify-content-center h-100">
                                                                <div class="text-center text-muted">
                                                                    <i class="fas fa-mouse-pointer fa-3x mb-2"></i>
                                                                    <p>Engagement tracking will appear here</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div class="col-lg-4">
                                                <div class="card border-0 shadow-sm">
                                                    <div class="card-header bg-white border-bottom">
                                                        <h6 class="mb-0">Conversion Funnel</h6>
                                                    </div>
                                                    <div class="card-body">
                                                        <div id="conversion-funnel">
                                                            <!-- Funnel visualization -->
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <!-- Alerts Panel -->
                                    <div class="tab-pane fade" id="alerts-panel">
                                        <div class="row g-4">
                                            <div class="col-12">
                                                <div class="card border-0 shadow-sm">
                                                    <div class="card-header bg-white border-bottom d-flex justify-content-between align-items-center">
                                                        <h6 class="mb-0">System Alerts & Monitoring</h6>
                                                        <button class="btn btn-primary btn-sm" id="create-alert-rule-btn">
                                                            <i class="fas fa-plus me-1"></i> New Alert Rule
                                                        </button>
                                                    </div>
                                                    <div class="card-body">
                                                        <div id="alerts-content">
                                                            <div class="text-center text-muted">
                                                                <i class="fas fa-bell fa-3x mb-2"></i>
                                                                <p>No recent alerts</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Remove existing modal if present
        document.getElementById('analytics-dashboard-modal')?.remove();
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
    
    /**
     * Bind event listeners
     */
    bindEvents() {
        // Auto-refresh toggle
        document.getElementById('auto-refresh-toggle')?.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.startAutoRefresh();
            } else {
                this.stopAutoRefresh();
            }
        });
        
        // Tab switching
        document.querySelectorAll('#dashboard-tabs .nav-link').forEach(tab => {
            tab.addEventListener('shown.bs.tab', (e) => {
                const targetPanel = e.target.getAttribute('href').substring(1);
                this.loadPanelData(targetPanel);
            });
        });
        
        // User analytics sorting
        document.querySelectorAll('[data-sort]').forEach(button => {
            button.addEventListener('click', (e) => {
                const sortBy = e.target.closest('[data-sort]').getAttribute('data-sort');
                this.loadUserAnalytics(sortBy);
            });
        });
        
        // Modal events
        const modal = document.getElementById('analytics-dashboard-modal');
        modal?.addEventListener('shown.bs.modal', () => {
            this.isVisible = true;
            this.loadAllData();
            this.startAutoRefresh();
        });
        
        modal?.addEventListener('hidden.bs.modal', () => {
            this.isVisible = false;
            this.stopAutoRefresh();
        });
    }
    
    /**
     * Show analytics dashboard
     */
    async showDashboard() {
        const modal = new bootstrap.Modal(document.getElementById('analytics-dashboard-modal'));
        modal.show();
    }
    
    /**
     * Start auto-refresh
     */
    startAutoRefresh() {
        // Disable auto-refresh if StateManager is not properly initialized
        if (!this.state || !this.state.request) {
            console.warn('Auto-refresh disabled: StateManager not properly initialized');
            return;
        }
        
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        this.refreshInterval = setInterval(() => {
            if (this.isVisible) {
                console.log('Auto-refreshing analytics dashboard...');
                this.refreshCurrentPanel();
            }
        }, 30000); // 30 seconds
    }
    
    /**
     * Stop auto-refresh
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
    
    /**
     * Refresh current active panel
     */
    refreshCurrentPanel() {
        const activeTab = document.querySelector('#dashboard-tabs .nav-link.active');
        if (activeTab) {
            const targetPanel = activeTab.getAttribute('href').substring(1);
            this.loadPanelData(targetPanel);
        }
    }
    
    /**
     * Load all dashboard data
     */
    async loadAllData() {
        await this.loadOverviewData();
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
     * Load overview dashboard data
     */
    async loadOverviewData() {
        try {
            console.log('Loading analytics overview data...');
            
            // Check if state is properly initialized
            if (!this.state) {
                console.error('StateManager not initialized');
                this.showNoDataMessage('StateManager not initialized');
                return;
            }
            
            // Check if request method exists
            if (!this.state.request) {
                console.error('StateManager request method not found');
                this.showNoDataMessage('StateManager request method not found');
                return;
            }
            
            // Check if API is configured
            if (!this.state.state || !this.state.state.api || !this.state.state.api.baseUrl) {
                console.error('API not configured in StateManager');
                this.showNoDataMessage('API not configured');
                return;
            }
            
            console.log('API Base URL:', this.state.state.api.baseUrl);
            console.log('Auth token exists:', !!this.state.state.auth.token);
            console.log('Is authenticated:', this.state.state.auth.isAuthenticated);
            
            // Check authentication before making request
            if (!this.state.state.auth.isAuthenticated || !this.state.state.auth.token) {
                console.error('User not authenticated for analytics');
                this.showNoDataMessage('Please log in to view analytics');
                return;
            }
            
            const response = await this.state.request('GET', '/analytics/user/dashboard');
            
            console.log('Analytics API response status:', response.status);
            
            if (response.ok) {
                const data = await response.json();
                console.log('Analytics data received:', data);
                this.updateOverviewMetrics(data);
            } else {
                const errorData = await response.json().catch(() => ({}));
                console.error('Analytics API error:', response.status, errorData);
                this.showNoDataMessage(`API Error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Failed to load overview data:', error);
            this.showNoDataMessage(`Connection Error: ${error.message}`);
        }
    }
    
    showNoDataMessage(message) {
        // Update metrics to show error state
        document.getElementById('total-users-metric').textContent = 'Error';
        document.getElementById('photos-processed-metric').textContent = 'Error';
        document.getElementById('accuracy-metric').textContent = 'Error';
        document.getElementById('avg-processing-time-metric').textContent = 'Error';
        
        // Update trend messages
        document.getElementById('users-growth').textContent = message;
        document.getElementById('photos-growth').textContent = 'Check console for details';
        document.getElementById('processing-time-trend').textContent = 'Refresh to retry';
    }
    
    /**
     * Update overview metrics display
     */
    updateOverviewMetrics(data) {
        // Update KPI cards
        const totalUsers = data.user_stats?.current_quota?.user_id || 0;
        const photosProcessed = data.user_stats?.total_photos_processed || 0;
        const accuracy = data.detection_accuracy?.percentage || 0;
        const avgProcessingTime = data.detection_accuracy?.avg_processing_time_ms || 0;
        
        document.getElementById('total-users-metric').textContent = totalUsers.toLocaleString();
        document.getElementById('photos-processed-metric').textContent = photosProcessed.toLocaleString();
        document.getElementById('accuracy-metric').textContent = `${accuracy.toFixed(1)}%`;
        
        // Convert milliseconds to seconds for display
        const avgTimeSeconds = avgProcessingTime / 1000;
        document.getElementById('avg-processing-time-metric').textContent = `${avgTimeSeconds.toFixed(2)}s`;
        
        // Update trends from real data
        const currentMonth = data.user_stats?.current_quota?.current_month || 'N/A';
        document.getElementById('users-growth').textContent = `Active in ${currentMonth}`;
        document.getElementById('photos-growth').textContent = `${data.user_stats?.uploads || 0} uploads this period`;
        document.getElementById('processing-time-trend').textContent = `${data.detection_accuracy?.total_photos || 0} photos analyzed`;
        
        // Update charts
        this.updateActivityTrendsChart(data.processing_trends || []);
        this.updateProcessingMethodsChart(data);
    }
    
    /**
     * Load user analytics data
     */
    async loadUserAnalytics(sortBy = 'activity') {
        try {
            // For now, just show placeholder since we need admin access
            const tbody = document.getElementById('users-analytics-tbody');
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-muted">
                        <i class="fas fa-lock me-2"></i>
                        Admin access required for user analytics
                    </td>
                </tr>
            `;
        } catch (error) {
            console.error('Failed to load user analytics:', error);
        }
    }
    
    /**
     * Load performance data
     */
    async loadPerformanceData() {
        try {
            const response = await this.state.request('GET', '/analytics/user/dashboard');
            
            if (response.ok) {
                const data = await response.json();
                this.updatePerformanceCharts(data);
            }
        } catch (error) {
            console.error('Failed to load performance data:', error);
        }
    }
    
    /**
     * Load engagement data
     */
    async loadEngagementData() {
        try {
            const response = await this.state.request('GET', '/analytics/user/engagement');
            
            if (response.ok) {
                const data = await response.json();
                this.updateEngagementVisualizations(data);
            }
        } catch (error) {
            console.error('Failed to load engagement data:', error);
        }
    }
    
    /**
     * Load alerts data
     */
    async loadAlertsData() {
        const alertsContent = document.getElementById('alerts-content');
        alertsContent.innerHTML = `
            <div class="text-center text-muted">
                <i class="fas fa-bell fa-3x mb-2"></i>
                <p>Alert system ready</p>
                <small>No alerts configured yet</small>
            </div>
        `;
    }
    
    /**
     * Update activity trends chart
     */
    updateActivityTrendsChart(trendsData) {
        const canvas = document.getElementById('activity-trends-chart');
        const ctx = canvas.getContext('2d');
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (!trendsData || trendsData.length === 0) {
            // Show no data message
            ctx.fillStyle = '#666';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No activity data available', canvas.width / 2, canvas.height / 2);
            ctx.font = '12px Arial';
            ctx.fillText('Data will appear after users start processing photos', canvas.width / 2, canvas.height / 2 + 25);
            return;
        }
        
        // Draw real trends data
        ctx.strokeStyle = '#dc3545';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        const maxValue = Math.max(...trendsData.map(d => d.value || 0));
        
        for (let i = 0; i < trendsData.length; i++) {
            const x = (canvas.width / trendsData.length) * i;
            const y = canvas.height - ((trendsData[i].value || 0) / maxValue * canvas.height * 0.8);
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
        
        // Add labels
        ctx.fillStyle = '#666';
        ctx.font = '12px Arial';
        ctx.textAlign = 'left';
        ctx.fillText('Activity trends over time', 10, 20);
        ctx.fillText(`Peak: ${maxValue} activities`, 10, canvas.height - 10);
    }
    
    /**
     * Update processing methods chart
     */
    updateProcessingMethodsChart(data) {
        const canvas = document.getElementById('processing-methods-chart');
        const ctx = canvas.getContext('2d');
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Get real detection data from API response
        const googleDetections = data.detection_stats?.google_vision_detections || 0;
        const tesseractDetections = data.detection_stats?.tesseract_detections || 0;
        const manualLabels = data.detection_stats?.manual_labels || 0;
        const totalDetections = googleDetections + tesseractDetections + manualLabels;
        
        if (totalDetections === 0) {
            // Show no data message
            ctx.fillStyle = '#666';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No detection data', canvas.width / 2, canvas.height / 2);
            ctx.font = '12px Arial';
            ctx.fillText('available yet', canvas.width / 2, canvas.height / 2 + 20);
            return;
        }
        
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = Math.min(centerX, centerY) - 30;
        
        // Calculate angles
        const googleAngle = (googleDetections / totalDetections) * 2 * Math.PI;
        const tesseractAngle = (tesseractDetections / totalDetections) * 2 * Math.PI;
        const manualAngle = (manualLabels / totalDetections) * 2 * Math.PI;
        
        let currentAngle = 0;
        
        // Google Vision segment
        if (googleDetections > 0) {
            ctx.fillStyle = '#dc3545';
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + googleAngle);
            ctx.closePath();
            ctx.fill();
            currentAngle += googleAngle;
        }
        
        // Tesseract segment
        if (tesseractDetections > 0) {
            ctx.fillStyle = '#28a745';
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + tesseractAngle);
            ctx.closePath();
            ctx.fill();
            currentAngle += tesseractAngle;
        }
        
        // Manual labels segment
        if (manualLabels > 0) {
            ctx.fillStyle = '#ffc107';
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + manualAngle);
            ctx.closePath();
            ctx.fill();
        }
        
        // Labels
        ctx.fillStyle = '#000';
        ctx.font = '11px Arial';
        ctx.textAlign = 'left';
        if (googleDetections > 0) {
            const googlePercent = ((googleDetections / totalDetections) * 100).toFixed(1);
            ctx.fillText(`Google Vision: ${googlePercent}%`, 10, canvas.height - 45);
        }
        if (tesseractDetections > 0) {
            const tesseractPercent = ((tesseractDetections / totalDetections) * 100).toFixed(1);
            ctx.fillText(`Tesseract: ${tesseractPercent}%`, 10, canvas.height - 30);
        }
        if (manualLabels > 0) {
            const manualPercent = ((manualLabels / totalDetections) * 100).toFixed(1);
            ctx.fillText(`Manual: ${manualPercent}%`, 10, canvas.height - 15);
        }
    }
    
    /**
     * Update performance charts
     */
    updatePerformanceCharts(data) {
        this.updateDetectionPerformanceChart(data.detection_accuracy || {});
        this.updateProcessingTimeChart(data.processing_trends || []);
        this.updateSystemMetricsGrid();
        this.updateProcessingTimeBreakdown(data.detection_accuracy || {});
    }
    
    updateDetectionPerformanceChart(accuracyData) {
        const canvas = document.getElementById('detection-performance-chart');
        const ctx = canvas.getContext('2d');
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const accuracy = accuracyData.percentage || 0;
        
        if (accuracy === 0) {
            ctx.fillStyle = '#666';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No detection data available', canvas.width / 2, canvas.height / 2);
            return;
        }
        
        // Show accuracy as a simple bar
        const barWidth = canvas.width * 0.8;
        const barHeight = 30;
        const barX = (canvas.width - barWidth) / 2;
        const barY = canvas.height / 2 - barHeight / 2;
        
        // Background bar
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(barX, barY, barWidth, barHeight);
        
        // Accuracy bar
        ctx.fillStyle = accuracy > 80 ? '#28a745' : accuracy > 60 ? '#ffc107' : '#dc3545';
        ctx.fillRect(barX, barY, (accuracy / 100) * barWidth, barHeight);
        
        // Add accuracy percentage
        ctx.fillStyle = '#000';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`${accuracy.toFixed(1)}% Detection Accuracy`, canvas.width / 2, barY - 15);
        
        ctx.font = '12px Arial';
        ctx.fillText(`Based on ${accuracyData.total_photos || 0} photos`, canvas.width / 2, barY + barHeight + 25);
    }
    
    updateProcessingTimeChart(trendsData) {
        const canvas = document.getElementById('processing-time-chart');
        const ctx = canvas.getContext('2d');
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (!trendsData || trendsData.length === 0) {
            ctx.fillStyle = '#666';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No processing time data', canvas.width / 2, canvas.height / 2);
            ctx.font = '12px Arial';
            ctx.fillText('available yet', canvas.width / 2, canvas.height / 2 + 20);
            return;
        }
        
        // Draw bars from real data
        const barWidth = canvas.width / trendsData.length;
        const maxTime = Math.max(...trendsData.map(d => d.processing_time || 0));
        
        for (let i = 0; i < trendsData.length; i++) {
            const time = trendsData[i].processing_time || 0;
            const barHeight = maxTime > 0 ? (time / maxTime) * canvas.height * 0.8 : 0;
            const x = i * barWidth;
            const y = canvas.height - barHeight;
            
            ctx.fillStyle = time > 3000 ? '#dc3545' : time > 1500 ? '#ffc107' : '#28a745';
            ctx.fillRect(x, y, barWidth - 5, barHeight);
        }
        
        ctx.fillStyle = '#000';
        ctx.font = '12px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(`Processing time distribution (${trendsData.length} jobs)`, 10, 20);
    }
    
    updateSystemMetricsGrid() {
        const grid = document.getElementById('system-metrics-grid');
        grid.innerHTML = `
            <div class="col-12 text-center text-muted">
                <i class="fas fa-chart-bar fa-3x mb-2"></i>
                <p>System metrics not available</p>
                <small>Real-time system monitoring coming soon</small>
            </div>
        `;
    }
    
    updateProcessingTimeBreakdown(accuracyData) {
        const breakdown = document.getElementById('processing-time-breakdown');
        const avgTimeMs = accuracyData.avg_processing_time_ms || 0;
        const totalPhotos = accuracyData.total_photos || 0;
        
        // Convert to different time units for better readability
        const avgTimeSeconds = avgTimeMs / 1000;
        const avgTimeMinutes = avgTimeSeconds / 60;
        
        // Estimate total processing time if all photos were processed
        const estimatedTotalSeconds = (avgTimeSeconds * totalPhotos);
        const estimatedTotalMinutes = estimatedTotalSeconds / 60;
        const estimatedTotalHours = estimatedTotalMinutes / 60;
        
        const metrics = [
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
        
        breakdown.innerHTML = metrics.map(metric => `
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
     * Update engagement visualizations
     */
    updateEngagementVisualizations(engagementData) {
        const funnelContainer = document.getElementById('conversion-funnel');
        
        if (!engagementData || !engagementData.funnel_steps) {
            funnelContainer.innerHTML = `
                <div class="text-center text-muted">
                    <i class="fas fa-chart-line fa-3x mb-2"></i>
                    <p>No conversion data available</p>
                    <small>Funnel metrics will appear after user activity</small>
                </div>
            `;
            return;
        }
        
        const funnelSteps = engagementData.funnel_steps;
        
        funnelContainer.innerHTML = funnelSteps.map((step, index) => `
            <div class="d-flex align-items-center mb-3">
                <div class="flex-grow-1">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <span class="fw-semibold">${step.name}</span>
                        <span class="text-muted">${step.count.toLocaleString()}</span>
                    </div>
                    <div class="progress" style="height: 8px;">
                        <div class="progress-bar bg-danger" 
                             style="width: ${step.percentage}%"
                             title="${step.percentage}% conversion"></div>
                    </div>
                </div>
                <div class="ms-2 text-muted" style="width: 45px;">
                    ${step.percentage.toFixed(1)}%
                </div>
            </div>
        `).join('');
    }
    
    /**
     * Get status color for metrics
     */
    getStatusColor(status) {
        switch (status) {
            case 'good': return 'success';
            case 'warning': return 'warning';
            case 'error': return 'danger';
            default: return 'secondary';
        }
    }
    
    /**
     * Export analytics data (legacy method)
     */
    async exportData(format = 'json') {
        return await this.exportReport('business_report', format);
    }
    
    /**
     * Export specific analytics report
     */
    async exportReport(reportType, format = 'json') {
        try {
            // Show loading state
            const exportBtns = document.querySelectorAll('.dropdown-item');
            exportBtns.forEach(btn => btn.style.opacity = '0.6');
            
            let endpoint;
            let filename;
            
            // Map report types to endpoints
            switch (reportType) {
                case 'business_report':
                    endpoint = `/analytics/admin/export/analytics-report?format=${format}`;
                    filename = `business_report_${new Date().toISOString().split('T')[0]}.${format}`;
                    break;
                case 'user_analytics':
                    endpoint = `/analytics/admin/export/user-analytics?format=${format}`;
                    filename = `user_analytics_${new Date().toISOString().split('T')[0]}.${format}`;
                    break;
                case 'system_metrics':
                    endpoint = `/analytics/admin/export/system-metrics?format=${format}`;
                    filename = `system_metrics_${new Date().toISOString().split('T')[0]}.${format}`;
                    break;
                case 'conversion_funnel':
                    endpoint = `/analytics/admin/export/conversion-funnel?format=${format}`;
                    filename = `conversion_funnel_${new Date().toISOString().split('T')[0]}.${format}`;
                    break;
                case 'detection_accuracy':
                    endpoint = `/analytics/admin/export/detection-accuracy?format=${format}`;
                    filename = `detection_accuracy_${new Date().toISOString().split('T')[0]}.${format}`;
                    break;
                default:
                    throw new Error(`Unknown report type: ${reportType}`);
            }
            
            // Make the API request
            const response = await this.state.request('GET', endpoint);
            
            if (response.ok) {
                // Handle the download
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                
                // Track the export event
                this.trackEngagement('success_action', 'analytics_export', {
                    report_type: reportType,
                    format: format
                });
                
                this.state.addNotification(`${reportType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} exported successfully (${format.toUpperCase()})`, 'success');
            } else {
                throw new Error(`Export failed: ${response.status} ${response.statusText}`);
            }
        } catch (error) {
            console.error('Export failed:', error);
            this.state.addNotification(`Failed to export ${reportType}: ${error.message}`, 'error');
        } finally {
            // Restore button states
            const exportBtns = document.querySelectorAll('.dropdown-item');
            exportBtns.forEach(btn => btn.style.opacity = '1');
        }
    }
    
    /**
     * Track engagement event
     */
    async trackEngagement(eventType, elementId = null, customData = {}) {
        try {
            const sessionId = this.getOrCreateSessionId();
            
            const eventData = {
                event_type: eventType,
                session_id: sessionId,
                page_path: window.location.pathname,
                element_id: elementId,
                viewport_width: window.innerWidth,
                viewport_height: window.innerHeight,
                user_agent: navigator.userAgent,
                custom_data: customData,
                timestamp: new Date().toISOString()
            };
            
            // Send to analytics API (disabled until engagement endpoints are implemented)
            // this.state.request('POST', '/analytics/engagement/track', eventData).catch(err => {
            //     console.warn('Failed to track engagement:', err);
            // });
            
        } catch (error) {
            console.warn('Engagement tracking error:', error);
        }
    }
    
    /**
     * Get or create session ID for tracking
     */
    getOrCreateSessionId() {
        let sessionId = sessionStorage.getItem('analytics_session_id');
        if (!sessionId) {
            sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem('analytics_session_id', sessionId);
        }
        return sessionId;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait a bit for StateManager to be fully initialized
    setTimeout(() => {
        if (window.stateManager) {
            console.log('Initializing AnalyticsDashboard with StateManager');
            window.analyticsDashboard = new AnalyticsDashboard(window.stateManager);
            
            // Track page view (disabled until engagement endpoints are implemented)
            // if (window.analyticsDashboard) {
            //     window.analyticsDashboard.trackEngagement('page_view');
            // }
        } else {
            console.error('StateManager not found on window object');
            // Try to create a new StateManager if it doesn't exist
            if (typeof StateManager !== 'undefined') {
                console.log('Creating new StateManager instance for analytics');
                window.stateManager = new StateManager();
                window.analyticsDashboard = new AnalyticsDashboard(window.stateManager);
            }
        }
    }, 100); // Small delay to ensure StateManager is ready
});

// Track common user interactions (disabled until engagement endpoints are implemented)
// document.addEventListener('click', (e) => {
//     if (window.analyticsDashboard && e.target.id) {
//         window.analyticsDashboard.trackEngagement('click', e.target.id);
//     }
// });

// Track modal opens (disabled until engagement endpoints are implemented)
// document.addEventListener('show.bs.modal', (e) => {
//     if (window.analyticsDashboard) {
//         window.analyticsDashboard.trackEngagement('modal_open', e.target.id);
//     }
// });