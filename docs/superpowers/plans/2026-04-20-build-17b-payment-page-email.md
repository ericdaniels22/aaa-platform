# Build 17b — Public Payment Page & Email Delivery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/settings/payments` (email templates, reminder cadence, fee disclosure), a `/lib/payment-emails.ts` dispatcher, wire the Billing section's "Send" action to actually email customers, and build the public customer-facing `/pay/[token]` flow with payment-method selection and Stripe session regeneration (using the 23.5-hour cap already decided in 17a). `/pay/[token]/success` is informational only. Webhook processing, receipt PDFs, refunds, and reminders-scheduler are **out of scope** (17c/17d).

**Architecture:**
- New singleton table `payment_email_settings` mirrors the shape of `contract_email_settings` from build33.
- Audit logging reuses the existing `contract_events` table by relaxing `contract_id` to nullable and stashing `payment_request_id` in the `metadata` jsonb column (spec Part 5 explicit requirement).
- Email dispatch reuses `RESEND_API_KEY` + the `email_accounts` table via a small local Resend/SMTP router parallel to `src/lib/contracts/email.ts` — Build 15 code is untouched.
- Merge fields are a superset: payment and invoice fields are added in a **new** `src/lib/payments/merge-fields.ts` that delegates to the existing `applyMergeFieldValues` so contract-flow callers are unaffected.
- The `/pay/[token]` route lives inside the existing `(public)` route group so it automatically picks up `src/app/(public)/layout.tsx` and `src/app/(public)/public.css` (same light theme as `/sign/[token]`).
- Payment token helper `src/lib/payment-link-tokens.ts` from 17a is reused unchanged.
- Stripe Checkout Session lifecycle: 17a caps session `expires_at` at 23.5h; 17b's `POST /api/pay/[token]/checkout` decides reuse-vs-regenerate per spec Part 7.

**Tech Stack:** Next.js 16.2.2 App Router (dynamic `params` is `Promise<{...}>` — `await params`), TypeScript strict (no `any`), Tailwind + shadcn/ui, Supabase (service client for privileged reads/writes, anon for client reads), `stripe` SDK v22 pinned to apiVersion `2026-03-25.dahlia` per 17a, `resend` package, `nodemailer` for SMTP fallback, `sonner` for toasts.

**Important conventions (verified from the current worktree):**
- Migration files are flat: `supabase/migration-build<NN>-<name>.sql`. Highest on disk in this worktree is `migration-build39-stripe-payments.sql`, so **this build uses `migration-build40-payment-emails.sql`**. If a higher number has landed before you run, rename to `build<NN+1>` and fix every reference.
- No test runner. "Verification" = `npx tsc --noEmit` (baseline is clean) + `npm run build` + a manual preview walkthrough against the Part 10 checklist in the spec.
- The `AGENTS.md` at the repo root demands: *"This is NOT the Next.js you know… Read the relevant guide in `node_modules/next/dist/docs/` before writing any code."* Before each task that touches a new Next.js surface (new route handler, server component, route group, middleware), skim the matching file under `node_modules/next/dist/docs/01-app/`.
- Route handlers with dynamic segments use `{ params }: { params: Promise<{ ... }> }`, then `const { x } = await params;` (verified in `src/app/api/accounting/export/[type]/route.ts`).
- Server-side privileged DB access uses `createServiceClient()` from `src/lib/supabase-api.ts`. Auth-gated server reads use `createServerSupabaseClient()` from `src/lib/supabase-server.ts`.
- Permission check: `requirePermission(supabase, "key")` from `src/lib/permissions-api.ts` — same pattern 17a established.
- `company_settings` is key-value — use the inline `select('key, value').in('key', [...])` → Map pattern from `src/app/(public)/sign/[token]/page.tsx:17-33`.

**Spec deviations (flagged — user should confirm before execution):**
1. **Auto-save vs. manual save on `/settings/payments`.** Spec Part 4 says *"auto-save on blur/change with toast confirmation — match the existing /settings/contracts auto-save behavior exactly."* `/settings/contracts` does **NOT** auto-save; it uses a dirty-flag + manual Save button (confirmed in `src/app/settings/contracts/page.tsx:15-101`). This plan follows the actual codebase pattern (dirty-flag + Save button) to honor "match the existing" over the conflicting "auto-save" language. If the user wants true auto-save, switch `/settings/contracts` first in a separate change so both settings pages stay consistent.
2. **Public route path.** Spec Part 7 says *"Create a minimal layout at src/app/pay/layout.tsx"*. The repo already has a `(public)` route group at `src/app/(public)/` with the exact light-theme scope the spec wants. This plan places the page at `src/app/(public)/pay/[token]/page.tsx` so it reuses the existing `PublicLayout` and `public.css` — no new layout file needed. Net effect for the user is identical: the URL is still `/pay/<token>` (route groups don't affect URL).
3. **Audit log schema migration.** Spec Part 5 says *"reuse that table — do NOT create a new one for this. Include payment_request_id in the metadata."* The current `contract_events` table has `contract_id uuid NOT NULL REFERENCES contracts(id)`, which blocks reuse. This plan adds **one ALTER in the build40 migration**: `ALTER TABLE contract_events ALTER COLUMN contract_id DROP NOT NULL`. No CHECK expansion needed — the existing event types (`sent`, `link_viewed`, `reminder_sent`, `voided`, `expired`, `email_delivered`, `email_opened`) already cover payment lifecycle. Surface this to the user on Task 1 — if they prefer a dedicated `payment_events` table instead, this plan can be adapted.

---

## File Structure

**New files (14):**
- `supabase/migration-build40-payment-emails.sql` — `payment_email_settings` singleton + seed, `contract_events.contract_id` nullability relax.
- `src/lib/payments/types.ts` — `PaymentEmailSettings`, `PaymentEmailProvider`, `PaymentEmailMergeExtras`.
- `src/lib/payments/merge-fields.ts` — `PAYMENT_MERGE_FIELDS`, `paymentMergeFieldsByCategory`, `buildPaymentMergeFieldValues`, `resolvePaymentEmailTemplate`.
- `src/lib/payments/email.ts` — `sendPaymentEmail` router (Resend + SMTP), parallel to `src/lib/contracts/email.ts`.
- `src/lib/payments/activity.ts` — `writePaymentEvent` helper (inserts into `contract_events` with `contract_id=null`, `metadata={ payment_request_id, ... }`).
- `src/lib/payment-emails.ts` — high-level `sendPaymentRequestEmail(supabase, paymentRequestId)` + `sendPaymentReminderEmail(...)`.
- `src/app/api/settings/payment-email/route.ts` — GET + PATCH for `payment_email_settings`.
- `src/app/api/payment-requests/[id]/send/route.ts` — POST; wraps `sendPaymentRequestEmail`, flips status `draft → sent`.
- `src/app/api/pay/[token]/checkout/route.ts` — POST; token-gated session reuse/regeneration.
- `src/app/settings/payments/page.tsx` — client component; mirrors `src/app/settings/contracts/page.tsx` layout.
- `src/app/settings/payments/payment-email-template-field.tsx` — shared subject + Tiptap body editor with payment-aware merge-field dropdown.
- `src/app/(public)/pay/[token]/page.tsx` — server component; token validation, status resolution, data load.
- `src/app/(public)/pay/[token]/method-selector.tsx` — `"use client"` — renders ACH/card buttons and POSTs to `/api/pay/[token]/checkout`.
- `src/app/(public)/pay/[token]/success/page.tsx` — informational confirmation.

**Modified files (2):**
- `src/lib/settings-nav.ts` — insert `{ href: "/settings/payments", label: "Payment Emails", icon: Mail }` right after the Stripe entry.
- `src/components/payments/online-payment-requests-subsection.tsx` — add Send / Copy link / View as customer actions; update STATUS_STYLES sent/viewed to amber (v1.7); keep paid/refunded/etc. untouched.

**Explicitly NOT touched:**
- `src/lib/contracts/**` (except read-only imports of `applyMergeFieldValues`, `MERGE_FIELDS`, `MERGE_FIELD_CATEGORIES`, `mergeFieldsByCategory`).
- `src/app/settings/contracts/**`.
- `src/app/(public)/sign/**`.
- `src/app/(public)/layout.tsx`, `src/app/(public)/public.css` (reuse; no edits).
- `src/lib/payment-link-tokens.ts` (17a — reuse).
- `src/app/api/payment-requests/route.ts` + `[id]/route.ts` + `[id]/void/route.ts` (17a — session cap is correct).
- `src/lib/stripe.ts` (17a).
- `src/lib/encryption.ts`.
- `src/app/api/stripe/webhooks/route.ts` (stub — touched by 17c).
- `globals.css`, Tailwind tokens, dark-mode variables.
- The three-card job detail layout; `RecordPaymentModal`.

---

## Preflight

- [ ] **P1: Verify clean baseline**

```bash
git status
npx tsc --noEmit
```
Expected: clean tree on branch `claude/adoring-carson-f53df4` (or whatever worktree branch you're on); tsc returns 0 errors. If not, stop and resolve before proceeding.

- [ ] **P2: Verify migration number**

```bash
ls supabase/migration-build*.sql | sort -V | tail -3
```
Expected latest is `migration-build39-stripe-payments.sql`. If something higher exists, rename `build40` → next number everywhere in this plan (migration file + any references).

- [ ] **P3: Confirm env prerequisites exist**

Read `.env.local`. `RESEND_API_KEY`, `SIGNING_LINK_SECRET` (≥32 chars), `ENCRYPTION_KEY` (64 hex chars), `NEXT_PUBLIC_APP_URL`, `STRIPE_CONNECT_STATE_SECRET`, `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_CONNECT_CLIENT_SECRET` must all already be set (added in Build 15 and 17a). If any is missing, stop — this is an environment issue, not a build issue.

- [ ] **P4: Confirm a Stripe test connection + contract email settings exist**

Required for end-to-end preview verification. Run in Supabase SQL editor:

```sql
select id, stripe_account_id, ach_enabled, card_enabled
  from stripe_connection limit 1;
select id, send_from_email, provider from contract_email_settings limit 1;
```
Expected: one row each. If `stripe_connection` is empty, connect via `/settings/stripe` first (17a flow). If `contract_email_settings.send_from_email` is empty, fill it via `/settings/contracts` first — the 17b payment email page copies the same email-validation approach, and having Build 15 configured lets you compare outputs.

- [ ] **P5: Open the Next.js docs for surfaces you will touch**

Per `AGENTS.md`: before each new route-handler task below, skim the corresponding Next.js doc. For this build, expect to touch:
- `node_modules/next/dist/docs/01-app/03-building-your-application/01-routing/12-route-handlers.mdx` (route handlers, dynamic params, streaming)
- `node_modules/next/dist/docs/01-app/03-building-your-application/01-routing/02-pages-and-layouts.mdx` (route groups, layouts)
- `node_modules/next/dist/docs/01-app/03-building-your-application/01-routing/11-middleware.mdx` if adjusting `middleware.ts` (you should NOT need to — `/pay/*` is public and should bypass auth middleware; verify this on Task 10).

You do not have to read them end-to-end. Note the Next.js 16 API shape for params and cookies, because it shifted from earlier versions.

---

## Task 1: Database migration (`migration-build40-payment-emails.sql`)

**Files:**
- Create: `supabase/migration-build40-payment-emails.sql`

**Context:** Single-row `payment_email_settings` shape mirrors `contract_email_settings` (build33) but stores only the two templates the spec specifies (request + reminder), plus a plain fee disclosure string. Receipt/refund/internal templates are deferred to 17c. Also relaxes `contract_events.contract_id` to nullable so payment sends can log against the same audit table.

- [ ] **Step 1: Write the migration**

Create `supabase/migration-build40-payment-emails.sql`:

```sql
-- Build 17b — Payment email settings + audit-log reuse
-- Creates a singleton payment_email_settings row (mirroring the
-- contract_email_settings pattern from build33), a default seed, and
-- relaxes contract_events.contract_id so payment-send events can log
-- into the same audit table per Build 17b spec Part 5.

-- ---------------------------------------------------------------------------
-- payment_email_settings — one row expected, seeded below.
-- ---------------------------------------------------------------------------
create table if not exists payment_email_settings (
  id uuid primary key default gen_random_uuid(),
  send_from_email text not null default '',
  send_from_name text not null default '',
  reply_to_email text,
  provider text not null default 'resend'
    check (provider in ('resend','email_account')),
  email_account_id uuid references email_accounts(id) on delete set null,
  payment_request_subject_template text not null default '',
  payment_request_body_template text not null default '',
  payment_reminder_subject_template text not null default '',
  payment_reminder_body_template text not null default '',
  reminder_day_offsets jsonb not null default '[3, 7]'::jsonb,
  default_link_expiry_days integer not null default 7
    check (default_link_expiry_days between 1 and 30),
  fee_disclosure_text text,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_payment_email_settings_updated_at on payment_email_settings;
create trigger trg_payment_email_settings_updated_at
  before update on payment_email_settings
  for each row execute function set_updated_at();

alter table payment_email_settings enable row level security;

drop policy if exists "Allow all on payment_email_settings" on payment_email_settings;
create policy "Allow all on payment_email_settings" on payment_email_settings
  for all using (true) with check (true);

grant all on payment_email_settings to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Relax contract_events.contract_id so payment send/view/reminder events
-- can be logged into the same audit table (spec Part 5). Payment rows
-- carry contract_id=NULL and store payment_request_id in metadata.
-- ---------------------------------------------------------------------------
alter table contract_events
  alter column contract_id drop not null;

-- Existing CHECK on event_type already permits: created, sent, email_delivered,
-- email_opened, link_viewed, signed, reminder_sent, voided, expired.
-- 'signed' is contract-only; payments reuse the other eight values.

-- ---------------------------------------------------------------------------
-- Seed default payment_email_settings row. Send-from fields are intentionally
-- blank — /settings/payments shows a setup banner until they're filled. Send
-- API hard-fails if either is empty, matching contract_email_settings behavior.
-- ---------------------------------------------------------------------------
insert into payment_email_settings (
  send_from_email,
  send_from_name,
  provider,
  payment_request_subject_template,
  payment_request_body_template,
  payment_reminder_subject_template,
  payment_reminder_body_template,
  reminder_day_offsets,
  default_link_expiry_days,
  fee_disclosure_text
) values (
  '',
  '',
  'resend',
  'Payment request: {{request_title}}',
  '<p>Hi {{customer_name}},</p><p>You have a payment request from <strong>{{company_name}}</strong> for <strong>{{amount_formatted}}</strong> — {{request_title}}.</p><p><a href="{{payment_link}}">Pay securely online</a></p><p>This secure link expires in {{link_expires_in_days}} days. Pay by bank transfer (ACH) to avoid card processing fees.</p><p>Questions? Reply to this email or call {{company_phone}}.</p><p>Thanks,<br>{{company_name}}</p>',
  'Reminder: {{request_title}} ({{amount_formatted}})',
  '<p>Hi {{customer_name}},</p><p>Just a reminder that your payment for <strong>{{request_title}}</strong> ({{amount_formatted}}) is still open.</p><p><a href="{{payment_link}}">Pay securely online</a></p><p>The link expires on {{link_expires_at}}. Let us know if you have any questions.</p><p>{{company_name}}<br>{{company_phone}}</p>',
  '[3, 7]'::jsonb,
  7,
  'A 3% service fee applies to card payments to cover payment processing costs. Pay by bank transfer (ACH) to avoid this fee.'
);
```

**Important:** `set_updated_at()` is the shared trigger function created in build39. Verify its existence by running `\df set_updated_at` in the SQL editor before running this migration; if absent, copy its definition from migration-build39 lines 258-263.

- [ ] **Step 2: Apply the migration**

Paste the file contents into the Supabase SQL editor (shared project — dev = prod per memory) and run.

Verify success:

```sql
-- 1. Table + seed exist
select id, provider, default_link_expiry_days, reminder_day_offsets
  from payment_email_settings;
-- Expected: one row, provider='resend', default_link_expiry_days=7

-- 2. contract_events.contract_id is nullable
select column_name, is_nullable
  from information_schema.columns
  where table_name='contract_events' and column_name='contract_id';
-- Expected: is_nullable = 'YES'
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors (migration is SQL — won't affect TS, but confirms baseline is still clean).

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-build40-payment-emails.sql
git commit -m "feat(17b): migration — payment_email_settings + relax contract_events.contract_id"
```

---

## Task 2: Payment domain types

**Files:**
- Create: `src/lib/payments/types.ts`

**Context:** Mirror of `src/lib/contracts/types.ts` `ContractEmailSettings` / `ContractEmailProvider`, but scoped to the payment table and the two templates it owns.

- [ ] **Step 1: Write the types module**

```ts
export type PaymentEmailProvider = "resend" | "email_account";

export interface PaymentEmailSettings {
  id: string;
  send_from_email: string;
  send_from_name: string;
  reply_to_email: string | null;
  provider: PaymentEmailProvider;
  email_account_id: string | null;
  payment_request_subject_template: string;
  payment_request_body_template: string;
  payment_reminder_subject_template: string;
  payment_reminder_body_template: string;
  reminder_day_offsets: number[];
  default_link_expiry_days: number;
  fee_disclosure_text: string | null;
  updated_at: string;
}

// Extras the payment merge-field resolver layers on top of the shared
// customer/job/company resolver — matches the /lib/contracts/email-merge-fields
// EMAIL_EXTRA_MERGE_FIELDS shape.
export const PAYMENT_EMAIL_EXTRA_MERGE_FIELDS = [
  { name: "payment_link", label: "Payment Link" },
  { name: "request_title", label: "Request Title" },
  { name: "amount", label: "Amount (raw)" },
  { name: "amount_formatted", label: "Amount (formatted $)" },
  { name: "card_fee_amount", label: "Card Fee (raw)" },
  { name: "card_fee_formatted", label: "Card Fee (formatted $)" },
  { name: "total_with_fee_formatted", label: "Amount + Card Fee (formatted $)" },
  { name: "link_expires_at", label: "Link Expiration Date" },
  { name: "link_expires_in_days", label: "Link Expires In (days)" },
  { name: "invoice_number", label: "Invoice Number" },
  { name: "invoice_total_formatted", label: "Invoice Total (formatted $)" },
  { name: "invoice_balance_formatted", label: "Invoice Balance (formatted $)" },
] as const;

export type PaymentExtraFieldName =
  typeof PAYMENT_EMAIL_EXTRA_MERGE_FIELDS[number]["name"];

// Shape passed into resolvePaymentEmailTemplate.
export interface PaymentEmailMergeExtras {
  payment_link: string;
  request_title: string;
  amount: string;
  amount_formatted: string;
  card_fee_amount: string | null;
  card_fee_formatted: string | null;
  total_with_fee_formatted: string | null;
  link_expires_at: string | null;
  link_expires_in_days: string | null;
  invoice_number: string | null;
  invoice_total_formatted: string | null;
  invoice_balance_formatted: string | null;
}

export interface PaymentRequestRow {
  id: string;
  job_id: string;
  invoice_id: string | null;
  request_type: "invoice" | "deposit" | "retainer" | "partial";
  title: string;
  amount: number;
  card_fee_amount: number | null;
  total_charged: number | null;
  status:
    | "draft" | "sent" | "viewed" | "paid" | "failed"
    | "refunded" | "partially_refunded" | "expired" | "voided";
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  payment_method_type: "card" | "us_bank_account" | null;
  link_token: string | null;
  link_expires_at: string | null;
  sent_at: string | null;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  reminder_count: number;
  next_reminder_at: string | null;
  voided_at: string | null;
  payer_email: string | null;
  payer_name: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/payments/types.ts
git commit -m "feat(17b): payment domain types — email settings + merge extras"
```

---

## Task 3: Payment merge-field resolver

**Files:**
- Create: `src/lib/payments/merge-fields.ts`

**Context:** Layered on top of `src/lib/contracts/merge-fields.ts#buildMergeFieldValues` — the existing resolver already handles customer/job/company/insurance fields. This module adds payment + invoice values and a `resolvePaymentEmailTemplate` convenience wrapper. Contract code is untouched.

- [ ] **Step 1: Write the module**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyMergeFieldValues,
  buildMergeFieldValues,
} from "@/lib/contracts/merge-fields";
import { PAYMENT_EMAIL_EXTRA_MERGE_FIELDS } from "./types";
import type { PaymentEmailMergeExtras } from "./types";

// Categorization mirrors MERGE_FIELD_CATEGORIES but local so the contract
// type union isn't widened. The /settings/payments sidebar renders these
// under the shared Customer/Job/Company/Insurance groups plus these two.
export const PAYMENT_MERGE_FIELD_CATEGORIES = ["Payment", "Invoice"] as const;
export type PaymentMergeFieldCategory =
  (typeof PAYMENT_MERGE_FIELD_CATEGORIES)[number];

export interface PaymentMergeFieldDefinition {
  name: string;
  label: string;
  category: PaymentMergeFieldCategory;
}

const PAYMENT_ONLY: PaymentMergeFieldDefinition[] = [
  { name: "request_title", label: "Request Title", category: "Payment" },
  { name: "amount", label: "Amount (raw)", category: "Payment" },
  { name: "amount_formatted", label: "Amount", category: "Payment" },
  { name: "card_fee_amount", label: "Card Fee (raw)", category: "Payment" },
  { name: "card_fee_formatted", label: "Card Fee", category: "Payment" },
  { name: "total_with_fee_formatted", label: "Amount + Card Fee", category: "Payment" },
  { name: "payment_link", label: "Payment Link", category: "Payment" },
  { name: "link_expires_at", label: "Link Expiration Date", category: "Payment" },
  { name: "link_expires_in_days", label: "Link Expires In (days)", category: "Payment" },
];

const INVOICE_ONLY: PaymentMergeFieldDefinition[] = [
  { name: "invoice_number", label: "Invoice Number", category: "Invoice" },
  { name: "invoice_total_formatted", label: "Invoice Total", category: "Invoice" },
  { name: "invoice_balance_formatted", label: "Invoice Balance", category: "Invoice" },
];

export const PAYMENT_MERGE_FIELDS: PaymentMergeFieldDefinition[] = [
  ...PAYMENT_ONLY,
  ...INVOICE_ONLY,
];

export function paymentMergeFieldsByCategory(): Record<
  PaymentMergeFieldCategory,
  PaymentMergeFieldDefinition[]
> {
  const grouped: Record<PaymentMergeFieldCategory, PaymentMergeFieldDefinition[]> = {
    Payment: [],
    Invoice: [],
  };
  for (const f of PAYMENT_MERGE_FIELDS) grouped[f.category].push(f);
  return grouped;
}

// USD formatter. Single source of truth so emails and the /pay page show
// the same strings.
export function formatUsd(n: number | null | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

interface PaymentRequestLite {
  id: string;
  job_id: string;
  invoice_id: string | null;
  title: string;
  amount: number;
  card_fee_amount: number | null;
  link_token: string | null;
  link_expires_at: string | null;
}

interface StripeConnectionFees {
  pass_card_fee_to_customer: boolean;
  card_fee_percent: number;
}

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  total_amount: number;
}

// Builds the full merge-field value map for a given payment request. It
// delegates customer/job/company/insurance fields to the shared contract
// resolver (so contract_phone, customer_address, etc. all resolve the
// same way) and layers payment + invoice fields on top.
export async function buildPaymentMergeFieldValues(
  supabase: SupabaseClient,
  pr: PaymentRequestLite,
  opts?: { appUrl?: string; stripeConnection?: StripeConnectionFees | null },
): Promise<Record<string, string | null>> {
  const values = await buildMergeFieldValues(supabase, pr.job_id);

  const appUrl =
    opts?.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "";

  // Card fee formatting. Prefer the stored card_fee_amount (set at
  // /api/pay/[token]/checkout time when the customer chooses the card
  // path). Otherwise compute from the connection's pass_card_fee +
  // card_fee_percent for the email-template preview case.
  let cardFee = pr.card_fee_amount;
  if (cardFee == null && opts?.stripeConnection?.pass_card_fee_to_customer) {
    cardFee = Math.round(
      pr.amount * (Number(opts.stripeConnection.card_fee_percent) / 100) * 100,
    ) / 100;
  }
  const totalWithFee = cardFee != null ? pr.amount + cardFee : null;

  // Link expiry
  let linkExpiresIso: string | null = pr.link_expires_at;
  let linkExpiresInDays: string | null = null;
  if (linkExpiresIso) {
    try {
      linkExpiresInDays = String(
        daysBetween(new Date(), new Date(linkExpiresIso)),
      );
    } catch {
      linkExpiresInDays = null;
    }
  }

  values.request_title = pr.title;
  values.amount = String(pr.amount.toFixed(2));
  values.amount_formatted = formatUsd(pr.amount);
  values.card_fee_amount = cardFee != null ? String(cardFee.toFixed(2)) : null;
  values.card_fee_formatted = formatUsd(cardFee);
  values.total_with_fee_formatted = formatUsd(totalWithFee);
  values.payment_link = pr.link_token ? `${appUrl}/pay/${pr.link_token}` : null;
  values.link_expires_at = formatDate(linkExpiresIso);
  values.link_expires_in_days = linkExpiresInDays;

  // Invoice fields
  if (pr.invoice_id) {
    const { data: invoice } = await supabase
      .from("invoices")
      .select("id, invoice_number, total_amount")
      .eq("id", pr.invoice_id)
      .maybeSingle<InvoiceRow>();
    if (invoice) {
      values.invoice_number = invoice.invoice_number;
      values.invoice_total_formatted = formatUsd(Number(invoice.total_amount));
      // Compute balance: total_amount - sum(payments where status='received')
      const { data: payments } = await supabase
        .from("payments")
        .select("amount, status")
        .eq("invoice_id", pr.invoice_id);
      const paid = (payments ?? [])
        .filter(
          (p: { amount: number; status: string }) => p.status === "received",
        )
        .reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0);
      const balance = Number(invoice.total_amount) - paid;
      values.invoice_balance_formatted = formatUsd(balance);
    }
  }

  return values;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Resolves a payment email subject + body against a payment request.
// Parallels resolveEmailTemplate from src/lib/contracts/email-merge-fields.ts.
export async function resolvePaymentEmailTemplate(
  supabase: SupabaseClient,
  subjectTemplate: string,
  bodyTemplate: string,
  pr: PaymentRequestLite,
  opts?: {
    appUrl?: string;
    stripeConnection?: StripeConnectionFees | null;
  },
): Promise<{ subject: string; html: string; unresolvedFields: string[] }> {
  const values = await buildPaymentMergeFieldValues(supabase, pr, opts);

  const subjResult = applyMergeFieldValues(subjectTemplate, values);
  const subject = decodeHtmlEntities(subjResult.html);

  const bodyResult = applyMergeFieldValues(bodyTemplate, values);

  const unresolved = Array.from(
    new Set([...subjResult.unresolvedFields, ...bodyResult.unresolvedFields]),
  );
  return { subject, html: bodyResult.html, unresolvedFields: unresolved };
}

// Export for the settings sidebar.
export { PAYMENT_EMAIL_EXTRA_MERGE_FIELDS };
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/payments/
git commit -m "feat(17b): payment merge-field resolver layered on shared contract resolver"
```

---

## Task 4: Email dispatcher modules (`src/lib/payments/email.ts` + `src/lib/payment-emails.ts`)

**Files:**
- Create: `src/lib/payments/email.ts`
- Create: `src/lib/payments/activity.ts`
- Create: `src/lib/payment-emails.ts`

**Context:** Three pieces:
- `src/lib/payments/email.ts` — low-level Resend/SMTP router. Intentional small duplication of the logic in `src/lib/contracts/email.ts` so Build 15 code stays untouched.
- `src/lib/payments/activity.ts` — writes a `contract_events` row with `contract_id=null` and `metadata={ payment_request_id, provider, message_id, ... }`, per spec Part 5.
- `src/lib/payment-emails.ts` — high-level orchestrator called by the send route and (later) the reminder cron.

- [ ] **Step 1: Write `src/lib/payments/email.ts`**

```ts
import { Resend } from "resend";
import nodemailer from "nodemailer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";
import type { PaymentEmailSettings } from "./types";

export interface Attachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SendResult {
  messageId: string;
  provider: "resend" | "smtp";
}

function requireResendKey(): string {
  const k = process.env.RESEND_API_KEY;
  if (!k) throw new Error("RESEND_API_KEY is not set");
  return k;
}

function formatFromHeader(name: string, address: string): string {
  return `"${name.replace(/"/g, '\\"')}" <${address}>`;
}

export async function sendViaResend(
  settings: PaymentEmailSettings,
  to: string,
  subject: string,
  html: string,
  attachments: Attachment[] = [],
): Promise<SendResult> {
  if (!settings.send_from_email) {
    throw new Error(
      "Resend send failed: payment_email_settings.send_from_email is empty. Set it in Settings → Payment Emails.",
    );
  }
  const resend = new Resend(requireResendKey());
  const { data, error } = await resend.emails.send({
    from: formatFromHeader(
      settings.send_from_name || "Payments",
      settings.send_from_email,
    ),
    to,
    subject,
    html,
    replyTo: settings.reply_to_email || undefined,
    attachments: attachments.map((a) => ({
      filename: a.filename,
      content: a.content.toString("base64"),
    })),
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
  if (!data?.id) throw new Error("Resend did not return a message id");
  return { messageId: data.id, provider: "resend" };
}

export async function sendViaSmtp(
  supabase: SupabaseClient,
  accountId: string,
  settings: PaymentEmailSettings,
  to: string,
  subject: string,
  html: string,
  attachments: Attachment[] = [],
): Promise<SendResult> {
  const { data: account, error } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", accountId)
    .single();
  if (error || !account) {
    throw new Error(`Email account ${accountId} not found for SMTP send`);
  }

  let password: string;
  try {
    password = decrypt(account.encrypted_password);
  } catch (e) {
    throw new Error(
      `Failed to decrypt email account password: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  const fromName =
    settings.send_from_name || account.display_name || "Payments";
  const fromEmail = settings.send_from_email || account.email_address;

  const transporter = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: account.smtp_port === 465,
    auth: { user: account.username, pass: password },
    tls: {
      rejectUnauthorized:
        process.env.EMAIL_TLS_REJECT_UNAUTHORIZED === "true",
    },
  });

  try {
    const info = await transporter.sendMail({
      from: formatFromHeader(fromName, fromEmail),
      to,
      replyTo: settings.reply_to_email || undefined,
      subject,
      html,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    return {
      messageId: info.messageId || `smtp-${Date.now()}`,
      provider: "smtp",
    };
  } finally {
    transporter.close();
  }
}

export async function sendPaymentEmail(
  supabase: SupabaseClient,
  settings: PaymentEmailSettings,
  args: {
    to: string;
    subject: string;
    html: string;
    attachments?: Attachment[];
  },
): Promise<SendResult> {
  const { to, subject, html, attachments = [] } = args;
  if (!to) throw new Error("sendPaymentEmail: 'to' address is required");
  if (!subject) throw new Error("sendPaymentEmail: 'subject' is required");

  if (settings.provider === "resend") {
    return sendViaResend(settings, to, subject, html, attachments);
  }
  if (settings.provider === "email_account") {
    if (!settings.email_account_id) {
      throw new Error(
        "Payment email settings use the email_account provider but no email_account_id is configured.",
      );
    }
    return sendViaSmtp(
      supabase,
      settings.email_account_id,
      settings,
      to,
      subject,
      html,
      attachments,
    );
  }
  throw new Error(`Unknown payment email provider: ${settings.provider}`);
}
```

- [ ] **Step 2: Write `src/lib/payments/activity.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

// Writes a payment-scoped row to contract_events (schema widened in
// migration-build40: contract_id is nullable so payment events share
// the same audit table per spec Part 5). payment_request_id goes in
// metadata; contract_id + signer_id stay NULL.
export interface PaymentEventArgs {
  paymentRequestId: string;
  eventType:
    | "created"
    | "sent"
    | "email_delivered"
    | "email_opened"
    | "link_viewed"
    | "reminder_sent"
    | "voided"
    | "expired";
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function writePaymentEvent(
  supabase: SupabaseClient,
  args: PaymentEventArgs,
): Promise<void> {
  const { error } = await supabase.from("contract_events").insert({
    contract_id: null,
    signer_id: null,
    event_type: args.eventType,
    ip_address: args.ipAddress ?? null,
    user_agent: args.userAgent ?? null,
    metadata: {
      payment_request_id: args.paymentRequestId,
      ...(args.metadata ?? {}),
    },
  });
  if (error) {
    // Audit write failures must not block the main flow.
    // eslint-disable-next-line no-console
    console.error("writePaymentEvent failed:", error);
  }
}
```

- [ ] **Step 3: Write `src/lib/payment-emails.ts`**

```ts
import { createServiceClient } from "@/lib/supabase-api";
import { resolvePaymentEmailTemplate } from "@/lib/payments/merge-fields";
import { sendPaymentEmail } from "@/lib/payments/email";
import { writePaymentEvent } from "@/lib/payments/activity";
import type {
  PaymentEmailSettings,
  PaymentRequestRow,
} from "@/lib/payments/types";

interface StripeConnectionFees {
  pass_card_fee_to_customer: boolean;
  card_fee_percent: number;
}

// Computes the first reminder timestamp given send-time + offsets.
// Mirrors src/lib/contracts/reminders.ts#computeInitialNextReminderAt so
// future cron code can share the same signal.
export function computeInitialNextReminderAt(
  sentAt: Date,
  offsets: number[],
): Date | null {
  const valid = (offsets ?? [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!valid.length) return null;
  const first = Math.min(...valid);
  return new Date(sentAt.getTime() + first * 24 * 60 * 60 * 1000);
}

async function loadSettings(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<PaymentEmailSettings> {
  const { data, error } = await supabase
    .from("payment_email_settings")
    .select("*")
    .limit(1)
    .maybeSingle<PaymentEmailSettings>();
  if (error) throw new Error(error.message);
  if (!data)
    throw new Error(
      "payment_email_settings row missing — did the build40 migration run?",
    );
  if (!data.send_from_email || !data.send_from_name) {
    throw new Error(
      "Set a send-from email and display name in Settings → Payment Emails before sending.",
    );
  }
  return data;
}

async function loadPaymentRequest(
  supabase: ReturnType<typeof createServiceClient>,
  paymentRequestId: string,
): Promise<PaymentRequestRow> {
  const { data, error } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("id", paymentRequestId)
    .maybeSingle<PaymentRequestRow>();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`payment_request ${paymentRequestId} not found`);
  return data;
}

async function loadRecipient(
  supabase: ReturnType<typeof createServiceClient>,
  pr: PaymentRequestRow,
): Promise<{ email: string; name: string | null }> {
  if (pr.payer_email) {
    return { email: pr.payer_email, name: pr.payer_name };
  }
  const { data: job } = await supabase
    .from("jobs")
    .select("contact_id")
    .eq("id", pr.job_id)
    .maybeSingle<{ contact_id: string | null }>();
  if (!job?.contact_id) {
    throw new Error(
      "No customer email on file — set a contact email on the job before sending.",
    );
  }
  const { data: contact } = await supabase
    .from("contacts")
    .select("email, first_name, last_name")
    .eq("id", job.contact_id)
    .maybeSingle<{
      email: string | null;
      first_name: string | null;
      last_name: string | null;
    }>();
  if (!contact?.email) {
    throw new Error(
      "Customer contact has no email address — cannot send payment request.",
    );
  }
  const name =
    [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() ||
    null;
  return { email: contact.email, name };
}

async function loadStripeFees(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<StripeConnectionFees | null> {
  const { data } = await supabase
    .from("stripe_connection")
    .select("pass_card_fee_to_customer, card_fee_percent")
    .limit(1)
    .maybeSingle<StripeConnectionFees>();
  return data ?? null;
}

export async function sendPaymentRequestEmail(
  paymentRequestId: string,
): Promise<{ messageId: string; provider: "resend" | "smtp" }> {
  const supabase = createServiceClient();
  const [settings, pr, fees] = await Promise.all([
    loadSettings(supabase),
    loadPaymentRequest(supabase, paymentRequestId),
    loadStripeFees(supabase),
  ]);
  const recipient = await loadRecipient(supabase, pr);

  const { subject, html } = await resolvePaymentEmailTemplate(
    supabase,
    settings.payment_request_subject_template,
    settings.payment_request_body_template,
    pr,
    { stripeConnection: fees },
  );

  const sent = await sendPaymentEmail(supabase, settings, {
    to: recipient.email,
    subject,
    html,
  });

  // Status + timestamp transition. On first send only.
  const firstReminder = computeInitialNextReminderAt(
    new Date(),
    settings.reminder_day_offsets,
  );
  const { error: upErr } = await supabase
    .from("payment_requests")
    .update({
      status: pr.status === "draft" ? "sent" : pr.status,
      sent_at: pr.sent_at ?? new Date().toISOString(),
      next_reminder_at: firstReminder
        ? firstReminder.toISOString()
        : pr.next_reminder_at,
      payer_email: pr.payer_email ?? recipient.email,
      payer_name: pr.payer_name ?? recipient.name,
    })
    .eq("id", pr.id);
  if (upErr) {
    // Email already went out — surface but keep the DB state best-effort.
    throw new Error(
      `Email sent (message ${sent.messageId}) but status update failed: ${upErr.message}`,
    );
  }

  await writePaymentEvent(supabase, {
    paymentRequestId: pr.id,
    eventType: "sent",
    metadata: { provider: sent.provider, message_id: sent.messageId },
  });

  return sent;
}

export async function sendPaymentReminderEmail(
  paymentRequestId: string,
): Promise<{ messageId: string; provider: "resend" | "smtp" }> {
  const supabase = createServiceClient();
  const [settings, pr, fees] = await Promise.all([
    loadSettings(supabase),
    loadPaymentRequest(supabase, paymentRequestId),
    loadStripeFees(supabase),
  ]);
  if (pr.status !== "sent" && pr.status !== "viewed") {
    throw new Error(
      `Cannot send reminder: payment_request status is ${pr.status}`,
    );
  }
  const recipient = await loadRecipient(supabase, pr);
  const { subject, html } = await resolvePaymentEmailTemplate(
    supabase,
    settings.payment_reminder_subject_template,
    settings.payment_reminder_body_template,
    pr,
    { stripeConnection: fees },
  );
  const sent = await sendPaymentEmail(supabase, settings, {
    to: recipient.email,
    subject,
    html,
  });
  await supabase
    .from("payment_requests")
    .update({
      reminder_count: pr.reminder_count + 1,
    })
    .eq("id", pr.id);
  await writePaymentEvent(supabase, {
    paymentRequestId: pr.id,
    eventType: "reminder_sent",
    metadata: { provider: sent.provider, message_id: sent.messageId },
  });
  return sent;
}
```

- [ ] **Step 4: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/email.ts src/lib/payments/activity.ts src/lib/payment-emails.ts
git commit -m "feat(17b): payment email dispatcher + audit helper"
```

---

## Task 5: `/api/settings/payment-email` route

**Files:**
- Create: `src/app/api/settings/payment-email/route.ts`

**Context:** GET + PATCH. Mirrors `src/app/api/settings/contract-email/route.ts` almost exactly — read through it before writing.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requirePermission } from "@/lib/permissions-api";
import type {
  PaymentEmailProvider,
  PaymentEmailSettings,
} from "@/lib/payments/types";

async function getSettings() {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("payment_email_settings")
    .select("*")
    .limit(1)
    .maybeSingle<PaymentEmailSettings>();
  return { supabase, data, error };
}

export async function GET() {
  const auth = await createServerSupabaseClient();
  const gate = await requirePermission(auth, "access_settings");
  if (!gate.ok) return gate.response;

  const { data, error } = await getSettings();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: "payment_email_settings row missing — did the build40 migration run?" },
      { status: 500 },
    );
  }
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const auth = await createServerSupabaseClient();
  const gate = await requirePermission(auth, "access_settings");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => null)) as
    | Partial<PaymentEmailSettings>
    | null;
  if (!body) {
    return NextResponse.json(
      { error: "Body must be a JSON object" },
      { status: 400 },
    );
  }

  const { supabase, data: current, error: fetchErr } = await getSettings();
  if (fetchErr)
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!current) {
    return NextResponse.json(
      { error: "payment_email_settings row missing — did the build40 migration run?" },
      { status: 500 },
    );
  }

  const patch: Partial<PaymentEmailSettings> = {};
  const stringFields: Array<keyof PaymentEmailSettings> = [
    "send_from_email",
    "send_from_name",
    "payment_request_subject_template",
    "payment_request_body_template",
    "payment_reminder_subject_template",
    "payment_reminder_body_template",
  ];
  for (const f of stringFields) {
    if (typeof body[f] === "string") {
      (patch as Record<string, unknown>)[f] = body[f];
    }
  }
  if (body.reply_to_email === null || typeof body.reply_to_email === "string") {
    patch.reply_to_email = body.reply_to_email || null;
  }
  if (body.provider === "resend" || body.provider === "email_account") {
    patch.provider = body.provider as PaymentEmailProvider;
  }
  if (
    body.email_account_id === null ||
    typeof body.email_account_id === "string"
  ) {
    patch.email_account_id = body.email_account_id || null;
  }
  if (Array.isArray(body.reminder_day_offsets)) {
    const offsets = body.reminder_day_offsets
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 60);
    patch.reminder_day_offsets = offsets;
  }
  if (typeof body.default_link_expiry_days === "number") {
    const d = Math.round(body.default_link_expiry_days);
    if (d < 1 || d > 30) {
      return NextResponse.json(
        { error: "default_link_expiry_days must be between 1 and 30" },
        { status: 400 },
      );
    }
    patch.default_link_expiry_days = d;
  }
  if (body.fee_disclosure_text === null || typeof body.fee_disclosure_text === "string") {
    patch.fee_disclosure_text = body.fee_disclosure_text || null;
  }

  if (
    patch.provider === "email_account" &&
    !patch.email_account_id &&
    !current.email_account_id
  ) {
    return NextResponse.json(
      {
        error:
          "Select an email account before switching provider to email_account",
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("payment_email_settings")
    .update(patch)
    .eq("id", current.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Smoke-test GET**

```bash
curl -s http://localhost:3000/api/settings/payment-email -H "Cookie: $(... paste your session cookie ...)"
```
Or simply trust that Task 7's UI will exercise this.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/settings/payment-email/
git commit -m "feat(17b): /api/settings/payment-email GET + PATCH"
```

---

## Task 6: Settings nav — insert "Payment Emails"

**Files:**
- Modify: `src/lib/settings-nav.ts`

- [ ] **Step 1: Edit the nav array**

Current relevant lines (from `src/lib/settings-nav.ts:45-47`):
```ts
  { href: "/settings/accounting", label: "Accounting", icon: Link2 },
  { href: "/settings/stripe", label: "Stripe Payments", icon: CreditCard },
  { href: "/settings/reports", label: "Reports", icon: FileText },
```

Change to:
```ts
  { href: "/settings/accounting", label: "Accounting", icon: Link2 },
  { href: "/settings/stripe", label: "Stripe Payments", icon: CreditCard },
  { href: "/settings/payments", label: "Payment Emails", icon: Mail },
  { href: "/settings/reports", label: "Reports", icon: FileText },
```

`Mail` is already imported at line 9 — no new import needed.

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings-nav.ts
git commit -m "feat(17b): settings nav — add Payment Emails entry"
```

---

## Task 7: `/settings/payments` page + merge-field template field

**Files:**
- Create: `src/app/settings/payments/page.tsx`
- Create: `src/app/settings/payments/payment-email-template-field.tsx`

**Context:** Mirrors `src/app/settings/contracts/page.tsx` (309 lines — re-read before editing). Dirty-flag + Save button pattern. The template-field helper is a local copy of `src/components/contracts/email-template-field.tsx` extended to offer the payment + invoice merge fields.

- [ ] **Step 1: Write `payment-email-template-field.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import TiptapEditor from "@/components/tiptap-editor";
import { ChevronDown, Plus } from "lucide-react";
import {
  MERGE_FIELD_CATEGORIES,
  mergeFieldsByCategory,
} from "@/lib/contracts/merge-fields";
import {
  PAYMENT_MERGE_FIELD_CATEGORIES,
  paymentMergeFieldsByCategory,
} from "@/lib/payments/merge-fields";

export interface PaymentEmailTemplateFieldProps {
  label: string;
  description?: string;
  subject: string;
  body: string;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
}

export default function PaymentEmailTemplateField({
  label,
  description,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
}: PaymentEmailTemplateFieldProps) {
  const [subjectMenuOpen, setSubjectMenuOpen] = useState(false);
  const [bodyMenuOpen, setBodyMenuOpen] = useState(false);
  const subjectInputRef = useRef<HTMLInputElement | null>(null);

  const contractGrouped = mergeFieldsByCategory();
  const paymentGrouped = paymentMergeFieldsByCategory();

  function insertIntoSubject(fieldName: string) {
    const el = subjectInputRef.current;
    const insert = `{{${fieldName}}}`;
    if (!el) {
      onSubjectChange(subject + insert);
      setSubjectMenuOpen(false);
      return;
    }
    const start = el.selectionStart ?? subject.length;
    const end = el.selectionEnd ?? subject.length;
    const next = subject.slice(0, start) + insert + subject.slice(end);
    onSubjectChange(next);
    setSubjectMenuOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + insert.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function insertIntoBody(fieldName: string) {
    onBodyChange(body + ` {{${fieldName}}}`);
    setBodyMenuOpen(false);
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">
            Subject
          </label>
          <MergeFieldDropdown
            open={subjectMenuOpen}
            setOpen={setSubjectMenuOpen}
            contractGrouped={contractGrouped}
            paymentGrouped={paymentGrouped}
            onPick={insertIntoSubject}
          />
        </div>
        <input
          ref={subjectInputRef}
          type="text"
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30 focus:border-[var(--brand-primary)]"
          placeholder="Subject line"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-muted-foreground">Body</label>
          <MergeFieldDropdown
            open={bodyMenuOpen}
            setOpen={setBodyMenuOpen}
            contractGrouped={contractGrouped}
            paymentGrouped={paymentGrouped}
            onPick={insertIntoBody}
          />
        </div>
        <TiptapEditor
          content={body}
          onChange={onBodyChange}
          placeholder="Email body. Use merge fields to insert data at send time."
        />
      </div>
    </div>
  );
}

function MergeFieldDropdown({
  open,
  setOpen,
  contractGrouped,
  paymentGrouped,
  onPick,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  contractGrouped: ReturnType<typeof mergeFieldsByCategory>;
  paymentGrouped: ReturnType<typeof paymentMergeFieldsByCategory>;
  onPick: (fieldName: string) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/10 transition-colors"
      >
        <Plus size={12} /> Merge Field <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-72 max-h-80 overflow-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-xl z-40 p-2">
          {PAYMENT_MERGE_FIELD_CATEGORIES.map((cat) => (
            <div key={cat} className="mb-2">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {cat}
              </div>
              <div className="flex flex-wrap gap-1">
                {paymentGrouped[cat].map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    onClick={() => onPick(f.name)}
                    className="merge-field-pill cursor-pointer hover:brightness-110"
                  >
                    {`{{${f.name}}}`}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {MERGE_FIELD_CATEGORIES.map((cat) => (
            <div key={cat} className="mb-2 last:mb-0">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {cat}
              </div>
              <div className="flex flex-wrap gap-1">
                {contractGrouped[cat].map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    onClick={() => onPick(f.name)}
                    className="merge-field-pill cursor-pointer hover:brightness-110"
                  >
                    {`{{${f.name}}}`}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write `page.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, Send, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import PaymentEmailTemplateField from "./payment-email-template-field";
import type {
  PaymentEmailProvider,
  PaymentEmailSettings,
} from "@/lib/payments/types";

interface EmailAccount {
  id: string;
  label: string;
  email_address: string;
}

export default function PaymentEmailSettingsPage() {
  const [settings, setSettings] = useState<PaymentEmailSettings | null>(null);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const refresh = useCallback(async () => {
    const [settingsRes, accountsRes] = await Promise.all([
      fetch("/api/settings/payment-email"),
      fetch("/api/email/accounts"),
    ]);
    if (settingsRes.ok) {
      setSettings((await settingsRes.json()) as PaymentEmailSettings);
    } else {
      toast.error("Failed to load payment email settings");
    }
    if (accountsRes.ok) {
      const data = (await accountsRes.json()) as EmailAccount[];
      setAccounts(data);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function patch<K extends keyof PaymentEmailSettings>(
    key: K,
    value: PaymentEmailSettings[K],
  ) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/payment-email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Save failed");
      }
      setDirty(false);
      toast.success("Payment email settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Loader2 size={20} className="inline animate-spin mr-2" /> Loading…
      </div>
    );
  }

  const setupIncomplete = !settings.send_from_email || !settings.send_from_name;
  const offsetsText = settings.reminder_day_offsets.join(", ");

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Send size={18} className="text-[var(--brand-primary)]" />
            Payment Email Settings
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Controls how payment request and reminder emails are delivered.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all disabled:opacity-60"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save
        </button>
      </div>

      {setupIncomplete && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 flex items-start gap-3 text-sm text-amber-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">
              Finish payment email setup before sending
            </div>
            <div className="text-xs text-amber-300/80 mt-0.5">
              A send-from email and display name are required. Sends will fail
              until both are filled in below.
            </div>
          </div>
        </div>
      )}

      {/* Provider + addresses */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Send from</h3>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted-foreground mb-1">
            Delivery provider
          </legend>
          <label className="flex items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5 cursor-pointer hover:bg-background/60 transition-colors">
            <input
              type="radio"
              name="provider"
              className="mt-1 accent-[var(--brand-primary)]"
              checked={settings.provider === "resend"}
              onChange={() => patch("provider", "resend" as PaymentEmailProvider)}
            />
            <div>
              <div className="text-sm text-foreground font-medium">
                Resend{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  (recommended)
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                Dedicated transactional email. Requires RESEND_API_KEY and a
                verified sending domain.
              </div>
            </div>
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5 cursor-pointer hover:bg-background/60 transition-colors">
            <input
              type="radio"
              name="provider"
              className="mt-1 accent-[var(--brand-primary)]"
              checked={settings.provider === "email_account"}
              onChange={() =>
                patch("provider", "email_account" as PaymentEmailProvider)
              }
            />
            <div className="flex-1">
              <div className="text-sm text-foreground font-medium">
                Use a connected email account
              </div>
              <div className="text-xs text-muted-foreground">
                Sends via SMTP through one of the Build 12 email accounts.
              </div>
              {settings.provider === "email_account" && (
                <select
                  value={settings.email_account_id ?? ""}
                  onChange={(e) =>
                    patch("email_account_id", e.target.value || null)
                  }
                  className="mt-2 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
                >
                  <option value="">— Select account —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} ({a.email_address})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </label>
        </fieldset>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextInput
            label="Send-from email"
            value={settings.send_from_email}
            onChange={(v) => patch("send_from_email", v)}
            placeholder="payments@yourcompany.com"
            required
          />
          <TextInput
            label="Display name"
            value={settings.send_from_name}
            onChange={(v) => patch("send_from_name", v)}
            placeholder="Your Company"
            required
          />
          <TextInput
            label="Reply-to email (optional)"
            value={settings.reply_to_email ?? ""}
            onChange={(v) => patch("reply_to_email", v || null)}
            placeholder="reply@yourcompany.com"
          />
          <NumberInput
            label="Default link expiry (days)"
            value={settings.default_link_expiry_days}
            onChange={(v) =>
              patch(
                "default_link_expiry_days",
                Math.max(1, Math.min(30, v)),
              )
            }
            min={1}
            max={30}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Reminder day offsets
          </label>
          <input
            type="text"
            value={offsetsText}
            onChange={(e) => {
              const parts = e.target.value
                .split(",")
                .map((p) => p.trim())
                .filter(Boolean)
                .map((p) => Number(p))
                .filter((n) => Number.isFinite(n) && n > 0 && n <= 60);
              patch("reminder_day_offsets", parts);
            }}
            className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
            placeholder="3, 7"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Days after send when automatic reminders are triggered. Default: 3, 7. Scheduler ships in 17d.
          </p>
        </div>
      </div>

      {/* Templates */}
      <PaymentEmailTemplateField
        label="Payment request"
        description="First email to the customer with the Stripe payment link."
        subject={settings.payment_request_subject_template}
        body={settings.payment_request_body_template}
        onSubjectChange={(v) => patch("payment_request_subject_template", v)}
        onBodyChange={(v) => patch("payment_request_body_template", v)}
      />
      <PaymentEmailTemplateField
        label="Payment reminder"
        description="Auto-reminder for unpaid requests (scheduling lands in 17d)."
        subject={settings.payment_reminder_subject_template}
        body={settings.payment_reminder_body_template}
        onSubjectChange={(v) => patch("payment_reminder_subject_template", v)}
        onBodyChange={(v) => patch("payment_reminder_body_template", v)}
      />

      {/* Fee disclosure */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Card payment fee disclosure
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Shown below the Card payment button on the customer payment page
            when card surcharge is enabled. Required by state law in some
            jurisdictions.
          </p>
        </div>
        <textarea
          value={settings.fee_disclosure_text ?? ""}
          onChange={(e) =>
            patch("fee_disclosure_text", e.target.value || null)
          }
          rows={3}
          className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
          placeholder="A 3% service fee applies to card payments..."
        />
      </div>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-amber-400 ml-0.5">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30 focus:border-[var(--brand-primary)]"
      />
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30 focus:border-[var(--brand-primary)]"
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Preview-verify**

Start the dev server if not running. Navigate to `/settings/payments`.
- Expect the page to load with the pre-seeded templates (amber setup banner since `send_from_email` is empty).
- Fill in Send-from email: `payments@example.com`, Display name: `AAA Disaster Recovery`.
- Click Save → toast "Payment email settings saved".
- Reload — values persist; banner disappears.
- Click Merge Field dropdown on the "Payment request" body → see Payment, Invoice, Customer, Property, Job, Insurance, Company groups.
- Insert `{{amount_formatted}}` into the body; save; reload — inserted text persists.
- Change reminder offsets to `1, 5, 10` → save → reload — `[1, 5, 10]` persists.
- Edit fee disclosure to a new string → save → reload — persists.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/payments/
git commit -m "feat(17b): /settings/payments page + template field"
```

---

## Task 8: `POST /api/payment-requests/[id]/send`

**Files:**
- Create: `src/app/api/payment-requests/[id]/send/route.ts`

**Context:** Calls `sendPaymentRequestEmail`. The dispatcher does the status transition, audit log, and first-reminder scheduling. This route is just the HTTP shim.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { requirePermission } from "@/lib/permissions-api";
import { sendPaymentRequestEmail } from "@/lib/payment-emails";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await createServerSupabaseClient();
  const gate = await requirePermission(auth, "record_payments");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const supabase = createServiceClient();
  const { data: pr, error } = await supabase
    .from("payment_requests")
    .select("id, status")
    .eq("id", id)
    .maybeSingle<{ id: string; status: string }>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!pr) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (pr.status !== "draft") {
    return NextResponse.json(
      { error: `cannot_send_from_status_${pr.status}` },
      { status: 400 },
    );
  }

  try {
    const sent = await sendPaymentRequestEmail(id);
    const { data: updated } = await supabase
      .from("payment_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return NextResponse.json({ payment_request: updated, message_id: sent.messageId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `send_failed: ${msg}` },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/payment-requests/\[id\]/send/
git commit -m "feat(17b): POST /api/payment-requests/[id]/send"
```

---

## Task 9: Billing section — Send / Copy link / View as customer + amber status

**Files:**
- Modify: `src/components/payments/online-payment-requests-subsection.tsx`

**Context:** Currently the subsection only has a Void button for drafts. This task adds Send, Copy link, View as customer, and re-tints Sent/Viewed to amber per v1.7.

- [ ] **Step 1: Edit the STATUS_STYLES map**

Replace lines 19-32 (verbatim current content quoted above) with:

```tsx
const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-foreground" },
  sent: {
    label: "Sent",
    className: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  },
  viewed: {
    label: "Viewed",
    className: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  },
  paid: {
    label: "Paid",
    className: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/20 text-red-700 dark:text-red-300",
  },
  refunded: {
    label: "Refunded",
    className: "bg-slate-500/20 text-slate-700 dark:text-slate-300",
  },
  partially_refunded: {
    label: "Partial refund",
    className: "bg-slate-500/20 text-slate-700 dark:text-slate-300",
  },
  expired: { label: "Expired", className: "bg-muted text-muted-foreground" },
  voided: {
    label: "Voided",
    className: "bg-muted text-muted-foreground line-through",
  },
};
```

- [ ] **Step 2: Add `link_token` to the row type and a Send/Copy/View action block**

Inside the component file, extend the `PaymentRequestRow` interface:

```tsx
interface PaymentRequestRow {
  id: string;
  title: string;
  amount: number;
  status: string;
  request_type: string;
  created_at: string;
  link_expires_at: string | null;
  link_token: string | null;
}
```

Add a `sending` state and action handlers inside the component (add after existing state declarations):

```tsx
const [sendingId, setSendingId] = useState<string | null>(null);

const onSend = async (id: string) => {
  setSendingId(id);
  const res = await fetch(`/api/payment-requests/${id}/send`, {
    method: "POST",
  });
  setSendingId(null);
  if (!res.ok) {
    const { error } = (await res.json()) as { error?: string };
    toast.error(error ?? "Failed to send");
    return;
  }
  toast.success("Payment request sent");
  await refresh();
};

const onCopyLink = async (token: string | null) => {
  if (!token) {
    toast.error("No link token — the request hasn't been created with a link yet.");
    return;
  }
  const url = `${window.location.origin}/pay/${token}`;
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  } catch {
    toast.error("Failed to copy — copy manually from the address bar after clicking View as customer.");
  }
};

const onViewAsCustomer = (token: string | null) => {
  if (!token) {
    toast.error("No link token.");
    return;
  }
  window.open(`/pay/${token}`, "_blank", "noopener,noreferrer");
};
```

Replace the existing action cluster for each row (currently just the Void button on draft) — the new cluster renders:

```tsx
<div className="flex items-center gap-2">
  <Badge className={s.className}>{s.label}</Badge>
  {r.status === "draft" && (
    <>
      <Button
        variant="default"
        size="sm"
        onClick={() => onSend(r.id)}
        disabled={sendingId === r.id}
      >
        {sendingId === r.id ? "Sending…" : "Send"}
      </Button>
      <Button variant="outline" size="sm" onClick={() => onVoid(r.id)}>
        Void
      </Button>
    </>
  )}
  {(r.status === "sent" || r.status === "viewed") && (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onCopyLink(r.link_token)}
      >
        Copy link
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onViewAsCustomer(r.link_token)}
      >
        View as customer
      </Button>
      <Button variant="outline" size="sm" onClick={() => onVoid(r.id)}>
        Void
      </Button>
    </>
  )}
</div>
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Preview-verify (partial — /pay/* page not yet built)**

- Navigate to a job that has a draft payment request from 17a.
- Verify the "Send" button renders, and the row's action cluster no longer has a blue "Sent" badge — it's amber now.
- Click Send with the `send_from_email` configured → expect "Payment request sent" toast, badge flips to amber "Sent", "Copy link" and "View as customer" appear.
- Click Copy link → `Link copied to clipboard` toast. Paste in another app to confirm.
- Click View as customer → opens `/pay/<token>` in a new tab — **expect a 404 at this point** since Task 10 adds the page. That's fine; skip past and come back after Task 10.

- [ ] **Step 5: Commit**

```bash
git add src/components/payments/online-payment-requests-subsection.tsx
git commit -m "feat(17b): billing section — Send/Copy/View actions + amber sent/viewed badges"
```

---

## Task 10: Public `/pay/[token]` server page — shell, validation, status

**Files:**
- Create: `src/app/(public)/pay/[token]/page.tsx`

**Context:** Server component. Reads the token, verifies signature + expiry, loads payment_request + job + contact + invoice + company_settings + stripe_connection, logs first-view, renders the payment card + method selector client component. Status branches:
- Invalid/expired token → ErrorShell
- Voided/failed/refunded request → ErrorShell with specific copy
- Paid → PaidShell
- Valid (draft/sent/viewed) → render the full page and transition draft → viewed on first load

**Important:** Before writing, re-read `src/app/(public)/sign/[token]/page.tsx` end-to-end — the structure (loadCompany helper, await params, ErrorShell / SignedShell local components, HeaderBlock, AuditFooter) is the pattern to match. Also verify `middleware.ts` does NOT apply auth to `/pay/*` (it should be listed in the public-route allowlist or excluded).

- [ ] **Step 1: Verify middleware excludes /pay**

```bash
grep -n "sign\|pay\|public" middleware.ts
```

If `/pay` is not already in the public bypass list, add it in a minimal edit. If that requires more than a token addition, stop and surface to the user.

- [ ] **Step 2: Write the page**

```tsx
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase-api";
import {
  verifyPaymentLinkToken,
  InvalidPaymentLinkTokenError,
} from "@/lib/payment-link-tokens";
import { writePaymentEvent } from "@/lib/payments/activity";
import type { PaymentRequestRow } from "@/lib/payments/types";
import { Lock, CheckCircle2 } from "lucide-react";
import MethodSelector from "./method-selector";
import { formatUsd } from "@/lib/payments/merge-fields";

interface CompanyBrand {
  name: string;
  phone: string;
  email: string;
  address: string;
  logoUrl: string | null;
}

async function loadCompany(): Promise<CompanyBrand> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("company_settings")
    .select("key, value")
    .in("key", ["company_name", "phone", "email", "address", "logo_url"]);
  const m = new Map<string, string | null>(
    (data ?? []).map((r: { key: string; value: string | null }) => [
      r.key,
      r.value,
    ]),
  );
  return {
    name: m.get("company_name") || "",
    phone: m.get("phone") || "",
    email: m.get("email") || "",
    address: m.get("address") || "",
    logoUrl: m.get("logo_url") || null,
  };
}

interface JobRow {
  id: string;
  job_number: string | null;
  property_address: string | null;
  contact_id: string | null;
}
interface StripeConnectionRow {
  ach_enabled: boolean;
  card_enabled: boolean;
  pass_card_fee_to_customer: boolean;
  card_fee_percent: number;
  ach_preferred_threshold: number | null;
}
interface FeeDisclosureRow {
  fee_disclosure_text: string | null;
}

export default async function PayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // 1. Validate JWT signature + expiry
  let payload: { payment_request_id: string; job_id: string };
  try {
    payload = verifyPaymentLinkToken(token);
  } catch (e) {
    const reason =
      e instanceof InvalidPaymentLinkTokenError ? e.message : "Invalid link";
    const company = await loadCompany();
    return (
      <ErrorShell
        title="This payment link is invalid"
        subtitle={reason}
        company={company}
      />
    );
  }

  const supabase = createServiceClient();
  const [{ data: pr }, company] = await Promise.all([
    supabase
      .from("payment_requests")
      .select("*")
      .eq("id", payload.payment_request_id)
      .maybeSingle<PaymentRequestRow>(),
    loadCompany(),
  ]);

  // 2. Request-level status checks
  if (!pr) {
    return (
      <ErrorShell
        title="Payment request not found"
        subtitle="This link is no longer valid."
        company={company}
      />
    );
  }
  if (pr.link_token !== token) {
    return (
      <ErrorShell
        title="This link has been replaced"
        subtitle="A newer payment link was sent for this request. Check your most recent email from the sender."
        company={company}
      />
    );
  }
  if (pr.status === "voided") {
    return (
      <ErrorShell
        title="This payment request has been cancelled"
        subtitle="Contact the sender if you believe this is an error."
        company={company}
      />
    );
  }
  if (pr.status === "paid") {
    return <PaidShell pr={pr} company={company} />;
  }
  if (pr.status === "refunded" || pr.status === "partially_refunded") {
    return (
      <ErrorShell
        title="This payment was refunded"
        subtitle="Contact the sender for details."
        company={company}
      />
    );
  }
  if (
    pr.link_expires_at &&
    new Date(pr.link_expires_at).getTime() < Date.now()
  ) {
    // Mark expired best-effort; don't block render.
    await supabase
      .from("payment_requests")
      .update({ status: "expired" })
      .eq("id", pr.id)
      .eq("status", pr.status);
    return (
      <ErrorShell
        title="This payment link has expired"
        subtitle="Contact the sender to have a fresh link issued."
        company={company}
      />
    );
  }

  // 3. Load job + stripe connection for the payment card UI
  const [{ data: job }, { data: stripeConn }, { data: settingsRow }] =
    await Promise.all([
      supabase
        .from("jobs")
        .select("id, job_number, property_address, contact_id")
        .eq("id", pr.job_id)
        .maybeSingle<JobRow>(),
      supabase
        .from("stripe_connection")
        .select(
          "ach_enabled, card_enabled, pass_card_fee_to_customer, card_fee_percent, ach_preferred_threshold",
        )
        .limit(1)
        .maybeSingle<StripeConnectionRow>(),
      supabase
        .from("payment_email_settings")
        .select("fee_disclosure_text")
        .limit(1)
        .maybeSingle<FeeDisclosureRow>(),
    ]);

  if (!stripeConn) {
    return (
      <ErrorShell
        title="Payments are temporarily unavailable"
        subtitle="Our payment processor is not currently connected. Please contact us directly."
        company={company}
      />
    );
  }

  // 4. First-view logging + status transition sent → viewed
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    h.get("x-real-ip") ||
    null;
  const ua = h.get("user-agent");
  if (!pr.first_viewed_at) {
    await writePaymentEvent(supabase, {
      paymentRequestId: pr.id,
      eventType: "link_viewed",
      ipAddress: ip,
      userAgent: ua,
    });
    await supabase
      .from("payment_requests")
      .update({
        first_viewed_at: new Date().toISOString(),
        last_viewed_at: new Date().toISOString(),
        status: pr.status === "sent" ? "viewed" : pr.status,
      })
      .eq("id", pr.id);
  } else {
    await supabase
      .from("payment_requests")
      .update({ last_viewed_at: new Date().toISOString() })
      .eq("id", pr.id);
  }

  // 5. Decide which payment methods to offer
  const amount = Number(pr.amount);
  const thresholdApplies =
    stripeConn.ach_preferred_threshold != null &&
    amount >= Number(stripeConn.ach_preferred_threshold) &&
    stripeConn.ach_enabled;

  const methods = {
    ach:
      stripeConn.ach_enabled &&
      // if threshold applies, ACH stays on
      true,
    card: stripeConn.card_enabled && !thresholdApplies,
  };

  const cardFeeAmount =
    stripeConn.pass_card_fee_to_customer && methods.card
      ? Math.round(
          amount * (Number(stripeConn.card_fee_percent) / 100) * 100,
        ) / 100
      : null;

  return (
    <div className="min-h-screen py-10 px-4">
      <div className="max-w-xl mx-auto">
        <HeaderBlock company={company} />

        <div className="public-card p-6 space-y-4">
          <div className="text-xs public-muted uppercase tracking-wider">
            {job?.job_number ? `Job ${job.job_number} · ` : ""}
            Payment to {company.name || "our company"}
          </div>
          <h1
            className="text-lg font-semibold"
            style={{ color: "#111827" }}
          >
            {pr.title}
          </h1>
          <div
            className="text-4xl font-bold"
            style={{ color: "#111827" }}
          >
            {formatUsd(amount) ?? `$${amount.toFixed(2)}`}
          </div>
          {job?.property_address && (
            <div className="text-sm public-muted">
              {job.property_address}
            </div>
          )}

          <MethodSelector
            token={token}
            showAch={methods.ach}
            showCard={methods.card}
            cardFeeFormatted={formatUsd(cardFeeAmount)}
            passCardFee={stripeConn.pass_card_fee_to_customer}
            thresholdApplied={thresholdApplies}
            feeDisclosure={settingsRow?.fee_disclosure_text ?? null}
          />
        </div>

        <FooterBlock company={company} />
      </div>
    </div>
  );
}

// -------------------- status shells --------------------

function HeaderBlock({ company }: { company: CompanyBrand }) {
  return (
    <div className="mb-6">
      <div className="flex items-start gap-3">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logoUrl}
            alt={company.name || "Company logo"}
            className="w-12 h-12 object-contain rounded-lg"
          />
        ) : null}
        <div className="flex-1">
          <div
            className="text-lg font-semibold"
            style={{ color: "#111827" }}
          >
            {company.name || "Payment"}
          </div>
          {(company.phone || company.email) && (
            <div className="text-sm public-muted">
              {[company.phone, company.email].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs public-muted">
          <Lock size={12} />
          Secure payment powered by Stripe
        </div>
      </div>
    </div>
  );
}

function FooterBlock({ company }: { company: CompanyBrand }) {
  return (
    <div className="mt-6 text-[11px] text-center public-muted space-y-1">
      {company.address && <div>{company.address}</div>}
      {(company.phone || company.email) && (
        <div>
          Questions? Contact
          {company.email && <> {company.email}</>}
          {company.phone && <> · {company.phone}</>}
        </div>
      )}
    </div>
  );
}

function ErrorShell({
  title,
  subtitle,
  company,
}: {
  title: string;
  subtitle: string;
  company: CompanyBrand;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="public-card w-full max-w-md p-8 text-center">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logoUrl}
            alt=""
            className="w-12 h-12 object-contain rounded-lg mx-auto mb-4"
          />
        ) : null}
        <h1
          className="text-xl font-semibold mb-2"
          style={{ color: "#111827" }}
        >
          {title}
        </h1>
        <p className="text-sm public-muted mb-6">{subtitle}</p>
        {(company.phone || company.email) && (
          <div className="text-xs public-muted">
            Contact {company.name}
            {company.phone && ` · ${company.phone}`}
            {company.email && ` · ${company.email}`}
          </div>
        )}
      </div>
    </div>
  );
}

function PaidShell({
  pr,
  company,
}: {
  pr: PaymentRequestRow;
  company: CompanyBrand;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="public-card w-full max-w-md p-8 text-center">
        <CheckCircle2
          size={48}
          className="mx-auto mb-3"
          style={{ color: "#0f6e56" }}
        />
        <h1
          className="text-xl font-semibold mb-2"
          style={{ color: "#111827" }}
        >
          Payment already received — thank you
        </h1>
        <p className="text-sm public-muted mb-6">
          We received your payment of {formatUsd(Number(pr.amount))} for{" "}
          {pr.title}. A receipt has been emailed.
        </p>
        {(company.phone || company.email) && (
          <div className="text-xs public-muted">
            {company.name}
            {company.phone && ` · ${company.phone}`}
            {company.email && ` · ${company.email}`}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors — but **note** that `MethodSelector` is not yet written. Expect a "cannot find module" error. That's acceptable at this step; Task 11 resolves it.

If you want a green tsc here, add a temporary stub at `src/app/(public)/pay/[token]/method-selector.tsx`:
```tsx
"use client";
export default function MethodSelector(_props: unknown) {
  return null;
}
```
Replace with the real implementation in Task 11.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(public\)/pay/\[token\]/page.tsx src/app/\(public\)/pay/\[token\]/method-selector.tsx middleware.ts
git commit -m "feat(17b): /pay/[token] server page — validation, status shells, view logging"
```

---

## Task 11: `method-selector.tsx` client component

**Files:**
- Modify (or create — replace the stub from Task 10): `src/app/(public)/pay/[token]/method-selector.tsx`

**Context:** Renders the ACH / card buttons per spec Part 7 Cases 1/2/3. POSTs to `/api/pay/[token]/checkout` on click (route added in Task 12). On success, `window.location.href = session_url`.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

interface Props {
  token: string;
  showAch: boolean;
  showCard: boolean;
  cardFeeFormatted: string | null;
  passCardFee: boolean;
  thresholdApplied: boolean;
  feeDisclosure: string | null;
}

export default function MethodSelector({
  token,
  showAch,
  showCard,
  cardFeeFormatted,
  passCardFee,
  thresholdApplied,
  feeDisclosure,
}: Props) {
  const [loading, setLoading] = useState<"ach" | "card" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (method: "ach" | "card") => {
    setLoading(method);
    setError(null);
    try {
      const res = await fetch(`/api/pay/${token}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      if (!res.ok) {
        const { error: e } = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(e || "Failed to start checkout");
      }
      const { session_url } = (await res.json()) as { session_url: string };
      window.location.href = session_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
      setLoading(null);
    }
  };

  // Case 1: ACH only
  if (showAch && !showCard) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => go("ach")}
          className="public-button-primary w-full flex items-center justify-center gap-2"
        >
          {loading === "ach" && <Loader2 size={16} className="animate-spin" />}
          Pay by bank transfer
        </button>
        <div className="text-xs public-muted text-center">
          No additional fees
        </div>
        {thresholdApplied && (
          <div className="text-xs public-muted text-center">
            Bank transfer is required for payments of this size.
          </div>
        )}
        {error && <div className="text-xs text-red-600 text-center">{error}</div>}
      </div>
    );
  }

  // Case 3: Card only
  if (!showAch && showCard) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          disabled={loading !== null}
          onClick={() => go("card")}
          className="public-button-primary w-full flex items-center justify-center gap-2"
        >
          {loading === "card" && <Loader2 size={16} className="animate-spin" />}
          Pay by card
          {passCardFee && cardFeeFormatted && (
            <span className="ml-1 font-normal">
              (+ {cardFeeFormatted} service fee)
            </span>
          )}
        </button>
        {passCardFee && feeDisclosure && (
          <div className="text-xs public-muted">{feeDisclosure}</div>
        )}
        {error && <div className="text-xs text-red-600 text-center">{error}</div>}
      </div>
    );
  }

  // Case 2: both
  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={loading !== null}
        onClick={() => go("ach")}
        className="public-button-primary w-full flex items-center justify-between"
      >
        <span className="flex items-center gap-2">
          {loading === "ach" && (
            <Loader2 size={16} className="animate-spin" />
          )}
          Pay by bank (no fee)
        </span>
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded-full"
          style={{ backgroundColor: "#ecfdf5", color: "#065f46" }}
        >
          No fee
        </span>
      </button>
      <button
        type="button"
        disabled={loading !== null}
        onClick={() => go("card")}
        className="public-button-secondary w-full flex items-center justify-center gap-2"
      >
        {loading === "card" && <Loader2 size={16} className="animate-spin" />}
        Pay by card
        {passCardFee && cardFeeFormatted && (
          <span className="text-xs public-muted">
            + {cardFeeFormatted} service fee
          </span>
        )}
      </button>
      {passCardFee && feeDisclosure && (
        <div className="text-xs public-muted">{feeDisclosure}</div>
      )}
      {error && <div className="text-xs text-red-600 text-center">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(public\)/pay/\[token\]/method-selector.tsx
git commit -m "feat(17b): /pay/[token] method selector client component"
```

---

## Task 12: `POST /api/pay/[token]/checkout` — session reuse vs regenerate

**Files:**
- Create: `src/app/api/pay/[token]/checkout/route.ts`

**Context:** The heart of spec Part 7. Validates the token, decides reuse vs regenerate per the rules in the spec, writes `card_fee_amount` + `total_charged` + `payment_method_type` to the payment_request BEFORE returning the URL. Uses `STRIPE_SESSION_MAX_MS = 23.5 * 60 * 60 * 1000` — same constant name as 17a's route.

Spec Part 7 reuse rules (paraphrased — re-check the spec before writing):
- Reuse if: session's payment_method_types matches chosen method AND session.expires_at > now AND session.status is still "open" AND (if surcharge applies) session line-item total matches current computed total.
- Regenerate in all other cases.

- [ ] **Step 1: Write the route**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import {
  verifyPaymentLinkToken,
  InvalidPaymentLinkTokenError,
} from "@/lib/payment-link-tokens";
import { getStripeClient } from "@/lib/stripe";
import type { PaymentRequestRow } from "@/lib/payments/types";

// Mirror of the constant in src/app/api/payment-requests/route.ts — Stripe
// Checkout Sessions expire at most 24h after creation. 23.5h keeps us safely
// under the cap while matching 17a.
const STRIPE_SESSION_MAX_MS = 23.5 * 60 * 60 * 1000;

interface Body {
  method: "ach" | "card";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || (body.method !== "ach" && body.method !== "card")) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // 1. Token validation
  let payload: { payment_request_id: string; job_id: string };
  try {
    payload = verifyPaymentLinkToken(token);
  } catch (e) {
    const msg =
      e instanceof InvalidPaymentLinkTokenError ? e.message : "Invalid token";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: pr, error: prErr } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("id", payload.payment_request_id)
    .maybeSingle<PaymentRequestRow>();
  if (prErr || !pr)
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (pr.link_token !== token)
    return NextResponse.json({ error: "token_replaced" }, { status: 400 });
  if (!["draft", "sent", "viewed"].includes(pr.status))
    return NextResponse.json(
      { error: `not_payable_from_status_${pr.status}` },
      { status: 400 },
    );
  if (
    pr.link_expires_at &&
    new Date(pr.link_expires_at).getTime() < Date.now()
  )
    return NextResponse.json({ error: "link_expired" }, { status: 400 });

  // 2. Stripe client + connection
  const { client: stripe, connection } = await getStripeClient();
  if (body.method === "ach" && !connection.ach_enabled)
    return NextResponse.json({ error: "ach_not_enabled" }, { status: 400 });
  if (body.method === "card" && !connection.card_enabled)
    return NextResponse.json({ error: "card_not_enabled" }, { status: 400 });

  const amount = Number(pr.amount);
  if (
    body.method === "card" &&
    connection.ach_preferred_threshold != null &&
    amount >= Number(connection.ach_preferred_threshold) &&
    connection.ach_enabled
  ) {
    return NextResponse.json(
      { error: "card_not_allowed_for_this_amount" },
      { status: 400 },
    );
  }

  const paymentMethodType =
    body.method === "card" ? "card" : "us_bank_account";

  // 3. Compute target line-item total + possible surcharge
  const applySurcharge =
    body.method === "card" && connection.pass_card_fee_to_customer;
  const cardFee = applySurcharge
    ? Math.round(
        amount * (Number(connection.card_fee_percent) / 100) * 100,
      ) / 100
    : 0;
  const totalCents = Math.round((amount + cardFee) * 100);

  // 4. Decide reuse vs regenerate
  let sessionUrl: string | null = null;
  let newSessionId: string | null = null;

  if (pr.stripe_checkout_session_id) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(
        pr.stripe_checkout_session_id,
      );
      const reusable =
        existing.status === "open" &&
        typeof existing.expires_at === "number" &&
        existing.expires_at * 1000 > Date.now() &&
        Array.isArray(existing.payment_method_types) &&
        existing.payment_method_types.length === 1 &&
        existing.payment_method_types[0] === paymentMethodType &&
        existing.amount_total === totalCents;
      if (reusable && existing.url) {
        sessionUrl = existing.url;
      }
    } catch {
      // Retrieval can fail for deleted/expired sessions. Regenerate.
      sessionUrl = null;
    }
  }

  if (!sessionUrl) {
    // 5. Regenerate — cap at min(link_expires_at, now + 23.5h)
    const linkExpMs = pr.link_expires_at
      ? new Date(pr.link_expires_at).getTime()
      : Date.now() + STRIPE_SESSION_MAX_MS;
    const sessionExpiresAtMs = Math.min(
      linkExpMs,
      Date.now() + STRIPE_SESSION_MAX_MS,
    );
    const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

    const lineItems = applySurcharge
      ? [
          {
            quantity: 1,
            price_data: {
              currency: "usd" as const,
              product_data: { name: pr.title },
              unit_amount: Math.round(amount * 100),
            },
          },
          {
            quantity: 1,
            price_data: {
              currency: "usd" as const,
              product_data: {
                name: `Card processing fee (${connection.card_fee_percent}%)`,
              },
              unit_amount: Math.round(cardFee * 100),
            },
          },
        ]
      : [
          {
            quantity: 1,
            price_data: {
              currency: "usd" as const,
              product_data: { name: pr.title },
              unit_amount: Math.round(amount * 100),
            },
          },
        ];

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: [paymentMethodType],
      line_items: lineItems,
      metadata: {
        payment_request_id: pr.id,
        job_id: pr.job_id,
        invoice_id: pr.invoice_id ?? "",
        request_type: pr.request_type,
        method: body.method,
      },
      payment_intent_data: {
        metadata: {
          payment_request_id: pr.id,
          job_id: pr.job_id,
          invoice_id: pr.invoice_id ?? "",
          request_type: pr.request_type,
          method: body.method,
        },
        statement_descriptor_suffix:
          connection.default_statement_descriptor?.slice(0, 22) || undefined,
      },
      customer_email: pr.payer_email ?? undefined,
      success_url: `${appUrl}/pay/${token}/success`,
      cancel_url: `${appUrl}/pay/${token}`,
      expires_at: Math.floor(sessionExpiresAtMs / 1000),
    });

    sessionUrl = session.url;
    newSessionId = session.id;

    // Best-effort: expire the previous session so it can't be reused via
    // a cached URL.
    if (
      pr.stripe_checkout_session_id &&
      pr.stripe_checkout_session_id !== newSessionId
    ) {
      try {
        await stripe.checkout.sessions.expire(pr.stripe_checkout_session_id);
      } catch {
        /* ignore */
      }
    }
  }

  if (!sessionUrl) {
    return NextResponse.json(
      { error: "session_url_missing" },
      { status: 500 },
    );
  }

  // 6. Persist pre-payment fields so webhook (17c) can verify consistency.
  const updatePatch: Partial<PaymentRequestRow> = {
    card_fee_amount: applySurcharge ? cardFee : null,
    total_charged: amount + cardFee,
    payment_method_type: paymentMethodType,
  };
  if (newSessionId) {
    updatePatch.stripe_checkout_session_id = newSessionId;
  }
  await supabase.from("payment_requests").update(updatePatch).eq("id", pr.id);

  return NextResponse.json({ session_url: sessionUrl });
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/pay/\[token\]/checkout/
git commit -m "feat(17b): /api/pay/[token]/checkout — session reuse/regenerate"
```

---

## Task 13: `/pay/[token]/success` confirmation page

**Files:**
- Create: `src/app/(public)/pay/[token]/success/page.tsx`

**Context:** Informational only. Does NOT mark paid — that's 17c. Re-uses the token only to display company branding; explicitly avoids mutating status.

- [ ] **Step 1: Write the page**

```tsx
import { CheckCircle2 } from "lucide-react";
import { createServiceClient } from "@/lib/supabase-api";
import {
  verifyPaymentLinkToken,
  InvalidPaymentLinkTokenError,
} from "@/lib/payment-link-tokens";

interface CompanyBrand {
  name: string;
  phone: string;
  email: string;
  logoUrl: string | null;
}

async function loadCompany(): Promise<CompanyBrand> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("company_settings")
    .select("key, value")
    .in("key", ["company_name", "phone", "email", "logo_url"]);
  const m = new Map<string, string | null>(
    (data ?? []).map((r: { key: string; value: string | null }) => [
      r.key,
      r.value,
    ]),
  );
  return {
    name: m.get("company_name") || "",
    phone: m.get("phone") || "",
    email: m.get("email") || "",
    logoUrl: m.get("logo_url") || null,
  };
}

export default async function PaySuccessPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Token-verify only for safety (don't want this page to render without a
  // real token in the URL). Do NOT touch payment_requests status here.
  try {
    verifyPaymentLinkToken(token);
  } catch (e) {
    if (!(e instanceof InvalidPaymentLinkTokenError)) throw e;
    // Even if the token is invalid/expired we still render the thank-you
    // page — the customer may have successfully paid, which consumes the
    // window but shouldn't show a scary error.
  }
  const company = await loadCompany();

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="public-card w-full max-w-md p-8 text-center">
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logoUrl}
            alt={company.name || "Company logo"}
            className="w-12 h-12 object-contain rounded-lg mx-auto mb-4"
          />
        ) : null}
        <CheckCircle2
          size={48}
          className="mx-auto mb-3"
          style={{ color: "#0f6e56" }}
        />
        <h1
          className="text-xl font-semibold mb-2"
          style={{ color: "#111827" }}
        >
          Payment submitted
        </h1>
        <p className="text-sm public-muted mb-6">
          Thank you — we&apos;ll send a receipt by email shortly. You can close
          this page.
        </p>
        {(company.phone || company.email) && (
          <div className="text-xs public-muted">
            {company.name}
            {company.phone && ` · ${company.phone}`}
            {company.email && ` · ${company.email}`}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify tsc**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(public\)/pay/\[token\]/success/
git commit -m "feat(17b): /pay/[token]/success confirmation page"
```

---

## Task 14: End-to-end preview verification (the spec's 22-point checklist)

**Files:** none modified in this task — pure verification.

- [ ] **Step 1: Clean build**

```bash
npx tsc --noEmit
npm run build
```
Both must succeed with 0 errors. If `npm run build` reports any issue specific to the new files, resolve before continuing.

- [ ] **Step 2: Walk the spec Part 10 checklist, one by one**

For each item, run the action and record pass/fail. Items use Stripe test mode (`acct_` ID from `/settings/stripe` in test mode; bank/card test numbers from Stripe docs).

1. **`npm run build` passes with no type errors.** Confirmed in Step 1.
2. **Migration runs cleanly.** Verify with `select id, default_link_expiry_days from payment_email_settings;` (expect 1 row) and `select is_nullable from information_schema.columns where table_name='contract_events' and column_name='contract_id';` (expect `YES`).
3. **`/settings/payments` loads.** All 3 editor sections work (provider, templates, fee disclosure). Save fires; toast confirms.
4. **Merge-field sidebar** shows Payment, Invoice, Customer, Property, Job, Insurance, Company groups.
5. **Create a payment request from an invoice** (17a flow) — appears in Billing as Draft.
6. **Click Send.** Row flips to Sent (amber). Check your inbox for the email; the `/pay/<token>` link resolves. Subject + body have merge fields resolved (customer name, company name, amount).
7. **Open `/pay/<token>` in incognito.** Light theme (no app sidebar), company logo/name/phone, amount large, method buttons correct per stripe_connection settings.
8. **DB transition on first open.** `select first_viewed_at, status from payment_requests where link_token='<token>';` → `first_viewed_at` set, `status='viewed'`.
9. **Second open.** `last_viewed_at` advanced; `first_viewed_at` unchanged; `status` stays `viewed`.
10. **Click "Pay by bank (no fee)".** Redirects to Stripe Checkout with only `us_bank_account` method. Pick a test bank (routing 110000000, account 000123456789). Complete payment.
11. **Redirects to `/pay/<token>/success`.** Renders the confirmation.
12. **DB stays non-paid.** `select status from payment_requests where link_token='<token>';` → still `viewed` (webhook is 17c).
13. **Create a fresh request. Toggle surcharge ON in `/settings/stripe`. Open `/pay/<token>`. Click "Pay by card".** New Stripe Checkout Session with only `card` method. Amount = base + 3%. Session `expires_at` ≤ 23.5h from now.
14. **Same request — click "Pay by bank".** Regeneration — new session, `us_bank_account` only, within 23.5h.
15. **Open `/pay/<token>` twice quickly, click the same method both times.** Second click reuses the session URL (check Stripe dashboard — one open session, not two).
16. **Create a request at or above `ach_preferred_threshold`.** `/pay/<token>` shows ACH only with the "Bank transfer is required for payments of this size" note.
17. **Copy link / View as customer actions** work from Billing section on a Sent row.
18. **Voided request** → open token → voided shell page.
19. **Expired link** — manually set `link_expires_at` to the past, reload → expired shell page.
20. **Stripe session expired but link alive.** In Stripe dashboard, manually expire the session for a sent request (or `update payment_requests set stripe_checkout_session_id='cs_test_invalid' where id=...`). Open `/pay/<token>` → click method → regeneration creates a fresh session, no customer-facing error.
21. **Mobile viewport.** Chrome DevTools iPhone 13 viewport. Layout holds on the `/pay/*` pages.
22. **Dark mode unaffected.** Switch the app theme; verify the rest of the app still looks right; confirm `/pay/*` stays light regardless of system preference.

- [ ] **Step 3: Spot-check the audit log**

```sql
select event_type, metadata, created_at
  from contract_events
  where contract_id is null
  order by created_at desc
  limit 10;
```
Expect rows with `event_type in ('sent', 'link_viewed')` and `metadata->>'payment_request_id'` populated.

- [ ] **Step 4: Final commit (only if Step 2 surfaced small fixes)**

Otherwise nothing to commit.

- [ ] **Step 5: Report completion**

Report to user in ≤100 words:
- Tasks 1–13 complete; all 22 Part 10 checklist items walked.
- Note any items that could not be end-to-end tested (e.g. if Stripe surcharge toggle was left off) and what was substituted.
- Explicitly confirm: did NOT touch webhook handler, did NOT implement receipt/refund emails, did NOT implement reminder scheduler.
- Point to the deviations list in the plan header for the three items the user should re-confirm (auto-save behavior, route-group placement, contract_events schema change).

---

## Notes on scope and deviations from spec

1. **Auto-save vs. manual save on `/settings/payments`.** See header deviations. Follows existing `/settings/contracts` pattern (dirty-flag + Save button). Flag for user.
2. **Public route path.** Placed under `(public)` route group to reuse the existing `PublicLayout` and `public.css`. User-visible URL is identical (`/pay/<token>`).
3. **`contract_events.contract_id` nullability.** Minimal ALTER in the build40 migration; no CHECK expansion needed because existing event types cover payment lifecycle. Flag for user.
4. **23.5-hour Stripe session cap.** Reused verbatim from 17a's `src/app/api/payment-requests/route.ts:131`. The regeneration route imports no helper — same constant is redeclared at top of the file with a comment pointing to 17a. If a future builder extracts this into a shared constants file, both locations should update.
5. **Duplicated Resend/SMTP router.** `src/lib/payments/email.ts` duplicates ~70 lines from `src/lib/contracts/email.ts` per the spec's "DO NOT modify Build 15 contract signing flow" constraint. A future consolidation pass could extract a shared `src/lib/email-provider.ts`, but that's out of scope for 17b.
6. **PaymentRequestRow `link_token` nullability.** The 17a migration creates `link_token` as `text unique` without a NOT NULL, so the type is `string | null`. In practice it's always populated by 17a's create route, but the types stay honest. Billing-section Copy-link / View-as-customer handlers defensively check.
7. **Merge-field resolver scope.** Payment fields are added in a new module rather than mutating `src/lib/contracts/merge-fields.ts#MERGE_FIELDS`, so the contract template picker keeps its original 5 categories and isn't polluted with payment-only fields.
8. **Middleware.** Task 10 Step 1 is a verification-only step. If `/pay/*` routing is blocked, add it to the public allowlist in a minimal edit and commit in the same Task 10 commit.

---

## Self-review summary

Spec-section → task mapping:
- Part 0 (read 17a first) → preflight + plan header.
- Part 1 (mission) → tasks cover /settings/payments, /pay/[token], /pay/[token]/success, Send wiring, method selection, session regen.
- Part 2 (reuse, don't rebuild) → Tasks 3 (merge fields), 4 (email), 7 (template field).
- Part 3 (DB migration) → Task 1.
- Part 4 (/settings/payments) → Tasks 5 (API), 6 (nav), 7 (page).
- Part 5 (email dispatch) → Tasks 4 (lib) + Task 8 (send route).
- Part 6 (merge fields list) → Task 2 (types), Task 3 (resolver).
- Part 7 (/pay/[token] flow + session regeneration) → Tasks 10 (page), 11 (method selector), 12 (checkout API).
- Part 8 (Billing integration) → Task 9.
- Part 9 (DO NOT CHANGE) → enforced via explicit "NOT touched" list + file-touch discipline.
- Part 10 (22-point checklist) → Task 14.
