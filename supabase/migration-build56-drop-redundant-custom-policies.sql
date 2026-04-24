-- build56: drop 3 custom policies that are redundant with tenant_isolation
-- policies added in 18a. Each of these predates multitenancy and either
-- encodes a tautology (invoice_email_settings_admin) or grants access to
-- all authenticated users irrespective of organization (the knowledge_*
-- "Authenticated users can read" pair). Now that tenant_isolation_* policies
-- enforce org scoping, these custom policies are strictly broader and
-- should be removed.
--
-- Runs in Session C step 2 — before the hook is enabled, after build55.
-- Does not affect behavior today: the transitional_allow_all_* policies
-- (dropped in build57) still permit access. This migration simply removes
-- three policies that would become redundant once enforcement flips on.

DROP POLICY invoice_email_settings_admin ON public.invoice_email_settings;
DROP POLICY "Authenticated users can read knowledge chunks" ON public.knowledge_chunks;
DROP POLICY "Authenticated users can read knowledge documents" ON public.knowledge_documents;

-- ROLLBACK ---
-- Exact definitions captured from prod pg_policies on 2026-04-23 (build18b prep).
--
-- CREATE POLICY invoice_email_settings_admin
--   ON public.invoice_email_settings FOR ALL TO authenticated
--   USING (
--     (organization_id = organization_id) AND (EXISTS (
--       SELECT 1 FROM user_organizations uo
--       WHERE uo.user_id = auth.uid()
--         AND uo.organization_id = invoice_email_settings.organization_id
--         AND uo.role = 'admin'
--     ))
--   )
--   WITH CHECK (
--     (organization_id = organization_id) AND (EXISTS (
--       SELECT 1 FROM user_organizations uo
--       WHERE uo.user_id = auth.uid()
--         AND uo.organization_id = invoice_email_settings.organization_id
--         AND uo.role = 'admin'
--     ))
--   );
--
-- CREATE POLICY "Authenticated users can read knowledge chunks"
--   ON public.knowledge_chunks FOR SELECT TO public
--   USING (auth.role() = 'authenticated');
--
-- CREATE POLICY "Authenticated users can read knowledge documents"
--   ON public.knowledge_documents FOR SELECT TO public
--   USING (auth.role() = 'authenticated');
