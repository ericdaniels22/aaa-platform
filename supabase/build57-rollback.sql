-- build57 rollback — restore all 58 policies dropped in build57.
--
-- NOT a migration. Not applied in sequence. This is an emergency recovery
-- artifact for Session C step 9: if post-drop smoke fails and forward-fix
-- within 15 minutes isn't feasible, apply this file to restore RLS to its
-- pre-build57 state.
--
-- Apply via: psql "<conn>" -f supabase/build57-rollback.sql
--
-- Every CREATE POLICY below was serialized from prod pg_policies on
-- 2026-04-23 (Session A prep). If prod has drifted since (new custom
-- policies added, names renamed), review before applying.
--
-- Counts:
--   Section 1: 48 legacy allow-all policies
--   Section 2: 10 transitional_allow_all_* patches from build53
--   Total:     58 CREATE POLICY statements

-- === Section 1: Legacy allow-all policies (48) ===
CREATE POLICY "Allow all on category_rules" ON public.category_rules
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on company_settings" ON public.company_settings
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on contacts" ON public.contacts
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.contract_email_settings
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.contract_events
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.contract_signers
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.contract_templates
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.contracts
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on damage_types" ON public.damage_types
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on email_accounts" ON public.email_accounts
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on email_attachments" ON public.email_attachments
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on email_signatures" ON public.email_signatures
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on emails" ON public.emails
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.expense_categories
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.expenses
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on form_config" ON public.form_config
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on invoice_line_items" ON public.invoice_line_items
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on invoices" ON public.invoices
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on job_activities" ON public.job_activities
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.job_adjusters
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on job_custom_fields" ON public.job_custom_fields
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on job_files" ON public.job_files
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on job_statuses" ON public.job_statuses
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on jobs" ON public.jobs
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on line_items" ON public.line_items
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on notification_preferences" ON public.notification_preferences
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on notifications" ON public.notifications
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY orgs_service_write ON public.organizations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on payment_email_settings" ON public.payment_email_settings
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on payment_requests" ON public.payment_requests
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on payments" ON public.payments
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on photo_annotations" ON public.photo_annotations
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on photo_report_templates" ON public.photo_report_templates
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on photo_reports" ON public.photo_reports
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on photo_tag_assignments" ON public.photo_tag_assignments
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on photo_tags" ON public.photo_tags
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on photos" ON public.photos
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "qb_mappings read" ON public.qb_mappings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "qb_sync_log read" ON public.qb_sync_log
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow all on refunds" ON public.refunds
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on stripe_connection" ON public.stripe_connection
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on stripe_disputes" ON public.stripe_disputes
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on stripe_events" ON public.stripe_events
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY user_orgs_service_write ON public.user_organizations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on user_permissions" ON public.user_permissions
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on user_profiles" ON public.user_profiles
  FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users can view all profiles" ON public.user_profiles
  FOR SELECT TO public USING (true);
CREATE POLICY "Allow all for authenticated users" ON public.vendors
  FOR ALL TO public USING (true) WITH CHECK (true);

-- === Section 2: Transitional patches (10) ===
CREATE POLICY transitional_allow_all_invoice_email_settings
  ON public.invoice_email_settings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY transitional_allow_all_jarvis_alerts
  ON public.jarvis_alerts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY transitional_allow_all_jarvis_conversations
  ON public.jarvis_conversations FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY transitional_allow_all_knowledge_chunks
  ON public.knowledge_chunks FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY transitional_allow_all_knowledge_documents
  ON public.knowledge_documents FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY transitional_allow_all_marketing_assets
  ON public.marketing_assets FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY transitional_allow_all_marketing_drafts
  ON public.marketing_drafts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY transitional_allow_all_qb_connection
  ON public.qb_connection FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY transitional_allow_all_qb_mappings
  ON public.qb_mappings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY transitional_allow_all_qb_sync_log
  ON public.qb_sync_log FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
