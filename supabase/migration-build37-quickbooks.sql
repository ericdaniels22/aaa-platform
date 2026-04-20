-- ============================================
-- Build 37 Migration: Build 16c — QuickBooks Online Connection & Customer Sync
-- Adds qb_connection, qb_mappings, qb_sync_log; qb_customer_id on contacts;
-- qb_subcustomer_id on jobs; manage_accounting permission; /settings/accounting
-- hub entry; and AFTER INSERT/UPDATE triggers on contacts + jobs that enqueue
-- sync rows automatically.
-- Run this in the Supabase SQL Editor. Not idempotent.
-- ============================================

-- ============================================
-- 1. qb_connection  — single row per QB company connection.
-- Tokens are AES-256-GCM encrypted via src/lib/encryption.ts
-- Format: iv:authTag:ciphertext (hex-encoded, colon-separated)
-- Set-up wizard leaves sync_start_date + setup_completed_at NULL until Step 3 finishes.
-- Once dry_run_mode is false it can't go back to true on the same connection
-- (enforced in the PATCH handler; the column is just a flag here).
-- ============================================
CREATE TABLE qb_connection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  realm_id text NOT NULL,
  company_name text,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  refresh_token_expires_at timestamptz NOT NULL,
  sync_start_date date,
  dry_run_mode boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  setup_completed_at timestamptz,
  last_sync_at timestamptz,
  connected_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_qb_connection_active ON qb_connection(is_active) WHERE is_active = true;

CREATE TRIGGER trg_qb_connection_updated_at
  BEFORE UPDATE ON qb_connection
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 2. qb_mappings  — platform value → QB entity, per mapping type.
-- type: 'damage_type' → QB Class; 'payment_method' → QB Deposit Account.
-- 'expense_category' reserved for future use but accepted by the CHECK constraint
-- so we don't need another migration to turn it on.
-- ============================================
CREATE TABLE qb_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL
    CHECK (type IN ('damage_type', 'payment_method', 'expense_category')),
  platform_value text NOT NULL,
  qb_entity_id text NOT NULL,
  qb_entity_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type, platform_value)
);

CREATE INDEX idx_qb_mappings_type ON qb_mappings(type);

CREATE TRIGGER trg_qb_mappings_updated_at
  BEFORE UPDATE ON qb_mappings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 3. qb_sync_log  — queue + audit trail for every QB sync attempt.
-- entity_type enum: 'customer', 'sub_customer', 'invoice', 'payment'
-- (invoice/payment accepted now so 16d can start enqueuing without a schema change).
-- depends_on_log_id: sub_customer rows point at the customer row that must
-- resolve first (sync path: parent before child).
-- next_retry_at: set on failure, used by the processor to pick up rows whose
-- exponential-backoff window has elapsed. retry_count caps at 5.
-- ============================================
CREATE TABLE qb_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL
    CHECK (entity_type IN ('customer', 'sub_customer', 'invoice', 'payment')),
  entity_id uuid NOT NULL,
  action text NOT NULL DEFAULT 'create'
    CHECK (action IN ('create', 'update', 'delete')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'synced', 'failed', 'skipped_dry_run')),
  payload jsonb,
  qb_entity_id text,
  error_message text,
  error_code text,
  retry_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  synced_at timestamptz,
  depends_on_log_id uuid REFERENCES qb_sync_log(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Queue scan: find rows to process this tick.
CREATE INDEX idx_qb_sync_log_queued ON qb_sync_log(created_at)
  WHERE status = 'queued';

-- Recent activity table on the QB tab: show last N by time desc, failed first.
CREATE INDEX idx_qb_sync_log_status_created ON qb_sync_log(status, created_at DESC);

-- Dedup probe (trigger re-entry guard).
CREATE INDEX idx_qb_sync_log_entity ON qb_sync_log(entity_type, entity_id, status);

CREATE TRIGGER trg_qb_sync_log_updated_at
  BEFORE UPDATE ON qb_sync_log
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 4. Columns on existing tables.
-- qb_invoice_id / qb_payment_id are NOT added here — that's 16d.
-- ============================================
ALTER TABLE contacts ADD COLUMN qb_customer_id text;
ALTER TABLE jobs ADD COLUMN qb_subcustomer_id text;

-- ============================================
-- 5. RLS — spec: "allow all for authenticated users, but restrict qb_connection
-- to admins only". Service role bypasses RLS so API routes using createServiceClient
-- keep working regardless of these policies.
-- ============================================
ALTER TABLE qb_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE qb_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE qb_sync_log ENABLE ROW LEVEL SECURITY;

-- qb_connection: admin only (tokens are encrypted but still sensitive).
CREATE POLICY "qb_connection admin read" ON qb_connection
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'
  ));

CREATE POLICY "qb_connection admin write" ON qb_connection
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_profiles.id = auth.uid() AND user_profiles.role = 'admin'
  ));

-- qb_mappings: any authenticated user can read (UI needs it for tooltips);
-- writes go through API routes using the service client.
CREATE POLICY "qb_mappings read" ON qb_mappings
  FOR SELECT TO authenticated USING (true);

-- qb_sync_log: any authenticated user can read (accounting tab shows it);
-- writes via service client.
CREATE POLICY "qb_sync_log read" ON qb_sync_log
  FOR SELECT TO authenticated USING (true);

-- ============================================
-- 6. manage_accounting permission.
-- Gates access to /settings/accounting + QB sync tab in addition to view_accounting.
-- Admin-only by default.
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
    'view_accounting', 'manage_accounting'
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

-- Seed manage_accounting for existing users.
INSERT INTO user_permissions (user_id, permission_key, granted)
SELECT id, 'manage_accounting', (role = 'admin')
FROM user_profiles
WHERE id NOT IN (SELECT user_id FROM user_permissions WHERE permission_key = 'manage_accounting');

-- ============================================
-- 7. Trigger functions: enqueue QB sync rows automatically.
--
-- Design notes:
--   * Trigger reads the single active qb_connection row. If none is active
--     or sync_start_date hasn't been set yet, silently skip — no queue rows.
--   * Customer sync is enqueued ONLY when a job is created (never from
--     contacts INSERT), so we don't sync orphan contacts (adjusters, insurance
--     carriers, etc.). Contacts referenced by jobs.contact_id ARE the QB
--     customers; others aren't.
--   * Dedup: we refuse to insert a second 'queued' row for the same
--     (entity_type, entity_id, action). The processor clears the 'queued'
--     state on completion, so another edit after a successful sync can
--     re-enqueue cleanly.
--   * created_at >= sync_start_date guards against backfilling history the
--     user has deliberately excluded. Edits of pre-start-date records that
--     were already synced (qb_customer_id present) still flow through
--     because the guard is skipped when qb_*_id is non-null.
-- ============================================

CREATE OR REPLACE FUNCTION qb_get_active_connection()
RETURNS qb_connection AS $$
  SELECT * FROM qb_connection
  WHERE is_active = true AND sync_start_date IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- INSERT on jobs → enqueue customer + sub_customer.
CREATE OR REPLACE FUNCTION trg_qb_enqueue_job_insert()
RETURNS trigger AS $$
DECLARE
  conn qb_connection;
  contact_row contacts;
  customer_log_id uuid;
BEGIN
  conn := qb_get_active_connection();
  IF conn.id IS NULL THEN RETURN NEW; END IF;
  IF NEW.created_at < conn.sync_start_date::timestamptz THEN RETURN NEW; END IF;

  SELECT * INTO contact_row FROM contacts WHERE id = NEW.contact_id;
  IF contact_row.id IS NULL THEN RETURN NEW; END IF;

  -- Enqueue parent customer (if not already synced and not already queued).
  IF contact_row.qb_customer_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM qb_sync_log
       WHERE entity_type = 'customer'
         AND entity_id = contact_row.id
         AND status = 'queued'
     )
  THEN
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status)
    VALUES ('customer', contact_row.id, 'create', 'queued')
    RETURNING id INTO customer_log_id;
  ELSE
    -- Sub-customer can still depend on a prior (already-synced or queued)
    -- customer row. Grab the most recent queued one if it exists.
    SELECT id INTO customer_log_id
      FROM qb_sync_log
      WHERE entity_type = 'customer'
        AND entity_id = contact_row.id
        AND status = 'queued'
      ORDER BY created_at DESC LIMIT 1;
  END IF;

  -- Enqueue sub_customer.
  IF NOT EXISTS (
    SELECT 1 FROM qb_sync_log
    WHERE entity_type = 'sub_customer'
      AND entity_id = NEW.id
      AND status = 'queued'
  ) THEN
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status, depends_on_log_id)
    VALUES ('sub_customer', NEW.id, 'create', 'queued', customer_log_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qb_enqueue_job_insert
  AFTER INSERT ON jobs
  FOR EACH ROW EXECUTE FUNCTION trg_qb_enqueue_job_insert();

-- UPDATE on contacts → enqueue customer update (only if synced + relevant change).
CREATE OR REPLACE FUNCTION trg_qb_enqueue_contact_update()
RETURNS trigger AS $$
DECLARE
  conn qb_connection;
BEGIN
  IF NEW.qb_customer_id IS NULL THEN RETURN NEW; END IF;

  -- Only care about fields that map into the QB Customer payload.
  IF NEW.first_name IS NOT DISTINCT FROM OLD.first_name
     AND NEW.last_name IS NOT DISTINCT FROM OLD.last_name
     AND NEW.phone IS NOT DISTINCT FROM OLD.phone
     AND NEW.email IS NOT DISTINCT FROM OLD.email
     AND NEW.notes IS NOT DISTINCT FROM OLD.notes
  THEN RETURN NEW; END IF;

  conn := qb_get_active_connection();
  IF conn.id IS NULL THEN RETURN NEW; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM qb_sync_log
    WHERE entity_type = 'customer'
      AND entity_id = NEW.id
      AND action = 'update'
      AND status = 'queued'
  ) THEN
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status)
    VALUES ('customer', NEW.id, 'update', 'queued');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qb_enqueue_contact_update
  AFTER UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION trg_qb_enqueue_contact_update();

-- UPDATE on jobs → enqueue sub_customer update (only if synced + relevant change).
CREATE OR REPLACE FUNCTION trg_qb_enqueue_job_update()
RETURNS trigger AS $$
DECLARE
  conn qb_connection;
BEGIN
  IF NEW.qb_subcustomer_id IS NULL THEN RETURN NEW; END IF;

  -- Fields that feed the sub-customer name or its class mapping.
  IF NEW.job_number IS NOT DISTINCT FROM OLD.job_number
     AND NEW.damage_type IS NOT DISTINCT FROM OLD.damage_type
     AND NEW.property_address IS NOT DISTINCT FROM OLD.property_address
  THEN RETURN NEW; END IF;

  conn := qb_get_active_connection();
  IF conn.id IS NULL THEN RETURN NEW; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM qb_sync_log
    WHERE entity_type = 'sub_customer'
      AND entity_id = NEW.id
      AND action = 'update'
      AND status = 'queued'
  ) THEN
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status)
    VALUES ('sub_customer', NEW.id, 'update', 'queued');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qb_enqueue_job_update
  AFTER UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION trg_qb_enqueue_job_update();
