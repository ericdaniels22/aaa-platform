-- ============================================
-- Build 32 Migration: Contract Templates (Build 15a)
-- First half of Build 15: template system + merge fields.
-- Signing flow, contracts table, and email settings come with
-- Build 15b / 15c in later migrations.
-- Run this in the Supabase SQL Editor.
-- ============================================

-- ============================================
-- 1. CONTRACT TEMPLATES TABLE
-- ============================================
CREATE TABLE contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  content jsonb NOT NULL DEFAULT '{"type":"doc","content":[]}'::jsonb,
  content_html text NOT NULL DEFAULT '',
  default_signer_count integer NOT NULL DEFAULT 1
    CHECK (default_signer_count IN (1, 2)),
  signer_role_label text NOT NULL DEFAULT 'Homeowner',
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- 2. ROW LEVEL SECURITY
-- ============================================
ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users"
  ON contract_templates FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================
-- 3. INDEXES
-- ============================================
CREATE INDEX idx_contract_templates_is_active ON contract_templates(is_active);
CREATE INDEX idx_contract_templates_updated_at ON contract_templates(updated_at DESC);

-- ============================================
-- 4. AUTO-UPDATE TIMESTAMP TRIGGER
-- ============================================
CREATE TRIGGER trg_contract_templates_updated_at
  BEFORE UPDATE ON contract_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 5. SEED: Work Authorization placeholder template
-- Eric will replace content with real legal language post-setup.
-- ============================================
INSERT INTO contract_templates (name, description, content, content_html, default_signer_count, signer_role_label)
VALUES (
  'Work Authorization',
  'Primary work authorization and assignment of benefits (AOB) template. Replace placeholder content with finalized legal language.',
  '{
    "type": "doc",
    "content": [
      {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Work Authorization"}]},
      {"type": "paragraph", "content": [
        {"type": "text", "text": "This document is a placeholder. Replace the body of this template with your finalized Work Authorization and Assignment of Benefits legal language before sending to customers."}
      ]},
      {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Property & Customer"}]},
      {"type": "paragraph", "content": [
        {"type": "text", "text": "Customer: "},
        {"type": "mergeField", "attrs": {"fieldName": "customer_name"}}
      ]},
      {"type": "paragraph", "content": [
        {"type": "text", "text": "Property: "},
        {"type": "mergeField", "attrs": {"fieldName": "property_address"}}
      ]},
      {"type": "paragraph", "content": [
        {"type": "text", "text": "Job #: "},
        {"type": "mergeField", "attrs": {"fieldName": "job_number"}},
        {"type": "text", "text": " — Date: "},
        {"type": "mergeField", "attrs": {"fieldName": "date_today"}}
      ]},
      {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Insurance"}]},
      {"type": "paragraph", "content": [
        {"type": "text", "text": "Carrier: "},
        {"type": "mergeField", "attrs": {"fieldName": "insurance_company"}},
        {"type": "text", "text": " — Claim #: "},
        {"type": "mergeField", "attrs": {"fieldName": "claim_number"}}
      ]},
      {"type": "horizontalRule"},
      {"type": "paragraph", "content": [
        {"type": "text", "text": "Authorized by "},
        {"type": "mergeField", "attrs": {"fieldName": "company_name"}},
        {"type": "text", "text": " ("},
        {"type": "mergeField", "attrs": {"fieldName": "company_phone"}},
        {"type": "text", "text": ")."}
      ]}
    ]
  }'::jsonb,
  '<h1>Work Authorization</h1><p>This document is a placeholder. Replace the body of this template with your finalized Work Authorization and Assignment of Benefits legal language before sending to customers.</p><h2>Property &amp; Customer</h2><p>Customer: <span class="merge-field-pill" data-field-name="customer_name" data-merge-field="true">{{customer_name}}</span></p><p>Property: <span class="merge-field-pill" data-field-name="property_address" data-merge-field="true">{{property_address}}</span></p><p>Job #: <span class="merge-field-pill" data-field-name="job_number" data-merge-field="true">{{job_number}}</span> — Date: <span class="merge-field-pill" data-field-name="date_today" data-merge-field="true">{{date_today}}</span></p><h2>Insurance</h2><p>Carrier: <span class="merge-field-pill" data-field-name="insurance_company" data-merge-field="true">{{insurance_company}}</span> — Claim #: <span class="merge-field-pill" data-field-name="claim_number" data-merge-field="true">{{claim_number}}</span></p><hr><p>Authorized by <span class="merge-field-pill" data-field-name="company_name" data-merge-field="true">{{company_name}}</span> (<span class="merge-field-pill" data-field-name="company_phone" data-merge-field="true">{{company_phone}}</span>).</p>',
  1,
  'Homeowner'
);

-- ============================================
-- 6. PERMISSION: manage_contract_templates
-- Extend the default-permissions function to cover the new key,
-- then backfill the permission row for every existing user so
-- their permissions map is complete. Admins default to granted;
-- crew_lead and crew_member default to denied.
-- ============================================
CREATE OR REPLACE FUNCTION set_default_permissions(p_user_id uuid, p_role text)
RETURNS void AS $$
DECLARE
  all_perms text[] := ARRAY[
    'view_jobs', 'edit_jobs', 'create_jobs',
    'log_activities', 'upload_photos', 'edit_photos',
    'view_billing', 'record_payments',
    'view_email', 'send_email',
    'manage_reports', 'access_settings',
    'manage_contract_templates'
  ];
  admin_perms text[] := all_perms;
  lead_perms text[] := ARRAY[
    'view_jobs', 'edit_jobs', 'create_jobs',
    'log_activities', 'upload_photos', 'edit_photos',
    'view_billing', 'record_payments',
    'view_email', 'send_email',
    'manage_reports'
  ];
  member_perms text[] := ARRAY[
    'view_jobs', 'log_activities', 'upload_photos'
  ];
  granted_perms text[];
  perm text;
BEGIN
  IF p_role = 'admin' THEN
    granted_perms := admin_perms;
  ELSIF p_role = 'crew_lead' THEN
    granted_perms := lead_perms;
  ELSE
    granted_perms := member_perms;
  END IF;

  FOREACH perm IN ARRAY all_perms LOOP
    INSERT INTO user_permissions (user_id, permission_key, granted)
    VALUES (p_user_id, perm, perm = ANY(granted_perms))
    ON CONFLICT (user_id, permission_key) DO UPDATE SET granted = EXCLUDED.granted;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Backfill the new permission for existing users without touching
-- any of their other permission grants. Admins get it granted, all
-- other roles default to denied (they can be flipped on in the
-- Users & Crew settings page by an admin).
INSERT INTO user_permissions (user_id, permission_key, granted)
SELECT id, 'manage_contract_templates', (role = 'admin')
FROM user_profiles
ON CONFLICT (user_id, permission_key) DO NOTHING;
