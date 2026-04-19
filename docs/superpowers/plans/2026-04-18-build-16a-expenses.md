# Build 16a — Expenses, Vendors, and Receipt Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add job-linked expense tracking with mobile-first receipt capture, plus supporting vendor and expense-category management, without any QuickBooks coupling.

**Architecture:** Three new tables (`vendors`, `expense_categories`, `expenses`), a private `receipts` storage bucket, three new permission keys, two new Settings pages (mirroring Build 14c's damage-types pattern), and a new `<ExpensesSection>` component on the job Overview tab between `<ContractsSection>` and the Reports block (mirroring the Build 15b `<ContractsSection>` pattern). Expense writes go through a RPC that atomically inserts the expense and its paired `job_activities` row.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres + Storage + Auth), Tailwind CSS, shadcn/ui, lucide-react, sonner, date-fns.

**Spec:** [docs/superpowers/specs/2026-04-18-build-16a-expenses-design.md](../specs/2026-04-18-build-16a-expenses-design.md)

**Context for the engineer:**
- This is an internal CRM. Jobs are restoration-industry projects.
- This build is **platform-only**. Do **not** add any QuickBooks code, hooks, column names, or references. QB integration is reserved for builds 16c/16d.
- The project has **no test framework** (no jest/vitest/playwright). "Tests" = manual preview + `npx tsc --noEmit`. Do not add jest/vitest; do not write `.test.ts` files.
- Migration convention: `supabase/migration-build<NN>-<name>.sql`, flat under `supabase/`, sequential, applied manually by the developer in the Supabase SQL editor. Next is **build35**. Not idempotent.
- There are ~39 pre-existing `tsc` errors in `jarvis/neural-network/*`. Ignore them — only worry about errors you introduce in files you touch.
- API routes that need to read the session user use `createServerSupabaseClient()` from `@/lib/supabase-server`; admin writes use `createServiceClient()` from `@/lib/supabase-api`. Permission checks go through `user_profiles.role` and `user_permissions`. Pattern to copy: [src/app/api/settings/nav-order/route.ts](../../src/app/api/settings/nav-order/route.ts).
- The platform is dark-themed. Cards use `bg-card`, `border border-border`, `rounded-xl`, `p-5` — see [src/components/job-detail.tsx:670](../../src/components/job-detail.tsx) for the pattern.
- Teal primary button uses `bg-[image:var(--gradient-primary)] text-white` — see [src/app/settings/damage-types/page.tsx:177](../../src/app/settings/damage-types/page.tsx).
- Toast library is `sonner`: `toast.success(...)`, `toast.error(...)`.

---

## File Structure

**New files:**
- `supabase/migration-build35-expenses.sql` — tables, RLS, triggers, seeds, storage bucket, RPCs, permission updates
- `src/lib/expenses-constants.ts` — vendor-type list + colors, payment-method map
- `src/components/expenses/image-utils.ts` — canvas-based downscale + JPEG encode
- `src/components/expenses/vendor-autocomplete.tsx` — autocomplete combobox
- `src/components/expenses/log-expense-modal.tsx` — create/edit modal
- `src/components/expenses/receipt-detail-modal.tsx` — view/edit/delete modal
- `src/components/expenses/expenses-section.tsx` — job-detail card
- `src/app/settings/vendors/page.tsx`
- `src/app/settings/expense-categories/page.tsx`
- `src/app/api/settings/vendors/route.ts` — `GET`, `POST`
- `src/app/api/settings/vendors/[id]/route.ts` — `PATCH`
- `src/app/api/settings/vendors/[id]/deactivate/route.ts` — `POST`
- `src/app/api/settings/vendors/[id]/reactivate/route.ts` — `POST`
- `src/app/api/settings/expense-categories/route.ts` — `GET`, `POST`, `PUT`, `DELETE`
- `src/app/api/expenses/route.ts` — `POST`
- `src/app/api/expenses/[id]/route.ts` — `PATCH`, `DELETE`
- `src/app/api/expenses/[id]/receipt-url/route.ts` — `GET`
- `src/app/api/expenses/[id]/thumbnail-url/route.ts` — `GET`
- `src/app/api/expenses/by-job/[jobId]/route.ts` — `GET`
- `src/app/api/expenses/by-activity/[activityId]/route.ts` — `GET`

**Modified files:**
- `src/lib/types.ts` — add `Vendor`, `VendorType`, `ExpenseCategory`, `Expense`, `PaymentMethod`; extend `JobActivity.activity_type` union
- `src/lib/settings-nav.ts` — insert Vendors + Expense Categories entries
- `src/components/job-detail.tsx` — mount `<ExpensesSection>` between `<ContractsSection>` and the Reports block
- `src/components/activity-timeline.tsx` — add `'expense'` config entry + click-through to receipt detail

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migration-build35-expenses.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migration-build35-expenses.sql`:

```sql
-- ============================================
-- Build 35 Migration: Build 16a — Expenses, Vendors, Receipt Capture
-- Run this in the Supabase SQL Editor.
-- ============================================

-- ============================================
-- 1. EXPENSE CATEGORIES TABLE
-- Mirrors damage_types so the settings UI can be forked from 14c.
-- ============================================
CREATE TABLE expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  display_label text NOT NULL,
  bg_color text NOT NULL DEFAULT '#F1EFE8',
  text_color text NOT NULL DEFAULT '#5F5E5A',
  icon text,
  sort_order integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_categories_sort_order ON expense_categories(sort_order);

CREATE TRIGGER trg_expense_categories_updated_at
  BEFORE UPDATE ON expense_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 2. VENDORS TABLE
-- ============================================
CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  vendor_type text NOT NULL
    CHECK (vendor_type IN ('supplier', 'subcontractor', 'equipment_rental', 'fuel', 'other')),
  default_category_id uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  is_1099 boolean NOT NULL DEFAULT false,
  tax_id text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vendors_active_name ON vendors(is_active, name);
CREATE INDEX idx_vendors_type ON vendors(vendor_type);
CREATE INDEX idx_vendors_is_1099 ON vendors(is_1099) WHERE is_1099 = true;

CREATE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- 3. EXPENSES TABLE
-- ============================================
CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  vendor_name text NOT NULL,
  category_id uuid NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  expense_date date NOT NULL,
  payment_method text NOT NULL
    CHECK (payment_method IN ('business_card', 'business_ach', 'cash', 'personal_reimburse', 'other')),
  description text,
  receipt_path text,
  thumbnail_path text,
  submitted_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  submitter_name text NOT NULL,
  activity_id uuid REFERENCES job_activities(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_expenses_job_date ON expenses(job_id, expense_date DESC);
CREATE INDEX idx_expenses_category ON expenses(category_id);
CREATE INDEX idx_expenses_vendor ON expenses(vendor_id);
CREATE INDEX idx_expenses_submitter ON expenses(submitted_by, created_at DESC);

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Bump vendors.last_used_at whenever a new expense references a vendor.
CREATE OR REPLACE FUNCTION bump_vendor_last_used()
RETURNS trigger AS $$
BEGIN
  IF NEW.vendor_id IS NOT NULL THEN
    UPDATE vendors SET last_used_at = NEW.created_at WHERE id = NEW.vendor_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_expenses_bump_vendor_last_used
  AFTER INSERT ON expenses
  FOR EACH ROW EXECUTE FUNCTION bump_vendor_last_used();

-- ============================================
-- 4. SEED DEFAULT EXPENSE CATEGORIES
-- ============================================
INSERT INTO expense_categories (name, display_label, bg_color, text_color, icon, sort_order, is_default) VALUES
  ('materials',         'Materials',           '#E6F1FB', '#0C447C', 'Hammer',   1, true),
  ('sub_labor',         'Subcontractor Labor', '#EEEDFE', '#3C3489', 'Users',    2, true),
  ('equipment_rental',  'Equipment Rental',    '#FAEEDA', '#633806', 'Wrench',   3, true),
  ('fuel_mileage',      'Fuel/Mileage',        '#FAECE7', '#712B13', 'Fuel',     4, true),
  ('permits',           'Permits',             '#F1EFE8', '#5F5E5A', 'FileText', 5, true),
  ('disposal_dumpster', 'Disposal/Dumpster',   '#EAF3DE', '#27500A', 'Trash2',   6, true),
  ('lodging',           'Lodging',             '#FBEAF0', '#72243E', 'Bed',      7, true),
  ('meals',             'Meals',               '#FBEAF0', '#72243E', 'Utensils', 8, true),
  ('other',             'Other',               '#F1EFE8', '#5F5E5A', NULL,       9, true);

-- ============================================
-- 5. EXTEND job_activities.activity_type TO ALLOW 'expense'
-- ============================================
ALTER TABLE job_activities DROP CONSTRAINT IF EXISTS job_activities_activity_type_check;
ALTER TABLE job_activities ADD CONSTRAINT job_activities_activity_type_check
  CHECK (activity_type IN ('note', 'photo', 'milestone', 'insurance', 'equipment', 'expense'));

-- ============================================
-- 6. ROW LEVEL SECURITY (platform-wide pattern)
-- ============================================
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users" ON vendors
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON expense_categories
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON expenses
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- 7. STORAGE BUCKET (private; API routes are the only caller)
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "receipts_bucket_authenticated_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'receipts');

CREATE POLICY "receipts_bucket_authenticated_write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'receipts');

CREATE POLICY "receipts_bucket_authenticated_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'receipts') WITH CHECK (bucket_id = 'receipts');

CREATE POLICY "receipts_bucket_authenticated_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'receipts');

-- ============================================
-- 8. RPCS FOR ATOMIC EXPENSE TRANSITIONS
-- Each function wraps the mutation plus its paired job_activities row in
-- one transaction so the expense and its activity log entry can't drift.
-- ============================================

-- Create expense + paired activity row in one transaction. Returns the
-- new expense id. Activity title/description are built server-side so
-- the rendered string is consistent with the activity log renderer.
CREATE OR REPLACE FUNCTION create_expense_with_activity(
  p_job_id uuid,
  p_vendor_id uuid,
  p_vendor_name text,
  p_category_id uuid,
  p_amount numeric,
  p_expense_date date,
  p_payment_method text,
  p_description text,
  p_receipt_path text,
  p_thumbnail_path text,
  p_submitted_by uuid,
  p_submitter_name text
) RETURNS uuid AS $$
DECLARE
  v_expense_id uuid;
  v_activity_id uuid;
  v_category_label text;
  v_activity_title text;
  v_activity_description text;
BEGIN
  SELECT display_label INTO v_category_label
    FROM expense_categories WHERE id = p_category_id;

  v_activity_title := 'Logged expense: ' || p_vendor_name || ' — $' || to_char(p_amount, 'FM999,999,990.00');
  v_activity_description := COALESCE(v_category_label, 'Expense');
  IF p_receipt_path IS NOT NULL THEN
    v_activity_description := v_activity_description || ' · receipt attached';
  END IF;

  INSERT INTO job_activities (job_id, activity_type, title, description, author)
    VALUES (p_job_id, 'expense', v_activity_title, v_activity_description, p_submitter_name)
    RETURNING id INTO v_activity_id;

  INSERT INTO expenses (
    job_id, vendor_id, vendor_name, category_id, amount, expense_date,
    payment_method, description, receipt_path, thumbnail_path,
    submitted_by, submitter_name, activity_id
  ) VALUES (
    p_job_id, p_vendor_id, p_vendor_name, p_category_id, p_amount, p_expense_date,
    p_payment_method, p_description, p_receipt_path, p_thumbnail_path,
    p_submitted_by, p_submitter_name, v_activity_id
  ) RETURNING id INTO v_expense_id;

  RETURN v_expense_id;
END;
$$ LANGUAGE plpgsql;

-- Update expense fields and keep the paired activity row's title/description
-- in sync with the new amount/vendor/category.
CREATE OR REPLACE FUNCTION update_expense(
  p_expense_id uuid,
  p_vendor_id uuid,
  p_vendor_name text,
  p_category_id uuid,
  p_amount numeric,
  p_expense_date date,
  p_payment_method text,
  p_description text,
  p_receipt_path text,
  p_thumbnail_path text
) RETURNS void AS $$
DECLARE
  v_activity_id uuid;
  v_category_label text;
  v_new_title text;
  v_new_description text;
BEGIN
  SELECT activity_id INTO v_activity_id FROM expenses WHERE id = p_expense_id;
  SELECT display_label INTO v_category_label FROM expense_categories WHERE id = p_category_id;

  v_new_title := 'Logged expense: ' || p_vendor_name || ' — $' || to_char(p_amount, 'FM999,999,990.00');
  v_new_description := COALESCE(v_category_label, 'Expense');
  IF p_receipt_path IS NOT NULL THEN
    v_new_description := v_new_description || ' · receipt attached';
  END IF;

  UPDATE expenses SET
    vendor_id = p_vendor_id,
    vendor_name = p_vendor_name,
    category_id = p_category_id,
    amount = p_amount,
    expense_date = p_expense_date,
    payment_method = p_payment_method,
    description = p_description,
    receipt_path = p_receipt_path,
    thumbnail_path = p_thumbnail_path
  WHERE id = p_expense_id;

  IF v_activity_id IS NOT NULL THEN
    UPDATE job_activities SET title = v_new_title, description = v_new_description
      WHERE id = v_activity_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Delete the paired activity row and the expense row in one transaction.
-- Returns the receipt paths so the API route can delete the storage objects.
CREATE OR REPLACE FUNCTION delete_expense_cascade(p_expense_id uuid)
RETURNS TABLE(receipt_path text, thumbnail_path text) AS $$
DECLARE
  v_activity_id uuid;
  v_receipt_path text;
  v_thumbnail_path text;
BEGIN
  SELECT e.activity_id, e.receipt_path, e.thumbnail_path
    INTO v_activity_id, v_receipt_path, v_thumbnail_path
    FROM expenses e WHERE e.id = p_expense_id;

  IF v_activity_id IS NOT NULL THEN
    DELETE FROM job_activities WHERE id = v_activity_id;
  END IF;

  DELETE FROM expenses WHERE id = p_expense_id;

  receipt_path := v_receipt_path;
  thumbnail_path := v_thumbnail_path;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 9. PERMISSION KEYS (Build 14d extension)
-- Replaces set_default_permissions to include the three new keys and
-- backfills permissions for every existing user.
-- ============================================
CREATE OR REPLACE FUNCTION set_default_permissions(p_user_id uuid, p_role text)
RETURNS void AS $$
DECLARE
  all_perms text[] := ARRAY[
    'view_jobs', 'edit_jobs', 'create_jobs',
    'log_activities', 'upload_photos', 'edit_photos',
    'view_billing', 'record_payments',
    'view_email', 'send_email',
    'manage_reports', 'access_settings',
    'log_expenses', 'manage_vendors', 'manage_expense_categories'
  ];
  admin_perms text[] := all_perms;
  lead_perms text[] := ARRAY[
    'view_jobs', 'edit_jobs', 'create_jobs',
    'log_activities', 'upload_photos', 'edit_photos',
    'view_billing', 'record_payments',
    'view_email', 'send_email',
    'manage_reports',
    'log_expenses'
  ];
  member_perms text[] := ARRAY[
    'view_jobs', 'log_activities', 'upload_photos',
    'log_expenses'
  ];
  granted_perms text[];
  perm text;
BEGIN
  IF p_role = 'admin' THEN
    granted_perms := admin_perms;
  ELSIF p_role = 'crew_lead' THEN
    granted_perms := lead_perms;
  ELSE
    granted_perms := member_perms;
  END IF;

  FOREACH perm IN ARRAY all_perms LOOP
    INSERT INTO user_permissions (user_id, permission_key, granted)
    VALUES (p_user_id, perm, perm = ANY(granted_perms))
    ON CONFLICT (user_id, permission_key) DO UPDATE SET granted = EXCLUDED.granted;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Backfill: ensure every existing user has the three new perm keys set
-- according to their role.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id, role FROM user_profiles LOOP
    PERFORM set_default_permissions(r.id, r.role);
  END LOOP;
END $$;
```

- [ ] **Step 2: Apply the migration**

Open the Supabase SQL editor for the shared dev/prod project. Paste the contents of `supabase/migration-build35-expenses.sql` and run it. It should complete without errors.

- [ ] **Step 3: Verify**

In the Supabase Table Editor, confirm:
- `vendors`, `expense_categories`, `expenses` tables exist with the columns listed in the migration.
- `expense_categories` has 9 seeded rows with `is_default = true`.
- `job_activities` activity_type CHECK now includes `'expense'` (Table Editor → constraints).
- Storage → Buckets shows `receipts` (private).
- `user_permissions` has `log_expenses`, `manage_vendors`, `manage_expense_categories` rows for every row in `user_profiles`.

Run in SQL editor:
```sql
SELECT count(*) FROM expense_categories WHERE is_default; -- expect 9
SELECT count(*) FROM user_permissions WHERE permission_key = 'log_expenses'; -- expect row count matches user_profiles
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-build35-expenses.sql
git commit -m "feat(db): build35 — expenses, vendors, receipt capture migration"
```

---

## Task 2: Types and constants

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/expenses-constants.ts`

- [ ] **Step 1: Add types to `src/lib/types.ts`**

Append these type declarations to `src/lib/types.ts` (if the file uses `export interface`, match that style; otherwise match its existing conventions):

```ts
export type VendorType =
  | "supplier"
  | "subcontractor"
  | "equipment_rental"
  | "fuel"
  | "other";

export interface Vendor {
  id: string;
  name: string;
  vendor_type: VendorType;
  default_category_id: string | null;
  is_1099: boolean;
  tax_id: string | null;
  notes: string | null;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  display_label: string;
  bg_color: string;
  text_color: string;
  icon: string | null;
  sort_order: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export type PaymentMethod =
  | "business_card"
  | "business_ach"
  | "cash"
  | "personal_reimburse"
  | "other";

export interface Expense {
  id: string;
  job_id: string;
  vendor_id: string | null;
  vendor_name: string;
  category_id: string;
  amount: number;
  expense_date: string;
  payment_method: PaymentMethod;
  description: string | null;
  receipt_path: string | null;
  thumbnail_path: string | null;
  submitted_by: string | null;
  submitter_name: string;
  activity_id: string | null;
  created_at: string;
  updated_at: string;
  // joined fields (present on GET responses that join)
  vendor?: Vendor | null;
  category?: ExpenseCategory | null;
}
```

Find the existing `JobActivity` interface in `src/lib/types.ts` and update its `activity_type` union to include `'expense'`. If it uses a union type like `"note" | "photo" | ...`, add `| "expense"` to the end.

- [ ] **Step 2: Create `src/lib/expenses-constants.ts`**

```ts
import type { VendorType, PaymentMethod } from "./types";

export interface VendorTypeConfig {
  value: VendorType;
  label: string;
  bg: string;
  text: string;
}

export const VENDOR_TYPES: VendorTypeConfig[] = [
  { value: "supplier",          label: "Supplier",           bg: "#E6F1FB", text: "#0C447C" },
  { value: "subcontractor",     label: "Subcontractor",      bg: "#EEEDFE", text: "#3C3489" },
  { value: "equipment_rental",  label: "Equipment Rental",   bg: "#FAEEDA", text: "#633806" },
  { value: "fuel",              label: "Fuel",               bg: "#FAECE7", text: "#712B13" },
  { value: "other",             label: "Other",              bg: "#F1EFE8", text: "#5F5E5A" },
];

export function vendorTypeConfig(value: VendorType): VendorTypeConfig {
  return VENDOR_TYPES.find((t) => t.value === value) ?? VENDOR_TYPES[VENDOR_TYPES.length - 1];
}

export interface PaymentMethodConfig {
  value: PaymentMethod;
  label: string;
}

export const PAYMENT_METHODS: PaymentMethodConfig[] = [
  { value: "business_card",      label: "Business Card" },
  { value: "business_ach",       label: "Business ACH" },
  { value: "cash",               label: "Cash" },
  { value: "personal_reimburse", label: "Personal (Reimburse)" },
  { value: "other",              label: "Other" },
];

export function paymentMethodLabel(value: PaymentMethod): string {
  return PAYMENT_METHODS.find((p) => p.value === value)?.label ?? "Other";
}

export function formatAmount(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
```

- [ ] **Step 3: Type check**

Run:
```bash
npx tsc --noEmit
```
Expect: no new errors in `src/lib/types.ts` or `src/lib/expenses-constants.ts`. Pre-existing errors in `jarvis/neural-network/*` are fine.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/expenses-constants.ts
git commit -m "feat(types): add Vendor, ExpenseCategory, Expense types and constants"
```

---

## Task 3: Image utilities

**Files:**
- Create: `src/components/expenses/image-utils.ts`

- [ ] **Step 1: Write the utility**

```ts
// Canvas-based image downscale + JPEG encode. Runs entirely in the browser.
// Used by the Log Expense modal to produce (1) a capped original and
// (2) a 200px-wide thumbnail from whatever the user picks or captures,
// normalizing HEIC/PNG/etc to JPEG so the storage path `.jpg` is accurate.

export interface DownscaledImage {
  blob: Blob;
  width: number;
  height: number;
}

async function loadImageFromFile(file: File | Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image"));
      el.src = url;
    });
    return img;
  } finally {
    // Revoke after a tick so the browser has time to pull pixels into the canvas.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas encode failed"))),
      "image/jpeg",
      quality,
    );
  });
}

async function downscale(img: HTMLImageElement, maxEdge: number, quality: number): Promise<DownscaledImage> {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create 2D context");
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await canvasToJpegBlob(canvas, quality);
  return { blob, width, height };
}

export async function prepareReceiptUploads(file: File): Promise<{ original: DownscaledImage; thumbnail: DownscaledImage }> {
  const img = await loadImageFromFile(file);
  const original = await downscale(img, 2048, 0.85);

  // Thumbnail: scale so width = 200 (preserve aspect).
  const thumbScale = 200 / img.width;
  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = 200;
  thumbCanvas.height = Math.max(1, Math.round(img.height * thumbScale));
  const thumbCtx = thumbCanvas.getContext("2d");
  if (!thumbCtx) throw new Error("Could not create 2D context");
  thumbCtx.drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
  const thumbBlob = await canvasToJpegBlob(thumbCanvas, 0.85);

  return {
    original,
    thumbnail: { blob: thumbBlob, width: thumbCanvas.width, height: thumbCanvas.height },
  };
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```
Expect: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/expenses/image-utils.ts
git commit -m "feat(expenses): add client-side image downscale utility"
```

---

## Task 4: Expense categories API

**Files:**
- Create: `src/app/api/settings/expense-categories/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

async function requireManageCategories(): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "admin") return { ok: true };
  const { data: perm } = await supabase.from("user_permissions")
    .select("granted")
    .eq("user_id", user.id)
    .eq("permission_key", "manage_expense_categories")
    .maybeSingle();
  if (perm?.granted) return { ok: true };
  return { ok: false, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
}

// GET — list, any authenticated user
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service.from("expense_categories").select("*").order("sort_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST — create custom category
export async function POST(request: Request) {
  const guard = await requireManageCategories();
  if (!guard.ok) return guard.response;

  const body = await request.json();
  const { name, display_label, bg_color, text_color, icon } = body as {
    name?: string; display_label?: string; bg_color?: string; text_color?: string; icon?: string;
  };
  if (!name || !display_label) {
    return NextResponse.json({ error: "name and display_label are required" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: existing } = await service.from("expense_categories")
    .select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const nextOrder = (existing?.[0]?.sort_order ?? 0) + 1;

  const { data, error } = await service.from("expense_categories").insert({
    name: name.toLowerCase().replace(/\s+/g, "_"),
    display_label,
    bg_color: bg_color || "#F1EFE8",
    text_color: text_color || "#5F5E5A",
    icon: icon || null,
    sort_order: nextOrder,
    is_default: false,
  }).select().single();

  if (error) {
    if (error.message.includes("duplicate")) {
      return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

// PUT — bulk update (rename/recolor/reorder)
export async function PUT(request: Request) {
  const guard = await requireManageCategories();
  if (!guard.ok) return guard.response;

  const body = await request.json();
  const service = createServiceClient();

  const items = Array.isArray(body) ? body : [body];
  for (const item of items) {
    const { error } = await service.from("expense_categories").update({
      display_label: item.display_label,
      bg_color: item.bg_color,
      text_color: item.text_color,
      icon: item.icon,
      sort_order: item.sort_order,
    }).eq("id", item.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// DELETE — custom categories only, and not if any expense references it
export async function DELETE(request: Request) {
  const guard = await requireManageCategories();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const service = createServiceClient();
  const { data: cat } = await service.from("expense_categories").select("is_default").eq("id", id).single();
  if (cat?.is_default) {
    return NextResponse.json({ error: "Default categories cannot be deleted" }, { status: 403 });
  }

  const { count } = await service.from("expenses").select("*", { count: "exact", head: true }).eq("category_id", id);
  if (count && count > 0) {
    return NextResponse.json({ error: `Cannot delete — ${count} expense(s) use this category` }, { status: 409 });
  }

  const { error } = await service.from("expense_categories").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```
Expect: no new errors.

- [ ] **Step 3: Smoke-test via curl (optional)**

Start the dev server in the other terminal (`npm run dev`). Hit:
```bash
curl http://localhost:3000/api/settings/expense-categories -H "Cookie: <your-auth-cookie>"
```
Expect: JSON array of 9 seeded categories in `sort_order`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/settings/expense-categories/route.ts
git commit -m "feat(api): expense-categories CRUD route"
```

---

## Task 5: Vendor API

**Files:**
- Create: `src/app/api/settings/vendors/route.ts`
- Create: `src/app/api/settings/vendors/[id]/route.ts`
- Create: `src/app/api/settings/vendors/[id]/deactivate/route.ts`
- Create: `src/app/api/settings/vendors/[id]/reactivate/route.ts`

- [ ] **Step 1: Helper permission guards (inline, not a new file)**

All four route files start with this helper (copy it into each). Keeps the plan self-contained per route:

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

async function requireManageVendors(): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "admin") return { ok: true };
  const { data: perm } = await supabase.from("user_permissions")
    .select("granted")
    .eq("user_id", user.id)
    .eq("permission_key", "manage_vendors")
    .maybeSingle();
  if (perm?.granted) return { ok: true };
  return { ok: false, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
}

async function requireAnyAuth(): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  return { ok: true };
}
```

- [ ] **Step 2: Write `src/app/api/settings/vendors/route.ts`**

Full file:
```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

async function requireAnyAuth() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  return { ok: true as const, user };
}

async function requireManageVendors() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "admin") return { ok: true as const };
  const { data: perm } = await supabase.from("user_permissions")
    .select("granted").eq("user_id", user.id).eq("permission_key", "manage_vendors").maybeSingle();
  if (perm?.granted) return { ok: true as const };
  return { ok: false as const, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
}

// GET — any authenticated user (used by Log Expense modal autocomplete too)
export async function GET(request: Request) {
  const auth = await requireAnyAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const active = searchParams.get("active");
  const type = searchParams.get("type");
  const is1099 = searchParams.get("is_1099");

  const service = createServiceClient();
  let query = service.from("vendors")
    .select("*, default_category:expense_categories!default_category_id(id, display_label, bg_color, text_color)")
    .order("name", { ascending: true });

  if (q) query = query.ilike("name", `%${q}%`);
  if (active === "true") query = query.eq("is_active", true);
  if (active === "false") query = query.eq("is_active", false);
  if (type) query = query.eq("vendor_type", type);
  if (is1099 === "true") query = query.eq("is_1099", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST — create
export async function POST(request: Request) {
  const guard = await requireManageVendors();
  if (!guard.ok) return guard.response;

  const body = await request.json();
  const { name, vendor_type, default_category_id, is_1099, tax_id, notes } = body as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const allowedTypes = ["supplier", "subcontractor", "equipment_rental", "fuel", "other"];
  if (typeof vendor_type !== "string" || !allowedTypes.includes(vendor_type)) {
    return NextResponse.json({ error: "invalid vendor_type" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service.from("vendors").insert({
    name: name.trim(),
    vendor_type,
    default_category_id: (default_category_id as string | null | undefined) ?? null,
    is_1099: Boolean(is_1099),
    tax_id: (tax_id as string | null | undefined) ?? null,
    notes: (notes as string | null | undefined) ?? null,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
```

- [ ] **Step 3: Write `src/app/api/settings/vendors/[id]/route.ts`** (PATCH — edit content fields only)

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

async function requireManageVendors() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "admin") return { ok: true as const };
  const { data: perm } = await supabase.from("user_permissions")
    .select("granted").eq("user_id", user.id).eq("permission_key", "manage_vendors").maybeSingle();
  if (perm?.granted) return { ok: true as const };
  return { ok: false as const, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireManageVendors();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = await request.json();
  const { name, vendor_type, default_category_id, is_1099, tax_id, notes } = body as Record<string, unknown>;

  const allowedTypes = ["supplier", "subcontractor", "equipment_rental", "fuel", "other"];
  if (vendor_type !== undefined && (typeof vendor_type !== "string" || !allowedTypes.includes(vendor_type))) {
    return NextResponse.json({ error: "invalid vendor_type" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof name === "string") updates.name = name.trim();
  if (typeof vendor_type === "string") updates.vendor_type = vendor_type;
  if (default_category_id !== undefined) updates.default_category_id = default_category_id ?? null;
  if (is_1099 !== undefined) updates.is_1099 = Boolean(is_1099);
  if (tax_id !== undefined) updates.tax_id = tax_id ?? null;
  if (notes !== undefined) updates.notes = notes ?? null;

  const service = createServiceClient();
  const { data, error } = await service.from("vendors").update(updates).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
```

- [ ] **Step 4: Write `src/app/api/settings/vendors/[id]/deactivate/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

async function requireManageVendors() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "admin") return { ok: true as const };
  const { data: perm } = await supabase.from("user_permissions")
    .select("granted").eq("user_id", user.id).eq("permission_key", "manage_vendors").maybeSingle();
  if (perm?.granted) return { ok: true as const };
  return { ok: false as const, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireManageVendors();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const service = createServiceClient();
  const { error } = await service.from("vendors").update({ is_active: false }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Write `src/app/api/settings/vendors/[id]/reactivate/route.ts`**

Same as deactivate but sets `is_active: true`:
```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

async function requireManageVendors() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role === "admin") return { ok: true as const };
  const { data: perm } = await supabase.from("user_permissions")
    .select("granted").eq("user_id", user.id).eq("permission_key", "manage_vendors").maybeSingle();
  if (perm?.granted) return { ok: true as const };
  return { ok: false as const, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireManageVendors();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const service = createServiceClient();
  const { error } = await service.from("vendors").update({ is_active: true }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 6: Type check**

```bash
npx tsc --noEmit
```
Expect: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/settings/vendors/
git commit -m "feat(api): vendors CRUD + deactivate/reactivate routes"
```

---

## Task 6: Expenses API

**Files:**
- Create: `src/app/api/expenses/route.ts`
- Create: `src/app/api/expenses/[id]/route.ts`
- Create: `src/app/api/expenses/[id]/receipt-url/route.ts`
- Create: `src/app/api/expenses/[id]/thumbnail-url/route.ts`
- Create: `src/app/api/expenses/by-job/[jobId]/route.ts`
- Create: `src/app/api/expenses/by-activity/[activityId]/route.ts`

- [ ] **Step 1: Write `src/app/api/expenses/route.ts`** (POST — create expense)

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

interface CreatePayload {
  job_id: string;
  vendor_id: string | null;
  vendor_name: string;
  category_id: string;
  amount: number;
  expense_date: string;
  payment_method: "business_card" | "business_ach" | "cash" | "personal_reimburse" | "other";
  description: string | null;
  receipt_path: string | null;
  thumbnail_path: string | null;
}

async function requireLogExpenses() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role, full_name").eq("id", user.id).maybeSingle();
  if (!profile) return { ok: false as const, response: NextResponse.json({ error: "Profile not found" }, { status: 403 }) };
  if (profile.role === "admin") return { ok: true as const, userId: user.id, fullName: profile.full_name, role: profile.role };
  const { data: perm } = await supabase.from("user_permissions")
    .select("granted").eq("user_id", user.id).eq("permission_key", "log_expenses").maybeSingle();
  if (perm?.granted) return { ok: true as const, userId: user.id, fullName: profile.full_name, role: profile.role };
  return { ok: false as const, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) };
}

export async function POST(request: Request) {
  const auth = await requireLogExpenses();
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as CreatePayload;
  if (!body.job_id || !body.category_id || !body.vendor_name || typeof body.amount !== "number") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc("create_expense_with_activity", {
    p_job_id: body.job_id,
    p_vendor_id: body.vendor_id,
    p_vendor_name: body.vendor_name,
    p_category_id: body.category_id,
    p_amount: body.amount,
    p_expense_date: body.expense_date,
    p_payment_method: body.payment_method,
    p_description: body.description,
    p_receipt_path: body.receipt_path,
    p_thumbnail_path: body.thumbnail_path,
    p_submitted_by: auth.userId,
    p_submitter_name: auth.fullName,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data }, { status: 201 });
}
```

- [ ] **Step 2: Write `src/app/api/expenses/[id]/route.ts`** (PATCH + DELETE, submitter-or-admin gate)

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

async function getCallerAndExpense(id: string) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Not authenticated" };

  const { data: profile } = await supabase.from("user_profiles").select("role").eq("id", user.id).maybeSingle();
  const service = createServiceClient();
  const { data: expense } = await service.from("expenses")
    .select("id, submitted_by, receipt_path, thumbnail_path, activity_id")
    .eq("id", id).maybeSingle();
  if (!expense) return { ok: false as const, status: 404, error: "Expense not found" };

  const isAdmin = profile?.role === "admin";
  const isSubmitter = expense.submitted_by === user.id;
  if (!isAdmin && !isSubmitter) return { ok: false as const, status: 403, error: "Permission denied" };

  // Also require log_expenses (defence in depth — submitters were granted this by role, but double check).
  const { data: perm } = await supabase.from("user_permissions")
    .select("granted").eq("user_id", user.id).eq("permission_key", "log_expenses").maybeSingle();
  if (!isAdmin && !perm?.granted) return { ok: false as const, status: 403, error: "Permission denied" };

  return { ok: true as const, user, profile, expense, service };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await getCallerAndExpense(id);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const body = await request.json();
  const { error } = await caller.service.rpc("update_expense", {
    p_expense_id: id,
    p_vendor_id: body.vendor_id,
    p_vendor_name: body.vendor_name,
    p_category_id: body.category_id,
    p_amount: body.amount,
    p_expense_date: body.expense_date,
    p_payment_method: body.payment_method,
    p_description: body.description,
    p_receipt_path: body.receipt_path,
    p_thumbnail_path: body.thumbnail_path,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If the photo was replaced, delete the old objects (caller provides the previous paths as query params).
  const { searchParams } = new URL(request.url);
  const oldReceipt = searchParams.get("old_receipt");
  const oldThumb = searchParams.get("old_thumb");
  const toRemove = [oldReceipt, oldThumb].filter((p): p is string => Boolean(p)
    && p !== body.receipt_path && p !== body.thumbnail_path);
  if (toRemove.length) await caller.service.storage.from("receipts").remove(toRemove);

  return NextResponse.json({ success: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await getCallerAndExpense(id);
  if (!caller.ok) return NextResponse.json({ error: caller.error }, { status: caller.status });

  const { data, error } = await caller.service.rpc("delete_expense_cascade", { p_expense_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Storage cleanup — best effort; orphans are acceptable per spec.
  const row = Array.isArray(data) ? data[0] : data;
  const paths = [row?.receipt_path, row?.thumbnail_path].filter((p): p is string => Boolean(p));
  if (paths.length) {
    const { error: rmErr } = await caller.service.storage.from("receipts").remove(paths);
    if (rmErr) console.warn("receipts cleanup failed after expense delete", { id, paths, rmErr });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Write the two signed-URL routes**

`src/app/api/expenses/[id]/receipt-url/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();
  const { data: expense } = await service.from("expenses").select("receipt_path").eq("id", id).maybeSingle();
  if (!expense?.receipt_path) return NextResponse.json({ error: "No receipt" }, { status: 404 });

  const { data, error } = await service.storage.from("receipts").createSignedUrl(expense.receipt_path, 600);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed" }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl, expiresAt: new Date(Date.now() + 600 * 1000).toISOString() });
}
```

`src/app/api/expenses/[id]/thumbnail-url/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const service = createServiceClient();
  const { data: expense } = await service.from("expenses").select("thumbnail_path").eq("id", id).maybeSingle();
  if (!expense?.thumbnail_path) return NextResponse.json({ error: "No thumbnail" }, { status: 404 });

  const { data, error } = await service.storage.from("receipts").createSignedUrl(expense.thumbnail_path, 600);
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Failed" }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl, expiresAt: new Date(Date.now() + 600 * 1000).toISOString() });
}
```

- [ ] **Step 4: Write `src/app/api/expenses/by-job/[jobId]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { jobId } = await params;
  const service = createServiceClient();
  const { data, error } = await service.from("expenses")
    .select(`
      *,
      vendor:vendors!vendor_id(id, name, vendor_type),
      category:expense_categories!category_id(id, name, display_label, bg_color, text_color, icon)
    `)
    .eq("job_id", jobId)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
```

- [ ] **Step 5: Write `src/app/api/expenses/by-activity/[activityId]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";

export async function GET(_request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { activityId } = await params;
  const service = createServiceClient();
  const { data, error } = await service.from("expenses")
    .select(`
      *,
      vendor:vendors!vendor_id(id, name, vendor_type),
      category:expense_categories!category_id(id, name, display_label, bg_color, text_color, icon)
    `)
    .eq("activity_id", activityId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}
```

- [ ] **Step 6: Type check**

```bash
npx tsc --noEmit
```
Expect: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/expenses/
git commit -m "feat(api): expenses create/update/delete + signed-url + by-activity routes"
```

---

## Task 7: Expense categories settings page

**Files:**
- Create: `src/app/settings/expense-categories/page.tsx`

- [ ] **Step 1: Fork the damage-types page**

Create `src/app/settings/expense-categories/page.tsx`. This is a near-verbatim fork of `src/app/settings/damage-types/page.tsx` with strings swapped, icons from Lucide rendered when set, and API paths pointed at `/api/settings/expense-categories`. Full file:

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Pencil, GripVertical, Check, X, Lock } from "lucide-react";
import { toast } from "sonner";
import type { ExpenseCategory } from "@/lib/types";

export default function ExpenseCategoriesSettingsPage() {
  const [cats, setCats] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newBg, setNewBg] = useState("#E6F1FB");
  const [newText, setNewText] = useState("#0C447C");
  const [newIcon, setNewIcon] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editBg, setEditBg] = useState("");
  const [editText, setEditText] = useState("");
  const [editIcon, setEditIcon] = useState("");

  const fetchCats = useCallback(async () => {
    const res = await fetch("/api/settings/expense-categories");
    if (res.ok) setCats(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchCats(); }, [fetchCats]);

  async function handleAdd() {
    if (!newLabel.trim()) { toast.error("Display label is required"); return; }
    const name = newLabel.trim().toLowerCase().replace(/\s+/g, "_");
    const res = await fetch("/api/settings/expense-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, display_label: newLabel.trim(),
        bg_color: newBg, text_color: newText,
        icon: newIcon.trim() || null,
      }),
    });
    if (res.ok) { toast.success("Category added"); setNewLabel(""); setNewIcon(""); setShowAdd(false); fetchCats(); }
    else { const err = await res.json().catch(() => ({})); toast.error(err.error || "Failed to add"); }
  }

  function startEdit(c: ExpenseCategory) {
    setEditId(c.id); setEditLabel(c.display_label);
    setEditBg(c.bg_color); setEditText(c.text_color);
    setEditIcon(c.icon || "");
  }

  async function saveOrder(items: ExpenseCategory[]) {
    await fetch("/api/settings/expense-categories", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items.map((c, i) => ({
        id: c.id, display_label: c.display_label,
        bg_color: c.bg_color, text_color: c.text_color,
        icon: c.icon, sort_order: i + 1,
      }))),
    });
  }

  async function handleSaveEdit() {
    if (!editId || !editLabel.trim()) return;
    const updated = cats.map((c) => c.id === editId
      ? { ...c, display_label: editLabel.trim(), bg_color: editBg, text_color: editText, icon: editIcon.trim() || null }
      : c
    );
    setSaving(true);
    await saveOrder(updated);
    toast.success("Category updated");
    setEditId(null);
    fetchCats();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/settings/expense-categories?id=${id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Category deleted"); fetchCats(); }
    else { const err = await res.json().catch(() => ({})); toast.error(err.error || "Failed to delete"); }
  }

  function moveUp(i: number) {
    if (i === 0) return;
    const u = [...cats]; [u[i - 1], u[i]] = [u[i], u[i - 1]]; setCats(u); saveOrder(u);
  }
  function moveDown(i: number) {
    if (i === cats.length - 1) return;
    const u = [...cats]; [u[i], u[i + 1]] = [u[i + 1], u[i]]; setCats(u); saveOrder(u);
  }

  if (loading) return <div className="text-center py-12 text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Expense Categories</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure categories for job-linked expenses. Default categories cannot be deleted.
          </p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-all">
          <Plus size={16} /> Add Category
        </button>
      </div>

      {showAdd && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <p className="text-sm font-medium text-foreground">New Category</p>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Display Label</label>
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Signage" />
            </div>
            <div className="w-32">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Icon (Lucide)</label>
              <Input value={newIcon} onChange={(e) => setNewIcon(e.target.value)} placeholder="e.g. Hammer" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">BG</label>
              <input type="color" value={newBg} onChange={(e) => setNewBg(e.target.value)} className="w-10 h-9 rounded border border-border cursor-pointer" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Text</label>
              <input type="color" value={newText} onChange={(e) => setNewText(e.target.value)} className="w-10 h-9 rounded border border-border cursor-pointer" />
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-medium self-center" style={{ backgroundColor: newBg, color: newText }}>
              {newLabel || "Preview"}
            </span>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={handleAdd}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110">
              <Check size={14} /> Add
            </button>
            <button onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-accent">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {cats.map((c, index) => (
          <div key={c.id} className="bg-card rounded-xl border border-border p-3 flex items-center gap-3">
            <div className="flex flex-col gap-0.5">
              <button onClick={() => moveUp(index)} disabled={index === 0}
                className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed">
                <GripVertical size={14} className="rotate-180" />
              </button>
              <button onClick={() => moveDown(index)} disabled={index === cats.length - 1}
                className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed">
                <GripVertical size={14} />
              </button>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-medium shrink-0 min-w-[80px] text-center"
              style={{
                backgroundColor: editId === c.id ? editBg : c.bg_color,
                color: editId === c.id ? editText : c.text_color,
              }}>
              {editId === c.id ? editLabel : c.display_label}
            </span>

            {editId === c.id ? (
              <div className="flex items-center gap-2 flex-1 flex-wrap">
                <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="h-8 text-sm flex-1 min-w-[120px]" />
                <Input value={editIcon} onChange={(e) => setEditIcon(e.target.value)} placeholder="Icon" className="h-8 text-sm w-24" />
                <input type="color" value={editBg} onChange={(e) => setEditBg(e.target.value)} className="w-8 h-8 rounded border border-border cursor-pointer shrink-0" />
                <input type="color" value={editText} onChange={(e) => setEditText(e.target.value)} className="w-8 h-8 rounded border border-border cursor-pointer shrink-0" />
                <button onClick={handleSaveEdit} disabled={saving} className="p-1.5 rounded-lg text-primary hover:bg-primary/10"><Check size={16} /></button>
                <button onClick={() => setEditId(null)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent"><X size={16} /></button>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-between">
                <div>
                  <span className="text-sm text-foreground font-medium">{c.display_label}</span>
                  <span className="text-xs text-muted-foreground ml-2">({c.name})</span>
                  {c.icon && <span className="text-xs text-muted-foreground/60 ml-1.5">{c.icon}</span>}
                </div>
                <div className="flex items-center gap-1">
                  {c.is_default && <Lock size={12} className="text-muted-foreground/40 mr-1" />}
                  <button onClick={() => startEdit(c)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent">
                    <Pencil size={14} />
                  </button>
                  {!c.is_default && (
                    <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```
Expect: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/settings/expense-categories/page.tsx
git commit -m "feat(settings): expense categories management page"
```

---

## Task 8: Vendor settings page

**Files:**
- Create: `src/app/settings/vendors/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Pencil, Ban, RotateCcw, FileBadge } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { Vendor, VendorType, ExpenseCategory } from "@/lib/types";
import { VENDOR_TYPES, vendorTypeConfig } from "@/lib/expenses-constants";

type Filter = "all" | VendorType | "1099";

export default function VendorsSettingsPage() {
  const [vendors, setVendors] = useState<(Vendor & { default_category?: ExpenseCategory | null })[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);

  const load = useCallback(async () => {
    const [vRes, cRes] = await Promise.all([
      fetch("/api/settings/vendors"),
      fetch("/api/settings/expense-categories"),
    ]);
    if (vRes.ok) setVendors(await vRes.json());
    if (cRes.ok) setCategories(await cRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "all": return vendors;
      case "1099": return vendors.filter((v) => v.is_1099);
      default: return vendors.filter((v) => v.vendor_type === filter);
    }
  }, [vendors, filter]);

  async function toggleActive(v: Vendor) {
    const path = v.is_active ? "deactivate" : "reactivate";
    const res = await fetch(`/api/settings/vendors/${v.id}/${path}`, { method: "POST" });
    if (res.ok) { toast.success(v.is_active ? "Vendor deactivated" : "Vendor reactivated"); load(); }
    else { toast.error("Failed to update vendor"); }
  }

  const filterTabs: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "subcontractor", label: "Subcontractors" },
    { value: "supplier", label: "Suppliers" },
    { value: "equipment_rental", label: "Equipment Rental" },
    { value: "other", label: "Other" },
    { value: "1099", label: "1099 Vendors" },
  ];

  if (loading) return <div className="text-center py-12 text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Vendors</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage suppliers, subcontractors, and equipment rentals.
          </p>
        </div>
        <button onClick={() => { setEditing(null); setModalOpen(true); }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 transition-all">
          <Plus size={16} /> Add Vendor
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {filterTabs.map((t) => {
          const active = filter === t.value;
          return (
            <button key={t.value} onClick={() => setFilter(t.value)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                active
                  ? "bg-[rgba(55,138,221,0.15)] text-[#85B7EB] border-[rgba(55,138,221,0.3)]"
                  : "bg-transparent text-[#8A9199] border-[rgba(255,255,255,0.08)] hover:text-foreground",
              )}>
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-accent/30">
            <tr className="text-left text-xs text-muted-foreground uppercase tracking-wide">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Default Category</th>
              <th className="px-4 py-2.5 text-center">1099</th>
              <th className="px-4 py-2.5">Last Used</th>
              <th className="px-4 py-2.5 text-center">Active</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No vendors match this filter.</td></tr>
            )}
            {filtered.map((v) => {
              const tcfg = vendorTypeConfig(v.vendor_type);
              return (
                <tr key={v.id} className="border-t border-border hover:bg-accent/20">
                  <td className="px-4 py-3 font-medium text-foreground">{v.name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                      style={{ backgroundColor: tcfg.bg, color: tcfg.text }}>
                      {tcfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {v.default_category ? (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                        style={{ backgroundColor: v.default_category.bg_color, color: v.default_category.text_color }}>
                        {v.default_category.display_label}
                      </span>
                    ) : <span className="text-muted-foreground/60">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {v.is_1099 ? <FileBadge size={14} className="inline text-primary" /> : ""}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {v.last_used_at ? format(new Date(v.last_used_at), "MMM d, yyyy") : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleActive(v)}
                      className={cn(
                        "w-8 h-4 rounded-full relative transition-colors",
                        v.is_active ? "bg-primary" : "bg-muted-foreground/20",
                      )}>
                      <span className={cn(
                        "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform",
                        v.is_active ? "translate-x-4" : "translate-x-0.5",
                      )} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => { setEditing(v); setModalOpen(true); }}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent" title="Edit">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => toggleActive(v)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title={v.is_active ? "Deactivate" : "Reactivate"}>
                        {v.is_active ? <Ban size={14} /> : <RotateCcw size={14} />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <VendorModal
        open={modalOpen}
        onOpenChange={(o) => { setModalOpen(o); if (!o) setEditing(null); }}
        vendor={editing}
        categories={categories}
        onSaved={load}
      />
    </div>
  );
}

function VendorModal({
  open, onOpenChange, vendor, categories, onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vendor: Vendor | null;
  categories: ExpenseCategory[];
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<VendorType>("supplier");
  const [categoryId, setCategoryId] = useState<string>("");
  const [taxId, setTaxId] = useState("");
  const [is1099, setIs1099] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(vendor?.name ?? "");
    setType(vendor?.vendor_type ?? "supplier");
    setCategoryId(vendor?.default_category_id ?? "");
    setTaxId(vendor?.tax_id ?? "");
    setIs1099(vendor?.is_1099 ?? false);
    setNotes(vendor?.notes ?? "");
  }, [open, vendor]);

  async function handleSave() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    const body = {
      name: name.trim(),
      vendor_type: type,
      default_category_id: categoryId || null,
      is_1099: is1099,
      tax_id: taxId || null,
      notes: notes || null,
    };
    const res = vendor
      ? await fetch(`/api/settings/vendors/${vendor.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/settings/vendors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (res.ok) { toast.success(vendor ? "Vendor updated" : "Vendor added"); onSaved(); onOpenChange(false); }
    else { const err = await res.json().catch(() => ({})); toast.error(err.error || "Failed to save"); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{vendor ? "Edit Vendor" : "Add Vendor"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vendor name" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Type</label>
            <div className="flex flex-wrap gap-1.5">
              {VENDOR_TYPES.map((t) => (
                <button key={t.value} type="button" onClick={() => setType(t.value)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                    type === t.value ? "border-transparent" : "border-border bg-transparent text-muted-foreground hover:text-foreground",
                  )}
                  style={type === t.value ? { backgroundColor: t.bg, color: t.text } : undefined}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Default Category</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-transparent border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">—</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.display_label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Tax ID</label>
            <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="EIN or SSN" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setIs1099(!is1099)}
              className={cn("w-8 h-4 rounded-full relative transition-colors", is1099 ? "bg-primary" : "bg-muted-foreground/20")}>
              <span className={cn("absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform", is1099 ? "translate-x-4" : "translate-x-0.5")} />
            </button>
            <span className="text-sm text-foreground">Requires 1099-NEC</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <button onClick={() => onOpenChange(false)} className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white hover:brightness-110 disabled:opacity-60">
            {saving ? "Saving..." : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```
Expect: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/settings/vendors/page.tsx
git commit -m "feat(settings): vendors management page"
```

---

## Task 9: Settings nav additions

**Files:**
- Modify: `src/lib/settings-nav.ts`

- [ ] **Step 1: Edit `src/lib/settings-nav.ts`**

Use the Edit tool. Add `Store` and `Receipt` to the lucide imports at the top:

```
old_string:
import {
  Building2,
  Palette,
  ListChecks,
  Flame,
  Users,
  Mail,
  FileSignature,
  ClipboardList,
  Bell,
  FileText,
  Download,
  BookOpen,
  Menu,
  Send,
} from "lucide-react";

new_string:
import {
  Building2,
  Palette,
  ListChecks,
  Flame,
  Store,
  Receipt,
  Users,
  Mail,
  FileSignature,
  ClipboardList,
  Bell,
  FileText,
  Download,
  BookOpen,
  Menu,
  Send,
} from "lucide-react";
```

Then insert the two new entries immediately after the Damage Types row:

```
old_string:
  { href: "/settings/damage-types", label: "Damage Types", icon: Flame },
  { href: "/settings/users", label: "Users & Crew", icon: Users },

new_string:
  { href: "/settings/damage-types", label: "Damage Types", icon: Flame },
  { href: "/settings/vendors", label: "Vendors", icon: Store },
  { href: "/settings/expense-categories", label: "Expense Categories", icon: Receipt },
  { href: "/settings/users", label: "Users & Crew", icon: Users },
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```
Expect: no new errors.

- [ ] **Step 3: Manual verify**

Start the dev server (`npm run dev`). Visit `/settings`. Sidebar should show Vendors and Expense Categories between Damage Types and Users & Crew. Clicking each loads the page built in Tasks 7–8.

- [ ] **Step 4: Commit**

```bash
git add src/lib/settings-nav.ts
git commit -m "feat(settings-nav): add Vendors and Expense Categories links"
```

---

## Task 10: Vendor autocomplete component

**Files:**
- Create: `src/components/expenses/vendor-autocomplete.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Vendor, ExpenseCategory } from "@/lib/types";
import { vendorTypeConfig } from "@/lib/expenses-constants";

type VendorWithCategory = Vendor & { default_category?: ExpenseCategory | null };

interface Props {
  value: VendorWithCategory | null;
  onChange: (v: VendorWithCategory | null) => void;
  disabled?: boolean;
}

export default function VendorAutocomplete({ value, onChange, disabled }: Props) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<VendorWithCategory[]>([]);
  const [adding, setAdding] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value?.name ?? ""); }, [value]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ active: "true" });
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/settings/vendors?${params}`);
      if (res.ok) setResults(await res.json());
    }, 150);
    return () => clearTimeout(t);
  }, [query, open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const showAddOption = useMemo(() =>
    query.trim().length > 0 && !results.some((r) => r.name.toLowerCase() === query.trim().toLowerCase()),
    [query, results],
  );

  async function handleAddInline() {
    setAdding(true);
    const res = await fetch("/api/settings/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: query.trim(), vendor_type: "other" }),
    });
    setAdding(false);
    if (res.ok) {
      const v = (await res.json()) as Vendor;
      onChange(v as VendorWithCategory);
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          disabled={disabled}
          onChange={(e) => { setQuery(e.target.value); onChange(null); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search or add a vendor"
          className="pl-9 h-11 text-base"
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto rounded-xl bg-card border border-border shadow-xl">
          {results.map((v) => {
            const t = vendorTypeConfig(v.vendor_type);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => { onChange(v); setQuery(v.name); setOpen(false); }}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-accent text-left"
              >
                <span className="text-sm text-foreground font-medium truncate">{v.name}</span>
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: t.bg, color: t.text }}>{t.label}</span>
                  {v.default_category && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                      style={{ backgroundColor: v.default_category.bg_color, color: v.default_category.text_color }}>
                      {v.default_category.display_label}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          {showAddOption && (
            <button
              type="button"
              disabled={adding}
              onClick={handleAddInline}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2.5 text-left border-t border-border",
                "text-primary hover:bg-primary/5",
              )}
            >
              <Plus size={14} />
              <span className="text-sm">{adding ? "Adding..." : `Add "${query.trim()}" as new vendor`}</span>
            </button>
          )}
          {!showAddOption && results.length === 0 && (
            <div className="px-3 py-3 text-sm text-muted-foreground">Type a name to search or add a vendor.</div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```
Expect: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/expenses/vendor-autocomplete.tsx
git commit -m "feat(expenses): vendor autocomplete component"
```

---

## Task 11: Log Expense modal

**Files:**
- Create: `src/components/expenses/log-expense-modal.tsx`

- [ ] **Step 1: Write the modal (handles both create and edit)**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase";
import {
  Dialog, DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Image as ImageIcon, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Expense, ExpenseCategory, PaymentMethod, Vendor } from "@/lib/types";
import { PAYMENT_METHODS } from "@/lib/expenses-constants";
import VendorAutocomplete from "./vendor-autocomplete";
import { prepareReceiptUploads } from "./image-utils";

type VendorWithCategory = Vendor & { default_category?: ExpenseCategory | null };

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  jobId: string;
  existing?: (Expense & { vendor?: Vendor | null; category?: ExpenseCategory | null }) | null;
  onSaved: () => void;
}

export default function LogExpenseModal({ open, onOpenChange, jobId, existing, onSaved }: Props) {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [keepExistingReceipt, setKeepExistingReceipt] = useState<boolean>(Boolean(existing?.receipt_path));
  const [vendor, setVendor] = useState<VendorWithCategory | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("business_card");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  const loadCategories = useCallback(async () => {
    const res = await fetch("/api/settings/expense-categories");
    if (res.ok) setCategories(await res.json());
  }, []);

  useEffect(() => { if (open) loadCategories(); }, [open, loadCategories]);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setVendor((existing.vendor ?? null) as VendorWithCategory | null);
      setAmount(existing.amount.toFixed(2));
      setDate(existing.expense_date);
      setCategoryId(existing.category_id);
      setPaymentMethod(existing.payment_method);
      setDescription(existing.description ?? "");
      setKeepExistingReceipt(Boolean(existing.receipt_path));
    } else {
      setVendor(null);
      setAmount("");
      setDate(new Date().toISOString().slice(0, 10));
      setCategoryId("");
      setPaymentMethod("business_card");
      setDescription("");
      setKeepExistingReceipt(false);
    }
    setFile(null);
    setPreview(null);
  }, [open, existing]);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setFile(f);
    e.target.value = "";
  }

  function handleVendorChange(v: VendorWithCategory | null) {
    setVendor(v);
    if (v?.default_category_id && !categoryId) setCategoryId(v.default_category_id);
  }

  function validate(): string | null {
    if (!vendor) return "Select or add a vendor";
    if (!amount || Number(amount) <= 0) return "Enter a valid amount";
    if (!date) return "Pick a date";
    if (!categoryId) return "Pick a category";
    if (!paymentMethod) return "Pick a payment method";
    return null;
  }

  async function uploadReceipt(): Promise<{ receipt_path: string | null; thumbnail_path: string | null }> {
    if (!file) return { receipt_path: null, thumbnail_path: null };
    const supabase = createClient();
    const uuid = crypto.randomUUID();
    const receiptPath = `${jobId}/${uuid}.jpg`;
    const thumbPath = `${jobId}/${uuid}.thumb.jpg`;
    const { original, thumbnail } = await prepareReceiptUploads(file);

    const upA = await supabase.storage.from("receipts").upload(receiptPath, original.blob, { contentType: "image/jpeg" });
    if (upA.error) throw new Error(upA.error.message);
    const upB = await supabase.storage.from("receipts").upload(thumbPath, thumbnail.blob, { contentType: "image/jpeg" });
    if (upB.error) {
      await supabase.storage.from("receipts").remove([receiptPath]);
      throw new Error(upB.error.message);
    }
    return { receipt_path: receiptPath, thumbnail_path: thumbPath };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) { toast.error(err); return; }
    if (!vendor) return;

    setSubmitting(true);
    try {
      let receiptPath: string | null = keepExistingReceipt ? (existing?.receipt_path ?? null) : null;
      let thumbPath: string | null = keepExistingReceipt ? (existing?.thumbnail_path ?? null) : null;

      if (file) {
        const uploaded = await uploadReceipt();
        receiptPath = uploaded.receipt_path;
        thumbPath = uploaded.thumbnail_path;
      }

      const body = {
        job_id: jobId,
        vendor_id: vendor.id,
        vendor_name: vendor.name,
        category_id: categoryId,
        amount: Number(Number(amount).toFixed(2)),
        expense_date: date,
        payment_method: paymentMethod,
        description: description || null,
        receipt_path: receiptPath,
        thumbnail_path: thumbPath,
      };

      let res: Response;
      if (existing) {
        const qs = new URLSearchParams();
        if (existing.receipt_path && existing.receipt_path !== receiptPath) qs.set("old_receipt", existing.receipt_path);
        if (existing.thumbnail_path && existing.thumbnail_path !== thumbPath) qs.set("old_thumb", existing.thumbnail_path);
        res = await fetch(`/api/expenses/${existing.id}${qs.toString() ? `?${qs}` : ""}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/expenses", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        // Roll back storage upload if we just wrote one
        if (!existing && receiptPath && thumbPath) {
          const supabase = createClient();
          await supabase.storage.from("receipts").remove([receiptPath, thumbPath]);
        }
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? "Failed to save expense");
      }

      toast.success(existing ? "Expense updated" : "Expense logged");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save expense");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(
        "p-0 overflow-hidden",
        "max-w-full h-screen max-h-screen inset-0 translate-x-0 translate-y-0 rounded-none top-0 left-0", // mobile
        "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-lg sm:h-auto sm:max-h-[90vh] sm:rounded-xl", // desktop
      )}>
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-lg font-semibold text-foreground">{existing ? "Edit Expense" : "Log Expense"}</h2>
            <button type="button" onClick={() => onOpenChange(false)}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Receipt photo */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Receipt</label>
              {preview || (keepExistingReceipt && existing?.thumbnail_path) ? (
                <div className="rounded-xl border border-border overflow-hidden bg-accent/30 flex items-center gap-3 p-3">
                  {preview
                    ? <img src={preview} alt="" className="w-20 h-20 object-cover rounded-lg" />
                    : <ReceiptPreviewFromServer expenseId={existing!.id} />}
                  <div className="flex-1">
                    <p className="text-sm text-foreground font-medium">
                      {file?.name ?? "Attached receipt"}
                    </p>
                    {file && <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>}
                    <div className="flex gap-2 mt-1">
                      <button type="button" onClick={() => libraryInputRef.current?.click()}
                        className="text-xs text-primary hover:underline">Replace</button>
                      <button type="button" onClick={() => { setFile(null); setKeepExistingReceipt(false); }}
                        className="text-xs text-muted-foreground hover:text-destructive">Remove</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => cameraInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 py-4 rounded-xl border-2 border-dashed border-border text-sm font-medium text-foreground hover:border-primary hover:bg-primary/5">
                    <Camera size={18} /> Take Photo
                  </button>
                  <button type="button" onClick={() => libraryInputRef.current?.click()}
                    className="flex items-center justify-center gap-2 py-4 rounded-xl border-2 border-dashed border-border text-sm font-medium text-foreground hover:border-primary hover:bg-primary/5">
                    <ImageIcon size={18} /> Choose from Library
                  </button>
                </div>
              )}
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />
              <input ref={libraryInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            </div>

            {/* Vendor */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Vendor</label>
              <VendorAutocomplete value={vendor} onChange={handleVendorChange} />
            </div>

            {/* Amount */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">$</span>
                <Input inputMode="decimal" value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  onBlur={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n) && n > 0) setAmount(n.toFixed(2)); }}
                  placeholder="0.00"
                  className="pl-7 h-11 text-base" />
              </div>
            </div>

            {/* Date */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Date</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 text-base" />
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Category</label>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <button key={c.id} type="button" onClick={() => setCategoryId(c.id)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium border transition-colors"
                    style={categoryId === c.id
                      ? { backgroundColor: c.bg_color, color: c.text_color, borderColor: "transparent" }
                      : { backgroundColor: "transparent", color: "#8A9199", borderColor: "rgba(255,255,255,0.08)" }}>
                    {c.display_label}
                  </button>
                ))}
              </div>
            </div>

            {/* Payment method */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Payment Method</label>
              <div className="flex flex-wrap gap-1.5">
                {PAYMENT_METHODS.map((p) => (
                  <button key={p.value} type="button" onClick={() => setPaymentMethod(p.value)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      paymentMethod === p.value
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-transparent text-[#8A9199] border-[rgba(255,255,255,0.08)] hover:text-foreground",
                    )}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Description (optional)</label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="text-base" />
            </div>
          </div>

          <div className="border-t border-border px-5 py-3 flex justify-end gap-2 bg-card">
            <button type="button" onClick={() => onOpenChange(false)}
              className="px-4 h-11 rounded-lg text-sm text-muted-foreground hover:bg-accent">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="px-5 h-11 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 disabled:opacity-60 inline-flex items-center gap-2">
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {existing ? "Save Changes" : "Log Expense"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptPreviewFromServer({ expenseId }: { expenseId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/expenses/${expenseId}/thumbnail-url`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j.url) setUrl(j.url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [expenseId]);
  if (!url) return <div className="w-20 h-20 rounded-lg bg-accent" />;
  return <img src={url} alt="" className="w-20 h-20 object-cover rounded-lg" />;
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```
Expect: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/expenses/log-expense-modal.tsx
git commit -m "feat(expenses): log expense modal (create + edit)"
```

---

## Task 12: Receipt Detail modal

**Files:**
- Create: `src/components/expenses/receipt-detail-modal.tsx`

- [ ] **Step 1: Write the modal**

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import type { Expense, ExpenseCategory, Vendor } from "@/lib/types";
import { paymentMethodLabel, formatAmount } from "@/lib/expenses-constants";
import LogExpenseModal from "./log-expense-modal";

type ExpenseWithRelations = Expense & {
  vendor?: Vendor | null;
  category?: ExpenseCategory | null;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  expense: ExpenseWithRelations | null;
  onChanged: () => void;
}

export default function ReceiptDetailModal({ open, onOpenChange, expense, onChanged }: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!open || !expense) { setImageUrl(null); return; }
    let cancelled = false;
    fetch(`/api/expenses/${expense.id}/receipt-url`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (!cancelled && j?.url) setImageUrl(j.url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, expense]);

  async function handleDelete() {
    if (!expense) return;
    setDeleting(true);
    const res = await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) {
      toast.success("Expense deleted");
      onChanged();
      setConfirmDelete(false);
      onOpenChange(false);
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed to delete");
    }
  }

  if (!expense) return null;

  return (
    <>
      <Dialog open={open && !editOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Receipt</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4">
            {imageUrl ? (
              <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="block">
                <img src={imageUrl} alt="Receipt" className="w-full max-h-[60vh] object-contain rounded-lg bg-accent/30" />
                <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1"><ExternalLink size={12} /> Open original</div>
              </a>
            ) : expense.receipt_path ? (
              <div className="h-48 rounded-lg bg-accent animate-pulse" />
            ) : (
              <div className="h-48 rounded-lg bg-accent/30 flex items-center justify-center text-muted-foreground text-sm">
                No receipt image
              </div>
            )}

            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Vendor</dt>
                <dd className="font-medium text-foreground">{expense.vendor?.name ?? expense.vendor_name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Amount</dt>
                <dd className="font-medium text-foreground">{formatAmount(expense.amount)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Date</dt>
                <dd className="font-medium text-foreground">{format(new Date(expense.expense_date), "MMM d, yyyy")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Category</dt>
                <dd>
                  {expense.category ? (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                      style={{ backgroundColor: expense.category.bg_color, color: expense.category.text_color }}>
                      {expense.category.display_label}
                    </span>
                  ) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Payment Method</dt>
                <dd className="font-medium text-foreground">{paymentMethodLabel(expense.payment_method)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Submitted By</dt>
                <dd className="font-medium text-foreground">{expense.submitter_name}</dd>
              </div>
              {expense.description && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Description</dt>
                  <dd className="text-foreground">{expense.description}</dd>
                </div>
              )}
              <div className="col-span-2 text-xs text-muted-foreground">
                Logged {format(new Date(expense.created_at), "MMM d, yyyy h:mm a")}
              </div>
            </dl>
          </div>

          <DialogFooter className="border-t border-border pt-3">
            {confirmDelete ? (
              <>
                <span className="text-sm text-destructive mr-auto">Delete this expense? This cannot be undone.</span>
                <button onClick={() => setConfirmDelete(false)}
                  className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent">Cancel</button>
                <button onClick={handleDelete} disabled={deleting}
                  className="px-3 py-2 rounded-lg text-sm font-medium bg-destructive text-white hover:bg-destructive/90 inline-flex items-center gap-2">
                  {deleting && <Loader2 size={14} className="animate-spin" />}
                  Delete
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setConfirmDelete(true)}
                  className="mr-auto px-3 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/10 inline-flex items-center gap-1.5">
                  <Trash2 size={14} /> Delete
                </button>
                <button onClick={() => setEditOpen(true)}
                  className="px-3 py-2 rounded-lg text-sm text-foreground border border-border hover:bg-accent inline-flex items-center gap-1.5">
                  <Pencil size={14} /> Edit
                </button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LogExpenseModal
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) { onChanged(); /* close the detail modal too so the caller can re-open with fresh data */ onOpenChange(false); }
        }}
        jobId={expense.job_id}
        existing={expense}
        onSaved={onChanged}
      />
    </>
  );
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```
Expect: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/expenses/receipt-detail-modal.tsx
git commit -m "feat(expenses): receipt detail modal with edit + delete"
```

---

## Task 13: Expenses section

**Files:**
- Create: `src/components/expenses/expenses-section.tsx`

- [ ] **Step 1: Write the section component**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Receipt, Plus, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import type { Expense, ExpenseCategory, Vendor } from "@/lib/types";
import { formatAmount } from "@/lib/expenses-constants";
import LogExpenseModal from "./log-expense-modal";
import ReceiptDetailModal from "./receipt-detail-modal";

type ExpenseRow = Expense & {
  vendor?: Vendor | null;
  category?: ExpenseCategory | null;
};

interface Props {
  jobId: string;
  onChanged?: () => void;
}

export default function ExpensesSection({ jobId, onChanged }: Props) {
  const [rows, setRows] = useState<ExpenseRow[] | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [logOpen, setLogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<ExpenseRow | null>(null);
  const { hasPermission } = useAuth();

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/expenses/by-job/${jobId}`);
    if (res.ok) setRows(await res.json());
    else { toast.error("Failed to load expenses"); setRows([]); }
    onChanged?.();
  }, [jobId, onChanged]);

  useEffect(() => { refresh(); }, [refresh]);

  const activeCategories = useMemo(() => {
    if (!rows) return [];
    const seen = new Map<string, ExpenseCategory>();
    for (const r of rows) if (r.category) seen.set(r.category.id, r.category);
    return Array.from(seen.values()).sort((a, b) => a.sort_order - b.sort_order);
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    if (filter === "all") return rows;
    return rows.filter((r) => r.category_id === filter);
  }, [rows, filter]);

  const canLog = hasPermission("log_expenses");

  return (
    <div className="bg-card rounded-xl border border-border p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground inline-flex items-center gap-2">
          <Receipt size={16} /> Expenses ({rows?.length ?? 0})
        </h3>
        {canLog && (
          <button onClick={() => { setSelected(null); setLogOpen(true); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110">
            <Plus size={14} /> Log Expense
          </button>
        )}
      </div>

      {activeCategories.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <button onClick={() => setFilter("all")}
            className={cn(
              "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
              filter === "all"
                ? "bg-[rgba(55,138,221,0.15)] text-[#85B7EB] border-[rgba(55,138,221,0.3)]"
                : "bg-transparent text-[#8A9199] border-[rgba(255,255,255,0.08)]",
            )}>
            All
          </button>
          {activeCategories.map((c) => (
            <button key={c.id} onClick={() => setFilter(c.id)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                filter === c.id
                  ? "bg-[rgba(55,138,221,0.15)] text-[#85B7EB] border-[rgba(55,138,221,0.3)]"
                  : "bg-transparent text-[#8A9199] border-[rgba(255,255,255,0.08)]",
              )}>
              {c.display_label}
            </button>
          ))}
        </div>
      )}

      {rows && rows.length === 0 ? (
        <div className="text-center py-8">
          <Receipt size={28} className="mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground mt-2">No expenses logged yet</p>
          {canLog && (
            <button onClick={() => { setSelected(null); setLogOpen(true); }}
              className="text-sm text-primary hover:underline mt-1">
              Log the first expense
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered?.map((r) => (
            <ExpenseRowView key={r.id} row={r}
              onClick={() => { setSelected(r); setDetailOpen(true); }} />
          ))}
        </div>
      )}

      <LogExpenseModal
        open={logOpen}
        onOpenChange={setLogOpen}
        jobId={jobId}
        onSaved={refresh}
      />
      <ReceiptDetailModal
        open={detailOpen}
        onOpenChange={(o) => { setDetailOpen(o); if (!o) setSelected(null); }}
        expense={selected}
        onChanged={refresh}
      />
    </div>
  );
}

function ExpenseRowView({ row, onClick }: { row: ExpenseRow; onClick: () => void }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!row.thumbnail_path) return;
    let cancelled = false;
    fetch(`/api/expenses/${row.id}/thumbnail-url`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (!cancelled && j?.url) setThumbUrl(j.url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [row.id, row.thumbnail_path]);

  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent/50 text-left transition-colors">
      <div className="w-10 h-10 rounded-lg bg-accent/30 flex items-center justify-center overflow-hidden flex-shrink-0">
        {thumbUrl
          ? <img src={thumbUrl} alt="" className="w-full h-full object-cover" />
          : <ImageIcon size={16} className="text-muted-foreground/50" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{row.vendor?.name ?? row.vendor_name}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {row.category && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
              style={{ backgroundColor: row.category.bg_color, color: row.category.text_color }}>
              {row.category.display_label}
            </span>
          )}
          <span>{format(new Date(row.expense_date), "MMM d")}</span>
          <span>·</span>
          <span>{row.submitter_name}</span>
        </div>
      </div>
      <div className="text-sm font-semibold text-foreground flex-shrink-0">{formatAmount(row.amount)}</div>
    </button>
  );
}
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```
Expect: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/expenses/expenses-section.tsx
git commit -m "feat(expenses): job-detail expenses section"
```

---

## Task 14: Wire into job detail + activity log

**Files:**
- Modify: `src/components/job-detail.tsx`
- Modify: `src/components/activity-timeline.tsx`

- [ ] **Step 1: Mount ExpensesSection in `job-detail.tsx`**

Use the Edit tool. Add the import near the other component imports (right after the `ContractsSection` import):

```
old_string:
import ContractsSection from "@/components/contracts/contracts-section";

new_string:
import ContractsSection from "@/components/contracts/contracts-section";
import ExpensesSection from "@/components/expenses/expenses-section";
```

Then mount the section immediately after the `<ContractsSection ... />` block and before the Reports block. Find and edit:

```
old_string:
      <ContractsSection
        jobId={jobId}
        customerName={job.contact ? `${job.contact.first_name} ${job.contact.last_name}` : null}
        customerEmail={job.contact?.email ?? null}
        onChanged={fetchData}
      />

      {/* Reports */}

new_string:
      <ContractsSection
        jobId={jobId}
        customerName={job.contact ? `${job.contact.first_name} ${job.contact.last_name}` : null}
        customerEmail={job.contact?.email ?? null}
        onChanged={fetchData}
      />

      <ExpensesSection jobId={jobId} onChanged={fetchData} />

      {/* Reports */}
```

- [ ] **Step 2: Update the activity timeline for the `'expense'` type and make expense rows clickable**

Open `src/components/activity-timeline.tsx`. Add `Receipt` to the lucide imports:

```
old_string:
import {
  MessageSquare,
  Camera,
  Flag,
  Shield,
  Wrench,
  Plus,
  Loader2,
} from "lucide-react";

new_string:
import {
  MessageSquare,
  Camera,
  Flag,
  Shield,
  Wrench,
  Receipt,
  Plus,
  Loader2,
} from "lucide-react";
```

Add imports for the expense types and the Receipt detail modal near the top (just below the existing imports):

```
old_string:
import { toast } from "sonner";

new_string:
import { toast } from "sonner";
import type { Expense, ExpenseCategory, Vendor } from "@/lib/types";
import ReceiptDetailModal from "@/components/expenses/receipt-detail-modal";
```

Add the `expense` entry to `activityTypeConfig` so rendered rows pick up the right icon and styling:

```
old_string:
const activityTypeConfig: Record<
  string,
  { icon: React.ComponentType<{ size?: number; className?: string }>; color: string; label: string }
> = {
  note: { icon: MessageSquare, color: "bg-vibrant-blue", label: "Note" },
  photo: { icon: Camera, color: "bg-primary", label: "Photo" },
  milestone: { icon: Flag, color: "bg-vibrant-red", label: "Milestone" },
  insurance: { icon: Shield, color: "bg-vibrant-purple", label: "Insurance" },
  equipment: { icon: Wrench, color: "bg-vibrant-amber", label: "Equipment" },
};

new_string:
const activityTypeConfig: Record<
  string,
  { icon: React.ComponentType<{ size?: number; className?: string }>; color: string; label: string }
> = {
  note: { icon: MessageSquare, color: "bg-vibrant-blue", label: "Note" },
  photo: { icon: Camera, color: "bg-primary", label: "Photo" },
  milestone: { icon: Flag, color: "bg-vibrant-red", label: "Milestone" },
  insurance: { icon: Shield, color: "bg-vibrant-purple", label: "Insurance" },
  equipment: { icon: Wrench, color: "bg-vibrant-amber", label: "Equipment" },
  expense: { icon: Receipt, color: "bg-[#27500A]", label: "Expense" },
};

type ExpenseWithRelations = Expense & { vendor?: Vendor | null; category?: ExpenseCategory | null };
```

Add state for the expense-activity → receipt-detail flow inside the component. Insert immediately after the existing `useState` declarations (look for the block starting with `const [open, setOpen] = useState(false);`):

```
old_string:
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activityType, setActivityType] = useState("note");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

new_string:
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activityType, setActivityType] = useState("note");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<ExpenseWithRelations | null>(null);

  async function handleActivityClick(activityId: string, activity_type: string) {
    if (activity_type !== "expense") return;
    const res = await fetch(`/api/expenses/by-activity/${activityId}`);
    if (!res.ok) { toast.error("Could not load receipt"); return; }
    const expense = (await res.json()) as ExpenseWithRelations;
    setSelectedExpense(expense);
    setReceiptOpen(true);
  }
```

Wrap the rendered activity row in a clickable button **only for `expense` type**. Find the `<div key={activity.id}` wrapper and replace the row outer element:

```
old_string:
              return (
                <div key={activity.id} className="flex gap-3 relative">
                  <div
                    className={cn(
                      "w-[30px] h-[30px] rounded-full flex items-center justify-center flex-shrink-0 z-10 shadow-sm",
                      config.color
                    )}
                  >
                    <Icon size={14} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">

new_string:
              const isExpense = activity.activity_type === "expense";
              const InnerWrapper: React.ElementType = isExpense ? "button" : "div";
              return (
                <InnerWrapper
                  key={activity.id}
                  onClick={isExpense ? () => handleActivityClick(activity.id, activity.activity_type) : undefined}
                  className={cn(
                    "w-full text-left flex gap-3 relative",
                    isExpense && "hover:bg-accent/30 rounded-lg -mx-1 px-1 py-0.5 cursor-pointer",
                  )}
                >
                  <div
                    className={cn(
                      "w-[30px] h-[30px] rounded-full flex items-center justify-center flex-shrink-0 z-10 shadow-sm",
                      config.color
                    )}
                  >
                    <Icon size={14} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
```

Close the wrapper properly at the end of the row (the row currently ends with `</div>` matching `<div key={activity.id}`). Find the matching close and replace with `</InnerWrapper>`:

```
old_string:
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {activity.author}
                    </p>
                  </div>
                </div>

new_string:
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {activity.author}
                    </p>
                  </div>
                </InnerWrapper>
```

Finally, render the `ReceiptDetailModal` at the bottom of the component's returned JSX. Find the closing tag of the outer container (`</div>` that closes the card) and insert the modal just before it. The easiest anchor is the penultimate closing tag — edit near the end of the component's return:

```
old_string:
            })}
          </div>
        </div>
      )}
    </div>
  );
}

new_string:
            })}
          </div>
        </div>
      )}
      <ReceiptDetailModal
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        expense={selectedExpense}
        onChanged={() => { onActivityAdded(); setReceiptOpen(false); }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Type check**

```bash
npx tsc --noEmit
```
Expect: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/job-detail.tsx src/components/activity-timeline.tsx
git commit -m "feat(job-detail): mount ExpensesSection and add expense activity icon"
```

---

## Task 15: End-to-end verification

**Files:** none modified

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Open `http://localhost:3000` and sign in.

- [ ] **Step 2: Verify Settings pages**

- Visit `/settings/expense-categories`. Expect 9 seeded categories with the chosen Lucide icons visible next to the name.
- Add a custom category, rename a default, reorder, delete the custom one. Each should round-trip.
- Visit `/settings/vendors`. Create 2–3 vendors (one supplier, one subcontractor, one with `is_1099=true`). Default category optional.
- Filter by each tab; confirm the 1099 Vendors tab only shows the 1099 rows. Deactivate one, confirm it disappears from the list when filter `active=true` via the autocomplete later. Re-activate it.

- [ ] **Step 3: Verify Log Expense (desktop)**

- Open any job (`/jobs/<id>`). The Expenses section should be between Contracts and Reports.
- Click "+ Log Expense". Pick a real receipt image (drag-drop or library). Pick a vendor from the autocomplete (try the "+ Add as new vendor" flow too). Amount, date, category, payment method, description. Submit.
- Expense row appears in the section with thumbnail, correct amount, vendor, category pill, date, submitter.
- Activity log shows "Logged expense: <vendor> — $<amount>" with the Receipt icon.

- [ ] **Step 4: Verify Log Expense (mobile viewport)**

Use `preview_resize` or the browser devtools device toolbar to set width 390×844 (iPhone).

- Open the same job. Tap "+ Log Expense". Modal should fill the viewport (no background visible).
- The Take Photo button is present; Choose from Library is present. Inputs are 44px high and 16px font.

- [ ] **Step 5: Verify Receipt Detail**

- Click the expense row. Modal opens with full receipt image. Click to open original in new tab.
- Scroll to the Activity Log. The expense activity row should be clickable (hover highlight). Click it — the same Receipt Detail Modal opens.
- Click Edit. The Log Expense modal re-opens in edit mode with fields prefilled.
- Change the amount, save. Back in the section, the row shows the new amount and the activity log title updates.
- Click Delete. Confirm. Row disappears. Activity log entry disappears. Receipt files are removed from the `receipts` bucket (verify in Supabase Storage UI — no file remains under `receipts/<job_id>/<uuid>.jpg` or `.thumb.jpg`).

- [ ] **Step 6: Verify permission gating**

- Create a `crew_member` user via `/settings/users`. Log in as them.
- Sidebar should hide Vendors and Expense Categories (requires admin or explicit perm).
- "+ Log Expense" should still appear on the job Overview (crew_member has `log_expenses` by default).
- They can log their own expense, see it in the section, edit and delete it.
- They can NOT edit or delete an expense logged by someone else (Edit/Delete buttons disabled or result in 403). Verify via DevTools network panel that the PATCH/DELETE returns 403 if submitted by another user.

- [ ] **Step 7: Type check clean**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | head
```
Expect: no new errors outside `jarvis/neural-network`. If `tsc` reports errors in files this build touched, fix them and re-verify.

- [ ] **Step 8: Commit anything left over**

```bash
git status
```

If nothing is untracked/modified, the build is done. Otherwise:
```bash
git add -A
git commit -m "chore(build16a): verification fixes"
```

---

## Self-Review Notes

- **Spec coverage**: every spec section has a corresponding task. Migration → 1. Types → 2. Storage bucket + image utils → Task 1 (bucket) and Task 3 (utils). APIs (vendors, categories, expenses, signed URLs, by-job, by-activity) → 4, 5, 6. Settings pages → 7, 8. Nav → 9. Autocomplete + Log modal + Receipt modal + Section → 10, 11, 12, 13. Activity log integration (including clickable expense rows) + job-detail mount → 14. Verification → 15.
- **No placeholders**: every code block is complete. No TBD/TODO.
- **Type consistency**: `VendorWithCategory` type is defined consistently in `vendor-autocomplete.tsx`, `log-expense-modal.tsx`, and used as `Vendor & { default_category?: ExpenseCategory | null }` in each. `Expense & { vendor?, category? }` appears consistently in section, modal, and API by-job route.
- **Order**: DB → types → utils → APIs → settings pages → nav → components → wire-up → verification. Each task's dependencies are already landed by the time the task runs.
