-- Build 18a (build46) — Replace global UNIQUE indexes with org-scoped
-- composite UNIQUE indexes. Add new per-tenant singleton UNIQUEs.
--
-- Purpose:   Preserves uniqueness guarantees while allowing the same
--            identifier (e.g. invoice_number, company_settings.key,
--            damage_type name) to coexist across tenants.
-- Depends on: build45 (organization_id is NOT NULL on bucket-A/B tables).
-- Revert:    drop the new indexes/constraints, recreate the old global
--            UNIQUEs. See -- ROLLBACK --- block at bottom.
--
-- Note on CONCURRENTLY: not used. Row counts are trivial (≤608 on emails,
-- the largest table) and ACCESS EXCLUSIVE locks are held for milliseconds.
-- CONCURRENTLY can't run inside the migration transaction block anyway.

-- ---------------------------------------------------------------------------
-- 1. jobs.job_number — per-org uniqueness.
-- ---------------------------------------------------------------------------
create unique index jobs_org_job_number_key on public.jobs(organization_id, job_number);
alter table public.jobs drop constraint if exists jobs_job_number_key;

-- ---------------------------------------------------------------------------
-- 2. invoices.invoice_number — per-org uniqueness.
-- ---------------------------------------------------------------------------
create unique index invoices_org_invoice_number_key on public.invoices(organization_id, invoice_number);
alter table public.invoices drop constraint if exists invoices_invoice_number_key;

-- ---------------------------------------------------------------------------
-- 3. payments.stripe_payment_intent_id — partial unique scoped to org.
-- ---------------------------------------------------------------------------
create unique index payments_org_stripe_payment_intent_key
  on public.payments(organization_id, stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
drop index if exists public.idx_payments_stripe_payment_intent_unique;

-- ---------------------------------------------------------------------------
-- 4. payment_requests.link_token — per-org uniqueness.
-- ---------------------------------------------------------------------------
create unique index payment_requests_org_link_token_key on public.payment_requests(organization_id, link_token);
alter table public.payment_requests drop constraint if exists payment_requests_link_token_key;

-- ---------------------------------------------------------------------------
-- 5. refunds.stripe_refund_id — per-org uniqueness.
-- ---------------------------------------------------------------------------
create unique index refunds_org_stripe_refund_id_key on public.refunds(organization_id, stripe_refund_id);
alter table public.refunds drop constraint if exists refunds_stripe_refund_id_key;

-- ---------------------------------------------------------------------------
-- 6. stripe_events.stripe_event_id — per-org uniqueness.
-- ---------------------------------------------------------------------------
create unique index stripe_events_org_stripe_event_id_key on public.stripe_events(organization_id, stripe_event_id);
alter table public.stripe_events drop constraint if exists stripe_events_stripe_event_id_key;

-- ---------------------------------------------------------------------------
-- 7. stripe_disputes.stripe_dispute_id — per-org uniqueness.
-- ---------------------------------------------------------------------------
create unique index stripe_disputes_org_stripe_dispute_id_key on public.stripe_disputes(organization_id, stripe_dispute_id);
alter table public.stripe_disputes drop constraint if exists stripe_disputes_stripe_dispute_id_key;

-- ---------------------------------------------------------------------------
-- 8. contracts.link_token — per-org uniqueness.
-- ---------------------------------------------------------------------------
create unique index contracts_org_link_token_key on public.contracts(organization_id, link_token);
alter table public.contracts drop constraint if exists contracts_link_token_key;

-- ---------------------------------------------------------------------------
-- 9. company_settings.key — per-org uniqueness.
-- ---------------------------------------------------------------------------
create unique index company_settings_org_key_key on public.company_settings(organization_id, key);
alter table public.company_settings drop constraint if exists company_settings_key_key;

-- ---------------------------------------------------------------------------
-- 10. qb_mappings (type, platform_value) — scoped to org.
-- ---------------------------------------------------------------------------
create unique index qb_mappings_org_type_value_key on public.qb_mappings(organization_id, type, platform_value);
alter table public.qb_mappings drop constraint if exists qb_mappings_type_platform_value_key;

-- ---------------------------------------------------------------------------
-- 11. photo_tags.name — per-org uniqueness.
-- ---------------------------------------------------------------------------
create unique index photo_tags_org_name_key on public.photo_tags(organization_id, name);
alter table public.photo_tags drop constraint if exists photo_tags_name_key;

-- ---------------------------------------------------------------------------
-- 12. emails dedup — per-org uniqueness on (message_id, account_id, folder).
-- ---------------------------------------------------------------------------
create unique index emails_org_dedup_key on public.emails(organization_id, message_id, account_id, folder);
drop index if exists public.idx_emails_dedup;

-- ---------------------------------------------------------------------------
-- 13. contract_templates — add NEW composite UNIQUE on (org, name). No prior
--     UNIQUE existed on name alone (per plan §1.2 note).
-- ---------------------------------------------------------------------------
create unique index contract_templates_org_name_key on public.contract_templates(organization_id, name);

-- ---------------------------------------------------------------------------
-- 14. Per-tenant singleton UNIQUEs — ADD (no prior UNIQUE to drop).
--     These enforce "one row per org" for tables that were implicit singletons.
-- ---------------------------------------------------------------------------
create unique index stripe_connection_org_key        on public.stripe_connection(organization_id);
create unique index qb_connection_org_key            on public.qb_connection(organization_id);
create unique index contract_email_settings_org_key  on public.contract_email_settings(organization_id);
create unique index invoice_email_settings_org_key   on public.invoice_email_settings(organization_id);
create unique index payment_email_settings_org_key   on public.payment_email_settings(organization_id);
create unique index form_config_org_key              on public.form_config(organization_id);

-- ---------------------------------------------------------------------------
-- 15. Bucket-D split-partial-unique pattern — defaults unique globally,
--     per-tenant customizations unique within their own org.
-- ---------------------------------------------------------------------------

-- damage_types
create unique index damage_types_name_default_key on public.damage_types(name) where organization_id is null;
create unique index damage_types_org_name_key     on public.damage_types(organization_id, name) where organization_id is not null;
alter table public.damage_types drop constraint if exists damage_types_name_key;

-- job_statuses
create unique index job_statuses_name_default_key on public.job_statuses(name) where organization_id is null;
create unique index job_statuses_org_name_key     on public.job_statuses(organization_id, name) where organization_id is not null;
alter table public.job_statuses drop constraint if exists job_statuses_name_key;

-- expense_categories
create unique index expense_categories_name_default_key on public.expense_categories(name) where organization_id is null;
create unique index expense_categories_org_name_key     on public.expense_categories(organization_id, name) where organization_id is not null;
alter table public.expense_categories drop constraint if exists expense_categories_name_key;

-- ROLLBACK ---
-- Recreate the global UNIQUEs and drop the org-scoped variants.
-- drop index if exists public.jobs_org_job_number_key;
-- alter table public.jobs add constraint jobs_job_number_key unique (job_number);
-- drop index if exists public.invoices_org_invoice_number_key;
-- alter table public.invoices add constraint invoices_invoice_number_key unique (invoice_number);
-- drop index if exists public.payments_org_stripe_payment_intent_key;
-- create unique index idx_payments_stripe_payment_intent_unique
--   on public.payments(stripe_payment_intent_id) where stripe_payment_intent_id is not null;
-- drop index if exists public.payment_requests_org_link_token_key;
-- alter table public.payment_requests add constraint payment_requests_link_token_key unique (link_token);
-- drop index if exists public.refunds_org_stripe_refund_id_key;
-- alter table public.refunds add constraint refunds_stripe_refund_id_key unique (stripe_refund_id);
-- drop index if exists public.stripe_events_org_stripe_event_id_key;
-- alter table public.stripe_events add constraint stripe_events_stripe_event_id_key unique (stripe_event_id);
-- drop index if exists public.stripe_disputes_org_stripe_dispute_id_key;
-- alter table public.stripe_disputes add constraint stripe_disputes_stripe_dispute_id_key unique (stripe_dispute_id);
-- drop index if exists public.contracts_org_link_token_key;
-- alter table public.contracts add constraint contracts_link_token_key unique (link_token);
-- drop index if exists public.company_settings_org_key_key;
-- alter table public.company_settings add constraint company_settings_key_key unique (key);
-- drop index if exists public.qb_mappings_org_type_value_key;
-- alter table public.qb_mappings add constraint qb_mappings_type_platform_value_key unique (type, platform_value);
-- drop index if exists public.photo_tags_org_name_key;
-- alter table public.photo_tags add constraint photo_tags_name_key unique (name);
-- drop index if exists public.emails_org_dedup_key;
-- create unique index idx_emails_dedup on public.emails(message_id, account_id, folder);
-- drop index if exists public.contract_templates_org_name_key;
-- drop index if exists public.stripe_connection_org_key;
-- drop index if exists public.qb_connection_org_key;
-- drop index if exists public.contract_email_settings_org_key;
-- drop index if exists public.invoice_email_settings_org_key;
-- drop index if exists public.payment_email_settings_org_key;
-- drop index if exists public.form_config_org_key;
-- drop index if exists public.damage_types_name_default_key;
-- drop index if exists public.damage_types_org_name_key;
-- alter table public.damage_types add constraint damage_types_name_key unique (name);
-- drop index if exists public.job_statuses_name_default_key;
-- drop index if exists public.job_statuses_org_name_key;
-- alter table public.job_statuses add constraint job_statuses_name_key unique (name);
-- drop index if exists public.expense_categories_name_default_key;
-- drop index if exists public.expense_categories_org_name_key;
-- alter table public.expense_categories add constraint expense_categories_name_key unique (name);
