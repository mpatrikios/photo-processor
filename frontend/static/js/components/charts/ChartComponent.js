/**
 * ChartComponent - Base component for chart rendering
 * Provides common functionality for different chart types
 * Extracted from analytics-dashboard.js custom canvas charts
 */

import { BaseComponent } from '../BaseComponent.js';

export class ChartComponent extends BaseComponent {
    constructor(container, options = {}) {
        super(container, {
            name: 'ChartComponent',
            chartType: 'base',
            width: 400,
            height: 300,
            responsive: true,
            enableAnimations: true,
            theme: 'default',
            ...options
        });

        // Chart state
        this.canvas = null;
        this.context = null;
        this.data = null;
        this.isRendered = false;

        // Animation state
        this.animationFrame = null;
        this.animationProgress = 0;

        // Theme colors
        this.themes = {
            default: {
                primary: '#dc3545',
                secondary: '#6c757d',
                background: '#ffffff',
                text: '#333333',
                gridLines: '#e9ecef',
                success: '#28a745',
                warning: '#ffc107',
                danger: '#dc3545',
                info: '#17a2b8'
            },
            dark: {
                primary: '#ff6b6b',
                secondary: '#adb5bd',
                background: '#2d3748',
                text: '#ffffff',
                gridLines: '#4a5568',
                success: '#48bb78',
                warning: '#ed8936',
                danger: '#f56565',
                info: '#4299e1'
            }
        };

        this.currentTheme = this.themes[this.options.theme] || this.themes.default;
    }

    /**
     * Initialize chart component
     */
    async onInitialize() {
        // Create canvas element
        this.createCanvas();
        
        // Setup resize handling if responsive
        if (this.options.responsive) {
            this.setupResponsiveHandling();
        }

        // Setup event listeners
        this.setupEventListeners();

        this.log('ChartComponent initialized');
    }

    /**
     * Create canvas element
     * @private
     */
    createCanvas() {
        // Check if canvas already exists
        const existingCanvas = this.container.querySelector('canvas');
        if (existingCanvas) {
            this.canvas = existingCanvas;
        } else {
            this.canvas = document.createElement('canvas');
            this.canvas.width = this.options.width;
            this.canvas.height = this.options.height;
            this.container.appendChild(this.canvas);
        }

        // Get context
        this.context = this.canvas.getContext('2d');
        
        // Set high DPI support
        this.setupHighDPI();
    }

    /**
     * Setup high DPI support
     * @private
     */
    setupHighDPI() {
        const devicePixelRatio = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        
        // Set actual size in memory (scaled up for high DPI)
        this.canvas.width = rect.width * devicePixelRatio;
        this.canvas.height = rect.height * devicePixelRatio;
        
        // Scale down canvas to display at original size
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        
        // Scale the drawing context so everything draws at high DPI
        this.context.scale(devicePixelRatio, devicePixelRatio);
    }

    /**
     * Setup responsive handling
     * @private
     */
    setupResponsiveHandling() {
        const resizeObserver = new ResizeObserver(() => {
            this.handleResize();
        });
        
        resizeObserver.observe(this.container);
        
        // Store observer for cleanup
        this.resizeObserver = resizeObserver;
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        // Mouse events for interactivity
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseout', this.handleMouseOut.bind(this));
        this.canvas.addEventListener('click', this.handleClick.bind(this));
    }

    /**
     * Handle resize
     * @private
     */
    handleResize() {
        // Debounce resize to avoid too many redraws
        clearTimeout(this.resizeTimeout);
        this.resizeTimeout = setTimeout(() => {
            this.updateSize();
            this.render();
        }, 250);
    }

    /**
     * Update canvas size
     * @private
     */
    updateSize() {
        const rect = this.container.getBoundingClientRect();
        this.options.width = rect.width;
        this.options.height = rect.height;
        this.setupHighDPI();
    }

    /**
     * Set chart data
     */
    setData(data) {
        this.data = data;
        this.isRendered = false;
        
        if (this.options.enableAnimations) {
            this.startAnimation();
        } else {
            this.render();
        }
        
        this.emit('chart:data:updated', { data });
    }

    /**
     * Render chart
     */
    render() {
        if (!this.context || !this.data) {
            this.showNoDataMessage();
            return;
        }

        try {
            // Clear canvas
            this.clear();
            
            // Render chart based on type
            this.renderChart();
            
            this.isRendered = true;
            this.emit('chart:rendered');

        } catch (error) {
            this.error('Chart render failed:', error);
            this.showErrorMessage(error.message);
        }
    }

    /**
     * Clear canvas
     */
    clear() {
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Render chart - override in subclasses
     * @protected
     */
    renderChart() {
        // Base implementation - override in subclasses
        this.showPlaceholderMessage('Chart type not implemented');
    }

    /**
     * Start animation
     * @private
     */
    startAnimation() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        this.animationProgress = 0;
        this.animate();
    }

    /**
     * Animation loop
     * @private
     */
    animate() {
        this.animationProgress += 0.02; // 2% per frame
        
        if (this.animationProgress >= 1) {
            this.animationProgress = 1;
        }

        this.renderChart();

        if (this.animationProgress < 1) {
            this.animationFrame = requestAnimationFrame(() => this.animate());
        } else {
            this.animationFrame = null;
            this.emit('chart:animation:completed');
        }
    }

    /**
     * Apply easing to animation progress
     * @protected
     */
    easeInOut(progress) {
        return progress < 0.5 
            ? 2 * progress * progress 
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    }

    /**
     * Show no data message
     */
    showNoDataMessage(message = 'No data available') {
        this.clear();
        this.context.fillStyle = this.currentTheme.text;
        this.context.font = '16px Arial';
        this.context.textAlign = 'center';
        this.context.fillText(message, this.canvas.width / 2, this.canvas.height / 2);
        
        this.context.font = '12px Arial';
        this.context.fillText('Data will appear when available', this.canvas.width / 2, this.canvas.height / 2 + 25);
    }

    /**
     * Show error message
     */
    showErrorMessage(message = 'Chart error') {
        this.clear();
        this.context.fillStyle = this.currentTheme.danger;
        this.context.font = '16px Arial';
        this.context.textAlign = 'center';
        this.context.fillText('⚠ ' + message, this.canvas.width / 2, this.canvas.height / 2);
    }

    /**
     * Show placeholder message
     */
    showPlaceholderMessage(message = 'Chart placeholder') {
        this.clear();
        this.context.fillStyle = this.currentTheme.secondary;
        this.context.font = '14px Arial';
        this.context.textAlign = 'center';
        this.context.fillText(message, this.canvas.width / 2, this.canvas.height / 2);
    }

    /**
     * Draw grid lines
     * @protected
     */
    drawGrid(xSteps = 10, ySteps = 10) {
        const stepX = this.canvas.width / xSteps;
        const stepY = this.canvas.height / ySteps;

        this.context.strokeStyle = this.currentTheme.gridLines;
        this.context.lineWidth = 0.5;

        // Vertical lines
        for (let i = 0; i <= xSteps; i++) {
            const x = i * stepX;
            this.context.beginPath();
            this.context.moveTo(x, 0);
            this.context.lineTo(x, this.canvas.height);
            this.context.stroke();
        }

        // Horizontal lines
        for (let i = 0; i <= ySteps; i++) {
            const y = i * stepY;
            this.context.beginPath();
            this.context.moveTo(0, y);
            this.context.lineTo(this.canvas.width, y);
            this.context.stroke();
        }
    }

    /**
     * Draw labels
     * @protected
     */
    drawLabels(title, xLabel = '', yLabel = '') {
        this.context.fillStyle = this.currentTheme.text;
        
        // Title
        if (title) {
            this.context.font = 'bold 16px Arial';
            this.context.textAlign = 'center';
            this.context.fillText(title, this.canvas.width / 2, 20);
        }

        // X-axis label
        if (xLabel) {
            this.context.font = '12px Arial';
            this.context.textAlign = 'center';
            this.context.fillText(xLabel, this.canvas.width / 2, this.canvas.height - 10);
        }

        // Y-axis label
        if (yLabel) {
            this.context.save();
            this.context.font = '12px Arial';
            this.context.textAlign = 'center';
            this.context.translate(15, this.canvas.height / 2);
            this.context.rotate(-Math.PI / 2);
            this.context.fillText(yLabel, 0, 0);
            this.context.restore();
        }
    }

    /**
     * Format number for display
     * @protected
     */
    formatNumber(value, decimals = 0) {
        if (typeof value !== 'number') return '0';
        
        if (value >= 1000000) {
            return (value / 1000000).toFixed(1) + 'M';
        } else if (value >= 1000) {
            return (value / 1000).toFixed(1) + 'K';
        }
        
        return value.toFixed(decimals);
    }

    /**
     * Get color by index
     * @protected
     */
    getColor(index) {
        const colors = [
            this.currentTheme.primary,
            this.currentTheme.info,
            this.currentTheme.success,
            this.currentTheme.warning,
            this.currentTheme.danger,
            this.currentTheme.secondary
        ];
        
        return colors[index % colors.length];
    }

    /**
     * Set theme
     */
    setTheme(themeName) {
        if (this.themes[themeName]) {
            this.currentTheme = this.themes[themeName];
            this.options.theme = themeName;
            this.render();
            this.emit('chart:theme:changed', { theme: themeName });
        }
    }

    /**
     * Get chart data as image
     */
    toDataURL(type = 'image/png') {
        return this.canvas.toDataURL(type);
    }

    /**
     * Download chart as image
     */
    downloadImage(filename = 'chart.png') {
        const link = document.createElement('a');
        link.download = filename;
        link.href = this.toDataURL();
        link.click();
    }

    // Event Handlers

    /**
     * Handle mouse move for interactivity
     * @private
     */
    handleMouseMove(event) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        this.emit('chart:mouse:move', { x, y, event });
    }

    /**
     * Handle mouse out
     * @private
     */
    handleMouseOut(event) {
        this.emit('chart:mouse:out', { event });
    }

    /**
     * Handle click
     * @private
     */
    handleClick(event) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        this.emit('chart:clicked', { x, y, event });
    }

    /**
     * Destroy chart component
     */
    async destroy() {
        // Cancel any ongoing animation
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        // Clear resize timeout
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }

        // Disconnect resize observer
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }

        // Clear canvas
        if (this.context) {
            this.clear();
        }

        await super.destroy();
    }
}