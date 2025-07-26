// Race Photo Processor - Main JavaScript

class PhotoProcessor {
    constructor() {
        this.apiBase = 'http://localhost:8000/api';
        this.selectedFiles = [];
        this.currentJobId = null;
        this.groupedPhotos = [];
        this.selectedGroups = [];
        this.modalSelectedFiles = []; // For upload more modal
        
        this.initializeEventListeners();
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

        // Export button
        document.getElementById('export-btn').addEventListener('click', this.exportPhotos.bind(this));
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
        const imageFiles = Array.from(files).filter(file => 
            file.type.startsWith('image/')
        );
        
        // Add to existing files instead of replacing
        this.selectedFiles = [...this.selectedFiles, ...imageFiles];
        
        // Remove duplicates based on file name and size
        this.selectedFiles = this.selectedFiles.filter((file, index, self) =>
            index === self.findIndex(f => f.name === file.name && f.size === file.size)
        );
        
        this.displaySelectedFiles();
        
        if (isFolder && imageFiles.length > 0) {
            this.showSuccess(`Added ${imageFiles.length} photos from folder`);
        } else if (imageFiles.length > 0) {
            this.showSuccess(`Added ${imageFiles.length} photos`);
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
                await this.fetchResults();
            } else if (job.status === 'failed') {
                this.showError('Processing failed. Please try again.');
            } else {
                setTimeout(() => this.pollProcessingStatus(), 2000);
            }

        } catch (error) {
            console.error('Status check error:', error);
            setTimeout(() => this.pollProcessingStatus(), 2000);
        }
    }

    updateProgress(job) {
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');

        progressBar.style.width = `${job.progress}%`;
        progressText.textContent = `Processing... ${job.completed_photos}/${job.total_photos} photos (${job.progress}%)`;
    }

    async fetchResults() {
        try {
            const response = await fetch(`${this.apiBase}/process/results/${this.currentJobId}`);
            if (!response.ok) throw new Error(`Results fetch failed: ${response.statusText}`);

            this.groupedPhotos = await response.json();
            this.showResultsSection();

        } catch (error) {
            console.error('Results fetch error:', error);
            this.showError('Failed to fetch results. Please try again.');
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

    // Results Display
    displayResults() {
        this.updateStatsCards();
        this.displayPhotoGroups();
        this.displayExportControls();
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
        const photoGroupsDiv = document.getElementById('photo-groups');
        
        photoGroupsDiv.innerHTML = this.groupedPhotos.map(group => `
            <div class="col-lg-4 col-md-6 mb-4">
                <div class="card photo-group-card">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <h5 class="card-title mb-0">
                                <i class="fas fa-user me-2"></i>
                                ${group.bib_number === 'unknown' ? 'Unknown Bib' : `Bib #${group.bib_number}`}
                            </h5>
                            <span class="badge bg-secondary">${group.count} photos</span>
                        </div>
                        
                        <div class="photo-grid">
                            ${group.photos.slice(0, 4).map(photo => `
                                <div class="photo-item">
                                    <div class="photo-placeholder">
                                        <i class="fas fa-image fa-2x"></i>
                                    </div>
                                    ${photo.detection_result ? `
                                        <div class="confidence-badge ${this.getConfidenceClass(photo.detection_result.confidence)}">
                                            ${Math.round(photo.detection_result.confidence * 100)}%
                                        </div>
                                    ` : ''}
                                </div>
                            `).join('')}
                        </div>
                        
                        ${group.count > 4 ? `
                            <p class="text-muted text-center mt-2 mb-0">
                                <small>+${group.count - 4} more photos</small>
                            </p>
                        ` : ''}
                    </div>
                </div>
            </div>
        `).join('');
    }

    displayExportControls() {
        const exportGroupsDiv = document.getElementById('export-groups');
        
        exportGroupsDiv.innerHTML = this.groupedPhotos.map(group => `
            <div class="col-md-6 mb-2">
                <label class="export-checkbox">
                    <input type="checkbox" value="${group.bib_number}" onchange="photoProcessor.toggleGroupSelection('${group.bib_number}')">
                    <div class="export-info">
                        <h6>${group.bib_number === 'unknown' ? 'Unknown Bib' : `Bib #${group.bib_number}`}</h6>
                        <small>${group.count} photos</small>
                    </div>
                </label>
            </div>
        `).join('');
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
        
        document.getElementById('export-btn').disabled = this.selectedGroups.length === 0;
    }

    async exportPhotos() {
        if (this.selectedGroups.length === 0) return;

        const selectedPhotos = this.groupedPhotos
            .filter(group => this.selectedGroups.includes(group.bib_number))
            .flatMap(group => group.photos);
        
        const photoIds = selectedPhotos.map(photo => photo.id);

        try {
            document.getElementById('export-btn').disabled = true;
            document.getElementById('export-btn').innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Creating Export...';

            const response = await fetch(`${this.apiBase}/download/export`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ photo_ids: photoIds })
            });

            if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);

            const result = await response.json();
            
            // Download the file
            const downloadUrl = `${this.apiBase}/download/file/${result.export_id}`;
            window.open(downloadUrl, '_blank');

        } catch (error) {
            console.error('Export error:', error);
            this.showError('Export failed. Please try again.');
        } finally {
            document.getElementById('export-btn').disabled = false;
            document.getElementById('export-btn').innerHTML = '<i class="fas fa-file-archive me-2"></i>Export Selected';
        }
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
}

// Initialize the application
const photoProcessor = new PhotoProcessor();

// Make it globally accessible for onclick handlers
window.photoProcessor = photoProcessor;