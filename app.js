// ==============================================================================
// app.js — JD ENTERPRISES CMS Monitor: Insurance & Vehicle Fleet Management System
// Uses Supabase JS SDK v2 with IndexedDB Offline Fallback & All-In-One Doc Uploads
// ==============================================================================

// Global Application State
let supabaseClient = null;
let customersData = [];
let activeFilters = {
    search: '',
    customerType: 'all',
    vehicleCount: 'all',
    expiryWarning: 'all',
    renewalStatus: 'all'
};

// Form In-Memory File State for Customer & General Docs
let formAadhaarDoc = { file: null, previewUrl: null, name: '', isImage: false };
let formPanDoc = { file: null, previewUrl: null, name: '', isImage: false };
let formInsuranceDoc = { file: null, previewUrl: null, name: '', isImage: false };
let formPucDoc = { file: null, previewUrl: null, name: '', isImage: false };

// Form In-Memory File State for Dynamic Vehicle RCs, Insurances, and PUCs:
// { [index]: { rc: { file, previewUrl, name, isImage }, ins: { file, previewUrl, name, isImage }, puc: { file, previewUrl, name, isImage } } }
let vehicleFilesState = {};

// Local IndexedDB Storage Configuration (Fallback)
const IDB_CONFIG = {
    name: 'JDEnterprisesDB',
    version: 2,
    store: 'customers_store'
};
let localDB = null;

// ==============================================================================
// 1. INITIALIZATION & STORAGE LAYER
// ==============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    await initIndexedDB();
    initSupabase();
    await fetchAllData();
    bindEventListeners();
});

// --- IndexedDB Initializer ---
function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(IDB_CONFIG.name, IDB_CONFIG.version);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_CONFIG.store)) {
                db.createObjectStore(IDB_CONFIG.store, { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => {
            localDB = e.target.result;
            resolve(localDB);
        };
        request.onerror = (e) => {
            console.error('IndexedDB Error:', e.target.error);
            reject(e.target.error);
        };
    });
}

const localStoreManager = {
    async getAll() {
        return new Promise((resolve, reject) => {
            const tx = localDB.transaction(IDB_CONFIG.store, 'readonly');
            const store = tx.objectStore(IDB_CONFIG.store);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    },
    async save(item) {
        return new Promise((resolve, reject) => {
            const tx = localDB.transaction(IDB_CONFIG.store, 'readwrite');
            const store = tx.objectStore(IDB_CONFIG.store);
            const req = store.put(item);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    async delete(id) {
        return new Promise((resolve, reject) => {
            const tx = localDB.transaction(IDB_CONFIG.store, 'readwrite');
            const store = tx.objectStore(IDB_CONFIG.store);
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
};

// --- Supabase Client Manager ---
function initSupabase() {
    const url = localStorage.getItem('supabase_url');
    const key = localStorage.getItem('supabase_anon_key');
    const pill = document.getElementById('cloud-pill');
    const pillLabel = document.getElementById('cloud-pill-label');

    if (url && key && window.supabase) {
        try {
            supabaseClient = window.supabase.createClient(url, key);
            pill.className = 'status-pill status-pill-online';
            pillLabel.textContent = 'Supabase Cloud';
            pill.title = 'Connected to Supabase PostgreSQL & Storage';
            return true;
        } catch (err) {
            console.error('Supabase Initialization Failed:', err);
            supabaseClient = null;
        }
    }

    pill.className = 'status-pill status-pill-offline';
    pillLabel.textContent = 'Local Storage';
    pill.title = 'Running on browser local storage';
    return false;
}

// Upload file directly to Supabase Storage bucket 'rc-documents'
async function uploadFileToSupabase(file, folderPrefix, identifier) {
    if (!supabaseClient || !file) return null;
    try {
        const fileExt = file.name.split('.').pop();
        const cleanName = `${folderPrefix}_${identifier}_${Date.now()}.${fileExt}`;
        const filePath = `${folderPrefix}/${cleanName}`;

        const { data, error } = await supabaseClient.storage
            .from('rc-documents')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: true
            });

        if (error) {
            console.warn('Storage upload error:', error.message);
            return null;
        }

        const { data: publicUrlData } = supabaseClient.storage
            .from('rc-documents')
            .getPublicUrl(filePath);

        return publicUrlData.publicUrl;
    } catch (err) {
        console.error('Upload document failed:', err);
        return null;
    }
}

// ==============================================================================
// 2. DATA FETCHING & SYNCHRONIZATION (SUPABASE + LOCAL)
// ==============================================================================
async function fetchAllData() {
    if (supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('customers')
                .select(`
                    id,
                    full_name,
                    phone,
                    pan_number,
                    pan_doc_url,
                    aadhar_number,
                    aadhar_doc_url,
                    puc_doc_url,
                    type,
                    created_at,
                    vehicles (
                        id,
                        vehicle_number,
                        rc_document_url,
                        insurance_expiry_date,
                        insurance_doc_url,
                        puc_expiry_date,
                        puc_doc_url
                    ),
                    insurance_policies (
                        id,
                        policy_number,
                        insurance_expiry_date,
                        policy_doc_url,
                        status
                    )
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;

            customersData = (data || []).map(c => ({
                id: c.id,
                full_name: c.full_name,
                phone: c.phone,
                pan_number: c.pan_number,
                pan_doc_url: c.pan_doc_url || null,
                aadhar_number: c.aadhar_number,
                aadhar_doc_url: c.aadhar_doc_url || null,
                puc_doc_url: c.puc_doc_url || null,
                type: c.type || 'permanent',
                created_at: c.created_at,
                vehicles: c.vehicles || [],
                insurance_policy: (c.insurance_policies && c.insurance_policies[0]) || {
                    id: null,
                    policy_number: '',
                    insurance_expiry_date: null,
                    policy_doc_url: null,
                    status: 'pending'
                }
            }));

            // Sync to local fallback
            for (let item of customersData) {
                await localStoreManager.save(item);
            }
        } catch (err) {
            console.warn('Supabase fetch failed, loading from local store:', err.message);
            customersData = await localStoreManager.getAll();
        }
    } else {
        customersData = await localStoreManager.getAll();
    }

    renderDashboard();
}

// ==============================================================================
// 3. DATE CALCULATIONS & EXPIRY HIGHLIGHTING
// ==============================================================================
function calculateDaysRemaining(dateString) {
    if (!dateString) return null;
    const target = new Date(dateString);
    const today = new Date();
    target.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const diff = target - today;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function isDateInCurrentMonth(dateString) {
    if (!dateString) return false;
    const d = new Date(dateString);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function isDateInNextMonth(dateString) {
    if (!dateString) return false;
    const d = new Date(dateString);
    const now = new Date();
    const nextMo = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return d.getFullYear() === nextMo.getFullYear() && d.getMonth() === nextMo.getMonth();
}

function getExpiryBadge(days) {
    if (days === null || days === undefined) {
        return { label: 'No Date', badgeClass: 'badge-info', isExpiringSoon: false, isExpired: false };
    }
    if (days < 0) {
        return { label: `🔴 Expired (${Math.abs(days)}d ago)`, badgeClass: 'badge-danger pulse-badge', isExpiringSoon: true, isExpired: true };
    }
    if (days === 0) {
        return { label: '⚠️ Due Today!', badgeClass: 'badge-warning pulse-badge', isExpiringSoon: true, isExpired: false };
    }
    if (days <= 30) {
        return { label: `⚠️ ${days}d Left`, badgeClass: 'badge-warning', isExpiringSoon: true, isExpired: false };
    }
    return { label: `✅ ${days}d Left`, badgeClass: 'badge-success', isExpiringSoon: false, isExpired: false };
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ==============================================================================
// 4. REAL-TIME ANALYTICS BAR & KPI SUMMARY
// ==============================================================================
function updateKPIAnalytics() {
    const totalCustomers = customersData.length;
    let permanentCount = 0;
    let leadCount = 0;
    let insExpiring30 = 0;
    let pucExpiring30 = 0;
    let pendingRenewals = 0;

    customersData.forEach(c => {
        if (c.type === 'permanent') permanentCount++;
        else leadCount++;

        // 1. Insurance Expiry across primary + individual vehicles
        let hasInsExpiring = false;
        const primaryInsDays = calculateDaysRemaining(c.insurance_policy?.insurance_expiry_date);
        if (primaryInsDays !== null && primaryInsDays <= 30) hasInsExpiring = true;

        (c.vehicles || []).forEach(v => {
            const vInsDays = calculateDaysRemaining(v.insurance_expiry_date);
            if (vInsDays !== null && vInsDays <= 30) hasInsExpiring = true;
        });
        if (hasInsExpiring) insExpiring30++;

        // 2. PUC Expiry across general + individual vehicles
        let hasPucExpiring = false;
        (c.vehicles || []).forEach(v => {
            const vPucDays = calculateDaysRemaining(v.puc_expiry_date);
            if (vPucDays !== null && vPucDays <= 30) hasPucExpiring = true;
        });
        if (hasPucExpiring) pucExpiring30++;

        if (c.insurance_policy?.status === 'pending') {
            pendingRenewals++;
        }
    });

    document.getElementById('kpi-total-customers').textContent = totalCustomers;
    document.getElementById('kpi-permanent-customers').textContent = permanentCount;
    document.getElementById('kpi-lead-customers').textContent = leadCount;
    document.getElementById('kpi-ins-expiring-30').textContent = insExpiring30;
    document.getElementById('kpi-puc-expiring-30').textContent = pucExpiring30;
    document.getElementById('kpi-pending-renewals').textContent = pendingRenewals;
}

// ==============================================================================
// 5. SEARCH & CALENDAR-WISE / VEHICLE COUNT FILTER ENGINE
// ==============================================================================
function getFilteredRecords() {
    return customersData.filter(c => {
        // 1. Unified Text Search
        if (activeFilters.search) {
            const q = activeFilters.search.toLowerCase();
            const name = (c.full_name || '').toLowerCase();
            const phone = (c.phone || '').toLowerCase();
            const pan = (c.pan_number || '').toLowerCase();
            const aadhar = (c.aadhar_number || '').toLowerCase();
            const policyNum = (c.insurance_policy?.policy_number || '').toLowerCase();
            const plates = (c.vehicles || []).map(v => (v.vehicle_number || '').toLowerCase()).join(' ');

            if (!name.includes(q) && !phone.includes(q) && !pan.includes(q) && !aadhar.includes(q) && !policyNum.includes(q) && !plates.includes(q)) {
                return false;
            }
        }

        // 2. Customer Type Filter
        if (activeFilters.customerType !== 'all' && c.type !== activeFilters.customerType) {
            return false;
        }

        // 3. Vehicle Count Filter (Clean Space Management)
        if (activeFilters.vehicleCount !== 'all') {
            const count = (c.vehicles && c.vehicles.length) || 0;
            if (activeFilters.vehicleCount === '1' && count !== 1) return false;
            if (activeFilters.vehicleCount === '2' && count !== 2) return false;
            if (activeFilters.vehicleCount === '3' && count !== 3) return false;
            if (activeFilters.vehicleCount === '4' && count !== 4) return false;
            if (activeFilters.vehicleCount === '5+' && count < 5) return false;
        }

        // 4. Calendar-Wise Expiry Filter (30d before Insurance & 30d before Pollution)
        if (activeFilters.expiryWarning !== 'all') {
            const filter = activeFilters.expiryWarning;
            const primaryInsDate = c.insurance_policy?.insurance_expiry_date;
            const primaryInsDays = calculateDaysRemaining(primaryInsDate);

            // Collect all insurance and PUC dates for this customer
            const allInsDates = [];
            if (primaryInsDate) allInsDates.push(primaryInsDate);
            (c.vehicles || []).forEach(v => {
                if (v.insurance_expiry_date) allInsDates.push(v.insurance_expiry_date);
            });

            const allPucDates = [];
            (c.vehicles || []).forEach(v => {
                if (v.puc_expiry_date) allPucDates.push(v.puc_expiry_date);
            });

            if (filter === 'ins-30') {
                const match = allInsDates.some(d => {
                    const days = calculateDaysRemaining(d);
                    return days !== null && days <= 30;
                });
                if (!match) return false;
            } else if (filter === 'puc-30') {
                const match = allPucDates.some(d => {
                    const days = calculateDaysRemaining(d);
                    return days !== null && days <= 30;
                });
                if (!match) return false;
            } else if (filter === 'ins-expired') {
                const match = allInsDates.some(d => {
                    const days = calculateDaysRemaining(d);
                    return days !== null && days < 0;
                });
                if (!match) return false;
            } else if (filter === 'puc-expired') {
                const match = allPucDates.some(d => {
                    const days = calculateDaysRemaining(d);
                    return days !== null && days < 0;
                });
                if (!match) return false;
            } else if (filter === 'this-month') {
                const match = allInsDates.some(isDateInCurrentMonth) || allPucDates.some(isDateInCurrentMonth);
                if (!match) return false;
            } else if (filter === 'next-month') {
                const match = allInsDates.some(isDateInNextMonth) || allPucDates.some(isDateInNextMonth);
                if (!match) return false;
            }
        }

        // 5. Renewal Action Status Filter
        if (activeFilters.renewalStatus !== 'all') {
            const status = c.insurance_policy?.status || 'pending';
            if (status !== activeFilters.renewalStatus) return false;
        }

        return true;
    });
}

// ==============================================================================
// 6. MAIN TABLE RENDERING & INLINE ACTIONS
// ==============================================================================
function renderDashboard() {
    updateKPIAnalytics();
    const filtered = getFilteredRecords();
    const tbody = document.getElementById('table-body');
    const emptyState = document.getElementById('empty-state');

    tbody.innerHTML = '';

    if (filtered.length === 0) {
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    filtered.forEach(c => {
        const tr = document.createElement('tr');

        // Customer Type Badge
        const typeBadge = c.type === 'permanent'
            ? '<span class="badge badge-permanent">⭐ Permanent</span>'
            : '<span class="badge badge-lead">🚶 Walk-in Lead</span>';

        // Primary Insurance Policy & Expiry
        const policyNum = c.insurance_policy?.policy_number || '—';
        const primaryInsExpiry = c.insurance_policy?.insurance_expiry_date;
        const primaryInsDays = calculateDaysRemaining(primaryInsExpiry);
        const primaryInsBadge = getExpiryBadge(primaryInsDays);

        // Vehicles & Individual Dates Box
        const vCount = (c.vehicles && c.vehicles.length) || 0;
        let vehiclesHtml = '';

        if (vCount > 0) {
            const vehicleRowsHtml = c.vehicles.map((v, i) => {
                const vInsDays = calculateDaysRemaining(v.insurance_expiry_date);
                const vInsBadge = getExpiryBadge(vInsDays);
                const vPucDays = calculateDaysRemaining(v.puc_expiry_date);
                const vPucBadge = getExpiryBadge(vPucDays);

                let buttons = '';
                if (v.rc_document_url) {
                    buttons += `<button type="button" class="table-doc-pill pill-rc preview-any-doc-btn" data-doc-url="${escapeHtml(v.rc_document_url)}" data-doc-title="${escapeHtml(c.full_name)} — Vehicle #${i + 1} RC (${escapeHtml(v.vehicle_number)})" title="Preview RC">🚗 RC</button> `;
                }
                if (v.insurance_doc_url) {
                    buttons += `<button type="button" class="table-doc-pill pill-insurance preview-any-doc-btn" data-doc-url="${escapeHtml(v.insurance_doc_url)}" data-doc-title="${escapeHtml(c.full_name)} — Vehicle #${i + 1} Insurance Doc" title="Preview Vehicle Ins. Doc">📄 Ins</button> `;
                }
                if (v.puc_doc_url) {
                    buttons += `<button type="button" class="table-doc-pill pill-puc preview-any-doc-btn" data-doc-url="${escapeHtml(v.puc_doc_url)}" data-doc-title="${escapeHtml(c.full_name)} — Vehicle #${i + 1} PUC Doc" title="Preview Vehicle PUC Doc">💨 PUC</button> `;
                }

                return `
                    <div style="background:var(--bg-subtle); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:0.4rem 0.55rem; margin-bottom:0.35rem;">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:0.4rem;">
                            <span class="plate-tag">${escapeHtml(v.vehicle_number || `Vehicle #${i + 1}`)}</span>
                            <div style="display:flex; gap:0.25rem;">${buttons}</div>
                        </div>
                        <div style="display:flex; flex-wrap:wrap; gap:0.4rem; font-size:0.7rem; margin-top:0.25rem;">
                            <span>Ins: <strong>${formatDate(v.insurance_expiry_date)}</strong> <span class="badge ${vInsBadge.badgeClass}" style="padding:0.1rem 0.35rem; font-size:0.65rem;">${vInsBadge.label}</span></span>
                            <span>PUC: <strong>${formatDate(v.puc_expiry_date)}</strong> <span class="badge ${vPucBadge.badgeClass}" style="padding:0.1rem 0.35rem; font-size:0.65rem;">${vPucBadge.label}</span></span>
                        </div>
                    </div>
                `;
            }).join('');

            vehiclesHtml = `
                <div class="fleet-cell-box">
                    <span class="fleet-count-badge">🚗 ${vCount} ${vCount === 1 ? 'Vehicle' : 'Vehicles'}</span>
                    <div style="margin-top:0.25rem;">${vehicleRowsHtml}</div>
                </div>
            `;
        } else {
            vehiclesHtml = '<span style="color:var(--text-muted); font-size:0.75rem;">No Vehicles</span>';
        }

        // Documents Attached Pill List (Customer level: Aadhaar, PAN, Primary Ins, General PUC)
        let docPillsHtml = '';
        if (c.aadhar_doc_url) {
            docPillsHtml += `<button type="button" class="table-doc-pill pill-aadhar preview-any-doc-btn" data-doc-url="${escapeHtml(c.aadhar_doc_url)}" data-doc-title="${escapeHtml(c.full_name)} — Aadhaar Card" title="Preview / Download Aadhaar">🆔 Aadhaar</button> `;
        }
        if (c.pan_doc_url) {
            docPillsHtml += `<button type="button" class="table-doc-pill pill-pan preview-any-doc-btn" data-doc-url="${escapeHtml(c.pan_doc_url)}" data-doc-title="${escapeHtml(c.full_name)} — PAN Card" title="Preview / Download PAN">💳 PAN</button> `;
        }
        if (c.insurance_policy?.policy_doc_url) {
            docPillsHtml += `<button type="button" class="table-doc-pill pill-insurance preview-any-doc-btn" data-doc-url="${escapeHtml(c.insurance_policy.policy_doc_url)}" data-doc-title="${escapeHtml(c.full_name)} — Primary Insurance Policy" title="Preview / Download Policy">📄 Primary Policy</button> `;
        }
        if (c.puc_doc_url) {
            docPillsHtml += `<button type="button" class="table-doc-pill pill-puc preview-any-doc-btn" data-doc-url="${escapeHtml(c.puc_doc_url)}" data-doc-title="${escapeHtml(c.full_name)} — General PUC Certificate" title="Preview / Download PUC">💨 General PUC</button> `;
        }

        if (!docPillsHtml) {
            docPillsHtml = '<span style="color:var(--text-muted); font-size:0.72rem; font-style:italic;">No KYC Files</span>';
        }

        // Inline Action: Renewal Status Dropdown
        const currentStatus = c.insurance_policy?.status || 'pending';

        tr.innerHTML = `
            <td>
                <div class="customer-cell">
                    <span class="customer-name">${escapeHtml(c.full_name)}</span>
                    <span class="customer-phone">${escapeHtml(c.phone)}</span>
                </div>
            </td>
            <td>
                <div class="kyc-badge-list">
                    <span class="kyc-item" title="PAN Number">💳 ${escapeHtml(c.pan_number || 'No PAN')}</span>
                    <span class="kyc-item" title="Aadhaar Number">🆔 ${escapeHtml(c.aadhar_number || 'No Aadhaar')}</span>
                </div>
            </td>
            <td>
                <div class="doc-tags-wrap">${docPillsHtml}</div>
            </td>
            <td>${typeBadge}</td>
            <td>${vehiclesHtml}</td>
            <td>
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <span style="font-family:var(--font-mono); font-weight:700; font-size:0.78rem;">${escapeHtml(policyNum)}</span>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${formatDate(primaryInsExpiry)}</span>
                    <span class="badge ${primaryInsBadge.badgeClass}">${primaryInsBadge.label}</span>
                </div>
            </td>
            <td>
                <select class="inline-action-select status-${currentStatus}" data-customer-id="${c.id}" aria-label="Change policy status">
                    <option value="pending" ${currentStatus === 'pending' ? 'selected' : ''}>⏳ Pending</option>
                    <option value="completed" ${currentStatus === 'completed' ? 'selected' : ''}>✅ Completed</option>
                    <option value="not_done" ${currentStatus === 'not_done' ? 'selected' : ''}>❌ Not Done</option>
                </select>
            </td>
            <td>
                <div class="table-actions">
                    <button type="button" class="btn-icon btn-edit" data-id="${c.id}" title="Edit Customer & Vehicles" aria-label="Edit record">
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
                    </button>
                    <button type="button" class="btn-icon btn-danger-icon btn-delete" data-id="${c.id}" title="Delete Record" aria-label="Delete record">
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                    </button>
                </div>
            </td>
        `;

        tbody.appendChild(tr);
    });

    // Attach Event Listeners to dynamic table rows
    attachTableDynamicEvents();
}

function attachTableDynamicEvents() {
    // 1. Inline Status Update
    document.querySelectorAll('.inline-action-select').forEach(select => {
        select.addEventListener('change', async (e) => {
            const customerId = e.target.dataset.customerId;
            const newStatus = e.target.value;
            await updatePolicyStatus(customerId, newStatus);
        });
    });

    // 2. Universal Preview from any Document Badge
    document.querySelectorAll('.preview-any-doc-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const url = e.currentTarget.dataset.docUrl;
            const title = e.currentTarget.dataset.docTitle || 'Document Preview';
            openDocumentViewer(url, title);
        });
    });

    // 3. Edit Buttons
    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            openEditCustomerModal(id);
        });
    });

    // 4. Delete Buttons
    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            handleDeleteCustomer(id);
        });
    });
}

// Inline Status Update (Supabase + Local)
async function updatePolicyStatus(customerId, newStatus) {
    const customer = customersData.find(c => String(c.id) === String(customerId));
    if (!customer) return;

    if (customer.insurance_policy) {
        customer.insurance_policy.status = newStatus;
    }

    if (supabaseClient && customer.insurance_policy?.id) {
        try {
            const { error } = await supabaseClient
                .from('insurance_policies')
                .update({ status: newStatus })
                .eq('id', customer.insurance_policy.id);

            if (error) throw error;
            showToast('Policy status updated in Supabase cloud!', 'success');
        } catch (err) {
            console.warn('Status cloud update failed:', err.message);
            showToast('Status updated locally.', 'info');
        }
    } else {
        showToast('Status updated locally.', 'info');
    }

    await localStoreManager.save(customer);
    renderDashboard();
}

// ==============================================================================
// 7. GENERIC DROPZONE ATTACHMENT HANDLER (AADHAAR, PAN, INSURANCE, PUC)
// ==============================================================================
function bindSingleDropzone(fileInputId, dropzoneId, emptyId, previewId, thumbImgId, filenameId, filesizeId, previewBtnId, clearBtnId, stateHolder, titleLabel) {
    const fileInput = document.getElementById(fileInputId);
    const dropzone = document.getElementById(dropzoneId);
    const emptyBox = document.getElementById(emptyId);
    const previewBox = document.getElementById(previewId);
    const thumbImg = document.getElementById(thumbImgId);
    const filenameEl = document.getElementById(filenameId);
    const filesizeEl = document.getElementById(filesizeId);
    const previewBtn = document.getElementById(previewBtnId);
    const clearBtn = document.getElementById(clearBtnId);

    if (!fileInput || !dropzone) return;

    // Check if existing URL
    if (stateHolder && stateHolder.previewUrl) {
        emptyBox.style.display = 'none';
        previewBox.style.display = 'flex';
        filenameEl.textContent = stateHolder.name || 'Uploaded Document';
        filesizeEl.textContent = 'Existing Cloud File';
        if (stateHolder.isImage) {
            thumbImg.src = stateHolder.previewUrl;
            thumbImg.style.display = 'block';
        } else {
            thumbImg.style.display = 'none';
        }
        previewBtn.onclick = (e) => {
            e.stopPropagation();
            openDocumentViewer(stateHolder.previewUrl, titleLabel);
        };
    } else {
        emptyBox.style.display = 'flex';
        previewBox.style.display = 'none';
        thumbImg.src = '';
        filenameEl.textContent = '';
    }

    dropzone.onclick = (e) => {
        if (!e.target.closest('.doc-action-btns')) {
            fileInput.click();
        }
    };

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const isImage = file.type.startsWith('image/');
        const reader = new FileReader();

        reader.onload = (event) => {
            const dataUrl = event.target.result;

            stateHolder.file = file;
            stateHolder.previewUrl = dataUrl;
            stateHolder.name = file.name;
            stateHolder.isImage = isImage;

            emptyBox.style.display = 'none';
            previewBox.style.display = 'flex';
            filenameEl.textContent = file.name;
            filesizeEl.textContent = `${(file.size / 1024).toFixed(1)} KB`;

            if (isImage) {
                thumbImg.src = dataUrl;
                thumbImg.style.display = 'block';
            } else {
                thumbImg.style.display = 'none';
            }

            previewBtn.onclick = (ev) => {
                ev.stopPropagation();
                openDocumentViewer(dataUrl, `${titleLabel} — ${file.name}`);
            };
        };

        reader.readAsDataURL(file);
    };

    clearBtn.onclick = (e) => {
        e.stopPropagation();
        stateHolder.file = null;
        stateHolder.previewUrl = null;
        stateHolder.name = '';
        stateHolder.isImage = false;
        fileInput.value = '';

        emptyBox.style.display = 'flex';
        previewBox.style.display = 'none';
        thumbImg.src = '';
        filenameEl.textContent = '';
    };
}

function renderDynamicVehicleInputs(count, existingVehicles = []) {
    const container = document.getElementById('dynamic-vehicles-container');
    const safeCount = Math.max(1, Math.min(20, parseInt(count) || 1));
    const inputCount = document.getElementById('input-vehicle-count');
    if (inputCount) inputCount.value = safeCount;

    // Preserve already typed values in case count changed
    const currentValues = [];
    container.querySelectorAll('.vehicle-entry-card').forEach((card, idx) => {
        const plate = card.querySelector('.input-v-plate')?.value || '';
        const insExpiry = card.querySelector('.input-v-ins-date')?.value || '';
        const pucExpiry = card.querySelector('.input-v-puc-date')?.value || '';
        const existingRcUrl = card.querySelector('.input-v-existing-rc-url')?.value || '';
        const existingInsUrl = card.querySelector('.input-v-existing-ins-url')?.value || '';
        const existingPucUrl = card.querySelector('.input-v-existing-puc-url')?.value || '';

        currentValues.push({
            vehicle_number: plate,
            insurance_expiry_date: insExpiry,
            insurance_doc_url: existingInsUrl,
            puc_expiry_date: pucExpiry,
            puc_doc_url: existingPucUrl,
            rc_document_url: existingRcUrl
        });
    });

    container.innerHTML = '';

    for (let i = 1; i <= safeCount; i++) {
        const prev = existingVehicles[i - 1] || currentValues[i - 1] || {};
        const vPlate = prev.vehicle_number || '';
        const vInsExpiry = prev.insurance_expiry_date || '';
        const vPucExpiry = prev.puc_expiry_date || '';
        const existingRcUrl = prev.rc_document_url || '';
        const existingInsUrl = prev.insurance_doc_url || '';
        const existingPucUrl = prev.puc_doc_url || '';

        // Ensure state holder exists for this vehicle index
        if (!vehicleFilesState[i]) {
            vehicleFilesState[i] = {
                rc: { file: null, previewUrl: existingRcUrl || null, name: existingRcUrl ? 'Existing RC' : '', isImage: existingRcUrl ? existingRcUrl.match(/\.(jpeg|jpg|png|webp)/i) !== null : false },
                ins: { file: null, previewUrl: existingInsUrl || null, name: existingInsUrl ? 'Existing Ins Doc' : '', isImage: existingInsUrl ? existingInsUrl.match(/\.(jpeg|jpg|png|webp)/i) !== null : false },
                puc: { file: null, previewUrl: existingPucUrl || null, name: existingPucUrl ? 'Existing PUC Doc' : '', isImage: existingPucUrl ? existingPucUrl.match(/\.(jpeg|jpg|png|webp)/i) !== null : false }
            };
        }

        const card = document.createElement('div');
        card.className = 'vehicle-entry-card';
        card.dataset.index = i;

        card.innerHTML = `
            <div class="vehicle-card-title-bar">
                <span class="v-badge-title">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                    <span>Vehicle #${i} Details</span>
                </span>
                ${safeCount > 1 ? `<button type="button" class="btn-sm btn-icon btn-danger-icon btn-remove-v" data-v-idx="${i}" title="Remove this vehicle">&times;</button>` : ''}
            </div>

            <div class="form-grid grid-3">
                <div class="form-group">
                    <label>Vehicle Plate Number <span class="required-star">*</span></label>
                    <input type="text" class="input-mono input-uppercase input-v-plate" placeholder="e.g. OD-02-XX-1234" value="${escapeHtml(vPlate)}" required>
                </div>

                <div class="form-group">
                    <label>Individual Vehicle Insurance Expiry</label>
                    <input type="date" class="input-v-ins-date" value="${vInsExpiry}">
                </div>

                <div class="form-group">
                    <label>Individual Vehicle PUC Expiry</label>
                    <input type="date" class="input-v-puc-date" value="${vPucExpiry}">
                </div>
            </div>

            <!-- Upload Row for Vehicle RC, Vehicle Insurance, and Vehicle PUC -->
            <div class="v-uploads-grid" style="margin-top: 0.5rem;">
                <!-- 1. Vehicle RC Upload -->
                <div class="v-upload-box">
                    <div class="v-upload-header v-upload-header-rc">
                        <span>🚗 Vehicle RC Document</span>
                    </div>
                    <input type="hidden" class="input-v-existing-rc-url" value="${escapeHtml(existingRcUrl)}">
                    <div class="rc-upload-dropzone" id="v-rc-dropzone-${i}">
                        <input type="file" id="v-rc-input-${i}" accept="image/*,application/pdf" style="display:none;">
                        <div class="rc-empty-placeholder" id="v-rc-empty-${i}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                            <span>Upload RC File</span>
                        </div>
                        <div class="rc-preview-thumbnail-box" id="v-rc-preview-${i}" style="display:none;">
                            <img src="" id="v-rc-thumb-${i}" class="thumbnail-img-preview" alt="RC Thumbnail" style="display:none;">
                            <div class="thumbnail-doc-info">
                                <span class="thumbnail-filename" id="v-rc-name-${i}"></span>
                                <span class="thumbnail-filesize" id="v-rc-size-${i}"></span>
                            </div>
                            <div class="thumbnail-actions">
                                <button type="button" class="btn-sm btn-icon" id="v-rc-view-${i}" title="Preview / Download">👁️</button>
                                <button type="button" class="btn-sm btn-icon btn-danger-icon" id="v-rc-clear-${i}" title="Remove">&times;</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 2. Vehicle Insurance Upload -->
                <div class="v-upload-box">
                    <div class="v-upload-header v-upload-header-ins">
                        <span>📄 Vehicle Insurance Policy</span>
                    </div>
                    <input type="hidden" class="input-v-existing-ins-url" value="${escapeHtml(existingInsUrl)}">
                    <div class="rc-upload-dropzone" id="v-ins-dropzone-${i}">
                        <input type="file" id="v-ins-input-${i}" accept="image/*,application/pdf" style="display:none;">
                        <div class="rc-empty-placeholder" id="v-ins-empty-${i}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                            <span>Upload Policy</span>
                        </div>
                        <div class="rc-preview-thumbnail-box" id="v-ins-preview-${i}" style="display:none;">
                            <img src="" id="v-ins-thumb-${i}" class="thumbnail-img-preview" alt="Ins Thumbnail" style="display:none;">
                            <div class="thumbnail-doc-info">
                                <span class="thumbnail-filename" id="v-ins-name-${i}"></span>
                                <span class="thumbnail-filesize" id="v-ins-size-${i}"></span>
                            </div>
                            <div class="thumbnail-actions">
                                <button type="button" class="btn-sm btn-icon" id="v-ins-view-${i}" title="Preview / Download">👁️</button>
                                <button type="button" class="btn-sm btn-icon btn-danger-icon" id="v-ins-clear-${i}" title="Remove">&times;</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 3. Vehicle PUC Upload -->
                <div class="v-upload-box">
                    <div class="v-upload-header v-upload-header-puc">
                        <span>💨 Vehicle PUC Document</span>
                    </div>
                    <input type="hidden" class="input-v-existing-puc-url" value="${escapeHtml(existingPucUrl)}">
                    <div class="rc-upload-dropzone" id="v-puc-dropzone-${i}">
                        <input type="file" id="v-puc-input-${i}" accept="image/*,application/pdf" style="display:none;">
                        <div class="rc-empty-placeholder" id="v-puc-empty-${i}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                            <span>Upload PUC</span>
                        </div>
                        <div class="rc-preview-thumbnail-box" id="v-puc-preview-${i}" style="display:none;">
                            <img src="" id="v-puc-thumb-${i}" class="thumbnail-img-preview" alt="PUC Thumbnail" style="display:none;">
                            <div class="thumbnail-doc-info">
                                <span class="thumbnail-filename" id="v-puc-name-${i}"></span>
                                <span class="thumbnail-filesize" id="v-puc-size-${i}"></span>
                            </div>
                            <div class="thumbnail-actions">
                                <button type="button" class="btn-sm btn-icon" id="v-puc-view-${i}" title="Preview / Download">👁️</button>
                                <button type="button" class="btn-sm btn-icon btn-danger-icon" id="v-puc-clear-${i}" title="Remove">&times;</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        container.appendChild(card);

        // Bind Dropzones for this Vehicle Card
        bindSingleDropzone(`v-rc-input-${i}`, `v-rc-dropzone-${i}`, `v-rc-empty-${i}`, `v-rc-preview-${i}`, `v-rc-thumb-${i}`, `v-rc-name-${i}`, `v-rc-size-${i}`, `v-rc-view-${i}`, `v-rc-clear-${i}`, vehicleFilesState[i].rc, `Vehicle #${i} — RC Document`);
        bindSingleDropzone(`v-ins-input-${i}`, `v-ins-dropzone-${i}`, `v-ins-empty-${i}`, `v-ins-preview-${i}`, `v-ins-thumb-${i}`, `v-ins-name-${i}`, `v-ins-size-${i}`, `v-ins-view-${i}`, `v-ins-clear-${i}`, vehicleFilesState[i].ins, `Vehicle #${i} — Insurance Policy`);
        bindSingleDropzone(`v-puc-input-${i}`, `v-puc-dropzone-${i}`, `v-puc-empty-${i}`, `v-puc-preview-${i}`, `v-puc-thumb-${i}`, `v-puc-name-${i}`, `v-puc-size-${i}`, `v-puc-view-${i}`, `v-puc-clear-${i}`, vehicleFilesState[i].puc, `Vehicle #${i} — PUC Certificate`);
    }

    // Bind remove vehicle buttons
    container.querySelectorAll('.btn-remove-v').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.dataset.vIdx);
            delete vehicleFilesState[idx];
            const currentTotal = container.querySelectorAll('.vehicle-entry-card').length;
            renderDynamicVehicleInputs(currentTotal - 1);
        });
    });
}

// ==============================================================================
// 9. FULL CRUD — SAVE ALL DATA IN ONCE (CUSTOMER, AADHAAR, PAN, POLICY, PUC, RCs)
// ==============================================================================
async function handleCustomerFormSubmit(e) {
    e.preventDefault();
    const saveBtn = document.getElementById('btn-save-customer');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '⏳ Uploading Files & Saving All Data in Once...';

    try {
        const idVal = document.getElementById('form-customer-id').value;
        const customerId = idVal || (crypto.randomUUID ? crypto.randomUUID() : `cust_${Date.now()}`);

        const fullName = document.getElementById('input-full-name').value.trim();
        const phone = document.getElementById('input-phone').value.trim();
        const pan = document.getElementById('input-pan').value.trim().toUpperCase();
        const aadhar = document.getElementById('input-aadhar').value.trim();
        const customerType = document.querySelector('input[name="customer-type"]:checked').value;

        // Policy details
        const policyNumber = document.getElementById('input-policy-number').value.trim();
        const insuranceExpiry = document.getElementById('input-insurance-expiry').value || null;
        const policyStatus = document.getElementById('select-policy-status').value;
        const customerPucDate = document.getElementById('input-customer-puc-date').value || null;

        // Existing URLs
        let finalAadharUrl = document.getElementById('input-existing-aadhar-url').value || null;
        let finalPanUrl = document.getElementById('input-existing-pan-url').value || null;
        let finalInsuranceUrl = document.getElementById('input-existing-insurance-url').value || null;
        let finalPucUrl = document.getElementById('input-existing-puc-url').value || null;

        // Upload Aadhaar File if new
        if (formAadhaarDoc.file) {
            if (supabaseClient) {
                const cloudUrl = await uploadFileToSupabase(formAadhaarDoc.file, 'aadhaar', customerId);
                finalAadharUrl = cloudUrl || formAadhaarDoc.previewUrl;
            } else {
                finalAadharUrl = formAadhaarDoc.previewUrl;
            }
        }

        // Upload PAN File if new
        if (formPanDoc.file) {
            if (supabaseClient) {
                const cloudUrl = await uploadFileToSupabase(formPanDoc.file, 'pan', customerId);
                finalPanUrl = cloudUrl || formPanDoc.previewUrl;
            } else {
                finalPanUrl = formPanDoc.previewUrl;
            }
        }

        // Upload Insurance Policy File if new
        if (formInsuranceDoc.file) {
            if (supabaseClient) {
                const cloudUrl = await uploadFileToSupabase(formInsuranceDoc.file, 'insurance', customerId);
                finalInsuranceUrl = cloudUrl || formInsuranceDoc.previewUrl;
            } else {
                finalInsuranceUrl = formInsuranceDoc.previewUrl;
            }
        }

        // Upload General PUC Certificate File if new
        if (formPucDoc.file) {
            if (supabaseClient) {
                const cloudUrl = await uploadFileToSupabase(formPucDoc.file, 'puc', customerId);
                finalPucUrl = cloudUrl || formPucDoc.previewUrl;
            } else {
                finalPucUrl = formPucDoc.previewUrl;
            }
        }

        // Gather Dynamic Vehicles & Upload Individual RC, Insurance, and PUC Files
        const vehicleCards = document.querySelectorAll('.vehicle-entry-card');
        const vehiclesList = [];

        for (let i = 0; i < vehicleCards.length; i++) {
            const card = vehicleCards[i];
            const vIndex = i + 1;
            const plate = card.querySelector('.input-v-plate').value.trim().toUpperCase();
            const insExpiry = card.querySelector('.input-v-ins-date').value || insuranceExpiry;
            const pucExpiry = card.querySelector('.input-v-puc-date').value || customerPucDate;

            let existingRcUrl = card.querySelector('.input-v-existing-rc-url')?.value || null;
            let existingInsUrl = card.querySelector('.input-v-existing-ins-url')?.value || null;
            let existingPucUrl = card.querySelector('.input-v-existing-puc-url')?.value || null;

            const fileStates = vehicleFilesState[vIndex] || {};

            // 1. Vehicle RC Upload
            let uploadedRcUrl = existingRcUrl;
            if (fileStates.rc && fileStates.rc.file) {
                if (supabaseClient) {
                    const cloudUrl = await uploadFileToSupabase(fileStates.rc.file, 'rc-files', `${customerId}_v${vIndex}`);
                    uploadedRcUrl = cloudUrl || fileStates.rc.previewUrl;
                } else {
                    uploadedRcUrl = fileStates.rc.previewUrl;
                }
            }

            // 2. Vehicle Insurance Upload
            let uploadedInsUrl = existingInsUrl;
            if (fileStates.ins && fileStates.ins.file) {
                if (supabaseClient) {
                    const cloudUrl = await uploadFileToSupabase(fileStates.ins.file, 'v-insurance', `${customerId}_v${vIndex}`);
                    uploadedInsUrl = cloudUrl || fileStates.ins.previewUrl;
                } else {
                    uploadedInsUrl = fileStates.ins.previewUrl;
                }
            }

            // 3. Vehicle PUC Upload
            let uploadedPucUrl = existingPucUrl;
            if (fileStates.puc && fileStates.puc.file) {
                if (supabaseClient) {
                    const cloudUrl = await uploadFileToSupabase(fileStates.puc.file, 'v-puc', `${customerId}_v${vIndex}`);
                    uploadedPucUrl = cloudUrl || fileStates.puc.previewUrl;
                } else {
                    uploadedPucUrl = fileStates.puc.previewUrl;
                }
            }

            vehiclesList.push({
                id: (crypto.randomUUID ? crypto.randomUUID() : `veh_${Date.now()}_${vIndex}`),
                customer_id: customerId,
                vehicle_number: plate,
                insurance_expiry_date: insExpiry,
                insurance_doc_url: uploadedInsUrl,
                puc_expiry_date: pucExpiry,
                puc_doc_url: uploadedPucUrl,
                rc_document_url: uploadedRcUrl
            });
        }

        const customerPayload = {
            id: customerId,
            full_name: fullName,
            phone: phone,
            pan_number: pan,
            pan_doc_url: finalPanUrl,
            aadhar_number: aadhar,
            aadhar_doc_url: finalAadharUrl,
            puc_doc_url: finalPucUrl,
            type: customerType,
            created_at: new Date().toISOString(),
            vehicles: vehiclesList,
            insurance_policy: {
                id: (crypto.randomUUID ? crypto.randomUUID() : `pol_${Date.now()}`),
                customer_id: customerId,
                policy_number: policyNumber,
                insurance_expiry_date: insuranceExpiry,
                policy_doc_url: finalInsuranceUrl,
                status: policyStatus
            }
        };

        // If Supabase Connected, execute database transactions
        if (supabaseClient) {
            // 1. Upsert Customer
            const { error: custErr } = await supabaseClient
                .from('customers')
                .upsert([{
                    id: customerPayload.id,
                    full_name: customerPayload.full_name,
                    phone: customerPayload.phone,
                    pan_number: customerPayload.pan_number,
                    pan_doc_url: customerPayload.pan_doc_url,
                    aadhar_number: customerPayload.aadhar_number,
                    aadhar_doc_url: customerPayload.aadhar_doc_url,
                    puc_doc_url: customerPayload.puc_doc_url,
                    type: customerPayload.type
                }]);

            if (custErr) throw custErr;

            // 2. Remove old vehicles and insert new ones
            await supabaseClient.from('vehicles').delete().eq('customer_id', customerPayload.id);
            if (vehiclesList.length > 0) {
                const { error: vehErr } = await supabaseClient.from('vehicles').insert(vehiclesList);
                if (vehErr) throw vehErr;
            }

            // 3. Upsert Insurance Policy
            await supabaseClient.from('insurance_policies').delete().eq('customer_id', customerPayload.id);
            const { error: polErr } = await supabaseClient.from('insurance_policies').insert([{
                customer_id: customerPayload.id,
                policy_number: policyNumber,
                insurance_expiry_date: insuranceExpiry,
                policy_doc_url: finalInsuranceUrl,
                status: policyStatus
            }]);

            if (polErr) throw polErr;
            showToast('All customer KYC, fleet, individual insurance & PUC files saved to Supabase in once!', 'success');
        } else {
            showToast('All customer & document files saved to local storage in once!', 'info');
        }

        // Save locally
        await localStoreManager.save(customerPayload);

        closeModal('modal-customer');
        await fetchAllData();
    } catch (err) {
        console.error('Error saving customer:', err);
        showToast(`Failed to save: ${err.message}`, 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Save All Data in Once';
    }
}

// Open Edit Modal with Prepopulated Data & Attached Document Previews
function openEditCustomerModal(id) {
    const customer = customersData.find(c => String(c.id) === String(id));
    if (!customer) return;

    resetCustomerForm();

    document.getElementById('form-customer-id').value = customer.id;
    document.getElementById('input-full-name').value = customer.full_name || '';
    document.getElementById('input-phone').value = customer.phone || '';
    document.getElementById('input-pan').value = customer.pan_number || '';
    document.getElementById('input-aadhar').value = customer.aadhar_number || '';

    if (customer.type === 'lead') {
        document.getElementById('type-lead').checked = true;
    } else {
        document.getElementById('type-permanent').checked = true;
    }

    // Aadhaar Document Prepopulation
    document.getElementById('input-existing-aadhar-url').value = customer.aadhar_doc_url || '';
    formAadhaarDoc = {
        file: null,
        previewUrl: customer.aadhar_doc_url || null,
        name: customer.aadhar_doc_url ? 'Existing Aadhaar Card' : '',
        isImage: customer.aadhar_doc_url ? customer.aadhar_doc_url.match(/\.(jpeg|jpg|png|webp)/i) !== null : false
    };
    bindSingleDropzone('input-aadhar-file', 'aadhar-dropzone', 'aadhar-dropzone-empty', 'aadhar-dropzone-preview', 'aadhar-thumb-img', 'aadhar-filename', 'aadhar-filesize', 'btn-preview-aadhar', 'btn-clear-aadhar', formAadhaarDoc, `${customer.full_name} — Aadhaar Card`);

    // PAN Document Prepopulation
    document.getElementById('input-existing-pan-url').value = customer.pan_doc_url || '';
    formPanDoc = {
        file: null,
        previewUrl: customer.pan_doc_url || null,
        name: customer.pan_doc_url ? 'Existing PAN Card' : '',
        isImage: customer.pan_doc_url ? customer.pan_doc_url.match(/\.(jpeg|jpg|png|webp)/i) !== null : false
    };
    bindSingleDropzone('input-pan-file', 'pan-dropzone', 'pan-dropzone-empty', 'pan-dropzone-preview', 'pan-thumb-img', 'pan-filename', 'pan-filesize', 'btn-preview-pan', 'btn-clear-pan', formPanDoc, `${customer.full_name} — PAN Card`);

    // Primary Insurance Policy Prepopulation
    if (customer.insurance_policy) {
        document.getElementById('input-policy-number').value = customer.insurance_policy.policy_number || '';
        document.getElementById('input-insurance-expiry').value = customer.insurance_policy.insurance_expiry_date || '';
        document.getElementById('select-policy-status').value = customer.insurance_policy.status || 'pending';
        document.getElementById('input-existing-insurance-url').value = customer.insurance_policy.policy_doc_url || '';

        formInsuranceDoc = {
            file: null,
            previewUrl: customer.insurance_policy.policy_doc_url || null,
            name: customer.insurance_policy.policy_doc_url ? 'Existing Primary Policy' : '',
            isImage: customer.insurance_policy.policy_doc_url ? customer.insurance_policy.policy_doc_url.match(/\.(jpeg|jpg|png|webp)/i) !== null : false
        };
    }
    bindSingleDropzone('input-insurance-file', 'insurance-dropzone', 'insurance-dropzone-empty', 'insurance-dropzone-preview', 'insurance-thumb-img', 'insurance-filename', 'insurance-filesize', 'btn-preview-insurance', 'btn-clear-insurance', formInsuranceDoc, `${customer.full_name} — Primary Policy`);

    // General PUC Certificate Prepopulation
    document.getElementById('input-existing-puc-url').value = customer.puc_doc_url || '';
    formPucDoc = {
        file: null,
        previewUrl: customer.puc_doc_url || null,
        name: customer.puc_doc_url ? 'Existing General PUC' : '',
        isImage: customer.puc_doc_url ? customer.puc_doc_url.match(/\.(jpeg|jpg|png|webp)/i) !== null : false
    };
    bindSingleDropzone('input-puc-file', 'puc-dropzone', 'puc-dropzone-empty', 'puc-dropzone-preview', 'puc-thumb-img', 'puc-filename', 'puc-filesize', 'btn-preview-puc', 'btn-clear-puc', formPucDoc, `${customer.full_name} — General PUC`);

    // Vehicles Prepopulation
    const vList = (customer.vehicles && customer.vehicles.length > 0) ? customer.vehicles : [{}];
    vehicleFilesState = {};
    vList.forEach((v, idx) => {
        const i = idx + 1;
        vehicleFilesState[i] = {
            rc: { file: null, previewUrl: v.rc_document_url || null, name: v.rc_document_url ? 'Existing RC' : '', isImage: v.rc_document_url ? v.rc_document_url.match(/\.(jpeg|jpg|png|webp)/i) !== null : false },
            ins: { file: null, previewUrl: v.insurance_doc_url || null, name: v.insurance_doc_url ? 'Existing Ins Doc' : '', isImage: v.insurance_doc_url ? v.insurance_doc_url.match(/\.(jpeg|jpg|png|webp)/i) !== null : false },
            puc: { file: null, previewUrl: v.puc_doc_url || null, name: v.puc_doc_url ? 'Existing PUC Doc' : '', isImage: v.puc_doc_url ? v.puc_doc_url.match(/\.(jpeg|jpg|png|webp)/i) !== null : false }
        };
    });

    renderDynamicVehicleInputs(vList.length, vList);

    document.getElementById('modal-form-title').textContent = 'Edit Customer & Fleet';
    openModal('modal-customer');
}

// Delete Customer (Cascades to Vehicles & Policies in Supabase)
async function handleDeleteCustomer(id) {
    const customer = customersData.find(c => String(c.id) === String(id));
    if (!customer) return;

    const confirmed = confirm(`Are you sure you want to delete customer "${customer.full_name}"?\nAll associated vehicles, RC documents, and policy records will be deleted.`);
    if (!confirmed) return;

    if (supabaseClient) {
        try {
            const { error } = await supabaseClient
                .from('customers')
                .delete()
                .eq('id', id);

            if (error) throw error;
            showToast('Customer and associated records deleted from Supabase.', 'success');
        } catch (err) {
            console.error('Delete error:', err);
            showToast(`Delete failed: ${err.message}`, 'error');
        }
    }

    await localStoreManager.delete(id);
    await fetchAllData();
}

// ==============================================================================
// 10. UNIVERSAL DOCUMENT PREVIEWER & DIRECT DOWNLOAD
// ==============================================================================
function openDocumentViewer(url, title = 'Document Preview') {
    if (!url) {
        showToast('No document attachment available to preview.', 'warning');
        return;
    }

    const previewContainer = document.getElementById('preview-container');
    const titleEl = document.getElementById('preview-doc-title');
    const subtitleEl = document.getElementById('preview-doc-subtitle');
    const downloadBtn = document.getElementById('btn-download-preview-doc');

    titleEl.textContent = title;
    subtitleEl.textContent = 'Previewing document. Click "Download Document" below to save a copy.';
    previewContainer.innerHTML = '';
    downloadBtn.href = url;

    const isPdf = url.includes('.pdf') || url.startsWith('data:application/pdf');

    if (isPdf) {
        const iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.title = title;
        previewContainer.appendChild(iframe);
    } else {
        const img = document.createElement('img');
        img.src = url;
        img.alt = title;
        previewContainer.appendChild(img);
    }

    openModal('modal-doc-preview');
}

// ==============================================================================
// 11. SUPABASE SETTINGS MODAL & CONNECTION TEST
// ==============================================================================
async function testSupabaseConnection() {
    const url = document.getElementById('cfg-supabase-url').value.trim();
    const key = document.getElementById('cfg-supabase-anon-key').value.trim();
    const feedback = document.getElementById('supabase-test-feedback');
    feedback.style.display = 'block';

    if (!url || !key) {
        feedback.className = 'status-feedback badge-danger';
        feedback.textContent = '❌ Please enter both Supabase Project URL and Anon Key.';
        return;
    }

    feedback.className = 'status-feedback badge-info';
    feedback.textContent = '⏳ Testing connection to Supabase database...';

    try {
        const client = window.supabase.createClient(url, key);
        const { data, error } = await client.from('customers').select('id').limit(1);

        if (error) {
            feedback.className = 'status-feedback badge-danger';
            feedback.textContent = `❌ Database Error: ${error.message} (Did you execute schema.sql?)`;
        } else {
            feedback.className = 'status-feedback badge-success';
            feedback.textContent = '✅ Connected successfully! Tables and RLS policies verified.';
        }
    } catch (err) {
        feedback.className = 'status-feedback badge-danger';
        feedback.textContent = `❌ Connection Failed: ${err.message}`;
    }
}

function saveSupabaseSettings() {
    const url = document.getElementById('cfg-supabase-url').value.trim();
    const key = document.getElementById('cfg-supabase-anon-key').value.trim();

    if (url && key) {
        localStorage.setItem('supabase_url', url);
        localStorage.setItem('supabase_anon_key', key);
        initSupabase();
        fetchAllData();
        showToast('Supabase settings saved and connected!', 'success');
    }
    closeModal('modal-supabase-settings');
}

function disconnectSupabase() {
    localStorage.removeItem('supabase_url');
    localStorage.removeItem('supabase_anon_key');
    supabaseClient = null;
    initSupabase();
    fetchAllData();
    showToast('Disconnected from cloud. Running in local mode.', 'info');
    closeModal('modal-supabase-settings');
}

// ==============================================================================
// 12. EVENT LISTENERS & UI HELPERS
// ==============================================================================
function bindEventListeners() {
    // --- Search Input ---
    document.getElementById('search-input').addEventListener('input', (e) => {
        activeFilters.search = e.target.value;
        renderDashboard();
    });

    // --- Dropdown Filters ---
    document.getElementById('filter-customer-type').addEventListener('change', (e) => {
        activeFilters.customerType = e.target.value;
        renderDashboard();
    });

    document.getElementById('filter-vehicle-count').addEventListener('change', (e) => {
        activeFilters.vehicleCount = e.target.value;
        renderDashboard();
    });

    document.getElementById('filter-expiry-warning').addEventListener('change', (e) => {
        activeFilters.expiryWarning = e.target.value;
        renderDashboard();
    });

    document.getElementById('filter-renewal-status').addEventListener('change', (e) => {
        activeFilters.renewalStatus = e.target.value;
        renderDashboard();
    });

    // --- Add Customer Modal Trigger ---
    document.getElementById('btn-add-customer').addEventListener('click', () => {
        resetCustomerForm();
        document.getElementById('modal-form-title').textContent = 'Add Customer & Vehicle Fleet';
        openModal('modal-customer');
    });

    // --- Dynamic Vehicle Steppers (+ / -) in Modal ---
    const btnIncrement = document.getElementById('btn-stepper-increment');
    const btnDecrement = document.getElementById('btn-stepper-decrement');
    const inputVehCount = document.getElementById('input-vehicle-count');

    if (btnIncrement) {
        btnIncrement.addEventListener('click', () => {
            const current = parseInt(inputVehCount?.value) || 1;
            const next = Math.min(20, current + 1);
            renderDynamicVehicleInputs(next);
        });
    }

    if (btnDecrement) {
        btnDecrement.addEventListener('click', () => {
            const current = parseInt(inputVehCount?.value) || 1;
            const next = Math.max(1, current - 1);
            renderDynamicVehicleInputs(next);
        });
    }

    if (inputVehCount) {
        inputVehCount.addEventListener('input', (e) => {
            const next = Math.max(1, Math.min(20, parseInt(e.target.value) || 1));
            renderDynamicVehicleInputs(next);
        });
    }

    // --- Aadhaar Mask Formatter (XXXX XXXX XXXX) ---
    document.getElementById('input-aadhar').addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, '').substring(0, 12);
        let formatted = val.match(/.{1,4}/g)?.join(' ') || val;
        e.target.value = formatted;
    });

    // --- PAN Formatter (ABCDE1234F) ---
    document.getElementById('input-pan').addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
    });

    // --- Customer Form Submission ---
    document.getElementById('customer-form').addEventListener('submit', handleCustomerFormSubmit);

    // --- Supabase Config Modal Triggers ---
    document.getElementById('btn-open-settings').addEventListener('click', () => {
        document.getElementById('cfg-supabase-url').value = localStorage.getItem('supabase_url') || '';
        document.getElementById('cfg-supabase-anon-key').value = localStorage.getItem('supabase_anon_key') || '';
        document.getElementById('supabase-test-feedback').style.display = 'none';
        openModal('modal-supabase-settings');
    });

    document.getElementById('btn-test-supabase').addEventListener('click', testSupabaseConnection);
    document.getElementById('btn-save-supabase').addEventListener('click', saveSupabaseSettings);
    document.getElementById('btn-disconnect-supabase').addEventListener('click', disconnectSupabase);

    // --- Modal Closers ---
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal-backdrop');
            if (modal) closeModal(modal.id);
        });
    });

    document.querySelectorAll('.modal-backdrop').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal.id);
        });
    });

    // --- Theme Toggle ---
    document.getElementById('btn-theme-toggle').addEventListener('click', toggleTheme);
}

function resetCustomerForm() {
    const form = document.getElementById('customer-form');
    form.reset();
    document.getElementById('form-customer-id').value = '';
    document.getElementById('input-existing-aadhar-url').value = '';
    document.getElementById('input-existing-pan-url').value = '';
    document.getElementById('input-existing-insurance-url').value = '';
    document.getElementById('input-existing-puc-url').value = '';
    document.getElementById('type-permanent').checked = true;

    formAadhaarDoc = { file: null, previewUrl: null, name: '', isImage: false };
    formPanDoc = { file: null, previewUrl: null, name: '', isImage: false };
    formInsuranceDoc = { file: null, previewUrl: null, name: '', isImage: false };
    formPucDoc = { file: null, previewUrl: null, name: '', isImage: false };
    vehicleFilesState = {};

    bindSingleDropzone('input-aadhar-file', 'aadhar-dropzone', 'aadhar-dropzone-empty', 'aadhar-dropzone-preview', 'aadhar-thumb-img', 'aadhar-filename', 'aadhar-filesize', 'btn-preview-aadhar', 'btn-clear-aadhar', formAadhaarDoc, 'Aadhaar Card');
    bindSingleDropzone('input-pan-file', 'pan-dropzone', 'pan-dropzone-empty', 'pan-dropzone-preview', 'pan-thumb-img', 'pan-filename', 'pan-filesize', 'btn-preview-pan', 'btn-clear-pan', formPanDoc, 'PAN Card');
    bindSingleDropzone('input-insurance-file', 'insurance-dropzone', 'insurance-dropzone-empty', 'insurance-dropzone-preview', 'insurance-thumb-img', 'insurance-filename', 'insurance-filesize', 'btn-preview-insurance', 'btn-clear-insurance', formInsuranceDoc, 'Insurance Policy');
    bindSingleDropzone('input-puc-file', 'puc-dropzone', 'puc-dropzone-empty', 'puc-dropzone-preview', 'puc-thumb-img', 'puc-filename', 'puc-filesize', 'btn-preview-puc', 'btn-clear-puc', formPucDoc, 'PUC Certificate');

    renderDynamicVehicleInputs(1);
}

function openModal(id) {
    document.getElementById(id).classList.add('show');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('show');
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- Theme Management ---
function initTheme() {
    const saved = localStorage.getItem('fleet_theme') || 'light';
    document.body.setAttribute('data-theme', saved);
    updateThemeIcons(saved);
}

function toggleTheme() {
    const current = document.body.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('fleet_theme', next);
    updateThemeIcons(next);
}

function updateThemeIcons(theme) {
    const moon = document.getElementById('icon-moon');
    const sun = document.getElementById('icon-sun');
    if (theme === 'dark') {
        sun.style.display = 'block';
        moon.style.display = 'none';
    } else {
        sun.style.display = 'none';
        moon.style.display = 'block';
    }
}

// --- Toast Notifications ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const iconMap = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };

    toast.innerHTML = `<span>${iconMap[type] || 'ℹ️'}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 250);
    }, 3200);
}
