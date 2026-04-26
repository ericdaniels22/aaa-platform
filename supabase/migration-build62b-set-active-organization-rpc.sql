-- build62b: public.set_active_organization(p_org_id uuid).
--
-- SECURITY DEFINER RPC the workspace switcher UI (src/lib/supabase/
-- switch-workspace.ts) calls to flip user_organizations.is_active flags
-- for the calling user.
--
-- Validates membership before flipping. The two UPDATE statements are
-- ordered (clear-then-set) so the partial unique index
-- user_orgs_one_active_per_user (build62) is never transiently violated.
--
-- Why SECURITY DEFINER:
--   tenant_isolation policies on user_organizations don't allow a user to
--   UPDATE their own membership rows. SECURITY DEFINER bypasses RLS for
--   this narrow operation, with the explicit membership-check at the top
--   of the function as the sole gate.
--
-- Why public schema (not nookleus, as plan §5.2 originally named it):
--   PostgREST exposes only the schemas listed in pgrst.db_schemas (default:
--   public). Existing client-callable RPCs in this codebase live in public
--   (e.g. mark_contract_expired, called from sign/[token]/page.tsx). Naming
--   this nookleus.set_active_organization would either require widening the
--   PostgREST schema config or fail with a "function not found" error from
--   the client. Recorded in build-18c/session-a-handoff.md §6.1 as a Rule C
--   minor.
--
-- Returns void on success. Raises 'not_authenticated' if auth.uid() is
-- null (no session). Raises 'not_a_member' if the user isn't a member of
-- p_org_id. Both surface to the client as a Postgres exception, which the
-- switcher UI displays as a toast.

CREATE OR REPLACE FUNCTION public.set_active_organization(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid;
  v_is_member boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.user_organizations
     WHERE user_id = v_user_id
       AND organization_id = p_org_id
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE = '42501';
  END IF;

  -- Clear any other active flag for this user. The
  -- "AND organization_id <> p_org_id" predicate keeps this idempotent: if
  -- the target org is already active, this is a no-op.
  UPDATE public.user_organizations
     SET is_active = false
   WHERE user_id = v_user_id
     AND is_active = true
     AND organization_id <> p_org_id;

  -- Set the target org active. The "AND is_active = false" predicate keeps
  -- this idempotent and keeps the UPDATE row count meaningful for callers
  -- that want to know whether anything changed.
  UPDATE public.user_organizations
     SET is_active = true
   WHERE user_id = v_user_id
     AND organization_id = p_org_id
     AND is_active = false;
END;
$function$;

-- Grant EXECUTE to authenticated only. anon and public have no business
-- calling this. service_role can bypass directly via SQL if needed.
REVOKE EXECUTE ON FUNCTION public.set_active_organization(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.set_active_organization(uuid) TO authenticated;

-- ROLLBACK ---
-- See supabase/build62b-rollback.sql.
