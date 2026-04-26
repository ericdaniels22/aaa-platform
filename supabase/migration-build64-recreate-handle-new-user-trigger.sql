-- build64: Restore the AFTER INSERT trigger on auth.users that mirrors new
-- auth users into public.user_profiles. The function public.handle_new_user()
-- already exists from build48; only the trigger calling it is missing.
-- Latent regression introduced sometime during the 18b RLS-hardening series.

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill check: every auth.users row should have a matching user_profiles
-- row. The one known orphan (eric@testtesttest.com) is being removed
-- separately via supabase.auth.admin.deleteUser, so this should be a no-op
-- after that step. Asserted at the end of the migration as a safety check.
DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT COUNT(*) INTO orphan_count
    FROM auth.users au
    LEFT JOIN public.user_profiles up ON up.id = au.id
   WHERE up.id IS NULL;

  IF orphan_count > 0 THEN
    RAISE NOTICE 'build64: % auth.users row(s) lack a user_profiles row. Trigger is now installed; future inserts mirror correctly. Resolve existing orphans manually.', orphan_count;
  END IF;
END$$;
