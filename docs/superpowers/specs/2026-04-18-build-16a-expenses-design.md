# Build 16a — Expenses, Vendors, and Receipt Capture — Design

**Date:** 2026-04-18
**Status:** Approved, pending implementation plan
**Source spec:** AAA Platform Build Guide v1.5 Section 5 (Build 16a) + Section 4 (schema additions). v1.5 is not in the repo; the authoritative text is the spec embedded in the implementation prompt on 2026-04-18. v1.6 Section 7 (SaaS Readiness Principles) applies.

## Overview

Add job-linked expense tracking to the platform. Techs log receipts from jobsites (phone camera primary); admins curate vendors and expense categories via Settings. Expenses are **platform-only**: no QuickBooks sync, no accounting dashboard, no profitability math. Those arrive in 16b–16d.

This build adds three tables (`vendors`, `expense_categories`, `expenses`), two Settings pages, one private storage bucket, three permission keys, and one new section on the job detail Overview tab. It reuses the Build 14c damage-types pattern for categories and the Build 15b `ContractsSection` pattern for the job-detail section.

## Scope

**In scope**
- `vendors`, `expense_categories`, `expenses` tables + RLS + seeds
- `receipts` private storage bucket
- `/settings/vendors` and `/settings/expense-categories` pages + APIs
- Sidebar nav additions
- `log_expenses`, `manage_vendors`, `manage_expense_categories` permission keys
- Expenses section on job Overview tab (between Contracts and Reports)
- Log Expense modal (mobile-first, camera-capture primary)
- Receipt detail modal (view / edit / delete)
- Activity log integration (`expense` activity type)

**Out of scope (deferred to later sub-builds)**
- Any `/accounting` route, accounting dashboard, job profitability, margin, AR aging — 16b
- QuickBooks OAuth, customer sync, invoice/payment sync — 16c, 16d
- Any `qb_*` column, QB-related code, or sync infrastructure

## Resolved decisions

These were ambiguous on first read; the design commits to one answer for each. Any that turn out wrong can be redirected before implementation.

1. **v1.5 file unavailable** — work from the prompt spec as authoritative.
2. **Migration path** — the repo's actual convention is flat `supabase/migration-build<NN>-<name>.sql`. Next sequential is build35. File: `supabase/migration-build35-expenses.sql`.
3. **"After Tags section"** — the sidebar is a flat array with no grouping; place Vendors + Expense Categories immediately after Damage Types (the tag-like nav entries).
4. **Icon collision** — Company Profile already uses `Building2`. Vendors will use `Store` to stay distinct. Expense Categories uses `Receipt` (spec-compliant; no collision).
5. **Modal vs. drawer** — one responsive component: full-viewport sheet on `< md`, centered modal on `>= md`. Implemented using the existing `Dialog` primitive with a conditional class for mobile full-screen, matching existing modal styling.
6. **Fuel filter tab** — keep the filter list exactly as specified (All / Subcontractors / Suppliers / Equipment Rental / Other / 1099 Vendors). Fuel vendors roll into **Other**. Worth revisiting once fuel vendor volume is high enough to warrant its own filter.
7. **Receipt extension** — normalize all uploads to JPEG client-side before upload so the `receipts/{job_id}/{uuid}.jpg` path is always accurate. HEIC inputs (iPhone camera default) decode via the browser's native `<img>` → canvas pipeline.
8. **Expenses section placement** — immediately after Contracts on Overview (so current order becomes Files → Contracts → **Expenses** → Reports → Emails).
9. **Original image size cap** — downscale originals to max 2048px on the long edge, encode JPEG quality 0.85 before upload. Keeps Supabase Storage cheap and Safari-friendly for HEIC.
10. **`vendor_name` snapshot column** — yes. `expenses.vendor_id` FK with `ON DELETE SET NULL`, plus a `NOT NULL` `vendor_name` text column snapshotted at insert. Deactivated or deleted vendors still render a human name.
11. **`submitted_by`** — FK `user_profiles(id)` plus a `submitter_name` snapshot column for display without a join, matching the `job_activities.author` pattern.

## Data Model

### New table: `vendors`

| Column              | Type         | Notes                                                                 |
|---------------------|--------------|-----------------------------------------------------------------------|
| `id`                | uuid         | PK, default `gen_random_uuid()`                                       |
| `name`              | text         | NOT NULL. No uniqueness constraint — two locations of the same vendor are OK |
| `vendor_type`       | text         | NOT NULL. CHECK in `('supplier', 'subcontractor', 'equipment_rental', 'fuel', 'other')` |
| `default_category_id` | uuid       | nullable FK → `expense_categories(id)` `ON DELETE SET NULL`           |
| `is_1099`           | boolean      | NOT NULL, default false                                               |
| `tax_id`            | text         | nullable                                                              |
| `notes`             | text         | nullable                                                              |
| `is_active`         | boolean      | NOT NULL, default true. Deactivated vendors hidden from expense autocomplete but preserved for historical expenses |
| `last_used_at`      | timestamptz  | nullable. Updated by trigger whenever a new `expenses` row references this vendor |
| `created_at`        | timestamptz  | default `now()`                                                       |
| `updated_at`        | timestamptz  | default `now()`, maintained by `update_updated_at` trigger            |

Indexes: `(is_active, name)` for the autocomplete; `(vendor_type)` for filter tabs; `(is_1099)` for the 1099 filter.

### New table: `expense_categories`

Schema mirrors `damage_types` so the /settings/expense-categories page can copy the 14c UX directly.

| Column          | Type         | Notes                                                         |
|-----------------|--------------|---------------------------------------------------------------|
| `id`            | uuid         | PK, default `gen_random_uuid()`                               |
| `name`          | text         | UNIQUE NOT NULL, snake_case (e.g. `materials`, `sub_labor`)   |
| `display_label` | text         | NOT NULL (e.g. "Materials")                                   |
| `bg_color`      | text         | NOT NULL, default `#F1EFE8`                                   |
| `text_color`    | text         | NOT NULL, default `#5F5E5A`                                   |
| `icon`          | text         | nullable Lucide icon name                                     |
| `sort_order`    | integer      | NOT NULL, default 0                                           |
| `is_default`    | boolean      | NOT NULL, default false. Defaults can be renamed/recolored but not deleted |
| `created_at`    | timestamptz  | default `now()`                                               |
| `updated_at`    | timestamptz  | default `now()`                                               |

Index: `(sort_order)`.

### New table: `expenses`

| Column               | Type          | Notes                                                                |
|----------------------|---------------|----------------------------------------------------------------------|
| `id`                 | uuid          | PK, default `gen_random_uuid()`                                       |
| `job_id`             | uuid          | NOT NULL FK → `jobs(id)` `ON DELETE CASCADE`                          |
| `vendor_id`          | uuid          | nullable FK → `vendors(id)` `ON DELETE SET NULL`                      |
| `vendor_name`        | text          | NOT NULL. Snapshot of vendor name at insert time                     |
| `category_id`        | uuid          | NOT NULL FK → `expense_categories(id)` `ON DELETE RESTRICT` (prevent accidental deletion of in-use categories) |
| `amount`             | numeric(12,2) | NOT NULL CHECK (`amount >= 0`)                                        |
| `expense_date`       | date          | NOT NULL                                                              |
| `payment_method`     | text          | NOT NULL. CHECK in `('business_card', 'business_ach', 'cash', 'personal_reimburse', 'other')` |
| `description`        | text          | nullable                                                              |
| `receipt_path`       | text          | nullable. `receipts/{job_id}/{uuid}.jpg`                              |
| `thumbnail_path`     | text          | nullable. `receipts/{job_id}/{uuid}.thumb.jpg`                        |
| `submitted_by`       | uuid          | nullable FK → `user_profiles(id)` `ON DELETE SET NULL`                |
| `submitter_name`     | text          | NOT NULL. Snapshot of submitter `full_name` at insert time            |
| `activity_id`        | uuid          | nullable FK → `job_activities(id)` `ON DELETE SET NULL`. Set after the companion activity row is created so delete can cascade/clean it up |
| `created_at`         | timestamptz   | default `now()`                                                       |
| `updated_at`         | timestamptz   | default `now()`                                                       |

Indexes: `(job_id, expense_date desc)` for the per-job list; `(category_id)` for filter pills; `(vendor_id)` for vendor-usage queries; `(submitted_by, created_at desc)` for future per-user reporting.

### Existing-table changes

- `job_activities.activity_type` CHECK constraint: drop and recreate with `'expense'` added to the allowed list.

### Expense-category seed data

Exact labels, colors, and `sort_order` as specified. All seeded with `is_default = true`. Icons are Lucide names rendered at the same sizes as damage-type icons.

| `name`              | `display_label`     | `bg_color` | `text_color` | `icon`      | `sort_order` |
|---------------------|---------------------|------------|--------------|-------------|--------------|
| materials           | Materials           | `#E6F1FB`  | `#0C447C`    | `Hammer`    | 1            |
| sub_labor           | Subcontractor Labor | `#EEEDFE`  | `#3C3489`    | `Users`     | 2            |
| equipment_rental    | Equipment Rental    | `#FAEEDA`  | `#633806`    | `Wrench`    | 3            |
| fuel_mileage        | Fuel/Mileage        | `#FAECE7`  | `#712B13`    | `Fuel`      | 4            |
| permits             | Permits             | `#F1EFE8`  | `#5F5E5A`    | `FileText`  | 5            |
| disposal_dumpster   | Disposal/Dumpster   | `#EAF3DE`  | `#27500A`    | `Trash2`    | 6            |
| lodging             | Lodging             | `#FBEAF0`  | `#72243E`    | `Bed`       | 7            |
| meals               | Meals               | `#FBEAF0`  | `#72243E`    | `Utensils`  | 8            |
| other               | Other               | `#F1EFE8`  | `#5F5E5A`    | `null`      | 9            |

### RLS

Matches the platform-wide pattern (auth done at the API layer, DB open to service-role + authenticated):

```sql
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated users" ON vendors FOR ALL USING (true) WITH CHECK (true);
-- ditto for expense_categories, expenses
```

### Triggers

- `trg_vendors_updated_at`, `trg_expense_categories_updated_at`, `trg_expenses_updated_at` — all use existing `update_updated_at()` function.
- `trg_expenses_bump_vendor_last_used` — AFTER INSERT ON `expenses` — updates `vendors.last_used_at = new.created_at` when `new.vendor_id IS NOT NULL`.

## Storage

### New bucket: `receipts`

- Private (`public = false`), same pattern as `contracts` bucket.
- Paths: `receipts/{job_id}/{uuid}.jpg` for originals, `receipts/{job_id}/{uuid}.thumb.jpg` for 200px-wide thumbnails.
- Policies: authenticated read / insert / update (mirrors the three policies in `migration-build33-contracts.sql`).
- **SaaS-readiness note (v1.6 Principle 4):** these paths migrate cleanly to `receipts/{org_id}/{job_id}/...` in Phase 5.

Reads from the UI go through `supabase.storage.from('receipts').createSignedUrl(path, 600)` via an API route — URLs are never embedded in SSR HTML.

## Permissions (Build 14d extension)

Add three permission keys. Update `set_default_permissions(p_user_id, p_role)` in `migration-build35-expenses.sql` to include them in `all_perms` and to grant each role correctly.

| Key                           | admin | crew_lead | crew_member |
|-------------------------------|-------|-----------|-------------|
| `log_expenses`                | yes   | yes       | yes         |
| `manage_vendors`              | yes   | no        | no          |
| `manage_expense_categories`   | yes   | no        | no          |

One-time backfill for existing users in the migration: for each existing `user_profiles` row, `INSERT ... ON CONFLICT DO UPDATE` each of the three keys using the role defaults above. This keeps `useAuth().hasPermission(...)` checks truthful immediately after the migration runs.

### Enforcement

- **Client:** the sidebar entries hide when `!hasPermission('manage_vendors')` / `!hasPermission('manage_expense_categories')`. The "+ Log Expense" button hides when `!hasPermission('log_expenses')`.
- **Server:** every API route under `/api/settings/vendors`, `/api/settings/expense-categories`, and `/api/expenses` reads the session user and checks the matching permission before writing. Route-level checks are the source of truth — client hiding is UX only.

## Settings navigation (update)

Edit [src/lib/settings-nav.ts](src/lib/settings-nav.ts). Insert two entries immediately after the Damage Types row:

```ts
{ href: "/settings/vendors",              label: "Vendors",            icon: Store },
{ href: "/settings/expense-categories",   label: "Expense Categories", icon: Receipt },
```

Both icons are Lucide. `Store` is used instead of the spec's `Building2` to avoid collision with Company Profile.

## Vendor management page (`/settings/vendors`)

Mirrors [src/app/settings/damage-types/page.tsx](src/app/settings/damage-types/page.tsx) structurally.

### Header

- Title "Vendors" + subtitle "Manage suppliers, subcontractors, and equipment rentals."
- Filter tabs (left-aligned, chip style): **All · Subcontractors · Suppliers · Equipment Rental · Other · 1099 Vendors**. Active tab uses the existing info-blue pill style. Selection is local state (no URL change).
- "+ Add Vendor" button (primary teal gradient, matches damage-types "Add Type" button).

### Table

| Column            | Source                                                                  |
|-------------------|-------------------------------------------------------------------------|
| Name              | `vendors.name`                                                          |
| Type              | `vendors.vendor_type` rendered as pill with per-type color (see below)   |
| Default category  | `expense_categories.display_label` rendered using category's own bg/text colors. Empty-state dash if null |
| 1099              | Lucide `FileBadge` icon if `is_1099 = true`, otherwise empty            |
| Last used         | `vendors.last_used_at`, formatted `MMM d, yyyy`, or "—" if null         |
| Active            | Toggle switch bound to `is_active`                                      |
| Row actions (⋯)   | Edit · Deactivate (hard delete disallowed)                              |

Vendor-type pill colors (chosen to complement the seed category palette):

- `supplier` → bg `#E6F1FB`, text `#0C447C`
- `subcontractor` → bg `#EEEDFE`, text `#3C3489`
- `equipment_rental` → bg `#FAEEDA`, text `#633806`
- `fuel` → bg `#FAECE7`, text `#712B13`
- `other` → bg `#F1EFE8`, text `#5F5E5A`

### Add / Edit modal

Single modal, reused for both. Fields in order:

1. **Name** — text input, required
2. **Type** — pill selector (five options above), required
3. **Default category** — dropdown populated from `expense_categories` (active + inactive both shown; sorted by `sort_order`), nullable
4. **Tax ID** — text input, nullable
5. **Requires 1099-NEC** — toggle, sets `is_1099`
6. **Notes** — textarea, nullable
7. Save / Cancel

On Save: POST (create) or PATCH (edit). Server revalidates the type against the CHECK list before writing.

## Expense category management page (`/settings/expense-categories`)

A near-verbatim fork of [src/app/settings/damage-types/page.tsx](src/app/settings/damage-types/page.tsx):

- Reorder (up/down) via sort-order writes
- Add custom (non-default) category: label + colors + optional icon
- Rename / recolor any category, including defaults
- Delete custom categories only; defaults locked (enforced server-side by checking `is_default`)
- Refuse delete if any `expenses` row references the category (409 response, toast)

API route layout: `src/app/api/settings/expense-categories/route.ts` with `GET`, `POST`, `PUT` (bulk sort update), `DELETE`. Fork of `src/app/api/settings/damage-types/route.ts` — same shape.

## Expenses section (job Overview tab)

New component: `src/components/expenses/expenses-section.tsx`. Mounted in [src/components/job-detail.tsx](src/components/job-detail.tsx) between `<ContractsSection>` and the Reports block.

### Card chrome

Matches the dark-theme card style already used on Overview: `bg-card` (which resolves to `rgba(255,255,255,0.03)`), `border border-border` (≈ 0.5px solid `rgba(255,255,255,0.08)`), `rounded-xl`, `p-5`, `mb-6`. Consistent with `<JobFiles>` and `<ContractsSection>`.

### Header

- Left: `Receipt` icon + "Expenses" label + count badge `(N)` where N is total expense count for the job.
- Right: "+ Log Expense" primary teal button, gated on `hasPermission('log_expenses')`.

### Category filter pills

Row below the header. First pill is "All" (selected by default). Remaining pills are one per category that has `>= 1` expense on this job, in category `sort_order`. Selection filters the rendered list client-side; no re-fetch. Styling:

- Active pill: `bg: rgba(55, 138, 221, 0.15)`, `text: #85B7EB`, `border: rgba(55, 138, 221, 0.3)`
- Inactive: transparent bg, `#8A9199` text, `rgba(255,255,255,0.08)` border

### List row

```
┌────┬──────────────────────────────────┬──────────┐
│ 🖼 │ Home Depot                       │ $312.54  │
│    │ [Materials] · Apr 10 · Eric L.  │          │
└────┴──────────────────────────────────┴──────────┘
```

- Left: 40×40 thumbnail from `receipts/{...}/.thumb.jpg` via signed URL (lazy-loaded per row). If missing, placeholder `ImageIcon` in a `rgba(255,255,255,0.04)` box.
- Middle top: `vendors.name` via `vendor_id` join, falling back to `expenses.vendor_name` when vendor was deleted.
- Middle bottom: category pill (bg/text from category row) · `format(expense_date, 'MMM d')` · `submitter_name`.
- Right: `amount` formatted `$X,XXX.XX`, white, semibold.
- Whole row is a button → opens Receipt Detail Modal.

### Empty state

Centered within the card body: muted `Receipt` icon, text "No expenses logged yet", and a teal text link "Log the first expense" that opens the Log Expense modal. Link is hidden if the user lacks `log_expenses`.

## Log Expense modal

Component: `src/components/expenses/log-expense-modal.tsx`.

### Chrome

Single `Dialog` with responsive classes: on `< md`, `inset-0 rounded-none max-w-full max-h-full` (full viewport); on `>= md`, the normal centered card (`sm:max-w-lg`, rounded). All controls use `min-h-11` (44px) and `text-base` (16px) to hit iOS touch/zoom guidelines.

### Fields (in order)

1. **Receipt photo** — large drop zone at the top of the modal body.
   - Mobile: two stacked buttons — **Take Photo** (`<input type="file" accept="image/*" capture="environment">`), **Choose from Library** (plain file input). Buttons span full width.
   - Desktop: single drop zone with "Drag & drop, or click to browse" copy. Same `<input>` element, no `capture` attribute.
   - On selection, preview renders immediately using `URL.createObjectURL`. User can Replace or Remove before submitting.
2. **Vendor** — autocomplete combobox. Queries `GET /api/settings/vendors?q=&active=true` debounced 150ms. Dropdown items show name + type pill + default-category pill. Final row: "+ Add \"<typed>\" as new vendor" when input is non-empty; selecting it calls `POST /api/settings/vendors` with `{name, vendor_type: 'other', default_category_id: null}` and auto-fills the field with the returned vendor. Selecting a vendor with a `default_category_id` pre-selects that category (user can override).
3. **Amount** — number input, `inputMode="decimal"`, `$` prefix, 2-decimal display on blur.
4. **Date** — native `<input type="date">`, default today.
5. **Category** — pill selector sourced from active `expense_categories` sorted by `sort_order`. Required.
6. **Payment method** — pill selector: Business Card / Business ACH / Cash / Personal (Reimburse) / Other. Values map to `business_card`, `business_ach`, `cash`, `personal_reimburse`, `other`.
7. **Description** — single-line text input, optional.

Primary "Log Expense" button at the bottom; disabled until required fields valid.

### Submit flow

1. Client: downscale selected image to `<= 2048px` longest edge via canvas, JPEG quality 0.85 → Blob (`original`). Produce a second canvas at 200px wide, JPEG quality 0.85 → Blob (`thumb`).
2. Client: generate `uuid = crypto.randomUUID()`. Upload `original` to `receipts/{jobId}/{uuid}.jpg` and `thumb` to `receipts/{jobId}/{uuid}.thumb.jpg` using `supabase.storage.from('receipts').upload(...)`. If either upload fails, abort and toast the error — no DB write.
3. Client: `POST /api/expenses` with the full payload including `receipt_path` and `thumbnail_path`.
4. Server: verify `log_expenses` permission, snapshot the vendor name and submitter name, then call RPC `create_expense_with_activity(...)` (single transaction: insert `expenses`, insert `job_activities`, update `expenses.activity_id`, update `vendors.last_used_at`).
5. Server returns the new expense row. Client closes the modal, toasts "Expense logged", and calls `onChanged()` to refresh the section and the activity timeline.

### Failure recovery

If the API call fails *after* storage succeeded, the client deletes both uploaded objects before surfacing the error. If the cleanup itself fails, orphaned objects are acceptable (matches how `photos` and `email-attachments` already behave — cleanup can be batched later).

## Receipt Detail modal

Component: `src/components/expenses/receipt-detail-modal.tsx`. Opened from expense rows or activity log rows.

### Content

- Full-size receipt image (signed URL, 10-minute expiry), contained within the modal body with `max-h-[70vh]` and `object-contain`. Click opens the raw signed URL in a new tab.
- Details block: vendor name, category pill, `expense_date`, payment method label, description (if present), `amount`, `submitter_name`, `format(created_at, 'MMM d, yyyy h:mm a')`.
- Footer actions: **Edit** (opens the Log Expense modal prefilled in edit mode), **Delete** (destructive red).

### Edit mode

The Log Expense modal accepts an optional `existing: Expense` prop. If provided: fields prefill, submit flow hits `PATCH /api/expenses/{id}` instead of `POST`, uploads only happen if the user replaced the photo. On photo replacement, new paths are written and the old storage objects are deleted server-side after the DB update succeeds.

### Delete

- Confirm dialog: "Delete this expense? This will also remove the activity log entry and receipt files. This cannot be undone."
- Client: `DELETE /api/expenses/{id}` → server calls RPC `delete_expense_cascade(id)` (removes the paired `job_activities` row and the `expenses` row in one transaction), **then** deletes both storage objects. If either storage delete fails after the DB transaction committed, the orphaned file is logged and swallowed — storage orphans are recoverable via batch cleanup; broken DB state isn't. This intentionally trades the "both-or-neither" wording in the spec for the safer failure mode.

## Activity log integration

### DB

Migration adds `'expense'` to the `job_activities.activity_type` CHECK constraint.

### Insert path

The expense insert RPC writes a paired `job_activities` row:

- `activity_type`: `'expense'`
- `title`: `"Logged expense: {vendor_name} — ${amount}"` (uses the snapshot vendor name and `amount.toFixed(2)` with thousands separators)
- `description`: `"{category_display_label} · receipt attached"` (omits "receipt attached" if no photo, though in practice a photo is always present; the schema allows it to be optional)
- `author`: `submitter_name`
- The expense row's `activity_id` is set after the activity row is inserted (same transaction).

### Renderer

Update [src/components/activity-timeline.tsx](src/components/activity-timeline.tsx):

- Add to `activityTypeConfig`: `expense: { icon: Receipt, color: "bg-vibrant-green", label: "Expense" }` (color may be swapped during visual QA).
- Add `"expense"` to the optional-filter chip list (it's not an entry type from the "Add Activity" dialog — it's insert-only from the expense flow).
- When an activity row has `activity_type === 'expense'`, clicking the row opens the Receipt Detail Modal for the linked expense (looked up by `activity_id`).

Spec wording shows "{submitter} logged expense: {vendor} — ${amount}" for the rendered row — the existing renderer already shows `author` alongside `title`, so the stored title `"Logged expense: ..."` produces the desired visual output without special-casing.

## API routes

All server routes use `createApiClient()` (service role) and explicitly check the session user's permission before mutating. Pattern-matched to existing `/api/settings/*` routes.

### Settings

- `GET  /api/settings/vendors` — list. Query params: `q` (fuzzy name match), `active` (`true`/`false`/omitted), `type` (one of the five), `is_1099` (`true`/omitted).
- `POST /api/settings/vendors` — create. Requires `manage_vendors`.
- `PATCH /api/settings/vendors/[id]` — edit the editable fields (name, type, default_category, tax_id, is_1099, notes). **Does not** touch `is_active`. Requires `manage_vendors`.
- `POST /api/settings/vendors/[id]/deactivate` — sets `is_active = false`. Requires `manage_vendors`.
- `POST /api/settings/vendors/[id]/reactivate` — sets `is_active = true`. Requires `manage_vendors`. The Active toggle in the vendor table calls whichever of the two matches the direction of the flip.
- `GET  /api/settings/expense-categories` — list ordered by `sort_order`.
- `POST /api/settings/expense-categories` — create custom. Requires `manage_expense_categories`.
- `PUT  /api/settings/expense-categories` — bulk sort update (fork of damage-types PUT).
- `DELETE /api/settings/expense-categories?id=...` — delete if not default and not in-use. Requires `manage_expense_categories`.

### Job-detail

- `GET  /api/expenses/by-job/[jobId]` — returns expenses joined to vendor + category, ordered by `expense_date desc, created_at desc`.
- `POST /api/expenses` — create. Requires `log_expenses`. Body includes uploaded-file paths.
- `PATCH /api/expenses/[id]` — edit. Permission: `log_expenses` AND (the current user is the original `submitted_by`, OR `user_profiles.role === 'admin'`). Returns 403 otherwise.
- `DELETE /api/expenses/[id]` — delete. Same permission model as edit. Server deletes the DB rows in one transaction, **then** deletes both storage objects. If the storage delete fails after the DB delete succeeds, the orphaned files are logged and swallowed (recoverable by later batch cleanup; broken DB state is not).
- `GET  /api/expenses/[id]/receipt-url` — returns `{ url, expiresAt }` for the original receipt (600s signed).
- `GET  /api/expenses/[id]/thumbnail-url` — returns `{ url, expiresAt }` for the thumbnail (600s signed). Called per-row in the Expenses section.

Responses match the shape of existing routes (array or `{ error }` for failures).

## RPC functions

Written in `migration-build35-expenses.sql`, called via `supabase.rpc(...)` from the API routes.

- `create_expense_with_activity(...)` — inserts the expense, inserts the paired activity, sets `expenses.activity_id`, bumps `vendors.last_used_at`. Returns the new expense id.
- `update_expense(...)` — updates the expense and the paired activity row's title/description if `amount`/`vendor_name`/`category` changed. Keeps the pair in sync within one txn.
- `delete_expense_cascade(p_expense_id uuid)` — looks up the expense's `activity_id`, deletes that `job_activities` row, then deletes the `expenses` row, all in one transaction. The `expenses.activity_id` FK with `ON DELETE SET NULL` is only a safety net for the unusual case where a `job_activities` row is deleted through some other path.

## Component file layout

```
src/components/expenses/
  expenses-section.tsx         # card + filter pills + rows; fetches via /api/expenses/by-job/[jobId]
  log-expense-modal.tsx        # create or edit
  receipt-detail-modal.tsx     # view + edit/delete actions
  vendor-autocomplete.tsx      # combobox with "+ Add new" inline
  thumbnail.ts                 # client-side canvas downscale utilities
```

```
src/app/settings/vendors/page.tsx
src/app/settings/expense-categories/page.tsx

src/app/api/settings/vendors/route.ts
src/app/api/settings/vendors/[id]/route.ts
src/app/api/settings/expense-categories/route.ts

src/app/api/expenses/route.ts
src/app/api/expenses/[id]/route.ts
src/app/api/expenses/[id]/receipt-url/route.ts
src/app/api/expenses/[id]/thumbnail-url/route.ts
src/app/api/expenses/by-job/[jobId]/route.ts
```

Types extended in `src/lib/types.ts`: `Vendor`, `VendorType`, `ExpenseCategory`, `Expense`, `PaymentMethod`; the existing `JobActivity.activity_type` union gains `'expense'`.

## SaaS-readiness alignment (v1.6 Section 7)

- **Principle 1 (no hardcoded company identity):** no company strings anywhere in the migration, APIs, or components. Receipt storage paths contain `job_id`, not a company slug.
- **Principle 2 (settings over code):** `expense_categories` drives all categorization. No hardcoded category IDs anywhere in component code. Vendor types are a `const` in one TypeScript file today; it promotes cleanly to a `vendor_types` table in a future build if needed.
- **Principle 4 (scoped storage paths):** `receipts/{job_id}/...` follows the Phase-5 migration pattern.
- **Principle 5 (multi-tenant permissions):** permission keys added via the same `user_permissions` pattern Build 14d uses; no shortcut code paths.
- **Principle 7 (scripted seed data):** all category defaults are in the SQL migration, rerunnable per organization in Phase 5.

## What this build explicitly does NOT do

- No `/accounting` route, no dashboard, no profitability, no margin, no AR aging.
- No QuickBooks code, tables, fields, hooks, or strings.
- No modifications to any "Financials tab" (doesn't exist in this branch at the time of this spec).
- No changes to existing colors, typography, dark-mode, or other platform aesthetics beyond adding the new section's chrome.

## Testing

Per project memory, this repo has no jest/vitest/playwright setup. "Testing" for this build means:

1. `tsc --noEmit` passes (ignoring the 39 pre-existing jarvis/neural-network errors).
2. Manual verification via `preview_*` tools: log → view → edit → delete a receipt on a real job, on both desktop and a mobile viewport.
3. Migration applied manually in Supabase SQL editor per project convention, against the shared dev/prod project.

## Deferred

- **Fuel filter tab** — intentionally rolled into **Other** for this build to keep the filter list small. Worth revisiting if fuel vendor volume grows enough to warrant its own tab.
