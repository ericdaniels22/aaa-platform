-- build53: transitional allow-all policies for tables that historically had
-- SELECT-only or admin-only policies before 18a. Without these, 18a's
-- tenant_isolation_* policies block INSERT because they require the JWT claim
-- nookleus.active_organization_id() which is not populated until the Access
-- Token Hook is enabled in 18b.
--
-- These policies are dropped in 18b alongside all other transitional allow-all
-- policies when RLS enforcement flips on.
--
-- Applied directly to prod via Supabase MCP on 2026-04-22 as a follow-up
-- to build52. Not included in the original build49 because the original
-- allow-all policies on these tables were not FOR ALL — they were narrower
-- (e.g. qb_sync_log had only a SELECT policy). This patch closes the gap.

CREATE POLICY transitional_allow_all_qb_sync_log
  ON public.qb_sync_log FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY transitional_allow_all_qb_connection
  ON public.qb_connection FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY transitional_allow_all_qb_mappings
  ON public.qb_mappings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

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

-- ROLLBACK ---
-- DROP POLICY transitional_allow_all_qb_sync_log ON public.qb_sync_log;
-- DROP POLICY transitional_allow_all_qb_connection ON public.qb_connection;
-- DROP POLICY transitional_allow_all_qb_mappings ON public.qb_mappings;
-- DROP POLICY transitional_allow_all_invoice_email_settings ON public.invoice_email_settings;
-- DROP POLICY transitional_allow_all_jarvis_alerts ON public.jarvis_alerts;
-- DROP POLICY transitional_allow_all_jarvis_conversations ON public.jarvis_conversations;
-- DROP POLICY transitional_allow_all_knowledge_chunks ON public.knowledge_chunks;
-- DROP POLICY transitional_allow_all_knowledge_documents ON public.knowledge_documents;
-- DROP POLICY transitional_allow_all_marketing_assets ON public.marketing_assets;
-- DROP POLICY transitional_allow_all_marketing_drafts ON public.marketing_drafts;
