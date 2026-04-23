-- build55: create public.custom_access_token_hook(jsonb) for Supabase's
-- access token hook. Reads the user's user_organizations membership and
-- injects app_metadata.active_organization_id into the JWT claims.
--
-- The 18a handoff claimed this function already existed; ground-truth query
-- at the start of 18b showed it did not. This migration creates it for the
-- first time.
--
-- Behavioral contract (per plan §5.1):
--   1. Extract user_id from event->>'user_id' (cast to uuid).
--   2. SELECT organization_id FROM user_organizations WHERE user_id = ?
--      ORDER BY created_at ASC LIMIT 1.
--   3. If a row is found, inject app_metadata.active_organization_id into
--      event->'claims'.
--   4. If no row is found, return the event unmodified.
--   5. On any exception, return the event unmodified (hook is resilient —
--      never blocks login).
--
-- No SECURITY DEFINER: grants are explicit per Supabase docs recommendation.
-- The function runs as supabase_auth_admin, which has EXECUTE on the hook
-- and SELECT on user_organizations but no other privileges.
--
-- Applied via Supabase MCP during Session C step 1 (order of operations §6).
-- This is safe and additive: the function is not called by anything until
-- Eric manually enables it in the dashboard (step 3).

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_claims jsonb;
  v_app_metadata jsonb;
BEGIN
  v_user_id := (event ->> 'user_id')::uuid;

  SELECT organization_id
    INTO v_org_id
    FROM public.user_organizations
    WHERE user_id = v_user_id
    ORDER BY created_at ASC
    LIMIT 1;

  IF v_org_id IS NULL THEN
    RETURN event;
  END IF;

  v_claims := COALESCE(event -> 'claims', '{}'::jsonb);
  v_app_metadata := COALESCE(v_claims -> 'app_metadata', '{}'::jsonb);
  v_app_metadata := v_app_metadata || jsonb_build_object('active_organization_id', v_org_id);
  v_claims := v_claims || jsonb_build_object('app_metadata', v_app_metadata);

  RETURN jsonb_set(event, '{claims}', v_claims, true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN event;
END;
$function$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
GRANT SELECT ON public.user_organizations TO supabase_auth_admin;

-- ROLLBACK ---
-- REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM supabase_auth_admin;
-- REVOKE SELECT ON public.user_organizations FROM supabase_auth_admin;
-- REVOKE USAGE ON SCHEMA public FROM supabase_auth_admin;
-- DROP FUNCTION IF EXISTS public.custom_access_token_hook(jsonb);
--
-- Order matters: revoke EXECUTE before DROP, otherwise the REVOKE line
-- is cosmetic. The schema USAGE and SELECT grants pre-existed this
-- migration on a fresh install only if Supabase's defaults included them;
-- on 18b prod they did not, so this rollback removes them.
