-- build58: drop nookleus.aaa_organization_id(). This helper returned a hard-
-- coded AAA UUID and was used throughout 18a to simulate the active-org
-- claim. After 18b the JWT carries app_metadata.active_organization_id
-- directly, and nookleus.active_organization_id() (added in 18a) reads it
-- from the token. There are no legitimate callers of aaa_organization_id()
-- post-18b.
--
-- If a missed caller exists, dropping this function will produce a loud
-- "function does not exist" error on the first call site that's exercised.
-- That's the intended signal: silent fallback to the AAA constant would
-- mask tenant leakage.
--
-- Runs in Session C step 10 — AFTER build57 drops the permissive policies
-- AND the post-drop smoke tests pass. Cosmetic cleanup.

DROP FUNCTION IF EXISTS nookleus.aaa_organization_id();

-- ROLLBACK ---
-- Function body captured from prod on 2026-04-23 (Session A prep):
--
-- CREATE OR REPLACE FUNCTION nookleus.aaa_organization_id()
--  RETURNS uuid
--  LANGUAGE sql
--  IMMUTABLE
-- AS $function$
--   select 'a0000000-0000-4000-8000-000000000001'::uuid;
-- $function$;
