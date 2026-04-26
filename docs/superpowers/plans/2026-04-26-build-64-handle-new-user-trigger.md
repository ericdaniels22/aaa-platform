# Build 64 — Restore `on_auth_user_created` Trigger on `auth.users`

**Status:** DRAFTED 2026-04-26 — ready to ship
**Drafted:** 2026-04-26
**Depends on:** Build 18c (complete, commit `5eedd76` on main)
**Precedes:** Build 65 — Mobile platform via Capacitor
**Severity:** MUST-FIX before `/settings/users` invite flow is usable on prod again
**Surface area:** 1 migration, 1 rollback, 1 cleanup of orphaned auth user. No app code changes.
**Sessions:** Single-session — does NOT use the three-session protocol from the 18 series.

---

## 1. Context & Goals

Build 18c Session C surfaced this regression at plan §6 step 15 (employee-onboarding regression check). When Eric attempted `/settings/users` → invite, `service.auth.admin.createUser(...)` succeeded — but the immediately-following `INSERT INTO user_organizations` raised `foreign key constraint "user_organizations_user_id_profile_fkey"`. The route's contract assumes that inserting into `auth.users` will trigger `public.handle_new_user()`, which mirrors the row into `public.user_profiles`. That trigger is missing on prod.

The function `public.handle_new_user()` itself still exists (rewritten in build48 to drop the legacy `role` column). Only the `AFTER INSERT ON auth.users` trigger that calls it is gone. Whatever migration in the 18b RLS-hardening series dropped it never reinstated it.

**Build 64 makes `/settings/users` invitations work end-to-end again** by:

1. Recreating the `AFTER INSERT ON auth.users FOR EACH ROW` trigger that calls `public.handle_new_user()`
2. Cleaning up the one orphaned `auth.users` row left behind from the 18c step 15 attempt (`eric@testtesttest.com`, id `7329adc0-f12a-4fb6-8463-c4171a6abdad`, no profile, no membership)
3. Re-running the §5.5 invite regression check from the 18c plan to confirm the fix

**What Build 64 does NOT do:**

- No changes to `public.handle_new_user()` itself — its body is correct as of build48
- No schema changes to `user_profiles` or `user_organizations`
- No changes to `src/app/api/settings/users/route.ts` — the route's logic is correct; it was always relying on this trigger
- No retroactive migration of `auth.users` rows that lack profiles — there's only the one orphan; cleanup, not backfill

---

## 2. Non-Goals

- Investigating which migration in the 18b series dropped the trigger. The git archeology question is not blocking — recreating the trigger is sufficient. (If the answer matters later for a writeup, `git log --all -p -S "on_auth_user_created" supabase/` will surface it.)
- Adding monitoring or alerts for "auth.users INSERT not mirrored to user_profiles" — interesting future work, not in scope.
- Touching the legacy `user_permissions` table or other 18b followups (storage migration, sequence drops, etc.).
- Migrating any other latent missing trigger. Build 64 is scoped to this one specific regression.

---

## 3. Current State (Ground Truth, verified 2026-04-26 via Supabase MCP)

| Object | Value | Notes |
|---|---|---|
| `pg_trigger` rows for `on_auth_user_created` | **0** | The bug — should be 1 |
| `public.handle_new_user()` function exists | **YES** | Body matches build48; just no trigger calling it |
| `auth.users` count | **2** | Eric + 1 orphan |
| `public.user_profiles` count | **1** | Just Eric — orphan never got mirrored |
| `public.user_organizations` count | **2** | Both rows are Eric's (AAA active, TestCo inactive) |
| `tenant_isolation_*` policies | 56 | Matches post-18c baseline |
| `user_organizations.is_active` column | exists | post-18c |
| `public.custom_access_token_hook(jsonb)` | exists | post-18c |
| `public.set_active_organization(uuid)` RPC | exists | post-18c |
| Latest commit on `main` | `5eedd76` | "session-c(18c): build62/62b applied + build63 forward-fix, smokes PASS, handoff written" |

**The orphan auth.users row:**

| id | email | created_at | profile? | membership? |
|---|---|---|---|---|
| `7329adc0-f12a-4fb6-8463-c4171a6abdad` | `eric@testtesttest.com` | 2026-04-26 07:27:32 UTC | NO | NO |

This row is the residue from 18c Session C step 15. It is safe to delete: zero downstream rows reference it (no profile, no membership, no jobs/contacts/anything since profile was never created). Deleting it via `auth.admin.deleteUser` is the cleanest path — let Supabase Auth handle the cascade through `auth.identities`, `auth.sessions`, etc.

**FK chain (verified):**

```
public.user_organizations.user_id
  → REFERENCES auth.users(id) ON DELETE RESTRICT      (user_organizations_user_id_fkey)
  → REFERENCES user_profiles(id) ON DELETE RESTRICT   (user_organizations_user_id_profile_fkey)
```

The dual FK is what makes this regression surface as a FK violation rather than a silent failure: even though `auth.users` accepted the new row, `user_profiles` had no matching row, so the membership INSERT trips `user_organizations_user_id_profile_fkey`.

---

## 4. Lessons from 18a/18b/18c applied here

This is a small mechanical fix, but the 18-series lessons still apply:

- **"Build passes" ≠ "feature works."** The 18b/18c migrations all built and applied cleanly; the trigger drop was invisible to compilation. Build 64's verification step has to be a real end-to-end invite flow against prod, not just "trigger exists in pg_trigger".
- **Document orphans before cleanup.** Before deleting the `eric@testtesttest.com` auth user, capture its id and timestamp in the run log. Once it's gone, the audit trail of why it existed is gone too.
- **Single-step scope discipline.** No tempting expansions. Build 64 is the trigger + the orphan. Anything else found along the way (other latent regressions, unrelated cleanup) gets logged as a Rule C minor or a future build, not folded in.

---

## 5. Deliverables

### 5.1 Migration `build64-recreate-handle-new-user-trigger.sql`

```sql
-- build64: Restore the AFTER INSERT trigger on auth.users that mirrors new
-- auth users into public.user_profiles. The function public.handle_new_user()
-- already exists from build48; only the trigger calling it is missing.
-- Latent regression introduced sometime during the 18b RLS-hardening series.

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill check: every auth.users row should have a matching user_profiles
-- row. The one known orphan (eric@testtesttest.com) is being removed
-- separately via supabase.auth.admin.deleteUser, so this should be a no-op
-- after that step. Asserted at the end of the migration as a safety check.
DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT COUNT(*) INTO orphan_count
    FROM auth.users au
    LEFT JOIN public.user_profiles up ON up.id = au.id
   WHERE up.id IS NULL;

  IF orphan_count > 0 THEN
    RAISE NOTICE 'build64: % auth.users row(s) lack a user_profiles row. Trigger is now installed; future inserts mirror correctly. Resolve existing orphans manually.', orphan_count;
  END IF;
END$$;
```

`CREATE OR REPLACE TRIGGER` is idempotent (Postgres 14+) — safe to re-run. Build48's wording (`CREATE OR REPLACE TRIGGER on_auth_user_created`) is the precedent here, mirrored exactly.

### 5.2 Rollback `build64-rollback.sql`

```sql
-- Rollback for build64: drop the trigger. Function is left intact (it was
-- already present pre-build64 and is referenced from migrations 14d/48).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
```

### 5.3 Orphan cleanup

Run via the Supabase Admin API (NOT via raw SQL — Supabase Auth manages cross-table cascades through `auth.identities`, `auth.sessions`, `auth.refresh_tokens`, `auth.mfa_factors`, etc., that aren't safe to clean up by hand):

```ts
// One-off script or Supabase dashboard "Delete user" button:
await service.auth.admin.deleteUser('7329adc0-f12a-4fb6-8463-c4171a6abdad');
```

Eric can run this from the Supabase dashboard's Authentication → Users page (find the row by email, click trash icon) or from a one-off node script using the service-role key. **Either path is fine; pick whichever Eric is more comfortable with at the moment.**

### 5.4 Verification — invite regression

After 5.1 + 5.2 + 5.3 land, re-run plan §5.5 from the 18c plan against prod:

1. Eric opens `/settings/users` and clicks the invite button
2. Enters a new test email (e.g. `eric+build64-test@aaacontracting.com`)
3. Confirms the API returns 201 (no FK violation)
4. Checks Supabase Auth dashboard: new auth.users row exists, mirrored into `user_profiles`, plus a `user_organizations` row with the chosen role and `organization_id = AAA`
5. Confirms invitation email is sent (Resend logs)
6. Logs out, signs up the test user via the magic link in the email, confirms they land in AAA's data
7. Deletes the test user via the Supabase dashboard

If any step fails, that's a Rule C material finding: stop and adjudicate before declaring Build 64 done.

---

## 6. Order of Operations (single session)

| # | Step | Actor | Blocking | Notes |
|---|---|---|---|---|
| 1 | Capture pre-state via Supabase MCP (orphan id, profile count, function definition hash) | Claude Code | Yes | Run-log evidence |
| 2 | Apply `build64-recreate-handle-new-user-trigger.sql` to prod | Claude Code | Yes | Via Supabase MCP `apply_migration` |
| 3 | Verify trigger is present: `pg_trigger` row exists, `tgrelid = 'auth.users'::regclass`, `tgenabled = 'O'` | Claude Code | Yes | Single SELECT |
| 4 | Delete orphan auth user `7329adc0-f12a-4fb6-8463-c4171a6abdad` | Eric (Supabase dashboard) OR Claude Code (admin API) | Yes | After trigger is in place — order matters |
| 5 | Verify cleanup: `auth.users` count = 1, `user_profiles` count = 1, no orphans | Claude Code | Yes | Single SELECT |
| 6 | Eric runs the §5.4 invite regression check end-to-end | Eric | Yes | Real verification, real email |
| 7 | Eric deletes the test invite user via dashboard | Eric | No | Cleanup |
| 8 | Commit migration + rollback to a `build64-fix` branch, merge to main | Claude Code | No | Vercel redeploy not required (no app code changes) |
| 9 | Write `docs/superpowers/build-64/handoff.md` | Claude Code | No | Brief — single page is fine |

**Pause points:** step 4 (Eric chooses path) and step 6 (Eric drives the invite). Steps 1–3 and 5 are pure DB queries that don't need Eric's hand on the wheel.

**Abort criteria:** if step 6 fails for any reason other than a typo, stop. The trigger being installed but the invite still failing means there's a second latent regression in the 18b series, and that's a planning conversation, not a hot-patch.

---

## 7. Smoke Tests (Prod)

Run during/after step 6.

| Test | Expected | Failure means |
|---|---|---|
| Trigger `on_auth_user_created` exists in `pg_trigger` | 1 row, enabled `O` | Migration didn't apply |
| `auth.users` count after orphan cleanup | 1 (just Eric) | Orphan still present |
| `user_profiles` count | 1 (just Eric) | Orphan profile somehow created |
| Invite new user via `/settings/users` | 201 OK | Trigger or route still broken |
| New `auth.users` row triggers a matching `user_profiles` row | yes | Trigger not firing |
| `user_organizations` row inserted with chosen role | yes | Route's INSERT failing |
| Invitation email arrives | yes | Resend connection issue (separate problem) |

---

## 8. Rollback Plan

### 8.1 Migration

Run `build64-rollback.sql`. This drops the trigger only; the function and any newly-created `user_profiles` rows are left intact (they're correct).

### 8.2 Application code

None. Build 64 ships zero application code changes.

### 8.3 If the orphan cleanup needs to be undone

It cannot be undone trivially — Supabase Auth doesn't keep a "trash" of deleted users. If Eric accidentally deletes the wrong user, the recovery is "create a new auth.users row with the same id" via the admin API, which is gnarly. **Mitigation: capture the orphan's row in the run log via `SELECT * FROM auth.users WHERE id = '7329adc0-...'` BEFORE step 4.** That snapshot makes a manual restore possible if needed.

### 8.4 Full rollback

Sequentially: roll back the migration via 8.1. Total rollback time: 30 seconds. The orphan cleanup is one-way; that's fine because the orphan was already broken (no profile, no membership) — losing it permanently has no business cost.

---

## 9. Locked Decisions

These are decisions that should NOT be reconsidered during execution:

1. **Recreate the trigger byte-identical to migration build14d's definition** (`AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()`). Don't try to "improve" the body — `public.handle_new_user()` is correct as of build48.
2. **Use `CREATE OR REPLACE TRIGGER`**, not `CREATE TRIGGER` + prior `DROP IF EXISTS`. The single-statement form is idempotent and matches Build 48's precedent.
3. **Delete the orphan via `auth.admin.deleteUser`, not raw SQL.** Supabase Auth manages auxiliary tables (identities, sessions, MFA factors) that aren't safely cleanable from the public-schema layer.
4. **No app code changes.** `src/app/api/settings/users/route.ts` is correct; the regression is database-side.
5. **No three-session protocol.** This is a single migration, single trigger, single orphan cleanup. The 18-series rehearsal pattern is overhead that doesn't pay back here.
6. **Apply directly to prod.** No scratch rehearsal. The change is small enough and well-understood enough that the rehearsal-vs-prod distinction doesn't add value. Rollback is fast if needed.
7. **Verification IS the invite-regression flow from 18c §5.5.** Don't substitute a synthetic test (e.g., direct INSERT into auth.users via SQL) — the bug surfaced through the real `/settings/users` route, the fix has to be verified through the same path.

---

## 10. Single-Prompt Execution Plan

Build 64 is small enough to ship in one Claude Code session. The full prompt:

```
Build 64 — Restore on_auth_user_created trigger on auth.users.

Plan: docs/superpowers/plans/2026-04-26-build-64-handle-new-user-trigger.md
Read it in full before doing anything else.

Pre-flight:
1. Re-run §3's prod baseline checks via Supabase MCP. Confirm trigger
   still missing, function still present, orphan still present.
2. Capture the orphan's full auth.users row to the run log
   (SELECT * FROM auth.users WHERE id = '7329adc0-f12a-4fb6-8463-c4171a6abdad').

Branch: build64-fix off main at 5eedd76.

Apply (in order):
3. Author supabase/build64-recreate-handle-new-user-trigger.sql per §5.1.
4. Author supabase/build64-rollback.sql per §5.2.
5. Apply build64 to prod via Supabase MCP apply_migration.
6. Verify trigger present (§7 row 1) — Eric's eyes on the result.
7. Stop. Pause for Eric to choose orphan-cleanup path (dashboard vs admin API).
8. After Eric confirms cleanup done, verify §7 rows 2–3.
9. Pause for Eric to run §5.4 invite regression check end-to-end.
10. After Eric confirms invite worked, capture all post-state via MCP.
11. Commit migration + rollback to build64-fix branch.
12. Open PR, merge to main. No Vercel redeploy needed (no app code).
13. Write docs/superpowers/build-64/handoff.md with: pre-state, applied
    SQL, post-state, orphan capture, verification outcome.

Rule C: any material finding stops for Eric. Minor proceeds with logging.
```

---

## 11. Success Criteria

Build 64 is complete when all of these are true:

- [ ] Trigger `on_auth_user_created` exists on `auth.users`, enabled, calling `public.handle_new_user()`
- [ ] `auth.users` count = 1, `user_profiles` count = 1, no orphans
- [ ] `/settings/users` invite for a new test email returns 201 OK
- [ ] Newly-invited user has a matching `user_profiles` row (created by the trigger) and a `user_organizations` row (created by the route)
- [ ] Test invite user deleted post-verification
- [ ] `supabase/build64-recreate-handle-new-user-trigger.sql` and `supabase/build64-rollback.sql` committed on main
- [ ] `docs/superpowers/build-64/handoff.md` committed on main
- [ ] No Vercel redeploy was needed (proves zero app-code coupling)

---

## 12. What this unblocks

- **Crew onboarding for Build 65 (Mobile platform).** Per the Build 65 plan, every crew member needs an authenticated account before they can use the iOS app. The `/settings/users` invite flow is the only way that happens. Build 64 restores that pathway.
- **Phase 5 SaaS readiness.** When external orgs eventually invite their own users, they'll go through the same `auth.users` → trigger → `user_profiles` mirror. Fixing it on a single-tenant baseline is much easier than fixing it during a multi-tenant signup launch.

---

*End of plan — Build 64 v1*
