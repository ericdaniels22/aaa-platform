# Build 16b — Accounting Dashboard & Profitability Views

**Status:** Design approved 2026-04-19. Implementation to follow via writing-plans skill.
**Migration number:** `build36-accounting`.
**Source of truth for spec:** This document plus the user's chat brief. `AAA-Platform-Build-Guide-v1_6.docx` defers Build 16 to `v1_5.docx`, which is not on disk; v1.6 Section 7 (SaaS Readiness Principles) still applies.

## Goal

Expose the profitability data that Build 16a's expense capture enabled. Create a top-level `/accounting` page with four tabs (Job profitability, AR aging, Expenses, By damage type), and a per-job Financials tab that houses the relocated Billing and Expenses sections. No QuickBooks work — that's 16c/16d.

## Out of scope (explicit)

- QB OAuth flow, `qb_*` columns, any sync logic
- The QuickBooks sync tab (hidden in 16b, added in 16c)
- Any changes to Build 16a's expense entry, category management, or vendor management
- A live margin on the main job detail header for non-completed jobs
- Any hardcoded company identity (v1.6 SaaS Readiness Principle 1)

## Database changes — `supabase/migration-build36-accounting.sql`

1. Add columns to `jobs`:
   - `estimated_crew_labor_cost numeric(10,2)` (nullable)
   - `payer_type text` (nullable) — values: `insurance`, `homeowner`, `mixed`, or `NULL`
2. Add permission key `view_accounting` via `set_default_permissions()` PL/pgSQL function (matching the build35 pattern): admin granted, crew_lead denied, crew_member denied.
3. Add PL/pgSQL function `recompute_job_payer_type(p_job_id uuid)` and a trigger `payments_update_payer_type` firing AFTER INSERT OR UPDATE OR DELETE ON payments. On UPDATE, recompute both old and new `job_id` when the row moved. Also update `jobs.payer_type` directly inside the trigger.
4. Seed `/accounting` into `nav_items` DB table, ordered between Email and Settings (matching Build 14a nav-order pattern).
5. One-time backfill: after creating the trigger, run `UPDATE jobs SET payer_type = recompute_job_payer_type(id)` so existing jobs get populated. Without this, payer_type stays NULL for all pre-migration jobs until their next payment mutation.

## Payer type computation

Chosen mechanism: PL/pgSQL trigger on `payments`, with a TS helper `src/lib/jobs/payer-type.ts` callable from route handlers as an idempotent second write.

Rule (confirmed):
- `payments.source = 'other'` does NOT contribute to classification
- If received payments include both `insurance` and `homeowner` → `mixed`
- If only `insurance` → `insurance`
- If only `homeowner` → `homeowner`
- Otherwise (no received payments, or only `other`) → `NULL`
- `status = 'received'` is required to count (pending/due payments are ignored)
- Invoice sources do not participate — computed from payments only (contrary to the original prompt wording)

## Margin calculation — `src/lib/accounting/margins.ts`

```ts
export type JobMargin = {
  jobId: string;
  invoiced: number;        // sum(invoices.total_amount)
  collected: number;       // sum(payments.amount) WHERE status = 'received'
  expenses: number;        // sum(expenses.amount)
  crew_labor: number;      // jobs.estimated_crew_labor_cost ?? 0
  gross_margin: number;    // collected - expenses - crew_labor
  margin_pct: number | null; // (gross_margin / collected) * 100, or null if collected = 0
  job_status: string;
  in_progress: boolean;        // job_status !== 'completed'
  crew_labor_is_estimated: boolean; // crew_labor > 0 && !completed
};
```

Two public entry points:
- `calculateJobMargin(jobId)` — single job (used by per-job Financials summary row)
- `aggregateMargins(dateRange, filter)` — batch for `/accounting` profitability tab; one SQL round-trip with grouped joins

UI rules for in-progress indicator:
- Per-job Financials summary row: small muted "(in progress)" caption under the margin pill
- Job profitability table: "↻ in-progress" icon beside Margin $
- Main job detail header: **no margin shown** for non-completed jobs (per explicit constraint)

## Date range logic — `src/lib/accounting/date-ranges.ts`

Activity-based: a job enters the range if ANY of (invoice created, payment received, expense logged) falls in range. No `jobs.created_at` fallback.

Presets: Last 30 days (default), This quarter, Year to date, All time.

Prior-period delta:
- Last 30 days → prior 30 days (day-aligned)
- This quarter → last quarter
- YTD → same period last year (Jan 1 → today of prior year)
- All time → no delta shown

Implementation note in code: add a block comment explaining why it's activity-based and not job-created-in-range, so future maintainers don't "fix" it.

## Top-level route — `/accounting`

Permission gate: `view_accounting`. Denied users hit the existing 403-style fallback.

Page header:
- Title "Accounting", subtitle "Revenue, expenses, and profitability across all jobs"
- Right side: date range selector (default 30 days), Export ↓ dropdown

Stat cards (4, grid):
1. Revenue (collected in range) + prior-period delta
2. Expenses (+ "X% of revenue" muted line)
3. Gross margin — highlighted (bg `rgba(29, 158, 117, 0.12)`, border `rgba(29, 158, 117, 0.35)`, value `#5DCAA5`, pct `#9FE1CB`). Footnote/tooltip: "Estimate — includes manual crew labor cost where entered"
4. Outstanding AR — unpaid invoice totals minus collected. "$X,XXX over 60 days" in `#FAC775` when non-zero

Tabs (four visible, one hidden for 16b):
1. **Job profitability** (default) — filter pills All/Active/Completed, sort Margin $/Margin %/Revenue/Expenses/Recent, table with color-coded Margin % (green ≥30%, amber 10–29%, red <10% or negative), row click → `/jobs/[id]?tab=financials`, pagination past 20 rows
2. **AR aging** — 5 bucket cards (Current/1-30/31-60/61-90/90+), payer-type filter pills, table with Nudge button
3. **Expenses** — global view; muted subtitle "Platform expenses only — QuickBooks tracks overhead separately"; reuses existing `ReceiptDetailModal`
4. **By damage type** — rollup table + Chart.js horizontal bar chart (Average margin % by damage type); same damage-type badge colors in both
5. **QuickBooks sync** — OMITTED entirely from the tab strip in 16b (not rendered-but-hidden). 16c will add it.

Nudge button wiring: Opens existing `ComposeEmail` with query-param pre-fill (`defaultTo`, `defaultSubject`, `defaultBody` based on payer type). No new email template infrastructure.

"Last contact" column on AR aging: most recent email on the job (not matched to invoice number).

## Export (header Export ↓ button)

Dropdown options:
- Export Job Profitability (CSV)
- Export AR Aging (CSV)
- Export Expenses (CSV)
- Export All (ZIP)

Scope: uses the currently-selected header date range.

Stack: add `jszip` (~12KB gz) for ZIP bundling; tiny custom CSV serializer in `src/lib/accounting/csv.ts` (no new CSV dep — small surface, quotes/escapes/BOM only). Delivered via server route as a streaming response.

## Per-job Financials tab

Inserted between Overview and Photos in [src/components/job-detail.tsx:90-106](src/components/job-detail.tsx:90).

Contents, in order:
1. Summary metrics row — 4 pills: Invoiced, Collected, Expenses, Gross margin (last one highlighted teal). Uses `calculateJobMargin(jobId)`. Shows "(in progress)" caption when job_status !== 'completed'.
2. **Billing** section — extracted from `job-detail.tsx:560-669` into a new `<BillingSection>` component and mounted here. Modals (`RecordPaymentModal`, + Invoice) keep existing behavior.
3. **Expenses** section — `<ExpensesSection>` mounted here unchanged.

## Tab structural change — what moves, what stays

**Overview (before):** Job Info → Contact → Insurance → **Billing** → Files → Contracts → **Expenses** → Reports → Emails → Custom Fields → Activity Timeline

**Overview (after):** Job Info (+ estimated_crew_labor_cost row) → Contact (+ payer_type badge) → Insurance → Files → Contracts → Reports → Emails → Custom Fields → Activity Timeline

**Financials (new):** Summary metrics row → Billing → Expenses

**Photos:** unchanged

Refactor mechanics:
- Lift the Billing JSX out of `job-detail.tsx` into `<BillingSection>` component
- Modal state (`RecordPaymentModal` etc.) lifts up with the section
- `<ExpensesSection>` is already a clean component; just a mount-point move
- Activity Timeline stays on Overview and continues to reflect payment/invoice/expense events because it reads from `job_activities`, which is UI-location-independent

Deep-link redirect: On `job-detail.tsx` mount, detect `?section=billing` or `#billing` hash and redirect to `?tab=financials`. (User unsure of exact legacy URL shape — covering the plausible ones.)

Default tab: no param → Overview (unchanged).

## Overview changes (small)

- Job Info card: add "Estimated crew labor cost" row (currency format, inline edit gated by `edit_jobs` permission, muted "Not set" when null)
- Contact & Insurance card: payer_type badge below content — Insurance (purple), Homeowner (blue), Mixed (amber). Auto-computed, no manual override.

## Nav

`src/lib/nav-items.ts` gets `{ href: "/accounting", label: "Accounting", icon: Calculator }` between Email and Settings. Nav order is loaded from DB `nav_items` table (Build 14a) at runtime with this array as fallback — migration seeds the DB row too.

## SaaS Readiness Principles compliance

- No hardcoded company name/address/phone/email anywhere in accounting UI or exports (Principle 1)
- Damage type colors and labels read from `damage_types` table; expense categories from `expense_categories` (Principle 2)
- No conditional like `if damage_type === 'water'` (Principle 6)
- Seed data for `view_accounting` permission and `/accounting` nav item goes through migration (Principle 7)
- Export infrastructure extends Build 14i philosophy (Principle 8)

## Verification plan (manual preview + tsc; no test framework per project convention)

1. Overview tab no longer shows Billing or Expenses cards
2. Financials tab shows both; + Invoice / + Record Payment open identical modals
3. Logging an expense from Financials updates Activity Timeline on Overview
4. Recording a payment from Financials updates Activity Timeline AND payer_type badge
5. `/jobs/[id]` (no tab) defaults to Overview
6. `/jobs/[id]?tab=financials` deep-link works
7. `?section=billing` and `#billing` redirect to `?tab=financials`
8. `/accounting` blocked for crew_lead/crew_member, visible to admin
9. Date range presets produce expected row counts (spot-check at least 2)
10. Export ↓ produces CSVs and a ZIP with the right filenames
11. Stat cards render with correct colors (green margin card, amber AR-over-60 when non-zero)
12. Bar chart on "By damage type" renders via Chart.js
13. Nudge button opens composer pre-filled
14. No new TS errors (baseline = 39 pre-existing errors in jarvis/neural-network; these remain and are ignored)

## File list

**Create (17)**
```
supabase/migration-build36-accounting.sql
src/lib/accounting/margins.ts
src/lib/accounting/date-ranges.ts
src/lib/accounting/csv.ts
src/lib/jobs/payer-type.ts
src/app/accounting/page.tsx
src/components/accounting/accounting-dashboard.tsx
src/components/accounting/stat-cards.tsx
src/components/accounting/date-range-selector.tsx
src/components/accounting/export-menu.tsx
src/components/accounting/job-profitability-tab.tsx
src/components/accounting/ar-aging-tab.tsx
src/components/accounting/global-expenses-tab.tsx
src/components/accounting/by-damage-type-tab.tsx
src/components/accounting/margin-pill.tsx
src/components/job-detail/financials-tab.tsx
src/app/api/accounting/[scope]/route.ts
```

**Modify (6)**
```
src/components/job-detail.tsx       -- add Financials tab; remove Billing (~560-669) and ExpensesSection from Overview; mount them in FinancialsTab; payer_type badge; crew_labor row
src/lib/nav-items.ts                -- add /accounting
src/lib/types.ts                    -- extend Job: estimated_crew_labor_cost, payer_type
src/app/api/payments/...            -- call computePayerType after mutation (path TBD; confirmed before edit)
src/app/api/invoices/...            -- same, on status change
package.json                         -- add chart.js, react-chartjs-2, jszip
```

Exact payment/invoice API paths to be confirmed during implementation (Explore agent did not locate them explicitly — may be server actions rather than route files).

## Ambiguities — resolved

1. Spec source: v1.6 is okay (v1.5 not on disk; user's brief is canonical)
2. `payments.source='other'` → does not contribute to payer_type
3. payer_type computed from payments only (no invoice sources)
4. `collected = sum WHERE status='received'`
5. Prior-period delta: per-preset logic as stated above
6. AR "Last contact" = most recent email on the job
7. Legacy billing deep-link: cover `?section=billing` and `#billing`
8. `jszip` approved
9. QuickBooks sync tab: omitted entirely in 16b
10. Export uses header date range
11. Strict activity-based date filter (no `jobs.created_at` fallback)
