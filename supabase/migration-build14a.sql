-- ============================================
-- Build 14a Migration: Settings Hub + Company Profile
-- Run this in the Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. COMPANY SETTINGS (key-value store)
-- ============================================
CREATE TABLE company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 2. ROW LEVEL SECURITY
-- ============================================
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on company_settings"
  ON company_settings FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================
-- 3. INDEXES
-- ============================================
CREATE INDEX idx_company_settings_key ON company_settings(key);

-- ============================================
-- 4. STORAGE BUCKET FOR COMPANY ASSETS
-- ============================================
-- Run separately if needed:
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-assets', 'company-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Allow all on company-assets bucket"
  ON storage.objects FOR ALL
  USING (bucket_id = 'company-assets')
  WITH CHECK (bucket_id = 'company-assets');

-- ============================================
-- 5. SEED DEFAULTS
-- ============================================
INSERT INTO company_settings (key, value) VALUES
  ('company_name', 'AAA Disaster Recovery'),
  ('phone', ''),
  ('email', ''),
  ('website', ''),
  ('license_number', ''),
  ('address_street', ''),
  ('address_city', ''),
  ('address_state', ''),
  ('address_zip', ''),
  ('logo_path', '')
ON CONFLICT (key) DO NOTHING;
