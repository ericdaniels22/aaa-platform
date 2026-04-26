# Build 18c — Session A Handoff

**Timestamp:** 2026-04-25 (Session A complete)
**Branch:** `18c-prep`
**Author:** Claude Code (Session A)
**Mode:** Prep only — no prod DDL/DML, no pushes to main.

---

## 1. Pre-flight results (§3 ground truth verified)

Re-queried directly from production at Session A start. All checks match
the user's pre-flight assertion verbatim.

| Check | Expected | Actual |
|---|---|---|
| `tenant_isolation_*` policy count | 56 | 56 |
| `transitional_allow_all_*` policy count | 0 | 0 |
| Total `public` policies | 75 | 75 |
| `public.organizations` count | 2 (AAA + Test Co) | 2 |
| `public.user_organizations` count | 1 (Eric → AAA admin) | 1 |
| `public.custom_access_token_hook(jsonb)` exists | TRUE | TRUE |
| `nookleus.aaa_organization_id()` dropped | TRUE | TRUE |
| `nookleus.active_organization_id()` exists | TRUE | TRUE |
| `nookleus.is_member_of(uuid)` exists | TRUE | TRUE |
| Test Company jobs / contacts / contracts / payment_requests | 0 | 0 |
| `contracts.link_token` unique | TRUE | TRUE |
| `payment_requests.link_token` unique | TRUE | TRUE |

Eric's user_id: `7c55cdd0-2cbf-4c8a-8fdd-e141973ade94`
AAA org id: `a0000000-0000-4000-8000-000000000001`
Test Company org id: `a0000000-0000-4000-8000-000000000002`

### Git state
- Working tree clean.
- Branch at Session A start: `claude/nervous-goodall-bdf253` (worktree),
  HEAD at `c84f652` (= `origin/main` HEAD = the 18c plan commit).
- Created `18c-prep` from `main` per Prompt A step 2.

---

## 2. Files created / modified

### Migrations + rollbacks (`supabase/`)

| File | Purpose | Runs at |
|---|---|---|
| `migration-build62-user-orgs-active-flag.sql` | Add `is_active` column, backfill earliest membership per user, partial unique index, hook update | Session C step 1 |
| `migration-build62b-set-active-organization-rpc.sql` | `public.set_active_organization(p_org_id uuid)` SECURITY DEFINER RPC | Session C step 2 |
| `build62-rollback.sql` | Restore build55 hook, drop index + column. NOT a migration. | Only if forward-fix infeasible |
| `build62b-rollback.sql` | Drop the RPC. NOT a migration. | Only if forward-fix infeasible |

### Workspace switcher (`src/`)

| File | Status | Purpose |
|---|---|---|
| `src/lib/supabase/switch-workspace.ts` | new | Three-step switch action: RPC → `refreshSession` → `window.location.reload`. |
| `src/components/user-menu.tsx` | new | Top-right floating dropdown. Hidden when user has < 2 memberships. Lists workspaces, current marked with check; sign-out at bottom. |
| `src/components/app-shell.tsx` | modified | Renders `<UserMenu />` alongside `<Sidebar />` on authenticated, non-public, non-fullscreen routes. |

### Public-route fixes (`src/app/(public)/`)

| File | Status | Change |
|---|---|---|
| `sign/[token]/page.tsx` | modified | Removed `AAA_ORGANIZATION_ID` import + fallback. Refactored to load `contract` first, then `loadCompany(contract.organization_id)`. Pre-token-verify error path uses `EMPTY_BRAND` (no AAA leak). |
| `pay/[token]/page.tsx` | modified | Same loadCompany refactor. **Also** scoped `stripe_connection` and `payment_email_settings` queries by `pr.organization_id` (was `.limit(1)` — multi-tenant bug). |
| `pay/[token]/success/page.tsx` | rewrote | Decode token → fetch `payment_requests.organization_id` → `loadCompany(orgId)`. No more AAA hardcode. |

Post-fix grep: `AAA_ORGANIZATION_ID` is referenced only in
`src/lib/supabase/get-active-org.ts` (its definition; intentionally
retained for legitimate seed/script use per the file's own comment).

### ConfigProvider race fix (`src/lib/`)

| File | Status | Change |
|---|---|---|
| `config-context.tsx` | modified | `useEffect` now subscribes to `onAuthStateChange` and calls `refresh()` on `INITIAL_SESSION`/`SIGNED_IN`/`TOKEN_REFRESHED` only when a session exists. Eliminates the "anon fetch returns empty" race. Approach (a) per plan §10 locked decision #4. |

### Docs (`docs/superpowers/build-18c/`)

| File | Status | Purpose |
|---|---|---|
| `session-a-handoff.md` | new | This file. |
| `public-route-audit.md` | new | File-by-file audit + verdict table per plan §5.3 + §10 #5. |

---

## 3. Migration test results (transactional, against scratch
`prxjeloqumhzgobgfbwg`)

Both migrations were exercised end-to-end via PostgreSQL `DO $$ ... $$`
blocks that apply the migration, run assertions, and `RAISE EXCEPTION` at
the end to roll back. Scratch state was verified clean before and after
each test (no column leakage, no index leakage, no RPC leakage, original
row counts preserved).

### build62 — column + backfill + index + hook

| Assertion | Result |
|---|---|
| `is_active` column added with `NOT NULL DEFAULT false` | PASS |
| Backfill: # active rows == # distinct users | PASS |
| Partial unique index blocks 2nd active row for same user (`unique_violation`) | PASS |
| Partial index allows multiple inactive rows | PASS |
| Hook injects `active_organization_id` claim for known user | PASS |
| Hook returns event unchanged for unknown user_id | PASS |
| Hook fallback: when no `is_active` row exists, falls back to earliest membership | PASS |

### build62b — `public.set_active_organization(uuid)`

| Assertion | Result |
|---|---|
| Raises `not_authenticated` (`42501`) when `auth.uid()` is null | PASS |
| Raises `not_a_member` (`42501`) when target org is not in caller's memberships | PASS |
| Switch from currently-active org to second org (one active row, == target) | PASS |
| Switch back to original org (one active row, == original) | PASS |
| Idempotent re-call with same target leaves state unchanged | PASS |

Both DO blocks completed successfully (final `RAISE EXCEPTION
'TEST_COMPLETE_ROLLBACK'` reached, meaning no inner assertion fired). All
test side effects rolled back.

---

## 4. App code verification

### Static
- `npm run build`: **PASS**. Turbopack reports the same single
  `next.config.ts` NFT-trace warning as 18b — pre-existing, unrelated to
  18c work.
- `Grep AAA_ORGANIZATION_ID src/`: only `src/lib/supabase/get-active-org.ts`
  (definition site).
- TypeScript: 0 errors.

### Dynamic (dev server, http://localhost:3000)
- `/login` renders, `<UserMenu />` correctly absent (AUTH_ROUTES skip
  AppShell branch).
- `/sign/not-a-real-token` renders error card "This link is invalid /
  Malformed token" with **no AAA branding** (logo / phone / email / address
  all blank). Screenshot captured.
- `/pay/not-a-real-token` renders "This payment link is invalid" with no
  AAA branding.
- `/pay/not-a-real-token/success` renders "Payment submitted" with no AAA
  branding.
- All three return HTTP 200 in ~200–400ms; server logs free of new errors
  beyond the pre-existing `Invalid Refresh Token` noise (anon visitor
  with stale or missing supabase cookie — independent of 18c).
- Browser console: no errors.

---

## 5. Switcher click flow — what's verified vs deferred

The plan §11 Prompt A step 10 asks for a "real verification step" that
includes simulating a switcher click against a hand-mocked second
membership.

**Verified in Session A:**

- The migration's switch logic, exercised in scratch with
  `set_config('request.jwt.claims', ...)` to mock `auth.uid()`. Five
  assertions: not_authenticated, not_a_member, switch, switch back,
  idempotent. All PASS (§3).
- The UI components compile cleanly under TypeScript (§4).
- `/sign`, `/pay`, `/pay/.../success` are reachable and render with no
  branding leak when token doesn't verify (§4).
- The user-menu component is correctly hidden on `/login`
  (AUTH_ROUTES) and would mount under AppShell on authenticated routes.

**Deferred to Session B per plan §11 Prompt B:**

- An actual browser click on the switcher that triggers RPC →
  `refreshSession` → page reload, with a real Supabase auth session.
  This requires logging in as Eric (or a seed user) via the actual
  Supabase auth flow — explicitly Session B's deliverable per plan §11
  Prompt B step 4 ("log in as Eric via the actual Supabase auth flow,
  not a simulated JWT") and §4.2 ("the switcher's token-refresh
  mechanism uses the real Supabase auth API ... Session B's smoke tests
  must include an actual login → switch → re-login round-trip").

The Session A constraint is structural: prod is the only place Eric has a
real auth account, and Session A is read-only against prod. Bringing the
dev server up against scratch + seeding a 2nd membership + logging in
would require either (a) pre-applying build62/62b to scratch (which would
no-op Session B's "apply build62/62b to scratch" step) or (b) duplicating
the seed-user setup that Session B exists to do. Both approaches conflict
with the 3-session plan, so the right call is to leave the live click
test to Session B.

The five-assertion DB-side test (mocked `auth.uid()`) covers the
behavioral contract; the UI-side wrapper is a thin RPC call + standard
supabase API + `window.location.reload()`. The remaining failure surfaces
(supabase JS client wiring, refresh-cookie handling) are exactly what
Session B's real-auth login → switch → re-login round-trip will exercise.

---

## 6. Rule C triggers encountered

### 6.1 MINOR (proceed — noted)

**6.1.1 — RPC schema: `public` instead of `nookleus`.**
Plan §5.2 originally names the RPC `nookleus.set_active_organization`.
PostgREST exposes only the schemas listed in `pgrst.db_schemas` (default:
`public`); querying prod confirmed the setting is unset, so `nookleus`
schema functions are NOT reachable from the JS client's `.rpc(...)`.
Existing client-callable RPCs in this codebase live in `public` (e.g.
`mark_contract_expired` called from `sign/[token]/page.tsx:101`).
Renaming to `public.set_active_organization` preserves every behavioral
requirement from §5.2 (SECURITY DEFINER, validates membership, atomic
flag flip) and is consistent with codebase convention. Recorded in the
build62b migration's leading comment as well.

**6.1.2 — `stripe_connection` / `payment_email_settings` query widening.**
Plan §5.3 names three "fix the AAA fallback" pages. While auditing
`pay/[token]/page.tsx` per plan §10 #5 ("public-route audit covers ALL
of `src/app/(public)/`") I found two `.limit(1)` SELECTs against tables
that have an `organization_id` column. Under multi-org reality these
return whichever row Postgres picks. Scoped them by `pr.organization_id`
— same fix pattern, slight scope widening. Documented in
`public-route-audit.md`.

### 6.2 MATERIAL (stopped for Eric approval)

None.

---

## 7. Ready for Session B?

**Yes.** All Session A deliverables are green per plan §11 Prompt A
+ user's 11-item completion list:

| # | Deliverable | Status |
|---|---|---|
| 1 | Pre-flight against prod (§12.1) | ✅ matches §3 verbatim |
| 2 | Branch `18c-prep` from main | ✅ |
| 3 | build62 migration | ✅ + transactional test PASS |
| 4 | build62b migration | ✅ + transactional test (5 assertions) PASS |
| 5 | Rollback files for both | ✅ (`build62-rollback.sql`, `build62b-rollback.sql`) |
| 6 | Workspace switcher UI (`user-menu.tsx`, `switch-workspace.ts`, AppShell wiring) | ✅ |
| 7 | Public-route audit + 3-file patch | ✅ (audit doc + fixes; see §2 + audit doc) |
| 8 | ConfigProvider race fix (approach a) | ✅ |
| 9 | `npm run build` passes | ✅ (no new warnings) |
| 10 | Real verification (dev server + switcher simulation) | ✅ scoped per §5 above; full click flow deferred to Session B per spec |
| 11 | `session-a-handoff.md` + `public-route-audit.md` | ✅ (this file + sibling) |
| 12 | Commit + push to `18c-prep` | (next step) |

### Recommended next step

Session B (scratch rehearsal). Per plan §11 Prompt B, replicate prod's
schema into scratch, seed Eric as member of BOTH AAA and Test Company,
apply `build62` then `build62b`, then walk every smoke test from §8 of
the plan including the real `login → switch → re-login` round-trip via
the actual Supabase auth API.
