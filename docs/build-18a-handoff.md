# Build 18a — Handoff

**Last updated:** 2026-04-22
**Branch:** `build-18a-code-sweep` (not pushed; local only)
**Plan document:** [docs/superpowers/plans/2026-04-21-build-18a-schema-backfill.md](superpowers/plans/2026-04-21-build-18a-schema-backfill.md)

---

## 1. Where we are in the plan

The plan has three prompts:

- **Prompt A — Migrations + code sweep (no DB changes).** DONE. Produced 9 migrations, the storage rename script, and the full code sweep on branch `build-18a-code-sweep`. `npm run build` passes.
- **Prompt B — Scratch rehearsal.** IN PROGRESS. Scratch Supabase project provisioned, all 9 new migrations applied on top of a reconstructed pre-18a schema, minimal test data seeded, dev server repointed at scratch. Smoke test is mid-walkthrough — dev server is live, some initial fixes landed (duplicate env var, stale cookies), Eric needs to sign out + sign back in and finish the list.
- **Prompt C — Prod apply.** NOT STARTED. Only begin after Prompt B's smoke tests all pass.

## 2. Migrations

### Applied to SCRATCH project `opbpcyxxrqzyvtzwjcsa`
All of these are live on the scratch DB. Verified via `list_migrations`:

| Order | Name | Covers |
|---|---|---|
| 1 | `00_base_schema` | Original `schema.sql` — contacts, jobs, job_activities, invoices, line_items, payments |
| 2 | `01_email_photos_builds_12_to_14g` | email_accounts/emails/email_attachments, photos/tags/annotations/reports, company_settings, job_statuses/damage_types, user_profiles + user_permissions + handle_new_user trigger, email_signatures, form_config + job_custom_fields, notifications + notification_preferences |
| 3 | `02_builds_21_to_31_and_fix` | jarvis_conversations/alerts, knowledge_documents/chunks + pgvector, marketing_assets/drafts, email categories + category_rules, nav_items, job_files, insurance redesign + job_adjusters, fix-folder-names |
| 4 | `03_build32_contract_templates` | contract_templates + manage_contract_templates perm |
| 5 | `04_build33_contracts` | contracts/contract_signers/contract_events/contract_email_settings + RPC functions |
| 6 | `05_builds_34_35_36` | contract reminder RPCs, expenses/vendors/expense_categories + `create_expense_with_activity`, accounting + `recompute_job_payer_type` |
| 7 | `06_builds_37_38_qb_invoices` | qb_connection/qb_mappings/qb_sync_log + qb triggers, invoice_line_items/invoice_email_settings + invoice status recompute |
| 8 | `07_builds_39_40_41_stripe` | stripe_connection/payment_requests/stripe_events, payment_email_settings, refunds/stripe_disputes + 17c widening |
| 9 | `08_seed_form_config` | default intake-form JSON seed |
| 10 | `build42_create_organizations_and_memberships` | organizations + user_organizations + nookleus schema (AAA + Test Company seeded, Eric's admin membership) |
| 11 | `build43_add_nullable_organization_id_columns` | `organization_id uuid` added to all bucket-A/B/D tables |
| 12 | `build44_backfill_organization_id` | bucket-A/B backfilled to AAA; bucket-D left NULL |
| 13 | `build45_organization_id_not_null_and_fks` | NOT NULL + FK + index on bucket-A/B, FK+index only on bucket-D; RPC updates for `create_expense_with_activity`, `create_contract_draft`, `create_contract_with_signers` |
| 14 | `build46_rework_unique_indexes` | Org-scoped UNIQUE indexes; split-partial-unique on bucket-D name columns |
| 15 | `build47_per_org_number_generator` | `org_number_counters` + `next_job_number`/`next_invoice_number`. **Scratch seeds differ from prod**: scratch uses `job=3, invoice=2` (based on seeded test data); prod will use `job=14, invoice=2` per the committed migration file. |
| 16 | `build48_migrate_user_permissions_and_preferences` | user_organization_permissions + notification_preferences rewire + 10 role-policy rewrites + drops user_profiles.role + deprecates user_permissions. **Patched to DROP set_default_permissions before CREATE OR REPLACE** (see §3). |
| 17 | `build49_rls_policies_part1_enable_rls_and_bucket_a` | RLS on job_files + invoice_line_items, tenant_isolation_* for 31 bucket-A + 13 bucket-B tables (applied via DO-loop for compactness; produces identical policies to the committed file) |
| 18 | `build49_rls_policies_part2_bucket_d_and_meta` | Bucket-D (6 tables × 2 policies) + organizations/user_organizations/user_organization_permissions policies |
| 19 | `build50_storage_migration_tracking` | `storage_migration_progress` table + `storage_paths_swap_to_new()` function |

The 9 build42–50 migration files committed on the branch are the authoritative versions for applying to PROD. The scratch project received a condensed/loop-based equivalent for build49 to fit MCP size limits — functionally the same policies.

### NOT applied to PROD project `rzzprgidqbnqcdupmpfe`
None of build42–50. Prod is still at build41 (as of 2026-04-21). This is per plan — migrations apply to prod during the scheduled maintenance window in Prompt C.

### Scratch-only bootstrap artifacts
The scratch project also has:
- **Auth user** for `eric@aaacontracting.com` with id `7c55cdd0-2cbf-4c8a-8fdd-e141973ade94` (password: `scratch-rehearsal-2026`). Created via direct `INSERT INTO auth.users` with bcrypt-hashed password because the curl admin-API approach got mangled by Git Bash's bracketed-paste mode.
- **Seed data** — 2 contacts, 2 jobs (`WTR-2026-0001` + `FYR-2026-0002`), 1 invoice (`INV-2026-0001`), 1 email account with placeholder encrypted password, 1 email.
- **9 storage buckets** matching prod (photos, receipts, contracts, reports, email-attachments, job-files, marketing-assets, company-assets, knowledge-docs).

## 3. Bugs

### Fixed
1. **`build48` set_default_permissions param rename (42P13).**
   Symptom: `ERROR: cannot change name of input parameter "p_user_id"`. Pre-18a signature is `(p_user_id, p_role)`; build48 changes to `(p_user_organization_id, p_role)`. Postgres refuses to rename positional params via `CREATE OR REPLACE`.
   Fix committed in `b380c54` — added `drop function if exists public.set_default_permissions(uuid, text);` before the CREATE.
   **The scratch DB already has the fix applied.** Prod is fine as long as the committed build48.sql is the one that gets applied.

2. **Duplicate `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.**
   Symptom: `/api/knowledge/documents` and any other `createServiceClient`-based endpoint returned 500 with `{"error":"Invalid API key"}`. Root cause: when Eric edited `.env.local` to point at scratch, a second `SUPABASE_SERVICE_ROLE_KEY=` line with prod's key was left intact below scratch's. dotenv takes "last wins", so every service-role request hit scratch with prod's JWT → rejected.
   Fix applied directly to the working tree — removed the prod line. `.env.local.prod-backup` still holds the original prod config for when the rehearsal ends.

### Open / expected for rehearsal scope

3. **`/api/email/sync` returns 500.**
   Symptom: `POST /api/email/sync 500`. Expected. The seeded email account has `encrypted_password = 'placeholder:placeholder:placeholder'` which `decrypt()` can't parse. Not a real bug — just an artifact of minimal seed data. Ignore unless you actually want IMAP sync in scratch (would require real credentials, same `ENCRYPTION_KEY`).

4. **Browser still held prod auth cookies when Eric first loaded the scratch-backed dev server.**
   Symptom: `/api/payment-requests` and `/api/expenses/by-job` returned 401 despite Eric visibly being logged in. Root cause: JWT in cookies was signed by prod's auth, not scratch's. Fix: sign out + clear `localhost:3000` cookies + sign in with the scratch credentials. This is Eric's next manual action.

### Known non-issues that look suspicious
- **`knowledge_documents` table has 0 rows.** Prod has 1 (an IICRC doc). Bucket-D semantics: prod's row has `organization_id = NULL`; scratch just wasn't populated because we didn't copy data. UI shows empty list, no error.
- **Per-org counter in scratch starts at 3 for jobs**, not 14. Because scratch has only 2 seeded jobs. When Eric creates a new job via intake the number will be `WTR-2026-0003` (water) or similar prefix for the selected damage type.

## 4. Last completed action

- Fixed the duplicate `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
- Restarted the dev server via the Claude Preview MCP (serverId `9db7655f-1407-481d-bf30-4a8607c5d6b5`, webpack mode, port 3000).
- Verified with `curl http://localhost:3000/api/knowledge/documents` → returns `[]` (correct empty response instead of 500).
- Told Eric to clear `localhost:3000` cookies and sign back in with the scratch credentials before continuing the smoke-test list.

## 5. Next steps

### Immediate (finish rehearsal)
1. **Eric clears cookies** for `localhost:3000` and signs in with `eric@aaacontracting.com` / `scratch-rehearsal-2026`.
2. **Walk the smoke-test checklist** against http://localhost:3000:
   - [ ] `/` dashboard renders
   - [ ] `/intake` — form loads (was the original bug; should work now that `form_config.organization_id` is populated)
   - [ ] `/jobs` — 2 jobs visible
   - [ ] `/contacts` — 2 contacts visible
   - [ ] `/settings/company` — 10 keyed settings render
   - [ ] `/settings/users` — Eric shows as admin (role now coming from `user_organizations`, not the dropped `user_profiles.role`)
   - [ ] **Intake form submit** — create a test job with damage=water. Confirm `job_number = WTR-2026-0003`. Delete afterward.
   - [ ] `/settings/damage-types` — 8 NULL-org defaults listed
   - [ ] `/jarvis` — page loads past "Loading..." (prior bug was the service-role key issue, should be resolved now)
3. Log anything that 500s or renders wrong into a new bug list — treat as blockers before Prompt C.
4. Note: `/api/email/sync` will still 500 (§3.3); ignore.

### After rehearsal passes
5. **Restore prod env:** `cp .env.local.prod-backup .env.local` and restart dev. Dev server should be back on prod DB, where pre-18a schema still lives — so the app will now exhibit the ORIGINAL intake-form bug again until prod migrations land. That's expected.
6. **Delete the scratch project** to avoid free-tier quota: Supabase Dashboard → `nookleus-18a-scratch-2026-04-21` → Settings → General → Delete project. (Alternative: keep it around for another 24h as an insurance policy against prod-apply regressions, then delete.)
7. **Proceed to Prompt C** — schedule the prod maintenance window and apply build42–build50 to prod. Plan §8.2 has the minute-by-minute schedule.

### Before prod apply
8. **Push the branch and open a PR** so there's a reviewable record:
   ```bash
   git push -u origin build-18a-code-sweep
   gh pr create --title "Build 18a: multi-tenant schema + code sweep" --body "..."
   ```
9. **Take a fresh prod `pg_dump`** within 2h of the maintenance window (plan §8.1 has the command). `pg_dump` is still not installed locally — install it via `winget install PostgreSQL.PostgreSQL.17` ahead of time, or use Docker:
   ```bash
   docker run --rm -v "$PWD:/backup" postgres:17 pg_dump \
     "postgresql://postgres.rzzprgidqbnqcdupmpfe:<PROD_PW>@aws-0-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require" \
     --schema=public --no-owner --no-acl --format=custom \
     --file=/backup/build42-pre-migration-<DATE>.dump
   ```
10. **Confirm PITR is enabled** on prod (Dashboard → Database → Backups) and note the oldest recoverable timestamp before starting.

### During prod apply
11. Apply `supabase/migration-build42-*.sql` through `supabase/migration-build50-*.sql` in order. Unlike scratch, these can go in one-file-at-a-time via MCP `apply_migration`. Plan §8.2 lists spot-check queries for each.
12. **Counter seeds in build47 are correct for prod as-committed** (`job=14, invoice=2`, derived from the MCP queries run at migration-writing time). Do not substitute scratch's `3/2` values.
13. Run `scripts/migrate-storage-paths.ts` against prod. Expect ~74 objects to migrate.
14. Merge the code-sweep PR → deploy to Vercel.
15. Smoke test against prod per plan §8.3. **Rollback to previous Vercel deploy is the recommended first recovery** (plan §8.4 Option C).

## 6. Important context

### Environment / credentials

| Item | Value |
|---|---|
| Prod Supabase project ref | `rzzprgidqbnqcdupmpfe` |
| Scratch Supabase project ref | `opbpcyxxrqzyvtzwjcsa` |
| Scratch URL | `https://opbpcyxxrqzyvtzwjcsa.supabase.co` |
| AAA organization UUID (hardcoded in migrations + code) | `a0000000-0000-4000-8000-000000000001` |
| Test Company organization UUID | `a0000000-0000-4000-8000-000000000002` |
| Eric's auth.users id (same on prod and scratch) | `7c55cdd0-2cbf-4c8a-8fdd-e141973ade94` |
| Scratch smoke-test password | `scratch-rehearsal-2026` |
| `.env.local` backup | `.env.local.prod-backup` (in repo root; currently points at scratch; backup holds prod values) |

### Dev server
- **Turbopack crashes on Windows** with `exit code 0xc0000142` (DLL init failed) while parsing `globals.css`. Known Turbopack-on-Windows bug, unrelated to the 18a code changes.
- Use **webpack mode**: `npx next dev --webpack`.
- `.claude/launch.json` already has this configured (`"runtimeArgs": ["run", "dev", "--", "--webpack"]`), so `preview_start next-dev` does the right thing.
- `pg_dump` and `pg_restore` are NOT installed locally. Install via winget or use Docker (see §5 step 9).

### Code sweep summary
- `src/lib/supabase/get-active-org.ts` — returns `'a0000000-0000-4000-8000-000000000001'` as a constant. Marked TODO(18b) to replace with session-sourced lookup via `nookleus.active_organization_id()` JWT claim.
- `src/lib/storage/paths.ts` — per-bucket path builders. All call sites go through these.
- **Auth helpers** (`src/lib/{permissions-api,qb/auth,accounting/auth,auth-context}`) now read role from `user_organizations` (scoped by org) and permissions from `user_organization_permissions`. `user_profiles.role` no longer exists post-build48.
- **`user_permissions` table is kept** (deprecated with a `COMMENT ON TABLE`) during 18a for revert safety. Most write paths dual-write to both `user_permissions` and `user_organization_permissions`. Drop table in a follow-up cleanup migration after the sweep has been live ~2 weeks.
- **Stripe webhook** resolver reads `event.data.object.metadata.organization_id` with an AAA fallback for pre-18a events (see `resolveOrgFromStripeEvent` in `src/app/api/stripe/webhook/route.ts`). Every Checkout Session creation now writes `metadata.organization_id` (both on session and `payment_intent_data`).
- **Migrations also patched RPC functions** (`create_expense_with_activity`, `create_contract_draft`, `create_contract_with_signers` in build45; `handle_new_user`, `notify_admins`, `set_default_permissions` in build48). Without these, post-build45 inserts from RPCs would fail the new NOT NULL org_id constraint.

### Plan lock-ins (do not re-open)
From plan §9 — all of these are locked decisions:
- Option A' for RLS (non-enforcing allow-all + tenant_isolation_* coexist in 18a; 18b drops allow-all).
- Bucket D (nullable org_id, NULL = Nookleus default) for: `damage_types`, `job_statuses`, `expense_categories`, `category_rules`, `knowledge_documents`, `knowledge_chunks`.
- `nav_items` stays global (no org_id).
- `user_permissions` NOT dropped in 18a.
- Product-admin separation deferred — the "admin in any org" transient gate on `nav_items`, `knowledge_*` is acceptable.
- `nookleus.aaa_organization_id()` helper lives through 18a; 18b replaces callers with session reads.

### Branch state
Branch `build-18a-code-sweep` has 12 commits on top of main. Latest commit: `b380c54`. Branch is **local only — not pushed** per the original prompt instruction ("leave it for Eric to review and push").

Files touched: 90 modified, 12 created. 3940 insertions, 374 deletions.

### Common gotchas the next session might hit
- `apply_migration` via MCP fails with `cannot change name of input parameter` if you `CREATE OR REPLACE FUNCTION` with a different param name than the existing function. Always `DROP FUNCTION IF EXISTS foo(signature)` first.
- MCP apply_migration has a request-size limit; very large files (>40KB of SQL) may need splitting. build49 was split in scratch for this reason.
- Windows terminal bracketed-paste mode wraps pasted commands with `^[[200~` and `^[[201~` which Git Bash interprets as command names. Use here-docs or save to a file when pasting long multi-line commands. (The direct SQL-via-MCP path avoided this entirely for the auth-user insert.)
- Pre-18a auth.users is empty in scratch. The `handle_new_user` trigger inserts user_profiles automatically when an auth user is created. Scratch-user insert used `raw_user_meta_data: {"full_name":"Eric Daniels","role":"admin"}` so user_profiles got populated correctly.
- scratch counter values (`org_number_counters.next_value`) differ from prod. Do NOT overwrite prod's build47 seeds with scratch's.

### What "smoke-test pass" means
Every item in §5 step 2 loads without error, and the intake-form submit produces a job with the expected next number. Anything else 500ing is a blocker and should stop Prompt C until investigated.
