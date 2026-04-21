-- Build 18a (build48) — Move role/permissions/preferences off user_profiles
-- onto membership. Rewrite the 10 existing policies that gate on
-- user_profiles.role before dropping the column.
--
-- Purpose:   Permissions become per-membership rather than per-user, so a
--            user can be admin in one workspace and crew_member in
--            another. Notification preferences scope similarly.
-- Depends on: build42 (user_organizations seeded with Eric's AAA admin row),
--             build45 (organization_id is NOT NULL on tenant tables so the
--             rewritten policies can reference it).
-- Revert:    Non-trivial — requires re-adding user_profiles.role, restoring
--            data from user_organizations, recreating the old policies,
--            rebuilding user_permissions from user_organization_permissions.
--            See -- ROLLBACK --- block at bottom.
--
-- NOTE: user_permissions table is NOT dropped in 18a. It is commented as
-- deprecated and scheduled for DROP in a post-18a cleanup migration once
-- the code sweep has shipped.

-- ---------------------------------------------------------------------------
-- 1. Create user_organization_permissions.
-- ---------------------------------------------------------------------------
create table if not exists public.user_organization_permissions (
  id uuid primary key default gen_random_uuid(),
  user_organization_id uuid not null references public.user_organizations(id) on delete cascade,
  permission_key text not null,
  granted boolean not null default false,
  created_at timestamptz not null default now(),
  constraint user_organization_permissions_uo_key_key unique (user_organization_id, permission_key)
);

create index if not exists idx_user_organization_permissions_uo on public.user_organization_permissions(user_organization_id);
create index if not exists idx_user_organization_permissions_key on public.user_organization_permissions(permission_key);

alter table public.user_organization_permissions enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Migrate existing user_permissions rows into user_organization_permissions
--    via the AAA membership. Every existing row targets AAA because 18a is
--    the single-tenant cutover point.
-- ---------------------------------------------------------------------------
insert into public.user_organization_permissions (user_organization_id, permission_key, granted)
select uo.id, up.permission_key, up.granted
  from public.user_permissions up
  join public.user_organizations uo
    on uo.user_id = up.user_id
   and uo.organization_id = 'a0000000-0000-4000-8000-000000000001'
on conflict (user_organization_id, permission_key) do update set granted = excluded.granted;

-- ---------------------------------------------------------------------------
-- 3. Rewire notification_preferences to user_organization_id.
-- ---------------------------------------------------------------------------
alter table public.notification_preferences add column if not exists user_organization_id uuid;

update public.notification_preferences np
   set user_organization_id = uo.id
  from public.user_organizations uo
 where np.user_id = uo.user_id
   and uo.organization_id = 'a0000000-0000-4000-8000-000000000001'
   and np.user_organization_id is null;

-- Fail loudly if any row wasn't matched — means the AAA membership row is
-- missing for a user who has notification preferences, which shouldn't
-- happen given build42 seeded Eric's membership.
do $$
begin
  if exists (select 1 from public.notification_preferences where user_organization_id is null) then
    raise exception 'notification_preferences: unmapped rows after membership join';
  end if;
end $$;

alter table public.notification_preferences alter column user_organization_id set not null;
alter table public.notification_preferences add constraint fk_notification_prefs_user_org
  foreign key (user_organization_id) references public.user_organizations(id) on delete cascade;

-- Replace the old (user_id, notification_type) UNIQUE with a membership-scoped one.
alter table public.notification_preferences
  drop constraint if exists notification_preferences_user_id_notification_type_key;
create unique index notification_preferences_user_org_type_key
  on public.notification_preferences(user_organization_id, notification_type);

-- user_id is now redundant — drop it.
alter table public.notification_preferences drop column if exists user_id;

-- ---------------------------------------------------------------------------
-- 4. Drop the 10 policies that gate on user_profiles.role BEFORE dropping
--    the role column. Recreate each with a user_organizations.role check.
--    Tenant tables: scope to active-org-admin.
--    Product-level tables (nav_items, knowledge_*): admin-in-any-org check.
--    (The "admin-in-any-org" test on product-level tables is a transient
--    18a gate; a dedicated is_product_admin flag ships in a later phase.)
-- ---------------------------------------------------------------------------

-- 4a. invoice_email_settings (tenant table)
drop policy if exists "invoice_email_settings admin" on public.invoice_email_settings;
create policy invoice_email_settings_admin
  on public.invoice_email_settings
  for all
  to authenticated
  using (
    organization_id = invoice_email_settings.organization_id
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = invoice_email_settings.organization_id
         and uo.role = 'admin'
    )
  )
  with check (
    organization_id = invoice_email_settings.organization_id
    and exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = invoice_email_settings.organization_id
         and uo.role = 'admin'
    )
  );

-- 4b. jarvis_alerts (tenant table, SELECT-only admin policy)
drop policy if exists "Admins can read all alerts" on public.jarvis_alerts;
create policy jarvis_alerts_admin_read
  on public.jarvis_alerts
  for select
  to authenticated
  using (
    exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = jarvis_alerts.organization_id
         and uo.role = 'admin'
    )
  );

-- 4c. jarvis_conversations (tenant table, SELECT-only admin policy)
drop policy if exists "Admins can read all conversations" on public.jarvis_conversations;
create policy jarvis_conversations_admin_read
  on public.jarvis_conversations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = jarvis_conversations.organization_id
         and uo.role = 'admin'
    )
  );

-- 4d. knowledge_chunks (product-level, admin-in-any-org)
drop policy if exists "Admins can manage knowledge chunks" on public.knowledge_chunks;
create policy knowledge_chunks_admin_manage
  on public.knowledge_chunks
  for all
  to authenticated
  using (
    exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.role = 'admin'
    )
  );

-- 4e. knowledge_documents (product-level, admin-in-any-org)
drop policy if exists "Admins can manage knowledge documents" on public.knowledge_documents;
create policy knowledge_documents_admin_manage
  on public.knowledge_documents
  for all
  to authenticated
  using (
    exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.role = 'admin'
    )
  );

-- 4f. marketing_assets (tenant table — per §1.2 row 53, per-tenant)
drop policy if exists "Admins can manage marketing assets" on public.marketing_assets;
create policy marketing_assets_admin_manage
  on public.marketing_assets
  for all
  to authenticated
  using (
    exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = marketing_assets.organization_id
         and uo.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = marketing_assets.organization_id
         and uo.role = 'admin'
    )
  );

-- 4g. marketing_drafts (tenant table, same pattern)
drop policy if exists "Admins can manage marketing drafts" on public.marketing_drafts;
create policy marketing_drafts_admin_manage
  on public.marketing_drafts
  for all
  to authenticated
  using (
    exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = marketing_drafts.organization_id
         and uo.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = marketing_drafts.organization_id
         and uo.role = 'admin'
    )
  );

-- 4h. nav_items (product-level, admin-in-any-org)
drop policy if exists "nav_items admin write" on public.nav_items;
create policy nav_items_admin_write
  on public.nav_items
  for all
  to authenticated
  using (
    exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.role = 'admin'
    )
  );

-- 4i. qb_connection — two policies merged into one FOR ALL admin policy
drop policy if exists "qb_connection admin read" on public.qb_connection;
drop policy if exists "qb_connection admin write" on public.qb_connection;
create policy qb_connection_admin
  on public.qb_connection
  for all
  to authenticated
  using (
    exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = qb_connection.organization_id
         and uo.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.user_organizations uo
       where uo.user_id = auth.uid()
         and uo.organization_id = qb_connection.organization_id
         and uo.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Rewrite DB functions that reference user_profiles.role or write to
--    user_permissions. These all fire from triggers or RPCs and would break
--    otherwise.
-- ---------------------------------------------------------------------------

-- handle_new_user: fires on auth.users insert. Drop the role set — role
-- is now per-membership, and new users don't have a membership at signup.
-- The caller (invite flow) is responsible for creating the user_organizations
-- row with the correct role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.user_profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  );
  return new;
end;
$$;

-- notify_admins: now reads role from user_organizations (scoped to a
-- job's org) and writes notifications with organization_id set. p_job_id
-- is required — without it we can't determine which tenant's admins to
-- notify. Keep the default NULL parameter for signature compat; raise
-- if called without a job_id post-18a.
create or replace function public.notify_admins(
  p_type text,
  p_title text,
  p_body text default null,
  p_job_id uuid default null
)
returns void
language plpgsql
as $$
declare
  v_org_id uuid;
begin
  if p_job_id is null then
    raise exception 'notify_admins: p_job_id is required post-18a (needed to scope to an org)';
  end if;

  select organization_id into v_org_id from public.jobs where id = p_job_id;
  if v_org_id is null then
    raise exception 'notify_admins: job % has no organization_id', p_job_id;
  end if;

  insert into public.notifications (organization_id, user_id, type, title, body, job_id)
  select v_org_id, uo.user_id, p_type, p_title, p_body, p_job_id
    from public.user_organizations uo
    join public.user_profiles up on up.id = uo.user_id
   where uo.organization_id = v_org_id
     and uo.role = 'admin'
     and up.is_active = true;
end;
$$;

-- set_default_permissions: now writes to BOTH user_permissions (legacy,
-- kept during 18a for revert safety) and user_organization_permissions
-- (the new source of truth). Requires p_user_organization_id so the
-- writes can land on the correct membership.
create or replace function public.set_default_permissions(p_user_organization_id uuid, p_role text)
returns void
language plpgsql
as $$
declare
  all_perms text[] := array[
    'view_jobs', 'edit_jobs', 'create_jobs',
    'log_activities', 'upload_photos', 'edit_photos',
    'view_billing', 'record_payments',
    'view_email', 'send_email',
    'manage_reports', 'access_settings',
    'log_expenses', 'manage_vendors', 'manage_contract_templates', 'manage_expense_categories',
    'view_accounting', 'manage_accounting'
  ];
  admin_perms text[] := all_perms;
  lead_perms text[] := array[
    'view_jobs', 'edit_jobs', 'create_jobs',
    'log_activities', 'upload_photos', 'edit_photos',
    'view_billing', 'record_payments',
    'view_email', 'send_email',
    'manage_reports',
    'log_expenses'
  ];
  member_perms text[] := array[
    'view_jobs', 'log_activities', 'upload_photos',
    'log_expenses'
  ];
  granted_perms text[];
  perm text;
  v_user_id uuid;
begin
  select user_id into v_user_id from public.user_organizations where id = p_user_organization_id;
  if v_user_id is null then
    raise exception 'set_default_permissions: user_organization % not found', p_user_organization_id;
  end if;

  if p_role = 'admin' then
    granted_perms := admin_perms;
  elsif p_role = 'crew_lead' then
    granted_perms := lead_perms;
  else
    granted_perms := member_perms;
  end if;

  foreach perm in array all_perms loop
    -- New source of truth
    insert into public.user_organization_permissions (user_organization_id, permission_key, granted)
    values (p_user_organization_id, perm, perm = any(granted_perms))
    on conflict (user_organization_id, permission_key) do update set granted = excluded.granted;

    -- Legacy table — kept in sync during 18a until the deprecation cleanup migration drops it.
    insert into public.user_permissions (user_id, permission_key, granted)
    values (v_user_id, perm, perm = any(granted_perms))
    on conflict (user_id, permission_key) do update set granted = excluded.granted;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Drop user_profiles.role — the role now lives on user_organizations.
-- ---------------------------------------------------------------------------
alter table public.user_profiles drop column if exists role;

-- ---------------------------------------------------------------------------
-- 7. Deprecate (but do NOT drop) user_permissions. Dropping the table is a
--    follow-up cleanup migration after the code sweep ships — keeps revert
--    safe during rollout.
-- ---------------------------------------------------------------------------
comment on table public.user_permissions is
  'DEPRECATED as of build48 (2026-04-21). Use user_organization_permissions. Scheduled for DROP in a post-18a cleanup migration once the code sweep has shipped.';

-- ROLLBACK ---
-- (Destructive revert — requires a pre-migration snapshot to be safe.)
-- alter table public.user_profiles add column role text not null default 'admin'
--   check (role in ('admin','crew_lead','crew_member','custom'));
-- update public.user_profiles up
--   set role = coalesce(
--     (select uo.role from public.user_organizations uo where uo.user_id = up.id limit 1),
--     'admin'
--   );
--
-- Recreate the 10 original policies (pre-build48 definitions):
-- drop policy if exists invoice_email_settings_admin   on public.invoice_email_settings;
-- create policy "invoice_email_settings admin" on public.invoice_email_settings for all
--   using  (exists (select 1 from user_profiles where user_profiles.id = auth.uid() and user_profiles.role = 'admin'))
--   with check (exists (select 1 from user_profiles where user_profiles.id = auth.uid() and user_profiles.role = 'admin'));
-- drop policy if exists jarvis_alerts_admin_read       on public.jarvis_alerts;
-- create policy "Admins can read all alerts" on public.jarvis_alerts for select
--   using (exists (select 1 from user_profiles where user_profiles.id = auth.uid() and user_profiles.role = 'admin'));
-- drop policy if exists jarvis_conversations_admin_read on public.jarvis_conversations;
-- create policy "Admins can read all conversations" on public.jarvis_conversations for select
--   using (exists (select 1 from user_profiles where user_profiles.id = auth.uid() and user_profiles.role = 'admin'));
-- drop policy if exists knowledge_chunks_admin_manage   on public.knowledge_chunks;
-- create policy "Admins can manage knowledge chunks" on public.knowledge_chunks for all
--   using (exists (select 1 from user_profiles where user_profiles.id = auth.uid() and user_profiles.role = 'admin'));
-- drop policy if exists knowledge_documents_admin_manage on public.knowledge_documents;
-- create policy "Admins can manage knowledge documents" on public.knowledge_documents for all
--   using (exists (select 1 from user_profiles where user_profiles.id = auth.uid() and user_profiles.role = 'admin'));
-- drop policy if exists marketing_assets_admin_manage   on public.marketing_assets;
-- create policy "Admins can manage marketing assets" on public.marketing_assets for all
--   using (exists (select 1 from user_profiles where user_profiles.id = auth.uid() and user_profiles.role = 'admin'));
-- drop policy if exists marketing_drafts_admin_manage   on public.marketing_drafts;
-- create policy "Admins can manage marketing drafts" on public.marketing_drafts for all
--   using (exists (select 1 from user_profiles where user_profiles.id = auth.uid() and user_profiles.role = 'admin'));
-- drop policy if exists nav_items_admin_write           on public.nav_items;
-- create policy "nav_items admin write" on public.nav_items for all
--   using (exists (select 1 from user_profiles where user_profiles.id = auth.uid() and user_profiles.role = 'admin'));
-- drop policy if exists qb_connection_admin             on public.qb_connection;
-- create policy "qb_connection admin read" on public.qb_connection for select
--   using (exists (select 1 from user_profiles where user_profiles.id = auth.uid() and user_profiles.role = 'admin'));
-- create policy "qb_connection admin write" on public.qb_connection for all
--   using (exists (select 1 from user_profiles where user_profiles.id = auth.uid() and user_profiles.role = 'admin'))
--   with check (exists (select 1 from user_profiles where user_profiles.id = auth.uid() and user_profiles.role = 'admin'));
--
-- Restore notification_preferences.user_id:
-- alter table public.notification_preferences add column user_id uuid;
-- update public.notification_preferences np set user_id = uo.user_id
--   from public.user_organizations uo where uo.id = np.user_organization_id;
-- alter table public.notification_preferences alter column user_id set not null;
-- alter table public.notification_preferences drop constraint fk_notification_prefs_user_org;
-- drop index if exists public.notification_preferences_user_org_type_key;
-- alter table public.notification_preferences drop column user_organization_id;
-- alter table public.notification_preferences add constraint notification_preferences_user_id_notification_type_key
--   unique (user_id, notification_type);
--
-- drop table if exists public.user_organization_permissions;
-- comment on table public.user_permissions is null;
