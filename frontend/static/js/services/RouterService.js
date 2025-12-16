/**
 * RouterService - Navigation and routing service
 * Extracted from script.js AppRouter class and integrated with component architecture
 * Provides clean navigation management with event-driven communication
 */

import { BaseService } from './BaseService.js';

export class RouterService extends BaseService {
    constructor(eventBus, options = {}) {
        super(eventBus, {
            name: 'RouterService',
            enableRouteGuards: true,
            enableStateRestoration: true,
            enableLoopDetection: true,
            maxRouteLoops: 3,
            ...options
        });

        // Make config accessible as options for backward compatibility
        this.options = this.config;

        // Route configuration
        this.routes = new Map([
            ['', 'home'],
            ['home', 'home'], 
            ['analytics', 'analytics'],
            ['app', 'app'],
            ['upload', 'upload'],
            ['results', 'results'],
            ['processing', 'processing']
        ]);

        // Route handlers
        this.routeHandlers = new Map();
        this.setupDefaultHandlers();

        // Protected routes that require authentication
        this.protectedRoutes = new Set(['analytics', 'app', 'upload', 'results', 'processing']);

        // Route loop detection
        this.lastRoute = null;
        this.routeCount = 0;
        this.lastAuthRequiredRoute = null;
        this.lastAuthRequiredTime = null;

        // Current state
        this.currentRoute = '';
        this.isNavigating = false;

        // Dependencies
        this.authService = null;
        this.stateManagerService = null;
    }

    /**
     * Initialize the router service
     */
    async onInitialize() {
        // Get service dependencies
        this.authService = this.serviceContainer?.get('authService');
        this.stateManagerService = this.serviceContainer?.get('stateManagerService');

        // Setup event listeners
        this.setupEventListeners();

        // Handle initial route
        this.handleInitialRoute();

        this.log('RouterService initialized');
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        // Browser navigation events
        window.addEventListener('hashchange', () => this.handleRouteChange());
        window.addEventListener('popstate', () => this.handleRouteChange());

        // Application events
        this.on('auth:signin:success', this.handleAuthChange.bind(this));
        this.on('auth:signout:success', this.handleAuthChange.bind(this));
        this.on('navigation:request', this.handleNavigationRequest.bind(this));
        
        // Component ready events
        this.on('component:ready', this.handleComponentReady.bind(this));
    }

    /**
     * Setup default route handlers
     * @private
     */
    setupDefaultHandlers() {
        this.routeHandlers.set('home', this.handleHomeRoute.bind(this));
        this.routeHandlers.set('analytics', this.handleAnalyticsRoute.bind(this));
        this.routeHandlers.set('app', this.handleAppRoute.bind(this));
        this.routeHandlers.set('upload', this.handleUploadRoute.bind(this));
        this.routeHandlers.set('results', this.handleResultsRoute.bind(this));
        this.routeHandlers.set('processing', this.handleProcessingRoute.bind(this));
    }

    /**
     * Handle initial route on page load
     * @private
     */
    handleInitialRoute() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.handleRouteChange());
        } else {
            // DOM is already ready
            setTimeout(() => this.handleRouteChange(), 0);
        }
    }

    /**
     * Navigate to a specific route
     */
    navigateTo(route, options = {}) {
        const { replace = false, force = false } = options;

        if (!force && this.isNavigating) {
            this.log('Navigation in progress, queuing request', { route });
            setTimeout(() => this.navigateTo(route, options), 100);
            return;
        }

        try {
            this.isNavigating = true;

            // Normalize route
            const normalizedRoute = this.normalizeRoute(route);

            // Check if this is the same route
            if (!force && normalizedRoute === this.currentRoute) {
                this.isNavigating = false;
                return;
            }

            // Update URL
            if (replace) {
                this.safeReplaceState(normalizedRoute);
            } else {
                this.safeUpdateHash(normalizedRoute);
            }

            // Handle the route change
            this.handleRouteChange();

        } finally {
            this.isNavigating = false;
        }
    }

    /**
     * Handle route changes
     * @private
     */
    handleRouteChange() {
        const hash = window.location.hash.slice(1); // Remove #
        const route = this.normalizeRoute(hash);

        this.log('Handling route change', { from: this.currentRoute, to: route });

        // Loop detection
        if (this.options.enableLoopDetection && !this.checkRouteLoop(route)) {
            return; // Loop detected and handled
        }

        // Authentication check
        if (this.options.enableRouteGuards && !this.checkAuthentication(route)) {
            return; // Authentication failed, redirected
        }

        // Execute route handler
        this.executeRoute(route);
    }

    /**
     * Normalize route name
     * @private
     */
    normalizeRoute(route) {
        if (!route) return 'home';
        const normalized = route.toLowerCase().trim();
        return this.routes.has(normalized) ? this.routes.get(normalized) : normalized;
    }

    /**
     * Check for route loops and prevent them
     * @private
     */
    checkRouteLoop(route) {
        if (route === this.lastRoute) {
            this.routeCount++;
            if (this.routeCount > this.options.maxRouteLoops) {
                this.warn('Route loop detected, falling back to upload', { route });
                if (route !== 'upload') {
                    this.routeCount = 0;
                    this.lastRoute = null;
                    this.navigateTo('upload', { force: true });
                    return false;
                }
            }
        } else {
            this.routeCount = 0;
        }
        this.lastRoute = route;
        return true;
    }

    /**
     * Check authentication for protected routes
     * @private
     */
    checkAuthentication(route) {
        if (!this.protectedRoutes.has(route)) {
            return true; // Public route
        }

        const isAuthenticated = this.authService?.getIsAuthenticated() || 
                               !!localStorage.getItem('auth_token');

        this.log('Auth check for route', { 
            route, 
            isAuthenticated, 
            authServiceExists: !!this.authService,
            hasAuthToken: !!localStorage.getItem('auth_token')
        });

        if (!isAuthenticated) {
            // Prevent infinite auth loops
            if (this.lastAuthRequiredRoute === route && (Date.now() - (this.lastAuthRequiredTime || 0)) < 1000) {
                this.warn('Preventing auth required loop for route', route);
                return false; // Just block the route, don't emit again
            }
            
            this.lastAuthRequiredRoute = route;
            this.lastAuthRequiredTime = Date.now();
            
            this.log('Authentication required for route', { route });
            this.navigateTo('home', { replace: true });
            this.emit('navigation:auth_required', { route });
            return false;
        }

        // Reset auth loop tracking on successful auth
        this.lastAuthRequiredRoute = null;
        this.lastAuthRequiredTime = null;
        
        return true;
    }

    /**
     * Execute route handler
     * @private
     */
    executeRoute(route) {
        const handler = this.routeHandlers.get(route);

        if (handler) {
            try {
                this.currentRoute = route;
                this.emit('navigation:before', { route, previousRoute: this.lastRoute });
                
                handler(route);
                
                this.emit('navigation:after', { route, previousRoute: this.lastRoute });
                this.log('Route executed', { route });

            } catch (error) {
                this.error('Route handler error', error);
                this.emit('navigation:error', { route, error });
                
                // Fallback to safe route
                if (route !== 'upload') {
                    this.navigateTo('upload', { replace: true });
                }
            }
        } else {
            this.warn('No handler for route', { route });
            
            // Check if user is authenticated and default to app route
            const isAuthenticated = this.authService?.isAuthenticated() || 
                                   !!localStorage.getItem('auth_token');
            
            if (isAuthenticated) {
                this.handleAppRoute(); // Smart routing
            } else {
                this.handleHomeRoute();
            }
        }
    }

    // Route Handlers

    /**
     * Handle home route
     * @private
     */
    handleHomeRoute() {
        // Check if already authenticated
        const isAuthenticated = this.authService?.getIsAuthenticated() || 
                               !!localStorage.getItem('auth_token');

        if (isAuthenticated) {
            // Redirect authenticated users to upload
            this.navigateTo('upload', { replace: true });
            return;
        }

        this.emit('navigation:show_section', { section: 'landing' });
        this.currentRoute = 'home';
    }

    /**
     * Handle analytics route
     * @private
     */
    handleAnalyticsRoute() {
        this.emit('navigation:show_section', { section: 'analytics' });
        this.currentRoute = 'analytics';
    }

    /**
     * Handle app route (legacy compatibility)
     * @private
     */
    handleAppRoute() {
        // Smart routing based on current application state
        this.emit('navigation:show_section', { section: 'app' });

        // Let the application determine the appropriate view
        if (this.options.enableStateRestoration) {
            this.restoreApplicationState();
        } else {
            // Default to upload
            this.navigateTo('upload', { replace: true });
        }

        this.currentRoute = 'app';
    }

    /**
     * Handle upload route
     * @private
     */
    handleUploadRoute() {
        this.emit('navigation:show_section', { section: 'upload' });
        this.currentRoute = 'upload';
    }

    /**
     * Handle results route
     * @private
     */
    handleResultsRoute() {
        // Check if we have valid results to show
        if (this.hasValidResults()) {
            this.emit('navigation:show_section', { section: 'results' });
        } else if (this.canRestoreRecentJob()) {
            // Try to restore recent job
            this.emit('navigation:restore_job');
        } else {
            // No results available - redirect to upload
            this.log('No results available, redirecting to upload');
            this.navigateTo('upload', { replace: true });
            return;
        }

        this.currentRoute = 'results';
    }

    /**
     * Handle processing route
     * @private
     */
    handleProcessingRoute() {
        this.emit('navigation:show_section', { section: 'processing' });
        this.currentRoute = 'processing';
    }

    /**
     * Restore application state intelligently
     * @private
     */
    restoreApplicationState() {
        // Emit event for application to handle state restoration
        this.emit('navigation:restore_state');

        // If no state restoration happens, default to upload after a delay
        setTimeout(() => {
            if (this.currentRoute === 'app') {
                this.navigateTo('upload', { replace: true });
            }
        }, 1000);
    }

    /**
     * Check if there are valid results to display
     * @private
     */
    hasValidResults() {
        // Check via PhotoProcessor (legacy compatibility)
        if (window.photoProcessor && window.photoProcessor.groupedPhotos) {
            const results = window.photoProcessor.groupedPhotos;
            return Array.isArray(results) ? results.length > 0 : Object.keys(results).length > 0;
        }

        // Check via state service
        if (this.stateManagerService) {
            return this.stateManagerService.hasValidResults();
        }

        // Emit event to let other components respond
        this.emit('navigation:check_results');
        return false;
    }

    /**
     * Check if we can restore a recent job
     * @private
     */
    canRestoreRecentJob() {
        // Check via state manager (legacy compatibility)
        if (window.stateManager) {
            return window.stateManager.hasRecentCompletedJob();
        }

        // Check via state service
        if (this.stateManagerService) {
            return this.stateManagerService.hasRecentCompletedJob();
        }

        return false;
    }

    /**
     * Safely update URL hash
     * @private
     */
    safeUpdateHash(route) {
        try {
            const hashRoute = route === 'home' ? '' : route;
            window.location.hash = hashRoute;
        } catch (error) {
            this.warn('Failed to update hash', { route, error });
        }
    }

    /**
     * Safely replace state without triggering navigation
     */
    safeReplaceState(route) {
        try {
            const hashRoute = route === 'home' ? '' : route;
            const newHash = hashRoute ? `#${hashRoute}` : '';
            
            if (window.location.hash !== newHash) {
                history.replaceState(null, null, newHash);
            }
        } catch (error) {
            this.warn('Failed to replace state', { route, error });
            // Gracefully degrade - the app will still work without URL updates
        }
    }

    /**
     * Register a custom route handler
     */
    registerRoute(route, handler) {
        this.routes.set(route, route);
        this.routeHandlers.set(route, handler);
        this.log('Custom route registered', { route });
    }

    /**
     * Unregister a route handler
     */
    unregisterRoute(route) {
        this.routes.delete(route);
        this.routeHandlers.delete(route);
        this.log('Route unregistered', { route });
    }

    /**
     * Add a route to protected routes
     */
    addProtectedRoute(route) {
        this.protectedRoutes.add(route);
    }

    /**
     * Remove a route from protected routes
     */
    removeProtectedRoute(route) {
        this.protectedRoutes.delete(route);
    }

    /**
     * Get current route
     */
    getCurrentRoute() {
        return this.currentRoute;
    }

    /**
     * Check if currently on a specific route
     */
    isCurrentRoute(route) {
        return this.currentRoute === this.normalizeRoute(route);
    }

    /**
     * Go back in browser history
     */
    goBack() {
        window.history.back();
    }

    /**
     * Go forward in browser history
     */
    goForward() {
        window.history.forward();
    }

    /**
     * Event handlers
     */

    /**
     * Handle authentication state changes
     * @private
     */
    handleAuthChange() {
        // Re-evaluate current route with new auth state
        this.handleRouteChange();
    }

    /**
     * Handle navigation requests from other components
     * @private
     */
    handleNavigationRequest(data) {
        const { route, options = {} } = data;
        this.navigateTo(route, options);
    }

    /**
     * Handle component ready events
     * @private
     */
    handleComponentReady(data) {
        // Components can signal they're ready to handle specific routes
        const { componentType, supportedRoutes = [] } = data;
        
        supportedRoutes.forEach(route => {
            if (!this.routeHandlers.has(route)) {
                this.log('Component registered for route', { componentType, route });
            }
        });
    }

    /**
     * Get routing statistics
     */
    getStats() {
        return {
            currentRoute: this.currentRoute,
            lastRoute: this.lastRoute,
            routeCount: this.routeCount,
            totalRoutes: this.routes.size,
            protectedRoutes: Array.from(this.protectedRoutes),
            isNavigating: this.isNavigating
        };
    }

    /**
     * Static helper for legacy compatibility
     */
    static safeReplaceState(route) {
        try {
            const hashRoute = route === 'home' ? '' : route;
            const newHash = hashRoute ? `#${hashRoute}` : '';
            
            if (window.location.hash !== newHash) {
                history.replaceState(null, null, newHash);
            }
        } catch (error) {
            console.warn('Failed to replace state', { route, error });
        }
    }

    /**
     * Static helper to check if PhotoProcessor has valid results
     */
    static hasValidResults() {
        if (!window.photoProcessor || !window.photoProcessor.groupedPhotos) {
            return false;
        }
        
        const results = window.photoProcessor.groupedPhotos;
        return Array.isArray(results) ? 
            results.length > 0 : 
            Object.keys(results).length > 0;
    }
}