-- ==============================================================================
-- Supabase Schema: Insurance & PUC Expiry Monitor with Multi-Vehicle RC Support
-- Run this script in the Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)
-- ==============================================================================

-- 1. Create Customers Table
CREATE TABLE IF NOT EXISTS public.customers (
    id BIGSERIAL PRIMARY KEY,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_type TEXT NOT NULL DEFAULT 'permanent' CHECK (customer_type IN ('permanent', 'lead')),
    aadhar_num TEXT,
    aadhar_doc_url TEXT,
    aadhar_doc_name TEXT,
    aadhar_doc_type TEXT,
    pan_num TEXT,
    pan_doc_url TEXT,
    pan_doc_name TEXT,
    pan_doc_type TEXT,
    requirement_notes TEXT,
    vehicle_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create Vehicles Table (One Customer -> Many Vehicles with RC, Insurance & PUC)
CREATE TABLE IF NOT EXISTS public.vehicles (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    vehicle_index INTEGER NOT NULL DEFAULT 1,
    vehicle_num TEXT,
    vehicle_type TEXT DEFAULT '4-Wheeler', -- '2-Wheeler', '4-Wheeler', 'Commercial', 'Other'
    model_name TEXT,
    insurance_due DATE,
    puc_due DATE,
    rc_doc_url TEXT,
    rc_doc_name TEXT,
    rc_doc_type TEXT,
    ins_doc_url TEXT,
    ins_doc_name TEXT,
    ins_doc_type TEXT,
    puc_doc_url TEXT,
    puc_doc_name TEXT,
    puc_doc_type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create Indexes for High Performance Queries
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(customer_phone);
CREATE INDEX IF NOT EXISTS idx_customers_type ON public.customers(customer_type);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer_id ON public.vehicles(customer_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_num ON public.vehicles(vehicle_num);
CREATE INDEX IF NOT EXISTS idx_vehicles_ins_due ON public.vehicles(insurance_due);
CREATE INDEX IF NOT EXISTS idx_vehicles_puc_due ON public.vehicles(puc_due);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- 5. Create RLS Policies (Allows public anon key access for read/write if used as dashboard)
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

-- 6. Setup Supabase Storage Bucket for Documents (RC, Aadhaar, PAN, Insurance, PUC)
INSERT INTO storage.buckets (id, name, public)
VALUES ('vehicle-docs', 'vehicle-docs', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Storage RLS Policies
DROP POLICY IF EXISTS "Public document upload policy" ON storage.objects;
CREATE POLICY "Public document upload policy"
    ON storage.objects
    FOR INSERT
    WITH CHECK (bucket_id = 'vehicle-docs');

DROP POLICY IF EXISTS "Public document select policy" ON storage.objects;
CREATE POLICY "Public document select policy"
    ON storage.objects
    FOR SELECT
    USING (bucket_id = 'vehicle-docs');

DROP POLICY IF EXISTS "Public document update policy" ON storage.objects;
CREATE POLICY "Public document update policy"
    ON storage.objects
    FOR UPDATE
    USING (bucket_id = 'vehicle-docs');

DROP POLICY IF EXISTS "Public document delete policy" ON storage.objects;
CREATE POLICY "Public document delete policy"
    ON storage.objects
    FOR DELETE
    USING (bucket_id = 'vehicle-docs');

-- 7. Trigger to automatically update 'updated_at' timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_customers_updated_at ON public.customers;
CREATE TRIGGER set_customers_updated_at
    BEFORE UPDATE ON public.customers
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_vehicles_updated_at ON public.vehicles;
CREATE TRIGGER set_vehicles_updated_at
    BEFORE UPDATE ON public.vehicles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();
