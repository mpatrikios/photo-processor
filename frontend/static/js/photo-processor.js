import CONFIG from './config.js';

export class PhotoProcessor {
    constructor() {
        // Use centralized API configuration
        this.apiBase = CONFIG.API_BASE_URL;
        this.selectedFiles = [];
        this.currentJobId = null;
        this.groupedPhotos = [];
        this.filteredGroups = [];
        this.modalSelectedFiles = []; // For upload more modal
        this.currentFilter = 'all';
        this.currentSort = 'bib-asc';
        this.searchTerm = '';
        this.confidenceFilter = 0;
        this.photoCountFilter = 1;
        
        // Processing state for warnings
        this.isActivelyProcessing = false;
        this.beforeUnloadHandler = null;
        
        // Session restoration tracking to prevent duplicate notifications
        this.hasRestoredSession = false;
        this.restorationInProgress = false;

        
        // Unified progress tracking
        this.unifiedProgress = null;
        
        const storedToken = localStorage.getItem('auth_token');
        this.authToken = storedToken || null;
        this.isAuthenticated = !!storedToken;
        this.zoomLevel = 1;
        this.panX = 0;
        this.panY = 0;
        this.currentLightboxGroup = null;
        this.currentPhotoIndex = 0;

        this.initializeEventListeners();
        this.initializeSearchAndFilters();
    }

    // Authentication Methods
    async checkAuthStatus() {
        const token = localStorage.getItem('auth_token');
        if (!token) {
            this.showLoginScreen();
            return false;
        }

        // First, assume the token is valid if it exists (optimistic approach)
        this.isAuthenticated = true;
        this.authToken = token;
        
        if (window.stateManager) {
            const userInfo = localStorage.getItem('user_info');
            try {
                window.stateManager.set('auth.isAuthenticated', true);
                window.stateManager.set('auth.token', token);
                if (userInfo) {
                    window.stateManager.set('auth.user', JSON.parse(userInfo));
                }
            } catch (error) {
                console.error('Failed to update StateManager auth state:', error);
            }
        }
        
        showAppSection();
        
        // Then validate in the background (non-blocking)
        try {
            const response = await fetch(`${this.apiBase}/auth/validate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                if (data.valid) {
                    // Token is valid, update user info if available
                    if (data.user) {
                        localStorage.setItem('user_info', JSON.stringify(data.user));
                        if (window.stateManager) {
                            window.stateManager.set('auth.user', data.user);
                        }
                    }
                    
                    // Check for recent completed jobs and restore if found
                    await this.checkAndRestoreRecentJob();
                    
                    return true;
                }
            }
            
            // Only clear auth if we got a definitive rejection (401/403)
            if (response.status === 401 || response.status === 403) {
                console.warn('Token validation failed, logging out');
                localStorage.removeItem('auth_token');
                localStorage.removeItem('user_info');
                this.isAuthenticated = false;
                this.authToken = null;
                
                if (window.stateManager) {
                    window.stateManager.set('auth.isAuthenticated', false);
                    window.stateManager.set('auth.token', null);
                    window.stateManager.set('auth.user', null);
                }
                
                this.showLoginScreen();
                return false;
            }
        } catch (error) {
            // Network error or server down - keep user logged in
            console.warn('Auth validation failed (network error), keeping user logged in:', error);
        }
        
        return true;
    }

    showLoginScreen() {
        // Make sure we're on the landing page, not showing API response
        showLandingPage();
    }

    showProcessingWarning() {
        // Warning message is now integrated into the processing page HTML
        // Just add beforeunload warning to prevent accidental page close
        this.beforeUnloadHandler = (e) => {
            if (this.isActivelyProcessing) {
                const message = 'Photo processing is in progress. Manual labels are saved, but leaving now may interrupt processing. Are you sure you want to leave?';
                e.preventDefault();
                e.returnValue = message;
                return message;
            }
        };
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
        
        this.isActivelyProcessing = true;
    }

    hideProcessingWarning() {
        // Warning message is now integrated into the processing page HTML
        // Just remove beforeunload warning
        if (this.beforeUnloadHandler) {
            window.removeEventListener('beforeunload', this.beforeUnloadHandler);
            this.beforeUnloadHandler = null;
        }
        
        this.isActivelyProcessing = false;
    }

    async checkAndRestoreRecentJob() {
        // Prevent concurrent restoration attempts and duplicate notifications
        if (this.hasRestoredSession || this.restorationInProgress) {
            return;
        }
        
        this.restorationInProgress = true;
        
        try {
            // First check for active/interrupted processing jobs
            const currentJobId = window.stateManager?.get('processing.currentJobId');
            const currentJobStatus = window.stateManager?.get('processing.currentJobStatus');
            
            if (currentJobId && currentJobStatus && currentJobStatus !== 'completed') {
                
                // Try to resume the active job
                try {
                    const statusResponse = await fetch(`${this.apiBase}/process/status/${currentJobId}`, {
                        headers: { 'Authorization': `Bearer ${this.authToken}` }
                    });
                    
                    if (statusResponse.ok) {
                        const jobStatus = await statusResponse.json();
                        this.currentJobId = currentJobId;
                        
                        if (jobStatus.status === 'completed') {
                            // Job completed while we were offline, get results
                            const resultsResponse = await fetch(`${this.apiBase}/process/results/${currentJobId}`, {
                                headers: { 'Authorization': `Bearer ${this.authToken}` }
                            });
                            
                            if (resultsResponse.ok) {
                                this.groupedPhotos = this.convertGroupedPhotosObjectToArray(await resultsResponse.json());
                                window.stateManager.markJobCompleted(currentJobId, 'completed');
                                this.showResultsSection();
                                // Mark session as restored to prevent duplicate notifications
                                this.hasRestoredSession = true;
                                return;
                            }
                        } else if (jobStatus.status === 'processing' || jobStatus.status === 'pending') {
                            this.showProcessingSection();
                            this.showProcessingWarning(); // Activate reload protection
                            
                            const progressText = document.getElementById('progress-text');
                            if (progressText) {
                                progressText.innerHTML = '<i class="fas fa-play text-success me-2"></i>Resuming processing job...';
                                setTimeout(() => {
                                    // Will be updated by polling
                                }, 1000);
                            }
                            
                            this.pollProcessingStatusWithUnifiedProgress();
                            // Mark session as handled to prevent duplicate restoration attempts
                            this.hasRestoredSession = true;
                            return;
                        } else if (jobStatus.status === 'failed') {
                            window.stateManager.markJobCompleted(currentJobId, 'failed');
                        }
                    } else {
                        console.warn(`Active job ${currentJobId} not found on server, clearing from localStorage`);
                        window.stateManager.set('processing.currentJobId', null);
                        window.stateManager.set('processing.currentJobStatus', null);
                    }
                } catch (error) {
                    console.error('Error resuming active job:', error);
                    // Don't clear the job state in case of network error - user might retry
                }
            }
            
            if (!window.stateManager || !window.stateManager.hasRecentCompletedJob()) {
                this.hasRestoredSession = true; // Mark as handled even if nothing to restore
                return;
            }

            const lastJobId = window.stateManager.get('processing.lastCompletedJobId');
            
            
            // Fetch the job results from the server
            const response = await fetch(`${this.apiBase}/process/results/${lastJobId}`, {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (response.ok) {
                const results = await response.json();
                
                this.currentJobId = lastJobId;
                window.stateManager.set('processing.currentJobId', lastJobId);
                window.stateManager.set('photos.groupedPhotos', results);
                
                this.groupedPhotos = this.convertGroupedPhotosObjectToArray(results);
                this.showResultsSection();
                
                // Mark session as restored to prevent duplicate notifications
                this.hasRestoredSession = true;
                
            } else {
                console.warn('Failed to restore job results, clearing saved state');
                window.stateManager.clearCompletedJob();
            }
            
        } catch (error) {
            console.error('Error restoring recent job:', error);
            if (window.stateManager) {
                window.stateManager.clearCompletedJob();
            }
        } finally {
            // Always clear the progress flag regardless of outcome
            this.restorationInProgress = false;
        }
    }

    showMainContent() {
        document.getElementById('login-section').classList.add('d-none');
        document.getElementById('main-content').classList.remove('d-none');
        
        this.loadUserQuota();
    }

    initializeLoginForm() {
        const loginForm = document.getElementById('loginForm');
        if (loginForm && !loginForm.hasEventListener) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
            loginForm.hasEventListener = true;
        }
    }

    async handleLogin(e) {
        e.preventDefault();

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const submitBtn = e.target.querySelector('button[type="submit"]');

        const originalText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Signing In...';

        try {
            const response = await fetch(`${this.apiBase}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
            });

            if (response.ok) {
                const result = await response.json();
                localStorage.setItem('auth_token', result.token);
                this.authToken = result.token;
                this.isAuthenticated = true;
                this.showMainContent();
                this.showSuccess(result.message);
            } else {
                const error = await response.json();
                this.showError(error.detail || 'Login failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showError('Login failed. Please try again.');
        } finally {
            // Restore button state
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    }

    async initializeApp() {
        // Prevent multiple initialization calls
        if (this.initializationInProgress) {
            return;
        }
        this.initializationInProgress = true;
        
        try {
            // Check if we have a stored token
            const token = localStorage.getItem('auth_token');
            
            if (token) {
                this.authToken = token;
                
                const isValid = await this.checkAuthStatus();
                if (!isValid) {
                    this.showLoginScreen();
                } else {
                    // Update StateManager auth state if it exists
                    try {
                        if (window.stateManager && window.stateManager.state && window.stateManager.state.auth) {
                            window.stateManager.state.auth.isAuthenticated = true;
                            window.stateManager.state.auth.token = token;
                        }
                    } catch (error) {
                    }
                }
            } else {
                this.showLoginScreen();
            }
        } finally {
            this.initializationInProgress = false;
        }
    }

    async logout() {
        try {
            // Call backend logout if we have a token
            if (this.authToken) {
                await fetch(`${this.apiBase}/auth/logout`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.authToken}`
                    },
                    credentials: 'include'
                });
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            // Always clear local session regardless of backend response
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user_info');
            this.authToken = null;
            this.isAuthenticated = false;
            this.resetApp();
            this.showLoginScreen();
            this.showSuccess('Successfully logged out!');
        }
    }

    initializeEventListeners() {
        // File upload events
        const uploadArea = document.getElementById('upload-area');
        const fileInput = document.getElementById('file-input');
        const folderInput = document.getElementById('folder-input');
        const uploadBtn = document.getElementById('upload-btn');
        const chooseFilesBtn = document.getElementById('choose-files-btn');
        const chooseFolderBtn = document.getElementById('choose-folder-btn');

        // Drag and drop events
        uploadArea.addEventListener('click', (e) => {
            if (e.target === uploadArea || e.target.closest('.upload-content')) {
                // Only trigger file input if clicking the upload area itself, not buttons
                if (!e.target.closest('button')) {
                    fileInput.click();
                }
            }
        });
        uploadArea.addEventListener('dragover', this.handleDragOver.bind(this));
        uploadArea.addEventListener('dragleave', this.handleDragLeave.bind(this));
        uploadArea.addEventListener('drop', this.handleDrop.bind(this));

        // Button events
        chooseFilesBtn.addEventListener('click', () => fileInput.click());
        chooseFolderBtn.addEventListener('click', () => folderInput.click());

        // File input change events
        fileInput.addEventListener('change', async (e) => await this.handleFileSelect(e.target.files, false));
        folderInput.addEventListener('change', async (e) => await this.handleFileSelect(e.target.files, true));

        // Upload button
        uploadBtn.addEventListener('click', this.uploadFiles.bind(this));

        document.getElementById('clear-files-btn').addEventListener('click', this.clearAllFiles.bind(this));
        document.getElementById('add-more-btn').addEventListener('click', () => fileInput.click());

        // Reset button
        document.getElementById('reset-btn').addEventListener('click', this.resetApp.bind(this));

        // Upload more button (only available in results section)
        document.addEventListener('click', (e) => {
            if (e.target.id === 'upload-more-btn') {
                this.showUploadMoreModal();
            }
        });

        // Modal event listeners
        this.initializeModalEventListeners();

        // Download All button (simplified)
        document.getElementById('download-all-btn').addEventListener('click', this.downloadAllPhotos.bind(this));

        // Simplified - no bulk selection needed
    }

    initializeBulkSelection() {
        document.getElementById('selectAllGroups').addEventListener('change', (e) => {
            if (e.target.checked) {
                this.selectAllGroups();
            } else {
                this.selectNone();
            }
        });

        document.getElementById('selectDetectedBtn').addEventListener('click', () => {
            this.selectDetectedGroups();
        });

        document.getElementById('selectUnknownBtn').addEventListener('click', () => {
            this.selectUnknownGroups();
        });

        document.getElementById('selectNoneBtn').addEventListener('click', () => {
            this.selectNone();
        });

    }



    initializeSearchAndFilters() {
        // Search input - only initialize if elements exist
        const searchInput = document.getElementById('searchBib');
        const clearSearchBtn = document.getElementById('clearSearchBtn');
        const searchSuggestions = document.getElementById('searchSuggestions');

        if (searchInput && clearSearchBtn && searchSuggestions) {
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value.toLowerCase();
                this.showSearchSuggestions();
                this.applyFilters();
            });

            searchInput.addEventListener('focus', () => {
                if (this.searchTerm === '') {
                    this.showSearchSuggestions();
                }
            });

            searchInput.addEventListener('blur', () => {
                // Delay hiding suggestions to allow clicking
                setTimeout(() => {
                    searchSuggestions.classList.remove('show');
                }, 150);
            });

            clearSearchBtn.addEventListener('click', () => {
                searchInput.value = '';
                this.searchTerm = '';
                this.applyFilters();
                searchSuggestions.classList.remove('show');
            });
        }

        // Filter buttons - only initialize if they exist
        const filterAll = document.getElementById('filterAll');
        const filterDetected = document.getElementById('filterDetected');
        const filterUnknown = document.getElementById('filterUnknown');

        if (filterAll) filterAll.addEventListener('click', () => this.setFilter('all'));
        if (filterDetected) filterDetected.addEventListener('click', () => this.setFilter('detected'));
        if (filterUnknown) filterUnknown.addEventListener('click', () => this.setFilter('unknown'));

        // Sort dropdown
        document.querySelectorAll('[data-sort]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.setSort(e.target.dataset.sort);
            });
        });

        // Advanced filters - only initialize if elements exist
        const showAdvancedBtn = document.getElementById('showAdvancedFilters');
        const hideAdvancedBtn = document.getElementById('toggleAdvancedFilters');
        const advancedFilters = document.getElementById('advancedFilters');

        if (showAdvancedBtn && hideAdvancedBtn && advancedFilters) {
            showAdvancedBtn.addEventListener('click', () => {
                advancedFilters.style.display = 'block';
                showAdvancedBtn.style.display = 'none';
            });

            hideAdvancedBtn.addEventListener('click', () => {
                advancedFilters.style.display = 'none';
                showAdvancedBtn.style.display = 'block';
            });
        }

        // Range sliders - only initialize if elements exist
        const confidenceRange = document.getElementById('confidenceRange');
        const photoCountRange = document.getElementById('photoCountRange');
        const confidenceValue = document.getElementById('confidenceValue');
        const photoCountValue = document.getElementById('photoCountValue');

        if (confidenceRange && confidenceValue) {
            confidenceRange.addEventListener('input', (e) => {
                this.confidenceFilter = parseInt(e.target.value);
                confidenceValue.textContent = `${this.confidenceFilter}%+`;
                this.applyFilters();
            });
        }

        if (photoCountRange && photoCountValue) {
            photoCountRange.addEventListener('input', (e) => {
                this.photoCountFilter = parseInt(e.target.value);
                photoCountValue.textContent = `${this.photoCountFilter}+`;
                this.applyFilters();
            });
        }
    }

    showSearchSuggestions() {
        const searchSuggestions = document.getElementById('searchSuggestions');
        if (!searchSuggestions) return; // Exit if element doesn't exist

        const bibNumbers = this.groupedPhotos
            .map(group => group.bib_number)
            .filter(bib => bib !== 'unknown')
            .filter(bib => this.searchTerm === '' || bib.toLowerCase().includes(this.searchTerm))
            .slice(0, 8);

        if (bibNumbers.length === 0 && this.searchTerm === '') {
            searchSuggestions.classList.remove('show');
            return;
        }

        searchSuggestions.innerHTML = bibNumbers.map(bib => `
            <div class="suggestion-item" onclick="photoProcessor.selectSuggestion('${bib}')">
                Bib #${bib}
            </div>
        `).join('');

        if (bibNumbers.length > 0) {
            searchSuggestions.classList.add('show');
        } else {
            searchSuggestions.classList.remove('show');
        }
    }

    selectSuggestion(bibNumber) {
        const searchInput = document.getElementById('searchBib');
        const searchSuggestions = document.getElementById('searchSuggestions');

        if (searchInput) {
            searchInput.value = bibNumber;
            this.searchTerm = bibNumber.toLowerCase();
            this.applyFilters();
        }

        if (searchSuggestions) {
            searchSuggestions.classList.remove('show');
        }
    }

    setFilter(filter) {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            if (btn.id === `filter${filter.charAt(0).toUpperCase() + filter.slice(1)}` || 
                (filter === 'all' && btn.id === 'filterAll')) {
                btn.classList.add('active');
                btn.classList.remove('btn-outline-primary', 'btn-outline-success', 'btn-outline-warning');
                if (filter === 'all') btn.classList.add('btn-primary');
                else if (filter === 'detected') btn.classList.add('btn-success');
                else if (filter === 'unknown') btn.classList.add('btn-warning');
            } else {
                btn.classList.remove('active', 'btn-primary', 'btn-success', 'btn-warning');
                if (btn.id === 'filterAll') btn.classList.add('btn-outline-primary');
                else if (btn.id === 'filterDetected') btn.classList.add('btn-outline-success');
                else if (btn.id === 'filterUnknown') btn.classList.add('btn-outline-warning');
            }
        });

        this.currentFilter = filter;
        this.applyFilters();
    }

    setSort(sortType) {
        this.currentSort = sortType;
        this.applyFilters();

        const sortLabels = {
            'bib-asc': 'Bib A-Z',
            'bib-desc': 'Bib Z-A',
            'count-desc': 'Most Photos',
            'count-asc': 'Least Photos',
            'confidence-desc': 'High Confidence',
            'confidence-asc': 'Low Confidence'
        };

        document.getElementById('sortDropdown').innerHTML = `
            <i class="fas fa-sort me-1"></i>${sortLabels[sortType]}
        `;
    }

    applyFilters() {
        if (!this.groupedPhotos || this.groupedPhotos.length === 0) {
            this.filteredGroups = [];
            this.updateResultsCount(0);
            return;
        }

        let filtered = [...this.groupedPhotos];

        // Apply search filter
        if (this.searchTerm) {
            filtered = filtered.filter(group => 
                group.bib_number.toLowerCase().includes(this.searchTerm)
            );
        }

        // Apply category filter
        if (this.currentFilter !== 'all') {
            if (this.currentFilter === 'detected') {
                filtered = filtered.filter(group => group.bib_number !== 'unknown');
            } else if (this.currentFilter === 'unknown') {
                filtered = filtered.filter(group => group.bib_number === 'unknown');
            }
        }

        // Apply confidence filter
        if (this.confidenceFilter > 0) {
            filtered = filtered.filter(group => {
                if (group.bib_number === 'unknown') return false;
                const avgConfidence = this.getGroupAverageConfidence(group);
                return avgConfidence >= (this.confidenceFilter / 100);
            });
        }

        // Apply photo count filter
        if (this.photoCountFilter > 1) {
            filtered = filtered.filter(group => group.count >= this.photoCountFilter);
        }

        // Apply sorting
        filtered.sort((a, b) => {
            switch (this.currentSort) {
                case 'bib-asc':
                    if (a.bib_number === 'unknown') return 1;
                    if (b.bib_number === 'unknown') return -1;
                    return a.bib_number.localeCompare(b.bib_number, undefined, { numeric: true });
                case 'bib-desc':
                    if (a.bib_number === 'unknown') return 1;
                    if (b.bib_number === 'unknown') return -1;
                    return b.bib_number.localeCompare(a.bib_number, undefined, { numeric: true });
                case 'count-desc':
                    return b.count - a.count;
                case 'count-asc':
                    return a.count - b.count;
                case 'confidence-desc':
                    const confA = this.getGroupAverageConfidence(a);
                    const confB = this.getGroupAverageConfidence(b);
                    return confB - confA;
                case 'confidence-asc':
                    const confA2 = this.getGroupAverageConfidence(a);
                    const confB2 = this.getGroupAverageConfidence(b);
                    return confA2 - confB2;
                default:
                    return 0;
            }
        });

        this.filteredGroups = filtered;
        this.updateResultsCount(filtered.length);
        this.displayFilteredPhotoGroups();
    }

    getGroupAverageConfidence(group) {
        const photosWithConfidence = group.photos.filter(photo => photo.detection_result);
        if (photosWithConfidence.length === 0) return 0;

        const totalConfidence = photosWithConfidence.reduce((sum, photo) => 
            sum + photo.detection_result.confidence, 0);
        return totalConfidence / photosWithConfidence.length;
    }

    updateResultsCount(count) {
        const total = this.groupedPhotos.length;
        const resultsCount = document.getElementById('resultsCount');

        if (count === total) {
            resultsCount.textContent = `Showing all ${total} groups`;
        } else {
            resultsCount.textContent = `Showing ${count} of ${total} groups`;
        }
    }

    displayFilteredPhotoGroups() {
        const photoGroupsDiv = document.getElementById('photo-groups');
        const groupsToShow = this.filteredGroups.length > 0 ? this.filteredGroups : this.groupedPhotos;


        if (groupsToShow.length === 0) {
            photoGroupsDiv.innerHTML = `
                <div class="col-12 text-center py-5">
                    <i class="fas fa-search fa-3x text-muted mb-3"></i>
                    <h5 class="text-muted">No groups found</h5>
                    <p class="text-muted">Try adjusting your search or filters</p>
                </div>
            `;
            return;
        }

        photoGroupsDiv.innerHTML = groupsToShow.map(group => `
            <div class="fade-in-up">
                <div class="gallery-section">
                    <div class="gallery-header">
                        <h5 class="gallery-title">
                            ${group.bib_number === 'unknown' ? 'Unknown Bib' : `Bib #${group.bib_number}`}
                        </h5>
                        <span class="photo-count-pill">${group.count} photo${group.count !== 1 ? 's' : ''}</span>
                    </div>

                        <div class="photo-grid">
                            ${group.photos.slice(0, 4).map((photo, index) => `
                                <div class="photo-item" onclick="photoProcessor.showPhotoModal('${photo.id}', '${photo.filename}', '${group.bib_number}')">
                                    <img src="${this.getImageUrl(photo.id)}" 
                                         alt="${photo.filename}" 
                                         style="width: 100%; height: 100%; object-fit: cover; border-radius: var(--border-radius);"
                                         onerror="console.error('Failed to load image:', this.src); this.style.display='none'; this.nextElementSibling.style.display='flex';">
                                    <div class="photo-placeholder" style="display: none;">
                                        <i class="fas fa-image fa-2x"></i>
                                    </div>
                                    <div class="hover-overlay">
                                        <i class="fas fa-expand-alt me-1"></i>
                                        ${group.bib_number === 'unknown' ? 'View & Label' : 'View & Edit'}
                                    </div>
                                    ${photo.detection_result && photo.detection_result.confidence > 0 ? `
                                        <div class="confidence-badge ${this.getConfidenceClass(photo.detection_result.confidence)}">
                                            ${Math.round((photo.detection_result.confidence / 1.5) * 100)}%
                                        </div>
                                    ` : ''}
                                    ${group.count > 4 && index === 3 ? `
                                        <div class="more-photos-overlay">
                                            <div class="more-photos-text">
                                                <i class="fas fa-plus-circle mb-1"></i>
                                                <div>+${group.count - 4} more</div>
                                            </div>
                                        </div>
                                    ` : ''}
                                </div>
                            `).join('')}
                        </div>
                </div>
            </div>
        `).join('');
    }

    // Drag and Drop Handlers
    handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('upload-area').classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('upload-area').classList.remove('dragover');
    }

    async handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('upload-area').classList.remove('dragover');

        const files = Array.from(e.dataTransfer.files).filter(file => 
            file.type.startsWith('image/')
        );

        await this.handleFileSelect(files);
    }

    // File Selection Handler - Validation Only (No Compression)
    async handleFileSelect(files, isFolder = false) {
        // Clear any previous completed job state when starting new upload
        if (window.stateManager) {
            window.stateManager.clearCompletedJob();
        }
        
        const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
        const SUPPORTED_FORMATS = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

        const invalidFiles = [];
        const validFiles = [];
        
        // Validate files: format and size only
        Array.from(files).forEach(file => {
            if (!SUPPORTED_FORMATS.includes(file.type)) {
                invalidFiles.push(`${file.name} - unsupported format`);
            } else if (file.size > MAX_FILE_SIZE) {
                invalidFiles.push(`${file.name} - too large (${this.formatFileSize(file.size)})`);
            } else {
                validFiles.push(file);
            }
        });

        // Add valid files to selection (raw, uncompressed)
        this.selectedFiles = [...this.selectedFiles, ...validFiles];

        // Remove duplicates based on file name and size
        this.selectedFiles = this.selectedFiles.filter((file, index, self) =>
            index === self.findIndex(f => f.name === file.name && f.size === file.size)
        );

        this.displaySelectedFiles();

        // Show feedback messages
        if (validFiles.length > 0) {
            this.showSuccess(`Added ${validFiles.length} photos${isFolder ? ' from folder' : ''}`);
        }

        if (invalidFiles.length > 0) {
            this.showError(`${invalidFiles.length} files skipped (unsupported or processing failed)`);
        }
    }

    async displaySelectedFiles() {
        const selectedFilesDiv = document.getElementById('selected-files');
        const fileListDiv = document.getElementById('file-list');
        const fileCountSpan = document.getElementById('file-count');

        if (this.selectedFiles.length === 0) {
            selectedFilesDiv.classList.add('d-none');
            return;
        }

        selectedFilesDiv.classList.remove('d-none');
        fileCountSpan.textContent = this.selectedFiles.length;

        // Check quota and add warning if needed
        const quotaCheck = await this.checkUploadQuota(this.selectedFiles.length);
        let warningHtml = '';
        
        if (!quotaCheck.canUpload) {
            warningHtml = `
                <div class="alert alert-danger mt-3 mb-3">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    ${quotaCheck.message}
                </div>
            `;
            // Disable upload button
            document.getElementById('upload-btn').disabled = true;
        } else {
            // Check if approaching limit (within 10 photos)
            const quota = await this.loadUserQuota();
            if (quota && quota.photos_remaining <= 10 && quota.photos_remaining > 0) {
                warningHtml = `
                    <div class="alert alert-warning mt-3 mb-3">
                        <i class="fas fa-exclamation-circle me-2"></i>
                        Warning: Only ${quota.photos_remaining} photos remaining this month.
                    </div>
                `;
            }
            // Enable upload button
            document.getElementById('upload-btn').disabled = false;
        }

        fileListDiv.innerHTML = warningHtml + this.selectedFiles.map((file, index) => `
            <div class="file-item">
                <div class="file-info">
                    <i class="fas fa-image file-icon"></i>
                    <div class="file-details">
                        <h6>${file.name}</h6>
                        <div class="file-size">${this.formatFileSize(file.size)}</div>
                    </div>
                </div>
                <button class="remove-file" onclick="photoProcessor.removeFile(${index})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');
    }

    removeFile(index) {
        this.selectedFiles.splice(index, 1);
        this.displaySelectedFiles();
    }

    clearAllFiles() {
        this.selectedFiles = [];
        this.displaySelectedFiles();
        this.showSuccess('All files cleared');
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Helper method for authenticated API calls
    getAuthHeaders(includeContentType = true) {
        const headers = {};
        if (includeContentType) {
            headers['Content-Type'] = 'application/json';
        }
        // Get token from localStorage if this.authToken is not set
        const token = this.authToken || localStorage.getItem('auth_token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }

    // Production-grade method to download files via signed URLs
    async downloadAuthenticatedFile(url, filename) {
        try {
            // First, get the signed URL from our backend
            const response = await fetch(url, {
                method: 'GET',
                headers: this.getAuthHeaders(true),
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`Download request failed: ${response.statusText}`);
            }

            // Backend now always returns JSON with signed URL
            const downloadData = await response.json();
            
            if (!downloadData.signed_url) {
                throw new Error('No signed URL provided by server');
            }

            // Direct navigation to signed URL - bypasses CORS, goes straight to GCS
            // This is the production pattern for scalable file downloads
            window.location.assign(downloadData.signed_url);
            
            // Note: We can't catch download errors with this approach, but that's
            // the trade-off for production scalability and proper architecture
            
        } catch (error) {
            console.error('Download failed:', error);
            throw error;
        }
    }

    getImageUrl(photoId) {
        const token = this.authToken || localStorage.getItem('auth_token');
        if (token) {
            // Use /view endpoint with token in URL - this generates signed URLs for <img> tags
            return `${this.apiBase}/upload/serve/${photoId}/view?token=${encodeURIComponent(token)}`;
        }
        // Fallback to direct serve endpoint (though this won't work for <img> tags without auth)
        return `${this.apiBase}/upload/serve/${photoId}`;
    }

    // Get current user quota
    async loadUserQuota() {
        try {
            
            // Check localStorage token as well
            const storedToken = localStorage.getItem('auth_token');
            
            const headers = this.getAuthHeaders();
            
            const response = await fetch(`${this.apiBase}/users/me/quota`, {
                headers: headers,
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                this.updateQuotaDisplay(data.quota);
                return data.quota;
            } else {
                console.error('❌ Quota request failed:', response.status, response.statusText);
            }
        } catch (error) {
            console.error('Failed to load quota:', error);
        }
        return null;
    }

    // Update quota display in UI
    updateQuotaDisplay(quota) {
        const quotaStatus = document.getElementById('quota-status');
        const quotaText = document.getElementById('quota-text');
        const quotaProgress = document.getElementById('quota-progress');

        if (!quota) {
            quotaStatus.classList.add('d-none');
            return;
        }

        const remaining = quota.photos_remaining;
        const used = quota.photos_used_this_month;
        const total = quota.monthly_photo_limit;
        const percentage = (used / total) * 100;

        quotaText.textContent = `${remaining.toLocaleString()} photos remaining this month (${used.toLocaleString()}/${total.toLocaleString()})`;
        quotaProgress.style.width = `${percentage}%`;

        // Update progress bar color based on usage
        quotaProgress.className = 'progress-bar';
        if (percentage >= 90) {
            quotaProgress.classList.add('bg-danger');
            quotaStatus.className = 'alert alert-danger mb-4';
        } else if (percentage >= 75) {
            quotaProgress.classList.add('bg-warning');
            quotaStatus.className = 'alert alert-warning mb-4';
        } else {
            quotaProgress.classList.add('bg-success');
            quotaStatus.className = 'alert alert-info mb-4';
        }

        quotaStatus.classList.remove('d-none');
    }

    // Check if user can upload the specified number of photos
    async checkUploadQuota(photoCount) {
        const quota = await this.loadUserQuota();
        if (!quota) return { canUpload: true, message: '' };

        const remaining = quota.photos_remaining;
        if (photoCount > remaining) {
            return {
                canUpload: false,
                message: `Cannot upload ${photoCount} photos. Only ${remaining} photos remaining this month.`
            };
        }

        return { canUpload: true, message: '' };
    }

    // File Upload with Batch Support for Large Photo Sets
    async uploadFiles() {
        if (this.selectedFiles.length === 0) return;

        // Check quota before upload
        const quotaCheck = await this.checkUploadQuota(this.selectedFiles.length);
        if (!quotaCheck.canUpload) {
            this.showError(quotaCheck.message);
            return;
        }

        try {
            // Capture timestamp when user clicks upload button (for full experience timing)
            this.uploadStartedAt = new Date().toISOString();

            // Initialize unified progress manager
            this.unifiedProgress = new UnifiedProgressManager();
            this.showUnifiedProgress();
            
            // Disable upload button and show unified progress
            document.getElementById('upload-btn').disabled = true;
            document.getElementById('upload-btn').innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Processing...';

            // Phase 1: Compression (0-25%)
            this.unifiedProgress.setPhase('compression', 0, { totalFiles: this.selectedFiles.length });
            const compressedFiles = await this.compressFilesWithUnifiedProgress(this.selectedFiles);
            
            // Phase 2: Upload (25-50%)
            const totalBatches = Math.ceil(compressedFiles.length / 5);
            this.unifiedProgress.setPhase('upload', 0, { 
                totalFiles: compressedFiles.length, 
                totalBatches: totalBatches 
            });
            const allPhotoIds = await this.uploadInBatchesWithUnifiedProgress(compressedFiles);
            
            
            // Track successful upload
            if (window.analyticsDashboard) {
                window.analyticsDashboard.trackEngagement('success_action', 'photos_uploaded', {
                    photo_count: this.selectedFiles.length,
                    upload_size_mb: this.selectedFiles.reduce((total, file) => total + file.size, 0) / (1024 * 1024)
                });
            }
            
            // Phase 3: Processing (50-100%)
            this.unifiedProgress.setPhase('processing', 0);
            this.showProcessingWarning();
            await this.startProcessingWithUnifiedProgress(allPhotoIds);

        } catch (error) {
            console.error('🔐 Upload error:', error);
            this.hideProcessingWarning();
            this.showUploadSection();
            
            if (error.message.includes('quota') || error.message.includes('limit')) {
                this.showError(`Quota exceeded: ${error.message}`);
            } else {
                this.showError(`Upload failed: ${error.message}`);
            }
            document.getElementById('upload-btn').disabled = false;
            document.getElementById('upload-btn').innerHTML = '<i class="fas fa-upload me-2"></i>Upload Photos';
        }
    }

    showUnifiedProgress() {
        // Hide all other sections
        const sections = ['upload-section', 'results-section', 'unknown-photos-section'];
        sections.forEach(sectionId => {
            const section = document.getElementById(sectionId);
            if (section) section.classList.add('d-none');
        });
        
        // Show processing section with unified progress
        this.showProcessingSection();
    }

    async compressFilesWithUnifiedProgress(files) {
        const COMPRESS_THRESHOLD = 1 * 1024 * 1024;
        const processedFiles = [];
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            let finalFile = file;
            
            if (file.size > COMPRESS_THRESHOLD) {
                const options = {
                    maxSizeMB: 5,
                    maxWidthOrHeight: 3072,
                    useWebWorker: true,
                    fileType: file.type,
                    preserveExif: false,
                    initialQuality: 0.95
                };
                
                finalFile = await imageCompression(file, options);
                finalFile = new File([finalFile], file.name, { type: finalFile.type });
            }
            
            processedFiles.push(finalFile);
            
            // Update compression progress (0-100% within compression phase)
            const progressPercent = ((i + 1) / files.length) * 100;
            this.unifiedProgress?.updatePhaseProgress(progressPercent);
        }
        
        return processedFiles;
    }

    async uploadInBatchesWithUnifiedProgress(files) {
        const BATCH_SIZE = 5;
        const CONCURRENT_BATCHES = 3;
        const batches = [];
        const allPhotoIds = [];
        
        // Split files into batches
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            batches.push(files.slice(i, i + BATCH_SIZE));
        }
        
        
        for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
            const concurrentBatches = batches.slice(i, i + CONCURRENT_BATCHES);
            const batchNumbers = concurrentBatches.map((_, idx) => i + idx + 1);
            
            // Update progress with current batch info
            this.unifiedProgress?.setPhase('upload', 
                (i / batches.length) * 100, 
                { currentBatch: i + 1, totalBatches: batches.length }
            );
            
            const batchPromises = concurrentBatches.map((batch, idx) => 
                this.uploadBatch(batch, batchNumbers[idx], batches.length)
            );
            
            const batchResults = await Promise.all(batchPromises);
            batchResults.forEach(result => allPhotoIds.push(...result));
            
            // Update progress after completing these batches
            const completedBatches = Math.min(i + CONCURRENT_BATCHES, batches.length);
            this.unifiedProgress?.updatePhaseProgress((completedBatches / batches.length) * 100);
        }
        
        return allPhotoIds;
    }

    async startProcessingWithUnifiedProgress(allPhotoIds) {
        // Start the processing job
        const response = await fetch(`${this.apiBase}/process/start`, {
            method: 'POST',
            headers: this.getAuthHeaders(true),
            credentials: 'include',
            body: JSON.stringify({ photo_ids: allPhotoIds, upload_started_at: this.uploadStartedAt })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Failed to start processing');
        }

        const jobData = await response.json();
        this.currentJobId = jobData.job_id;
        
        // Store the job ID for potential restoration
        if (window.stateManager) {
            window.stateManager.set('processing.currentJobId', this.currentJobId);
            window.stateManager.set('processing.startTime', new Date().toISOString());
            window.stateManager.set('processing.totalPhotos', allPhotoIds.length);
        }

        // Poll processing status with unified progress
        await this.pollProcessingStatusWithUnifiedProgress();
    }

    async pollProcessingStatusWithUnifiedProgress() {
        const startTime = Date.now();
        const maxWaitTime = 600000; // 10 minutes max
        
        while (true) {
            try {
                const response = await fetch(`${this.apiBase}/process/status/${this.currentJobId}`, {
                    method: 'GET',
                    headers: this.getAuthHeaders(false),
                    credentials: 'include'
                });

                if (!response.ok) {
                    throw new Error('Failed to check processing status');
                }

                const statusData = await response.json();

                // Update unified progress in processing phase (50-100%)
                if (statusData.progress !== undefined) {
                    this.unifiedProgress?.updatePhaseProgress(statusData.progress);
                }

                if (statusData.status === 'completed') {
                    this.unifiedProgress?.complete();
                    
                    // Fetch and display results
                    if (this.isUploadMoreOperation) {
                        // Upload more: merge new results with existing
                        await this.fetchAndMergeResults();
                        this.hideProcessingWarning();
                        // Stay on results section, just refresh display
                        this.displayResults();
                        this.showSuccess('Additional photos processed and merged!');
                        this.isUploadMoreOperation = false; // Reset flag
                    } else {
                        // Normal upload: show results section
                        await this.fetchResults();
                        this.hideProcessingWarning();
                        this.showResultsSection();
                    }
                    return;
                }

                if (statusData.status === 'failed') {
                    throw new Error(statusData.error || 'Processing failed');
                }

                // Check timeout
                if (Date.now() - startTime > maxWaitTime) {
                    throw new Error('Processing timeout - please try again');
                }

                // Wait before next poll
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.error('Processing status error:', error);
                this.hideProcessingWarning();
                this.showUploadSection();
                throw error;
            }
        }
    }

    // REMOVED: uploadInBatches() method - replaced by uploadInBatchesWithUnifiedProgress()

    // NEW: Direct upload to GCS (bypasses server bottleneck)
    // NEW: Direct upload to GCS (bypasses server bottleneck)
    async uploadBatch(batchFiles, batchNum, totalBatches) {
        
        try {
            // Step 1: Get signed URLs from our API
            const fileInfos = batchFiles.map(file => ({
                filename: file.name,
                content_type: file.type,
                size: file.size
            }));

            const signedResponse = await fetch(`${this.apiBase}/direct-upload/signed-urls`, {
                method: 'POST',
                headers: this.getAuthHeaders(true),
                credentials: 'include',
                body: JSON.stringify({ files: fileInfos })
            });

            if (signedResponse.status === 402) {
                const error = await signedResponse.json();
                throw new Error(error.detail || 'Monthly photo limit exceeded');
            }

            if (!signedResponse.ok) {
                const errorData = await signedResponse.json();
                throw new Error(`Failed to get signed URLs: ${errorData.detail || signedResponse.statusText}`);
            }

            const signedData = await signedResponse.json();
            const { signed_urls } = signedData;
            

            // Step 2: Upload all files in parallel to Google Cloud Storage
            // We create an array of promises, one for each file upload
            const uploadPromises = batchFiles.map(async (file, i) => {
                const urlInfo = signed_urls[i];

                const uploadResponse = await fetch(urlInfo.signed_url, {
                    method: 'PUT',
                    body: file,
                    headers: {
                        'Content-Type': file.type
                    }
                });

                if (!uploadResponse.ok) {
                    console.error(`❌ Direct upload failed for ${file.name}:`, uploadResponse.status);
                    throw new Error(`Direct upload failed for ${file.name}: ${uploadResponse.statusText}`);
                }


                // Return the success data for this file
                return {
                    photo_id: urlInfo.photo_id,
                    original_filename: urlInfo.filename,
                    gcs_filename: urlInfo.gcs_filename,
                    file_extension: urlInfo.file_extension,
                    size: urlInfo.size
                };
            });

            // Wait for ALL uploads in this batch to complete
            const completedUploads = await Promise.all(uploadPromises);

            // Step 3: Tell our API the uploads are complete
            const completionResponse = await fetch(`${this.apiBase}/direct-upload/complete`, {
                method: 'POST',
                headers: this.getAuthHeaders(true),
                credentials: 'include',
                body: JSON.stringify({ completed_uploads: completedUploads })
            });

            if (!completionResponse.ok) {
                const errorData = await completionResponse.json();
                throw new Error(`Failed to record uploads: ${errorData.detail || completionResponse.statusText}`);
            }

            const result = await completionResponse.json();
            
            // Update quota display
            if (result.quota_info) {
                this.updateQuotaDisplay(result.quota_info);
            }
            
            
            return result.photo_ids || [];

        } catch (error) {
            console.error(`❌ Batch ${batchNum} failed:`, error);
            throw error;
        }
    }

    // REMOVED: startProcessing() method - replaced by startProcessingWithUnifiedProgress()

    // REMOVED: pollProcessingStatus() method - replaced by pollProcessingStatusWithUnifiedProgress()

    updateProgress(job) {
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');

        // Smooth progress bar transitions
        progressBar.style.transition = 'width 0.3s ease-in-out';
        progressBar.style.width = `${job.progress}%`;

        // Enhanced progress text with phases
        let statusText = '';
        if (job.progress === 0 || job.completed_photos === 0) {
            statusText = 'Initializing photo processing...';
        } else if (job.progress < 100 && job.status === 'processing') {
            const currentPhoto = Math.min(job.completed_photos + 1, job.total_photos);
            statusText = `Processing photo ${currentPhoto} of ${job.total_photos} (${job.progress}%)`;
        } else if (job.progress >= 95 && job.status === 'processing') {
            statusText = 'Finalizing results and organizing photos...';
        } else {
            statusText = `Processing... ${job.completed_photos}/${job.total_photos} photos (${job.progress}%)`;
        }

        progressText.textContent = statusText;
    }

    async fetchResults(retryCount = 0) {
        try {
            const response = await fetch(`${this.apiBase}/process/results/${this.currentJobId}`, {
                headers: this.getAuthHeaders(true),
                credentials: 'include'
            });
            if (!response.ok) {
                // Handle 404 job not found
                if (response.status === 404) {
                    console.warn(`Job ${this.currentJobId} not found when fetching results (404). Server may have restarted.`);
                    this.showError('Processing job was lost due to server restart. Please upload your photos again.');
                    this.resetApp();
                    return;
                }
                
                // If results aren't ready yet and we haven't retried too many times, try again
                if (response.status === 400 && retryCount < 3) {
                    // Update progress text to show retry
                    const progressText = document.getElementById('progress-text');
                    if (progressText) {
                        progressText.textContent = `Finalizing results... (attempt ${retryCount + 1})`;
                    }
                    setTimeout(() => this.fetchResults(retryCount + 1), 1000);
                    return;
                }
                throw new Error(`Results fetch failed: ${response.statusText}`);
            }

            const groupedPhotosObj = await response.json();
            
            // Convert Object format to Array format for compatibility with existing code
            this.groupedPhotos = this.convertGroupedPhotosObjectToArray(groupedPhotosObj);
            
            // Track successful processing completion
            if (window.analyticsDashboard) {
                const totalPhotos = Object.values(groupedPhotosObj).reduce((sum, group) => sum + group.length, 0);
                const detectedPhotos = Object.keys(groupedPhotosObj).filter(key => key !== 'unknown').length > 0 
                    ? Object.keys(groupedPhotosObj).filter(key => key !== 'unknown').reduce((sum, key) => sum + groupedPhotosObj[key].length, 0) 
                    : 0;
                const unknownPhotos = groupedPhotosObj.unknown ? groupedPhotosObj.unknown.length : 0;
                
                window.analyticsDashboard.trackEngagement('success_action', 'processing_completed', {
                    total_photos: totalPhotos,
                    detected_photos: detectedPhotos,
                    unknown_photos: unknownPhotos,
                    detection_accuracy: totalPhotos > 0 ? (detectedPhotos / totalPhotos * 100).toFixed(1) : 0,
                    job_id: this.currentJobId
                });
            }
            
            // Save job completion state to localStorage for persistence
            if (window.stateManager && this.currentJobId) {
                window.stateManager.markJobCompleted(this.currentJobId, 'completed');
            }
            
            // Hide processing warning since job is now completed
            this.hideProcessingWarning();
            
            this.showResultsSection();

        } catch (error) {
            console.error('Results fetch error:', error);

            // If this is the first attempt, try once more after a delay
            if (retryCount === 0) {
                // Update progress text to show retry
                const progressText = document.getElementById('progress-text');
                if (progressText) {
                    progressText.textContent = 'Retrying to fetch results...';
                }
                setTimeout(() => this.fetchResults(1), 2000);
            } else {
                this.hideProcessingWarning(); // Hide warning if error occurs
                this.showError('Failed to fetch results. Please try again.');
            }
        }
    }

    async fetchAndMergeResults(retryCount = 0) {
        try {
            const response = await fetch(`${this.apiBase}/process/results/${this.currentJobId}`, {
                headers: this.getAuthHeaders(true),
                credentials: 'include'
            });
            if (!response.ok) {
                // Handle 404 job not found
                if (response.status === 404) {
                    console.warn(`Job ${this.currentJobId} not found when fetching results (404). Server may have restarted.`);
                    this.showError('Processing job was lost due to server restart. Please upload your photos again.');
                    return;
                }
                
                // If results aren't ready yet and we haven't retried too many times, try again
                if (response.status === 400 && retryCount < 3) {
                    setTimeout(() => this.fetchAndMergeResults(retryCount + 1), 1000);
                    return;
                }
                throw new Error(`Results fetch failed: ${response.statusText}`);
            }

            const newGroupedPhotosObj = await response.json();
            
            // Convert Object format to Array format for compatibility with existing code
            const newGroupedPhotos = this.convertGroupedPhotosObjectToArray(newGroupedPhotosObj);
            
            // Merge with existing results using existing method
            this.mergeGroupedPhotos(newGroupedPhotos);
            
            // Save job completion state to localStorage for persistence
            if (window.stateManager && this.currentJobId) {
                window.stateManager.markJobCompleted(this.currentJobId, 'completed');
            }

        } catch (error) {
            console.error('Results fetch and merge error:', error);

            // If this is the first attempt, try once more after a delay
            if (retryCount === 0) {
                setTimeout(() => this.fetchAndMergeResults(1), 2000);
            } else {
                this.showError('Failed to fetch additional results. Please try again.');
            }
        }
    }

    // UI Section Management
    showProcessingSection() {
        document.getElementById('upload-section').classList.add('d-none');
        document.getElementById('processing-section').classList.remove('d-none');
        document.getElementById('results-section').classList.add('d-none');
        // Update URL without triggering route change if we're not already on processing route
        AppRouter.safeReplaceState('processing');
    }

    /**
     * Convert grouped photos from Object format to Array format
     * Backend returns: {bib_123: [...], unknown: [...]}
     * Frontend expects: [{bib_number: "123", photos: [...], count: N}, ...]
     */
    convertGroupedPhotosObjectToArray(groupedPhotosObj) {
        return Object.entries(groupedPhotosObj).map(([bibNumber, photos]) => ({
            bib_number: bibNumber,
            photos: photos,
            count: photos.length
        }));
    }

    showResultsSection() {
        document.getElementById('upload-section').classList.add('d-none');
        document.getElementById('processing-section').classList.add('d-none');
        document.getElementById('results-section').classList.remove('d-none');

        this.displayResults();
        // Update URL without triggering route change if we're not already on results route
        AppRouter.safeReplaceState('results');
    }

    showUploadSection() {
        document.getElementById('upload-section').classList.remove('d-none');
        document.getElementById('processing-section').classList.add('d-none');
        document.getElementById('results-section').classList.add('d-none');
        // Update URL without triggering route change if we're not already on upload route
        AppRouter.safeReplaceState('upload');
    }

    // Results Display - Simplified
    displayResults() {
        this.updateStatsCards();
        this.displayPhotoGroups();
        // No complex export controls needed - just simple download all button
    }

    updateStatsCards() {
        // groupedPhotos is now an Array: [{bib_number: "123", photos: [...], count: N}, ...]
        const totalPhotos = this.groupedPhotos.reduce((sum, group) => sum + group.count, 0);
        const detectedPhotos = this.groupedPhotos
            .filter(group => group.bib_number !== 'unknown')
            .reduce((sum, group) => sum + group.count, 0);
        const unknownPhotos = this.groupedPhotos.find(group => group.bib_number === 'unknown')?.count || 0;

        document.getElementById('total-photos').textContent = totalPhotos;
        document.getElementById('detected-photos').textContent = detectedPhotos;
        document.getElementById('unknown-photos').textContent = unknownPhotos;
    }

    displayPhotoGroups() {
        // Initialize filters and show all groups
        this.applyFilters();
    }


    getConfidenceClass(confidence) {
        if (confidence >= 0.8) return 'confidence-high';
        if (confidence >= 0.6) return 'confidence-medium';
        return 'confidence-low';
    }



    async downloadAllPhotos() {
        // Track download initiation
        if (window.analyticsDashboard) {
            window.analyticsDashboard.trackEngagement('success_action', 'download_initiated', {
                download_type: 'all_photos'
            });
        }
        
        // Get all photos from all groups
        const allPhotos = this.groupedPhotos.flatMap(group => group.photos);
        const photoIds = allPhotos.map(photo => photo.id);

        if (photoIds.length === 0) {
            this.showError('No photos to download.');
            return;
        }

        try {
            const downloadBtn = document.getElementById('download-all-btn');
            
            // Start progress animation
            this.startButtonProgress(downloadBtn, 'Creating ZIP...');

            const exportData = {
                photo_ids: photoIds,
                format: 'zip'
            };

            const response = await fetch(`${this.apiBase}/download/export`, {
                method: 'POST',
                headers: this.getAuthHeaders(true),
                credentials: 'include',
                body: JSON.stringify(exportData)
            });

            if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);
            const result = await response.json();

            // Update to completion state and download
            setTimeout(async () => {
                this.completeButtonProgress(downloadBtn, 'Download Ready');

                // Download the file with authentication
                const downloadUrl = `${this.apiBase}/download/file/${result.export_id}`;
                await this.downloadAuthenticatedFile(downloadUrl, `tag_photos_${result.export_id}.zip`);

                // Track successful download completion
                if (window.analyticsDashboard) {
                    window.analyticsDashboard.trackEngagement('success_action', 'download_completed', {
                        download_type: 'all_photos',
                        photo_count: photoIds.length,
                        export_id: result.export_id
                    });
                }

                this.showSuccess(`Successfully downloaded ${photoIds.length} photos organized by bib number!`);

                // Reset button after a delay
                setTimeout(() => {
                    this.resetButtonProgress(downloadBtn, '<i class="fas fa-download me-2"></i>Download All Photos as ZIP');
                }, 2000);

            }, 1000);
        } catch (error) {
            console.error('Download error:', error);
            this.showError('Download failed. Please try again.');
            const downloadBtn = document.getElementById('download-all-btn');
            this.resetButtonProgress(downloadBtn, '<i class="fas fa-download me-2"></i>Download All Photos as ZIP');
        }
    }

    // Integrated Button Progress Methods
    startButtonProgress(button, message) {
        if (!button) return;
        
        button.disabled = true;
        button.classList.add('btn-progress', 'loading');
        
        const content = button.querySelector('.btn-content') || button;
        content.innerHTML = `<i class="fas fa-spinner fa-spin me-2"></i>${message}`;
        
        // Start the progress fill animation
        setTimeout(() => {
            if (button.style) {
                button.style.setProperty('--progress-width', '0%');
                button.style.setProperty('--progress-width', '75%');
            }
        }, 100);
    }
    
    updateButtonProgress(button, percent, message) {
        if (!button) return;
        
        const content = button.querySelector('.btn-content') || button;
        if (message) {
            content.innerHTML = `<i class="fas fa-spinner fa-spin me-2"></i>${message}`;
        }
        
        // Update the progress fill
        const beforeElement = button.querySelector('::before');
        if (beforeElement) {
            beforeElement.style.width = `${percent}%`;
        }
    }
    
    completeButtonProgress(button, message) {
        if (!button) return;
        
        button.classList.remove('loading');
        button.classList.add('complete');
        
        const content = button.querySelector('.btn-content') || button;
        content.innerHTML = `<i class="fas fa-check me-2"></i>${message}`;
    }
    
    resetButtonProgress(button, originalContent) {
        if (!button) return;
        
        button.disabled = false;
        button.classList.remove('btn-progress', 'loading', 'complete');
        
        const content = button.querySelector('.btn-content') || button;
        content.innerHTML = originalContent;
        
        // Reset any inline styles
        if (button.style) {
            button.style.removeProperty('--progress-width');
        }
    }

    // Utility Functions
    resetApp() {
        this.selectedFiles = [];
        this.currentJobId = null;
        this.groupedPhotos = [];

        // Clear both completed and current job state from localStorage
        if (window.stateManager) {
            window.stateManager.clearCompletedJob();
            window.stateManager.set('processing.currentJobId', null);
            window.stateManager.set('processing.currentJobStatus', null);
        }
        
        // Hide any processing warnings
        this.hideProcessingWarning();

        document.getElementById('file-input').value = '';
        document.getElementById('upload-btn').disabled = false;
        document.getElementById('upload-btn').innerHTML = '<i class="fas fa-upload me-2"></i>Upload Photos';

        this.showUploadSection();
    }


    showError(message) {
        // You can enhance this with a proper modal or toast notification
        alert(message);
    }

    showSuccess(message) {
        // Create a temporary success message
        const successDiv = document.createElement('div');
        successDiv.className = 'alert alert-success alert-dismissible fade show position-fixed';
        successDiv.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
        successDiv.innerHTML = `
            <i class="fas fa-check-circle me-2"></i>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;

        document.body.appendChild(successDiv);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            if (successDiv.parentNode) {
                successDiv.remove();
            }
        }, 3000);
    }

    // Modal Event Listeners
    initializeModalEventListeners() {
        const modalUploadArea = document.getElementById('modal-upload-area');
        const modalFileInput = document.getElementById('modal-file-input');
        const modalFolderInput = document.getElementById('modal-folder-input');
        const modalChooseFilesBtn = document.getElementById('modal-choose-files-btn');
        const modalChooseFolderBtn = document.getElementById('modal-choose-folder-btn');
        const modalClearBtn = document.getElementById('modal-clear-files-btn');
        const modalUploadBtn = document.getElementById('modal-upload-btn');

        // Modal drag and drop
        modalUploadArea.addEventListener('click', (e) => {
            if (!e.target.closest('button')) {
                modalFileInput.click();
            }
        });
        modalUploadArea.addEventListener('dragover', this.handleModalDragOver.bind(this));
        modalUploadArea.addEventListener('dragleave', this.handleModalDragLeave.bind(this));
        modalUploadArea.addEventListener('drop', this.handleModalDrop.bind(this));

        // Modal button events
        modalChooseFilesBtn.addEventListener('click', () => modalFileInput.click());
        modalChooseFolderBtn.addEventListener('click', () => modalFolderInput.click());
        modalClearBtn.addEventListener('click', this.clearModalFiles.bind(this));
        modalUploadBtn.addEventListener('click', this.uploadMoreFiles.bind(this));

        // Modal file input events
        modalFileInput.addEventListener('change', (e) => this.handleModalFileSelect(e.target.files, false));
        modalFolderInput.addEventListener('change', (e) => this.handleModalFileSelect(e.target.files, true));
    }

    // Modal Upload More Functions
    showUploadMoreModal() {
        this.modalSelectedFiles = [];
        this.displayModalSelectedFiles();
        const modal = new bootstrap.Modal(document.getElementById('uploadMoreModal'));
        modal.show();
    }

    handleModalDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('modal-upload-area').classList.add('dragover');
    }

    handleModalDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('modal-upload-area').classList.remove('dragover');
    }

    handleModalDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('modal-upload-area').classList.remove('dragover');

        const files = Array.from(e.dataTransfer.files).filter(file => 
            file.type.startsWith('image/')
        );

        this.handleModalFileSelect(files);
    }

    handleModalFileSelect(files, isFolder = false) {
        const imageFiles = Array.from(files).filter(file => 
            file.type.startsWith('image/')
        );

        this.modalSelectedFiles = [...this.modalSelectedFiles, ...imageFiles];

        // Remove duplicates
        this.modalSelectedFiles = this.modalSelectedFiles.filter((file, index, self) =>
            index === self.findIndex(f => f.name === file.name && f.size === file.size)
        );

        this.displayModalSelectedFiles();

        if (imageFiles.length > 0) {
            this.showSuccess(`Added ${imageFiles.length} additional photos`);
        }
    }

    async displayModalSelectedFiles() {
        const selectedFilesDiv = document.getElementById('modal-selected-files');
        const fileListDiv = document.getElementById('modal-file-list');
        const fileCountSpan = document.getElementById('modal-file-count');
        const uploadBtn = document.getElementById('modal-upload-btn');

        if (this.modalSelectedFiles.length === 0) {
            selectedFilesDiv.classList.add('d-none');
            uploadBtn.disabled = true;
            return;
        }

        selectedFilesDiv.classList.remove('d-none');
        fileCountSpan.textContent = this.modalSelectedFiles.length;

        // Check quota for modal files
        const quotaCheck = await this.checkUploadQuota(this.modalSelectedFiles.length);
        let warningHtml = '';
        
        if (!quotaCheck.canUpload) {
            warningHtml = `
                <div class="alert alert-danger mt-3 mb-3">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    ${quotaCheck.message}
                </div>
            `;
            uploadBtn.disabled = true;
        } else {
            // Check if approaching limit
            const quota = await this.loadUserQuota();
            if (quota && quota.photos_remaining <= 10 && quota.photos_remaining > 0) {
                warningHtml = `
                    <div class="alert alert-warning mt-3 mb-3">
                        <i class="fas fa-exclamation-circle me-2"></i>
                        Warning: Only ${quota.photos_remaining} photos remaining this month.
                    </div>
                `;
            }
            uploadBtn.disabled = false;
        }

        fileListDiv.innerHTML = warningHtml + this.modalSelectedFiles.map((file, index) => `
            <div class="file-item">
                <div class="file-info">
                    <i class="fas fa-image file-icon"></i>
                    <div class="file-details">
                        <h6>${file.name}</h6>
                        <div class="file-size">${this.formatFileSize(file.size)}</div>
                    </div>
                </div>
                <button class="remove-file" onclick="photoProcessor.removeModalFile(${index})">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');
    }

    removeModalFile(index) {
        this.modalSelectedFiles.splice(index, 1);
        this.displayModalSelectedFiles();
    }

    clearModalFiles() {
        this.modalSelectedFiles = [];
        this.displayModalSelectedFiles();
    }

    async uploadMoreFiles() {
        if (this.modalSelectedFiles.length === 0) return;

        // Check quota before upload
        const quotaCheck = await this.checkUploadQuota(this.modalSelectedFiles.length);
        if (!quotaCheck.canUpload) {
            this.showError(quotaCheck.message);
            return;
        }

        try {
            const modalUploadBtn = document.getElementById('modal-upload-btn');
            modalUploadBtn.disabled = true;
            modalUploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Processing...';

            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('uploadMoreModal'));
            modal.hide();

            // Capture timestamp when user clicks upload button (for full experience timing)
            this.uploadStartedAt = new Date().toISOString();

            // Use existing unified progress flow
            this.selectedFiles = this.modalSelectedFiles;
            this.unifiedProgress = new UnifiedProgressManager();
            this.showUnifiedProgress();
            
            // Disable upload button and show unified progress
            document.getElementById('upload-btn').disabled = true;
            document.getElementById('upload-btn').innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Processing...';
            
            // Mark as upload more operation for result handling
            this.isUploadMoreOperation = true;
            
            // Phase 1: Compression (0-25%)
            this.unifiedProgress.setPhase('compression', 0, { totalFiles: this.selectedFiles.length });
            const compressedFiles = await this.compressFilesWithUnifiedProgress(this.selectedFiles);
            
            // Phase 2: Upload (25-50%)
            const BATCH_SIZE = 5;
            const totalBatches = Math.ceil(compressedFiles.length / BATCH_SIZE);
            this.unifiedProgress.setPhase('upload', 0, { totalBatches: totalBatches });
            const allPhotoIds = await this.uploadInBatchesWithUnifiedProgress(compressedFiles);
            
            // Phase 3: Processing (50-100%)
            this.unifiedProgress.setPhase('processing', 0);
            this.showProcessingWarning();
            await this.startProcessingWithUnifiedProgress(allPhotoIds);

        } catch (error) {
            console.error('Upload more error:', error);
            if (error.message.includes('quota') || error.message.includes('limit')) {
                this.showError(`Quota exceeded: ${error.message}`);
            } else {
                this.showError('Failed to upload additional photos. Please try again.');
            }
            document.getElementById('upload-btn').disabled = false;
            document.getElementById('upload-btn').innerHTML = '<i class="fas fa-upload me-2"></i>Upload Photos';
        }
    }


    mergeGroupedPhotos(newGroupedPhotos) {
        // Merge new grouped photos with existing ones
        newGroupedPhotos.forEach(newGroup => {
            const existingGroupIndex = this.groupedPhotos.findIndex(
                group => group.bib_number === newGroup.bib_number
            );

            if (existingGroupIndex >= 0) {
                // Add photos to existing group
                this.groupedPhotos[existingGroupIndex].photos.push(...newGroup.photos);
                this.groupedPhotos[existingGroupIndex].count += newGroup.count;
            } else {
                // Add new group
                this.groupedPhotos.push(newGroup);
            }
        });
    }

    // Enhanced Photo Modal Functions
    showPhotoModal(photoId, filename, groupBibNumber = null) {
        // Track photo modal open
        if (window.analyticsDashboard) {
            window.analyticsDashboard.trackEngagement('click', 'photo_modal_open', {
                photo_id: photoId,
                group_bib: groupBibNumber,
                source: groupBibNumber === 'unknown' ? 'unknown_photos' : 'detected_photos'
            });
        }
        
        // Sort groups by bib number before creating flat list for logical navigation
        const sortedGroups = [...this.groupedPhotos].sort((a, b) => {
            // Put 'unknown' group at the end
            if (a.bib_number === 'unknown') return 1;
            if (b.bib_number === 'unknown') return -1;
            
            // Sort numeric bib numbers
            return parseInt(a.bib_number) - parseInt(b.bib_number);
        });

        // Create a flat list of all photos from sorted groups for navigation
        this.allPhotosFlat = [];
        sortedGroups.forEach(group => {
            group.photos.forEach(photo => {
                this.allPhotosFlat.push({
                    ...photo,
                    groupBibNumber: group.bib_number,
                    groupCount: group.count
                });
            });
        });
        

        // Find the current photo index in the flat list
        this.currentPhotoIndex = this.allPhotosFlat.findIndex(photo => photo.id === photoId);
        
        if (this.currentPhotoIndex === -1) {
            console.error('Photo not found in flat list:', photoId);
            return;
        }

        
        this.initializeLightbox();
        this.showPhotoInLightbox(this.currentPhotoIndex);

        const modal = new bootstrap.Modal(document.getElementById('photoModal'), {
            focus: false  // Disable Bootstrap focus management
        });
        modal.show();


        // Initialize keyboard navigation
        this.initializeLightboxKeyboard();
    }



    setupModalEventListeners() {
        const modalElement = document.getElementById('photoModal');
        
        // Remove any stray photoMetadata elements inside the modal
        this.cleanupModalPhotoMetadata();
        
        // Remove existing listeners to prevent duplicates
        modalElement.removeEventListener('shown.bs.modal', this.handleModalShown);
        modalElement.removeEventListener('hidden.bs.modal', this.handleModalHidden);
        
        // Bind the context for the event handlers
        this.handleModalShown = this.handleModalShown.bind(this);
        this.handleModalHidden = this.handleModalHidden.bind(this);
        
        // Add event listeners
        modalElement.addEventListener('shown.bs.modal', this.handleModalShown);
        modalElement.addEventListener('hidden.bs.modal', this.handleModalHidden);
    }

    cleanupModalPhotoMetadata() {
        // Remove any photoMetadata elements that might exist inside the modal
        const modalElement = document.getElementById('photoModal');
        if (modalElement) {
            const strayElements = modalElement.querySelectorAll('[id*="photoMetadata"], .photoMetadata');
            strayElements.forEach(element => {
                element.remove();
            });
        }
    }

    handleModalShown() {
        // Modal is now shown - sidebar is already visible
    }

    handleModalHidden() {
        // Modal is now hidden - sidebar is hidden with modal
    }

    initializeLightbox() {
        const modal = document.getElementById('photoModal');

        // Add Bootstrap modal event listeners for fixed metadata panel
        this.setupModalEventListeners();

        // Navigation via keyboard only

        // Zoom controls
        document.getElementById('zoomInBtn').onclick = () => this.zoomIn();
        document.getElementById('zoomOutBtn').onclick = () => this.zoomOut();
        document.getElementById('zoomResetBtn').onclick = () => this.resetZoom();

        // Fullscreen toggle
        document.getElementById('fullscreenBtn').onclick = () => this.toggleFullscreen();




        // Initialize zoom functionality
        this.initializeZoom();

        // Reset zoom
        this.zoomLevel = 1;
        this.panX = 0;
        this.panY = 0;
    }

    showPhotoInLightbox(index) {
        if (!this.allPhotosFlat || index < 0 || index >= this.allPhotosFlat.length) {
            return;
        }

        this.currentPhotoIndex = index;
        const photo = this.allPhotosFlat[index];

        // Show loading spinner
        document.getElementById('photoLoader').style.display = 'block';

        // Update image
        const modalImage = document.getElementById('modalPhotoImage');
        modalImage.onload = () => {
            document.getElementById('photoLoader').style.display = 'none';
        };
        modalImage.src = this.getImageUrl(photo.id);
        modalImage.alt = photo.filename;

        // Update header metadata
        document.getElementById('photoModalLabel').textContent = `${photo.groupBibNumber === 'unknown' ? 'Photo' : `Bib #${photo.groupBibNumber}`}`;
        document.getElementById('photoPosition').textContent = `${index + 1} of ${this.allPhotosFlat.length}`;
        
        // Update category badge
        const categoryBadge = document.getElementById('photoCategory');
        const confidenceBadge = document.getElementById('photoConfidence');
        const isUnknown = photo.groupBibNumber === 'unknown' || 
                         !photo.detection_result || 
                         photo.detection_result.bib_number === 'unknown';
        if (isUnknown) {
            // Hide badges for unknown photos to avoid "Unknown N/A" clutter
            if (categoryBadge) categoryBadge.style.display = 'none';
            if (confidenceBadge) confidenceBadge.style.display = 'none';
        } else {
            if (categoryBadge) {
                categoryBadge.style.display = '';
                categoryBadge.textContent = 'Detected';
                categoryBadge.className = 'badge bg-info';
            }
            if (confidenceBadge) confidenceBadge.style.display = '';
        }

        // Update confidence
        if (photo.detection_result) {
            const confidence = Math.round((photo.detection_result.confidence / 1.5) * 100);
            document.getElementById('photoConfidence').textContent = `${confidence}%`;

            // Update confidence badge color
            const badge = document.getElementById('photoConfidence');
            badge.className = 'badge ' + this.getConfidenceBadgeClass(photo.detection_result.confidence);
        } else {
            document.getElementById('photoConfidence').textContent = 'N/A';
            document.getElementById('photoConfidence').className = 'badge bg-secondary';
        }

        // Update sidebar elements
        this.updatePhotoSidebar(photo, index);

        // Reset zoom
        this.resetZoom();
    }

    updatePhotoSidebar(photo, index) {
        // Update sidebar header
        const sidebarTitle = document.getElementById('sidebarPhotoTitle');
        
        if (sidebarTitle) {
            sidebarTitle.textContent = photo.groupBibNumber === 'unknown' ? 'Label Photo' : `Bib #${photo.groupBibNumber}`;
        }

        // Update bib input and metadata
        const bibInput = document.getElementById('inlineBibInput');
        const confidenceItem = document.getElementById('confidenceItem');
        const sidebarConfidence = document.getElementById('sidebarPhotoConfidence');

        const isUnknown = photo.groupBibNumber === 'unknown';

        if (!isUnknown && photo.groupBibNumber) {
            // Pre-fill with detected bib number from groupBibNumber
            if (bibInput) {
                bibInput.value = photo.groupBibNumber;
                bibInput.classList.add('has-ai-value');
            }
            if (confidenceItem && sidebarConfidence && photo.detection_result) {
                const confidence = Math.round((photo.detection_result.confidence / 1.5) * 100);
                sidebarConfidence.textContent = `${confidence}%`;
                confidenceItem.style.display = '';
            }
        } else {
            // Clear input for unknown photos
            if (bibInput) {
                bibInput.value = '';
                bibInput.classList.remove('has-ai-value');
            }
            if (confidenceItem) {
                confidenceItem.style.display = 'none';
            }
        }


        // Auto-focus and select text in input field
        this.focusAndSelectBibInput();

        // Set up inline labeling event listeners
        this.setupInlineLabelingListeners(photo);
    }

    setupInlineLabelingListeners(photo) {
        const bibInput = document.getElementById('inlineBibInput');
        const confirmBtn = document.getElementById('confirmBibBtn');
        const noBibBtn = document.getElementById('noBibBtn');

        // Remove existing listeners
        const newBibInput = bibInput.cloneNode(true);
        const newConfirmBtn = confirmBtn.cloneNode(true);
        const newNoBibBtn = noBibBtn.cloneNode(true);
        
        bibInput.parentNode.replaceChild(newBibInput, bibInput);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        noBibBtn.parentNode.replaceChild(newNoBibBtn, noBibBtn);

        // Add new listeners
        newBibInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.saveInlineLabel(photo);
            }
        });

        newBibInput.addEventListener('input', (e) => {
            this.validateBibInput(e.target);
        });

        newConfirmBtn.addEventListener('click', () => {
            this.saveInlineLabel(photo);
        });

        newNoBibBtn.addEventListener('click', () => {
            this.saveInlineLabel(photo, 'unknown');
        });

        // Global keyboard shortcuts
        document.addEventListener('keydown', this.handleGlobalKeyShortcuts.bind(this));
    }

    handleGlobalKeyShortcuts(e) {
        // Only handle shortcuts when photo modal is open
        const modal = document.getElementById('photoModal');
        if (!modal.classList.contains('show')) return;

        if (e.key === 'x' || e.key === 'X') {
            e.preventDefault();
            const photo = this.allPhotosFlat[this.currentPhotoIndex];
            this.saveInlineLabel(photo, 'unknown');
        }
    }

    validateBibInput(input) {
        const value = input.value.trim();
        
        // Remove validation classes
        input.classList.remove('is-valid', 'is-invalid');
        
        if (!value) {
            return;
        }

        if (this.validateBibNumber(value)) {
            input.classList.add('is-valid');
        } else {
            input.classList.add('is-invalid');
        }
    }

    async saveInlineLabel(photo, bibNumber = null) {
        if (!bibNumber) {
            const bibInput = document.getElementById('inlineBibInput');
            bibNumber = bibInput.value.trim();
        }

        if (!bibNumber || !this.validateBibNumber(bibNumber)) {
            this.showError('Please enter a valid bib number (1-6 digits, 1-99999) or click "No Bib Visible"');
            return;
        }

        try {
            // Show loading state
            const confirmBtn = document.getElementById('confirmBibBtn');
            confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Saving...';
            confirmBtn.disabled = true;

            await this.labelPhoto(photo.id, bibNumber);

            this.showSuccess(`Photo labeled as ${bibNumber === 'unknown' ? 'No Bib Visible' : `Bib #${bibNumber}`}`);

            // Refresh displays
            await this.refreshAfterLabeling();

            // Advance to next photo if this was an unknown photo
            if (photo.groupBibNumber === 'unknown' || 
                !photo.detection_result || 
                photo.detection_result.bib_number === 'unknown') {
                
                this.advanceToNextUnknownPhoto();
            }

        } catch (error) {
            this.showError(`Failed to label photo: ${error.message}`);
        } finally {
            // Reset button state
            const confirmBtn = document.getElementById('confirmBibBtn');
            if (confirmBtn) {
                confirmBtn.innerHTML = '<i class="fas fa-check me-2"></i>Save Bib Number';
                confirmBtn.disabled = false;
            }
        }
    }

    // Helper method to focus and select text in bib input
    focusAndSelectBibInput() {
        const bibInput = document.getElementById('inlineBibInput');
        if (!bibInput) return;

        // Use multiple attempts with increasing delays for better reliability
        const attemptSelection = (attempt = 0) => {
            if (attempt > 3) return; // Give up after 3 attempts

            setTimeout(() => {
                try {
                    bibInput.focus();
                    
                    // Use multiple selection methods for maximum browser compatibility
                    if (bibInput.value.length > 0) {
                        bibInput.select();
                        
                        // Fallback for browsers that don't support select()
                        if (bibInput.setSelectionRange) {
                            bibInput.setSelectionRange(0, bibInput.value.length);
                        }
                        
                        // Additional fallback
                        if (bibInput.selectionStart !== 0 || bibInput.selectionEnd !== bibInput.value.length) {
                            // If selection didn't work, try again
                            attemptSelection(attempt + 1);
                        }
                    }
                } catch (e) {
                    console.log('Selection attempt failed:', e);
                    if (attempt < 3) {
                        attemptSelection(attempt + 1);
                    }
                }
            }, 50 + (attempt * 100)); // Increasing delay: 50ms, 150ms, 250ms, 350ms
        };

        attemptSelection();
    }

    // Helper Methods (keeping existing ones)
    validateBibNumber(bibNumber) {
        // Allow "unknown" as a special case for "no bib visible"
        if (bibNumber.toLowerCase() === 'unknown') {
            return true;
        }
        // Standard numeric validation
        const num = parseInt(bibNumber);
        return /^\d{1,6}$/.test(bibNumber) && num >= 1 && num <= 99999;
    }


    advanceToNextUnknownPhoto() {
        if (!this.allPhotosFlat) return;

        // Find next unknown photo in the flat list starting from current position
        for (let i = this.currentPhotoIndex + 1; i < this.allPhotosFlat.length; i++) {
            const photo = this.allPhotosFlat[i];
            if (photo.groupBibNumber === 'unknown' || !photo.detection_result || photo.detection_result.bib_number === 'unknown') {
                this.showPhotoInLightbox(i);
                return;
            }
        }

        // If no more unknown photos found, show success message
        this.showSuccess('All photos have been labeled! 🎉');

        // Close modal after a brief delay
        setTimeout(() => {
            const modal = bootstrap.Modal.getInstance(document.getElementById('photoModal'));
            if (modal) modal.hide();
        }, 1500);
    }


    previousPhoto() {
        if (this.currentPhotoIndex > 0) {
            this.showPhotoInLightbox(this.currentPhotoIndex - 1);
            // Ensure text is selected after navigation
            setTimeout(() => this.focusAndSelectBibInput(), 200);
        } else {
        }
    }

    nextPhoto() {
        if (this.currentPhotoIndex < this.allPhotosFlat.length - 1) {
            this.showPhotoInLightbox(this.currentPhotoIndex + 1);
            // Ensure text is selected after navigation
            setTimeout(() => this.focusAndSelectBibInput(), 200);
        } else {
        }
    }

    initializeZoom() {
        const modalImage = document.getElementById('modalPhotoImage');
        const photoContainer = document.getElementById('photoContainer');

        // Mouse wheel zoom
        photoContainer.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            this.adjustZoom(delta);
        }, { passive: false });

        // Touch zoom (pinch)
        let initialDistance = 0;
        let initialZoom = 1;

        photoContainer.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                initialDistance = this.getTouchDistance(e.touches);
                initialZoom = this.zoomLevel;
            }
        }, { passive: false });

        photoContainer.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const currentDistance = this.getTouchDistance(e.touches);
                const scale = currentDistance / initialDistance;
                this.zoomLevel = Math.max(0.5, Math.min(5, initialZoom * scale));
                this.applyZoom();
            }
        }, { passive: false });

        // Drag to pan when zoomed
        let isDragging = false;
        let lastX = 0;
        let lastY = 0;

        modalImage.addEventListener('mousedown', (e) => {
            if (this.zoomLevel > 1) {
                e.preventDefault();
                isDragging = true;
                lastX = e.clientX;
                lastY = e.clientY;
                modalImage.classList.add('dragging');
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                e.preventDefault();
                const deltaX = e.clientX - lastX;
                const deltaY = e.clientY - lastY;
                this.panX += deltaX;
                this.panY += deltaY;
                this.applyZoom();
                lastX = e.clientX;
                lastY = e.clientY;
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                modalImage.classList.remove('dragging');
            }
        });
    }

    getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    adjustZoom(delta) {
        this.zoomLevel = Math.max(0.5, Math.min(5, this.zoomLevel + delta));
        this.applyZoom();
    }

    zoomIn() {
        this.adjustZoom(0.2);
    }

    zoomOut() {
        this.adjustZoom(-0.2);
    }

    resetZoom() {
        this.zoomLevel = 1;
        this.panX = 0;
        this.panY = 0;
        this.applyZoom();
    }

    applyZoom() {
        const modalImage = document.getElementById('modalPhotoImage');
        modalImage.style.transform = `scale(${this.zoomLevel}) translate(${this.panX / this.zoomLevel}px, ${this.panY / this.zoomLevel}px)`;

        if (this.zoomLevel > 1) {
            modalImage.classList.add('zoomed');
        } else {
            modalImage.classList.remove('zoomed');
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.getElementById('photoModal').requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    downloadCurrentPhoto() {
        if (this.currentLightboxGroup && this.currentPhotoIndex >= 0) {
            const photo = this.currentLightboxGroup.photos[this.currentPhotoIndex];
            window.open(photo.image_url, '_blank');
        }
    }

    initializeLightboxKeyboard() {
        // Remove any existing listener to prevent duplicates
        if (this.lightboxKeyboardHandler) {
            document.removeEventListener('keydown', this.lightboxKeyboardHandler);
        }
        
        // Bind and store the handler for future removal
        this.lightboxKeyboardHandler = this.handleLightboxKeyboard.bind(this);
        document.addEventListener('keydown', this.lightboxKeyboardHandler);
    }

    handleLightboxKeyboard(e) {
        const modal = document.getElementById('photoModal');
        if (!modal.classList.contains('show')) return;

        // Check if we're in an input field
        const isInputFocused = document.activeElement && 
            (document.activeElement.tagName === 'INPUT' || 
             document.activeElement.tagName === 'TEXTAREA');

        // For input fields: allow arrow keys for navigation, but block other keys that interfere with typing
        if (isInputFocused) {
            // Allow arrow keys for photo navigation even in input fields
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                // Continue to handle arrow keys below
            } else if (e.key === 'Enter' || e.key === 'Escape') {
                // Allow Enter and Escape to be handled by input event listeners
                return;
            } else {
                // Block all other keys to prevent interference with typing
                return;
            }
        }

        switch(e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                this.previousPhoto();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.nextPhoto();
                break;
            case 'Escape':
                bootstrap.Modal.getInstance(modal).hide();
                break;
            case '+':
            case '=':
                e.preventDefault();
                this.zoomIn();
                break;
            case '-':
                e.preventDefault();
                this.zoomOut();
                break;
            case '0':
                e.preventDefault();
                this.resetZoom();
                break;
            case 'f':
            case 'F11':
                e.preventDefault();
                this.toggleFullscreen();
                break;
        }
    }

    getConfidenceBadgeClass(confidence) {
        if (confidence >= 0.8) return 'bg-success';
        if (confidence >= 0.6) return 'bg-warning';
        return 'bg-danger';
    }


    showManualLabelModal() {
        const unknownGroup = this.groupedPhotos.find(group => group.bib_number === 'unknown');
        if (!unknownGroup || unknownGroup.photos.length === 0) {
            this.showError('No unknown photos found.');
            return;
        }

        const container = document.getElementById('unknown-photos-container');
        container.innerHTML = unknownGroup.photos.map(photo => `
            <div class="col-md-4 mb-3">
                <div class="card">
                    <img src="${this.getImageUrl(photo.id)}" 
                         class="card-img-top" 
                         style="height: 150px; object-fit: cover;"
                         alt="${photo.filename}">
                    <div class="card-body p-2">
                        <small class="text-muted d-block mb-2">${photo.filename}</small>
                        <div class="input-group input-group-sm mb-2">
                            <input type="text" 
                                   class="form-control manual-label-input" 
                                   data-photo-id="${photo.id}"
                                   placeholder="Bib #" 
                                   pattern="[0-9]+"
                                   title="Enter bib number (numbers only)">
                            <button class="btn btn-outline-success btn-sm" 
                                    type="button" 
                                    onclick="photoProcessor.applyLabelToPhoto('${photo.id}', this)">
                                <i class="fas fa-check"></i>
                            </button>
                        </div>
                        <button class="btn btn-outline-secondary btn-sm w-100" 
                                type="button" 
                                onclick="photoProcessor.applyNoBibToPhoto('${photo.id}', this)"
                                title="Mark as no bib visible">
                            <i class="fas fa-eye-slash"></i> No Bib Visible
                        </button>
                    </div>
                </div>
            </div>
        `).join('');

        // Add existing bib numbers as datalist for autocomplete
        const existingBibs = [...new Set(this.groupedPhotos
            .filter(group => group.bib_number !== 'unknown')
            .map(group => group.bib_number)
            .sort((a, b) => parseInt(a) - parseInt(b))
        )];

        if (existingBibs.length > 0) {
            const datalist = document.createElement('datalist');
            datalist.id = 'existing-bibs';
            datalist.innerHTML = existingBibs.map(bib => `<option value="${bib}"></option>`).join('');
            document.body.appendChild(datalist);

            // Add datalist to all inputs
            container.querySelectorAll('.manual-label-input').forEach(input => {
                input.setAttribute('list', 'existing-bibs');
            });
        }

        const modal = new bootstrap.Modal(document.getElementById('manualLabelModal'));
        modal.show();
    }

    async applyLabelToPhoto(photoId, buttonElement) {
        const input = buttonElement.parentElement.querySelector('.manual-label-input');
        const bibNumber = input.value.trim();

        if (!bibNumber) {
            this.showError('Please enter a bib number.');
            input.focus();
            return;
        }

        if (!/^\d+$/.test(bibNumber)) {
            this.showError('Bib number must contain only numbers.');
            input.focus();
            return;
        }

        try {
            buttonElement.disabled = true;
            buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

            const response = await fetch(`${this.apiBase}/process/manual-label`, {
                method: 'PUT',
                headers: this.getAuthHeaders(),
                credentials: 'include',
                body: JSON.stringify({
                    photo_id: photoId,
                    bib_number: bibNumber
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to label photo');
            }

            // Success - remove the photo from the unknown group and refresh display
            input.parentElement.parentElement.parentElement.remove();

            // Refresh the grouped photos from backend
            await this.refreshGroupedPhotos();

            this.showSuccess(`Photo labeled as bib #${bibNumber}!`);

        } catch (error) {
            console.error('Manual labeling error:', error);
            this.showError(`Failed to label photo: ${error.message}`);
        } finally {
            buttonElement.disabled = false;
            buttonElement.innerHTML = '<i class="fas fa-check"></i>';
        }
    }

    async applyNoBibToPhoto(photoId, buttonElement) {
        try {
            buttonElement.disabled = true;
            buttonElement.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Marking...';

            const response = await fetch(`${this.apiBase}/process/manual-label`, {
                method: 'PUT',
                headers: this.getAuthHeaders(),
                credentials: 'include',
                body: JSON.stringify({
                    photo_id: photoId,
                    bib_number: 'unknown'  // Special value for "no bib visible"
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to mark photo');
            }

            // Success - remove the photo from the unknown group and refresh display
            buttonElement.closest('.col-md-3').remove();

            // Refresh the grouped photos from backend
            await this.refreshGroupedPhotos();

            this.showSuccess('Photo marked as "no bib visible"!');

        } catch (error) {
            console.error('No bib marking error:', error);
            this.showError(`Failed to mark photo: ${error.message}`);
        } finally {
            buttonElement.disabled = false;
            buttonElement.innerHTML = '<i class="fas fa-eye-slash"></i> No Bib Visible';
        }
    }

    async refreshGroupedPhotos() {
        if (!this.currentJobId) return;

        try {
            const response = await fetch(`${this.apiBase}/process/results/${this.currentJobId}`, {
                headers: this.getAuthHeaders(true),
                credentials: 'include'
            });
            if (response.ok) {
                const groupedPhotosObj = await response.json();
                this.groupedPhotos = this.convertGroupedPhotosObjectToArray(groupedPhotosObj);
                this.displayResults();
            }
        } catch (error) {
            console.error('Failed to refresh grouped photos:', error);
        }
    }


    // Unknown Photos Page Methods
    showUnknownPhotosPage() {
        document.getElementById('results-section').classList.add('d-none');
        document.getElementById('unknown-photos-section').classList.remove('d-none');
        this.displayUnknownPhotos();
    }

    showMainResults() {
        document.getElementById('unknown-photos-section').classList.add('d-none');
        document.getElementById('results-section').classList.remove('d-none');
    }

    displayUnknownPhotos() {
        const unknownGroup = this.groupedPhotos.find(group => group.bib_number === 'unknown');
        const unknownPhotos = unknownGroup ? unknownGroup.photos : [];

        document.getElementById('unknown-count-display').textContent = unknownPhotos.length;

        if (unknownPhotos.length === 0) {
            document.getElementById('unknown-photos-grid').classList.add('d-none');
            document.getElementById('no-unknown-message').classList.remove('d-none');
            return;
        }

        document.getElementById('unknown-photos-grid').classList.remove('d-none');
        document.getElementById('no-unknown-message').classList.add('d-none');

        const gridHtml = unknownPhotos.map(photo => `
            <div class="col-lg-3 col-md-4 col-sm-6 mb-4">
                <div class="card h-100 unknown-photo-card" data-photo-id="${photo.id}">
                    <div class="position-relative">
                        <img src="${this.getImageUrl(photo.id)}" 
                             class="card-img-top" 
                             style="height: 200px; object-fit: cover; cursor: pointer;"
                             onclick="photoProcessor.showPhotoModal('${photo.id}', '${photo.filename}', 'unknown')"
                             loading="lazy">

                        <!-- Edit button -->
                        <div class="position-absolute top-0 end-0 p-2">
                            <button class="btn btn-primary btn-sm" 
                                    onclick="photoProcessor.showSinglePhotoLabelModal('${photo.id}')"
                                    title="Label this photo">
                                <i class="fas fa-tag"></i>
                            </button>
                        </div>
                    </div>

                    <div class="card-body p-2">
                        <p class="card-text small text-muted mb-1" title="${photo.filename}">
                            ${photo.filename.length > 20 ? photo.filename.substring(0, 20) + '...' : photo.filename}
                        </p>
                        <small class="text-warning">
                            <i class="fas fa-question-circle me-1"></i>
                            No bib detected
                        </small>
                    </div>
                </div>
            </div>
        `).join('');

        document.getElementById('unknown-photos-grid').innerHTML = gridHtml;

    }

    // Selection Management

    // Manual Labeling Methods





    // Helper Methods
    validateBibNumber(bibNumber) {
        // Allow "unknown" as a special case for "no bib visible"
        if (bibNumber.toLowerCase() === 'unknown') {
            return true;
        }
        // Standard numeric validation
        const num = parseInt(bibNumber);
        return /^\d{1,6}$/.test(bibNumber) && num >= 1 && num <= 99999;
    }

    findPhotoById(photoId) {
        for (const group of this.groupedPhotos) {
            const photo = group.photos.find(p => p.id === photoId);
            if (photo) return photo;
        }
        return null;
    }

    async labelPhoto(photoId, bibNumber) {
        // Track manual labeling action
        if (window.analyticsDashboard) {
            window.analyticsDashboard.trackEngagement('success_action', 'manual_label_applied', {
                photo_id: photoId,
                bib_number: bibNumber,
                action_type: 'manual_correction'
            });
        }
        
        const response = await fetch(`${this.apiBase}/batch/update-labels`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            credentials: 'include',
            body: JSON.stringify({
                photo_ids: [photoId],
                bib_number: bibNumber
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to label photo');
        }

        return await response.json();
    }

    async refreshAfterLabeling() {
        // Refresh the grouped photos data
        if (this.currentJobId) {
            try {
                const response = await fetch(`${this.apiBase}/process/results/${this.currentJobId}`, {
                    headers: this.getAuthHeaders(true),
                    credentials: 'include'
                });
                if (response.ok) {
                    const groupedPhotosObj = await response.json();
                    this.groupedPhotos = this.convertGroupedPhotosObjectToArray(groupedPhotosObj);
                    this.updateStatsCards();
                    this.displayResults();

                    // If we're on unknown photos page, refresh it
                    if (!document.getElementById('unknown-photos-section').classList.contains('d-none')) {
                        this.displayUnknownPhotos();
                    }
                }
            } catch (error) {
                console.error('Failed to refresh data:', error);
            }
        }
    }

}

class UnifiedProgressManager {
    constructor() {
        this.phases = {
            compression: { 
                start: 0, 
                end: 25, 
                weight: 0.25,
                title: 'Optimizing photos...',
                description: 'Reducing file sizes for faster processing'
            },
            upload: { 
                start: 25, 
                end: 50, 
                weight: 0.25,
                title: 'Uploading batch {current} of {total}...',
                description: 'Securely transferring your photos'
            },
            processing: { 
                start: 50, 
                end: 100, 
                weight: 0.50,
                title: 'Analyzing bib numbers...',
                description: 'AI is detecting race numbers in your photos'
            }
        };
        this.currentPhase = 'compression';
        this.phaseProgress = 0;
        this.totalFiles = 0;
        this.currentBatch = 0;
        this.totalBatches = 0;
    }

    setPhase(phase, progress = 0, meta = {}) {
        this.currentPhase = phase;
        this.phaseProgress = Math.min(100, Math.max(0, progress));
        
        if (meta.totalFiles) this.totalFiles = meta.totalFiles;
        if (meta.currentBatch) this.currentBatch = meta.currentBatch;
        if (meta.totalBatches) this.totalBatches = meta.totalBatches;
        
        // Switch animation based on phase
        const animationElement = document.getElementById('progress-animation');
        if (animationElement) {
            if (phase === 'compression' || phase === 'upload') {
                // Upload/compression animation
                animationElement.src = 'https://lottie.host/e0ebd645-bfad-4439-86b0-5099f351b106/zNcAaQQDY1.lottie';
            } else if (phase === 'processing') {
                // Detection/processing animation
                animationElement.src = 'https://lottie.host/e6756db5-32c8-42f8-ac7c-59e803a2b16f/tzIArfl6ZX.lottie';
            }
        }
        
        this.updateUI();
    }

    updatePhaseProgress(progress) {
        this.phaseProgress = Math.min(100, Math.max(0, progress));
        this.updateUI();
    }

    calculateOverallProgress() {
        const phase = this.phases[this.currentPhase];
        const phaseContribution = (this.phaseProgress / 100) * phase.weight;
        return phase.start + (phaseContribution * (phase.end - phase.start));
    }

    updateUI() {
        // Progress elements are now in the processing section
        const phase = this.phases[this.currentPhase];
        const overallProgress = this.calculateOverallProgress();

        const titleElement = document.getElementById('progress-phase-title');
        const percentageElement = document.getElementById('progress-percentage');
        const progressBar = document.getElementById('unified-progress-bar');

        if (titleElement) {
            let title = phase.title;
            if (this.currentPhase === 'upload' && this.totalBatches > 0) {
                title = title.replace('{current}', this.currentBatch).replace('{total}', this.totalBatches);
            }
            titleElement.textContent = title;
        }

        if (percentageElement) {
            percentageElement.textContent = `${Math.round(overallProgress)}%`;
        }

        if (progressBar) {
            progressBar.style.width = `${overallProgress}%`;
        }
    }

    show() {
        // Progress is now shown via processing section
        // This method is kept for compatibility but doesn't need to do anything
    }

    hide() {
        // Progress is now hidden via processing section
        // This method is kept for compatibility but doesn't need to do anything
    }

    complete() {
        this.setPhase('processing', 100);
        setTimeout(() => this.hide(), 1000);
    }
}