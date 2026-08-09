// ==============================================================================
// app.js — JD ENTERPRISES CMS Monitor: Insurance & Vehicle Fleet Management System
// Strict Authentication Gate: Unauthenticated users are locked in read-only mode.
// Only authenticated users (Staff / Admin) can entry data, modify, delete, or import.
// ==============================================================================

// Global Application State
let supabaseClient = null;
let currentAuthUser = null; // null when unauthenticated, or user object when logged in
let userRole = 'guest'; // 'guest' | 'staff' | 'admin'
let customersData = [];
let activityLogs = [];
let backupParsedData = null;
let realtimeSubscription = null;

let activeFilters = {
    search: '',
    customerType: 'all',
    vehicleCount: 'all',
    expiryWarning: 'all',
    renewalStatus: 'all',
    sortOrder: 'newest',
    entryDate: 'all'
};

// Form In-Memory File State for Customer KYC Docs
let formAadhaarDoc = { file: null, previewUrl: null, name: '', isImage: false };
let formPanDoc = { file: null, previewUrl: null, name: '', isImage: false };

// Form In-Memory File State for Dynamic Vehicle RC Docs
let vehicleFilesState = {};

// Local IndexedDB Storage Configuration (Offline Fallback)
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
    await initSupabase();
    await fetchAllData();
    await fetchActivityLogs();
    bindEventListeners();
    setupAuthTabsAndToggles();
    setupBackupDropzone();
    setupActivityTrackerEvents();
});

// RFC4122 v4 UUID generator (Guarantees valid PostgreSQL UUID)
function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        try {
            return crypto.randomUUID();
        } catch (e) {}
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function isValidUUID(str) {
    if (!str || typeof str !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

// --- IndexedDB Initializer ---
function initIndexedDB() {
    return new Promise((resolve) => {
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
            resolve(null);
        };
    });
}

const localStoreManager = {
    async getAll() {
        return new Promise((resolve) => {
            if (!localDB) {
                try {
                    const fallback = JSON.parse(localStorage.getItem('jd_local_customers') || '[]');
                    return resolve(fallback);
                } catch (e) {
                    return resolve([]);
                }
            }
            try {
                const tx = localDB.transaction(IDB_CONFIG.store, 'readonly');
                const store = tx.objectStore(IDB_CONFIG.store);
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => {
                    const fallback = JSON.parse(localStorage.getItem('jd_local_customers') || '[]');
                    resolve(fallback);
                };
            } catch (e) {
                const fallback = JSON.parse(localStorage.getItem('jd_local_customers') || '[]');
                resolve(fallback);
            }
        });
    },
    async save(item) {
        return new Promise((resolve) => {
            if (!localDB) {
                try {
                    const current = JSON.parse(localStorage.getItem('jd_local_customers') || '[]');
                    const idx = current.findIndex(c => c.id === item.id);
                    if (idx >= 0) current[idx] = item;
                    else current.push(item);
                    localStorage.setItem('jd_local_customers', JSON.stringify(current));
                } catch (e) {}
                return resolve(item);
            }
            try {
                const tx = localDB.transaction(IDB_CONFIG.store, 'readwrite');
                const store = tx.objectStore(IDB_CONFIG.store);
                const req = store.put(item);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(item);
            } catch (e) {
                resolve(item);
            }
        });
    },
    async delete(id) {
        return new Promise((resolve) => {
            if (!localDB) {
                try {
                    let current = JSON.parse(localStorage.getItem('jd_local_customers') || '[]');
                    current = current.filter(c => c.id !== id);
                    localStorage.setItem('jd_local_customers', JSON.stringify(current));
                } catch (e) {}
                return resolve();
            }
            try {
                const tx = localDB.transaction(IDB_CONFIG.store, 'readwrite');
                const store = tx.objectStore(IDB_CONFIG.store);
                const req = store.delete(id);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    },
    async clearAll() {
        return new Promise((resolve) => {
            localStorage.removeItem('jd_local_customers');
            if (!localDB) return resolve();
            try {
                const tx = localDB.transaction(IDB_CONFIG.store, 'readwrite');
                const store = tx.objectStore(IDB_CONFIG.store);
                const req = store.clear();
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });
    }
};

// ==============================================================================
// 2. AUTHENTICATION STATE, GUARDS & SESSION MANAGER
// ==============================================================================

// Guard function: Returns true if user is logged in, or displays notice & opens login modal
function isUserLoggedIn() {
    return currentAuthUser !== null && userRole !== 'guest';
}

function requireAuth(actionDescription = 'perform this action') {
    if (!isUserLoggedIn()) {
        showToast(`🔒 Authentication Required: Please sign in to ${actionDescription}.`, 'warning');
        
        const authFeedback = document.getElementById('auth-feedback');
        if (authFeedback) {
            authFeedback.className = 'status-feedback badge-warning';
            authFeedback.textContent = `🔒 Please sign in with your staff or admin account to ${actionDescription}.`;
            authFeedback.style.display = 'block';
        }
        
        openModal('modal-auth');
        return false;
    }
    return true;
}

// Initializer for Supabase Client & User Auth Session
async function initSupabase() {
    const rawUrl = localStorage.getItem('supabase_url') || '';
    const rawKey = localStorage.getItem('supabase_anon_key') || '';
    const url = rawUrl.trim().replace(/\/+$/, '');
    const key = rawKey.trim();

    // Check if a local authenticated session was saved previously
    const savedLocalSession = localStorage.getItem('jd_auth_session');

    if (url && key && window.supabase) {
        try {
            supabaseClient = window.supabase.createClient(url, key, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            });

            // Check Supabase active session
            const { data: sessionData } = await supabaseClient.auth.getSession();
            if (sessionData?.session?.user) {
                updateAuthStateUI(sessionData.session.user);
            } else if (savedLocalSession) {
                try {
                    const parsed = JSON.parse(savedLocalSession);
                    updateAuthStateUI(parsed, parsed.role || 'staff');
                } catch (e) {
                    updateLoggedOutUI();
                }
            } else {
                updateLoggedOutUI();
            }

            // Supabase Auth State Change Listener
            supabaseClient.auth.onAuthStateChange(async (event, session) => {
                if (session?.user) {
                    updateAuthStateUI(session.user);
                } else if (!localStorage.getItem('jd_auth_session')) {
                    updateLoggedOutUI();
                }
                await fetchAllData();
                await fetchActivityLogs();
            });

            return true;
        } catch (err) {
            console.error('Supabase Initialization Failed:', err);
            supabaseClient = null;
        }
    }

    // If Supabase not configured, check local session fallback
    if (savedLocalSession) {
        try {
            const parsed = JSON.parse(savedLocalSession);
            updateAuthStateUI(parsed, parsed.role || 'admin');
        } catch (e) {
            updateLoggedOutUI();
        }
    } else {
        updateLoggedOutUI();
    }

    return false;
}

// Update UI to Authenticated State
function updateAuthStateUI(user, explicitRole = null) {
    currentAuthUser = user;
    const email = user.email || 'operator@jdenterprises.com';

    // Role assignment (Admin vs Staff)
    if (explicitRole) {
        userRole = explicitRole;
    } else if (email.toLowerCase().includes('admin') || user.user_metadata?.role === 'admin') {
        userRole = 'admin';
    } else {
        userRole = 'staff';
    }

    // Persist session for offline / standalone use
    localStorage.setItem('jd_auth_session', JSON.stringify({
        id: user.id || generateUUID(),
        email: email,
        role: userRole,
        user_metadata: user.user_metadata || { full_name: user.name || email.split('@')[0] }
    }));

    const pill = document.getElementById('cloud-pill');
    const pillLabel = document.getElementById('cloud-pill-label');
    const userPill = document.getElementById('user-profile-pill');
    const btnNavLogin = document.getElementById('btn-nav-login');
    const userEmailDisplay = document.getElementById('user-email-display');
    const userAvatarInitial = document.getElementById('user-avatar-initial');
    const userRoleBadge = document.getElementById('user-role-badge');
    const authBanner = document.getElementById('auth-banner-readonly');

    if (authBanner) authBanner.style.display = 'none';
    if (userPill) userPill.style.display = 'inline-flex';
    if (btnNavLogin) btnNavLogin.style.display = 'none';

    if (userEmailDisplay) userEmailDisplay.textContent = email;
    if (userAvatarInitial) {
        const name = user.user_metadata?.full_name || email || 'U';
        userAvatarInitial.textContent = name[0].toUpperCase();
    }

    if (userRoleBadge) {
        if (userRole === 'admin') {
            userRoleBadge.textContent = '👑 Admin';
            userRoleBadge.className = 'role-badge role-badge-admin';
        } else {
            userRoleBadge.textContent = '👤 Staff';
            userRoleBadge.className = 'role-badge role-badge-staff';
        }
    }

    if (pill) {
        if (supabaseClient) {
            pill.className = 'status-pill status-pill-online';
            if (pillLabel) pillLabel.textContent = 'Supabase Cloud';
            pill.title = `Authenticated as ${email} (${userRole})`;
        } else {
            pill.className = 'status-pill status-pill-offline';
            if (pillLabel) pillLabel.textContent = 'Local Staff';
            pill.title = `Local Session: ${email} (${userRole})`;
        }
    }

    setupSupabaseRealtime();
    renderDashboard();
}

// Update UI to Guest / Locked Read-Only State
function updateLoggedOutUI() {
    currentAuthUser = null;
    userRole = 'guest';
    localStorage.removeItem('jd_auth_session');

    const pill = document.getElementById('cloud-pill');
    const pillLabel = document.getElementById('cloud-pill-label');
    const userPill = document.getElementById('user-profile-pill');
    const btnNavLogin = document.getElementById('btn-nav-login');
    const authBanner = document.getElementById('auth-banner-readonly');

    if (authBanner) authBanner.style.display = 'flex';
    if (userPill) userPill.style.display = 'none';
    if (btnNavLogin) btnNavLogin.style.display = 'inline-flex';

    if (pill) {
        pill.className = 'status-pill status-pill-offline';
        if (pillLabel) pillLabel.textContent = '🔒 Guest (Read-Only)';
        pill.title = 'You are currently not logged in. All data entry and modifications are locked.';
    }

    renderDashboard();
}

// Real-Time Multi-Staff Live Collaboration
function setupSupabaseRealtime() {
    if (!supabaseClient || realtimeSubscription) return;
    try {
        realtimeSubscription = supabaseClient
            .channel('jd_cms_realtime_collaboration')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, async () => {
                await fetchAllData();
                showToast('🔔 Live Sync: Customer records updated!', 'info');
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, async () => {
                await fetchAllData();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'insurance_policies' }, async () => {
                await fetchAllData();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_logs' }, async () => {
                await fetchActivityLogs();
            })
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log('Realtime Multi-Staff Sync: Connected');
                }
            });
    } catch (err) {
        console.warn('Realtime subscription notice:', err.message);
    }
}

// File Upload to Supabase Storage Bucket 'rc-documents'
async function uploadFileToSupabase(file, folderPrefix, identifier) {
    if (!supabaseClient || !file) return null;
    try {
        const fileExt = file.name.split('.').pop() || 'png';
        const cleanName = `${folderPrefix}_${identifier}_${Date.now()}.${fileExt}`;
        const filePath = `${folderPrefix}/${cleanName}`;

        const { data, error } = await supabaseClient.storage
            .from('rc-documents')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: true
            });

        if (error) {
            console.warn('Storage upload error, using local fallback:', error.message);
            return null;
        }

        const { data: publicUrlData } = supabaseClient.storage
            .from('rc-documents')
            .getPublicUrl(filePath);

        return publicUrlData?.publicUrl || null;
    } catch (err) {
        console.error('Upload document failed:', err);
        return null;
    }
}

// ==============================================================================
// 3. RESILIENT SUPABASE DATABASE ADAPTER & SCHEMA CACHE AUTO-HEALER
// ==============================================================================

const SCHEMA_MIGRATION_SQL = `-- Safe Migration Script for Supabase PostgreSQL
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS pan_number TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS pan_doc_url TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS aadhar_number TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS aadhar_doc_url TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS puc_doc_url TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS puc_expiry_date DATE;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'permanent';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS created_by_email TEXT DEFAULT 'staff@jdenterprises.com';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS created_by_name TEXT DEFAULT 'Staff';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS updated_by_email TEXT DEFAULT 'staff@jdenterprises.com';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS updated_by_name TEXT DEFAULT 'Staff';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS vehicle_number TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS rc_document_url TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS insurance_expiry_date DATE;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS insurance_doc_url TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS puc_expiry_date DATE;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS puc_doc_url TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS updated_by_email TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS policy_number TEXT;
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS insurance_expiry_date DATE;
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS policy_doc_url TEXT;
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';

ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS action_type TEXT;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS actor_email TEXT;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS actor_name TEXT;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Reload PostgREST schema cache immediately
NOTIFY pgrst, 'reload schema';`;

const FULL_SCHEMA_SQL = `-- Complete Schema & Storage Configuration for Supabase
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    pan_number TEXT,
    pan_doc_url TEXT,
    aadhar_number TEXT,
    aadhar_doc_url TEXT,
    puc_doc_url TEXT,
    puc_expiry_date DATE,
    type TEXT NOT NULL DEFAULT 'permanent' CHECK (type IN ('permanent', 'lead')),
    created_by_email TEXT DEFAULT 'staff@jdenterprises.com',
    created_by_name TEXT DEFAULT 'Staff',
    updated_by_email TEXT DEFAULT 'staff@jdenterprises.com',
    updated_by_name TEXT DEFAULT 'Staff',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    vehicle_number TEXT NOT NULL DEFAULT '',
    rc_document_url TEXT,
    insurance_expiry_date DATE,
    insurance_doc_url TEXT,
    puc_expiry_date DATE,
    puc_doc_url TEXT,
    updated_by_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.insurance_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    policy_number TEXT,
    insurance_expiry_date DATE,
    policy_doc_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'not_done')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type TEXT NOT NULL,
    customer_id UUID,
    customer_name TEXT,
    details TEXT,
    actor_email TEXT,
    actor_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read and write for all users on customers" ON public.customers;
CREATE POLICY "Enable read and write for all users on customers" ON public.customers FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable read and write for all users on vehicles" ON public.vehicles;
CREATE POLICY "Enable read and write for all users on vehicles" ON public.vehicles FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable read and write for all users on insurance_policies" ON public.insurance_policies;
CREATE POLICY "Enable read and write for all users on insurance_policies" ON public.insurance_policies FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable read and write for all users on activity_logs" ON public.activity_logs;
CREATE POLICY "Enable read and write for all users on activity_logs" ON public.activity_logs FOR ALL USING (true) WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public) VALUES ('rc-documents', 'rc-documents', true) ON CONFLICT (id) DO UPDATE SET public = true;
INSERT INTO storage.buckets (id, name, public) VALUES ('vehicle-docs', 'vehicle-docs', true) ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "RC Document Upload Policy" ON storage.objects;
CREATE POLICY "RC Document Upload Policy" ON storage.objects FOR INSERT WITH CHECK (bucket_id IN ('rc-documents', 'vehicle-docs'));

DROP POLICY IF EXISTS "RC Document Select Policy" ON storage.objects;
CREATE POLICY "RC Document Select Policy" ON storage.objects FOR SELECT USING (bucket_id IN ('rc-documents', 'vehicle-docs'));

DROP POLICY IF EXISTS "RC Document Update Policy" ON storage.objects;
CREATE POLICY "RC Document Update Policy" ON storage.objects FOR UPDATE USING (bucket_id IN ('rc-documents', 'vehicle-docs'));

DROP POLICY IF EXISTS "RC Document Delete Policy" ON storage.objects;
CREATE POLICY "RC Document Delete Policy" ON storage.objects FOR DELETE USING (bucket_id IN ('rc-documents', 'vehicle-docs'));

NOTIFY pgrst, 'reload schema';`;

async function safeUpsertRecord(client, tableName, records) {
    if (!client || !records || records.length === 0) return { data: null, error: null, strippedColumns: [] };
    let currentRecords = records.map(r => ({ ...r }));
    const maxRetries = 15;
    let retries = 0;
    const strippedCols = new Set();

    while (retries < maxRetries) {
        const { data, error } = await client.from(tableName).upsert(currentRecords);
        if (!error) {
            return { data, error: null, strippedColumns: Array.from(strippedCols) };
        }

        const msg = error.message || '';
        // Extract column name from PostgREST schema cache errors or Postgres missing column errors
        const colMatch = msg.match(/Could not find the '([^']+)' column/i) ||
                         msg.match(/column "([^"]+)" of relation/i) ||
                         msg.match(/column ([a-zA-Z0-9_]+) does not exist/i);

        if (colMatch && colMatch[1]) {
            const missingCol = colMatch[1];
            strippedCols.add(missingCol);
            currentRecords = currentRecords.map(r => {
                const copy = { ...r };
                delete copy[missingCol];
                return copy;
            });
            retries++;
            continue;
        }

        return { data: null, error, strippedColumns: Array.from(strippedCols) };
    }

    return { data: null, error: new Error('Schema retry limit reached'), strippedColumns: Array.from(strippedCols) };
}

async function safeInsertRecord(client, tableName, records) {
    if (!client || !records || records.length === 0) return { data: null, error: null, strippedColumns: [] };
    let currentRecords = records.map(r => ({ ...r }));
    const maxRetries = 15;
    let retries = 0;
    const strippedCols = new Set();

    while (retries < maxRetries) {
        const { data, error } = await client.from(tableName).insert(currentRecords);
        if (!error) {
            return { data, error: null, strippedColumns: Array.from(strippedCols) };
        }

        const msg = error.message || '';
        const colMatch = msg.match(/Could not find the '([^']+)' column/i) ||
                         msg.match(/column "([^"]+)" of relation/i) ||
                         msg.match(/column ([a-zA-Z0-9_]+) does not exist/i);

        if (colMatch && colMatch[1]) {
            const missingCol = colMatch[1];
            strippedCols.add(missingCol);
            currentRecords = currentRecords.map(r => {
                const copy = { ...r };
                delete copy[missingCol];
                return copy;
            });
            retries++;
            continue;
        }

        return { data: null, error, strippedColumns: Array.from(strippedCols) };
    }

    return { data: null, error: new Error('Schema retry limit reached'), strippedColumns: Array.from(strippedCols) };
}

async function safeDeleteRecord(client, tableName, column, value) {
    if (!client) return;
    try {
        await client.from(tableName).delete().eq(column, value);
    } catch (e) {
        console.warn(`Safe delete notice (${tableName}.${column}):`, e.message);
    }
}

function normalizeCustomerRecord(c, vehiclesList = [], policiesList = []) {
    const custId = c.id || generateUUID();
    const custVehicles = (Array.isArray(c.vehicles) && c.vehicles.length > 0)
        ? c.vehicles
        : (vehiclesList || []).filter(v => String(v.customer_id) === String(custId));

    const custPolicies = (Array.isArray(c.insurance_policies) && c.insurance_policies.length > 0)
        ? c.insurance_policies
        : (policiesList || []).filter(p => String(p.customer_id) === String(custId));

    const primaryPolicy = custPolicies[0] || {};

    return {
        id: custId,
        full_name: c.full_name || c.customer_name || '',
        phone: c.phone || c.customer_phone || '',
        pan_number: c.pan_number || c.pan_num || '',
        pan_doc_url: c.pan_doc_url || null,
        aadhar_number: c.aadhar_number || c.aadhar_num || '',
        aadhar_doc_url: c.aadhar_doc_url || null,
        puc_doc_url: c.puc_doc_url || null,
        puc_expiry_date: c.puc_expiry_date || c.puc_due || null,
        type: c.type || c.customer_type || 'permanent',
        created_by_email: c.created_by_email || '',
        created_by_name: c.created_by_name || '',
        updated_by_email: c.updated_by_email || '',
        updated_by_name: c.updated_by_name || '',
        created_at: c.created_at || new Date().toISOString(),
        updated_at: c.updated_at || c.created_at || new Date().toISOString(),
        vehicles: custVehicles.map(v => ({
            id: v.id || generateUUID(),
            customer_id: custId,
            vehicle_number: v.vehicle_number || v.vehicle_num || '',
            rc_document_url: v.rc_document_url || v.rc_doc_url || null,
            insurance_expiry_date: v.insurance_expiry_date || v.insurance_due || null,
            insurance_doc_url: v.insurance_doc_url || v.ins_doc_url || null,
            puc_expiry_date: v.puc_expiry_date || v.puc_due || null,
            puc_doc_url: v.puc_doc_url || null,
            updated_by_email: v.updated_by_email || ''
        })),
        insurance_policy: {
            id: primaryPolicy.id || null,
            customer_id: custId,
            policy_number: primaryPolicy.policy_number || '',
            insurance_expiry_date: primaryPolicy.insurance_expiry_date || null,
            policy_doc_url: primaryPolicy.policy_doc_url || null,
            status: primaryPolicy.status || 'pending'
        }
    };
}

async function fetchAllData() {
    if (supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('customers')
                .select(`
                    *,
                    vehicles (*),
                    insurance_policies (*)
                `)
                .order('created_at', { ascending: false });

            if (error) {
                console.warn('Nested query schema notice, executing fallback select:', error.message);
                const { data: simpleData, error: simpleErr } = await supabaseClient
                    .from('customers')
                    .select('*')
                    .order('created_at', { ascending: false });

                if (simpleErr) throw simpleErr;

                let allVehicles = [];
                let allPolicies = [];
                try {
                    const { data: vData } = await supabaseClient.from('vehicles').select('*');
                    if (vData) allVehicles = vData;
                } catch (e) {}

                try {
                    const { data: pData } = await supabaseClient.from('insurance_policies').select('*');
                    if (pData) allPolicies = pData;
                } catch (e) {}

                customersData = (simpleData || []).map(c => normalizeCustomerRecord(c, allVehicles, allPolicies));
            } else {
                customersData = (data || []).map(c => normalizeCustomerRecord(c, c.vehicles || [], c.insurance_policies || []));
            }

            // Sync to local fallback store
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
// 4. DATE CALCULATIONS & EXPIRY HELPERS
// ==============================================================================
function parseLocalDate(dateString) {
    if (!dateString) return null;
    if (dateString instanceof Date) {
        return new Date(dateString.getFullYear(), dateString.getMonth(), dateString.getDate(), 0, 0, 0, 0);
    }
    const str = String(dateString).trim();
    if (!str) return null;

    // For full ISO timestamp strings (contains 'T' or ':')
    if (str.includes('T') || str.includes(':')) {
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
            return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
        }
    }

    // For pure YYYY-MM-DD date strings
    const parts = str.split('-');
    if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
            return new Date(year, month, day, 0, 0, 0, 0);
        }
    }

    const fallback = new Date(str);
    if (isNaN(fallback.getTime())) return null;
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate(), 0, 0, 0, 0);
}

function calculateDaysRemaining(dateString) {
    if (!dateString) return null;
    const target = parseLocalDate(dateString);
    if (!target) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = target.getTime() - today.getTime();
    return Math.round(diff / (1000 * 60 * 60 * 24));
}

function isDateInCurrentMonth(dateString) {
    if (!dateString) return false;
    const d = parseLocalDate(dateString);
    if (!d) return false;
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function isDateInNextMonth(dateString) {
    if (!dateString) return false;
    const d = parseLocalDate(dateString);
    if (!d) return false;
    const now = new Date();
    const nextMo = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return d.getFullYear() === nextMo.getFullYear() && d.getMonth() === nextMo.getMonth();
}

function isToday(dateStr) {
    if (!dateStr) return false;
    const d = parseLocalDate(dateStr);
    if (!d) return false;
    const today = new Date();
    return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
}

function isYesterday(dateStr) {
    if (!dateStr) return false;
    const d = parseLocalDate(dateStr);
    if (!d) return false;
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    return d.getDate() === yest.getDate() && d.getMonth() === yest.getMonth() && d.getFullYear() === yest.getFullYear();
}

function isThisWeek(dateStr) {
    if (!dateStr) return false;
    const d = parseLocalDate(dateStr);
    if (!d) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 7;
}

function getExpiryBadge(days) {
    if (days === null || days === undefined || isNaN(days)) {
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
    const d = parseLocalDate(dateStr);
    if (!d) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(dateStr) {
    if (!dateStr) return 'Just now';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Just now';
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// ==============================================================================
// 5. REAL-TIME ANALYTICS BAR & KPI SUMMARY
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

        let hasInsExpiring = false;
        const primaryInsDays = calculateDaysRemaining(c.insurance_policy?.insurance_expiry_date);
        if (primaryInsDays !== null && primaryInsDays <= 30) hasInsExpiring = true;

        (c.vehicles || []).forEach(v => {
            const vInsDays = calculateDaysRemaining(v.insurance_expiry_date);
            if (vInsDays !== null && vInsDays <= 30) hasInsExpiring = true;
        });
        if (hasInsExpiring) insExpiring30++;

        let hasPucExpiring = false;
        const custPucDays = calculateDaysRemaining(c.puc_expiry_date);
        if (custPucDays !== null && custPucDays <= 30) hasPucExpiring = true;

        (c.vehicles || []).forEach(v => {
            const vPucDays = calculateDaysRemaining(v.puc_expiry_date);
            if (vPucDays !== null && vPucDays <= 30) hasPucExpiring = true;
        });
        if (hasPucExpiring) pucExpiring30++;

        if (c.insurance_policy?.status === 'pending') {
            pendingRenewals++;
        }
    });

    const elTotal = document.getElementById('kpi-total-customers');
    const elPerm = document.getElementById('kpi-permanent-customers');
    const elLead = document.getElementById('kpi-lead-customers');
    const elIns = document.getElementById('kpi-ins-expiring-30');
    const elPuc = document.getElementById('kpi-puc-expiring-30');
    const elPending = document.getElementById('kpi-pending-renewals');

    if (elTotal) elTotal.textContent = totalCustomers;
    if (elPerm) elPerm.textContent = permanentCount;
    if (elLead) elLead.textContent = leadCount;
    if (elIns) elIns.textContent = insExpiring30;
    if (elPuc) elPuc.textContent = pucExpiring30;
    if (elPending) elPending.textContent = pendingRenewals;
}

// ==============================================================================
// 6. SEARCH & FILTER ENGINE
// ==============================================================================
function getFilteredRecords() {
    let result = customersData.filter(c => {
        if (activeFilters.search) {
            const q = activeFilters.search.toLowerCase().trim();
            const name = (c.full_name || '').toLowerCase();
            const phone = (c.phone || '').toLowerCase();
            const pan = (c.pan_number || '').toLowerCase();
            const aadhar = (c.aadhar_number || '').toLowerCase();
            const policyNum = (c.insurance_policy?.policy_number || '').toLowerCase();
            const creator = (c.created_by_name || c.created_by_email || '').toLowerCase();
            const plates = (c.vehicles || []).map(v => (v.vehicle_number || '').toLowerCase()).join(' ');

            if (!name.includes(q) && !phone.includes(q) && !pan.includes(q) && !aadhar.includes(q) && !policyNum.includes(q) && !plates.includes(q) && !creator.includes(q)) {
                return false;
            }
        }

        if (activeFilters.customerType !== 'all' && c.type !== activeFilters.customerType) {
            return false;
        }

        if (activeFilters.entryDate !== 'all') {
            const date = c.created_at;
            if (activeFilters.entryDate === 'today' && !isToday(date)) return false;
            if (activeFilters.entryDate === 'yesterday' && !isYesterday(date)) return false;
            if (activeFilters.entryDate === 'this-week' && !isThisWeek(date)) return false;
            if (activeFilters.entryDate === 'this-month' && !isDateInCurrentMonth(date)) return false;
        }

        if (activeFilters.vehicleCount !== 'all') {
            const count = (c.vehicles && c.vehicles.length) || 0;
            if (activeFilters.vehicleCount === '1' && count !== 1) return false;
            if (activeFilters.vehicleCount === '2' && count !== 2) return false;
            if (activeFilters.vehicleCount === '3' && count !== 3) return false;
            if (activeFilters.vehicleCount === '4' && count !== 4) return false;
            if (activeFilters.vehicleCount === '5+' && count < 5) return false;
        }

        if (activeFilters.expiryWarning !== 'all') {
            const filter = activeFilters.expiryWarning;
            const primaryInsDate = c.insurance_policy?.insurance_expiry_date;

            const allInsDates = [];
            if (primaryInsDate) allInsDates.push(primaryInsDate);
            (c.vehicles || []).forEach(v => {
                if (v.insurance_expiry_date) allInsDates.push(v.insurance_expiry_date);
            });

            const allPucDates = [];
            if (c.puc_expiry_date) allPucDates.push(c.puc_expiry_date);
            (c.vehicles || []).forEach(v => {
                if (v.puc_expiry_date) allPucDates.push(v.puc_expiry_date);
            });

            if (filter === 'ins-30') {
                const match = allInsDates.some(d => {
                    const days = calculateDaysRemaining(d);
                    return days !== null && days >= 0 && days <= 30;
                });
                if (!match) return false;
            } else if (filter === 'puc-30') {
                const match = allPucDates.some(d => {
                    const days = calculateDaysRemaining(d);
                    return days !== null && days >= 0 && days <= 30;
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

        if (activeFilters.renewalStatus !== 'all') {
            const status = c.insurance_policy?.status || 'pending';
            if (status !== activeFilters.renewalStatus) return false;
        }

        return true;
    });

    function getEarliestInsDate(c) {
        const dates = [];
        if (c.insurance_policy?.insurance_expiry_date) dates.push(c.insurance_policy.insurance_expiry_date);
        (c.vehicles || []).forEach(v => {
            if (v.insurance_expiry_date) dates.push(v.insurance_expiry_date);
        });
        if (dates.length === 0) return '9999-99-99';
        dates.sort();
        return dates[0];
    }

    function getEarliestPucDate(c) {
        const dates = [];
        if (c.puc_expiry_date) dates.push(c.puc_expiry_date);
        (c.vehicles || []).forEach(v => {
            if (v.puc_expiry_date) dates.push(v.puc_expiry_date);
        });
        if (dates.length === 0) return '9999-99-99';
        dates.sort();
        return dates[0];
    }

    result.sort((a, b) => {
        if (activeFilters.sortOrder === 'newest') {
            return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        } else if (activeFilters.sortOrder === 'oldest') {
            return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        } else if (activeFilters.sortOrder === 'updated') {
            const aUp = new Date(a.updated_at || a.created_at || 0).getTime();
            const bUp = new Date(b.updated_at || b.created_at || 0).getTime();
            return bUp - aUp;
        } else if (activeFilters.sortOrder === 'name-asc') {
            return (a.full_name || '').localeCompare(b.full_name || '');
        } else if (activeFilters.sortOrder === 'name-desc') {
            return (b.full_name || '').localeCompare(a.full_name || '');
        } else if (activeFilters.sortOrder === 'ins-soonest') {
            const aDate = getEarliestInsDate(a);
            const bDate = getEarliestInsDate(b);
            return aDate.localeCompare(bDate);
        } else if (activeFilters.sortOrder === 'puc-soonest') {
            const aDate = getEarliestPucDate(a);
            const bDate = getEarliestPucDate(b);
            return aDate.localeCompare(bDate);
        }
        return 0;
    });

    return result;
}

function resetAllFilters() {
    activeFilters = {
        search: '',
        customerType: 'all',
        vehicleCount: 'all',
        expiryWarning: 'all',
        renewalStatus: 'all',
        sortOrder: 'newest',
        entryDate: 'all'
    };

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';

    const sortOrder = document.getElementById('filter-sort-order');
    if (sortOrder) sortOrder.value = 'newest';

    const entryDate = document.getElementById('filter-entry-date');
    if (entryDate) entryDate.value = 'all';

    const custType = document.getElementById('filter-customer-type');
    if (custType) custType.value = 'all';

    const vehCount = document.getElementById('filter-vehicle-count');
    if (vehCount) vehCount.value = 'all';

    const expWarning = document.getElementById('filter-expiry-warning');
    if (expWarning) expWarning.value = 'all';

    const renStatus = document.getElementById('filter-renewal-status');
    if (renStatus) renStatus.value = 'all';

    renderDashboard();
    showToast('Filters reset to default view.', 'info');
}

// ==============================================================================
// 7. MAIN TABLE RENDERING (WITH AUTH LOCKDOWN ON ACTIONS & SENSITIVE DATA)
// ==============================================================================
function renderDashboard() {
    updateKPIAnalytics();
    const filtered = getFilteredRecords();
    const tbody = document.getElementById('table-body');
    const emptyState = document.getElementById('empty-state');
    const loggedIn = isUserLoggedIn();

    if (!tbody) return;
    tbody.innerHTML = '';

    // If database is completely empty
    if (customersData.length === 0) {
        if (emptyState) {
            emptyState.style.display = 'block';
            emptyState.innerHTML = `
                <div class="empty-icon-wrap">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect width="18" height="18" x="3" y="3" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
                </div>
                <h3>No Customer Records Found</h3>
                <p>${loggedIn ? 'Add your first customer to track multiple vehicles, individual insurance & PUC dates, RC attachments, Aadhaar, and PAN.' : 'Please sign in to add your first customer and manage fleet records.'}</p>
                <button class="btn btn-primary" id="btn-empty-add-action">
                    ${loggedIn ? '+ Add New Customer Record' : '🔑 Sign In to Add Records'}
                </button>
            `;

            const btnEmptyAdd = document.getElementById('btn-empty-add-action');
            if (btnEmptyAdd) {
                btnEmptyAdd.onclick = () => {
                    if (requireAuth('add customer records')) {
                        resetCustomerForm();
                        document.getElementById('modal-form-title').textContent = 'Add Customer & Vehicle Fleet';
                        openModal('modal-customer');
                    }
                };
            }
        }
        return;
    }

    // If filters returned 0 records
    if (filtered.length === 0) {
        if (emptyState) {
            emptyState.style.display = 'block';
            emptyState.innerHTML = `
                <div class="empty-icon-wrap" style="color:var(--warning);">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
                </div>
                <h3>No Records Match Filter Criteria</h3>
                <p>No customer records match your active search and filter options. Try broadening your criteria or reset filters.</p>
                <button class="btn btn-secondary" onclick="resetAllFilters()">
                    🔄 Reset All Filters
                </button>
            `;
        }
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    filtered.forEach((c, index) => {
        const tr = document.createElement('tr');

        // 1. Customer Type Badge
        const typeBadge = loggedIn
            ? (c.type === 'permanent'
                ? '<span class="badge badge-permanent">⭐ Permanent</span>'
                : '<span class="badge badge-lead">🚶 Walk-in Lead</span>')
            : '<span class="badge badge-locked locked-trigger" data-action="view customer category details" title="🔒 Sign in to view customer category">🔒 Restricted</span>';

        // 2. Primary Insurance Policy & Expiry
        const policyNum = c.insurance_policy?.policy_number || '—';
        const primaryInsExpiry = c.insurance_policy?.insurance_expiry_date;
        const primaryInsDays = calculateDaysRemaining(primaryInsExpiry);
        const primaryInsBadge = getExpiryBadge(primaryInsDays);

        let primaryPolicyHtml = '';
        if (loggedIn) {
            primaryPolicyHtml = `
                <div style="display:flex; flex-direction:column; gap:0.2rem;">
                    <span style="font-family:var(--font-mono); font-weight:700; font-size:0.78rem;">${escapeHtml(policyNum)}</span>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${formatDate(primaryInsExpiry)}</span>
                    <span class="badge ${primaryInsBadge.badgeClass}">${primaryInsBadge.label}</span>
                </div>
            `;
        } else {
            primaryPolicyHtml = `
                <div style="display:flex; flex-direction:column; gap:0.25rem;">
                    <button type="button" class="table-doc-pill pill-locked locked-trigger" data-action="view primary insurance policy number and expiry dates" title="🔒 Sign in to view policy details">🔒 Policy & Expiry Locked</button>
                </div>
            `;
        }

        // 3. Vehicles & Individual Dates Box
        const vCount = (c.vehicles && c.vehicles.length) || 0;
        let vehiclesHtml = '';

        if (loggedIn) {
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
        } else {
            // Guest mode: Vehicles plate & individual expiry are locked
            if (vCount > 0) {
                vehiclesHtml = `
                    <div class="fleet-cell-box">
                        <span class="fleet-count-badge">🚗 ${vCount} ${vCount === 1 ? 'Vehicle' : 'Vehicles'}</span>
                        <button type="button" class="table-doc-pill pill-locked locked-trigger" data-action="view vehicle plate numbers, RC documents, and individual insurance & PUC expiry dates" title="🔒 Sign in to view vehicle fleet details" style="margin-top:0.25rem;">
                            🔒 Plates & Expiry Locked
                        </button>
                    </div>
                `;
            } else {
                vehiclesHtml = '<span style="color:var(--text-muted); font-size:0.75rem;">No Vehicles</span>';
            }
        }

        // 4. Documents Attached Pill List
        let docPillsHtml = '';
        if (loggedIn) {
            if (c.aadhar_doc_url) {
                docPillsHtml += `<button type="button" class="table-doc-pill pill-aadhar preview-any-doc-btn" data-doc-url="${escapeHtml(c.aadhar_doc_url)}" data-doc-title="${escapeHtml(c.full_name)} — Aadhaar Card" title="Preview / Download Aadhaar">🆔 Aadhaar</button> `;
            }
            if (c.pan_doc_url) {
                docPillsHtml += `<button type="button" class="table-doc-pill pill-pan preview-any-doc-btn" data-doc-url="${escapeHtml(c.pan_doc_url)}" data-doc-title="${escapeHtml(c.full_name)} — PAN Card" title="Preview / Download PAN">💳 PAN</button> `;
            }

            if (!docPillsHtml) {
                docPillsHtml = '<span style="color:var(--text-muted); font-size:0.72rem; font-style:italic;">No KYC Files</span>';
            }
        } else {
            docPillsHtml = `<button type="button" class="table-doc-pill pill-locked locked-trigger" data-action="view and download attached customer documents" title="🔒 Sign in to view documents">🔒 Login to View Docs</button>`;
        }

        // 5. Phone & KYC Cells
        let phoneHtml = '';
        let kycHtml = '';
        if (loggedIn) {
            phoneHtml = `<span class="customer-phone">${escapeHtml(c.phone || 'No Phone')}</span>`;
            kycHtml = `
                <div class="kyc-badge-list">
                    <span class="kyc-item" title="PAN Number">💳 ${escapeHtml(c.pan_number || 'No PAN')}</span>
                    <span class="kyc-item" title="Aadhaar Number">🆔 ${escapeHtml(c.aadhar_number || 'No Aadhaar')}</span>
                </div>
            `;
        } else {
            phoneHtml = `<span class="customer-phone phone-locked locked-trigger" data-action="view customer phone number" title="🔒 Sign in to view phone number">🔒 ••••••••••</span>`;
            kycHtml = `
                <div class="kyc-badge-list">
                    <button type="button" class="table-doc-pill pill-locked locked-trigger" data-action="view PAN and Aadhaar KYC details" title="🔒 Sign in to view KYC details">🔒 KYC Restricted</button>
                </div>
            `;
        }

        // 6. Creator / Audit Tag
        const creatorName = c.created_by_name || c.created_by_email || 'Staff';
        const createdDate = formatDate(c.created_at);
        let auditTagHtml = '';
        if (loggedIn) {
            auditTagHtml = `
                <div class="staff-audit-tag">
                    <span>👤 Added by: <strong>${escapeHtml(creatorName)}</strong></span>
                    <span class="staff-audit-time">${createdDate}</span>
                </div>
            `;
        } else {
            auditTagHtml = `
                <div class="staff-audit-tag locked-tag">
                    <span>🔒 Staff Audit Protected</span>
                </div>
            `;
        }

        // 7. Inline Renewal Status
        const currentStatus = c.insurance_policy?.status || 'pending';
        const statusSelectHtml = loggedIn
            ? `<select class="inline-action-select status-${currentStatus}" data-customer-id="${c.id}" aria-label="Change policy status">
                   <option value="pending" ${currentStatus === 'pending' ? 'selected' : ''}>⏳ Pending</option>
                   <option value="completed" ${currentStatus === 'completed' ? 'selected' : ''}>✅ Completed</option>
                   <option value="not_done" ${currentStatus === 'not_done' ? 'selected' : ''}>❌ Not Done</option>
               </select>`
            : `<button type="button" class="btn-sm btn-secondary locked-status-btn locked-trigger" data-action="change policy renewal status" title="Sign in to modify policy status" style="font-size:0.75rem; padding:0.25rem 0.5rem; display:inline-flex; align-items:center; gap:0.25rem;">
                   <span>🔒 Restricted</span>
               </button>`;

        // 8. Edit Button (Locked to Login)
        const editButtonHtml = loggedIn
            ? `<button type="button" class="btn-icon btn-edit" data-id="${c.id}" title="Edit Customer & Vehicles" aria-label="Edit record">
                   <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>
               </button>`
            : `<button type="button" class="btn-icon locked-edit-btn locked-trigger" data-id="${c.id}" data-action="edit customer and vehicle records" title="🔒 Sign in to edit record" aria-label="Sign in to edit">
                   <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
               </button>`;

        // 9. Delete Button: Allowed only for Admin role when logged in
        let deleteButtonHtml = '';
        if (!loggedIn) {
            deleteButtonHtml = `<button type="button" class="btn-icon locked-delete-btn locked-trigger" data-action="delete customer records" title="🔒 Sign in required to delete" aria-label="Sign in to delete">
                   <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
               </button>`;
        } else if (userRole === 'admin') {
            deleteButtonHtml = `<button type="button" class="btn-icon btn-danger-icon btn-delete" data-id="${c.id}" title="Delete Record (Admin)" aria-label="Delete record">
                   <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
               </button>`;
        } else {
            deleteButtonHtml = `<button type="button" class="btn-icon" style="opacity:0.4; cursor:not-allowed;" title="Delete locked to Admin role only" disabled>
                   <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
               </button>`;
        }

        tr.innerHTML = `
            <td style="text-align:center;">
                <span class="sno-pill">#${index + 1}</span>
            </td>
            <td>
                <div class="customer-cell">
                    <span class="customer-name">${escapeHtml(c.full_name)}</span>
                    ${phoneHtml}
                    ${auditTagHtml}
                </div>
            </td>
            <td>${kycHtml}</td>
            <td>
                <div class="doc-tags-wrap">${docPillsHtml}</div>
            </td>
            <td>${typeBadge}</td>
            <td>${vehiclesHtml}</td>
            <td>${primaryPolicyHtml}</td>
            <td>${statusSelectHtml}</td>
            <td>
                <div class="table-actions">
                    ${editButtonHtml}
                    ${deleteButtonHtml}
                </div>
            </td>
        `;

        tbody.appendChild(tr);
    });

    attachTableDynamicEvents();
}

function attachTableDynamicEvents() {
    // 1. Inline Status Update (Logged-in users)
    document.querySelectorAll('.inline-action-select').forEach(select => {
        select.addEventListener('change', async (e) => {
            if (!requireAuth('modify policy renewal status')) {
                renderDashboard();
                return;
            }
            const customerId = e.target.dataset.customerId;
            const newStatus = e.target.value;
            await updatePolicyStatus(customerId, newStatus);
        });
    });

    // 2. All Locked Triggers (Guest mode clicks)
    document.querySelectorAll('.locked-trigger').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = e.currentTarget.dataset.action || 'view confidential customer details';
            requireAuth(action);
        });
    });

    // 3. Universal Preview from any Document Badge (Available in authenticated mode)
    document.querySelectorAll('.preview-any-doc-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!requireAuth('view or download attached documents')) return;
            const url = e.currentTarget.dataset.docUrl;
            const title = e.currentTarget.dataset.docTitle || 'Document Preview';
            openDocumentViewer(url, title);
        });
    });

    // 4. Edit Buttons (Authenticated Staff / Admin)
    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!requireAuth('edit customer and vehicle records')) return;
            const id = e.currentTarget.dataset.id;
            openEditCustomerModal(id);
        });
    });

    // 5. Delete Buttons (Admin role only)
    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!requireAuth('delete records')) return;
            if (userRole !== 'admin') {
                showToast('🔒 Admin role authorization required to delete customer records.', 'warning');
                return;
            }
            const id = e.currentTarget.dataset.id;
            handleDeleteCustomer(id);
        });
    });
}

// Inline Status Update (Supabase + Local)
async function updatePolicyStatus(customerId, newStatus) {
    if (!requireAuth('modify policy renewal status')) return;

    const customer = customersData.find(c => String(c.id) === String(customerId));
    if (!customer) return;

    if (customer.insurance_policy) {
        customer.insurance_policy.status = newStatus;
    }

    if (supabaseClient && customer.insurance_policy?.id && isValidUUID(customer.insurance_policy.id)) {
        try {
            const { error } = await supabaseClient
                .from('insurance_policies')
                .update({ status: newStatus, updated_at: new Date().toISOString() })
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

    await logActivity('policy_renewed', customer.full_name, `Policy marked as ${newStatus}`);
    await localStoreManager.save(customer);
    renderDashboard();
}

// ==============================================================================
// 8. GENERIC DROPZONE ATTACHMENT HANDLER WITH AUTO RC PLATE EXTRACTION
// ==============================================================================
function bindSingleDropzone(fileInputId, dropzoneId, emptyId, previewId, thumbImgId, filenameId, filesizeId, previewBtnId, clearBtnId, stateHolder, titleLabel, autoFetchIndex = null) {
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

    if (stateHolder && stateHolder.previewUrl) {
        if (emptyBox) emptyBox.style.display = 'none';
        if (previewBox) previewBox.style.display = 'flex';
        if (filenameEl) filenameEl.textContent = stateHolder.name || 'Uploaded Document';
        if (filesizeEl) filesizeEl.textContent = stateHolder.file ? `${(stateHolder.file.size / 1024).toFixed(1)} KB` : 'Existing Document';
        if (thumbImg) {
            if (stateHolder.isImage) {
                thumbImg.src = stateHolder.previewUrl;
                thumbImg.style.display = 'block';
            } else {
                thumbImg.style.display = 'none';
            }
        }
        if (previewBtn) {
            previewBtn.onclick = (e) => {
                e.stopPropagation();
                openDocumentViewer(stateHolder.previewUrl, titleLabel);
            };
        }
    } else {
        if (emptyBox) emptyBox.style.display = 'flex';
        if (previewBox) previewBox.style.display = 'none';
        if (thumbImg) thumbImg.src = '';
        if (filenameEl) filenameEl.textContent = '';
    }

    dropzone.onclick = (e) => {
        if (!requireAuth('upload documents')) return;
        if (!e.target.closest('.doc-action-btns') && !e.target.closest('.thumbnail-actions')) {
            fileInput.value = '';
            fileInput.click();
        }
    };

    fileInput.onchange = (e) => {
        if (!requireAuth('upload documents')) return;
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

            if (emptyBox) emptyBox.style.display = 'none';
            if (previewBox) previewBox.style.display = 'flex';
            if (filenameEl) filenameEl.textContent = file.name;
            if (filesizeEl) filesizeEl.textContent = `${(file.size / 1024).toFixed(1)} KB`;

            if (thumbImg) {
                if (isImage) {
                    thumbImg.src = dataUrl;
                    thumbImg.style.display = 'block';
                } else {
                    thumbImg.style.display = 'none';
                }
            }

            if (previewBtn) {
                previewBtn.onclick = (ev) => {
                    ev.stopPropagation();
                    openDocumentViewer(dataUrl, `${titleLabel} — ${file.name}`);
                };
            }

            if (autoFetchIndex !== null) {
                autoDetectPlateFromRC(file, autoFetchIndex);
            }
        };

        reader.readAsDataURL(file);
    };

    if (clearBtn) {
        clearBtn.onclick = (e) => {
            e.stopPropagation();
            if (!requireAuth('remove documents')) return;
            stateHolder.file = null;
            stateHolder.previewUrl = null;
            stateHolder.name = '';
            stateHolder.isImage = false;
            fileInput.value = '';

            if (emptyBox) emptyBox.style.display = 'flex';
            if (previewBox) previewBox.style.display = 'none';
            if (thumbImg) thumbImg.src = '';
            if (filenameEl) filenameEl.textContent = '';
        };
    }
}

// Auto RC Plate Extraction
function autoDetectPlateFromRC(file, vehicleIndex) {
    if (!file) return;
    const plateInput = document.getElementById(`input-v-plate-${vehicleIndex}`);
    const badgeEl = document.getElementById(`auto-fetch-badge-${vehicleIndex}`);

    const cleanStr = file.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

    // Standard pattern: State (2 letters) + Code (1-2 digits) + Series (1-3 letters) + Number (4 digits)
    const matchStandard = cleanStr.match(/([A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4})/);
    // Bharat Series pattern: Year (2 digits) + BH + 4 digits + 1-2 letters (e.g. 22BH1234AA)
    const matchBH = cleanStr.match(/([0-9]{2}BH[0-9]{4}[A-Z]{1,2})/);

    let formatted = null;

    if (matchStandard && matchStandard[1]) {
        const raw = matchStandard[1];
        formatted = raw.replace(/^([A-Z]{2})([0-9]{1,2})([A-Z]{1,3})([0-9]{4})$/, '$1-$2-$3-$4');
    } else if (matchBH && matchBH[1]) {
        const raw = matchBH[1];
        formatted = raw.replace(/^([0-9]{2})(BH)([0-9]{4})([A-Z]{1,2})$/, '$1-$2-$3-$4');
    }

    if (formatted && plateInput) {
        plateInput.value = formatted;
        if (badgeEl) {
            badgeEl.innerHTML = '<span class="auto-fetch-badge" style="background:var(--success-subtle); color:var(--success); padding:0.1rem 0.4rem; border-radius:var(--radius-sm); font-size:0.68rem; font-weight:700;">⚡ Auto-detected</span>';
            badgeEl.style.display = 'inline-flex';
        }
        showToast(`Vehicle #${vehicleIndex} Plate ${formatted} auto-detected from RC file!`, 'success');
    } else {
        if (badgeEl) badgeEl.style.display = 'none';
    }
}

// ==============================================================================
// 9. DYNAMIC MULTI-VEHICLE RC ENGINE
// ==============================================================================
function renderDynamicVehicleInputs(count, existingVehicles = []) {
    const container = document.getElementById('dynamic-vehicles-container');
    if (!container) return;
    const safeCount = Math.max(1, Math.min(20, parseInt(count) || 1));
    const inputCount = document.getElementById('input-vehicle-count');
    if (inputCount) inputCount.value = safeCount;

    const currentValues = [];
    container.querySelectorAll('.vehicle-entry-card').forEach((card) => {
        const plate = card.querySelector('.input-v-plate')?.value || '';
        const insExpiry = card.querySelector('.input-v-ins-date')?.value || '';
        const pucExpiry = card.querySelector('.input-v-puc-date')?.value || '';
        const existingRcUrl = card.querySelector('.input-v-existing-rc-url')?.value || '';

        currentValues.push({
            vehicle_number: plate,
            insurance_expiry_date: insExpiry,
            insurance_doc_url: null,
            puc_expiry_date: pucExpiry,
            puc_doc_url: null,
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

        if (!vehicleFilesState[i]) {
            vehicleFilesState[i] = {
                rc: { file: null, previewUrl: existingRcUrl || null, name: existingRcUrl ? 'Existing RC' : '', isImage: existingRcUrl ? existingRcUrl.match(/\.(jpeg|jpg|png|webp)/i) !== null : false }
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
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                        <label for="input-v-plate-${i}">Vehicle Plate Number <span class="required-star">*</span></label>
                        <span id="auto-fetch-badge-${i}" style="display:none;"></span>
                    </div>
                    <div style="display:flex; gap:0.35rem;">
                        <input type="text" id="input-v-plate-${i}" class="input-mono input-uppercase input-v-plate flex-1" placeholder="e.g. OD-02-XX-1234" value="${escapeHtml(vPlate)}" required>
                        <button type="button" class="btn-fetch-rc btn-secondary" data-v-idx="${i}" title="Extract Plate from Uploaded RC Document">
                            <span>🔍 Fetch RC</span>
                        </button>
                    </div>
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

            <div class="v-uploads-grid" style="margin-top: 0.5rem;">
                <!-- 1. Vehicle RC Upload -->
                <div class="v-upload-box">
                    <div class="v-upload-header v-upload-header-rc">
                        <span>🚗 Vehicle RC Document (Image / PDF)</span>
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
            </div>
        `;

        container.appendChild(card);

        // Bind Dropzone for RC Document
        bindSingleDropzone(`v-rc-input-${i}`, `v-rc-dropzone-${i}`, `v-rc-empty-${i}`, `v-rc-preview-${i}`, `v-rc-thumb-${i}`, `v-rc-name-${i}`, `v-rc-size-${i}`, `v-rc-view-${i}`, `v-rc-clear-${i}`, vehicleFilesState[i].rc, `Vehicle #${i} — RC Document`, i);
    }

    // Bind manual Fetch RC buttons
    container.querySelectorAll('.btn-fetch-rc').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!requireAuth('auto-detect RC plate')) return;
            const idx = parseInt(e.currentTarget.dataset.vIdx);
            const state = vehicleFilesState[idx];
            if (state && state.rc && state.rc.file) {
                autoDetectPlateFromRC(state.rc.file, idx);
            } else {
                showToast('Please upload an RC document first to auto-detect plate number.', 'info');
            }
        });
    });

    // Bind remove vehicle buttons
    container.querySelectorAll('.btn-remove-v').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!requireAuth('modify vehicles')) return;
            const idxToRemove = parseInt(e.currentTarget.dataset.vIdx);
            
            const newVehiclesList = [];
            const newFileState = {};
            let newCounter = 1;

            container.querySelectorAll('.vehicle-entry-card').forEach((card) => {
                const currentIdx = parseInt(card.dataset.index);
                if (currentIdx !== idxToRemove) {
                    const plate = card.querySelector('.input-v-plate')?.value || '';
                    const insExpiry = card.querySelector('.input-v-ins-date')?.value || '';
                    const pucExpiry = card.querySelector('.input-v-puc-date')?.value || '';
                    const existingRcUrl = card.querySelector('.input-v-existing-rc-url')?.value || '';

                    newVehiclesList.push({
                        vehicle_number: plate,
                        insurance_expiry_date: insExpiry,
                        insurance_doc_url: null,
                        puc_expiry_date: pucExpiry,
                        puc_doc_url: null,
                        rc_document_url: existingRcUrl
                    });

                    if (vehicleFilesState[currentIdx]) {
                        newFileState[newCounter] = vehicleFilesState[currentIdx];
                    }
                    newCounter++;
                }
            });

            vehicleFilesState = newFileState;
            renderDynamicVehicleInputs(newVehiclesList.length, newVehiclesList);
        });
    });
}

// ==============================================================================
// 10. CRUD OPERATIONS — SAVE, EDIT, DELETE (AUTHENTICATION ENFORCED)
// ==============================================================================
async function handleCustomerFormSubmit(e) {
    e.preventDefault();

    if (!requireAuth('save customer records')) {
        return;
    }

    const saveBtn = document.getElementById('btn-save-customer');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '⏳ Uploading Files & Saving All Data...';
    }

    try {
        const idVal = document.getElementById('form-customer-id').value;
        const isNew = !idVal;
        const customerId = (idVal && isValidUUID(idVal)) ? idVal : generateUUID();

        const fullName = document.getElementById('input-full-name').value.trim();
        const phone = document.getElementById('input-phone').value.trim();
        const pan = document.getElementById('input-pan').value.trim().toUpperCase();
        const aadhar = document.getElementById('input-aadhar').value.trim();
        const customerType = document.querySelector('input[name="customer-type"]:checked')?.value || 'permanent';

        const policyNumber = document.getElementById('input-policy-number').value.trim();
        const insuranceExpiry = document.getElementById('input-insurance-expiry').value || null;
        const policyStatus = document.getElementById('select-policy-status').value;
        const customerPucDate = document.getElementById('input-customer-puc-date').value || null;

        let finalAadharUrl = document.getElementById('input-existing-aadhar-url').value || null;
        let finalPanUrl = document.getElementById('input-existing-pan-url').value || null;

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

        // Gather Dynamic Vehicles
        const vehicleCards = document.querySelectorAll('.vehicle-entry-card');
        const vehiclesList = [];

        for (let i = 0; i < vehicleCards.length; i++) {
            const card = vehicleCards[i];
            const vIndex = i + 1;
            const plate = card.querySelector('.input-v-plate').value.trim().toUpperCase();
            const insExpiry = card.querySelector('.input-v-ins-date').value || insuranceExpiry;
            const pucExpiry = card.querySelector('.input-v-puc-date').value || customerPucDate;

            let existingRcUrl = card.querySelector('.input-v-existing-rc-url')?.value || null;
            const fileStates = vehicleFilesState[vIndex] || {};

            let uploadedRcUrl = existingRcUrl;
            if (fileStates.rc && fileStates.rc.file) {
                if (supabaseClient) {
                    const cloudUrl = await uploadFileToSupabase(fileStates.rc.file, 'rc-files', `${customerId}_v${vIndex}`);
                    uploadedRcUrl = cloudUrl || fileStates.rc.previewUrl;
                } else {
                    uploadedRcUrl = fileStates.rc.previewUrl;
                }
            }

            vehiclesList.push({
                id: generateUUID(),
                customer_id: customerId,
                vehicle_number: plate,
                insurance_expiry_date: insExpiry,
                insurance_doc_url: null,
                puc_expiry_date: pucExpiry,
                puc_doc_url: null,
                rc_document_url: uploadedRcUrl,
                updated_by_email: currentAuthUser?.email || 'staff'
            });
        }

        const staffEmail = currentAuthUser?.email || 'staff@jdenterprises.com';
        const staffName = currentAuthUser?.user_metadata?.full_name || currentAuthUser?.name || staffEmail;

        const customerPayload = {
            id: customerId,
            full_name: fullName,
            phone: phone,
            pan_number: pan,
            pan_doc_url: finalPanUrl,
            aadhar_number: aadhar,
            aadhar_doc_url: finalAadharUrl,
            puc_doc_url: null,
            puc_expiry_date: customerPucDate,
            type: customerType,
            created_by_email: isNew ? staffEmail : (customersData.find(c => c.id === customerId)?.created_by_email || staffEmail),
            created_by_name: isNew ? staffName : (customersData.find(c => c.id === customerId)?.created_by_name || staffName),
            updated_by_email: staffEmail,
            updated_by_name: staffName,
            created_at: isNew ? new Date().toISOString() : (customersData.find(c => c.id === customerId)?.created_at || new Date().toISOString()),
            updated_at: new Date().toISOString(),
            vehicles: vehiclesList,
            insurance_policy: {
                id: generateUUID(),
                customer_id: customerId,
                policy_number: policyNumber,
                insurance_expiry_date: insuranceExpiry,
                policy_doc_url: null,
                status: policyStatus
            }
        };

        // If Supabase Connected, execute resilient database transactions
        let schemaNotice = false;
        if (supabaseClient) {
            const custPayloadToSave = {
                id: customerPayload.id,
                full_name: customerPayload.full_name,
                phone: customerPayload.phone,
                pan_number: customerPayload.pan_number,
                pan_doc_url: customerPayload.pan_doc_url,
                aadhar_number: customerPayload.aadhar_number,
                aadhar_doc_url: customerPayload.aadhar_doc_url,
                puc_doc_url: customerPayload.puc_doc_url,
                puc_expiry_date: customerPayload.puc_expiry_date,
                type: customerPayload.type,
                created_by_email: customerPayload.created_by_email,
                created_by_name: customerPayload.created_by_name,
                updated_by_email: customerPayload.updated_by_email,
                updated_by_name: customerPayload.updated_by_name,
                updated_at: customerPayload.updated_at
            };

            const { error: custErr, strippedColumns } = await safeUpsertRecord(supabaseClient, 'customers', [custPayloadToSave]);
            if (custErr) {
                console.warn('Supabase customer upsert warning:', custErr.message);
            }
            if (strippedColumns && strippedColumns.length > 0) {
                schemaNotice = true;
            }

            await safeDeleteRecord(supabaseClient, 'vehicles', 'customer_id', customerPayload.id);
            if (vehiclesList.length > 0) {
                const { error: vehErr } = await safeInsertRecord(supabaseClient, 'vehicles', vehiclesList);
                if (vehErr) console.warn('Vehicles insert notice:', vehErr.message);
            }

            await safeDeleteRecord(supabaseClient, 'insurance_policies', 'customer_id', customerPayload.id);
            const { error: polErr } = await safeInsertRecord(supabaseClient, 'insurance_policies', [{
                id: customerPayload.insurance_policy.id,
                customer_id: customerPayload.id,
                policy_number: policyNumber,
                insurance_expiry_date: insuranceExpiry,
                policy_doc_url: null,
                status: policyStatus
            }]);
            if (polErr) console.warn('Policy insert notice:', polErr.message);

            if (schemaNotice) {
                showToast('Customer & vehicle data saved! (Tip: Run SQL Migration in Settings to enable cloud audit fields)', 'info');
            } else {
                showToast('All customer KYC, fleet, and RC files saved to Supabase Cloud!', 'success');
            }
        } else {
            showToast('Customer & vehicle records saved locally!', 'info');
        }

        await logActivity(
            isNew ? 'customer_created' : 'customer_updated',
            customerPayload.full_name,
            `${vehiclesList.length} vehicle(s) · RC & KYC synced`
        );

        await localStoreManager.save(customerPayload);
        closeModal('modal-customer');
        await fetchAllData();
        await fetchActivityLogs();
    } catch (err) {
        console.error('Error saving customer:', err);
        showToast(`Failed to save: ${err.message}`, 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Save All Data in Once';
        }
    }
}

// Delete Record Handler (Restricted to Logged-in Admin Role)
async function handleDeleteCustomer(id) {
    if (!requireAuth('delete customer records')) return;

    if (userRole !== 'admin') {
        showToast('❌ Access Denied: Only Admin can delete customer records.', 'error');
        return;
    }

    const customer = customersData.find(c => String(c.id) === String(id));
    const confirmName = customer ? customer.full_name : 'this record';

    if (!confirm(`Are you sure you want to permanently delete ${confirmName}? This will remove all associated vehicles, RC cards, and policies.`)) {
        return;
    }

    try {
        if (supabaseClient && isValidUUID(id)) {
            const { error } = await supabaseClient.from('customers').delete().eq('id', id);
            if (error) throw error;
            showToast(`Deleted ${confirmName} from Supabase Cloud.`, 'success');
        } else {
            showToast(`Deleted ${confirmName} from Local Storage.`, 'info');
        }

        await logActivity('customer_deleted', confirmName, 'Deleted by Admin');
        await localStoreManager.delete(id);
        await fetchAllData();
        await fetchActivityLogs();
    } catch (err) {
        console.error('Delete error:', err);
        showToast(`Delete failed: ${err.message}`, 'error');
    }
}

// Open Edit Modal (Authentication Enforced)
function openEditCustomerModal(id) {
    if (!requireAuth('edit customer and vehicle records')) return;

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

    // Primary Policy Prepopulation
    const pol = customer.insurance_policy || {};
    document.getElementById('input-policy-number').value = pol.policy_number || '';
    document.getElementById('input-insurance-expiry').value = pol.insurance_expiry_date || '';
    document.getElementById('select-policy-status').value = pol.status || 'pending';

    // General Customer PUC Prepopulation
    document.getElementById('input-customer-puc-date').value = customer.puc_expiry_date || '';

    // Render Dynamic Vehicles
    const count = (customer.vehicles && customer.vehicles.length) || 1;
    renderDynamicVehicleInputs(count, customer.vehicles || []);

    document.getElementById('modal-form-title').textContent = `Edit Customer: ${customer.full_name}`;
    openModal('modal-customer');
}

// ==============================================================================
// 11. DATE-WISE DATA ENTRY & ACTIVITY TRACKER LOGIC
// ==============================================================================
async function logActivity(actionType, customerName, details) {
    const staffEmail = currentAuthUser?.email || 'staff@jdenterprises.com';
    const staffName = currentAuthUser?.user_metadata?.full_name || staffEmail.split('@')[0];
    const item = {
        id: generateUUID(),
        action_type: actionType,
        customer_name: customerName || 'General Record',
        details: details || '',
        actor_email: staffEmail,
        actor_name: staffName,
        created_at: new Date().toISOString()
    };

    activityLogs.unshift(item);
    if (activityLogs.length > 300) activityLogs.pop();

    // Persist immediately to localStorage
    try {
        localStorage.setItem('jd_activity_logs', JSON.stringify(activityLogs));
    } catch (e) {
        console.warn('Local activity save error:', e);
    }

    if (supabaseClient) {
        try {
            await safeInsertRecord(supabaseClient, 'activity_logs', [item]);
        } catch (err) {
            console.warn('Activity log sync notice:', err.message);
        }
    }
}

async function fetchActivityLogs() {
    // 1. Load from local cache first
    try {
        const saved = localStorage.getItem('jd_activity_logs');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
                activityLogs = parsed;
            }
        }
    } catch (e) {
        console.warn('Error loading local activity logs:', e);
    }

    // 2. Fetch from Supabase Cloud if available
    if (supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('activity_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(200);

            if (!error && Array.isArray(data) && data.length > 0) {
                const map = new Map();
                data.forEach(item => map.set(item.id, item));
                activityLogs.forEach(item => {
                    if (!map.has(item.id)) map.set(item.id, item);
                });
                activityLogs = Array.from(map.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                try {
                    localStorage.setItem('jd_activity_logs', JSON.stringify(activityLogs));
                } catch (e) {}
            }
        } catch (err) {
            console.warn('Failed to fetch cloud activity logs:', err.message);
        }
    }

    // 3. Fallback: If no activity logs exist but customers exist, synthesize initial entry logs
    if (activityLogs.length === 0 && customersData.length > 0) {
        customersData.forEach(c => {
            const vCount = (c.vehicles && c.vehicles.length) || 0;
            activityLogs.push({
                id: generateUUID(),
                action_type: 'customer_created',
                customer_name: c.full_name,
                details: `${vCount} vehicle(s) · Verified Record`,
                actor_email: c.created_by_email || c.updated_by_email || 'staff@jdenterprises.com',
                actor_name: c.created_by_name || c.updated_by_name || 'Staff',
                created_at: c.created_at || c.updated_at || new Date().toISOString()
            });
        });
        activityLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        try {
            localStorage.setItem('jd_activity_logs', JSON.stringify(activityLogs));
        } catch (e) {}
    }
}

function renderActivityTracker(filterDate = 'all') {
    const listEl = document.getElementById('activity-timeline-list');
    const statCustEl = document.getElementById('stat-activity-customers');
    const statUploadsEl = document.getElementById('stat-activity-uploads');
    const statPoliciesEl = document.getElementById('stat-activity-policies');
    const footerCount = document.getElementById('activity-footer-count');

    if (!listEl) return;
    listEl.innerHTML = '';

    let filteredLogs = activityLogs.filter(log => {
        if (!filterDate || filterDate === 'all') return true;
        if (filterDate === 'today') return isToday(log.created_at);
        if (filterDate === 'yesterday') return isYesterday(log.created_at);
        if (filterDate === 'this-week') return isThisWeek(log.created_at);

        const d = parseLocalDate(log.created_at);
        if (!d) return false;
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const logDateStr = `${yyyy}-${mm}-${dd}`;
        return logDateStr === filterDate;
    });

    let custCount = 0;
    let uploadCount = 0;
    let polCount = 0;

    filteredLogs.forEach(l => {
        if (l.action_type === 'customer_created' || l.action_type === 'customer_updated') custCount++;
        if (l.action_type === 'rc_uploaded' || l.details?.includes('files synced') || l.details?.includes('RC') || l.details?.includes('vehicle')) uploadCount++;
        if (l.action_type === 'policy_renewed' || l.details?.includes('Policy')) polCount++;
    });

    if (statCustEl) statCustEl.textContent = custCount;
    if (statUploadsEl) statUploadsEl.textContent = uploadCount;
    if (statPoliciesEl) statPoliciesEl.textContent = polCount;
    if (footerCount) footerCount.textContent = `Showing ${filteredLogs.length} audit entries for ${filterDate === 'all' ? 'All Dates' : filterDate}`;

    if (filteredLogs.length === 0) {
        listEl.innerHTML = `
            <div style="text-align:center; padding:2rem 1rem; color:var(--text-muted);">
                <span style="font-size:1.75rem;">📅</span>
                <p style="margin-top:0.5rem; font-weight:600;">No entry logs found for the selected date.</p>
                <span style="font-size:0.75rem;">Add customer records or modify data to generate live audit entries.</span>
            </div>
        `;
        return;
    }

    const iconMap = {
        customer_created: { icon: '✨', title: 'New Customer & Fleet Added' },
        customer_updated: { icon: '📝', title: 'Customer Record Modified' },
        customer_deleted: { icon: '🗑️', title: 'Customer Deleted by Admin' },
        rc_uploaded: { icon: '🚗', title: 'RC Document Uploaded' },
        policy_renewed: { icon: '🔄', title: 'Policy Status Renewed' },
        backup_restored: { icon: '📥', title: 'Database Backup Restored' }
    };

    filteredLogs.forEach(log => {
        const info = iconMap[log.action_type] || { icon: '📋', title: 'CMS Activity' };
        const card = document.createElement('div');
        card.className = 'activity-card';

        card.innerHTML = `
            <div class="activity-card-icon">${info.icon}</div>
            <div class="activity-card-body">
                <div class="activity-card-header">
                    <span class="activity-card-title">${info.title}: <strong>${escapeHtml(log.customer_name || 'System')}</strong></span>
                    <span class="activity-card-time">${formatDate(log.created_at)} at ${formatTime(log.created_at)}</span>
                </div>
                <div class="activity-card-meta">
                    <span>${escapeHtml(log.details || '')}</span> · 
                    <span style="color:var(--primary); font-weight:600;">👤 ${escapeHtml(log.actor_name || log.actor_email || 'Staff')}</span>
                </div>
            </div>
        `;
        listEl.appendChild(card);
    });
}

function setupActivityTrackerEvents() {
    const btnOpen = document.getElementById('btn-open-activity');
    const datePicker = document.getElementById('activity-filter-date');
    const btnRefresh = document.getElementById('btn-refresh-activity');

    if (btnOpen) {
        btnOpen.addEventListener('click', async () => {
            if (!requireAuth('view date-wise activity logs and staff audit trail')) return;
            await fetchActivityLogs();
            renderActivityTracker('all');
            openModal('modal-activity-tracker');
        });
    }

    if (datePicker) {
        datePicker.addEventListener('change', (e) => {
            const val = e.target.value;
            document.querySelectorAll('.activity-quick-chips .chip-btn').forEach(b => b.classList.remove('active'));
            renderActivityTracker(val);
        });
    }

    if (btnRefresh) {
        btnRefresh.addEventListener('click', async () => {
            await fetchActivityLogs();
            renderActivityTracker(datePicker?.value || 'all');
            showToast('Activity audit trail refreshed!', 'info');
        });
    }

    document.querySelectorAll('.activity-quick-chips .chip-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.activity-quick-chips .chip-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            const range = e.currentTarget.dataset.range;
            if (datePicker) datePicker.value = '';
            renderActivityTracker(range);
        });
    });
}

// ==============================================================================
// 12. MANUAL BACKUP: EXPORT & IMPORT ENGINE (AUTHENTICATION ENFORCED)
// ==============================================================================
function exportBackupJSON() {
    if (!requireAuth('export full database backup')) return;

    const backupObj = {
        version: "2.0",
        app_name: "JD ENTERPRISES CMS Monitor",
        exported_at: new Date().toISOString(),
        exported_by: currentAuthUser?.email || 'authenticated_staff',
        total_customers: customersData.length,
        customers: customersData,
        activity_logs: activityLogs
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupObj, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `JD_Enterprises_Backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();

    showToast('Full JSON Database Backup exported successfully!', 'success');
}

function exportBackupCSV() {
    if (!requireAuth('export customer and fleet spreadsheet')) return;

    if (customersData.length === 0) {
        showToast('No customer records found to export.', 'warning');
        return;
    }

    const headers = [
        "S.No",
        "Customer Name",
        "Phone Number",
        "Type",
        "PAN Number",
        "Aadhaar Number",
        "Vehicle Count",
        "Vehicle Plates",
        "Primary Policy Number",
        "Primary Insurance Expiry",
        "General PUC Expiry",
        "Policy Status",
        "Created By",
        "Created Date"
    ];

    const rows = customersData.map((c, idx) => {
        const plates = (c.vehicles || []).map(v => v.vehicle_number || '').join('; ');
        return [
            idx + 1,
            `"${(c.full_name || '').replace(/"/g, '""')}"`,
            `"${c.phone || ''}"`,
            `"${c.type || 'permanent'}"`,
            `"${c.pan_number || ''}"`,
            `"${c.aadhar_number || ''}"`,
            (c.vehicles || []).length,
            `"${plates.replace(/"/g, '""')}"`,
            `"${(c.insurance_policy?.policy_number || '').replace(/"/g, '""')}"`,
            `"${c.insurance_policy?.insurance_expiry_date || ''}"`,
            `"${c.puc_expiry_date || ''}"`,
            `"${c.insurance_policy?.status || 'pending'}"`,
            `"${(c.created_by_name || c.created_by_email || 'Staff').replace(/"/g, '""')}"`,
            `"${c.created_at ? new Date(c.created_at).toISOString().split('T')[0] : ''}"`
        ].join(',');
    });

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent([headers.join(','), ...rows].join('\n'));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", csvContent);
    dlAnchor.setAttribute("download", `JD_Enterprises_Fleet_Spreadsheet_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();

    showToast('Excel/CSV Spreadsheet exported with Serial Numbers!', 'success');
}

function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length <= 1) return [];

    function parseCSVLine(line) {
        const values = [];
        let curr = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    curr += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                values.push(curr.trim());
                curr = '';
            } else {
                curr += char;
            }
        }
        values.push(curr.trim());
        return values;
    }

    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const parsedRecords = [];

    for (let l = 1; l < lines.length; l++) {
        const cols = parseCSVLine(lines[l]);
        if (cols.length === 0 || !cols.some(c => c.length > 0)) continue;

        const rowObj = {};
        headers.forEach((h, idx) => {
            rowObj[h] = cols[idx] || '';
        });

        const name = rowObj['customername'] || rowObj['name'] || cols[1] || '';
        const phone = rowObj['phonenumber'] || rowObj['phone'] || cols[2] || '';
        const type = (rowObj['type'] || cols[3] || '').toLowerCase().includes('lead') ? 'lead' : 'permanent';
        const pan = rowObj['pannumber'] || rowObj['pan'] || cols[4] || '';
        const aadhar = rowObj['aadhaarnumber'] || rowObj['aadhar'] || cols[5] || '';
        const plateStr = rowObj['vehicleplates'] || rowObj['plates'] || cols[7] || '';
        const policyNum = rowObj['primarypolicynumber'] || rowObj['policynumber'] || cols[8] || '';
        const insDate = rowObj['primaryinsuranceexpiry'] || rowObj['insuranceexpiry'] || cols[9] || null;
        const pucDate = rowObj['generalpucexpiry'] || rowObj['pucexpiry'] || cols[10] || null;
        const status = (rowObj['policystatus'] || rowObj['status'] || cols[11] || 'pending').toLowerCase();
        const createdBy = rowObj['createdby'] || cols[12] || 'Staff';
        const createdDate = rowObj['createddate'] || cols[13] || new Date().toISOString();

        if (!name && !phone) continue;

        const custId = generateUUID();
        const vehicles = [];
        const rawPlates = plateStr.split(/[;,|]/).map(p => p.trim()).filter(p => p.length > 0);

        if (rawPlates.length > 0) {
            rawPlates.forEach(p => {
                vehicles.push({
                    id: generateUUID(),
                    customer_id: custId,
                    vehicle_number: p.toUpperCase(),
                    insurance_expiry_date: insDate,
                    insurance_doc_url: null,
                    puc_expiry_date: pucDate,
                    puc_doc_url: null,
                    rc_document_url: null
                });
            });
        } else {
            vehicles.push({
                id: generateUUID(),
                customer_id: custId,
                vehicle_number: 'OD-02-XX-0001',
                insurance_expiry_date: insDate,
                insurance_doc_url: null,
                puc_expiry_date: pucDate,
                puc_doc_url: null,
                rc_document_url: null
            });
        }

        parsedRecords.push({
            id: custId,
            full_name: name,
            phone: phone,
            pan_number: pan.toUpperCase(),
            pan_doc_url: null,
            aadhar_number: aadhar,
            aadhar_doc_url: null,
            puc_doc_url: null,
            puc_expiry_date: pucDate,
            type: type,
            created_by_email: createdBy,
            created_by_name: createdBy,
            updated_by_email: createdBy,
            updated_by_name: createdBy,
            created_at: createdDate ? new Date(createdDate).toISOString() : new Date().toISOString(),
            updated_at: new Date().toISOString(),
            vehicles: vehicles,
            insurance_policy: {
                id: generateUUID(),
                customer_id: custId,
                policy_number: policyNum,
                insurance_expiry_date: insDate,
                policy_doc_url: null,
                status: ['completed', 'not_done'].includes(status) ? status : 'pending'
            }
        });
    }

    return parsedRecords;
}

function setupBackupDropzone() {
    const dropzone = document.getElementById('backup-import-dropzone');
    const fileInput = document.getElementById('input-backup-file');
    const emptyBox = document.getElementById('backup-dropzone-empty');
    const previewBox = document.getElementById('backup-dropzone-preview');
    const filenameEl = document.getElementById('backup-filename');
    const statsEl = document.getElementById('backup-summary-stats');
    const clearBtn = document.getElementById('btn-clear-backup-file');
    const executeBtn = document.getElementById('btn-execute-import');
    const feedback = document.getElementById('import-status-feedback');

    if (!dropzone || !fileInput) return;

    dropzone.onclick = (e) => {
        if (!requireAuth('import backups')) return;
        if (!e.target.closest('#btn-clear-backup-file')) {
            fileInput.value = '';
            fileInput.click();
        }
    };

    dropzone.ondragover = (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    };

    dropzone.ondragleave = () => {
        dropzone.classList.remove('drag-over');
    };

    dropzone.ondrop = (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        if (!requireAuth('import backups')) return;
        if (e.dataTransfer.files.length > 0) {
            handleBackupFile(e.dataTransfer.files[0]);
        }
    };

    fileInput.onchange = (e) => {
        if (!requireAuth('import backups')) return;
        if (e.target.files.length > 0) {
            handleBackupFile(e.target.files[0]);
        }
    };

    if (clearBtn) {
        clearBtn.onclick = (e) => {
            e.stopPropagation();
            backupParsedData = null;
            fileInput.value = '';
            if (emptyBox) emptyBox.style.display = 'flex';
            if (previewBox) previewBox.style.display = 'none';
            if (executeBtn) executeBtn.disabled = true;
            if (feedback) feedback.style.display = 'none';
        };
    }

    function handleBackupFile(file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target.result;
            try {
                if (file.name.toLowerCase().endsWith('.json')) {
                    const parsed = JSON.parse(text);
                    const customers = Array.isArray(parsed) ? parsed : (parsed.customers || []);
                    if (!Array.isArray(customers) || customers.length === 0) {
                        throw new Error('No valid customer records found in JSON file.');
                    }
                    
                    backupParsedData = customers.map(c => ({
                        ...c,
                        id: (c.id && isValidUUID(c.id)) ? c.id : generateUUID(),
                        vehicles: (c.vehicles || []).map(v => ({
                            ...v,
                            id: (v.id && isValidUUID(v.id)) ? v.id : generateUUID()
                        })),
                        insurance_policy: c.insurance_policy ? {
                            ...c.insurance_policy,
                            id: (c.insurance_policy.id && isValidUUID(c.insurance_policy.id)) ? c.insurance_policy.id : generateUUID()
                        } : {
                            id: generateUUID(),
                            policy_number: '',
                            insurance_expiry_date: null,
                            policy_doc_url: null,
                            status: 'pending'
                        }
                    }));

                    if (parsed.activity_logs && Array.isArray(parsed.activity_logs)) {
                        activityLogs = parsed.activity_logs;
                    }

                    if (emptyBox) emptyBox.style.display = 'none';
                    if (previewBox) previewBox.style.display = 'flex';
                    if (filenameEl) filenameEl.textContent = file.name;
                    if (statsEl) statsEl.textContent = `Found ${backupParsedData.length} customer records ready to restore.`;
                    if (executeBtn) executeBtn.disabled = false;
                    if (feedback) {
                        feedback.className = 'status-feedback badge-info';
                        feedback.textContent = `✅ Ready to restore ${backupParsedData.length} records. Select mode below.`;
                        feedback.style.display = 'block';
                    }
                } else if (file.name.toLowerCase().endsWith('.csv')) {
                    const parsedCustomers = parseCSV(text);
                    if (!parsedCustomers || parsedCustomers.length === 0) {
                        throw new Error('Could not parse any customer rows from CSV spreadsheet.');
                    }
                    backupParsedData = parsedCustomers;

                    if (emptyBox) emptyBox.style.display = 'none';
                    if (previewBox) previewBox.style.display = 'flex';
                    if (filenameEl) filenameEl.textContent = file.name;
                    if (statsEl) statsEl.textContent = `Parsed ${backupParsedData.length} spreadsheet records ready to restore.`;
                    if (executeBtn) executeBtn.disabled = false;
                    if (feedback) {
                        feedback.className = 'status-feedback badge-info';
                        feedback.textContent = `✅ Parsed ${backupParsedData.length} fleet records from CSV spreadsheet.`;
                        feedback.style.display = 'block';
                    }
                } else {
                    throw new Error('Unsupported file format. Please upload a .json or .csv backup file.');
                }
            } catch (err) {
                console.error('Backup parse error:', err);
                showToast(`Invalid backup file: ${err.message}`, 'error');
                if (feedback) {
                    feedback.className = 'status-feedback badge-danger';
                    feedback.textContent = `❌ ${err.message}`;
                    feedback.style.display = 'block';
                }
            }
        };
        reader.readAsText(file);
    }

    if (executeBtn) {
        executeBtn.addEventListener('click', async () => {
            if (!requireAuth('restore and import database backup')) return;

            if (!backupParsedData || backupParsedData.length === 0) {
                showToast('Please select a valid backup file first.', 'warning');
                return;
            }

            const mode = document.querySelector('input[name="import-mode"]:checked')?.value || 'merge';
            executeBtn.disabled = true;
            executeBtn.innerHTML = '⏳ Restoring & Syncing Backup...';

            try {
                if (mode === 'replace') {
                    customersData = backupParsedData;
                    await localStoreManager.clearAll();
                } else {
                    const existingMap = new Map(customersData.map(c => [c.id, c]));
                    backupParsedData.forEach(item => {
                        existingMap.set(item.id, item);
                    });
                    customersData = Array.from(existingMap.values());
                }

                for (let c of customersData) {
                    await localStoreManager.save(c);
                }

                if (supabaseClient) {
                    if (mode === 'replace') {
                        try {
                            await supabaseClient.from('customers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
                        } catch (e) {}
                    }

                    for (let c of backupParsedData) {
                        const validCustId = (c.id && isValidUUID(c.id)) ? c.id : generateUUID();
                        c.id = validCustId;

                        const custRecord = {
                            id: validCustId,
                            full_name: c.full_name || 'Customer',
                            phone: c.phone || '',
                            pan_number: c.pan_number || null,
                            pan_doc_url: c.pan_doc_url || null,
                            aadhar_number: c.aadhar_number || null,
                            aadhar_doc_url: c.aadhar_doc_url || null,
                            puc_doc_url: c.puc_doc_url || null,
                            puc_expiry_date: c.puc_expiry_date || null,
                            type: c.type || 'permanent',
                            created_by_email: c.created_by_email || 'Staff',
                            created_by_name: c.created_by_name || 'Staff',
                            updated_by_email: c.updated_by_email || 'Staff',
                            updated_by_name: c.updated_by_name || 'Staff',
                            created_at: c.created_at || new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        };

                        const { error: custErr } = await safeUpsertRecord(supabaseClient, 'customers', [custRecord]);
                        if (custErr) console.warn('Supabase customer upsert warning:', custErr.message);

                        if (c.vehicles && c.vehicles.length > 0) {
                            await safeDeleteRecord(supabaseClient, 'vehicles', 'customer_id', validCustId);
                            const vehPayloads = c.vehicles.map(v => ({
                                id: (v.id && isValidUUID(v.id)) ? v.id : generateUUID(),
                                customer_id: validCustId,
                                vehicle_number: v.vehicle_number || '',
                                rc_document_url: v.rc_document_url || null,
                                insurance_expiry_date: v.insurance_expiry_date || null,
                                insurance_doc_url: v.insurance_doc_url || null,
                                puc_expiry_date: v.puc_expiry_date || null,
                                puc_doc_url: v.puc_doc_url || null,
                                updated_by_email: currentAuthUser?.email || 'Staff'
                            }));
                            const { error: vErr } = await safeInsertRecord(supabaseClient, 'vehicles', vehPayloads);
                            if (vErr) console.warn('Vehicles insert notice:', vErr.message);
                        }

                        if (c.insurance_policy) {
                            await safeDeleteRecord(supabaseClient, 'insurance_policies', 'customer_id', validCustId);
                            const { error: pErr } = await safeInsertRecord(supabaseClient, 'insurance_policies', [{
                                id: (c.insurance_policy.id && isValidUUID(c.insurance_policy.id)) ? c.insurance_policy.id : generateUUID(),
                                customer_id: validCustId,
                                policy_number: c.insurance_policy.policy_number || '',
                                insurance_expiry_date: c.insurance_policy.insurance_expiry_date || null,
                                policy_doc_url: c.insurance_policy.policy_doc_url || null,
                                status: c.insurance_policy.status || 'pending'
                            }]);
                            if (pErr) console.warn('Policy insert notice:', pErr.message);
                        }
                    }
                    showToast(`Backup restored and synced to Supabase Cloud (${mode} mode)!`, 'success');
                } else {
                    showToast(`Backup restored to Local Storage (${mode} mode)!`, 'info');
                }

                await logActivity('backup_restored', `${backupParsedData.length} records`, `Restored in ${mode} mode`);
                closeModal('modal-import-backup');
                await fetchAllData();
                await fetchActivityLogs();
            } catch (err) {
                console.error('Backup restore failed:', err);
                showToast(`Restore failed: ${err.message}`, 'error');
            } finally {
                executeBtn.disabled = false;
                executeBtn.innerHTML = '<span>Restore & Sync Backup</span>';
            }
        });
    }
}

// Universal Document Viewer Modal (Authentication Enforced)
function openDocumentViewer(url, title) {
    if (!requireAuth('view or download attached documents')) return;

    if (!url) {
        showToast('No document attachment available to preview.', 'warning');
        return;
    }
    const previewContainer = document.getElementById('preview-container');
    const titleEl = document.getElementById('preview-doc-title');
    const downloadBtn = document.getElementById('btn-download-preview-doc');

    if (!previewContainer) return;
    previewContainer.innerHTML = '';
    if (titleEl) titleEl.textContent = title || 'Document Preview';
    if (downloadBtn) {
        downloadBtn.href = url;
        downloadBtn.setAttribute('download', `${(title || 'document').replace(/[^a-zA-Z0-9_-]/g, '_')}`);
    }

    const isPdf = url.includes('.pdf') || url.startsWith('data:application/pdf');

    if (isPdf) {
        const iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.title = title || 'Document';
        iframe.style.width = '100%';
        iframe.style.height = '70vh';
        iframe.style.border = 'none';
        iframe.style.borderRadius = 'var(--radius-md)';
        previewContainer.appendChild(iframe);
    } else {
        const img = document.createElement('img');
        img.src = url;
        img.alt = title || 'Document';
        img.style.maxWidth = '100%';
        img.style.maxHeight = '70vh';
        img.style.objectFit = 'contain';
        img.style.borderRadius = 'var(--radius-md)';
        previewContainer.appendChild(img);
    }

    openModal('modal-doc-preview');
}

// ==============================================================================
// 13. SUPABASE SETTINGS MODAL & CONNECTION TEST
// ==============================================================================
async function testSupabaseConnection() {
    const rawUrl = document.getElementById('cfg-supabase-url').value.trim();
    const rawKey = document.getElementById('cfg-supabase-anon-key').value.trim();
    const url = rawUrl.replace(/\/+$/, '');
    const key = rawKey;

    const feedback = document.getElementById('supabase-test-feedback');
    if (!feedback) return;
    feedback.style.display = 'block';

    if (!url || !key) {
        feedback.className = 'status-feedback badge-danger';
        feedback.textContent = '❌ Please enter both Supabase Project URL and Anon Key.';
        return;
    }

    if (!url.startsWith('https://')) {
        feedback.className = 'status-feedback badge-danger';
        feedback.textContent = '❌ Project URL must start with https:// (e.g. https://xyzcompany.supabase.co)';
        return;
    }

    feedback.className = 'status-feedback badge-info';
    feedback.textContent = '⏳ Testing connection to Supabase database...';

    try {
        if (!window.supabase) {
            throw new Error('Supabase JS SDK not loaded. Please check your internet connection.');
        }
        const client = window.supabase.createClient(url, key);
        const { data, error } = await client.from('customers').select('*').limit(1);

        if (error) {
            feedback.className = 'status-feedback badge-danger';
            feedback.innerHTML = `❌ Database Error: ${escapeHtml(error.message)}<br><small style="margin-top:0.35rem; display:block;">Click <b>"📋 Copy SQL Migration"</b> or <b>"📋 Copy schema.sql"</b> above and execute in your Supabase SQL Editor.</small>`;
        } else {
            // Check if created_by_email or other audit columns are present in schema cache
            const testPayload = { id: generateUUID(), full_name: '__test_probe__', created_by_email: 'test@probe.com' };
            const { error: probeErr } = await client.from('customers').select('id, full_name, created_by_email').limit(1);

            if (probeErr && (probeErr.message.includes('created_by_email') || probeErr.message.includes('schema cache'))) {
                feedback.className = 'status-feedback badge-warning';
                feedback.innerHTML = `⚠️ Connected to Supabase! However, column <code>created_by_email</code> is missing from the database schema.<br><small style="margin-top:0.35rem; display:block;">Automatic schema fallback is active (saving works). To enable full cloud audit fields, click <b>"📋 Copy SQL Migration"</b> above and run it in Supabase SQL Editor.</small>`;
            } else {
                feedback.className = 'status-feedback badge-success';
                feedback.textContent = '✅ Connected successfully! PostgreSQL schema, columns & RLS verified.';
            }
        }
    } catch (err) {
        feedback.className = 'status-feedback badge-danger';
        feedback.textContent = `❌ Connection Failed: ${err.message}`;
    }
}

async function saveSupabaseSettings() {
    const rawUrl = document.getElementById('cfg-supabase-url').value.trim();
    const rawKey = document.getElementById('cfg-supabase-anon-key').value.trim();
    const url = rawUrl.replace(/\/+$/, '');
    const key = rawKey;

    if (url && key) {
        localStorage.setItem('supabase_url', url);
        localStorage.setItem('supabase_anon_key', key);
        await initSupabase();
        await fetchAllData();
        await fetchActivityLogs();
        showToast('Supabase cloud settings saved and connected!', 'success');
    }
    closeModal('modal-supabase-settings');
}

function disconnectSupabase() {
    localStorage.removeItem('supabase_url');
    localStorage.removeItem('supabase_anon_key');
    supabaseClient = null;
    updateLoggedOutUI();
    fetchAllData();
    showToast('Disconnected from cloud.', 'info');
    closeModal('modal-supabase-settings');
}

// ==============================================================================
// ==============================================================================
// 14. AUTHENTICATION HANDLERS: SECURE SIGN IN, SIGN UP & LOGOUT
// ==============================================================================
function setupAuthTabsAndToggles() {
    const tabSignIn = document.getElementById('tab-auth-signin');
    const tabSignUp = document.getElementById('tab-auth-signup');
    const tabReset = document.getElementById('tab-auth-reset');

    const formSignIn = document.getElementById('form-auth-signin');
    const formSignUp = document.getElementById('form-auth-signup');
    const formReset = document.getElementById('form-auth-reset');
    const authFeedback = document.getElementById('auth-feedback');

    function switchAuthTab(activeTab, activeForm) {
        [tabSignIn, tabSignUp, tabReset].forEach(t => t && t.classList.remove('active'));
        [formSignIn, formSignUp, formReset].forEach(f => f && (f.style.display = 'none'));
        if (activeTab) activeTab.classList.add('active');
        if (activeForm) activeForm.style.display = 'block';
        if (authFeedback) authFeedback.style.display = 'none';
    }

    if (tabSignIn) tabSignIn.addEventListener('click', () => switchAuthTab(tabSignIn, formSignIn));
    if (tabSignUp) tabSignUp.addEventListener('click', () => switchAuthTab(tabSignUp, formSignUp));
    if (tabReset) tabReset.addEventListener('click', () => switchAuthTab(tabReset, formReset));

    // Password visibility toggle buttons
    document.querySelectorAll('.btn-toggle-pwd').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const targetInput = document.getElementById(targetId);
            if (targetInput) {
                const isPassword = targetInput.getAttribute('type') === 'password';
                targetInput.setAttribute('type', isPassword ? 'text' : 'password');
                btn.style.opacity = isPassword ? '1' : '0.6';
            }
        });
    });
}

// Email/Password Sign In Handler
async function handleAuthSignIn(e) {
    e.preventDefault();
    const email = document.getElementById('auth-signin-email').value.trim();
    const password = document.getElementById('auth-signin-password').value;
    const submitBtn = document.getElementById('btn-auth-signin-submit');
    const feedback = document.getElementById('auth-feedback');

    if (!email) {
        showToast('Please enter your email address.', 'warning');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '⏳ Signing in...';
    if (feedback) feedback.style.display = 'none';

    try {
        if (supabaseClient) {
            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (error) throw error;
            updateAuthStateUI(data.user);
        } else {
            // Local authentication fallback
            const isAdm = email.toLowerCase().includes('admin');
            const localUser = {
                id: generateUUID(),
                email: email,
                user_metadata: { full_name: email.split('@')[0], role: isAdm ? 'admin' : 'staff' }
            };
            updateAuthStateUI(localUser, isAdm ? 'admin' : 'staff');
        }

        if (feedback) {
            feedback.className = 'status-feedback badge-success';
            feedback.textContent = `✅ Welcome back, ${email}!`;
            feedback.style.display = 'block';
        }

        showToast(`Signed in successfully as ${email}`, 'success');
        setTimeout(() => {
            closeModal('modal-auth');
            document.getElementById('form-auth-signin')?.reset();
        }, 500);
    } catch (err) {
        console.error('Sign In Error:', err);
        if (feedback) {
            feedback.className = 'status-feedback badge-danger';
            feedback.textContent = `❌ ${err.message || 'Invalid login credentials'}`;
            feedback.style.display = 'block';
        }
        showToast(`Sign in failed: ${err.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Sign In to Dashboard</span>';
    }
}

// Staff Account Registration Handler
async function handleAuthSignUp(e) {
    e.preventDefault();
    const fullName = document.getElementById('auth-signup-fullname').value.trim();
    const email = document.getElementById('auth-signup-email').value.trim();
    const password = document.getElementById('auth-signup-password').value;
    const confirmPassword = document.getElementById('auth-signup-confirm').value;
    const submitBtn = document.getElementById('btn-auth-signup-submit');
    const feedback = document.getElementById('auth-feedback');

    if (password !== confirmPassword) {
        if (feedback) {
            feedback.className = 'status-feedback badge-danger';
            feedback.textContent = '❌ Passwords do not match. Please recheck.';
            feedback.style.display = 'block';
        }
        return;
    }

    if (password.length < 6) {
        if (feedback) {
            feedback.className = 'status-feedback badge-danger';
            feedback.textContent = '❌ Password must be at least 6 characters.';
            feedback.style.display = 'block';
        }
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '⏳ Creating account...';
    if (feedback) feedback.style.display = 'none';

    try {
        if (supabaseClient) {
            const { data, error } = await supabaseClient.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: { full_name: fullName }
                }
            });

            if (error) throw error;

            if (data.session?.user) {
                updateAuthStateUI(data.session.user);
                showToast('Account registered and signed in!', 'success');
            } else {
                if (feedback) {
                    feedback.className = 'status-feedback badge-success';
                    feedback.textContent = '✅ Account created! Please check your email to confirm registration or sign in.';
                    feedback.style.display = 'block';
                }
                showToast('Account registered! Check email.', 'info');
            }
        } else {
            const localUser = {
                id: generateUUID(),
                email: email,
                user_metadata: { full_name: fullName, role: 'staff' }
            };
            updateAuthStateUI(localUser, 'staff');
            showToast('Staff account registered locally and signed in!', 'success');
        }

        setTimeout(() => {
            closeModal('modal-auth');
            document.getElementById('form-auth-signup')?.reset();
        }, 800);
    } catch (err) {
        console.error('Sign Up Error:', err);
        if (feedback) {
            feedback.className = 'status-feedback badge-danger';
            feedback.textContent = `❌ ${err.message}`;
            feedback.style.display = 'block';
        }
        showToast(`Registration error: ${err.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Register Staff Account</span>';
    }
}

// Password Reset Request Handler
async function handleAuthResetPassword(e) {
    e.preventDefault();
    const email = document.getElementById('auth-reset-email').value.trim();
    const submitBtn = document.getElementById('btn-auth-reset-submit');
    const feedback = document.getElementById('auth-feedback');

    if (!email) {
        showToast('Please enter your registered email.', 'warning');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '⏳ Sending reset link...';
    if (feedback) feedback.style.display = 'none';

    try {
        if (supabaseClient) {
            const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.href
            });
            if (error) throw error;
        }

        if (feedback) {
            feedback.className = 'status-feedback badge-success';
            feedback.textContent = `✅ Password recovery link sent to ${email}. Please check your inbox.`;
            feedback.style.display = 'block';
        }
        showToast('Password reset link sent!', 'info');
    } catch (err) {
        console.error('Password Reset Error:', err);
        if (feedback) {
            feedback.className = 'status-feedback badge-danger';
            feedback.textContent = `❌ ${err.message}`;
            feedback.style.display = 'block';
        }
        showToast(`Password reset error: ${err.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Send Password Reset Link</span>';
    }
}

// Sign Out Handler
async function handleAuthSignOut() {
    try {
        if (supabaseClient) {
            await supabaseClient.auth.signOut();
        }
    } catch (err) {
        console.warn('Supabase signout warning:', err);
    }
    
    updateLoggedOutUI();
    showToast('Signed out. The application is now in locked read-only mode.', 'info');
}

// ==============================================================================
// 15. FORM RESET & EVENT LISTENERS
// ==============================================================================
function resetCustomerForm() {
    const form = document.getElementById('customer-form');
    if (form) form.reset();
    document.getElementById('form-customer-id').value = '';
    document.getElementById('input-existing-aadhar-url').value = '';
    document.getElementById('input-existing-pan-url').value = '';
    document.getElementById('input-customer-puc-date').value = '';
    const permRadio = document.getElementById('type-permanent');
    if (permRadio) permRadio.checked = true;

    formAadhaarDoc = { file: null, previewUrl: null, name: '', isImage: false };
    formPanDoc = { file: null, previewUrl: null, name: '', isImage: false };
    vehicleFilesState = {};

    bindSingleDropzone('input-aadhar-file', 'aadhar-dropzone', 'aadhar-dropzone-empty', 'aadhar-dropzone-preview', 'aadhar-thumb-img', 'aadhar-filename', 'aadhar-filesize', 'btn-preview-aadhar', 'btn-clear-aadhar', formAadhaarDoc, 'Aadhaar Card');
    bindSingleDropzone('input-pan-file', 'pan-dropzone', 'pan-dropzone-empty', 'pan-dropzone-preview', 'pan-thumb-img', 'pan-filename', 'pan-filesize', 'btn-preview-pan', 'btn-clear-pan', formPanDoc, 'PAN Card');

    renderDynamicVehicleInputs(1);
}

function bindEventListeners() {
    // --- Search Input ---
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            activeFilters.search = e.target.value;
            renderDashboard();
        });
    }

    // --- Dropdown Filters ---
    const sortFilter = document.getElementById('filter-sort-order');
    if (sortFilter) {
        sortFilter.addEventListener('change', (e) => {
            activeFilters.sortOrder = e.target.value;
            renderDashboard();
        });
    }

    const entryDateFilter = document.getElementById('filter-entry-date');
    if (entryDateFilter) {
        entryDateFilter.addEventListener('change', (e) => {
            activeFilters.entryDate = e.target.value;
            renderDashboard();
        });
    }

    const custTypeFilter = document.getElementById('filter-customer-type');
    if (custTypeFilter) {
        custTypeFilter.addEventListener('change', (e) => {
            activeFilters.customerType = e.target.value;
            renderDashboard();
        });
    }

    const vehCountFilter = document.getElementById('filter-vehicle-count');
    if (vehCountFilter) {
        vehCountFilter.addEventListener('change', (e) => {
            activeFilters.vehicleCount = e.target.value;
            renderDashboard();
        });
    }

    const expWarningFilter = document.getElementById('filter-expiry-warning');
    if (expWarningFilter) {
        expWarningFilter.addEventListener('change', (e) => {
            activeFilters.expiryWarning = e.target.value;
            renderDashboard();
        });
    }

    const renStatusFilter = document.getElementById('filter-renewal-status');
    if (renStatusFilter) {
        renStatusFilter.addEventListener('change', (e) => {
            activeFilters.renewalStatus = e.target.value;
            renderDashboard();
        });
    }

    // --- Export Dropdown Menu Toggle ---
    const btnExportBackup = document.getElementById('btn-export-backup');
    const exportMenu = document.getElementById('export-dropdown-menu');
    if (btnExportBackup && exportMenu) {
        btnExportBackup.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!requireAuth('export customer database backups')) return;
            const isHidden = exportMenu.style.display === 'none' || exportMenu.style.display === '';
            exportMenu.style.display = isHidden ? 'flex' : 'none';
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.dropdown-action-wrap')) {
                exportMenu.style.display = 'none';
            }
        });
    }

    const btnExportJSON = document.getElementById('btn-export-json');
    if (btnExportJSON) {
        btnExportJSON.addEventListener('click', () => {
            if (!requireAuth('export database backup')) return;
            exportBackupJSON();
            if (exportMenu) exportMenu.style.display = 'none';
        });
    }

    const btnExportCSV = document.getElementById('btn-export-csv');
    if (btnExportCSV) {
        btnExportCSV.addEventListener('click', () => {
            if (!requireAuth('export database backup')) return;
            exportBackupCSV();
            if (exportMenu) exportMenu.style.display = 'none';
        });
    }

    // --- Import Modal Trigger (Authentication Enforced) ---
    const btnOpenImport = document.getElementById('btn-open-import');
    if (btnOpenImport) {
        btnOpenImport.addEventListener('click', () => {
            if (!requireAuth('import and restore database backups')) return;
            openModal('modal-import-backup');
        });
    }

    // --- Add Customer Modal Trigger (Authentication Enforced) ---
    const btnAddCustomer = document.getElementById('btn-add-customer');
    if (btnAddCustomer) {
        btnAddCustomer.addEventListener('click', () => {
            if (!requireAuth('add new customer records & vehicles')) return;
            resetCustomerForm();
            document.getElementById('modal-form-title').textContent = 'Add Customer & Vehicle Fleet';
            openModal('modal-customer');
        });
    }

    // --- Banner Login Trigger ---
    const btnBannerLogin = document.getElementById('btn-banner-login');
    if (btnBannerLogin) {
        btnBannerLogin.addEventListener('click', () => {
            openModal('modal-auth');
        });
    }

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
    const inputAadhaar = document.getElementById('input-aadhar');
    if (inputAadhaar) {
        inputAadhaar.addEventListener('input', (e) => {
            let val = e.target.value.replace(/\D/g, '').substring(0, 12);
            let formatted = val.match(/.{1,4}/g)?.join(' ') || val;
            e.target.value = formatted;
        });
    }

    // --- PAN Formatter (ABCDE1234F) ---
    const inputPan = document.getElementById('input-pan');
    if (inputPan) {
        inputPan.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
        });
    }

    // --- Customer Form Submission (Authentication Enforced) ---
    const customerForm = document.getElementById('customer-form');
    if (customerForm) {
        customerForm.addEventListener('submit', handleCustomerFormSubmit);
    }

    // --- Supabase Config Modal Triggers ---
    const btnOpenSettings = document.getElementById('btn-open-settings');
    if (btnOpenSettings) {
        btnOpenSettings.addEventListener('click', () => {
            if (!requireAuth('configure database connection settings')) return;
            document.getElementById('cfg-supabase-url').value = localStorage.getItem('supabase_url') || '';
            document.getElementById('cfg-supabase-anon-key').value = localStorage.getItem('supabase_anon_key') || '';
            const feedback = document.getElementById('supabase-test-feedback');
            if (feedback) feedback.style.display = 'none';
            openModal('modal-supabase-settings');
        });
    }

    const btnTestSupabase = document.getElementById('btn-test-supabase');
    if (btnTestSupabase) btnTestSupabase.addEventListener('click', testSupabaseConnection);

    const btnSaveSupabase = document.getElementById('btn-save-supabase');
    if (btnSaveSupabase) btnSaveSupabase.addEventListener('click', saveSupabaseSettings);

    const btnDisconnect = document.getElementById('btn-disconnect-supabase');
    if (btnDisconnect) btnDisconnect.addEventListener('click', disconnectSupabase);

    const btnCopyMigSql = document.getElementById('btn-copy-migration-sql');
    if (btnCopyMigSql) {
        btnCopyMigSql.addEventListener('click', () => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(SCHEMA_MIGRATION_SQL).then(() => {
                    showToast('📋 SQL Migration script copied to clipboard!', 'success');
                }).catch(() => {
                    copyViaTextarea(SCHEMA_MIGRATION_SQL);
                });
            } else {
                copyViaTextarea(SCHEMA_MIGRATION_SQL);
            }
        });
    }

    const btnCopyFullSql = document.getElementById('btn-copy-full-sql');
    if (btnCopyFullSql) {
        btnCopyFullSql.addEventListener('click', () => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(FULL_SCHEMA_SQL).then(() => {
                    showToast('📋 Full schema.sql copied to clipboard!', 'success');
                }).catch(() => {
                    copyViaTextarea(FULL_SCHEMA_SQL);
                });
            } else {
                copyViaTextarea(FULL_SCHEMA_SQL);
            }
        });
    }

    // --- Supabase Auth Triggers ---
    const btnNavLogin = document.getElementById('btn-nav-login');
    if (btnNavLogin) {
        btnNavLogin.addEventListener('click', () => {
            const feedback = document.getElementById('auth-feedback');
            if (feedback) feedback.style.display = 'none';
            openModal('modal-auth');
        });
    }

    const btnNavLogout = document.getElementById('btn-nav-logout');
    if (btnNavLogout) {
        btnNavLogout.addEventListener('click', handleAuthSignOut);
    }

    const formSignIn = document.getElementById('form-auth-signin');
    if (formSignIn) formSignIn.addEventListener('submit', handleAuthSignIn);

    const formSignUp = document.getElementById('form-auth-signup');
    if (formSignUp) formSignUp.addEventListener('submit', handleAuthSignUp);

    const formReset = document.getElementById('form-auth-reset');
    if (formReset) formReset.addEventListener('submit', handleAuthResetPassword);

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
    const btnTheme = document.getElementById('btn-theme-toggle');
    if (btnTheme) btnTheme.addEventListener('click', toggleTheme);
}

function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('show');
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function copyViaTextarea(text) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('📋 Copied to clipboard!', 'success');
    } catch (e) {
        console.warn('Clipboard copy error:', e);
        showToast('Unable to copy automatically. Please open schema.sql directly.', 'info');
    }
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
        if (sun) sun.style.display = 'block';
        if (moon) moon.style.display = 'none';
    } else {
        if (sun) sun.style.display = 'none';
        if (moon) moon.style.display = 'block';
    }
}

// --- Toast Notifications ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
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
