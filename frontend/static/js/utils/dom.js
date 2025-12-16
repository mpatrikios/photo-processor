/**
 * DOM utility functions for TagSort
 * Helper functions for common DOM operations
 */

/**
 * Safely get element by ID
 * @param {string} id - Element ID
 * @returns {Element|null} Element or null if not found
 */
export function getElementById(id) {
    return document.getElementById(id);
}

/**
 * Safely query selector
 * @param {string} selector - CSS selector
 * @param {Element} context - Context element (default: document)
 * @returns {Element|null} First matching element or null
 */
export function querySelector(selector, context = document) {
    return context.querySelector(selector);
}

/**
 * Safely query selector all
 * @param {string} selector - CSS selector
 * @param {Element} context - Context element (default: document)
 * @returns {Element[]} Array of matching elements
 */
export function querySelectorAll(selector, context = document) {
    return Array.from(context.querySelectorAll(selector));
}

/**
 * Add class to element if it exists
 * @param {string|Element} elementOrId - Element or element ID
 * @param {string} className - Class name to add
 */
export function addClass(elementOrId, className) {
    const element = typeof elementOrId === 'string' ? getElementById(elementOrId) : elementOrId;
    if (element) {
        element.classList.add(className);
    }
}

/**
 * Remove class from element if it exists
 * @param {string|Element} elementOrId - Element or element ID
 * @param {string} className - Class name to remove
 */
export function removeClass(elementOrId, className) {
    const element = typeof elementOrId === 'string' ? getElementById(elementOrId) : elementOrId;
    if (element) {
        element.classList.remove(className);
    }
}

/**
 * Toggle class on element if it exists
 * @param {string|Element} elementOrId - Element or element ID
 * @param {string} className - Class name to toggle
 * @returns {boolean} True if class was added, false if removed
 */
export function toggleClass(elementOrId, className) {
    const element = typeof elementOrId === 'string' ? getElementById(elementOrId) : elementOrId;
    if (element) {
        return element.classList.toggle(className);
    }
    return false;
}

/**
 * Check if element has class
 * @param {string|Element} elementOrId - Element or element ID
 * @param {string} className - Class name to check
 * @returns {boolean} True if element has class
 */
export function hasClass(elementOrId, className) {
    const element = typeof elementOrId === 'string' ? getElementById(elementOrId) : elementOrId;
    return element ? element.classList.contains(className) : false;
}

/**
 * Set element text content safely
 * @param {string|Element} elementOrId - Element or element ID
 * @param {string} text - Text content to set
 */
export function setText(elementOrId, text) {
    const element = typeof elementOrId === 'string' ? getElementById(elementOrId) : elementOrId;
    if (element) {
        element.textContent = text;
    }
}

/**
 * Set element innerHTML safely
 * @param {string|Element} elementOrId - Element or element ID
 * @param {string} html - HTML content to set
 */
export function setHTML(elementOrId, html) {
    const element = typeof elementOrId === 'string' ? getElementById(elementOrId) : elementOrId;
    if (element) {
        element.innerHTML = html;
    }
}

/**
 * Show element by removing 'd-none' class
 * @param {string|Element} elementOrId - Element or element ID
 */
export function showElement(elementOrId) {
    removeClass(elementOrId, 'd-none');
}

/**
 * Hide element by adding 'd-none' class
 * @param {string|Element} elementOrId - Element or element ID
 */
export function hideElement(elementOrId) {
    addClass(elementOrId, 'd-none');
}

/**
 * Create element with attributes and content
 * @param {string} tagName - HTML tag name
 * @param {object} attributes - Attributes to set on element
 * @param {string} content - Text content for element
 * @returns {Element} Created element
 */
export function createElement(tagName, attributes = {}, content = '') {
    const element = document.createElement(tagName);
    
    Object.entries(attributes).forEach(([key, value]) => {
        if (key === 'className') {
            element.className = value;
        } else if (key === 'textContent') {
            element.textContent = value;
        } else if (key === 'innerHTML') {
            element.innerHTML = value;
        } else {
            element.setAttribute(key, value);
        }
    });
    
    if (content) {
        element.textContent = content;
    }
    
    return element;
}

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML string
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Create a debounced function that delays execution
 * @param {Function} func - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, delay) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}

/**
 * Create a throttled function that limits execution frequency
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}