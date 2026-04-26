# Build 18c — Workspace Switcher & Multi-Tenant Polish

**Status:** Planning
**Drafted:** 2026-04-25
**Depends on:** Build 18b (complete, commit `70ebfd2` on main)
**Precedes:** Phase 5 — Multi-Tenant SaaS conversion (Stripe Connect, billing, signup, etc.)

---

## 1. Context & Goals

Build 18b flipped multi-tenant Row-Level Security from "transitional permissive" to "tenant_isolation as the sole gate." Today every authenticated user's JWT carries `app_metadata.active_organization_id`; that claim drives RLS; and the only living human in the system (Eric) is a member of one org (AAA Disaster Recovery). Test Company exists as an organization row with zero data and zero members.

**Build 18c makes multi-tenancy actually usable.** After this build ships:

- Eric can switch between AAA and Test Company via a top-right user menu.
- Switching updates the active org in `auth.users.raw_app_meta_data` and force-refreshes the JWT — no logout required.
- Public-facing magic-link routes (`/sign/[token]`, `/pay/[token]`, `/pay/[token]/success`, plus any others discovered in the audit) derive `organization_id` from the token row, not from a hardcoded AAA fallback.
- The cosmetic ConfigProvider race regression on cold incognito loads is fixed.
- A regression check confirms employee onboarding to AAA still works post-18b.

**What 18c does NOT do** (deliberately deferred to Phase 5 — see §13):

- Stripe Connect / per-org payment routing
- Subscription billing for orgs
- Self-service org signup / onboarding flow
- Per-org email domain customization
- SOC 2 / compliance work

The user has confirmed the immediate goal is dogfooding — switching for testing, while AAA continues to be used for real business. No paying customer organizations are imminent. Phase 5 is its own planning round when demand validates.

---

## 2. Non-Goals

Out of scope for 18c:

- **Stripe Connect or any per-org Stripe integration.** Today's `stripe_connection` is a single-row table; it stays that way.
- **Subscription billing.** Orgs do not pay Eric to use the platform yet.
- **Self-service org signup.** New orgs are created via SQL by Eric. There is no "Create Workspace" button.
- **Inviting users to multiple orgs.** Eric can be a member of AAA + Test Company in 18c, but the UX for "invite this employee to my second org" is Phase 5.
- **Resend / email-domain per-org.** All transactional email continues to send from `@aaacontracting.com`.
- **Org-level branding** (logos, colors, custom subdomain). Build 14a Company Profile already lets each org configure its own; no schema changes needed.
- **Test Company seeding with realistic data.** Test Company stays empty in 18c. Eric will manually create test data after the switcher works.
- **Storage path migration**, scratch project deletion, `user_permissions` drop, legacy sequence drops — all are 18b followups that can happen any time, not gated by 18c.

---

## 3. Current State (Ground Truth, verified 2026-04-25)

Queried directly from production:

| Object | Count / Value |
|---|---|
| `tenant_isolation_*` policies | 56 |
| `transitional_allow_all_*` policies | 0 (dropped in build57) |
| Total public-schema policies | 75 (56 tenant_iso + 18 custom narrow + 1 build60 auth_admin) |
| `public.custom_access_token_hook(jsonb)` | exists, enabled |
| `nookleus.active_organization_id()` | exists, reads `auth.jwt()` |
| `nookleus.is_member_of(uuid)` | exists |
| `nookleus.aaa_organization_id()` | dropped (build58) |
| `public.organizations` count | 2 (AAA + Test Company) |
| `public.user_organizations` count | 1 (Eric → AAA, role admin) |
| Test Company jobs / contacts / contracts / payment_requests | 0 (intentionally empty) |
| `contracts.link_token` unique index | yes |
| `payment_requests.link_token` unique index | yes |

**Bucket-D shared tables (`damage_types`, `job_statuses`, `expense_categories`, `category_rules`):** SELECT policies allow `(organization_id IS NULL OR organization_id = nookleus.active_organization_id() AND member_check)`. Both branches scope to `{authenticated}` role only — anon visitors get zero rows. This is the root of the cold-incognito ConfigProvider race.

**Hook behavior today:** picks the first `user_organizations` row for a user, ordered by `created_at ASC`. No "preferred workspace" mechanism. Changing the active org for a user requires changing which membership is "first" or — better — adding a preference column.

---

## 4. Lessons from 18a + 18b applied here

### 4.1 Code sweep coverage gap → exercise the path under test

18a missed 8 SQL trigger functions that INSERT into org-scoped tables (build54 emergency patch). 18b's Session A code sweep missed the `getActiveOrganizationId` JWT-decode bug that broke every authenticated request post-deploy (build61 fix). Pattern: **`npm run build` passing is not the same as the change actually working end-to-end.**

**18c response:** The Session A code sweep MUST include a real "exercise the change" step, not just compilation. Specifically:
- **Switcher:** test the actual click → token refresh → page reload flow against scratch with both AAA and Test Company seeded with a sample row each, confirm visible state changes.
- **Public routes:** for each fixed public page, simulate an unauthenticated request with a real token and verify the page loads.
- This is part of Session A's deliverables, not Session B's rehearsal.

### 4.2 Auth path can't be fully simulated in scratch

18b's Session B exercised the hook via simulated JWTs as the `authenticated` role. The actual `supabase_auth_admin` execution path was never tested. Result: build60 had to be added live in Session C when Eric's first real login produced a JWT with no claim.

**18c response:** The switcher's token-refresh mechanism uses `supabase.auth.updateUser()` and/or `supabase.auth.refreshSession()`. These run through the real Supabase auth API, not just the database. **Session B's smoke tests must include an actual login → switch → re-login round-trip via the real auth API**, not a simulated JWT mint. If scratch's auth provider doesn't behave identically to prod's, that's a Session B finding before Session C ships.

### 4.3 Rule C hybrid gating works — keep it

Both 18a and 18b had multiple Rule C material findings. All caught, all resolved cleanly because the gates were explicit and the discovery handling rule (minor proceeds, material stops for approval) was clear.

**18c response:** Same Rule C model. No changes.

### 4.4 Public-facing surface is an ignored attack surface

18b's code sweep was scoped to authenticated routes. Public routes (`/sign`, `/pay`, etc.) were left with `?? AAA_ORGANIZATION_ID` fallbacks because Test Company was empty so the bug couldn't fire. The §13 entry was the right call — but it surfaces a broader pattern: **anytime a build introduces multi-tenant infrastructure, the public-facing surface needs its own audit pass.**

**18c response:** The public-route audit (deliverable 5.3) is a first-class deliverable, not a side note. Every file under `src/app/(public)/` gets reviewed — not just the three named in §13.

---

## 5. Deliverables

### 5.1 `user_organizations.is_active` column + hook update

**Migration:** `build62-user-orgs-active-flag.sql`

- Add column `user_organizations.is_active boolean NOT NULL DEFAULT false`
- For each user, ensure exactly one row has `is_active = true` (initially: the membership the hook would currently pick — the earliest created_at)
- Backfill: set `is_active = true` for the earliest membership of each user
- Add a partial unique index: `CREATE UNIQUE INDEX user_orgs_one_active_per_user ON user_organizations(user_id) WHERE is_active = true;` — guarantees at most one active org per user
- Update `public.custom_access_token_hook(jsonb)` to prefer the `is_active` row instead of `created_at ASC`. Fallback to earliest if no active row exists (defensive — shouldn't happen post-backfill, but resilient)

The hook's fallback on no-active-row is important: if a user is added to a new org and their existing active row gets deleted somehow, the hook still injects *something* rather than blocking login.

**Rollback:** drop the column and revert the hook function. Rollback file shipped alongside.

### 5.2 Workspace switcher UI

**Files modified:**
- `src/components/user-menu.tsx` (new) — top-right avatar dropdown with current workspace name + switcher
- `src/lib/supabase/switch-workspace.ts` (new) — the switch action: update `is_active` flags, refresh session, reload
- `src/app/layout.tsx` or wherever the top nav lives — wire in the new menu

**UX:**
- Click avatar in top-right → dropdown opens
- Dropdown shows: current workspace (highlighted), other workspaces user is member of, separator, "Sign out"
- Click another workspace → switch action fires
- During switch: brief loading state (~1 second), then page reloads with new context
- Workspace switcher is hidden if user is only a member of one org (no point showing a one-item menu)

**Switch action implementation:**
1. Service-role-or-RPC call to flip `user_organizations.is_active` flags atomically (the partial unique index enforces "only one active at a time"; flipping is a single transaction with both UPDATE statements)
2. Call `supabase.auth.refreshSession()` — this triggers the auth hook to re-run and inject the new claim into a fresh JWT
3. `window.location.reload()` to ensure server-rendered pages pick up the new claim
4. If any step fails, show toast error and don't change UI

**Why a SECURITY DEFINER RPC for the flip:** `user_organizations` has tenant_isolation policies that don't allow self-update. Easiest path: a `nookleus.set_active_organization(p_org_id uuid)` RPC that runs as SECURITY DEFINER, validates the user is a member of `p_org_id`, then updates flags. Narrow, specific, auditable.

### 5.3 Public-route audit + fix

**Files audited (all under `src/app/(public)/`):** every page, route handler, and component that uses `AAA_ORGANIZATION_ID` or the `?? AAA_ORGANIZATION_ID` fallback pattern.

**Known three from §13:**
- `src/app/(public)/sign/[token]/page.tsx`
- `src/app/(public)/pay/[token]/page.tsx`
- `src/app/(public)/pay/[token]/success/page.tsx`

**Audit deliverable:** Session A produces `docs/superpowers/build-18c/public-route-audit.md` listing every file under `src/app/(public)/` plus any other files that import `AAA_ORGANIZATION_ID`. For each: classification (legitimate seed/script use OR fallback that needs fixing).

**Fix pattern (per §13):**

```ts
// BEFORE — broken when token belongs to non-AAA org
const orgId = await getActiveOrganizationId();
const { data: contract } = await supabase
  .from("contracts")
  .select("...")
  .eq("link_token", token)
  .eq("organization_id", orgId ?? AAA_ORGANIZATION_ID)
  .single();

// AFTER — derives org from the token row
const { data: contract } = await supabase
  .from("contracts")
  .select("organization_id, /* other fields */")
  .eq("link_token", token)
  .single();
// Now use contract.organization_id for any subsequent queries
```

**Anonymous query path:** these public routes already use the service-role Supabase client (because the visitor isn't authenticated). Service role bypasses RLS, so the queries work against any org's data. The change is purely application-side — derive the org_id from the row, don't filter by it as a precondition.

**Verification per fix:** for each page, manually test (in Session A code-sweep verification step) that an unauthenticated visitor with a valid token sees the right contract/payment, including for a token that belongs to Test Company (after temporarily seeding Test Company with one fake contract for the test, then removing it).

### 5.4 ConfigProvider auth-race fix

**File modified:** `src/lib/config-context.tsx`

**Today's behavior:** ConfigProvider fires `damage_types` and `job_statuses` fetches on mount. On first incognito render, the auth cookie hasn't hydrated yet, so the request goes out as anon. RLS on damage_types/job_statuses is `{authenticated}`-only, so anon gets zero rows. ConfigProvider sets the result arrays to empty. Subsequent renders see the populated cookie but ConfigProvider doesn't re-fetch. Cosmetic effect: gray fallback strip on job cards.

**Pre-build57 this was hidden** by `Allow all on damage_types` legacy policies allowing anon reads. Post-build57, those are gone. The race was always there; the symptom is new.

**Fix candidates from §13:**

**(a) Wait for auth state before fetching.** Subscribe to Supabase auth state changes; only kick off `damage_types`/`job_statuses` fetches once `INITIAL_SESSION` event fires with a non-null session. Cleanest. The fetches still run on every page load but only after auth is ready.

**(b) Re-fetch on auth state change.** Fire fetches eagerly. If they return empty AND auth state changes from null to a session, re-fetch. Slightly hacky — accepts the wasted first fetch.

**(c) Defer fetches to per-component.** Move `damage_types`/`job_statuses` lookups out of ConfigProvider and into the components that actually use them. Components that need the data wait for the data. More refactor work but eliminates the global fetch entirely.

**Recommendation (a).** Cleanest. Single change to ConfigProvider. Components that already consume from ConfigProvider keep working. The cost is a 50-100ms delay on the first render of an authenticated session — imperceptible in practice.

**Rollback:** revert the ConfigProvider change. It's app code, no migration.

### 5.5 Employee onboarding regression check

**Not a feature build.** A verification step.

Eric walks `/settings/users` end-to-end during Session C smoke testing:
1. Add a new user (test email, e.g. `eric+employee-test@aaacontracting.com`)
2. Confirm the invitation email sends (Resend logs OK)
3. Click the invite link in a separate browser session
4. Sign up the test user
5. Verify they appear in `/settings/users` as a member of AAA
6. Verify they can log in and see AAA's data
7. Delete the test user before Session C completes

If any step fails, that's a Rule C material finding — investigate and decide whether to ship 18c with it broken (no — depends on severity) or hold for fix.

**No code changes.** Build 14d already implemented this. We're just verifying it survived 18b.

---

## 6. Order of Operations (Session C)

| # | Step | Actor | Blocking | Notes |
|---|---|---|---|---|
| 1 | Apply build62 (is_active column + hook update) | Claude Code | Yes | Backfill confirms one row per user has is_active=true |
| 2 | Apply build62b (set_active_organization RPC) | Claude Code | Yes | Separated from 62 to keep migrations focused |
| 3 | Verify hook still injects claim correctly via test JWT | Claude Code | Yes | §12.3 verifier; no Eric action needed |
| 4 | Deploy code sweep (merge 18c-prep → main, Vercel auto-deploy) | Claude Code + Eric | Yes | Includes switcher UI, public-route fixes, ConfigProvider fix |
| 5 | Smoke: Eric logs out + back in, confirms claim still injected | Eric | Yes | Must work post-build62. If JWT lacks claim, abort. |
| 6 | Smoke: workspace switcher visible in top-right, dropdown shows AAA only (Eric is only in AAA) | Eric | Yes | Should not yet show Test Company since Eric isn't a member |
| 7 | Eric adds himself as member of Test Company via SQL (one-time admin action) | Eric (Supabase dashboard SQL editor) | Yes | INSERT into user_organizations; explicit action, not part of switcher |
| 8 | Eric logs out + back in. Workspace switcher now shows both AAA and Test Company | Eric | Yes | Test that adding a membership becomes visible after re-auth |
| 9 | Eric clicks "Switch to Test Company" | Eric | Yes | Page should reload, claim should change |
| 10 | Verify Eric's session is now scoped to Test Company: /jobs is empty, /contacts is empty, etc. | Eric | Yes | This is the true tenant isolation test |
| 11 | Eric switches back to AAA. /jobs shows AAA's 8 jobs again. | Eric | Yes | Round-trip confirmation |
| 12 | Smoke: ConfigProvider race fix — open incognito, hit /jobs, confirm colored damage strips load correctly | Eric | Yes | Cosmetic fix verification |
| 13 | Smoke: public-route audit — Eric visits /sign/[token] in incognito for an AAA contract, confirms it works | Eric | Yes | Existing AAA contracts must still work |
| 14 | Smoke: public-route audit — manually create a Test Company contract via SQL, get its token, visit /sign/[token], confirm it works | Eric + Claude Code | Yes | The actual SaaS-readiness proof. Delete after. |
| 15 | Smoke: employee onboarding regression (§5.5 walkthrough) | Eric | Yes | Confirms /settings/users invitation flow survives |
| 16 | Mark 18c complete, update handoff doc | Claude Code | No | |

**Pause points:** steps 5, 9, 12, 13, 14, 15 — all human verifications. Steps 1, 2, 3 are pre-deploy DB-only and run without Eric.

**Abort criteria (§12.5):** any step 5-15 failure that isn't a 1-line obvious fix is a forward-fix-or-rollback decision. Default rollback: revert the merge commit on main, Vercel redeploys, app returns to 18b state. Migrations build62 + build62b have explicit rollback files.

---

## 7. Migration Plan

Two migrations for 18c:

- **build62 — `user_organizations.is_active` + hook update.** Adds the column, backfills one row per user as active, adds the partial unique index, updates `custom_access_token_hook` to read from `is_active` first.
- **build62b — `nookleus.set_active_organization(p_org_id uuid)` RPC.** SECURITY DEFINER function that validates membership and flips is_active flags atomically.

Both apply in order. Both have rollback files. Both are tested in Session B against scratch with multi-membership fixtures.

---

## 8. Smoke Tests (Prod, Session C)

Run between steps 5-15 of §6. Each test gets PASS/FAIL.

| Test | Expected | Failure means |
|---|---|---|
| Login → JWT contains active_organization_id claim | Pass | build62 broke the hook |
| Workspace switcher visible in top-right | Pass | UI wiring incomplete |
| Switcher hides itself when user has only one membership | Pass | UX edge case |
| Adding Eric to Test Company makes Test Company visible in switcher (after re-login) | Pass | Membership not surfaced correctly |
| Click "Switch to Test Company" reloads page with Test Company context | Pass | RPC, refresh, or reload broken |
| /jobs in Test Company shows zero rows | Pass | RLS isn't actually enforcing |
| Switch back to AAA shows AAA's jobs again | Pass | Round-trip broken |
| Cold incognito /jobs shows colored damage strips | Pass | ConfigProvider race fix didn't land |
| /sign/[token] for AAA contract works in incognito | Pass | Regression on existing flow |
| /sign/[token] for Test Company contract works in incognito | Pass | Public-route fix didn't work |
| Employee invite via /settings/users works end-to-end | Pass | Build 14d regression |

---

## 9. Rollback Plan

### 9.1 Migrations (build62 + build62b)

- Each migration has a rollback file in `supabase/`.
- build62 rollback: drop the partial index, drop the column, restore the prior `custom_access_token_hook` body (saved verbatim in the rollback file).
- build62b rollback: drop the RPC.
- Order matters: rollback build62b before build62.

### 9.2 Application code

- Revert the merge commit (`git revert -m 1 <merge-sha>`) and push.
- Vercel auto-redeploys.
- Workspace switcher disappears, public-route fix reverts, ConfigProvider fix reverts.
- App returns exactly to 18b state.

### 9.3 Full rollback

Sequentially execute 9.2 + 9.1 (in that order — code first, then DB). Total time ~5 minutes.

---

## 10. Locked Decisions

These are decisions made during planning that should NOT be reconsidered during execution without explicit re-approval:

1. **Switcher placement: top-right user avatar menu.** Not sidebar, not settings page only.
2. **Switch mechanism: update is_active flag + refreshSession + page reload.** Not full sign-out/sign-in.
3. **Test Company stays empty in 18c.** Eric will manually create test data after the switcher works. No seed step.
4. **ConfigProvider race fix uses approach (a): wait for auth state before fetching.** Not (b) re-fetch on change, not (c) per-component refactor.
5. **Public-route audit covers ALL of `src/app/(public)/`, not just the three §13 named pages.**
6. **Employee onboarding is a regression check, not a feature build.** No code changes for it.
7. **No Stripe Connect, no subscription billing, no signup flow.** Phase 5 territory.
8. **Three sessions (A, B, C) — actually run separately.**
9. **Rule C hybrid gating governs mid-session discoveries.** Same as 18a/18b.
10. **`is_active` partial unique index, not a `preferred_organization_id` column on user_profiles.** The flag-on-membership approach is more flexible and lets a future "remove user from org X" automatically pick up another active org if needed.

---

## 11. Three-Prompt Execution Plan

### Prompt A: Preparation

Claude Code, in the aaa-platform repo:

1. Pre-flight against prod (§12.1 baseline).
2. Branch off main: `git checkout -b 18c-prep`.
3. Author migration build62 (column + index + hook update). Test against a hand-mocked scratch row before committing.
4. Author migration build62b (set_active_organization RPC). Same test discipline.
5. Author rollback files for both migrations.
6. Author the workspace switcher: `user-menu.tsx`, `switch-workspace.ts`, layout wiring.
7. Public-route audit: produce `docs/superpowers/build-18c/public-route-audit.md` listing every file. Patch the three known + any newly discovered files. Each patch derives `organization_id` from the token row.
8. Author the ConfigProvider race fix.
9. Run `npm run build` — must pass cleanly.
10. **Real verification step (lesson 4.1):** start the dev server, simulate a switcher click against a hand-mocked second membership, confirm the page reload picks up new context. Document in a code-sweep report.
11. Produce `docs/superpowers/build-18c/session-a-handoff.md` summarizing.
12. Commit and push to `18c-prep` branch.

No prod changes. No pushes to main.

### Prompt B: Scratch Rehearsal

Claude Code, against a fresh scratch Supabase project:

1. Replicate prod's full schema into scratch (using the pg_dump approach from Session B 18b — Eric has Postgres tools installed; this is now a known procedure).
2. Seed with: Eric as auth.users, both organizations, Eric as member of BOTH AAA and Test Company (different from 18b's seed — multi-membership is the whole point of 18c).
3. Apply build62 + build62b. Verify hook picks the `is_active` row.
4. Run the app locally pointed at scratch. **Critical: log in as Eric via the actual Supabase auth flow, not a simulated JWT.** Confirms the auth-admin path that bit us in 18b.
5. Walk every smoke test from §8 against scratch.
6. Test the switcher: click, confirm reload, confirm context change visible (different jobs visible per workspace).
7. Test the rollback path for build62 against scratch.
8. Produce `docs/superpowers/build-18c/session-b-rehearsal-report.md`.

Rule C hybrid gating: minor fixes proceed, material findings stop for Eric.

### Prompt C: Production Apply

Claude Code + Eric together, during the windowed session:

1. Pre-flight: confirm prod still matches §3, confirm 18c-prep is mergeable.
2. Execute §6 Order of Operations steps 1-16 in order.
3. Each step has explicit pass criteria from §12.3.
4. Step 7 (Eric adds himself to Test Company via SQL) is the only manual SQL step Eric runs. Claude Code provides the exact SQL.
5. On completion: merge 18c-prep to main, Vercel auto-deploys, mark 18c done.

---

## 12. Pause & Resume Procedures

(Same structure as 18b plan §12 — verifiers per step, between-session checkpoints, abort triggers. Generate via Session A; defer detail until then to avoid copying 18b's text wholesale. The pattern is proven; reuse it.)

---

## 13. Phase 5 Followups (post-18c)

These are explicitly NOT 18c work but ARE the things that need to happen before another organization can pay for and use this platform:

### Critical for any external org to use the platform

- **Stripe Connect or alternative.** Today's `stripe_connection` is single-row; payments flow into AAA's account. For org-2 to receive their customers' payments into their own bank, the architecture must change. Options: Stripe Connect (Standard or Express), or "platform model" where AAA receives all funds and pays out manually. The Connect path is cleaner long-term but adds significant complexity (KYC, onboarding flow, dispute handling). The platform model is faster to ship but makes AAA a money-services business.
- **Per-org Resend / email domain.** Today all transactional email sends from `@aaacontracting.com`. Org-2's customers receiving "please sign this contract" from AAA's domain is a trust problem. Either each org configures their own Resend account (per SaaS Readiness Principle 3) OR a shared sending domain with proper DKIM per-org-as-subdomain.
- **Subscription billing.** No way for an org to pay Eric. Stripe Billing integration. Pricing model TBD.
- **Self-service signup flow.** Org owner clicks "Sign up", enters company info, creates a workspace, gets routed through onboarding. Today's workflow is "Eric runs INSERT INTO organizations".
- **Org-level branding.** Build 14a Company Profile already supports per-org name, logo, colors, license. Verify it survives 18c and Phase 5 — should be OK but worth a check.
- **Customer-facing domain.** Today the app is at `aaaplatform.vercel.app`. Per the Nookleus rebrand, the eventual public face will be `nookleus.app` (or wherever the domain lands). Subdomain-per-org (e.g. `aaa.nookleus.app`, `othercompany.nookleus.app`) is one option; org-selector after login is another.

### Operational

- **Support model.** Who handles "my contract template won't save" tickets from org-2's owner?
- **Legal terms.** Terms of service, data processing agreement, etc.
- **Compliance.** SOC 2 if pursuing enterprise customers. Data-export-on-cancellation requirement (Build 14i already covers this).
- **Pricing & packaging.** Free tier? Per-seat? Per-job? Flat?

### Inherited 18b followups (not blocked by 18c)

- Scratch project deletion (~24h after 18b green — done)
- Storage migration script (74 files, path rename)
- `user_permissions` table drop (2+ weeks post-18b)
- Legacy sequence drops (`job_number_seq`, `invoice_number_seq`)

**None of these are on the 18c critical path.** They block "first paying customer" but not "Eric dogfooding multi-tenancy."

---

## 14. Success Criteria

18c is complete when all of the following are true:

- [ ] `user_organizations.is_active` column exists with partial unique index
- [ ] One row per user has `is_active = true` (currently just Eric; verifies post-add-to-Test-Company)
- [ ] `nookleus.set_active_organization(uuid)` RPC exists, requires membership, atomically flips flags
- [ ] `custom_access_token_hook` reads `is_active` first, falls back to earliest if no active row
- [ ] Workspace switcher renders in top-right user menu when user has 2+ memberships
- [ ] Switching workspaces refreshes session, reloads page, changes context
- [ ] Switching back round-trips correctly
- [ ] All public routes under `src/app/(public)/` derive `organization_id` from token row, not from `?? AAA_ORGANIZATION_ID`
- [ ] Public-route audit document at `docs/superpowers/build-18c/public-route-audit.md`
- [ ] Cold incognito `/jobs` renders colored damage strips (ConfigProvider race fixed)
- [ ] /sign/[token] works for both AAA and Test Company test contracts in incognito
- [ ] Employee onboarding via /settings/users still works post-18c
- [ ] Migrations build62 + build62b committed, both with rollback files
- [ ] Session A handoff doc, Session B rehearsal report, Session C run log + handoff doc all committed

---

## 15. What this build sets up well for Phase 5

This section exists because Eric explicitly asked: "ensure things are set up properly so we don't have to backtrack."

The 18c choices that matter for Phase 5:

- **`is_active` flag mechanism scales to N orgs.** Adding a second user to AAA doesn't change anything. Adding a real org-2 with their own users doesn't change anything. Each user has at most one is_active row across all their memberships, regardless of org count.
- **Switcher UI scales to N orgs.** The dropdown lists every membership. 2 orgs, 5 orgs, 50 orgs — same UX.
- **Public routes derive from token, not from claim/fallback.** Once fixed, an org-2 contract sent to org-2's customer's email works without any code change. The token is the credential.
- **`nookleus.set_active_organization` RPC validates membership.** Forging a switch to an org you're not a member of is impossible — the RPC raises an exception. Defense in depth; Phase 5 doesn't have to add a separate check.
- **No org-specific assumptions in app code.** The `AAA_ORGANIZATION_ID` constant remains in `src/lib/supabase/get-active-org.ts` for legitimate seed-script use. App code reads `app_metadata.active_organization_id`. Phase 5 doesn't need a code sweep — the work is integrating new external systems (Stripe Connect, billing, signup).

The 18c choices that DON'T affect Phase 5:

- ConfigProvider race fix (cosmetic, isolated)
- Employee onboarding regression check (no code change)
- Test Company seeding / not-seeding (just fixture data)

If 18c ships clean, Phase 5 is purely additive: Stripe Connect integration, billing, signup, etc. No retrofit work, no schema changes, no rebuild of the multi-tenant foundation. **That foundation is what 18a+18b+18c is for.**

*End of plan — Build 18c v1*
