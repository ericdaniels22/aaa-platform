# Build 18a plan — Schema + backfill + storage rename

> **Status:** Planning draft. Replaces Build 18a pre-planning briefing where live-schema ground truth diverged from assumed state. No implementation code or Claude Code prompt in this document — planning output only.
>
> **Scope recap:** Ship the multi-tenant schema foundation, backfill all existing data to AAA, rework UNIQUE indexes for org-scoping, migrate storage paths to org-prefixed layout, and write (but do not enforce) RLS policies. **RLS enforcement and session context ship together in 18b.** Nookleus rebrand ships in 18c. Per-tenant third-party connections ship in 18d.
>
> **Migration high-water:** `build41` applied 2026-04-21. Next migration is `build42`.

---

## 0. Ground-truth corrections to the briefing

Before anything else, this plan records where the briefing's assumptions don't match the live database. Every downstream decision in this document flows from these corrections — worth reading before the detail sections.

### 0.1 RLS is already ON — the briefing's "Option A" no longer applies

- 50 of 52 user tables have `relrowsecurity = true`. The exceptions are `job_files` and `invoice_line_items`.
- Every enabled table has one or more `PERMISSIVE` policies with `qual = true` (effective allow-all). A few tables additionally have narrower role-based policies (`jarvis_*`, `knowledge_*`, `marketing_*`, `nav_items`, `qb_connection`, `qb_mappings`, `qb_sync_log`, `invoice_email_settings`, `user_permissions`, `user_profiles`).
- The briefing proposed (Option A): "defer `ENABLE ROW LEVEL SECURITY` to 18b." That is not possible — it is already enabled.
- **Revised approach (Option A'):** In 18a, *add* new `PERMISSIVE` tenant-isolation policies alongside the existing allow-all policies. Because `PERMISSIVE` policies are OR'd, the old allow-all keeps everything accessible through 18a — the new policies exist but have no restrictive effect. In 18b, drop the allow-all policies (or convert them to `RESTRICTIVE` with `false` quals, equivalent effect) and the tenant-isolation policies become the sole gate.
- **Why this is better than deferring an ENABLE:** No table-mode flip between releases, no risk of the policy set being half-baked at the ENABLE boundary, 18b's diff is pure policy-drop SQL with a predictable blast radius.
- `job_files` and `invoice_line_items` get `ENABLE ROW LEVEL SECURITY` added in 18a alongside their tenant-isolation policies (otherwise they'd remain unconstrained during 18b's enforcement switch).

### 0.2 Table count is 54, not ~35

The briefing's draft list missed 17 tables that also need the org-scoping decision. Full authoritative list in §1. Tables mentioned in the briefing that don't exist in the live schema: `email_matching_rules`, `job_emails`, `user_preferences`. Either renamed, consolidated, or never shipped — matching features are served by `emails.matched_by`, `emails`, and `user_profiles`/localStorage respectively.

### 0.3 Storage is 9 buckets, ~79 objects, ~44 MB

- Buckets: `company-assets`, `contracts`, `email-attachments`, `job-files`, `knowledge-docs`, `marketing-assets`, `photos`, `receipts`, `reports`.
- Path shapes vary per bucket — the briefing's assumed `{job_id}/...` prefix is NOT universal. Actual shapes include `{contact_id}/...`, `{account_id}/{email_id}/...`, `{job_number}/...`, `S500/...` (standard-id flat), and bare timestamp-slug. Storage rename plan (§7) addresses each bucket individually.
- Volume is trivial — the copy-then-delete will run in minutes, not hours.

### 0.4 Number generation uses global `SEQUENCE` objects, not a lookup function

- `public.job_number_seq` (last_value=13) and `public.invoice_number_seq` (last_value=1) are real Postgres sequences read via `nextval()` inside `generate_job_number(damage text)` and `set_invoice_number()` triggers.
- Job numbers follow `{DAMAGE_PREFIX}-{YYYY}-{NNNN}` (e.g. `WTR-2026-0013`, `FYR-2026-0010`), NOT the `JOB-YYYY-NNNN` shape assumed in docs. Damage prefix map is hardcoded in `generate_job_number`. Per-org rework (§3, build47) needs to preserve this prefix behavior.
- AAA's current counter state must be preserved on cutover. Plan writes explicit seed values into the new per-org counter table (§3, build47).

### 0.5 Data volume allows a lock-everything approach

Largest table: `emails` at 608 rows. Sum of all rows: ~900. Total storage objects: 79 (~44 MB). The 30–90s maintenance window budget from the briefing is more than sufficient; most migrations will complete in sub-second with an `ACCESS EXCLUSIVE` lock held the whole time. No need for `NOT VALID` FK tricks or batched updates.

### 0.6 Eric's user id is known

`7c55cdd0-2cbf-4c8a-8fdd-e141973ade94` — hardcoded into the membership seed in build42.

---

## 1. Authoritative table inventory with org-scoping decisions

Every public-schema table is classified into one of four buckets. This drives whether it gets an `organization_id` column, what its FK shape looks like, and what its RLS policy says.

### 1.1 Classification buckets

- **A. Tenant-owned (direct):** Core business data the tenant owns. Gets `organization_id NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT`.
- **B. Child-of-tenant (denormalized):** Child rows whose parent already has `organization_id`. Gets `organization_id` **denormalized** onto the child row (same FK shape) so RLS policies don't need a JOIN. Keeps policy SQL flat and fast. Trigger enforces parent/child org match on INSERT/UPDATE.
- **C. Global product-level:** Product-level config shared across all tenants of Nookleus. **Does NOT get `organization_id`.** RLS policy allows any authenticated user to SELECT; mutation gated on a product-level role (handled later — for 18a, match current narrow policies).
- **D. Global with optional org override:** Product-level defaults with tenant-specific extensions allowed. Gets `organization_id` as **nullable**; NULL means "Nookleus-provided, visible to all tenants." RLS policy: `organization_id IS NULL OR organization_id = active_org`.
- **E. Identity / membership (special):** User records span orgs. See §1.3.

### 1.2 Table classification

| # | Table | Rows | Bucket | Notes / rationale |
|---|---|---|---|---|
| 1 | `organizations` | **NEW** | — | Created in build42. PK = `id`. |
| 2 | `user_organizations` | **NEW** | E | Created in build42. Join table. `(user_id, organization_id)` UNIQUE. Role lives here. |
| 3 | `user_organization_permissions` | **NEW** | E | Created in build48. `(user_organization_id, permission_key)` UNIQUE. Replaces `user_permissions`. |
| 4 | `contacts` | 5 | A | Per-tenant contact book. |
| 5 | `jobs` | 5 | A | Per-tenant jobs. |
| 6 | `job_activities` | 2 | B | Child of `jobs`. Denormalized `organization_id`. |
| 7 | `job_adjusters` | 0 | B | Child of `jobs`. |
| 8 | `job_custom_fields` | 0 | B | Child of `jobs`. |
| 9 | `job_files` | 1 | B | Child of `jobs`. **Also needs `ENABLE ROW LEVEL SECURITY`** (currently off). |
| 10 | `invoices` | 1 | A | Per-tenant. UNIQUE on `invoice_number` reworked. |
| 11 | `invoice_line_items` | 2 | B | Child of `invoices`. **Also needs `ENABLE ROW LEVEL SECURITY`**. |
| 12 | `line_items` | 0 | B | Legacy table, parallel to `invoice_line_items`. Still has FK; treat as child. Consider dropping post-18a in a separate cleanup build; not in 18a scope. |
| 13 | `payments` | 5 | A | Per-tenant. Partial UNIQUE on `stripe_payment_intent_id` reworked. |
| 14 | `payment_requests` | 3 | A | Per-tenant. UNIQUE on `link_token` reworked. |
| 15 | `refunds` | 0 | A | Per-tenant. UNIQUE on `stripe_refund_id` reworked. |
| 16 | `stripe_events` | 3 | A | Per-tenant. UNIQUE on `stripe_event_id` reworked. |
| 17 | `stripe_disputes` | 0 | A | Per-tenant. UNIQUE on `stripe_dispute_id` reworked. |
| 18 | `stripe_connection` | 1 | A | Per-tenant. `UNIQUE(organization_id)` singleton constraint. |
| 19 | `qb_connection` | 1 | A | Per-tenant. `UNIQUE(organization_id)` singleton constraint. |
| 20 | `qb_mappings` | 17 | A | Per-tenant. Current `UNIQUE(type, platform_value)` → `UNIQUE(organization_id, type, platform_value)`. |
| 21 | `qb_sync_log` | 6 | A | Per-tenant. |
| 22 | `expenses` | 0 | A | Per-tenant. |
| 23 | `expense_categories` | 9 | D | Global defaults + per-tenant customization. `is_default=true` rows stay with `organization_id=NULL`; tenants can add their own. |
| 24 | `vendors` | 0 | A | Per-tenant vendor directory. |
| 25 | `email_accounts` | 2 | A | Per-tenant. |
| 26 | `emails` | 608 | B | Child of `email_accounts` (which has `organization_id`). Denormalized. Dedup index reworked to include org. |
| 27 | `email_attachments` | 57 | B | Child of `emails`. |
| 28 | `email_signatures` | 0 | B | Child of `email_accounts`. |
| 29 | `category_rules` | 36 | D | Email categorization rules. Ship defaults with `organization_id=NULL`; tenants can override by inserting their own. |
| 30 | `contract_templates` | 3 | A | Per-tenant. Current (untracked-unique) `name` → `UNIQUE(organization_id, name)`. Actual live schema has no UNIQUE on `name` — §3 build46 only adds the new composite, no drop. |
| 31 | `contracts` | 15 | A | Per-tenant. `link_token` UNIQUE reworked. |
| 32 | `contract_signers` | 15 | B | Child of `contracts`. `UNIQUE(contract_id, signer_order)` is already tenant-scoped via the contract FK — add `organization_id` column but no UNIQUE rework needed. |
| 33 | `contract_events` | 44 | B | Child of `contracts`. |
| 34 | `contract_email_settings` | 1 | A | Per-tenant singleton. `UNIQUE(organization_id)`. |
| 35 | `invoice_email_settings` | 1 | A | Per-tenant singleton. `UNIQUE(organization_id)`. |
| 36 | `payment_email_settings` | 1 | A | Per-tenant singleton. `UNIQUE(organization_id)`. |
| 37 | `company_settings` | 10 | A | Per-tenant K/V. `UNIQUE(key)` → `UNIQUE(organization_id, key)`. |
| 38 | `form_config` | 1 | A | Per-tenant form builder config. Current implicit singleton → `UNIQUE(organization_id)`. |
| 39 | `photos` | 5 | A | Per-tenant. |
| 40 | `photo_tags` | 10 | A | Per-tenant customizable tags. `UNIQUE(name)` → `UNIQUE(organization_id, name)`. |
| 41 | `photo_tag_assignments` | 0 | B | Child of `photos`. |
| 42 | `photo_annotations` | 3 | B | Child of `photos`. |
| 43 | `photo_reports` | 3 | A | Per-tenant. |
| 44 | `photo_report_templates` | 1 | A | Per-tenant. Each tenant can define their own templates. |
| 45 | `damage_types` | 8 | D | Global defaults + per-tenant customization. Default types (water/fire/mold/storm/other) seeded with `organization_id=NULL`. Custom types per tenant. `UNIQUE(name)` → `UNIQUE(organization_id, name)` with a partial unique on NULL to enforce default names globally. |
| 46 | `job_statuses` | 5 | D | Same pattern as `damage_types`. |
| 47 | `notifications` | 2 | A | Per-tenant. Routed to user_id within the tenant. |
| 48 | `notification_preferences` | 8 | B | Child of `user_organizations` — a user's preferences are per-membership. Move FK to `user_organization_id`. §3 build48 handles this alongside the permissions move. |
| 49 | `knowledge_documents` | 1 | D | IICRC S500/S520/S700 are product-level industry standards. Seed with `organization_id=NULL`. Tenants *could* upload their own SOPs later but not scope for 18a. Keep existing admin-role policies. |
| 50 | `knowledge_chunks` | 0 | D | Inherits visibility from parent doc. Denormalize `organization_id` from `knowledge_documents`. |
| 51 | `jarvis_conversations` | 9 | A | Per-tenant. Existing user-scoped policy stays; add org-scoping layer. |
| 52 | `jarvis_alerts` | 0 | A | Per-tenant. |
| 53 | `marketing_assets` | 1 | A | Per-tenant. Each tenant has their own marketing library. |
| 54 | `marketing_drafts` | 1 | A | Per-tenant. |
| 55 | `nav_items` | 11 | C | **Global product-level.** The sidebar nav is Nookleus product identity, not per-tenant. Do NOT add `organization_id`. RLS policy stays as-is (any authenticated reads, admin writes). |
| 56 | `user_profiles` | 1 | E | Identity. **No `organization_id`.** Briefing's lean accepted: `role` column dropped in build48 (moves to `user_organizations.role`). Name/phone/photo stay. |
| 57 | `user_permissions` | 18 | — | **Dropped in build48** after migration to `user_organization_permissions`. |

### 1.3 User tables — special handling

Per briefing lean: `user_profiles` carries identity only (name, phone, photo, active flag). The `role` column moves to `user_organizations.role` — a user can be admin in one workspace, crew_member in another. `user_permissions(user_id, permission_key, granted)` is replaced by `user_organization_permissions(user_organization_id, permission_key, granted)` so permissions scope to membership, not user.

RLS on user_profiles: "any authenticated user can read any profile" is preserved. This is acceptable — name/email leakage across orgs is tolerated because there's no business data on user_profiles. Writes remain self-only.

### 1.4 Bucket C justification — why nav_items is global

Every alternative (giving AAA its own nav, letting each tenant reorder) creates a product maintenance burden for marginal benefit. The sidebar is Nookleus product identity. When we add a feature to the product, all tenants should see the new nav entry without a per-tenant data migration. If a tenant needs custom nav someday (unlikely — this is a vertical SaaS), that's a future build with an override table, not a retrofit.

---

## 2. Migration matrix

One row per affected table. Columns map directly to what build42–build50 must do.

### 2.1 Legend

- **Bucket** — A/B/C/D/E from §1.1.
- **FK shape** — `RESTRICT` on every new FK to `organizations(id)`. Child-of-tenant tables keep their existing child FK (e.g. `photos.job_id → jobs.id`) at `CASCADE` if already that way; adding `organization_id` is orthogonal.
- **UNIQUE rework** — `none` / `add-composite` (add new composite UNIQUE alongside, drop old after) / `scope-to-org` (replace existing global UNIQUE with org-scoped variant).
- **Backfill** — `trivial` (all rows to AAA) / `NULL` (leave NULL for bucket D defaults) / `denorm` (join from parent).

### 2.2 Matrix

| Table | Bucket | FK shape to orgs | UNIQUE rework | Backfill | Row count |
|---|---|---|---|---|---|
| `contacts` | A | RESTRICT | none | trivial | 5 |
| `jobs` | A | RESTRICT | `jobs_job_number_key` → `UNIQUE(org, job_number)` | trivial | 5 |
| `job_activities` | B | RESTRICT | none | denorm from jobs | 2 |
| `job_adjusters` | B | RESTRICT | none | denorm from jobs | 0 |
| `job_custom_fields` | B | RESTRICT | none (UNIQUE already per-job) | denorm from jobs | 0 |
| `job_files` | B | RESTRICT | `storage_path` UNIQUE stays (org prefix in path guarantees uniqueness) | denorm from jobs | 1 |
| `invoices` | A | RESTRICT | `invoices_invoice_number_key` → `UNIQUE(org, invoice_number)` | trivial | 1 |
| `invoice_line_items` | B | RESTRICT | none | denorm from invoices | 2 |
| `line_items` | B | RESTRICT | none | denorm from invoices | 0 |
| `payments` | A | RESTRICT | `idx_payments_stripe_payment_intent_unique` → `UNIQUE(org, stripe_payment_intent_id) WHERE ... IS NOT NULL` | trivial | 5 |
| `payment_requests` | A | RESTRICT | `payment_requests_link_token_key` → `UNIQUE(org, link_token)` | trivial | 3 |
| `refunds` | A | RESTRICT | `refunds_stripe_refund_id_key` → `UNIQUE(org, stripe_refund_id)` | trivial | 0 |
| `stripe_events` | A | RESTRICT | `stripe_events_stripe_event_id_key` → `UNIQUE(org, stripe_event_id)` | trivial | 3 |
| `stripe_disputes` | A | RESTRICT | `stripe_disputes_stripe_dispute_id_key` → `UNIQUE(org, stripe_dispute_id)` | trivial | 0 |
| `stripe_connection` | A | RESTRICT | add `UNIQUE(organization_id)` | trivial | 1 |
| `qb_connection` | A | RESTRICT | add `UNIQUE(organization_id)` | trivial | 1 |
| `qb_mappings` | A | RESTRICT | `qb_mappings_type_platform_value_key` → `UNIQUE(org, type, platform_value)` | trivial | 17 |
| `qb_sync_log` | A | RESTRICT | none | trivial | 6 |
| `expenses` | A | RESTRICT | none | trivial | 0 |
| `expense_categories` | D | RESTRICT (nullable col) | `expense_categories_name_key` → partial unique `WHERE org IS NULL` + `UNIQUE(org, name) WHERE org IS NOT NULL` | NULL (keep as defaults) | 9 |
| `vendors` | A | RESTRICT | none | trivial | 0 |
| `email_accounts` | A | RESTRICT | none | trivial | 2 |
| `emails` | B | RESTRICT | `idx_emails_dedup` → `UNIQUE(org, message_id, account_id, folder)` | denorm from email_accounts | 608 |
| `email_attachments` | B | RESTRICT | none | denorm from emails | 57 |
| `email_signatures` | B | RESTRICT | `email_signatures_account_id_key` stays (per-account is implicitly per-org) | denorm from email_accounts | 0 |
| `category_rules` | D | RESTRICT (nullable col) | none (no current unique) | NULL | 36 |
| `contract_templates` | A | RESTRICT | add `UNIQUE(org, name)` (no pre-existing UNIQUE to drop) | trivial | 3 |
| `contracts` | A | RESTRICT | `contracts_link_token_key` → `UNIQUE(org, link_token)` | trivial | 15 |
| `contract_signers` | B | RESTRICT | none (existing `(contract_id, signer_order)` UNIQUE stays) | denorm from contracts | 15 |
| `contract_events` | B | RESTRICT | none | denorm from contracts | 44 |
| `contract_email_settings` | A | RESTRICT | add `UNIQUE(organization_id)` | trivial | 1 |
| `invoice_email_settings` | A | RESTRICT | add `UNIQUE(organization_id)` | trivial | 1 |
| `payment_email_settings` | A | RESTRICT | add `UNIQUE(organization_id)` | trivial | 1 |
| `company_settings` | A | RESTRICT | `company_settings_key_key` → `UNIQUE(org, key)` | trivial | 10 |
| `form_config` | A | RESTRICT | add `UNIQUE(organization_id)` | trivial | 1 |
| `photos` | A | RESTRICT | none | trivial | 5 |
| `photo_tags` | A | RESTRICT | `photo_tags_name_key` → `UNIQUE(org, name)` | trivial | 10 |
| `photo_tag_assignments` | B | RESTRICT | none | denorm from photos | 0 |
| `photo_annotations` | B | RESTRICT | none | denorm from photos | 3 |
| `photo_reports` | A | RESTRICT | none | trivial | 3 |
| `photo_report_templates` | A | RESTRICT | none | trivial | 1 |
| `damage_types` | D | RESTRICT (nullable col) | `damage_types_name_key` → split partial unique (NULL defaults global, non-NULL per-org) | NULL | 8 |
| `job_statuses` | D | RESTRICT (nullable col) | `job_statuses_name_key` → same split pattern | NULL | 5 |
| `notifications` | A | RESTRICT | none | trivial | 2 |
| `notification_preferences` | E | FK to user_organizations, not organizations | `user_id, notification_type` UNIQUE → `user_organization_id, notification_type` UNIQUE | migrate via user_orgs lookup (build48) | 8 |
| `knowledge_documents` | D | RESTRICT (nullable col) | none | NULL (product-level) | 1 |
| `knowledge_chunks` | D | RESTRICT (nullable col) | none | denorm from knowledge_documents (NULL follows) | 0 |
| `jarvis_conversations` | A | RESTRICT | none | trivial | 9 |
| `jarvis_alerts` | A | RESTRICT | none | trivial | 0 |
| `marketing_assets` | A | RESTRICT | none | trivial | 1 |
| `marketing_drafts` | A | RESTRICT | none | trivial | 1 |
| `nav_items` | C | no change | none | no change | 11 |
| `user_profiles` | E | no org FK | none | drop `role` column (build48) | 1 |
| `user_permissions` | — | — | drop table | migrate into user_organization_permissions (build48) | 18 |

### 2.3 The split-partial-unique pattern for bucket D tables

For `expense_categories`, `damage_types`, `job_statuses`:

```sql
-- Replaces the simple UNIQUE(name) constraint.
-- Defaults (organization_id IS NULL) must be globally unique by name.
CREATE UNIQUE INDEX {table}_name_default_key
  ON public.{table} (name) WHERE organization_id IS NULL;

-- Per-tenant customizations are unique within their own org.
CREATE UNIQUE INDEX {table}_org_name_key
  ON public.{table} (organization_id, name) WHERE organization_id IS NOT NULL;
```

This keeps the invariants from today while allowing tenant-specific overrides of any name. RLS (§5) filters visibility to `organization_id IS NULL OR organization_id = active_org`.

---

## 3. Migration sequence

Nine migrations, `build42` through `build50`. Every migration independently revertible between its apply and the next migration (revert SQL drafted in §3.11). All run inside a single transaction per migration (`apply_migration` default).

### 3.1 `build42_create_organizations_and_memberships`

**Purpose:** Create the three new tables. Seed AAA and Test Company. Seed Eric's membership.

**Does:**
- `CREATE TABLE organizations (id, name, slug, created_at, updated_at)` + `UNIQUE(slug)`.
- `CREATE TABLE user_organizations (id, user_id FK auth.users, organization_id FK organizations, role, created_at)` + `UNIQUE(user_id, organization_id)`. Role check: `('admin','crew_lead','crew_member','custom')`. Both FKs `ON DELETE RESTRICT`.
- Hardcoded `INSERT` of AAA row with known UUID literal. **This UUID is committed to the migration file** — do not regenerate on rerun.
- Hardcoded `INSERT` of Test Company with known UUID literal.
- `INSERT INTO user_organizations (user_id, organization_id, role)` for Eric + AAA with role=`admin`.
- `CREATE SCHEMA nookleus` — namespace for helper functions that shouldn't live in `public`.
- `CREATE FUNCTION nookleus.active_organization_id() RETURNS uuid` — reads `auth.jwt() -> 'active_organization_id'`, returns NULL on missing claim (policies handle NULL explicitly).
- `CREATE FUNCTION nookleus.aaa_organization_id() RETURNS uuid` — returns the hardcoded AAA literal. Exists for temporary use by the code sweep; removed in 18b once every caller uses the JWT claim.

**UUIDs to hardcode (chosen now, committed in the migration file):**
- AAA: `a0000000-0000-4000-8000-000000000001`
- Test Company: `a0000000-0000-4000-8000-000000000002`

Both use UUIDv4 reserved prefix `a0000000-...-0001`/`-0002` for instant visual recognition in log lines; the non-reserved bits `4` (version) and `8` (variant) keep them valid UUIDs.

**Depends on:** nothing.

**Revert:** `DROP SCHEMA nookleus CASCADE; DROP TABLE user_organizations, organizations;`. Safe — no other tables reference these yet.

---

### 3.2 `build43_add_nullable_organization_id_columns`

**Purpose:** Add `organization_id uuid` (nullable, no default, no FK) to every bucket-A / bucket-B / bucket-D / bucket-E-child table.

**Does:** One `ALTER TABLE ... ADD COLUMN organization_id uuid` per affected table. In Postgres 17, adding a nullable column with no default is a metadata-only change — no table rewrite, milliseconds even on the 608-row `emails` table.

**Why this is its own migration and not merged with build44:** If backfill fails for some reason (nobody expects it, but still), we can re-run backfill without having to re-add the column. Atomic revert is cleaner.

**Depends on:** build42 (the UUIDs it'll reference exist in organizations).

**Revert:** `ALTER TABLE ... DROP COLUMN organization_id` per table. No data lost — column is still nullable and empty.

---

### 3.3 `build44_backfill_organization_id`

**Purpose:** Populate every row's `organization_id`.

**Structure:**

```sql
DO $$
DECLARE
  aaa_id uuid := 'a0000000-0000-4000-8000-000000000001';
BEGIN
  -- Bucket A: trivial
  UPDATE public.contacts SET organization_id = aaa_id WHERE organization_id IS NULL;
  UPDATE public.jobs SET organization_id = aaa_id WHERE organization_id IS NULL;
  -- ... all bucket-A tables ...

  -- Bucket B: denormalize from parent
  UPDATE public.job_activities ja SET organization_id = j.organization_id
    FROM public.jobs j WHERE ja.job_id = j.id AND ja.organization_id IS NULL;
  UPDATE public.emails e SET organization_id = ea.organization_id
    FROM public.email_accounts ea WHERE e.account_id = ea.id AND e.organization_id IS NULL;
  UPDATE public.email_attachments eat SET organization_id = e.organization_id
    FROM public.emails e WHERE eat.email_id = e.id AND eat.organization_id IS NULL;
  -- ... etc ...

  -- Bucket D: LEAVE NULL (these are defaults)
  -- expense_categories, damage_types, job_statuses, category_rules, knowledge_documents, knowledge_chunks

  -- Safety check: every bucket-A/B row must be populated
  IF EXISTS (SELECT 1 FROM public.jobs WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'jobs has unbackfilled rows';
  END IF;
  -- ... repeat for each bucket-A/B table ...
END $$;
```

**Idempotency:** `WHERE organization_id IS NULL` means re-running is safe. The guard assertions at the end fail loudly if any row was missed.

**Bucket B order matters:** Denormalize in dependency order so parents are populated before children. Specifically:
1. `email_accounts` before `emails` before `email_attachments` before `email_signatures`.
2. `jobs` before `job_*` children.
3. `invoices` before `invoice_line_items`, `line_items`.
4. `contracts` before `contract_signers`, `contract_events`.
5. `photos` before `photo_tag_assignments`, `photo_annotations`.
6. `knowledge_documents` before `knowledge_chunks`.

**Depends on:** build43.

**Revert:** `UPDATE public.{table} SET organization_id = NULL;` per table. Trivial.

---

### 3.4 `build45_organization_id_not_null_and_fks`

**Purpose:** Set `NOT NULL` constraint and add FK to `organizations(id) ON DELETE RESTRICT` for every populated column.

**Does:**
- Bucket A/B tables: `ALTER TABLE ... ALTER COLUMN organization_id SET NOT NULL` + `ALTER TABLE ... ADD CONSTRAINT fk_{table}_organization FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT`.
- Bucket D tables: `ADD CONSTRAINT` only (keep column nullable).
- Index every new `organization_id`: `CREATE INDEX idx_{table}_organization_id ON public.{table}(organization_id)` — critical for RLS policy performance once enforced in 18b.

**Depends on:** build44 (every row populated for bucket A/B).

**Revert:** drop FKs, drop indexes, `DROP NOT NULL`. Column and data preserved.

---

### 3.5 `build46_rework_unique_indexes`

**Purpose:** Replace global UNIQUE indexes with org-scoped composite UNIQUE indexes.

**Pattern per index:**

```sql
-- 1. Create new concurrent unique index
CREATE UNIQUE INDEX CONCURRENTLY idx_{table}_{col}_org_unique
  ON public.{table} (organization_id, {col}) [WHERE ...];

-- 2. Drop the old constraint
ALTER TABLE public.{table} DROP CONSTRAINT {old_constraint_name};
-- OR if it was only an index, not a constraint:
DROP INDEX public.{old_index_name};
```

**Caveat on `CREATE INDEX CONCURRENTLY`:** Cannot run inside a transaction block. `apply_migration` wraps each migration in a transaction by default. Two workarounds:

1. Split into separate migrations: one for the new `CREATE INDEX CONCURRENTLY` (no transaction), one for the `DROP CONSTRAINT` (transactional). Six indexes → six migrations. Ugly.
2. At AAA's data volume (≤608 rows per table), regular `CREATE INDEX` holds `ACCESS EXCLUSIVE` for milliseconds. Skip `CONCURRENTLY` entirely. This is the recommended path given the data size and maintenance-window budget.

**Recommendation: path 2.** One transactional migration. Lock impact is negligible.

**Indexes reworked (13 total):**

| Table | Old | New |
|---|---|---|
| `jobs` | `jobs_job_number_key` | `UNIQUE(organization_id, job_number)` |
| `invoices` | `invoices_invoice_number_key` | `UNIQUE(organization_id, invoice_number)` |
| `payments` | `idx_payments_stripe_payment_intent_unique` | `UNIQUE(organization_id, stripe_payment_intent_id) WHERE ... IS NOT NULL` |
| `payment_requests` | `payment_requests_link_token_key` | `UNIQUE(organization_id, link_token)` |
| `refunds` | `refunds_stripe_refund_id_key` | `UNIQUE(organization_id, stripe_refund_id)` |
| `stripe_events` | `stripe_events_stripe_event_id_key` | `UNIQUE(organization_id, stripe_event_id)` |
| `stripe_disputes` | `stripe_disputes_stripe_dispute_id_key` | `UNIQUE(organization_id, stripe_dispute_id)` |
| `contracts` | `contracts_link_token_key` | `UNIQUE(organization_id, link_token)` |
| `company_settings` | `company_settings_key_key` | `UNIQUE(organization_id, key)` |
| `qb_mappings` | `qb_mappings_type_platform_value_key` | `UNIQUE(organization_id, type, platform_value)` |
| `photo_tags` | `photo_tags_name_key` | `UNIQUE(organization_id, name)` |
| `emails` | `idx_emails_dedup` | `UNIQUE(organization_id, message_id, account_id, folder)` |
| `damage_types` | `damage_types_name_key` | split partial (see §2.3) |
| `job_statuses` | `job_statuses_name_key` | split partial |
| `expense_categories` | `expense_categories_name_key` | split partial |

New per-tenant singletons (add, don't replace):
- `UNIQUE(organization_id)` on: `stripe_connection`, `qb_connection`, `contract_email_settings`, `invoice_email_settings`, `payment_email_settings`, `form_config`.

New composite UNIQUE on previously-unconstrained column:
- `contract_templates`: `UNIQUE(organization_id, name)`.

**Depends on:** build45.

**Revert:** recreate the old indexes, drop the new ones. SQL is mechanical — keep in the same migration file as `-- rollback` comments for ease.

---

### 3.6 `build47_per_org_number_generator`

**Purpose:** Replace global sequences with a per-org counter table. Preserve AAA's current counter state.

**Does:**

```sql
-- Counter table: one row per (org, year, document_kind)
CREATE TABLE public.org_number_counters (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  year int NOT NULL,
  document_kind text NOT NULL CHECK (document_kind IN ('job','invoice')),
  next_value int NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  PRIMARY KEY (organization_id, year, document_kind)
);

-- Seed AAA's current state. job_number_seq last_value=13 (is_called=true), so
-- next call returns 14. invoice_number_seq last_value=1 but no rows used it,
-- so next call returns 2 — but rows in invoices used invoice_number_seq=1.
-- Verify: SELECT invoice_number FROM invoices. Invoice numbers seen: INV-2026-0001.
-- So next_value should start at 2.
INSERT INTO public.org_number_counters (organization_id, year, document_kind, next_value)
VALUES
  ('a0000000-0000-4000-8000-000000000001', EXTRACT(YEAR FROM now())::int, 'job',     14),
  ('a0000000-0000-4000-8000-000000000001', EXTRACT(YEAR FROM now())::int, 'invoice',  2);

-- Lookup function: SELECT FOR UPDATE prevents concurrent duplicate numbers.
-- Advisory lock on organization_id as a secondary guard against pathological cases.
CREATE OR REPLACE FUNCTION public.next_job_number(p_org uuid, p_damage text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  prefix text;
  yr int := EXTRACT(YEAR FROM now())::int;
  counter int;
BEGIN
  prefix := CASE p_damage
    WHEN 'water' THEN 'WTR'
    WHEN 'fire' THEN 'FYR'
    WHEN 'mold' THEN 'MLD'
    WHEN 'storm' THEN 'STM'
    WHEN 'biohazard' THEN 'BIO'
    WHEN 'contents' THEN 'CTS'
    WHEN 'rebuild' THEN 'BLD'
    ELSE 'JOB'
  END;

  INSERT INTO public.org_number_counters (organization_id, year, document_kind, next_value)
    VALUES (p_org, yr, 'job', 1)
    ON CONFLICT (organization_id, year, document_kind) DO NOTHING;

  UPDATE public.org_number_counters
    SET next_value = next_value + 1
    WHERE organization_id = p_org AND year = yr AND document_kind = 'job'
    RETURNING next_value - 1 INTO counter;

  RETURN prefix || '-' || yr || '-' || lpad(counter::text, 4, '0');
END;
$$;

-- Equivalent for invoice. Same shape.
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_org uuid) ... ;

-- Rewire the trigger functions.
CREATE OR REPLACE FUNCTION public.set_job_number() RETURNS trigger AS $$
BEGIN
  IF NEW.job_number IS NULL OR NEW.job_number = '' THEN
    NEW.job_number := public.next_job_number(NEW.organization_id, NEW.damage_type);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.set_invoice_number() RETURNS trigger AS $$
DECLARE
  org_id uuid;
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.invoice_number := public.next_invoice_number(NEW.organization_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Legacy sequences kept but detached from triggers. Drop in a post-18a cleanup build
-- once we're certain no other code paths reference them.
```

**Transaction safety:** The UPDATE...RETURNING gives us an atomic counter increment — concurrent transactions serialize on the row lock. No FOR UPDATE needed.

**Damage type prefix map:** Currently hardcoded in the function. Phase 5 will push this into `damage_types.prefix_code` so tenants can customize. Out of scope for 18a; document as followup.

**Depends on:** build45 (organization_id exists and is NOT NULL on jobs/invoices).

**Revert:** Restore the original `generate_job_number(text)` and `set_invoice_number()` trigger functions from the pre-build42 state. Drop the new counter table. AAA's `job_number_seq`/`invoice_number_seq` are untouched so trigger flow reverts to using them.

---

### 3.7 `build48_migrate_user_permissions_and_preferences`

**Purpose:** Move role/permissions/preferences off `user_profiles` and onto membership.

**Does:**

```sql
-- 1. New permissions table
CREATE TABLE public.user_organization_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_organization_id uuid NOT NULL REFERENCES public.user_organizations(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  granted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_organization_id, permission_key)
);

-- 2. Migrate existing permissions via membership lookup
INSERT INTO public.user_organization_permissions (user_organization_id, permission_key, granted)
SELECT uo.id, up.permission_key, up.granted
FROM public.user_permissions up
JOIN public.user_organizations uo
  ON uo.user_id = up.user_id
  AND uo.organization_id = 'a0000000-0000-4000-8000-000000000001'
ON CONFLICT (user_organization_id, permission_key) DO UPDATE SET granted = EXCLUDED.granted;

-- 3. Rewire notification_preferences to user_organization_id
ALTER TABLE public.notification_preferences ADD COLUMN user_organization_id uuid;
UPDATE public.notification_preferences np
  SET user_organization_id = uo.id
  FROM public.user_organizations uo
  WHERE np.user_id = uo.user_id
    AND uo.organization_id = 'a0000000-0000-4000-8000-000000000001';
ALTER TABLE public.notification_preferences
  ALTER COLUMN user_organization_id SET NOT NULL,
  ADD CONSTRAINT fk_notification_prefs_user_org
    FOREIGN KEY (user_organization_id) REFERENCES public.user_organizations(id) ON DELETE CASCADE;
ALTER TABLE public.notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_user_id_notification_type_key;
CREATE UNIQUE INDEX notification_preferences_user_org_type_key
  ON public.notification_preferences(user_organization_id, notification_type);
ALTER TABLE public.notification_preferences DROP COLUMN user_id;

-- 4. Drop user_profiles.role (moved to user_organizations.role)
-- Verify first that no code currently reads user_profiles.role outside the
-- allowed code-sweep list (§4). If any RLS policy references user_profiles.role,
-- update it before drop.
ALTER TABLE public.user_profiles DROP COLUMN role;

-- 5. Drop old user_permissions table
-- KEEP it for now — drop in a follow-up cleanup migration after 18a is live
-- and the code sweep has shipped. This is safer than dropping it in the same
-- migration: if anything still queries user_permissions during the code-sweep
-- rollout, it'll fail hard instead of silently returning nothing.
-- Add a deprecation note and drop in the post-18a cleanup migration.
COMMENT ON TABLE public.user_permissions IS 'DEPRECATED as of build48. Use user_organization_permissions. Scheduled for DROP after 18a code sweep ships.';
```

**Caveat on user_profiles.role drop:** The live schema has existing RLS policies that reference `user_profiles.role = 'admin'` (on `knowledge_documents`, `knowledge_chunks`, `marketing_assets`, `marketing_drafts`, `nav_items`, `jarvis_conversations`, `jarvis_alerts`, `invoice_email_settings`, `qb_connection`, `qb_sync_log`). These policies all need rewriting to check `user_organizations.role` instead. This migration must:

1. `DROP POLICY` for each affected policy.
2. `CREATE POLICY` with the new check referencing `user_organizations` joined to the same user.
3. `DROP COLUMN user_profiles.role` last.

Full rewritten policies covered in §5.5.

**Depends on:** build45 (organization_id exists), build42 (user_organizations seeded).

**Revert:** add `user_profiles.role` back, backfill from user_organizations, recreate old policies, rebuild user_permissions from user_organization_permissions, drop the new tables. Non-trivial — this is the build where revert is hardest. Mitigate by keeping a verified scratch-project snapshot immediately before apply (§8 checklist).

---

### 3.8 `build49_rls_policies_written_not_enforced`

**Purpose:** Add tenant-isolation `PERMISSIVE` policies on every bucket-A/B/D table alongside the existing allow-all policies. Policies have no restrictive effect during 18a (because allow-all is OR'd in), but 18b drops the allow-all and the tenant-isolation takes over.

**Pattern (applied per table):**

```sql
-- Bucket A/B (strict match required)
CREATE POLICY tenant_isolation_select_{table} ON public.{table} FOR SELECT TO authenticated
  USING (
    organization_id = nookleus.active_organization_id()
    AND organization_id IN (
      SELECT organization_id FROM public.user_organizations WHERE user_id = auth.uid()
    )
  );

CREATE POLICY tenant_isolation_mod_{table} ON public.{table} FOR ALL TO authenticated
  USING (
    organization_id = nookleus.active_organization_id()
    AND organization_id IN (
      SELECT organization_id FROM public.user_organizations WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id = nookleus.active_organization_id()
    AND organization_id IN (
      SELECT organization_id FROM public.user_organizations WHERE user_id = auth.uid()
    )
  );
```

**Bucket D pattern (defaults visible to all members):**

```sql
CREATE POLICY tenant_isolation_select_{table} ON public.{table} FOR SELECT TO authenticated
  USING (
    organization_id IS NULL  -- product-level defaults, visible to every tenant
    OR (
      organization_id = nookleus.active_organization_id()
      AND organization_id IN (
        SELECT organization_id FROM public.user_organizations WHERE user_id = auth.uid()
      )
    )
  );

-- Modification of NULL-org rows is product-team only — blocked for end users.
CREATE POLICY tenant_isolation_mod_{table} ON public.{table} FOR ALL TO authenticated
  USING (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND organization_id IN (
      SELECT organization_id FROM public.user_organizations WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nookleus.active_organization_id()
    AND organization_id IN (
      SELECT organization_id FROM public.user_organizations WHERE user_id = auth.uid()
    )
  );
```

**Also adds:** `ENABLE ROW LEVEL SECURITY` on `job_files` and `invoice_line_items` (currently off), with the bucket-B tenant-isolation policy.

**Also adds:** rewritten policies for the nine tables currently gating on `user_profiles.role = 'admin'`. See §5.5 for the new definitions.

**Does NOT touch:** The existing `Allow all on {table}` policies. They stay — that's what makes 18a non-enforcing.

**Depends on:** build42 (nookleus schema and functions), build45 (org column exists).

**Revert:** `DROP POLICY` for each new policy, plus `DISABLE ROW LEVEL SECURITY` on `job_files` and `invoice_line_items`. Trivial.

---

### 3.9 `build50_storage_migration_tracking`

**Purpose:** Schema and helper functions for the storage rename script (the actual rename runs as a Node script, not SQL — see §7).

**Does:**

```sql
CREATE TABLE public.storage_migration_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL,
  old_path text NOT NULL,
  new_path text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','copied','verified','db_updated','deleted','failed')),
  error_message text,
  attempted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket_id, old_path)
);

CREATE INDEX idx_storage_migration_status ON public.storage_migration_progress(status);
```

The rename script (Node, runs from CI or locally) reads/writes this table to track progress and resume on failure. Table is dropped in a post-18a cleanup migration.

**Depends on:** nothing.

**Revert:** `DROP TABLE public.storage_migration_progress`.

---

### 3.10 Sequence summary

| # | Migration | Bytes SQL (approx) | Duration est. | Revertibility |
|---|---|---|---|---|
| build42 | create orgs + memberships + seed | 2 KB | <100 ms | Trivial |
| build43 | add nullable organization_id (47 ALTERs) | 3 KB | <500 ms total | Trivial |
| build44 | backfill | 4 KB | <1 s | Trivial |
| build45 | NOT NULL + FK + index (47 × 3 stmts) | 5 KB | 1–3 s | Trivial |
| build46 | UNIQUE rework | 3 KB | <1 s | Trivial |
| build47 | per-org number generator | 3 KB | <100 ms | Moderate (restore old function) |
| build48 | user permissions + policies touching user_profiles.role | 4 KB | <1 s | **Hardest** — requires pre-migration snapshot for safe revert |
| build49 | RLS policies written not enforced | 8 KB | <1 s | Trivial |
| build50 | storage migration tracking table | <1 KB | <100 ms | Trivial |
| **Total** | 9 migrations | ~33 KB | <10 s aggregate locks | |

The estimated 30–90s maintenance window in the briefing is comfortable. Recommend scheduling 10 PM rather than 11 PM so post-migration smoke tests can complete before Eric goes to bed — not 2 AM debugging.

### 3.11 Independent revertibility

Each migration is independently revertible in the window between apply and the next migration applying. The revert SQL is trivial for every migration except build47 (requires preserving pre-migration function definition) and build48 (requires preserving pre-migration user_permissions table state + RLS policies — mitigated by scratch-project snapshot).

Every migration file includes `-- ROLLBACK ---` section at the bottom with the reverse SQL, even if not used. Gives a fast copy-paste path if something breaks before build{N+1} lands.

---

## 4. Code sweep inventory

Every server-side file that queries one of the affected tables needs updating to filter by `organization_id`, sourced from `nookleus.aaa_organization_id()` (the temporary helper from build42) until 18b wires in the real session context.

> **NOTE on precision:** I do not have direct repo access for this plan. This inventory is a pattern-based enumeration from the schema touched and the folder layout described in project memory. The actual code-sweep work is a grep pass over the repo using the queries in §4.3. Expect small misses — those surface in `npm run build` type errors after the schema migrations.

### 4.1 File/module groups to audit

#### API routes (likely `/src/app/api/.../route.ts`)
- `api/jobs/` — create, read, update. Inject `organization_id` on INSERT. Filter all SELECTs.
- `api/jobs/[id]/` — verify job belongs to active org before any mutation.
- `api/intake/` — customer intake form submission. Create contact and job both scoped to org.
- `api/photos/` — list (filter), upload (inject org_id, write to org-prefixed storage path).
- `api/photos/[id]/` — read/annotate. Load with org check.
- `api/reports/` — list, generate. PDF output path includes org prefix.
- `api/contacts/` — list, create, update.
- `api/invoices/` — all endpoints. `set_invoice_number` trigger now requires org_id be set on the invoice row.
- `api/payments/` — all endpoints.
- `api/payment-requests/` — creation includes `metadata.organization_id` on the Stripe Checkout Session.
- `api/payment-requests/[id]/void/`, `.../reminders/`.
- `api/stripe/webhook/` — reads org from `event.data.object.metadata.organization_id`, falls back to `nookleus.aaa_organization_id()` for events issued before 18a deploy. New helper: `resolveOrgFromStripeEvent(event)` encapsulates this.
- `api/stripe/connect/start/`, `.../callback/`, `.../disconnect/` — all read/write `stripe_connection` filtered by org.
- `api/contracts/` — list, send, void. Inject org on create. Merge field resolver (from Build 15) already queries company_settings — now needs the org-scoped version.
- `api/contracts/[id]/remind/`, `.../reminders/` — scoped queries.
- `api/sign/[token]/` — **public route, no auth**. Uses service-role client. Resolves contract → org explicitly, logs events filtered by org. Verifies link token against (org, contract_id) pair.
- `api/pay/[token]/` — same pattern as `api/sign/[token]/`.
- `api/emails/sync/` — IMAP sync. Reads email_accounts filtered by org, writes emails with org denorm.
- `api/emails/[id]/` — reply/forward send. Reads email_signatures by account (implicit org).
- `api/email-accounts/` — CRUD. Inject org on create.
- `api/notifications/` — list filtered by user_organization_id, not user_id.
- `api/settings/company/` — reads/writes company_settings filtered by (org, key).
- `api/settings/damage-types/`, `.../statuses/`, `.../expense-categories/` — bucket-D pattern: SELECT returns NULL-org defaults PLUS org-owned rows. INSERT always writes with org_id set.
- `api/settings/form-config/`, `.../email-accounts/`, `.../contract-templates/`, `.../payment-templates/` — straight org-scoped CRUD.
- `api/settings/stripe/`, `.../quickbooks/` — per-tenant connection CRUD.
- `api/settings/users/`, `.../permissions/` — moves from user_permissions to user_organization_permissions.
- `api/settings/nav-items/` — **no change** (global bucket C).
- `api/quickbooks/sync/`, `.../callback/`, `.../webhook/` — qb_connection filtered by org. All sync log entries include org.
- `api/quickbooks/reconnect/` — updates existing connection, scoped by org.
- `api/jarvis/conversations/`, `.../alerts/` — both tables now have org column. User-scoping stays on top.
- `api/knowledge/search/` — reads knowledge_documents with `org IS NULL OR org = active_org`. For 18a, active_org comes from the AAA helper.
- `api/marketing/drafts/`, `.../assets/` — org-scoped.
- `api/cron/contract-reminders/` — runs over all orgs' contracts (service-role bypass).
- `api/cron/payment-request-reminders/` — same.
- `api/cron/email-sync/` — iterates over all email_accounts (service-role), each sync runs in that account's org context.

#### Server library helpers (likely `/src/lib/`)
- `lib/supabase/server.ts` or similar — service role client. No change.
- `lib/supabase/route-handler.ts` — request-scoped client. Add `getActiveOrgId()` helper that returns `nookleus.aaa_organization_id()` in 18a; will be swapped to read from session in 18b.
- `lib/jobs.ts` — helpers for create/update/list. All queries get `.eq('organization_id', orgId)`.
- `lib/invoicing.ts`, `lib/payments.ts`, `lib/refunds.ts` — same.
- `lib/contracts/merge-fields.ts` — resolver already reads company_settings. Update to org-scoped query.
- `lib/contracts/pdf.ts` — storage upload path changes to `{org_id}/{contact_id}/{contract_id}.pdf`.
- `lib/contracts/signing-link.ts` — JWT payload already includes contract_id; add org_id so the public route can verify without a DB call.
- `lib/stripe/client.ts` — `getStripeClient(orgId)` loads `stripe_connection` filtered by org. Returns a per-org client instance.
- `lib/stripe/checkout.ts` — always includes `metadata.organization_id` on session creation. Even in 18a with one org, this is the forward-compat change from Principle 9.
- `lib/stripe/webhook.ts` — `processEvent(event)` resolves org from `event.data.object.metadata.organization_id` with the AAA fallback.
- `lib/quickbooks/client.ts` — similar per-org pattern for QB clients.
- `lib/quickbooks/sync/customer.ts`, `.../invoice.ts`, `.../payment.ts` — all read qb_connection, qb_mappings filtered by org.
- `lib/email/imap.ts`, `lib/email/smtp.ts` — per-account config; account carries org.
- `lib/email/categorize.ts` — now reads category_rules with `org IS NULL OR org = active_org`.
- `lib/encryption.ts` — no change. Still AES-256-GCM. Now each tenant's secrets encrypted with the same master key (per-tenant keys deferred to Phase 5).
- `lib/storage/paths.ts` — NEW file. Central place for org-prefixed path construction. Every upload call site reads from here. See §7.3.
- `lib/storage/upload.ts` — refactored to use `paths.ts`.
- `lib/pdf/receipts.ts`, `.../reports.ts` — output paths use org-prefixed layout.
- `lib/number-generator.ts` if one exists at app layer — deleted; the DB trigger is the source of truth.

#### Server components / page components (likely `/src/app/...`)
- `app/page.tsx` (dashboard) — stat queries include org filter.
- `app/jobs/page.tsx`, `app/jobs/[id]/page.tsx`, `app/jobs/[id]/photos/page.tsx`, `app/jobs/[id]/reports/page.tsx`.
- `app/intake/page.tsx` — form submission endpoint already handles it; page itself doesn't query.
- `app/photos/page.tsx`, `app/photos/[id]/page.tsx`.
- `app/email/page.tsx`, `app/email/[id]/page.tsx`.
- `app/contacts/page.tsx`, `app/contacts/[id]/page.tsx`.
- `app/reports/page.tsx`.
- `app/settings/*` — every sub-page.
- `app/accounting/*` — dashboard, expenses, profitability views.
- `app/jarvis/*` — conversation UI.
- `app/sign/[token]/page.tsx` — **public page, no session**. Resolves org from the contract record.
- `app/pay/[token]/page.tsx` — same.

#### Layout / nav components
- `components/nav.tsx` (sidebar) — queries `nav_items`. **No change** (global).
- Top nav — displays company_settings.company_name. Query gets org filter.

### 4.2 Places that MUST use service-role and filter explicitly

Because the `api/sign/[token]/*` and `api/pay/[token]/*` routes run unauthenticated, they cannot rely on the user's JWT claim (there is no user). They use the service-role client, which bypasses RLS, and therefore must filter explicitly by `organization_id` on every query.

Same applies to:
- Every `/api/cron/*` route
- Every `/api/stripe/webhook` handler
- Every `/api/quickbooks/webhook` handler (if any)
- Every `/api/emails/sync` invocation
- Background receipt-PDF generation
- Contract PDF generation

**Convention to enforce via code review:** when the service-role client is used, `organization_id` must appear in the `.eq()` chain or the `WHERE` clause explicitly. Consider adding a lint rule that flags `createServiceClient()` usages that aren't followed by `.eq('organization_id', ...)` within a 15-line span. Not blocking for 18a; document as a linting followup.

### 4.3 Grep queries for the sweep pass

Run each of these against the repo; every hit is a candidate site:

```bash
# Every table name that gained org_id
grep -rn "from('\(contacts\|jobs\|job_activities\|invoices\|payments\|payment_requests\|refunds\|stripe_events\|stripe_connection\|qb_connection\|qb_mappings\|qb_sync_log\|expenses\|vendors\|email_accounts\|emails\|email_attachments\|contracts\|contract_templates\|contract_signers\|contract_events\|contract_email_settings\|invoice_email_settings\|payment_email_settings\|company_settings\|form_config\|photos\|photo_tags\|photo_tag_assignments\|photo_annotations\|photo_reports\|photo_report_templates\|damage_types\|job_statuses\|expense_categories\|category_rules\|notifications\|notification_preferences\|jarvis_conversations\|jarvis_alerts\|marketing_assets\|marketing_drafts\|knowledge_documents\|knowledge_chunks\|stripe_disputes\|job_files\|job_adjusters\|job_custom_fields\|invoice_line_items\|line_items\|email_signatures\)')" src/

# Storage path construction
grep -rn "\.from('storage')" src/
grep -rn "storage\.from(" src/
grep -rn "'photos/'\|'receipts/'\|'contracts/'\|'reports/'\|'email-attachments/'\|'job-files/'\|'marketing-assets/'\|'company-assets/'\|'knowledge-docs/'" src/

# Stripe Checkout Session creation — needs metadata.organization_id
grep -rn "checkout\.sessions\.create" src/

# Old user_permissions references
grep -rn "user_permissions" src/

# Old generate_job_number references (should disappear)
grep -rn "generate_job_number\|job_number_seq\|invoice_number_seq" src/

# Hardcoded AAA strings
grep -rn "AAA Disaster Recovery\|AAA Contracting\|aaacontracting\|AAA Platform" src/
# Each hit is either a display string sourced from company_settings (keep as fallback)
# or a hardcoded identity string (move to company_settings).
```

### 4.4 Test surface

- Unit tests for `lib/storage/paths.ts`.
- Unit tests for `lib/stripe/webhook.ts` org resolver (with and without metadata).
- Integration test for intake flow end-to-end: submit form → job created with AAA org → job_number generated with AAA's counter.
- Integration test for contract signing: send → public sign page loads contract with matching org → submit → PDF generated at org-prefixed path.
- Integration test for Stripe payment: create payment request → session includes org metadata → webhook processes and links to correct org.
- Integration test that queries one of the bucket-D tables as a member of AAA: sees NULL-org defaults plus AAA-owned rows, does not see rows owned by Test Company.

---

## 5. RLS policy SQL (written in 18a, enforced in 18b)

### 5.1 Helper function (in build42)

```sql
-- Returns the active organization from the JWT, or NULL if missing/invalid.
-- Policies must handle NULL explicitly (treat as "no access").
CREATE OR REPLACE FUNCTION nookleus.active_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(
    COALESCE(
      auth.jwt() ->> 'active_organization_id',
      (auth.jwt() -> 'app_metadata' ->> 'active_organization_id')
    ),
    ''
  )::uuid;
$$;

-- Temporary helper: returns AAA's org id. Used by 18a code sweep until
-- session context lands in 18b. DROP in 18b cleanup.
CREATE OR REPLACE FUNCTION nookleus.aaa_organization_id()
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'a0000000-0000-4000-8000-000000000001'::uuid;
$$;

-- Grant read access
GRANT USAGE ON SCHEMA nookleus TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION nookleus.active_organization_id() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION nookleus.aaa_organization_id() TO authenticated, service_role;
```

**Why COALESCE with `app_metadata`:** Supabase's access token hook writes claims under the top level of the JWT, but some tenants have `app_metadata` as the customary location. Policies should accept either. In 18b once the hook is confirmed, collapse to just the top-level read.

**Why `STABLE` not `IMMUTABLE` on `active_organization_id`:** The JWT can change between requests; `STABLE` is correct for within-a-query caching without over-promising.

### 5.2 Bucket A/B policy template

Applied to every bucket-A and bucket-B table listed in §1.2:

```sql
-- SELECT policy (separate from ALL for clarity in policy trace output)
CREATE POLICY tenant_isolation_select_{table}
ON public.{table}
FOR SELECT
TO authenticated
USING (
  organization_id IS NOT NULL
  AND organization_id = nookleus.active_organization_id()
  AND EXISTS (
    SELECT 1 FROM public.user_organizations uo
    WHERE uo.user_id = auth.uid()
      AND uo.organization_id = {table}.organization_id
  )
);

-- Mutation policy
CREATE POLICY tenant_isolation_mod_{table}
ON public.{table}
FOR INSERT, UPDATE, DELETE
TO authenticated
USING (
  organization_id IS NOT NULL
  AND organization_id = nookleus.active_organization_id()
  AND EXISTS (
    SELECT 1 FROM public.user_organizations uo
    WHERE uo.user_id = auth.uid()
      AND uo.organization_id = {table}.organization_id
  )
)
WITH CHECK (
  organization_id IS NOT NULL
  AND organization_id = nookleus.active_organization_id()
  AND EXISTS (
    SELECT 1 FROM public.user_organizations uo
    WHERE uo.user_id = auth.uid()
      AND uo.organization_id = {table}.organization_id
  )
);
```

**Note on PostgreSQL syntax:** `FOR INSERT, UPDATE, DELETE` is not valid — each operation needs its own policy. Practical pattern: one policy per operation, or use `FOR ALL` which covers SELECT too (then the separate SELECT policy becomes redundant). **Recommended:** `FOR ALL` in one policy per table. Keeps the SQL tight. Listed below as single-policy form:

```sql
CREATE POLICY tenant_isolation_{table}
ON public.{table}
FOR ALL
TO authenticated
USING (
  organization_id IS NOT NULL
  AND organization_id = nookleus.active_organization_id()
  AND EXISTS (
    SELECT 1 FROM public.user_organizations uo
    WHERE uo.user_id = auth.uid()
      AND uo.organization_id = {table}.organization_id
  )
)
WITH CHECK (
  organization_id IS NOT NULL
  AND organization_id = nookleus.active_organization_id()
  AND EXISTS (
    SELECT 1 FROM public.user_organizations uo
    WHERE uo.user_id = auth.uid()
      AND uo.organization_id = {table}.organization_id
  )
);
```

Apply this to all 44 bucket-A/B tables (all of §1.2 minus bucket C/D/E exceptions).

### 5.3 Bucket D policy template

Applied to `expense_categories`, `damage_types`, `job_statuses`, `category_rules`, `knowledge_documents`, `knowledge_chunks`:

```sql
CREATE POLICY tenant_isolation_select_{table}
ON public.{table}
FOR SELECT
TO authenticated
USING (
  organization_id IS NULL  -- Nookleus-provided default, visible to all tenants
  OR (
    organization_id = nookleus.active_organization_id()
    AND EXISTS (
      SELECT 1 FROM public.user_organizations uo
      WHERE uo.user_id = auth.uid()
        AND uo.organization_id = {table}.organization_id
    )
  )
);

CREATE POLICY tenant_isolation_mod_{table}
ON public.{table}
FOR ALL
TO authenticated
USING (
  organization_id IS NOT NULL
  AND organization_id = nookleus.active_organization_id()
  AND EXISTS (
    SELECT 1 FROM public.user_organizations uo
    WHERE uo.user_id = auth.uid()
      AND uo.organization_id = {table}.organization_id
  )
)
WITH CHECK (
  organization_id IS NOT NULL
  AND organization_id = nookleus.active_organization_id()
  AND EXISTS (
    SELECT 1 FROM public.user_organizations uo
    WHERE uo.user_id = auth.uid()
      AND uo.organization_id = {table}.organization_id
  )
);
```

Note two policies per bucket-D table: SELECT allows both NULL and scoped; ALL (mutations) only allow scoped. Product-team updates to NULL-org defaults happen via migrations or service-role-bypass code paths.

### 5.4 Bucket C — `nav_items`

No new policy needed. Existing `nav_items read` (authenticated SELECT) and `nav_items admin write` (user_profiles.role='admin' ALL) get rewritten in §5.5 to use user_organizations.role.

### 5.5 Rewrites for policies currently gating on `user_profiles.role`

Every policy that currently reads `user_profiles.role = 'admin'` needs rewriting to read `user_organizations.role = 'admin'` for any org the user belongs to (for product-level tables) or specifically the active org (for tenant tables).

**Tables affected:** `invoice_email_settings`, `jarvis_alerts`, `jarvis_conversations`, `knowledge_chunks`, `knowledge_documents`, `marketing_assets`, `marketing_drafts`, `nav_items`, `qb_connection`, `qb_mappings`, `qb_sync_log`.

Most of these (except `nav_items`, `knowledge_*`) are tenant tables and their admin-role check becomes active-org-admin-role:

```sql
-- Example for qb_connection (tenant-scoped admin requirement)
DROP POLICY IF EXISTS "qb_connection admin read" ON public.qb_connection;
DROP POLICY IF EXISTS "qb_connection admin write" ON public.qb_connection;

CREATE POLICY qb_connection_admin
ON public.qb_connection
FOR ALL
TO authenticated
USING (
  organization_id = nookleus.active_organization_id()
  AND EXISTS (
    SELECT 1 FROM public.user_organizations uo
    WHERE uo.user_id = auth.uid()
      AND uo.organization_id = qb_connection.organization_id
      AND uo.role = 'admin'
  )
)
WITH CHECK (
  organization_id = nookleus.active_organization_id()
  AND EXISTS (
    SELECT 1 FROM public.user_organizations uo
    WHERE uo.user_id = auth.uid()
      AND uo.organization_id = qb_connection.organization_id
      AND uo.role = 'admin'
  )
);
```

Product-level tables (`nav_items`, `knowledge_*`) use a simpler check:

```sql
-- Example for nav_items (product-level admin)
DROP POLICY IF EXISTS "nav_items admin write" ON public.nav_items;
CREATE POLICY nav_items_admin_write
ON public.nav_items
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_organizations uo
    WHERE uo.user_id = auth.uid()
      AND uo.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_organizations uo
    WHERE uo.user_id = auth.uid()
      AND uo.role = 'admin'
  )
);
```

**Open question worth flagging:** "admin in any org" is probably not the right long-term policy for `nav_items` (it means an admin of Test Company can edit the product-level nav). Correct long-term is a distinct `is_product_admin` flag on user_profiles. Out of scope for 18a; document as followup for phase 5 product-admin separation.

### 5.6 Policy for `user_organizations` itself

```sql
-- Users can see their own memberships.
CREATE POLICY user_orgs_self_read
ON public.user_organizations
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Service role can write memberships (admin provisioning).
-- End-user mutations blocked until invitation flow ships in 18c.
CREATE POLICY user_orgs_service_only_write
ON public.user_organizations
FOR INSERT, UPDATE, DELETE
TO service_role
USING (true)
WITH CHECK (true);
```

(Apply same pattern — `FOR ALL` single-policy form — in practice.)

### 5.7 Policy for `user_organization_permissions`

```sql
CREATE POLICY user_org_perms_self_read
ON public.user_organization_permissions
FOR SELECT
TO authenticated
USING (
  user_organization_id IN (
    SELECT id FROM public.user_organizations WHERE user_id = auth.uid()
  )
);

CREATE POLICY user_org_perms_admin_manage
ON public.user_organization_permissions
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_organizations uo_target
    JOIN public.user_organizations uo_me ON uo_me.organization_id = uo_target.organization_id
    WHERE uo_target.id = user_organization_permissions.user_organization_id
      AND uo_me.user_id = auth.uid()
      AND uo_me.role = 'admin'
      AND uo_target.organization_id = nookleus.active_organization_id()
  )
);
```

### 5.8 Policy for `organizations`

```sql
CREATE POLICY orgs_member_read
ON public.organizations
FOR SELECT
TO authenticated
USING (
  id IN (SELECT organization_id FROM public.user_organizations WHERE user_id = auth.uid())
);

CREATE POLICY orgs_service_only_write
ON public.organizations
FOR INSERT, UPDATE, DELETE
TO service_role
USING (true)
WITH CHECK (true);
```

### 5.9 RLS coverage check

After build49, every table that has `relrowsecurity = true` must have at least one authorising policy. If any table is left without a policy after build49, 18b's allow-all drop will lock it completely. The scratch-project smoke test (§8) includes a query that enumerates tables-with-rls-and-zero-non-allow-all-policies; it must return zero rows.

---

## 6. Supabase auth access-token hook

### 6.1 Purpose

On login, Supabase Auth calls a configured SQL function ("Access Token Hook") and merges its return value into the JWT's claims. We use this to set `active_organization_id` — the value every RLS policy reads via `nookleus.active_organization_id()` (§5.1).

**In 18a:** hook function is created and committed in the migration, but **not yet wired in Supabase dashboard.** Enabling the hook is part of 18b, where session-context code starts reading the claim.

**In 18b:** dashboard config change turns the hook on. Code starts writing an override to `app_metadata` when Eric switches workspace (18c). During the switcher UI gap between 18b and 18c, the hook's default behavior (pick first membership ordered by created_at) is what every login sees — equivalent to "enter your primary org."

### 6.2 Hook function SQL

```sql
-- Supabase Auth Access Token Hook
-- Returns JSON that gets merged into the JWT `claims` payload.
-- Signature is fixed by Supabase: (event jsonb) RETURNS jsonb.
-- Input event shape: {"user_id": uuid, "claims": {...existing claims}}
-- Return shape:      {"claims": {...modified claims}}
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  user_uuid uuid;
  claims jsonb;
  chosen_org uuid;
  explicit_org uuid;
BEGIN
  user_uuid := (event ->> 'user_id')::uuid;
  claims := COALESCE(event -> 'claims', '{}'::jsonb);

  -- 1) If the client has previously written a preferred org into app_metadata
  --    (18c workspace switcher), honor it — but only if the user is actually
  --    a member of that org.
  explicit_org := NULLIF(claims -> 'app_metadata' ->> 'active_organization_id', '')::uuid;

  IF explicit_org IS NOT NULL THEN
    SELECT organization_id INTO chosen_org
    FROM public.user_organizations
    WHERE user_id = user_uuid AND organization_id = explicit_org
    LIMIT 1;
  END IF;

  -- 2) Otherwise pick the oldest membership — Eric's primary/first org.
  IF chosen_org IS NULL THEN
    SELECT organization_id INTO chosen_org
    FROM public.user_organizations
    WHERE user_id = user_uuid
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  -- 3) Write the claim. If user has no memberships (unexpected), leave the
  --    claim NULL — every RLS policy treats NULL as "no access," which is
  --    the correct failure mode.
  IF chosen_org IS NOT NULL THEN
    claims := jsonb_set(claims, '{active_organization_id}', to_jsonb(chosen_org::text));
  END IF;

  event := jsonb_set(event, '{claims}', claims);
  RETURN event;
END;
$$;

-- Permission grants: Supabase calls this with the supabase_auth_admin role.
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
GRANT ALL ON TABLE public.user_organizations TO supabase_auth_admin;

-- Revoke executes from roles that shouldn't be able to call the hook directly.
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
```

### 6.3 Dashboard configuration (activation in 18b, not 18a)

Supabase Auth → Hooks → Access Token (Custom) →
- Enabled: (leave OFF in 18a)
- Function: `public.custom_access_token_hook`
- Schema: `public`

Documented here as a deliverable of 18a (the function exists in the DB) even though the dashboard switch flips in 18b.

### 6.4 Token TTL and the role-change problem

When `user_organizations.role` changes (demote/promote), the JWT doesn't know until the next refresh. Default Supabase access token TTL is 3600s. For AAA there's one user so this is a non-issue; for phase 5 multi-tenant it's a known lag but acceptable.

### 6.5 Why the `app_metadata` path is preferred for the switcher

The workspace switcher (18c) needs a way to persist "I want to be in Test Company now" across logins. Writing to `app_metadata.active_organization_id` via the admin API does that — it survives the user's refresh and is honored by the hook on next login. Writing to the live JWT directly isn't possible; writing to `user_metadata` is possible but that's user-editable and a security footgun. `app_metadata` is admin-only writable and is the right home.

---

## 7. Storage path rename plan

### 7.1 Goals

- Every object moves from `{current_path}` to `{org_id}/{current_path}`.
- Exception: `knowledge-docs` bucket — the documents are IICRC product-level standards, owned by Nookleus, not AAA. Skip the prefix. (If we later add tenant-owned knowledge docs, they'll live at `{org_id}/{filename}`.)
- Exception: `nav_items` — global product, no storage.
- Script is resumable: any failure leaves a coherent state recorded in `storage_migration_progress`.
- DB path columns updated *after* all files are verified in new locations. Strict ordering.

### 7.2 Per-bucket rename rules

| Bucket | Objects | Old path shape | New path shape |
|---|---|---|---|
| `photos` | 8 | `{contact_id}/{filename}` | `{org_id}/{contact_id}/{filename}` |
| `receipts` | 1 | `{contact_id}/{payment_req_id}.pdf` | `{org_id}/{contact_id}/{payment_req_id}.pdf` |
| `contracts` | 6 | `{contact_id}/{contract_id}[/signatures/...].pdf|.png` | `{org_id}/{contact_id}/...` |
| `reports` | 1 | `{job_number}/{report_id}.pdf` | `{org_id}/{job_number}/{report_id}.pdf` |
| `email-attachments` | 56 | `{account_id}/{email_id}/{filename}` | `{org_id}/{account_id}/{email_id}/{filename}` |
| `job-files` | 1 | `{contact_id}/{file_id}-{filename}` | `{org_id}/{contact_id}/{file_id}-{filename}` |
| `marketing-assets` | 1 | `{timestamp}-{slug}.{ext}` | `{org_id}/{timestamp}-{slug}.{ext}` |
| `company-assets` | ? | currently unused, verify | `{org_id}/...` |
| `knowledge-docs` | 5 | `S500/{file}`, `S520/{file}`, `S700/{file}` | **no rename** (product-level) |

Approximate total: 74 objects renamed, 5 skipped. ~40 MB total bytes to copy.

### 7.3 App-layer path helper (committed with 18a code sweep)

```typescript
// src/lib/storage/paths.ts
export function photoPath(orgId: string, contactId: string, filename: string) {
  return `${orgId}/${contactId}/${filename}`;
}
export function receiptPath(orgId: string, contactId: string, paymentRequestId: string) {
  return `${orgId}/${contactId}/${paymentRequestId}.pdf`;
}
// ... etc, one function per bucket×type ...
```

Every call site that previously constructed a path inline imports from here instead.

### 7.4 Rename script (Node / TypeScript, runs manually during maintenance window)

Lives at `scripts/migrate-storage-paths.ts`. Rough pseudocode:

```typescript
import { createClient } from '@supabase/supabase-js';
const supa = createClient(url, SERVICE_ROLE_KEY); // bypasses RLS
const ORG_ID = 'a0000000-0000-4000-8000-000000000001';

// Bucket-specific rename rules
const RULES: Record<string, (old: string) => string | null> = {
  photos:            (p) => `${ORG_ID}/${p}`,
  receipts:          (p) => `${ORG_ID}/${p}`,
  contracts:         (p) => `${ORG_ID}/${p}`,
  reports:           (p) => `${ORG_ID}/${p}`,
  'email-attachments': (p) => `${ORG_ID}/${p}`,
  'job-files':       (p) => `${ORG_ID}/${p}`,
  'marketing-assets':(p) => `${ORG_ID}/${p}`,
  'company-assets':  (p) => `${ORG_ID}/${p}`,
  'knowledge-docs':  () => null, // skip
};

// Phase 1: enumerate every object, seed storage_migration_progress rows as 'pending'
for (const bucket of Object.keys(RULES)) {
  const { data } = await supa.storage.from(bucket).list('', { limit: 10000, recursive: true });
  for (const obj of data) {
    const newPath = RULES[bucket](obj.name);
    if (newPath === null) continue;
    await supa.from('storage_migration_progress').upsert({
      bucket_id: bucket, old_path: obj.name, new_path: newPath, status: 'pending'
    }, { onConflict: 'bucket_id,old_path' });
  }
}

// Phase 2: COPY every pending to new path; mark 'copied'
const pending = await supa.from('storage_migration_progress').select('*').eq('status', 'pending');
for (const row of pending.data) {
  try {
    await supa.storage.from(row.bucket_id).copy(row.old_path, row.new_path);
    await supa.from('storage_migration_progress').update({
      status: 'copied', attempted_at: new Date().toISOString()
    }).eq('id', row.id);
  } catch (err) {
    await supa.from('storage_migration_progress').update({
      status: 'failed', error_message: err.message, attempted_at: new Date().toISOString()
    }).eq('id', row.id);
  }
}

// Phase 3: VERIFY every copied row — new path must exist in storage
const copied = await supa.from('storage_migration_progress').select('*').eq('status', 'copied');
for (const row of copied.data) {
  const { data } = await supa.storage.from(row.bucket_id).list(
    row.new_path.substring(0, row.new_path.lastIndexOf('/')) || '',
    { search: row.new_path.substring(row.new_path.lastIndexOf('/') + 1) }
  );
  const found = data?.some(o => o.name === row.new_path.substring(row.new_path.lastIndexOf('/') + 1));
  if (found) {
    await supa.from('storage_migration_progress').update({ status: 'verified' }).eq('id', row.id);
  } else {
    await supa.from('storage_migration_progress').update({
      status: 'failed', error_message: 'post-copy verification failed'
    }).eq('id', row.id);
  }
}

// HALT if any 'failed'. Manual investigation. Script exits non-zero.
const failures = await supa.from('storage_migration_progress').select('count').eq('status', 'failed');
if (failures.data[0].count > 0) {
  console.error('Storage copy verification failures. Halting. See storage_migration_progress.');
  process.exit(1);
}

// Phase 4: UPDATE DB path columns. Inside a single SQL transaction so this is atomic.
await supa.rpc('storage_paths_swap_to_new'); // DB function defined below

// Phase 5: DELETE originals. Mark 'deleted'. Safe because DB already points to new paths.
const verified = await supa.from('storage_migration_progress').select('*').eq('status', 'db_updated');
for (const row of verified.data) {
  await supa.storage.from(row.bucket_id).remove([row.old_path]);
  await supa.from('storage_migration_progress').update({
    status: 'deleted', completed_at: new Date().toISOString()
  }).eq('id', row.id);
}
```

### 7.5 DB path swap

The DB-side column updates are a SQL function that runs atomically once storage copies are verified. This is the critical "point of no return" for the rename.

```sql
CREATE OR REPLACE FUNCTION public.storage_paths_swap_to_new()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  aaa_id uuid := 'a0000000-0000-4000-8000-000000000001';
BEGIN
  -- photos.storage_path, annotated_path, thumbnail_path
  UPDATE public.photos
    SET storage_path = aaa_id::text || '/' || storage_path
    WHERE storage_path IS NOT NULL AND storage_path NOT LIKE (aaa_id::text || '/%');
  UPDATE public.photos
    SET annotated_path = aaa_id::text || '/' || annotated_path
    WHERE annotated_path IS NOT NULL AND annotated_path NOT LIKE (aaa_id::text || '/%');
  UPDATE public.photos
    SET thumbnail_path = aaa_id::text || '/' || thumbnail_path
    WHERE thumbnail_path IS NOT NULL AND thumbnail_path NOT LIKE (aaa_id::text || '/%');

  -- email_attachments.storage_path
  UPDATE public.email_attachments
    SET storage_path = aaa_id::text || '/' || storage_path
    WHERE storage_path IS NOT NULL AND storage_path NOT LIKE (aaa_id::text || '/%');

  -- contracts.signed_pdf_path
  UPDATE public.contracts
    SET signed_pdf_path = aaa_id::text || '/' || signed_pdf_path
    WHERE signed_pdf_path IS NOT NULL AND signed_pdf_path NOT LIKE (aaa_id::text || '/%');

  -- contract_signers.signature_image_path
  UPDATE public.contract_signers
    SET signature_image_path = aaa_id::text || '/' || signature_image_path
    WHERE signature_image_path IS NOT NULL AND signature_image_path NOT LIKE (aaa_id::text || '/%');

  -- photo_reports.pdf_path
  UPDATE public.photo_reports
    SET pdf_path = aaa_id::text || '/' || pdf_path
    WHERE pdf_path IS NOT NULL AND pdf_path NOT LIKE (aaa_id::text || '/%');

  -- payment_requests.receipt_pdf_path
  UPDATE public.payment_requests
    SET receipt_pdf_path = aaa_id::text || '/' || receipt_pdf_path
    WHERE receipt_pdf_path IS NOT NULL AND receipt_pdf_path NOT LIKE (aaa_id::text || '/%');

  -- expenses.receipt_path, thumbnail_path (all 0 rows currently)
  UPDATE public.expenses
    SET receipt_path = aaa_id::text || '/' || receipt_path
    WHERE receipt_path IS NOT NULL AND receipt_path NOT LIKE (aaa_id::text || '/%');
  UPDATE public.expenses
    SET thumbnail_path = aaa_id::text || '/' || thumbnail_path
    WHERE thumbnail_path IS NOT NULL AND thumbnail_path NOT LIKE (aaa_id::text || '/%');

  -- marketing_assets.storage_path
  UPDATE public.marketing_assets
    SET storage_path = aaa_id::text || '/' || storage_path
    WHERE storage_path IS NOT NULL AND storage_path NOT LIKE (aaa_id::text || '/%');

  -- job_files.storage_path
  UPDATE public.job_files
    SET storage_path = aaa_id::text || '/' || storage_path
    WHERE storage_path IS NOT NULL AND storage_path NOT LIKE (aaa_id::text || '/%');

  -- user_profiles.profile_photo_path (if present in storage)
  UPDATE public.user_profiles
    SET profile_photo_path = aaa_id::text || '/' || profile_photo_path
    WHERE profile_photo_path IS NOT NULL AND profile_photo_path NOT LIKE (aaa_id::text || '/%');

  -- company_settings logo_path (value field, lookup by key)
  UPDATE public.company_settings
    SET value = aaa_id::text || '/' || value
    WHERE key IN ('logo_path','signature_logo_path')
      AND value IS NOT NULL AND value NOT LIKE (aaa_id::text || '/%');

  -- Mark all verified rows as db_updated
  UPDATE public.storage_migration_progress SET status = 'db_updated' WHERE status = 'verified';
END;
$$;
```

**Idempotency:** The `NOT LIKE (aaa_id::text || '/%')` guard means re-running the function is a no-op.

### 7.6 Rollback posture

The rename can fail at five points:

1. **During enumeration (Phase 1):** Nothing changed, no cleanup needed. Re-run from top.
2. **During copy (Phase 2):** Some files at new paths, originals still present, DB unchanged. Everything still works via original paths because DB points to them. Resume by querying `storage_migration_progress WHERE status = 'pending'`.
3. **During verification (Phase 3):** Same posture — originals still present, DB unchanged. Investigate `failed` rows manually. Common cause: copy silently no-op'd (already existed). Verify, mark `verified`, continue.
4. **During DB swap (Phase 4):** Atomic — either every path column updated or none. If this fails (network issue between copy verify and DB swap), storage is in the weird state of having both originals and copies, but DB still points to originals. Revert is a no-op; just re-run the swap.
5. **During delete (Phase 5):** Originals partially deleted, DB points to new paths. Safe because DB already updated. Resume from `status = 'db_updated'`.

**True point of no return:** Phase 4. Everything before is safe to discard the progress table and retry. Phase 5 is a cleanup that can always be finished later — even if interrupted, everything still works.

**Emergency rollback after Phase 4 but before code sweep ships:** Reverse the SQL function:

```sql
CREATE OR REPLACE FUNCTION public.storage_paths_swap_to_old()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE aaa_id uuid := 'a0000000-0000-4000-8000-000000000001';
BEGIN
  UPDATE public.photos
    SET storage_path = substring(storage_path from length(aaa_id::text) + 2)
    WHERE storage_path LIKE (aaa_id::text || '/%');
  -- ... repeat for every column ...
END; $$;
```

Combined with: don't delete originals in Phase 5 until code sweep is verified on preview. Keep the old files for ≥24 hours after the rename completes. Storage cost is negligible given the data volume.

### 7.7 When to run the rename

Right after build50 applies. Before any code-sweep PR that uses the new path helpers ships. Sequence in maintenance window:

1. Apply build42–build50 (<10s).
2. Run `scripts/migrate-storage-paths.ts`. Should complete in 2–5 minutes given 74 objects.
3. Deploy code-sweep PR (Vercel).
4. Smoke test per §8.

---

## 8. Pre-launch checklist

Pattern matches the Build 17c checklist — checkboxes, explicit verification steps, no hand-waving.

### 8.1 Before the maintenance window

- [ ] All nine migration SQL files drafted and code-reviewed (paired with a human or self-review the morning of).
- [ ] Storage rename script (`scripts/migrate-storage-paths.ts`) drafted and unit-tested against a local Supabase in-memory emulator if available, or dry-run mode.
- [ ] Code-sweep PR drafted against a feature branch. Passes `npm run build`. Does not yet use `nookleus.active_organization_id()` — uses `nookleus.aaa_organization_id()` everywhere (temporary).
- [ ] Code-sweep PR is split into commits per module group (see §4.1) so individual sections can be reverted if needed.
- [ ] Storage path helper (`src/lib/storage/paths.ts`) lives in the code-sweep PR and every upload call site routes through it.
- [ ] `.env.local` confirmed to have `SUPABASE_SERVICE_ROLE_KEY` for the rename script.
- [ ] Scratch Supabase project provisioned (free tier, same region). Named clearly, e.g. `nookleus-18a-scratch-20260421`.
- [ ] PITR enabled on production. Verify in Supabase dashboard → Database → Backups. Note the oldest recoverable timestamp.
- [ ] Explicit `pg_dump` of production run within the last 2 hours. Stored locally on Eric's machine AND in an off-machine location (Dropbox, iCloud, whatever).
  ```bash
  pg_dump "postgresql://postgres:$PROD_PW@db.rzzprgidqbnqcdupmpfe.supabase.co:5432/postgres?sslmode=require" \
    --no-owner --no-acl --format=custom \
    --file=build42-pre-migration-$(date +%F).dump
  ```
- [ ] **Scratch-project restore verification:** restore the pg_dump to the scratch project. Open the scratch project in Supabase dashboard. Confirm row counts match production for `jobs`, `emails`, `contacts`, `payments`, `contracts`. This proves the dump is not corrupt.
- [ ] **Apply all nine migrations to the scratch project in sequence.** Watch for any error. Every migration succeeds independently.
- [ ] Run the storage rename script against the scratch project (it has no storage objects, so this is a no-op — but confirms the script doesn't crash on empty buckets).
- [ ] Execute the smoke tests (§8.3) against the scratch project with the code-sweep branch pointed at it. Every smoke test passes.
- [ ] **Drop the scratch project** to avoid accruing free-tier quota.
- [ ] Maintenance window scheduled — 10:00 PM – 10:30 PM local, weekday night. Calendar block created.
- [ ] Deploy log document created: `docs/deploys/2026-MM-DD-build-18a-deploy.md`. Template includes pre-start timestamp, per-migration apply timestamp, rename script completion timestamp, smoke test pass/fail status, post-window timestamp.
- [ ] Contingency: Vercel preview branch exists with the code-sweep applied. If the production sweep breaks something unexpected, revert Vercel to the pre-sweep deploy while DB stays forward.
- [ ] No other deploys queued. GitHub PRs frozen 24h before window.

### 8.2 During the maintenance window

- [ ] T+0: Write start timestamp to deploy log.
- [ ] T+0: Post a banner via the admin UI (or notify Eric himself, since he's the only user) that the platform is in maintenance.
- [ ] T+1m: Apply `build42_create_organizations_and_memberships`. Confirm the two organization rows and Eric's `user_organizations` row are present. `SELECT * FROM public.organizations; SELECT * FROM public.user_organizations;`.
- [ ] T+2m: Apply `build43_add_nullable_organization_id_columns`. Spot-check a few tables have the column: `\d public.jobs`, `\d public.emails`, `\d public.company_settings`.
- [ ] T+3m: Apply `build44_backfill_organization_id`. Verify: `SELECT count(*) FROM public.jobs WHERE organization_id IS NULL;` returns 0. Repeat for `emails`, `contracts`, `photos`, `payments`.
- [ ] T+4m: Apply `build45_organization_id_not_null_and_fks`. Confirm constraints: `\d+ public.jobs` shows `NOT NULL` and FK.
- [ ] T+5m: Apply `build46_rework_unique_indexes`. Spot-check: `\d public.jobs` shows `UNIQUE(organization_id, job_number)`.
- [ ] T+6m: Apply `build47_per_org_number_generator`. Test: `SELECT public.next_job_number('a0000000-0000-4000-8000-000000000001', 'water');` should return `WTR-2026-0014` (next after the 13 existing). **Roll back the test by decrementing the counter manually** (`UPDATE org_number_counters SET next_value = 14 WHERE document_kind = 'job';`) so the next real job insert still gets `-0014`.
- [ ] T+7m: Apply `build48_migrate_user_permissions_and_preferences`. Confirm: `SELECT count(*) FROM public.user_organization_permissions;` returns 18 (matches old `user_permissions` count). `SELECT count(*) FROM public.notification_preferences WHERE user_organization_id IS NULL;` returns 0.
- [ ] T+8m: Apply `build49_rls_policies_written_not_enforced`. Confirm: `SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'tenant_isolation_%';` returns at least 44.
- [ ] T+9m: Apply `build50_storage_migration_tracking`.
- [ ] T+10m: **Run storage rename script.** Expect 2–5 minutes. Watch for any `failed` rows: `SELECT status, count(*) FROM storage_migration_progress GROUP BY status;`. Must end with all rows at `deleted` (or `db_updated` if Phase 5 intentionally deferred).
- [ ] T+15m: Deploy code-sweep PR via Vercel. Wait for deploy to complete (<90s).
- [ ] T+17m: Run smoke test suite (§8.3).
- [ ] T+25m: If all smoke tests pass, write end timestamp to deploy log. Clear maintenance banner.
- [ ] T+30m: Done. Window closes.
- [ ] **If any smoke test fails:** write failure to deploy log, execute rollback (§8.4), notify yourself, go to bed, review fresh tomorrow.

### 8.3 Smoke tests (run after deploy, all must pass)

- [ ] **Login works.** Open /login, sign in as Eric. JWT arrives (no 401). Dashboard loads.
- [ ] **Dashboard renders.** Stat cards show correct counts (5 jobs, etc.).
- [ ] **Jobs list loads.** All 5 existing AAA jobs visible. Click one.
- [ ] **Job detail loads.** Billing, photos, emails, contracts tabs render. No "undefined" or error pills.
- [ ] **Photos load from new storage paths.** Open one of the 8 existing photos in the detail view — image renders (not a broken-image icon).
- [ ] **Intake form submits.** Fill out a test job: "Build 18a smoke test", damage=water, random address. Submit. New job created. `job_number` is `WTR-2026-0014`. Open the job. Delete it afterwards.
- [ ] **Invoice number generator works.** Create a draft invoice on a job. Number is `INV-2026-0002`. Delete the draft.
- [ ] **Settings → Company loads.** All 10 `company_settings` rows render. Edit one, save, reload. Change persists.
- [ ] **Settings → Users shows Eric.** Role reads `admin` (from `user_organizations` now).
- [ ] **Email inbox loads.** Existing 608 emails display. Open one. Attachment downloads (verify one with attachments exists).
- [ ] **Contract detail loads.** Open any of the 15 existing contracts. Signed PDF loads at its new org-prefixed path.
- [ ] **Payment Request works.** No need to create a real one; verify list view loads existing 3 without errors.
- [ ] **QuickBooks settings page loads.** Connection shows active, realm ID correct.
- [ ] **Stripe settings page loads.** Connection shows active, mode=test.
- [ ] **Nothing in `storage_migration_progress` at status=failed.**
- [ ] **Vercel logs show no 500s in the past 5 minutes.** Spot-check via Vercel dashboard.
- [ ] **Supabase logs show no RLS policy violations.** Spot-check "Logs Explorer" → Postgres logs. None of the new `tenant_isolation_*` policies should have fired (18a is non-enforcing).
- [ ] **Coverage check for RLS.** Run: `SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=true AND tablename NOT IN (SELECT tablename FROM pg_policies WHERE schemaname='public');`. Must return zero rows — every RLS-enabled table has at least one policy.

### 8.4 Rollback posture

If T+17m smoke tests fail unrecoverably:

**Option A (DB-only revert, fast):** Apply the reverse SQL for build42–build50 in reverse order. Total time <10s. Storage: run `storage_paths_swap_to_old()` + re-upload deleted originals if Phase 5 completed. If Phase 5 didn't complete (recommended to defer it by 24h), originals are still in place and no storage action is needed.

**Option B (full restore from pg_dump):** Nuclear. Do this if the DB reverse SQL surfaces any unexpected dependency issue. Drop the public schema on production, restore the pg_dump. Then re-upload missing storage files. Downtime: 15–30 minutes.

**Option C (Vercel-only revert, if DB state is fine but app is broken):** Vercel dashboard → redeploy pre-sweep commit. DB stays forward-migrated; the old app happens to work because the new columns are nullable or have defaults that the old code ignores. Tested against: `organization_id` in SELECTs is just extra noise to old code, triggers are rewired but their interface didn't change (invoice/job numbers still generate correctly). **This is the fastest recovery and probably the right first-choice.**

**Prefer Option C** if smoke tests fail. It takes 90 seconds, doesn't touch the DB, and buys time to diagnose on preview without a live-site outage.

### 8.5 Post-window

- [ ] Deploy log finalized, committed to `docs/deploys/`.
- [ ] Create followup issues for known debt:
  - Drop `user_permissions` table (after 2+ weeks of no code hits).
  - Drop `job_number_seq` and `invoice_number_seq` sequences (after confirming no code references).
  - Drop `nookleus.aaa_organization_id()` function (replaced in 18b by session context).
  - Drop `storage_migration_progress` table (after rename fully complete).
  - File the product-admin flag question (see §5.5 open question).
- [ ] Update user memory / project context: single-tenant with AAA row is now the data layout; organizations table exists.
- [ ] Update Build Guide to version 1.8 with Build 18a as complete, Builds 18b–18d staged with dependencies documented.

---

## 9. Open items escalated from this plan session

Items where I made a call but flagged them for Eric's explicit confirmation before Claude Code starts:

1. **RLS strategy revision (§0.1).** Briefing's Option A is not usable. I chose Option A': add tenant-isolation PERMISSIVE policies alongside allow-alls; 18b drops the allow-alls. Confirm this is acceptable vs. alternatives (convert allow-alls to RESTRICTIVE with `true` quals? Use a feature-flag function that returns true until a flag is flipped?).
2. **Bucket D vs bucket A for `damage_types`, `job_statuses`, `expense_categories`, `category_rules`, `knowledge_documents`.** I classified these as D (global defaults + per-tenant extensions with NULL-org). Alternative is A (every tenant gets their own seeded copy). D keeps maintenance simpler when the product ships new defaults; A gives tenants more freedom. Phase 5 behaviour is a design decision, not a technical one — confirm lean.
3. **`nav_items` as global (bucket C).** Flagged in §1.4. Confirm this is right long-term.
4. **Dropping `user_permissions` in a follow-up, not in build48.** Rationale: safer. Confirm or collapse into build48 if you prefer one fewer migration.
5. **Hardcoded organization UUIDs in the migration file.** Chosen values: AAA `a0000000-0000-4000-8000-000000000001`, Test Company `a0000000-0000-4000-8000-000000000002`. Confirm or propose alternate.
6. **Product-admin separation deferred to phase 5.** Currently "admin in any org" can edit `nav_items` per the new policy. Acceptable transient state?
7. **AAA-helper function `nookleus.aaa_organization_id()` lives through 18a and is dropped in 18b.** During 18a, server code imports from it. Code sweep is therefore two commits: 18a uses the helper, 18b replaces helper calls with session reads. Confirm this split.
8. **Maintenance window time.** Recommended 10 PM local, not 11 PM — gives 30-min smoke-test budget before bed. Confirm.
9. **Phase 5 knowledge-docs story.** Current plan leaves IICRC docs as global (bucket D, NULL org). If a tenant later wants to upload their own SOPs, the same table supports it (org_id becomes non-NULL). Is that sufficient, or do we want a separate `tenant_knowledge_documents` table later? Decision for 18c+.

---

*End of Build 18a plan draft. Ready for Eric review. When locked, next step is the Claude Code prompt to execute build42–build50 in sequence plus the code sweep PR. That prompt is NOT in this document by design.*
