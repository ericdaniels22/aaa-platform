-- build63: restore SELECT policy on public.user_profiles.
--
-- Build57 (in 18b) dropped the legacy "Users can view all profiles"
-- SELECT policy on user_profiles as part of the post-RLS-flip cleanup.
-- The cleanup was correct in spirit (legacy "Allow all" patterns had to
-- go) but no replacement was added, so user_profiles SELECT returned 0
-- rows for authenticated users. The bug was latent until 18c Session C
-- when Eric attempted to log out for the first time post-18b — the
-- sidebar's user-info section (which contains the sign-out button) only
-- renders when AuthProvider's `profile` state is non-null, which
-- requires a successful SELECT against user_profiles.
--
-- Surfaced as a Rule C MATERIAL during 18c Session C step 5 smoke (Eric's
-- screenshot showed "AAA Platform v1.0" — the profile=null fallback —
-- in the sidebar footer instead of his name + sign-out icon). Eric
-- approved forward-fix on the recommended (self-read + shared-org-read)
-- option, which restores pre-build57 intent narrowed to tenant-isolation
-- semantics.
--
-- Rollback: supabase/build63-rollback.sql.

CREATE POLICY user_profiles_authenticated_read
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
        FROM public.user_organizations uo
       WHERE uo.user_id = public.user_profiles.id
         AND nookleus.is_member_of(uo.organization_id)
    )
  );
