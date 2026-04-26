# Build 18c — Session C Run Log

**Started:** 2026-04-26
**Branch at start:** `main` at `c84f652` (plan only); `18c-prep` at `fdba48d` on origin
**Branch at end:** `main` at `dcf4127` (merge of 18c-prep) plus follow-on commits for build63 + this run-log
**Prod project ID:** `rzzprgidqbnqcdupmpfe`
**Author:** Claude Code (Session C) + Eric (live)

Forensic record of every step, every verification, every Rule C call. Three Rule C findings encountered: one minor (proceeded), two material that surfaced as latent **18b** regressions, not 18c bugs. One forward-fix migration (build63) added live with Eric approval; one (handle_new_user trigger) deferred to a followup build per Eric's direction.

---

## §0. Pre-flight — independent prod baseline verification

Re-queried prod at session start to confirm post-18b state per the prompt's expected baseline.

**Single-shot baseline query:**

```sql
SELECT
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'tenant_isolation_%') AS tenant_isolation_count,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'transitional_allow_all_%') AS transitional_count,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public') AS total_public_policies,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='user_organizations') AS user_orgs_policies,
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

Result: **13/13 PASS**.

| Check | Expected | Actual |
|---|---|---|
| `tenant_isolation_*` policies | 56 | 56 ✓ |
| `transitional_allow_all_*` policies | 0 | 0 ✓ |
| Total `public` policies | 75 | 75 ✓ |
| `user_organizations` policies | 3 (incl. build60 auth_admin) | 3 ✓ |
| `custom_access_token_hook(jsonb)` exists | TRUE | TRUE ✓ |
| `nookleus.active_organization_id()` exists | TRUE | TRUE ✓ |
| `nookleus.is_member_of(uuid)` exists | TRUE | TRUE ✓ |
| `nookleus.aaa_organization_id()` dropped | TRUE | TRUE ✓ |
| `public.set_active_organization(uuid)` absent | TRUE | TRUE ✓ |
| `user_organizations.is_active` column absent | TRUE | TRUE ✓ |
| `public.organizations` count | 2 | 2 ✓ |
| `public.user_organizations` count | 1 | 1 ✓ |
| `auth.users` count | 1 | 1 ✓ |

**Identity follow-up:**
- Eric's user_id: `7c55cdd0-2cbf-4c8a-8fdd-e141973ade94` (matches Session A handoff §1)
- AAA org id: `a0000000-0000-4000-8000-000000000001` ✓
- Test Co org id: `a0000000-0000-4000-8000-000000000002` ✓
- Eric's role in AAA: `admin` ✓
- Eric's only membership pre-Session-C: AAA ✓
- Hook body still has `ORDER BY created_at ASC` (build55), no `is_active` reference ✓

`list_migrations` last entry pre-Session-C: `build58_drop_aaa_organization_id_helper` (20260425134512). build62/62b/63 NOT present.

**Pre-flight: GO.**

---

## §1. Prod auth hook config — Eric verified

Asked Eric to open `https://supabase.com/dashboard/project/rzzprgidqbnqcdupmpfe/auth/hooks` and confirm the "Customize Access Token (JWT) Claims" hook is ENABLED with schema=`public`, function=`custom_access_token_hook`. Eric confirmed: **Enabled, public.custom_access_token_hook**.

This pre-empts the build60-style failure mode (hook function defined but dashboard config disabled, claim never injected).

---

## §2. Apply build62 to prod

**Migration:** `supabase/migration-build62-user-orgs-active-flag.sql`, byte-identical to scratch's apply per Session B.

**Apply:** `apply_migration` with `project_id=rzzprgidqbnqcdupmpfe`, `name=build62_user_orgs_active_flag`. Result: `{"success":true}`. Migration history version: `20260426064526`.

**Verification (single execute_sql):**

| Check | Expected | Actual |
|---|---|---|
| `is_active` column type | `boolean` | `boolean` ✓ |
| `is_active` nullable | NO | NO ✓ |
| `is_active` default | `false` | `false` ✓ |
| Backfill: rows with `is_active=true` | == count(distinct user_id) | 1 == 1 ✓ |
| Partial unique index `user_orgs_one_active_per_user` exists | TRUE | TRUE ✓ |
| Index def has `WHERE (is_active = true)` | TRUE | TRUE ✓ |
| Hook function body references `is_active = true` | TRUE | TRUE ✓ |
| Hook function body has `ORDER BY created_at ASC` (defensive fallback) | TRUE | TRUE ✓ |

**Eric's existing membership row remains correctly active:**
```
user_id=7c55cdd0-…  org=AAA  role=admin  is_active=true  created_at=2026-04-22 16:33:16+00
```

**Hook EXECUTE grants:** `postgres`, `service_role`, `supabase_auth_admin` (anon + authenticated correctly absent — explicit revoke in migration).

Build62 PASS.

---

## §3. Apply build62b to prod

**Migration:** `supabase/migration-build62b-set-active-organization-rpc.sql`, byte-identical to scratch's apply.

**Apply:** `apply_migration` with `name=build62b_set_active_organization_rpc`. Result: `{"success":true}`. Migration history version: `20260426064629`.

**Verification:**

| Check | Expected | Actual |
|---|---|---|
| `proname` | `set_active_organization` | ✓ |
| `prosecdef` (SECURITY DEFINER) | TRUE | TRUE ✓ |
| Argument signature | `p_org_id uuid` | ✓ |
| `proconfig` | `[search_path=public]` | `["search_path=public"]` ✓ |
| Return type | `void` | `void` ✓ |

### Rule C #1 (MINOR — proceed, no actual drift)

**Title:** Session B's run-log §2 reported set_active_organization EXECUTE grants as `{authenticated, postgres}` only. Prod query returned `{anon, authenticated, postgres, service_role}`.

**Investigation:**
- Queried `pg_default_acl` for public schema: postgres + supabase_admin both default-grant EXECUTE on functions to anon/authenticated/service_role. Universal Supabase platform behavior.
- Queried `mark_contract_expired` (a pre-existing public RPC): grants are `{anon, authenticated, postgres, service_role, PUBLIC}` — same shape plus PUBLIC pseudo-role.
- The migration's `REVOKE EXECUTE FROM public` correctly removed the `PUBLIC` pseudo-role grant — set_active_organization has 4 grants vs mark_contract_expired's 5 (the missing one is PUBLIC).
- The functional security gate (`auth.uid() IS NULL → RAISE EXCEPTION 'not_authenticated'`) is intact and identical to scratch.

**Disposition:** MINOR — Session B's verification summary was incomplete (missing rows in their `information_schema.role_routine_grants` query result), not actual scratch/prod divergence. Byte-identical migration must produce same grants on both Supabase-hosted projects. Functional security identical. The 5-step real-auth round-trip on scratch in Session B PASSED end-to-end, which would not have if grants were broken. Proceed.

Build62b PASS.

---

## §4. DB-side hook smoke (simulated JWT events)

Plan §6 step 3 — verify the hook injects the claim correctly post-build62.

**Test 1: Eric's user_id, expected claim = AAA.**

```sql
SELECT public.custom_access_token_hook(
  jsonb_build_object(
    'user_id', '7c55cdd0-2cbf-4c8a-8fdd-e141973ade94',
    'claims', jsonb_build_object(
      'aud', 'authenticated', 'role', 'authenticated',
      'sub', '7c55cdd0-2cbf-4c8a-8fdd-e141973ade94',
      'email', 'eric@aaacontracting.com',
      'app_metadata', jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'))
    )
  )
);
```

Result: `claims.app_metadata.active_organization_id = a0000000-0000-4000-8000-000000000001` (AAA). ✓

**Test 2: unknown user (no membership), expected event returned unchanged.**

Synthetic user_id `deadbeef-0000-4000-8000-000000000000`. Result: `claims.app_metadata` has no `active_organization_id` key (event unchanged) — defensive fallback path verified.

DB-side hook smoke PASS.

---

## §5. Merge 18c-prep → main, push, watch Vercel deploy

**Local merge:**
- Pre-merge state: `main` at `c84f652`, `origin/18c-prep` at `fdba48d`. 17 files, +2127/-43.
- `git merge --no-ff origin/18c-prep -m "merge(18c): 18c-prep workspace switcher + multi-tenant polish — build62/62b applied to prod"`
- Result: merge commit `dcf4127`. Worktree clean post-merge.

**Push:** `git push origin main` → `c84f652..dcf4127  main -> main`. Vercel auto-deploy triggered.

**Eric confirmed Vercel deploy GREEN with Current badge.** Step 5 unblocked.

---

## §6. Plan §6 step 5 — Eric login + JWT claim verification (PASS, implicit)

Eric was redirected to a Vercel preview URL (`https://aaaplatform-cq726su33-aaa-disaster-recovery-e5661f28.vercel.app/`), saw the Dashboard with **8 active jobs and "Welcome back, Eric"**.

**Implicit proof of JWT claim presence:** RLS on `jobs` is `tenant_isolation_jobs_*` policies that USING `nookleus.is_member_of(organization_id)` (which resolves through `nookleus.active_organization_id()`, which reads `auth.jwt()->'app_metadata'->>'active_organization_id'`). 8 jobs visible == claim is in the JWT and matches AAA.

The console-snippet JWT decode was offered but Eric got tripped up on browser navigation; the implicit proof via `/jobs` rendering AAA-scoped data was accepted as sufficient.

**Step 5: PASS (implicit).**

---

## §7. Rule C #2 — MATERIAL — sign-out button missing in sidebar

Eric reported "the logout button is missing." Screenshot showed **`AAA Platform v1.0`** in the sidebar footer where the user-info + sign-out should be.

### Diagnosis

Read `src/components/nav.tsx`:
- Lines 188-246: `{profile ? <user-info-with-signout> : <p>AAA Platform v1.0</p>}`
- The sidebar's user-info section only renders when `profile` from `useAuth()` is truthy.

Read `src/lib/auth-context.tsx`:
- `loadProfile(userId, activeOrgId)` does `SELECT * FROM user_profiles WHERE id = userId .maybeSingle()`.
- If `profileData` is null, profile state stays null.

Read `src/components/user-menu.tsx`:
- Comment line 11 claims: "the sidebar footer already provides sign-out for the single-org case." Correct in spirit; but the sidebar footer is gated on `profile` being truthy.

**Hypothesis:** `user_profiles` SELECT returns 0 rows for authenticated users → profile state stays null → sidebar shows the fallback.

### Verification — confirmed bug

Queried prod: `user_profiles` has RLS enabled but only ONE policy: `Users can update own profile` (UPDATE only, USING `auth.uid() = id`). **No SELECT policy exists.**

Read `supabase/migration-build57-drop-allow-all-policies.sql`:
- Line 68: `DROP POLICY "Service role full access on user_profiles" ON public.user_profiles;`
- Line 69: `DROP POLICY "Users can view all profiles" ON public.user_profiles;`

**build57 (in 18b) dropped the SELECT policy and never replaced it.** The bug has been latent on prod since 18b shipped 2026-04-25 (~24 hours pre-Session-C). It only surfaced in Session C because Eric attempted his first logout post-18b in step 5 of this session.

### Adjudication — Rule C #2 disposition

**MATERIAL.** Rolling back 18c would NOT fix this — 18c is innocent. The fix is a forward-applied SELECT policy on user_profiles.

Surfaced to Eric with two scope options:
1. **Self-read + shared-org-read (RECOMMENDED).** `id = auth.uid() OR EXISTS (uo.user_id = user_profiles.id AND nookleus.is_member_of(uo.organization_id))`. Restores pre-build57 intent narrowed to tenant-isolation. Also unblocks /settings/users employee displays.
2. **Self-read only.** Minimum to fix sign-out. /settings/users may still be broken.
3. **Roll back 18c first, fix separately.**

Eric chose option 1 (recommended).

### build63 forward-fix

Authored `supabase/migration-build63-user-profiles-select-policy.sql` + `supabase/build63-rollback.sql` locally. Applied via `apply_migration` with `name=build63_user_profiles_select_policy`. Result: `{"success":true}`. Migration history version: `20260426070316`.

```sql
CREATE POLICY user_profiles_authenticated_read
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
        FROM public.user_organizations uo
       WHERE uo.user_id = public.user_profiles.id
         AND nookleus.is_member_of(uo.organization_id)
    )
  );
```

**Post-apply verification:** `pg_policies` on `user_profiles` returns 2 rows: `Users can update own profile` (UPDATE) + `user_profiles_authenticated_read` (SELECT, `{authenticated}`). ✓

**Eric verified the fix:** hard-refreshed prod, sidebar footer now shows his name + sign-out icon. Build63 PASS.

---

## §8. Plan §6 steps 6–11 — Workspace switcher live tests

| Step | What | Result |
|---|---|---|
| 6 | Switcher correctly HIDDEN with single membership (per `user-menu.tsx` line 97 `if (memberships.length < 2) return null`). | **PASS** — Eric confirmed top-right empty. |
| 7 | Eric add himself to Test Co via SQL. Eric got tripped up on dashboard SQL editor navigation; chose "you run it via MCP." Plan §6 actor was "Eric (Supabase dashboard SQL editor)" but the spirit ("a deliberate state-changing action recorded in the run-log") is satisfied either way. INSERT executed via `execute_sql`: `INSERT INTO public.user_organizations (user_id, organization_id, role) VALUES ('7c55cdd0...', 'a0000000-...002', 'admin')`. Defaults handled `id`, `created_at`, `is_active=false`. Verify SELECT: 2 rows for Eric, AAA `is_active=true` (created 2026-04-22), Test Co `is_active=false` (created 2026-04-26 07:09:38). | **PASS** |
| 8 | Eric logout → login. Avatar pill in top-right shows "AAA Disaster Recovery". Click → dropdown lists AAA (with check) + Test Company. | **PASS** |
| 9+10 | Click "Test Company" → page reloads → avatar pill now "Test Company" → /jobs empty + /contacts empty. RPC + refreshSession + reload all worked; tenant isolation enforced. | **PASS** |
| 11 | Click avatar → click "AAA Disaster Recovery" → page reloads → /jobs shows AAA's 8 jobs again. Round-trip works in both directions; RPC's clear-then-set ordering does not transiently violate the partial unique index. | **PASS** |

**Headline:** the multi-tenant switcher works end-to-end on prod via the real auth API. The Session B critical-path test (5-step round-trip on scratch) translates directly to Eric's live prod walkthrough.

---

## §9. Plan §6 step 12 — ConfigProvider cold incognito (PASS)

Eric opened a fresh incognito window, logged in, navigated to /jobs. **Job-card colored damage strips render with proper damage-type colors on first paint** (no gray fallback). Plan §5.4 fix (approach a — wait for `INITIAL_SESSION` before fetching) verified live on prod.

---

## §10. Plan §6 step 13 — /sign/[token] for AAA (PASS)

### Setup

The 5 most recent AAA contracts on prod all had link_tokens issued ~7 days ago with 7-day exp; current time exceeds them all → `verifySigningToken` would throw `Token expired`, render `EMPTY_BRAND` shell — not a useful test.

Picked draft contract `907f1b15-ec59-43b3-840b-d8941a2d03b4` (signer Shenoah Grove, link_token NULL pre-test). Minted a fresh JWT with 30-day exp via inline Node + `SIGNING_LINK_SECRET` from `.env.local`:

```js
const h = b64(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
const p = b64(Buffer.from(JSON.stringify({
  contract_id: '907f1b15-ec59-43b3-840b-d8941a2d03b4',
  signer_id: '613fcafd-19f9-42ce-91b0-b94bb65f6ea6',
  iat: now, exp: now + 30*24*3600
})));
const sig = b64(createHmac('sha256', SECRET).update(h+'.'+p).digest());
```

UPDATE `public.contracts SET link_token = <fresh JWT>` WHERE id = `907f1b15...`.

### Eric's verification

Eric visited `https://aaaplatform.vercel.app/sign/<token>` in incognito. Result: **AAA branding (logo, name, phone, address), signing form for "Work Authorization - Tina TestCo"** [misnamed contract title — legacy data]. PASS.

---

## §11. Plan §6 step 14 — /sign/[token] for Test Company (PASS)

### Setup — TestCo seed (8 rows, single execute_sql transaction)

All Session-C ad-hoc test rows use `f0000033-*` UUID prefix to mark as cleanup-able.

Created in dependency order:
1. `contacts` (Tina TestCo, tina@testcompany.test)
2. `jobs` (TST-2026-0001, water damage at "999 Test Boulevard")
3. `contract_templates` (Test Co Work Authorization)
4. `contracts` (Work Authorization - Tina TestCo, status=sent, link_token=<minted JWT>, link_expires_at=now()+30d)
5. `contract_signers` (Tina TestCo, signer_order=1)
6. `company_settings` (4 rows: company_name=Test Company SaaS, phone=(555) 999-8888, email=billing@testcompany.test, address=999 Test Boulevard, Test City, TC 99999)

Token minted with `payload = { contract_id: 'f0000033-c011-...', signer_id: 'f0000033-5181-...', iat, exp: +30d }`, included directly in the contracts INSERT.

### Eric's verification

Eric visited `/sign/<testco_token>` in incognito. Result: **"Test Company SaaS" header, phone (555) 999-8888, email billing@testcompany.test, signing form for Tina TestCo. NO AAA branding anywhere on the page.** Public-route multi-tenant fix verified end-to-end on prod for /sign. PASS.

---

## §12. Plan §6 step 14a — /pay/[token] for Test Company (PASS, with detail)

Per Session A's §6.1.2 widening (the Rule C minor scope expansion in Session A): `pay/[token]/page.tsx` queries `stripe_connection` AND `payment_email_settings` scoped by `pr.organization_id`, replacing pre-fix `.limit(1)` selects.

### Setup — additional TestCo rows for /pay

Added (still using `f0000033-*` prefix for cleanup):
- `stripe_connection` (TestCo) — placeholder `stripe_account_id`/`publishable_key`/`secret_key_encrypted`, `card_fee_percent=3.50` (vs AAA's default 3.00), `default_statement_descriptor='TESTCO 18C'`
- `payment_email_settings` (TestCo) — `send_from_email=billing@testcompany.test`, `fee_disclosure_text='TestCo Session-C verification: 3.5% surcharge applies to card transactions only — pay by ACH to avoid.'` (vs AAA's "A 3% service fee applies...")
- `payment_requests` (TestCo) — `request_type=deposit`, `title='Deposit for TST-2026-0001'`, `amount=250.00`, `status=sent`, `link_token=<minted /pay JWT>`, `link_expires_at=now()+30d`

`/pay` token shape differs from `/sign`: payload has `payment_request_id` + `job_id`, not `contract_id` + `signer_id`. Minted via the same inline Node mint pattern.

### Eric's verification (screenshot)

Eric visited `/pay/<testco_pay_token>` in incognito. Screenshot showed:
- Header: **Test Company SaaS** with `(555) 999-8888 · billing@testcompany.test`
- Body: "JOB TST-2026-0001 · PAYMENT TO TEST COMPANY SAAS", "Deposit for TST-2026-0001", "$250.00", "999 Test Boulevard"
- Payment selector visible: "Pay by bank (no fee) / No fee" highlighted by default + "Pay by card" option
- Footer: "999 Test Boulevard, Test City, TC 99999 — Questions? Contact billing@testcompany.test · (555) 999-8888"
- **Zero AAA-branding strings on the page-content surface**

Eric clicked "Pay by card" and got "Failed to start checkout" — **expected**: the placeholder `pk_test_session_c_testco_placeholder...` and `acct_session_c_testco_placeholder` are not real Stripe credentials, so `/api/pay/[token]/checkout` failed when calling Stripe. This was a known pre-test consequence, not a regression.

The fee disclosure text isn't visible on the initial page render — it's wired as a prop to the method-selector client component (`pay/[token]/page.tsx` line 284: `feeDisclosure={settingsRow?.fee_disclosure_text ?? null}`) and rendered conditionally inside that component (likely on card-method selection). The query that fetches it IS scoped by `pr.organization_id` per the Session A fix; the visible TestCo branding + TestCo job number + TestCo address all confirm the broader org-scoping fix landed.

The browser-tab title `"AAA Disaster Recovery — Platf..."` is the layout-level hardcoded `<title>` from `src/app/layout.tsx`, separate from the page-content branding. Session B noted the same in scratch; it's a Phase 5 cosmetic concern (per-org tab title), not a Session C verification failure.

**§6.1.2 widening verified end-to-end on prod: PASS.**

---

## §13. Rule C #3 — MATERIAL → DEFERRED — handle_new_user trigger missing on auth.users

### Step 15 walkthrough → unexpected error

Eric attempted plan §6 step 15 (Build 14d invite regression check). Filled in /settings/users → Add Team Member dialog (Eric Testerson, eric@testtesttest.com, Crew Member role) → Add User. Dialog returned error: **`insert or update on table "user_organizations" violates foreign key constraint "user_organizations_user_id_profile_fkey"`**.

### Diagnosis

Read `src/app/api/settings/users/route.ts:70-117`:
- Comment line 70-71: "Create auth user with invite — handle_new_user trigger creates user_profiles row."
- Code calls `service.auth.admin.createUser(...)`, then immediately `INSERT INTO user_organizations (user_id, ...)` — relies on `handle_new_user` trigger having auto-created the `user_profiles` row in the interim.

Queried prod for triggers on `auth.users`: **zero non-internal triggers**. Queried for the function: `public.handle_new_user()` exists, but **no trigger calls it**.

The function exists; the trigger doesn't. Either the trigger was never created on prod, or it was dropped at some point. Migration history shows no `handle_new_user` trigger creation in any committed migration file.

### Adjudication

This is a **latent 18b regression** (or older — undetermined exactly when the trigger went missing). Like Rule C #2 (build63), this is NOT 18c's fault and rolling back 18c would not fix it. This is also separate from the Build 14d code itself, which assumes the trigger exists.

Eric chose **"Skip step 15, go to cleanup"** — i.e., defer the fix. The fix is small (recreate the trigger) but requires verifying `handle_new_user`'s body covers what the invite flow expects (full_name from invite metadata, etc.) before recreating. That investigation belongs in a separate followup build, not 18c Session C.

**Disposition:** MATERIAL — DEFERRED to followup build (suggested name: build64_handle_new_user_trigger). Documented in §17 carry-forward + Session C handoff.

---

## §14. Cleanup

Single execute_sql transaction:

```sql
-- 1. Restore AAA contract 907f1b15 link_token to NULL (was NULL pre-step-13)
UPDATE public.contracts SET link_token = NULL WHERE id = '907f1b15-ec59-43b3-840b-d8941a2d03b4';

-- 2. Delete TestCo seed rows in reverse FK order
DELETE FROM public.contract_signers WHERE id = 'f0000033-5181-4222-8000-000000000003';
DELETE FROM public.contracts WHERE id = 'f0000033-c011-4222-8000-000000000003';
DELETE FROM public.contract_templates WHERE id = 'f0000033-7e70-4222-8000-000000000003';
DELETE FROM public.payment_requests WHERE id = 'f0000033-9091-4222-8000-000000000003';
DELETE FROM public.stripe_connection WHERE id = 'f0000033-577e-4222-8000-000000000003';
DELETE FROM public.payment_email_settings WHERE id = 'f0000033-e511-4222-8000-000000000003';
DELETE FROM public.jobs WHERE id = 'f0000033-1010-4222-8000-000000000003';
DELETE FROM public.contacts WHERE id = 'f0000033-c0c0-4222-8000-000000000003';
DELETE FROM public.company_settings WHERE organization_id = 'a0000000-0000-4000-8000-000000000002';
```

**Verification:** all 9 TestCo seed targets count=0; AAA contract link_token=NULL. **Eric's TestCo membership row was intentionally KEPT** — it's part of the dogfooding state Eric wants per plan §6 step 7. He has 2 memberships at session end (AAA active, TestCo inactive); 1 active row total across the table.

---

## §15. Final prod state (verified)

```sql
SELECT
  (SELECT count(*) FROM pg_policies WHERE schemaname='public') AS total_policies,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='user_profiles') AS user_profiles_policies,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='user_organizations') AS user_orgs_policies,
  (SELECT to_regprocedure('public.set_active_organization(uuid)') IS NOT NULL) AS set_active_rpc_present,
  (SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_organizations' AND column_name='is_active')) AS is_active_column_present,
  (SELECT count(*) FROM public.user_organizations WHERE user_id = '7c55cdd0-2cbf-4c8a-8fdd-e141973ade94') AS eric_memberships,
  (SELECT count(*) FROM public.user_organizations WHERE is_active=true) AS active_rows;
```

| Check | Value |
|---|---|
| Total `public` policies | 76 (was 75 → +1 from build63) |
| `user_profiles` policies | 2 (UPDATE-self + new SELECT from build63) |
| `user_organizations` policies | 3 (unchanged from build60) |
| `public.set_active_organization(uuid)` exists | TRUE |
| `user_organizations.is_active` column exists | TRUE |
| Eric's memberships | 2 (AAA + Test Co) |
| Active rows in `user_organizations` | 1 (Eric → AAA active) |

**Migration history additions in this session:**
- `20260426064526 build62_user_orgs_active_flag`
- `20260426064629 build62b_set_active_organization_rpc`
- `20260426070316 build63_user_profiles_select_policy`

---

## §16. Output summary block (per prompt)

| Verification | Result |
|---|---|
| Pre-flight prod baseline verification | **PASS** |
| Prod auth hook config (Eric verified) | **PASS** |
| build62 apply to prod | **PASS** |
| build62b apply to prod | **PASS** |
| DB-side hook smoke (simulated JWT) | **PASS** |
| Merge 18c-prep → main, Vercel deploy | **PASS** |
| Step 5 (Eric: real login + JWT claim) | **PASS** (implicit via /jobs rendering 8 AAA jobs; explicit JWT decode skipped due to UI navigation friction) |
| Step 6 (Eric: switcher correctly hidden, AAA only) | **PASS** |
| Step 7 (TestCo membership inserted; via MCP path A per Eric's choice) | **PASS** |
| Step 8 (Eric: re-login, both orgs visible) | **PASS** |
| Step 9 (Eric: switch to TestCo, page reload) | **PASS** |
| Step 10 (Eric: TestCo session is empty) | **PASS** |
| Step 11 (Eric: switch back to AAA) | **PASS** |
| Step 12 (Eric: ConfigProvider cold incognito) | **PASS** |
| Step 13 (Eric: /sign existing AAA contract — fresh token minted) | **PASS** |
| Step 14 (Eric: /sign new TestCo contract) | **PASS** |
| Step 14a (Eric: /pay new TestCo payment_request — §6.1.2 widening) | **PASS** |
| Step 15 (Eric: invite regression) | **DEFERRED** — handle_new_user trigger missing on auth.users (latent 18b regression) — followup build needed |
| Cleanup | **PASS** (9 TestCo seed targets deleted, AAA contract link_token restored, Eric's TestCo membership KEPT) |
| Migrations applied | **build62 + build62b + build63** (build63 = forward-fix for Rule C #2) |

---

## §17. Carry-forward for future builds

These are NOT 18c work but ARE things future sessions should know:

1. **handle_new_user trigger missing on `auth.users`.** Latent 18b regression. The `public.handle_new_user()` function exists but no trigger calls it. The /settings/users invite flow (`src/app/api/settings/users/route.ts`) assumes the trigger creates the `user_profiles` row before the route inserts into `user_organizations`. Without the trigger, the FK constraint `user_organizations_user_id_profile_fkey` violates. Suggested followup: `build64_recreate_handle_new_user_trigger`. Verify `public.handle_new_user()` body first (full_name extraction from invite metadata, default values, etc.) before recreating the AFTER INSERT trigger on `auth.users`.

2. **Plan-template suggestion: latent-bug discovery.** Rule C #2 (build63) and #3 (handle_new_user) were both latent 18b regressions surfaced when Eric exercised paths he hadn't touched since 18b shipped (logout, invite). 18b's smoke didn't include "log out + log back in" or "invite a new user." Future plans should include "exercise every auth-mutating user action once" as part of Session C — even if those actions are unrelated to the build's stated scope. The lesson Eric framed for the planning template: "right after a major RLS / auth-policy change, exercise every auth path the live user has — not just the ones the build directly modifies."

3. **Plan-template suggestion: executor credential pre-flight.** Carried forward from Session B's Finding #2 — Supabase MCP does not expose service-role keys. If a future build's Session-C-equivalent needs to run a dev server against prod (e.g., for an end-to-end script that bypasses RLS), include "confirm executor has all credentials needed for deliverables" in the prep prompt to surface tooling gaps during planning rather than mid-execution.

4. **Backfill non-determinism** (carry-over from Session B operational note): non-issue on prod through 18c (only Eric's two memberships, with distinct created_at timestamps minutes apart). Stays a future concern only if the platform ever bulk-inserts memberships in a single SQL statement.

5. **Tab-title hardcoded to "AAA Disaster Recovery — Platform".** Session A noted; Session B noted in scratch; observed live in step 14a screenshot. Layout-level hardcode in `src/app/layout.tsx`. Phase 5 (per-org tab title / per-org domain) followup. Not a tenant-isolation concern — pure cosmetic.

6. **Eric's TestCo membership remains.** Eric is now an admin of both AAA and Test Company per plan §10 #3. Test Company has zero data; Eric will manually populate fixtures as needed for ad-hoc verification.

7. **Worktree env-wiring quirk** (carry-over from Session B Finding #3): not exercised in Session C since no preview_start was needed; carry-forward unchanged.

8. **Scratch service-role key rotation** (action item flagged in Session B handoff): not Session C's responsibility, but still pending Eric's manual action via dashboard.

---

*End of run-log.*
