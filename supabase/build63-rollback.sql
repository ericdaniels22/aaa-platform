-- build63 rollback — drop the user_profiles SELECT policy.
--
-- NOT a migration. Apply only if build63 lands and a forward-fix isn't
-- viable. Rolling this back will re-break user_profiles SELECT for
-- authenticated users (which is the bug build63 fixes), so this is
-- only useful in the unlikely case that the policy itself causes a
-- regression elsewhere.

DROP POLICY IF EXISTS user_profiles_authenticated_read ON public.user_profiles;
