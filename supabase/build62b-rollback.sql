-- build62b rollback — drop public.set_active_organization(uuid).
--
-- NOT a migration. Apply only if build62b lands in prod and a forward-fix
-- isn't viable within the abort window.
--
-- Apply via: psql "<conn>" -f supabase/build62b-rollback.sql
--
-- Apply this BEFORE supabase/build62-rollback.sql if rolling back both:
-- the RPC has no dependency on the column, but ordering keeps the rollback
-- mirror-image of the apply order (build62 then build62b).

DROP FUNCTION IF EXISTS public.set_active_organization(uuid);
