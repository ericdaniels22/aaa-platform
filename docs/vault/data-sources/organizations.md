---
table: organizations
type: supabase
created_in: build-18a
related_builds: ["[[build-18a]]", "[[build-18b]]", "[[build-18c]]"]
---

#data-source #area/multi-tenant

# `organizations`

The tenant table. Created in [[build-18a]] (build42).

## Created in

- [supabase/migration-build42-create-organizations-and-memberships.sql](../../../supabase/migration-build42-create-organizations-and-memberships.sql) — `id`, `name`, `slug` (UNIQUE), timestamps. RLS enabled but no policies in build42; transitional `Allow all` in build53.
- Seeded with **AAA Disaster Recovery** (Eric's company; primary tenant) and **Test Company** (multi-tenant verification tenant).

## Altered by

- **[[build-18b]]** — drops transitional allow-all policies in build57; effective enforcement gated on `tenant_isolation_organizations` matching `nookleus.active_organization_id()`.

## RLS

- **18b:** `tenant_isolation_organizations`. The `nookleus` schema has helpers: `active_organization_id()` (reads `app_metadata.active_organization_id` from `auth.jwt()`), `is_member_of(uuid)`.

## Used by

Workspace switcher ([[build-18c]]), `/api/jobs/*` and every other multi-tenant route via `getActiveOrganizationId()` ([src/lib/supabase/get-active-org.ts](../../../src/lib/supabase/get-active-org.ts)), the GoTrue `custom_access_token_hook` (which mints `app_metadata.active_organization_id`), [[user_organizations]] (FK).
