// RaceSort - Main JavaScript

// Global functions for modal and authentication handling
function showSignInModal() {
    const modal = new bootstrap.Modal(document.getElementById('signInModal'));
    modal.show();

    // Attach event listener when modal is shown
    setTimeout(() => {
        const signInForm = document.getElementById('signInForm');
        if (signInForm) {
            // Remove any existing listeners
            signInForm.removeEventListener('submit', handleSignIn);
            // Add new listener
            signInForm.addEventListener('submit', handleSignIn);
            console.log('Sign In form listener attached in modal'); // Debug log
        }
    }, 100);
}

function showCreateAccountModal() {
    const modal = new bootstrap.Modal(document.getElementById('createAccountModal'));
    modal.show();

    // Attach event listener when modal is shown
    setTimeout(() => {
        const createAccountForm = document.getElementById('createAccountForm');
        if (createAccountForm) {
            // Remove any existing listeners
            createAccountForm.removeEventListener('submit', handleCreateAccount);
            // Add new listener
            createAccountForm.addEventListener('submit', handleCreateAccount);
            console.log('Create Account form listener attached in modal'); // Debug log
        }
    }, 100);
}

function switchToCreateAccount() {
    // Hide sign in modal and show create account modal
    const signInModal = bootstrap.Modal.getInstance(document.getElementById('signInModal'));
    if (signInModal) signInModal.hide();

    setTimeout(() => {
        showCreateAccountModal();
    }, 300);
}

function switchToSignIn() {
    // Hide create account modal and show sign in modal  
    const createAccountModal = bootstrap.Modal.getInstance(document.getElementById('createAccountModal'));
    if (createAccountModal) createAccountModal.hide();

    setTimeout(() => {
        showSignInModal();
    }, 300);
}

function showLandingPage() {
    document.getElementById('landing-page').classList.remove('d-none');
    document.getElementById('app-section').classList.add('d-none');
}

function showAppSection() {
    document.getElementById('landing-page').classList.add('d-none');
    document.getElementById('app-section').classList.remove('d-none');
}

function logout() {
    // Clear auth token and show landing page
    localStorage.removeItem('auth_token');
    showLandingPage();

    // Reset any app state
    if (window.photoProcessor) {
        window.photoProcessor.isAuthenticated = false;
        window.photoProcessor.authToken = null;
    }
}

// Handle authentication form submissions
function handleSignIn(event) {
    console.log('Sign In form submitted'); // Debug log
    event.preventDefault();
    const form = event.target;

    const emailElement = document.getElementById('signInEmail');
    const passwordElement = document.getElementById('signInPassword');

    console.log('Email element:', emailElement); // Debug log
    console.log('Password element:', passwordElement); // Debug log

    if (!emailElement || !passwordElement) {
        console.error('Form elements not found!');
        showNotification('Form error - please try again', 'error');
        return;
    }

    const email = emailElement.value;
    const password = passwordElement.value;

    console.log('Email:', email, 'Password:', password); // Debug log

    // Basic validation
    if (!email || !password) {
        showNotification('Please fill in all fields', 'error');
        return;
    }

    // Show loading state
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Signing In...';

    // Simulate authentication (replace with actual API call)
    setTimeout(() => {
        // Store auth token
        localStorage.setItem('auth_token', 'demo-token-' + Date.now());

        // Hide modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('signInModal'));
        modal.hide();

        // Show app section
        showAppSection();

        showNotification('Welcome to RaceSort!', 'success');

        // Restore button
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }, 1500);
}

function handleCreateAccount(event) {
    event.preventDefault();
    const form = event.target;
    const name = document.getElementById('createName').value;
    const email = document.getElementById('createEmail').value;
    const password = document.getElementById('createPassword').value;

    // Validation
    if (!name || !email || !password) {
        showNotification('Please fill in all fields', 'error');
        return;
    }

    if (password.length < 6) {
        showNotification('Password must be at least 6 characters', 'error');
        return;
    }

    // Show loading state
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Creating Account...';

    // Simulate account creation (replace with actual API call)
    setTimeout(() => {
        // Store auth token
        localStorage.setItem('auth_token', 'demo-token-' + Date.now());

        // Hide modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('createAccountModal'));
        modal.hide();

        // Show app section
        showAppSection();

        showNotification('Account created successfully! Welcome to RaceSort!', 'success');

        // Restore button
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }, 1500);
}

function showNotification(message, type = 'info') {
    const alertClass = type === 'error' ? 'alert-danger' : type === 'success' ? 'alert-success' : 'alert-info';
    const iconClass = type === 'error' ? 'fa-exclamation-triangle' : type === 'success' ? 'fa-check-circle' : 'fa-info-circle';

    const notification = document.createElement('div');
    notification.className = `alert ${alertClass} alert-dismissible fade show position-fixed`;
    notification.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    notification.innerHTML = `
        <i class="fas ${iconClass} me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    document.body.appendChild(notification);

    // Auto-remove after 4 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 4000);
}

// Check authentication status on page load
function checkAuthOnLoad() {
    const token = localStorage.getItem('auth_token');
    if (token) {
        // User is authenticated, show app section
        showAppSection();
    } else {
        // User is not authenticated, show landing page
        showLandingPage();
    }
}

class PhotoProcessor {
    constructor() {
        // In development, frontend runs on 5173 and backend on 8000
        // In production, both will be served from the same domain
        const isDevelopment = window.location.port === '5173';
        if (isDevelopment) {
            this.apiBase = window.location.protocol + '//' + window.location.hostname + ':8000/api';
        } else {
            // Production deployment will serve everything from the same port
            this.apiBase = window.location.protocol + '//' + window.location.host + '/api';
        }
        this.selectedFiles = [];
        this.currentJobId = null;
        this.groupedPhotos = [];
        this.filteredGroups = [];
        this.selectedGroups = [];
        this.modalSelectedFiles = []; // For upload more modal
        this.currentFilter = 'all';
        this.currentSort = 'bib-asc';
        this.searchTerm = '';
        this.confidenceFilter = 0;
        this.photoCountFilter = 1;
        this.isAuthenticated = false;
        this.authToken = null;
        this.isEditMode = false; // For inline labeling
        this.zoomLevel = 1;
        this.panX = 0;
        this.panY = 0;
        this.currentLightboxGroup = null;
        this.currentPhotoIndex = 0;
        this.selectedUnknownPhotos = []; // For unknown photos selection

        this.initializeEventListeners();
        this.initializeSearchAndFilters();

        // Initialize authentication and UI
        this.initializeApp();
    }

    // Authentication Methods
    async checkAuthStatus() {
        const token = localStorage.getItem('auth_token');
        if (!token) {
            this.showLoginScreen();
            return false;
        }

        try {
            const response = await fetch(`${this.apiBase}/auth/validate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ token: token })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.valid) {
                    this.isAuthenticated = true;
                    this.authToken = token;
                    showAppSection();
                    return true;
                }
            }
        } catch (error) {
            console.error('Auth check failed:', error);
        }
        
        // If we get here, auth failed - clear token and show login
        localStorage.removeItem('auth_token');
        this.showLoginScreen();
        return false;
    }

    showLoginScreen() {
        // Make sure we're on the landing page, not showing API response
        showLandingPage();
    }

    showMainContent() {
        document.getElementById('login-section').classList.add('d-none');
        document.getElementById('main-content').classList.remove('d-none');
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

        // Show loading state
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
        // Check if we have a stored token
        const token = localStorage.getItem('auth_token');
        if (token) {
            this.authToken = token;
            const isValid = await this.checkAuthStatus();
            if (!isValid) {
                this.showLoginScreen();
            }
        } else {
            this.showLoginScreen();
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
                    },
                    body: JSON.stringify({ token: this.authToken })
                });
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            // Always clear local session regardless of backend response
            localStorage.removeItem('auth_token');
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
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e.target.files, false));
        folderInput.addEventListener('change', (e) => this.handleFileSelect(e.target.files, true));

        // Upload button
        uploadBtn.addEventListener('click', this.uploadFiles.bind(this));

        // Clear files and add more buttons
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

        // Export options change handlers
        document.getElementById('exportFormat').addEventListener('change', () => {
            this.updateExportPreview();
        });

        document.getElementById('filenamePattern').addEventListener('change', () => {
            this.updateExportPreview();
        });
    }

    selectAllGroups() {
        const groupsToShow = this.filteredGroups.length > 0 ? this.filteredGroups : this.groupedPhotos;
        this.selectedGroups = groupsToShow.map(group => group.bib_number);
        this.updateSelectionUI();
        this.updateExportPreview();
    }

    selectDetectedGroups() {
        const groupsToShow = this.filteredGroups.length > 0 ? this.filteredGroups : this.groupedPhotos;
        this.selectedGroups = groupsToShow
            .filter(group => group.bib_number !== 'unknown')
            .map(group => group.bib_number);
        this.updateSelectionUI();
        this.updateExportPreview();
    }

    selectUnknownGroups() {
        const groupsToShow = this.filteredGroups.length > 0 ? this.filteredGroups : this.groupedPhotos;
        this.selectedGroups = groupsToShow
            .filter(group => group.bib_number === 'unknown')
            .map(group => group.bib_number);
        this.updateSelectionUI();
        this.updateExportPreview();
    }

    selectNone() {
        this.selectedGroups = [];
        document.getElementById('selectAllGroups').checked = false;
        this.updateSelectionUI();
        this.updateExportPreview();
    }

    updateSelectionUI() {
        // Update checkboxes in export groups
        document.querySelectorAll('.export-checkbox input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = this.selectedGroups.includes(checkbox.value);
            const label = checkbox.closest('.export-checkbox');
            if (checkbox.checked) {
                label.classList.add('selected');
            } else {
                label.classList.remove('selected');
            }
        });

        // Update selection count
        const count = this.selectedGroups.length;
        document.getElementById('selectionCount').textContent = `${count} group${count !== 1 ? 's' : ''} selected`;
        document.getElementById('exportBtnCount').textContent = count;

        // Update select all checkbox
        const groupsToShow = this.filteredGroups.length > 0 ? this.filteredGroups : this.groupedPhotos;
        const allSelected = groupsToShow.length > 0 && this.selectedGroups.length === groupsToShow.length;
        document.getElementById('selectAllGroups').checked = allSelected;

        // Enable/disable export button
        document.getElementById('export-btn').disabled = this.selectedGroups.length === 0;
    }

    updateExportPreview() {
        const selectedGroupData = this.groupedPhotos.filter(group => 
            this.selectedGroups.includes(group.bib_number)
        );

        const exportPreview = document.getElementById('exportPreview');
        const exportPreviewList = document.getElementById('exportPreviewList');
        const exportPhotoCount = document.getElementById('exportPhotoCount');

        if (selectedGroupData.length === 0) {
            exportPreview.style.display = 'none';
            return;
        }

        exportPreview.style.display = 'block';

        const totalPhotos = selectedGroupData.reduce((sum, group) => sum + group.count, 0);
        exportPhotoCount.textContent = totalPhotos;

        exportPreviewList.innerHTML = selectedGroupData.map(group => `
            <div class="d-flex justify-content-between align-items-center mb-1">
                <small class="text-muted">
                    ${group.bib_number === 'unknown' ? 'Unknown' : `Bib #${group.bib_number}`}
                </small>
                <small class="badge bg-secondary">${group.count}</small>
            </div>
        `).join('');
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
        // Update button states
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

        // Update dropdown button text
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

        console.log('Displaying groups:', groupsToShow);

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
            <div class="col-lg-4 col-md-6 mb-4 fade-in-up">
                <div class="card photo-group-card">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <h5 class="card-title mb-0">
                                <i class="fas fa-user me-2"></i>
                                ${group.bib_number === 'unknown' ? 'Unknown Bib' : `Bib #${group.bib_number}`}
                            </h5>
                            <span class="badge bg-secondary">${group.count} photo${group.count !== 1 ? 's' : ''}</span>
                        </div>
                        <p class="text-muted small mb-3">
                            <i class="fas fa-mouse-pointer me-1"></i>
                            Click photos to view full size
                        </p>

                        <div class="photo-grid">
                            ${group.photos.slice(0, 4).map((photo, index) => `
                                <div class="photo-item" onclick="photoProcessor.showPhotoModal('${photo.id}', '${photo.filename}', '${group.bib_number}')">
                                    <img src="${this.apiBase}/upload/serve/${photo.id}" 
                                         alt="${photo.filename}" 
                                         style="width: 100%; height: 100%; object-fit: cover; border-radius: var(--border-radius);"
                                         onerror="console.error('Failed to load image:', this.src); this.style.display='none'; this.nextElementSibling.style.display='flex';">
                                    <div class="photo-placeholder" style="display: none;">
                                        <i class="fas fa-image fa-2x"></i>
                                    </div>
                                    <div class="hover-overlay">
                                        <i class="fas fa-expand-alt me-1"></i>
                                        View
                                    </div>
                                    ${photo.detection_result ? `
                                        <div class="confidence-badge ${this.getConfidenceClass(photo.detection_result.confidence)}">
                                            ${Math.round(photo.detection_result.confidence * 100)}%
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

                        <div class="text-center mt-3">
                            ${group.count > 4 ? `
                                <button class="btn btn-primary btn-sm me-2" onclick="photoProcessor.showAllPhotos('${group.bib_number}')">
                                    <i class="fas fa-expand-alt me-1"></i>
                                    View All ${group.count} Photos
                                </button>
                            ` : group.count > 0 ? `
                                <button class="btn btn-outline-primary btn-sm me-2" onclick="photoProcessor.showAllPhotos('${group.bib_number}')">
                                    <i class="fas fa-eye me-1"></i>
                                    View Photos
                                </button>
                            ` : ''}
                            ${group.bib_number === 'unknown' ? `
                                <button class="btn btn-warning btn-sm" onclick="photoProcessor.showUnknownPhotosPage()">
                                    <i class="fas fa-tag me-1"></i>
                                    Label Photos
                                </button>
                            ` : `
                                <button class="btn btn-outline-secondary btn-sm" onclick="photoProcessor.showEditGroupModal('${group.bib_number}')">
                                    <i class="fas fa-edit me-1"></i>
                                    Edit Labels
                                </button>
                            `}
                        </div>
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

    handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('upload-area').classList.remove('dragover');

        const files = Array.from(e.dataTransfer.files).filter(file => 
            file.type.startsWith('image/')
        );

        this.handleFileSelect(files);
    }

    // File Selection Handler
    handleFileSelect(files, isFolder = false) {
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
        const SUPPORTED_FORMATS = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

        const validFiles = [];
        const invalidFiles = [];
        const oversizedFiles = [];

        Array.from(files).forEach(file => {
            if (!SUPPORTED_FORMATS.includes(file.type)) {
                invalidFiles.push(file.name);
            } else if (file.size > MAX_FILE_SIZE) {
                oversizedFiles.push(file.name);
            } else {
                validFiles.push(file);
            }
        });

        // Add to existing files instead of replacing
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
            this.showError(`${invalidFiles.length} files skipped (unsupported format)`);
        }

        if (oversizedFiles.length > 0) {
            this.showError(`${oversizedFiles.length} files skipped (too large)`);
        }
    }

    displaySelectedFiles() {
        const selectedFilesDiv = document.getElementById('selected-files');
        const fileListDiv = document.getElementById('file-list');
        const fileCountSpan = document.getElementById('file-count');

        if (this.selectedFiles.length === 0) {
            selectedFilesDiv.classList.add('d-none');
            return;
        }

        selectedFilesDiv.classList.remove('d-none');
        fileCountSpan.textContent = this.selectedFiles.length;

        fileListDiv.innerHTML = this.selectedFiles.map((file, index) => `
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

    // File Upload
    async uploadFiles() {
        if (this.selectedFiles.length === 0) return;

        const formData = new FormData();
        this.selectedFiles.forEach(file => {
            formData.append('files', file);
        });

        try {
            document.getElementById('upload-btn').disabled = true;
            document.getElementById('upload-btn').innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Uploading...';

            const response = await fetch(`${this.apiBase}/upload/photos`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            const result = await response.json();
            this.showProcessingSection();
            this.startProcessing(result.photo_ids);

        } catch (error) {
            console.error('Upload error:', error);
            this.showError('Upload failed. Please try again.');
            document.getElementById('upload-btn').disabled = false;
            document.getElementById('upload-btn').innerHTML = '<i class="fas fa-upload me-2"></i>Upload Photos';
        }
    }

    // Processing
    async startProcessing(photoIds) {
        try {
            const response = await fetch(`${this.apiBase}/process/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(photoIds)
            });

            if (!response.ok) {
                throw new Error(`Processing failed: ${response.statusText}`);
            }

            const job = await response.json();
            this.currentJobId = job.job_id;
            this.pollProcessingStatus();

        } catch (error) {
            console.error('Processing error:', error);
            this.showError('Processing failed. Please try again.');
        }
    }

    async pollProcessingStatus() {
        if (!this.currentJobId) return;

        try {
            const response = await fetch(`${this.apiBase}/process/status/${this.currentJobId}`);
            if (!response.ok) throw new Error(`Status check failed: ${response.statusText}`);

            const job = await response.json();
            this.updateProgress(job);

            if (job.status === 'completed') {
                // Update progress to show completion
                const progressText = document.getElementById('progress-text');
                if (progressText) {
                    progressText.textContent = 'Processing complete! Loading results...';
                }
                // Add a small delay to ensure backend results are ready
                setTimeout(() => this.fetchResults(), 500);
            } else if (job.status === 'failed') {
                this.showError('Processing failed. Please try again.');
            } else {
                setTimeout(() => this.pollProcessingStatus(), 500);
            }

        } catch (error) {
            console.error('Status check error:', error);
            setTimeout(() => this.pollProcessingStatus(), 1000);
        }
    }

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
            const response = await fetch(`${this.apiBase}/process/results/${this.currentJobId}`);
            if (!response.ok) {
                // If results aren't ready yet and we haven't retried too many times, try again
                if (response.status === 400 && retryCount < 3) {
                    console.log(`Results not ready yet, retrying in 1 second... (attempt ${retryCount + 1})`);
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

            this.groupedPhotos = await response.json();
            console.log('Grouped photos received:', this.groupedPhotos);
            this.showResultsSection();

        } catch (error) {
            console.error('Results fetch error:', error);

            // If this is the first attempt, try once more after a delay
            if (retryCount === 0) {
                console.log('Retrying results fetch after 2 seconds...');
                // Update progress text to show retry
                const progressText = document.getElementById('progress-text');
                if (progressText) {
                    progressText.textContent = 'Retrying to fetch results...';
                }
                setTimeout(() => this.fetchResults(1), 2000);
            } else {
                this.showError('Failed to fetch results. Please try again.');
            }
        }
    }

    // UI Section Management
    showProcessingSection() {
        document.getElementById('upload-section').classList.add('d-none');
        document.getElementById('processing-section').classList.remove('d-none');
        document.getElementById('results-section').classList.add('d-none');
    }

    showResultsSection() {
        document.getElementById('upload-section').classList.add('d-none');
        document.getElementById('processing-section').classList.add('d-none');
        document.getElementById('results-section').classList.remove('d-none');

        this.displayResults();
    }

    showUploadSection() {
        document.getElementById('upload-section').classList.remove('d-none');
        document.getElementById('processing-section').classList.add('d-none');
        document.getElementById('results-section').classList.add('d-none');
    }

    // Results Display - Simplified
    displayResults() {
        this.updateStatsCards();
        this.displayPhotoGroups();
        // No complex export controls needed - just simple download all button
    }

    updateStatsCards() {
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

    displayExportControls() {
        const exportGroupsDiv = document.getElementById('export-groups');
        const groupsToShow = this.filteredGroups.length > 0 ? this.filteredGroups : this.groupedPhotos;

        exportGroupsDiv.innerHTML = groupsToShow.map(group => `
            <div class="col-md-6 mb-2">
                <label class="export-checkbox ${this.selectedGroups.includes(group.bib_number) ? 'selected' : ''}">
                    <input type="checkbox" value="${group.bib_number}" ${this.selectedGroups.includes(group.bib_number) ? 'checked' : ''} onchange="photoProcessor.toggleGroupSelection('${group.bib_number}')">
                    <div class="export-info">
                        <h6>${group.bib_number === 'unknown' ? 'Unknown Bib' : `Bib #${group.bib_number}`}</h6>
                        <small>${group.count} photos • ${group.bib_number !== 'unknown' ? Math.round(this.getGroupAverageConfidence(group) * 100) + '% confidence' : 'No detection'}</small>
                    </div>
                </label>
            </div>
        `).join('');

        // Update selection UI after rendering
        this.updateSelectionUI();
        this.updateExportPreview();
    }

    getConfidenceClass(confidence) {
        if (confidence >= 0.8) return 'confidence-high';
        if (confidence >= 0.6) return 'confidence-medium';
        return 'confidence-low';
    }

    // Export Functions
    toggleGroupSelection(bibNumber) {
        const index = this.selectedGroups.indexOf(bibNumber);
        if (index > -1) {
            this.selectedGroups.splice(index, 1);
        } else {
            this.selectedGroups.push(bibNumber);
        }

        this.updateSelectionUI();
        this.updateExportPreview();
    }

    async exportPhotos() {
        if (this.selectedGroups.length === 0) return;

        const selectedPhotos = this.groupedPhotos
            .filter(group => this.selectedGroups.includes(group.bib_number))
            .flatMap(group => group.photos);

        const photoIds = selectedPhotos.map(photo => photo.id);

        // Get export options
        const exportFormat = document.getElementById('exportFormat').value;
        const filenamePattern = document.getElementById('filenamePattern').value;

        try {
            // Show progress
            this.showExportProgress('Preparing export...');

            document.getElementById('export-btn').disabled = true;
            document.getElementById('export-btn').innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Creating Export...';

            const exportData = {
                photo_ids: photoIds,
                export_options: {
                    format: exportFormat,
                    filename_pattern: filenamePattern,
                    group_data: this.groupedPhotos.filter(group => 
                        this.selectedGroups.includes(group.bib_number)
                    )
                }
            };

            const response = await fetch(`${this.apiBase}/download/export`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(exportData)
            });

            if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);

            const result = await response.json();

            // Update progress
            this.updateExportProgress(75, 'Generating ZIP file...');

            // Simulate additional progress steps
            setTimeout(() => {
                this.updateExportProgress(100, 'Download ready!');

                // Download the file
                const downloadUrl = `${this.apiBase}/download/file/${result.export_id}`;
                window.open(downloadUrl, '_blank');

                this.showSuccess(`Successfully exported ${photoIds.length} photos from ${this.selectedGroups.length} groups!`);

                // Hide progress after a delay
                setTimeout(() => {
                    this.hideExportProgress();
                }, 2000);
            }, 1000);

        } catch (error) {
            console.error('Export error:', error);
            this.showError('Export failed. Please try again.');
            this.hideExportProgress();
        } finally {
            document.getElementById('export-btn').disabled = false;
            document.getElementById('export-btn').innerHTML = `<i class="fas fa-file-archive me-2"></i>Export Selected (<span id="exportBtnCount">${this.selectedGroups.length}</span>)`;
        }
    }

    async downloadAllPhotos() {
        // Get all photos from all groups
        const allPhotos = this.groupedPhotos.flatMap(group => group.photos);
        const photoIds = allPhotos.map(photo => photo.id);

        if (photoIds.length === 0) {
            this.showError('No photos to download.');
            return;
        }

        try {
            // Show progress
            this.showExportProgress('Preparing download...');

            const downloadBtn = document.getElementById('download-all-btn');
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Creating ZIP...';

            const exportData = {
                photo_ids: photoIds,
                format: 'zip'
            };

            const response = await fetch(`${this.apiBase}/download/export`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(exportData)
            });

            if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);
            const result = await response.json();

            // Show completion and download
            setTimeout(() => {
                this.updateExportProgress(100, 'Download ready!');

                // Download the file
                const downloadUrl = `${this.apiBase}/download/file/${result.export_id}`;
                window.open(downloadUrl, '_blank');

                this.showSuccess(`Successfully downloaded ${photoIds.length} photos organized by bib number!`);

                // Hide progress after a delay
                setTimeout(() => {
                    this.hideExportProgress();
                }, 2000);

            }, 1000);
        } catch (error) {
            console.error('Download error:', error);
            this.showError('Download failed. Please try again.');
            this.hideExportProgress();
        } finally {
            const downloadBtn = document.getElementById('download-all-btn');
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = '<i class="fas fa-download me-2"></i>Download All Photos as ZIP';
        }
    }

    showExportProgress(message) {
        const progress = document.getElementById('exportProgress');
        const progressBar = progress.querySelector('.progress-bar');
        progress.style.display = 'block';
        progressBar.style.width = '25%';
        progressBar.innerHTML = `<small>${message}</small>`;
    }

    updateExportProgress(percent, message) {
        const progressBar = document.querySelector('#exportProgress .progress-bar');
        progressBar.style.width = `${percent}%`;
        progressBar.innerHTML = `<small>${message}</small>`;
    }

    hideExportProgress() {
        document.getElementById('exportProgress').style.display = 'none';
    }

    // Utility Functions
    resetApp() {
        this.selectedFiles = [];
        this.currentJobId = null;
        this.groupedPhotos = [];
        this.selectedGroups = [];

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

    displayModalSelectedFiles() {
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
        uploadBtn.disabled = false;
        fileCountSpan.textContent = this.modalSelectedFiles.length;

        fileListDiv.innerHTML = this.modalSelectedFiles.map((file, index) => `
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

        const formData = new FormData();
        this.modalSelectedFiles.forEach(file => {
            formData.append('files', file);
        });

        try {
            const modalUploadBtn = document.getElementById('modal-upload-btn');
            modalUploadBtn.disabled = true;
            modalUploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Processing...';

            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('uploadMoreModal'));
            modal.hide();

            // Upload new photos
            const response = await fetch(`${this.apiBase}/upload/photos`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            const result = await response.json();

            // Process new photos
            const processResponse = await fetch(`${this.apiBase}/process/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(result.photo_ids)
            });

            if (!processResponse.ok) {
                throw new Error(`Processing failed: ${processResponse.statusText}`);
            }

            const job = await processResponse.json();

            // Show processing notification
            this.showSuccess(`Processing ${this.modalSelectedFiles.length} additional photos...`);

            // Poll for completion and merge results
            this.pollAdditionalProcessing(job.job_id);

        } catch (error) {
            console.error('Upload more error:', error);
            this.showError('Failed to upload additional photos. Please try again.');
        }
    }

    async pollAdditionalProcessing(jobId) {
        try {
            const response = await fetch(`${this.apiBase}/process/status/${jobId}`);
            if (!response.ok) throw new Error(`Status check failed: ${response.statusText}`);

            const job = await response.json();

            if (job.status === 'completed') {
                // Fetch new results
                const resultsResponse = await fetch(`${this.apiBase}/process/results/${jobId}`);
                if (!resultsResponse.ok) throw new Error(`Results fetch failed: ${resultsResponse.statusText}`);

                const newGroupedPhotos = await resultsResponse.json();

                // Merge with existing results
                this.mergeGroupedPhotos(newGroupedPhotos);
                this.displayResults();
                this.showSuccess('Additional photos processed and merged!');

            } else if (job.status === 'failed') {
                this.showError('Processing additional photos failed.');
            } else {
                setTimeout(() => this.pollAdditionalProcessing(jobId), 2000);
            }

        } catch (error) {
            console.error('Additional processing error:', error);
            setTimeout(() => this.pollAdditionalProcessing(jobId), 2000);
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
        // Create a flat list of all photos from all groups for navigation
        this.allPhotosFlat = [];
        this.groupedPhotos.forEach(group => {
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
        
        if (this.currentPhotoIndex === -1) return;

        this.initializeLightbox();
        this.showPhotoInLightbox(this.currentPhotoIndex);

        const modal = new bootstrap.Modal(document.getElementById('photoModal'));
        modal.show();

        // Initialize keyboard navigation
        this.initializeLightboxKeyboard();
    }

    initializeLightbox() {
        const modal = document.getElementById('photoModal');

        // Navigation buttons
        document.getElementById('prevPhotoBtn').onclick = () => this.previousPhoto();
        document.getElementById('nextPhotoBtn').onclick = () => this.nextPhoto();

        // Zoom controls
        document.getElementById('zoomInBtn').onclick = () => this.zoomIn();
        document.getElementById('zoomOutBtn').onclick = () => this.zoomOut();
        document.getElementById('zoomResetBtn').onclick = () => this.resetZoom();

        // Fullscreen toggle
        document.getElementById('fullscreenBtn').onclick = () => this.toggleFullscreen();

        // Download button
        document.getElementById('downloadPhotoBtn').onclick = () => this.downloadCurrentPhoto();

        // Initialize inline labeling
        this.initializeInlineLabeling();

        // Initialize edit button
        document.getElementById('editBibBtn').onclick = () => this.enableEditMode();

        // Initialize thumbnails
        this.createThumbnailStrip();

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
        modalImage.src = `${this.apiBase}/upload/serve/${photo.id}`;
        modalImage.alt = photo.filename;

        // Update metadata
        document.getElementById('photoModalLabel').textContent = `${photo.groupBibNumber === 'unknown' ? 'Unknown Bib' : `Bib #${photo.groupBibNumber}`}`;
        document.getElementById('photoPosition').textContent = `${index + 1} of ${this.allPhotosFlat.length}`;
        document.getElementById('photoFilename').textContent = photo.filename;
        document.getElementById('photoBibNumber').textContent = photo.groupBibNumber === 'unknown' ? 'Unknown' : photo.groupBibNumber;

        // Update confidence
        if (photo.detection_result) {
            const confidence = Math.round(photo.detection_result.confidence * 100);
            document.getElementById('photoConfidence').textContent = `${confidence}%`;
            document.getElementById('photoConfidenceDetail').textContent = `${confidence}%`;

            // Update confidence badge color
            const badge = document.getElementById('photoConfidence');
            badge.className = 'badge ' + this.getConfidenceBadgeClass(photo.detection_result.confidence);
        } else {
            document.getElementById('photoConfidence').textContent = 'N/A';
            document.getElementById('photoConfidenceDetail').textContent = 'Not detected';
            document.getElementById('photoConfidence').className = 'badge bg-secondary';
        }

        // Update navigation buttons
        document.getElementById('prevPhotoBtn').disabled = index === 0;
        document.getElementById('nextPhotoBtn').disabled = index === this.allPhotosFlat.length - 1;

        // Show/hide inline labeling for unknown photos
        this.updateInlineLabeling(photo);

        // Update thumbnail selection
        this.updateThumbnailSelection();

        // Reset zoom
        this.resetZoom();
    }

    initializeInlineLabeling() {
        console.log('initializeInlineLabeling called');

        const input = document.getElementById('inlineBibInput');

        console.log('Inline labeling input found:', !!input);

        if (!input) {
            console.error('Could not find inline labeling input');
            return;
        }

        // Remove any existing event listeners to prevent duplicates
        const newInput = input.cloneNode(true);
        input.parentNode.replaceChild(newInput, input);
        const freshInput = document.getElementById('inlineBibInput');

        // Input keyboard events
        freshInput.addEventListener('keydown', (e) => {
            console.log('Keydown event:', e.key);
            if (e.key === 'Enter') {
                e.preventDefault();
                console.log('Enter pressed, calling saveInlineLabel');
                this.saveInlineLabel();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                console.log('Escape pressed, calling cancelInlineLabel');
                this.cancelInlineLabel();
            }
        });

        // Only allow numbers - use input event for better control
        freshInput.addEventListener('input', (e) => {
            // Remove any non-numeric characters
            const value = e.target.value;
            const numericValue = value.replace(/[^0-9]/g, '');
            if (value !== numericValue) {
                e.target.value = numericValue;
            }
        });

        // Also prevent non-numeric input on keypress
        freshInput.addEventListener('keypress', (e) => {
            // Allow numbers (0-9) and control keys
            const char = String.fromCharCode(e.which);
            if (!/[0-9]/.test(char) && !e.ctrlKey && !e.metaKey && e.which != 8 && e.which != 0) {
                console.log('Blocking non-numeric character:', char);
                e.preventDefault();
            }
        });

        console.log('Inline labeling initialized successfully');
    }

    updateInlineLabeling(photo) {
        const staticContainer = document.getElementById('photoBibNumberContainer');
        const staticDisplay = document.getElementById('photoBibNumber');
        const editBtn = document.getElementById('editBibBtn'); 
        const inlineContainer = document.getElementById('inlineLabelContainer');

        if (!staticContainer || !staticDisplay || !editBtn || !inlineContainer) {
            console.error('Missing DOM elements for inline labeling');
            return;
        }

        const isUnknown = photo.groupBibNumber === 'unknown' || 
                         (photo.detection_result && photo.detection_result.bib_number === 'unknown');

        // Always show the enhanced inline labeling interface for ALL photos
        // This ensures consistent UI between unknown and labeled photos
        staticContainer.classList.add('d-none');
        inlineContainer.classList.remove('d-none');
        this.setupEnhancedInlineLabeling(photo);
    }

    setupEnhancedInlineLabeling(photo) {
        const inlineContainer = document.getElementById('inlineLabelContainer');
        
        // Determine the current bib number for pre-filling
        let currentBibNumber = '';
        let detectionNote = '';
        
        if (photo.detection_result && photo.detection_result.bib_number && photo.detection_result.bib_number !== 'unknown') {
            currentBibNumber = photo.detection_result.bib_number;
            const confidence = Math.round(photo.detection_result.confidence * 100);
            detectionNote = `<div class="detection-note mb-2">
                <small class="text-info">
                    <i class="fas fa-robot me-1"></i>
                    AI detected: Bib #${currentBibNumber} (${confidence}% confidence)
                </small>
            </div>`;
        } else if (this.currentLightboxGroup.bib_number !== 'unknown') {
            currentBibNumber = this.currentLightboxGroup.bib_number;
        }
        
        // Create enhanced labeling interface
        inlineContainer.innerHTML = `
            <div class="inline-labeling-form">
                <div class="labeling-header">
                    <h6>
                        <i class="fas fa-tag"></i>
                        Label this photo
                    </h6>
                    <p>Enter the bib number you can see in this image</p>
                </div>
                
                ${detectionNote}
                
                <div class="bib-input-group">
                    <input type="text" 
                           class="form-control" 
                           id="inlineBibInput" 
                           placeholder="Bib #" 
                           maxlength="6" 
                           pattern="[0-9]{1,6}"
                           autocomplete="off"
                           spellcheck="false"
                           value="${currentBibNumber}">
                </div>
                
                <div class="labeling-hints">
                    <div class="hint-item">
                        <i class="fas fa-keyboard"></i>
                        <span>Press Enter to save</span>
                    </div>
                    <div class="hint-item">
                        <i class="fas fa-arrow-right"></i>
                        <span>Auto-advance to next</span>
                    </div>
                    <div class="hint-item">
                        <i class="fas fa-undo"></i>
                        <span>Esc to cancel</span>
                    </div>
                </div>
            </div>
        `;
        
        // Re-initialize event listeners for the new elements after DOM update
        setTimeout(() => {
            this.initializeInlineLabeling();
            
            // Focus and select the input
            const input = document.getElementById('inlineBibInput');
            if (input) {
                input.focus();
                if (currentBibNumber) {
                    input.select();
                }
            }
        }, 50);
    }

    enableEditMode() {
        console.log('enableEditMode called');
        
        if (!this.currentLightboxGroup || this.currentPhotoIndex < 0) return;

        const photo = this.currentLightboxGroup.photos[this.currentPhotoIndex];

        // Switch to edit mode
        this.isEditMode = true;
        
        // Trigger the UI update using the existing updateInlineLabeling function
        // The setupEnhancedInlineLabeling function will handle pre-filling and focus
        this.updateInlineLabeling(photo);
    }

    async saveInlineLabel() {
        const input = document.getElementById('inlineBibInput');
        if (!input) {
            console.error('Inline bib input not found');
            return;
        }

        const bibNumber = input.value.trim();

        if (!bibNumber || !this.validateBibNumber(bibNumber)) {
            this.showError('Please enter a valid bib number (1-6 digits, 1-99999)');
            input.focus();
            return;
        }

        if (!this.allPhotosFlat || this.currentPhotoIndex < 0 || this.currentPhotoIndex >= this.allPhotosFlat.length) {
            this.showError('No photo selected for labeling');
            return;
        }

        const photo = this.allPhotosFlat[this.currentPhotoIndex];

        try {
            // Show loading state in input
            input.disabled = true;
            input.style.opacity = '0.6';
            input.value = 'Saving...';

            console.log(`Attempting to label photo ${photo.id} as bib #${bibNumber}`);

            // Save the label
            await this.labelPhoto(photo.id, bibNumber);

            // Show success
            this.showSuccess(`Photo labeled as Bib #${bibNumber}`);

            // Refresh data
            await this.refreshAfterLabeling();

            // Smart navigation based on mode
            if (this.isEditMode) {
                // For editing detected photos: stay in current group, just refresh
                this.isEditMode = false;
                const staticContainer = document.getElementById('photoBibNumberContainer');
                const inlineContainer = document.getElementById('inlineLabelContainer');
                if (staticContainer && inlineContainer) {
                    staticContainer.classList.remove('d-none');
                    inlineContainer.classList.add('d-none');
                }
            } else {
                // For unknown photos: advance to next unknown for rapid labeling
                this.advanceToNextUnknownPhoto();
            }

        } catch (error) {
            console.error('Failed to label photo:', error);
            this.showError(`Failed to label photo: ${error.message}`);
            // Restore input state
            input.disabled = false;
            input.style.opacity = '1';
            input.value = bibNumber;
            input.focus();
        }
    }

    cancelInlineLabel() {
        const input = document.getElementById('inlineBibInput');
        const staticContainer = document.getElementById('photoBibNumberContainer');
        const inlineContainer = document.getElementById('inlineLabelContainer');

        input.value = '';
        input.blur();

        // If we were in edit mode, go back to static display
        if (this.isEditMode) {
            this.isEditMode = false;
            staticContainer.classList.remove('d-none');
            inlineContainer.classList.add('d-none');
        }
        // For unknown photos, keep the inline input visible
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

    createThumbnailStrip() {
        const container = document.getElementById('thumbnailContainer');
        container.innerHTML = '';

        // Show thumbnails for all photos, but highlight current group
        const currentPhoto = this.allPhotosFlat[this.currentPhotoIndex];
        const currentGroupPhotos = this.allPhotosFlat.filter(photo => photo.groupBibNumber === currentPhoto.groupBibNumber);

        currentGroupPhotos.forEach((photo, localIndex) => {
            const globalIndex = this.allPhotosFlat.findIndex(p => p.id === photo.id);
            
            const thumbnailDiv = document.createElement('div');
            thumbnailDiv.className = 'thumbnail-item';
            thumbnailDiv.onclick = () => this.showPhotoInLightbox(globalIndex);

            const img = document.createElement('img');
            img.src = `${this.apiBase}/upload/serve/${photo.id}`;
            img.alt = photo.filename;

            thumbnailDiv.appendChild(img);
            container.appendChild(thumbnailDiv);
        });
    }

    updateThumbnailSelection() {
        const thumbnails = document.querySelectorAll('.thumbnail-item');
        const currentPhoto = this.allPhotosFlat[this.currentPhotoIndex];
        
        thumbnails.forEach((thumb) => {
            thumb.classList.remove('active');
        });
        
        // Find and highlight the current photo's thumbnail
        const currentPhotoThumbnails = Array.from(thumbnails);
        const currentGroupPhotos = this.allPhotosFlat.filter(photo => photo.groupBibNumber === currentPhoto.groupBibNumber);
        const localIndex = currentGroupPhotos.findIndex(photo => photo.id === currentPhoto.id);
        
        if (currentPhotoThumbnails[localIndex]) {
            currentPhotoThumbnails[localIndex].classList.add('active');
        }
    }

    previousPhoto() {
        if (this.currentPhotoIndex > 0) {
            this.showPhotoInLightbox(this.currentPhotoIndex - 1);
        }
    }

    nextPhoto() {
        if (this.currentPhotoIndex < this.allPhotosFlat.length - 1) {
            this.showPhotoInLightbox(this.currentPhotoIndex + 1);
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
        });

        // Touch zoom (pinch)
        let initialDistance = 0;
        let initialZoom = 1;

        photoContainer.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                initialDistance = this.getTouchDistance(e.touches);
                initialZoom = this.zoomLevel;
            }
        });

        photoContainer.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const currentDistance = this.getTouchDistance(e.touches);
                const scale = currentDistance / initialDistance;
                this.zoomLevel = Math.max(0.5, Math.min(5, initialZoom * scale));
                this.applyZoom();
            }
        });

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
            window.open(`${this.apiBase}/upload/serve/${photo.id}`, '_blank');
        }
    }

    initializeLightboxKeyboard() {
        document.addEventListener('keydown', this.handleLightboxKeyboard.bind(this));
    }

    handleLightboxKeyboard(e) {
        const modal = document.getElementById('photoModal');
        if (!modal.classList.contains('show')) return;

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

    showAllPhotos(bibNumber, editMode = false) {
        const group = this.groupedPhotos.find(g => g.bib_number === bibNumber);
        if (!group) return;

        const galleryGrid = document.getElementById('galleryGrid');
        const modalLabel = document.getElementById('galleryModalLabel');
        const downloadBtn = document.getElementById('downloadGroupBtn');

        if (editMode) {
            modalLabel.textContent = `Edit Labels - ${bibNumber === 'unknown' ? 'Unknown Bib' : `Bib #${bibNumber}`}`;
            downloadBtn.style.display = 'none';
        } else {
            modalLabel.textContent = `All Photos - ${bibNumber === 'unknown' ? 'Unknown Bib' : `Bib #${bibNumber}`}`;
            downloadBtn.style.display = 'block';
        }

        galleryGrid.innerHTML = group.photos.map(photo => `
            <div class="photo-item position-relative" ${editMode ? '' : `onclick="photoProcessor.showPhotoModal('${photo.id}', '${photo.filename}')"`}>
                <img src="${this.apiBase}/upload/serve/${photo.id}" 
                     alt="${photo.filename}" 
                     style="width: 100%; height: 100%; object-fit: cover; border-radius: var(--border-radius);"
                     onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <div class="photo-placeholder" style="display: none;">
                    <i class="fas fa-image fa-2x"></i>
                </div>
                ${photo.detection_result ? `
                    <div class="confidence-badge ${this.getConfidenceClass(photo.detection_result.confidence)}">
                        ${Math.round(photo.detection_result.confidence * 100)}%
                    </div>
                ` : ''}
                ${editMode ? `
                    <div class="position-absolute top-0 end-0 p-1">
                        <button class="btn btn-primary btn-sm" 
                                onclick="photoProcessor.showSinglePhotoLabelModal('${photo.id}')"
                                title="Edit label">
                            <i class="fas fa-edit"></i>
                        </button>
                    </div>
                    <div class="position-absolute bottom-0 start-0 end-0 bg-dark bg-opacity-75 text-white text-center py-1">
                        <small>${photo.filename}</small>
                    </div>
                ` : ''}
            </div>
        `).join('');

        if (!editMode) {
            downloadBtn.onclick = () => {
                // Export this specific group
                this.selectedGroups = [bibNumber];
                this.exportPhotos();
            };
        }

        const modal = new bootstrap.Modal(document.getElementById('galleryModal'));
        modal.show();
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
                    <img src="${this.apiBase}/upload/serve/${photo.id}" 
                         class="card-img-top" 
                         style="height: 150px; object-fit: cover;"
                         alt="${photo.filename}">
                    <div class="card-body p-2">
                        <small class="text-muted d-block mb-2">${photo.filename}</small>
                        <div class="input-group input-group-sm">
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
                headers: {
                    'Content-Type': 'application/json',
                },
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

    async refreshGroupedPhotos() {
        if (!this.currentJobId) return;

        try {
            const response = await fetch(`${this.apiBase}/process/results/${this.currentJobId}`);
            if (response.ok) {
                this.groupedPhotos = await response.json();
                this.displayResults();
            }
        } catch (error) {
            console.error('Failed to refresh grouped photos:', error);
        }
    }

    showFeedbackModal() {
        // Reset form
        document.getElementById('feedbackForm').reset();
        document.getElementById('charCount').textContent = '0';

        // Auto-fill system information
        const systemInfo = this.getSystemInfo();
        document.getElementById('systemInfo').textContent = systemInfo;

        // Set up character counter
        const description = document.getElementById('feedbackDescription');
        const charCount = document.getElementById('charCount');

        description.addEventListener('input', function() {
            charCount.textContent = this.value.length;
        });

        // Set up form submission
        document.getElementById('submitFeedbackBtn').onclick = this.submitFeedback.bind(this);

        const modal = new bootstrap.Modal(document.getElementById('feedbackModal'));
        modal.show();
    }

    getSystemInfo() {
        const nav = navigator;
        const screen = window.screen;

        return `Browser: ${nav.userAgent} | Screen: ${screen.width}x${screen.height} | Language: ${nav.language} | Platform: ${nav.platform}`;
    }

    async submitFeedback() {
        const form = document.getElementById('feedbackForm');
        const submitBtn = document.getElementById('submitFeedbackBtn');

        // Validate form
        if (!form.checkValidity()) {
            form.classList.add('was-validated');
            return;
        }

        const feedbackData = {
            type: document.getElementById('feedbackType').value,
            title: document.getElementById('feedbackTitle').value.trim(),
            description: document.getElementById('feedbackDescription').value.trim(),
            email: document.getElementById('feedbackEmail').value.trim() || null,
            system_info: this.getSystemInfo()
        };

        try {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Sending...';

            const response = await fetch(`${this.apiBase}/feedback/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(feedbackData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to submit feedback');
            }

            const result = await response.json();

            // Close modal and show success
            const modal = bootstrap.Modal.getInstance(document.getElementById('feedbackModal'));
            modal.hide();

            this.showSuccess('Thank you for your feedback! We appreciate your input and will review it soon.');

        } catch (error) {
            console.error('Feedback submission error:', error);
            this.showError(`Failed to submit feedback: ${error.message}`);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane me-2"></i>Send Feedback';
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
        this.selectedUnknownPhotos = []; // Clear selection
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
                        <img src="${this.apiBase}/upload/serve/${photo.id}" 
                             class="card-img-top" 
                             style="height: 200px; object-fit: cover; cursor: pointer;"
                             onclick="photoProcessor.showPhotoModal('${photo.id}', '${photo.filename}', 'unknown')"
                             loading="lazy">

                        <!-- Selection checkbox -->
                        <div class="position-absolute top-0 start-0 p-2">
                            <input class="form-check-input unknown-photo-checkbox" 
                                   type="checkbox" 
                                   data-photo-id="${photo.id}"
                                   onchange="photoProcessor.toggleUnknownPhotoSelection('${photo.id}')">
                        </div>

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

        // Initialize selection state
        this.selectedUnknownPhotos = [];
        this.updateBatchLabelButton();
    }

    // Selection Management
    toggleUnknownPhotoSelection(photoId) {
        const index = this.selectedUnknownPhotos.indexOf(photoId);
        if (index > -1) {
            this.selectedUnknownPhotos.splice(index, 1);
        } else {
            this.selectedUnknownPhotos.push(photoId);
        }
        this.updateBatchLabelButton();
    }

    selectAllUnknown() {
        const unknownGroup = this.groupedPhotos.find(group => group.bib_number === 'unknown');
        const unknownPhotos = unknownGroup ? unknownGroup.photos : [];

        const allSelected = this.selectedUnknownPhotos.length === unknownPhotos.length;

        if (allSelected) {
            // Deselect all
            this.selectedUnknownPhotos = [];
            document.querySelectorAll('.unknown-photo-checkbox').forEach(cb => cb.checked = false);
            document.getElementById('select-all-unknown-btn').innerHTML = '<i class="fas fa-check-square me-2"></i>Select All';
        } else {
            // Select all
            this.selectedUnknownPhotos = unknownPhotos.map(photo => photo.id);
            document.querySelectorAll('.unknown-photo-checkbox').forEach(cb => cb.checked = true);
            document.getElementById('select-all-unknown-btn').innerHTML = '<i class="fas fa-minus-square me-2"></i>Deselect All';
        }

        this.updateBatchLabelButton();
    }

    updateBatchLabelButton() {
        const batchBtn = document.getElementById('batch-label-btn');
        const selectAllBtn = document.getElementById('select-all-unknown-btn');

        if (this.selectedUnknownPhotos.length > 0) {
            batchBtn.disabled = false;
            batchBtn.innerHTML = `<i class="fas fa-tags me-2"></i>Batch Label Selected (${this.selectedUnknownPhotos.length})`;
        } else {
            batchBtn.disabled = true;
            batchBtn.innerHTML = '<i class="fas fa-tags me-2"></i>Batch Label Selected';
        }

        const unknownGroup = this.groupedPhotos.find(group => group.bib_number === 'unknown');
        const totalUnknown = unknownGroup ? unknownGroup.photos.length : 0;

        if (this.selectedUnknownPhotos.length === totalUnknown && totalUnknown > 0) {
            selectAllBtn.innerHTML = '<i class="fas fa-minus-square me-2"></i>Deselect All';
        } else {
            selectAllBtn.innerHTML = '<i class="fas fa-check-square me-2"></i>Select All';
        }
    }

    // Manual Labeling Methods
    currentPhotoToLabel = null;

    showSinglePhotoLabelModal(photoId) {
        this.currentPhotoToLabel = photoId;
        const photo = this.findPhotoById(photoId);

        if (!photo) return;

        // Set up modal content
        document.getElementById('labelPhotoPreview').src = `${this.apiBase}/upload/serve/${photoId}`;
        document.getElementById('labelPhotoFilename').textContent = photo.filename;
        document.getElementById('manualBibNumber').value = '';

        // Set current status
        const statusEl = document.getElementById('currentPhotoStatus');
        if (photo.detection_result && photo.detection_result.bib_number && photo.detection_result.bib_number !== 'unknown') {
            statusEl.innerHTML = `Currently labeled as Bib #${photo.detection_result.bib_number}`;
            statusEl.parentElement.className = 'alert alert-info mb-0';
        } else {
            statusEl.innerHTML = 'No bib number detected';
            statusEl.parentElement.className = 'alert alert-warning mb-0';
        }

        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('manualLabelModal'));
        modal.show();

        // Set up event listener
        this.setupSingleLabelEventListener();
    }

    setupSingleLabelEventListener() {
        const btn = document.getElementById('apply-single-label-btn');
        const input = document.getElementById('manualBibNumber');

        // Remove existing listeners
        btn.replaceWith(btn.cloneNode(true));
        const newBtn = document.getElementById('apply-single-label-btn');

        newBtn.addEventListener('click', () => this.applySingleLabel());

        // Allow Enter key to submit
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.applySingleLabel();
            }
        });
    }

    async applySingleLabel() {
        const bibNumber = document.getElementById('manualBibNumber').value.trim();

        if (!bibNumber || !this.validateBibNumber(bibNumber)) {
            this.showError('Please enter a valid bib number (1-6 digits, 1-99999)');
            return;
        }

        try {
            await this.labelPhoto(this.currentPhotoToLabel, bibNumber);

            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('manualLabelModal'));
            modal.hide();

            this.showSuccess(`Photo labeled as Bib #${bibNumber}`);

            // Refresh displays
            await this.refreshAfterLabeling();

        } catch (error) {
            this.showError(`Failed to label photo: ${error.message}`);
        }
    }

    showBatchLabelModal() {
        if (this.selectedUnknownPhotos.length === 0) {
            this.showError('Please select photos to label first');
            return;
        }

        // Update count
        document.getElementById('selectedPhotoCount').textContent = this.selectedUnknownPhotos.length;
        document.getElementById('batchBibNumber').value = '';

        // Show preview thumbnails
        this.displayBatchPhotoPreviews();

        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('batchLabelModal'));
        modal.show();

        // Set up event listener
        this.setupBatchLabelEventListener();
    }

    displayBatchPhotoPreviews() {
        const previewsHtml = this.selectedUnknownPhotos.map(photoId => {
            const photo = this.findPhotoById(photoId);
            return `
                <div class="position-relative">
                    <img src="${this.apiBase}/upload/serve/${photoId}" 
                         class="rounded" 
                         style="width: 60px; height: 60px; object-fit: cover;">
                    <button class="btn btn-danger btn-sm position-absolute top-0 end-0" 
                            style="transform: translate(50%, -50%); width: 20px; height: 20px; border-radius: 50%; padding: 0; font-size: 10px;"
                            onclick="photoProcessor.removeFromBatchSelection('${photoId}')"
                            title="Remove from selection">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        }).join('');

        document.getElementById('batchPhotosPreviews').innerHTML = previewsHtml;
    }

    removeFromBatchSelection(photoId) {
        const index = this.selectedUnknownPhotos.indexOf(photoId);
        if (index > -1) {
            this.selectedUnknownPhotos.splice(index, 1);

            // Update checkbox
            const checkbox = document.querySelector(`input[data-photo-id="${photoId}"]`);
            if (checkbox) checkbox.checked = false;

            // Update count and previews
            document.getElementById('selectedPhotoCount').textContent = this.selectedUnknownPhotos.length;
            this.displayBatchPhotoPreviews();
            this.updateBatchLabelButton();

            // Close modal if no photos left
            if (this.selectedUnknownPhotos.length === 0) {
                const modal = bootstrap.Modal.getInstance(document.getElementById('batchLabelModal'));
                modal.hide();
            }
        }
    }

    setupBatchLabelEventListener() {
        const btn = document.getElementById('apply-batch-labels-btn');
        const input = document.getElementById('batchBibNumber');

        // Remove existing listeners
        btn.replaceWith(btn.cloneNode(true));
        const newBtn = document.getElementById('apply-batch-labels-btn');

        newBtn.addEventListener('click', () => this.applyBatchLabels());

        // Allow Enter key to submit
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.applyBatchLabels();
            }
        });
    }

    async applyBatchLabels() {
        const bibNumber = document.getElementById('batchBibNumber').value.trim();

        if (!bibNumber || !this.validateBibNumber(bibNumber)) {
            this.showError('Please enter a valid bib number (1-6 digits, 1-99999)');
            return;
        }

        const btn = document.getElementById('apply-batch-labels-btn');
        const originalText = btn.innerHTML;

        try {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Labeling...';

            // Label all selected photos
            const promises = this.selectedUnknownPhotos.map(photoId => 
                this.labelPhoto(photoId, bibNumber)
            );

            await Promise.all(promises);

            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('batchLabelModal'));
            modal.hide();

            this.showSuccess(`${this.selectedUnknownPhotos.length} photos labeled as Bib #${bibNumber}`);

            // Clear selection
            this.selectedUnknownPhotos = [];

            // Refresh displays
            await this.refreshAfterLabeling();

        } catch (error) {
            this.showError(`Failed to label photos: ${error.message}`);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }

    // Helper Methods
    validateBibNumber(bibNumber) {
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
        const response = await fetch(`${this.apiBase}/process/manual-label`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                photo_id: photoId,
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
                const response = await fetch(`${this.apiBase}/process/results/${this.currentJobId}`);
                if (response.ok) {
                    this.groupedPhotos = await response.json();
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

    // Group Editing Methods
    showEditGroupModal(bibNumber) {
        const group = this.groupedPhotos.find(g => g.bib_number === bibNumber);
        if (!group) return;

        // For now, let's show the individual photos in the group for editing
        // We'll use the gallery modal but with edit functionality
        this.showAllPhotos(bibNumber, true); // true for edit mode
    }
}

// Initialize the application
const photoProcessor = new PhotoProcessor();

// Make it globally accessible for onclick handlers
window.photoProcessor = photoProcessor;

// Make functions globally accessible for onclick handlers
window.showSignInModal = showSignInModal;
window.showCreateAccountModal = showCreateAccountModal;
window.switchToCreateAccount = switchToCreateAccount;
window.switchToSignIn = switchToSignIn;
window.showLandingPage = showLandingPage;
window.showAppSection = showAppSection;
window.logout = logout;

// Check authentication status when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded'); // Debug log
    checkAuthOnLoad();

    // Set up authentication form handlers
    const signInForm = document.getElementById('signInForm');
    const createAccountForm = document.getElementById('createAccountForm');

    console.log('Sign In Form found:', !!signInForm); // Debug log
    console.log('Create Account Form found:', !!createAccountForm); // Debug log

    if (signInForm) {
        signInForm.addEventListener('submit', handleSignIn);
        console.log('Sign In event listener attached'); // Debug log
    }

    if (createAccountForm) {
        createAccountForm.addEventListener('submit', handleCreateAccount);
        console.log('Create Account event listener attached'); // Debug log
    }
});