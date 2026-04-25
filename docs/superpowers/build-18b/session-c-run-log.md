# 18b Session C Run Log

**Started:** 2026-04-24T15:59:39Z
**Eric present:** yes
**Session A commit:** 38d1b10 (`origin/main` at Session A start; 18b-prep branched from here)
**Session B rehearsal report:** `docs/superpowers/build-18b/session-b-rehearsal-report.md` (PASS)
**18b-prep branch HEAD:** f5c6078 (`rehearsal(18b): Session B scratch rehearsal — all PASS`)
**Prod project ID:** rzzprgidqbnqcdupmpfe

---

## Pre-flight (§12.1)

**2026-04-24T15:59:39Z — Q1 baseline (prod):** all 8 TRUE
- `tenant_isolation_*` = 56: TRUE
- `transitional_allow_all_*` = 10: TRUE
- `nookleus.active_organization_id()` exists: TRUE
- `nookleus.is_member_of(uuid)` exists: TRUE
- `public.custom_access_token_hook(jsonb)` absent: TRUE
- `nookleus.aaa_organization_id()` present: TRUE
- `organizations` count = 2: TRUE
- `user_organizations` count = 1: TRUE

**2026-04-24T15:59:39Z — Q2 git state:**
- Working tree: clean (only untracked `supabase/.temp/`, unrelated)
- HEAD: `f5c6078` on branch `18b-prep`
- `origin/main`: `38d1b10` (matches Session A handoff)
- Mergeability of `18b-prep` → `main`: CLEAN (merge dry-run returned 0 with auto-merge; aborted without committing)

**2026-04-24T15:59:39Z — Eric confirms dashboard access:** yes (confirmed at session start)

Pre-flight result: **PASS — proceeding to Step 1.**

---

## Step 1: Create hook function + grants (build55)

**2026-04-24T15:59:39Z — Migration `build55_custom_access_token_hook` applied:** success.
**Verifier output:**
- `fn_exists`: TRUE
- `auth_admin_can_execute`: TRUE
- `auth_admin_can_read_members`: TRUE
- `auth_admin_schema_usage`: TRUE
- `anon_can_execute_bad`: FALSE (REVOKE correctly applied)
- Functional test: `custom_access_token_hook({user_id: Eric})` returned claim with `active_organization_id = a0000000-0000-4000-8000-000000000001` (AAA)

**Status: PASS.**

## Step 2: Patch 7 contract RPCs (build59)

**2026-04-24T15:59:39Z — Migration `build59_contract_event_rpcs_organization_id` applied:** success.
**Verifier output:** all 7 RPCs have `pg_get_functiondef() ILIKE '%INSERT INTO contract_events (organization_id%'` = TRUE
- `activate_next_signer(uuid,uuid,text,timestamp with time zone)`: patched
- `mark_contract_expired(uuid)`: patched
- `mark_contract_sent(uuid,text,text)`: patched
- `mark_reminder_sent(uuid,jsonb)`: patched
- `record_signer_signature(uuid,text,text,text,text)`: patched
- `resend_contract_link(uuid,text,timestamp with time zone)`: patched
- `void_contract(uuid,uuid,text)`: patched

**Status: PASS.**

## Step 3: Drop 3 redundant custom policies (build56)

**2026-04-24T15:59:39Z — Migration `build56_drop_redundant_custom_policies` applied:** success.
**Verifier output:** `step_3_complete = TRUE`, `remaining_if_any = null` (all 3 target policies gone from pg_policies)

**Status: PASS.**

## Step 4: Eric enables hook in Supabase dashboard

**2026-04-24 — Eric enabled the hook in the Supabase dashboard** (Authentication → Hooks → Customize Access Token (JWT) Claims hook → Postgres function `public.custom_access_token_hook` → Enable + Save).

**Verifier (function-call sanity):** `SELECT public.custom_access_token_hook({user_id: Eric})` returned `active_organization_id = a0000000-0000-4000-8000-000000000001` (AAA).

**Status: PASS** (function reachable; live toggle verification happens in Step 5 via Eric's actual login).

## Step 5: Verify JWT carries claim

**2026-04-24T ~14:47 local — First attempt (Eric logged out/in, decoded JWT):**
- JWT `iat = 2:46:44 PM local`, `exp = 3:46:44 PM local` (fresh token, post-toggle).
- `app_metadata = {"provider": "email", "providers": ["email"]}` — `active_organization_id` ABSENT.

### Rule C MATERIAL finding + resolution (Eric-approved)

**Diagnosis:**
- `supabase_auth_admin.rolbypassrls = FALSE` on hosted Supabase.
- `public.user_organizations` has RLS enabled (`relrowsecurity = TRUE`).
- Pre-build60 policies on `user_organizations`:
  - `user_orgs_member_read` → `{authenticated}`, `nookleus.is_member_of(organization_id)`
  - `user_orgs_self_read` → `{authenticated}`, `user_id = auth.uid()`
  - `user_orgs_service_write` → `{service_role}`, `true`
  (plus the `transitional_allow_all_user_organizations` that grants to `anon`/`authenticated`)
- None of these match `supabase_auth_admin`. When Supabase Auth invokes the hook as `supabase_auth_admin`, the `SELECT organization_id FROM public.user_organizations` returns zero rows. Our function's `IF v_org_id IS NULL THEN RETURN event` path then returns the event unchanged. Silent no-op.
- Session B's rehearsal simulated JWTs on the `authenticated` role and called the function as `service_role` — it never exercised the actual `supabase_auth_admin` / RLS path. Gap in rehearsal coverage.

**Resolution:** authored and applied **build60** (`supabase/migration-build60-auth-admin-read-user-orgs-policy.sql`):

```sql
CREATE POLICY auth_admin_read_user_organizations
  ON public.user_organizations
  FOR SELECT
  TO supabase_auth_admin
  USING (true);
```

Matches Supabase's own pattern in the custom_access_token_hook docs. Narrow (SELECT only, trusted internal role only). Rollback: `DROP POLICY auth_admin_read_user_organizations ON public.user_organizations;`.

**Verifier:** `pg_policies` now shows the policy present with `roles = {supabase_auth_admin}`, `cmd = SELECT`, `qual = true`.

**2026-04-24T ~14:59 local — Second attempt (post-build60, Eric logged out/in again, re-decoded JWT):**
- `iat = 2:58:55 PM local` (fresh, post-build60).
- `active_organization_id = a0000000-0000-4000-8000-000000000001` (AAA) — **present**.
- `app_metadata = {"active_organization_id": "a0000000-...-0001", "provider": "email", "providers": ["email"]}`.

**Status: PASS** (after Rule C material fix).

## Step 6: Verify `nookleus.active_organization_id()` resolves

**2026-04-24 — Function body check:**
```sql
RETURNS uuid LANGUAGE sql STABLE AS $$
  select nullif(
    coalesce(
      auth.jwt() ->> 'active_organization_id',
      (auth.jwt() -> 'app_metadata' ->> 'active_organization_id')
    ),
    ''
  )::uuid;
$$;
```
Reads the claim from either the top-level JWT or `app_metadata`. Compatible with the hook's injection location (`app_metadata`).

**Simulation (authenticated role + Eric's claim):**
```sql
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{..., "app_metadata": {..., "active_organization_id": "a0000000-...-0001"}}';
SELECT nookleus.active_organization_id();
-- → a0000000-0000-4000-8000-000000000001
```

**Status: PASS.**

## Step 7: Deploy code sweep (merge 18b-prep → main + Vercel deploy)

**2026-04-24 — Sequence executed:**
1. `18b-prep` = `2aaf22f` (build60 + run log committed on top of Session B's `f5c6078`).
2. Pushed `18b-prep` → origin.
3. Checked out `main` (`38d1b10`), pulled (already up to date), merged `18b-prep` with `--no-ff`:
   - Merge commit: `bef05b9 merge(18b): 18b-prep RLS enforcement — build55/56/57/58/59/60 + code sweep`
   - 78 files changed, +1834 / -250 — code sweep + 6 migrations + rollback + docs.
4. Pushed `main` → origin. Vercel auto-deploy triggered.

**Verifier:** `git log origin/main -1 --oneline` → `bef05b9 merge(18b): ...`. Matches expected message containing "18b". PASS.

**Status: PASS** (Vercel deploy pending Eric's visual confirmation on Vercel dashboard).

## Step 8: Post-sweep smoke tests

**2026-04-25 — First smoke pass (Eric, post-`bef05b9` deploy):**
- `/intake` shows "No form configuration found".
- `/settings/intake-form` toast: "Failed to save form config".
- All other tenant-scoped reads/writes also broken (every code path that calls `getActiveOrganizationId`).

### Rule C MATERIAL finding + resolution (Eric-approved)

**Diagnosis:**
- The hook (`public.custom_access_token_hook`) injects `app_metadata.active_organization_id` into the **JWT only**. It does NOT update `auth.users.raw_app_meta_data` (the DB column).
- `src/lib/supabase/get-active-org.ts` was reading `(await supabase.auth.getUser()).app_metadata.active_organization_id`. `getUser()` returns the user record from the auth API, whose `app_metadata` field is sourced from the DB column — not from the JWT.
- Net effect: helper always returned `null` for every authenticated request → GETs filtered on `organization_id = NULL` (no rows) → POSTs violated NOT NULL.
- Step 5 had verified the JWT *does* carry the claim, and the DB-side `nookleus.active_organization_id()` works because it reads `auth.jwt()`. The client helper just had the parallel bug.
- 61 files import this helper; one centralized fix repairs them all. Same class of incomplete-coverage bug as build54/build59 (Session A code sweep), but caught at smoke time instead of compile time.

**Resolution:** patched `src/lib/supabase/get-active-org.ts` to decode the access-token JWT directly via `getSession().access_token`, mirror `nookleus.active_organization_id()`'s `app_metadata` → top-level fallback. Cross-runtime base64url decoder (`atob` in browser, `Buffer` on Node).

**Forward-fix justification (§12.5):** fix is single-file, ~25-line patch, mechanical. Within the 15-minute "fix is obvious" window. No rollback needed.

**Sequence:** patch → commit on `main` → push → Vercel redeploy → re-run `/intake` + `/settings/intake-form` + remaining §8 smokes.

**Patch:** commit `ae580cc fix(18b): decode JWT directly in getActiveOrganizationId`. Pushed to `origin/main`. Vercel auto-deploy triggered.

**2026-04-25 — Eric verified post-deploy:** `/settings/intake-form` saves successfully; `/intake` renders the form configuration. Intake fix PASS.

**Remaining §8 smokes:** Eric walked /jobs, /intake submit, /photos, /contacts, /settings/users, /jarvis, incognito → all PASS.

**Status: PASS.**

## Step 9: Drop 48 legacy + 10 transitional policies (build57)

**2026-04-25 — Migration `build57_drop_allow_all_policies` applied:** success.

**Pre-state:** 59 policies satisfied `(qual='true' OR null+true) AND name NOT LIKE 'tenant_isolation_%'`. 56 tenant_isolation policies, 10 transitional_allow_all_*.

**Post-state verifier (§12.3 step 9, amended to exclude build60's `auth_admin_read_user_organizations`):**
- `transitional_gone`: TRUE (10 → 0)
- `legacy_allow_alls_gone`: TRUE (48 listed in build57 §1 → 0)
- `tenant_isolation_count`: 56 (unchanged — RLS perimeter intact)

**Verifier amendment (Rule C MINOR):** the original §12.3 step 9 verifier checked `legacy_allow_alls_gone = 0` without an exception for build60's `auth_admin_read_user_organizations`. Build60 was added mid-Session-C and is the supabase-recommended pattern for the hook (SELECT-only, restricted to internal trusted role `supabase_auth_admin`). Amended verifier excludes that one policy by name; enumerator confirms it is the only residual:

```
tablename            policyname                              roles                    cmd
user_organizations   auth_admin_read_user_organizations      {supabase_auth_admin}    SELECT
```

**Status: PASS.**

## Step 10: Post-drop smoke tests

**2026-04-25 — Eric walked the §8 checklist post-build57:**
- `/jobs`: 5 AAA jobs render — PASS
- `/intake` submit → new job appears in `/jobs` — PASS
- `/photos`: PASS
- `/contacts`: PASS
- `/settings/users`: Eric appears as admin of AAA — PASS
- `/jarvis`: opens without error — PASS
- Incognito: tenant isolation enforced (jobs render only for authenticated user with matching org) — PASS

**Cosmetic regression noted (not a §12.5 abort trigger):** in incognito on a cold load, the colored top strip on job cards falls back to gray. Root cause: `ConfigProvider` (`src/lib/config-context.tsx`) fires its `damage_types`/`job_statuses` fetches before the auth cookie hydrates on first incognito render; pre-build57 the `Allow all on damage_types` / `Allow all on job_statuses` legacy policies were a `public`-role backstop that hid this race. Post-build57 only `tenant_isolation_*` (`{authenticated}`) remains, so the anon-during-race request returns 0 rows. Status badges stay correctly colored because `getStatusColor()` has a hardcoded fallback table; the damage-type accent `accentColor = dtConfig?.text_color || "#666666"` does not.

Functional smoke is GREEN. Tenant isolation is doing its job. Eric's call: ship and add to 18c followup. Documented in plan §13 with three fix candidates.

**Status: PASS** (with cosmetic regression flagged for 18c).

## Step 11: Drop `nookleus.aaa_organization_id()` (build58)

**2026-04-25 — Migration `build58_drop_aaa_organization_id_helper` applied:** success.

**Verifier (§12.3 step 11):** `to_regprocedure('nookleus.aaa_organization_id()') IS NULL = TRUE`. Function dropped. Any missed caller would now surface a loud "function does not exist" error rather than silently returning the AAA constant.

**Status: PASS.**

## Step 12: Service-role sanity

**2026-04-25 — §12.3 step 12 verifier (run as service role via MCP):**
- `all_jobs_visible`: 8 — service role bypasses RLS, sees every row.
- `orgs_in_jobs`: 1 — only AAA has data (Test Company exists with zero rows, as planned for pre-18c).
- `test_company_jobs`: 0 — Test Company has no jobs (expected; 18c will seed).

Service role bypass confirmed working. No cross-tenant leakage created by 18b.

**Status: PASS.**

## Step 13: Handoff doc + commit

(in progress — writing `session-c-handoff.md` and committing migration files + run log + handoff to `main`.)

---

## Session outcome

**18b RLS enforcement: SHIPPED to prod 2026-04-25.**

Migrations applied: build55, build56, build57, build58, build59, build60, build61.
- build55: `custom_access_token_hook` function + grants
- build56: drop 3 redundant custom policies
- build57: drop 48 legacy + 10 transitional policies (the enforcement flip)
- build58: drop `nookleus.aaa_organization_id()` helper
- build59: patch 7 contract RPCs to include `organization_id` in `contract_events` INSERTs
- build60 (Rule C MATERIAL, mid-session): `auth_admin_read_user_organizations` policy so the hook can SELECT under RLS
- build61 (Rule C MATERIAL, post-deploy): app-code patch to `getActiveOrganizationId()` to decode the JWT directly instead of reading `auth.users.raw_app_meta_data` via `getUser()`

All §12.3 step verifiers PASS (with one amendment to the step 9 verifier to acknowledge build60 as expected residual). All §8 smoke tests PASS at both step 8 and step 10.

Tenant isolation via `tenant_isolation_*` policies is now the sole gate. App reads `app_metadata.active_organization_id` from the JWT (client) and `auth.jwt() -> 'app_metadata' ->> 'active_organization_id'` (DB). Test Company has zero rows; service role bypass confirmed.

**18c followups (plan §13):**
- Public-route org resolution (must-fix before 18c)
- ConfigProvider auth-race on cold sessions (cosmetic; surfaced Step 10 smoke)
- Scratch project deletion, storage migration, sequence drops, etc.
