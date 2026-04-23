-- build54: patch every trg_qb_enqueue_* trigger function to set organization_id
-- when inserting into qb_sync_log. build45 added NOT NULL to
-- qb_sync_log.organization_id, but the trigger functions (created in build36/37
-- for QuickBooks sync) were not updated at the same time. The code sweep in
-- the main 18a work reviewed application code but not SQL trigger functions.
--
-- Source of organization_id per trigger:
--   job insert/update  → NEW.organization_id
--   contact update     → NEW.organization_id
--   invoice update     → NEW.organization_id (or joined parent row)
--   line item change   → inv.organization_id (already SELECTed)
--   payment insert     → NEW.organization_id
--   payment update     → NEW.organization_id
--   payment delete     → OLD.organization_id
--
-- Applied directly to prod via Supabase MCP on 2026-04-22 as a follow-up
-- to build53.

CREATE OR REPLACE FUNCTION public.trg_qb_enqueue_contact_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  conn qb_connection;
BEGIN
  IF NEW.qb_customer_id IS NULL THEN RETURN NEW; END IF;

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
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status, organization_id)
    VALUES ('customer', NEW.id, 'update', 'queued', NEW.organization_id);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_qb_enqueue_job_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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

  IF contact_row.qb_customer_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM qb_sync_log
       WHERE entity_type = 'customer'
         AND entity_id = contact_row.id
         AND status = 'queued'
     )
  THEN
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status, organization_id)
    VALUES ('customer', contact_row.id, 'create', 'queued', contact_row.organization_id)
    RETURNING id INTO customer_log_id;
  ELSE
    SELECT id INTO customer_log_id
      FROM qb_sync_log
      WHERE entity_type = 'customer'
        AND entity_id = contact_row.id
        AND status = 'queued'
      ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM qb_sync_log
    WHERE entity_type = 'sub_customer'
      AND entity_id = NEW.id
      AND status = 'queued'
  ) THEN
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status, depends_on_log_id, organization_id)
    VALUES ('sub_customer', NEW.id, 'create', 'queued', customer_log_id, NEW.organization_id);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_qb_enqueue_job_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  conn qb_connection;
BEGIN
  IF NEW.qb_subcustomer_id IS NULL THEN RETURN NEW; END IF;

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
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status, organization_id)
    VALUES ('sub_customer', NEW.id, 'update', 'queued', NEW.organization_id);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_qb_enqueue_invoice_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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

  IF OLD.status = 'draft' AND NEW.status = 'sent' THEN
    SELECT * INTO job_row FROM jobs WHERE id = NEW.job_id;
    IF job_row.id IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO contact_row FROM contacts WHERE id = job_row.contact_id;
    IF contact_row.id IS NULL THEN RETURN NEW; END IF;

    IF contact_row.qb_customer_id IS NULL THEN
      SELECT id INTO customer_log_id FROM qb_sync_log
        WHERE entity_type = 'customer' AND entity_id = contact_row.id
          AND status IN ('queued', 'failed') ORDER BY created_at DESC LIMIT 1;
      IF customer_log_id IS NULL THEN
        INSERT INTO qb_sync_log (entity_type, entity_id, action, status, organization_id)
          VALUES ('customer', contact_row.id, 'create', 'queued', contact_row.organization_id)
          RETURNING id INTO customer_log_id;
      END IF;
    END IF;

    IF job_row.qb_subcustomer_id IS NULL THEN
      SELECT id INTO sub_log_id FROM qb_sync_log
        WHERE entity_type = 'sub_customer' AND entity_id = job_row.id
          AND status IN ('queued', 'failed') ORDER BY created_at DESC LIMIT 1;
      IF sub_log_id IS NULL THEN
        INSERT INTO qb_sync_log (entity_type, entity_id, action, status, depends_on_log_id, organization_id)
          VALUES ('sub_customer', job_row.id, 'create', 'queued', customer_log_id, job_row.organization_id)
          RETURNING id INTO sub_log_id;
      END IF;
    END IF;

    dep_id := sub_log_id;

    INSERT INTO qb_sync_log (entity_type, entity_id, action, status, depends_on_log_id, organization_id)
      VALUES ('invoice', NEW.id, 'create', 'queued', dep_id, NEW.organization_id);
    RETURN NEW;
  END IF;

  IF OLD.status <> 'voided' AND NEW.status = 'voided' THEN
    DELETE FROM qb_sync_log
      WHERE entity_type = 'invoice' AND entity_id = NEW.id
        AND action = 'create' AND status = 'queued';
    IF NEW.qb_invoice_id IS NOT NULL THEN
      INSERT INTO qb_sync_log (entity_type, entity_id, action, status, organization_id)
        VALUES ('invoice', NEW.id, 'void', 'queued', NEW.organization_id);
    END IF;
    RETURN NEW;
  END IF;

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
      INSERT INTO qb_sync_log (entity_type, entity_id, action, status, organization_id)
        VALUES ('invoice', NEW.id, 'update', 'queued', NEW.organization_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_qb_enqueue_line_item_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status, organization_id)
      VALUES ('invoice', inv.id, 'update', 'queued', inv.organization_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_qb_enqueue_payment_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  conn qb_connection;
  inv invoices;
  dep_id uuid;
BEGIN
  conn := qb_get_active_connection();
  IF conn.id IS NULL THEN RETURN NEW; END IF;
  IF NEW.created_at < conn.sync_start_date::timestamptz THEN RETURN NEW; END IF;

  IF NEW.invoice_id IS NOT NULL THEN
    SELECT * INTO inv FROM invoices WHERE id = NEW.invoice_id;
    IF inv.id IS NOT NULL AND inv.qb_invoice_id IS NULL THEN
      SELECT id INTO dep_id FROM qb_sync_log
        WHERE entity_type = 'invoice' AND entity_id = inv.id
          AND status IN ('queued', 'failed') ORDER BY created_at DESC LIMIT 1;
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM qb_sync_log
    WHERE entity_type = 'payment' AND entity_id = NEW.id AND status = 'queued'
  ) THEN
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status, depends_on_log_id, organization_id)
      VALUES ('payment', NEW.id, 'create', 'queued', dep_id, NEW.organization_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_qb_enqueue_payment_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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
    INSERT INTO qb_sync_log (entity_type, entity_id, action, status, organization_id)
      VALUES ('payment', NEW.id, 'update', 'queued', NEW.organization_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_qb_enqueue_payment_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.qb_payment_id IS NULL THEN RETURN OLD; END IF;
  INSERT INTO qb_sync_log (entity_type, entity_id, action, status, payload, qb_entity_id, organization_id)
    VALUES (
      'payment', OLD.id, 'delete', 'queued',
      jsonb_build_object(
        'qb_payment_id', OLD.qb_payment_id,
        'amount', OLD.amount,
        'invoice_id', OLD.invoice_id
      ),
      OLD.qb_payment_id,
      OLD.organization_id
    );
  RETURN OLD;
END;
$function$;

-- ROLLBACK ---
-- Restoring the pre-build54 state means reverting each function to its
-- pre-build42 body (without organization_id in any INSERT). Because the
-- functions are CREATE OR REPLACE, reverting requires the prior bodies
-- which are preserved in migration-build37-quickbooks.sql for the QB
-- triggers originating there. If revert is ever needed, use pg_dump
-- against the last pre-build54 state rather than manually reassembling.
