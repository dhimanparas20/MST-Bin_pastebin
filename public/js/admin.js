// Admin Panel JavaScript - MST Bin
let currentPage = 1;
let currentSortBy = 'created_at';
let currentSortOrder = 'desc';
let currentSearch = '';
let currentLanguage = '';
let currentEncryption = '';
let perPage = 20;
let deleteKey = null;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    loadAnalytics();
    loadPastes();
    setupEventListeners();
    setupCharts();
});

// Event Listeners
function setupEventListeners() {
    // Search
    let searchTimeout;
    document.getElementById('searchInput').addEventListener('input', function(e) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearch = e.target.value;
            currentPage = 1;
            loadPastes();
        }, 300);
    });

    // Filters
    document.getElementById('languageFilter').addEventListener('change', function(e) {
        currentLanguage = e.target.value;
        currentPage = 1;
        loadPastes();
    });

    document.getElementById('encryptionFilter').addEventListener('change', function(e) {
        currentEncryption = e.target.value;
        currentPage = 1;
        loadPastes();
    });

    // Sort
    document.getElementById('sortBy').addEventListener('change', function(e) {
        currentSortBy = e.target.value;
        currentPage = 1;
        loadPastes();
    });

    document.getElementById('sortOrder').addEventListener('change', function(e) {
        currentSortOrder = e.target.value;
        currentPage = 1;
        loadPastes();
    });

    // Per page
    document.getElementById('perPageSelect').addEventListener('change', function(e) {
        perPage = parseInt(e.target.value);
        currentPage = 1;
        loadPastes();
    });

    // Toggle filters
    document.getElementById('toggleFilters').addEventListener('click', function() {
        const filtersBody = document.getElementById('filtersBody');
        const icon = this.querySelector('i');
        if (filtersBody.style.display === 'none') {
            filtersBody.style.display = 'block';
            icon.classList.remove('fa-chevron-down');
            icon.classList.add('fa-chevron-up');
        } else {
            filtersBody.style.display = 'none';
            icon.classList.remove('fa-chevron-up');
            icon.classList.add('fa-chevron-down');
        }
    });

    // Delete confirmation
    document.getElementById('confirmDeleteBtn').addEventListener('click', function() {
        if (deleteKey) {
            deletePaste(deleteKey);
        }
    });

    // Modal delete button
    document.getElementById('modalDeleteBtn').addEventListener('click', function() {
        const key = document.getElementById('modalKey').textContent;
        showDeleteModal(key);
    });
}

// Load Analytics
async function loadAnalytics() {
    try {
        const response = await fetch('/api/admin/analytics');
        const data = await response.json();
        
        document.getElementById('statTotalPastes').textContent = formatNumber(data.total_pastes);
        document.getElementById('statTotalViews').textContent = formatNumber(data.total_views);
        document.getElementById('statLastDay').textContent = formatNumber(data.pastes_last_day);
        document.getElementById('statProtected').textContent = formatNumber(data.password_protected);
        document.getElementById('statLastWeek').textContent = formatNumber(data.pastes_last_week);
        document.getElementById('statLastMonth').textContent = formatNumber(data.pastes_last_month);
        document.getElementById('statAvgViews').textContent = data.avg_views;
        document.getElementById('statViewOnce').textContent = formatNumber(data.view_once_pastes);
        
        updateCharts(data);
    } catch (error) {
        console.error('Failed to load analytics:', error);
    }
}

// Load Pastes
async function loadPastes() {
    const tbody = document.getElementById('pastesTableBody');
    tbody.innerHTML = '<tr><td colspan="10" class="text-center py-4 text-purple-light"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';
    
    try {
        const params = new URLSearchParams({
            page: currentPage,
            per_page: perPage,
            search: currentSearch,
            sort_by: currentSortBy,
            sort_order: currentSortOrder,
            language: currentLanguage,
            encrypted: currentEncryption
        });
        
        const response = await fetch(`/api/admin/pastes?${params}`);
        const data = await response.json();
        
        renderPastesTable(data.pastes);
        renderPagination(data.page, data.total_pages, data.total);
        document.getElementById('totalCount').textContent = data.total;
        if (data.total === 0) {
            document.getElementById('paginationInfo').textContent = 'No pastes found';
        } else {
            const start = (data.page - 1) * data.per_page + 1;
            const end = Math.min(data.page * data.per_page, data.total);
            document.getElementById('paginationInfo').textContent = `Showing ${start}-${end} of ${data.total} pastes`;
        }
    } catch (error) {
        console.error('Failed to load pastes:', error);
        tbody.innerHTML = '<tr><td colspan="10" class="text-center py-4 text-danger"><i class="fas fa-exclamation-triangle me-2"></i>Failed to load pastes</td></tr>';
        showToast('Error', 'Failed to load pastes', 'error');
    }
}

// Render Pastes Table
function renderPastesTable(pastes) {
    const tbody = document.getElementById('pastesTableBody');
    
    if (!pastes || pastes.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="text-center py-4">
                    <div class="empty-state">
                        <i class="fas fa-inbox"></i>
                        <p class="text-purple-light mb-0">No pastes found</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = pastes.map(paste => `
        <tr>
            <td class="text-muted">${paste.index}</td>
            <td><span class="table-key">${escapeHtml(paste.key)}</span></td>
            <td><span class="table-title" title="${escapeHtml(paste.heading)}">${escapeHtml(paste.heading)}</span></td>
            <td><span class="badge bg-secondary">${escapeHtml(paste.language)}</span></td>
            <td><span class="table-date">${formatDate(paste.created_at)}</span></td>
            <td><span class="table-ip">${escapeHtml(paste.ip_address)}</span></td>
            <td><span class="table-views">${paste.open_count}</span></td>
            <td>${getEncryptionBadge(paste.encrypted_with, paste.password_hash)}</td>
            <td>${getExpiryBadge(paste.expires_at)}</td>
            <td>
                <div class="d-flex gap-1">
                    <button class="btn btn-action btn-view" onclick="viewPaste('${escapeHtml(paste.key)}')" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                    <a href="/${escapeHtml(paste.key)}" target="_blank" class="btn btn-action btn-view" title="Open Paste">
                        <i class="fas fa-external-link-alt"></i>
                    </a>
                    <button class="btn btn-action btn-delete" onclick="showDeleteModal('${escapeHtml(paste.key)}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// Render Pagination
function renderPagination(currentPageNum, totalPages, total) {
    const pagination = document.getElementById('pagination');
    
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // Previous
    html += `<li class="page-item ${currentPageNum === 1 ? 'disabled' : ''}">
        <a class="page-link" href="#" onclick="goToPage(${currentPageNum - 1})">&laquo;</a>
    </li>`;
    
    // Page numbers
    const maxVisible = 5;
    let startPage = Math.max(1, currentPageNum - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }
    
    if (startPage > 1) {
        html += `<li class="page-item"><a class="page-link" href="#" onclick="goToPage(1)">1</a></li>`;
        if (startPage > 2) {
            html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<li class="page-item ${i === currentPageNum ? 'active' : ''}">
            <a class="page-link" href="#" onclick="goToPage(${i})">${i}</a>
        </li>`;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            html += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
        }
        html += `<li class="page-item"><a class="page-link" href="#" onclick="goToPage(${totalPages})">${totalPages}</a></li>`;
    }
    
    // Next
    html += `<li class="page-item ${currentPageNum === totalPages ? 'disabled' : ''}">
        <a class="page-link" href="#" onclick="goToPage(${currentPageNum + 1})">&raquo;</a>
    </li>`;
    
    pagination.innerHTML = html;
}

// Go to page
function goToPage(page) {
    currentPage = page;
    loadPastes();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// View Paste Details
async function viewPaste(key) {
    try {
        const response = await fetch(`/api/admin/paste/${key}`);
        const paste = await response.json();
        
        if (paste.error) {
            showToast('Error', paste.error, 'error');
            return;
        }
        
        document.getElementById('modalTitle').textContent = paste.heading || 'Paste Details';
        document.getElementById('modalKey').textContent = paste.key;
        document.getElementById('modalLanguage').textContent = paste.language;
        document.getElementById('modalViews').textContent = paste.open_count;
        document.getElementById('modalCreated').textContent = formatDate(paste.created_at);
        document.getElementById('modalIP').textContent = paste.ip_address || '-';
        document.getElementById('modalEncrypted').innerHTML = getEncryptionBadge(paste.encrypted_with, paste.password_hash);
        document.getElementById('modalExpires').textContent = paste.expires_at ? formatDate(paste.expires_at) : 'Never';
        document.getElementById('modalViewOnce').textContent = paste.view_once ? 'Yes' : 'No';
        document.getElementById('modalMaxViews').textContent = paste.max_views || 'Unlimited';
        document.getElementById('modalDataSize').textContent = formatBytes(paste.data_length);
        document.getElementById('modalContent').textContent = paste.data || '[No content]';
        document.getElementById('modalOpenLink').href = `/${paste.key}`;
        
        const modal = new bootstrap.Modal(document.getElementById('pasteModal'));
        modal.show();
    } catch (error) {
        console.error('Failed to load paste:', error);
        showToast('Error', 'Failed to load paste details', 'error');
    }
}

// Show Delete Modal
function showDeleteModal(key) {
    deleteKey = key;
    document.getElementById('deleteKey').textContent = key;
    const modal = new bootstrap.Modal(document.getElementById('deleteModal'));
    modal.show();
}

// Delete Paste
async function deletePaste(key) {
    const btn = document.getElementById('confirmDeleteBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Deleting...';
    btn.disabled = true;
    
    try {
        const response = await fetch(`/api/admin/paste/${key}`, { method: 'DELETE' });
        const data = await response.json();
        
        if (data.ok) {
            showToast('Success', `Paste ${key} deleted`, 'success');
            loadPastes();
            loadAnalytics();
        } else {
            showToast('Error', data.error || 'Failed to delete paste', 'error');
        }
        
        bootstrap.Modal.getInstance(document.getElementById('deleteModal')).hide();
        bootstrap.Modal.getInstance(document.getElementById('pasteModal'))?.hide();
    } catch (error) {
        console.error('Failed to delete paste:', error);
        showToast('Error', 'Failed to delete paste', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// Delete Expired
async function deleteExpired() {
    const btn = document.getElementById('deleteExpiredBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Cleaning...';
    btn.disabled = true;
    
    try {
        const response = await fetch('/api/admin/delete-expired', { method: 'DELETE' });
        const data = await response.json();
        
        if (data.ok) {
            showToast('Success', data.message || `Deleted ${data.deleted} expired pastes`, 'success');
            loadPastes();
            loadAnalytics();
        } else {
            showToast('Error', data.error || 'Failed to clean expired pastes', 'error');
        }
    } catch (error) {
        console.error('Failed to delete expired:', error);
        showToast('Error', 'Failed to clean expired pastes', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

// Charts
let languageChart = null;
let encryptionChart = null;

function setupCharts() {
    const languageCtx = document.getElementById('languageChart').getContext('2d');
    const encryptionCtx = document.getElementById('encryptionChart').getContext('2d');
    
    Chart.defaults.color = '#a78bfa';
    Chart.defaults.borderColor = 'rgba(139, 92, 246, 0.2)';
    
    languageChart = new Chart(languageCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Pastes',
                data: [],
                backgroundColor: 'rgba(139, 92, 246, 0.6)',
                borderColor: 'rgba(139, 92, 246, 1)',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(139, 92, 246, 0.1)' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
    
    encryptionChart = new Chart(encryptionCtx, {
        type: 'doughnut',
        data: {
            labels: ['Server Encrypted', 'Password Protected', 'None'],
            datasets: [{
                data: [0, 0, 0],
                backgroundColor: [
                    'rgba(34, 197, 94, 0.8)',
                    'rgba(249, 115, 22, 0.8)',
                    'rgba(107, 114, 128, 0.8)'
                ],
                borderColor: [
                    'rgba(34, 197, 94, 1)',
                    'rgba(249, 115, 22, 1)',
                    'rgba(107, 114, 128, 1)'
                ],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 15 }
                }
            }
        }
    });
}

function updateCharts(data) {
    if (data.language_stats && data.language_stats.length > 0) {
        languageChart.data.labels = data.language_stats.map(s => s.language);
        languageChart.data.datasets[0].data = data.language_stats.map(s => s.count);
        languageChart.update();
    }
    
    if (data.encryption_stats) {
        let server = 0, password = 0, none = 0;
        data.encryption_stats.forEach(stat => {
            if (stat._id === 'server') server = stat.count;
            else if (stat._id === 'password') password = stat.count;
            else if (stat._id === null) none = stat.count;
        });
        encryptionChart.data.datasets[0].data = [server, password, none];
        encryptionChart.update();
    }
}

// Helper Functions
function formatDate(epoch) {
    if (!epoch) return '-';
    const date = new Date(epoch * 1000);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatNumber(num) {
    if (num === undefined || num === null) return '-';
    return num.toLocaleString();
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getEncryptionBadge(encryptedWith, hasPasswordHash) {
    if (encryptedWith === 'server') {
        return '<span class="badge badge-encrypted"><i class="fas fa-server me-1"></i>Server</span>';
    } else if (encryptedWith === 'password' || hasPasswordHash) {
        return '<span class="badge badge-password"><i class="fas fa-key me-1"></i>Password</span>';
    }
    return '<span class="badge badge-none"><i class="fas fa-lock-open me-1"></i>None</span>';
}

function getExpiryBadge(expiresAt) {
    if (!expiresAt) return '<span class="badge badge-active">Never</span>';
    
    const now = Math.floor(Date.now() / 1000);
    if (expiresAt < now) {
        return '<span class="badge badge-expired">Expired</span>';
    }
    
    const remaining = expiresAt - now;
    if (remaining < 3600) {
        const mins = Math.floor(remaining / 60);
        return `<span class="badge badge-active">${mins}m left</span>`;
    } else if (remaining < 86400) {
        const hours = Math.floor(remaining / 3600);
        return `<span class="badge badge-active">${hours}h left</span>`;
    } else {
        const days = Math.floor(remaining / 86400);
        return `<span class="badge badge-active">${days}d left</span>`;
    }
}

// Toast Notifications
function showToast(title, message, type = 'info') {
    const toast = document.getElementById('adminToast');
    const toastTitle = document.getElementById('toastTitle');
    const toastBody = document.getElementById('toastBody');
    const toastIcon = document.getElementById('toastIcon');
    
    toastTitle.textContent = title;
    toastBody.textContent = message;
    
    toastIcon.className = 'fas me-2';
    if (type === 'success') {
        toastIcon.classList.add('fa-check-circle', 'text-success');
    } else if (type === 'error') {
        toastIcon.classList.add('fa-exclamation-circle', 'text-danger');
    } else {
        toastIcon.classList.add('fa-info-circle', 'text-info');
    }
    
    const bsToast = new bootstrap.Toast(toast, { delay: 3000 });
    bsToast.show();
}
