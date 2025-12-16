/**
 * ProfileService - User profile management service
 * Extracted from script.js user info handling and localStorage management
 * Provides centralized user profile state management and future extensibility
 */

import { BaseService } from './BaseService.js';

export class ProfileService extends BaseService {
    constructor(eventBus, options = {}) {
        super(eventBus, {
            name: 'ProfileService',
            enableLocalStorage: true,
            enableProfileCache: true,
            enableProfileSync: false, // Future: sync with backend
            cacheTimeout: 300000, // 5 minutes cache timeout
            ...options
        });

        // Current user profile state
        this.currentProfile = null;
        this.profileCache = new Map();
        this.isLoaded = false;

        // Profile storage keys
        this.storageKeys = {
            userInfo: 'user_info',
            profileCache: 'profile_cache',
            profilePreferences: 'profile_preferences'
        };

        // Service dependencies
        this.apiService = null;
        this.authService = null;
    }

    /**
     * Initialize profile service
     */
    async onInitialize() {
        // Get service dependencies
        this.apiService = this.serviceContainer?.get('apiService');
        this.authService = this.serviceContainer?.get('authService');

        // Setup event listeners
        this.setupEventListeners();

        // Load current profile from storage
        this.loadProfileFromStorage();

        this.log('ProfileService initialized');
    }

    /**
     * Setup event listeners
     * @private
     */
    setupEventListeners() {
        // Auth events
        this.on('auth:signin:success', this.handleAuthSuccess.bind(this));
        this.on('auth:signout:success', this.handleAuthSignout.bind(this));
        this.on('auth:logout:success', this.handleAuthSignout.bind(this));

        // Profile update events
        this.on('profile:update:request', this.handleProfileUpdateRequest.bind(this));
        this.on('profile:preferences:update', this.handlePreferencesUpdate.bind(this));
    }

    /**
     * Load profile from localStorage
     * @private
     */
    loadProfileFromStorage() {
        try {
            if (!this.options.enableLocalStorage) return;

            const storedUserInfo = localStorage.getItem(this.storageKeys.userInfo);
            if (storedUserInfo) {
                this.currentProfile = JSON.parse(storedUserInfo);
                this.isLoaded = true;
                this.log('Profile loaded from storage', { userId: this.currentProfile?.id });
                
                // Emit profile loaded event
                this.emit('profile:loaded', { profile: this.currentProfile });
            }

            // Load cached profiles if enabled
            if (this.options.enableProfileCache) {
                this.loadProfileCache();
            }

        } catch (error) {
            this.error('Failed to load profile from storage:', error);
            this.clearStoredProfile();
        }
    }

    /**
     * Load profile cache from storage
     * @private
     */
    loadProfileCache() {
        try {
            const storedCache = localStorage.getItem(this.storageKeys.profileCache);
            if (storedCache) {
                const cacheData = JSON.parse(storedCache);
                
                // Check cache validity
                if (this.isCacheValid(cacheData.timestamp)) {
                    this.profileCache = new Map(cacheData.profiles);
                    this.log('Profile cache loaded', { count: this.profileCache.size });
                } else {
                    this.clearProfileCache();
                }
            }
        } catch (error) {
            this.warn('Failed to load profile cache:', error);
            this.clearProfileCache();
        }
    }

    /**
     * Check if cache is valid
     * @private
     */
    isCacheValid(timestamp) {
        return timestamp && (Date.now() - timestamp) < this.options.cacheTimeout;
    }

    /**
     * Get current user profile
     */
    getCurrentProfile() {
        return this.currentProfile;
    }

    /**
     * Check if profile is loaded
     */
    isProfileLoaded() {
        return this.isLoaded && this.currentProfile !== null;
    }

    /**
     * Set current profile
     */
    setProfile(profileData, saveToStorage = true) {
        try {
            // Validate profile data
            if (!profileData || typeof profileData !== 'object') {
                throw new Error('Invalid profile data provided');
            }

            this.currentProfile = {
                ...profileData,
                lastUpdated: new Date().toISOString()
            };

            this.isLoaded = true;

            // Save to storage
            if (saveToStorage && this.options.enableLocalStorage) {
                this.saveProfileToStorage();
            }

            // Cache profile
            if (this.options.enableProfileCache && profileData.id) {
                this.profileCache.set(profileData.id, this.currentProfile);
                this.saveProfileCache();
            }

            this.emit('profile:updated', { profile: this.currentProfile });
            this.log('Profile updated', { userId: this.currentProfile.id });

        } catch (error) {
            this.error('Failed to set profile:', error);
            throw error;
        }
    }

    /**
     * Update specific profile fields
     */
    updateProfile(updates, saveToStorage = true) {
        if (!this.currentProfile) {
            throw new Error('No current profile to update');
        }

        try {
            const updatedProfile = {
                ...this.currentProfile,
                ...updates,
                lastUpdated: new Date().toISOString()
            };

            this.setProfile(updatedProfile, saveToStorage);

            this.emit('profile:field:updated', { 
                updates, 
                profile: this.currentProfile 
            });

            return this.currentProfile;

        } catch (error) {
            this.error('Failed to update profile:', error);
            throw error;
        }
    }

    /**
     * Save profile to localStorage
     * @private
     */
    saveProfileToStorage() {
        try {
            if (!this.options.enableLocalStorage || !this.currentProfile) return;

            localStorage.setItem(
                this.storageKeys.userInfo, 
                JSON.stringify(this.currentProfile)
            );

            this.log('Profile saved to storage');

        } catch (error) {
            this.error('Failed to save profile to storage:', error);
        }
    }

    /**
     * Save profile cache to storage
     * @private
     */
    saveProfileCache() {
        try {
            if (!this.options.enableProfileCache) return;

            const cacheData = {
                timestamp: Date.now(),
                profiles: Array.from(this.profileCache.entries())
            };

            localStorage.setItem(
                this.storageKeys.profileCache,
                JSON.stringify(cacheData)
            );

        } catch (error) {
            this.warn('Failed to save profile cache:', error);
        }
    }

    /**
     * Clear current profile
     */
    clearProfile(clearStorage = true) {
        this.currentProfile = null;
        this.isLoaded = false;

        if (clearStorage && this.options.enableLocalStorage) {
            this.clearStoredProfile();
        }

        this.emit('profile:cleared');
        this.log('Profile cleared');
    }

    /**
     * Clear stored profile from localStorage
     * @private
     */
    clearStoredProfile() {
        try {
            localStorage.removeItem(this.storageKeys.userInfo);
            this.log('Stored profile cleared');
        } catch (error) {
            this.error('Failed to clear stored profile:', error);
        }
    }

    /**
     * Clear profile cache
     */
    clearProfileCache() {
        this.profileCache.clear();
        
        try {
            localStorage.removeItem(this.storageKeys.profileCache);
        } catch (error) {
            this.warn('Failed to clear profile cache storage:', error);
        }

        this.log('Profile cache cleared');
    }

    /**
     * Get profile by user ID from cache
     */
    getCachedProfile(userId) {
        return this.profileCache.get(userId) || null;
    }

    /**
     * Cache profile for user
     */
    cacheProfile(userId, profileData) {
        if (!this.options.enableProfileCache) return;

        this.profileCache.set(userId, {
            ...profileData,
            cachedAt: new Date().toISOString()
        });

        this.saveProfileCache();
        this.log('Profile cached', { userId });
    }

    /**
     * Get user preferences
     */
    getUserPreferences() {
        try {
            const stored = localStorage.getItem(this.storageKeys.profilePreferences);
            return stored ? JSON.parse(stored) : {};
        } catch (error) {
            this.warn('Failed to load user preferences:', error);
            return {};
        }
    }

    /**
     * Set user preferences
     */
    setUserPreferences(preferences) {
        try {
            localStorage.setItem(
                this.storageKeys.profilePreferences,
                JSON.stringify(preferences)
            );

            this.emit('profile:preferences:updated', { preferences });
            this.log('User preferences updated');

        } catch (error) {
            this.error('Failed to save user preferences:', error);
        }
    }

    /**
     * Update specific preference
     */
    updatePreference(key, value) {
        const preferences = this.getUserPreferences();
        preferences[key] = value;
        this.setUserPreferences(preferences);
    }

    /**
     * Get specific preference
     */
    getPreference(key, defaultValue = null) {
        const preferences = this.getUserPreferences();
        return preferences[key] !== undefined ? preferences[key] : defaultValue;
    }

    /**
     * Sync profile with backend (future feature)
     */
    async syncProfileWithBackend() {
        if (!this.options.enableProfileSync || !this.apiService) {
            return false;
        }

        try {
            if (!this.currentProfile?.id) {
                throw new Error('No profile to sync');
            }

            this.log('Syncing profile with backend', { userId: this.currentProfile.id });

            const response = await this.apiService.get(`/users/${this.currentProfile.id}/profile`);

            if (response && response.profile) {
                // Update local profile with backend data
                this.setProfile(response.profile, true);
                this.emit('profile:synced', { profile: response.profile });
                return true;
            }

        } catch (error) {
            this.error('Profile sync failed:', error);
            this.emit('profile:sync:failed', { error });
            return false;
        }
    }

    /**
     * Get profile display information
     */
    getDisplayInfo() {
        if (!this.currentProfile) {
            return {
                displayName: 'Guest User',
                initials: 'GU',
                email: null,
                isAuthenticated: false
            };
        }

        const { name, email, first_name, last_name } = this.currentProfile;
        
        let displayName = name || 'User';
        if (!name && (first_name || last_name)) {
            displayName = [first_name, last_name].filter(Boolean).join(' ');
        }

        const initials = this.generateInitials(displayName);

        return {
            displayName,
            initials,
            email: email || null,
            isAuthenticated: true,
            profile: this.currentProfile
        };
    }

    /**
     * Generate user initials
     * @private
     */
    generateInitials(name) {
        if (!name) return 'U';
        
        return name
            .split(' ')
            .map(part => part.charAt(0).toUpperCase())
            .slice(0, 2)
            .join('');
    }

    // Event Handlers

    /**
     * Handle authentication success
     * @private
     */
    handleAuthSuccess(data) {
        if (data.user) {
            this.setProfile(data.user);
            this.log('Profile updated from auth success');
        }
    }

    /**
     * Handle authentication signout
     * @private
     */
    handleAuthSignout() {
        this.clearProfile(true);
        this.log('Profile cleared from auth signout');
    }

    /**
     * Handle profile update requests
     * @private
     */
    handleProfileUpdateRequest(data) {
        try {
            const { updates } = data;
            this.updateProfile(updates);
        } catch (error) {
            this.error('Profile update request failed:', error);
            this.emit('profile:update:failed', { error });
        }
    }

    /**
     * Handle preferences updates
     * @private
     */
    handlePreferencesUpdate(data) {
        const { preferences } = data;
        this.setUserPreferences(preferences);
    }

    /**
     * Get service statistics
     */
    getStats() {
        return {
            profile: {
                isLoaded: this.isLoaded,
                hasProfile: !!this.currentProfile,
                userId: this.currentProfile?.id || null
            },
            cache: {
                enabled: this.options.enableProfileCache,
                size: this.profileCache.size,
                keys: Array.from(this.profileCache.keys())
            },
            storage: {
                enabled: this.options.enableLocalStorage,
                hasStoredProfile: !!localStorage.getItem(this.storageKeys.userInfo),
                hasPreferences: !!localStorage.getItem(this.storageKeys.profilePreferences)
            },
            options: this.options
        };
    }

    /**
     * Cleanup service
     */
    async cleanup() {
        // Clear memory state
        this.currentProfile = null;
        this.isLoaded = false;
        
        // Clear cache
        this.profileCache.clear();

        await super.cleanup();
    }

    /**
     * Static helper for legacy compatibility
     */
    static getCurrentUserInfo() {
        try {
            const userInfo = localStorage.getItem('user_info');
            return userInfo ? JSON.parse(userInfo) : null;
        } catch {
            return null;
        }
    }

    /**
     * Static helper to check if user info exists
     */
    static hasUserInfo() {
        return !!localStorage.getItem('user_info');
    }
}