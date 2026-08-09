-- ==============================================================================
-- Schema & Migration Script: Insurance & Vehicle Fleet Management System
-- Compatible with Supabase PostgreSQL, Row Level Security (RLS) & Storage
-- ==============================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Create Customers Table if it doesn't exist
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

-- Safe Column Migrations for Customers (Ensures all fields exist even if table was created previously)
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS pan_number TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS pan_doc_url TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS aadhar_number TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS aadhar_doc_url TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS puc_doc_url TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS puc_expiry_date DATE;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'permanent';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS created_by_email TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS updated_by_email TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS updated_by_name TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backward compatibility aliases if legacy columns existed
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'customer_name') THEN
        UPDATE public.customers SET full_name = customer_name WHERE full_name IS NULL OR full_name = '';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'customer_phone') THEN
        UPDATE public.customers SET phone = customer_phone WHERE phone IS NULL OR phone = '';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'aadhar_num') THEN
        UPDATE public.customers SET aadhar_number = aadhar_num WHERE aadhar_number IS NULL OR aadhar_number = '';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'pan_num') THEN
        UPDATE public.customers SET pan_number = pan_num WHERE pan_number IS NULL OR pan_number = '';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'customer_type') THEN
        UPDATE public.customers SET type = customer_type WHERE type IS NULL;
    END IF;
END $$;

-- 3. Create Vehicles Table (One Customer -> Many Vehicles)
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

-- Safe Column Migrations for Vehicles
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS vehicle_number TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS rc_document_url TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS insurance_expiry_date DATE;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS insurance_doc_url TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS puc_expiry_date DATE;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS puc_doc_url TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS updated_by_email TEXT;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 4. Create Insurance Policies Table
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

-- Safe Column Migrations for Insurance Policies
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS policy_number TEXT;
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS insurance_expiry_date DATE;
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS policy_doc_url TEXT;
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 5. Create Daily Data Entry & Activity Audit Log Table
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

-- Safe Column Migrations for Activity Logs
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS action_type TEXT;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS customer_id UUID;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS actor_email TEXT;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS actor_name TEXT;
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 6. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_type ON public.customers(type);
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON public.customers(created_at);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer_id ON public.vehicles(customer_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_number ON public.vehicles(vehicle_number);
CREATE INDEX IF NOT EXISTS idx_vehicles_ins_expiry ON public.vehicles(insurance_expiry_date);
CREATE INDEX IF NOT EXISTS idx_vehicles_puc_expiry ON public.vehicles(puc_expiry_date);
CREATE INDEX IF NOT EXISTS idx_insurance_customer_id ON public.insurance_policies(customer_id);
CREATE INDEX IF NOT EXISTS idx_insurance_expiry ON public.insurance_policies(insurance_expiry_date);
CREATE INDEX IF NOT EXISTS idx_activity_created_at ON public.activity_logs(created_at);

-- 7. Enable Row Level Security (RLS)
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- 8. Universal RLS Policies
DROP POLICY IF EXISTS "Public access to customers" ON public.customers;
DROP POLICY IF EXISTS "Authenticated users access customers" ON public.customers;
DROP POLICY IF EXISTS "Enable read and write for all users on customers" ON public.customers;
CREATE POLICY "Enable read and write for all users on customers"
    ON public.customers
    FOR ALL
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Public access to vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Authenticated users access vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Enable read and write for all users on vehicles" ON public.vehicles;
CREATE POLICY "Enable read and write for all users on vehicles"
    ON public.vehicles
    FOR ALL
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Public access to insurance_policies" ON public.insurance_policies;
DROP POLICY IF EXISTS "Authenticated users access insurance_policies" ON public.insurance_policies;
DROP POLICY IF EXISTS "Enable read and write for all users on insurance_policies" ON public.insurance_policies;
CREATE POLICY "Enable read and write for all users on insurance_policies"
    ON public.insurance_policies
    FOR ALL
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users access activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Public access to activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Enable read and write for all users on activity_logs" ON public.activity_logs;
CREATE POLICY "Enable read and write for all users on activity_logs"
    ON public.activity_logs
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 9. Storage Buckets (Supports both 'rc-documents' and 'vehicle-docs')
INSERT INTO storage.buckets (id, name, public)
VALUES ('rc-documents', 'rc-documents', true)
ON CONFLICT (id) DO UPDATE SET public = true;

INSERT INTO storage.buckets (id, name, public)
VALUES ('vehicle-docs', 'vehicle-docs', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage Bucket Policies
DROP POLICY IF EXISTS "RC Document Upload Policy" ON storage.objects;
CREATE POLICY "RC Document Upload Policy"
    ON storage.objects
    FOR INSERT
    WITH CHECK (bucket_id IN ('rc-documents', 'vehicle-docs'));

DROP POLICY IF EXISTS "RC Document Select Policy" ON storage.objects;
CREATE POLICY "RC Document Select Policy"
    ON storage.objects
    FOR SELECT
    USING (bucket_id IN ('rc-documents', 'vehicle-docs'));

DROP POLICY IF EXISTS "RC Document Update Policy" ON storage.objects;
CREATE POLICY "RC Document Update Policy"
    ON storage.objects
    FOR UPDATE
    USING (bucket_id IN ('rc-documents', 'vehicle-docs'));

DROP POLICY IF EXISTS "RC Document Delete Policy" ON storage.objects;
CREATE POLICY "RC Document Delete Policy"
    ON storage.objects
    FOR DELETE
    USING (bucket_id IN ('rc-documents', 'vehicle-docs'));

-- 10. Enable Supabase Realtime Replication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'customers'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.customers, public.vehicles, public.insurance_policies, public.activity_logs;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END $$;

-- 11. Force PostgREST to reload schema cache immediately
NOTIFY pgrst, 'reload schema';
