---
table: user_organizations
type: supabase
created_in: build-18a
related_builds: ["[[build-18a]]", "[[build-18b]]", "[[build-18c]]", "[[build-64]]"]
---

#data-source #area/multi-tenant

# `user_organizations`

Memberships join table — users to [[organizations]] with a role and an active flag.

## Created in

- [supabase/migration-build42-create-organizations-and-memberships.sql](../../../supabase/migration-build42-create-organizations-and-memberships.sql) — `user_id` (FK `auth.users` ON DELETE RESTRICT), `organization_id` (FK `organizations` ON DELETE RESTRICT), `role` (CHECK: `admin`, `crew_lead`, `crew_member`, `custom`), UNIQUE(user_id, organization_id).

## Altered by

- **[[build-18a]]** ([build48](../../../supabase/migration-build48-migrate-user-permissions-and-preferences.sql)) — `set_default_permissions()` reworked to insert per-membership rather than per-user.
- **[[build-18a]]** ([build51](../../../supabase/migration-build51-user-organizations-postgrest-fk.sql)) — PostgREST embedding fix (FK syntax).
- **[[build-18b]]** ([build60](../../../supabase/migration-build60-auth-admin-read-user-orgs-policy.sql)) — `auth_admin_read_user_organizations` SELECT policy so `custom_access_token_hook` can read memberships under RLS.
- **[[build-18c]]** ([build62](../../../supabase/migration-build62-user-orgs-active-flag.sql)) — `is_active boolean` column with partial unique index `user_orgs_one_active_per_user` (one active membership per user). Hook updated to prefer active row.
- **[[build-18c]]** ([build62b](../../../supabase/migration-build62b-set-active-organization-rpc.sql)) — `public.set_active_organization(p_org_id uuid)` SECURITY DEFINER RPC.

## RLS

- **18b:** `tenant_isolation_user_organizations` keyed on membership; plus `auth_admin_read_user_organizations` for the hook.

## Lessons

- The `on_auth_user_created` trigger on `auth.users` (which mirrors new auth users into `user_profiles`, prerequisite for `user_organizations` FKs) had been silently absent until [[build-64]] restored it. Surfaced as an FK violation when inviting a new user via `/settings/users` mid-[[build-18c]] Session C.

## Used by

GoTrue `custom_access_token_hook` (membership lookup → `active_organization_id` claim), workspace switcher (lists memberships, sets active), `/settings/users`, `getActiveOrganizationId()` helper, RLS policies across every tenant table.
