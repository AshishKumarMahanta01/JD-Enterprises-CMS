# JD ENTERPRISES CMS Monitor — Insurance & Fleet Manager

A modern, high-performance web application to monitor Vehicle Insurance and Pollution (PUC) expiry dates, manage customer KYC (Aadhaar & PAN), dynamically upload & preview Vehicle RC cards with **Supabase Authentication & Row Level Security (RLS)**, **Multi-Staff Real-Time Collaboration**, **Date-Wise Data Entry Audit Tracker**, **Dual Auto/Manual RC Plate Extraction**, and **Manual JSON/Excel Backup & Restore Engine**.

---

## ✨ Key Features & Capabilities

1. **🔐 Supabase Authentication & Role-Based Access Control (Admin vs. Staff)**:
   - Built-in secure portal with **Sign In**, **Create Account**, **Password Reset**, and **Logout**.
   - **Role Separation**:
     - 👑 **Admin**: Full control to create, update, export/import, inspect staff audit logs, and **delete** customer records.
     - 👤 **Staff**: Can create, update, upload RC/KYC documents, and edit policies. Delete button is strictly locked to prevent accidental data loss.
   - Strict Row Level Security (RLS) on PostgreSQL tables (`customers`, `vehicles`, `insurance_policies`, `activity_logs`) and Storage bucket (`rc-documents`).

2. **⚡ Real-Time Multi-Staff Live Collaboration**:
   - Multiple staff members can work concurrently on different laptops and mobile phones.
   - PostgreSQL table changes automatically trigger live synchronization via Supabase Realtime without page refresh.

3. **📊 Date-Wise Data Entry & Activity Tracker**:
   - Dedicated modal (`#modal-activity-tracker`) displaying who created or modified each customer and vehicle record.
   - Quick date filters: **Today**, **Yesterday**, **This Week**, or **Pick Specific Date**.
   - Live metrics summary: Customers processed, Documents uploaded, and Policies renewed on the selected date.

4. **🚗 Dual Auto + Manual RC Plate Extraction**:
   - Automatically detects Indian vehicle registration plate patterns (e.g. `OD-02-AB-1234`, `DL-01-XY-5678`) from uploaded RC document filenames/metadata.
   - Dedicated **"🔍 Auto-Fetch RC"** button on each vehicle card.
   - Keeps the vehicle plate input **100% manually editable** at all times for manual corrections or overrides.

5. **📤 Manual Backup & Restore Engine (JSON & Excel CSV)**:
   - **Export Database**: Download full JSON database backups (`.json`) or clean Excel spreadsheets (`.csv`) with Serial Numbers (`S.No`).
   - **Import & Restore**: Drag-and-drop or select any `.json` or `.csv` backup file with two safe restore modes:
     - 🔄 **Merge Mode (Recommended)**: Safely adds new entries and updates matching records without deleting existing data.
     - ⚠️ **Clean Restore Mode**: Replaces existing table records with the backup snapshot.

6. **🔢 Serial Numbers (`S.No`) & Smart Sorting / Date Filters**:
   - Sequential `# 1`, `# 2`, `# 3` column in the main dashboard table.
   - Sort Order selector: Newest First, Oldest First, Recently Modified, Name (A-Z), Name (Z-A), Insurance Expiry Soonest, PUC Expiry Soonest.
   - Entry Date filter: All Time, Added Today, Added Yesterday, Added This Week, Added This Month.

7. **📱 Multi-Device Ready (Laptop & Mobile)**:
   - Fully responsive layout with mobile-optimized touch controls, dark/light theme switching, and persistent IndexedDB offline fallback.

---

## 🚀 Quick Setup with Supabase (3 Minutes)

### Step 1: Create Supabase Project & Run SQL Migration
1. Go to [https://supabase.com](https://supabase.com) and create a free project.
2. Open the **SQL Editor** (`>_`) from the left sidebar.
3. Copy all contents of `schema.sql` and click **Run**.
   - This creates `customers`, `vehicles`, `insurance_policies`, and `activity_logs` tables with audit fields, sets up the `rc-documents` storage bucket, and enables Realtime sync.

### Step 2: Connect in the Application
1. Open `index.html` in your browser.
2. Click the **⚡ Supabase Config** button in the top navigation bar.
3. Paste your **Supabase Project URL** and **Anon Public Key** (from Supabase Dashboard > `Project Settings` > `API`).
4. Click **Save & Connect**.

### Step 3: Register Staff or Admin Account
1. Click the **"Sign In"** button in the header.
2. Switch to the **"Create Account"** tab and register your email (e.g. `admin@jdenterprises.com` for Admin, or any staff email).
3. Once logged in, your user role badge (`👑 Admin` or `👤 Staff`) will appear in the top bar, and all fleet records, documents, and activity logs will synchronize in real-time.

---

## 📂 File Architecture

```
├── index.html           # Main UI, Activity Tracker modal, Backup Import modal, Auth modal
├── style.css            # Design system, S.No pills, role badges, audit tags, backup dropzone
├── app.js               # Core logic: Supabase Auth, Realtime sync, RC plate parser, Export/Import
├── schema.sql           # Complete Supabase PostgreSQL schema with RLS, audit trail & Realtime
├── vercel.json          # Vercel deployment configuration
└── README.md            # Documentation
```

