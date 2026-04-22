# Build 18a — Complete Handoff (post-prod-apply)

**Last updated:** 2026-04-22
**Branch:** `build-18a-code-sweep`
**Prod project ref:** `rzzprgidqbnqcdupmpfe`
**Scratch project ref:** `opbpcyxxrqzyvtzwjcsa` (still alive — keep ≤24h as insurance, then delete)
**Plan document:** [docs/superpowers/plans/2026-04-21-build-18a-schema-backfill.md](superpowers/plans/2026-04-21-build-18a-schema-backfill.md)
**Stage-1 handoff (rehearsal):** [docs/build-18a-handoff.md](build-18a-handoff.md) — historical only; superseded by this doc.

---

## 1. Status

**Build 18a is COMPLETE.** All 11 schema migrations (build42–build52) are applied to prod. Smoke check passes on prod. Branch has the orphan-fallback patch + 3 blocker fixes from rehearsal. Two unpushed commits remain locally:

- `098b57b` fix(nav): bump sidebar sign-out icon contrast
- `24840bb` fix(18a): proxy.ts, build51 FK+RLS, build52 auth.users tokens

Nothing in 18a's plan document is still open. The next mainline of work is **build 18b** (RLS enforcement + session context).

---

## 2. Migrations applied to prod

All applied via Supabase MCP `apply_migration` against `rzzprgidqbnqcdupmpfe` on 2026-04-22 in the listed order. Each was an atomic transaction — failed attempts rolled back fully and were retried after pre-cleanup.

| # | Migration | What it does | Notes |
|---|---|---|---|
| 42 | `build42_create_organizations_and_memberships` | `organizations`, `user_organizations`, `nookleus` schema + helpers, AAA + Test Company seeded, Eric's admin membership | Applied in prior session |
| 43 | `build43_add_nullable_organization_id_columns` | Adds nullable `organization_id uuid` to 31 bucket-A + 13 bucket-B + 6 bucket-D tables | Metadata-only; ran in ms |
| 44 | `build44_backfill_organization_id` | Bucket A → AAA. Bucket B → denormalize from parent → orphan fallback to AAA | **First attempt failed** on 9 orphan `contract_events` (parent contracts hard-deleted on 2026-04-21). Added orphan-fallback step; retry succeeded. **Repo file now contains the orphan fallback** (committed in this session). |
| 45 | `build45_organization_id_not_null_and_fks` | NOT NULL + FK + index on bucket A/B; FK + index only on bucket D. RPC patches: `create_expense_with_activity`, `create_contract_draft`, `create_contract_with_signers` | |
| 46 | `build46_rework_unique_indexes` | Org-scoped composite UNIQUE indexes; split-partial-unique on bucket-D name columns | **First attempt failed** on duplicate `("Untitled Template")` rows in `contract_templates`. Manually renamed the later duplicate to `"Untitled Template (copy 2)"`; retry succeeded. Both rows are unused (no contracts reference them). Cleanup is **prod-only** — not in repo because it's data, not schema. |
| 47 | `build47_per_org_number_generator` | `org_number_counters` table; `next_job_number`, `next_invoice_number` RPCs replace global sequence triggers | Seeded AAA: `job=14`, `invoice=2` (verified against prod's max numbers at apply time). |
| 48 | `build48_migrate_user_permissions_and_preferences` | `user_organization_permissions`, `notification_preferences` rewire (user_id → user_organization_id), 9 role-policy rewrites, `handle_new_user`/`notify_admins`/`set_default_permissions` rewrites, drop `user_profiles.role`, deprecate `user_permissions` | Already had the `DROP FUNCTION` fix from `b380c54`. |
| 49 | `build49_rls_policies_written_not_enforced` | `tenant_isolation_*` policies on bucket A/B/D; ENABLE RLS on `job_files` + `invoice_line_items`; meta-table policies | Applied as 2 splits to fit MCP request size. **Effective state: 56 tenant-isolation policies, 57 RLS-enabled public tables.** Allow-all policies remain alongside (per Option A' — 18b drops them). |
| 50 | `build50_storage_migration_tracking` | `storage_migration_progress` table + `storage_paths_swap_to_new()` function | Storage migration script not yet run — see §6. |
| 51 | `build51_user_organizations_postgrest_fk` | Parallel FK `user_organizations.user_id → user_profiles(id)` for PostgREST embeds; `nookleus.is_member_of()` SECURITY DEFINER helper; `user_orgs_member_read` RLS policy | **New migration** added during rehearsal. Without it, `/settings/users` returns `[]`. |
| 52 | `build52_auth_users_null_token_backfill` | `update auth.users set ... = coalesce(..., '')` for 4 token columns | **New migration** added during rehearsal. Without it, GoTrue panics on Eric's seed row → silent login failure + 500 from `/admin/users`. |

Post-apply prod smoke check (2026-04-22):

- `organizations`: 2 (AAA + Test Company)
- `user_organizations`: 1 (Eric admin on AAA)
- `user_organization_permissions`: 18
- `org_number_counters`: 2 rows (AAA: `job=14`, `invoice=2`)
- `tenant_isolation_*` policies: **56**
- Tables with `relrowsecurity=true`: **57**
- NULL `organization_id` rows across all bucket-A/B tables: **0**
- `auth.users` rows with NULL token columns: **0**
- `contract_templates` unique `(org_id, name)` pairs: 3 of 3 (no constraint violations)

---

## 3. Blockers fixed during scratch rehearsal

These were the three discoveries that came out of running the actual app against the post-build50 schema. Each has a committed fix on the branch.

### 3.1 Next 16 renamed `middleware` → `proxy`

**Symptom:** `/settings/users` showed Eric as signed in but `/api/settings/users` returned `[]`. No Supabase session cookies were ever set. Auth gate never redirected unauthenticated users to `/login`.

**Root cause:** The `middleware.ts` file at the repo root was silently ignored on Next 16 because the framework now expects `proxy.ts` instead. The exported function must be named `proxy` (or be the default export); `middleware` is no longer recognized.

**Fix:** [src/proxy.ts](../src/proxy.ts) — moved + renamed. Same logic as the old middleware: refresh session, gate `/login`, allow `/api/`, `/sign/`, `/pay/` through unauthenticated.

### 3.2 GoTrue NULL token columns → silent login failure

**Symptom:** `POST /auth/v1/token` returned 500 `"Database error querying schema"`. The `/login` form silently failed (no toast, no console error) because the SDK swallows the 500. `/admin/users` (used by service-role admin API in `/api/settings/users`) returned 500 `"Database error finding users"`.

**Root cause:** GoTrue scans `auth.users` rows into Go structs where `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change` are typed as `string` (not `*string`). NULL → panic. Build42 inserted Eric's seed row via raw SQL that didn't set these columns, and they have no DB default.

**Fix:** [supabase/migration-build52-auth-users-null-token-backfill.sql](../supabase/migration-build52-auth-users-null-token-backfill.sql) — `coalesce(..., '')` on all four columns.

**Note for future seed scripts:** newly signed-up users via GoTrue's `createUser` path get `''` automatically. Only SQL-seeded rows hit this. If we ever do another bulk seed, set these explicitly.

### 3.3 `/settings/users` returned `[]` after build49

**Symptom:** Users & Crew page rendered empty even though Eric was signed in and a membership row existed. `/api/settings/users` returned `[]` rather than `[{Eric}]`.

**Root cause:** Two coupled issues, both required:
1. PostgREST didn't expose a relationship for the `user_organizations.user_profiles:user_id(...)` embed because the FK pointed at `auth.users`, not `public.user_profiles`. PostgREST does not surface FKs into the auth schema.
2. The build49 `user_orgs_self_read` policy only let a user see their own membership row. The Users & Crew page needs to list all members of the active org; notification fan-out needs to reach every admin.

**Fix:** [supabase/migration-build51-user-organizations-postgrest-fk.sql](../supabase/migration-build51-user-organizations-postgrest-fk.sql) — adds parallel FK to `user_profiles`, plus `nookleus.is_member_of()` SECURITY DEFINER helper and `user_orgs_member_read` policy.

---

## 4. Current state of the app

### Working
- All migrations applied; schema is at build52.
- Login works (after build52). Eric's session establishes correctly.
- `/settings/users` lists members of the active org and shows roles from `user_organizations`.
- `/api/settings/users` GET returns enriched member rows; POST creates auth user + membership + permission rows.
- Tenant scoping is in effect on every server-side query that goes through the code-sweep helpers — `getActiveOrganizationId()` returns the AAA constant (per plan; replaced by JWT read in 18b).
- Per-org number generation: next job created via intake will be `WTR-2026-0014` (or another prefix matching damage type).
- All bucket-A/B writes are guaranteed to set `organization_id` (NOT NULL constraint plus the code sweep's `.insert({ ..., organization_id: orgId })` pattern).
- Storage path conventions are wired in code through `src/lib/storage/paths.ts`. New uploads use the org-prefixed layout.

### Not yet done (scope-correct — these belong to 18b/18c)
- **RLS is not enforcing tenant isolation.** Both the new `tenant_isolation_*` policies AND the old allow-all policies coexist. Because `PERMISSIVE` policies are OR'd, allow-all wins. Multi-tenant queries from the same browser session would currently see other orgs' data IF a malicious user could spoof `organization_id` in their requests — but the code sweep always supplies AAA's id, so this is a latent risk, not an active leak. **18b drops allow-all to flip the gate.**
- **No JWT `active_organization_id` claim yet.** `nookleus.active_organization_id()` returns NULL. The Access Token Hook function is created but not enabled in the Supabase dashboard. The code reads `getActiveOrganizationId()` which returns the AAA constant. **18b enables the hook + swaps callers.**
- **No workspace switcher UI.** Test Company exists in `organizations` but no user has a membership in it. **18c.**
- **Storage migration script (`scripts/migrate-storage-paths.ts`) not yet run against prod.** Existing files still live at the old paths. New uploads use the new layout. The dual-read code in `src/lib/storage/paths.ts` handles old paths, so this is non-blocking. Run when convenient — expect ~74 objects.

### Known minor issues to watch
- `org_number_counters` was seeded with `job=14, invoice=2`. If anyone created a job between when the seed was computed and when the migration ran, the counter could collide with an existing job number. Spot-check after the first new intake submission.
- The 2 unused `"Untitled Template"` rows that caused build46 to fail — one was renamed to `"Untitled Template (copy 2)"`. Both are still in `contract_templates`. If/when we clean up, also drop both. They're not referenced by any contract.
- `user_permissions` table is intentionally kept (commented as DEPRECATED) for revert safety. Most write paths dual-write. Drop in a follow-up cleanup migration ~2 weeks after 18b ships.
- Vercel deploy has not been refreshed since the prod migrations landed. The prod app is still running pre-build52 client code against the now-migrated DB. Most surfaces work because the client only queries through API routes which the SSR path will pick up — but if any client-side direct Supabase query references `user_profiles.role`, it will 500. **Safer to deploy the branch before the next user session.**

---

## 5. What 18b and 18c do

### Build 18b — RLS enforcement + session context

Per plan §0 / §5 / §6:

1. **Enable Access Token Hook in Supabase dashboard.** Wires `nookleus.active_organization_id()` to actually return the JWT claim instead of NULL. Default behavior on first login: pick first membership ordered by `created_at`.
2. **Code swap:** every `getActiveOrganizationId()` call site reads from session/JWT instead of returning the AAA constant. The temporary `nookleus.aaa_organization_id()` helper gets dropped after no callers remain.
3. **Drop allow-all RLS policies.** Either `DROP POLICY ... allow_all` per table, or convert them to `RESTRICTIVE` with `false` qual. Tenant isolation policies (already written in build49) become the sole gate. The 56 tenant-isolation policies cover every bucket-A/B/D table; build49's coverage check confirmed zero tables-with-RLS-and-no-non-allow-all-policy.
4. **Set `app_metadata.active_organization_id`** when Eric switches workspace (placeholder until 18c ships the switcher).
5. **Drop `nookleus.aaa_organization_id()`** once all code-sweep callers are gone.

Risk profile: this is the change with real RLS teeth. Any code path that doesn't supply `organization_id` correctly will either return empty results (read) or fail RLS (write). The code sweep in 18a was specifically meant to surface those — but anything missed comes out in 18b. Have a rollback plan (re-add allow-all policy temporarily).

### Build 18c — Nookleus rebrand + workspace switcher

Per plan recap:

1. UI rebrand from "AAA platform" to "Nookleus" (or whatever the final name lands as).
2. **Workspace switcher UI** — dropdown in the sidebar, switches `app_metadata.active_organization_id`, forces session refresh.
3. User invitation flow that lets an admin in one org invite a new user into that specific org.

### Build 18d — Per-tenant third-party connections

Out of scope for now. Per plan, this is the work to make Stripe/QuickBooks/email connections per-org instead of per-app. Don't start until 18b + 18c are stable.

---

## 6. Exact next steps for the fresh session

In priority order:

1. **Push the branch.**
   ```bash
   git push -u origin build-18a-code-sweep
   ```
   2 unpushed commits: `098b57b`, `24840bb`. After this session's commit lands, push that too.

2. **Open a PR** (optional but recommended for the audit trail):
   ```bash
   gh pr create --title "Build 18a: multi-tenant schema + code sweep" \
     --body "..."
   ```
   Squash-merge or rebase as preferred.

3. **Deploy to Vercel** (or whatever the prod deploy path is). Without this, prod runs old client code against the new schema — works mostly, but anything that touches `user_profiles.role` directly will 500.

4. **Sign in to prod** (`https://<prod-domain>/login`) and walk the smoke checklist:
   - [ ] `/` dashboard renders
   - [ ] `/jobs` lists 5 jobs
   - [ ] `/contacts` lists 5 contacts
   - [ ] `/settings/company` settings render
   - [ ] `/settings/users` lists Eric as admin
   - [ ] **Intake form submit** — create a real test job, confirm `job_number = WTR-2026-0014` (or matching prefix). Decide whether to delete or keep.
   - [ ] `/jarvis` page loads (was the original service-role failure mode)
   - [ ] Try creating a contract from a template — exercises the build45 RPC patches.

5. **Run the storage migration script** when convenient:
   ```bash
   npx tsx scripts/migrate-storage-paths.ts
   ```
   Expect ~74 objects. Resumable via `storage_migration_progress` table — safe to interrupt.

6. **Delete the scratch project** `opbpcyxxrqzyvtzwjcsa` after 24h of prod stability. Supabase Dashboard → Settings → General → Delete project.

7. **Keep `.env.local.prod-backup` around** until the scratch project is deleted. If at any point the active `.env.local` is the scratch one, the dev server is talking to the wrong DB — `cp .env.local.prod-backup .env.local` to recover.

8. **Plan build 18b.** The plan doc already enumerates the work; the new session can start by reading `docs/superpowers/plans/2026-04-21-build-18a-schema-backfill.md` §6 (Access Token Hook) and §5.9 (RLS coverage check that 18b inherits).

---

## 7. Watch-outs

- **Counter race risk.** `org_number_counters.next_value` is read-modify-write inside the `next_job_number()` RPC. The RPC uses `UPDATE ... RETURNING` so it's atomic per call, but parallel intake submissions in the same second on the same org could theoretically race. Has not been observed in single-tenant testing.
- **The orphan-fallback in build44 is defensive.** Only `contract_events` had orphans on prod (9 rows). If we ever discover other orphans in future tables, the same pattern applies.
- **build46's prod-only de-dupe is data, not schema.** Future re-applies of build46 against a fresh DB will not need it. If we ever rebuild a prod-like database from migrations + a snapshot, watch for the same constraint violation if the snapshot includes the duplicate template rows.
- **Don't drop `user_permissions` yet.** Two write paths still dual-write. Wait until 18b is stable.
- **Don't enable the Access Token Hook yet.** It's part of 18b's atomic switch — enabling it now without dropping allow-all and swapping code callers leaves the system in an in-between state where some code paths read JWT (NULL) and some still use the constant.
- **`nookleus.is_member_of()` is SECURITY DEFINER.** Don't add additional logic to it without thinking about RLS bypass — the function intentionally short-circuits RLS so the policy on `user_organizations` doesn't recurse.
- **Vercel build cache.** If the deploy fails with type errors referencing `user_profiles.role`, that's the build cache holding pre-build48 types. Bust it by touching `package.json` or running with `--force`.

---

## 8. Quick reference — key UUIDs, paths, and ids

| Thing | Value |
|---|---|
| Prod Supabase project | `rzzprgidqbnqcdupmpfe` |
| Scratch Supabase project | `opbpcyxxrqzyvtzwjcsa` |
| AAA organization id | `a0000000-0000-4000-8000-000000000001` |
| Test Company organization id | `a0000000-0000-4000-8000-000000000002` |
| Eric's auth.users id | `7c55cdd0-2cbf-4c8a-8fdd-e141973ade94` |
| Active-org helper (18a) | `src/lib/supabase/get-active-org.ts` (returns AAA constant; replaced in 18b) |
| Access Token Hook function | `nookleus.active_organization_id()` (created in build42, returns NULL until 18b enables the hook) |
| Member-of helper | `nookleus.is_member_of(uuid)` (SECURITY DEFINER, used by `user_orgs_member_read`) |
| Storage path builders | `src/lib/storage/paths.ts` |
| Per-org number RPCs | `public.next_job_number(uuid, int)`, `public.next_invoice_number(uuid, int)` |
