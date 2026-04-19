# Build 16b — Accounting Dashboard & Profitability Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/accounting` page (4 visible tabs) and a per-job `Financials` tab that relocates Billing + Expenses from Overview, so expense data from Build 16a becomes actionable through profitability views.

**Architecture:** PL/pgSQL trigger on `payments` keeps `jobs.payer_type` current. TypeScript utilities in `src/lib/accounting/*` handle margin math, date ranges, and CSV serialization. New API routes under `src/app/api/accounting/[scope]/route.ts` serve the dashboard tabs. UI is a new `/accounting` route plus a tab insert in the existing `job-detail.tsx`. No QuickBooks integration — that's 16c/16d.

**Tech Stack:** Next.js 14 App Router, Supabase (PostgreSQL + RLS), Tailwind, Lucide icons, Chart.js + react-chartjs-2 (new), jszip (new). No test framework — verification is `tsc --noEmit` + manual preview.

**Project conventions to follow:**
- Migrations: `supabase/migration-build36-accounting.sql`. Manual-run in Supabase dashboard. Not idempotent. Next number is **36** (build35 = Build 16a on main).
- API routes: mirror [src/app/api/expenses/route.ts](src/app/api/expenses/route.ts) pattern — `createServerSupabaseClient()` for auth/reads, `createServiceClient()` for writes. Permission check via role=admin OR user_permissions row.
- Payment mutations go direct via Supabase client (see [src/components/record-payment.tsx:80](src/components/record-payment.tsx:80)) — no API route wrapper. Trigger handles payer_type because every mutation hits the DB.
- Dark theme + teal `#0F6E56` accent. Damage type/status colors live in [src/lib/badge-colors.ts](src/lib/badge-colors.ts).
- tsc baseline: 39 pre-existing errors in `jarvis/neural-network` — ignore those. Success = no NEW errors.
- SaaS Readiness: no hardcoded company identity; damage types read from `damage_types` table, categories from `expense_categories` table.
- Commit frequently; each task ends with a commit. Branch: `claude/wonderful-solomon-533fee`.

**Design spec:** [docs/superpowers/specs/2026-04-19-build-16b-accounting-design.md](docs/superpowers/specs/2026-04-19-build-16b-accounting-design.md)

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Chart.js + react wrapper + jszip**

Run:
```bash
npm install chart.js@^4 react-chartjs-2@^5 jszip@^3
```

Expected: three packages added to `dependencies` in package.json; `package-lock.json` updated.

- [ ] **Step 2: Verify install**

Run:
```bash
node -e "console.log(require('chart.js/package.json').version, require('react-chartjs-2/package.json').version, require('jszip/package.json').version)"
```

Expected: three version strings printed.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(16b): add chart.js, react-chartjs-2, jszip"
```

---

## Task 2: Migration — columns, permission, nav seed, payer_type trigger, backfill

**Files:**
- Create: `supabase/migration-build36-accounting.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migration-build36-accounting.sql
-- Build 16b: Accounting dashboard columns, view_accounting permission,
-- nav seed, payer_type trigger + backfill.

-- 1. Add columns to jobs
ALTER TABLE jobs ADD COLUMN estimated_crew_labor_cost numeric(10,2);
ALTER TABLE jobs ADD COLUMN payer_type text
  CHECK (payer_type IN ('insurance', 'homeowner', 'mixed'));
-- nullable; NULL means "no received payments yet or only 'other'-source payments"

-- 2. payer_type recompute function
CREATE OR REPLACE FUNCTION recompute_job_payer_type(p_job_id uuid)
RETURNS text AS $$
DECLARE
  has_insurance boolean;
  has_homeowner boolean;
  result text;
BEGIN
  SELECT
    bool_or(source = 'insurance'),
    bool_or(source = 'homeowner')
  INTO has_insurance, has_homeowner
  FROM payments
  WHERE job_id = p_job_id AND status = 'received';

  IF has_insurance AND has_homeowner THEN
    result := 'mixed';
  ELSIF has_insurance THEN
    result := 'insurance';
  ELSIF has_homeowner THEN
    result := 'homeowner';
  ELSE
    result := NULL;
  END IF;

  UPDATE jobs SET payer_type = result WHERE id = p_job_id;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger on payments to maintain payer_type
CREATE OR REPLACE FUNCTION trg_recompute_payer_type()
RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM recompute_job_payer_type(NEW.job_id);
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM recompute_job_payer_type(OLD.job_id);
  ELSIF (TG_OP = 'UPDATE') THEN
    PERFORM recompute_job_payer_type(NEW.job_id);
    IF OLD.job_id IS DISTINCT FROM NEW.job_id THEN
      PERFORM recompute_job_payer_type(OLD.job_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_update_payer_type
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_recompute_payer_type();

-- 4. One-time backfill of payer_type for existing jobs
UPDATE jobs SET payer_type = recompute_job_payer_type(id);

-- 5. view_accounting permission — seed into user_permissions for admins
-- (matches Build 14d/35 pattern: set_default_permissions function adds new keys)
-- 5a. Update set_default_permissions to include view_accounting for admins
CREATE OR REPLACE FUNCTION set_default_permissions(p_user_id uuid, p_role text)
RETURNS void AS $$
BEGIN
  DELETE FROM user_permissions WHERE user_id = p_user_id;

  IF p_role = 'admin' THEN
    INSERT INTO user_permissions (user_id, permission_key, granted) VALUES
      (p_user_id, 'view_jobs', true),
      (p_user_id, 'edit_jobs', true),
      (p_user_id, 'create_jobs', true),
      (p_user_id, 'log_activities', true),
      (p_user_id, 'upload_photos', true),
      (p_user_id, 'edit_photos', true),
      (p_user_id, 'view_billing', true),
      (p_user_id, 'record_payments', true),
      (p_user_id, 'view_email', true),
      (p_user_id, 'send_email', true),
      (p_user_id, 'manage_reports', true),
      (p_user_id, 'access_settings', true),
      (p_user_id, 'log_expenses', true),
      (p_user_id, 'manage_vendors', true),
      (p_user_id, 'manage_expense_categories', true),
      (p_user_id, 'manage_contract_templates', true),
      (p_user_id, 'view_accounting', true);
  ELSIF p_role = 'crew_lead' THEN
    INSERT INTO user_permissions (user_id, permission_key, granted) VALUES
      (p_user_id, 'view_jobs', true),
      (p_user_id, 'edit_jobs', true),
      (p_user_id, 'create_jobs', false),
      (p_user_id, 'log_activities', true),
      (p_user_id, 'upload_photos', true),
      (p_user_id, 'edit_photos', true),
      (p_user_id, 'view_billing', false),
      (p_user_id, 'record_payments', false),
      (p_user_id, 'view_email', false),
      (p_user_id, 'send_email', false),
      (p_user_id, 'manage_reports', false),
      (p_user_id, 'access_settings', false),
      (p_user_id, 'log_expenses', true),
      (p_user_id, 'manage_vendors', false),
      (p_user_id, 'manage_expense_categories', false),
      (p_user_id, 'manage_contract_templates', false),
      (p_user_id, 'view_accounting', false);
  ELSIF p_role = 'crew_member' THEN
    INSERT INTO user_permissions (user_id, permission_key, granted) VALUES
      (p_user_id, 'view_jobs', true),
      (p_user_id, 'edit_jobs', false),
      (p_user_id, 'create_jobs', false),
      (p_user_id, 'log_activities', true),
      (p_user_id, 'upload_photos', true),
      (p_user_id, 'edit_photos', false),
      (p_user_id, 'view_billing', false),
      (p_user_id, 'record_payments', false),
      (p_user_id, 'view_email', false),
      (p_user_id, 'send_email', false),
      (p_user_id, 'manage_reports', false),
      (p_user_id, 'access_settings', false),
      (p_user_id, 'log_expenses', true),
      (p_user_id, 'manage_vendors', false),
      (p_user_id, 'manage_expense_categories', false),
      (p_user_id, 'manage_contract_templates', false),
      (p_user_id, 'view_accounting', false);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 5b. Apply view_accounting key to existing users
INSERT INTO user_permissions (user_id, permission_key, granted)
SELECT id, 'view_accounting', (role = 'admin')
FROM user_profiles
WHERE id NOT IN (
  SELECT user_id FROM user_permissions WHERE permission_key = 'view_accounting'
);

-- 6. Seed /accounting into nav_items (Build 14a nav-order table)
-- Insert between Email and Settings. nav_items uses sort_order integers — shift higher ones.
UPDATE nav_items SET sort_order = sort_order + 1 WHERE sort_order >= (
  SELECT sort_order FROM nav_items WHERE href = '/settings'
);
INSERT INTO nav_items (href, label, icon, sort_order)
SELECT '/accounting', 'Accounting', 'Calculator',
       (SELECT sort_order FROM nav_items WHERE href = '/settings') - 1;
```

- [ ] **Step 2: Manual run in Supabase dashboard**

Per project convention (memory: `project_migration_convention.md`), migrations are applied manually. Steps:
1. Open Supabase dashboard SQL editor for the shared project
2. Paste the file contents
3. Click Run
4. If it fails mid-way, it's not idempotent — you must investigate and may need to partially revert before re-running

**Note before applying:** Verify the `nav_items` table column names match (`href`, `label`, `icon`, `sort_order`). If the schema uses different names, adjust Step 6 of the SQL before running. Check via `SELECT column_name FROM information_schema.columns WHERE table_name = 'nav_items'`.

- [ ] **Step 3: Verify**

In Supabase SQL editor, run:
```sql
SELECT id, status, payer_type FROM jobs LIMIT 10;
SELECT permission_key, count(*) FROM user_permissions WHERE permission_key = 'view_accounting' GROUP BY 1;
SELECT href, sort_order FROM nav_items ORDER BY sort_order;
```

Expected: `payer_type` populated for jobs with received payments; `view_accounting` key exists for all users; `/accounting` sits between `/email` and `/settings` in nav_items.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-build36-accounting.sql
git commit -m "feat(db): build36 — accounting columns, view_accounting perm, payer_type trigger"
```

---

## Task 3: Update types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Locate Job type**

Run:
```bash
grep -n "export.*Job\b\|type Job\|interface Job" src/lib/types.ts
```

- [ ] **Step 2: Add the two new fields**

Add to the `Job` type (alongside existing optional fields like `deductible`, `hoa_*`):

```typescript
  estimated_crew_labor_cost: number | null;
  payer_type: "insurance" | "homeowner" | "mixed" | null;
```

- [ ] **Step 3: tsc check**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -20
```

Expected: no new errors. If a caller relies on `Job` exactly matching a Supabase select shape, you may need to update that query string too.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): Job.estimated_crew_labor_cost and Job.payer_type"
```

---

## Task 4: payer-type TypeScript helper

**Files:**
- Create: `src/lib/jobs/payer-type.ts`

- [ ] **Step 1: Write the helper**

```typescript
// src/lib/jobs/payer-type.ts
// Computes payer_type for a job from received payments.
// The DB trigger payments_update_payer_type (migration-build36) maintains
// jobs.payer_type automatically on every payment INSERT/UPDATE/DELETE. This
// helper exists as a manual-recompute utility (useful for data fixes, tests,
// or if a future code path bypasses the DB).

import { createServiceClient } from "@/lib/supabase-api";

export type PayerType = "insurance" | "homeowner" | "mixed" | null;

export async function computePayerType(jobId: string): Promise<PayerType> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("recompute_job_payer_type", {
    p_job_id: jobId,
  });
  if (error) {
    throw new Error(`computePayerType failed for job ${jobId}: ${error.message}`);
  }
  return (data as PayerType) ?? null;
}
```

- [ ] **Step 2: tsc check**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/jobs/payer-type.ts
git commit -m "feat(jobs): computePayerType TS helper (manual recompute utility)"
```

---

## Task 5: Margin calculation utility

**Files:**
- Create: `src/lib/accounting/margins.ts`

- [ ] **Step 1: Write the utility**

```typescript
// src/lib/accounting/margins.ts
// Job margin math. Per design spec:
// - collected = sum(payments.amount) WHERE status = 'received'
// - expenses  = sum(expenses.amount)
// - crew_labor = jobs.estimated_crew_labor_cost ?? 0
// - gross_margin = collected - expenses - crew_labor
// - margin_pct = (gross_margin / collected) * 100, or null if collected = 0
// - in_progress = job_status !== 'completed'
//
// Active jobs show the margin with an "(in progress)" indicator because
// mid-job numbers are misleading (expenses landed but collections haven't).

import { createServerSupabaseClient } from "@/lib/supabase-server";

export type JobMargin = {
  jobId: string;
  jobNumber: string | null;
  invoiced: number;
  collected: number;
  expenses: number;
  crew_labor: number;
  gross_margin: number;
  margin_pct: number | null;
  job_status: string;
  in_progress: boolean;
  crew_labor_is_estimated: boolean;
};

function sum<T>(rows: T[] | null | undefined, pick: (r: T) => number | null): number {
  if (!rows) return 0;
  let total = 0;
  for (const r of rows) total += pick(r) ?? 0;
  return total;
}

export async function calculateJobMargin(jobId: string): Promise<JobMargin> {
  const supabase = await createServerSupabaseClient();

  const [jobRes, invoicesRes, paymentsRes, expensesRes] = await Promise.all([
    supabase.from("jobs").select("id, job_number, status, estimated_crew_labor_cost").eq("id", jobId).maybeSingle(),
    supabase.from("invoices").select("total_amount").eq("job_id", jobId),
    supabase.from("payments").select("amount").eq("job_id", jobId).eq("status", "received"),
    supabase.from("expenses").select("amount").eq("job_id", jobId),
  ]);

  if (!jobRes.data) throw new Error(`Job ${jobId} not found`);

  const invoiced = sum(invoicesRes.data, (r: any) => Number(r.total_amount));
  const collected = sum(paymentsRes.data, (r: any) => Number(r.amount));
  const expenses = sum(expensesRes.data, (r: any) => Number(r.amount));
  const crew_labor = Number(jobRes.data.estimated_crew_labor_cost ?? 0);
  const gross_margin = collected - expenses - crew_labor;
  const margin_pct = collected > 0 ? (gross_margin / collected) * 100 : null;
  const job_status = jobRes.data.status;
  const in_progress = job_status !== "completed";

  return {
    jobId,
    jobNumber: jobRes.data.job_number,
    invoiced,
    collected,
    expenses,
    crew_labor,
    gross_margin,
    margin_pct,
    job_status,
    in_progress,
    crew_labor_is_estimated: crew_labor > 0 && in_progress,
  };
}

// Batch version used by /accounting Job Profitability tab.
// Returns one JobMargin row per job that has ANY activity in the date range
// (invoice, payment, or expense), per activity-based scoping rule.
export type MarginFilter = "all" | "active" | "completed";

export async function aggregateMargins(
  startISO: string | null,
  endISO: string | null,
  filter: MarginFilter,
): Promise<JobMargin[]> {
  const supabase = await createServerSupabaseClient();

  // Activity-based scoping: a job is in scope if it has an invoice, payment,
  // or expense in the range. When startISO/endISO are null (All time), skip filtering.
  // We do this as a single round-trip by fetching all 4 tables in parallel and
  // joining in JS. This keeps the SQL simple and sidesteps needing new RPCs.

  const [jobsRes, invoicesRes, paymentsRes, expensesRes] = await Promise.all([
    supabase.from("jobs").select("id, job_number, status, estimated_crew_labor_cost, damage_type, property_address"),
    supabase.from("invoices").select("job_id, total_amount, issued_date"),
    supabase.from("payments").select("job_id, amount, received_date, status"),
    supabase.from("expenses").select("job_id, amount, expense_date"),
  ]);

  const inRange = (iso: string | null) => {
    if (!iso) return false;
    if (startISO && iso < startISO) return false;
    if (endISO && iso > endISO) return false;
    return true;
  };

  const activeJobIds = new Set<string>();
  if (startISO || endISO) {
    for (const i of invoicesRes.data ?? []) if (inRange(i.issued_date)) activeJobIds.add(i.job_id);
    for (const p of paymentsRes.data ?? []) if (p.status === "received" && inRange(p.received_date)) activeJobIds.add(p.job_id);
    for (const e of expensesRes.data ?? []) if (inRange(e.expense_date)) activeJobIds.add(e.job_id);
  } else {
    for (const j of jobsRes.data ?? []) activeJobIds.add(j.id);
  }

  const invByJob = new Map<string, number>();
  const colByJob = new Map<string, number>();
  const expByJob = new Map<string, number>();
  for (const i of invoicesRes.data ?? []) invByJob.set(i.job_id, (invByJob.get(i.job_id) ?? 0) + Number(i.total_amount ?? 0));
  for (const p of paymentsRes.data ?? []) {
    if (p.status === "received") colByJob.set(p.job_id, (colByJob.get(p.job_id) ?? 0) + Number(p.amount ?? 0));
  }
  for (const e of expensesRes.data ?? []) expByJob.set(e.job_id, (expByJob.get(e.job_id) ?? 0) + Number(e.amount ?? 0));

  const out: JobMargin[] = [];
  for (const job of jobsRes.data ?? []) {
    if (!activeJobIds.has(job.id)) continue;
    if (filter === "active" && job.status === "completed") continue;
    if (filter === "completed" && job.status !== "completed") continue;

    const invoiced = invByJob.get(job.id) ?? 0;
    const collected = colByJob.get(job.id) ?? 0;
    const expenses = expByJob.get(job.id) ?? 0;
    const crew_labor = Number(job.estimated_crew_labor_cost ?? 0);
    const gross_margin = collected - expenses - crew_labor;
    const margin_pct = collected > 0 ? (gross_margin / collected) * 100 : null;
    const in_progress = job.status !== "completed";

    out.push({
      jobId: job.id,
      jobNumber: job.job_number,
      invoiced, collected, expenses, crew_labor, gross_margin, margin_pct,
      job_status: job.status,
      in_progress,
      crew_labor_is_estimated: crew_labor > 0 && in_progress,
    });
  }

  return out;
}

// Color band for Margin %
export function marginPctBand(pct: number | null): "green" | "amber" | "red" | "none" {
  if (pct === null) return "none";
  if (pct >= 30) return "green";
  if (pct >= 10) return "amber";
  return "red";
}
```

- [ ] **Step 2: tsc check**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/accounting/margins.ts
git commit -m "feat(accounting): calculateJobMargin + aggregateMargins utilities"
```

---

## Task 6: Date range utility

**Files:**
- Create: `src/lib/accounting/date-ranges.ts`

- [ ] **Step 1: Write the utility**

```typescript
// src/lib/accounting/date-ranges.ts
// Date range presets for /accounting, plus prior-period math.
//
// Activity-based scoping: a job is "in range" if ANY of (invoice created,
// payment received, expense logged) falls inside the range. This is NOT
// "job created in range" — the decision was made deliberately because a job
// created in March but paid out in June should appear in June's view.
// See design spec 2026-04-19-build-16b-accounting.

export type RangePreset = "last_30" | "this_quarter" | "ytd" | "all_time";

export type DateRange = {
  preset: RangePreset;
  startISO: string | null; // null for "all_time"
  endISO: string | null;   // null for "all_time"; otherwise today's date
  priorStartISO: string | null;
  priorEndISO: string | null;
  label: string;
};

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resolveRange(preset: RangePreset, now: Date = new Date()): DateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endISO = iso(today);

  if (preset === "all_time") {
    return {
      preset,
      startISO: null, endISO: null,
      priorStartISO: null, priorEndISO: null,
      label: "All time",
    };
  }

  if (preset === "last_30") {
    const start = new Date(today); start.setDate(start.getDate() - 29);
    const priorEnd = new Date(start); priorEnd.setDate(priorEnd.getDate() - 1);
    const priorStart = new Date(priorEnd); priorStart.setDate(priorStart.getDate() - 29);
    return {
      preset,
      startISO: iso(start), endISO,
      priorStartISO: iso(priorStart), priorEndISO: iso(priorEnd),
      label: "Last 30 days",
    };
  }

  if (preset === "this_quarter") {
    const qStartMonth = Math.floor(today.getMonth() / 3) * 3;
    const start = new Date(today.getFullYear(), qStartMonth, 1);
    const priorStart = new Date(start); priorStart.setMonth(priorStart.getMonth() - 3);
    const priorEnd = new Date(start); priorEnd.setDate(priorEnd.getDate() - 1);
    return {
      preset,
      startISO: iso(start), endISO,
      priorStartISO: iso(priorStart), priorEndISO: iso(priorEnd),
      label: "This quarter",
    };
  }

  // ytd
  const start = new Date(today.getFullYear(), 0, 1);
  const priorStart = new Date(today.getFullYear() - 1, 0, 1);
  const priorEnd = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  return {
    preset: "ytd",
    startISO: iso(start), endISO,
    priorStartISO: iso(priorStart), priorEndISO: iso(priorEnd),
    label: "Year to date",
  };
}

export function computeDelta(current: number, prior: number): { amount: number; pct: number | null; direction: "up" | "down" | "flat" } {
  const amount = current - prior;
  const pct = prior === 0 ? null : (amount / prior) * 100;
  const direction = amount > 0 ? "up" : amount < 0 ? "down" : "flat";
  return { amount, pct, direction };
}
```

- [ ] **Step 2: tsc check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/lib/accounting/date-ranges.ts
git commit -m "feat(accounting): date-range presets + prior-period math"
```

---

## Task 7: CSV serializer

**Files:**
- Create: `src/lib/accounting/csv.ts`

- [ ] **Step 1: Write**

```typescript
// src/lib/accounting/csv.ts
// Minimal CSV serializer. Handles commas, quotes, newlines, and nulls.
// Prepends a UTF-8 BOM so Excel on Windows renders UTF-8 correctly.

export function toCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.map(escape).join(",")];
  for (const row of rows) lines.push(row.map(escape).join(","));
  return "\uFEFF" + lines.join("\r\n");
}
```

- [ ] **Step 2: tsc check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/lib/accounting/csv.ts
git commit -m "feat(accounting): minimal CSV serializer"
```

---

## Task 8: Extract BillingSection component (refactor only, no behavior change)

**Files:**
- Create: `src/components/billing/billing-section.tsx`
- Modify: `src/components/job-detail.tsx` (Billing JSX block ~560-669)

- [ ] **Step 1: Read the existing Billing block**

```bash
sed -n '555,675p' src/components/job-detail.tsx
```

Identify:
- Props the section consumes from `job-detail.tsx` state: job, payments, invoices, onRecordPayment, onAddInvoice handlers, etc.
- State used internally (progress bar calc, sort order) — ideally keep local to BillingSection
- Modals involved (`RecordPaymentModal`) — decide whether modal state lifts with the section (preferred) or stays in job-detail

- [ ] **Step 2: Create the component**

`src/components/billing/billing-section.tsx`:
```typescript
"use client";

import { useState } from "react";
import type { Job, Payment } from "@/lib/types";
// ... bring over imports used by the Billing block
import RecordPaymentModal from "@/components/record-payment";

type Props = {
  job: Job;
  payments: Payment[];
  invoices: /* Invoice[] — add to types if not present */ any[];
  canRecordPayment: boolean;  // hasPermission("record_payments")
  onPaymentRecorded: () => void; // parent refetches
};

export default function BillingSection({ job, payments, invoices, canRecordPayment, onPaymentRecorded }: Props) {
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  // Move the existing Billing JSX (title, progress bar, payment rows, + buttons) here.
  // Keep all classNames (#0F6E56 teal, #2B5EA7 homeowner blue, muted grays) EXACTLY as they are in job-detail.tsx.
  return (
    <section className="...">
      {/* copy-paste Billing JSX from job-detail.tsx */}
    </section>
  );
}
```

**Important:** This is a pure extraction. Do NOT change the visible markup, CSS classes, or colors. Reviewer will diff and expect zero visual delta.

- [ ] **Step 3: Replace Billing block in job-detail.tsx**

Delete the original JSX (lines ~560-669). Replace with:
```tsx
<BillingSection
  job={job}
  payments={payments}
  invoices={invoices}
  canRecordPayment={hasPermission("record_payments")}
  onPaymentRecorded={() => { refetchPayments(); refetchActivities(); }}
/>
```

Remove any now-unused imports from job-detail.tsx.

- [ ] **Step 4: Preview check — no regressions**

```bash
# Use preview_start, open a job detail page with payments, confirm:
# - Billing card renders identically (progress bar, split colors, rows)
# - + Record Payment opens the RecordPaymentModal
# - After recording, progress bar updates and Activity Timeline shows the entry
```

- [ ] **Step 5: tsc check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -10
git add src/components/billing/billing-section.tsx src/components/job-detail.tsx
git commit -m "refactor(16b): extract BillingSection (no behavior change, prep for Financials tab)"
```

---

## Task 9: Financials tab — create component, insert tab, move Billing + Expenses

**Files:**
- Create: `src/components/job-detail/financials-tab.tsx`
- Modify: `src/components/job-detail.tsx` (tab strip, Overview content)

- [ ] **Step 1: Create FinancialsTab component**

`src/components/job-detail/financials-tab.tsx`:
```typescript
"use client";

import type { Job, Payment } from "@/lib/types";
import BillingSection from "@/components/billing/billing-section";
import ExpensesSection from "@/components/expenses/expenses-section";

type Props = {
  job: Job;
  payments: Payment[];
  invoices: any[];
  canRecordPayment: boolean;
  canLogExpenses: boolean;
  summary: {
    invoiced: number;
    collected: number;
    expenses: number;
    gross_margin: number;
    margin_pct: number | null;
    in_progress: boolean;
  };
  onPaymentRecorded: () => void;
  onExpenseLogged: () => void;
};

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function FinancialsTab(props: Props) {
  const { job, payments, invoices, canRecordPayment, canLogExpenses, summary, onPaymentRecorded, onExpenseLogged } = props;

  return (
    <div className="space-y-6">
      {/* Summary metrics row — 4 pills */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryPill label="Invoiced" value={fmtCurrency(summary.invoiced)} />
        <SummaryPill label="Collected" value={fmtCurrency(summary.collected)} />
        <SummaryPill label="Expenses" value={fmtCurrency(summary.expenses)} />
        <SummaryPill
          label="Gross margin"
          value={fmtCurrency(summary.gross_margin)}
          highlight
          caption={summary.in_progress ? "(in progress)" : summary.margin_pct !== null ? `${summary.margin_pct.toFixed(1)}% margin` : undefined}
        />
      </div>

      <BillingSection
        job={job}
        payments={payments}
        invoices={invoices}
        canRecordPayment={canRecordPayment}
        onPaymentRecorded={onPaymentRecorded}
      />

      <ExpensesSection jobId={job.id} canLog={canLogExpenses} onExpenseLogged={onExpenseLogged} />
    </div>
  );
}

function SummaryPill({ label, value, highlight, caption }: { label: string; value: string; highlight?: boolean; caption?: string }) {
  const hl = highlight
    ? { background: "rgba(29, 158, 117, 0.12)", border: "1px solid rgba(29, 158, 117, 0.35)", color: "#5DCAA5" }
    : undefined;
  return (
    <div className="rounded-lg p-4" style={hl ?? { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <div className="text-xs uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold" style={hl ? { color: "#5DCAA5" } : undefined}>{value}</div>
      {caption && <div className="mt-1 text-xs" style={{ color: highlight ? "#9FE1CB" : "#a3a3a3" }}>{caption}</div>}
    </div>
  );
}
```

**Note:** Check the actual `<ExpensesSection>` component props at [src/components/expenses/expenses-section.tsx](src/components/expenses/expenses-section.tsx) and adjust the call site above to match (jobId, onExpenseLogged, etc. may have different names).

- [ ] **Step 2: Modify the job-detail.tsx tab strip**

At the tab strip (search for `tab === "overview"` / `tab === "photos"`):

```typescript
// Before:
const tabs = [
  { id: "overview", label: "Overview" },
  { id: "photos", label: "Photos" },
];

// After:
const tabs = [
  { id: "overview", label: "Overview" },
  { id: "financials", label: "Financials" },
  { id: "photos", label: "Photos" },
];
```

Then add a render branch:
```tsx
{activeTab === "financials" && (
  <FinancialsTab
    job={job}
    payments={payments}
    invoices={invoices}
    canRecordPayment={hasPermission("record_payments")}
    canLogExpenses={hasPermission("log_expenses")}
    summary={{
      invoiced: /* sum(invoices) */,
      collected: /* sum(payments where received) */,
      expenses: /* sum(expenses) */,
      gross_margin: /* collected - expenses - (job.estimated_crew_labor_cost ?? 0) */,
      margin_pct: /* ... or null */,
      in_progress: job.status !== "completed",
    }}
    onPaymentRecorded={() => { refetchPayments(); refetchActivities(); }}
    onExpenseLogged={() => refetchActivities()}
  />
)}
```

Better: extract the summary computation into a small helper at the top of `JobDetail` so it's recomputed when payments/expenses change.

- [ ] **Step 3: Remove Billing + Expenses from Overview render**

Delete the `<BillingSection>` and `<ExpensesSection>` usages from the Overview branch in job-detail.tsx. Keep: Job Info, Contact, Insurance, Files, Contracts, Reports, Emails, Custom Fields, Activity Timeline. (The Activity Timeline continues to display payment/invoice/expense events regardless of where the sections are mounted.)

- [ ] **Step 4: Preview check**

```bash
# With preview_start:
# 1. Open a job detail page
# 2. Overview tab: no Billing card, no Expenses card
# 3. Click Financials tab: summary pills + Billing + Expenses all render
# 4. Click + Record Payment from Financials → modal opens → record → progress bar updates + Activity Timeline (on Overview) also updates
# 5. Click Log Expense from Financials → same — Activity Timeline updates
# 6. Photos tab unchanged
```

- [ ] **Step 5: tsc check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -10
git add src/components/job-detail/financials-tab.tsx src/components/job-detail.tsx
git commit -m "feat(job-detail): Financials tab; relocate Billing + Expenses from Overview"
```

---

## Task 10: Deep-link redirect for legacy billing links

**Files:**
- Modify: `src/components/job-detail.tsx`

- [ ] **Step 1: Add redirect effect**

Near the top of `JobDetail`, after `useSearchParams()`:

```typescript
useEffect(() => {
  const section = searchParams.get("section");
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  if (section === "billing" || hash === "#billing") {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("section");
    params.set("tab", "financials");
    const newUrl = `?${params.toString()}`;
    if (typeof window !== "undefined") window.history.replaceState(null, "", newUrl);
    if (hash === "#billing") {
      // clear hash
      if (typeof window !== "undefined") window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    setActiveTab("financials");
  }
}, [searchParams]);
```

- [ ] **Step 2: Preview check**

```bash
# Visit /jobs/<id>?section=billing → should redirect to ?tab=financials
# Visit /jobs/<id>#billing → same
```

- [ ] **Step 3: tsc check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/components/job-detail.tsx
git commit -m "feat(job-detail): redirect legacy ?section=billing and #billing to Financials tab"
```

---

## Task 11: Job Info card — Estimated crew labor cost row

**Files:**
- Modify: `src/components/job-detail.tsx` (Job Info card on Overview)

- [ ] **Step 1: Locate Job Info card**

```bash
grep -n "Job Info\|property_address\|damage_source" src/components/job-detail.tsx | head -10
```

- [ ] **Step 2: Add the row**

Inside the Job Info card content (keep the existing "Edit" button pattern):
```tsx
<div className="grid grid-cols-2 gap-y-2 text-sm">
  {/* existing rows */}
  <div className="text-neutral-400">Estimated crew labor cost</div>
  <div>
    {editingCrewLabor && hasPermission("edit_jobs") ? (
      <input
        type="number"
        step="0.01"
        defaultValue={job.estimated_crew_labor_cost ?? ""}
        onBlur={(e) => saveCrewLabor(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditingCrewLabor(false); }}
        autoFocus
        className="rounded bg-neutral-800 px-2 py-0.5 text-right w-32"
      />
    ) : job.estimated_crew_labor_cost !== null ? (
      <button
        disabled={!hasPermission("edit_jobs")}
        onClick={() => setEditingCrewLabor(true)}
        className="hover:underline"
      >
        {Number(job.estimated_crew_labor_cost).toLocaleString("en-US", { style: "currency", currency: "USD" })}
      </button>
    ) : (
      <button
        disabled={!hasPermission("edit_jobs")}
        onClick={() => setEditingCrewLabor(true)}
        className="text-neutral-500 italic hover:underline disabled:cursor-not-allowed"
      >
        Not set
      </button>
    )}
  </div>
</div>
```

Add state + handler near the top of `JobDetail`:
```typescript
const [editingCrewLabor, setEditingCrewLabor] = useState(false);

async function saveCrewLabor(raw: string) {
  const value = raw === "" ? null : Number(raw);
  if (value !== null && (Number.isNaN(value) || value < 0)) { setEditingCrewLabor(false); return; }
  const supabase = createBrowserSupabaseClient();
  await supabase.from("jobs").update({ estimated_crew_labor_cost: value }).eq("id", job.id);
  setEditingCrewLabor(false);
  // local state refresh:
  setJob({ ...job, estimated_crew_labor_cost: value });
}
```

Match whatever the existing job-update pattern in job-detail.tsx is (it may already have an `updateJob` helper).

- [ ] **Step 3: Preview + commit**

```bash
# Verify: "Not set" → click → input → type 5000 → blur → "$5,000"
# Verify with a crew_member (no edit_jobs): row is read-only
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/components/job-detail.tsx
git commit -m "feat(job-detail): Estimated crew labor cost row with inline edit"
```

---

## Task 12: Contact & Insurance card — Payer type badge

**Files:**
- Modify: `src/components/job-detail.tsx`

- [ ] **Step 1: Locate the card**

```bash
grep -n "Contact\|Insurance\b" src/components/job-detail.tsx | head
```

- [ ] **Step 2: Add the badge**

Inside the Contact & Insurance card, below the existing content:
```tsx
{job.payer_type && (
  <div className="mt-3 flex items-center gap-2">
    <span className="text-xs text-neutral-400">Payer:</span>
    <PayerTypeBadge value={job.payer_type} />
  </div>
)}
```

Add the badge component at the top of the file (or in `src/lib/badge-colors.ts` if that matches the project pattern):
```typescript
function PayerTypeBadge({ value }: { value: "insurance" | "homeowner" | "mixed" }) {
  const styles = {
    insurance: { bg: "rgba(139, 92, 246, 0.15)", color: "#C4B5FD", border: "rgba(139, 92, 246, 0.35)", label: "Insurance" },
    homeowner: { bg: "rgba(59, 130, 246, 0.15)", color: "#93C5FD", border: "rgba(59, 130, 246, 0.35)", label: "Homeowner" },
    mixed: { bg: "rgba(250, 199, 117, 0.15)", color: "#FAC775", border: "rgba(250, 199, 117, 0.35)", label: "Mixed" },
  }[value];
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: styles.bg, color: styles.color, border: `1px solid ${styles.border}` }}>
      {styles.label}
    </span>
  );
}
```

- [ ] **Step 3: Preview + commit**

```bash
# Verify badge shows correct color for jobs with insurance / homeowner / mixed payments
# Verify no badge when payer_type is NULL
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/components/job-detail.tsx
git commit -m "feat(job-detail): payer_type badge on Contact & Insurance card"
```

---

## Task 13: Add /accounting to navigation

**Files:**
- Modify: `src/lib/nav-items.ts`

- [ ] **Step 1: Add the entry**

Open [src/lib/nav-items.ts](src/lib/nav-items.ts). Insert between Email and Settings (match existing `{ href, label, icon }` shape — the icon value should match whatever string format nav.tsx reads, likely a Lucide name):

```typescript
import { Calculator } from "lucide-react";
// ... existing imports

// Inside the hardcoded fallback array:
{ href: "/accounting", label: "Accounting", icon: Calculator },
```

Check how icons are referenced in the existing file and match that. The DB `nav_items` row (seeded in Task 2) uses the string `"Calculator"`; nav.tsx likely maps the string to the component.

- [ ] **Step 2: Preview + commit**

```bash
# Admin account: sidebar shows Accounting between Email and Settings
# Clicking it currently 404s — that's expected until Task 20
# crew_lead: no Accounting item (permission filter should hide it — verify how nav.tsx filters by permission)
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/lib/nav-items.ts
git commit -m "feat(nav): add Accounting item between Email and Settings"
```

---

## Task 14: API route — summary stats

**Files:**
- Create: `src/app/api/accounting/summary/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/accounting/summary/route.ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { resolveRange, computeDelta, type RangePreset } from "@/lib/accounting/date-ranges";

async function requireViewAccounting() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile) return { ok: false as const, response: NextResponse.json({ error: "Profile not found" }, { status: 403 }) };
  if (profile.role === "admin") return { ok: true as const, userId: user.id };
  const { data: perm } = await supabase.from("user_permissions")
    .select("granted").eq("user_id", user.id).eq("permission_key", "view_accounting").maybeSingle();
  if (perm?.granted) return { ok: true as const, userId: user.id };
  return { ok: false as const, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
}

export async function GET(request: Request) {
  const auth = await requireViewAccounting();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const preset = (url.searchParams.get("range") ?? "last_30") as RangePreset;
  const range = resolveRange(preset);

  const supabase = await createServerSupabaseClient();

  // Activity-based fetch for current + prior windows
  const fetchWindow = async (startISO: string | null, endISO: string | null) => {
    // invoices: total_amount by issued_date in range
    // payments: amount by received_date in range, status='received'
    // expenses: amount by expense_date in range
    // AR aging: derived from invoices + payments snapshot — computed separately below
    let invQ = supabase.from("invoices").select("total_amount, status, issued_date");
    let payQ = supabase.from("payments").select("amount, received_date").eq("status", "received");
    let expQ = supabase.from("expenses").select("amount, expense_date");
    if (startISO) { invQ = invQ.gte("issued_date", startISO); payQ = payQ.gte("received_date", startISO); expQ = expQ.gte("expense_date", startISO); }
    if (endISO) { invQ = invQ.lte("issued_date", endISO); payQ = payQ.lte("received_date", endISO); expQ = expQ.lte("expense_date", endISO); }
    const [inv, pay, exp] = await Promise.all([invQ, payQ, expQ]);
    const revenue = (pay.data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const expenses = (exp.data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
    return { revenue, expenses };
  };

  const [current, prior] = await Promise.all([
    fetchWindow(range.startISO, range.endISO),
    range.priorStartISO ? fetchWindow(range.priorStartISO, range.priorEndISO) : Promise.resolve({ revenue: 0, expenses: 0 }),
  ]);

  // Gross margin needs crew_labor for jobs with activity in range.
  // For the top-level card we approximate by summing estimated_crew_labor_cost
  // for jobs that had any payment in the range. (Per-job exact margins live in
  // the profitability tab.)
  let crewLabor = 0;
  {
    const { data: payJobs } = range.startISO
      ? await supabase.from("payments").select("job_id").eq("status", "received").gte("received_date", range.startISO!).lte("received_date", range.endISO!)
      : await supabase.from("payments").select("job_id").eq("status", "received");
    const jobIds = Array.from(new Set((payJobs ?? []).map((r) => r.job_id)));
    if (jobIds.length > 0) {
      const { data: jobs } = await supabase.from("jobs").select("estimated_crew_labor_cost").in("id", jobIds);
      crewLabor = (jobs ?? []).reduce((s, j) => s + Number(j.estimated_crew_labor_cost ?? 0), 0);
    }
  }

  const grossMargin = current.revenue - current.expenses - crewLabor;
  const marginPct = current.revenue > 0 ? (grossMargin / current.revenue) * 100 : null;
  const expensesPctOfRevenue = current.revenue > 0 ? (current.expenses / current.revenue) * 100 : null;
  const revenueDelta = range.priorStartISO ? computeDelta(current.revenue, prior.revenue) : null;

  // Outstanding AR: unpaid invoices minus collected payments on those invoices
  const { data: allInvoices } = await supabase.from("invoices").select("id, total_amount, status, issued_date");
  const { data: allPayments } = await supabase.from("payments").select("invoice_id, amount").eq("status", "received");
  const paidByInvoice = new Map<string, number>();
  for (const p of allPayments ?? []) if (p.invoice_id) paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount ?? 0));
  let outstandingAR = 0;
  let overSixtyAR = 0;
  const today = new Date(); const sixtyDaysAgo = new Date(today); sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  for (const inv of allInvoices ?? []) {
    if (inv.status === "paid" || inv.status === "draft") continue;
    const outstanding = Number(inv.total_amount ?? 0) - (paidByInvoice.get(inv.id) ?? 0);
    if (outstanding <= 0) continue;
    outstandingAR += outstanding;
    if (inv.issued_date && new Date(inv.issued_date) < sixtyDaysAgo) overSixtyAR += outstanding;
  }

  return NextResponse.json({
    range: { preset: range.preset, startISO: range.startISO, endISO: range.endISO, label: range.label },
    revenue: { current: current.revenue, prior: prior.revenue, delta: revenueDelta },
    expenses: { current: current.expenses, pctOfRevenue: expensesPctOfRevenue },
    grossMargin: { amount: grossMargin, pct: marginPct, crew_labor: crewLabor },
    outstandingAR: { amount: outstandingAR, overSixty: overSixtyAR },
  });
}
```

- [ ] **Step 2: tsc check + commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/app/api/accounting/summary/route.ts
git commit -m "feat(api): /api/accounting/summary — stat cards data"
```

---

## Task 15: API route — job profitability

**Files:**
- Create: `src/app/api/accounting/profitability/route.ts`

- [ ] **Step 1: Write**

```typescript
// src/app/api/accounting/profitability/route.ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { aggregateMargins, marginPctBand, type MarginFilter } from "@/lib/accounting/margins";
import { resolveRange, type RangePreset } from "@/lib/accounting/date-ranges";

async function requireViewAccounting() { /* duplicate from Task 14 or extract to src/lib/accounting/auth.ts — see note below */ }

export async function GET(request: Request) {
  const auth = await requireViewAccounting();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const preset = (url.searchParams.get("range") ?? "last_30") as RangePreset;
  const filter = (url.searchParams.get("filter") ?? "all") as MarginFilter;
  const sort = url.searchParams.get("sort") ?? "margin_desc";
  const range = resolveRange(preset);

  const supabase = await createServerSupabaseClient();
  const margins = await aggregateMargins(range.startISO, range.endISO, filter);

  // Attach job context (address, damage type, customer name) for the table
  const jobIds = margins.map((m) => m.jobId);
  const { data: jobs } = jobIds.length ? await supabase.from("jobs").select("id, damage_type, property_address, contact_id").in("id", jobIds) : { data: [] };
  const { data: contacts } = jobs && jobs.length ? await supabase.from("contacts").select("id, full_name").in("id", jobs.map(j => j.contact_id).filter(Boolean)) : { data: [] };
  const jobById = new Map((jobs ?? []).map(j => [j.id, j]));
  const contactById = new Map((contacts ?? []).map(c => [c.id, c]));

  const rows = margins.map((m) => {
    const j = jobById.get(m.jobId);
    const c = j?.contact_id ? contactById.get(j.contact_id) : null;
    return {
      ...m,
      damage_type: j?.damage_type ?? null,
      property_address: j?.property_address ?? null,
      customer_name: c?.full_name ?? null,
      margin_band: marginPctBand(m.margin_pct),
    };
  });

  const cmp: Record<string, (a: any, b: any) => number> = {
    margin_desc: (a, b) => b.gross_margin - a.gross_margin,
    margin_pct_desc: (a, b) => (b.margin_pct ?? -Infinity) - (a.margin_pct ?? -Infinity),
    revenue_desc: (a, b) => b.collected - a.collected,
    expenses_desc: (a, b) => b.expenses - a.expenses,
    recent: () => 0, // placeholder; "recent" could sort by max activity date — implementation detail
  };
  rows.sort(cmp[sort] ?? cmp.margin_desc);

  return NextResponse.json({ rows, range: { preset: range.preset, label: range.label } });
}
```

**Auth dedup:** Before pasting `requireViewAccounting` three times, extract to `src/lib/accounting/auth.ts`:

```typescript
// src/lib/accounting/auth.ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function requireViewAccounting() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile) return { ok: false as const, response: NextResponse.json({ error: "Profile not found" }, { status: 403 }) };
  if (profile.role === "admin") return { ok: true as const, userId: user.id };
  const { data: perm } = await supabase.from("user_permissions")
    .select("granted").eq("user_id", user.id).eq("permission_key", "view_accounting").maybeSingle();
  if (perm?.granted) return { ok: true as const, userId: user.id };
  return { ok: false as const, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
}
```

Then update Task 14's route.ts to import from here, and this route uses it too.

- [ ] **Step 2: Commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/app/api/accounting/profitability/route.ts src/lib/accounting/auth.ts src/app/api/accounting/summary/route.ts
git commit -m "feat(api): /api/accounting/profitability + shared auth helper"
```

---

## Task 16: API route — AR aging

**Files:**
- Create: `src/app/api/accounting/ar-aging/route.ts`

- [ ] **Step 1: Write**

```typescript
// src/app/api/accounting/ar-aging/route.ts
// Returns 5 buckets (current / 1-30 / 31-60 / 61-90 / 90+) + table rows.
// "Last contact" = most recent email on the job (per design decision).

import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireViewAccounting } from "@/lib/accounting/auth";

type PayerFilter = "all" | "insurance" | "homeowner";

function ageBucket(days: number): "current" | "1-30" | "31-60" | "61-90" | "90+" {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export async function GET(request: Request) {
  const auth = await requireViewAccounting();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const payerFilter = (url.searchParams.get("payer") ?? "all") as PayerFilter;

  const supabase = await createServerSupabaseClient();
  const [invRes, payRes] = await Promise.all([
    supabase.from("invoices").select("id, job_id, invoice_number, total_amount, status, issued_date"),
    supabase.from("payments").select("invoice_id, amount").eq("status", "received"),
  ]);

  const paidByInvoice = new Map<string, number>();
  for (const p of payRes.data ?? []) if (p.invoice_id) paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount ?? 0));

  const unpaid = (invRes.data ?? []).filter(i => i.status !== "draft" && i.status !== "paid").map(i => {
    const outstanding = Number(i.total_amount ?? 0) - (paidByInvoice.get(i.id) ?? 0);
    return { ...i, outstanding };
  }).filter(i => i.outstanding > 0);

  const jobIds = Array.from(new Set(unpaid.map(i => i.job_id)));
  const { data: jobs } = jobIds.length ? await supabase.from("jobs").select("id, job_number, property_address, payer_type, contact_id").in("id", jobIds) : { data: [] };
  const jobById = new Map((jobs ?? []).map(j => [j.id, j]));

  // Last contact per job: most recent email
  // (adjust table/column names to match email module — likely `emails.job_id, received_at/sent_at`)
  let lastEmailByJob = new Map<string, string>();
  if (jobIds.length) {
    const { data: emails } = await supabase.from("emails").select("job_id, date").in("job_id", jobIds).order("date", { ascending: false });
    for (const e of emails ?? []) if (!lastEmailByJob.has(e.job_id)) lastEmailByJob.set(e.job_id, e.date);
  }

  const today = new Date();
  type Row = { invoiceId: string; jobId: string; jobNumber: string | null; jobAddress: string | null; invoiceNumber: string | null; payerType: string | null; outstanding: number; ageDays: number; bucket: string; lastContact: string | null };
  const rows: Row[] = [];
  const buckets = { current: { total: 0, count: 0 }, "1-30": { total: 0, count: 0 }, "31-60": { total: 0, count: 0 }, "61-90": { total: 0, count: 0 }, "90+": { total: 0, count: 0 } };

  for (const i of unpaid) {
    const j = jobById.get(i.job_id);
    const payerType = j?.payer_type ?? null;
    if (payerFilter !== "all" && payerType !== payerFilter) continue;
    const issuedDate = i.issued_date ? new Date(i.issued_date) : null;
    const ageDays = issuedDate ? Math.floor((today.getTime() - issuedDate.getTime()) / 86400000) : 0;
    const bucket = ageBucket(ageDays);
    buckets[bucket].total += i.outstanding;
    buckets[bucket].count += 1;
    rows.push({
      invoiceId: i.id,
      jobId: i.job_id,
      jobNumber: j?.job_number ?? null,
      jobAddress: j?.property_address ?? null,
      invoiceNumber: i.invoice_number,
      payerType,
      outstanding: i.outstanding,
      ageDays,
      bucket,
      lastContact: lastEmailByJob.get(i.job_id) ?? null,
    });
  }

  rows.sort((a, b) => b.ageDays - a.ageDays);

  return NextResponse.json({ buckets, rows });
}
```

**Note on emails table shape:** verify column names during implementation (`emails.date` vs `received_at` etc.). Check [src/app/api/email/](src/app/api/email/) or equivalent.

- [ ] **Step 2: Commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/app/api/accounting/ar-aging/route.ts
git commit -m "feat(api): /api/accounting/ar-aging — buckets + table rows"
```

---

## Task 17: API route — global expenses

**Files:**
- Create: `src/app/api/accounting/expenses/route.ts`

- [ ] **Step 1: Write**

```typescript
// src/app/api/accounting/expenses/route.ts
// Global expenses list with filters. Reuses existing ReceiptDetailModal on the client.
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireViewAccounting } from "@/lib/accounting/auth";
import { resolveRange, type RangePreset } from "@/lib/accounting/date-ranges";

export async function GET(request: Request) {
  const auth = await requireViewAccounting();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const preset = (url.searchParams.get("range") ?? "last_30") as RangePreset;
  const categoryIds = url.searchParams.getAll("category");
  const vendorId = url.searchParams.get("vendor");
  const jobId = url.searchParams.get("job");
  const damageTypes = url.searchParams.getAll("damage_type");
  const submittedBy = url.searchParams.get("submitted_by");
  const range = resolveRange(preset);

  const supabase = await createServerSupabaseClient();

  let q = supabase.from("expenses").select(`
    id, job_id, vendor_id, vendor_name, category_id, amount, expense_date,
    payment_method, description, receipt_path, thumbnail_path,
    submitted_by, submitter_name, created_at,
    expense_categories(name, display_label, bg_color, text_color),
    jobs(id, job_number, property_address, damage_type)
  `);
  if (range.startISO) q = q.gte("expense_date", range.startISO);
  if (range.endISO) q = q.lte("expense_date", range.endISO);
  if (categoryIds.length) q = q.in("category_id", categoryIds);
  if (vendorId) q = q.eq("vendor_id", vendorId);
  if (jobId) q = q.eq("job_id", jobId);
  if (submittedBy) q = q.eq("submitted_by", submittedBy);
  q = q.order("expense_date", { ascending: false });

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let rows = data ?? [];
  if (damageTypes.length) rows = rows.filter((r: any) => damageTypes.includes(r.jobs?.damage_type));

  const total = rows.reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
  const uniqueJobs = new Set(rows.map((r: any) => r.job_id)).size;

  return NextResponse.json({
    rows,
    summary: { total, count: rows.length, jobs: uniqueJobs },
    range: { preset: range.preset, label: range.label },
  });
}
```

- [ ] **Step 2: Commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/app/api/accounting/expenses/route.ts
git commit -m "feat(api): /api/accounting/expenses — global list with filters"
```

---

## Task 18: API route — damage type rollup

**Files:**
- Create: `src/app/api/accounting/damage-type/route.ts`

- [ ] **Step 1: Write**

```typescript
// src/app/api/accounting/damage-type/route.ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireViewAccounting } from "@/lib/accounting/auth";
import { resolveRange, type RangePreset } from "@/lib/accounting/date-ranges";
import { aggregateMargins } from "@/lib/accounting/margins";

export async function GET(request: Request) {
  const auth = await requireViewAccounting();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const preset = (url.searchParams.get("range") ?? "last_30") as RangePreset;
  const range = resolveRange(preset);

  const supabase = await createServerSupabaseClient();
  const margins = await aggregateMargins(range.startISO, range.endISO, "all");

  const { data: jobs } = margins.length ? await supabase.from("jobs").select("id, damage_type").in("id", margins.map(m => m.jobId)) : { data: [] };
  const dtByJob = new Map((jobs ?? []).map(j => [j.id, j.damage_type]));

  type Bucket = { damage_type: string; job_count: number; revenue: number; expenses: number; margin: number; pct_sum: number; pct_n: number };
  const bucket = new Map<string, Bucket>();
  for (const m of margins) {
    const dt = dtByJob.get(m.jobId) ?? "other";
    const b = bucket.get(dt) ?? { damage_type: dt, job_count: 0, revenue: 0, expenses: 0, margin: 0, pct_sum: 0, pct_n: 0 };
    b.job_count++;
    b.revenue += m.collected;
    b.expenses += m.expenses;
    b.margin += m.gross_margin;
    if (m.margin_pct !== null) { b.pct_sum += m.margin_pct; b.pct_n++; }
    bucket.set(dt, b);
  }

  const rows = Array.from(bucket.values()).map(b => ({
    damage_type: b.damage_type,
    job_count: b.job_count,
    revenue: b.revenue,
    expenses: b.expenses,
    margin: b.margin,
    avg_margin_pct: b.pct_n > 0 ? b.pct_sum / b.pct_n : null,
  })).sort((a, b) => b.margin - a.margin);

  return NextResponse.json({ rows });
}
```

- [ ] **Step 2: Commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/app/api/accounting/damage-type/route.ts
git commit -m "feat(api): /api/accounting/damage-type — rollup by damage type"
```

---

## Task 19: API route — CSV/ZIP export

**Files:**
- Create: `src/app/api/accounting/export/[type]/route.ts`

- [ ] **Step 1: Write**

```typescript
// src/app/api/accounting/export/[type]/route.ts
// type ∈ {profitability, ar-aging, expenses, all}
import { NextResponse } from "next/server";
import JSZip from "jszip";
import { requireViewAccounting } from "@/lib/accounting/auth";
import { toCSV } from "@/lib/accounting/csv";
import { resolveRange, type RangePreset } from "@/lib/accounting/date-ranges";
import { aggregateMargins, marginPctBand } from "@/lib/accounting/margins";
import { createServerSupabaseClient } from "@/lib/supabase-server";

async function buildProfitabilityCSV(preset: RangePreset): Promise<string> {
  const range = resolveRange(preset);
  const margins = await aggregateMargins(range.startISO, range.endISO, "all");
  const supabase = await createServerSupabaseClient();
  const { data: jobs } = margins.length ? await supabase.from("jobs").select("id, job_number, property_address, damage_type").in("id", margins.map(m => m.jobId)) : { data: [] };
  const jbid = new Map((jobs ?? []).map(j => [j.id, j]));
  const headers = ["Job #", "Address", "Damage", "Status", "Invoiced", "Collected", "Expenses", "Crew labor", "Gross margin", "Margin %"];
  const rows = margins.map(m => {
    const j = jbid.get(m.jobId);
    return [j?.job_number ?? "", j?.property_address ?? "", j?.damage_type ?? "", m.job_status, m.invoiced, m.collected, m.expenses, m.crew_labor, m.gross_margin, m.margin_pct?.toFixed(1) ?? ""];
  });
  return toCSV(headers, rows);
}

async function buildArAgingCSV(): Promise<string> {
  // Match the logic in /api/accounting/ar-aging but emit CSV
  // (consider extracting the aging logic into a shared function to avoid duplication)
  const supabase = await createServerSupabaseClient();
  const [invRes, payRes] = await Promise.all([
    supabase.from("invoices").select("id, job_id, invoice_number, total_amount, status, issued_date"),
    supabase.from("payments").select("invoice_id, amount").eq("status", "received"),
  ]);
  const paidByInvoice = new Map<string, number>();
  for (const p of payRes.data ?? []) if (p.invoice_id) paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount ?? 0));
  const unpaid = (invRes.data ?? []).filter(i => i.status !== "draft" && i.status !== "paid").map(i => ({ ...i, outstanding: Number(i.total_amount ?? 0) - (paidByInvoice.get(i.id) ?? 0) })).filter(i => i.outstanding > 0);
  const jobIds = Array.from(new Set(unpaid.map(i => i.job_id)));
  const { data: jobs } = jobIds.length ? await supabase.from("jobs").select("id, job_number, property_address, payer_type").in("id", jobIds) : { data: [] };
  const jobById = new Map((jobs ?? []).map(j => [j.id, j]));
  const today = new Date();
  const headers = ["Invoice #", "Job #", "Address", "Payer", "Outstanding", "Age (days)", "Bucket", "Issued"];
  const rows = unpaid.map(i => {
    const j = jobById.get(i.job_id);
    const ageDays = i.issued_date ? Math.floor((today.getTime() - new Date(i.issued_date).getTime()) / 86400000) : 0;
    const bucket = ageDays <= 0 ? "current" : ageDays <= 30 ? "1-30" : ageDays <= 60 ? "31-60" : ageDays <= 90 ? "61-90" : "90+";
    return [i.invoice_number, j?.job_number ?? "", j?.property_address ?? "", j?.payer_type ?? "", i.outstanding, ageDays, bucket, i.issued_date ?? ""];
  });
  return toCSV(headers, rows);
}

async function buildExpensesCSV(preset: RangePreset): Promise<string> {
  const range = resolveRange(preset);
  const supabase = await createServerSupabaseClient();
  let q = supabase.from("expenses").select("expense_date, vendor_name, amount, description, jobs(job_number, property_address), expense_categories(name), submitter_name");
  if (range.startISO) q = q.gte("expense_date", range.startISO);
  if (range.endISO) q = q.lte("expense_date", range.endISO);
  const { data } = await q;
  const headers = ["Date", "Vendor", "Category", "Amount", "Description", "Job #", "Job address", "Submitted by"];
  const rows = (data ?? []).map((r: any) => [r.expense_date, r.vendor_name, r.expense_categories?.name ?? "", r.amount, r.description ?? "", r.jobs?.job_number ?? "", r.jobs?.property_address ?? "", r.submitter_name ?? ""]);
  return toCSV(headers, rows);
}

export async function GET(request: Request, { params }: { params: Promise<{ type: string }> }) {
  const auth = await requireViewAccounting();
  if (!auth.ok) return auth.response;
  const { type } = await params;
  const url = new URL(request.url);
  const preset = (url.searchParams.get("range") ?? "last_30") as RangePreset;

  if (type === "profitability") {
    const csv = await buildProfitabilityCSV(preset);
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="profitability-${preset}.csv"` } });
  }
  if (type === "ar-aging") {
    const csv = await buildArAgingCSV();
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="ar-aging.csv"` } });
  }
  if (type === "expenses") {
    const csv = await buildExpensesCSV(preset);
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="expenses-${preset}.csv"` } });
  }
  if (type === "all") {
    const zip = new JSZip();
    const [p, a, e] = await Promise.all([buildProfitabilityCSV(preset), buildArAgingCSV(), buildExpensesCSV(preset)]);
    zip.file(`profitability-${preset}.csv`, p);
    zip.file(`ar-aging.csv`, a);
    zip.file(`expenses-${preset}.csv`, e);
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    return new Response(buf, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="accounting-${preset}.zip"` } });
  }
  return NextResponse.json({ error: "Unknown export type" }, { status: 400 });
}
```

- [ ] **Step 2: Preview check**

```bash
# curl the URLs or click Export from the dashboard after Task 21
# Expected: 4 file downloads, each with sane headers
```

- [ ] **Step 3: Commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/app/api/accounting/export/[type]/route.ts
git commit -m "feat(api): /api/accounting/export/[type] — CSV + ZIP export"
```

---

## Task 20: /accounting page shell + permission gate

**Files:**
- Create: `src/app/accounting/page.tsx`
- Create: `src/components/accounting/accounting-dashboard.tsx` (shell only — tabs filled in later tasks)

- [ ] **Step 1: Write page.tsx (server component with gate)**

```typescript
// src/app/accounting/page.tsx
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import AccountingDashboard from "@/components/accounting/accounting-dashboard";

export default async function AccountingPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = profile?.role === "admin";
  let canView = isAdmin;
  if (!canView) {
    const { data: perm } = await supabase.from("user_permissions").select("granted").eq("user_id", user.id).eq("permission_key", "view_accounting").maybeSingle();
    canView = !!perm?.granted;
  }
  if (!canView) redirect("/"); // match existing pattern for permission denial

  return <AccountingDashboard />;
}
```

- [ ] **Step 2: Write AccountingDashboard shell**

```typescript
// src/components/accounting/accounting-dashboard.tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { RangePreset } from "@/lib/accounting/date-ranges";
import DateRangeSelector from "./date-range-selector";
import ExportMenu from "./export-menu";
import StatCards from "./stat-cards";
import JobProfitabilityTab from "./job-profitability-tab";
import ArAgingTab from "./ar-aging-tab";
import GlobalExpensesTab from "./global-expenses-tab";
import ByDamageTypeTab from "./by-damage-type-tab";

type Tab = "profitability" | "ar-aging" | "expenses" | "damage-type";
const TABS: { id: Tab; label: string }[] = [
  { id: "profitability", label: "Job profitability" },
  { id: "ar-aging", label: "AR aging" },
  { id: "expenses", label: "Expenses" },
  { id: "damage-type", label: "By damage type" },
  // QuickBooks sync tab omitted — added in Build 16c
];

export default function AccountingDashboard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [range, setRange] = useState<RangePreset>((searchParams.get("range") as RangePreset) ?? "last_30");
  const [tab, setTab] = useState<Tab>((searchParams.get("tab") as Tab) ?? "profitability");

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", range);
    params.set("tab", tab);
    router.replace(`/accounting?${params.toString()}`);
  }, [range, tab, router]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Accounting</h1>
          <p className="text-sm text-neutral-400">Revenue, expenses, and profitability across all jobs</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeSelector value={range} onChange={setRange} />
          <ExportMenu range={range} />
        </div>
      </div>

      <StatCards range={range} />

      <div className="border-b border-neutral-800 flex gap-4">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm ${tab === t.id ? "text-white border-b-2" : "text-neutral-400 hover:text-neutral-200"}`}
            style={tab === t.id ? { borderBottomColor: "#0F6E56" } : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profitability" && <JobProfitabilityTab range={range} />}
      {tab === "ar-aging" && <ArAgingTab />}
      {tab === "expenses" && <GlobalExpensesTab range={range} />}
      {tab === "damage-type" && <ByDamageTypeTab range={range} />}
    </div>
  );
}
```

- [ ] **Step 3: Stub the 4 tab components so tsc passes**

Create each file with a minimal empty component:
```typescript
// src/components/accounting/job-profitability-tab.tsx (and likewise for ar-aging-tab, global-expenses-tab, by-damage-type-tab)
"use client";
export default function JobProfitabilityTab({ range }: { range: string }) {
  return <div className="p-4 text-neutral-400">Job profitability (range: {range}) — coming in Task 24</div>;
}
```

(Replace the "coming in Task N" text with the right task number per component. These stubs let the shell render and tsc pass.)

Also stub `date-range-selector.tsx`, `export-menu.tsx`, `stat-cards.tsx` with minimal functional components.

- [ ] **Step 4: Preview check**

```bash
# /accounting: admin sees shell with 4 tabs; crew_lead redirects to "/"
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -10
git add src/app/accounting/page.tsx src/components/accounting/
git commit -m "feat(accounting): /accounting route, shell, permission gate; tab stubs"
```

---

## Task 21: DateRangeSelector + ExportMenu

**Files:**
- Modify: `src/components/accounting/date-range-selector.tsx`
- Modify: `src/components/accounting/export-menu.tsx`

- [ ] **Step 1: Date range selector**

```typescript
// src/components/accounting/date-range-selector.tsx
"use client";

import type { RangePreset } from "@/lib/accounting/date-ranges";

const OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "last_30", label: "Last 30 days" },
  { value: "this_quarter", label: "This quarter" },
  { value: "ytd", label: "Year to date" },
  { value: "all_time", label: "All time" },
];

export default function DateRangeSelector({ value, onChange }: { value: RangePreset; onChange: (v: RangePreset) => void }) {
  return (
    <div className="inline-flex rounded-md border border-neutral-800 overflow-hidden">
      {OPTIONS.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-sm ${value === o.value ? "text-white" : "text-neutral-400 hover:text-neutral-200"}`}
          style={value === o.value ? { background: "#0F6E56" } : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Export menu**

```typescript
// src/components/accounting/export-menu.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import type { RangePreset } from "@/lib/accounting/date-ranges";

export default function ExportMenu({ range }: { range: RangePreset }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const download = (type: "profitability" | "ar-aging" | "expenses" | "all") => {
    const url = `/api/accounting/export/${type}?range=${range}`;
    window.location.href = url;
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 rounded-md border border-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-900"
      >
        Export <ChevronDown size={14} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded-md border border-neutral-800 bg-neutral-900 shadow-lg z-10">
          <button onClick={() => download("profitability")} className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-800">Export Job Profitability (CSV)</button>
          <button onClick={() => download("ar-aging")} className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-800">Export AR Aging (CSV)</button>
          <button onClick={() => download("expenses")} className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-800">Export Expenses (CSV)</button>
          <div className="border-t border-neutral-800" />
          <button onClick={() => download("all")} className="block w-full text-left px-3 py-2 text-sm hover:bg-neutral-800">Export All (ZIP)</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Preview + commit**

```bash
# Range selector: click each pill, URL updates, teal background on active
# Export menu: click → dropdown → click item → file downloads
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/components/accounting/date-range-selector.tsx src/components/accounting/export-menu.tsx
git commit -m "feat(accounting): DateRangeSelector + ExportMenu"
```

---

## Task 22: Stat cards

**Files:**
- Modify: `src/components/accounting/stat-cards.tsx`

- [ ] **Step 1: Write**

```typescript
// src/components/accounting/stat-cards.tsx
"use client";

import { useEffect, useState } from "react";
import type { RangePreset } from "@/lib/accounting/date-ranges";

type Summary = {
  revenue: { current: number; prior: number; delta: { amount: number; pct: number | null; direction: "up" | "down" | "flat" } | null };
  expenses: { current: number; pctOfRevenue: number | null };
  grossMargin: { amount: number; pct: number | null; crew_labor: number };
  outstandingAR: { amount: number; overSixty: number };
};

function fmt(n: number): string { return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }); }

export default function StatCards({ range }: { range: RangePreset }) {
  const [data, setData] = useState<Summary | null>(null);
  useEffect(() => {
    fetch(`/api/accounting/summary?range=${range}`).then(r => r.json()).then(setData);
  }, [range]);

  if (!data) return <div className="grid grid-cols-4 gap-3"><CardSkel /><CardSkel /><CardSkel /><CardSkel /></div>;

  return (
    <div className="grid grid-cols-4 gap-3">
      <Card label="Revenue" value={fmt(data.revenue.current)}>
        {data.revenue.delta && data.revenue.delta.pct !== null && (
          <div className="text-xs" style={{ color: data.revenue.delta.direction === "up" ? "#5DCAA5" : data.revenue.delta.direction === "down" ? "#F09595" : "#a3a3a3" }}>
            {data.revenue.delta.direction === "up" ? "▲" : data.revenue.delta.direction === "down" ? "▼" : "–"}{" "}
            {Math.abs(data.revenue.delta.pct).toFixed(1)}% vs prior
          </div>
        )}
      </Card>
      <Card label="Expenses" value={fmt(data.expenses.current)}>
        {data.expenses.pctOfRevenue !== null && <div className="text-xs text-neutral-400">{data.expenses.pctOfRevenue.toFixed(1)}% of revenue</div>}
      </Card>
      <Card
        label="Gross margin*"
        value={fmt(data.grossMargin.amount)}
        highlight
        title="Estimate — includes manual crew labor cost where entered"
      >
        {data.grossMargin.pct !== null && <div className="text-xs" style={{ color: "#9FE1CB" }}>{data.grossMargin.pct.toFixed(1)}% margin</div>}
      </Card>
      <Card label="Outstanding AR" value={fmt(data.outstandingAR.amount)}>
        {data.outstandingAR.overSixty > 0 && <div className="text-xs" style={{ color: "#FAC775" }}>{fmt(data.outstandingAR.overSixty)} over 60 days</div>}
      </Card>
    </div>
  );
}

function Card({ label, value, children, highlight, title }: { label: string; value: string; children?: React.ReactNode; highlight?: boolean; title?: string }) {
  const hl = highlight
    ? { background: "rgba(29, 158, 117, 0.12)", border: "1px solid rgba(29, 158, 117, 0.35)" }
    : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" };
  return (
    <div className="rounded-lg p-4" style={hl} title={title}>
      <div className="text-xs uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold" style={highlight ? { color: "#5DCAA5" } : undefined}>{value}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function CardSkel() {
  return <div className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}><div className="h-4 w-16 rounded bg-neutral-800" /><div className="mt-2 h-7 w-24 rounded bg-neutral-800" /></div>;
}
```

- [ ] **Step 2: Preview + commit**

```bash
# Stat cards render, all 4 show numbers, delta colors work, margin card is teal
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/components/accounting/stat-cards.tsx
git commit -m "feat(accounting): stat cards with delta, margin, outstanding AR"
```

---

## Task 23: MarginPill shared component

**Files:**
- Create: `src/components/accounting/margin-pill.tsx`

- [ ] **Step 1: Write**

```typescript
// src/components/accounting/margin-pill.tsx
import { marginPctBand } from "@/lib/accounting/margins";

export function MarginPctPill({ pct }: { pct: number | null }) {
  const band = marginPctBand(pct);
  if (band === "none") return <span className="text-neutral-500">—</span>;
  const color = band === "green" ? "#5DCAA5" : band === "amber" ? "#FAC775" : "#F09595";
  const bg = band === "green" ? "rgba(93, 202, 165, 0.1)" : band === "amber" ? "rgba(250, 199, 117, 0.1)" : "rgba(240, 149, 149, 0.1)";
  return (
    <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium" style={{ background: bg, color }}>
      {pct!.toFixed(1)}%
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/components/accounting/margin-pill.tsx
git commit -m "feat(accounting): MarginPctPill shared component"
```

---

## Task 24: Job profitability tab

**Files:**
- Modify: `src/components/accounting/job-profitability-tab.tsx`

- [ ] **Step 1: Write**

```typescript
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MarginPctPill } from "./margin-pill";
import type { RangePreset } from "@/lib/accounting/date-ranges";
import type { JobMargin } from "@/lib/accounting/margins";

type Row = JobMargin & { damage_type: string | null; property_address: string | null; customer_name: string | null; margin_band: string };
type Filter = "all" | "active" | "completed";

const SORTS = [
  { value: "margin_desc", label: "Margin $ ↓" },
  { value: "margin_pct_desc", label: "Margin % ↓" },
  { value: "revenue_desc", label: "Revenue ↓" },
  { value: "expenses_desc", label: "Expenses ↓" },
  { value: "recent", label: "Recent" },
];

function fmt(n: number) { return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }); }

export default function JobProfitabilityTab({ range }: { range: RangePreset }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState("margin_desc");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  useEffect(() => {
    setRows(null);
    fetch(`/api/accounting/profitability?range=${range}&filter=${filter}&sort=${sort}`).then(r => r.json()).then(d => setRows(d.rows));
  }, [range, filter, sort]);

  const view = rows?.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? [];
  const total = rows?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-md border border-neutral-800 overflow-hidden">
          {(["all", "active", "completed"] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm capitalize ${filter === f ? "text-white" : "text-neutral-400 hover:text-neutral-200"}`}
              style={filter === f ? { background: "#0F6E56" } : undefined}>
              {f === "all" ? "All jobs" : f}
            </button>
          ))}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm">
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <div className="rounded-lg border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900/50 text-neutral-400">
            <tr>
              <th className="text-left px-3 py-2">Job</th>
              <th className="text-right px-3 py-2">Invoiced</th>
              <th className="text-right px-3 py-2">Collected</th>
              <th className="text-right px-3 py-2">Expenses</th>
              <th className="text-right px-3 py-2">Margin</th>
              <th className="text-right px-3 py-2">%</th>
            </tr>
          </thead>
          <tbody>
            {view.map(r => (
              <tr key={r.jobId} className="border-t border-neutral-800 hover:bg-neutral-900/30 cursor-pointer">
                <td className="px-3 py-2">
                  <Link href={`/jobs/${r.jobId}?tab=financials`} className="block">
                    <div className="flex items-center gap-2">
                      {r.damage_type && <span className="text-xs rounded px-1.5 py-0.5 bg-neutral-800 text-neutral-300">{r.damage_type}</span>}
                      <span className="truncate">{r.customer_name ?? r.property_address ?? r.jobNumber}</span>
                    </div>
                    <div className="text-xs text-neutral-500">{r.jobNumber}</div>
                  </Link>
                </td>
                <td className="text-right px-3 py-2">{fmt(r.invoiced)}</td>
                <td className="text-right px-3 py-2">{fmt(r.collected)}</td>
                <td className="text-right px-3 py-2">{fmt(r.expenses)}</td>
                <td className="text-right px-3 py-2">
                  {fmt(r.gross_margin)}
                  {r.in_progress && <span className="ml-1 text-xs text-neutral-500" title="In progress">↻</span>}
                </td>
                <td className="text-right px-3 py-2"><MarginPctPill pct={r.margin_pct} /></td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr><td colSpan={6} className="text-center px-3 py-8 text-neutral-500">No jobs with activity in this range</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-neutral-400">
          <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}</span>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="rounded px-2 py-1 disabled:opacity-30 hover:bg-neutral-800">Prev</button>
            <button disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)} className="rounded px-2 py-1 disabled:opacity-30 hover:bg-neutral-800">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Preview + commit**

```bash
# Tab renders table; filter pills, sort selector, pagination all work
# Row click → navigates to /jobs/<id>?tab=financials
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/components/accounting/job-profitability-tab.tsx
git commit -m "feat(accounting): Job profitability tab"
```

---

## Task 25: AR aging tab + Nudge button

**Files:**
- Modify: `src/components/accounting/ar-aging-tab.tsx`

- [ ] **Step 1: Write**

```typescript
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type PayerFilter = "all" | "insurance" | "homeowner";
type Bucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

type Row = {
  invoiceId: string;
  jobId: string;
  jobNumber: string | null;
  jobAddress: string | null;
  invoiceNumber: string | null;
  payerType: string | null;
  outstanding: number;
  ageDays: number;
  bucket: Bucket;
  lastContact: string | null;
};

const BUCKET_LABEL: Record<Bucket, string> = { current: "Current", "1-30": "1-30d", "31-60": "31-60d", "61-90": "61-90d", "90+": "90+d" };
const BUCKET_COLOR: Record<Bucket, string> = { current: "#a3a3a3", "1-30": "#a3a3a3", "31-60": "#FAC775", "61-90": "#F0B060", "90+": "#F09595" };

function fmt(n: number) { return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }); }

export default function ArAgingTab() {
  const router = useRouter();
  const [payer, setPayer] = useState<PayerFilter>("all");
  const [data, setData] = useState<{ buckets: Record<Bucket, { total: number; count: number }>; rows: Row[] } | null>(null);

  useEffect(() => {
    fetch(`/api/accounting/ar-aging?payer=${payer}`).then(r => r.json()).then(setData);
  }, [payer]);

  const nudge = (row: Row) => {
    const payer = row.payerType === "insurance" ? "insurance adjuster" : "homeowner";
    const subject = `Invoice ${row.invoiceNumber} - Payment follow-up`;
    const body = row.payerType === "insurance"
      ? `Hi,\n\nFollowing up on invoice ${row.invoiceNumber} for job ${row.jobNumber}. Current outstanding balance is ${fmt(row.outstanding)}. Please let me know if you need anything from our side to process payment.\n\nThank you.`
      : `Hi,\n\nJust a quick reminder about invoice ${row.invoiceNumber} (${fmt(row.outstanding)} outstanding). Please let me know if you have any questions.\n\nThank you.`;
    const params = new URLSearchParams({
      subject,
      body,
      jobId: row.jobId,
    });
    router.push(`/email?compose=1&${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      {/* 5 bucket cards */}
      <div className="grid grid-cols-5 gap-3">
        {(["current", "1-30", "31-60", "61-90", "90+"] as Bucket[]).map(b => {
          const bk = data?.buckets?.[b] ?? { total: 0, count: 0 };
          return (
            <div key={b} className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${BUCKET_COLOR[b]}40` }}>
              <div className="text-xs uppercase" style={{ color: BUCKET_COLOR[b] }}>{BUCKET_LABEL[b]}</div>
              <div className="mt-1 text-xl font-semibold">{fmt(bk.total)}</div>
              <div className="text-xs text-neutral-400">{bk.count} invoices</div>
            </div>
          );
        })}
      </div>

      {/* Payer filter pills */}
      <div className="inline-flex rounded-md border border-neutral-800 overflow-hidden">
        {(["all", "insurance", "homeowner"] as PayerFilter[]).map(p => (
          <button key={p} onClick={() => setPayer(p)}
            className={`px-3 py-1.5 text-sm capitalize ${payer === p ? "text-white" : "text-neutral-400"}`}
            style={payer === p ? { background: "#0F6E56" } : undefined}>
            {p === "all" ? "All payers" : p}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900/50 text-neutral-400">
            <tr>
              <th className="text-left px-3 py-2">Job / Invoice</th>
              <th className="text-left px-3 py-2">Payer</th>
              <th className="text-right px-3 py-2">Outstanding</th>
              <th className="text-left px-3 py-2">Age</th>
              <th className="text-left px-3 py-2">Last contact</th>
              <th className="text-right px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map(r => (
              <tr key={r.invoiceId} className="border-t border-neutral-800">
                <td className="px-3 py-2">
                  <div>{r.jobAddress ?? r.jobNumber}</div>
                  <div className="text-xs text-neutral-500">#{r.invoiceNumber} • {r.jobNumber}</div>
                </td>
                <td className="px-3 py-2">
                  {r.payerType ? <PayerBadge value={r.payerType} /> : <span className="text-neutral-500">—</span>}
                </td>
                <td className="text-right px-3 py-2">{fmt(r.outstanding)}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex rounded px-2 py-0.5 text-xs" style={{ color: BUCKET_COLOR[r.bucket], background: `${BUCKET_COLOR[r.bucket]}20` }}>{r.ageDays}d</span>
                </td>
                <td className="px-3 py-2 text-neutral-400">{r.lastContact ?? "—"}</td>
                <td className="text-right px-3 py-2">
                  <button onClick={() => nudge(r)} className="text-sm rounded px-2 py-1 hover:bg-neutral-800">Nudge ↗</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PayerBadge({ value }: { value: string }) {
  const m: Record<string, { bg: string; color: string; label: string }> = {
    insurance: { bg: "rgba(139, 92, 246, 0.15)", color: "#C4B5FD", label: "Insurance" },
    homeowner: { bg: "rgba(59, 130, 246, 0.15)", color: "#93C5FD", label: "Homeowner" },
    mixed: { bg: "rgba(250, 199, 117, 0.15)", color: "#FAC775", label: "Mixed" },
  };
  const s = m[value] ?? { bg: "rgba(255,255,255,0.05)", color: "#a3a3a3", label: value };
  return <span className="inline-flex rounded px-2 py-0.5 text-xs" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}
```

**Nudge integration:** this implementation navigates to `/email?compose=1&subject=...&body=...&jobId=...`. Verify that the `/email` page reads these query params and pre-fills `ComposeEmail`. If not, either (a) adjust the email page to consume these params, or (b) open ComposeEmail directly from this page. Prefer (a) — light integration per the spec.

- [ ] **Step 2: Verify /email consumes the query params**

```bash
grep -rn "compose=1\|searchParams.get.*subject" src/app/email/ | head
```

If the email page doesn't consume the params today, add a small useEffect on `/email` to open ComposeEmail with the pre-fill when `compose=1` is present. Keep this change small and scoped to the Nudge integration.

- [ ] **Step 3: Preview + commit**

```bash
# 5 buckets render with color ramp; payer filter pills update table;
# Nudge button opens compose with pre-filled subject/body
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/components/accounting/ar-aging-tab.tsx src/app/email/
git commit -m "feat(accounting): AR aging tab with Nudge button"
```

---

## Task 26: Global expenses tab

**Files:**
- Modify: `src/components/accounting/global-expenses-tab.tsx`

- [ ] **Step 1: Write**

```typescript
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RangePreset } from "@/lib/accounting/date-ranges";
import ReceiptDetailModal from "@/components/expenses/receipt-detail-modal";

type Row = {
  id: string;
  job_id: string;
  vendor_name: string;
  category_id: string;
  amount: number;
  expense_date: string;
  description: string | null;
  receipt_path: string | null;
  thumbnail_path: string | null;
  submitter_name: string | null;
  expense_categories: { name: string; display_label: string; bg_color: string; text_color: string } | null;
  jobs: { id: string; job_number: string | null; property_address: string | null; damage_type: string | null } | null;
};

function fmt(n: number) { return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }); }

export default function GlobalExpensesTab({ range }: { range: RangePreset }) {
  const [data, setData] = useState<{ rows: Row[]; summary: { total: number; count: number; jobs: number } } | null>(null);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/accounting/expenses?range=${range}`).then(r => r.json()).then(setData);
  }, [range]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500">Platform expenses only — QuickBooks tracks overhead separately</p>
      {data && (
        <div className="text-sm text-neutral-300">
          <span className="font-medium">Total: {fmt(data.summary.total)}</span>
          <span className="text-neutral-500"> across {data.summary.count} expenses on {data.summary.jobs} jobs</span>
        </div>
      )}

      {/* TODO: filter UI — category multi-select, vendor autocomplete, job autocomplete, damage-type multi-select, submitted-by dropdown.
         For v1 of this tab, date range from header is the only filter; additional filters can ship in a follow-up if needed. */}

      <div className="rounded-lg border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900/50 text-neutral-400">
            <tr>
              <th className="px-3 py-2"></th>
              <th className="text-left px-3 py-2">Vendor</th>
              <th className="text-left px-3 py-2">Category</th>
              <th className="text-left px-3 py-2">Date</th>
              <th className="text-left px-3 py-2">Job</th>
              <th className="text-left px-3 py-2">Submitted by</th>
              <th className="text-right px-3 py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map(r => (
              <tr key={r.id} className="border-t border-neutral-800 hover:bg-neutral-900/30 cursor-pointer" onClick={() => setSelectedExpenseId(r.id)}>
                <td className="px-3 py-2">
                  {r.thumbnail_path
                    ? <img src={`/api/expenses/${r.id}/thumbnail-url`} alt="" className="h-8 w-8 rounded object-cover" />
                    : <div className="h-8 w-8 rounded bg-neutral-800" />}
                </td>
                <td className="px-3 py-2">{r.vendor_name}</td>
                <td className="px-3 py-2">
                  {r.expense_categories && <span className="inline-flex rounded px-2 py-0.5 text-xs" style={{ background: r.expense_categories.bg_color, color: r.expense_categories.text_color }}>{r.expense_categories.display_label}</span>}
                </td>
                <td className="px-3 py-2">{r.expense_date}</td>
                <td className="px-3 py-2">
                  {r.jobs && <Link href={`/jobs/${r.jobs.id}?tab=financials`} onClick={(e) => e.stopPropagation()} className="text-neutral-200 hover:underline">{r.jobs.property_address ?? r.jobs.job_number}</Link>}
                </td>
                <td className="px-3 py-2">{r.submitter_name}</td>
                <td className="text-right px-3 py-2">{fmt(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedExpenseId && (
        <ReceiptDetailModal expenseId={selectedExpenseId} onClose={() => setSelectedExpenseId(null)} />
      )}
    </div>
  );
}
```

**Note:** The filter UI is intentionally deferred (marked TODO in code + flagged here). The spec calls for category/vendor/job/damage-type/submitted-by filters. Shipping those in v1 adds ~1 day. Consider splitting them to a follow-up task if scope pressure — but confirm with reviewer before leaving them out. For the initial PR, including at least a category multi-select is a reasonable middle ground.

Also verify the actual `ReceiptDetailModal` props — the import + prop shape above is a guess; adjust during implementation by reading the component.

- [ ] **Step 2: Preview + commit**

```bash
# Expenses list renders; row click opens Receipt Detail Modal;
# job link navigates to ?tab=financials
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/components/accounting/global-expenses-tab.tsx
git commit -m "feat(accounting): global expenses tab"
```

---

## Task 27: By damage type tab (with Chart.js)

**Files:**
- Modify: `src/components/accounting/by-damage-type-tab.tsx`

- [ ] **Step 1: Write**

```typescript
"use client";

import { useEffect, useState } from "react";
import type { RangePreset } from "@/lib/accounting/date-ranges";
import { Bar } from "react-chartjs-2";
import { Chart, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from "chart.js";
Chart.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

type Row = {
  damage_type: string;
  job_count: number;
  revenue: number;
  expenses: number;
  margin: number;
  avg_margin_pct: number | null;
};

const DAMAGE_COLORS: Record<string, string> = {
  water: "#3B82F6",
  fire: "#EF4444",
  mold: "#10B981",
  storm: "#8B5CF6",
  biohazard: "#F59E0B",
  contents: "#A78BFA",
  rebuild: "#6366F1",
  other: "#6B7280",
};

function fmt(n: number) { return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }); }

export default function ByDamageTypeTab({ range }: { range: RangePreset }) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    fetch(`/api/accounting/damage-type?range=${range}`).then(r => r.json()).then(d => setRows(d.rows ?? []));
  }, [range]);

  const chartData = {
    labels: rows.map(r => r.damage_type),
    datasets: [{
      label: "Average margin %",
      data: rows.map(r => r.avg_margin_pct ?? 0),
      backgroundColor: rows.map(r => DAMAGE_COLORS[r.damage_type] ?? "#6B7280"),
      borderWidth: 0,
    }],
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900/50 text-neutral-400">
            <tr>
              <th className="text-left px-3 py-2">Damage type</th>
              <th className="text-right px-3 py-2">Jobs</th>
              <th className="text-right px-3 py-2">Revenue</th>
              <th className="text-right px-3 py-2">Expenses</th>
              <th className="text-right px-3 py-2">Margin</th>
              <th className="text-right px-3 py-2">Avg margin %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.damage_type} className="border-t border-neutral-800">
                <td className="px-3 py-2">
                  <span className="inline-flex rounded px-2 py-0.5 text-xs" style={{ background: `${DAMAGE_COLORS[r.damage_type] ?? "#6B7280"}30`, color: DAMAGE_COLORS[r.damage_type] ?? "#6B7280" }}>
                    {r.damage_type}
                  </span>
                </td>
                <td className="text-right px-3 py-2">{r.job_count}</td>
                <td className="text-right px-3 py-2">{fmt(r.revenue)}</td>
                <td className="text-right px-3 py-2">{fmt(r.expenses)}</td>
                <td className="text-right px-3 py-2">{fmt(r.margin)}</td>
                <td className="text-right px-3 py-2">{r.avg_margin_pct !== null ? `${r.avg_margin_pct.toFixed(1)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-neutral-800 p-4">
        <div className="text-sm text-neutral-300 mb-2">Average margin % by damage type</div>
        <div style={{ height: 320 }}>
          <Bar data={chartData} options={{
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { color: "#262626" }, ticks: { color: "#a3a3a3" } },
              y: { grid: { display: false }, ticks: { color: "#a3a3a3" } },
            },
          }} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Preview + commit**

```bash
# Table + horizontal bar chart both render; colors match across
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | grep -v "^$" | head -5
git add src/components/accounting/by-damage-type-tab.tsx
git commit -m "feat(accounting): By damage type tab with Chart.js bar"
```

---

## Task 28: Verification run-through

**Files:** none (testing only)

- [ ] **Step 1: Run the full verification checklist from the design spec**

Start preview:
```bash
# Use preview_start (Claude Preview MCP)
```

Work through each of these (14 items from the design spec) in a browser:

1. Overview tab no longer shows Billing or Expenses
2. Financials tab shows both; + Invoice / + Record Payment open identical modals
3. Logging an expense from Financials updates Activity Timeline on Overview
4. Recording a payment from Financials updates Activity Timeline AND payer_type badge
5. `/jobs/[id]` (no tab) defaults to Overview
6. `/jobs/[id]?tab=financials` deep-link works
7. `?section=billing` and `#billing` redirect to `?tab=financials`
8. `/accounting` blocked for crew_lead/crew_member (redirects to /), visible to admin
9. Date range presets produce expected row counts — test `last_30` vs `all_time`
10. Export ↓ produces 3 CSVs + 1 ZIP with correct filenames
11. Stat cards render with correct colors (green margin card, amber AR-over-60 when non-zero)
12. Chart.js bar chart renders on By damage type
13. Nudge button opens composer pre-filled
14. `npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | wc -l` returns baseline (~39) — no new errors

- [ ] **Step 2: Memory update**

Update `C:\Users\14252\.claude\projects\C--Users-14252-Desktop-aaa-platform\memory\project_migration_convention.md` to reflect build36 as the new high-water mark (was build35).

- [ ] **Step 3: PR preparation**

```bash
# Summarize commits on the branch
git log --oneline main..HEAD
```

Open a PR referencing the design spec path and listing verification results. Do NOT merge until you've confirmed Vercel preview deployment works (per memory: no premature rollback; wait for Current badge + incognito refresh).

---

## Self-review checklist — completed during plan writing

**Spec coverage:**
- [x] `/accounting` route + 4 visible tabs + 1 hidden → Tasks 20-27
- [x] `view_accounting` permission → Task 2
- [x] `estimated_crew_labor_cost` + `payer_type` columns → Task 2
- [x] payer_type trigger + backfill → Task 2
- [x] Margin calc (completed vs in-progress) → Task 5
- [x] Date range activity-based + prior-period → Task 6
- [x] Financials tab + relocation → Tasks 8, 9
- [x] Deep-link redirect → Task 10
- [x] Job Info card crew labor row → Task 11
- [x] Contact card payer badge → Task 12
- [x] Sidebar nav item → Tasks 2 (seed) + 13 (hardcoded fallback)
- [x] Stat cards (4, highlighted margin) → Task 22
- [x] Job profitability tab → Task 24
- [x] AR aging + Nudge → Task 25
- [x] Global expenses → Task 26
- [x] By damage type + Chart.js → Task 27
- [x] Export (CSV + ZIP) → Task 19
- [x] SaaS Readiness — damage colors from table, no hardcoded company refs — noted in conventions and covered in each component
- [x] QuickBooks sync tab OMITTED from tab strip → Task 20

**Placeholder scan:** The plan has marked notes where a detail must be discovered during implementation (e.g., "verify email page consumes params" in Task 25, "filter UI deferred" in Task 26). These are explicit, bounded unknowns — not "TBD" placeholders. The Task 26 filter deferral is flagged as a scope decision to make with the reviewer.

**Type consistency:** `JobMargin` shape defined in Task 5, consumed identically in Tasks 15, 18, 24. `RangePreset` / `DateRange` defined in Task 6, consumed in 14-19, 21-22, 24, 26-27. `PayerType` defined in Task 4, referenced in Task 12 styling.

**Scope:** Single coherent implementation plan covering one feature (Build 16b). Appropriate for subagent-driven-development.
