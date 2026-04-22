-- Build 18a (build51) — Make /settings/users (Users & Crew) work after build42-49.
-- Two coupled fixes both required for the same page:
--   (1) PostgREST-visible FK so user_profiles can be embedded from
--       user_organizations selects.
--   (2) RLS policy so members can see their org-mates, not only themselves.
--
-- Background:
--   build42 created user_organizations.user_id with FK → auth.users(id).
--   PostgREST does not surface FKs into the auth schema, so embeds like
--     .from('user_organizations').select('..., user_profiles:user_id(...)')
--   fail with "Could not find a relationship between 'user_organizations' and
--   'user_id' in the schema cache". Two production code paths exercise this
--   embed today:
--     - src/app/api/settings/users/route.ts (GET — Users & Crew page)
--     - src/lib/notifications/write.ts     (admin fan-out for notifications)
--
--   build49 added user_orgs_self_read which only lets a user see their own
--   row. The Users & Crew page needs to list ALL members of the active org;
--   notifications/write needs to fan out to every active admin. With only
--   self_read in place, both queries return at most one row.
--
-- Fixes:
--   (1) Add a second FK on user_organizations.user_id pointing at
--       user_profiles(id). The referenced row always exists because
--       handle_new_user mirrors auth.users into user_profiles 1:1 with the
--       same id. The existing auth.users FK is kept for explicit linkage.
--   (2) Add user_orgs_member_read policy: any authenticated user can read
--       every membership row whose organization_id is one they belong to.
--       Combines with self_read via OR. Implemented as a SECURITY DEFINER
--       helper to avoid RLS recursion on the same table.
--
-- Caught by: scratch rehearsal smoke test (2026-04-22). /settings/users
--   returned 500 with the schema-cache error; once the FK was added it
--   returned [] because RLS filtered every other member out.
--
-- Depends on: build42 (creates user_organizations and the seed row), build48
--   (rewires user_profiles), build49 (the self_read policy this complements).
--
-- Revert: see ROLLBACK block at bottom.

-- ---------------------------------------------------------------------------
-- 1. PostgREST-visible FK to user_profiles.
-- ---------------------------------------------------------------------------
alter table public.user_organizations
  add constraint user_organizations_user_id_profile_fkey
  foreign key (user_id) references public.user_profiles(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 2. SECURITY DEFINER helper — "is the current user a member of org X?"
--    SECURITY DEFINER bypasses RLS inside the function body, which lets us
--    reference user_organizations from a policy ON user_organizations
--    without recursive policy evaluation.
-- ---------------------------------------------------------------------------
create or replace function nookleus.is_member_of(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.user_organizations
     where user_id = auth.uid()
       and organization_id = target_org
  );
$$;

grant execute on function nookleus.is_member_of(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Policy — members can read every membership row in any org they belong to.
--    Combined with user_orgs_self_read (build49) by OR; either can grant
--    visibility. self_read remains useful as the base case during sign-up
--    when nookleus.is_member_of would also return true but is more expensive.
-- ---------------------------------------------------------------------------
create policy user_orgs_member_read on public.user_organizations for select to authenticated
  using (nookleus.is_member_of(organization_id));

-- Force PostgREST to refresh its schema cache so the new relationship and
-- policy are visible immediately.
notify pgrst, 'reload schema';

-- ROLLBACK ---
-- drop policy if exists user_orgs_member_read on public.user_organizations;
-- drop function if exists nookleus.is_member_of(uuid);
-- alter table public.user_organizations
--   drop constraint if exists user_organizations_user_id_profile_fkey;
