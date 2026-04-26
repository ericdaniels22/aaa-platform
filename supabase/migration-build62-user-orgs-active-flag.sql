-- build62: user_organizations.is_active column + partial unique index +
-- custom_access_token_hook update.
--
-- Adds support for user-selectable active organization. Replaces the prior
-- "first by created_at" hook strategy (build55) with a "preferred via flag"
-- approach:
--   * Each user has at most one is_active=true row across all their
--     memberships, enforced by a partial unique index.
--   * The hook reads the is_active=true membership and injects its
--     organization_id as app_metadata.active_organization_id.
--   * Defensive fallback: if no is_active row exists for a user (should not
--     happen post-backfill, but resilient against accidental flag clearing
--     by future ops), the hook falls back to the earliest membership by
--     created_at — mirroring build55 behavior so login never breaks.
--
-- Pairs with build62b (the public.set_active_organization RPC the workspace
-- switcher UI calls to flip flags).
--
-- Apply order in Session C: build62 first, build62b second.
-- Rollback file: supabase/build62-rollback.sql.

-- 1. Add the column. NOT NULL DEFAULT false makes existing rows safe;
--    backfill follows.
ALTER TABLE public.user_organizations
  ADD COLUMN is_active boolean NOT NULL DEFAULT false;

-- 2. Backfill: for each user, mark the earliest membership (by created_at)
--    as active. Mirrors the prior hook's "first row" semantics so existing
--    sessions resolve to the same org they would have pre-build62.
WITH first_membership AS (
  SELECT DISTINCT ON (user_id) id
    FROM public.user_organizations
    ORDER BY user_id, created_at ASC
)
UPDATE public.user_organizations uo
   SET is_active = true
  FROM first_membership fm
 WHERE uo.id = fm.id;

-- 3. Partial unique index — at most one active row per user. Created AFTER
--    the backfill so the index doesn't block step 2 (it wouldn't, since the
--    backfill writes one true row per user, but ordering keeps the migration
--    re-readable as "add column → backfill → constrain").
CREATE UNIQUE INDEX user_orgs_one_active_per_user
  ON public.user_organizations(user_id)
  WHERE is_active = true;

-- 4. Replace the hook to prefer is_active. The function body is otherwise
--    identical to build55: same grants, same exception handler, same claim
--    shape. Only the SELECT changes.
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

  -- Prefer the explicitly-active membership.
  SELECT organization_id
    INTO v_org_id
    FROM public.user_organizations
    WHERE user_id = v_user_id
      AND is_active = true
    LIMIT 1;

  -- Defensive fallback: earliest membership if no is_active row exists.
  -- Should not occur post-backfill, but keeps login resilient if a future
  -- operation accidentally clears the flag for a user.
  IF v_org_id IS NULL THEN
    SELECT organization_id
      INTO v_org_id
      FROM public.user_organizations
      WHERE user_id = v_user_id
      ORDER BY created_at ASC
      LIMIT 1;
  END IF;

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

-- Grants and revokes are unchanged from build55 (idempotent restate, safe
-- to re-run).
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
GRANT SELECT ON public.user_organizations TO supabase_auth_admin;

-- ROLLBACK ---
-- See supabase/build62-rollback.sql. Order matters: revert the hook first
-- so it stops referencing the column being dropped.
