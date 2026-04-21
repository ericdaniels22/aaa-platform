# Build 18a — Claude Code prompts

> **Three prompts, sequenced.** Run A first, review output. Then B, review output. Then C during the maintenance window.
>
> **Source of truth:** `docs/superpowers/plans/2026-04-21-build-18a-schema-backfill.md`. Claude Code must read this file first and refer to it throughout. Prompts are directives + checkpoints; the plan carries the detail.

---

## §9 decisions locked (bakes into all three prompts)

Before starting Prompt A, confirm these. Each was flagged in the plan's §9 and I'm assuming the stated call unless you say otherwise:

| # | Decision | Locked value |
|---|---|---|
| 1 | RLS strategy | Option A' — add tenant-isolation PERMISSIVE policies alongside existing allow-alls; 18b drops allow-alls. |
| 2 | Bucket D classification | `damage_types`, `job_statuses`, `expense_categories`, `category_rules`, `knowledge_documents`, `knowledge_chunks` all get nullable `organization_id`; NULL = Nookleus default. |
| 3 | `nav_items` | Global product-level (bucket C). No `organization_id` column. |
| 4 | `user_permissions` drop | Deferred to a post-18a cleanup migration. Kept (deprecated) through 18a. |
| 5 | Hardcoded UUIDs | AAA = `a0000000-0000-4000-8000-000000000001`. Test Company = `a0000000-0000-4000-8000-000000000002`. |
| 6 | Product-admin separation | Deferred to Phase 5. Transiently, "admin in any org" gates `nav_items` and `knowledge_*` writes. |
| 7 | AAA helper function | `nookleus.aaa_organization_id()` created in 18a, used by code sweep, dropped in 18b. |
| 8 | Maintenance window | 10:00 PM local, 30-min budget. You confirm the date when scheduling Prompt C. |
| 9 | IICRC knowledge docs | Stay as bucket D (NULL org, visible to all tenants). Tenant-uploaded SOPs deferred to later build. |

**If any of these is wrong, say so before running Prompt A.**

Also: **the counter seed values in build47** — my plan used hardcoded `14` and `2`. Prompt A instructs Claude Code to re-read `job_number_seq.last_value` and `invoice_number_seq.last_value` at the moment it writes the migration, and compute seeds from those values. That way if you create another job between now and the window, the counter stays correct.

---

---

# Prompt A — Preparation

**Paste this to Claude Code. It does not touch production. It writes all the SQL files, the storage rename script, and the code sweep branch. You review the output offline before Prompt B.**

```
You are Claude Code. You're executing the preparation phase of Build 18a for
the aaa-platform repo (single-tenant → multi-tenant schema refactor). This
phase writes code but does not apply any migrations or modify any database.

## Read first (non-negotiable)
1. docs/superpowers/plans/2026-04-21-build-18a-schema-backfill.md — the full
   plan. This is source of truth for every decision.
2. supabase/migrations/ — look at the most recent migrations to match naming
   and style conventions. The next migration number is build42.

## §9 locked decisions
All nine decisions in the plan's §9 are locked. Do not re-open them. Use:
- Option A' for RLS (non-enforcing in 18a via coexisting policies)
- Bucket D (nullable org_id, NULL = Nookleus default) for damage_types,
  job_statuses, expense_categories, category_rules, knowledge_documents,
  knowledge_chunks
- nav_items stays global (no org_id)
- AAA UUID: a0000000-0000-4000-8000-000000000001
- Test Company UUID: a0000000-0000-4000-8000-000000000002
- user_permissions table NOT dropped in 18a — deprecated and survives to a
  follow-up cleanup migration
- Product-admin separation deferred; transient "admin in any org" gate is
  acceptable for nav_items and knowledge_*

## Scope of this prompt — what to produce

### 1. Nine migration SQL files
Written to supabase/migrations/ following the project's naming convention.
Read the most recent existing migration to match the timestamp/name pattern
exactly. The nine files:

- build42_create_organizations_and_memberships.sql
- build43_add_nullable_organization_id_columns.sql
- build44_backfill_organization_id.sql
- build45_organization_id_not_null_and_fks.sql
- build46_rework_unique_indexes.sql
- build47_per_org_number_generator.sql
- build48_migrate_user_permissions_and_preferences.sql
- build49_rls_policies_written_not_enforced.sql
- build50_storage_migration_tracking.sql

Each file must:
- Include a block comment at the top: purpose, depends-on, revert summary
- Include a -- ROLLBACK --- section at the bottom with the reverse SQL
- Be independently applicable (no inter-file ordering bugs)
- Wrap the forward SQL in the transaction Supabase CLI provides by default
- Use the AAA UUID literal hardcoded, not regenerated

Specifics per file — follow the plan's §3 subsections literally. Do not
improvise. If anything in §3 is ambiguous, stop and ask. Key reminders:

- build42: nookleus schema + both helper functions
  (active_organization_id and aaa_organization_id). Seed orgs AND Eric's
  user_organizations row with his user_id:
  7c55cdd0-2cbf-4c8a-8fdd-e141973ade94. Role: admin.

- build43: enumerate every bucket-A, bucket-B, bucket-D, and bucket-E-child
  table from the plan's §1.2 table. ALTER TABLE ... ADD COLUMN
  organization_id uuid for each. No default, no NOT NULL, no FK.

- build44: use the DO $$ ... END $$ pattern with aaa_id declared once.
  Bucket-A = trivial UPDATE. Bucket-B = UPDATE FROM parent join. Bucket-D =
  leave NULL. Guard assertions at the end for bucket-A/B completeness.
  Dependency order for bucket-B denorm: email_accounts → emails →
  email_attachments, jobs → job_*, invoices → invoice_line_items/line_items,
  contracts → contract_signers/contract_events, photos → photo_*,
  knowledge_documents → knowledge_chunks.

- build45: SET NOT NULL + ADD CONSTRAINT (FK with ON DELETE RESTRICT) +
  CREATE INDEX idx_{table}_organization_id on every bucket-A/B/E-child table.
  Bucket-D gets the FK constraint but keeps the column nullable.

- build46: follow §2.2 matrix exactly. Use plain CREATE UNIQUE INDEX (not
  CONCURRENTLY — row counts trivial, locks will be milliseconds).
  Split-partial-unique pattern for damage_types, job_statuses,
  expense_categories per §2.3.

- build47: CRITICAL — at the moment you write this file, query the current
  sequence values via MCP:
    SELECT last_value, is_called FROM public.job_number_seq;
    SELECT last_value, is_called FROM public.invoice_number_seq;
  Then separately query:
    SELECT coalesce(max(substring(job_number FROM '-(\d+)$')::int), 0)
      FROM public.jobs WHERE job_number ~ '-\d{4}$';
    SELECT coalesce(max(substring(invoice_number FROM '-(\d+)$')::int), 0)
      FROM public.invoices WHERE invoice_number ~ '-\d{4}$';
  Use max(actual_number) + 1 as the seed next_value, NOT the sequence's
  last_value. Sequences can be ahead of real data if inserts were rolled
  back. Write the computed seed as a SQL literal into the migration file.
  Leave a comment noting the query and computed value.

- build48: follow §3.7 exactly. Includes RLS policy rewrites for the nine
  tables currently gating on user_profiles.role (see plan §5.5). Comment
  user_permissions as deprecated, do not drop it.

- build49: generate tenant-isolation policies for every bucket-A/B table
  (plan §5.2 pattern, single FOR ALL policy form). Generate bucket-D
  policies (plan §5.3). Add ENABLE ROW LEVEL SECURITY on job_files and
  invoice_line_items PLUS their tenant-isolation policies. Add the
  user_organizations, user_organization_permissions, and organizations
  policies from §5.6–§5.8. CRITICAL: policy names must be distinct from
  existing allow-all policy names on the same table (use tenant_isolation_
  prefix). Do NOT drop or modify the existing allow-all policies.

- build50: just the storage_migration_progress table + index.

### 2. Storage rename script
Written to scripts/migrate-storage-paths.ts. Follows plan §7.4 pseudocode.
Must:
- Use SUPABASE_SERVICE_ROLE_KEY from .env.local
- Hardcode the AAA org UUID
- Skip knowledge-docs bucket entirely (per §7.2)
- Be idempotent — running it twice produces the same end state
- Have a --dry-run flag that enumerates and reports but doesn't copy/delete
- Exit non-zero if any row ends at status=failed
- Phase 4 calls the storage_paths_swap_to_new() function you'll define in
  build50. Wait — build50 only creates the tracking table. The swap
  function lives in the rename script (as raw SQL via supabase.rpc or
  inline execute_sql). Actually no: per plan §7.5, the swap function is
  a SQL function. Add it to build50 or create a new build50b if needed.
  Decide: cleanest path is including the swap function in build50 alongside
  the tracking table. Do that. The script calls supabase.rpc() to invoke
  it.

The script must have clear phase markers in console output:
  [Phase 1] Enumerating bucket: photos... 8 objects queued
  [Phase 2] Copying... 74/74 complete
  [Phase 3] Verifying... 74/74 verified
  [Phase 4] Running storage_paths_swap_to_new()... OK
  [Phase 5] Deleting originals... 74/74 deleted

And a final summary line: "Storage rename complete. 74 objects migrated."

### 3. Code sweep branch
Create a new git branch: build-18a-code-sweep

On this branch, do the code sweep work per plan §4. Specifically:

a) Create src/lib/storage/paths.ts — centralized org-prefixed path helpers
   per plan §7.3. One function per bucket×type.

b) For every file identified in plan §4.1, update queries to include
   organization_id filter. Source of the org id: create a helper in
   src/lib/supabase/get-active-org.ts that returns
   nookleus.aaa_organization_id() value — concretely, hardcode the AAA
   UUID as a const. Leave a TODO comment: "Replace with session-sourced
   org in 18b." Every query that touches a bucket-A/B table must use this
   helper in the filter.

c) For every upload call site, route through the new paths.ts helpers
   (rather than inline string concatenation).

d) For every Stripe Checkout Session creation, add metadata.organization_id
   to the session params.

e) For src/app/api/sign/[token]/... and src/app/api/pay/[token]/... —
   these are public routes using service role. They must load the
   contract or payment_request and read organization_id from that record,
   then use it for all subsequent queries.

f) For src/app/api/stripe/webhook — implement resolveOrgFromStripeEvent
   per plan §4.1. Reads event.data.object.metadata.organization_id with
   fallback to nookleus.aaa_organization_id() for pre-18a events.

g) Run the grep queries from plan §4.3 as verification. Any hit that
   doesn't appear in a modified file means you missed something.
   Investigate each one.

h) Delete nothing. user_permissions references in server code should be
   updated to user_organization_permissions (deprecation-safe because
   build48 migrated data into both tables). But the user_permissions
   table itself stays.

i) Do NOT remove hardcoded "AAA Disaster Recovery" display strings that
   fall back to company_settings lookups — those are appropriate defaults.
   DO remove hardcoded strings that don't read from company_settings.

j) Run `npm run build` at the end. Must pass.

k) Commit in logical chunks per plan §4.1 (one commit per module group)
   so the PR is reviewable.

l) Do NOT push the branch or open a PR. Leave it for Eric to review and
   push.

## Stop points — ASK ERIC BEFORE PROCEEDING if:
- Any migration SQL would be ambiguous or you have to improvise
- build47 counter seeds come back with unexpected values (e.g. a gap or
  a value lower than current max)
- A grep query from §4.3 returns a pattern that's not in the plan's
  enumerated file list — could be dead code or a missed case
- `npm run build` fails and the fix is non-trivial
- Any existing code would need to be deleted rather than modified

## Output when done
Print a summary:

    Migration files written:    9 (build42.sql through build50.sql)
    Storage rename script:      scripts/migrate-storage-paths.ts
    Code sweep branch:          build-18a-code-sweep
      Commits:                  {N}
      Files modified:           {N}
      Files created:            {N}
      npm run build:            PASS

    build47 counter seeds (computed, not hardcoded):
      job:      WTR next = {N+1} (derived from max job number {N})
      invoice:  INV next = {N+1} (derived from max invoice number {N})

    Ready for Prompt B (scratch rehearsal).

## What NOT to do in this prompt
- Do not apply any migration to any database
- Do not run the storage rename script against anything
- Do not push the branch
- Do not open a PR
- Do not modify or delete the existing build41 or earlier migrations
- Do not touch .env.local
- Do not run `supabase db push`, `supabase db reset`, or anything that
  writes to Supabase
```

---

---

# Prompt B — Scratch project rehearsal

**Run this only after Prompt A completes cleanly and you've eyeballed the output. Creates a scratch Supabase project (manual step on your part first), applies everything, runs smoke tests. Still does not touch production.**

### Before running Prompt B — manual steps you do first

1. **Take a production `pg_dump`:**
   ```bash
   pg_dump "postgresql://postgres:$PROD_PW@db.rzzprgidqbnqcdupmpfe.supabase.co:5432/postgres?sslmode=require" \
     --no-owner --no-acl --format=custom \
     --file=build42-pre-migration-$(date +%F).dump
   ```
   Store the `.dump` file somewhere you won't lose it.

2. **Create a scratch Supabase project** in the dashboard. Name it `nookleus-18a-scratch`. Free tier, `us-east-2` region. Wait for provisioning.

3. **Copy the scratch project's ref** (from the URL, looks like `abcdefghijklmnop`) and its service-role key (from API settings). You'll paste these into Prompt B below.

4. **Restore the production dump onto the scratch project:**
   ```bash
   pg_restore --host=db.<SCRATCH_REF>.supabase.co --port=5432 --username=postgres \
     --dbname=postgres --no-owner --no-acl --clean --if-exists \
     build42-pre-migration-YYYY-MM-DD.dump
   ```

5. **Confirm row counts match** on the scratch project (spot-check `jobs`, `emails`, `contracts`, `photos` in the scratch project's SQL editor — should match production).

### The Prompt B paste

```
You are Claude Code. Prompt A has completed. You're now running the scratch-
project rehearsal for Build 18a.

## Context you need
- Plan: docs/superpowers/plans/2026-04-21-build-18a-schema-backfill.md
- Migration files: supabase/migrations/build42*.sql through build50*.sql
- Storage rename script: scripts/migrate-storage-paths.ts
- Code sweep branch: build-18a-code-sweep
- Current branch: whichever Eric is on — DO NOT switch to code sweep for
  this prompt. We apply migrations, then run smoke tests from main.

## Scratch project info (Eric fills in before pasting)
- Scratch project ref: <PASTE_SCRATCH_REF>
- Scratch project service role key: <PASTE_KEY_OR_EXPORTED_ENV>

## What to do

### 1. Apply migrations to scratch, one at a time, with verification
For each migration build42 through build50, in order:

a) Apply the migration to the scratch project using the Supabase MCP
   apply_migration tool. Use the project_id of the scratch project.

b) After each apply, run verification queries appropriate to that
   migration. Report row counts, constraint existence, policy existence.
   Examples:
   - build42: SELECT count(*) FROM public.organizations (expect 2)
   - build43: SELECT column_name FROM information_schema.columns WHERE
     table_schema='public' AND column_name='organization_id'
     (expect ~47 rows)
   - build44: for each bucket-A/B table, SELECT count(*) WHERE
     organization_id IS NULL (expect 0)
   - build45: spot-check NOT NULL + FK on jobs, emails, company_settings
   - build46: pg_indexes query for new UNIQUE index names
   - build47: SELECT public.next_job_number(
     'a0000000-0000-4000-8000-000000000001', 'water');
     compare to expected value from build47's computed seed
   - build48: SELECT count(*) FROM public.user_organization_permissions
     (expect 18, same as user_permissions)
   - build49: SELECT count(*) FROM pg_policies WHERE policyname LIKE
     'tenant_isolation_%' (expect >=44). Also verify the coverage
     query from plan §8.3 returns 0 rows.
   - build50: SELECT to_regclass('public.storage_migration_progress')
     returns non-null.

c) If any verification fails, STOP. Report the failure. Do not apply
   the next migration.

### 2. Run the storage rename script against scratch
After all 9 migrations applied cleanly:

a) Update the script's SUPABASE_SERVICE_ROLE_KEY to use the scratch
   project's key for this run only (do not commit this change).

b) Run `node scripts/migrate-storage-paths.ts --dry-run` first. Verify
   output looks reasonable — it should enumerate 0 objects because the
   scratch project was restored from the DB dump, which doesn't include
   storage. Confirm the script doesn't crash on empty buckets.

c) Revert the key change. Scratch rehearsal for storage is inherently
   limited because pg_dump doesn't dump storage. The real test of the
   rename is in Prompt C's production window. This is acceptable per
   plan §8.1.

### 3. Run the smoke test suite — scratch-compatible subset
Because the scratch project has DB but no storage, some smoke tests
from plan §8.3 don't apply. Run this subset:

- SQL: SELECT count(*) FROM public.jobs WHERE organization_id IS NULL
  (expect 0)
- SQL: SELECT count(*) FROM public.organizations (expect 2)
- SQL: SELECT role FROM public.user_organizations WHERE user_id =
  '7c55cdd0-2cbf-4c8a-8fdd-e141973ade94' (expect 'admin')
- SQL: test intake flow by manually INSERTing a test contact + job
  (don't use the real endpoint, just SQL), confirm the job_number
  trigger generates a correct value with the AAA counter
- SQL: SELECT count(*) FROM public.user_organization_permissions
  (expect 18)
- SQL: the RLS coverage query from plan §8.3
- SQL: policy count — expect 44+ tenant_isolation_* policies PLUS all
  original allow-all policies still present

Report pass/fail for each.

### 4. Rollback rehearsal (optional but recommended)
After smoke tests pass, test that the revert SQL from build50 works:
a) Apply build50's ROLLBACK block to the scratch project
b) Verify storage_migration_progress is gone
c) Re-apply build50 forward
d) Verify it's back

This validates that the ROLLBACK sections in the migration files are
actually correct SQL. We're not testing every migration's revert (too
time-expensive) but validating the pattern on one is reasonable.

### 5. Cleanup
a) DO NOT delete the scratch project yet — keep it until after Prompt C
   succeeds, as a fallback reference.
b) Revert any local file changes made for scratch connectivity (env
   pointers, etc.). Leave the repo in the exact state it was in at the
   start of Prompt B.

## Output when done
Print:

    Scratch project: <ref>
    Migrations applied: build42–build50, all passing verification
    Storage script dry-run: clean
    Smoke tests: {N}/{N} passing
    Rollback rehearsal: {PASS/FAIL/SKIPPED}

    Ready for Prompt C (production window) when Eric schedules it.

## Stop points
- Any migration fails to apply or fails verification
- Any smoke test fails
- Rollback rehearsal reveals a ROLLBACK block error
- Storage script dry-run throws

## What NOT to do
- Do not touch the production Supabase project (rzzprgidqbnqcdupmpfe)
- Do not delete the scratch project
- Do not push any branch or open a PR
- Do not modify any migration file based on scratch results — if a
  migration needs to change, STOP and ask Eric. We regenerate Prompt A
  output and re-rehearse.
```

---

---

# Prompt C — Production execution (maintenance window)

**Run this only during the scheduled window, after Prompts A and B completed successfully. This touches production. Every applied migration is real.**

### Before running Prompt C — manual steps in the window

1. **T-5min:** Final `pg_dump` of production (same command as Prompt B setup, fresh timestamp).
2. **T-3min:** Verify the dump file is non-trivial in size and can be read by `pg_restore --list`.
3. **T-1min:** Confirm the code sweep branch passes `npm run build` locally one more time.
4. **T-0:** Paste Prompt C to Claude Code.

### The Prompt C paste

```
You are Claude Code. This is the production execution of Build 18a.
Prompts A and B have completed successfully. We're inside the scheduled
maintenance window.

Every operation in this prompt touches the PRODUCTION Supabase project
(rzzprgidqbnqcdupmpfe). Be deliberate.

## Context
- Plan: docs/superpowers/plans/2026-04-21-build-18a-schema-backfill.md
  (especially §8 — the pre-launch checklist)
- Migration files: supabase/migrations/build42*.sql through build50*.sql
- Storage rename script: scripts/migrate-storage-paths.ts
- Code sweep branch: build-18a-code-sweep

## Deploy log
Open docs/deploys/2026-04-21-build-18a-deploy.md (create it if absent).
Append every step with a timestamp as you complete it. This is
non-optional — if something goes wrong at 3 AM tomorrow we need to know
what happened when.

## Execution sequence

### Phase 1: Migrations (expected duration: <10s aggregate)
Apply each migration to production via Supabase MCP apply_migration,
project_id = rzzprgidqbnqcdupmpfe. Between each apply:

1. Run the verification queries from Prompt B section 1 for this
   specific migration
2. Write result to deploy log
3. If verification fails: STOP. Run the ROLLBACK block for this
   migration. Report. Do not proceed.

Sequence: build42, build43, build44, build45, build46, build47, build48,
build49, build50.

### Phase 2: Storage rename (expected duration: 2–5 minutes)
1. Ensure .env.local has the PRODUCTION service role key (not scratch).
2. Run: node scripts/migrate-storage-paths.ts --dry-run
3. Verify the dry-run output: expect ~74 objects across 8 buckets
   (knowledge-docs skipped).
4. Run: node scripts/migrate-storage-paths.ts
5. Monitor phase output. The script tracks via
   storage_migration_progress and is resumable.
6. On script exit: query SELECT status, count(*) FROM
   storage_migration_progress GROUP BY status.
   - All rows at status='deleted' → clean completion.
   - Any row at status='failed' → STOP. Investigate. Do not deploy
     code sweep until resolved.
7. DEFER PHASE 5 (delete originals) BY 24 HOURS. Per plan §7.6, the
   originals are our escape hatch. Modify the script to exit after
   Phase 4 (db_updated status) for this run. Create a followup task
   to run the Phase-5-only pass tomorrow.

   Concretely: if the script is already written to run through Phase 5,
   comment out the Phase 5 loop and log that it's being deferred.

### Phase 3: Code sweep deploy
1. git checkout build-18a-code-sweep
2. git pull origin main --rebase  (in case any hotfixes landed)
3. Resolve any rebase conflicts (unlikely given PR freeze per §8.1)
4. git push origin build-18a-code-sweep
5. Open a PR via gh CLI: gh pr create --base main --title "Build 18a:
   schema refactor + code sweep" --body "See plan:
   docs/superpowers/plans/2026-04-21-build-18a-schema-backfill.md"
6. Merge the PR: gh pr merge --squash --admin
7. Vercel auto-deploys from main. Watch the deploy at
   https://vercel.com/ericdaniels22/aaa-platform. Wait for green.
8. If deploy fails: see Phase 5 rollback.

### Phase 4: Smoke tests
Run the full smoke test suite from plan §8.3 against production. Each
test has an explicit pass criterion in the plan. Record each result in
the deploy log.

Order matters — tests early in the list are diagnostic for later tests.
Don't skip a failed test and continue; stop, investigate, decide.

### Phase 5: Rollback procedures (only if needed)
If any Phase 1 migration fails verification:
- Apply the ROLLBACK block from that migration file
- Apply ROLLBACK blocks from all successful prior migrations in reverse
  order
- Verify production row counts match the pre-window pg_dump row counts
- Restore from pg_dump only if reverse-SQL itself fails (unlikely given
  the mechanical nature of the ROLLBACK blocks, but possible)

If Phase 2 (storage rename) fails partway:
- Per plan §7.6, the state is usually safe
- If any row is at status='failed', investigate the specific error
- Re-run the script — it resumes from last checkpoint
- If unresolvable: skip Phase 3, proceed with Phase 5 Vercel-revert
  posture, run storage_paths_swap_to_old() to reverse any DB path
  changes already made

If Phase 3 deploy succeeds but Phase 4 smoke tests fail:
- PREFERRED: Vercel dashboard → redeploy pre-sweep commit. Takes 90
  seconds. DB stays forward-migrated. Tested against: old code works
  against new DB.
- If Vercel revert doesn't restore function, apply the migration
  ROLLBACK blocks in reverse order.

Every rollback path is logged to the deploy log with timestamps.

### Phase 6: Completion
After smoke tests pass:
1. Clear any "maintenance in progress" banner/notification
2. Write final timestamp to deploy log
3. Commit deploy log to main
4. Create followup GitHub issues per plan §8.5:
   - "Drop user_permissions table (2+ weeks post-18a)"
   - "Drop job_number_seq and invoice_number_seq (post-code-sweep verify)"
   - "Drop nookleus.aaa_organization_id() (18b)"
   - "Drop storage_migration_progress table (post-cleanup)"
   - "Storage rename Phase 5: delete originals (24hr followup)"
   - "Product-admin flag separation (Phase 5)"

## Checkpoints — REPORT TO ERIC AND WAIT for acknowledgement before proceeding
These are hard stops. You must write status to the deploy log AND pause
for Eric to confirm before moving on:

CHECKPOINT 1: After build45 applies cleanly (migrations now partially
irreversible without dump restore because FKs + NOT NULL are enforced).
Confirm before build46.

CHECKPOINT 2: After all 9 migrations apply cleanly. Confirm before
running storage rename.

CHECKPOINT 3: After storage rename Phase 4 (DB swap) completes.
This is the true point-of-no-return for storage. Confirm before
deploying code sweep.

CHECKPOINT 4: After smoke tests complete (pass or fail). Confirm
outcome with Eric; agree on next step (continue to cleanup vs rollback).

## Absolute rules
- Never apply a migration to production without running its verification
  query first, then writing the result to the deploy log
- Never proceed past a checkpoint without explicit Eric ack
- Never run `rm` on any storage object (Phase 5 delete step is deferred
  per plan §7.6)
- Never force-push any branch
- Never squash-merge without a passing CI status (if CI is configured)
- If anything unexpected happens, STOP and report. Do not improvise a fix.
```

---

## Sequencing summary for you

1. **Now:** Review the §9 locked decisions at the top. Tell me which (if any) to change. Otherwise paste **Prompt A** to Claude Code.
2. **After Prompt A:** Review the migration files, rename script, and code sweep commits offline. If anything looks wrong, we iterate before Prompt B.
3. **After Prompt A looks clean:** Take the production pg_dump. Create the scratch project. Paste **Prompt B**. Review its output.
4. **When Prompt B is clean:** Schedule the window (10 PM, a weekday). At T-0, paste **Prompt C**. Ride the checkpoints.

### One important thing I didn't build into the prompts

**The user memories in this project tell me you work with Claude Code on Windows + Git Bash.** The prompts assume Claude Code runs on your dev machine, not in a container. If you want me to tweak any command for Windows path quirks (e.g., `pg_dump` / `pg_restore` path escaping, `.env.local` location on Windows), say so and I'll edit inline.

### If you want a single-file artifact

The prompts above are inline in this response. I can also save them to `/mnt/user-data/outputs/` as a markdown file you can drop into `docs/superpowers/prompts/` — would that be useful, or is this response sufficient as-is for the paste workflow?
