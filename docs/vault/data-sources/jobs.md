---
table: jobs
type: supabase
created_in: build-1-10
related_builds: ["[[build-1-10]]", "[[build-14c]]", "[[build-31]]", "[[build-16b]]", "[[build-16c]]", "[[build-18a]]", "[[build-66]]"]
---

#data-source #area/jobs

# `jobs`

Central business entity. Created in [[build-1-10]] (`schema.sql`); virtually every later build touches it.

## Created in

- [supabase/schema.sql](../../../supabase/schema.sql) — initial table with damage type, status, addresses, customer info, billing fields, photo bucket, etc.
- Job number generator: `generate_job_number(damage)` returns `WTR-YYYY-NNNN` / `FIR-YYYY-NNNN` / etc., backed by `job_number_seq` (resets yearly in build42's per-org rework via [[build-18a]]/build47).

## Altered by

- **[[build-14c]]** — replaces hardcoded status/damage enum with FKs into `job_statuses` and `damage_types` lookup tables.
- **[[build-31]]** — insurance redesign: multi-adjuster columns, restructured insurance fields.
- **[[build-16b]]** (migration build36) — accounting columns (`estimated_crew_labor_cost`, `payer_type`); `payer_type` trigger.
- **[[build-16c]]** (migration build37) — QuickBooks reference columns.
- **[[build-18a]]** — `organization_id` column (build43 nullable, build44 backfill, build45 NOT NULL + FK, build46 unique index rework).
- **[[build-66]]** — soft-delete columns (`deleted_at`, `deleted_by`), 30-day trash window before purge.

## RLS

- **18a:** transitional `Allow all on jobs` policy until 18b enforced.
- **18b:** `tenant_isolation_jobs` policy keyed on `nookleus.active_organization_id() = jobs.organization_id`.

## Used by

Pretty much every feature: jobs list, job detail, intake form, photos tab, files tab, contracts (FK), invoices (FK), payment requests (FK), expenses (FK), email (job match), Jarvis (`get_job_details`/`search_jobs`), accounting, reports.
