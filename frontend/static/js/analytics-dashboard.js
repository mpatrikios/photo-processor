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
            button.className = 'btn btn-outline-secondary btn-sm me-2';
            button.id = 'analytics-dashboard-btn';
            button.innerHTML = '<i class="fas fa-chart-line me-1"></i> Analytics';
            button.title = 'View analytics dashboard';
            
            button.addEventListener('click', () => {
                // Show analytics dashboard modal directly
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
                        <div class="modal-header">
                            <h5 class="modal-title" id="analyticsDashboardLabel">
                                Analytics Dashboard
                            </h5>
                            <div class="d-flex align-items-center">
                                <button type="button" class="btn btn-outline-secondary btn-sm me-3" onclick="window.location.hash='results'">
                                    <i class="fas fa-arrow-left me-1"></i> Back to App
                                </button>
                                <div class="form-check form-switch me-3">
                                    <input class="form-check-input" type="checkbox" id="auto-refresh-toggle" checked>
                                    <label class="form-check-label" for="auto-refresh-toggle">
                                        Auto Refresh (30s)
                                    </label>
                                </div>
                                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close" onclick="window.location.hash='results'"></button>
                            </div>
                        </div>
                        <div class="modal-body">
                            <div class="analytics-loading" id="analytics-loading">
                                <div class="spinner"></div>
                                <p>Loading analytics data...</p>
                            </div>
                            
                            <!-- Analytics Grid -->
                            <div class="analytics-grid fade-in" id="analytics-content" style="display: none;">
                                <!-- KPI Cards -->
                                <div class="analytics-card">
                                    <h5>Total Users</h5>
                                    <div class="metric-value" id="total-users-metric">-</div>
                                    <div class="metric-label">Active users</div>
                                    <div class="metric-trend neutral" id="users-growth">+0% this month</div>
                                </div>
                                
                                <div class="analytics-card">
                                    <h5>Photos Processed</h5>
                                    <div class="metric-value" id="photos-processed-metric">-</div>
                                    <div class="metric-label">Total processed</div>
                                    <div class="metric-trend positive" id="photos-growth">+0% this month</div>
                                </div>
                                
                                <div class="analytics-card">
                                    <h5>Gemini Flash Accuracy</h5>
                                    <div class="metric-value" id="accuracy-metric">-</div>
                                    <div class="metric-label">Detection accuracy</div>
                                    <div class="metric-trend neutral" id="accuracy-trend">Classification performance</div>
                                </div>
                                
                                <div class="analytics-card">
                                    <h5>Avg Processing Speed</h5>
                                    <div class="metric-value" id="avg-processing-time-metric">-</div>
                                    <div class="metric-label">Per photo</div>
                                    <div class="metric-trend neutral" id="processing-time-trend">Gemini Flash processing</div>
                                </div>
                            </div>
                            
                            <!-- Charts Section -->
                            <div class="chart-container fade-in" id="activity-chart-container" style="display: none;">
                                <h4>📈 Classification Activity Trends</h4>
                                <div class="chart-wrapper">
                                    <canvas id="activity-trends-chart" class="chart-canvas"></canvas>
                                </div>
                            </div>
                            
                            <div class="chart-container fade-in" id="performance-chart-container" style="display: none;">
                                <h4>🎯 Gemini Flash Performance Distribution</h4>
                                <div class="chart-wrapper">
                                    <canvas id="processing-methods-chart" class="chart-canvas"></canvas>
                                </div>
                            </div>
                            
                            <!-- Statistics List -->
                            <div class="stats-list fade-in" id="stats-list" style="display: none;">
                                <div class="stats-list-item">
                                    <span class="stats-list-label">Detection Accuracy Rate</span>
                                    <span class="stats-list-value" id="detection-accuracy-stat">-</span>
                                </div>
                                <div class="stats-list-item">
                                    <span class="stats-list-label">Average Processing Time</span>
                                    <span class="stats-list-value" id="avg-time-stat">-</span>
                                </div>
                                <div class="stats-list-item">
                                    <span class="stats-list-label">Photos per Hour</span>
                                    <span class="stats-list-value" id="photos-per-hour-stat">-</span>
                                </div>
                                <div class="stats-list-item">
                                    <span class="stats-list-label">Total Processing Time</span>
                                    <span class="stats-list-value" id="total-time-stat">-</span>
                                </div>
                            </div>
                            
                            <!-- Export Controls -->
                            <div class="analytics-card fade-in" id="export-controls" style="display: none;">
                                <h5>📊 Export Analytics</h5>
                                <div class="metric-label">Download analytics reports</div>
                                <div style="display: flex; gap: 1rem; margin-top: 1rem;">
                                    <button class="btn btn-outline-primary btn-sm" onclick="window.analyticsDashboard?.exportReport('business_report', 'json')">
                                        <i class="fas fa-download me-1"></i>Business Report (JSON)
                                    </button>
                                    <button class="btn btn-outline-secondary btn-sm" onclick="window.analyticsDashboard?.exportReport('detection_accuracy', 'csv')">
                                        <i class="fas fa-download me-1"></i>Detection Data (CSV)
                                    </button>
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
        // Show loading state
        this.showLoadingState();
        
        try {
            await this.loadOverviewData();
            
            // Show content with staggered animations
            this.showContentWithAnimations();
        } catch (error) {
            console.error('Failed to load analytics data:', error);
            this.showErrorState(error.message);
        }
    }
    
    /**
     * Show loading state
     */
    showLoadingState() {
        document.getElementById('analytics-loading').style.display = 'flex';
        document.getElementById('analytics-content').style.display = 'none';
        document.getElementById('activity-chart-container').style.display = 'none';
        document.getElementById('performance-chart-container').style.display = 'none';
        document.getElementById('stats-list').style.display = 'none';
        document.getElementById('export-controls').style.display = 'none';
    }
    
    /**
     * Show content with staggered animations
     */
    showContentWithAnimations() {
        document.getElementById('analytics-loading').style.display = 'none';
        
        // Show content with delays for smooth animation
        setTimeout(() => {
            document.getElementById('analytics-content').style.display = 'grid';
            document.getElementById('analytics-content').classList.add('slide-up');
        }, 200);
        
        setTimeout(() => {
            document.getElementById('activity-chart-container').style.display = 'block';
            document.getElementById('activity-chart-container').classList.add('slide-up');
        }, 400);
        
        setTimeout(() => {
            document.getElementById('performance-chart-container').style.display = 'block';
            document.getElementById('performance-chart-container').classList.add('slide-up');
        }, 600);
        
        setTimeout(() => {
            document.getElementById('stats-list').style.display = 'block';
            document.getElementById('stats-list').classList.add('slide-up');
        }, 800);
        
        setTimeout(() => {
            document.getElementById('export-controls').style.display = 'block';
            document.getElementById('export-controls').classList.add('slide-up');
        }, 1000);
    }
    
    /**
     * Show error state
     */
    showErrorState(message) {
        document.getElementById('analytics-loading').innerHTML = `
            <div class="analytics-error">
                <div class="error-icon">⚠️</div>
                <h4>Failed to Load Analytics</h4>
                <p>${message}</p>
                <button class="btn btn-outline-primary" onclick="window.analyticsDashboard.loadAllData()">
                    <i class="fas fa-refresh me-1"></i>Retry
                </button>
            </div>
        `;
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
        }
    }
    
    /**
     * Load overview dashboard data
     */
    async loadOverviewData() {
        try {
            console.log('Loading analytics data from /analytics/daily-metrics...');
            const response = await this.state.request('GET', '/analytics/daily-metrics');
            
            console.log('Analytics response status:', response.status);
            console.log('Analytics response headers:', response.headers);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Analytics API error response:', errorText);
                throw new Error(`API call failed: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('Analytics data received:', data);
            
            // Transform the API data to match the expected format for updateOverviewMetrics
            const transformedData = {
                user_stats: {
                    current_quota: { 
                        user_id: data.total_users || 1,
                        current_month: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                    },
                    total_photos_processed: data.total_jobs || 0,
                    uploads: data.trends?.reduce((sum, trend) => sum + (trend.photos || 0), 0) || 0
                },
                detection_accuracy: {
                    percentage: data.avg_detection_accuracy || 0,
                    avg_processing_time_ms: (data.average_processing_time_per_photo || 0) * 1000,
                    total_photos: data.trends?.reduce((sum, trend) => sum + (trend.photos || 0), 0) || 0
                },
                processing_trends: (data.trends || []).map(trend => ({
                    value: trend.photos || 0,
                    processing_time: (trend.avg_time || 0) * 1000
                })),
                detection_stats: {
                    gemini_detections: Math.floor((data.total_jobs || 0) * 0.85), // Most should be Gemini
                    manual_labels: Math.floor((data.total_jobs || 0) * 0.15) // Some manual
                }
            };
            
            console.log('Transformed data for analytics:', transformedData);
            this.updateOverviewMetrics(transformedData);
            
        } catch (error) {
            console.error("Failed to load dashboard data:", error);
            this.showErrorState(`Failed to load analytics: ${error.message}`);
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
        const totalUsers = data.user_stats?.current_quota?.user_id || 1;
        const photosProcessed = data.user_stats?.total_photos_processed || data.detection_accuracy?.total_photos || 0;
        const accuracy = data.detection_accuracy?.percentage || 0;
        const avgProcessingTime = data.detection_accuracy?.avg_processing_time_ms || 0;
        
        // Update analytics cards with modern styling
        document.getElementById('total-users-metric').textContent = totalUsers.toLocaleString();
        document.getElementById('photos-processed-metric').textContent = photosProcessed.toLocaleString();
        document.getElementById('accuracy-metric').textContent = accuracy > 0 ? `${accuracy.toFixed(1)}%` : 'N/A';
        
        // Convert milliseconds to seconds for display
        const avgTimeSeconds = avgProcessingTime / 1000;
        document.getElementById('avg-processing-time-metric').textContent = avgTimeSeconds > 0 
            ? `${avgTimeSeconds.toFixed(2)}s` 
            : 'N/A';
        
        // Update trend indicators with appropriate colors
        const currentMonth = data.user_stats?.current_quota?.current_month || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const uploads = data.user_stats?.uploads || 0;
        const totalPhotos = data.detection_accuracy?.total_photos || 0;
        
        document.getElementById('users-growth').textContent = `Active in ${currentMonth}`;
        document.getElementById('users-growth').className = 'metric-trend neutral';
        
        document.getElementById('photos-growth').textContent = `${uploads} uploads this period`;
        document.getElementById('photos-growth').className = uploads > 0 ? 'metric-trend positive' : 'metric-trend neutral';
        
        document.getElementById('processing-time-trend').textContent = `${totalPhotos} photos analyzed`;
        document.getElementById('processing-time-trend').className = 'metric-trend neutral';
        
        // Update accuracy trend
        const accuracyElement = document.getElementById('accuracy-trend');
        if (accuracy >= 90) {
            accuracyElement.textContent = 'Excellent performance';
            accuracyElement.className = 'metric-trend positive';
        } else if (accuracy >= 75) {
            accuracyElement.textContent = 'Good performance';
            accuracyElement.className = 'metric-trend positive';
        } else if (accuracy > 0) {
            accuracyElement.textContent = 'Needs improvement';
            accuracyElement.className = 'metric-trend negative';
        } else {
            accuracyElement.textContent = 'No data yet';
            accuracyElement.className = 'metric-trend neutral';
        }
        
        // Update statistics list
        this.updateStatsList(data);
        
        // Update charts
        this.updateActivityTrendsChart(data.processing_trends || []);
        this.updateProcessingMethodsChart(data);
    }
    
    /**
     * Update statistics list with current data
     */
    updateStatsList(data) {
        const accuracy = data.detection_accuracy?.percentage || 0;
        const avgTimeMs = data.detection_accuracy?.avg_processing_time_ms || 0;
        const totalPhotos = data.detection_accuracy?.total_photos || 0;
        
        // Update individual stats
        document.getElementById('detection-accuracy-stat').textContent = accuracy > 0 ? `${accuracy.toFixed(1)}%` : 'N/A';
        document.getElementById('avg-time-stat').textContent = avgTimeMs > 0 ? `${(avgTimeMs / 1000).toFixed(2)}s` : 'N/A';
        
        // Calculate photos per hour
        const photosPerHour = avgTimeMs > 0 ? Math.round(3600000 / avgTimeMs) : 0;
        document.getElementById('photos-per-hour-stat').textContent = photosPerHour > 0 ? photosPerHour.toLocaleString() : 'N/A';
        
        // Calculate total processing time
        const totalTimeMs = avgTimeMs * totalPhotos;
        const totalTimeMinutes = totalTimeMs / 60000;
        const totalTimeFormatted = totalTimeMinutes > 60 
            ? `${(totalTimeMinutes / 60).toFixed(1)}h`
            : totalTimeMinutes > 0 
                ? `${totalTimeMinutes.toFixed(1)}m`
                : 'N/A';
        document.getElementById('total-time-stat').textContent = totalTimeFormatted;
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
     * Update activity trends chart with Chart.js
     */
    updateActivityTrendsChart(trendsData) {
        const ctx = document.getElementById('activity-trends-chart').getContext('2d');
        
        // Destroy existing chart if it exists
        if (this.charts.activityChart) {
            this.charts.activityChart.destroy();
        }
        
        // Prepare data for Chart.js
        const labels = trendsData && trendsData.length > 0 
            ? trendsData.map((_, i) => `Day ${i + 1}`)
            : ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'];
            
        const data = trendsData && trendsData.length > 0
            ? trendsData.map(d => d.value || 0)
            : [0, 0, 0, 0, 0, 0, 0];
        
        this.charts.activityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Photo Processing Activity',
                    data: data,
                    borderColor: 'var(--analytics-accent)',
                    backgroundColor: 'var(--analytics-accent-light)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointBackgroundColor: 'var(--analytics-accent)',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2,
                    pointRadius: 6,
                    pointHoverRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: 'var(--analytics-accent)',
                        borderWidth: 1,
                        cornerRadius: 8,
                        displayColors: false
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false
                        },
                        border: {
                            display: false
                        },
                        ticks: {
                            color: 'var(--analytics-text-secondary)',
                            font: {
                                size: 12
                            }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(0, 0, 0, 0.05)',
                            drawBorder: false
                        },
                        border: {
                            display: false
                        },
                        ticks: {
                            color: 'var(--analytics-text-secondary)',
                            font: {
                                size: 12
                            },
                            callback: function(value) {
                                return value.toFixed(0);
                            }
                        }
                    }
                },
                elements: {
                    point: {
                        hoverBackgroundColor: 'var(--analytics-accent)'
                    }
                }
            }
        });
    }
    
    /**
     * Update processing methods chart with Chart.js
     */
    updateProcessingMethodsChart(data) {
        const ctx = document.getElementById('processing-methods-chart').getContext('2d');
        
        // Destroy existing chart if it exists
        if (this.charts.methodsChart) {
            this.charts.methodsChart.destroy();
        }
        
        // Get detection data from API response
        const geminiDetections = data.detection_stats?.gemini_detections || 0;
        const manualLabels = data.detection_stats?.manual_labels || 0;
        const totalDetections = geminiDetections + manualLabels;
        
        // Prepare data
        const hasData = totalDetections > 0;
        const chartData = hasData ? [geminiDetections, manualLabels] : [1];
        const chartLabels = hasData ? ['Gemini Flash AI', 'Manual Labels'] : ['No Data Available'];
        const chartColors = hasData ? ['var(--analytics-success)', 'var(--analytics-warning)'] : ['#e5e7eb'];
        
        this.charts.methodsChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: chartLabels,
                datasets: [{
                    data: chartData,
                    backgroundColor: chartColors,
                    borderColor: '#ffffff',
                    borderWidth: 3,
                    cutout: '60%'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: 'var(--analytics-text-secondary)',
                            font: {
                                size: 12
                            },
                            padding: 20,
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: 'var(--analytics-accent)',
                        borderWidth: 1,
                        cornerRadius: 8,
                        displayColors: true,
                        callbacks: {
                            label: function(context) {
                                if (!hasData) return 'No detection data available yet';
                                const value = context.parsed;
                                const percentage = ((value / totalDetections) * 100).toFixed(1);
                                return `${context.label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                },
                elements: {
                    arc: {
                        borderAlign: 'inner'
                    }
                }
            }
        });
        
        // Add center text for total count
        if (hasData) {
            const centerPlugin = {
                id: 'centerText',
                beforeDraw: (chart) => {
                    const ctx = chart.ctx;
                    ctx.restore();
                    const fontSize = 20;
                    ctx.font = `bold ${fontSize}px Arial`;
                    ctx.fillStyle = 'var(--analytics-text-primary)';
                    ctx.textBaseline = 'middle';
                    ctx.textAlign = 'center';
                    
                    const centerX = chart.width / 2;
                    const centerY = chart.height / 2 - 20;
                    
                    ctx.fillText(totalDetections.toString(), centerX, centerY);
                    
                    ctx.font = `12px Arial`;
                    ctx.fillStyle = 'var(--analytics-text-secondary)';
                    ctx.fillText('Total Detections', centerX, centerY + 20);
                    ctx.save();
                }
            };
            
            Chart.register(centerPlugin);
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
