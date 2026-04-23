# Build 18b — RLS Enforcement & Active Organization Resolution

**Status:** Planning
**Version:** 2 (adds §12 Pause & Resume Procedures)
**Drafted:** 2026-04-23
**Depends on:** Build 18a (complete, commit `c19278a` on main)
**Precedes:** Build 18c (workspace switcher UI + Eric's Test Company membership)

---

## 1. Context & Goals

Build 18a added multi-tenant schema structure to the platform: every row is now tagged with `organization_id`, parallel `tenant_isolation_*` policies are in place alongside legacy allow-all policies, and a `custom_access_token_hook` function is expected (but was not actually created during 18a — see §3). Today, tenant isolation is **non-enforcing**: every query still returns AAA's data because the app code hardcodes the AAA org ID via `nookleus.aaa_organization_id()`.

**Build 18b flips enforcement on.** After this build ships:

- Every authenticated user's JWT carries an `app_metadata.active_organization_id` claim.
- Application code reads `getActiveOrganizationId()` from the JWT claim, not from the AAA constant.
- Row-level security is the tenant gate — not code discipline.
- The 48 legacy allow-all policies and 10 transitional patches from build53 are dropped.
- Only the 56 `tenant_isolation_*` policies and ~18 legitimate custom policies remain.

The effect for Eric: once 18b ships, any future user (or any future switch to Test Company) will see only the rows belonging to their active org. Today only AAA has members, so Eric continues to see AAA data — but now the mechanism is real tenant isolation, not a constant.

---

## 2. Non-Goals

Explicitly out of scope for 18b:

- **Workspace switcher UI.** No sidebar dropdown, no "Switch to Test Company" button. That's 18c.
- **Eric's membership in Test Company.** He stays AAA-only. Adding him to Test Company is 18c (the switcher needs data to switch into).
- **Actually using Test Company for anything.** It stays empty, as confirmed in planning.
- **Dropping `user_permissions` table.** Stays for at least two weeks post-18b for rollback safety.
- **Storage path migration.** Deferred — app handles both layouts.
- **Deleting scratch project.** Hold until 18b prod is stable for 24h, then delete.

---

## 3. Current State (Ground Truth, verified 2026-04-23)

Queried directly from production:

| Category | Count | Purpose |
|---|---|---|
| `tenant_isolation_*` policies | 56 | Real tenant gates across 50 tables; active but non-enforcing today |
| Legacy allow-all policies | 48 | Pre-18a permissive; DROP in 18b |
| `transitional_allow_all_*` policies | 10 | Build53 patch; DROP in 18b |
| Other custom policies | 21 | Narrower than allow-all; review each, KEEP most |

**Critical gap vs 18a plan:**

- `public.custom_access_token_hook(jsonb)` **does not exist.** The 18a handoff doc claimed it was "created but not enabled." Actually never created. 18b creates *and* enables it.
- `nookleus.active_organization_id()` exists and returns NULL today (no JWT claim to read).
- `nookleus.is_member_of(uuid)` exists and works.
- `nookleus.aaa_organization_id()` exists and is still called from application code.

**Member state:**

- Eric (`7c55cdd0-2cbf-4c8a-8fdd-e141973ade94`) is the only user_organizations row. Membership: AAA, role `admin`.
- Test Company exists as an organization row but has zero members and zero data.

**The 21 "other custom" policies — the surgical list:**

Most of these are legitimate narrow policies that protect data at a finer granularity than tenant isolation alone. Dropping them with the allow-alls would break functionality.

| Table | Policy | Status in 18b |
|---|---|---|
| `organizations` | `orgs_member_read` | **KEEP** (lets user see only their orgs) |
| `user_organizations` | `user_orgs_member_read` | **KEEP** (org member visibility) |
| `user_organizations` | `user_orgs_self_read` | **KEEP** (self visibility) |
| `user_organization_permissions` | `user_org_perms_self_read` | **KEEP** (self visibility) |
| `user_organization_permissions` | `user_org_perms_admin_manage` | **KEEP** (org admin management) |
| `user_profiles` | `Users can update own profile` | **KEEP** (self-update) |
| `user_permissions` | `Users can view own permissions` | **KEEP** (deprecated table, kept for rollback) |
| `nav_items` | `nav_items read` | **KEEP** (global nav read) |
| `nav_items` | `nav_items_admin_write` | **KEEP** (admin-only nav edits) |
| `jarvis_alerts` | `Users can manage their own alerts` | **KEEP** (user-scoped) |
| `jarvis_alerts` | `jarvis_alerts_admin_read` | **KEEP** (admin visibility) |
| `jarvis_conversations` | `Users can manage their own conversations` | **KEEP** (user-scoped) |
| `jarvis_conversations` | `jarvis_conversations_admin_read` | **KEEP** (admin visibility) |
| `knowledge_chunks` | `Authenticated users can read knowledge chunks` | **DROP** (too broad; tenant isolation covers it) |
| `knowledge_chunks` | `knowledge_chunks_admin_manage` | **KEEP** |
| `knowledge_documents` | `Authenticated users can read knowledge documents` | **DROP** (too broad; tenant isolation covers it) |
| `knowledge_documents` | `knowledge_documents_admin_manage` | **KEEP** |
| `marketing_assets` | `marketing_assets_admin_manage` | **KEEP** |
| `marketing_drafts` | `marketing_drafts_admin_manage` | **KEEP** |
| `qb_connection` | `qb_connection_admin` | **KEEP** |
| `invoice_email_settings` | `invoice_email_settings_admin` | **DROP** (tautology bug; tenant isolation covers it) |

After 18b: ~18 custom policies remain (3 dropped).

---

## 4. Lessons From 18a (Applied Here)

Directly actionable lessons from 18a execution, baked into this plan:

### 4.1 SQL trigger function audit is a first-class deliverable

18a's code sweep audited Next.js server code but missed 8 SQL trigger functions that INSERT into org-scoped tables. Result: prod broke on the first intake submission, required an emergency build54 patch.

**18b response:** The code sweep explicitly enumerates every PL/pgSQL function that performs INSERT against an org-scoped table and verifies it sources `organization_id` correctly. This includes triggers, RPCs, and any function called from app code. No function ships un-audited.

### 4.2 Handoff doc vs reality

18a's handoff doc claimed the hook function existed. It didn't. This discrepancy was found during 18b ground-truth verification.

**18b response:** Every claim in the handoff doc is verified by direct prod query before Session A begins. If something is claimed to exist and doesn't, that's a deliverable, not an assumption.

### 4.3 Gating matters

18a's three-session plan collapsed into one run because rehearsal surfaced multiple issues that got fixed in-flight without stopping. Worked out fine, but the gating intent was lost.

**18b response:** Rule C (hybrid discovery handling) governs when Claude Code proceeds vs stops.
- **Minor (proceed):** missing GRANT, typo, config key spelling, obvious hook permission, function body tweak with no semantic change.
- **Material (stop for Eric approval):** new migration that wasn't in the plan, a change to policy semantics, any data-affecting operation, any decision about what to keep/drop.
- When stopping, Claude Code reports: "Found X. Proposed fix: Y. Risk: Z. Approve to proceed, or reject."

### 4.4 Surgical drops, not pattern drops

My 18a plan said "drop allow-all policies" like it was one operation. Reality: 48 legacy + 10 transitional + 21 custom, all intermixed. A pattern-based `DROP` would nuke legitimate policies.

**18b response:** Every DROP POLICY is enumerated explicitly by `(schemaname, tablename, policyname)`. No patterns.

---

## 5. Deliverables

### 5.1 `custom_access_token_hook` function

A PL/pgSQL function in `public` schema that runs before every JWT issuance. Reads the user's `user_organizations` membership and injects `active_organization_id` into the token's `app_metadata` claim.

Behavior for 18b (single-workspace-per-user):

- If user has exactly one membership, set claim to that org's id.
- If user has multiple memberships, set claim to the first (ordered by `created_at ASC`).
- If user has no membership (shouldn't happen post-18a backfill, but possible for brand-new signups), return the event unmodified — do NOT set a claim.
- No error returns. The hook is resilient: on any failure, it returns the event unchanged rather than blocking login.

Critical grants per Supabase docs:

```sql
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
GRANT SELECT ON public.user_organizations TO supabase_auth_admin;
```

The hook does NOT read `user_profiles` or any other table in 18b. When 18c adds a user's "preferred workspace" column, the hook gets extended to prefer that selection.

### 5.2 Hook enablement (manual, dashboard)

One manual step during the window: Supabase Dashboard → Authentication → Hooks → "Before a token is issued" → Select Postgres function → `public.custom_access_token_hook` → Enable.

Eric performs this step during Session C, at the exact timestamped point in the plan. Claude Code waits for confirmation before proceeding.

### 5.3 Code sweep

App-layer changes:

1. **`getActiveOrganizationId()`** (wherever it's defined) — swap from returning the AAA constant to reading the JWT claim. Implementation: decode the JWT in the current session and read `app_metadata.active_organization_id`. Fallback: if JWT has no claim, return null (NOT the AAA constant — that would mask failures).
2. **Every call site of `nookleus.aaa_organization_id()`** — Claude Code greps for both the function name and the AAA UUID literal. Every occurrence gets reviewed. Most should vanish once `getActiveOrganizationId()` is fixed.
3. **SQL trigger function audit** (lesson 4.1) — grep every PL/pgSQL function body for `INSERT INTO <org-scoped-table>` and verify `organization_id` is sourced from NEW or a parent lookup, never omitted.
4. **RPC audit** — any Postgres RPC that touches org-scoped tables needs the same verification.

Output of code sweep: a written report attached to the Session A handoff, listing every file changed and every function audited.

### 5.4 Policy drops (surgical)

Two groups, enumerated by exact name in a single migration:

**Group 1: Legacy allow-all policies (48 drops).** Claude Code queries `pg_policies` live in Session A to build the exact DROP list. List gets committed in the migration file.

**Group 2: Transitional patch policies (10 drops).** Enumerated directly from build53's CREATE POLICY statements.

Both groups drop in the same migration, in the same transaction. If anything breaks, rollback is a recreate of all 58 policies from the migration file.

### 5.5 Policy fixes (targeted)

Three targeted drops (not fixes) to the custom policies:

1. `invoice_email_settings_admin` — tautology bug; redundant with tenant isolation.
2. `Authenticated users can read knowledge chunks` — too broad post-multitenancy.
3. `Authenticated users can read knowledge documents` — too broad post-multitenancy.

All three are handled in the same migration as the fix to the invoice_email_settings bug.

### 5.6 Drop `nookleus.aaa_organization_id()` helper

After the code sweep confirms no callers, drop the function. If any caller is discovered post-drop, fail-fast with a missing-function error is better than silently returning AAA constants.

---

## 6. Order of Operations (Session C)

This order is critical. Every step must complete successfully before the next begins.

| # | Step | Actor | Blocking | Notes |
|---|---|---|---|---|
| 1 | Apply migration: create `custom_access_token_hook` function + grants | Claude Code | Yes | Safe, additive. No behavior change yet. |
| 2 | Apply migration: patch 7 contract RPCs to include `organization_id` in contract_events INSERTs | Claude Code | Yes | build59. Fixes a pre-existing NOT NULL defect surfaced during Session A SQL audit; safe, additive function rewrites. |
| 3 | Apply migration: drop 3 policies (invoice_email_settings_admin + 2 knowledge_* broad-read) | Claude Code | Yes | Part of policy audit, one migration. |
| 4 | **MANUAL:** Eric enables hook in Supabase dashboard | Eric | Yes | 30-second toggle. |
| 5 | Verify hook is injecting claim (log out, log in, decode new JWT) | Eric | Yes | If claim is missing, roll back steps 1-4 and investigate. |
| 6 | Verify `nookleus.active_organization_id()` returns AAA's UUID for Eric's session | Claude Code | Yes | Direct SQL check. |
| 7 | Deploy code sweep changes (merge `18b-prep` → main, Vercel auto-deploys) | Claude Code + Eric | Yes | App now reads JWT, not AAA constant. |
| 8 | Smoke test: intake, jobs, photos, contacts, settings, jarvis — each renders AAA data only | Eric | Yes | If any smoke fails, roll back to step 7. |
| 9 | Apply migration: drop 48 legacy + 10 transitional policies | Claude Code | Yes | Tenant isolation is now the sole gate. |
| 10 | Smoke test again, full sweep | Eric | Yes | Same tests, verify nothing broke. |
| 11 | Apply migration: drop `nookleus.aaa_organization_id()` helper | Claude Code | No | Cosmetic cleanup. |
| 12 | Service-role sanity test: verify a raw service-role query sees both AAA and Test Company data | Claude Code | No | Confirms service role bypasses RLS as expected. |
| 13 | Mark 18b complete, update handoff doc | Claude Code | No | |

If step 4 or 5 fails: the hook itself is broken. Roll back step 1's grants (drop the function), investigate, retry. This is the only step requiring external coordination.

If step 8 or 10 fails: app has a missed call site. Claude Code identifies the file, patches it, redeploys. Does NOT proceed to step 9 with failures outstanding.

---

## 7. Migration Plan

Five migrations for 18b:

- **build55:** Create `custom_access_token_hook` function, apply grants, grant `SELECT` on `user_organizations` to `supabase_auth_admin`.
- **build59:** Patch 7 contract RPC functions (`activate_next_signer`, `mark_contract_expired`, `mark_contract_sent`, `mark_reminder_sent`, `record_signer_signature`, `resend_contract_link`, `void_contract`) to include `organization_id` when INSERTing into `public.contract_events`. Same defect class as build54 (QB triggers / qb_sync_log), different table. Discovered by the Session A SQL audit. Additive `CREATE OR REPLACE` only; no DDL on tables, no data changes.
- **build56:** Policy surgery — drop 3 policies (invoice_email_settings_admin, 2 knowledge_* broad-read).
- **build57:** Drop 48 legacy allow-alls + 10 transitional_allow_all_* policies. Exact DROP list built from live pg_policies query in Session A.
- **build58:** Drop `nookleus.aaa_organization_id()` helper function.

Migrations are applied in order, each in its own transaction. Build59 runs right after build55 and before build56 (§6 step 2): earliest point, since the underlying defect exists today and build57 would otherwise flip enforcement on while these INSERTs still lack `organization_id`. Build56 runs before the hook is enabled (dashboard toggle, step 4). Build57 runs after the hook is enabled AND the code sweep is deployed (step 9). Build58 is cosmetic cleanup at the end (step 11).

---

## 8. Smoke Tests (Prod, Session C)

Run at step 7 (post-code-sweep) and step 9 (post-policy-drop). Each test expected to pass.

| Test | Expected | Failure means |
|---|---|---|
| `/jobs` lists 5 jobs, all AAA | Pass | Missed call site reading JWT; code sweep incomplete |
| `/intake` submit creates a new job visible in `/jobs` | Pass | Trigger missed in SQL audit |
| `/photos` renders the job's photos | Pass | Storage path sweep OR code sweep gap |
| `/contacts` lists contacts | Pass | Code sweep gap |
| `/settings/users` lists Eric as admin of AAA | Pass | user_organizations query routing wrong |
| `/jarvis` opens without error | Pass | Jarvis-specific custom policies not preserved |
| Switching browser to incognito → try to access a job URL directly → redirected to login | Pass | Auth gate broken |
| Service-role query `SELECT count(*) FROM jobs` returns all jobs across orgs | Pass | Service role bypass working |
| Service-role query shows Test Company has zero rows across all tables | Pass | No cross-tenant leakage created |

---

## 9. Rollback Plan

### 9.1 If step 3 (hook enable) or step 4 (claim verification) fails

- Disable hook in Supabase dashboard (same place it was enabled)
- `DROP FUNCTION public.custom_access_token_hook(jsonb);`
- Users' JWTs revert to pre-hook state on next refresh
- No data changes; pure rollback

### 9.2 If step 7 (post-sweep smoke) fails

- Revert app-code commit in git (`git revert HEAD; git push`)
- Vercel redeploys automatically
- `getActiveOrganizationId()` returns AAA constant again; app works exactly as pre-18b

### 9.3 If step 9 (post-drop smoke) fails

- Re-apply the 58 dropped policies from the build57 migration file (the migration ships with a rollback section containing full CREATE POLICY statements)
- This is the one step with meaningful rollback complexity. Claude Code builds an explicit `build57-rollback.sql` file during Session A as a precaution.

### 9.4 Full rollback to 18a state

Sequentially execute 9.1 + 9.2 + 9.3. Total time ~5 minutes if all three are needed. Prod returns to the exact state described in the 18a handoff doc.

---

## 10. Locked Decisions

These are decisions made during planning that should NOT be reconsidered during execution without explicit re-approval:

1. **Hook enablement is manual via dashboard.** No attempt to automate via Management API in 18b. If 18c wants to, it can.
2. **`invoice_email_settings_admin` is dropped, not fixed.** Redundant with tenant isolation.
3. **Two `knowledge_*` broad-read policies are dropped.** Tenant isolation (bucket D) covers the use case correctly.
4. **`nookleus.aaa_organization_id()` is dropped in build58.** No exceptions — if a caller is found post-drop, the resulting error is the correct signal.
5. **No Test Company data seeding.** Empty through 18b; seeded in 18c when the switcher ships.
6. **`user_permissions` table is not dropped.** Kept for rollback safety for at least two weeks post-18b.
7. **Rule C (hybrid) governs mid-session discoveries.** Material changes halt for approval.
8. **Three sessions (A, B, C) — actually run separately this time.**

---

## 11. Three-Prompt Execution Plan

### Prompt A: Preparation

Claude Code, in the aaa-platform repo:

1. Query prod live to build the exact 48-policy drop list for build57. Commit list to the migration file as the canonical source.
2. Author migrations build55, build56, build57, build58 as .sql files in `supabase/`.
3. Code sweep (documented in §5.3). Produce a written report at `docs/superpowers/build-18b/code-sweep-report.md`. Changes go in a branch `18b-prep`, not main.
4. Author the explicit `build57-rollback.sql` file that can recreate every dropped policy.
5. Run `npm run build` — must pass cleanly.
6. Produce `docs/superpowers/build-18b/session-a-handoff.md` summarizing what was built and what's ready for rehearsal.

No prod changes. No pushes to main. All work on `18b-prep` branch.

### Prompt B: Scratch Rehearsal

Claude Code, against a fresh scratch Supabase project:

1. Clone prod schema + minimal fixtures into scratch (same method as 18a: dump + restore via service role).
2. Apply build55, 56, 57, 58 in sequence, verify each lands cleanly.
3. Simulate the code sweep: run the updated app locally pointed at scratch, log in as Eric, walk the full smoke test list.
4. Deliberately trigger one policy rollback (build57-rollback.sql) to verify it works end-to-end.
5. Produce `docs/superpowers/build-18b/session-b-rehearsal-report.md` with pass/fail per step.

If any step fails and it's **minor** per Rule C, Claude Code fixes it and proceeds. If **material**, Claude Code stops and reports to Eric.

Output: green rehearsal report, or clear "stopped at step X for approval" report.

### Prompt C: Production Apply

Claude Code + Eric together, during the 60-90 minute window:

1. Pre-flight: Claude Code re-queries prod to confirm policy counts and function existence match Session A's expected state. If they've drifted (someone else pushed something), stop.
2. Execute §6 "Order of Operations" steps 1-12 in order.
3. Each step has explicit pass criteria (see §12 state verifiers).
4. At step 3 (manual dashboard toggle), Claude Code pauses and asks Eric to confirm completion.
5. On completion: merge `18b-prep` to main, Vercel auto-deploys, mark 18b done.

---

## 12. Pause & Resume Procedures

Every step in 18b has a deterministic state verifier. When resuming a paused session, run verifiers top-to-bottom and find the first one that returns "not done" — that's where to pick up.

### 12.1 Pre-flight Check (run before starting ANY session)

Run these queries before beginning Session A, B, or C. All must match expected values, or stop and investigate.

```sql
-- Q1: 18a baseline is intact
SELECT
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'tenant_isolation_%') = 56 AS tenant_iso_count_ok,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'transitional_allow_all_%') = 10 AS transitional_count_ok,
  (to_regprocedure('nookleus.active_organization_id()') IS NOT NULL) AS active_org_fn_ok,
  (to_regprocedure('nookleus.is_member_of(uuid)') IS NOT NULL) AS is_member_fn_ok,
  (SELECT count(*) FROM public.organizations) = 2 AS org_count_ok,
  (SELECT count(*) FROM public.user_organizations) = 1 AS member_count_ok;
```

All six should return `true`. If any is `false`, do not proceed — investigate the drift.

```bash
# Q2: Git state clean
cd ~/Desktop/aaa-platform
git status                          # Working tree clean
git log origin/main -1 --oneline    # Latest commit matches expected
```

### 12.2 Between-Session Checkpoints

**Resuming into Session B (after Session A complete):**

- `18b-prep` branch exists on GitHub: `git fetch origin && git branch -r | grep 18b-prep`
- Session A handoff doc exists: `ls docs/superpowers/build-18b/session-a-handoff.md`
- All four migration files exist: `ls supabase/migration-build5[5678]-*.sql`
- Code sweep report exists: `ls docs/superpowers/build-18b/code-sweep-report.md`
- `build57-rollback.sql` exists: `ls supabase/build57-rollback.sql`
- No new commits on main since Session A ended (if there are, rebase `18b-prep` first): `git log origin/main --oneline ^<session-a-commit>`
- `npm run build` still passes when run against the `18b-prep` branch

**Resuming into Session C (after Session B complete):**

- Session B rehearsal report is green: `cat docs/superpowers/build-18b/session-b-rehearsal-report.md | grep -i "status: pass"`
- Pre-flight Q1 + Q2 still pass (no drift)
- `18b-prep` is still mergeable to main: `git checkout main && git merge --no-commit --no-ff 18b-prep && git merge --abort`
- Eric can dedicate 60-90 uninterrupted minutes
- Browser access to Supabase dashboard is confirmed (Eric logged in)

### 12.3 Mid-Session C Step Verifiers

Each step in §6 has a verifier query. When resuming a paused Session C, run each in order — the first one that returns "not done" is your resume point.

**Step 1: Hook function + grants exist**
```sql
SELECT
  (to_regprocedure('public.custom_access_token_hook(jsonb)') IS NOT NULL) AS fn_exists,
  EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name = 'custom_access_token_hook'
      AND grantee = 'supabase_auth_admin'
      AND privilege_type = 'EXECUTE'
  ) AS auth_admin_can_execute,
  has_table_privilege('supabase_auth_admin', 'public.user_organizations', 'SELECT') AS auth_admin_can_read_members;
-- All three TRUE = step 1 complete
```

**Step 2: Contract RPCs patched (build59)**
```sql
-- Every patched function's body should reference `organization_id` in the
-- contract_events INSERT. Spot-check one fast function:
SELECT pg_get_functiondef('public.mark_contract_expired(uuid)'::regprocedure) ILIKE '%INSERT INTO contract_events (organization_id%' AS mark_contract_expired_patched;
-- TRUE = step 2 complete
```

**Step 3: Three custom policies dropped**
```sql
SELECT count(*) = 0 AS step_3_complete
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname IN (
    'invoice_email_settings_admin',
    'Authenticated users can read knowledge chunks',
    'Authenticated users can read knowledge documents'
  );
-- TRUE = step 3 complete
```

**Step 4: Hook enabled in dashboard**

Dashboard state is not directly queryable via SQL. Verify by calling the function with a simulated event and confirming the shape of the return:

```sql
SELECT public.custom_access_token_hook(
  jsonb_build_object(
    'user_id', '7c55cdd0-2cbf-4c8a-8fdd-e141973ade94',
    'claims', '{}'::jsonb
  )
) -> 'claims' -> 'app_metadata' ->> 'active_organization_id' AS injected_org_id;
-- Expected: 'a0000000-0000-4000-8000-000000000001' (AAA's UUID)
```

This tests the function works. Step 4 is "the toggle is on" which means the function is actually called on token issuance — that's verified by step 5.

**Step 5: New JWTs carry the claim**

Eric performs in browser: log out completely (clear session), log back in, open DevTools → Application → Cookies, find the `sb-*-auth-token` cookie, decode the JWT at jwt.io (or copy the access_token and paste). Expected: `app_metadata.active_organization_id` is present and equals AAA's UUID.

If missing: the hook is created (step 1) but not enabled (step 4). Re-verify the dashboard toggle.

**Step 6: `active_organization_id()` resolves correctly**

Requires being logged in to the app. The function reads `auth.jwt()` which only populates in an active authenticated session. For a mid-session verification, Claude Code can run:

```sql
-- Simulates what the function would return given a fake JWT with Eric's claim
SELECT (
  jsonb_build_object(
    'app_metadata', jsonb_build_object(
      'active_organization_id', 'a0000000-0000-4000-8000-000000000001'
    )
  )
  #>> '{app_metadata,active_organization_id}'
)::uuid AS resolved;
-- Expected: a0000000-0000-4000-8000-000000000001
```

Real-session verification happens when Eric hits any page (step 8 smoke test) and sees data.

**Step 7: Code sweep deployed**
```bash
# From Eric's terminal
git log origin/main -1 --format='%H %s'
# Expected: latest commit on main is the 18b-prep merge, with message containing "18b" or similar
```

And: Vercel deployment matching this commit has succeeded. Check Vercel dashboard or:
```bash
curl -s https://<your-vercel-domain>/api/health 2>/dev/null | grep -o '"commit":"[a-f0-9]*"'
# If you have a version endpoint; otherwise rely on Vercel dashboard visual
```

**Step 8: Post-sweep smoke green**

Human-verified. Claude Code cannot determine this automatically. The run log (§12.5) captures "PASS" / "FAIL" per test.

**Step 9: 58 policies dropped**
```sql
SELECT
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'transitional_allow_all_%') = 0 AS transitional_gone,
  (SELECT count(*)
   FROM pg_policies
   WHERE schemaname = 'public'
     AND (qual = 'true' OR (qual IS NULL AND with_check = 'true'))
     AND policyname NOT LIKE 'tenant_isolation_%'
  ) = 0 AS legacy_allow_alls_gone;
-- Both TRUE = step 9 complete
```

**Step 10: Post-drop smoke green** — same as step 8, human-verified.

**Step 11: `aaa_organization_id()` helper dropped**
```sql
SELECT to_regprocedure('nookleus.aaa_organization_id()') IS NULL AS step_11_complete;
-- TRUE = step 11 complete
```

**Step 12: Service-role sanity pass**
```sql
-- Run AS service role (MCP queries run as service role by default)
SELECT
  (SELECT count(*) FROM public.jobs) AS all_jobs_visible,
  (SELECT count(DISTINCT organization_id) FROM public.jobs) AS orgs_in_jobs,
  (SELECT count(*) FROM public.jobs WHERE organization_id = 'a0000000-0000-4000-8000-000000000002') AS test_company_jobs;
-- all_jobs_visible > 0, orgs_in_jobs >= 1, test_company_jobs = 0 (empty) = step 12 complete
```

**Step 13: Handoff doc exists and is committed**
```bash
ls docs/superpowers/build-18b/session-c-handoff.md && \
  git log origin/main --oneline -- docs/superpowers/build-18b/session-c-handoff.md | head -1
# File exists AND has a commit = step 13 complete
```

### 12.4 Resume Protocol

When picking up a paused 18b session:

1. **Run §12.1 Pre-flight** — if it fails, drift has occurred; investigate before resuming.
2. **Run §12.2 Between-Session Checkpoint** for the session you're entering.
3. **If mid-Session-C**: read the run log (`docs/superpowers/build-18b/session-c-run-log.md`) to find the last "COMPLETED" step. Then walk §12.3 verifiers from that step forward to confirm the actual prod state matches the log.
4. **Trust prod state over the log**. If the log says step 5 complete but step 5's verifier returns false, the verifier wins. Investigate before proceeding.
5. **Resume from the first "not done" verifier.** Not the step after the last "done" — that handles the case where a step was attempted but not actually completed.
6. **Re-verify Eric's JWT** before proceeding past step 4. Tokens expire. If it's been >1 hour since last JWT refresh, Eric logs out and back in before running step 5+ verifiers.

### 12.5 Abort Triggers (Session C)

If any of the following occur, stop Session C and choose between rollback and re-plan:

- **>4 hours elapsed since Session C started** — JWT context drift, Eric fatigue, accumulated risk
- **>2 consecutive verifier failures** at any step — something is wrong with the plan, not just the execution
- **Unexplained prod drift mid-session** — a policy appears or disappears that isn't in the plan
- **Eric needs to stop and can't return within 30 minutes** — pause with a full §12.5 run log entry, resume at next opportunity
- **Step 7 or step 9 smoke fails and the fix isn't obvious within 15 minutes** — roll back per §9.2 or §9.3 rather than forward-fix

**Default behavior on abort trigger:** Roll back to the last green step. Do not leave prod in a half-state. 18b is intentionally structured so every in-flight state has a clean rollback.

### 12.6 Session C Run Log Template

Claude Code creates and updates `docs/superpowers/build-18b/session-c-run-log.md` as it executes. Template:

```markdown
# 18b Session C Run Log

**Started:** <ISO timestamp>
**Eric present:** yes
**Session A commit:** <sha>
**Session B rehearsal report:** docs/superpowers/build-18b/session-b-rehearsal-report.md
**18b-prep branch HEAD:** <sha>

---

## Pre-flight
<timestamp> — Q1 baseline query: <RESULT>
<timestamp> — Q2 git state: <RESULT>
<timestamp> — Eric confirms dashboard access: <yes/no>

## Step 1: Create hook function + grants
<timestamp> — Migration build55 applied: <success/fail>
<timestamp> — Verifier query output: <raw result>
<timestamp> — Status: <PASS/FAIL/PAUSED>

## Step 2: Drop 3 custom policies
<timestamp> — Migration build56 applied: ...
...

## Step N: ...

---

## Session outcome
<timestamp> — 18b COMPLETE / PAUSED / ROLLED BACK
<timestamp> — Resume point (if paused): Step N, verifier output X
<timestamp> — Rollback performed (if rolled back): yes/no, to state Y
```

This log is the source of truth if Session C aborts. Read it first when resuming.

---

## 13. Post-18b Followups

Not required for 18b completion, but tracked:

- Delete scratch Supabase project (~24h after prod green)
- Storage migration script run (74 files, path rename)
- `user_permissions` table drop (2+ weeks post-18b)
- Legacy sequence drops (`job_number_seq`, `invoice_number_seq`)
- Begin 18c planning (workspace switcher UI + Eric's Test Company membership)
- Optional: add a post-18b admin query Eric can run periodically to verify Test Company remains row-free until 18c seeds it

---

## 14. Success Criteria

18b is complete when all of the following are true:

- [ ] `custom_access_token_hook` function exists in `public` schema with correct grants (§12.3 step 1 verifier returns TRUE)
- [ ] 7 contract RPC functions patched to include `organization_id` in contract_events INSERTs (§12.3 step 2 verifier returns TRUE)
- [ ] Hook is enabled in Supabase dashboard (§12.3 step 4 verifier returns expected UUID)
- [ ] Eric's JWT, when decoded, contains `app_metadata.active_organization_id = 'a0000000-0000-4000-8000-000000000001'` (§12.3 step 5)
- [ ] `nookleus.active_organization_id()` returns AAA's UUID for Eric's session
- [ ] App code no longer references `nookleus.aaa_organization_id()` or the AAA UUID constant
- [ ] `pg_policies` shows zero legacy allow-all and zero transitional policies (§12.3 step 9 verifier)
- [ ] All smoke tests (§8) pass at steps 8 and 10
- [ ] `nookleus.aaa_organization_id()` function does not exist (§12.3 step 11)
- [ ] Service-role query confirms Test Company has zero rows (§12.3 step 12)
- [ ] Build55, 56, 57, 58, 59 migrations are committed to main
- [ ] Session C run log is committed
- [ ] 18b handoff doc is written and committed
