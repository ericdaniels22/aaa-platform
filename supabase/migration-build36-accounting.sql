-- ============================================
-- Build 36 Migration: Build 16b — Accounting Dashboard
-- Adds accounting columns to jobs, payer_type trigger, view_accounting
-- permission, nav_items seed for /accounting.
-- Run this in the Supabase SQL Editor. Not idempotent.
-- ============================================

-- ============================================
-- 1. Add columns to jobs
-- ============================================
ALTER TABLE jobs
  ADD COLUMN estimated_crew_labor_cost numeric(10,2),
  ADD COLUMN payer_type text CHECK (payer_type IN ('insurance', 'homeowner', 'mixed'));

-- ============================================
-- 2. PL/pgSQL function: recompute_job_payer_type
-- Reads received payments for a job (insurance/homeowner sources only),
-- returns 'mixed' / 'insurance' / 'homeowner' / NULL, and updates
-- jobs.payer_type in-place.
-- ============================================
CREATE OR REPLACE FUNCTION recompute_job_payer_type(p_job_id uuid)
RETURNS text AS $$
DECLARE
  v_has_insurance boolean;
  v_has_homeowner boolean;
  v_result text;
BEGIN
  SELECT
    bool_or(source = 'insurance'),
    bool_or(source = 'homeowner')
  INTO v_has_insurance, v_has_homeowner
  FROM payments
  WHERE job_id = p_job_id
    AND status = 'received'
    AND source IN ('insurance', 'homeowner');

  IF v_has_insurance AND v_has_homeowner THEN
    v_result := 'mixed';
  ELSIF v_has_insurance THEN
    v_result := 'insurance';
  ELSIF v_has_homeowner THEN
    v_result := 'homeowner';
  ELSE
    v_result := NULL;
  END IF;

  UPDATE jobs SET payer_type = v_result WHERE id = p_job_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. Trigger function + trigger: payments_update_payer_type
-- Fires AFTER INSERT OR UPDATE OR DELETE on payments FOR EACH ROW.
-- On UPDATE, recomputes payer_type for both OLD and NEW job_id when
-- they differ.
-- ============================================
CREATE OR REPLACE FUNCTION trg_recompute_payer_type()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_job_payer_type(OLD.job_id);
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM recompute_job_payer_type(NEW.job_id);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM recompute_job_payer_type(NEW.job_id);
    IF OLD.job_id IS DISTINCT FROM NEW.job_id THEN
      PERFORM recompute_job_payer_type(OLD.job_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_update_payer_type
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_recompute_payer_type();

-- ============================================
-- 4. One-time backfill: payer_type for all existing jobs
-- Must run after the function and trigger are in place.
-- ============================================
UPDATE jobs SET payer_type = recompute_job_payer_type(id);

-- ============================================
-- 5. Extend set_default_permissions to include view_accounting
-- admin=true, crew_lead=false, crew_member=false.
-- Preserves all permission keys from build35.
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
    'log_expenses', 'manage_vendors', 'manage_contract_templates', 'manage_expense_categories',
    'view_accounting'
  ];
  admin_perms text[] := all_perms;
  lead_perms text[] := ARRAY[
    'view_jobs', 'edit_jobs', 'create_jobs',
    'log_activities', 'upload_photos', 'edit_photos',
    'view_billing', 'record_payments',
    'view_email', 'send_email',
    'manage_reports',
    'log_expenses'
  ];
  member_perms text[] := ARRAY[
    'view_jobs', 'log_activities', 'upload_photos',
    'log_expenses'
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

-- ============================================
-- 6. Seed view_accounting for existing users
-- Only inserts for users who don't already have this key.
-- ============================================
INSERT INTO user_permissions (user_id, permission_key, granted)
SELECT id, 'view_accounting', (role = 'admin')
FROM user_profiles
WHERE id NOT IN (SELECT user_id FROM user_permissions WHERE permission_key = 'view_accounting');

-- ============================================
-- 7. Seed /accounting into nav_items between /email (sort_order=9)
-- and /settings (sort_order=10).
-- Shift /settings to sort_order=11, then insert /accounting at 10.
-- ============================================
UPDATE nav_items SET sort_order = 11 WHERE href = '/settings';

INSERT INTO nav_items (href, sort_order) VALUES ('/accounting', 10);
