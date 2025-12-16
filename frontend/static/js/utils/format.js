/**
 * Format utility functions for TagSort
 * Pure functions for common formatting operations
 */

/**
 * Format file size in bytes to human readable format
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size string
 */
export function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format time in milliseconds to human readable duration
 * @param {number} ms - Time in milliseconds
 * @returns {string} Formatted duration string
 */
export function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Format percentage with specified decimal places
 * @param {number} value - Value to convert to percentage
 * @param {number} total - Total value for percentage calculation
 * @param {number} decimals - Number of decimal places (default: 1)
 * @returns {string} Formatted percentage string
 */
export function formatPercentage(value, total, decimals = 1) {
    if (total === 0) return '0%';
    const percentage = (value / total) * 100;
    return percentage.toFixed(decimals) + '%';
}

/**
 * Format number with thousands separators
 * @param {number} num - Number to format
 * @returns {string} Formatted number string
 */
export function formatNumber(num) {
    return new Intl.NumberFormat().format(num);
}

/**
 * Format timestamp to readable date/time string
 * @param {Date|string|number} timestamp - Timestamp to format
 * @param {boolean} includeTime - Whether to include time (default: true)
 * @returns {string} Formatted date string
 */
export function formatTimestamp(timestamp, includeTime = true) {
    const date = new Date(timestamp);
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        ...(includeTime && {
            hour: '2-digit',
            minute: '2-digit'
        })
    };
    return date.toLocaleDateString('en-US', options);
}