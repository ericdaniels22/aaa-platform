# Build 18c — Session C Handoff

**Status:** SHIPPED 2026-04-26.
**Plan:** `docs/superpowers/plans/2026-04-25-build-18c-workspace-switcher.md`
**Run log:** `docs/superpowers/build-18c/session-c-run-log.md` (timestamped, every step + every Rule C decision)
**Prod project ID:** `rzzprgidqbnqcdupmpfe`
**Final main commit (after this handoff lands):** see `git log` post-commit.

---

## What 18c did

- Added `user_organizations.is_active boolean` column with partial unique index `user_orgs_one_active_per_user` (one active membership per user).
- Updated `public.custom_access_token_hook(jsonb)` to prefer the `is_active=true` membership when injecting `app_metadata.active_organization_id`, with `ORDER BY created_at ASC` defensive fallback.
- Added `public.set_active_organization(p_org_id uuid)` SECURITY DEFINER RPC for the workspace switcher to call atomically.
- Shipped the workspace switcher UI: top-right avatar dropdown rendered by `AppShell`, hides itself when user has < 2 memberships.
- Fixed three public-route pages to derive `organization_id` from token rows instead of falling back to `AAA_ORGANIZATION_ID`: `/sign/[token]`, `/pay/[token]`, `/pay/[token]/success`. Plus the §6.1.2 widening: `stripe_connection` and `payment_email_settings` queries inside `/pay/[token]` now scope by `pr.organization_id` instead of `.limit(1)`.
- Fixed the ConfigProvider cold-incognito race (plan §5.4 approach a): waits for `INITIAL_SESSION` before fetching `damage_types`/`job_statuses`.
- **+ build63 (live forward-fix during this session — see Findings).**

---

## Migrations applied (in order)

| Migration | Purpose | Source file |
|---|---|---|
| build62 | `is_active` column + partial unique index + hook update + grants | `supabase/migration-build62-user-orgs-active-flag.sql` |
| build62b | `public.set_active_organization(uuid)` SECURITY DEFINER RPC | `supabase/migration-build62b-set-active-organization-rpc.sql` |
| build63 | `user_profiles_authenticated_read` SELECT policy (forward-fix for latent 18b regression) | `supabase/migration-build63-user-profiles-select-policy.sql` |

All three have rollback files: `supabase/build62-rollback.sql`, `build62b-rollback.sql`, `build63-rollback.sql`.

App-code commits: `dcf4127` (merge of 18c-prep into main).

---

## Findings

### Finding #1 — MINOR — RPC EXECUTE grants (proceeded)

Session B's run-log §2 reported `set_active_organization` EXECUTE grants as `{authenticated, postgres}`. Prod query returned `{anon, authenticated, postgres, service_role}`. Investigated — this is the universal Supabase default ACL on public-schema functions (every public RPC including pre-existing `mark_contract_expired` has the same shape; `pg_default_acl` confirms). The migration's `REVOKE EXECUTE FROM public` correctly removed the PUBLIC pseudo-role grant. Functional security gate (`auth.uid() IS NULL → raise 'not_authenticated'`) is intact. Session B's verification summary was incomplete, not actual scratch/prod divergence. Proceeded.

### Finding #2 — MATERIAL — RESOLVED via build63 — user_profiles missing SELECT policy

Eric reported "the logout button is missing" during plan §6 step 5 smoke. Diagnosis: 18b's build57 dropped the legacy `"Users can view all profiles"` SELECT policy on `user_profiles` and never replaced it. Authenticated users get 0 rows back from `SELECT * FROM user_profiles WHERE id = userId`, so `AuthProvider.profile` stays null, so `Sidebar` renders the `<p>AAA Platform v1.0</p>` fallback instead of the user-info-with-sign-out section.

This is a **latent 18b regression**, not 18c's fault. Rolling back 18c would NOT fix it.

Eric chose option 1 (recommended): build63 with self-read + shared-org-read policy. Authored migration + rollback locally, applied via MCP. Eric verified live: sidebar now shows his name + sign-out icon. RESOLVED.

### Finding #3 — MATERIAL — DEFERRED — handle_new_user trigger missing on auth.users

Eric attempted plan §6 step 15 (Build 14d invite regression check). Got error `insert or update on table "user_organizations" violates foreign key constraint "user_organizations_user_id_profile_fkey"`. Diagnosis: `src/app/api/settings/users/route.ts` calls `service.auth.admin.createUser(...)` then immediately INSERTs into `user_organizations`, relying on a `handle_new_user` trigger to have created the `user_profiles` row. The function `public.handle_new_user()` exists on prod, but **no trigger on `auth.users` calls it.** Latent regression — undetermined exactly when the trigger went missing.

Like Finding #2, this is NOT 18c's fault. Per Eric's direction: skip step 15, go to cleanup. **Deferred to followup build (suggested: build64_recreate_handle_new_user_trigger).** Investigation order: read `public.handle_new_user()` body, verify it covers what the invite flow expects, then recreate the AFTER INSERT trigger on `auth.users`.

---

## Verifier outcomes (all PASS, except step 15 which was DEFERRED)

| Verifier | Result |
|---|---|
| Pre-flight prod baseline (13 checks) | **PASS** |
| Auth hook dashboard config | **PASS** |
| build62 apply | **PASS** |
| build62b apply | **PASS** |
| DB-side hook smoke (Eric + unknown user) | **PASS** |
| Merge 18c-prep → main + Vercel deploy | **PASS** |
| Step 5: login + JWT claim (implicit via /jobs rendering 8 AAA jobs) | **PASS** |
| Step 6: switcher hidden with single membership | **PASS** |
| Step 7: TestCo membership inserted (via MCP path A) | **PASS** |
| Step 8: re-login, both orgs visible | **PASS** |
| Step 9: switch to TestCo (page reload) | **PASS** |
| Step 10: TestCo session is empty (tenant isolation) | **PASS** |
| Step 11: switch back to AAA round-trip | **PASS** |
| Step 12: ConfigProvider cold incognito | **PASS** |
| Step 13: /sign for AAA contract (fresh token minted) | **PASS** |
| Step 14: /sign for TestCo contract | **PASS** |
| Step 14a: /pay for TestCo payment_request (§6.1.2 widening) | **PASS** |
| Step 15: invite regression | **DEFERRED** (Finding #3) |
| build63 forward-fix | **PASS** |
| Cleanup of TestCo seed | **PASS** |

---

## Final prod state (verified)

| Check | Value |
|---|---|
| Total `public` policies | 76 (75 pre-Session-C + 1 from build63) |
| `user_profiles` SELECT policy | EXISTS (`user_profiles_authenticated_read`) |
| `user_organizations` policies | 3 |
| `public.set_active_organization(uuid)` | EXISTS, SECURITY DEFINER |
| `user_organizations.is_active` column | EXISTS, NOT NULL DEFAULT false |
| Partial unique index `user_orgs_one_active_per_user` | EXISTS, `WHERE (is_active = true)` |
| Eric's memberships | 2 (AAA + Test Company) |
| Active membership rows | 1 (Eric → AAA) |

---

## What 18c did NOT do (deferred)

- **handle_new_user trigger recreation** (Finding #3 — must-fix before /settings/users invite flow is usable on prod again). Suggested followup: build64.
- Phase 5 work (Stripe Connect, billing, signup, per-org email/domain, etc.) — see plan §13.
- Inherited 18b followups: storage migration script, `user_permissions` table drop, legacy sequence drops, scratch project deletion, scratch service-role key rotation.
- Per-org `<title>` tag (page-content branding is fixed; `<title>` tag in `src/app/layout.tsx` is still hardcoded). Cosmetic; Phase 5.

---

## Operational notes for the next session

- **Eric is now a member of both AAA and Test Company.** Active membership is AAA. The workspace switcher is visible and works in both directions.
- **Test Company is empty.** Eric will manually populate fixtures as needed for ad-hoc verification. The Session C TestCo seed (contracts, jobs, etc.) was deleted at session end; only the org row + Eric's membership remain.
- **The `f0000033-*` UUID prefix** was used for all Session C ad-hoc test rows. None remain. If you see any `f0000033-*` rows on prod in a future session, they're stale and safe to delete.
- **`AAA_ORGANIZATION_ID`** constant is retained in `src/lib/supabase/get-active-org.ts` for out-of-app scripts. App code is grep-clean — only the definition site references it.
- **The build62b RPC `public.set_active_organization(uuid)`** validates membership and atomically flips `is_active` flags. Defense in depth: the partial unique index `user_orgs_one_active_per_user` enforces the invariant at the storage layer; the RPC's `RAISE EXCEPTION 'not_a_member'` enforces it at the API layer.
- **Workspace switcher hides at < 2 memberships.** This is intentional UX (plan §5.2). The sidebar's user-info-with-sign-out section is the always-visible sign-out path; build63 ensures it renders correctly.

---

## Bottom line

**18c shipped successfully on prod.** All plan §6 deliverables PASS except step 15 (invite regression), which surfaced a latent 18b regression unrelated to 18c and was deferred per Eric's call.

**Two latent 18b regressions discovered and adjudicated** during 18c Session C:
- `user_profiles` missing SELECT policy → fixed live via build63.
- `handle_new_user` trigger missing on `auth.users` → deferred to followup build.

**The multi-tenant story now works end-to-end on prod:**
- Eric can log in, see the workspace switcher (with both orgs), switch, and the page reloads with the correct tenant context.
- Tenant isolation enforces empty datasets when scoped to Test Company.
- Public-route /sign and /pay correctly resolve company branding from the token row's `organization_id`, not from a hardcoded AAA fallback. Verified end-to-end on prod with seeded TestCo data.
- The ConfigProvider race fix eliminates the cold-incognito gray-strip regression.
- Build 14d invite flow is broken in a way that pre-existed 18c — out of scope for this session, deferred to build64.

**No rollback was performed.** All migrations and code changes remain live.
