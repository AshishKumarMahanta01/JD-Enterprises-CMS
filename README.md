# JD ENTERPRISES CMS Monitor — Insurance & Fleet Manager

A modern, high-performance web application to monitor Vehicle Insurance and Pollution (PUC) expiry dates, manage customer leads, track Aadhaar & PAN details, and dynamically upload & preview multiple Vehicle RC cards with seamless **Supabase Database & Storage** integration, offline-first **IndexedDB**, and **Vercel** deployment readiness.

---

## ✨ Key Features

1. **Aadhaar & PAN Card Management**:
   - 12-digit Aadhaar input with auto-formatting (`XXXX XXXX XXXX`) and Aadhaar card document upload with live preview & download.
   - 10-character PAN Card input (`ABCDE1234F`) with uppercase auto-formatting and PAN document upload.
2. **Dynamic Multi-Vehicle RC Engine**:
   - Dynamic **Vehicle Count** selector (e.g. 1 to 20 vehicles).
   - Form dynamically generates responsive vehicle cards for each vehicle with:
     - Vehicle Plate Number (e.g. `OD-02-AB-1234`)
     - Vehicle Category / Model (2-Wheeler, 4-Wheeler, Commercial, SUV, etc.)
     - **RC Document Upload** with instant thumbnail preview, remove/replace, and full modal preview.
     - **Insurance Expiry Date & Doc Upload** with countdown and badge alert.
     - **PUC Expiry Date & Doc Upload** with countdown and badge alert.
   - Quick helpers: Duplicate dates to all vehicles, Add/Remove vehicle cards dynamically.
3. **Universal Document Previewer**:
   - Inspect Aadhaar, PAN, and any vehicle's RC, Insurance, or PUC in high definition with zoom, pan, and direct download.
4. **Fleet View Modal**:
   - View all vehicles, plates, and document statuses of any customer at a glance.
5. **Supabase & Vercel Integration**:
   - **Dual Storage Engine**: Works offline with IndexedDB and seamlessly syncs with Supabase PostgreSQL and Supabase Storage (`vehicle-docs`).
   - In-app **Supabase Settings Modal** to configure Project URL & Anon Key with one-click connection test.
   - `supabase_schema.sql` script with `customers` and `vehicles` tables, storage bucket, and RLS policies.
   - Ready for Vercel deployment with `vercel.json` and serverless API endpoints in `/api/records.js`.
6. **Data Export / Backup**:
   - One-click CSV (Excel compatible) & JSON backup/restore supporting multi-vehicle data and documents.
7. **Theme Switcher**:
   - Sleek Dark / Light theme with smooth transitions and persistent preference.

---

## 🚀 Quick Setup with Supabase (2 Minutes)

### Step 1: Create Supabase Project & Run SQL Schema
1. Go to [https://supabase.com](https://supabase.com) and create a free project.
2. Open the **SQL Editor** from the left sidebar.
3. Copy all contents of `supabase_schema.sql` and click **Run**.
   - This automatically creates the `customers` and `vehicles` tables, the `vehicle-docs` storage bucket, and enables RLS policies.

### Step 2: Connect in the App
1. Open the app in your browser (`index.html`).
2. Click the **⚡ Supabase Settings** button in the top navigation bar.
3. Paste your **Supabase Project URL** and **Anon Public Key** (found in your Supabase Dashboard under `Project Settings` > `API`).
4. Click **Test & Save Connection**.
5. Your data and file uploads (RC, Aadhaar, PAN, Insurance, PUC) will now automatically sync to Supabase!

> **Note**: Even without Supabase credentials, the app runs 100% offline using the browser's IndexedDB engine!

---

## ⚡ Deployment to Vercel

1. Push your repository to GitHub / GitLab / Bitbucket.
2. Go to [https://vercel.com](https://vercel.com) and click **Add New Project**.
3. Select your repository and click **Deploy**.
4. *(Optional)* Under **Environment Variables**, you can add:
   - `SUPABASE_URL`: Your Supabase Project URL
   - `SUPABASE_ANON_KEY`: Your Supabase Anon Key
5. Your app is now live with global CDN caching and SSL!

---

## 📂 File Architecture

```
├── index.html           # Main semantic HTML structure & modals
├── styles.css           # Modern CSS design system, vehicle cards & dropzones
├── app.js               # Core app logic (Supabase client, dynamic form unfolding, charts)
├── supabase_schema.sql  # Supabase SQL migration script
├── vercel.json          # Vercel deployment configuration
├── api/
│   └── records.js       # Vercel Serverless Function
└── README.md            # Documentation
```
