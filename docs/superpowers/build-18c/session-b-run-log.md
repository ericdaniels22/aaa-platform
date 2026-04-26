# Build 18c — Session B Run Log

**Started:** 2026-04-25 (continued into 2026-04-26)
**Branch:** `18c-prep`
**Branch HEAD at start:** `3208053` (prep(18c): build62 + 62b migrations, switcher UI, public-route audit)
**Scratch project ID:** `prxjeloqumhzgobgfbwg` (`aaa-platform-scratch-18b`, postgres 17.6.1.105)
**Prod project ID:** `rzzprgidqbnqcdupmpfe` — read-only baseline reference, NOT touched in this session
**Author:** Claude Code (Session B)

Every Supabase MCP call below explicitly names `project_id=prxjeloqumhzgobgfbwg`. No prod DDL/DML. No pushes to main. All work stays on `18c-prep`.

---

## 0. Pre-flight — baseline parity check

Eric independently verified prod's post-18b state at session start (per session prompt):

| Check | Prod (Eric) |
|---|---|
| `tenant_isolation_*` policies | 56 |
| `transitional_allow_all_*` policies | 0 |
| Total `public` policies | 75 |
| `user_organizations` policies | 3 (incl. `auth_admin_read_user_organizations` for `{supabase_auth_admin}`) |
| `custom_access_token_hook(jsonb)` exists | TRUE |
| `nookleus.active_organization_id()` / `nookleus.is_member_of(uuid)` exist | TRUE |
| `nookleus.aaa_organization_id()` dropped | TRUE |
| `user_organizations.is_active` column absent | TRUE |
| `public.set_active_organization` RPC absent | TRUE |
| `public.organizations` count | 2 (AAA + Test Co) |
| `public.user_organizations` count | 1 (Eric → AAA admin) |

Initial scratch parity query (`execute_sql`, project_id=`prxjeloqumhzgobgfbwg`):

```sql
SELECT
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'tenant_isolation_%') AS tenant_isolation_count,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'transitional_allow_all_%') AS transitional_count,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public') AS total_public_policies,
  (SELECT to_regprocedure('public.custom_access_token_hook(jsonb)') IS NOT NULL) AS hook_exists,
  (SELECT to_regprocedure('nookleus.active_organization_id()') IS NOT NULL) AS active_org_id_fn_exists,
  (SELECT to_regprocedure('nookleus.is_member_of(uuid)') IS NOT NULL) AS is_member_fn_exists,
  (SELECT to_regprocedure('nookleus.aaa_organization_id()') IS NULL) AS aaa_org_id_dropped,
  (SELECT to_regprocedure('public.set_active_organization(uuid)') IS NULL) AS set_active_rpc_absent,
  (SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_organizations' AND column_name='is_active')) AS is_active_column_absent,
  (SELECT count(*) FROM public.organizations) AS org_count,
  (SELECT count(*) FROM public.user_organizations) AS user_org_count,
  (SELECT count(*) FROM auth.users) AS auth_user_count;
```

Result:

```json
{
  "tenant_isolation_count": 56,
  "transitional_count": 0,
  "legacy_allow_alls": 0,
  "total_public_policies": 74,
  "hook_exists": true,
  "active_org_id_fn_exists": true,
  "is_member_fn_exists": true,
  "aaa_org_id_dropped": true,
  "set_active_rpc_absent": true,
  "is_active_column_absent": true,
  "org_count": 2,
  "user_org_count": 1,
  "auth_user_count": 1
}
```

Detail follow-ups (`execute_sql`, project_id=`prxjeloqumhzgobgfbwg`):

- Orgs / memberships / users:
  - `auth_user`: `7c55cdd0-2cbf-4c8a-8fdd-e141973ade94` / `eric@aaacontracting.com`
  - `membership`: Eric → AAA admin
  - `orgs`: AAA Disaster Recovery (`a0000000-0000-4000-8000-000000000001`) + Test Company (`a0000000-0000-4000-8000-000000000002`)
- `user_organizations` policies pre-fix: only `user_orgs_member_read` and `user_orgs_self_read`, both `{authenticated}`. **No `auth_admin_read_user_organizations`.**
- Hook function body: matches build55 (earliest-by-`created_at`, no `is_active` reference) — correct for pre-build62 state.
- Hook EXECUTE grants: includes `supabase_auth_admin` ✅
- `user_organizations` table-level grants: include `supabase_auth_admin` SELECT ✅
- Eric `auth.users` row: `email_confirmed_at` set, `confirmation_token` / `recovery_token` / `email_change` are empty strings (not NULL — the build52 fix), bcrypt password hash present.
- `list_migrations` (scratch): `scratch_18b_seed_fixtures`, `build55_custom_access_token_hook`, `build59_contract_event_rpcs_organization_id`, `build56_drop_redundant_custom_policies`, `build57_drop_allow_all_policies`, `build58_drop_aaa_helper`. **build60 absent.**

---

## Finding #1 — Rule C MATERIAL (RESOLVED)

**Title:** Scratch missing `build60.auth_admin_read_user_organizations` policy.

**Detected at:** Pre-flight parity check, before any DDL.

**Evidence:**
- Total `public` policies: scratch 74 vs prod 75.
- `user_organizations` policies: scratch 2 (`user_orgs_member_read`, `user_orgs_self_read`, both `{authenticated}`) vs prod 3 (those two + `auth_admin_read_user_organizations` for `{supabase_auth_admin}`).
- `list_migrations` confirmed build60 absent from scratch — scratch was used for 18b Session B BEFORE build60 was discovered live in 18b Session C as a Rule C MATERIAL.

**Why it would have broken Session B:** Without build60, the `custom_access_token_hook` SELECTs zero rows when invoked as `supabase_auth_admin` (table-level GRANT exists, but no RLS policy applies to that role). The hook's `IF v_org_id IS NULL THEN RETURN event` path silently emits a JWT without `app_metadata.active_organization_id`. **This is the exact failure mode 18b Session C surfaced live with Eric's first real login.** Step 1 of this session's mandated 5-step real-auth round-trip would have re-discovered it instead of validating build62.

**Plan §4.2 (auth path can't be fully simulated in scratch) correctly anticipated this exact gap. Caught at parity check rather than mid-rehearsal — exactly the failure-mode-prevention this session was designed to deliver.**

**Resolution:** Stopped, surfaced finding to Eric with proposed fix + risk + approval ask. Eric confirmed dashboard auth-hook config is enabled in scratch and approved applying `supabase/migration-build60-auth-admin-read-user-orgs-policy.sql` byte-identical to prod via `apply_migration` (name `build60_auth_admin_read_user_orgs_policy`).

**Apply:** `apply_migration` with `project_id=prxjeloqumhzgobgfbwg`, `name=build60_auth_admin_read_user_orgs_policy`. Body:

```sql
CREATE POLICY auth_admin_read_user_organizations
  ON public.user_organizations
  FOR SELECT
  TO supabase_auth_admin
  USING (true);
```

Result: `{"success":true}`.

**Post-apply verification:**

```sql
SELECT
  (SELECT count(*) FROM pg_policies WHERE schemaname='public') AS total_public_policies,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='user_organizations') AS user_orgs_policies,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'tenant_isolation_%') AS tenant_isolation_count,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'transitional_allow_all_%') AS transitional_count;
```

Result:
```json
{ "total_public_policies": 75, "user_orgs_policies": 3, "tenant_isolation_count": 56, "transitional_count": 0 }
```

`user_organizations` policies after fix:
| policyname | cmd | roles | qual | with_check |
|---|---|---|---|---|
| `auth_admin_read_user_organizations` | SELECT | `{supabase_auth_admin}` | `true` | (none) |
| `user_orgs_member_read` | SELECT | `{authenticated}` | `nookleus.is_member_of(organization_id)` | (none) |
| `user_orgs_self_read` | SELECT | `{authenticated}` | `(user_id = auth.uid())` | (none) |

`list_migrations` after fix includes:
- `20260426051238 build60_auth_admin_read_user_orgs_policy` ✅

Scratch parity with prod restored. Disposition: **MATERIAL — RESOLVED**.

---

## 1. Apply build62 to scratch

Migration body byte-identical to `supabase/migration-build62-user-orgs-active-flag.sql`. Applied via `apply_migration` with `project_id=prxjeloqumhzgobgfbwg`, `name=build62_user_orgs_active_flag`. Result: `{"success":true}`.

**Post-apply verification (single execute_sql):**

| Check | Expected | Actual |
|---|---|---|
| `is_active` column type | `boolean` | `boolean` ✅ |
| `is_active` nullable | NO | NO ✅ |
| `is_active` default | `false` | `false` ✅ |
| Backfill: rows with `is_active=true` | == count(distinct user_id) | 1 == 1 ✅ |
| Partial unique index `user_orgs_one_active_per_user` exists | TRUE | TRUE ✅ |
| Index def has `WHERE (is_active = true)` | TRUE | TRUE ✅ |
| Hook function body references `is_active = true` | TRUE | TRUE ✅ |
| Hook function body still has `ORDER BY created_at ASC` (defensive fallback) | TRUE | TRUE ✅ |

Hook EXECUTE grants after build62: `postgres`, `service_role`, `supabase_auth_admin` (anon + authenticated REVOKED — matches the migration body's explicit revoke).

Eric's existing membership row remains correctly active:
```
user_id=7c55cdd0-…  org=AAA  role=admin  is_active=true  created_at=2026-04-23 21:01:57
```

`list_migrations` after apply: includes `20260426051407 build62_user_orgs_active_flag` ✅.

**Build62 PASS** — column, backfill, partial unique index, hook update, grants all verified.

---

## 2. Apply build62b to scratch

Migration body byte-identical to `supabase/migration-build62b-set-active-organization-rpc.sql`. Applied via `apply_migration`, `project_id=prxjeloqumhzgobgfbwg`, `name=build62b_set_active_organization_rpc`. Result: `{"success":true}`.

**Post-apply verification:**

| Check | Expected | Actual |
|---|---|---|
| `proname` | `set_active_organization` | `set_active_organization` ✅ |
| `prosecdef` (SECURITY DEFINER) | TRUE | TRUE ✅ |
| Argument signature | `p_org_id uuid` | `p_org_id uuid` ✅ |
| `proconfig` | `[search_path=public]` | `["search_path=public"]` ✅ |
| Return type | `void` | `void` ✅ |
| EXECUTE grants | `authenticated` only (plus implicit `postgres`) | `{authenticated, postgres}` — `anon`/`public`/`service_role` correctly absent ✅ |

`list_migrations` after apply: includes `build62_user_orgs_active_flag` and `build62b_set_active_organization_rpc`.

**Build62b PASS** — SECURITY DEFINER, search_path, void return, grants all match plan §5.2.

---

## 3. Seed real test user

Per deliverable §4 — created via `execute_sql` (not migration) since this is transient session data.

**Test user identity:**
- email: `claude-test-b@aaaplatform.test`
- user_id: `b0000000-0000-4000-8000-00000000c1aa` (stable for reproducibility)
- password: `Sb18cTest!RehearsalB2026` (bcrypt-hashed via `crypt(pw, gen_salt('bf', 10))`)
- email_confirmed_at: now()
- All GoTrue token columns set to empty string per build52 fix (confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
- raw_app_meta_data: `{"provider":"email","providers":["email"]}`

**Auxiliary rows:**
- `auth.identities` — `provider=email`, `provider_id = user_id::text`, identity_data with `sub`, `email`, `email_verified=true`. (Note: `email` column on `auth.identities` is GENERATED — must not be explicitly inserted.)
- `public.user_profiles` — `full_name='Claude Session B Test'` (FK requirement on `user_organizations`).
- `public.user_organizations` — TWO rows:
  - AAA, role=admin, is_active=true
  - Test Co, role=admin, is_active=false

**Seed verification:**
```json
{
  "users_seeded": 1,
  "identities_seeded": 1,
  "profile_seeded": 1,
  "memberships_seeded": 2,
  "active_memberships": 1,
  "active_org_id": "a0000000-0000-4000-8000-000000000001"
}
```

**Test user seed PASS.**

### Operational note — Rule C MINOR (logged for awareness, not numbered as a Finding)

**Title:** Inserting two memberships in a single transaction with `now()` produces identical `created_at` timestamps.

**Detected at:** seed step.

**Why noted:** the build62 backfill uses `DISTINCT ON (user_id) … ORDER BY user_id, created_at ASC` to pick the "earliest" membership for each user. When two rows share a `created_at` (microsecond-precise tie), the backfill is non-deterministic — Postgres chooses one based on physical row order or `ctid`. **The hook's defensive fallback (when no `is_active` row exists) ALSO orders by `created_at ASC` and has the same property.**

**Production impact:** none. In production, memberships are added one user-action at a time, so two rows would never share `created_at` to microsecond precision in practice.

**Test artifact impact:** confirmed during the rollback round-trip in §7 — after re-applying build62, the backfill picked the Test Co membership instead of the AAA one for the test user, because the seed inserts share `created_at`. Worked around by explicitly setting `is_active = true` on the AAA row after re-apply.

(Numbered Findings in this run-log are reserved for Rule C MATERIAL items. This MINOR is recorded inline above for traceability.)

**Disposition:** MINOR — noted only. Suggest a future plan-followup if production ever bulk-inserts memberships (e.g., a "join all of these orgs" action), tie-break by `id` or insert with deliberate small `pg_sleep` between rows.

---

## 4. Real auth-API 5-step round-trip — THE CRITICAL SESSION B TEST

This is the test 18b's Session C lacked: a real `signInWithPassword` round-trip via the actual Supabase auth API, exercising the `supabase_auth_admin` execution path that simulated JWTs cannot reach.

**Mechanism:** Node script `scripts/session-b/auth-roundtrip.mjs` using `@supabase/supabase-js` v2.101.1 (real client; `persistSession:false` so each phase explicitly sets+passes session tokens). Anon key for project `prxjeloqumhzgobgfbwg`. Password supplied via `SESSION_B_PASSWORD` env var.

**Run:** `cd nervous-goodall-bdf253 && SESSION_B_PASSWORD='…' node scripts/session-b/auth-roundtrip.mjs`. Captured to `/tmp/session-b-roundtrip.txt` (140 lines). Script exit code: **0**.

### Step 1: signInWithPassword
```json
{
  "label": "step1_signin",
  "pass": true,
  "expected_org": "a0000000-0000-4000-8000-000000000001",
  "actual_org": "a0000000-0000-4000-8000-000000000001",
  "claims": {
    "sub_redacted": "b0000000…c1aa",
    "aud": ["authenticated"],
    "role": "authenticated",
    "email": "claude-test-b@aaaplatform.test",
    "iat": 1777180903, "exp": 1777184503,
    "app_metadata": {
      "active_organization_id": "a0000000-0000-4000-8000-000000000001",
      "provider": "email", "providers": ["email"]
    }
  },
  "refresh_token_present": true
}
```
**`app_metadata.active_organization_id` is present and equals AAA — the auth hook fired correctly via the `supabase_auth_admin` path.** This is the assertion 18b Session B couldn't make. PASS.

### Step 2: rpc('set_active_organization', { p_org_id: TestCo })
```json
{ "label": "step2_rpc_to_testco", "pass": true, "rpc_returned": null }
```
RPC succeeded silently (`void` return type). PASS.

### Step 3: refreshSession after switch
```json
{
  "label": "step3_refresh_after_testco",
  "pass": true,
  "expected_org": "a0000000-0000-4000-8000-000000000002",
  "actual_org": "a0000000-0000-4000-8000-000000000002",
  "claims": { "app_metadata": { "active_organization_id": "a0000000-0000-4000-8000-000000000002", "...": "..." } },
  "refresh_returned_new_access_token": true
}
```
**The hook re-fired during refreshSession and saw the new flag state.** This is the second-most-important assertion: refresh-token path (which previously couldn't be simulated via `SET LOCAL request.jwt.claims`) actually invokes the hook. PASS.

### Step 4: rpc back to AAA + refreshSession
```json
{
  "label": "step4_refresh_after_aaa",
  "pass": true,
  "expected_org": "a0000000-0000-4000-8000-000000000001",
  "actual_org": "a0000000-0000-4000-8000-000000000001",
  "claims": { "app_metadata": { "active_organization_id": "a0000000-0000-4000-8000-000000000001", "...": "..." } }
}
```
Round-trip works in both directions. The RPC's clear-then-set ordering (build62b §5.2) does not transiently violate the partial unique index. PASS.

### Step 5: signOut + signInWithPassword again (the build60-discovery path)
```json
{ "label": "step5_signout", "pass": true }
{
  "label": "step5_signin_again",
  "pass": true,
  "expected_org": "a0000000-0000-4000-8000-000000000001",
  "actual_org": "a0000000-0000-4000-8000-000000000001",
  "claims": { "app_metadata": { "active_organization_id": "a0000000-0000-4000-8000-000000000001", "...": "..." } },
  "note": "active org should still be AAA — that was the state at end of step 4"
}
```
**Full re-auth cycle preserves the claim. This is exactly the path that surfaced build60 in 18b — and it works clean here because build60 is now present on scratch.** PASS.

### Final DB state confirmation
```sql
SELECT user_id, organization_id, role, is_active FROM public.user_organizations ORDER BY user_id, organization_id;
```
| user_id | organization_id | role | is_active |
|---|---|---|---|
| `7c55cdd0-…` (Eric) | AAA | admin | true |
| `b0000000-…c1aa` (test) | AAA | admin | true |
| `b0000000-…c1aa` (test) | Test Co | admin | false |

State matches step 4's RPC call (back to AAA). Atomicity verified — partial unique index never violated (would have errored). PASS.

**Round-trip summary: 6/6 assertions PASS, exit 0. The auth path that wasn't covered in 18b Session B is now covered.**

---

## 5. Public-route audit verification — PASS

### Finding #2 — Rule C MATERIAL — RESOLVED

**Title:** Deliverable §6 step b requires `SUPABASE_SERVICE_ROLE_KEY` for `prxjeloqumhzgobgfbwg`. Supabase MCP `get_publishable_keys` only exposes anon/publishable keys (security policy). No `.env.local` in any sibling worktree contains scratch credentials.

**Eric's adjudication:** path (A) — drop scratch service-role key in chat; run literal Eric-spec dev-server tests; do ConfigProvider race fix in the same dev-server session; restore env with byte-exact diff; recommend key rotation in handoff.

**Lesson (Eric's framing for the planning template):** *"Service role keys are not exposed via Supabase MCP by design. Future builds touching public routes that bypass RLS need to anticipate this tooling gap during planning, not discover it mid-rehearsal. Suggested adjustment to plan §11 Prompt B template: include a 'pre-flight: confirm executor has all credentials needed for deliverables' step."*

**Resolution:** Eric pasted scratch service-role key in chat. JWT decoded: `iss=supabase, ref=prxjeloqumhzgobgfbwg, role=service_role`. Backed up `nervous-goodall-bdf253/.env.local` to `/tmp/session-b-env-original.local` (md5 `cd588741…715e35`); 3 Edit calls swapped `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` to scratch values; diff confirmed only those 3 lines changed. (See Finding #3 for the additional eloquent worktree env swap.)

### Finding #3 — Rule C MINOR — Worktree env-wiring quirk

**Title:** `preview_start` (Claude Code MCP preview tool) launches `npm run dev` from the **session's worktree cwd** (`eloquent-aryabhata-da21c0`), not from the worktree whose `.claude/launch.json` matches the path. So Turbopack served eloquent-aryabhata's source files (which are on a different branch — `claude/eloquent-aryabhata-da21c0` — and have the **pre-Session-A** `?? AAA_ORGANIZATION_ID` fallback) AND used eloquent-aryabhata's `.env.local`.

**How it manifested:** First /sign hit returned `<title>AAA Disaster Recovery — Platform</title>` and "Document not found" against AAA contract `44444444…` because the dev server was talking to PROD (eloquent's pre-swap env) for a row only on scratch. Inspecting the rendered HTML chunks revealed `eloquent-aryabhata-da21c0` paths. `grep loadCompany` on eloquent's source confirmed it still imports `AAA_ORGANIZATION_ID` and calls `loadCompany()` (no arg), which falls back to AAA's hardcode — the bug Session A fixed in nervous-goodall.

**Resolution:**
1. `mcp__Claude_Preview__preview_stop` on the misrouted dev server.
2. Mirrored the env swap into `eloquent-aryabhata-da21c0/.env.local` (saved original to `/tmp/session-b-env-original-eloquent.local`, md5 `cd588741…715e35`; 3 Edit calls; diff confirmed 3 lines changed). The two worktrees had byte-identical `.env.local` because the SessionStart hook copies `.env.local` to new worktrees.
3. Restarted dev server explicitly inside `nervous-goodall-bdf253` cwd via `Bash run_in_background`. Turbopack now used 18c-prep source files.
4. Re-hit URLs — both /sign + /pay rendered correctly per-org (results below).
5. Both env files restored byte-exact (md5 match) at session end.

**Disposition:** MINOR — operational, contained, resolved. **Planning-template suggestion:** future builds that depend on `preview_start` against a non-session worktree should either (a) explicitly run `npm run dev` from the target worktree cwd via Bash + run_in_background, or (b) sync `.env.local` across both worktrees as part of the rehearsal prep.

### /sign for AAA — PASS

`curl http://localhost:3000/sign/<aaa_token>` → HTTP 200, 37460 bytes, 14.3s (first hit, Turbopack compile).

| Assertion | Expected | Actual |
|---|---|---|
| HeaderBlock company name (`<div class="text-lg font-semibold">`) | "AAA Disaster Recovery" | ✅ |
| HeaderBlock phone+email (`<div class="text-sm public-muted">`) | "(555) 111-2222 · support@aaadr.test" | ✅ |
| Contract title `<h1>` | "Work Authorization - Jane Smoketester" | ✅ |
| AAA brand assertions in body | (>0) | 2× brand, 1× phone, 1× email, 1× signer ✅ |
| Test Co data points | 0 | 0 ✅ no leak |

### /sign for Test Co — PASS

`curl http://localhost:3000/sign/<testco_token>` → HTTP 200, 37363 bytes, 0.9s.

| Assertion | Expected | Actual |
|---|---|---|
| HeaderBlock company name | "Test Company SaaS" | ✅ |
| HeaderBlock phone+email | "(555) 999-8888 · billing@testcompany.test" | ✅ |
| Contract title | "Work Authorization - Tina TestCo" | ✅ |
| Test Co brand assertions | (>0) | 1× brand, 1× phone, 1× email, 1× signer ✅ |
| AAA branding leak in HeaderBlock or contract content | 0 | 0 ✅ (the 2× "AAA Disaster Recovery" matches in raw HTML are the layout's hardcoded `<title>` + `<meta description>` — separate concern, not page-content branding) |

### /pay for AAA — PASS

`curl http://localhost:3000/pay/<aaa_pay_token>` → HTTP 200, 37439 bytes, 3.3s.

| Assertion | Expected | Actual |
|---|---|---|
| HeaderBlock company name | "AAA Disaster Recovery" | ✅ |
| Job number | "WTR-2026-0001" | ✅ |
| Title | "Deposit for WTR-2026-0001" | ✅ |
| Amount | $150.00 | ✅ |
| **Fee disclosure** (from `payment_email_settings.fee_disclosure_text` for AAA) | "AAA fee disclosure: 2.9% card fee may apply." | ✅ — proves §6.1.2 widening: query scopes by `pr.organization_id` |
| Stripe-payments-unavailable shell | NOT shown | ✅ — `stripe_connection` query for AAA found a row |
| Test Co data | 0 | 0 ✅ |

### /pay for Test Co — PASS (the §6.1.2 widening's headline assertion)

`curl http://localhost:3000/pay/<testco_pay_token>` → HTTP 200, 37662 bytes, 1.3s.

| Assertion | Expected | Actual |
|---|---|---|
| HeaderBlock company name | "Test Company SaaS" | ✅ |
| Job number | "TST-2026-0001" | ✅ |
| Title | "Deposit for TST-2026-0001" | ✅ |
| Amount | $250.00 | ✅ |
| **Fee disclosure** (from `payment_email_settings.fee_disclosure_text` for Test Co) | "TestCo fee disclosure: 3.5% surcharge applies to card transactions." | ✅ — DIFFERENT text from AAA's; proves the per-org scoping fix works |
| Stripe-payments-unavailable shell | NOT shown | ✅ — `stripe_connection` query for Test Co org found Test Co's row (different `card_fee_percent` and `stripe_account_id` than AAA's) |
| AAA data leak | 0 | 0 ✅ |

**This is the Session A widening (Rule C minor 6.1.2) verified end-to-end with a real HTTP request.** Pre-Session-A, `pay/[token]/page.tsx` queried `stripe_connection` and `payment_email_settings` with `.limit(1).maybeSingle()` — under multi-org reality that returns whichever row Postgres hands back first (often AAA). Post-fix, both queries are scoped by `.eq("organization_id", pr.organization_id)`. **Test Co's payment page now shows Test Co's fee disclosure text and Test Co's stripe connection details, not AAA's.**

### EMPTY_BRAND case (org has no company_settings) — PASS

Temporarily deleted Test Co's 4 `company_settings` rows (verified `count → 0`), then `curl /sign/<testco_token>`.

| Assertion | Expected | Actual |
|---|---|---|
| HeaderBlock falls back to "Contract Signing" (per `{company.name \|\| "Contract Signing"}`) | TRUE | ✅ |
| Phone/email line not rendered (empty `(company.phone \|\| company.email)`) | TRUE | ✅ (no `(555) …` strings) |
| AAA data leak | 0 | 0 ✅ — no AAA phone, email, address. The 2× layout `<title>` matches are the hardcoded metadata, not brand leak. |
| Contract title still correct | "Work Authorization - Tina TestCo" | ✅ — contract data still loads even when company_settings is empty |

**Confirms the EMPTY_BRAND fallback works as designed: when `loadCompany(orgId)` returns no rows, the route renders the empty-branding shell, NOT AAA's hardcoded fallback.** Re-inserted Test Co's 4 `company_settings` rows post-test (verified `count → 4`).

---

## 6. ConfigProvider race fix verification — PASS (code-level)

Plan §5.4 fix (approach a) — wait for auth state before fetching `damage_types`/`job_statuses`. Per plan §10 locked decision #4.

**Verification approach:** the fix is fundamentally a CLIENT-side React effect — the race only manifests when JS runs in a browser and the supabase auth cookie hasn't yet hydrated. `curl` cannot exercise this (server-side render uses cookies if present; the race is about client-side `useEffect` ordering). To dynamically test would require a real browser session with cold cache + valid auth cookie, which the dev-server-via-Bash setup didn't directly support.

**Code-level verification (`src/lib/config-context.tsx` on 18c-prep):**

The `useEffect` subscribes to `supabase.auth.onAuthStateChange`. On `INITIAL_SESSION`, `SIGNED_IN`, or `TOKEN_REFRESHED` events:
- If `session` is non-null: calls `refresh()` (fetches `damage_types` + `job_statuses` via the supabase client, which now has the hydrated session and queries as `authenticated`).
- If `session` is null: clears arrays + `setLoading(false)` so the route guard / login redirect can render without a blocked spinner.
- On `SIGNED_OUT`: clears arrays + `setLoading(false)`.

**Race-elimination property:**
- Pre-fix: `useEffect` fired `refresh()` on mount, before `INITIAL_SESSION` had resolved → fetch ran as anon → empty arrays → gray fallback strips on damage cards.
- Post-fix: `useEffect` only registers a subscription on mount; the actual fetch is gated on `INITIAL_SESSION` carrying a non-null session. By that point the auth cookie is hydrated and the supabase client queries as `authenticated` → tenant_isolation_* policies match → real rows returned → colored damage strips render on first paint.

Bonus property: `TOKEN_REFRESHED` triggers a re-fetch, which also handles the workspace-switcher's refresh-after-flag-flip case (per-org `damage_types`/`job_statuses` overrides may differ).

**Code-level verification: PASS.** Dynamic browser-based verification (cold incognito visit to /jobs) is deferred to Session C step 12 of plan §6, where Eric will perform the live smoke test as part of the human walkthrough. Acceptable because: the bug is a race between two well-defined client-side events (mount vs auth-state-resolution); the fix changes the ordering; the change is isolated to one component with no DB or auth-path ramifications; `npm run build` PASS.

---

## 7. Rollback round-trip migration test

Per deliverable §8 — verify rollback artifacts work and re-apply restores convergence.

**Phase 1 — Rollback build62b** (drop the RPC):
```sql
DROP FUNCTION IF EXISTS public.set_active_organization(uuid);
SELECT to_regprocedure('public.set_active_organization(uuid)') IS NULL AS rpc_dropped;
```
Result: `rpc_dropped = true`. ✅

**Phase 2 — Rollback build62** (revert hook → drop index → drop column, in that order per `supabase/build62-rollback.sql`):
```sql
-- Restore build55 hook body (no is_active reference, ORDER BY created_at ASC only)
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb) … (build55 body)
DROP INDEX IF EXISTS public.user_orgs_one_active_per_user;
ALTER TABLE public.user_organizations DROP COLUMN IF EXISTS is_active;
```
Result:
| Check | Expected | Actual |
|---|---|---|
| `hook_still_references_is_active` | FALSE | FALSE ✅ |
| `hook_is_build55_body` (ORDER BY created_at ASC, no is_active) | TRUE | TRUE ✅ |
| `index_still_exists` | FALSE | FALSE ✅ |
| `column_still_exists` | FALSE | FALSE ✅ |

Pre-build62 state restored. ✅

**Phase 3 — Re-apply build62** (column + backfill + index + hook update). Body byte-identical to migration. Executed via `execute_sql` (not `apply_migration`, since the migration history already records it).

**Phase 4 — Re-apply build62b** (RPC). Same.

**Convergence verification:**
| Check | Expected | Actual |
|---|---|---|
| Column back | TRUE | TRUE ✅ |
| Index back | TRUE | TRUE ✅ |
| Hook reads `is_active = true` | TRUE | TRUE ✅ |
| RPC back | TRUE | TRUE ✅ |
| Active count after re-apply backfill | 2 (Eric + test user) | 2 ✅ |
| Distinct users | 2 | 2 ✅ |

**Backfill artifact (Finding #2 manifested here):** the test user has two memberships with identical `created_at` (both seeded in same DO block, same `now()` call). Re-apply backfill picked Test Co for the test user (non-deterministic tie-break — physical row order). Worked around by explicit UPDATEs:
```sql
UPDATE user_organizations SET is_active=false WHERE user_id=test AND org_id=TestCo AND is_active=true;
UPDATE user_organizations SET is_active=true WHERE user_id=test AND org_id=AAA AND is_active=false;
```
Final state mirrors prod-style:
| user_id | organization_id | is_active |
|---|---|---|
| Eric | AAA | true |
| test | AAA | true |
| test | Test Co | false |

**Rollback round-trip PASS** with one MINOR test-artifact (Finding #2, already logged) requiring manual restoration of test seed state. **Production rollback workflow is unaffected** — prod can never have memberships with sub-microsecond identical `created_at` from real user actions.

---

## 8. npm run build

```bash
cd nervous-goodall-bdf253 && npm run build
```

Run as background task `bqirb31hz`. Exit code: **0**. Output: 40 lines (route table only — Turbopack suppressed compile messages, which is the same pattern Session A reported). `grep -iE "error|warn"` against the captured output: **no matches**.

Same as Session A. **Build PASS** with no new warnings.

---

## 9. Env restoration + tempfile cleanup

Per Eric's directive: byte-exact diff verification on env restore + delete tempfile.

```bash
cp /tmp/session-b-env-original.local nervous-goodall-bdf253/.env.local
cp /tmp/session-b-env-original-eloquent.local eloquent-aryabhata-da21c0/.env.local

diff /tmp/session-b-env-original.local nervous-goodall-bdf253/.env.local         # exit 0 (identical)
diff /tmp/session-b-env-original-eloquent.local eloquent-aryabhata-da21c0/.env.local  # exit 0 (identical)

md5sum (all four files)
# cd588741635ceec3dd3cfa0d39715e35  /tmp/session-b-env-original.local
# cd588741635ceec3dd3cfa0d39715e35  nervous-goodall-bdf253/.env.local
# cd588741635ceec3dd3cfa0d39715e35  /tmp/session-b-env-original-eloquent.local
# cd588741635ceec3dd3cfa0d39715e35  eloquent-aryabhata-da21c0/.env.local

grep "^NEXT_PUBLIC_SUPABASE_URL" nervous-goodall-bdf253/.env.local eloquent-aryabhata-da21c0/.env.local
# both → https://rzzprgidqbnqcdupmpfe.supabase.co (PROD restored)

rm /tmp/session-b-env-original.local /tmp/session-b-env-original-eloquent.local /tmp/session-b-tokens.json /tmp/session-b-roundtrip.txt /tmp/sign_*.html /tmp/pay_*.html
# 12 files removed
```

**Restoration verified.** Both worktree env files are byte-identical to their pre-Session-B state. All Session B tempfiles deleted.

**🔐 KEY ROTATION RECOMMENDATION (passed to handoff for Eric's attention):** the scratch `service_role` key was visible in Eric's chat message and briefly written to `.env.local` (worktree-local, gitignored). Restored to original (prod) value via byte-exact diff. **Eric should rotate the scratch service-role key in the Supabase dashboard before Session C** as a defense-in-depth measure (Settings → API → service_role → "Generate new key"). Scratch carries no production data, but key hygiene matters; the new key isn't needed until/unless a future session needs another scratch dev-server run.

---

## 10. Scratch state at end of Session B

Left as fixtures for any follow-up runs (Eric can clean up by running `delete_branch`/project pause when scratch is no longer needed):

- `auth.users` + `auth.identities` + `public.user_profiles` + `public.user_organizations`: test user `claude-test-b@aaaplatform.test` (`b0000000-…c1aa`) with memberships in BOTH AAA (active) and Test Co (inactive). Password remains `Sb18cTest!RehearsalB2026`.
- AAA chain (pre-existing + Session B-added auxiliaries):
  - 1 `contracts` row (`44444444-…`), `link_token` is the mint-tokens.mjs-generated JWT (will expire 30 days from mint, ~2026-05-26)
  - 1 `contract_signers` row (`55555555-…`), 1 `contract_templates` (`33333333-…`), 1 `jobs` (`22222222-…`), 1 `contacts` (existing)
  - 1 `payment_requests` row (`77777777-…`), `link_token` is the mint-tokens.mjs-generated JWT
  - 4 `company_settings` rows (Session B added: company_name, phone, email, address)
  - 1 `stripe_connection` row (Session B added)
  - 1 `payment_email_settings` row (Session B added)
- Test Co chain (entirely Session B-added):
  - 1 `contracts` (`f0000022-c011-…`), `link_token` is the mint-tokens.mjs-generated JWT
  - 1 `contract_signers` (`f0000022-5181-…`), 1 `contract_templates` (`f0000022-7e70-…`), 1 `jobs` (`f0000022-1010-…`, `TST-2026-0001`), 1 `contacts` (`f0000022-c0c0-…`)
  - 1 `payment_requests` (`f0000022-9091-…`), `link_token` is the mint-tokens.mjs-generated JWT
  - 4 `company_settings` rows (re-inserted after EMPTY_BRAND test)
  - 1 `stripe_connection` row, 1 `payment_email_settings` row
- Migration history additions (`list_migrations`):
  - `20260426051238 build60_auth_admin_read_user_orgs_policy`
  - `20260426051407 build62_user_orgs_active_flag`
  - `20260426 (later) build62b_set_active_organization_rpc`

**No prod DDL/DML** was performed in this session (Session B is rehearsal only). All work is on the scratch project `prxjeloqumhzgobgfbwg`.

---

