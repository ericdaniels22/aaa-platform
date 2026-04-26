-- build62 rollback — restore the build55 hook body and drop the
-- is_active column + partial unique index.
--
-- NOT a migration. Not applied in sequence. Apply only if Session C step 1
-- (build62) lands in prod and a forward-fix isn't viable within the abort
-- window.
--
-- Apply via: psql "<conn>" -f supabase/build62-rollback.sql
--
-- Order matters: revert the hook FIRST (so it stops referencing the column
-- being dropped), then drop the index, then drop the column.

-- 1. Restore the build55 hook body (earliest-membership-by-created_at).
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

-- 2. Drop the partial unique index. Safe even if it's already gone.
DROP INDEX IF EXISTS public.user_orgs_one_active_per_user;

-- 3. Drop the column. CASCADE not used: the column should have no dependents
--    other than the partial index dropped above. If anything else references
--    it, fix-forward rather than blow it away silently.
ALTER TABLE public.user_organizations DROP COLUMN IF EXISTS is_active;
