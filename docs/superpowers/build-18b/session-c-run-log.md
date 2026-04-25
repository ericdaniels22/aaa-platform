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

**Status: in progress — patch committed, awaiting deploy + re-test.**

## Step 5: Verify JWT carries claim

(pending)

## Step 6: Verify `nookleus.active_organization_id()` resolves

(pending)

## Step 7: Deploy code sweep (merge 18b-prep → main)

(pending)

## Step 8: Post-sweep smoke tests

(pending)

## Step 9: Drop 48 legacy + 10 transitional policies (build57)

(pending)

## Step 10: Post-drop smoke tests

(pending)

## Step 11: Drop `nookleus.aaa_organization_id()` (build58)

(pending)

## Step 12: Service-role sanity

(pending)

## Step 13: Handoff doc + commit

(pending)

---

## Session outcome

(pending)
