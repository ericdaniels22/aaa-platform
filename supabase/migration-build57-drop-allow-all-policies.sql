-- build57: drop every legacy allow-all policy and every transitional_allow_all_*
-- policy from build53. After this migration, only tenant_isolation_* policies
-- and the 18 KEEP custom policies enumerated in plan §3 remain.
--
-- Runs in Session C step 8 — AFTER the hook is enabled (step 3), AFTER the
-- code sweep is deployed (step 6), AFTER post-sweep smoke passes (step 7).
-- This is the migration that flips enforcement on. Any missed call site or
-- uncaught SQL trigger will break here, which is why step 7 must be green
-- before this runs.
--
-- Rollback: supabase/build57-rollback.sql recreates every policy dropped here
-- from the prod definitions captured on 2026-04-23 (Session A prep).
--
-- Exact names enumerated (no patterns) to avoid accidentally dropping
-- tenant_isolation_* or custom-narrow KEEP policies.
--
-- Counts:
--   Section 1: 48 legacy allow-all policies
--   Section 2: 10 transitional_allow_all_* policies from build53
--   Total:     58 DROP POLICY statements

-- === Section 1: 48 legacy allow-all policies ===
DROP POLICY "Allow all on category_rules" ON public.category_rules;
DROP POLICY "Allow all on company_settings" ON public.company_settings;
DROP POLICY "Allow all on contacts" ON public.contacts;
DROP POLICY "Allow all for authenticated users" ON public.contract_email_settings;
DROP POLICY "Allow all for authenticated users" ON public.contract_events;
DROP POLICY "Allow all for authenticated users" ON public.contract_signers;
DROP POLICY "Allow all for authenticated users" ON public.contract_templates;
DROP POLICY "Allow all for authenticated users" ON public.contracts;
DROP POLICY "Allow all on damage_types" ON public.damage_types;
DROP POLICY "Allow all on email_accounts" ON public.email_accounts;
DROP POLICY "Allow all on email_attachments" ON public.email_attachments;
DROP POLICY "Allow all on email_signatures" ON public.email_signatures;
DROP POLICY "Allow all on emails" ON public.emails;
DROP POLICY "Allow all for authenticated users" ON public.expense_categories;
DROP POLICY "Allow all for authenticated users" ON public.expenses;
DROP POLICY "Allow all on form_config" ON public.form_config;
DROP POLICY "Allow all on invoice_line_items" ON public.invoice_line_items;
DROP POLICY "Allow all on invoices" ON public.invoices;
DROP POLICY "Allow all on job_activities" ON public.job_activities;
DROP POLICY "Allow all for authenticated users" ON public.job_adjusters;
DROP POLICY "Allow all on job_custom_fields" ON public.job_custom_fields;
DROP POLICY "Allow all on job_files" ON public.job_files;
DROP POLICY "Allow all on job_statuses" ON public.job_statuses;
DROP POLICY "Allow all on jobs" ON public.jobs;
DROP POLICY "Allow all on line_items" ON public.line_items;
DROP POLICY "Allow all on notification_preferences" ON public.notification_preferences;
DROP POLICY "Allow all on notifications" ON public.notifications;
DROP POLICY orgs_service_write ON public.organizations;
DROP POLICY "Allow all on payment_email_settings" ON public.payment_email_settings;
DROP POLICY "Allow all on payment_requests" ON public.payment_requests;
DROP POLICY "Allow all on payments" ON public.payments;
DROP POLICY "Allow all on photo_annotations" ON public.photo_annotations;
DROP POLICY "Allow all on photo_report_templates" ON public.photo_report_templates;
DROP POLICY "Allow all on photo_reports" ON public.photo_reports;
DROP POLICY "Allow all on photo_tag_assignments" ON public.photo_tag_assignments;
DROP POLICY "Allow all on photo_tags" ON public.photo_tags;
DROP POLICY "Allow all on photos" ON public.photos;
DROP POLICY "qb_mappings read" ON public.qb_mappings;
DROP POLICY "qb_sync_log read" ON public.qb_sync_log;
DROP POLICY "Allow all on refunds" ON public.refunds;
DROP POLICY "Allow all on stripe_connection" ON public.stripe_connection;
DROP POLICY "Allow all on stripe_disputes" ON public.stripe_disputes;
DROP POLICY "Allow all on stripe_events" ON public.stripe_events;
DROP POLICY user_orgs_service_write ON public.user_organizations;
DROP POLICY "Service role full access on user_permissions" ON public.user_permissions;
DROP POLICY "Service role full access on user_profiles" ON public.user_profiles;
DROP POLICY "Users can view all profiles" ON public.user_profiles;
DROP POLICY "Allow all for authenticated users" ON public.vendors;

-- === Section 2: 10 transitional_allow_all_* policies from build53 ===
DROP POLICY transitional_allow_all_invoice_email_settings ON public.invoice_email_settings;
DROP POLICY transitional_allow_all_jarvis_alerts ON public.jarvis_alerts;
DROP POLICY transitional_allow_all_jarvis_conversations ON public.jarvis_conversations;
DROP POLICY transitional_allow_all_knowledge_chunks ON public.knowledge_chunks;
DROP POLICY transitional_allow_all_knowledge_documents ON public.knowledge_documents;
DROP POLICY transitional_allow_all_marketing_assets ON public.marketing_assets;
DROP POLICY transitional_allow_all_marketing_drafts ON public.marketing_drafts;
DROP POLICY transitional_allow_all_qb_connection ON public.qb_connection;
DROP POLICY transitional_allow_all_qb_mappings ON public.qb_mappings;
DROP POLICY transitional_allow_all_qb_sync_log ON public.qb_sync_log;

-- ROLLBACK ---
-- See supabase/build57-rollback.sql for the full set of CREATE POLICY
-- statements that recreate every policy dropped by this migration.
