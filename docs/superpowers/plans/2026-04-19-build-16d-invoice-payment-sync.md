# Build 16d — Invoice & Payment Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the minimal invoice creation/edit/send UI, QB invoice sync gated on draft→sent transitions, immediate QB payment sync, a hardened scheduler with retry/backoff/idempotency, and a Stripe webhook stub for Build 17.

**Architecture:** DB triggers enqueue sync rows automatically (mirrors 16c). Route handlers write platform state; triggers handle the `qb_sync_log` inserts, sync_start_date gating, dedupe, and dependency linking. A Postgres advisory lock serializes scheduler runs. New sync modules (`invoices.ts`, `payments.ts`) are dispatched by the existing `processor.ts`. Invoice UI is new — Build 6 only delivered the schema.

**Tech Stack:** Next.js 14 App Router, Supabase (PostgreSQL + RLS), Tailwind, Lucide icons, @react-pdf/renderer (existing), Resend (existing). No test framework — verification is `npx tsc --noEmit` + manual preview.

**Project conventions to follow:**
- Migrations: `supabase/migration-build38-invoice-payment-sync.sql`. Manual-run in Supabase dashboard. Not idempotent. Next number is **38** (build37 = Build 16c on main).
- API routes: mirror [src/app/api/qb/sync-log/route.ts](src/app/api/qb/sync-log/route.ts) — `createApiClient()` / `createServerSupabaseClient()` for auth, `createServiceClient()` for writes needing elevated privileges.
- Permission check: admin role OR user_permissions row (see existing `view_accounting` / `manage_accounting` pattern).
- DB triggers own QB enqueue — follow [supabase/migration-build37-quickbooks.sql:211-367](supabase/migration-build37-quickbooks.sql:211) pattern. Route handlers never insert into `qb_sync_log` directly.
- Dark theme + teal `#0F6E56` accent. Damage-type and status colors in [src/lib/badge-colors.ts](src/lib/badge-colors.ts).
- Sync-start-date gate: per-row short-circuit inside each sync function, not at the queue fetch.
- Cron unchanged: daily at 13:30 UTC ([vercel.json](vercel.json)). Hobby plan — sub-daily fails deploy.
- tsc baseline: 0 errors (per memory). Success = 0 new errors.
- Commit after each task. Branch: `claude/clever-elgamal-08f352`.

**Design spec:** [docs/superpowers/specs/2026-04-19-build-16d-invoice-payment-sync-design.md](docs/superpowers/specs/2026-04-19-build-16d-invoice-payment-sync-design.md)

---

## Task 1: Verify dependencies

**Files:**
- No edits; reads `package.json` only.

- [ ] **Step 1: Confirm existing deps cover 16d**

Run:
```bash
node -e "const p=require('./package.json'); ['@react-pdf/renderer','resend','@supabase/supabase-js'].forEach(n => console.log(n, p.dependencies[n]||'MISSING'))"
```

Expected: all three present with version strings. `@react-pdf/renderer` is used by [src/lib/generate-report-pdf.tsx](src/lib/generate-report-pdf.tsx); we reuse it. `resend` drives contract email; we reuse it. No new installs for 16d.

- [ ] **Step 2: No commit**

This task is purely verification.

---

## Task 2: Migration — `supabase/migration-build38-invoice-payment-sync.sql`

**Files:**
- Create: `supabase/migration-build38-invoice-payment-sync.sql`

- [ ] **Step 1: Write the migration**

```sql
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

-- 7. Advisory lock helpers. Fixed lock keys live in code (see src/lib/qb/sync/locks.ts).
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migration-build38-invoice-payment-sync.sql
git commit -m "feat(16d): build38 migration — invoice/payment columns, triggers, email settings"
```

---

## Task 3: Apply migration

**Files:** None (database operation).

- [ ] **Step 1: Run the migration**

Open the Supabase dashboard → SQL Editor → paste the full contents of `supabase/migration-build38-invoice-payment-sync.sql` → Run.

Expected: "Success. No rows returned" with all statements executing. No errors.

- [ ] **Step 2: Smoke-check the schema**

In SQL Editor, run:
```sql
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'invoices'
    AND column_name IN ('qb_invoice_id','sent_at','voided_at','voided_by','due_date','subtotal','tax_rate','tax_amount','po_number','memo')
  ORDER BY column_name;

SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN ('invoice_line_items','invoice_email_settings');

SELECT COUNT(*) FROM information_schema.triggers
  WHERE trigger_name IN (
    'qb_enqueue_invoice_update','qb_enqueue_line_item_change',
    'qb_enqueue_payment_insert','qb_enqueue_payment_update','qb_enqueue_payment_delete',
    'payments_update_invoice_status'
  );

SELECT try_acquire_advisory_lock(4216042), release_advisory_lock(4216042);
```

Expected:
- 10 rows (all new invoice columns present).
- `count = 2` (both new tables).
- `count = 6` (all triggers created).
- Lock acquire returns `t`, release returns `t`.

- [ ] **Step 3: No commit** (schema changes are in the DB, not in files yet beyond the migration committed in Task 2).

---

## Task 4: Extend `src/lib/qb/types.ts`

**Files:**
- Modify: `src/lib/qb/types.ts`

- [ ] **Step 1: Add invoice/payment types and the new action/status values**

Replace the entire file with:

```ts
// DB row shapes + QB payload types shared across the sync lib.

export type QbMappingType = "damage_type" | "payment_method" | "expense_category";

export type QbSyncEntityType = "customer" | "sub_customer" | "invoice" | "payment";
export type QbSyncAction = "create" | "update" | "delete" | "void";
export type QbSyncStatus = "queued" | "synced" | "failed" | "skipped_dry_run";

export interface QbConnectionRow {
  id: string;
  realm_id: string;
  company_name: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
  sync_start_date: string | null;
  dry_run_mode: boolean;
  is_active: boolean;
  setup_completed_at: string | null;
  last_sync_at: string | null;
  connected_by: string | null;
  cpa_cleanup_confirmed: boolean;
  dry_run_review_confirmed: boolean;
  created_at: string;
  updated_at: string;
}

export interface QbMappingRow {
  id: string;
  type: QbMappingType;
  platform_value: string;
  qb_entity_id: string;
  qb_entity_name: string;
  created_at: string;
  updated_at: string;
}

export interface QbSyncLogRow {
  id: string;
  entity_type: QbSyncEntityType;
  entity_id: string;
  action: QbSyncAction;
  status: QbSyncStatus;
  payload: unknown;
  qb_entity_id: string | null;
  error_message: string | null;
  error_code: string | null;
  retry_count: number;
  next_retry_at: string | null;
  synced_at: string | null;
  depends_on_log_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- QB payload shapes (subset we actually send) ----------

export interface QbAddress {
  Line1?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
  Country?: string;
}

export interface QbCustomerPayload {
  Id?: string;
  SyncToken?: string;
  DisplayName: string;
  GivenName?: string;
  FamilyName?: string;
  PrimaryPhone?: { FreeFormNumber: string };
  PrimaryEmailAddr?: { Address: string };
  BillAddr?: QbAddress;
  Notes?: string;
  ParentRef?: { value: string };
  Job?: boolean;
  ClassRef?: { value: string; name?: string };
}

export interface QbClass {
  Id: string;
  Name: string;
  FullyQualifiedName?: string;
  Active?: boolean;
}

export interface QbAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType?: string;
  Active?: boolean;
}

// ---------- Invoice ----------

export interface QbInvoiceLine {
  Amount: number;
  Description?: string;
  DetailType: "SalesItemLineDetail";
  SalesItemLineDetail: {
    Qty?: number;
    UnitPrice?: number;
    ClassRef?: { value: string; name?: string };
  };
}

export interface QbInvoicePayload {
  Id?: string;
  SyncToken?: string;
  CustomerRef: { value: string };
  Line: QbInvoiceLine[];
  ClassRef?: { value: string; name?: string };
  TxnDate?: string; // YYYY-MM-DD
  DueDate?: string; // YYYY-MM-DD
  DocNumber?: string;
  PrivateNote?: string;
  TxnTaxDetail?: { TotalTax: number };
}

export interface QbInvoiceWriteResult {
  id: string;
  syncToken: string;
}

// ---------- Payment ----------

export interface QbPaymentLine {
  Amount: number;
  LinkedTxn: Array<{ TxnId: string; TxnType: "Invoice" }>;
}

export interface QbPaymentPayload {
  Id?: string;
  SyncToken?: string;
  CustomerRef: { value: string };
  TotalAmt: number;
  Line: QbPaymentLine[];
  DepositToAccountRef?: { value: string };
  PaymentMethodRef?: { value: string };
  TxnDate?: string;
  PrivateNote?: string;
}

export interface QbPaymentWriteResult {
  id: string;
  syncToken: string;
}

// ---------- Invoice email settings ----------

export type InvoiceEmailProvider = "resend" | "email_account";

export interface InvoiceEmailSettings {
  id: string;
  provider: InvoiceEmailProvider;
  email_account_id: string | null;
  send_from_email: string | null;
  send_from_name: string | null;
  reply_to_email: string | null;
  subject_template: string;
  body_template: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Verify tsc**

Run:
```bash
npx tsc --noEmit
```

Expected: 0 errors. If existing callers complain about `QbSyncAction`, it's because we added `'void'` — no caller should narrow the type before 16d runtime code lands, so the type widening is safe.

- [ ] **Step 3: Commit**

```bash
git add src/lib/qb/types.ts
git commit -m "feat(16d): extend qb types for invoice/payment/void + email settings"
```

---

## Task 5: Extend `src/lib/qb/client.ts` with invoice + payment helpers

**Files:**
- Modify: `src/lib/qb/client.ts`

- [ ] **Step 1: Append invoice + payment helpers**

Append to the end of `src/lib/qb/client.ts` (after the existing `getCustomer` export):

```ts
// ---------- Invoices ----------

import type {
  QbInvoicePayload,
  QbInvoiceWriteResult,
  QbPaymentPayload,
  QbPaymentWriteResult,
} from "./types";

export async function createInvoice(
  token: QbApiContext,
  payload: QbInvoicePayload,
): Promise<QbInvoiceWriteResult> {
  const data = await call<{ Invoice?: { Id: string; SyncToken: string } }>(
    token,
    "POST",
    "/invoice",
    payload,
  );
  if (!data.Invoice?.Id) throw new Error("QuickBooks returned no Invoice id");
  return { id: data.Invoice.Id, syncToken: data.Invoice.SyncToken };
}

export async function updateInvoice(
  token: QbApiContext,
  payload: QbInvoicePayload,
): Promise<QbInvoiceWriteResult> {
  if (!payload.Id || !payload.SyncToken) {
    throw new Error("updateInvoice requires Id and SyncToken");
  }
  // QB requires a full update for Invoice (sparse not supported the same way
  // as Customer), so the payload must be the complete re-computed state.
  const data = await call<{ Invoice?: { Id: string; SyncToken: string } }>(
    token,
    "POST",
    "/invoice?operation=update",
    payload,
  );
  if (!data.Invoice?.Id) throw new Error("QuickBooks returned no Invoice id");
  return { id: data.Invoice.Id, syncToken: data.Invoice.SyncToken };
}

export async function getInvoice(
  token: QbApiContext,
  id: string,
): Promise<{ Id: string; SyncToken: string } | null> {
  try {
    const data = await call<{ Invoice?: { Id: string; SyncToken: string } }>(
      token,
      "GET",
      `/invoice/${id}`,
    );
    return data.Invoice ?? null;
  } catch {
    return null;
  }
}

export async function voidInvoice(
  token: QbApiContext,
  id: string,
  syncToken: string,
): Promise<void> {
  await call<unknown>(token, "POST", "/invoice?operation=void", {
    Id: id,
    SyncToken: syncToken,
  });
}

// ---------- Payments ----------

export async function createPayment(
  token: QbApiContext,
  payload: QbPaymentPayload,
): Promise<QbPaymentWriteResult> {
  const data = await call<{ Payment?: { Id: string; SyncToken: string } }>(
    token,
    "POST",
    "/payment",
    payload,
  );
  if (!data.Payment?.Id) throw new Error("QuickBooks returned no Payment id");
  return { id: data.Payment.Id, syncToken: data.Payment.SyncToken };
}

export async function updatePayment(
  token: QbApiContext,
  payload: QbPaymentPayload,
): Promise<QbPaymentWriteResult> {
  if (!payload.Id || !payload.SyncToken) {
    throw new Error("updatePayment requires Id and SyncToken");
  }
  const data = await call<{ Payment?: { Id: string; SyncToken: string } }>(
    token,
    "POST",
    "/payment?operation=update",
    payload,
  );
  if (!data.Payment?.Id) throw new Error("QuickBooks returned no Payment id");
  return { id: data.Payment.Id, syncToken: data.Payment.SyncToken };
}

export async function getPayment(
  token: QbApiContext,
  id: string,
): Promise<{ Id: string; SyncToken: string } | null> {
  try {
    const data = await call<{ Payment?: { Id: string; SyncToken: string } }>(
      token,
      "GET",
      `/payment/${id}`,
    );
    return data.Payment ?? null;
  } catch {
    return null;
  }
}

export async function deletePayment(
  token: QbApiContext,
  id: string,
  syncToken: string,
): Promise<void> {
  // QB hard-deletes payments when given `operation=delete` — no void equivalent.
  // This matches our platform semantics: a payment is either correct or a data error.
  await call<unknown>(token, "POST", "/payment?operation=delete", {
    Id: id,
    SyncToken: syncToken,
  });
}
```

Note: the `import` statement at the top of this block must be consolidated with the existing import at the top of the file. Move the import up so the top of `client.ts` imports everything it needs in one place.

- [ ] **Step 2: Consolidate import at top**

Open `src/lib/qb/client.ts` line 10 — the existing import is:
```ts
import type { QbAccount, QbClass, QbCustomerPayload } from "./types";
```
Change it to:
```ts
import type {
  QbAccount,
  QbClass,
  QbCustomerPayload,
  QbInvoicePayload,
  QbInvoiceWriteResult,
  QbPaymentPayload,
  QbPaymentWriteResult,
} from "./types";
```

Then delete the duplicate import inside the appended block.

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/qb/client.ts
git commit -m "feat(16d): qb client helpers for invoices + payments"
```

---

## Task 6: Create `src/lib/qb/sync/invoices.ts`

**Files:**
- Create: `src/lib/qb/sync/invoices.ts`

- [ ] **Step 1: Write the sync module**

```ts
// Invoice sync primitives — mirrors customers.ts shape.
//
// Dry-run assembles the payload and returns it (caller marks the log row
// skipped_dry_run); live mode calls QB, writes qb_invoice_id back, returns
// the new QB id.
//
// sync_start_date gate: per-row short-circuit. Invoices older than the
// start date are logged as synced with a pre_sync_start_date note.
//
// Voids: if there's no qb_invoice_id the void is a no-op (the enqueue
// coalescer usually deletes the matching queued create row so this path
// is rare).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createInvoice,
  getInvoice,
  updateInvoice,
  voidInvoice as qbVoidInvoice,
} from "@/lib/qb/client";
import type { ValidToken } from "@/lib/qb/tokens";
import type {
  QbInvoiceLine,
  QbInvoicePayload,
  QbMappingRow,
  QbSyncAction,
} from "@/lib/qb/types";

export type SyncMode = "dry_run" | "live";

export interface InvoiceSyncOutcome {
  status: "synced" | "skipped_dry_run" | "deferred";
  payload: QbInvoicePayload;
  qbEntityId?: string;
  reason?: string;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  job_id: string;
  status: string;
  issued_date: string | null;
  due_date: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  po_number: string | null;
  memo: string | null;
  notes: string | null;
  qb_invoice_id: string | null;
  created_at: string;
}

interface LineItemRow {
  id: string;
  sort_order: number;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  xactimate_code: string | null;
}

interface JobRow {
  id: string;
  job_number: string;
  damage_type: string;
  qb_subcustomer_id: string | null;
}

function toIsoDate(ts: string | null): string | undefined {
  if (!ts) return undefined;
  return ts.slice(0, 10);
}

export async function syncInvoice(
  supabase: SupabaseClient,
  token: ValidToken | null,
  mode: SyncMode,
  invoiceId: string,
  action: QbSyncAction,
): Promise<InvoiceSyncOutcome> {
  const { data: invoice } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, job_id, status, issued_date, due_date, subtotal, tax_rate, tax_amount, total_amount, po_number, memo, notes, qb_invoice_id, created_at",
    )
    .eq("id", invoiceId)
    .maybeSingle<InvoiceRow>();
  if (!invoice) throw new Error(`invoices row ${invoiceId} not found`);

  // sync_start_date gate
  const connection = token?.connection;
  if (connection?.sync_start_date) {
    const startTs = Date.parse(connection.sync_start_date);
    if (Date.parse(invoice.created_at) < startTs) {
      return {
        status: "synced",
        payload: { CustomerRef: { value: "pre_sync_start_date" }, Line: [] },
        reason: "pre_sync_start_date",
      };
    }
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, job_number, damage_type, qb_subcustomer_id")
    .eq("id", invoice.job_id)
    .maybeSingle<JobRow>();
  if (!job) throw new Error(`jobs row ${invoice.job_id} not found`);
  if (!job.qb_subcustomer_id) {
    return {
      status: "deferred",
      payload: { CustomerRef: { value: "pending" }, Line: [] },
      reason: "sub_customer_not_synced",
    };
  }

  const { data: items } = await supabase
    .from("invoice_line_items")
    .select("id, sort_order, description, quantity, unit_price, amount, xactimate_code")
    .eq("invoice_id", invoice.id)
    .order("sort_order", { ascending: true });
  const lineItems = (items ?? []) as LineItemRow[];

  const { data: mappings } = await supabase
    .from("qb_mappings")
    .select("id, type, platform_value, qb_entity_id, qb_entity_name, created_at, updated_at")
    .eq("type", "damage_type");
  const classMap = (mappings ?? []) as QbMappingRow[];
  const classRef = classMap.find((m) => m.platform_value === job.damage_type) ?? null;
  if (!classRef) {
    const err = new Error(
      `Damage type "${job.damage_type}" isn't mapped to a QB Class.`,
    );
    (err as Error & { code?: string }).code = "class_not_mapped";
    throw err;
  }

  const lines: QbInvoiceLine[] = lineItems.map((li) => ({
    Amount: Number(li.amount),
    Description: li.xactimate_code
      ? `[${li.xactimate_code}] ${li.description}`
      : li.description,
    DetailType: "SalesItemLineDetail",
    SalesItemLineDetail: {
      Qty: Number(li.quantity),
      UnitPrice: Number(li.unit_price),
      ClassRef: { value: classRef.qb_entity_id, name: classRef.qb_entity_name },
    },
  }));

  const payload: QbInvoicePayload = {
    CustomerRef: { value: job.qb_subcustomer_id },
    Line: lines,
    ClassRef: { value: classRef.qb_entity_id, name: classRef.qb_entity_name },
    TxnDate: toIsoDate(invoice.issued_date),
    DueDate: toIsoDate(invoice.due_date),
    DocNumber: invoice.invoice_number,
    PrivateNote: `Job ${job.job_number}${invoice.memo ? ` — ${invoice.memo}` : ""}${invoice.notes ? ` — ${invoice.notes}` : ""}`.slice(0, 4000),
  };
  if (Number(invoice.tax_amount) > 0) {
    payload.TxnTaxDetail = { TotalTax: Number(invoice.tax_amount) };
  }

  if (mode === "dry_run") {
    return { status: "skipped_dry_run", payload };
  }
  if (!token) throw new Error("live sync requires a valid token");

  if (action === "update" && invoice.qb_invoice_id) {
    const current = await getInvoice(token, invoice.qb_invoice_id);
    if (!current) {
      // Vanished on QB side — recreate and repoint.
      const created = await createInvoice(token, payload);
      await supabase.from("invoices").update({ qb_invoice_id: created.id }).eq("id", invoice.id);
      return { status: "synced", payload, qbEntityId: created.id };
    }
    const updated = await updateInvoice(token, {
      ...payload,
      Id: current.Id,
      SyncToken: current.SyncToken,
    });
    return { status: "synced", payload, qbEntityId: updated.id };
  }

  if (invoice.qb_invoice_id) {
    // Already synced; nothing to create.
    return { status: "synced", payload, qbEntityId: invoice.qb_invoice_id };
  }

  const created = await createInvoice(token, payload);
  await supabase.from("invoices").update({ qb_invoice_id: created.id }).eq("id", invoice.id);
  return { status: "synced", payload, qbEntityId: created.id };
}

export async function voidInvoiceSync(
  supabase: SupabaseClient,
  token: ValidToken | null,
  mode: SyncMode,
  invoiceId: string,
): Promise<InvoiceSyncOutcome> {
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, qb_invoice_id")
    .eq("id", invoiceId)
    .maybeSingle<{ id: string; qb_invoice_id: string | null }>();
  if (!invoice) throw new Error(`invoices row ${invoiceId} not found`);

  const payload: QbInvoicePayload = {
    CustomerRef: { value: "void" },
    Line: [],
  };

  if (!invoice.qb_invoice_id) {
    return { status: "synced", payload, reason: "never_synced" };
  }

  if (mode === "dry_run") {
    return { status: "skipped_dry_run", payload, qbEntityId: invoice.qb_invoice_id };
  }
  if (!token) throw new Error("live sync requires a valid token");

  const current = await getInvoice(token, invoice.qb_invoice_id);
  if (!current) {
    return { status: "synced", payload, qbEntityId: invoice.qb_invoice_id, reason: "qb_record_gone" };
  }
  await qbVoidInvoice(token, current.Id, current.SyncToken);
  return { status: "synced", payload, qbEntityId: invoice.qb_invoice_id };
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/qb/sync/invoices.ts
git commit -m "feat(16d): invoice sync module (create/update/void)"
```

---

## Task 7: Create `src/lib/qb/sync/payments.ts`

**Files:**
- Create: `src/lib/qb/sync/payments.ts`

- [ ] **Step 1: Write the sync module**

```ts
// Payment sync primitives. All payments sync immediately (no status gate).
//
// deletePayment: the platform row is already gone when we run. The trigger
// captured a snapshot into qb_sync_log.payload so we can reach qb_payment_id.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createPayment,
  deletePayment as qbDeletePayment,
  getPayment,
  updatePayment,
} from "@/lib/qb/client";
import type { ValidToken } from "@/lib/qb/tokens";
import type {
  QbMappingRow,
  QbPaymentPayload,
  QbSyncAction,
} from "@/lib/qb/types";

export type SyncMode = "dry_run" | "live";

export interface PaymentSyncOutcome {
  status: "synced" | "skipped_dry_run" | "deferred";
  payload: QbPaymentPayload;
  qbEntityId?: string;
  reason?: string;
}

interface PaymentRow {
  id: string;
  invoice_id: string | null;
  job_id: string;
  amount: number;
  method: string;
  received_date: string | null;
  reference_number: string | null;
  notes: string | null;
  qb_payment_id: string | null;
  created_at: string;
}

interface InvoiceRow {
  id: string;
  qb_invoice_id: string | null;
  job_id: string;
}

interface JobRow {
  id: string;
  qb_subcustomer_id: string | null;
}

function toIsoDate(ts: string | null): string | undefined {
  if (!ts) return undefined;
  return ts.slice(0, 10);
}

export async function syncPayment(
  supabase: SupabaseClient,
  token: ValidToken | null,
  mode: SyncMode,
  paymentId: string,
  action: QbSyncAction,
): Promise<PaymentSyncOutcome> {
  const { data: payment } = await supabase
    .from("payments")
    .select(
      "id, invoice_id, job_id, amount, method, received_date, reference_number, notes, qb_payment_id, created_at",
    )
    .eq("id", paymentId)
    .maybeSingle<PaymentRow>();
  if (!payment) throw new Error(`payments row ${paymentId} not found`);

  const connection = token?.connection;
  if (connection?.sync_start_date) {
    const startTs = Date.parse(connection.sync_start_date);
    if (Date.parse(payment.created_at) < startTs) {
      return {
        status: "synced",
        payload: { CustomerRef: { value: "pre_sync_start_date" }, TotalAmt: 0, Line: [] },
        reason: "pre_sync_start_date",
      };
    }
  }

  if (!payment.invoice_id) {
    // No invoice linkage — we don't sync free-standing payments in 16d.
    return {
      status: "synced",
      payload: { CustomerRef: { value: "no_invoice" }, TotalAmt: 0, Line: [] },
      reason: "no_invoice_linkage",
    };
  }

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, qb_invoice_id, job_id")
    .eq("id", payment.invoice_id)
    .maybeSingle<InvoiceRow>();
  if (!invoice) throw new Error(`invoices row ${payment.invoice_id} not found`);
  if (!invoice.qb_invoice_id) {
    return {
      status: "deferred",
      payload: { CustomerRef: { value: "pending" }, TotalAmt: 0, Line: [] },
      reason: "invoice_not_synced",
    };
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, qb_subcustomer_id")
    .eq("id", invoice.job_id)
    .maybeSingle<JobRow>();
  if (!job?.qb_subcustomer_id) {
    return {
      status: "deferred",
      payload: { CustomerRef: { value: "pending" }, TotalAmt: 0, Line: [] },
      reason: "sub_customer_not_synced",
    };
  }

  const { data: mappings } = await supabase
    .from("qb_mappings")
    .select("id, type, platform_value, qb_entity_id, qb_entity_name, created_at, updated_at")
    .eq("type", "payment_method");
  const acctMap = (mappings ?? []) as QbMappingRow[];
  const depositAccount = acctMap.find((m) => m.platform_value === payment.method) ?? null;
  if (!depositAccount) {
    const err = new Error(
      `Payment method "${payment.method}" isn't mapped to a QB deposit account.`,
    );
    (err as Error & { code?: string }).code = "deposit_account_not_mapped";
    throw err;
  }

  const payload: QbPaymentPayload = {
    CustomerRef: { value: job.qb_subcustomer_id },
    TotalAmt: Number(payment.amount),
    Line: [
      {
        Amount: Number(payment.amount),
        LinkedTxn: [{ TxnId: invoice.qb_invoice_id, TxnType: "Invoice" }],
      },
    ],
    DepositToAccountRef: { value: depositAccount.qb_entity_id },
    TxnDate: toIsoDate(payment.received_date),
    PrivateNote: (payment.reference_number || payment.notes || "").slice(0, 4000) || undefined,
  };

  if (mode === "dry_run") {
    return { status: "skipped_dry_run", payload };
  }
  if (!token) throw new Error("live sync requires a valid token");

  if (action === "update" && payment.qb_payment_id) {
    const current = await getPayment(token, payment.qb_payment_id);
    if (!current) {
      const created = await createPayment(token, payload);
      await supabase.from("payments").update({ qb_payment_id: created.id }).eq("id", payment.id);
      return { status: "synced", payload, qbEntityId: created.id };
    }
    const updated = await updatePayment(token, {
      ...payload,
      Id: current.Id,
      SyncToken: current.SyncToken,
    });
    return { status: "synced", payload, qbEntityId: updated.id };
  }

  if (payment.qb_payment_id) {
    return { status: "synced", payload, qbEntityId: payment.qb_payment_id };
  }

  const created = await createPayment(token, payload);
  await supabase.from("payments").update({ qb_payment_id: created.id }).eq("id", payment.id);
  return { status: "synced", payload, qbEntityId: created.id };
}

export async function deletePaymentSync(
  token: ValidToken | null,
  mode: SyncMode,
  snapshotQbPaymentId: string | null,
): Promise<PaymentSyncOutcome> {
  const payload: QbPaymentPayload = {
    CustomerRef: { value: "delete" },
    TotalAmt: 0,
    Line: [],
  };

  if (!snapshotQbPaymentId) {
    return { status: "synced", payload, reason: "never_synced" };
  }
  if (mode === "dry_run") {
    return { status: "skipped_dry_run", payload, qbEntityId: snapshotQbPaymentId };
  }
  if (!token) throw new Error("live sync requires a valid token");

  const current = await getPayment(token, snapshotQbPaymentId);
  if (!current) {
    return { status: "synced", payload, qbEntityId: snapshotQbPaymentId, reason: "qb_record_gone" };
  }
  await qbDeletePayment(token, current.Id, current.SyncToken);
  return { status: "synced", payload, qbEntityId: snapshotQbPaymentId };
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/qb/sync/payments.ts
git commit -m "feat(16d): payment sync module (create/update/delete)"
```

---

## Task 8: Update `src/lib/qb/sync/processor.ts`

**Files:**
- Modify: `src/lib/qb/sync/processor.ts`

- [ ] **Step 1: Rewrite processor with advisory lock + invoice/payment dispatch + new backoff**

Replace the full file contents with:

```ts
// Batch processor for qb_sync_log queued rows. Invoked from the cron
// endpoint (daily) and the manual "Sync now" button.
//
// Concurrency: wraps the entire run in a Postgres advisory lock so two
// invocations never process rows simultaneously. If the lock is held,
// returns early with reason = "already_running".
//
// Ordering rules:
//   * customer < sub_customer < invoice < payment
//   * Within each entity type, oldest first.
//   * Rows with depends_on_log_id waiting on an unresolved parent are
//     skipped this tick.
//   * Rows with next_retry_at in the future are also skipped.
//
// Cap: PROCESS_BATCH_LIMIT rows per invocation.
//
// Retry policy: exponential backoff in minutes per spec: 5, 25, 120, 600, 1440.
// ThrottleExceeded errors override to a flat 5 minutes so we recover fast.
// After retry_count = 5, the row stops auto-retrying.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidAccessToken, getActiveConnection } from "@/lib/qb/tokens";
import { syncCustomer, syncSubCustomer } from "./customers";
import { syncInvoice, voidInvoiceSync } from "./invoices";
import { syncPayment, deletePaymentSync } from "./payments";
import type { SyncMode } from "./customers";
import type { QbSyncLogRow } from "@/lib/qb/types";

const PROCESS_BATCH_LIMIT = 50;
const MAX_RETRIES = 5;
const BACKOFF_MINUTES = [5, 25, 120, 600, 1440];
const SCHEDULER_LOCK_KEY = 4216042;

export interface ProcessResult {
  processed: number;
  synced: number;
  skipped: number;
  failed: number;
  deferred: number;
  reason?: "no_connection" | "setup_incomplete" | "connection_inactive" | "already_running";
}

async function tryLock(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.rpc("try_acquire_advisory_lock", {
    p_key: SCHEDULER_LOCK_KEY,
  });
  return data === true;
}

async function releaseLock(supabase: SupabaseClient): Promise<void> {
  await supabase.rpc("release_advisory_lock", { p_key: SCHEDULER_LOCK_KEY });
}

export async function processQueue(
  supabase: SupabaseClient,
): Promise<ProcessResult> {
  const acquired = await tryLock(supabase);
  if (!acquired) {
    return emptyResult("already_running");
  }
  try {
    return await runInsideLock(supabase);
  } finally {
    await releaseLock(supabase);
  }
}

async function runInsideLock(supabase: SupabaseClient): Promise<ProcessResult> {
  const connection = await getActiveConnection(supabase);
  if (!connection) return emptyResult("no_connection");
  if (!connection.sync_start_date || !connection.setup_completed_at) {
    return emptyResult("setup_incomplete");
  }

  const mode: SyncMode = connection.dry_run_mode ? "dry_run" : "live";
  const token = mode === "live" ? await getValidAccessToken(supabase) : null;
  if (mode === "live" && !token) return emptyResult("connection_inactive");

  const nowIso = new Date().toISOString();

  // Order expression: we want customer < sub_customer < invoice < payment.
  // Alphabetical sort gives: customer < invoice < payment < sub_customer — wrong.
  // Fetch all candidates, then sort client-side with an explicit order map.
  const { data: rows } = await supabase
    .from("qb_sync_log")
    .select("*")
    .eq("status", "queued")
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(PROCESS_BATCH_LIMIT * 2); // oversample — we'll slice after sort

  const typeOrder: Record<string, number> = {
    customer: 0,
    sub_customer: 1,
    invoice: 2,
    payment: 3,
  };
  const queue = ((rows ?? []) as QbSyncLogRow[])
    .sort((a, b) => {
      const d = (typeOrder[a.entity_type] ?? 99) - (typeOrder[b.entity_type] ?? 99);
      if (d !== 0) return d;
      return a.created_at.localeCompare(b.created_at);
    })
    .slice(0, PROCESS_BATCH_LIMIT);

  const result: ProcessResult = {
    processed: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
  };

  for (const row of queue) {
    result.processed += 1;

    if (row.depends_on_log_id) {
      const { data: parent } = await supabase
        .from("qb_sync_log")
        .select("status")
        .eq("id", row.depends_on_log_id)
        .maybeSingle<{ status: string }>();
      if (!parent || parent.status === "queued" || parent.status === "failed") {
        result.deferred += 1;
        continue;
      }
    }

    try {
      let outcome:
        | { status: "synced" | "skipped_dry_run" | "deferred"; payload: unknown; qbEntityId?: string; reason?: string }
        | null = null;

      if (row.entity_type === "customer") {
        outcome = await syncCustomer(supabase, token, mode, row.entity_id, row.action);
      } else if (row.entity_type === "sub_customer") {
        outcome = await syncSubCustomer(supabase, token, mode, row.entity_id, row.action);
      } else if (row.entity_type === "invoice") {
        if (row.action === "void") {
          outcome = await voidInvoiceSync(supabase, token, mode, row.entity_id);
        } else {
          outcome = await syncInvoice(supabase, token, mode, row.entity_id, row.action);
        }
      } else if (row.entity_type === "payment") {
        if (row.action === "delete") {
          const snapshot = row.payload as { qb_payment_id?: string | null } | null;
          outcome = await deletePaymentSync(
            token,
            mode,
            snapshot?.qb_payment_id ?? row.qb_entity_id ?? null,
          );
        } else {
          outcome = await syncPayment(supabase, token, mode, row.entity_id, row.action);
        }
      }

      if (!outcome) {
        result.deferred += 1;
        continue;
      }

      if (outcome.status === "deferred") {
        result.deferred += 1;
        continue;
      }

      await supabase
        .from("qb_sync_log")
        .update({
          status: outcome.status,
          payload: outcome.payload,
          qb_entity_id: outcome.qbEntityId ?? row.qb_entity_id ?? null,
          synced_at: new Date().toISOString(),
          error_message: outcome.reason ?? null,
          error_code: null,
        })
        .eq("id", row.id);

      if (outcome.status === "synced") result.synced += 1;
      else result.skipped += 1;
    } catch (err) {
      result.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: unknown }).code)
          : null;
      const isThrottle = code === "ThrottleExceeded" || /429|throttle|rate/i.test(message);
      const next = nextRetry(row.retry_count, isThrottle);
      await supabase
        .from("qb_sync_log")
        .update({
          status: next ? "queued" : "failed",
          error_message: message,
          error_code: code,
          retry_count: row.retry_count + 1,
          next_retry_at: next,
        })
        .eq("id", row.id);
      if (code === "AuthenticationFailure") break;
    }
  }

  if (result.synced > 0) {
    await supabase
      .from("qb_connection")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("id", connection.id);
  }

  return result;
}

function nextRetry(currentRetryCount: number, isThrottle: boolean): string | null {
  if (currentRetryCount >= MAX_RETRIES) return null;
  const minutes = isThrottle ? 5 : (BACKOFF_MINUTES[currentRetryCount] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1]);
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function emptyResult(reason: ProcessResult["reason"]): ProcessResult {
  return { processed: 0, synced: 0, skipped: 0, failed: 0, deferred: 0, reason };
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/qb/sync/processor.ts
git commit -m "feat(16d): processor — advisory lock, invoice/payment dispatch, new backoff"
```

---

## Task 9: Update `/api/qb/sync-scheduled` + `/api/qb/sync-now` to surface `already_running`

**Files:**
- Modify: `src/app/api/qb/sync-scheduled/route.ts`
- Verify: `src/app/api/qb/sync-now/route.ts`

- [ ] **Step 1: Update sync-scheduled route log**

Replace the file contents with:

```ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { processQueue } from "@/lib/qb/sync/processor";

// GET /api/qb/sync-scheduled — Vercel Cron endpoint. Runs daily (Hobby
// plan cap). Authenticates via Authorization: Bearer <CRON_SECRET>.
// Returns early with reason=already_running if another sync is in flight.
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const service = createServiceClient();
  const result = await processQueue(service);
  const durationMs = Date.now() - startedAt;
  console.log(
    `[qb-sync-scheduled] processed=${result.processed} synced=${result.synced} skipped=${result.skipped} failed=${result.failed} deferred=${result.deferred} reason=${result.reason ?? "-"} durationMs=${durationMs}`,
  );
  return NextResponse.json({ ok: true, ...result, durationMs });
}
```

(Only the inline comment changes; the body already returns `result.reason` through the spread.)

- [ ] **Step 2: Read sync-now route**

Run:
```bash
cat src/app/api/qb/sync-now/route.ts
```

If it already calls `processQueue` and spreads the result into the response (same pattern as sync-scheduled), no change needed. If not, match the sync-scheduled pattern. Given 16c followed the pattern, expect no change; include this verification as a safeguard.

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/qb/sync-scheduled/route.ts
git commit -m "feat(16d): sync-scheduled — document advisory-lock short-circuit"
```

---

## Task 10: Sync log admin endpoints — `mark-synced` + `cleanup`

**Files:**
- Create: `src/app/api/qb/sync-log/[id]/mark-synced/route.ts`
- Create: `src/app/api/qb/sync-log/cleanup/route.ts`

- [ ] **Step 1: Write mark-synced route**

```ts
// POST /api/qb/sync-log/[id]/mark-synced
// Manual override: admin provides a QB entity id (or leaves blank) and the
// log row flips to synced with note "manually_marked". Used when the record
// was created in QB out-of-band or when a stuck row needs to move on.

import { NextResponse } from "next/server";
import { createApiClient, createServiceClient } from "@/lib/supabase-api";
import type { QbSyncLogRow } from "@/lib/qb/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    qbEntityId?: string;
  };
  const qbEntityId = typeof body.qbEntityId === "string" && body.qbEntityId.trim()
    ? body.qbEntityId.trim()
    : null;

  const service = createServiceClient();
  const { data: row } = await service
    .from("qb_sync_log")
    .select("*")
    .eq("id", id)
    .maybeSingle<QbSyncLogRow>();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Write qb_*_id back to the platform record when the user provides one.
  if (qbEntityId) {
    if (row.entity_type === "customer") {
      await service.from("contacts").update({ qb_customer_id: qbEntityId }).eq("id", row.entity_id);
    } else if (row.entity_type === "sub_customer") {
      await service.from("jobs").update({ qb_subcustomer_id: qbEntityId }).eq("id", row.entity_id);
    } else if (row.entity_type === "invoice") {
      await service.from("invoices").update({ qb_invoice_id: qbEntityId }).eq("id", row.entity_id);
    } else if (row.entity_type === "payment") {
      await service.from("payments").update({ qb_payment_id: qbEntityId }).eq("id", row.entity_id);
    }
  }

  const { error } = await service
    .from("qb_sync_log")
    .update({
      status: "synced",
      qb_entity_id: qbEntityId ?? row.qb_entity_id,
      error_message: "manually_marked",
      error_code: null,
      synced_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Write cleanup route**

```ts
// POST /api/qb/sync-log/cleanup
// Deletes synced rows older than 90 days. Keeps failed/queued rows
// regardless of age. Admin only.

import { NextResponse } from "next/server";
import { createApiClient, createServiceClient } from "@/lib/supabase-api";

export async function POST() {
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const service = createServiceClient();
  const { error, count } = await service
    .from("qb_sync_log")
    .delete({ count: "exact" })
    .in("status", ["synced", "skipped_dry_run"])
    .lt("synced_at", cutoff);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/qb/sync-log/[id]/mark-synced/route.ts src/app/api/qb/sync-log/cleanup/route.ts
git commit -m "feat(16d): sync log admin routes — mark-synced + cleanup"
```

---

## Task 11: Invoice list + create — `/api/invoices/route.ts`

**Files:**
- Create: `src/app/api/invoices/route.ts`
- Create: `src/lib/invoices/types.ts`

- [ ] **Step 1: Write shared invoice types**

```ts
// Shared invoice types used by API routes + UI.

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "voided";

export interface InvoiceLineItemInput {
  description: string;
  quantity: number;
  unit_price: number;
  xactimate_code?: string | null;
}

export interface InvoiceLineItemRow {
  id: string;
  invoice_id: string;
  sort_order: number;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  xactimate_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  job_id: string;
  status: InvoiceStatus;
  issued_date: string;
  due_date: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  po_number: string | null;
  memo: string | null;
  notes: string | null;
  sent_at: string | null;
  voided_at: string | null;
  voided_by: string | null;
  qb_invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceWithItems extends InvoiceRow {
  line_items: InvoiceLineItemRow[];
}

export interface CreateInvoiceInput {
  jobId: string;
  issuedDate?: string; // ISO; defaults to now server-side
  dueDate?: string | null;
  lineItems: InvoiceLineItemInput[];
  taxRate?: number; // decimal; 0.0875 = 8.75%
  poNumber?: string | null;
  memo?: string | null;
  notes?: string | null;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeTotals(
  items: InvoiceLineItemInput[],
  taxRate: number,
): { subtotal: number; taxAmount: number; total: number; lineAmounts: number[] } {
  const lineAmounts = items.map((li) => roundMoney(Number(li.quantity) * Number(li.unit_price)));
  const subtotal = roundMoney(lineAmounts.reduce((a, b) => a + b, 0));
  const taxAmount = roundMoney(subtotal * Number(taxRate || 0));
  const total = roundMoney(subtotal + taxAmount);
  return { subtotal, taxAmount, total, lineAmounts };
}
```

- [ ] **Step 2: Write the list + create route**

```ts
// GET /api/invoices — list with filters (jobId, status, search, limit, offset).
// POST /api/invoices — create a draft invoice with line items in one atomic shot.

import { NextResponse } from "next/server";
import { createApiClient, createServiceClient } from "@/lib/supabase-api";
import {
  computeTotals,
  type CreateInvoiceInput,
  type InvoiceRow,
  type InvoiceLineItemInput,
} from "@/lib/invoices/types";

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export async function GET(request: Request) {
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("search")?.trim();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

  let query = supabase
    .from("invoices")
    .select("*, jobs!inner(id, job_number, property_address, contact_id, contacts:contact_id(first_name, last_name))", { count: "exact" })
    .order("issued_date", { ascending: false })
    .range(offset, offset + limit - 1);

  if (jobId) query = query.eq("job_id", jobId);
  if (status) query = query.eq("status", status);
  if (search) {
    query = query.or(
      `invoice_number.ilike.%${search}%,memo.ilike.%${search}%,notes.ilike.%${search}%`,
    );
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [], total: count ?? 0 });
}

export async function POST(request: Request) {
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as CreateInvoiceInput | null;
  if (!body || typeof body.jobId !== "string") {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }
  if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) {
    return NextResponse.json({ error: "at least one line item is required" }, { status: 400 });
  }

  const items: InvoiceLineItemInput[] = body.lineItems.map((li) => ({
    description: String(li.description ?? "").trim(),
    quantity: Number(li.quantity ?? 1),
    unit_price: Number(li.unit_price ?? 0),
    xactimate_code: li.xactimate_code?.toString().trim() || null,
  }));
  for (const li of items) {
    if (!li.description) {
      return NextResponse.json({ error: "line item description is required" }, { status: 400 });
    }
  }

  const taxRate = Number(body.taxRate ?? 0);
  const { subtotal, taxAmount, total, lineAmounts } = computeTotals(items, taxRate);

  const issued = body.issuedDate ?? new Date().toISOString();
  const due = body.dueDate === null ? null : (body.dueDate ?? addDays(issued, 30));

  const service = createServiceClient();
  const { data: inv, error: invErr } = await service
    .from("invoices")
    .insert({
      job_id: body.jobId,
      status: "draft",
      issued_date: issued,
      due_date: due,
      subtotal,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      total_amount: total,
      po_number: body.poNumber ?? null,
      memo: body.memo ?? null,
      notes: body.notes ?? null,
    })
    .select()
    .single<InvoiceRow>();
  if (invErr || !inv) {
    return NextResponse.json({ error: invErr?.message ?? "insert failed" }, { status: 500 });
  }

  const rows = items.map((li, idx) => ({
    invoice_id: inv.id,
    sort_order: idx,
    description: li.description,
    quantity: li.quantity,
    unit_price: li.unit_price,
    amount: lineAmounts[idx],
    xactimate_code: li.xactimate_code,
  }));
  const { error: liErr } = await service.from("invoice_line_items").insert(rows);
  if (liErr) {
    // Rollback: delete the parent invoice.
    await service.from("invoices").delete().eq("id", inv.id);
    return NextResponse.json({ error: liErr.message }, { status: 500 });
  }

  return NextResponse.json(inv);
}
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/invoices/route.ts src/lib/invoices/types.ts
git commit -m "feat(16d): invoice list + create API + shared types"
```

---

## Task 12: Invoice detail/patch/delete — `/api/invoices/[id]/route.ts`

**Files:**
- Create: `src/app/api/invoices/[id]/route.ts`

- [ ] **Step 1: Write the route**

```ts
// GET /api/invoices/[id]     — detail with joined line items.
// PATCH /api/invoices/[id]   — edit. Status-gated: draft allows everything;
//                              sent/partial/paid require confirmLineItemEdit:true
//                              to change line_items/totals/dates.
//                              voided is read-only.
// DELETE /api/invoices/[id]  — draft only; hard delete.

import { NextResponse } from "next/server";
import { createApiClient, createServiceClient } from "@/lib/supabase-api";
import {
  computeTotals,
  type InvoiceLineItemInput,
  type InvoiceRow,
  type InvoiceWithItems,
} from "@/lib/invoices/types";

const COSMETIC_FIELDS = new Set(["po_number", "memo", "notes"]);
const GATED_FIELDS = new Set([
  "issued_date",
  "due_date",
  "tax_rate",
  "line_items",
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: invoice } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle<InvoiceRow>();
  if (!invoice) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: items } = await supabase
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", id)
    .order("sort_order", { ascending: true });

  const result: InvoiceWithItems = {
    ...invoice,
    line_items: items ?? [],
  };
  return NextResponse.json(result);
}

interface PatchBody {
  issuedDate?: string;
  dueDate?: string | null;
  lineItems?: InvoiceLineItemInput[];
  taxRate?: number;
  poNumber?: string | null;
  memo?: string | null;
  notes?: string | null;
  confirmLineItemEdit?: boolean;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const service = createServiceClient();
  const { data: current } = await service
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle<InvoiceRow>();
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (current.status === "voided") {
    return NextResponse.json({ error: "voided invoices are read-only" }, { status: 400 });
  }

  const wantsGatedChange =
    body.issuedDate !== undefined
    || body.dueDate !== undefined
    || body.taxRate !== undefined
    || body.lineItems !== undefined;

  if (current.status !== "draft" && wantsGatedChange && !body.confirmLineItemEdit) {
    return NextResponse.json(
      { error: "confirmLineItemEdit required to change gated fields on a sent invoice" },
      { status: 409 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (body.poNumber !== undefined) patch.po_number = body.poNumber;
  if (body.memo !== undefined) patch.memo = body.memo;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.issuedDate !== undefined) patch.issued_date = body.issuedDate;
  if (body.dueDate !== undefined) patch.due_date = body.dueDate;

  // Recompute totals if line items or tax rate changed.
  let lineRowsToReplace: Array<{
    invoice_id: string;
    sort_order: number;
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
    xactimate_code: string | null;
  }> | null = null;

  if (body.lineItems || body.taxRate !== undefined) {
    const items = body.lineItems
      ? body.lineItems.map((li) => ({
          description: String(li.description ?? "").trim(),
          quantity: Number(li.quantity ?? 1),
          unit_price: Number(li.unit_price ?? 0),
          xactimate_code: li.xactimate_code?.toString().trim() || null,
        }))
      : null;

    if (items) {
      for (const li of items) {
        if (!li.description) {
          return NextResponse.json({ error: "line item description is required" }, { status: 400 });
        }
      }
    }

    const effectiveRate = body.taxRate !== undefined ? Number(body.taxRate) : Number(current.tax_rate);
    if (items) {
      const { subtotal, taxAmount, total, lineAmounts } = computeTotals(items, effectiveRate);
      patch.subtotal = subtotal;
      patch.tax_amount = taxAmount;
      patch.total_amount = total;
      patch.tax_rate = effectiveRate;
      lineRowsToReplace = items.map((li, idx) => ({
        invoice_id: id,
        sort_order: idx,
        description: li.description,
        quantity: li.quantity,
        unit_price: li.unit_price,
        amount: lineAmounts[idx],
        xactimate_code: li.xactimate_code,
      }));
    } else {
      // Only tax rate changed; recompute against existing line items.
      const { data: existing } = await service
        .from("invoice_line_items")
        .select("amount")
        .eq("invoice_id", id);
      const subtotal = (existing ?? []).reduce((a, b) => a + Number(b.amount), 0);
      const taxAmount = Math.round(subtotal * effectiveRate * 100) / 100;
      patch.subtotal = Math.round(subtotal * 100) / 100;
      patch.tax_amount = taxAmount;
      patch.total_amount = Math.round((subtotal + taxAmount) * 100) / 100;
      patch.tax_rate = effectiveRate;
    }
  }

  // Persist line items first (if replacing) to keep sync triggers coherent.
  if (lineRowsToReplace) {
    const { error: delErr } = await service
      .from("invoice_line_items")
      .delete()
      .eq("invoice_id", id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    const { error: insErr } = await service
      .from("invoice_line_items")
      .insert(lineRowsToReplace);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  if (Object.keys(patch).length > 0) {
    const { data: updated, error: updErr } = await service
      .from("invoices")
      .update(patch)
      .eq("id", id)
      .select()
      .single<InvoiceRow>();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    return NextResponse.json(updated);
  }

  return NextResponse.json(current);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: current } = await service
    .from("invoices")
    .select("status")
    .eq("id", id)
    .maybeSingle<{ status: string }>();
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (current.status !== "draft") {
    return NextResponse.json({ error: "only drafts can be deleted" }, { status: 400 });
  }

  const { error } = await service.from("invoices").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Note unused import**

The constants `COSMETIC_FIELDS` and `GATED_FIELDS` are documentation only — delete both declarations (they're not referenced). Leave the surrounding comments intact.

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/invoices/[id]/route.ts
git commit -m "feat(16d): invoice GET/PATCH/DELETE route with status-gated edits"
```

---

## Task 13: Invoice send / mark-sent / void routes

**Files:**
- Create: `src/app/api/invoices/[id]/send/route.ts`
- Create: `src/app/api/invoices/[id]/mark-sent/route.ts`
- Create: `src/app/api/invoices/[id]/void/route.ts`

- [ ] **Step 1: Write the send route**

```ts
// POST /api/invoices/[id]/send
// Transitions draft → sent, stamps sent_at. The DB trigger handles QB enqueue.
// Called by the invoice detail page's onSent callback after the email composer
// reports a successful send.

import { NextResponse } from "next/server";
import { createApiClient, createServiceClient } from "@/lib/supabase-api";
import type { InvoiceRow } from "@/lib/invoices/types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: current } = await service
    .from("invoices")
    .select("status")
    .eq("id", id)
    .maybeSingle<{ status: string }>();
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (current.status !== "draft") {
    return NextResponse.json({ error: "only draft invoices can be sent" }, { status: 400 });
  }

  const { data: updated, error } = await service
    .from("invoices")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single<InvoiceRow>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(updated);
}
```

- [ ] **Step 2: Write the mark-sent route**

```ts
// POST /api/invoices/[id]/mark-sent
// Same DB effect as /send, but no email is sent. Used when the invoice was
// delivered outside the platform.

import { NextResponse } from "next/server";
import { createApiClient, createServiceClient } from "@/lib/supabase-api";
import type { InvoiceRow } from "@/lib/invoices/types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: current } = await service
    .from("invoices")
    .select("status")
    .eq("id", id)
    .maybeSingle<{ status: string }>();
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (current.status !== "draft") {
    return NextResponse.json({ error: "only draft invoices can be marked sent" }, { status: 400 });
  }

  const { data: updated, error } = await service
    .from("invoices")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single<InvoiceRow>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(updated);
}
```

- [ ] **Step 3: Write the void route**

```ts
// POST /api/invoices/[id]/void
// Guards against payments on the invoice. Sets status=voided, voided_at, voided_by.
// Trigger handles QB enqueue (and coalesces with queued create if applicable).

import { NextResponse } from "next/server";
import { createApiClient, createServiceClient } from "@/lib/supabase-api";
import type { InvoiceRow } from "@/lib/invoices/types";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: current } = await service
    .from("invoices")
    .select("status")
    .eq("id", id)
    .maybeSingle<{ status: string }>();
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (current.status === "voided") {
    return NextResponse.json({ error: "already voided" }, { status: 400 });
  }
  if (current.status === "draft") {
    return NextResponse.json(
      { error: "drafts can be deleted instead of voided" },
      { status: 400 },
    );
  }

  const { count } = await service
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", id);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "Cannot void an invoice with recorded payments. Refund or void payments first.",
      },
      { status: 400 },
    );
  }

  const { data: updated, error } = await service
    .from("invoices")
    .update({
      status: "voided",
      voided_at: new Date().toISOString(),
      voided_by: user.id,
    })
    .eq("id", id)
    .select()
    .single<InvoiceRow>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(updated);
}
```

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/invoices/[id]/send/route.ts src/app/api/invoices/[id]/mark-sent/route.ts src/app/api/invoices/[id]/void/route.ts
git commit -m "feat(16d): invoice send / mark-sent / void routes"
```

---

## Task 14: Invoice PDF — document, generator, route

**Files:**
- Create: `src/components/invoices/invoice-pdf-document.tsx`
- Create: `src/lib/invoices/generate-invoice-pdf.tsx`
- Create: `src/app/api/invoices/[id]/pdf/route.ts`

- [ ] **Step 1: Write the PDF document**

```tsx
// Plain, printable invoice PDF. Matches the report-pdf structure (Build 11).
// No design polish — line items, totals, company header, payment info.

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { InvoiceWithItems } from "@/lib/invoices/types";

interface CompanyBlock {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

interface CustomerBlock {
  name: string;
  address: string;
}

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  companyName: { fontSize: 14, fontWeight: "bold" },
  muted: { color: "#666", fontSize: 9 },
  title: { fontSize: 22, fontWeight: "bold", textAlign: "right" },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 4 },
  metaLabel: { color: "#666" },
  section: { marginTop: 16 },
  h: { fontWeight: "bold", fontSize: 10, marginBottom: 4 },
  table: { marginTop: 8, borderTop: "1 solid #ddd" },
  tr: { flexDirection: "row", borderBottom: "1 solid #eee", paddingVertical: 6 },
  thRow: { flexDirection: "row", paddingVertical: 6, backgroundColor: "#f5f5f5" },
  tdDesc: { flex: 3, paddingHorizontal: 6 },
  tdQty: { flex: 0.6, paddingHorizontal: 6, textAlign: "right" },
  tdPrice: { flex: 1, paddingHorizontal: 6, textAlign: "right" },
  tdAmt: { flex: 1, paddingHorizontal: 6, textAlign: "right" },
  totals: { marginTop: 12, alignSelf: "flex-end", width: 220 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalBold: { fontWeight: "bold", borderTop: "1 solid #333", paddingTop: 4, marginTop: 4 },
  memo: { marginTop: 20, paddingTop: 12, borderTop: "1 solid #eee" },
});

function money(n: number): string {
  return `$${Number(n).toFixed(2)}`;
}

function fmtDate(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function InvoicePdfDocument({
  invoice,
  company,
  customer,
}: {
  invoice: InvoiceWithItems;
  company: CompanyBlock;
  customer: CustomerBlock;
}) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>{company.name ?? "Company"}</Text>
            {company.address && <Text style={styles.muted}>{company.address}</Text>}
            {company.phone && <Text style={styles.muted}>{company.phone}</Text>}
            {company.email && <Text style={styles.muted}>{company.email}</Text>}
          </View>
          <View>
            <Text style={styles.title}>INVOICE</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>No.</Text>
              <Text>{invoice.invoice_number}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Issued</Text>
              <Text>{fmtDate(invoice.issued_date)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Due</Text>
              <Text>{fmtDate(invoice.due_date)}</Text>
            </View>
            {invoice.po_number && (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>PO</Text>
                <Text>{invoice.po_number}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.h}>Bill to</Text>
          <Text>{customer.name}</Text>
          <Text style={styles.muted}>{customer.address}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.thRow}>
            <Text style={styles.tdDesc}>Description</Text>
            <Text style={styles.tdQty}>Qty</Text>
            <Text style={styles.tdPrice}>Unit price</Text>
            <Text style={styles.tdAmt}>Amount</Text>
          </View>
          {invoice.line_items.map((li) => (
            <View key={li.id} style={styles.tr}>
              <Text style={styles.tdDesc}>
                {li.xactimate_code ? `[${li.xactimate_code}] ` : ""}
                {li.description}
              </Text>
              <Text style={styles.tdQty}>{Number(li.quantity)}</Text>
              <Text style={styles.tdPrice}>{money(Number(li.unit_price))}</Text>
              <Text style={styles.tdAmt}>{money(Number(li.amount))}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalsRow}>
            <Text>Subtotal</Text>
            <Text>{money(Number(invoice.subtotal))}</Text>
          </View>
          {Number(invoice.tax_amount) > 0 && (
            <View style={styles.totalsRow}>
              <Text>Tax ({(Number(invoice.tax_rate) * 100).toFixed(2)}%)</Text>
              <Text>{money(Number(invoice.tax_amount))}</Text>
            </View>
          )}
          <View style={[styles.totalsRow, styles.totalBold]}>
            <Text>Total</Text>
            <Text>{money(Number(invoice.total_amount))}</Text>
          </View>
        </View>

        {invoice.memo && (
          <View style={styles.memo}>
            <Text style={styles.h}>Memo</Text>
            <Text>{invoice.memo}</Text>
          </View>
        )}
      </Page>
    </Document>
  );
}
```

- [ ] **Step 2: Write the generator wrapper**

```tsx
// Renders the PDF document to a Buffer. Called by the /pdf route handler.

import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePdfDocument } from "@/components/invoices/invoice-pdf-document";
import type { InvoiceWithItems } from "@/lib/invoices/types";

export interface PdfCompany {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export interface PdfCustomer {
  name: string;
  address: string;
}

export async function generateInvoicePdf(
  invoice: InvoiceWithItems,
  company: PdfCompany,
  customer: PdfCustomer,
): Promise<Buffer> {
  return renderToBuffer(
    <InvoicePdfDocument invoice={invoice} company={company} customer={customer} />,
  );
}
```

- [ ] **Step 3: Write the route**

```ts
// GET /api/invoices/[id]/pdf
// Query param `mode`: "download" (default) returns the file; "attachment" also
// uploads to Supabase storage under invoice-pdfs/{invoiceId}/{ts}.pdf and
// returns { storage_path, filename, content_type, file_size } — used by the
// Send Invoice flow to hand the file to the email composer.

import { NextResponse } from "next/server";
import { createApiClient, createServiceClient } from "@/lib/supabase-api";
import { generateInvoicePdf } from "@/lib/invoices/generate-invoice-pdf";
import type { InvoiceWithItems } from "@/lib/invoices/types";

async function loadPayload(
  service: ReturnType<typeof createServiceClient>,
  id: string,
): Promise<{
  invoice: InvoiceWithItems;
  company: { name: string | null; address: string | null; phone: string | null; email: string | null };
  customer: { name: string; address: string };
} | null> {
  const { data: invoice } = await service
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle<InvoiceWithItems>();
  if (!invoice) return null;
  const { data: items } = await service
    .from("invoice_line_items")
    .select("*")
    .eq("invoice_id", id)
    .order("sort_order", { ascending: true });
  invoice.line_items = items ?? [];

  const { data: job } = await service
    .from("jobs")
    .select("property_address, contact_id, contacts:contact_id(first_name, last_name)")
    .eq("id", invoice.job_id)
    .maybeSingle<{
      property_address: string | null;
      contact_id: string;
      contacts: { first_name: string | null; last_name: string | null } | null;
    }>();
  const customer = {
    name: [job?.contacts?.first_name, job?.contacts?.last_name].filter(Boolean).join(" ") || "Customer",
    address: job?.property_address ?? "",
  };

  const { data: company } = await service
    .from("company_settings")
    .select("company_name, address, phone, email")
    .limit(1)
    .maybeSingle<{ company_name: string | null; address: string | null; phone: string | null; email: string | null }>();
  return {
    invoice,
    company: {
      name: company?.company_name ?? null,
      address: company?.address ?? null,
      phone: company?.phone ?? null,
      email: company?.email ?? null,
    },
    customer,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const payload = await loadPayload(service, id);
  if (!payload) return NextResponse.json({ error: "not found" }, { status: 404 });

  const buffer = await generateInvoicePdf(payload.invoice, payload.company, payload.customer);
  const filename = `invoice-${payload.invoice.invoice_number}.pdf`;

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  if (mode === "attachment") {
    const ts = Date.now();
    const path = `invoice-pdfs/${id}/${ts}.pdf`;
    const { error: upErr } = await service.storage
      .from("email-attachments")
      .upload(path, buffer, { contentType: "application/pdf", upsert: false });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    return NextResponse.json({
      storage_path: path,
      filename,
      content_type: "application/pdf",
      file_size: buffer.byteLength,
    });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
```

- [ ] **Step 4: Verify the `email-attachments` storage bucket exists**

If `email-attachments` is not a real bucket in this project (check Supabase Storage), use the bucket that `compose-email.tsx` already uploads to. Grep:
```bash
grep -nR "storage\.from" src/components/compose-email.tsx src/app/api/email | head -5
```
If a different bucket name appears, change `"email-attachments"` in the PDF route to match.

- [ ] **Step 5: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/invoices/invoice-pdf-document.tsx src/lib/invoices/generate-invoice-pdf.tsx src/app/api/invoices/[id]/pdf/route.ts
git commit -m "feat(16d): invoice PDF — document, generator, route (inline + attachment)"
```

---

## Task 15: Payment routes

**Files:**
- Create: `src/app/api/payments/route.ts`
- Create: `src/app/api/payments/[id]/route.ts`

- [ ] **Step 1: Write the list + create route**

```ts
// GET  /api/payments?invoiceId=&jobId=   — list.
// POST /api/payments                       — record a payment.

import { NextResponse } from "next/server";
import { createApiClient, createServiceClient } from "@/lib/supabase-api";

interface CreatePaymentBody {
  jobId: string;
  invoiceId?: string | null;
  source: "insurance" | "homeowner" | "other";
  method: "check" | "ach" | "venmo_zelle" | "cash" | "credit_card";
  amount: number;
  referenceNumber?: string | null;
  payerName?: string | null;
  receivedDate?: string | null;
  notes?: string | null;
}

export async function GET(request: Request) {
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const invoiceId = url.searchParams.get("invoiceId");
  const jobId = url.searchParams.get("jobId");

  let query = supabase
    .from("payments")
    .select("*")
    .order("received_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (invoiceId) query = query.eq("invoice_id", invoiceId);
  if (jobId) query = query.eq("job_id", jobId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as CreatePaymentBody | null;
  if (!body?.jobId || !body?.source || !body?.method || !body.amount) {
    return NextResponse.json({ error: "jobId, source, method, amount required" }, { status: 400 });
  }
  if (body.invoiceId) {
    // Block recording payments against draft invoices.
    const service = createServiceClient();
    const { data: inv } = await service
      .from("invoices")
      .select("status")
      .eq("id", body.invoiceId)
      .maybeSingle<{ status: string }>();
    if (inv?.status === "draft") {
      return NextResponse.json(
        { error: "Cannot record a payment on a draft invoice. Send or mark it sent first." },
        { status: 400 },
      );
    }
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("payments")
    .insert({
      job_id: body.jobId,
      invoice_id: body.invoiceId ?? null,
      source: body.source,
      method: body.method,
      amount: body.amount,
      reference_number: body.referenceNumber ?? null,
      payer_name: body.payerName ?? null,
      received_date: body.receivedDate ?? new Date().toISOString(),
      notes: body.notes ?? null,
      status: "received",
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
```

- [ ] **Step 2: Write the patch + delete route**

```ts
// PATCH  /api/payments/[id]   — edit. Trigger handles QB update enqueue.
// DELETE /api/payments/[id]   — delete. Trigger captures snapshot before delete.

import { NextResponse } from "next/server";
import { createApiClient, createServiceClient } from "@/lib/supabase-api";

interface PatchBody {
  amount?: number;
  method?: string;
  source?: string;
  receivedDate?: string | null;
  referenceNumber?: string | null;
  payerName?: string | null;
  notes?: string | null;
  status?: "received" | "pending" | "due";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.amount === "number") patch.amount = body.amount;
  if (typeof body.method === "string") patch.method = body.method;
  if (typeof body.source === "string") patch.source = body.source;
  if (body.receivedDate !== undefined) patch.received_date = body.receivedDate;
  if (body.referenceNumber !== undefined) patch.reference_number = body.referenceNumber;
  if (body.payerName !== undefined) patch.payer_name = body.payerName;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.status) patch.status = body.status;

  const service = createServiceClient();
  const { data, error } = await service
    .from("payments")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { error } = await service.from("payments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/payments/route.ts src/app/api/payments/[id]/route.ts
git commit -m "feat(16d): payment routes (list, create, update, delete)"
```

---

## Task 16: Invoice email settings — API + page

**Files:**
- Create: `src/app/api/settings/invoice-email/route.ts`
- Create: `src/app/settings/invoices/page.tsx`

- [ ] **Step 1: Write the API route**

```ts
// GET /api/settings/invoice-email   — returns the singleton row.
// PATCH /api/settings/invoice-email — updates allowed fields.

import { NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";
import type { InvoiceEmailProvider, InvoiceEmailSettings } from "@/lib/qb/types";

async function getSettings() {
  const supabase = createApiClient();
  const { data, error } = await supabase
    .from("invoice_email_settings")
    .select("*")
    .limit(1)
    .maybeSingle<InvoiceEmailSettings>();
  return { supabase, data, error };
}

export async function GET() {
  const { data, error } = await getSettings();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: "invoice_email_settings row missing — did the build38 migration run?" },
      { status: 500 },
    );
  }
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<InvoiceEmailSettings> | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const { supabase, data: current } = await getSettings();
  if (!current) return NextResponse.json({ error: "settings missing" }, { status: 500 });

  const patch: Partial<InvoiceEmailSettings> = {};
  const strFields: Array<keyof InvoiceEmailSettings> = [
    "send_from_email",
    "send_from_name",
    "reply_to_email",
    "subject_template",
    "body_template",
  ];
  for (const f of strFields) {
    if (body[f] === null || typeof body[f] === "string") {
      (patch as Record<string, unknown>)[f] = body[f] || null;
    }
  }
  if (body.provider === "resend" || body.provider === "email_account") {
    patch.provider = body.provider as InvoiceEmailProvider;
  }
  if (body.email_account_id === null || typeof body.email_account_id === "string") {
    patch.email_account_id = body.email_account_id || null;
  }

  if (patch.provider === "email_account" && !patch.email_account_id && !current.email_account_id) {
    return NextResponse.json(
      { error: "Select an email account before switching provider to email_account" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("invoice_email_settings")
    .update(patch)
    .eq("id", current.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
```

- [ ] **Step 2: Write the settings page**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import EmailTemplateField from "@/components/contracts/email-template-field";
import type { InvoiceEmailSettings } from "@/lib/qb/types";

interface EmailAccount {
  id: string;
  label: string;
  email_address: string;
}

const MERGE_FIELDS = [
  "invoice_number",
  "invoice_total",
  "due_date",
  "job_address",
  "customer_name",
  "customer_first_name",
  "company_name",
];

export default function InvoiceEmailSettingsPage() {
  const [settings, setSettings] = useState<InvoiceEmailSettings | null>(null);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const refresh = useCallback(async () => {
    const [sRes, aRes] = await Promise.all([
      fetch("/api/settings/invoice-email"),
      fetch("/api/email/accounts"),
    ]);
    if (sRes.ok) setSettings((await sRes.json()) as InvoiceEmailSettings);
    else toast.error("Failed to load invoice email settings");
    if (aRes.ok) setAccounts((await aRes.json()) as EmailAccount[]);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function patch<K extends keyof InvoiceEmailSettings>(key: K, value: InvoiceEmailSettings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/invoice-email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Save failed");
      }
      setDirty(false);
      toast.success("Invoice email settings saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Loader2 className="animate-spin mx-auto mb-2" size={22} /> Loading…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Invoice email</h1>
        <p className="text-sm text-muted-foreground">
          Configure how invoice emails are sent and what templates they use.
        </p>
      </div>

      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold">Provider</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={settings.provider === "resend"}
            onChange={() => patch("provider", "resend")}
          />
          Resend (platform default)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={settings.provider === "email_account"}
            onChange={() => patch("provider", "email_account")}
          />
          Send from a connected email account
        </label>
        {settings.provider === "email_account" && (
          <select
            className="border border-border rounded-lg px-3 py-2 bg-background text-sm"
            value={settings.email_account_id ?? ""}
            onChange={(e) => patch("email_account_id", e.target.value || null)}
          >
            <option value="">Select account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} — {a.email_address}
              </option>
            ))}
          </select>
        )}
      </section>

      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold">Identity</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">
            From name
            <input
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
              value={settings.send_from_name ?? ""}
              onChange={(e) => patch("send_from_name", e.target.value)}
            />
          </label>
          <label className="text-sm">
            From email
            <input
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
              value={settings.send_from_email ?? ""}
              onChange={(e) => patch("send_from_email", e.target.value)}
            />
          </label>
        </div>
        <label className="text-sm block">
          Reply-to (optional)
          <input
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
            value={settings.reply_to_email ?? ""}
            onChange={(e) => patch("reply_to_email", e.target.value)}
          />
        </label>
      </section>

      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <h2 className="font-semibold">Template</h2>
        <EmailTemplateField
          label="Subject"
          value={settings.subject_template}
          onChange={(v) => patch("subject_template", v)}
          mergeFields={MERGE_FIELDS}
          singleLine
        />
        <EmailTemplateField
          label="Body"
          value={settings.body_template}
          onChange={(v) => patch("body_template", v)}
          mergeFields={MERGE_FIELDS}
        />
      </section>

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="px-4 py-2 rounded-lg bg-[#0F6E56] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify `EmailTemplateField` props**

Read `src/components/contracts/email-template-field.tsx` and confirm the props used above (`label`, `value`, `onChange`, `mergeFields`, `singleLine`) match what the component accepts. If any differ, adapt the usage in `page.tsx` to the real prop names. The rest of this plan assumes the contract template field component accepts those names; do not fabricate props.

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/invoice-email/route.ts src/app/settings/invoices/page.tsx
git commit -m "feat(16d): invoice email settings API + page"
```

---

## Task 17: Extend `ComposeEmailModal` with `defaultAttachments`

**Files:**
- Modify: `src/components/compose-email.tsx`

- [ ] **Step 1: Add the prop to `ComposeEmailProps`**

In `src/components/compose-email.tsx`, extend the interface (around line 39-53):

```ts
interface ComposeEmailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId?: string;
  draftId?: string;
  defaultTo?: string;
  defaultCc?: string;
  defaultBcc?: string;
  defaultSubject?: string;
  defaultBody?: string;
  defaultAccountId?: string;
  replyToMessageId?: string;
  mode?: "compose" | "reply" | "forward";
  onSent?: () => void;
  defaultAttachments?: UploadedFile[];
}
```

- [ ] **Step 2: Destructure the new prop**

In the component signature (around line 55-69), add `defaultAttachments = []` to the destructured props list.

- [ ] **Step 3: Seed `uploadedFiles` from the prop on mount**

Find the `useState<UploadedFile[]>([])` for `uploadedFiles`. Change to:
```ts
const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>(defaultAttachments);
```

Also add an effect that resets attachments when the modal opens with new defaults:
```ts
useEffect(() => {
  if (open) setUploadedFiles(defaultAttachments);
  // defaultAttachments is intentionally not in deps — we only snapshot at open.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [open]);
```

Place that effect next to the other `useEffect` hooks near the top of the component.

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/compose-email.tsx
git commit -m "feat(16d): ComposeEmail accepts defaultAttachments for invoice PDF pre-attach"
```

---

## Task 18: Invoice shared UI components

**Files:**
- Create: `src/components/invoices/invoice-status-pill.tsx`
- Create: `src/components/invoices/line-items-editor.tsx`
- Create: `src/components/invoices/invoice-totals-panel.tsx`

- [ ] **Step 1: Write the status pill**

```tsx
"use client";

import type { InvoiceStatus } from "@/lib/invoices/types";

const MAP: Record<InvoiceStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  sent: { label: "Sent", className: "bg-blue-500/10 text-blue-700" },
  partial: { label: "Partial", className: "bg-amber-500/10 text-amber-700" },
  paid: { label: "Paid", className: "bg-green-500/10 text-green-700" },
  voided: { label: "Voided", className: "bg-red-500/10 text-red-700 line-through" },
};

export function InvoiceStatusPill({ status }: { status: InvoiceStatus }) {
  const v = MAP[status];
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${v.className}`}>
      {v.label}
    </span>
  );
}
```

- [ ] **Step 2: Write the line items editor**

```tsx
"use client";

import { GripVertical, Plus, Trash2 } from "lucide-react";
import type { InvoiceLineItemInput } from "@/lib/invoices/types";

export interface EditableLineItem extends InvoiceLineItemInput {
  key: string; // client-only; stable React key across reorders
}

function makeKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function blankLine(): EditableLineItem {
  return { key: makeKey(), description: "", quantity: 1, unit_price: 0, xactimate_code: null };
}

export function toInputs(items: EditableLineItem[]): InvoiceLineItemInput[] {
  return items.map((li) => ({
    description: li.description,
    quantity: Number(li.quantity),
    unit_price: Number(li.unit_price),
    xactimate_code: li.xactimate_code ?? null,
  }));
}

export default function LineItemsEditor({
  items,
  onChange,
  readOnly = false,
}: {
  items: EditableLineItem[];
  onChange: (next: EditableLineItem[]) => void;
  readOnly?: boolean;
}) {
  function update(idx: number, patch: Partial<EditableLineItem>) {
    const next = [...items];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  }
  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }
  function add() {
    onChange([...items, blankLine()]);
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="w-8"></th>
            <th className="text-left px-3 py-2 font-medium">Description</th>
            <th className="text-left px-3 py-2 font-medium w-28">Xactimate</th>
            <th className="text-right px-3 py-2 font-medium w-20">Qty</th>
            <th className="text-right px-3 py-2 font-medium w-28">Unit price</th>
            <th className="text-right px-3 py-2 font-medium w-28">Amount</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((li, idx) => {
            const amount = Number(li.quantity) * Number(li.unit_price);
            return (
              <tr key={li.key} className="border-t border-border">
                <td className="px-2 py-2 text-muted-foreground">
                  {!readOnly && (
                    <div className="flex flex-col items-center gap-0.5">
                      <button
                        onClick={() => move(idx, idx - 1)}
                        className="text-xs hover:text-foreground"
                        aria-label="Move up"
                      >▲</button>
                      <GripVertical size={12} />
                      <button
                        onClick={() => move(idx, idx + 1)}
                        className="text-xs hover:text-foreground"
                        aria-label="Move down"
                      >▼</button>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <textarea
                    disabled={readOnly}
                    value={li.description}
                    onChange={(e) => update(idx, { description: e.target.value })}
                    rows={2}
                    className="w-full border border-border rounded-md px-2 py-1 bg-background text-sm resize-none disabled:opacity-70"
                    placeholder="Description"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    disabled={readOnly}
                    value={li.xactimate_code ?? ""}
                    onChange={(e) => update(idx, { xactimate_code: e.target.value || null })}
                    className="w-full border border-border rounded-md px-2 py-1 bg-background text-sm disabled:opacity-70"
                    placeholder="DRY-1/RT+"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    disabled={readOnly}
                    type="number"
                    min="0"
                    step="0.01"
                    value={li.quantity}
                    onChange={(e) => update(idx, { quantity: Number(e.target.value) })}
                    className="w-full border border-border rounded-md px-2 py-1 bg-background text-right text-sm disabled:opacity-70"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    disabled={readOnly}
                    type="number"
                    min="0"
                    step="0.01"
                    value={li.unit_price}
                    onChange={(e) => update(idx, { unit_price: Number(e.target.value) })}
                    className="w-full border border-border rounded-md px-2 py-1 bg-background text-right text-sm disabled:opacity-70"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  ${amount.toFixed(2)}
                </td>
                <td className="px-2 py-2">
                  {!readOnly && (
                    <button
                      onClick={() => remove(idx)}
                      className="text-muted-foreground hover:text-red-500"
                      aria-label="Remove line"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!readOnly && (
        <div className="p-3 border-t border-border">
          <button
            onClick={add}
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            <Plus size={14} /> Add line
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the totals panel**

```tsx
"use client";

import { computeTotals, type InvoiceLineItemInput } from "@/lib/invoices/types";

export default function InvoiceTotalsPanel({
  items,
  taxRate,
  onTaxRateChange,
  readOnly = false,
}: {
  items: InvoiceLineItemInput[];
  taxRate: number; // decimal
  onTaxRateChange: (decimal: number) => void;
  readOnly?: boolean;
}) {
  const { subtotal, taxAmount, total } = computeTotals(items, taxRate);
  const percent = (taxRate * 100).toFixed(2);

  return (
    <div className="bg-card border border-border rounded-xl p-4 w-full md:w-80 md:ml-auto space-y-2 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Subtotal</span>
        <span>${subtotal.toFixed(2)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Tax rate</span>
        <div className="flex items-center gap-1">
          <input
            disabled={readOnly}
            type="number"
            min="0"
            max="30"
            step="0.01"
            value={percent}
            onChange={(e) => onTaxRateChange(Math.max(0, Number(e.target.value)) / 100)}
            className="w-20 border border-border rounded-md px-2 py-1 bg-background text-right disabled:opacity-70"
          />
          <span className="text-muted-foreground">%</span>
        </div>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Tax</span>
        <span>${taxAmount.toFixed(2)}</span>
      </div>
      <div className="flex justify-between pt-2 border-t border-border font-semibold">
        <span>Total</span>
        <span>${total.toFixed(2)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/invoices/invoice-status-pill.tsx src/components/invoices/line-items-editor.tsx src/components/invoices/invoice-totals-panel.tsx
git commit -m "feat(16d): invoice shared UI — status pill, line items editor, totals panel"
```

---

## Task 19: Invoice list page — `/invoices`

**Files:**
- Create: `src/app/invoices/page.tsx`
- Create: `src/components/invoices/invoice-list-client.tsx`

- [ ] **Step 1: Write the server page**

```tsx
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import InvoiceListClient from "@/components/invoices/invoice-list-client";

export default async function InvoicesPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = profile?.role === "admin";
  let canView = isAdmin;
  if (!canView) {
    const { data: perm } = await supabase
      .from("user_permissions")
      .select("granted")
      .eq("user_id", user.id)
      .eq("permission_key", "view_billing")
      .maybeSingle();
    canView = !!perm?.granted;
  }
  if (!canView) redirect("/");

  return <InvoiceListClient />;
}
```

- [ ] **Step 2: Write the client list**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { InvoiceStatusPill } from "./invoice-status-pill";
import type { InvoiceRow, InvoiceStatus } from "@/lib/invoices/types";

type StatusFilter = "all" | InvoiceStatus;

interface InvoiceWithJob extends InvoiceRow {
  jobs?: {
    id: string;
    job_number: string;
    property_address: string | null;
    contacts?: { first_name: string | null; last_name: string | null } | null;
  };
}

const FILTER_TABS: StatusFilter[] = ["all", "draft", "sent", "partial", "paid", "voided"];

export default function InvoiceListClient() {
  const [rows, setRows] = useState<InvoiceWithJob[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    if (search.trim()) params.set("search", search.trim());
    params.set("limit", "100");
    const res = await fetch(`/api/invoices?${params.toString()}`);
    if (!res.ok) {
      toast.error("Failed to load invoices");
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { rows: InvoiceWithJob[] };
    setRows(data.rows);
    setLoading(false);
  }, [filter, search]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <p className="text-sm text-muted-foreground">All invoices across all jobs</p>
        </div>
        <Link
          href="/invoices/new"
          className="px-4 py-2 rounded-lg bg-[#0F6E56] text-white text-sm font-medium hover:brightness-110 flex items-center gap-2"
        >
          <Plus size={14} /> New invoice
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTER_TABS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
              filter === f
                ? "bg-[#0F6E56] text-white border-[#0F6E56]"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
        <input
          type="text"
          placeholder="Search invoice #, memo, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto border border-border rounded-lg px-3 py-1.5 bg-background text-sm w-72"
        />
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="animate-spin mx-auto mb-2" size={22} /> Loading…
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Invoice</th>
                <th className="text-left px-4 py-2 font-medium">Customer</th>
                <th className="text-left px-4 py-2 font-medium">Job</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
                <th className="text-left px-4 py-2 font-medium">Issued</th>
                <th className="text-left px-4 py-2 font-medium">Due</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">QB</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted-foreground">
                    No invoices match the current filters.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-accent/30">
                  <td className="px-4 py-2">
                    <Link href={`/invoices/${r.id}`} className="text-primary hover:underline">
                      {r.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {[r.jobs?.contacts?.first_name, r.jobs?.contacts?.last_name].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.jobs?.property_address ?? r.jobs?.job_number ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right">${Number(r.total_amount).toFixed(2)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDate(r.issued_date)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDate(r.due_date)}</td>
                  <td className="px-4 py-2"><InvoiceStatusPill status={r.status} /></td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {r.qb_invoice_id ? `QB ${r.qb_invoice_id}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatDate(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/invoices/page.tsx src/components/invoices/invoice-list-client.tsx
git commit -m "feat(16d): invoice list page"
```

---

## Task 20: Invoice new — `/invoices/new`

**Files:**
- Create: `src/app/invoices/new/page.tsx`
- Create: `src/components/invoices/invoice-new-client.tsx`

This page picks a job and redirects to the new invoice form (which lives at `/invoices/[id]` once created).

- [ ] **Step 1: Write the server page**

```tsx
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import InvoiceNewClient from "@/components/invoices/invoice-new-client";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  return <InvoiceNewClient prefillJobId={params.jobId ?? null} />;
}
```

- [ ] **Step 2: Write the client**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import LineItemsEditor, { blankLine, toInputs, type EditableLineItem } from "./line-items-editor";
import InvoiceTotalsPanel from "./invoice-totals-panel";

interface JobOption {
  id: string;
  job_number: string;
  property_address: string | null;
  contacts?: { first_name: string | null; last_name: string | null } | null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function InvoiceNewClient({ prefillJobId }: { prefillJobId: string | null }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [jobId, setJobId] = useState<string>(prefillJobId ?? "");
  const [items, setItems] = useState<EditableLineItem[]>([blankLine()]);
  const [taxRate, setTaxRate] = useState(0);
  const [issuedDate, setIssuedDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => addDays(new Date().toISOString(), 30));
  const [poNumber, setPoNumber] = useState("");
  const [memo, setMemo] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const loadJobs = useCallback(async () => {
    const res = await fetch("/api/jobs?limit=200");
    if (!res.ok) return;
    const data = (await res.json()) as { rows?: JobOption[] } | JobOption[];
    const list = Array.isArray(data) ? data : data.rows ?? [];
    setJobs(list);
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    // Keep dueDate in sync when issued date changes if user hasn't manually altered it.
    setDueDate((prev) => {
      const auto = addDays(new Date(issuedDate).toISOString(), 30);
      return prev === "" ? auto : prev;
    });
  }, [issuedDate]);

  const inputs = useMemo(() => toInputs(items), [items]);

  async function save(action: "draft" | "send" | "mark-sent") {
    if (!jobId) {
      toast.error("Select a job");
      return;
    }
    if (items.length === 0 || items.every((li) => !li.description)) {
      toast.error("Add at least one line item");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        issuedDate: new Date(issuedDate).toISOString(),
        dueDate: new Date(dueDate).toISOString(),
        taxRate,
        poNumber: poNumber || null,
        memo: memo || null,
        notes: notes || null,
        lineItems: inputs,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Create failed");
      return;
    }
    const invoice = (await res.json()) as { id: string };
    if (action === "draft") {
      router.push(`/invoices/${invoice.id}`);
    } else {
      // Redirect to detail with a query flag so detail page opens the flow.
      router.push(`/invoices/${invoice.id}?action=${action}`);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <h1 className="text-2xl font-semibold">New invoice</h1>

      <section className="bg-card border border-border rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="text-sm">
          Job
          <select
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
          >
            <option value="">Select a job…</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.job_number} — {[j.contacts?.first_name, j.contacts?.last_name].filter(Boolean).join(" ") || j.property_address}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          PO number
          <input
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
          />
        </label>
        <label className="text-sm">
          Issued
          <input
            type="date"
            value={issuedDate}
            onChange={(e) => setIssuedDate(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
          />
        </label>
        <label className="text-sm">
          Due
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
          />
        </label>
        <label className="text-sm md:col-span-2">
          Memo (shows on PDF)
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
          />
        </label>
        <label className="text-sm md:col-span-2">
          Internal notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
          />
        </label>
      </section>

      <LineItemsEditor items={items} onChange={setItems} />

      <InvoiceTotalsPanel items={inputs} taxRate={taxRate} onTaxRateChange={setTaxRate} />

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => save("draft")}
          disabled={saving}
          className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : "Save draft"}
        </button>
        <button
          onClick={() => save("mark-sent")}
          disabled={saving}
          className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          Save &amp; mark sent
        </button>
        <button
          onClick={() => save("send")}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-[#0F6E56] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50"
        >
          Save &amp; send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/invoices/new/page.tsx src/components/invoices/invoice-new-client.tsx
git commit -m "feat(16d): new invoice page (job picker + create form)"
```

---

## Task 21: Invoice detail — `/invoices/[id]` (view + edit + all actions)

**Files:**
- Create: `src/app/invoices/[id]/page.tsx`
- Create: `src/components/invoices/invoice-detail-client.tsx`

- [ ] **Step 1: Write the server page**

```tsx
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import InvoiceDetailClient from "@/components/invoices/invoice-detail-client";

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const { action } = await searchParams;
  return <InvoiceDetailClient invoiceId={id} autoAction={action ?? null} />;
}
```

- [ ] **Step 2: Write the client (detail / edit / action bar)**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronLeft,
  Download,
  Edit2,
  Loader2,
  Mail,
  Save,
  Send,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import ComposeEmailModal from "@/components/compose-email";
import RecordPaymentModal from "@/components/payments/record-payment-modal";
import { InvoiceStatusPill } from "./invoice-status-pill";
import LineItemsEditor, { blankLine, toInputs, type EditableLineItem } from "./line-items-editor";
import InvoiceTotalsPanel from "./invoice-totals-panel";
import type {
  InvoiceLineItemInput,
  InvoiceLineItemRow,
  InvoiceStatus,
  InvoiceWithItems,
} from "@/lib/invoices/types";

interface JobSummary {
  id: string;
  job_number: string;
  property_address: string | null;
  damage_type: string | null;
  contact_id: string;
  contacts?: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
}

interface InvoiceEmailSettingsLite {
  subject_template: string;
  body_template: string;
}

interface AttachmentRef {
  filename: string;
  content_type: string;
  file_size: number;
  storage_path: string;
}

function toEditable(rows: InvoiceLineItemRow[]): EditableLineItem[] {
  return rows
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => ({
      key: r.id,
      description: r.description,
      quantity: Number(r.quantity),
      unit_price: Number(r.unit_price),
      xactimate_code: r.xactimate_code,
    }));
}

function resolveMergeFields(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? "");
}

export default function InvoiceDetailClient({
  invoiceId,
  autoAction,
}: {
  invoiceId: string;
  autoAction: string | null;
}) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceWithItems | null>(null);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [emailSettings, setEmailSettings] = useState<InvoiceEmailSettingsLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState<EditableLineItem[]>([]);
  const [taxRate, setTaxRate] = useState(0);
  const [poNumber, setPoNumber] = useState("");
  const [memo, setMemo] = useState("");
  const [notes, setNotes] = useState("");
  const [issuedDate, setIssuedDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendAttachments, setSendAttachments] = useState<AttachmentRef[]>([]);
  const [preparingSend, setPreparingSend] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/invoices/${invoiceId}`);
    if (!res.ok) {
      toast.error("Failed to load invoice");
      setLoading(false);
      return;
    }
    const data = (await res.json()) as InvoiceWithItems;
    setInvoice(data);
    setItems(toEditable(data.line_items));
    setTaxRate(Number(data.tax_rate));
    setPoNumber(data.po_number ?? "");
    setMemo(data.memo ?? "");
    setNotes(data.notes ?? "");
    setIssuedDate(data.issued_date?.slice(0, 10) ?? "");
    setDueDate(data.due_date?.slice(0, 10) ?? "");

    const jobRes = await fetch(`/api/jobs/${data.job_id}`);
    if (jobRes.ok) setJob((await jobRes.json()) as JobSummary);

    const esRes = await fetch("/api/settings/invoice-email");
    if (esRes.ok) setEmailSettings((await esRes.json()) as InvoiceEmailSettingsLite);

    setLoading(false);
  }, [invoiceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-trigger send flow when coming from /invoices/new?action=send.
  useEffect(() => {
    if (autoAction === "send" && invoice?.status === "draft" && !sendModalOpen && !preparingSend) {
      handleOpenSend();
    }
    if (autoAction === "mark-sent" && invoice?.status === "draft" && !saving) {
      handleMarkSent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAction, invoice?.status]);

  const inputs = useMemo<InvoiceLineItemInput[]>(() => toInputs(items), [items]);
  const readOnlyLineItems = !!invoice && (invoice.status !== "draft" && !editing);
  const isVoided = invoice?.status === "voided";
  const isPostSent = invoice && invoice.status !== "draft" && invoice.status !== "voided";

  async function saveCosmeticEdits() {
    if (!invoice) return;
    setSaving(true);
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        poNumber: poNumber || null,
        memo: memo || null,
        notes: notes || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Save failed");
      return;
    }
    toast.success("Invoice updated");
    await refresh();
  }

  async function saveLineItemEdits() {
    if (!invoice) return;
    const confirm = invoice.status !== "draft"
      ? window.confirm(
          "This invoice has been sent to the customer and synced to QuickBooks. Editing will update both. Continue?",
        )
      : true;
    if (!confirm) return;

    setSaving(true);
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        issuedDate: issuedDate ? new Date(issuedDate).toISOString() : undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        taxRate,
        poNumber: poNumber || null,
        memo: memo || null,
        notes: notes || null,
        lineItems: inputs,
        confirmLineItemEdit: invoice.status !== "draft",
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Save failed");
      return;
    }
    toast.success("Invoice updated");
    setEditing(false);
    await refresh();
  }

  async function handleMarkSent() {
    if (!invoice) return;
    if (!window.confirm(
      "Mark this invoice as sent? This will create the invoice in QuickBooks. Use this option if you delivered the invoice outside AAA Platform.",
    )) return;
    setSaving(true);
    const res = await fetch(`/api/invoices/${invoice.id}/mark-sent`, { method: "POST" });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Action failed");
      return;
    }
    toast.success("Invoice marked as sent");
    // Clear autoAction from URL.
    router.replace(`/invoices/${invoice.id}`);
    await refresh();
  }

  async function handleOpenSend() {
    if (!invoice) return;
    setPreparingSend(true);
    const res = await fetch(`/api/invoices/${invoice.id}/pdf?mode=attachment`);
    setPreparingSend(false);
    if (!res.ok) {
      toast.error("Failed to generate invoice PDF");
      return;
    }
    const data = (await res.json()) as AttachmentRef;
    setSendAttachments([data]);
    setSendModalOpen(true);
  }

  async function handleAfterSend() {
    if (!invoice) return;
    const res = await fetch(`/api/invoices/${invoice.id}/send`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Failed to flip invoice to sent");
      return;
    }
    toast.success("Invoice sent");
    router.replace(`/invoices/${invoice.id}`);
    await refresh();
  }

  async function handleVoid() {
    if (!invoice) return;
    if (!window.confirm(
      "Void this invoice? The invoice will be preserved for audit but marked as voided in both the platform and QuickBooks.",
    )) return;
    setSaving(true);
    const res = await fetch(`/api/invoices/${invoice.id}/void`, { method: "POST" });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Void failed");
      return;
    }
    toast.success("Invoice voided");
    await refresh();
  }

  async function handleDeleteDraft() {
    if (!invoice) return;
    if (!window.confirm("Delete this draft? This cannot be undone.")) return;
    setSaving(true);
    const res = await fetch(`/api/invoices/${invoice.id}`, { method: "DELETE" });
    setSaving(false);
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success("Draft deleted");
    router.push("/invoices");
  }

  if (loading || !invoice) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Loader2 className="animate-spin mx-auto mb-2" size={22} /> Loading…
      </div>
    );
  }

  const customerName = [job?.contacts?.first_name, job?.contacts?.last_name]
    .filter(Boolean)
    .join(" ") || "Customer";
  const ctx: Record<string, string> = {
    invoice_number: invoice.invoice_number,
    invoice_total: `$${Number(invoice.total_amount).toFixed(2)}`,
    due_date: invoice.due_date
      ? new Date(invoice.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "",
    job_address: job?.property_address ?? "",
    customer_name: customerName,
    customer_first_name: job?.contacts?.first_name ?? customerName.split(" ")[0],
    company_name: "",
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <Link href="/invoices" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ChevronLeft size={14} /> All invoices
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className={`text-2xl font-semibold ${isVoided ? "line-through text-muted-foreground" : ""}`}>
              {invoice.invoice_number}
            </h1>
            <InvoiceStatusPill status={invoice.status as InvoiceStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            {customerName}
            {job?.property_address ? ` · ${job.property_address}` : ""}
            {job?.job_number ? ` · Job ${job.job_number}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {invoice.status === "draft" && (
            <>
              <button onClick={handleDeleteDraft} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50">Delete</button>
              <button onClick={handleMarkSent} disabled={saving} className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50">Mark as sent</button>
              <button onClick={handleOpenSend} disabled={saving || preparingSend} className="px-3 py-1.5 rounded-lg bg-[#0F6E56] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5">
                {preparingSend ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Send invoice
              </button>
            </>
          )}
          {isPostSent && (
            <>
              <a
                href={`/api/invoices/${invoice.id}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-accent flex items-center gap-1.5"
              >
                <Download size={14} /> PDF
              </a>
              <button onClick={() => setPaymentModalOpen(true)} disabled={saving} className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50">
                Record payment
              </button>
              <button onClick={handleVoid} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50 flex items-center gap-1.5">
                <XCircle size={14} /> Void
              </button>
            </>
          )}
          {isVoided && (
            <a
              href={`/api/invoices/${invoice.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-accent flex items-center gap-1.5"
            >
              <Download size={14} /> PDF
            </a>
          )}
        </div>
      </div>

      <section className="bg-card border border-border rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="text-sm">
          Issued
          <input
            type="date"
            disabled={readOnlyLineItems}
            value={issuedDate}
            onChange={(e) => setIssuedDate(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background disabled:opacity-70"
          />
        </label>
        <label className="text-sm">
          Due
          <input
            type="date"
            disabled={readOnlyLineItems}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background disabled:opacity-70"
          />
        </label>
        <label className="text-sm">
          PO number
          <input
            disabled={isVoided}
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background disabled:opacity-70"
          />
        </label>
        <label className="text-sm md:col-span-2">
          Memo
          <input
            disabled={isVoided}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background disabled:opacity-70"
          />
        </label>
        <label className="text-sm md:col-span-2">
          Internal notes
          <textarea
            disabled={isVoided}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background disabled:opacity-70"
          />
        </label>
      </section>

      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Line items</h2>
        {isPostSent && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            <Edit2 size={14} /> Edit line items (requires confirmation)
          </button>
        )}
      </div>

      <LineItemsEditor items={items} onChange={setItems} readOnly={readOnlyLineItems} />

      <InvoiceTotalsPanel
        items={inputs}
        taxRate={taxRate}
        onTaxRateChange={setTaxRate}
        readOnly={readOnlyLineItems}
      />

      <div className="flex items-center justify-end gap-2">
        {isPostSent && !editing && !isVoided && (
          <button
            onClick={saveCosmeticEdits}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save cosmetic edits
          </button>
        )}
        {(invoice.status === "draft" || editing) && !isVoided && (
          <button
            onClick={saveLineItemEdits}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-[#0F6E56] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save changes
          </button>
        )}
      </div>

      {isVoided && (
        <div className="flex items-center gap-2 p-3 bg-red-500/5 rounded-lg border border-red-500/20 text-sm text-red-700">
          <AlertTriangle size={16} />
          This invoice has been voided. Voided invoices are read-only and preserved for audit.
        </div>
      )}

      {emailSettings && job && (
        <ComposeEmailModal
          open={sendModalOpen}
          onOpenChange={setSendModalOpen}
          jobId={invoice.job_id}
          defaultTo={job.contacts?.email ?? ""}
          defaultSubject={resolveMergeFields(emailSettings.subject_template, ctx)}
          defaultBody={resolveMergeFields(emailSettings.body_template, ctx)}
          defaultAttachments={sendAttachments}
          onSent={handleAfterSend}
        />
      )}

      <RecordPaymentModal
        open={paymentModalOpen}
        onOpenChange={setPaymentModalOpen}
        invoiceId={invoice.id}
        jobId={invoice.job_id}
        onRecorded={refresh}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify tsc**

Likely errors: `RecordPaymentModal` does not yet exist (created in Task 22) and `/api/jobs/[id]` is assumed. Before compile, apply one of two mitigations:
1. Comment the import of `RecordPaymentModal` and its JSX usage; uncomment in Task 22. OR
2. Create Task 22's modal stub first, commit, then land this task.

Use option 1 — add `// TODO(task22):` comments next to the import and JSX block, with them commented out. Task 22 removes the comments.

Also verify `/api/jobs/[id]` exists. If not, replace `fetch(\`/api/jobs/${data.job_id}\`)` with a direct Supabase client query or with an embedded select on `/api/invoices/[id]` (extend that route to also include `jobs(...)` join). If you choose to embed, update `/api/invoices/[id]` from Task 12 accordingly and this client reads `data.jobs` instead.

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/invoices/[id]/page.tsx src/components/invoices/invoice-detail-client.tsx
git commit -m "feat(16d): invoice detail page with status-gated actions + send flow"
```

---

## Task 22: Record payment modal

**Files:**
- Create: `src/components/payments/record-payment-modal.tsx`

- [ ] **Step 1: Write the modal**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Source = "insurance" | "homeowner" | "other";
type Method = "check" | "ach" | "venmo_zelle" | "cash" | "credit_card";

export default function RecordPaymentModal({
  open,
  onOpenChange,
  invoiceId,
  jobId,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId?: string;
  jobId: string;
  onRecorded?: () => void;
}) {
  const [source, setSource] = useState<Source>("insurance");
  const [method, setMethod] = useState<Method>("check");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [payerName, setPayerName] = useState("");
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSource("insurance");
      setMethod("check");
      setAmount("");
      setReference("");
      setPayerName("");
      setReceivedDate(new Date().toISOString().slice(0, 10));
      setNotes("");
    }
  }, [open]);

  async function submit() {
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error("Enter an amount");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        invoiceId: invoiceId ?? null,
        source,
        method,
        amount: amt,
        referenceNumber: reference || null,
        payerName: payerName || null,
        receivedDate: new Date(receivedDate).toISOString(),
        notes: notes || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Record failed");
      return;
    }
    toast.success("Payment recorded · QB sync queued");
    onOpenChange(false);
    onRecorded?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Source
              <select
                className="mt-1 w-full border border-border rounded-lg px-2 py-2 bg-background"
                value={source}
                onChange={(e) => setSource(e.target.value as Source)}
              >
                <option value="insurance">Insurance</option>
                <option value="homeowner">Homeowner</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="text-sm">
              Method
              <select
                className="mt-1 w-full border border-border rounded-lg px-2 py-2 bg-background"
                value={method}
                onChange={(e) => setMethod(e.target.value as Method)}
              >
                <option value="check">Check</option>
                <option value="ach">ACH</option>
                <option value="venmo_zelle">Venmo / Zelle</option>
                <option value="cash">Cash</option>
                <option value="credit_card">Credit card</option>
              </select>
            </label>
          </div>
          <label className="text-sm block">
            Amount
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Reference
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Check #, auth code"
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
              />
            </label>
            <label className="text-sm">
              Payer name
              <input
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
              />
            </label>
          </div>
          <label className="text-sm block">
            Received
            <input
              type="date"
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
            />
          </label>
          <label className="text-sm block">
            Notes
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
            />
          </label>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#0F6E56] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Record
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Uncomment the import + usage in `invoice-detail-client.tsx`**

Remove the `// TODO(task22):` comments from Task 21 and restore `RecordPaymentModal` imports/JSX.

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/payments/record-payment-modal.tsx src/components/invoices/invoice-detail-client.tsx
git commit -m "feat(16d): record payment modal + wire into invoice detail"
```

---

## Task 23: Job detail Financials — Create Invoice + Record Payment hooks

**Files:**
- Modify: the existing Financials tab component within the `/jobs/[id]` tree

- [ ] **Step 1: Locate the Financials tab component**

Run:
```bash
grep -nR "Financials" src/app/jobs src/components | head -10
```

Expected: points to `src/components/jobs/financials-tab.tsx` or similar (created in 16b). Open that file.

- [ ] **Step 2: Add Create Invoice + Record Payment buttons**

At the top of the Financials tab's Invoices subsection, insert:

```tsx
import Link from "next/link";
import RecordPaymentModal from "@/components/payments/record-payment-modal";

// ...inside component:
const [paymentOpen, setPaymentOpen] = useState(false);

// ...at the top of the Invoices subsection:
<div className="flex items-center justify-between mb-2">
  <h3 className="font-semibold">Invoices</h3>
  <Link
    href={`/invoices/new?jobId=${jobId}`}
    className="text-sm text-primary hover:underline"
  >
    Create invoice →
  </Link>
</div>

// ...at the top of the Payments subsection (if it exists, otherwise skip):
<div className="flex items-center justify-between mb-2">
  <h3 className="font-semibold">Payments</h3>
  <button
    onClick={() => setPaymentOpen(true)}
    className="text-sm text-primary hover:underline"
  >
    Record payment →
  </button>
</div>

// ...at the end of the component return:
<RecordPaymentModal
  open={paymentOpen}
  onOpenChange={setPaymentOpen}
  jobId={jobId}
  onRecorded={/* trigger whatever refresh the tab uses */}
/>
```

Where the surrounding code uses a different state/refresh pattern, adapt rather than force this shape.

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Manual preview smoke check**

Start dev server (if not running), load `/jobs/<some-id>`, switch to Financials tab. Verify:
- Create invoice link navigates to `/invoices/new?jobId=…`.
- Record payment button opens the modal.

- [ ] **Step 5: Commit**

```bash
git add src/components/jobs/financials-tab.tsx  # actual file path may differ
git commit -m "feat(16d): wire Create Invoice + Record Payment into job Financials tab"
```

---

## Task 24: Extend `qb-fix-modal.tsx` with more error classifications + Mark as synced

**Files:**
- Modify: `src/components/accounting/qb-fix-modal.tsx`

- [ ] **Step 1: Replace the file with the extended version**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Copy, Loader2, RefreshCw, Settings as SettingsIcon, X } from "lucide-react";
import { toast } from "sonner";
import type { QbSyncLogRow } from "@/lib/qb/types";

type ErrorClass =
  | "class_not_mapped"
  | "deposit_account_not_mapped"
  | "auth_failure"
  | "rate_limit"
  | "duplicate"
  | "unknown";

function classify(row: QbSyncLogRow): ErrorClass {
  const code = row.error_code ?? "";
  const msg = row.error_message ?? "";
  if (code === "class_not_mapped" || /class.*(not|un)mapped|ClassRef/i.test(msg)) return "class_not_mapped";
  if (code === "deposit_account_not_mapped" || /deposit.*account.*(not|un)mapped/i.test(msg)) return "deposit_account_not_mapped";
  if (code === "AuthenticationFailure" || /authentic/i.test(msg)) return "auth_failure";
  if (code === "ThrottleExceeded" || /429|rate limit|too many/i.test(msg)) return "rate_limit";
  if (code === "DuplicateNameExists" || /duplicate|already exists/i.test(msg)) return "duplicate";
  return "unknown";
}

export default function QbFixModal({
  row,
  onClose,
  onRetried,
}: {
  row: QbSyncLogRow;
  onClose: () => void;
  onRetried: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [marking, setMarking] = useState(false);
  const [manualId, setManualId] = useState("");
  const cls = classify(row);

  async function retry() {
    setRetrying(true);
    const res = await fetch(`/api/qb/sync-log/${row.id}/retry`, { method: "POST" });
    setRetrying(false);
    if (res.ok) {
      toast.success("Re-queued.");
      onRetried();
      onClose();
    } else toast.error("Failed to re-queue");
  }

  async function markSynced() {
    setMarking(true);
    const res = await fetch(`/api/qb/sync-log/${row.id}/mark-synced`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qbEntityId: manualId.trim() || undefined }),
    });
    setMarking(false);
    if (res.ok) {
      toast.success("Marked as synced.");
      onRetried();
      onClose();
    } else toast.error("Failed to mark synced");
  }

  function copyError() {
    navigator.clipboard.writeText(row.error_message ?? "").then(
      () => toast.success("Error copied"),
      () => toast.error("Copy failed"),
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card rounded-xl border border-border p-6 max-w-lg w-full">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="text-red-500" size={20} />
            Fix sync error
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="text-xs text-muted-foreground mb-3">
          {row.entity_type} · retry {row.retry_count} of 5 · action {row.action}
        </div>

        {cls === "class_not_mapped" && (
          <Panel tone="amber">
            <p className="font-medium">QuickBooks Class is not mapped.</p>
            <p className="text-sm mt-1 opacity-90">Pick a Class for this damage type, then retry.</p>
            <Link href="/settings/accounting/setup?tab=mappings" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium hover:underline">
              <SettingsIcon size={14} /> Go to mappings
            </Link>
          </Panel>
        )}

        {cls === "deposit_account_not_mapped" && (
          <Panel tone="amber">
            <p className="font-medium">Deposit account is not mapped.</p>
            <p className="text-sm mt-1 opacity-90">Map this payment method to a QB deposit account.</p>
            <Link href="/settings/accounting/setup?tab=mappings" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium hover:underline">
              <SettingsIcon size={14} /> Go to mappings
            </Link>
          </Panel>
        )}

        {cls === "auth_failure" && (
          <Panel tone="red">
            <p className="font-medium">QuickBooks connection expired.</p>
            <p className="text-sm mt-1 opacity-90">Reconnect to resume sync.</p>
            <Link href="/api/qb/authorize" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium hover:underline">
              Reconnect →
            </Link>
          </Panel>
        )}

        {cls === "rate_limit" && (
          <Panel tone="blue">
            <p className="font-medium">QuickBooks rate limit reached.</p>
            <p className="text-sm mt-1 opacity-90">Will auto-retry shortly. You can also retry now below.</p>
          </Panel>
        )}

        {cls === "duplicate" && (
          <Panel tone="amber">
            <p className="font-medium">QuickBooks reports a duplicate.</p>
            <p className="text-sm mt-1 opacity-90">If the record already exists in QB, paste its id to mark this log synced.</p>
            <input
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              placeholder="QB entity id"
              className="mt-2 w-full border border-border rounded-md px-2 py-1 bg-background text-sm"
            />
          </Panel>
        )}

        {cls === "unknown" && (
          <Panel tone="red">
            <p className="font-medium">Error</p>
            <pre className="mt-1 text-xs whitespace-pre-wrap break-words">{row.error_message ?? "Unknown error"}</pre>
            {row.error_code && <p className="mt-1 text-xs opacity-70">Code: {row.error_code}</p>}
          </Panel>
        )}

        <div className="flex items-center justify-end gap-2 pt-4">
          {cls === "unknown" && (
            <button
              onClick={copyError}
              className="px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent flex items-center gap-1.5"
            >
              <Copy size={14} /> Copy error
            </button>
          )}
          {cls === "duplicate" && (
            <button
              onClick={markSynced}
              disabled={marking || !manualId.trim()}
              className="px-3 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {marking ? <Loader2 size={14} className="animate-spin" /> : "Mark as synced"}
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent">
            Close
          </button>
          <button
            onClick={retry}
            disabled={retrying}
            className="px-4 py-2 rounded-lg bg-[#0F6E56] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
          >
            {retrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Retry now
          </button>
        </div>
      </div>
    </div>
  );
}

function Panel({ tone, children }: { tone: "amber" | "red" | "blue"; children: React.ReactNode }) {
  const map = {
    amber: "bg-amber-500/10 border-amber-500/30 text-amber-700",
    red: "bg-red-500/10 border-red-500/30 text-red-700",
    blue: "bg-blue-500/10 border-blue-500/30 text-blue-700",
  };
  return <div className={`p-3 rounded-lg border ${map[tone]} text-sm`}>{children}</div>;
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/accounting/qb-fix-modal.tsx
git commit -m "feat(16d): extended Fix modal — deposit/auth/duplicate classifications + mark-synced"
```

---

## Task 25: QB sync tab — filters, search, cleanup button

**Files:**
- Modify: `src/components/accounting/qb-sync-tab.tsx`

- [ ] **Step 1: Add state + filter controls**

Near the top of the `QbSyncTab` component, beside the existing `useState` calls, add:

```ts
type EntityFilter = "all" | "customer" | "sub_customer" | "invoice" | "payment" | "void";
type StatusFilter = "all" | "synced" | "queued" | "failed" | "skipped_dry_run";

const [entityFilter, setEntityFilter] = useState<EntityFilter>("all");
const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
const [search, setSearch] = useState("");
const [cleaning, setCleaning] = useState(false);
```

- [ ] **Step 2: Derive filtered rows**

Just before `return (` in the component, add:

```ts
const filteredRows = rows.filter((r) => {
  if (entityFilter === "void") {
    if (r.action !== "void") return false;
  } else if (entityFilter !== "all") {
    if (r.entity_type !== entityFilter) return false;
  }
  if (statusFilter !== "all" && r.status !== statusFilter) return false;
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    const hay = [r.entity_id, r.qb_entity_id, r.error_message].filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
});
```

Then change the `rows.map((row) => …)` inside the `<tbody>` to `filteredRows.map(...)` and the empty-row guard to `filteredRows.length === 0`.

- [ ] **Step 3: Insert filter bar above the activity table**

Just above `<div className="bg-card rounded-xl border border-border overflow-hidden">` (the Recent activity table wrapper), insert:

```tsx
<div className="flex flex-wrap items-center gap-2">
  <FilterGroup
    value={entityFilter}
    onChange={(v) => setEntityFilter(v as EntityFilter)}
    options={[
      { value: "all", label: "All entities" },
      { value: "customer", label: "Customers" },
      { value: "sub_customer", label: "Sub-customers" },
      { value: "invoice", label: "Invoices" },
      { value: "payment", label: "Payments" },
      { value: "void", label: "Voids" },
    ]}
  />
  <FilterGroup
    value={statusFilter}
    onChange={(v) => setStatusFilter(v as StatusFilter)}
    options={[
      { value: "all", label: "All statuses" },
      { value: "synced", label: "Synced" },
      { value: "queued", label: "Queued" },
      { value: "failed", label: "Failed" },
      { value: "skipped_dry_run", label: "Dry run" },
    ]}
  />
  <input
    type="text"
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    placeholder="Search record / error…"
    className="ml-auto border border-border rounded-lg px-3 py-1.5 bg-background text-sm w-72"
  />
  <button
    onClick={handleCleanup}
    disabled={cleaning}
    className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50"
    title="Delete synced logs older than 90 days"
  >
    {cleaning ? "Cleaning…" : "Clear old logs"}
  </button>
</div>
```

Add the `handleCleanup` function near `handleSyncNow`:

```ts
async function handleCleanup() {
  if (!window.confirm("Delete synced sync-log entries older than 90 days?")) return;
  setCleaning(true);
  const res = await fetch("/api/qb/sync-log/cleanup", { method: "POST" });
  setCleaning(false);
  if (!res.ok) {
    toast.error("Cleanup failed");
    return;
  }
  const data = await res.json();
  toast.success(`Deleted ${data.deleted} log entries`);
  await refreshAll();
}
```

And define the `FilterGroup` helper at the bottom of the file, alongside the other helpers:

```tsx
function FilterGroup({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border border-border rounded-lg px-3 py-1.5 bg-background text-sm"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 4: Update `entityLabel` + `StatusPill` for void rows**

The `entityLabel` helper at the bottom already covers invoice/payment. Add a check for void action in the row render: in the `<td className="px-4 py-2 text-foreground">{entityLabel(row.entity_type)}</td>` line, change to:

```tsx
<td className="px-4 py-2 text-foreground">
  {entityLabel(row.entity_type)}
  {row.action === "void" && <span className="ml-1 text-xs text-red-600">(void)</span>}
  {row.action === "delete" && <span className="ml-1 text-xs text-muted-foreground">(delete)</span>}
</td>
```

- [ ] **Step 5: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/accounting/qb-sync-tab.tsx
git commit -m "feat(16d): QB sync tab — filters, search, cleanup button"
```

---

## Task 26: Sync log page entity filter

**Files:**
- Modify: `src/app/accounting/sync-log/sync-log-client.tsx`

- [ ] **Step 1: Read current client**

```bash
cat src/app/accounting/sync-log/sync-log-client.tsx | head -50
```

- [ ] **Step 2: Add entity-type + status filter selects**

At the top of the render (beside any existing filters), add selects for:
- entity_type: All / customer / sub_customer / invoice / payment
- status: All / synced / queued / failed / skipped_dry_run

Include them in the query string when the client fetches `/api/qb/sync-log`. Update `GET /api/qb/sync-log` route to honor `entity_type` and `status` query parameters (inspect the current handler in `src/app/api/qb/sync-log/route.ts` — likely needs a one-line filter addition).

Concrete edit in the API route:
```ts
// after existing query construction:
const entity = url.searchParams.get("entity_type");
if (entity) query = query.eq("entity_type", entity);
const status = url.searchParams.get("status");
if (status) query = query.eq("status", status);
```

In the client, pass the filters:
```ts
const params = new URLSearchParams();
if (entityType !== "all") params.set("entity_type", entityType);
if (statusFilter !== "all") params.set("status", statusFilter);
params.set("limit", "100");
const res = await fetch(`/api/qb/sync-log?${params.toString()}`);
```

- [ ] **Step 3: Verify tsc + manual smoke**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/app/accounting/sync-log/sync-log-client.tsx src/app/api/qb/sync-log/route.ts
git commit -m "feat(16d): sync-log page + API filter on entity_type + status"
```

---

## Task 27: Pre-launch checklist

**Files:**
- Create: `src/components/accounting/pre-launch-checklist.tsx`
- Modify: `src/app/settings/accounting/page.tsx`
- Create: `src/app/api/settings/accounting/checklist/route.ts`

- [ ] **Step 1: Write the checklist API route**

```ts
// GET /api/settings/accounting/checklist — returns the 5 checklist items,
// with auto-checks computed server-side.
// PATCH — toggles the manual flags (cpa_cleanup_confirmed, dry_run_review_confirmed).

import { NextResponse } from "next/server";
import { createApiClient, createServiceClient } from "@/lib/supabase-api";
import type { QbConnectionRow, QbMappingRow } from "@/lib/qb/types";

export async function GET() {
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const service = createServiceClient();
  const { data: conn } = await service
    .from("qb_connection")
    .select("*")
    .eq("is_active", true)
    .maybeSingle<QbConnectionRow>();
  if (!conn) return NextResponse.json({ items: [] });

  const { data: mappings } = await service
    .from("qb_mappings")
    .select("id, type, platform_value, qb_entity_id, qb_entity_name, created_at, updated_at");
  const all = (mappings ?? []) as QbMappingRow[];

  const { data: damageTypes } = await service.from("damage_types").select("id");
  const { data: methodEnum } = await service.rpc("get_payment_methods").catch(() => ({ data: null }));
  // If no RPC, fall back to the known enum values.
  const knownMethods = (methodEnum as string[] | null) ?? [
    "check", "ach", "venmo_zelle", "cash", "credit_card",
  ];

  const damageMapped = all.filter((m) => m.type === "damage_type").length;
  const methodMapped = all.filter((m) => m.type === "payment_method").length;

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const setupTs = conn.setup_completed_at ? Date.parse(conn.setup_completed_at) : null;
  const dryRunOld = !!(conn.dry_run_mode && setupTs !== null && setupTs <= sevenDaysAgo);

  return NextResponse.json({
    items: [
      { key: "cpa_cleanup_confirmed", label: "CPA has completed QB cleanup", checked: conn.cpa_cleanup_confirmed, manual: true },
      { key: "damage_mappings", label: "Damage type → class mappings complete", checked: damageMapped > 0 && damageMapped >= (damageTypes?.length ?? 0), manual: false },
      { key: "method_mappings", label: "Payment method → deposit account mappings complete", checked: methodMapped >= knownMethods.length, manual: false },
      { key: "dry_run_7_days", label: "Dry run active for 7+ days", checked: dryRunOld, manual: false },
      { key: "dry_run_review_confirmed", label: "Would-have-synced log reviewed", checked: conn.dry_run_review_confirmed, manual: true },
    ],
  });
}

export async function PATCH(request: Request) {
  const supabase = createApiClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as {
    cpa_cleanup_confirmed?: boolean;
    dry_run_review_confirmed?: boolean;
  } | null;
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const service = createServiceClient();
  const patch: Record<string, unknown> = {};
  if (typeof body.cpa_cleanup_confirmed === "boolean") patch.cpa_cleanup_confirmed = body.cpa_cleanup_confirmed;
  if (typeof body.dry_run_review_confirmed === "boolean") patch.dry_run_review_confirmed = body.dry_run_review_confirmed;

  const { data: conn } = await service.from("qb_connection").select("id").eq("is_active", true).maybeSingle<{ id: string }>();
  if (!conn) return NextResponse.json({ error: "no active connection" }, { status: 404 });

  const { error } = await service.from("qb_connection").update(patch).eq("id", conn.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

Note: if the `get_payment_methods` RPC doesn't exist, the fallback array covers the current enum. If the enum expands, update the fallback or add an RPC.

- [ ] **Step 2: Write the checklist component**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

interface ChecklistItem {
  key: string;
  label: string;
  checked: boolean;
  manual: boolean;
}

export default function PreLaunchChecklist() {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/settings/accounting/checklist");
    if (res.ok) {
      const data = (await res.json()) as { items: ChecklistItem[] };
      setItems(data.items);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function toggle(key: string, next: boolean) {
    const res = await fetch("/api/settings/accounting/checklist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: next }),
    });
    if (!res.ok) {
      toast.error("Update failed");
      return;
    }
    await refresh();
  }

  if (loading) {
    return (
      <div className="py-6 text-center text-muted-foreground">
        <Loader2 className="animate-spin mx-auto" size={18} />
      </div>
    );
  }

  return (
    <section className="bg-card border border-border rounded-xl p-5 space-y-3">
      <div>
        <h2 className="font-semibold">Pre-launch checklist</h2>
        <p className="text-sm text-muted-foreground">
          Review these before turning off dry run. Non-blocking — they're a moment of reflection.
        </p>
      </div>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.key} className="flex items-start gap-3 text-sm">
            {it.manual ? (
              <input
                type="checkbox"
                checked={it.checked}
                onChange={(e) => toggle(it.key, e.target.checked)}
                className="mt-0.5"
              />
            ) : it.checked ? (
              <Check size={16} className="text-green-600 mt-0.5" />
            ) : (
              <X size={16} className="text-red-500 mt-0.5" />
            )}
            <span className={it.checked ? "text-foreground" : "text-muted-foreground"}>
              {it.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Mount the checklist in `/settings/accounting`**

Open `src/app/settings/accounting/page.tsx`, find the section just above the dry-run toggle control, and insert:

```tsx
import PreLaunchChecklist from "@/components/accounting/pre-launch-checklist";
// ... inside the component, above the dry-run toggle:
<PreLaunchChecklist />
```

If the current settings page is a server component that delegates to a client child, mount `PreLaunchChecklist` inside the client child.

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/accounting/pre-launch-checklist.tsx src/app/api/settings/accounting/checklist/route.ts src/app/settings/accounting/page.tsx
git commit -m "feat(16d): pre-launch checklist on /settings/accounting"
```

---

## Task 28: Stripe webhook stub

**Files:**
- Create: `src/app/api/stripe/webhooks/route.ts`

- [ ] **Step 1: Write the stub**

```ts
// POST /api/stripe/webhooks — Stripe event receiver.
//
// 16d scope: verify signature with STRIPE_WEBHOOK_SECRET, log recognized
// events, return 200 for everything. No DB writes.
//
// TODO(build-17): On payment_intent.succeeded, look up the invoice by
// event.data.object.metadata.invoice_id, insert a platform payment row,
// and let the existing DB trigger enqueue the QB sync. All plumbing is
// already in place — this is the only file Build 17 needs to edit.

import { NextResponse } from "next/server";
import crypto from "node:crypto";

const TOLERANCE_SECONDS = 300; // standard Stripe tolerance

function verifyStripeSignature(payload: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k?.trim(), v?.trim()];
    }),
  ) as Record<string, string>;
  const t = Number(parts.t);
  const sig = parts.v1;
  if (!t || !sig) return false;
  if (Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) return false;

  const signed = `${t}.${payload}`;
  const expected = crypto.createHmac("sha256", secret).update(signed).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // No secret configured — return 200 so Stripe stops retrying, but log.
    console.warn("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not configured; stub is inert");
    return NextResponse.json({ ok: true, stub: true });
  }

  const payload = await request.text();
  const sig = request.headers.get("stripe-signature");
  if (!verifyStripeSignature(payload, sig, secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let event: { type?: string; id?: string } = {};
  try {
    event = JSON.parse(payload) as { type?: string; id?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded"
      || event.type === "payment_intent.payment_failed"
      || event.type === "charge.refunded") {
    console.log(`[stripe-webhook] received ${event.type} id=${event.id ?? "-"}`);
  } else {
    console.log(`[stripe-webhook] ignored ${event.type} id=${event.id ?? "-"}`);
  }

  // TODO(build-17): create platform payment row here on payment_intent.succeeded.
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Add `STRIPE_WEBHOOK_SECRET` to env docs**

Check where env vars are documented (`.env.example`, `docs/env.md`, README, or similar). Add `STRIPE_WEBHOOK_SECRET=whsec_...` with a comment: `# Build 16d stub; fully wired in Build 17`.

```bash
ls -la .env.example README.md docs 2>/dev/null | head -5
```

If no `.env.example` exists, skip — the user manages env via Vercel directly per conversation context.

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/stripe/webhooks/route.ts
git commit -m "feat(16d): Stripe webhook stub (signature verify + logging) for Build 17"
```

---

## Task 29: Final verification

**Files:** None.

- [ ] **Step 1: Full tsc sweep**

```bash
npx tsc --noEmit
```

Expected: 0 errors. If errors appear, fix in the relevant task-owning file and amend/new-commit. Do NOT mass-suppress.

- [ ] **Step 2: Manual preview smoke**

Start dev server (if not already).

Flow 1 — invoice draft → send → QB (dry-run):
1. `/jobs/<existing-job>` → Financials tab → Create invoice.
2. Add a line, enter qty 1, price 500, tax rate 0.
3. Save draft — verify redirect to detail page with Draft pill.
4. Click Send Invoice → compose modal opens with PDF attachment pre-populated, subject + body filled from settings.
5. Send (or cancel and repeat to verify). After send, status should flip to Sent.
6. Open `/accounting` → QB sync tab → confirm a queued `invoice` row appears (if a QB connection is set up) or that the Send status change worked otherwise.

Flow 2 — record payment:
1. On the sent invoice, click Record payment.
2. Enter $500, method Check, source Insurance, submit.
3. Toast confirms. Invoice status auto-updates to Paid (via trigger).
4. Sync tab shows a queued `payment` row.

Flow 3 — void:
1. On a sent invoice with NO payments, click Void.
2. Confirm dialog. Invoice renders with strikethrough + Voided pill.
3. Sync tab shows a queued `invoice` row with action `void`.

Flow 4 — sync log + fix modal:
1. `/accounting/sync-log` with entity filter = invoice, status = queued.
2. Back on sync tab, Clear old logs button works (confirms prompt, toast).
3. Induce a failure: temporarily break a mapping, run Sync now, open Fix modal on the failed row. Verify the right classification panel shows.

- [ ] **Step 3: Verify cron wiring (manual)**

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<preview-deploy-url>/api/qb/sync-scheduled
```

Expected: 200 with a JSON body containing `ok:true, processed, synced, …`.

If `CRON_SECRET` isn't in your shell, grab it from Vercel env and run locally against the preview URL.

- [ ] **Step 4: Final commit + PR prep**

Nothing to commit at this step if all prior commits landed. Push the branch and open a PR per standard practice.

```bash
git push -u origin claude/clever-elgamal-08f352
```

Then open a PR titled `feat(16d): invoice & payment sync`.

---

## Spec coverage self-check

Cross-reference vs. spec `docs/superpowers/specs/2026-04-19-build-16d-invoice-payment-sync-design.md`:

- ✅ Invoice columns + line items table + voided status — Task 2
- ✅ Payment columns (qb + stripe) — Task 2
- ✅ qb_sync_log `void` action — Task 2
- ✅ invoice_email_settings singleton — Task 2
- ✅ qb_connection checklist columns — Task 2
- ✅ Advisory lock RPCs — Task 2
- ✅ Invoice status auto-transition trigger — Task 2
- ✅ DB triggers on invoices/line_items/payments — Task 2
- ✅ QB types extended — Task 4
- ✅ QB client (invoice + payment + void + delete) — Task 5
- ✅ Invoice sync module — Task 6
- ✅ Payment sync module — Task 7
- ✅ Processor (lock + dispatch + backoff 5/25/120/600/1440 + throttle override) — Task 8
- ✅ sync-scheduled / sync-now surface already_running — Task 9
- ✅ Sync log admin endpoints (mark-synced + cleanup) — Task 10
- ✅ Invoice list + create API — Task 11
- ✅ Invoice detail/patch/delete with status gating — Task 12
- ✅ Send / mark-sent / void routes — Task 13
- ✅ PDF (document + generator + route) — Task 14
- ✅ Payment routes — Task 15
- ✅ Invoice email settings (API + page) — Task 16
- ✅ ComposeEmail defaultAttachments — Task 17
- ✅ Invoice shared UI — Task 18
- ✅ Invoice list page — Task 19
- ✅ Invoice new flow — Task 20
- ✅ Invoice detail (all status-gated actions, send flow, void, record payment hook) — Task 21
- ✅ Record payment modal — Task 22
- ✅ Job Financials tab hooks — Task 23
- ✅ Fix modal extended — Task 24
- ✅ Sync tab filters + cleanup — Task 25
- ✅ Sync log page entity filter — Task 26
- ✅ Pre-launch checklist — Task 27
- ✅ Stripe stub — Task 28
- ✅ Final verification — Task 29

Known deferrals (called out in spec):
- 5-min cron awaits Vercel plan upgrade.
- Non-US tax code mappings.
- Line-item-level tax.
- Contract → invoice auto-creation.
- Full Stripe payment flow (Build 17).






