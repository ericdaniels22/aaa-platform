-- Build 18a (build42) — Create organizations, user_organizations, nookleus schema.
-- Seeds AAA + Test Company and Eric's admin membership in AAA.
--
-- Purpose:   First migration of the multi-tenant schema refactor. Introduces
--            the organizations table, the user_organizations join table, and
--            the nookleus helper schema (active_organization_id from JWT,
--            aaa_organization_id as a hardcoded temporary helper for the
--            18a code sweep).
-- Depends on: nothing — no other tables reference these rows yet.
-- Revert:    DROP SCHEMA nookleus CASCADE; DROP TABLE public.user_organizations,
--            public.organizations. See -- ROLLBACK --- block at bottom.

-- ---------------------------------------------------------------------------
-- 1. organizations table.
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_key unique (slug)
);

-- RLS is enabled but no policies yet — added in build49. Service role and
-- build scripts bypass RLS so the seeds below succeed inside this migration.
alter table public.organizations enable row level security;

-- ---------------------------------------------------------------------------
-- 2. user_organizations join table (memberships + role).
-- ---------------------------------------------------------------------------
create table if not exists public.user_organizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  role text not null check (role in ('admin','crew_lead','crew_member','custom')),
  created_at timestamptz not null default now(),
  constraint user_organizations_user_org_key unique (user_id, organization_id)
);

create index if not exists idx_user_organizations_user_id on public.user_organizations(user_id);
create index if not exists idx_user_organizations_organization_id on public.user_organizations(organization_id);

alter table public.user_organizations enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Seed AAA Disaster Recovery and Test Company with hardcoded UUIDs.
--    Hardcoded so reruns are idempotent and code can reference the constants.
--    AAA:          a0000000-0000-4000-8000-000000000001
--    Test Company: a0000000-0000-4000-8000-000000000002
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug) values
  ('a0000000-0000-4000-8000-000000000001', 'AAA Disaster Recovery', 'aaa-disaster-recovery'),
  ('a0000000-0000-4000-8000-000000000002', 'Test Company',           'test-company')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Seed Eric's admin membership in AAA.
--    User id: 7c55cdd0-2cbf-4c8a-8fdd-e141973ade94
-- ---------------------------------------------------------------------------
insert into public.user_organizations (user_id, organization_id, role) values
  ('7c55cdd0-2cbf-4c8a-8fdd-e141973ade94', 'a0000000-0000-4000-8000-000000000001', 'admin')
on conflict (user_id, organization_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. nookleus helper schema + functions.
-- ---------------------------------------------------------------------------
create schema if not exists nookleus;

-- Returns the active organization from the JWT, or NULL if missing.
-- Policies must handle NULL explicitly (treat as "no access").
-- STABLE not IMMUTABLE: the JWT can change between requests.
create or replace function nookleus.active_organization_id()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      auth.jwt() ->> 'active_organization_id',
      (auth.jwt() -> 'app_metadata' ->> 'active_organization_id')
    ),
    ''
  )::uuid;
$$;

-- Temporary helper: returns AAA's org id. Used by 18a code sweep until
-- session context lands in 18b. DROP in 18b cleanup.
create or replace function nookleus.aaa_organization_id()
returns uuid
language sql
immutable
as $$
  select 'a0000000-0000-4000-8000-000000000001'::uuid;
$$;

grant usage on schema nookleus to authenticated, anon, service_role;
grant execute on function nookleus.active_organization_id() to authenticated, anon, service_role;
grant execute on function nookleus.aaa_organization_id() to authenticated, service_role;

-- ROLLBACK ---
-- drop function if exists nookleus.active_organization_id();
-- drop function if exists nookleus.aaa_organization_id();
-- drop schema if exists nookleus cascade;
-- drop table if exists public.user_organizations;
-- drop table if exists public.organizations;
