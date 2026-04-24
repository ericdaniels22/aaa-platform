-- build60: allow supabase_auth_admin to SELECT from user_organizations so the
-- custom_access_token_hook can inject app_metadata.active_organization_id.
--
-- Root cause discovered mid-Session-C (§12.5 Rule C material finding,
-- Eric-approved 2026-04-24):
--   * supabase_auth_admin on hosted Supabase has rolbypassrls = false.
--   * public.user_organizations has RLS enabled.
--   * Existing policies grant access only to {authenticated} or {service_role}.
--   * When Supabase Auth runs the hook, the function executes as
--     supabase_auth_admin. The SELECT returns zero rows under RLS.
--   * Our function's "IF v_org_id IS NULL THEN RETURN event" path then returns
--     the event unchanged, silently producing a JWT without the claim.
--
-- Fix: a narrow SELECT-only policy on user_organizations for
-- supabase_auth_admin. This mirrors Supabase's own recommended pattern in
-- the custom_access_token_hook docs.
--
-- Why not SECURITY DEFINER on the function? The Supabase docs specifically
-- recommend the policy approach; SECURITY DEFINER changes the run-as-owner
-- semantics and would make the RLS story opaque.
--
-- Why not GRANT BYPASSRLS? Not possible on hosted Supabase (requires superuser,
-- which only the postgres role has).
--
-- This policy is narrow and low-risk:
--   * SELECT only (no INSERT/UPDATE/DELETE).
--   * Restricted to supabase_auth_admin, which is an internal trusted role.
--   * authenticated / anon / service_role cannot assume supabase_auth_admin.
--   * Does not relax tenant isolation for end users.

CREATE POLICY auth_admin_read_user_organizations
  ON public.user_organizations
  FOR SELECT
  TO supabase_auth_admin
  USING (true);

-- ROLLBACK ---
-- DROP POLICY auth_admin_read_user_organizations ON public.user_organizations;
--
-- Dropping this policy restores the pre-build60 state: supabase_auth_admin's
-- SELECT against user_organizations returns zero rows (because no other
-- policy matches it and RLS is enabled), which in turn makes the
-- custom_access_token_hook silently return events without an
-- active_organization_id claim. In other words: dropping this policy
-- effectively disables the hook's functionality. Pair with disabling the
-- hook in the dashboard if you want a clean rollback.
