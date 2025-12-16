/**
 * MetricCardComponent - Individual metric display card
 * Reusable component for displaying analytics metrics with trend indicators
 * Used by AnalyticsDashboardComponent for consistent metric visualization
 */

import { BaseComponent } from './BaseComponent.js';

export class MetricCardComponent extends BaseComponent {
    constructor(container, options = {}) {
        super(container, {
            name: 'MetricCardComponent',
            title: 'Metric',
            value: 0,
            unit: '',
            icon: 'fas fa-chart-line',
            color: 'primary',
            trend: null, // { direction: 'up|down|stable', percentage: 0, label: '' }
            showTrend: true,
            animateValue: true,
            clickable: false,
            ...options
        });

        // Component state
        this.currentValue = 0;
        this.animationFrame = null;
    }

    /**
     * Initialize metric card
     */
    async onInitialize() {
        this.createCard();
        this.setupEventListeners();
        this.log('MetricCardComponent initialized');
    }

    /**
     * Create metric card structure
     * @private
     */
    createCard() {
        const { title, icon, color, clickable } = this.options;
        
        // BaseComponent uses 'element' not 'container'
        if (!this.element) {
            this.error('Cannot create card - element not found');
            return;
        }
        
        this.element.className = `metric-card ${clickable ? 'clickable' : ''}`;
        this.element.innerHTML = `
            <div class="card border-0 shadow-sm h-100">
                <div class="card-body text-center">
                    <div class="d-flex align-items-center justify-content-between">
                        <div class="metric-content">
                            <h6 class="card-subtitle text-muted mb-1">${title}</h6>
                            <h3 class="card-title mb-0" id="${this.id}-value">-</h3>
                        </div>
                        <i class="${icon} fa-2x text-${color} opacity-75" id="${this.id}-icon"></i>
                    </div>
                    ${this.options.showTrend ? `
                        <div class="metric-trend mt-2" id="${this.id}-trend">
                            <small class="text-muted">No trend data</small>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        // Add clickable styles if needed
        if (clickable) {
            this.element.style.cursor = 'pointer';
        }
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        if (this.options.clickable) {
            this.element.addEventListener('click', () => {
                this.emit('metric:clicked', {
                    title: this.options.title,
                    value: this.currentValue,
                    options: this.options
                });
            });
        }

        // Hover effects for clickable cards
        if (this.options.clickable) {
            this.element.addEventListener('mouseenter', () => {
                const card = this.element.querySelector('.card');
                if (card) {
                    card.style.transform = 'translateY(-2px)';
                    card.style.transition = 'transform 0.2s ease';
                }
            });

            this.element.addEventListener('mouseleave', () => {
                const card = this.element.querySelector('.card');
                if (card) {
                    card.style.transform = 'translateY(0)';
                }
            });
        }
    }

    /**
     * Update metric value
     */
    updateValue(newValue, options = {}) {
        const { animate = this.options.animateValue, unit = this.options.unit } = options;
        
        if (animate && typeof newValue === 'number' && newValue !== this.currentValue) {
            this.animateValue(this.currentValue, newValue, unit);
        } else {
            this.setValueDisplay(newValue, unit);
        }

        this.currentValue = newValue;
        this.emit('metric:updated', { value: newValue, unit });
    }

    /**
     * Update trend information
     */
    updateTrend(trendData) {
        if (!this.options.showTrend) return;

        const trendElement = document.getElementById(`${this.id}-trend`);
        if (!trendElement) return;

        if (!trendData) {
            trendElement.innerHTML = '<small class="text-muted">No trend data</small>';
            return;
        }

        const { direction, percentage, label } = trendData;
        
        let iconClass = 'fa-minus';
        let colorClass = 'text-muted';
        
        if (direction === 'up') {
            iconClass = 'fa-arrow-up';
            colorClass = 'text-success';
        } else if (direction === 'down') {
            iconClass = 'fa-arrow-down';
            colorClass = 'text-danger';
        }

        const percentageText = percentage ? `${percentage > 0 ? '+' : ''}${percentage.toFixed(1)}%` : '';
        const displayLabel = label || 'vs previous period';

        trendElement.innerHTML = `
            <small class="${colorClass}">
                <i class="fas ${iconClass} me-1"></i>
                ${percentageText} ${displayLabel}
            </small>
        `;

        this.emit('trend:updated', trendData);
    }

    /**
     * Update icon
     */
    updateIcon(iconClass, color = null) {
        const iconElement = document.getElementById(`${this.id}-icon`);
        if (!iconElement) return;

        iconElement.className = `${iconClass} fa-2x opacity-75`;
        
        if (color) {
            iconElement.className += ` text-${color}`;
            this.options.color = color;
        } else {
            iconElement.className += ` text-${this.options.color}`;
        }

        this.emit('icon:updated', { icon: iconClass, color });
    }

    /**
     * Update card color theme
     */
    updateColor(color) {
        const iconElement = document.getElementById(`${this.id}-icon`);
        if (iconElement) {
            iconElement.className = iconElement.className.replace(/text-\w+/, `text-${color}`);
        }

        this.options.color = color;
        this.emit('color:updated', { color });
    }

    /**
     * Set loading state
     */
    setLoading(isLoading = true) {
        const valueElement = document.getElementById(`${this.id}-value`);
        const iconElement = document.getElementById(`${this.id}-icon`);
        
        if (isLoading) {
            if (valueElement) valueElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            if (iconElement) iconElement.classList.add('opacity-50');
        } else {
            if (valueElement) valueElement.textContent = this.formatValue(this.currentValue);
            if (iconElement) iconElement.classList.remove('opacity-50');
        }

        this.emit('loading:changed', { loading: isLoading });
    }

    /**
     * Set error state
     */
    setError(errorMessage = 'Error') {
        const valueElement = document.getElementById(`${this.id}-value`);
        const trendElement = document.getElementById(`${this.id}-trend`);
        
        if (valueElement) {
            valueElement.innerHTML = `<span class="text-danger">${errorMessage}</span>`;
        }
        
        if (trendElement && this.options.showTrend) {
            trendElement.innerHTML = `<small class="text-danger">Unable to load data</small>`;
        }

        this.emit('error:set', { message: errorMessage });
    }

    /**
     * Animate value change
     * @private
     */
    animateValue(fromValue, toValue, unit = '') {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        const startTime = performance.now();
        const duration = 1000; // 1 second animation
        const diff = toValue - fromValue;

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function (ease-out)
            const easedProgress = 1 - Math.pow(1 - progress, 3);
            const currentValue = fromValue + (diff * easedProgress);
            
            this.setValueDisplay(currentValue, unit);
            
            if (progress < 1) {
                this.animationFrame = requestAnimationFrame(animate);
            } else {
                this.animationFrame = null;
                this.setValueDisplay(toValue, unit); // Ensure final value is exact
            }
        };

        this.animationFrame = requestAnimationFrame(animate);
    }

    /**
     * Set value display
     * @private
     */
    setValueDisplay(value, unit = '') {
        const valueElement = document.getElementById(`${this.id}-value`);
        if (!valueElement) return;

        const formattedValue = this.formatValue(value);
        valueElement.textContent = `${formattedValue}${unit}`;
    }

    /**
     * Format value for display
     * @private
     */
    formatValue(value) {
        if (value === null || value === undefined) return '-';
        if (typeof value === 'string') return value;
        if (typeof value !== 'number') return String(value);

        // Format large numbers
        if (Math.abs(value) >= 1000000) {
            return (value / 1000000).toFixed(1) + 'M';
        } else if (Math.abs(value) >= 1000) {
            return (value / 1000).toFixed(1) + 'K';
        }

        // Handle decimals
        if (value % 1 !== 0) {
            return value.toFixed(2);
        }

        return value.toLocaleString();
    }

    /**
     * Update all card properties at once
     */
    update(data) {
        const { value, trend, icon, color, unit, title } = data;

        // Update title if provided
        if (title && title !== this.options.title) {
            const titleElement = this.element.querySelector('.card-subtitle');
            if (titleElement) {
                titleElement.textContent = title;
                this.options.title = title;
            }
        }

        // Update value
        if (value !== undefined) {
            this.updateValue(value, { unit });
        }

        // Update trend
        if (trend) {
            this.updateTrend(trend);
        }

        // Update icon
        if (icon) {
            this.updateIcon(icon, color);
        } else if (color) {
            this.updateColor(color);
        }

        this.emit('card:updated', data);
    }

    /**
     * Get current metric data
     */
    getData() {
        return {
            title: this.options.title,
            value: this.currentValue,
            unit: this.options.unit,
            icon: this.options.icon,
            color: this.options.color,
            trend: this.getCurrentTrend()
        };
    }

    /**
     * Get current trend data
     * @private
     */
    getCurrentTrend() {
        const trendElement = document.getElementById(`${this.id}-trend`);
        if (!trendElement || !this.options.showTrend) return null;

        const trendText = trendElement.textContent;
        if (!trendText || trendText.includes('No trend data')) return null;

        // Parse trend from display text (basic parsing)
        const hasUp = trendText.includes('arrow-up');
        const hasDown = trendText.includes('arrow-down');
        const direction = hasUp ? 'up' : hasDown ? 'down' : 'stable';

        return { direction };
    }

    /**
     * Set clickable state
     */
    setClickable(clickable = true) {
        this.options.clickable = clickable;
        
        if (clickable) {
            this.element.classList.add('clickable');
            this.element.style.cursor = 'pointer';
        } else {
            this.element.classList.remove('clickable');
            this.element.style.cursor = 'default';
        }

        this.emit('clickable:changed', { clickable });
    }

    /**
     * Cleanup metric card
     */
    async destroy() {
        // Cancel any ongoing animation
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        await super.destroy();
    }
}

/**
 * Predefined metric card configurations
 */
export const MetricConfigs = {
    USER_COUNT: {
        title: 'Total Users',
        icon: 'fas fa-users',
        color: 'primary',
        unit: '',
        clickable: true
    },
    
    PHOTOS_PROCESSED: {
        title: 'Photos Processed',
        icon: 'fas fa-images',
        color: 'success',
        unit: '',
        clickable: true
    },
    
    ACCURACY: {
        title: 'Detection Accuracy',
        icon: 'fas fa-bullseye',
        color: 'warning',
        unit: '%',
        clickable: true
    },
    
    PROCESSING_TIME: {
        title: 'Avg Processing Time',
        icon: 'fas fa-clock',
        color: 'info',
        unit: 's',
        clickable: true
    },
    
    SUCCESS_RATE: {
        title: 'Success Rate',
        icon: 'fas fa-check-circle',
        color: 'success',
        unit: '%',
        clickable: false
    },
    
    ERROR_RATE: {
        title: 'Error Rate',
        icon: 'fas fa-exclamation-triangle',
        color: 'danger',
        unit: '%',
        clickable: true
    },
    
    ACTIVE_SESSIONS: {
        title: 'Active Sessions',
        icon: 'fas fa-broadcast-tower',
        color: 'info',
        unit: '',
        clickable: false
    },
    
    STORAGE_USED: {
        title: 'Storage Used',
        icon: 'fas fa-hdd',
        color: 'secondary',
        unit: 'GB',
        clickable: true
    }
};