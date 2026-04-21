# Build 18a pre-planning briefing

> **Purpose:** Hand this to a fresh Claude session before starting the Build 18a planning work. Captures the multi-tenant refactor's architectural ground truth, the decisions already made across 18a–18d, and the specific scope, sequencing, and watch-outs for 18a itself. Modeled on the 17c post-build briefing.

---

## TL;DR

**Build 18a is the schema + backfill + storage-path migration phase of the multi-tenant SaaS refactor.** It does NOT turn on RLS, does NOT introduce session-scoped org context, does NOT ship a workspace switcher, and does NOT create a second organization in the UI. Those are 18b and 18c.

**What 18a DOES ship to production:**
1. `organizations` table + `user_organizations` join table, seeded with one row for AAA Disaster Recovery
2. `organization_id` column added to ~30 tables, backfilled to AAA, converted to `NOT NULL` with FKs
3. UNIQUE indexes across the schema reworked to be `(organization_id, ...)` scoped
4. Per-org job/invoice number sequences replace the current global sequences (AAA continues its existing numbering; future orgs start fresh)
5. Storage bucket paths migrated from `photos/{job_id}/...` to `{org_id}/photos/{job_id}/...` (and equivalent for receipts/contracts)
6. Role + permissions moved from `user_permissions(user_id, …)` to `user_organizations.role` + `user_organization_permissions(user_organization_id, …)`
7. Stripe Checkout Session creation starts including `metadata.organization_id` on every session
8. RLS policies **written but not enabled** — either in a separate later migration in the sequence, or gated behind a feature flag / commented out until 18b

**What 18a does NOT ship:**
- Active RLS enforcement (policies exist but either `ENABLE ROW LEVEL SECURITY` is deferred to 18b, or the policies pass everything). Decision on the exact mechanic below in "Open questions for the planning session."
- Any session-aware `active_organization_id`. Queries continue resolving via a hardcoded lookup (`SELECT id FROM organizations LIMIT 1` helper, or an env var) to the AAA row
- Workspace switcher, Test Company, any multi-org UI
- Per-tenant Stripe / QB / email account connections (they gain `organization_id` columns but only AAA's single connection row exists)
- Nookleus rebrand (lands in 18c alongside the switcher)

**Between 18a and 18b the platform is single-org, but is schema-compatible with multi-org.** Eric keeps using it for development and testing throughout. No user-visible functional change.

**Why this split (Option C from the planning conversation):** Turning on RLS while the resolver is hardcoded is a foot-gun — a misfire returns empty result sets and the UI quietly looks broken rather than leaking data. Splitting structural migration (18a) from policy enforcement (18b, which ships alongside real session context) gives us a cleaner "everything flips on together" moment for isolation, and 18a is independently reviewable as pure schema work.

---

## Decisions already locked (from planning conversation)

These are not open for re-litigation in the 18a planning session unless something surfaces during implementation that invalidates them.

### Sequencing
- **Option C** from planning: 18a = schema + backfill + columns NOT NULL + FKs + UNIQUE rework + storage rename. 18b = RLS live + session context together. 18c = switcher + Test Company + Nookleus rebrand. 18d = per-tenant Stripe/QB/email + live-mode cutover.

### Data model
- **User → organization mapping via `user_organizations` join table** from day one, even though Eric is the only user. Supports the 18c requirement to be in multiple orgs simultaneously.
- **All singleton tables gain `organization_id`** and become per-org: `stripe_connection`, `qb_connection`, `payment_email_settings`, `contract_email_settings`, `company_settings`, `form_config`, plus multi-row `email_accounts`. Add `UNIQUE(organization_id)` where previously singleton; `UNIQUE(organization_id, key)` on `company_settings`.
- **Per-org job/invoice number sequences.** Each org's `JOB-YYYY-NNNN` and `INV-YYYY-NNNN` are independent. Implemented via `(organization_id, year, counter)` composite lookup inside the number-generation function.
- **Role + permissions move.** Role on `user_organizations`. `user_permissions` table becomes `user_organization_permissions(user_organization_id, permission_key, granted)` — keyed off the membership row, not the user.
- **Partial UNIQUE indexes become org-scoped.** Full audit list goes into the 18a plan. Minimum known set: `payments.stripe_payment_intent_id`, `emails.message_id`, `contracts.link_token`, `payment_requests.link_token`, `contract_templates.name`, `job_statuses.name`, `damage_types.name`. Plus `invoices.invoice_number`, `jobs.job_number`, and any other UNIQUE that assumed global uniqueness.
- **Naming: `organizations` in the DB, "Workspace" in UI copy.** "Workspace switcher" not "organization switcher." `organization_id` everywhere in code and SQL.

### RLS approach (designed in 18a, activated in 18b)
- **JWT custom claim** as RLS source of truth: `active_organization_id` set as a claim in the Supabase auth JWT. Policies read via `auth.jwt() ->> 'active_organization_id'`.
- **Double-belt policy pattern:** `USING (organization_id = (auth.jwt() ->> 'active_organization_id')::uuid AND organization_id IN (SELECT organization_id FROM user_organizations WHERE user_id = auth.uid()))`. Both the active-org claim AND the membership check must pass. Defense in depth.
- **Service-role-key bypasses RLS as today.** Webhook handlers (`/api/stripe/webhook`), cron routes, and other server-to-server paths use service role and filter explicitly by `organization_id`. No RLS change for those flows in 18a.
- **Policies written but not enforced in 18a.** Either `ENABLE ROW LEVEL SECURITY` deferred to 18b's migration, or policies return true-for-all in 18a — final mechanic is an open question for the planning session (see below).

### Migration mechanics
- **Sequence of migrations, not one monolith.** Something like: `build42-organizations-and-memberships`, `build43-add-organization-id-columns`, `build44-backfill-organization-id`, `build45-not-null-and-fks`, `build46-rework-unique-indexes`, `build47-per-org-sequences`, `build48-role-permissions-move`, `build49-rls-policies-written-not-enabled`. Migration filenames don't have to match sub-build numbers. The exact split is a planning-session decision.
- **Backup: both PITR and explicit `pg_dump` to local, restore-verified on a scratch Supabase project before running against prod.** Non-negotiable. No "skip the backup, it's fine" path.
- **Maintenance window:** 30–90s lock window at 11 PM on a weekday is acceptable per Eric. Schedule it, don't just run it ad-hoc. Pre-communicate to... nobody, since he's the sole user, but write the start/end timestamps into a deploy log.
- **Test Company row seeded in 18a** so RLS policy testing can validate two-org isolation. Not exposed in any UI until 18c.
- **Storage path rename happens in 18a.** Cheaper now (one org, all files belong to AAA) than later. Supabase Storage doesn't do transactional renames; this runs as a one-time script after the DB migration, with a fallback shim that serves old paths during cutover. Details in "Watch-outs" below.

### Stripe / forward-compat
- `payment_intent.metadata.organization_id` starts being populated on every Checkout Session created starting 18a, even though only one org exists. Makes 18d's webhook routing trivial.
- `stripe_events`, `stripe_connection`, `qb_connection`, `notifications`, `stripe_disputes`, `refunds`, and `payment_requests` all gain `organization_id` in the 18a batch.

### Product naming
- **Product name is Nookleus** (N-O-O-K-L-E-U-S). Confirmed spelling. Rebrand UI/copy/docs lands in **18c** — the workspace switcher is the first moment product identity becomes visually distinct from tenant identity, natural rebrand moment. 18a is purely structural; "AAA Platform" branding stays intact through 18b.
- No domain yet — Eric is sourcing. Not a blocker for 18a. Relevant to 18c's auth email sender setup (auth emails need a Nookleus sending identity distinct from per-tenant business emails).

---

## Key architectural decisions 18a must establish

These are the patterns that subsequent builds inherit. Getting them right here avoids a second refactor.

1. **Every table owning user-generated data has `organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT`.** `ON DELETE RESTRICT` not `CASCADE` — deleting an organization must require explicit intent, not cascade-nuke a tenant's data. Deletion is a later-phase concern anyway; for now treat it as "never happens."

2. **`user_organizations` is the single source of truth for membership.** `(user_id, organization_id)` UNIQUE. Role lives on the row. Permissions key off `user_organization_id`, not `user_id` directly. Seeding Eric's membership to AAA is part of the 18a migration.

3. **Service-role paths (webhooks, cron, API routes that bypass RLS) must explicitly filter by `organization_id`** and not rely on RLS to save them. Add a linting convention or code-review checklist item so this stays enforced over time.

4. **Stripe Checkout Sessions include `metadata.organization_id` from 18a onward**, even while webhooks still route via the singleton `stripe_connection`. 18d flips the webhook to read the metadata; having the data already present means 18d is a webhook-side refactor with no Stripe-account-side backfill needed.

5. **Storage paths are org-scoped from 18a forward.** New uploads: `{org_id}/photos/{job_id}/{filename}`. Old paths migrated during 18a. Any code that constructs a path reads `organization_id` from the parent record (job → organization_id → build path).

6. **Per-org sequences use a lookup function, not PostgreSQL `SEQUENCE` objects.** Something like `next_job_number(org_id UUID) RETURNS TEXT` that reads the current year and the max counter for that org and returns the next string. Sequence-per-org would explode the object count; a lookup function with a UNIQUE index on `(organization_id, year, counter)` is cleaner.

7. **RLS policies are written in 18a even though not enforced.** The `GRANT` statements, the policies themselves, and the JWT claim read pattern are all committed as part of 18a's migrations. 18b's delta is turning enforcement on, not writing new policy SQL. This means 18a's planning session MUST include the policy SQL review — don't leave it to 18b.

8. **Singleton-per-org tables (stripe_connection, qb_connection, payment_email_settings, contract_email_settings, company_settings, form_config) get `UNIQUE(organization_id)`** (or `UNIQUE(organization_id, key)` for the k/v company_settings). Code that assumes "one row exists" now assumes "one row per org exists" and queries with `WHERE organization_id = $1 LIMIT 1`.

9. **`email_accounts` does NOT get a UNIQUE constraint beyond what's already there** — it's intentionally multi-row per tenant. Just gets `organization_id NOT NULL`.

10. **Backfill uses a single canonical org ID variable** declared at the top of the backfill migration: `DO $$ DECLARE aaa_id UUID := '<hardcoded UUID created in build42>'; BEGIN ... END $$`. Reproducibility and idempotency both depend on this being a known, stable value.

---

## Open questions for the 18a planning session

These need answers during the planning session, before Claude Code starts implementing. Listed with my lean where I have one.

### RLS enforcement mechanic in 18a
How do we represent "policies exist, aren't enforcing yet"?
- (A) `ENABLE ROW LEVEL SECURITY` is deferred to 18b's migration. 18a commits policies + grants only. Simple and honest.
- (B) Policies enforced in 18a, but the "active organization" claim resolves to AAA's ID via a hardcoded fallback when no JWT claim is present. Risky — invisible single-org coupling.
- (C) Policies enforced in 18a against `auth.jwt() ->> 'active_organization_id'`, and 18a also includes a login-time hook that sets the claim to AAA for Eric's user. Dependencies on auth hook infrastructure in 18a.

**Lean: (A).** Cleanest split. 18b's migration is small: `ALTER TABLE <x> ENABLE ROW LEVEL SECURITY;` repeated 30 times, ships with the session-context code in the same PR.

### Table audit — is the list complete?
Draft list of tables needing `organization_id`. Planning session should pressure-test this. Known tables from schema across v1.3 through v1.7:

Core (v1.3): contacts, jobs, job_activities, invoices, line_items, payments, job_emails, email_matching_rules, photos, photo_tags, photo_tag_assignments, photo_annotations, photo_report_templates, photo_reports, email_accounts, emails, email_attachments

Settings Hub (v1.4): company_settings, user_profiles, user_permissions (becoming user_organization_permissions), job_statuses, damage_types, form_config, job_custom_fields, notifications, notification_preferences, user_preferences, email_signatures

Contracts (v1.6): contract_templates, contracts, contract_signers, contract_events, contract_email_settings

Accounting (v1.5, per Build 16 — not fully detailed in briefings): qb_connection, qb_mappings, plus any expense tracking tables

Stripe (v1.7 / 17c): stripe_connection, payment_requests, stripe_events, refunds, stripe_disputes, payment_email_settings

**That's ~35 tables.** Planning session must enumerate authoritatively from the live Supabase schema, not from docs. Run `\dt` equivalent against the DB as the first step.

### `user_profiles` — does it get `organization_id` or not?
A user can belong to multiple organizations via `user_organizations`. But `user_profiles` has today a single `role` column. Options:
- Remove `role` from `user_profiles`, move entirely to `user_organizations.role`. `user_profiles` becomes purely identity (name, phone, photo).
- Keep `role` on `user_profiles` as a "primary role" fallback. Confusing.

**Lean: first option.** `user_profiles` is identity-scoped; role/permissions are membership-scoped. This is cleaner for 18c's switcher (role can differ per workspace).

### How does `created_by` behave cross-org?
Many tables have `created_by uuid FK user_profiles.id`. Post-18a, a user who belongs to multiple orgs could technically have created records in either. This is fine — `created_by` stays as-is, but queries that join `created_by` to user data must still respect RLS on `user_profiles` (which itself won't have `organization_id`, so RLS on it is the membership check only).

**Lean: leave `created_by` alone, note it in watch-outs.** No org_id on `user_profiles` means user records are visible across the platform. Name/email leakage is acceptable; no business data is on `user_profiles`.

### Storage rename strategy
Supabase Storage object renames: no native atomic rename API. Options:
- **Copy-then-delete** via Storage API, one file at a time, tracked in a migration table so it's resumable. Slow but safe.
- **Database-only path update** — flip the DB path values to the new scheme, leave objects at old physical paths, and run a background migration script later. Breaks immediately because the path in the DB must match the actual object key.
- **Hybrid: write new uploads to new path from day one, migrate old paths in background, serve both.** Requires app-layer path resolution shim.

**Lean: copy-then-delete, tracked, resumable.** At AAA's file volume (likely under a few thousand photos/receipts/contracts combined), this runs in minutes. Script runs after the DB migration completes. Until it finishes, paths in the DB point to new locations that might not exist yet — so sequence matters: copy all files, verify, then update DB paths, then delete originals.

### Test Company row — what goes in it?
Seeded in 18a but not user-visible. What does the row actually look like?
- Name: "Test Company" (or "Sandbox" — planning session decide)
- Minimal company_settings (maybe just a name and placeholder phone)
- No Stripe, QB, email accounts, contract templates, etc. Those get created when Eric first switches into it in 18c.

**Lean: "Test Company" name, seed only the `organizations` row + one `company_settings` row with the name. Everything else lazy-initialized on first switch in 18c.**

### Existing data touching `user_permissions` — migration path
Current schema has `user_permissions(user_id, permission_key, granted)`. Moving to `user_organization_permissions(user_organization_id, ...)` means:
1. Create new table
2. Find each `user_permissions` row, look up `user_organizations.id` where `user_id = up.user_id AND organization_id = aaa_id`, insert equivalent row in new table
3. Drop `user_permissions`

This is easy because Eric is the only user. But the migration should still be written to handle "N users, M permissions each" idempotently. Planning session should write the SQL carefully.

### Connection-pool considerations
Supabase uses pgBouncer by default. JWT claims reach Postgres via `auth.jwt()` which is a function call, not a GUC. Should work fine with transaction-mode pooling. Planning session should verify there's no weirdness with RLS + pgBouncer, but I don't expect any.

### Backfill idempotency
The backfill migration should be safely re-runnable. Pattern:
```sql
UPDATE jobs SET organization_id = aaa_id WHERE organization_id IS NULL;
```
This is idempotent as long as `aaa_id` is stable across runs. If the migration crashes mid-way and reruns, `IS NULL` catches only the unupdated rows. The only non-idempotent operation is the `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL` at the end — if rerun after success, it's a no-op.

### What breaks existing code between 18a deploy and 18b?
Every query currently hitting a singleton or assumed-global table. Examples:
- `SELECT * FROM stripe_connection LIMIT 1` — now returns AAA's row because only one exists, but the query's intent must be updated to `WHERE organization_id = $aaa_id`
- Number-generation function called without org context

**Lean: the 18a planning session produces an exhaustive code-sweep task list.** Every query in the codebase that touches one of the ~35 affected tables gets updated to filter by `organization_id`, sourced from the hardcoded AAA lookup helper. This is the bulk of the non-migration work in 18a.

---

## Watch-outs for the 18a implementation

1. **Don't assume `auth.uid()` returns the right user in webhook contexts.** Service-role-key paths have no `auth.uid()`. Webhooks resolve organization via `event.data.object.metadata.organization_id` (Stripe) or stored connection rows. Plan for this in the 18a code sweep.

2. **JWT claim setting needs a custom access token hook in Supabase.** Not a code change in 18a, but a config change in Supabase dashboard. The hook reads `user_organizations` on login and sets `active_organization_id` in the token. Document the hook SQL as part of 18a's deliverables even though it only starts being read in 18b.

3. **Storage path migration is the riskiest single step.** If it fails partway, half the files point to new paths, half to old. Mitigations: run it against a full Supabase clone first, script must track state in a `storage_migration_progress` table (or similar), on failure it resumes from last checkpoint, and the DB path update happens LAST after all files are copied and verified.

4. **Don't regenerate the AAA `organizations.id` UUID between migration attempts.** Hardcode it once in build42 and reuse it in every subsequent backfill migration. If someone accidentally writes `INSERT INTO organizations (name) VALUES ('AAA...') RETURNING id` and uses that for backfill, a rerun creates a second AAA row with a different ID.

5. **`payment_intent.metadata.organization_id` change is trivial code-wise but affects every new Stripe Checkout Session.** Make sure test payments after 18a deploy still work — the metadata field is additive, shouldn't break anything, but verify on preview before prod.

6. **Unique index rework has a gotcha:** dropping `UNIQUE(invoice_number)` and adding `UNIQUE(organization_id, invoice_number)` is not atomic. Use `CREATE UNIQUE INDEX CONCURRENTLY` first, then `ALTER TABLE DROP CONSTRAINT` for the old one. Planning session should enumerate each UNIQUE rework and verify the order.

7. **Migration sequence order matters:** create `organizations` + seed AAA → add nullable `organization_id` columns everywhere → backfill → add FKs → `SET NOT NULL` → rework UNIQUE indexes → per-org sequences → role/permissions move → RLS policies (not enabled). Reordering any of these risks either a FK violation or a constraint violation mid-migration.

8. **Per-org number sequence function must be transaction-safe.** Two concurrent job creates in the same org can't both read the current max and both insert `NNNN+1`. Use `SELECT ... FOR UPDATE` inside the function, or an advisory lock on `organization_id`.

9. **`CASCADE` on FK deletes is tempting for things like `photos.job_id`.** Confirm no surprises: deleting a job cascades photos, fine. Deleting an organization must NOT cascade anything — `organizations.id` FKs should all be `ON DELETE RESTRICT`. Double-check every new FK added in 18a.

10. **The 17c-era partial UNIQUE on `payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL`** needs to become `UNIQUE(organization_id, stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL`. In practice a PI ID is globally unique from Stripe, but future multi-tenant with per-tenant Stripe accounts could technically share a PI ID if two tenants' events got cross-wired (it shouldn't happen, but the constraint is now the right shape).

11. **Nookleus rebrand is NOT in 18a.** Don't rename files, repos, package.json, or user-facing copy. If something has to be named in 18a, use `aaa-platform` / existing names. 18c handles the rebrand.

12. **No RLS testing in prod before 18b.** Planning session outputs a test plan for 18b that covers: (a) Eric authenticated with AAA claim sees AAA data, (b) Eric authenticated with Test Company claim sees Test Company data (empty), (c) Eric with no claim sees nothing, (d) service-role queries see everything. This test plan is 18a deliverable even though tests run in 18b.

13. **Supabase's `auth.jwt()` returns `jsonb`.** `(auth.jwt() ->> 'active_organization_id')::uuid` is the pattern. If the claim is missing, the cast throws — policies should handle this gracefully, either by defaulting to a "no access" condition or explicitly checking for NULL first.

14. **Code sweep will be the longest part of 18a.** Every server-side query, every RPC call, every admin-client call. Grep for the 35 affected table names. Plan for this to be more tedious than the SQL.

15. **Dev = prod database.** Migrations run against the real DB. No staging DB to test against first. This is why the scratch-project backup-restore verification in the migration plan is mandatory, not optional.

---

## Environment state going into 18a

- **Supabase migration high-water:** build41 (applied 2026-04-21). Next migration is build42.
- **Current org count:** zero (no `organizations` table exists).
- **Current user count:** one (Eric).
- **Current data volume:** single-digit real jobs (Eric's been using preview for testing — some will be "test data" that should arguably move to Test Company, but deferred). All rows backfill to AAA in 18a. Data cleanup is a separate Eric-driven exercise post-18c.
- **Stripe connection:** one row in `stripe_connection`. Test mode. Live-mode cutover gated on 18d.
- **QuickBooks connection:** sandbox realm connected. Mappings seeded per 17c briefing. Dev = prod at the QB layer too.
- **Email accounts:** Eric's `eric@aaacontracting.com` IMAP/SMTP configured. Potentially the additional `aaa-contracting.net` accounts (trevor, jdaniels, codie, jake) are present per user memory.
- **Storage buckets:** photos, receipts, contracts (and possibly others). All objects currently keyed under `{parent_id}/...` patterns. Migration target: `{org_id}/{bucket}/{parent_id}/...`.
- **RLS status:** off on all tables (per 17c baseline). 18a adds policies to the schema but does not enable.
- **Backup plan for 18a run:** Supabase PITR on + explicit `pg_dump` to local + restore to scratch project verified before running against prod.

---

## Suggested opening for the 18a planning session

When the next chat kicks off for the actual Build 18a planning work (the doc that becomes `docs/superpowers/plans/2026-MM-DD-build-18a-schema-backfill.md`), open with:

```
I'm starting planning for Build 18a of Nookleus (formerly aaa-platform).
This is the schema + backfill phase of the multi-tenant SaaS refactor.

The pre-planning briefing is attached — read it end-to-end before asking
questions. Every locked decision in the "Decisions already locked" section
is not open for re-litigation unless you find something invalidating during
implementation planning.

Your first deliverables for this planning session, in order:

1. Query the live Supabase schema and produce an authoritative list of
   every table needing organization_id. The briefing has a draft list from
   docs; ground-truth against the real schema.

2. For each table, produce a row in a migration matrix: table name, FK shape
   (RESTRICT vs CASCADE), UNIQUE indexes that need rework, backfill strategy
   (trivial UPDATE vs something more complex), estimated row count.

3. Propose the exact migration sequence (build42 through build4X) with one
   migration per clearly-defined step. Each migration must be independently
   revertible during the window between apply and the next migration.

4. Enumerate every code path that queries one of the affected tables and
   needs updating in the 18a code sweep. Group by file / module.

5. Draft the RLS policy SQL for every affected table. These ship in 18a as
   written-but-not-enforced; 18b's job is just to ENABLE ROW LEVEL SECURITY.

6. Draft the Supabase auth access-token hook SQL that will set
   active_organization_id as a JWT claim on login. 18a deliverable even
   though 18b activates it.

7. Storage path rename plan: the script, the state-tracking table, the
   sequence (copy all → verify → update DB paths → delete originals), and
   the rollback posture if it fails mid-way.

8. Pre-launch checklist for 18a (modeled on 17c's). Must include the
   scratch-project backup-restore verification, the maintenance-window
   scheduling, and the post-migration smoke-test steps.

Do not write implementation code yet. Do not write the Claude Code prompt
yet. Planning output is a single markdown plan document, comprehensive,
that reviews cleanly in one sitting.
```

---

## Reference pointers

- **17c post-build briefing** — architectural patterns to preserve (webhook-as-source-of-truth, idempotency layering, inline QB sync).
- **Build Guide v1.7** — canonical product spec including Phase 5 multi-tenant section and SaaS Readiness Principles 1-9.
- **Build Guide v1.4 Build 14d** — existing permission matrix that `user_organization_permissions` needs to preserve.
- **17c migration build41** — reference for the SQL style, migration file naming, and mapping seeding pattern.
- **Project memory** — user memory has Stack, deployment URLs, and prior-build context.
- **PRs to review before planning 18a:** [#23 (17c)](https://github.com/ericdaniels22/aaa-platform/pull/23) and whichever PR shipped 17a/17b for the Stripe connection code that gets touched in the code sweep.

---

*End of Build 18a pre-planning briefing*
