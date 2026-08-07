-- ==============================================================================
-- Schema: Insurance & Vehicle Fleet Management System (with Individual Insurance & PUC)
-- Compatible with Supabase PostgreSQL & Storage (Aadhaar, PAN, Insurance, PUC & RC)
-- ==============================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Create Customers Table
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    pan_number TEXT,
    pan_doc_url TEXT,
    aadhar_number TEXT,
    aadhar_doc_url TEXT,
    puc_doc_url TEXT,
    type TEXT NOT NULL DEFAULT 'permanent' CHECK (type IN ('permanent', 'lead')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create Vehicles Table (One Customer -> Many Vehicles with RC, Insurance & PUC)
CREATE TABLE IF NOT EXISTS public.vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    vehicle_number TEXT NOT NULL,
    rc_document_url TEXT,
    insurance_expiry_date DATE,
    insurance_doc_url TEXT,
    puc_expiry_date DATE,
    puc_doc_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Create Insurance Policies Table (Primary / Customer-level Policy)
CREATE TABLE IF NOT EXISTS public.insurance_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    policy_number TEXT,
    insurance_expiry_date DATE,
    policy_doc_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'not_done')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Create Performance Indexes
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_type ON public.customers(type);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer_id ON public.vehicles(customer_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_number ON public.vehicles(vehicle_number);
CREATE INDEX IF NOT EXISTS idx_vehicles_ins_expiry ON public.vehicles(insurance_expiry_date);
CREATE INDEX IF NOT EXISTS idx_vehicles_puc_expiry ON public.vehicles(puc_expiry_date);
CREATE INDEX IF NOT EXISTS idx_insurance_customer_id ON public.insurance_policies(customer_id);
CREATE INDEX IF NOT EXISTS idx_insurance_expiry ON public.insurance_policies(insurance_expiry_date);
CREATE INDEX IF NOT EXISTS idx_insurance_status ON public.insurance_policies(status);

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_policies ENABLE ROW LEVEL SECURITY;

-- 7. Public RLS Policies
DROP POLICY IF EXISTS "Public access to customers" ON public.customers;
CREATE POLICY "Public access to customers"
    ON public.customers
    FOR ALL
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Public access to vehicles" ON public.vehicles;
CREATE POLICY "Public access to vehicles"
    ON public.vehicles
    FOR ALL
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Public access to insurance_policies" ON public.insurance_policies;
CREATE POLICY "Public access to insurance_policies"
    ON public.insurance_policies
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 8. Supabase Storage: Create public bucket for RC & All Customer Documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('rc-documents', 'rc-documents', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage Bucket Policies
DROP POLICY IF EXISTS "Public RC Document Upload Policy" ON storage.objects;
CREATE POLICY "Public RC Document Upload Policy"
    ON storage.objects
    FOR INSERT
    WITH CHECK (bucket_id = 'rc-documents');

DROP POLICY IF EXISTS "Public RC Document Select Policy" ON storage.objects;
CREATE POLICY "Public RC Document Select Policy"
    ON storage.objects
    FOR SELECT
    USING (bucket_id = 'rc-documents');

DROP POLICY IF EXISTS "Public RC Document Update Policy" ON storage.objects;
CREATE POLICY "Public RC Document Update Policy"
    ON storage.objects
    FOR UPDATE
    USING (bucket_id = 'rc-documents');

DROP POLICY IF EXISTS "Public RC Document Delete Policy" ON storage.objects;
CREATE POLICY "Public RC Document Delete Policy"
    ON storage.objects
    FOR DELETE
    USING (bucket_id = 'rc-documents');
