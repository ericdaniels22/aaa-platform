-- ============================================
-- Build 38 Migration: Build 16d — Invoice & Payment Sync
--
-- Adds:
--   1. Invoice columns (qb_invoice_id, sent_at, voided_at, voided_by, due_date,
--      subtotal, tax_rate, tax_amount, po_number, memo) + 'voided' status.
--   2. invoice_line_items table.
--   3. Payment columns (qb_payment_id, stripe_payment_intent_id).
--   4. qb_sync_log extensions ('void' action).
--   5. invoice_email_settings singleton (mirrors contract_email_settings).
--   6. qb_connection checklist columns (cpa_cleanup_confirmed, dry_run_review_confirmed).
--   7. Advisory lock RPCs (try_acquire_sync_lock / release_sync_lock).
--   8. DB triggers on invoices / invoice_line_items / payments that enqueue QB syncs.
--   9. Trigger + function to recompute invoice status based on payments.
--
-- Run in Supabase SQL Editor. Not idempotent.
-- ============================================

-- 1. Extend invoices
ALTER TABLE invoices ADD COLUMN qb_invoice_id text;
ALTER TABLE invoices ADD COLUMN sent_at timestamptz;
ALTER TABLE invoices ADD COLUMN voided_at timestamptz;
ALTER TABLE invoices ADD COLUMN voided_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN due_date timestamptz;
ALTER TABLE invoices ADD COLUMN subtotal numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN tax_rate numeric(6,4) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN tax_amount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN po_number text;
ALTER TABLE invoices ADD COLUMN memo text;

-- Extend status CHECK to add 'voided'.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft', 'sent', 'partial', 'paid', 'voided'));

-- 2. invoice_line_items
CREATE TABLE invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  description text NOT NULL,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  amount numeric(10,2) NOT NULL DEFAULT 0,
  xactimate_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoice_line_items_invoice ON invoice_line_items(invoice_id, sort_order);
CREATE TRIGGER trg_invoice_line_items_updated_at
  BEFORE UPDATE ON invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. Extend payments
ALTER TABLE payments ADD COLUMN qb_payment_id text;
ALTER TABLE payments ADD COLUMN stripe_payment_intent_id text;

-- 4. qb_sync_log: allow 'void' action.
ALTER TABLE qb_sync_log DROP CONSTRAINT IF EXISTS qb_sync_log_action_check;
ALTER TABLE qb_sync_log ADD CONSTRAINT qb_sync_log_action_check
  CHECK (action IN ('create', 'update', 'delete', 'void'));

-- Speed processor candidate scan.
CREATE INDEX IF NOT EXISTS idx_qb_sync_log_retry ON qb_sync_log(status, next_retry_at);

-- 5. invoice_email_settings (singleton, mirrors contract_email_settings)
CREATE TABLE invoice_email_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'resend'
    CHECK (provider IN ('resend', 'email_account')),
  email_account_id uuid REFERENCES email_accounts(id) ON DELETE SET NULL,
  send_from_email text,
  send_from_name text,
  reply_to_email text,
  subject_template text NOT NULL
    DEFAULT 'Invoice {{invoice_number}} — {{job_address}}',
  body_template text NOT NULL
    DEFAULT '<p>Hi {{customer_first_name}},</p><p>Please find attached invoice {{invoice_number}} for the work at {{job_address}}.</p><p>Total due: {{invoice_total}}<br>Due date: {{due_date}}</p><p>Thanks,<br>{{company_name}}</p>',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_invoice_email_settings_updated_at
  BEFORE UPDATE ON invoice_email_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed singleton.
INSERT INTO invoice_email_settings DEFAULT VALUES;

ALTER TABLE invoice_email_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_email_settings admin" ON invoice_email_settings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'));

-- 6. qb_connection checklist columns
ALTER TABLE qb_connection ADD COLUMN cpa_cleanup_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE qb_connection ADD COLUMN dry_run_review_confirmed boolean NOT NULL DEFAULT false;

-- 7. Advisory lock helpers. Fixed lock keys live in code (see src/lib/qb/sync/processor.ts).
-- Key 4216042 = scheduler run; key 4216043 = token refresh.
CREATE OR REPLACE FUNCTION try_acquire_advisory_lock(p_key bigint)
RETURNS boolean AS $$
  SELECT pg_try_advisory_lock(p_key);
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION release_advisory_lock(p_key bigint)
RETURNS boolean AS $$
  SELECT pg_advisory_unlock(p_key);
$$ LANGUAGE sql;

-- 8. Invoice status recompute based on payments.
-- 'draft' and 'voided' are terminal for this function — not touched.
CREATE OR REPLACE FUNCTION recompute_invoice_status(p_invoice_id uuid)
RETURNS text AS $$
DECLARE
  current_status text;
  total numeric(10,2);
  collected numeric(10,2);
  new_status text;
BEGIN
  SELECT status, total_amount INTO current_status, total
    FROM invoices WHERE id = p_invoice_id;
  IF current_status IS NULL THEN RETURN NULL; END IF;
  IF current_status IN ('draft', 'voided') THEN RETURN current_status; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO collected
    FROM payments WHERE invoice_id = p_invoice_id AND status = 'received';

  IF collected >= total AND total > 0 THEN
    new_status := 'paid';
  ELSIF collected > 0 THEN
    new_status := 'partial';
  ELSE
    new_status := 'sent';
  END IF;

  IF new_status <> current_status THEN
    UPDATE invoices SET status = new_status WHERE id = p_invoice_id;
  END IF;
  RETURN new_status;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_payments_recompute_invoice_status()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.invoice_id IS NOT NULL THEN
      PERFORM recompute_invoice_status(NEW.invoice_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.invoice_id IS NOT NULL THEN
      PERFORM recompute_invoice_status(OLD.invoice_id);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.invoice_id IS NOT NULL THEN
      PERFORM recompute_invoice_status(NEW.invoice_id);
    END IF;
    IF OLD.invoice_id IS NOT NULL AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
      PERFORM recompute_invoice_status(OLD.invoice_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_update_invoice_status
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_payments_recompute_invoice_status();

-- 9. Invoice triggers: enqueue QB sync on status transitions.
CREATE OR REPLACE FUNCTION trg_qb_enqueue_invoice_update()
RETURNS trigger AS $$
DECLARE
  conn qb_connection;
  contact_row contacts;
  job_row jobs;
  customer_log_id uuid;
  sub_log_id uuid;
  dep_id uuid;
BEGIN
  conn := qb_get_active_connection();
  IF conn.id IS NULL THEN RETURN NEW; END IF;

  -- Draft → Sent: enqueue create, with cascading customer/sub_customer deps.
  IF OLD.status = 'draft' AND NEW.status = 'sent' THEN
    SELECT * INTO job_row FROM jobs WHERE id = NEW.job_id;
    IF job_row.id IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO contact_row FROM contacts WHERE id = job_row.contact_id;
    IF contact_row.id IS NULL THEN RETURN NEW; END IF;

    -- Ensure parent customer is synced or queued.
    IF contact_row.qb_customer_id IS NULL THEN
      SELECT id INTO customer_log_id FROM qb_sync_log
        WHERE entity_type = 'customer' AND entity_id = contact_row.id
          AND status = 'queued' ORDER BY created_at DESC LIMIT 1;
      IF customer_log_id IS NULL THEN
        INSERT INTO qb_sync_log (entity_type, entity_id, action, status)
          VALUES ('customer', contact_row.id, 'create', 'queued')
          RETURNING id INTO customer_log_id;
      END IF;
    END IF;

    -- Ensure sub-customer is synced or queued.
    IF job_row.qb_subcustomer_id IS NULL THEN
      SELECT id INTO sub_log_id FROM qb_sync_log
        WHERE entity_type = 'sub_customer' AND entity_id = job_row.id
          AND status = 'queued' ORDER BY created_at DESC LIMIT 1;
      IF sub_log_id IS NULL THEN
        INSERT INTO qb_sync_log (entity_type, entity_id, action, status, depends_on_log_id)
          VALUES ('sub_customer', job_row.id, 'create', 'queued', customer_log_id)
          RETURNING id INTO sub_log_id;
      END IF;
    END IF;

    dep_id := sub_log_id;  -- may be NULL if sub already synced; that's fine.

    INSERT INTO qb_sync_log (entity_type, entity_id, action, status, depends_on_log_id)
      VALUES ('invoice', NEW.id, 'create', 'queued', dep_id);
    RETURN NEW;
  END IF;

  -- Any-state → Voided: enqueue void, or coalesce with a queued create.
  IF OLD.status <> 'voided' AND NEW.status = 'voided' THEN
    -- Coalesce: if a queued 'create' exists for this invoice, delete it —
    -- the invoice never reached QB so there's nothing to void.
    DELETE FROM qb_sync_log
      WHERE entity_type = 'invoice' AND entity_id = NEW.id
        AND action = 'create' AND status = 'queued';
    IF NEW.qb_invoice_id IS NOT NULL THEN
      INSERT INTO qb_sync_log (entity_type, entity_id, action, status)
        VALUES ('invoice', NEW.id, 'void', 'queued');
    END IF;
    RETURN NEW;
  END IF;

  -- Sent/partial/paid edits after sync: enqueue update when any field changed.
  IF NEW.qb_invoice_id IS NOT NULL
     AND NEW.status IN ('sent', 'partial', 'paid')
     AND (
       NEW.total_amount IS DISTINCT FROM OLD.total_amount
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.tax_rate IS DISTINCT FROM OLD.tax_rate
       OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
       OR NEW.issued_date IS DISTINCT FROM OLD.issued_date
       OR NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.po_number IS DISTINCT FROM OLD.po_number
       OR NEW.memo IS DISTINCT FROM OLD.memo
       OR NEW.notes IS DISTINCT FROM OLD.notes
     )
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM qb_sync_log
      WHERE entity_type = 'invoice' AND entity_id = NEW.id
        AND action = 'update' AND status = 'queued'
    ) THEN
      INSERT INTO qb_sync_log (entity_type, entity_id, action, status)
        VALUES ('invoice', NEW.id, 'update', 'queued');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qb_enqueue_invoice_update
  AFTER UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION trg_qb_enqueue_invoice_update();

-- Line-item CRUD on a synced invoice → enqueue invoice update.
CREATE OR REPLACE FUNCTION trg_qb_enqueue_line_item_change()
RETURNS trigger AS $$
DECLARE
  inv invoices;
  target_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_id := OLD.invoice_id;
  ELSE
    target_id := NEW.invoice_id;
  END IF;
  SELECT * INTO inv FROM invoices WHERE id = target_id;
  IF inv.id IS NULL OR inv.qb_invoice_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF inv.status NOT IN ('sent', 'partial', 'paid') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM qb_sync_log
    WHERE entity_type = 'invoice' AND entity_id = inv.id
      AND action = 'update' AND status = 'queued'
  ) THEN
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status)
      VALUES ('invoice', inv.id, 'update', 'queued');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qb_enqueue_line_item_change
  AFTER INSERT OR UPDATE OR DELETE ON invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION trg_qb_enqueue_line_item_change();

-- 10. Payment triggers: enqueue QB sync.
CREATE OR REPLACE FUNCTION trg_qb_enqueue_payment_insert()
RETURNS trigger AS $$
DECLARE
  conn qb_connection;
  inv invoices;
  dep_id uuid;
BEGIN
  conn := qb_get_active_connection();
  IF conn.id IS NULL THEN RETURN NEW; END IF;
  IF NEW.created_at < conn.sync_start_date::timestamptz THEN RETURN NEW; END IF;

  -- Resolve parent invoice dep.
  IF NEW.invoice_id IS NOT NULL THEN
    SELECT * INTO inv FROM invoices WHERE id = NEW.invoice_id;
    IF inv.id IS NOT NULL AND inv.qb_invoice_id IS NULL THEN
      SELECT id INTO dep_id FROM qb_sync_log
        WHERE entity_type = 'invoice' AND entity_id = inv.id
          AND status = 'queued' ORDER BY created_at DESC LIMIT 1;
      -- If no queued invoice sync, the payment can't sync yet — leave dep_id
      -- NULL and the sync function will defer.
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM qb_sync_log
    WHERE entity_type = 'payment' AND entity_id = NEW.id AND status = 'queued'
  ) THEN
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status, depends_on_log_id)
      VALUES ('payment', NEW.id, 'create', 'queued', dep_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qb_enqueue_payment_insert
  AFTER INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_qb_enqueue_payment_insert();

CREATE OR REPLACE FUNCTION trg_qb_enqueue_payment_update()
RETURNS trigger AS $$
BEGIN
  IF NEW.qb_payment_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.method IS NOT DISTINCT FROM OLD.method
     AND NEW.received_date IS NOT DISTINCT FROM OLD.received_date
     AND NEW.reference_number IS NOT DISTINCT FROM OLD.reference_number
     AND NEW.invoice_id IS NOT DISTINCT FROM OLD.invoice_id
  THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM qb_sync_log
    WHERE entity_type = 'payment' AND entity_id = NEW.id
      AND action = 'update' AND status = 'queued'
  ) THEN
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status)
      VALUES ('payment', NEW.id, 'update', 'queued');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qb_enqueue_payment_update
  AFTER UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_qb_enqueue_payment_update();

CREATE OR REPLACE FUNCTION trg_qb_enqueue_payment_delete()
RETURNS trigger AS $$
BEGIN
  IF OLD.qb_payment_id IS NULL THEN RETURN OLD; END IF;
  -- Store snapshot in payload so the sync function can reach the QB id even
  -- though the row is gone.
  INSERT INTO qb_sync_log (entity_type, entity_id, action, status, payload, qb_entity_id)
    VALUES (
      'payment', OLD.id, 'delete', 'queued',
      jsonb_build_object(
        'qb_payment_id', OLD.qb_payment_id,
        'amount', OLD.amount,
        'invoice_id', OLD.invoice_id
      ),
      OLD.qb_payment_id
    );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qb_enqueue_payment_delete
  AFTER DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_qb_enqueue_payment_delete();

-- ============================================
-- End of build38 migration.
-- ============================================
