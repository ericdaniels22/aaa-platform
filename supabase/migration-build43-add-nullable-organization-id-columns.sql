-- Build 18a (build43) — Add nullable organization_id columns to every
-- bucket-A (direct tenant), bucket-B (child-of-tenant), and bucket-D
-- (global with optional org override) table.
--
-- Purpose:   Stage the column so build44 can backfill values and build45
--            can add NOT NULL + FK. In PG17, adding a nullable column with
--            no default is a metadata-only change (milliseconds even on the
--            608-row `emails` table).
-- Depends on: build42 (organizations table exists — FK comes in build45).
-- Revert:    ALTER TABLE ... DROP COLUMN organization_id per table. No data
--            lost. See -- ROLLBACK --- block at bottom.

-- ---------------------------------------------------------------------------
-- Bucket A — direct tenant ownership (31 tables)
-- ---------------------------------------------------------------------------
alter table public.contacts                  add column if not exists organization_id uuid;
alter table public.jobs                      add column if not exists organization_id uuid;
alter table public.invoices                  add column if not exists organization_id uuid;
alter table public.payments                  add column if not exists organization_id uuid;
alter table public.payment_requests          add column if not exists organization_id uuid;
alter table public.refunds                   add column if not exists organization_id uuid;
alter table public.stripe_events             add column if not exists organization_id uuid;
alter table public.stripe_disputes           add column if not exists organization_id uuid;
alter table public.stripe_connection         add column if not exists organization_id uuid;
alter table public.qb_connection             add column if not exists organization_id uuid;
alter table public.qb_mappings               add column if not exists organization_id uuid;
alter table public.qb_sync_log               add column if not exists organization_id uuid;
alter table public.expenses                  add column if not exists organization_id uuid;
alter table public.vendors                   add column if not exists organization_id uuid;
alter table public.email_accounts            add column if not exists organization_id uuid;
alter table public.contract_templates        add column if not exists organization_id uuid;
alter table public.contracts                 add column if not exists organization_id uuid;
alter table public.contract_email_settings   add column if not exists organization_id uuid;
alter table public.invoice_email_settings    add column if not exists organization_id uuid;
alter table public.payment_email_settings    add column if not exists organization_id uuid;
alter table public.company_settings          add column if not exists organization_id uuid;
alter table public.form_config               add column if not exists organization_id uuid;
alter table public.photos                    add column if not exists organization_id uuid;
alter table public.photo_tags                add column if not exists organization_id uuid;
alter table public.photo_reports             add column if not exists organization_id uuid;
alter table public.photo_report_templates    add column if not exists organization_id uuid;
alter table public.notifications             add column if not exists organization_id uuid;
alter table public.jarvis_conversations      add column if not exists organization_id uuid;
alter table public.jarvis_alerts             add column if not exists organization_id uuid;
alter table public.marketing_assets          add column if not exists organization_id uuid;
alter table public.marketing_drafts          add column if not exists organization_id uuid;

-- ---------------------------------------------------------------------------
-- Bucket B — child-of-tenant with denormalized organization_id (13 tables)
-- ---------------------------------------------------------------------------
alter table public.job_activities            add column if not exists organization_id uuid;
alter table public.job_adjusters             add column if not exists organization_id uuid;
alter table public.job_custom_fields         add column if not exists organization_id uuid;
alter table public.job_files                 add column if not exists organization_id uuid;
alter table public.invoice_line_items        add column if not exists organization_id uuid;
alter table public.line_items                add column if not exists organization_id uuid;
alter table public.emails                    add column if not exists organization_id uuid;
alter table public.email_attachments         add column if not exists organization_id uuid;
alter table public.email_signatures          add column if not exists organization_id uuid;
alter table public.contract_signers          add column if not exists organization_id uuid;
alter table public.contract_events           add column if not exists organization_id uuid;
alter table public.photo_tag_assignments     add column if not exists organization_id uuid;
alter table public.photo_annotations         add column if not exists organization_id uuid;

-- ---------------------------------------------------------------------------
-- Bucket D — global with optional org override (6 tables, column stays
-- nullable — NULL rows are Nookleus-provided defaults)
-- ---------------------------------------------------------------------------
alter table public.expense_categories        add column if not exists organization_id uuid;
alter table public.damage_types              add column if not exists organization_id uuid;
alter table public.job_statuses              add column if not exists organization_id uuid;
alter table public.category_rules            add column if not exists organization_id uuid;
alter table public.knowledge_documents       add column if not exists organization_id uuid;
alter table public.knowledge_chunks          add column if not exists organization_id uuid;

-- ROLLBACK ---
-- alter table public.contacts                  drop column if exists organization_id;
-- alter table public.jobs                      drop column if exists organization_id;
-- alter table public.invoices                  drop column if exists organization_id;
-- alter table public.payments                  drop column if exists organization_id;
-- alter table public.payment_requests          drop column if exists organization_id;
-- alter table public.refunds                   drop column if exists organization_id;
-- alter table public.stripe_events             drop column if exists organization_id;
-- alter table public.stripe_disputes           drop column if exists organization_id;
-- alter table public.stripe_connection         drop column if exists organization_id;
-- alter table public.qb_connection             drop column if exists organization_id;
-- alter table public.qb_mappings               drop column if exists organization_id;
-- alter table public.qb_sync_log               drop column if exists organization_id;
-- alter table public.expenses                  drop column if exists organization_id;
-- alter table public.vendors                   drop column if exists organization_id;
-- alter table public.email_accounts            drop column if exists organization_id;
-- alter table public.contract_templates        drop column if exists organization_id;
-- alter table public.contracts                 drop column if exists organization_id;
-- alter table public.contract_email_settings   drop column if exists organization_id;
-- alter table public.invoice_email_settings    drop column if exists organization_id;
-- alter table public.payment_email_settings    drop column if exists organization_id;
-- alter table public.company_settings          drop column if exists organization_id;
-- alter table public.form_config               drop column if exists organization_id;
-- alter table public.photos                    drop column if exists organization_id;
-- alter table public.photo_tags                drop column if exists organization_id;
-- alter table public.photo_reports             drop column if exists organization_id;
-- alter table public.photo_report_templates    drop column if exists organization_id;
-- alter table public.notifications             drop column if exists organization_id;
-- alter table public.jarvis_conversations      drop column if exists organization_id;
-- alter table public.jarvis_alerts             drop column if exists organization_id;
-- alter table public.marketing_assets          drop column if exists organization_id;
-- alter table public.marketing_drafts          drop column if exists organization_id;
-- alter table public.job_activities            drop column if exists organization_id;
-- alter table public.job_adjusters             drop column if exists organization_id;
-- alter table public.job_custom_fields         drop column if exists organization_id;
-- alter table public.job_files                 drop column if exists organization_id;
-- alter table public.invoice_line_items        drop column if exists organization_id;
-- alter table public.line_items                drop column if exists organization_id;
-- alter table public.emails                    drop column if exists organization_id;
-- alter table public.email_attachments         drop column if exists organization_id;
-- alter table public.email_signatures          drop column if exists organization_id;
-- alter table public.contract_signers          drop column if exists organization_id;
-- alter table public.contract_events           drop column if exists organization_id;
-- alter table public.photo_tag_assignments     drop column if exists organization_id;
-- alter table public.photo_annotations         drop column if exists organization_id;
-- alter table public.expense_categories        drop column if exists organization_id;
-- alter table public.damage_types              drop column if exists organization_id;
-- alter table public.job_statuses              drop column if exists organization_id;
-- alter table public.category_rules            drop column if exists organization_id;
-- alter table public.knowledge_documents       drop column if exists organization_id;
-- alter table public.knowledge_chunks          drop column if exists organization_id;
