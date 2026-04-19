-- ============================================
-- Build 35 Migration: Build 16a — Expenses, Vendors, Receipt Capture
-- Run this in the Supabase SQL Editor.
-- ============================================

-- ============================================
-- 1. EXPENSE CATEGORIES TABLE
-- Mirrors damage_types so the settings UI can be forked from 14c.
-- ============================================
CREATE TABLE expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  display_label text NOT NULL,
  bg_color text NOT NULL DEFAULT '#F1EFE8',
  text_color text NOT NULL DEFAULT '#5F5E5A',
  icon text,
  sort_order integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_categories_sort_order ON expense_categories(sort_order);

CREATE TRIGGER trg_expense_categories_updated_at
  BEFORE UPDATE ON expense_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 2. VENDORS TABLE
-- ============================================
CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  vendor_type text NOT NULL
    CHECK (vendor_type IN ('supplier', 'subcontractor', 'equipment_rental', 'fuel', 'other')),
  default_category_id uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  is_1099 boolean NOT NULL DEFAULT false,
  tax_id text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vendors_active_name ON vendors(is_active, name);
CREATE INDEX idx_vendors_type ON vendors(vendor_type);
CREATE INDEX idx_vendors_is_1099 ON vendors(is_1099) WHERE is_1099 = true;

CREATE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 3. EXPENSES TABLE
-- ============================================
CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  vendor_name text NOT NULL,
  category_id uuid NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  expense_date date NOT NULL,
  payment_method text NOT NULL
    CHECK (payment_method IN ('business_card', 'business_ach', 'cash', 'personal_reimburse', 'other')),
  description text,
  receipt_path text,
  thumbnail_path text,
  submitted_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  submitter_name text NOT NULL,
  activity_id uuid REFERENCES job_activities(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_expenses_job_date ON expenses(job_id, expense_date DESC);
CREATE INDEX idx_expenses_category ON expenses(category_id);
CREATE INDEX idx_expenses_vendor ON expenses(vendor_id);
CREATE INDEX idx_expenses_submitter ON expenses(submitted_by, created_at DESC);

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Bump vendors.last_used_at whenever a new expense references a vendor.
CREATE OR REPLACE FUNCTION bump_vendor_last_used()
RETURNS trigger AS $$
BEGIN
  IF NEW.vendor_id IS NOT NULL THEN
    UPDATE vendors SET last_used_at = NEW.created_at WHERE id = NEW.vendor_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_expenses_bump_vendor_last_used
  AFTER INSERT ON expenses
  FOR EACH ROW EXECUTE FUNCTION bump_vendor_last_used();

-- ============================================
-- 4. SEED DEFAULT EXPENSE CATEGORIES
-- ============================================
INSERT INTO expense_categories (name, display_label, bg_color, text_color, icon, sort_order, is_default) VALUES
  ('materials',         'Materials',           '#E6F1FB', '#0C447C', 'Hammer',   1, true),
  ('sub_labor',         'Subcontractor Labor', '#EEEDFE', '#3C3489', 'Users',    2, true),
  ('equipment_rental',  'Equipment Rental',    '#FAEEDA', '#633806', 'Wrench',   3, true),
  ('fuel_mileage',      'Fuel/Mileage',        '#FAECE7', '#712B13', 'Fuel',     4, true),
  ('permits',           'Permits',             '#F1EFE8', '#5F5E5A', 'FileText', 5, true),
  ('disposal_dumpster', 'Disposal/Dumpster',   '#EAF3DE', '#27500A', 'Trash2',   6, true),
  ('lodging',           'Lodging',             '#FBEAF0', '#72243E', 'Bed',      7, true),
  ('meals',             'Meals',               '#FBEAF0', '#72243E', 'Utensils', 8, true),
  ('other',             'Other',               '#F1EFE8', '#5F5E5A', NULL,       9, true);

-- ============================================
-- 5. EXTEND job_activities.activity_type TO ALLOW 'expense'
-- ============================================
ALTER TABLE job_activities DROP CONSTRAINT IF EXISTS job_activities_activity_type_check;
ALTER TABLE job_activities ADD CONSTRAINT job_activities_activity_type_check
  CHECK (activity_type IN ('note', 'photo', 'milestone', 'insurance', 'equipment', 'expense'));

-- ============================================
-- 6. ROW LEVEL SECURITY (platform-wide pattern)
-- ============================================
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users" ON vendors
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON expense_categories
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON expenses
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- 7. STORAGE BUCKET (private; API routes are the only caller)
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "receipts_bucket_authenticated_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts');

CREATE POLICY "receipts_bucket_authenticated_write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts');

CREATE POLICY "receipts_bucket_authenticated_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'receipts') WITH CHECK (bucket_id = 'receipts');

CREATE POLICY "receipts_bucket_authenticated_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'receipts');

-- ============================================
-- 8. RPCS FOR ATOMIC EXPENSE TRANSITIONS
-- Each function wraps the mutation plus its paired job_activities row in
-- one transaction so the expense and its activity log entry can't drift.
-- ============================================

-- Create expense + paired activity row in one transaction. Returns the
-- new expense id. Activity title/description are built server-side so
-- the rendered string is consistent with the activity log renderer.
CREATE OR REPLACE FUNCTION create_expense_with_activity(
  p_job_id uuid,
  p_vendor_id uuid,
  p_vendor_name text,
  p_category_id uuid,
  p_amount numeric,
  p_expense_date date,
  p_payment_method text,
  p_description text,
  p_receipt_path text,
  p_thumbnail_path text,
  p_submitted_by uuid,
  p_submitter_name text
) RETURNS uuid AS $$
DECLARE
  v_expense_id uuid;
  v_activity_id uuid;
  v_category_label text;
  v_activity_title text;
  v_activity_description text;
BEGIN
  SELECT display_label INTO v_category_label
    FROM expense_categories WHERE id = p_category_id;

  v_activity_title := 'Logged expense: ' || p_vendor_name || ' — $' || to_char(p_amount, 'FM999,999,990.00');
  v_activity_description := COALESCE(v_category_label, 'Expense');
  IF p_receipt_path IS NOT NULL THEN
    v_activity_description := v_activity_description || ' · receipt attached';
  END IF;

  INSERT INTO job_activities (job_id, activity_type, title, description, author)
    VALUES (p_job_id, 'expense', v_activity_title, v_activity_description, p_submitter_name)
    RETURNING id INTO v_activity_id;

  INSERT INTO expenses (
    job_id, vendor_id, vendor_name, category_id, amount, expense_date,
    payment_method, description, receipt_path, thumbnail_path,
    submitted_by, submitter_name, activity_id
  ) VALUES (
    p_job_id, p_vendor_id, p_vendor_name, p_category_id, p_amount, p_expense_date,
    p_payment_method, p_description, p_receipt_path, p_thumbnail_path,
    p_submitted_by, p_submitter_name, v_activity_id
  ) RETURNING id INTO v_expense_id;

  RETURN v_expense_id;
END;
$$ LANGUAGE plpgsql;

-- Update expense fields and keep the paired activity row's title/description
-- in sync with the new amount/vendor/category.
CREATE OR REPLACE FUNCTION update_expense(
  p_expense_id uuid,
  p_vendor_id uuid,
  p_vendor_name text,
  p_category_id uuid,
  p_amount numeric,
  p_expense_date date,
  p_payment_method text,
  p_description text,
  p_receipt_path text,
  p_thumbnail_path text
) RETURNS void AS $$
DECLARE
  v_activity_id uuid;
  v_category_label text;
  v_new_title text;
  v_new_description text;
BEGIN
  SELECT activity_id INTO v_activity_id FROM expenses WHERE id = p_expense_id;
  SELECT display_label INTO v_category_label FROM expense_categories WHERE id = p_category_id;

  v_new_title := 'Logged expense: ' || p_vendor_name || ' — $' || to_char(p_amount, 'FM999,999,990.00');
  v_new_description := COALESCE(v_category_label, 'Expense');
  IF p_receipt_path IS NOT NULL THEN
    v_new_description := v_new_description || ' · receipt attached';
  END IF;

  UPDATE expenses SET
    vendor_id = p_vendor_id,
    vendor_name = p_vendor_name,
    category_id = p_category_id,
    amount = p_amount,
    expense_date = p_expense_date,
    payment_method = p_payment_method,
    description = p_description,
    receipt_path = p_receipt_path,
    thumbnail_path = p_thumbnail_path
  WHERE id = p_expense_id;

  IF v_activity_id IS NOT NULL THEN
    UPDATE job_activities SET title = v_new_title, description = v_new_description
      WHERE id = v_activity_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Delete the paired activity row and the expense row in one transaction.
-- Returns the receipt paths so the API route can delete the storage objects.
CREATE OR REPLACE FUNCTION delete_expense_cascade(p_expense_id uuid)
RETURNS TABLE(receipt_path text, thumbnail_path text) AS $$
DECLARE
  v_activity_id uuid;
  v_receipt_path text;
  v_thumbnail_path text;
BEGIN
  SELECT e.activity_id, e.receipt_path, e.thumbnail_path
    INTO v_activity_id, v_receipt_path, v_thumbnail_path
    FROM expenses e WHERE e.id = p_expense_id;

  IF v_activity_id IS NOT NULL THEN
    DELETE FROM job_activities WHERE id = v_activity_id;
  END IF;

  DELETE FROM expenses WHERE id = p_expense_id;

  receipt_path := v_receipt_path;
  thumbnail_path := v_thumbnail_path;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 9. PERMISSION KEYS (Build 14d extension)
-- Replaces set_default_permissions to include the three new keys and
-- backfills permissions for every existing user.
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
    'log_expenses', 'manage_vendors', 'manage_expense_categories'
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

-- Backfill: ensure every existing user has the three new perm keys set
-- according to their role.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, role FROM user_profiles LOOP
    PERFORM set_default_permissions(r.id, r.role);
  END LOOP;
END $$;
