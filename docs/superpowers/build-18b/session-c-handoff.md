# 18b Session C Handoff

**Status:** SHIPPED 2026-04-25.
**Plan:** `docs/superpowers/plans/2026-04-23-build-18b-rls-enforcement.md`
**Run log:** `docs/superpowers/build-18b/session-c-run-log.md` (timestamped, every step + every Rule C decision)
**Prod project ID:** `rzzprgidqbnqcdupmpfe`

---

## What 18b did

Flipped multi-tenant Row-Level Security from "transitional permissive" to "tenant_isolation as the sole gate" in production.

Pre-18b: `nookleus.aaa_organization_id()` returned a hardcoded AAA UUID; app code called it everywhere; legacy `Allow all` policies + `transitional_allow_all_*` policies were the actual access gate.

Post-18b: `app_metadata.active_organization_id` is injected into every JWT by `public.custom_access_token_hook`; `nookleus.active_organization_id()` reads it from `auth.jwt()`; app-side `getActiveOrganizationId()` decodes the same claim from the access token; `tenant_isolation_*` policies are the only thing standing between an authenticated user and another tenant's rows.

---

## Migrations applied (in order)

| Migration | Purpose |
|---|---|
| build55 | Create `public.custom_access_token_hook(jsonb)` with grants to `supabase_auth_admin` |
| build59 | Patch 7 contract RPCs to include `organization_id` in `contract_events` INSERTs |
| build56 | Drop 3 redundant custom policies (`invoice_email_settings_admin`, 2 broad knowledge_* reads) |
| build60 | (Rule C MATERIAL, mid-session) `auth_admin_read_user_organizations` SELECT policy on `user_organizations` so the hook can read under RLS |
| build57 | Drop 48 legacy `Allow all*` + 10 `transitional_allow_all_*` policies |
| build58 | Drop `nookleus.aaa_organization_id()` helper |

Plus one app-code commit:

| Commit | Purpose |
|---|---|
| `ae580cc` | (Rule C MATERIAL, post-deploy) `fix(18b): decode JWT directly in getActiveOrganizationId` — `getUser().app_metadata` reads the DB column not the JWT, so the helper was always returning `null` post-merge. Switched to decoding `getSession().access_token` directly. |

All migrations applied through Supabase MCP (`apply_migration`); migration files live under `supabase/migration-build5{5,6,7,8,9}-*.sql` and `supabase/migration-build60-*.sql`. Rollback notes inline in each file.

---

## Rule C decisions

Two MATERIAL findings during Session C, both Eric-approved before applying:

1. **build60 — `auth_admin_read_user_organizations`.** The hook function executes as `supabase_auth_admin`, which has `rolbypassrls = false` on hosted Supabase. Existing policies on `user_organizations` granted access only to `{authenticated}` or `{service_role}`, so the hook's `SELECT organization_id FROM public.user_organizations WHERE user_id = ...` returned zero rows under RLS, and the function silently returned the event unchanged — JWTs were issued without the claim. Fix: a narrow SELECT-only policy for `supabase_auth_admin` (Supabase-recommended pattern). Alternative `SECURITY DEFINER` rejected per the docs; `GRANT BYPASSRLS` not available on hosted.

2. **build61 — `getActiveOrganizationId` JWT decode.** The hook injects `app_metadata.active_organization_id` into the issued JWT only — it does NOT update `auth.users.raw_app_meta_data`. `supabase.auth.getUser().app_metadata` reads that DB column, so the helper was returning `null` for every authenticated request post-merge → all 61 callers broke (intake form was the first to be tested and failed). Fix: read `session.access_token` via `getSession()`, decode the base64url JWT payload, mirror the DB-side `nookleus.active_organization_id()`'s `app_metadata` → top-level fallback.

One MINOR amendment: §12.3 step 9 verifier was tightened to exclude `auth_admin_read_user_organizations` from the "legacy allow-alls gone" count, because build60 was added mid-session and wasn't enumerated in plan §3's KEEP list.

---

## Verifier outcomes (all PASS)

- **Step 1:** `custom_access_token_hook` function exists, `auth_admin` can EXECUTE + read `user_organizations`, `anon` cannot EXECUTE.
- **Step 2:** all 7 contract RPCs now write `organization_id` to `contract_events`.
- **Step 3:** 3 target policies dropped, none remaining.
- **Step 5:** Eric's JWT carries `app_metadata.active_organization_id = a0000000-0000-4000-8000-000000000001`.
- **Step 6:** `nookleus.active_organization_id()` returns AAA UUID for Eric's session.
- **Step 8 + 10 smokes:** `/jobs`, `/intake` submit, `/photos`, `/contacts`, `/settings/users`, `/jarvis`, incognito tenant-scope check — all PASS.
- **Step 9:** `transitional_gone` TRUE, `legacy_allow_alls_gone` TRUE (with build60 exclusion), `tenant_isolation_count` 56.
- **Step 11:** `to_regprocedure('nookleus.aaa_organization_id()') IS NULL` TRUE.
- **Step 12:** service role sees `all_jobs_visible = 8`, `orgs_in_jobs = 1` (AAA), `test_company_jobs = 0`.

---

## What 18b did NOT do (deferred to 18c per plan §13)

- **Public-route org resolution (must-fix before 18c ships).** `src/app/(public)/sign/[token]/page.tsx`, `src/app/(public)/pay/[token]/page.tsx`, `src/app/(public)/pay/[token]/success/page.tsx` still use `.eq("organization_id", orgId ?? AAA_ORGANIZATION_ID)` with `orgId` always `null` for unauthenticated magic-link visitors. Today this works because AAA is the only tenant with data; after 18c seeds Test Company, Test Company signing/payment links will silently 404. Fix pattern: derive `organization_id` from the token row itself (`contracts.link_token` and `payment_requests.link_token` are unique and carry `organization_id`).
- **ConfigProvider auth-race on cold sessions (cosmetic).** Surfaced during Step 10 smoke. `src/lib/config-context.tsx` fires `damage_types`/`job_statuses` fetches before the auth cookie is hydrated on first incognito render. Pre-build57 the `Allow all` legacy policies were a `public`-role backstop that hid the race; post-build57 the request returns 0 rows under `tenant_isolation_*`, so `damageTypes`/`statuses` arrays stay empty for that page-load. Visual symptom: job-card colored top strip falls back to gray on a cold incognito `/jobs`. No tenant-isolation impact, no functional break, normal warm sessions unaffected. Three fix candidates documented in plan §13.
- Scratch Supabase project deletion (~24h after prod green).
- Storage migration script (74 files, path rename).
- `user_permissions` table drop (2+ weeks post-18b).
- Legacy sequence drops (`job_number_seq`, `invoice_number_seq`).

---

## Operational notes for the next session

- The hook is **enabled in the Supabase dashboard** (Authentication → Hooks → Customize Access Token (JWT) Claims hook → `public.custom_access_token_hook` → ON). Disabling it in the dashboard is the §9.1 rollback path; the hook function itself remains defined.
- `AAA_ORGANIZATION_ID` constant is retained in `src/lib/supabase/get-active-org.ts` for out-of-app scripts and seed data only. **App code must NOT fall back to it** — that would mask missing claims and reintroduce the tenant-leak risk 18b just eliminated.
- `nookleus.active_organization_id()` is the canonical DB-side accessor. `getActiveOrganizationId()` is the canonical app-side accessor. Both read the JWT, never the DB column.
- Test Company (`a0000000-0000-4000-8000-000000000002`) exists with zero rows. 18c will seed it and add Eric as a member of both orgs.
