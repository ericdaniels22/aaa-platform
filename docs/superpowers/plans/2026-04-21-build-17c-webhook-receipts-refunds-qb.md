# Build 17c — Webhook Reconciliation, Receipts, Refunds & QuickBooks Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 17b gap — receive Stripe webhooks, flip `payment_requests.status` to `paid`/`failed`/`refunded`, create `payments` rows automatically, generate and email branded receipt PDFs, handle refunds and disputes, and auto-sync everything to QuickBooks with a retry escape hatch.

**Architecture:** Stripe POSTs to `/api/stripe/webhook`. Route verifies HMAC signature, inserts into `stripe_events` (UNIQUE on `stripe_event_id` = idempotency), dispatches to per-event-type handlers in `src/lib/stripe/webhook/handlers/*`. Each handler is idempotent — re-running is a no-op. Post-payment side effects (receipt PDF, customer email, internal email, in-app notification, QuickBooks push) run inline after the status flip, each wrapped in try/catch so one failure doesn't cascade. Failed QuickBooks sync becomes a manual "Retry QuickBooks sync" action. Refunds are initiated from the Billing section row, go through Stripe's API, and reconciled on the `charge.refunded` webhook.

**Tech Stack:** Next.js 14 App Router (nodejs runtime for the webhook route), TypeScript, Supabase, `stripe` SDK (already installed), `pdf-lib` (already installed, reused from Build 15), Resend/SMTP via the existing `src/lib/payments/email.ts` router, existing `src/lib/qb/sync/*` modules extended.

---

## Conflicts surfaced (resolve before executing)

These are differences between the prompt, briefing, and current code. Resolutions noted; plan proceeds with them.

1. **Build 14g notifications infrastructure NOT FOUND.** No `notifications` table, no `src/lib/notifications/`, no bell UI. The prompt explicitly says "surface that and ask before skipping". **This plan defaults to Option A: add a minimal notifications stub as part of 17c** (Task 2 migration adds the table; Task 14 writes + renders). If user prefers **Option B (defer)**, they should say so — in Option B, Task 14 becomes a no-op and the webhook handlers skip the notification writes (emails and `contract_events` audit rows still fire).
2. **`payments` table CHECK constraints need widening beyond what Part 4 of the prompt specifies.** The webhook will write rows with `source='stripe'`, `method='stripe_card'` or `'stripe_ach'`, and (on full refund) `status='refunded'`. Current CHECKs (from `supabase/schema.sql:1-14`) block all three. Task 2 migration widens all three. The prompt covered `method` only — `source` and `status` are additional.
3. **Existing QB column is `payments.qb_payment_id`, not `quickbooks_entity_id`.** `src/lib/qb/sync/payments.ts:159` writes `qb_payment_id`. This plan uses `qb_payment_id` everywhere (not the prompt's `quickbooks_entity_id` naming) and adds `quickbooks_sync_status`, `quickbooks_sync_attempted_at`, `quickbooks_sync_error` as new companion columns.
4. **`syncPayment()` skips payments without `invoice_id`** ([src/lib/qb/sync/payments.ts:86-93](src/lib/qb/sync/payments.ts:86) — returns `reason: "no_invoice_linkage"`). The prompt Part 10 says standalone deposits/retainers should post to a generic income account. Task 15 extends `syncPayment()` to handle the no-invoice case using a new mapping type `generic_income_account`.
5. **`payment_requests.status` CHECK already includes all 17c values** (`paid`,`failed`,`refunded`,`partially_refunded` are in the build39 definition at lines 195-198). Migration does NOT need to widen this CHECK.
6. **`STATUS_STYLES` in `online-payment-requests-subsection.tsx` already covers all 17c statuses.** Task 19 extends the row content (payment method icon, QB badge, refund/receipt/retry actions) rather than rewriting the status map.
7. **`src/lib/payments/email.ts` already supports attachments** ([src/lib/payments/email.ts:7-11](src/lib/payments/email.ts:7) defines `Attachment` and line 133 accepts it). No router extension needed — Task 7 just uses it.
8. **Stripe default receipt suppression requires a minimal 17b edit.** [src/app/api/pay/[token]/checkout/route.ts:184](src/app/api/pay/[token]/checkout/route.ts:184) sets `customer_email`. Task 9 adds `payment_intent_data.receipt_email: null` in the same `sessions.create(...)` call. Prompt Part 13 allows this edit and asks it be flagged in the final report.

---

## File Structure

**New files:**
```
supabase/
  migration-build41-webhook-receipts-refunds.sql

src/app/api/
  stripe/
    webhook/route.ts                    # POST — signature verify, dedupe, dispatch
    webhook-secret/route.ts             # POST — save encrypted webhook signing secret
  payment-requests/[id]/refund/route.ts # POST — initiate refund
  payments/[id]/retry-qb-sync/route.ts  # POST — manual QB retry
  notifications/route.ts                # GET + PATCH (if Option A)
  notifications/[id]/read/route.ts      # POST (if Option A)

src/lib/stripe/webhook/
  verify.ts                             # signature verify helper
  idempotency.ts                        # stripe_events insert/dedupe
  handlers/
    checkout-session-completed.ts
    payment-intent-succeeded.ts
    payment-intent-failed.ts
    charge-refunded.ts
    charge-dispute.ts                   # handles both .created and .closed

src/lib/payments/
  receipt-pdf.ts                        # branded receipt PDF via pdf-lib

src/lib/qb/sync/
  stripe-fees.ts                        # post Stripe processing fee to QB expense account
  refunds.ts                            # post refund to QB

src/lib/notifications/                  # (if Option A)
  write.ts                              # writeNotification() helper
  types.ts                              # Notification, NotificationType

src/components/
  payments/refund-modal.tsx             # refund modal (client)
  payments/qb-sync-badge.tsx            # QB sync status pill (presentational)
  notifications/bell.tsx                # (if Option A) header bell icon + dropdown
```

**Modified files:**
```
src/lib/payment-emails.ts               # add sendPaymentReceiptEmail, sendPaymentInternalNotification, sendRefundConfirmationEmail
src/lib/payments/merge-fields.ts        # add receipt/refund/internal fields
src/lib/payments/types.ts               # add new template columns, refund + dispute types
src/lib/qb/sync/payments.ts             # extend syncPayment for no-invoice standalone deposits
src/app/api/pay/[token]/checkout/route.ts  # add payment_intent_data.receipt_email: null
src/app/settings/stripe/page.tsx        # pass webhook-config status to client
src/app/settings/stripe/stripe-settings-client.tsx  # add Webhook Configuration section
src/app/settings/payments/payments-settings-client.tsx  # add new template fields to the Tiptap matrix
src/app/api/settings/payment-email/route.ts  # accept new template columns in PATCH
src/components/payments/online-payment-requests-subsection.tsx  # refund, view receipt, retry QB actions; method icon; QB badge
src/components/app-shell.tsx            # (if Option A) mount <NotificationBell /> in the header
```

---

## Preflight

- [ ] **Verify worktree branch**

Run: `git branch --show-current`
Expected: `claude/great-chatelet-598282` (or whatever the worktree created). Must NOT be `main`.

- [ ] **Verify clean tsc baseline**

Run: `npx tsc --noEmit`
Expected: 0 errors. Per project memory, this is the baseline. If it's not clean, stop and surface — 17c starts from clean tsc.

- [ ] **Verify baseline build passes**

Run: `npm run build`
Expected: success. If it fails, surface — the baseline must pass before edits begin.

- [ ] **Verify `.env.local` has the required vars**

Run: `grep -c STRIPE_SECRET_KEY .env.local; grep -c NEXT_PUBLIC_APP_URL .env.local; grep -c ENCRYPTION_KEY .env.local`
Expected: each prints `1` or greater. If any print `0`, stop and ask.

- [ ] **Install Stripe CLI (for webhook testing)**

Per-developer; not a code change. Confirm the engineer has `stripe` on PATH: `stripe --version`. If missing, note that they'll need it for Task 20 verification (not blocking earlier tasks).

---

## Task 1: Decide notifications path

**Files:** none yet (decision task).

- [ ] **Step 1: Confirm notifications path with user (if not already decided)**

Default: **Option A — minimal notifications stub in 17c**. Task 2 (migration) adds the `notifications` table; Task 14 adds the write helper, API, and bell UI.

If the user chose **Option B — defer to Build 14g**: skip Task 14 entirely, remove the notification-table DDL from Task 2, and in Tasks 12/16/18/19 drop the `writeNotification(...)` calls — keep the `contract_events` audit rows and emails intact.

This plan is written for Option A. Flip to B requires four in-plan edits:
1. Task 2 — delete the `notifications` section of the migration.
2. Task 14 — mark as N/A (no-op).
3. Tasks 12/16/18 — delete the three `writeNotification(...)` call sites.
4. Task 19 — delete the `qb_sync_failed` notification write in `/api/payments/[id]/retry-qb-sync/route.ts`.

- [ ] **Step 2: Note decision in commit history**

No commit yet — decision is captured implicitly by what Task 2 contains.

---

## Task 2: Database migration (`migration-build41-webhook-receipts-refunds.sql`)

**Files:**
- Create: `supabase/migration-build41-webhook-receipts-refunds.sql`

**Context:** One migration covers everything schema-side for 17c:
- Widens `contract_events.event_type` CHECK (add paid/payment_failed/refunded/partially_refunded/dispute_opened/dispute_closed).
- Widens `payments` CHECKs for `source`, `method`, `status`.
- Adds Stripe + QB columns to `payments`.
- Adds Stripe + QB columns to `payment_requests`.
- Adds template columns to `payment_email_settings` (three pairs customer, three pairs internal).
- Creates `refunds` table.
- Creates `stripe_disputes` table.
- Creates `notifications` table (Option A).
- Adds a `qb_mappings` row type `generic_income_account` (via a comment — the row itself is populated manually via settings UI later).

- [ ] **Step 1: Write the migration file**

Create `supabase/migration-build41-webhook-receipts-refunds.sql`:

```sql
-- Build 17c — Webhook reconciliation, receipts, refunds, QuickBooks sync.
-- Widens CHECKs, adds columns to existing tables, creates refunds +
-- stripe_disputes + notifications tables, and seeds new email templates.

-- ---------------------------------------------------------------------------
-- 1. Widen contract_events.event_type CHECK to cover payment lifecycle.
--    Original values (build33 line 81): 'created','sent','email_delivered',
--    'email_opened','link_viewed','signed','reminder_sent','voided','expired'.
--    Adding six: 'paid','payment_failed','refunded','partially_refunded',
--    'dispute_opened','dispute_closed'.
-- ---------------------------------------------------------------------------
alter table contract_events drop constraint if exists contract_events_event_type_check;
alter table contract_events add constraint contract_events_event_type_check
  check (event_type in (
    'created','sent','email_delivered','email_opened','link_viewed',
    'signed','reminder_sent','voided','expired',
    'paid','payment_failed','refunded','partially_refunded',
    'dispute_opened','dispute_closed'
  ));

-- ---------------------------------------------------------------------------
-- 2. Widen payments CHECKs.
--    Original (supabase/schema.sql:1-14):
--      source   in ('insurance','homeowner','other')
--      method   in ('check','ach','venmo_zelle','cash','credit_card')
--      status   in ('received','pending','due')
-- ---------------------------------------------------------------------------
alter table payments drop constraint if exists payments_source_check;
alter table payments add constraint payments_source_check
  check (source in ('insurance','homeowner','other','stripe'));

alter table payments drop constraint if exists payments_method_check;
alter table payments add constraint payments_method_check
  check (method in ('check','ach','venmo_zelle','cash','credit_card','stripe_card','stripe_ach'));

alter table payments drop constraint if exists payments_status_check;
alter table payments add constraint payments_status_check
  check (status in ('received','pending','due','refunded'));

-- ---------------------------------------------------------------------------
-- 3. Add Stripe + QB columns to payments.
--    qb_payment_id already exists from build16-series. Add companion sync
--    status + timestamps + error, and Stripe-specific identifiers.
-- ---------------------------------------------------------------------------
alter table payments add column if not exists payment_request_id uuid references payment_requests(id) on delete set null;
alter table payments add column if not exists stripe_payment_intent_id text;
alter table payments add column if not exists stripe_charge_id text;
alter table payments add column if not exists stripe_fee_amount numeric(10,2);
alter table payments add column if not exists net_amount numeric(10,2);
alter table payments add column if not exists quickbooks_sync_status text
  check (quickbooks_sync_status in ('pending','synced','failed','not_applicable'));
alter table payments add column if not exists quickbooks_sync_attempted_at timestamptz;
alter table payments add column if not exists quickbooks_sync_error text;

create index if not exists idx_payments_payment_request_id on payments(payment_request_id);
create index if not exists idx_payments_stripe_payment_intent_id on payments(stripe_payment_intent_id);
create index if not exists idx_payments_stripe_charge_id on payments(stripe_charge_id);

-- ---------------------------------------------------------------------------
-- 4. Add Stripe receipt + QB sync columns to payment_requests.
--    receipt_pdf_path already exists from build39.
-- ---------------------------------------------------------------------------
alter table payment_requests add column if not exists stripe_receipt_url text;
alter table payment_requests add column if not exists qb_payment_id text;
alter table payment_requests add column if not exists quickbooks_sync_status text
  check (quickbooks_sync_status in ('pending','synced','failed','not_applicable'));
alter table payment_requests add column if not exists quickbooks_sync_attempted_at timestamptz;
alter table payment_requests add column if not exists quickbooks_sync_error text;

-- ---------------------------------------------------------------------------
-- 5. Add receipt + refund + internal-notification template columns to
--    payment_email_settings. Three customer-facing pairs + three internal
--    pairs = six pairs = twelve columns. Seeded via UPDATE below.
-- ---------------------------------------------------------------------------
alter table payment_email_settings
  add column if not exists payment_receipt_subject_template text not null default '',
  add column if not exists payment_receipt_body_template text not null default '',
  add column if not exists refund_confirmation_subject_template text not null default '',
  add column if not exists refund_confirmation_body_template text not null default '',
  add column if not exists payment_received_internal_subject_template text not null default '',
  add column if not exists payment_received_internal_body_template text not null default '',
  add column if not exists payment_failed_internal_subject_template text not null default '',
  add column if not exists payment_failed_internal_body_template text not null default '',
  add column if not exists refund_issued_internal_subject_template text not null default '',
  add column if not exists refund_issued_internal_body_template text not null default '',
  add column if not exists internal_notification_to_email text;

-- ---------------------------------------------------------------------------
-- 6. Seed defaults into the singleton row. Only overwrite when blank so
--    re-running the migration doesn't clobber operator edits.
-- ---------------------------------------------------------------------------
update payment_email_settings set
  payment_receipt_subject_template = case when payment_receipt_subject_template = ''
    then 'Receipt: {{request_title}} ({{amount_formatted}})' else payment_receipt_subject_template end,
  payment_receipt_body_template = case when payment_receipt_body_template = ''
    then '<p>Hi {{customer_name}},</p><p>Thank you for your payment. We received <strong>{{amount_formatted}}</strong> on {{paid_at_formatted}} for <strong>{{request_title}}</strong>.</p><p>A receipt is attached to this email. You can also view the Stripe receipt at <a href="{{stripe_receipt_url}}">{{stripe_receipt_url}}</a>.</p><p>Payment method: {{payment_method_display}}<br>Transaction ID: {{transaction_id}}</p><p>Thanks,<br>{{company_name}}<br>{{company_phone}}</p>'
    else payment_receipt_body_template end,
  refund_confirmation_subject_template = case when refund_confirmation_subject_template = ''
    then 'Refund issued: {{refund_amount_formatted}} for {{request_title}}' else refund_confirmation_subject_template end,
  refund_confirmation_body_template = case when refund_confirmation_body_template = ''
    then '<p>Hi {{customer_name}},</p><p>We have issued a refund of <strong>{{refund_amount_formatted}}</strong> against your payment for <strong>{{request_title}}</strong>.</p><p>{{refund_reason}}</p><p>Refunds typically take 5–10 business days to appear on your statement, depending on your bank.</p><p>Thanks,<br>{{company_name}}<br>{{company_phone}}</p>'
    else refund_confirmation_body_template end,
  payment_received_internal_subject_template = case when payment_received_internal_subject_template = ''
    then 'Payment received: {{amount_formatted}} — job {{job_number}}' else payment_received_internal_subject_template end,
  payment_received_internal_body_template = case when payment_received_internal_body_template = ''
    then '<p><strong>{{payer_name}}</strong> just paid <strong>{{amount_formatted}}</strong> for <strong>{{request_title}}</strong> on job <strong>{{job_number}}</strong>.</p><p>Method: {{payment_method_display}}<br>Stripe fee: {{stripe_fee_formatted}}<br>Net to bank: {{net_amount_formatted}}</p><p><a href="{{job_link}}">View job</a></p>'
    else payment_received_internal_body_template end,
  payment_failed_internal_subject_template = case when payment_failed_internal_subject_template = ''
    then 'Payment failed: {{amount_formatted}} — job {{job_number}}' else payment_failed_internal_subject_template end,
  payment_failed_internal_body_template = case when payment_failed_internal_body_template = ''
    then '<p>A payment attempt failed.</p><p>Job: <strong>{{job_number}}</strong><br>Request: {{request_title}}<br>Amount: {{amount_formatted}}<br>Payer: {{payer_name}} ({{payer_email}})<br>Reason: {{failure_reason}}</p><p><a href="{{job_link}}">View job</a></p><p>Stripe has notified the customer directly. No action required unless they reach out.</p>'
    else payment_failed_internal_body_template end,
  refund_issued_internal_subject_template = case when refund_issued_internal_subject_template = ''
    then 'Refund confirmed: {{refund_amount_formatted}} — job {{job_number}}' else refund_issued_internal_subject_template end,
  refund_issued_internal_body_template = case when refund_issued_internal_body_template = ''
    then '<p>A refund of <strong>{{refund_amount_formatted}}</strong> has been confirmed by Stripe on job <strong>{{job_number}}</strong> ({{request_title}}).</p><p>Reason (internal): {{refund_reason}}<br>Refunded by: {{refunded_by_name}}</p><p><a href="{{job_link}}">View job</a></p>'
    else refund_issued_internal_body_template end
  where id is not null;

-- ---------------------------------------------------------------------------
-- 7. refunds table — one row per refund request, pending → succeeded|failed.
-- ---------------------------------------------------------------------------
create table if not exists refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  payment_request_id uuid references payment_requests(id) on delete set null,
  amount numeric(10,2) not null check (amount > 0),
  reason text,
  include_reason_in_customer_email boolean not null default false,
  notify_customer boolean not null default true,
  stripe_refund_id text unique,
  status text not null default 'pending'
    check (status in ('pending','succeeded','failed','canceled')),
  failure_reason text,
  refunded_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  refunded_at timestamptz
);

create index if not exists idx_refunds_payment_id on refunds(payment_id);
create index if not exists idx_refunds_payment_request_id on refunds(payment_request_id);
create index if not exists idx_refunds_stripe_refund_id on refunds(stripe_refund_id);

alter table refunds enable row level security;
drop policy if exists "Allow all on refunds" on refunds;
create policy "Allow all on refunds" on refunds for all using (true) with check (true);
grant all on refunds to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. stripe_disputes table — minimal tracking; no evidence flow in 17c.
-- ---------------------------------------------------------------------------
create table if not exists stripe_disputes (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references payments(id) on delete set null,
  payment_request_id uuid references payment_requests(id) on delete set null,
  stripe_dispute_id text unique not null,
  amount numeric(10,2),
  reason text,
  status text check (status in (
    'warning_needs_response','warning_under_review','warning_closed',
    'needs_response','under_review','won','lost'
  )),
  evidence_due_by timestamptz,
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stripe_disputes_stripe_dispute_id on stripe_disputes(stripe_dispute_id);
create index if not exists idx_stripe_disputes_payment_id on stripe_disputes(payment_id);

drop trigger if exists trg_stripe_disputes_updated_at on stripe_disputes;
create trigger trg_stripe_disputes_updated_at
  before update on stripe_disputes
  for each row execute function update_updated_at();

alter table stripe_disputes enable row level security;
drop policy if exists "Allow all on stripe_disputes" on stripe_disputes;
create policy "Allow all on stripe_disputes" on stripe_disputes for all using (true) with check (true);
grant all on stripe_disputes to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. notifications table — minimal stub for Build 14g (Option A). One row
--    per event that should surface in the bell. Scoped to user_profiles so
--    a future multi-user expansion just uses user_profile_id.
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid references user_profiles(id) on delete cascade,
  type text not null check (type in (
    'payment_received','payment_failed','refund_issued',
    'dispute_opened','qb_sync_failed'
  )),
  title text not null,
  body text,
  href text,
  priority text not null default 'normal' check (priority in ('normal','high')),
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_unread
  on notifications(user_profile_id, created_at desc)
  where read_at is null;
create index if not exists idx_notifications_user_created
  on notifications(user_profile_id, created_at desc);

alter table notifications enable row level security;
drop policy if exists "Allow all on notifications" on notifications;
create policy "Allow all on notifications" on notifications for all using (true) with check (true);
grant all on notifications to anon, authenticated, service_role;
```

- [ ] **Step 2: Apply via Supabase dashboard SQL editor**

Paste the file contents into the SQL editor (shared project — dev = prod per memory) and run.

Verify:

```sql
-- CHECKs widened
select conname, pg_get_constraintdef(oid) from pg_constraint
  where conname in (
    'contract_events_event_type_check',
    'payments_source_check','payments_method_check','payments_status_check'
  );

-- New columns on payments
select column_name, data_type from information_schema.columns
  where table_name='payments' and column_name in (
    'payment_request_id','stripe_payment_intent_id','stripe_charge_id',
    'stripe_fee_amount','net_amount','quickbooks_sync_status',
    'quickbooks_sync_attempted_at','quickbooks_sync_error'
  );
-- Expected: 8 rows.

-- New columns on payment_requests
select column_name from information_schema.columns
  where table_name='payment_requests' and column_name in (
    'stripe_receipt_url','qb_payment_id','quickbooks_sync_status',
    'quickbooks_sync_attempted_at','quickbooks_sync_error'
  );
-- Expected: 5 rows.

-- Template columns seeded
select payment_receipt_subject_template is null or payment_receipt_subject_template = ''
  as is_empty from payment_email_settings;
-- Expected: is_empty = false.

-- New tables exist
select table_name from information_schema.tables
  where table_name in ('refunds','stripe_disputes','notifications');
-- Expected: 3 rows (or 2 for Option B — minus notifications).
```

- [ ] **Step 3: Verify tsc still clean**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-build41-webhook-receipts-refunds.sql
git commit -m "feat(17c): migration build41 — webhook CHECKs, payments/payment_requests columns, refunds/disputes/notifications tables, template seeds"
```

---

## Task 3: Stripe webhook signature verification helper

**Files:**
- Create: `src/lib/stripe/webhook/verify.ts`

**Context:** Stripe's SDK provides `stripe.webhooks.constructEvent(body, sig, secret)` which both parses and verifies. We wrap it so callers get a typed error we can surface as 400 vs 503. The secret is loaded from `stripe_connection.webhook_signing_secret_encrypted` and decrypted via `src/lib/encryption.ts`.

- [ ] **Step 1: Write the module**

Create `src/lib/stripe/webhook/verify.ts`:

```typescript
import Stripe from "stripe";
import { decrypt } from "@/lib/encryption";
import { createServiceClient } from "@/lib/supabase-api";

export class WebhookSecretMissingError extends Error {
  constructor() {
    super(
      "Webhook signing secret is not configured. Paste it in Settings → Stripe Payments → Webhook Configuration.",
    );
    this.name = "WebhookSecretMissingError";
  }
}

export class WebhookSignatureInvalidError extends Error {
  constructor(detail: string) {
    super(`Stripe webhook signature verification failed: ${detail}`);
    this.name = "WebhookSignatureInvalidError";
  }
}

async function loadWebhookSecret(): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("stripe_connection")
    .select("webhook_signing_secret_encrypted")
    .limit(1)
    .maybeSingle<{ webhook_signing_secret_encrypted: string | null }>();
  if (error) throw new Error(`stripe_connection load failed: ${error.message}`);
  if (!data || !data.webhook_signing_secret_encrypted)
    throw new WebhookSecretMissingError();
  try {
    return decrypt(data.webhook_signing_secret_encrypted);
  } catch (e) {
    throw new Error(
      `Failed to decrypt webhook signing secret: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// Verifies the signature on an incoming Stripe webhook request. Uses a
// separate Stripe instance (not the tenant getStripeClient) because this
// path runs before we know the event type or account. Any Stripe instance
// can call .webhooks.constructEvent — no API calls are made.
const VERIFIER = new Stripe(process.env.STRIPE_CONNECT_CLIENT_SECRET || "sk_dummy", {
  apiVersion: "2025-09-30.clover",
});

export async function verifyWebhook(
  rawBody: string,
  signature: string | null,
): Promise<Stripe.Event> {
  if (!signature) {
    throw new WebhookSignatureInvalidError("missing stripe-signature header");
  }
  const secret = await loadWebhookSecret();
  try {
    return VERIFIER.webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    throw new WebhookSignatureInvalidError(
      e instanceof Error ? e.message : String(e),
    );
  }
}
```

**Note on `apiVersion`:** the value `"2025-09-30.clover"` matches what `src/lib/stripe.ts` already pins. If the existing `src/lib/stripe.ts` uses a different pin, update this file to match.

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors. If the Stripe API version is wrong, the TS types error will show `'2025-09-30.clover' is not assignable to type StripeConfig['apiVersion']`. Fix by matching whatever `src/lib/stripe.ts:N` has.

- [ ] **Step 3: Commit**

```bash
git add src/lib/stripe/webhook/verify.ts
git commit -m "feat(17c): webhook signature verification helper"
```

---

## Task 4: Idempotency helper (`stripe_events` insert-and-claim)

**Files:**
- Create: `src/lib/stripe/webhook/idempotency.ts`

**Context:** The contract is: on receipt of a Stripe event, INSERT a row into `stripe_events` with `stripe_event_id` UNIQUE. If the insert succeeds, this process owns the event and must process it. If the insert fails with a UNIQUE violation, another process already claimed it — return "duplicate" and the caller returns 200 without reprocessing.

After the handler finishes, we set `processed_at = now()` (success) or `processing_error = <text>` (failure). Failure leaves `processed_at` null so a Stripe retry re-attempts processing. Because `stripe_events.stripe_event_id` is UNIQUE, the retry also becomes a "duplicate" — which means we CANNOT retry by waiting for Stripe to resend. Instead, on handler failure we should either (a) return 500 so Stripe retries AND delete our `stripe_events` row first, or (b) return 200 and rely on a manual replay. Choose (a) for the webhook route — delete the `stripe_events` row on handler exception so the Stripe retry can re-insert and re-process.

- [ ] **Step 1: Write the module**

Create `src/lib/stripe/webhook/idempotency.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

export type ClaimResult =
  | { status: "claimed"; rowId: string }
  | { status: "duplicate" };

// Attempts to claim the event for processing by inserting into stripe_events.
// Returns "claimed" on success, "duplicate" if the row already exists.
export async function claimEvent(
  supabase: SupabaseClient,
  event: Stripe.Event,
): Promise<ClaimResult> {
  const { data, error } = await supabase
    .from("stripe_events")
    .insert({
      stripe_event_id: event.id,
      event_type: event.type,
      livemode: event.livemode ?? null,
      payload: event as unknown as Record<string, unknown>,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) {
    // Supabase PostgREST maps UNIQUE violation to code 23505 / details "duplicate key".
    const msg = error.message.toLowerCase();
    if (
      error.code === "23505" ||
      msg.includes("duplicate key") ||
      msg.includes("violates unique")
    ) {
      return { status: "duplicate" };
    }
    throw new Error(`stripe_events insert failed: ${error.message}`);
  }
  if (!data) throw new Error("stripe_events insert returned no row");
  return { status: "claimed", rowId: data.id };
}

export async function markProcessed(
  supabase: SupabaseClient,
  rowId: string,
  paymentRequestId: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = {
    processed_at: new Date().toISOString(),
  };
  if (paymentRequestId) patch.payment_request_id = paymentRequestId;
  const { error } = await supabase
    .from("stripe_events")
    .update(patch)
    .eq("id", rowId);
  if (error) throw new Error(`stripe_events mark-processed failed: ${error.message}`);
}

// On handler exception: delete the row so Stripe's retry re-claims cleanly.
// Returns nothing — best-effort. If this delete itself fails, the caller
// should log and still return 500; a manual DB cleanup unblocks retries.
export async function releaseEvent(
  supabase: SupabaseClient,
  rowId: string,
  err: unknown,
): Promise<void> {
  const errText = err instanceof Error ? err.message : String(err);
  // First, try to record the error — helpful for post-mortem.
  await supabase
    .from("stripe_events")
    .update({ processing_error: errText })
    .eq("id", rowId)
    .then(() => undefined, () => undefined);
  // Then delete so the next Stripe retry can re-insert.
  await supabase
    .from("stripe_events")
    .delete()
    .eq("id", rowId)
    .then(() => undefined, () => undefined);
}
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/stripe/webhook/idempotency.ts
git commit -m "feat(17c): stripe_events idempotency helpers (claim/markProcessed/releaseEvent)"
```

---

## Task 5: Webhook route skeleton with dispatcher

**Files:**
- Create: `src/app/api/stripe/webhook/route.ts`

**Context:** Thin entry point. Reads raw body, verifies signature, claims the event, dispatches to handlers by event type, marks processed. Returns 200 for success, 400 for bad signature, 503 for missing secret, 500 for handler failure (which triggers Stripe retry).

Handlers are stubbed in this task — they throw "not yet implemented" for non-`checkout.session.completed` types — so we can ship + test signature + idempotency in isolation before wiring specific handlers in Tasks 11–19.

- [ ] **Step 1: Write the route**

Create `src/app/api/stripe/webhook/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase-api";
import {
  verifyWebhook,
  WebhookSecretMissingError,
  WebhookSignatureInvalidError,
} from "@/lib/stripe/webhook/verify";
import {
  claimEvent,
  markProcessed,
  releaseEvent,
} from "@/lib/stripe/webhook/idempotency";

// Webhook handlers need the raw request body for signature verification.
// Force nodejs runtime + disable response caching.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HandlerResult = { paymentRequestId: string | null };

type Handler = (event: Stripe.Event) => Promise<HandlerResult>;

const HANDLERS: Record<string, Handler> = {
  // Tasks 11-19 replace these stubs with real implementations. Until then,
  // anything not explicitly listed returns null and is marked processed.
  "checkout.session.completed": async () => ({ paymentRequestId: null }),
  "payment_intent.succeeded": async () => ({ paymentRequestId: null }),
  "payment_intent.payment_failed": async () => ({ paymentRequestId: null }),
  "charge.refunded": async () => ({ paymentRequestId: null }),
  "charge.dispute.created": async () => ({ paymentRequestId: null }),
  "charge.dispute.closed": async () => ({ paymentRequestId: null }),
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = await verifyWebhook(rawBody, signature);
  } catch (e) {
    if (e instanceof WebhookSecretMissingError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    if (e instanceof WebhookSignatureInvalidError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const supabase = createServiceClient();

  const claim = await claimEvent(supabase, event);
  if (claim.status === "duplicate") {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const handler = HANDLERS[event.type];
  if (!handler) {
    // Unknown event type — we still stored it (good for audit). Mark processed
    // so Stripe doesn't retry. Nothing to do.
    await markProcessed(supabase, claim.rowId, null);
    return NextResponse.json({ ok: true, handled: false });
  }

  try {
    const result = await handler(event);
    await markProcessed(supabase, claim.rowId, result.paymentRequestId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    await releaseEvent(supabase, claim.rowId, e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Verify route is listed in Next build**

Run: `npm run build 2>&1 | grep -E "/api/stripe/webhook"`
Expected: output includes `app/api/stripe/webhook/route`. Confirms Next registered the route.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/stripe/webhook/route.ts
git commit -m "feat(17c): /api/stripe/webhook route skeleton + dispatcher"
```

---

## Task 6: Extend `src/lib/payments/types.ts` with new columns and refund/dispute types

**Files:**
- Modify: `src/lib/payments/types.ts`

**Context:** The existing `PaymentEmailSettings` type must gain the 10 new template columns + `internal_notification_to_email`. Add `PaymentRow`, `RefundRow`, `StripeDisputeRow`, and `NotificationRow` types so handlers have typed shapes.

- [ ] **Step 1: Read the current file to learn the existing shape**

```bash
sed -n '1,200p' src/lib/payments/types.ts
```

Note the existing `PaymentEmailSettings` interface and `PaymentRequestRow` shape. You'll extend both, not rewrite.

- [ ] **Step 2: Add the new template fields to `PaymentEmailSettings`**

Inside the existing `export interface PaymentEmailSettings { ... }`, add these fields (preserve existing ones):

```typescript
  // Added in build41 (17c)
  payment_receipt_subject_template: string;
  payment_receipt_body_template: string;
  refund_confirmation_subject_template: string;
  refund_confirmation_body_template: string;
  payment_received_internal_subject_template: string;
  payment_received_internal_body_template: string;
  payment_failed_internal_subject_template: string;
  payment_failed_internal_body_template: string;
  refund_issued_internal_subject_template: string;
  refund_issued_internal_body_template: string;
  internal_notification_to_email: string | null;
```

- [ ] **Step 3: Extend `PaymentRequestRow` with 17c columns**

Append to the existing `PaymentRequestRow`:

```typescript
  // Added in build41 (17c)
  stripe_receipt_url: string | null;
  qb_payment_id: string | null;
  quickbooks_sync_status: "pending" | "synced" | "failed" | "not_applicable" | null;
  quickbooks_sync_attempted_at: string | null;
  quickbooks_sync_error: string | null;
```

- [ ] **Step 4: Add `PaymentRow`**

Append to the file:

```typescript
export interface PaymentRow {
  id: string;
  job_id: string;
  invoice_id: string | null;
  payment_request_id: string | null;
  source: "insurance" | "homeowner" | "other" | "stripe";
  method:
    | "check"
    | "ach"
    | "venmo_zelle"
    | "cash"
    | "credit_card"
    | "stripe_card"
    | "stripe_ach";
  amount: number;
  reference_number: string | null;
  payer_name: string | null;
  status: "received" | "pending" | "due" | "refunded";
  notes: string | null;
  received_date: string | null;
  created_at: string;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_fee_amount: number | null;
  net_amount: number | null;
  qb_payment_id: string | null;
  quickbooks_sync_status: "pending" | "synced" | "failed" | "not_applicable" | null;
  quickbooks_sync_attempted_at: string | null;
  quickbooks_sync_error: string | null;
}
```

- [ ] **Step 5: Add `RefundRow`, `StripeDisputeRow`, `NotificationRow`**

Append to the file:

```typescript
export interface RefundRow {
  id: string;
  payment_id: string;
  payment_request_id: string | null;
  amount: number;
  reason: string | null;
  include_reason_in_customer_email: boolean;
  notify_customer: boolean;
  stripe_refund_id: string | null;
  status: "pending" | "succeeded" | "failed" | "canceled";
  failure_reason: string | null;
  refunded_by: string | null;
  created_at: string;
  refunded_at: string | null;
}

export interface StripeDisputeRow {
  id: string;
  payment_id: string | null;
  payment_request_id: string | null;
  stripe_dispute_id: string;
  amount: number | null;
  reason: string | null;
  status:
    | "warning_needs_response"
    | "warning_under_review"
    | "warning_closed"
    | "needs_response"
    | "under_review"
    | "won"
    | "lost"
    | null;
  evidence_due_by: string | null;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: string;
  user_profile_id: string | null;
  type:
    | "payment_received"
    | "payment_failed"
    | "refund_issued"
    | "dispute_opened"
    | "qb_sync_failed";
  title: string;
  body: string | null;
  href: string | null;
  priority: "normal" | "high";
  read_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
```

- [ ] **Step 6: Verify tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors. If `PaymentEmailSettings` is used elsewhere and now reports missing required fields, that code must be updated too — but the new fields have `default ''` in the DB, so they should always be present in SELECT *. If errors appear, make the new fields optional (suffix `?:`) as a fallback and flag.

- [ ] **Step 7: Commit**

```bash
git add src/lib/payments/types.ts
git commit -m "feat(17c): extend payment types — new templates, PaymentRow, RefundRow, StripeDisputeRow, NotificationRow"
```

---

## Task 7: Extend merge-fields with receipt/refund/internal fields

**Files:**
- Modify: `src/lib/payments/merge-fields.ts`

**Context:** The `buildPaymentMergeFieldValues` function currently resolves payment+invoice fields. Add the fields listed in Part 7 of the prompt so receipt, refund, and internal templates can reference them. Inputs to new fields come in via an optional `extras` arg so the resolver doesn't have to re-fetch.

- [ ] **Step 1: Add the `PaymentMergeExtras` type near the top of the file**

After the existing `StripeConnectionFees` interface, add:

```typescript
// Runtime-only merge-field inputs — populated by the webhook handler or
// refund flow from a Stripe event payload. None of these are stored on
// payment_requests directly.
export interface PaymentMergeExtras {
  paid_at?: string | null;           // ISO timestamp when Stripe confirmed the payment
  payer_name?: string | null;
  payer_email?: string | null;
  payment_method_type?: "card" | "us_bank_account" | null;
  card_last4?: string | null;        // from Stripe charge.payment_method_details
  card_brand?: string | null;
  bank_name?: string | null;
  transaction_id?: string | null;    // stripe_payment_intent_id (full)
  stripe_receipt_url?: string | null;
  stripe_fee_amount?: number | null;
  net_amount?: number | null;
  failure_reason?: string | null;
  refund_amount?: number | null;
  refund_reason?: string | null;
  refunded_at?: string | null;
  refunded_by_name?: string | null;
  job_link?: string | null;          // <APP_URL>/jobs/<job_id>
}
```

- [ ] **Step 2: Extend the `PAYMENT_MERGE_FIELDS` array**

Add new definitions for each field. Keep existing entries; append these after the existing payment entries:

```typescript
const PAYMENT_EXTENDED: PaymentMergeFieldDefinition[] = [
  { name: "paid_at", label: "Paid At (raw)", category: "Payment" },
  { name: "paid_at_formatted", label: "Paid At", category: "Payment" },
  { name: "payer_name", label: "Payer Name", category: "Payment" },
  { name: "payer_email", label: "Payer Email", category: "Payment" },
  { name: "payment_method_display", label: "Payment Method", category: "Payment" },
  { name: "transaction_id", label: "Transaction ID", category: "Payment" },
  { name: "stripe_receipt_url", label: "Stripe Receipt URL", category: "Payment" },
  { name: "stripe_fee_formatted", label: "Stripe Fee", category: "Payment" },
  { name: "net_amount_formatted", label: "Net to Bank", category: "Payment" },
  { name: "failure_reason", label: "Failure Reason", category: "Payment" },
  { name: "refund_amount_formatted", label: "Refund Amount", category: "Payment" },
  { name: "refund_reason", label: "Refund Reason", category: "Payment" },
  { name: "refunded_at_formatted", label: "Refund Date", category: "Payment" },
  { name: "refunded_by_name", label: "Refunded By", category: "Payment" },
  { name: "job_link", label: "Job Link (internal)", category: "Payment" },
];
```

And change the `PAYMENT_MERGE_FIELDS` export to include them:

```typescript
export const PAYMENT_MERGE_FIELDS: PaymentMergeFieldDefinition[] = [
  ...PAYMENT_ONLY,
  ...PAYMENT_EXTENDED,
  ...INVOICE_ONLY,
];
```

- [ ] **Step 3: Resolve the new fields inside `buildPaymentMergeFieldValues`**

Change the signature to accept `extras`:

```typescript
export async function buildPaymentMergeFieldValues(
  supabase: SupabaseClient,
  pr: PaymentRequestLite,
  opts?: {
    appUrl?: string;
    stripeConnection?: StripeConnectionFees | null;
    extras?: PaymentMergeExtras;
  },
): Promise<Record<string, string | null>> {
```

At the end of the function (just before `return values`), resolve the extras:

```typescript
  const extras = opts?.extras ?? {};

  values.paid_at = extras.paid_at ?? null;
  values.paid_at_formatted = formatDate(extras.paid_at ?? null);
  values.payer_name = extras.payer_name ?? null;
  values.payer_email = extras.payer_email ?? null;

  values.payment_method_display = (() => {
    if (extras.payment_method_type === "us_bank_account") {
      return extras.bank_name
        ? `Bank transfer (${extras.bank_name})`
        : "Bank transfer (ACH)";
    }
    if (extras.payment_method_type === "card") {
      const brand = extras.card_brand
        ? extras.card_brand
            .split("_")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ")
        : "Card";
      return extras.card_last4 ? `${brand} ending in ${extras.card_last4}` : brand;
    }
    return null;
  })();

  values.transaction_id = extras.transaction_id
    ? extras.transaction_id.length > 12
      ? `…${extras.transaction_id.slice(-12)}`
      : extras.transaction_id
    : null;
  values.stripe_receipt_url = extras.stripe_receipt_url ?? null;
  values.stripe_fee_formatted = formatUsd(extras.stripe_fee_amount ?? null);
  values.net_amount_formatted = formatUsd(extras.net_amount ?? null);

  values.failure_reason = extras.failure_reason ?? null;

  values.refund_amount_formatted = formatUsd(extras.refund_amount ?? null);
  values.refund_reason = extras.refund_reason ?? null;
  values.refunded_at_formatted = formatDate(extras.refunded_at ?? null);
  values.refunded_by_name = extras.refunded_by_name ?? null;

  values.job_link = extras.job_link ?? null;
```

- [ ] **Step 4: Extend `resolvePaymentEmailTemplate` to pass `extras` through**

Change signature:

```typescript
export async function resolvePaymentEmailTemplate(
  supabase: SupabaseClient,
  subjectTemplate: string,
  bodyTemplate: string,
  pr: PaymentRequestLite,
  opts?: {
    appUrl?: string;
    stripeConnection?: StripeConnectionFees | null;
    extras?: PaymentMergeExtras;
  },
): Promise<{ subject: string; html: string; unresolvedFields: string[] }> {
  const values = await buildPaymentMergeFieldValues(supabase, pr, opts);
  // ... rest unchanged
}
```

- [ ] **Step 5: Verify tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors. The existing callers (`sendPaymentRequestEmail`, `sendPaymentReminderEmail` in `src/lib/payment-emails.ts`) pass a two-arg opts object without `extras` — that's fine, `extras` is optional.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payments/merge-fields.ts
git commit -m "feat(17c): extend payment merge fields — receipt, refund, internal notification"
```

---

## Task 8: Branded receipt PDF generator

**Files:**
- Create: `src/lib/payments/receipt-pdf.ts`

**Context:** Generates a PDF buffer using `pdf-lib` following the Build 15 contract-signing pattern. Loads company branding from `company_settings`, resolves the payer/payment/invoice details, and composes a simple one-page receipt. Storage is handled by the caller (Task 12) — this module returns only the Buffer.

- [ ] **Step 1: Write the module**

Create `src/lib/payments/receipt-pdf.ts`:

```typescript
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatUsd } from "./merge-fields";

interface CompanySettings {
  company_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  license_number: string | null;
  logo_path: string | null;
}

interface PaymentRequestForReceipt {
  id: string;
  job_id: string;
  invoice_id: string | null;
  title: string;
  amount: number;
  card_fee_amount: number | null;
  total_charged: number | null;
  paid_at: string | null;
  stripe_receipt_url: string | null;
  payer_name: string | null;
  payer_email: string | null;
  payment_method_type: "card" | "us_bank_account" | null;
}

interface JobForReceipt {
  job_number: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface InvoiceForReceipt {
  invoice_number: string | null;
  total_amount: number;
}

export interface GenerateReceiptPdfInput {
  paymentRequestId: string;
  methodDisplay: string;  // from merge-fields; e.g. "Visa ending in 4242"
  transactionIdDisplay: string;  // e.g. "…abc123def456"
  stripeFeeAmount: number | null;
  netAmount: number | null;
}

async function loadCompany(
  supabase: SupabaseClient,
): Promise<CompanySettings> {
  const { data, error } = await supabase
    .from("company_settings")
    .select(
      "company_name, address, city, state, zip, phone, email, license_number, logo_path",
    )
    .limit(1)
    .maybeSingle<CompanySettings>();
  if (error) throw new Error(`company_settings load: ${error.message}`);
  return (
    data ?? {
      company_name: null,
      address: null,
      city: null,
      state: null,
      zip: null,
      phone: null,
      email: null,
      license_number: null,
      logo_path: null,
    }
  );
}

async function loadReceiptContext(
  supabase: SupabaseClient,
  paymentRequestId: string,
): Promise<{
  pr: PaymentRequestForReceipt;
  job: JobForReceipt;
  invoice: InvoiceForReceipt | null;
}> {
  const { data: pr, error: prErr } = await supabase
    .from("payment_requests")
    .select(
      "id, job_id, invoice_id, title, amount, card_fee_amount, total_charged, paid_at, stripe_receipt_url, payer_name, payer_email, payment_method_type",
    )
    .eq("id", paymentRequestId)
    .maybeSingle<PaymentRequestForReceipt>();
  if (prErr || !pr)
    throw new Error(
      `payment_request ${paymentRequestId} not found: ${prErr?.message ?? ""}`,
    );

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("job_number, street_address, city, state, zip")
    .eq("id", pr.job_id)
    .maybeSingle<JobForReceipt>();
  if (jobErr || !job) throw new Error(`job ${pr.job_id} not found`);

  let invoice: InvoiceForReceipt | null = null;
  if (pr.invoice_id) {
    const { data: inv } = await supabase
      .from("invoices")
      .select("invoice_number, total_amount")
      .eq("id", pr.invoice_id)
      .maybeSingle<InvoiceForReceipt>();
    invoice = inv ?? null;
  }

  return { pr, job, invoice };
}

async function loadLogoBytes(
  supabase: SupabaseClient,
  path: string | null,
): Promise<Uint8Array | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from("company").download(path);
  if (!data) return null;
  const arrayBuf = await data.arrayBuffer();
  return new Uint8Array(arrayBuf);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
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

export async function generateReceiptPdf(
  supabase: SupabaseClient,
  input: GenerateReceiptPdfInput,
): Promise<Buffer> {
  const [{ pr, job, invoice }, company] = await Promise.all([
    loadReceiptContext(supabase, input.paymentRequestId),
    loadCompany(supabase),
  ]);

  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // US letter
  const { width, height } = page.size();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const marginX = 48;
  let cursorY = height - marginX;
  const textColor = rgb(0.12, 0.12, 0.14);
  const mutedColor = rgb(0.45, 0.45, 0.5);
  const accentColor = rgb(0.11, 0.62, 0.46);

  // Try to embed the logo in the top-left.
  const logoBytes = await loadLogoBytes(supabase, company.logo_path).catch(
    () => null,
  );
  let logoHeight = 0;
  if (logoBytes && logoBytes.length > 0) {
    try {
      const isPng =
        logoBytes[0] === 0x89 &&
        logoBytes[1] === 0x50 &&
        logoBytes[2] === 0x4e;
      const img = isPng
        ? await doc.embedPng(logoBytes)
        : await doc.embedJpg(logoBytes);
      const scale = Math.min(1, 90 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, {
        x: marginX,
        y: cursorY - h,
        width: w,
        height: h,
      });
      logoHeight = h;
    } catch {
      logoHeight = 0;
    }
  }

  // Right-aligned wordmark + receipt number + date
  const receiptNumber = `#${pr.id.slice(0, 8).toUpperCase()}`;
  page.drawText("RECEIPT", {
    x: width - marginX - bold.widthOfTextAtSize("RECEIPT", 24),
    y: cursorY - 18,
    size: 24,
    font: bold,
    color: accentColor,
  });
  page.drawText(receiptNumber, {
    x: width - marginX - font.widthOfTextAtSize(receiptNumber, 10),
    y: cursorY - 36,
    size: 10,
    font,
    color: mutedColor,
  });
  const dateStr = formatDate(pr.paid_at);
  page.drawText(dateStr, {
    x: width - marginX - font.widthOfTextAtSize(dateStr, 10),
    y: cursorY - 50,
    size: 10,
    font,
    color: mutedColor,
  });

  cursorY -= Math.max(logoHeight, 70) + 24;

  // Company block
  const companyLines = [
    company.company_name || "",
    [company.address, company.city, company.state, company.zip]
      .filter(Boolean)
      .join(", "),
    [company.phone, company.email].filter(Boolean).join(" • "),
    company.license_number ? `License: ${company.license_number}` : "",
  ].filter(Boolean);
  for (const line of companyLines) {
    page.drawText(line, {
      x: marginX,
      y: cursorY,
      size: 10,
      font,
      color: textColor,
    });
    cursorY -= 14;
  }
  cursorY -= 18;

  // Paid-by block
  page.drawText("PAID BY", {
    x: marginX,
    y: cursorY,
    size: 9,
    font: bold,
    color: mutedColor,
  });
  cursorY -= 14;
  const paidByLines = [
    pr.payer_name || "—",
    pr.payer_email || "",
    `Job: ${job.job_number ?? "—"} — ${pr.title}`,
    [job.street_address, job.city, job.state, job.zip]
      .filter(Boolean)
      .join(", "),
  ].filter(Boolean);
  for (const line of paidByLines) {
    page.drawText(line, {
      x: marginX,
      y: cursorY,
      size: 10,
      font,
      color: textColor,
    });
    cursorY -= 14;
  }
  cursorY -= 20;

  // Payment table
  const tableTopY = cursorY;
  page.drawLine({
    start: { x: marginX, y: tableTopY },
    end: { x: width - marginX, y: tableTopY },
    thickness: 0.5,
    color: mutedColor,
  });
  cursorY -= 16;
  page.drawText("Description", {
    x: marginX,
    y: cursorY,
    size: 9,
    font: bold,
    color: mutedColor,
  });
  page.drawText("Amount", {
    x: width - marginX - 80,
    y: cursorY,
    size: 9,
    font: bold,
    color: mutedColor,
  });
  cursorY -= 18;

  const baseAmount = Number(pr.amount);
  const feeAmount = pr.card_fee_amount != null ? Number(pr.card_fee_amount) : 0;
  const totalPaid = pr.total_charged != null ? Number(pr.total_charged) : baseAmount;

  page.drawText(pr.title, {
    x: marginX,
    y: cursorY,
    size: 11,
    font,
    color: textColor,
  });
  page.drawText(formatUsd(baseAmount) ?? "", {
    x: width - marginX - 80,
    y: cursorY,
    size: 11,
    font,
    color: textColor,
  });
  cursorY -= 18;

  if (feeAmount > 0) {
    page.drawText("Card processing fee", {
      x: marginX,
      y: cursorY,
      size: 11,
      font,
      color: textColor,
    });
    page.drawText(formatUsd(feeAmount) ?? "", {
      x: width - marginX - 80,
      y: cursorY,
      size: 11,
      font,
      color: textColor,
    });
    cursorY -= 18;
  }

  page.drawLine({
    start: { x: marginX, y: cursorY + 4 },
    end: { x: width - marginX, y: cursorY + 4 },
    thickness: 0.5,
    color: mutedColor,
  });
  cursorY -= 18;

  page.drawText("TOTAL PAID", {
    x: marginX,
    y: cursorY,
    size: 13,
    font: bold,
    color: textColor,
  });
  page.drawText(formatUsd(totalPaid) ?? "", {
    x: width - marginX - 80,
    y: cursorY,
    size: 13,
    font: bold,
    color: accentColor,
  });
  cursorY -= 30;

  // Method / transaction / stripe fee
  const metaLines = [
    `Method: ${input.methodDisplay}`,
    `Transaction ID: ${input.transactionIdDisplay}`,
  ];
  if (input.stripeFeeAmount != null) {
    metaLines.push(
      `Processing fee: ${formatUsd(input.stripeFeeAmount)} (deducted by Stripe)`,
    );
  }
  if (input.netAmount != null) {
    metaLines.push(`Net deposited to bank: ${formatUsd(input.netAmount)}`);
  }
  for (const line of metaLines) {
    page.drawText(line, {
      x: marginX,
      y: cursorY,
      size: 10,
      font,
      color: mutedColor,
    });
    cursorY -= 14;
  }

  // Invoice balance (if linked)
  if (invoice) {
    cursorY -= 14;
    page.drawText(
      `Applied to invoice ${invoice.invoice_number ?? ""} (${formatUsd(
        Number(invoice.total_amount),
      )}).`,
      {
        x: marginX,
        y: cursorY,
        size: 10,
        font,
        color: mutedColor,
      },
    );
    cursorY -= 14;
  }

  // Footer
  const footerY = 60;
  page.drawLine({
    start: { x: marginX, y: footerY + 40 },
    end: { x: width - marginX, y: footerY + 40 },
    thickness: 0.5,
    color: mutedColor,
  });
  page.drawText("Thank you for your business.", {
    x: marginX,
    y: footerY + 20,
    size: 10,
    font: bold,
    color: textColor,
  });
  if (pr.stripe_receipt_url) {
    page.drawText(
      `A Stripe-issued receipt is also available at ${pr.stripe_receipt_url}`,
      {
        x: marginX,
        y: footerY + 4,
        size: 8,
        font,
        color: mutedColor,
      },
    );
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors. If `company_settings.logo_path` column name differs (some projects use `logo_url`), adapt the SELECT to match actual schema. Verify via:

```bash
grep -E "logo_(path|url)" supabase/*.sql | head -5
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/payments/receipt-pdf.ts
git commit -m "feat(17c): branded receipt PDF generator via pdf-lib"
```

---

## Task 9: Extend email orchestrators — receipt, internal notification, refund

**Files:**
- Modify: `src/lib/payment-emails.ts`

**Context:** The file already exports `sendPaymentRequestEmail` and `sendPaymentReminderEmail`. We add three new orchestrators that match the existing shape (load settings → load request → compute extras → resolve template → send → audit log).

- [ ] **Step 1: Import the new merge-field extras type and receipt PDF**

At the top of `src/lib/payment-emails.ts`, add imports (preserve existing):

```typescript
import type { PaymentMergeExtras } from "@/lib/payments/merge-fields";
import type { Attachment } from "@/lib/payments/email";
import { generateReceiptPdf } from "@/lib/payments/receipt-pdf";
```

- [ ] **Step 2: Export `sendPaymentReceiptEmail`**

Append to the file:

```typescript
export interface ReceiptEmailInput {
  paymentRequestId: string;
  extras: PaymentMergeExtras;
  attachment?: Attachment; // caller may pass a pre-generated PDF
}

export async function sendPaymentReceiptEmail(
  input: ReceiptEmailInput,
): Promise<{ messageId: string; provider: "resend" | "smtp" }> {
  const supabase = createServiceClient();
  const [settings, pr, fees] = await Promise.all([
    loadSettings(supabase),
    loadPaymentRequest(supabase, input.paymentRequestId),
    loadStripeFees(supabase),
  ]);
  const recipient = await loadRecipient(supabase, pr);

  const { subject, html } = await resolvePaymentEmailTemplate(
    supabase,
    settings.payment_receipt_subject_template,
    settings.payment_receipt_body_template,
    pr,
    { stripeConnection: fees, extras: input.extras },
  );

  // Generate receipt PDF if caller didn't pass one. Attachment is optional
  // — if PDF generation fails, send the email without it (body still links
  // to Stripe's hosted receipt).
  let attachments: Attachment[] = [];
  if (input.attachment) {
    attachments = [input.attachment];
  } else {
    try {
      const pdf = await generateReceiptPdf(supabase, {
        paymentRequestId: pr.id,
        methodDisplay: extraMethodDisplay(input.extras),
        transactionIdDisplay: input.extras.transaction_id
          ? `…${input.extras.transaction_id.slice(-12)}`
          : "—",
        stripeFeeAmount: input.extras.stripe_fee_amount ?? null,
        netAmount: input.extras.net_amount ?? null,
      });
      attachments = [
        {
          filename: `receipt-${pr.id.slice(0, 8)}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      ];
    } catch (e) {
      // Log but don't fail the email.
      console.warn(`receipt PDF generation failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  const sent = await sendPaymentEmail(supabase, settings, {
    to: recipient.email,
    subject,
    html,
    attachments,
  });

  await writePaymentEvent(supabase, {
    paymentRequestId: pr.id,
    eventType: "email_delivered",
    metadata: { kind: "receipt", provider: sent.provider, message_id: sent.messageId },
  });

  return sent;
}

function extraMethodDisplay(extras: PaymentMergeExtras): string {
  if (extras.payment_method_type === "us_bank_account") {
    return extras.bank_name ? `Bank transfer (${extras.bank_name})` : "Bank transfer (ACH)";
  }
  if (extras.payment_method_type === "card") {
    const brand = extras.card_brand
      ? extras.card_brand.charAt(0).toUpperCase() + extras.card_brand.slice(1)
      : "Card";
    return extras.card_last4 ? `${brand} ending in ${extras.card_last4}` : brand;
  }
  return "—";
}
```

- [ ] **Step 3: Export `sendPaymentInternalNotification`**

Append:

```typescript
export type InternalNotificationKind =
  | "payment_received"
  | "payment_failed"
  | "refund_issued"
  | "dispute_opened";

export interface InternalNotificationInput {
  paymentRequestId: string;
  kind: InternalNotificationKind;
  extras: PaymentMergeExtras;
  subjectPrefix?: string; // e.g. "DISPUTE OPENED — "
}

export async function sendPaymentInternalNotification(
  input: InternalNotificationInput,
): Promise<{ messageId: string; provider: "resend" | "smtp" } | null> {
  const supabase = createServiceClient();
  const [settings, pr] = await Promise.all([
    loadSettings(supabase),
    loadPaymentRequest(supabase, input.paymentRequestId),
  ]);

  const to = settings.internal_notification_to_email || settings.send_from_email;
  if (!to) return null; // no-op if no destination configured

  const { subjectTpl, bodyTpl } = (() => {
    switch (input.kind) {
      case "payment_received":
      case "dispute_opened":
        // dispute reuses payment_failed template with a subject override per
        // prompt Part 6 (acceptable compromise to avoid a 7th template pair).
        return input.kind === "dispute_opened"
          ? {
              subjectTpl: settings.payment_failed_internal_subject_template,
              bodyTpl: settings.payment_failed_internal_body_template,
            }
          : {
              subjectTpl: settings.payment_received_internal_subject_template,
              bodyTpl: settings.payment_received_internal_body_template,
            };
      case "payment_failed":
        return {
          subjectTpl: settings.payment_failed_internal_subject_template,
          bodyTpl: settings.payment_failed_internal_body_template,
        };
      case "refund_issued":
        return {
          subjectTpl: settings.refund_issued_internal_subject_template,
          bodyTpl: settings.refund_issued_internal_body_template,
        };
    }
  })();

  const { subject, html } = await resolvePaymentEmailTemplate(
    supabase,
    subjectTpl,
    bodyTpl,
    pr,
    { extras: input.extras },
  );

  const finalSubject = input.subjectPrefix
    ? `${input.subjectPrefix}${subject}`
    : subject;

  const sent = await sendPaymentEmail(supabase, settings, {
    to,
    subject: finalSubject,
    html,
  });

  await writePaymentEvent(supabase, {
    paymentRequestId: pr.id,
    eventType: "email_delivered",
    metadata: {
      kind: `internal_${input.kind}`,
      provider: sent.provider,
      message_id: sent.messageId,
    },
  });

  return sent;
}
```

- [ ] **Step 4: Export `sendRefundConfirmationEmail`**

Append:

```typescript
export interface RefundConfirmationInput {
  paymentRequestId: string;
  extras: PaymentMergeExtras; // must include refund_amount, refunded_at; optionally refund_reason if include_reason_in_customer_email
}

export async function sendRefundConfirmationEmail(
  input: RefundConfirmationInput,
): Promise<{ messageId: string; provider: "resend" | "smtp" }> {
  const supabase = createServiceClient();
  const [settings, pr, fees] = await Promise.all([
    loadSettings(supabase),
    loadPaymentRequest(supabase, input.paymentRequestId),
    loadStripeFees(supabase),
  ]);
  const recipient = await loadRecipient(supabase, pr);

  const { subject, html } = await resolvePaymentEmailTemplate(
    supabase,
    settings.refund_confirmation_subject_template,
    settings.refund_confirmation_body_template,
    pr,
    { stripeConnection: fees, extras: input.extras },
  );

  const sent = await sendPaymentEmail(supabase, settings, {
    to: recipient.email,
    subject,
    html,
  });

  await writePaymentEvent(supabase, {
    paymentRequestId: pr.id,
    eventType: "email_delivered",
    metadata: {
      kind: "refund_confirmation",
      provider: sent.provider,
      message_id: sent.messageId,
    },
  });

  return sent;
}
```

- [ ] **Step 5: Verify tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payment-emails.ts
git commit -m "feat(17c): email orchestrators — receipt, internal notification, refund confirmation"
```

---

## Task 10: Suppress Stripe's default customer receipt on Checkout Session

**Files:**
- Modify: `src/app/api/pay/[token]/checkout/route.ts`

**Context:** Currently ([line 184](src/app/api/pay/[token]/checkout/route.ts:184)) the session is created with `customer_email: pr.payer_email ?? undefined`. Without further configuration, Stripe will send its default receipt if the dashboard's "Email customers" setting is on. 17c ships a branded receipt email, so Stripe's default must be suppressed deterministically (not relying on a Dashboard toggle).

The cleanest programmatic suppression: set `payment_intent_data.receipt_email = null`. Stripe documents this as "explicitly disable the receipt for this PaymentIntent even if Dashboard settings would enable it."

- [ ] **Step 1: Edit the session create call**

In `src/app/api/pay/[token]/checkout/route.ts`, inside the `stripe.checkout.sessions.create({...})` call, add `receipt_email: null` to `payment_intent_data`. The existing block is:

```typescript
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
```

Change to:

```typescript
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
        // 17c — suppress Stripe's default customer receipt. Our webhook
        // handler sends a branded receipt email with a PDF attached instead.
        receipt_email: null,
      },
```

- [ ] **Step 2: Verify tsc**

Run: `npx tsc --noEmit`
Expected: 0 errors. If Stripe's TS types complain about `null` (some versions expect `string | undefined`), cast: `receipt_email: null as unknown as undefined`. Flag the cast in the commit message if needed.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/pay/[token]/checkout/route.ts
git commit -m "fix(17c): suppress Stripe default customer receipt — branded receipt replaces it"
```

---

## Task 11: Webhook signing secret UI + API

**Files:**
- Create: `src/app/api/stripe/webhook-secret/route.ts`
- Modify: `src/app/settings/stripe/page.tsx`
- Modify: `src/app/settings/stripe/stripe-settings-client.tsx`

**Context:** The UI shows a masked input ("whsec_•••••" with reveal toggle), a Save button (not auto-save — follow the dirty-flag pattern 17b uses), helper text with dashboard link + event list, and a status indicator derived from whether the secret is set and when the most recent `stripe_events` row was inserted.

- [ ] **Step 1: Write the API route**

Create `src/app/api/stripe/webhook-secret/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { createRouteClient } from "@/lib/supabase-api";
import { encrypt } from "@/lib/encryption";
import { requirePermission } from "@/lib/auth";

export const runtime = "nodejs";

interface Body {
  secret: string | null;
}

export async function POST(req: NextRequest) {
  const gate = await requirePermission(req, "access_settings");
  if (!gate.ok) return gate.response;

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body.secret !== "string" || body.secret !== null && !body.secret.startsWith("whsec_")) {
    return NextResponse.json(
      { error: "secret must be a string starting with whsec_, or null to clear" },
      { status: 400 },
    );
  }

  const supabase = createRouteClient();
  const encryptedOrNull = body.secret ? encrypt(body.secret) : null;

  const { data: existing } = await supabase
    .from("stripe_connection")
    .select("id")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!existing) {
    return NextResponse.json(
      { error: "Connect Stripe before setting the webhook signing secret." },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("stripe_connection")
    .update({ webhook_signing_secret_encrypted: encryptedOrNull })
    .eq("id", existing.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
```

Note: this assumes `src/lib/auth.ts` exports `requirePermission(req, key)` — 17a Task 6 introduced this. If it lives at a different path (e.g. `src/lib/permissions.ts`), adjust the import. Verify before coding:

```bash
grep -rn "export.*requirePermission" src/lib/ | head -3
```

- [ ] **Step 2: Extend the server page to load webhook-config status**

In `src/app/settings/stripe/page.tsx`, where it loads `initialConnection`, also compute two booleans:

```typescript
  const webhookConfigured = Boolean(
    initialConnection?.webhook_signing_secret_encrypted,
  );

  // Most recent stripe_events row timestamp (for "last event received" indicator).
  let lastEventAt: string | null = null;
  if (webhookConfigured) {
    const { data } = await supabase
      .from("stripe_events")
      .select("received_at")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ received_at: string }>();
    lastEventAt = data?.received_at ?? null;
  }
```

Pass `webhookConfigured` and `lastEventAt` to the client component as props.

- [ ] **Step 3: Extend the client with a Webhook Configuration section**

In `src/app/settings/stripe/stripe-settings-client.tsx`, add a new section below the existing settings. The section renders:

```typescript
function WebhookConfigSection({
  configured,
  lastEventAt,
}: {
  configured: boolean;
  lastEventAt: string | null;
}) {
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const res = await fetch("/api/stripe/webhook-secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: value || null }),
    });
    setSaving(false);
    if (!res.ok) {
      const { error } = (await res.json()) as { error?: string };
      toast.error(error ?? "Failed to save webhook secret");
      return;
    }
    toast.success(value ? "Webhook secret saved" : "Webhook secret cleared");
    setDirty(false);
    setValue("");
    router.refresh();
  };

  const statusBadge = (() => {
    if (!configured)
      return <Badge className="bg-red-500/20 text-red-700 dark:text-red-300">No webhook configured</Badge>;
    if (!lastEventAt)
      return <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300">Configured — no events received yet</Badge>;
    const diff = Date.now() - new Date(lastEventAt).getTime();
    const readable =
      diff < 60_000 ? "just now" :
      diff < 3_600_000 ? `${Math.floor(diff / 60_000)}m ago` :
      diff < 86_400_000 ? `${Math.floor(diff / 3_600_000)}h ago` :
      `${Math.floor(diff / 86_400_000)}d ago`;
    return <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">Configured — last event {readable}</Badge>;
  })();

  const appUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <section className="space-y-3 border-t pt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Webhook Configuration</h2>
        {statusBadge}
      </div>
      <p className="text-sm text-muted-foreground">
        Stripe uses a webhook to tell this app when a payment succeeds, fails, is refunded,
        or disputed. Create a webhook in your <a className="underline" target="_blank" rel="noopener noreferrer" href="https://dashboard.stripe.com/test/webhooks">Stripe Dashboard</a> pointing to <code>{appUrl}/api/stripe/webhook</code> and subscribe to these events:
      </p>
      <ul className="text-xs text-muted-foreground list-disc pl-6">
        <li>checkout.session.completed</li>
        <li>payment_intent.succeeded</li>
        <li>payment_intent.payment_failed</li>
        <li>charge.refunded</li>
        <li>charge.dispute.created</li>
        <li>charge.dispute.closed</li>
      </ul>
      <p className="text-sm text-muted-foreground">
        Then copy that endpoint's signing secret (starts with <code>whsec_</code>) and paste it below.
      </p>
      <div className="flex items-center gap-2">
        <Input
          type={reveal ? "text" : "password"}
          placeholder={configured ? "whsec_•••••  (paste to replace)" : "whsec_..."}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setDirty(true);
          }}
        />
        <Button variant="outline" size="sm" onClick={() => setReveal((v) => !v)}>
          {reveal ? "Hide" : "Show"}
        </Button>
        <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </section>
  );
}
```

Mount it in the main client component's return, below the existing sections. Pass `webhookConfigured` and `lastEventAt` through props.

- [ ] **Step 4: Preview-verify**

Ensure dev server is running (`preview_start` if needed). Navigate to `/settings/stripe`:
- Confirm the new section renders with "No webhook configured" red badge.
- Paste a dummy `whsec_test123` value, click Save — toast says saved. Refresh page — badge flips to "Configured — no events received yet" (amber).

- [ ] **Step 5: Verify tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/stripe/webhook-secret/route.ts src/app/settings/stripe/page.tsx src/app/settings/stripe/stripe-settings-client.tsx
git commit -m "feat(17c): /settings/stripe — webhook secret UI + /api/stripe/webhook-secret"
```

---

## Task 12: Handler — `checkout.session.completed` (capture payer details only)

**Files:**
- Create: `src/lib/stripe/webhook/handlers/checkout-session-completed.ts`
- Modify: `src/app/api/stripe/webhook/route.ts` (wire the handler)

**Context:** Per prompt Part 6, this handler does NOT mark paid. It only persists payer info and the payment_intent id onto the `payment_requests` row. The actual status flip waits for `payment_intent.succeeded` so ACH's multi-day settlement window is handled correctly.

- [ ] **Step 1: Write the handler**

Create `src/lib/stripe/webhook/handlers/checkout-session-completed.ts`:

```typescript
import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase-api";

interface HandlerResult {
  paymentRequestId: string | null;
}

export async function handleCheckoutSessionCompleted(
  event: Stripe.Event,
): Promise<HandlerResult> {
  const session = event.data.object as Stripe.Checkout.Session;
  const paymentRequestId =
    (session.metadata as Record<string, string> | null)?.payment_request_id ?? null;
  if (!paymentRequestId) {
    console.warn(
      `[webhook] checkout.session.completed ${session.id} has no metadata.payment_request_id — skipping`,
    );
    return { paymentRequestId: null };
  }

  const supabase = createServiceClient();

  // Payer email/name are optional on the session — fall back to customer_email.
  const payerEmail =
    session.customer_details?.email ?? session.customer_email ?? null;
  const payerName = session.customer_details?.name ?? null;
  const paymentMethodType =
    (session.payment_method_types?.[0] as string | undefined) === "us_bank_account"
      ? "us_bank_account"
      : "card";
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const patch: Record<string, unknown> = {
    payment_method_type: paymentMethodType,
  };
  if (payerEmail) patch.payer_email = payerEmail;
  if (payerName) patch.payer_name = payerName;
  if (paymentIntentId) patch.stripe_payment_intent_id = paymentIntentId;

  const { error } = await supabase
    .from("payment_requests")
    .update(patch)
    .eq("id", paymentRequestId);
  if (error) throw new Error(`payment_requests update: ${error.message}`);

  return { paymentRequestId };
}
```

- [ ] **Step 2: Wire into the dispatcher**

In `src/app/api/stripe/webhook/route.ts`, import the handler and replace the stub:

```typescript
import { handleCheckoutSessionCompleted } from "@/lib/stripe/webhook/handlers/checkout-session-completed";

const HANDLERS: Record<string, Handler> = {
  "checkout.session.completed": handleCheckoutSessionCompleted,
  // ... others remain stubs
};
```

- [ ] **Step 3: Verify tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/stripe/webhook/handlers/checkout-session-completed.ts src/app/api/stripe/webhook/route.ts
git commit -m "feat(17c): webhook handler — checkout.session.completed captures payer/PI id"
```

---

## Task 13: Handler — `payment_intent.succeeded` (the big one)

**Files:**
- Create: `src/lib/stripe/webhook/handlers/payment-intent-succeeded.ts`
- Modify: `src/app/api/stripe/webhook/route.ts` (wire the handler)

**Context:** This is the central handler. It:
1. Looks up the `payment_request` by `payment_intent.metadata.payment_request_id`.
2. Short-circuits if already paid (idempotency).
3. Expands the charge + balance_transaction to get fees.
4. Updates `payment_requests` to `status='paid'`, sets `paid_at`, `stripe_charge_id`, `stripe_receipt_url`.
5. Inserts a `payments` row with Stripe fields populated.
6. Updates `jobs.has_pending_payment_request` and optionally `invoices.stripe_balance_remaining`.
7. Writes `contract_events` with `event_type='paid'`.
8. Kicks off receipt PDF + customer email + internal email + in-app notification + QB sync — each in try/catch so one failure doesn't fail the webhook.

QuickBooks sync logic lives in Task 15; this task imports + calls it (creating a placeholder call that Task 15 fills in).

- [ ] **Step 1: Write the handler**

Create `src/lib/stripe/webhook/handlers/payment-intent-succeeded.ts`:

```typescript
import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase-api";
import { getStripeClient } from "@/lib/stripe";
import { writePaymentEvent } from "@/lib/payments/activity";
import {
  sendPaymentReceiptEmail,
  sendPaymentInternalNotification,
} from "@/lib/payment-emails";
import { writeNotification } from "@/lib/notifications/write";
import { syncPaymentToQb } from "@/lib/qb/sync/stripe-payment-bridge";
import type { PaymentMergeExtras } from "@/lib/payments/merge-fields";
import type { PaymentRequestRow } from "@/lib/payments/types";

interface HandlerResult {
  paymentRequestId: string | null;
}

export async function handlePaymentIntentSucceeded(
  event: Stripe.Event,
): Promise<HandlerResult> {
  const pi = event.data.object as Stripe.PaymentIntent;
  const paymentRequestId =
    (pi.metadata as Record<string, string> | null)?.payment_request_id ?? null;
  if (!paymentRequestId) {
    console.warn(
      `[webhook] payment_intent.succeeded ${pi.id} has no metadata.payment_request_id — skipping`,
    );
    return { paymentRequestId: null };
  }

  const supabase = createServiceClient();

  // Load the payment_request
  const { data: pr, error: prErr } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("id", paymentRequestId)
    .maybeSingle<PaymentRequestRow>();
  if (prErr || !pr) {
    throw new Error(
      `payment_intent.succeeded: payment_request ${paymentRequestId} not found: ${prErr?.message ?? ""}`,
    );
  }

  // Idempotency short-circuit
  if (pr.status === "paid" || pr.status === "refunded" || pr.status === "partially_refunded") {
    return { paymentRequestId };
  }

  // Expand the charge to get fee data
  const { client: stripe } = await getStripeClient();
  const latestChargeId =
    typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
  let charge: Stripe.Charge | null = null;
  let feeAmount = 0;
  if (latestChargeId) {
    charge = await stripe.charges.retrieve(latestChargeId, {
      expand: ["balance_transaction"],
    });
    const bt = charge.balance_transaction;
    if (bt && typeof bt !== "string" && typeof bt.fee === "number") {
      feeAmount = bt.fee / 100;
    }
  }

  const amountReceived = (pi.amount_received ?? 0) / 100;
  const expected = pr.total_charged != null ? Number(pr.total_charged) : Number(pr.amount);
  const amountMismatch = Math.abs(amountReceived - expected) > 0.01;

  const paymentMethodType: "card" | "us_bank_account" =
    (charge?.payment_method_details?.type as string | undefined) === "us_bank_account"
      ? "us_bank_account"
      : "card";
  const methodColumn = paymentMethodType === "us_bank_account" ? "stripe_ach" : "stripe_card";

  const nowIso = new Date().toISOString();

  // 1. Flip payment_requests to paid
  const { error: upErr } = await supabase
    .from("payment_requests")
    .update({
      status: "paid",
      paid_at: nowIso,
      stripe_charge_id: charge?.id ?? null,
      stripe_receipt_url: charge?.receipt_url ?? null,
      quickbooks_sync_status: "pending",
    })
    .eq("id", paymentRequestId)
    .eq("status", pr.status); // optimistic: don't overwrite if another process beat us
  if (upErr) throw new Error(`payment_requests flip paid: ${upErr.message}`);

  // 2. Insert payments row
  const payerName =
    pr.payer_name ?? charge?.billing_details?.name ?? null;

  const { data: inserted, error: insErr } = await supabase
    .from("payments")
    .insert({
      job_id: pr.job_id,
      invoice_id: pr.invoice_id,
      payment_request_id: pr.id,
      source: "stripe",
      method: methodColumn,
      amount: amountReceived,
      reference_number: pi.id, // stripe_payment_intent_id for readability
      payer_name: payerName,
      status: "received",
      received_date: nowIso.slice(0, 10),
      stripe_payment_intent_id: pi.id,
      stripe_charge_id: charge?.id ?? null,
      stripe_fee_amount: feeAmount,
      net_amount: amountReceived - feeAmount,
      quickbooks_sync_status: "pending",
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (insErr) throw new Error(`payments insert: ${insErr.message}`);
  const paymentId = inserted!.id;

  // 3. Update jobs.has_pending_payment_request — recompute
  const { count } = await supabase
    .from("payment_requests")
    .select("id", { count: "exact", head: true })
    .eq("job_id", pr.job_id)
    .in("status", ["sent", "viewed"]);
  await supabase
    .from("jobs")
    .update({ has_pending_payment_request: (count ?? 0) > 0 })
    .eq("id", pr.job_id);

  // 4. Update invoices.stripe_balance_remaining if linked
  if (pr.invoice_id) {
    const { data: inv } = await supabase
      .from("invoices")
      .select("total_amount")
      .eq("id", pr.invoice_id)
      .maybeSingle<{ total_amount: number }>();
    if (inv) {
      const { data: allPaid } = await supabase
        .from("payments")
        .select("amount, status")
        .eq("invoice_id", pr.invoice_id);
      const paidSum = (allPaid ?? [])
        .filter((p: { amount: number; status: string }) => p.status === "received")
        .reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0);
      await supabase
        .from("invoices")
        .update({ stripe_balance_remaining: Number(inv.total_amount) - paidSum })
        .eq("id", pr.invoice_id);
    }
  }

  // 5. Audit log
  await writePaymentEvent(supabase, {
    paymentRequestId: pr.id,
    eventType: "paid",
    metadata: {
      payment_intent_id: pi.id,
      charge_id: charge?.id ?? null,
      amount_received: amountReceived,
      stripe_fee: feeAmount,
      net_amount: amountReceived - feeAmount,
      amount_mismatch: amountMismatch
        ? { expected, actual: amountReceived }
        : undefined,
    },
  });

  // 6. Build merge extras for emails + receipt
  const { data: jobMeta } = await supabase
    .from("jobs")
    .select("job_number")
    .eq("id", pr.job_id)
    .maybeSingle<{ job_number: string | null }>();
  const extras: PaymentMergeExtras = {
    paid_at: nowIso,
    payer_name: payerName,
    payer_email: pr.payer_email,
    payment_method_type: paymentMethodType,
    card_last4:
      charge?.payment_method_details?.card?.last4 ?? null,
    card_brand:
      charge?.payment_method_details?.card?.brand ?? null,
    bank_name:
      charge?.payment_method_details?.us_bank_account?.bank_name ?? null,
    transaction_id: pi.id,
    stripe_receipt_url: charge?.receipt_url ?? null,
    stripe_fee_amount: feeAmount,
    net_amount: amountReceived - feeAmount,
    job_link: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/jobs/${pr.job_id}`,
  };

  // 7. Side effects — each wrapped so one failure doesn't cascade
  await sendPaymentReceiptEmail({ paymentRequestId: pr.id, extras }).catch((e) => {
    console.error(`receipt email failed: ${e instanceof Error ? e.message : e}`);
  });
  await sendPaymentInternalNotification({
    paymentRequestId: pr.id,
    kind: "payment_received",
    extras,
  }).catch((e) => {
    console.error(`internal notification email failed: ${e instanceof Error ? e.message : e}`);
  });
  await writeNotification({
    type: "payment_received",
    title: `Payment received: ${formatUsdInline(amountReceived)} for job ${jobMeta?.job_number ?? "—"}`,
    body: `${payerName ?? "Customer"} paid ${formatUsdInline(amountReceived)} for ${pr.title}.`,
    href: `/jobs/${pr.job_id}`,
    metadata: { payment_request_id: pr.id, payment_id: paymentId },
  }).catch((e) => {
    console.error(`in-app notification failed: ${e instanceof Error ? e.message : e}`);
  });

  // 8. QB sync — inline, failures recorded on payment row (not fatal)
  await syncPaymentToQb(paymentId).catch(async (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("payments")
      .update({
        quickbooks_sync_status: "failed",
        quickbooks_sync_error: msg,
        quickbooks_sync_attempted_at: new Date().toISOString(),
      })
      .eq("id", paymentId);
    await supabase
      .from("payment_requests")
      .update({
        quickbooks_sync_status: "failed",
        quickbooks_sync_error: msg,
        quickbooks_sync_attempted_at: new Date().toISOString(),
      })
      .eq("id", pr.id);
    await writeNotification({
      type: "qb_sync_failed",
      title: `QuickBooks sync failed for job ${jobMeta?.job_number ?? "—"}`,
      body: msg,
      href: `/jobs/${pr.job_id}`,
      priority: "high",
      metadata: { payment_id: paymentId },
    }).catch(() => undefined);
  });

  return { paymentRequestId };
}

function formatUsdInline(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}
```

**Forward-declared dependencies (stubbed in later tasks):**
- `writeNotification` lives in `src/lib/notifications/write.ts` (Task 14).
- `syncPaymentToQb` lives in `src/lib/qb/sync/stripe-payment-bridge.ts` (Task 15).
- This task creates both as stubs so tsc passes. Fill in Task 14 and 15.

- [ ] **Step 2: Create the notifications stub**

Create `src/lib/notifications/write.ts` as a compile-time stub that Task 14 replaces:

```typescript
export interface WriteNotificationInput {
  type:
    | "payment_received"
    | "payment_failed"
    | "refund_issued"
    | "dispute_opened"
    | "qb_sync_failed";
  title: string;
  body?: string;
  href?: string;
  priority?: "normal" | "high";
  userProfileId?: string | null;
  metadata?: Record<string, unknown>;
}

// Stub: Task 14 replaces with the real implementation. Always returns null
// so Option B (defer) also works — nothing surfaces but the webhook flow
// continues uninterrupted.
export async function writeNotification(
  _input: WriteNotificationInput,
): Promise<null> {
  return null;
}
```

- [ ] **Step 3: Create the QB bridge stub**

Create `src/lib/qb/sync/stripe-payment-bridge.ts` as a compile-time stub:

```typescript
// Stub: Task 15 replaces with the real implementation that calls
// syncPayment (invoice-linked) or falls back to a generic income posting
// for standalone deposits, and posts the Stripe fee separately.
export async function syncPaymentToQb(_paymentId: string): Promise<void> {
  throw new Error("syncPaymentToQb not yet implemented (Task 15 stub)");
}
```

- [ ] **Step 4: Wire into the dispatcher**

In `src/app/api/stripe/webhook/route.ts`:

```typescript
import { handlePaymentIntentSucceeded } from "@/lib/stripe/webhook/handlers/payment-intent-succeeded";

const HANDLERS: Record<string, Handler> = {
  "checkout.session.completed": handleCheckoutSessionCompleted,
  "payment_intent.succeeded": handlePaymentIntentSucceeded,
  // rest stays stubs
};
```

- [ ] **Step 5: Verify tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors; build succeeds. The Stripe types `payment_method_details.us_bank_account.bank_name` may not exist in older SDK versions — if so, use `(charge?.payment_method_details as unknown as { us_bank_account?: { bank_name?: string } })?.us_bank_account?.bank_name ?? null`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stripe/webhook/handlers/payment-intent-succeeded.ts src/lib/notifications/write.ts src/lib/qb/sync/stripe-payment-bridge.ts src/app/api/stripe/webhook/route.ts
git commit -m "feat(17c): webhook handler — payment_intent.succeeded (status flip, payments row, side effects)"
```

---

## Task 14: In-app notifications — write helper, API, bell UI (Option A)

**Files (Option A only; skip entirely if Option B was chosen):**
- Replace: `src/lib/notifications/write.ts` (stub → real implementation)
- Create: `src/lib/notifications/types.ts`
- Create: `src/app/api/notifications/route.ts`
- Create: `src/app/api/notifications/[id]/read/route.ts`
- Create: `src/components/notifications/bell.tsx`
- Modify: `src/components/app-shell.tsx` (mount `<NotificationBell />` in header)

**Context:** Minimal stub. No per-user preference persistence in 17c — all authenticated users see the bell. Notifications are currently written with `user_profile_id = null` (broadcast) so every logged-in user sees them; if multi-user preference is needed later, the write helper gains a `userProfileId` arg (already in the input type).

- [ ] **Step 1: Write the types file**

Create `src/lib/notifications/types.ts`:

```typescript
import type { NotificationRow } from "@/lib/payments/types";
export type { NotificationRow };

export type NotificationType = NotificationRow["type"];
```

- [ ] **Step 2: Replace the write stub with real implementation**

Overwrite `src/lib/notifications/write.ts`:

```typescript
import { createServiceClient } from "@/lib/supabase-api";
import type { NotificationType } from "./types";

export interface WriteNotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
  href?: string;
  priority?: "normal" | "high";
  userProfileId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeNotification(
  input: WriteNotificationInput,
): Promise<{ id: string } | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_profile_id: input.userProfileId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      priority: input.priority ?? "normal",
      metadata: input.metadata ?? {},
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`notifications insert: ${error.message}`);
  return data;
}
```

- [ ] **Step 3: Write the list + patch API route**

Create `src/app/api/notifications/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { createRouteClient } from "@/lib/supabase-api";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await requireAuth(req);
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 100);
  const unreadOnly = searchParams.get("unread") === "1";

  const supabase = createRouteClient();
  let q = supabase
    .from("notifications")
    .select("id, type, title, body, href, priority, read_at, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (unreadOnly) q = q.is("read_at", null);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notifications: data ?? [] });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireAuth(req);
  if (!gate.ok) return gate.response;

  const body = (await req.json().catch(() => null)) as { mark_all_read?: boolean } | null;
  if (!body?.mark_all_read) {
    return NextResponse.json(
      { error: "body must include { mark_all_read: true }" },
      { status: 400 },
    );
  }

  const supabase = createRouteClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

If `requireAuth` doesn't exist, substitute with the existing gate — `requirePermission(req, "access_settings")` as a fallback, or simply require any authenticated session. Verify first:

```bash
grep -rn "export.*requireAuth\|export.*requirePermission" src/lib/ | head -5
```

- [ ] **Step 4: Single-mark-read endpoint**

Create `src/app/api/notifications/[id]/read/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { createRouteClient } from "@/lib/supabase-api";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAuth(req);
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const supabase = createRouteClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Write the bell UI**

Create `src/components/notifications/bell.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { NotificationRow } from "@/lib/notifications/types";

export function NotificationBell() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=20");
      if (!res.ok) return;
      const { notifications } = (await res.json()) as {
        notifications: NotificationRow[];
      };
      setRows(notifications);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, []);

  const unreadCount = rows.filter((r) => !r.read_at).length;

  const markOneRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, read_at: new Date().toISOString() } : r)),
    );
  };

  const markAllRead = async () => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mark_all_read: true }),
    });
    await refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {unreadCount > 0 && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline"
              onClick={() => void markAllRead()}
            >
              Mark all read
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading && rows.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">All caught up.</div>
        ) : (
          rows.map((r) => (
            <DropdownMenuItem
              key={r.id}
              asChild
              onSelect={() => void markOneRead(r.id)}
            >
              <Link
                href={r.href ?? "#"}
                className={`flex flex-col gap-0.5 ${
                  r.read_at ? "opacity-60" : ""
                } ${r.priority === "high" ? "border-l-2 border-red-500 pl-2" : ""}`}
              >
                <span className="font-medium text-sm">{r.title}</span>
                {r.body && (
                  <span className="text-xs text-muted-foreground line-clamp-2">
                    {r.body}
                  </span>
                )}
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 6: Mount the bell in the app shell**

In `src/components/app-shell.tsx`, find the header area (where the user menu or theme toggle lives) and add:

```typescript
import { NotificationBell } from "@/components/notifications/bell";

// … inside the header render, next to existing icon buttons:
<NotificationBell />
```

Only mount when NOT on a public route — the existing `PUBLIC_ROUTES` check already gates the header chrome.

- [ ] **Step 7: Preview-verify**

Navigate to any authenticated page (e.g. `/jobs`). Confirm the bell renders in the header. Click it — dropdown says "All caught up."

Insert a test row manually to test the badge:
```sql
insert into notifications (type, title, body, href) values
  ('payment_received','Test notification','Body text','/jobs');
```
Refresh — badge shows "1", dropdown shows the row. Click it — opens `/jobs`, row marks read.

Delete the test row:
```sql
delete from notifications where title = 'Test notification';
```

- [ ] **Step 8: Verify tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/lib/notifications/ src/app/api/notifications/ src/components/notifications/ src/components/app-shell.tsx
git commit -m "feat(17c): minimal in-app notifications — write helper, API, bell UI"
```

---

## Task 15: QuickBooks bridge — standalone deposits + Stripe fee posting

**Files:**
- Replace: `src/lib/qb/sync/stripe-payment-bridge.ts` (stub → real)
- Modify: `src/lib/qb/sync/payments.ts` (add standalone-deposit branch)
- Create: `src/lib/qb/sync/stripe-fees.ts` (post Stripe fee to expense account)

**Context:** The existing `syncPayment()` short-circuits when `payment.invoice_id` is null ([line 86-93](src/lib/qb/sync/payments.ts:86)). 17c needs to either (a) extend `syncPayment` to handle the no-invoice case, or (b) wrap the existing function in a bridge that handles both. Choose (b) — it keeps `syncPayment` surface clean and the bridge concentrates Stripe-specific logic.

**Generic income account mapping:** stored in the existing `qb_mappings` table with `type = 'generic_income_account'`, `platform_value = 'stripe_deposits'`, `qb_entity_id = <account id>`. The admin must configure this row manually via the QB settings UI; if missing, the bridge defers with a clear error.

- [ ] **Step 1: Write the stripe-fees module**

Create `src/lib/qb/sync/stripe-fees.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPurchase } from "@/lib/qb/client";
import type { ValidToken } from "@/lib/qb/tokens";
import type { QbMappingRow } from "@/lib/qb/types";

interface FeePostingInput {
  paymentId: string;
  feeAmount: number;
  stripeChargeId: string;
  paidDate: string; // yyyy-mm-dd
}

export interface FeePostingResult {
  status: "posted" | "skipped";
  qbEntityId?: string;
  reason?: string;
}

// Looks up the mapping row for the Stripe processing-fee expense account,
// then posts a Purchase (expense) line to QB for the fee amount. If no
// mapping exists, returns skipped — the admin must configure first.
export async function postStripeFee(
  supabase: SupabaseClient,
  token: ValidToken,
  input: FeePostingInput,
): Promise<FeePostingResult> {
  if (input.feeAmount <= 0) {
    return { status: "skipped", reason: "fee_amount_zero" };
  }

  const { data: mappings } = await supabase
    .from("qb_mappings")
    .select("id, type, platform_value, qb_entity_id")
    .eq("type", "stripe_fee_account");
  const accountMap = (mappings ?? []) as QbMappingRow[];
  const expenseAccount = accountMap.find(
    (m) => m.platform_value === "stripe_processing_fees",
  );
  if (!expenseAccount) {
    return { status: "skipped", reason: "no_mapping" };
  }

  // We also need a bank/deposit account to pay FROM — reuse the same deposit
  // account as the matching Stripe payment, found via the "stripe_card"
  // mapping for now. If neither stripe_card nor stripe_ach mapping exists,
  // fall back to any payment_method mapping.
  const { data: depositMappings } = await supabase
    .from("qb_mappings")
    .select("id, type, platform_value, qb_entity_id")
    .eq("type", "payment_method");
  const deposits = (depositMappings ?? []) as QbMappingRow[];
  const bankAccount =
    deposits.find((m) => m.platform_value === "stripe_card") ??
    deposits.find((m) => m.platform_value === "stripe_ach") ??
    deposits[0];
  if (!bankAccount) {
    return { status: "skipped", reason: "no_bank_mapping" };
  }

  const purchase = await createPurchase(token, {
    PaymentType: "Cash",
    AccountRef: { value: bankAccount.qb_entity_id },
    TxnDate: input.paidDate,
    PrivateNote: `Stripe processing fee for charge ${input.stripeChargeId}`,
    Line: [
      {
        Amount: input.feeAmount,
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: expenseAccount.qb_entity_id },
        },
      },
    ],
  });

  return { status: "posted", qbEntityId: purchase.id };
}
```

**Note:** `createPurchase` may not exist in `src/lib/qb/client.ts`. If it doesn't, add it following the existing `createPayment` pattern in the same file — a thin wrapper around QBO's POST /v3/company/{id}/purchase endpoint. Verify:

```bash
grep -n "export.*createPurchase\|export.*createPayment" src/lib/qb/client.ts
```

If `createPurchase` is missing, add it in a sub-step:

```typescript
// In src/lib/qb/client.ts, next to createPayment:
export async function createPurchase(
  token: ValidToken,
  payload: Record<string, unknown>,
): Promise<{ id: string; SyncToken: string }> {
  const res = await postQbo(token, "/purchase", payload);
  return { id: res.Purchase.Id, SyncToken: res.Purchase.SyncToken };
}
```

Use the same `postQbo` helper that `createPayment` uses.

- [ ] **Step 2: Extend `syncPayment` for standalone deposits**

In `src/lib/qb/sync/payments.ts`, replace the current no-invoice short-circuit (lines 86-93):

```typescript
  if (!payment.invoice_id) {
    // No invoice linkage — we don't sync free-standing payments in 16d.
    return {
      status: "synced",
      payload: { CustomerRef: { value: "no_invoice" }, TotalAmt: 0, Line: [] },
      reason: "no_invoice_linkage",
    };
  }
```

with a branch that syncs standalone deposits to a generic income account if one is configured:

```typescript
  if (!payment.invoice_id) {
    // 17c — for standalone deposits/retainers (no invoice linkage), post
    // against a generic income account if configured via qb_mappings.
    const { data: genericMappings } = await supabase
      .from("qb_mappings")
      .select("id, type, platform_value, qb_entity_id")
      .eq("type", "generic_income_account");
    const incomeAccount = (genericMappings ?? []).find(
      (m) => m.platform_value === "stripe_deposits",
    ) as QbMappingRow | undefined;
    if (!incomeAccount) {
      return {
        status: "deferred",
        payload: { CustomerRef: { value: "pending" }, TotalAmt: 0, Line: [] },
        reason: "no_generic_income_mapping",
      };
    }

    // Need a subcustomer for the job — same as the invoice path.
    const { data: job } = await supabase
      .from("jobs")
      .select("id, qb_subcustomer_id")
      .eq("id", payment.job_id)
      .maybeSingle<JobRow>();
    if (!job?.qb_subcustomer_id) {
      return {
        status: "deferred",
        payload: { CustomerRef: { value: "pending" }, TotalAmt: 0, Line: [] },
        reason: "sub_customer_not_synced",
      };
    }

    const { data: methodMappings } = await supabase
      .from("qb_mappings")
      .select("id, type, platform_value, qb_entity_id")
      .eq("type", "payment_method");
    const depositAccount =
      (methodMappings ?? []).find(
        (m: QbMappingRow) => m.platform_value === payment.method,
      ) ?? null;
    if (!depositAccount) {
      const err = new Error(
        `Payment method "${payment.method}" isn't mapped to a QB deposit account.`,
      );
      (err as Error & { code?: string }).code = "deposit_account_not_mapped";
      throw err;
    }

    const payload: QbPaymentPayload = {
      CustomerRef: { value: job.qb_subcustomer_id },
      TotalAmt: Number(payment.amount),
      Line: [
        {
          // No LinkedTxn — credits the generic income account instead.
          Amount: Number(payment.amount),
          DetailType: "PaymentLineDetail",
          PaymentLineDetail: {
            DepositToAccountRef: { value: incomeAccount.qb_entity_id },
          },
        },
      ],
      DepositToAccountRef: { value: depositAccount.qb_entity_id },
      TxnDate: toIsoDate(payment.received_date),
      PrivateNote:
        (payment.reference_number || payment.notes || "").slice(0, 4000) ||
        "Standalone deposit (no invoice)",
    };

    if (mode === "dry_run") {
      return { status: "skipped_dry_run", payload };
    }
    if (!token) throw new Error("live sync requires a valid token");

    if (payment.qb_payment_id) {
      return { status: "synced", payload, qbEntityId: payment.qb_payment_id };
    }
    const created = await createPayment(token, payload);
    await supabase
      .from("payments")
      .update({ qb_payment_id: created.id })
      .eq("id", payment.id);
    return { status: "synced", payload, qbEntityId: created.id };
  }
```

Important: the payload shape for a no-invoice payment may need adjustment per QBO's actual API. The `DetailType: "PaymentLineDetail"` with a line-level `DepositToAccountRef` is standard for "deposit without linked invoice". If `QbPaymentPayload['Line']` in `src/lib/qb/types.ts` doesn't permit this shape, widen the type:

```bash
grep -n "interface QbPaymentLine\|Line:" src/lib/qb/types.ts
```

Add the optional `DetailType` and `PaymentLineDetail` fields to the `Line` element type.

- [ ] **Step 3: Replace the stripe-payment-bridge stub**

Overwrite `src/lib/qb/sync/stripe-payment-bridge.ts`:

```typescript
import { createServiceClient } from "@/lib/supabase-api";
import { getValidToken } from "@/lib/qb/tokens";
import { syncPayment } from "@/lib/qb/sync/payments";
import { postStripeFee } from "@/lib/qb/sync/stripe-fees";
import type { PaymentRow } from "@/lib/payments/types";

// Entry point called from the webhook handler. Pushes a Stripe payment to
// QuickBooks and posts the processing fee as a separate expense. Updates
// payments.quickbooks_sync_status + error on the way out.
export async function syncPaymentToQb(paymentId: string): Promise<void> {
  const supabase = createServiceClient();

  const token = await getValidToken();
  if (!token) {
    // No active QB connection — not applicable, not failed.
    await supabase
      .from("payments")
      .update({
        quickbooks_sync_status: "not_applicable",
        quickbooks_sync_attempted_at: new Date().toISOString(),
      })
      .eq("id", paymentId);
    await supabase
      .from("payment_requests")
      .update({ quickbooks_sync_status: "not_applicable" })
      .eq("id",
        (
          await supabase
            .from("payments")
            .select("payment_request_id")
            .eq("id", paymentId)
            .maybeSingle<{ payment_request_id: string | null }>()
        ).data?.payment_request_id ?? "00000000-0000-0000-0000-000000000000",
      );
    return;
  }

  const outcome = await syncPayment(supabase, token, "live", paymentId, "create");

  if (outcome.status === "deferred") {
    throw new Error(`QB sync deferred: ${outcome.reason ?? "unknown"}`);
  }

  // Post the Stripe fee as a separate expense, if we have fee data.
  const { data: payment } = await supabase
    .from("payments")
    .select("stripe_fee_amount, stripe_charge_id, received_date, payment_request_id")
    .eq("id", paymentId)
    .maybeSingle<Pick<PaymentRow, "stripe_fee_amount" | "stripe_charge_id" | "received_date" | "payment_request_id">>();
  if (payment?.stripe_fee_amount && payment.stripe_fee_amount > 0 && payment.stripe_charge_id) {
    await postStripeFee(supabase, token, {
      paymentId,
      feeAmount: Number(payment.stripe_fee_amount),
      stripeChargeId: payment.stripe_charge_id,
      paidDate: payment.received_date ?? new Date().toISOString().slice(0, 10),
    }).catch((e) => {
      // Fee posting failure is logged but doesn't fail the whole sync — the
      // payment is in QB; the fee can be posted manually by accounting.
      console.warn(`Stripe fee posting failed: ${e instanceof Error ? e.message : e}`);
    });
  }

  // Mark synced.
  const nowIso = new Date().toISOString();
  await supabase
    .from("payments")
    .update({
      quickbooks_sync_status: "synced",
      quickbooks_sync_attempted_at: nowIso,
      qb_payment_id: outcome.qbEntityId,
    })
    .eq("id", paymentId);
  if (payment?.payment_request_id) {
    await supabase
      .from("payment_requests")
      .update({
        quickbooks_sync_status: "synced",
        quickbooks_sync_attempted_at: nowIso,
        qb_payment_id: outcome.qbEntityId,
      })
      .eq("id", payment.payment_request_id);
  }
}
```

**Note on `getValidToken`:** this is the existing function from `src/lib/qb/tokens.ts`. Verify its exact name and return shape:

```bash
grep -n "export.*getValidToken\|export.*validToken" src/lib/qb/tokens.ts
```

Adjust import if the name differs (e.g. `loadValidToken`, `currentToken`).

- [ ] **Step 4: Verify tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/qb/sync/stripe-payment-bridge.ts src/lib/qb/sync/payments.ts src/lib/qb/sync/stripe-fees.ts src/lib/qb/client.ts src/lib/qb/types.ts
git commit -m "feat(17c): QB bridge — standalone deposits + Stripe fee posting"
```

---

## Task 16: Handler — `payment_intent.payment_failed`

**Files:**
- Create: `src/lib/stripe/webhook/handlers/payment-intent-failed.ts`
- Modify: `src/app/api/stripe/webhook/route.ts` (wire handler)

- [ ] **Step 1: Write the handler**

Create `src/lib/stripe/webhook/handlers/payment-intent-failed.ts`:

```typescript
import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase-api";
import { writePaymentEvent } from "@/lib/payments/activity";
import { sendPaymentInternalNotification } from "@/lib/payment-emails";
import { writeNotification } from "@/lib/notifications/write";
import type { PaymentRequestRow } from "@/lib/payments/types";

export async function handlePaymentIntentFailed(
  event: Stripe.Event,
): Promise<{ paymentRequestId: string | null }> {
  const pi = event.data.object as Stripe.PaymentIntent;
  const paymentRequestId =
    (pi.metadata as Record<string, string> | null)?.payment_request_id ?? null;
  if (!paymentRequestId) return { paymentRequestId: null };

  const supabase = createServiceClient();
  const { data: pr } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("id", paymentRequestId)
    .maybeSingle<PaymentRequestRow>();
  if (!pr) return { paymentRequestId };

  // Idempotency: if already failed, skip side effects.
  if (pr.status === "failed") return { paymentRequestId };

  const failureReason =
    pi.last_payment_error?.message ??
    pi.last_payment_error?.code ??
    "unknown";

  await supabase
    .from("payment_requests")
    .update({ status: "failed" })
    .eq("id", paymentRequestId)
    .eq("status", pr.status);

  await writePaymentEvent(supabase, {
    paymentRequestId,
    eventType: "payment_failed",
    metadata: {
      payment_intent_id: pi.id,
      failure_code: pi.last_payment_error?.code,
      failure_reason: failureReason,
      decline_code: pi.last_payment_error?.decline_code,
    },
  });

  const { data: jobMeta } = await supabase
    .from("jobs")
    .select("job_number")
    .eq("id", pr.job_id)
    .maybeSingle<{ job_number: string | null }>();

  const extras = {
    payer_name: pr.payer_name,
    payer_email: pr.payer_email,
    failure_reason: failureReason,
    job_link: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/jobs/${pr.job_id}`,
  };

  await sendPaymentInternalNotification({
    paymentRequestId,
    kind: "payment_failed",
    extras,
  }).catch((e) => {
    console.error(`internal failure email: ${e instanceof Error ? e.message : e}`);
  });

  await writeNotification({
    type: "payment_failed",
    title: `Payment failed: ${pr.title} (job ${jobMeta?.job_number ?? "—"})`,
    body: failureReason,
    href: `/jobs/${pr.job_id}`,
    metadata: { payment_request_id: pr.id },
  }).catch(() => undefined);

  return { paymentRequestId };
}
```

- [ ] **Step 2: Wire into dispatcher**

```typescript
import { handlePaymentIntentFailed } from "@/lib/stripe/webhook/handlers/payment-intent-failed";

const HANDLERS: Record<string, Handler> = {
  // existing three …
  "payment_intent.payment_failed": handlePaymentIntentFailed,
};
```

- [ ] **Step 3: Verify tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/stripe/webhook/handlers/payment-intent-failed.ts src/app/api/stripe/webhook/route.ts
git commit -m "feat(17c): webhook handler — payment_intent.payment_failed"
```

---

## Task 17: Refund API + modal

**Files:**
- Create: `src/app/api/payment-requests/[id]/refund/route.ts`
- Create: `src/components/payments/refund-modal.tsx`

**Context:** The API route creates a `refunds` row (status='pending'), calls Stripe, returns immediately. The charge.refunded webhook (Task 18) finalizes the row and fires the customer email. The modal is opened from the Billing section (wired in Task 20).

- [ ] **Step 1: Write the refund API route**

Create `src/app/api/payment-requests/[id]/refund/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { createRouteClient, createServiceClient } from "@/lib/supabase-api";
import { requirePermission } from "@/lib/auth";
import { getStripeClient } from "@/lib/stripe";
import type { PaymentRow } from "@/lib/payments/types";

export const runtime = "nodejs";

interface Body {
  amount: number; // USD, e.g. 12.34
  reason?: string | null;
  include_reason_in_customer_email?: boolean;
  notify_customer?: boolean;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requirePermission(req, "record_payments");
  if (!gate.ok) return gate.response;
  const { id: paymentRequestId } = await params;

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body.amount !== "number" || body.amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }

  const authedSupabase = createRouteClient();
  const serviceSupabase = createServiceClient();

  // Find the most recent stripe payment row linked to this request.
  const { data: payment, error: payErr } = await serviceSupabase
    .from("payments")
    .select("id, amount, status, stripe_charge_id, payment_request_id")
    .eq("payment_request_id", paymentRequestId)
    .eq("source", "stripe")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Pick<PaymentRow, "id" | "amount" | "status" | "stripe_charge_id" | "payment_request_id">>();
  if (payErr || !payment) {
    return NextResponse.json({ error: "no Stripe payment found on this request" }, { status: 404 });
  }
  if (!payment.stripe_charge_id) {
    return NextResponse.json({ error: "payment has no stripe_charge_id — cannot refund" }, { status: 400 });
  }

  // Validate amount against remaining refundable
  const { data: prevRefunds } = await serviceSupabase
    .from("refunds")
    .select("amount, status")
    .eq("payment_id", payment.id)
    .in("status", ["pending", "succeeded"]);
  const refundedSoFar = (prevRefunds ?? []).reduce(
    (s: number, r: { amount: number }) => s + Number(r.amount),
    0,
  );
  const remaining = Number(payment.amount) - refundedSoFar;
  if (body.amount - remaining > 0.01) {
    return NextResponse.json(
      { error: `refund exceeds remaining refundable ($${remaining.toFixed(2)})` },
      { status: 400 },
    );
  }

  // Find the acting user for refunded_by
  const { data: me } = await authedSupabase.auth.getUser();
  const refundedBy = me.user?.id ?? null;

  // Create pending refund row FIRST so we have an ID to send to Stripe metadata.
  const { data: refundRow, error: rfErr } = await serviceSupabase
    .from("refunds")
    .insert({
      payment_id: payment.id,
      payment_request_id: paymentRequestId,
      amount: body.amount,
      reason: body.reason ?? null,
      include_reason_in_customer_email: body.include_reason_in_customer_email ?? false,
      notify_customer: body.notify_customer ?? true,
      refunded_by: refundedBy,
      status: "pending",
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (rfErr || !refundRow) {
    return NextResponse.json(
      { error: `failed to create refund row: ${rfErr?.message ?? ""}` },
      { status: 500 },
    );
  }

  // Call Stripe
  const { client: stripe } = await getStripeClient();
  try {
    const stripeRefund = await stripe.refunds.create({
      charge: payment.stripe_charge_id,
      amount: Math.round(body.amount * 100),
      reason: "requested_by_customer",
      metadata: {
        refund_id: refundRow.id,
        payment_request_id: paymentRequestId,
      },
    });
    await serviceSupabase
      .from("refunds")
      .update({ stripe_refund_id: stripeRefund.id })
      .eq("id", refundRow.id);
    return NextResponse.json({
      refund_id: refundRow.id,
      status: "pending",
      stripe_refund_id: stripeRefund.id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await serviceSupabase
      .from("refunds")
      .update({ status: "failed", failure_reason: msg })
      .eq("id", refundRow.id);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the refund modal**

Create `src/components/payments/refund-modal.tsx`:

```typescript
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

export interface RefundModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentRequestId: string;
  paymentRequestTitle: string;
  remainingRefundable: number;
  onRefunded?: () => void;
}

export function RefundModal({
  open,
  onOpenChange,
  paymentRequestId,
  paymentRequestTitle,
  remainingRefundable,
  onRefunded,
}: RefundModalProps) {
  const [refundType, setRefundType] = useState<"full" | "partial">("full");
  const [amount, setAmount] = useState(remainingRefundable.toFixed(2));
  const [reason, setReason] = useState("");
  const [includeReason, setIncludeReason] = useState(false);
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    const amt = refundType === "full" ? remainingRefundable : Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter a positive amount.");
      return;
    }
    if (amt - remainingRefundable > 0.01) {
      toast.error(`Amount exceeds refundable ($${remainingRefundable.toFixed(2)}).`);
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/payment-requests/${paymentRequestId}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amt,
        reason: reason || null,
        include_reason_in_customer_email: includeReason,
        notify_customer: notifyCustomer,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const { error } = (await res.json()) as { error?: string };
      toast.error(error ?? "Refund failed");
      return;
    }
    toast.success("Refund initiated. Stripe will confirm in a few seconds.");
    onOpenChange(false);
    onRefunded?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund — {paymentRequestTitle}</DialogTitle>
          <DialogDescription>
            Refundable: ${remainingRefundable.toFixed(2)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <RadioGroup value={refundType} onValueChange={(v) => setRefundType(v as "full" | "partial")}>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="full" id="rf-full" />
              <Label htmlFor="rf-full">Full refund</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="partial" id="rf-partial" />
              <Label htmlFor="rf-partial">Partial refund</Label>
            </div>
          </RadioGroup>

          <div>
            <Label htmlFor="rf-amount">Amount</Label>
            <Input
              id="rf-amount"
              type="number"
              step="0.01"
              min="0.01"
              max={remainingRefundable}
              disabled={refundType === "full"}
              value={refundType === "full" ? remainingRefundable.toFixed(2) : amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="rf-reason">Reason</Label>
            <Textarea
              id="rf-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Internal note. Shown to customer only if you check the box below."
              rows={3}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="rf-include-reason"
              checked={includeReason}
              onCheckedChange={(v) => setIncludeReason(v === true)}
            />
            <Label htmlFor="rf-include-reason" className="text-sm">
              Include reason in customer email
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="rf-notify"
              checked={notifyCustomer}
              onCheckedChange={(v) => setNotifyCustomer(v === true)}
            />
            <Label htmlFor="rf-notify" className="text-sm">
              Notify customer by email when Stripe confirms the refund
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void onSubmit()} disabled={submitting}>
            {submitting ? "Submitting…" : "Confirm refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Verify tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/payment-requests/[id]/refund/route.ts src/components/payments/refund-modal.tsx
git commit -m "feat(17c): refund initiation — /api/payment-requests/[id]/refund + RefundModal"
```

---

## Task 18: Handler — `charge.refunded`

**Files:**
- Create: `src/lib/stripe/webhook/handlers/charge-refunded.ts`
- Create: `src/lib/qb/sync/refunds.ts`
- Modify: `src/app/api/stripe/webhook/route.ts` (wire handler)

**Context:** Fires both when we initiated via the API (Task 17 — a `refunds` row exists with matching `stripe_refund_id`) and when Eric issues a refund directly in Stripe Dashboard (no `refunds` row — create one on receipt with `refunded_by = null`). Reconciles row to `succeeded`, flips `payment_requests.status` to `refunded` or `partially_refunded`, sends customer email if toggled, writes audit + notification, pushes refund to QB.

- [ ] **Step 1: Write the QB refund posting module**

Create `src/lib/qb/sync/refunds.ts`:

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRefundReceipt } from "@/lib/qb/client";
import type { ValidToken } from "@/lib/qb/tokens";
import type { QbMappingRow } from "@/lib/qb/types";

interface RefundPostingInput {
  refundId: string;
  paymentId: string;
  amount: number;
  paidDate: string;
  stripeRefundId: string;
  invoiceId: string | null;
  jobId: string;
}

export async function postRefundToQb(
  supabase: SupabaseClient,
  token: ValidToken,
  input: RefundPostingInput,
): Promise<{ status: "posted" | "skipped"; qbEntityId?: string; reason?: string }> {
  // Look up the job's subcustomer
  const { data: job } = await supabase
    .from("jobs")
    .select("qb_subcustomer_id")
    .eq("id", input.jobId)
    .maybeSingle<{ qb_subcustomer_id: string | null }>();
  if (!job?.qb_subcustomer_id) {
    return { status: "skipped", reason: "sub_customer_not_synced" };
  }

  // Find the deposit account mapping
  const { data: mappings } = await supabase
    .from("qb_mappings")
    .select("id, type, platform_value, qb_entity_id")
    .eq("type", "payment_method");
  const deposits = (mappings ?? []) as QbMappingRow[];
  const depositAccount =
    deposits.find((m) => m.platform_value === "stripe_card") ??
    deposits.find((m) => m.platform_value === "stripe_ach");
  if (!depositAccount) {
    return { status: "skipped", reason: "no_deposit_mapping" };
  }

  const payload: Record<string, unknown> = {
    CustomerRef: { value: job.qb_subcustomer_id },
    TotalAmt: input.amount,
    DepositToAccountRef: { value: depositAccount.qb_entity_id },
    TxnDate: input.paidDate,
    PrivateNote: `Stripe refund ${input.stripeRefundId}`,
    Line: [
      {
        Amount: input.amount,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          // Use the same generic service item as invoice lines. Assumes a
          // qb_mappings row of type='refund_item' maps to a QB Item id.
          ItemRef: { value: "1" }, // placeholder — see note below
        },
      },
    ],
  };

  const created = await createRefundReceipt(token, payload);
  return { status: "posted", qbEntityId: created.id };
}
```

**Note on the ItemRef placeholder:** QB RefundReceipt requires a line-level Item. If the project already has a "Services" or "Labor" item configured via `qb_mappings` (e.g., invoice line items), look that up instead of hardcoding `"1"`. Verify by looking at how `syncInvoice` resolves line items:

```bash
grep -n "ItemRef\|SalesItemLineDetail" src/lib/qb/sync/invoices.ts | head -10
```

If invoices use a per-line-item mapping, reuse that. Otherwise, add a `qb_mappings` row of `type='refund_item'` manually (documented in the verification task) and look it up in this function.

Also add `createRefundReceipt` to `src/lib/qb/client.ts` if missing (follow `createPayment` pattern, hit `/refundreceipt`).

- [ ] **Step 2: Write the charge.refunded handler**

Create `src/lib/stripe/webhook/handlers/charge-refunded.ts`:

```typescript
import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase-api";
import { getStripeClient } from "@/lib/stripe";
import { getValidToken } from "@/lib/qb/tokens";
import { writePaymentEvent } from "@/lib/payments/activity";
import {
  sendRefundConfirmationEmail,
  sendPaymentInternalNotification,
} from "@/lib/payment-emails";
import { writeNotification } from "@/lib/notifications/write";
import { postRefundToQb } from "@/lib/qb/sync/refunds";
import type {
  PaymentRequestRow,
  PaymentRow,
  RefundRow,
} from "@/lib/payments/types";

export async function handleChargeRefunded(
  event: Stripe.Event,
): Promise<{ paymentRequestId: string | null }> {
  const charge = event.data.object as Stripe.Charge;
  const chargeId = charge.id;

  const supabase = createServiceClient();

  // 1. Find the payment by stripe_charge_id
  const { data: payment, error: payErr } = await supabase
    .from("payments")
    .select("id, job_id, invoice_id, amount, payment_request_id, stripe_charge_id, received_date")
    .eq("stripe_charge_id", chargeId)
    .maybeSingle<Pick<PaymentRow, "id" | "job_id" | "invoice_id" | "amount" | "payment_request_id" | "stripe_charge_id" | "received_date">>();
  if (payErr || !payment) {
    console.warn(`[webhook] charge.refunded — no payments row for charge ${chargeId}`);
    return { paymentRequestId: null };
  }

  // 2. Find the most recent Stripe refund object on this charge
  const { client: stripe } = await getStripeClient();
  const refundList = await stripe.refunds.list({ charge: chargeId, limit: 10 });
  if (!refundList.data.length) {
    console.warn(`[webhook] charge.refunded — Stripe has no refund objects for charge ${chargeId}`);
    return { paymentRequestId: payment.payment_request_id };
  }

  // Newest-first is how Stripe orders refunds.list by default.
  const newestRefund = refundList.data[0]!;

  // 3. Find or create the refunds row
  let { data: refundRow } = await supabase
    .from("refunds")
    .select("*")
    .eq("stripe_refund_id", newestRefund.id)
    .maybeSingle<RefundRow>();

  if (!refundRow) {
    // Refund was initiated from Stripe Dashboard (not our UI) — create row.
    const { data: created, error: crErr } = await supabase
      .from("refunds")
      .insert({
        payment_id: payment.id,
        payment_request_id: payment.payment_request_id,
        amount: newestRefund.amount / 100,
        reason: "Initiated from Stripe dashboard",
        include_reason_in_customer_email: false,
        notify_customer: true,
        stripe_refund_id: newestRefund.id,
        status: "pending",
        refunded_by: null,
      })
      .select("*")
      .maybeSingle<RefundRow>();
    if (crErr || !created) {
      throw new Error(`refunds insert (dashboard-initiated): ${crErr?.message ?? ""}`);
    }
    refundRow = created;
  }

  // Idempotency: if already succeeded, skip the side effects.
  if (refundRow.status === "succeeded") {
    return { paymentRequestId: payment.payment_request_id };
  }

  // 4. Mark refund row succeeded
  const nowIso = new Date().toISOString();
  await supabase
    .from("refunds")
    .update({
      status: "succeeded",
      refunded_at: nowIso,
    })
    .eq("id", refundRow.id);

  // 5. Determine full vs partial
  const totalRefunded = charge.amount_refunded;
  const chargeAmount = charge.amount;
  const isFull = totalRefunded >= chargeAmount;

  // 6. Update payment_requests.status
  if (payment.payment_request_id) {
    await supabase
      .from("payment_requests")
      .update({ status: isFull ? "refunded" : "partially_refunded" })
      .eq("id", payment.payment_request_id);
  }

  // 7. Update payments.status on full refund; leave alone on partial
  if (isFull) {
    await supabase.from("payments").update({ status: "refunded" }).eq("id", payment.id);
  }

  // 8. Audit log
  if (payment.payment_request_id) {
    await writePaymentEvent(supabase, {
      paymentRequestId: payment.payment_request_id,
      eventType: isFull ? "refunded" : "partially_refunded",
      metadata: {
        refund_id: refundRow.id,
        stripe_refund_id: newestRefund.id,
        amount: refundRow.amount,
      },
    });
  }

  // 9. Build extras for emails
  const { data: pr } = payment.payment_request_id
    ? await supabase
        .from("payment_requests")
        .select("*")
        .eq("id", payment.payment_request_id)
        .maybeSingle<PaymentRequestRow>()
    : { data: null };
  const { data: jobMeta } = await supabase
    .from("jobs")
    .select("job_number")
    .eq("id", payment.job_id)
    .maybeSingle<{ job_number: string | null }>();

  // Resolve refunded_by_name for internal notification
  let refundedByName: string | null = null;
  if (refundRow.refunded_by) {
    const { data: userRow } = await supabase
      .from("user_profiles")
      .select("first_name, last_name")
      .eq("id", refundRow.refunded_by)
      .maybeSingle<{ first_name: string | null; last_name: string | null }>();
    refundedByName =
      [userRow?.first_name, userRow?.last_name].filter(Boolean).join(" ") ||
      null;
  } else {
    refundedByName = "Stripe Dashboard";
  }

  const extras = {
    refund_amount: refundRow.amount,
    refund_reason: refundRow.include_reason_in_customer_email
      ? refundRow.reason
      : "",
    refunded_at: nowIso,
    refunded_by_name: refundedByName,
    payer_name: pr?.payer_name ?? null,
    payer_email: pr?.payer_email ?? null,
    job_link: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/jobs/${payment.job_id}`,
  };

  // 10. Customer email (gated by notify_customer toggle)
  if (refundRow.notify_customer && payment.payment_request_id) {
    await sendRefundConfirmationEmail({
      paymentRequestId: payment.payment_request_id,
      extras,
    }).catch((e) =>
      console.error(`refund email: ${e instanceof Error ? e.message : e}`),
    );
  }

  // 11. Internal notification
  if (payment.payment_request_id) {
    await sendPaymentInternalNotification({
      paymentRequestId: payment.payment_request_id,
      kind: "refund_issued",
      extras: { ...extras, refund_reason: refundRow.reason }, // internal gets reason always
    }).catch((e) =>
      console.error(`internal refund email: ${e instanceof Error ? e.message : e}`),
    );
  }

  // 12. In-app notification
  await writeNotification({
    type: "refund_issued",
    title: `Refund issued: $${refundRow.amount.toFixed(2)} — job ${jobMeta?.job_number ?? "—"}`,
    body: `${refundedByName} refunded $${refundRow.amount.toFixed(2)} for ${pr?.title ?? ""}.`,
    href: `/jobs/${payment.job_id}`,
    metadata: {
      payment_id: payment.id,
      refund_id: refundRow.id,
      payment_request_id: payment.payment_request_id,
    },
  }).catch(() => undefined);

  // 13. QB refund push — best effort
  const token = await getValidToken();
  if (token) {
    await postRefundToQb(supabase, token, {
      refundId: refundRow.id,
      paymentId: payment.id,
      amount: refundRow.amount,
      paidDate: payment.received_date ?? nowIso.slice(0, 10),
      stripeRefundId: newestRefund.id,
      invoiceId: payment.invoice_id,
      jobId: payment.job_id,
    }).catch((e) =>
      console.error(`QB refund push: ${e instanceof Error ? e.message : e}`),
    );
  }

  return { paymentRequestId: payment.payment_request_id };
}
```

- [ ] **Step 3: Wire into dispatcher**

```typescript
import { handleChargeRefunded } from "@/lib/stripe/webhook/handlers/charge-refunded";

const HANDLERS: Record<string, Handler> = {
  // others …
  "charge.refunded": handleChargeRefunded,
};
```

- [ ] **Step 4: Verify tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stripe/webhook/handlers/charge-refunded.ts src/lib/qb/sync/refunds.ts src/lib/qb/client.ts src/app/api/stripe/webhook/route.ts
git commit -m "feat(17c): webhook handler — charge.refunded (reconcile, email, QB push)"
```

---

## Task 19: Handler — `charge.dispute.created` and `charge.dispute.closed`

**Files:**
- Create: `src/lib/stripe/webhook/handlers/charge-dispute.ts`
- Modify: `src/app/api/stripe/webhook/route.ts` (wire both event types)

**Context:** Minimal tracking — insert / update `stripe_disputes`, write audit event, send internal notification with "DISPUTE OPENED" subject prefix (per prompt Part 6's acceptable compromise — reuse `payment_failed_internal_*` template + subject override). No evidence submission workflow (deferred to Build 19).

- [ ] **Step 1: Write the handler**

Create `src/lib/stripe/webhook/handlers/charge-dispute.ts`:

```typescript
import type Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase-api";
import { writePaymentEvent } from "@/lib/payments/activity";
import { sendPaymentInternalNotification } from "@/lib/payment-emails";
import { writeNotification } from "@/lib/notifications/write";
import type { PaymentRow } from "@/lib/payments/types";

type DisputeStatus =
  | "warning_needs_response"
  | "warning_under_review"
  | "warning_closed"
  | "needs_response"
  | "under_review"
  | "won"
  | "lost";

function normalizeStatus(raw: string): DisputeStatus | null {
  const allowed: DisputeStatus[] = [
    "warning_needs_response",
    "warning_under_review",
    "warning_closed",
    "needs_response",
    "under_review",
    "won",
    "lost",
  ];
  return allowed.includes(raw as DisputeStatus) ? (raw as DisputeStatus) : null;
}

export async function handleChargeDisputeCreated(
  event: Stripe.Event,
): Promise<{ paymentRequestId: string | null }> {
  const dispute = event.data.object as Stripe.Dispute;
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;

  const supabase = createServiceClient();

  const { data: payment } = await supabase
    .from("payments")
    .select("id, job_id, payment_request_id")
    .eq("stripe_charge_id", chargeId)
    .maybeSingle<Pick<PaymentRow, "id" | "job_id" | "payment_request_id">>();

  const status = normalizeStatus(dispute.status);
  const dueBy = dispute.evidence_details?.due_by
    ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
    : null;

  const { error: upErr } = await supabase
    .from("stripe_disputes")
    .upsert(
      {
        payment_id: payment?.id ?? null,
        payment_request_id: payment?.payment_request_id ?? null,
        stripe_dispute_id: dispute.id,
        amount: dispute.amount / 100,
        reason: dispute.reason,
        status,
        evidence_due_by: dueBy,
        opened_at: new Date((dispute.created ?? Date.now() / 1000) * 1000).toISOString(),
      },
      { onConflict: "stripe_dispute_id" },
    );
  if (upErr) throw new Error(`stripe_disputes upsert: ${upErr.message}`);

  if (payment?.payment_request_id) {
    await writePaymentEvent(supabase, {
      paymentRequestId: payment.payment_request_id,
      eventType: "dispute_opened",
      metadata: {
        stripe_dispute_id: dispute.id,
        amount: dispute.amount / 100,
        reason: dispute.reason,
        status,
      },
    });

    const { data: jobMeta } = await supabase
      .from("jobs")
      .select("job_number")
      .eq("id", payment.job_id)
      .maybeSingle<{ job_number: string | null }>();

    await sendPaymentInternalNotification({
      paymentRequestId: payment.payment_request_id,
      kind: "dispute_opened",
      subjectPrefix: "DISPUTE OPENED — ",
      extras: {
        failure_reason: dispute.reason,
        job_link: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/jobs/${payment.job_id}`,
      },
    }).catch((e) =>
      console.error(`internal dispute email: ${e instanceof Error ? e.message : e}`),
    );

    await writeNotification({
      type: "dispute_opened",
      title: `Dispute opened: $${(dispute.amount / 100).toFixed(2)} — job ${jobMeta?.job_number ?? "—"}`,
      body: `Reason: ${dispute.reason}. Evidence due: ${dueBy ? new Date(dueBy).toLocaleDateString() : "—"}.`,
      href: `/jobs/${payment.job_id}`,
      priority: "high",
      metadata: { stripe_dispute_id: dispute.id },
    }).catch(() => undefined);
  }

  return { paymentRequestId: payment?.payment_request_id ?? null };
}

export async function handleChargeDisputeClosed(
  event: Stripe.Event,
): Promise<{ paymentRequestId: string | null }> {
  const dispute = event.data.object as Stripe.Dispute;
  const supabase = createServiceClient();

  const status = normalizeStatus(dispute.status);

  const { data: existing } = await supabase
    .from("stripe_disputes")
    .select("payment_request_id")
    .eq("stripe_dispute_id", dispute.id)
    .maybeSingle<{ payment_request_id: string | null }>();

  await supabase
    .from("stripe_disputes")
    .update({ status, closed_at: new Date().toISOString() })
    .eq("stripe_dispute_id", dispute.id);

  if (existing?.payment_request_id) {
    await writePaymentEvent(supabase, {
      paymentRequestId: existing.payment_request_id,
      eventType: "dispute_closed",
      metadata: {
        stripe_dispute_id: dispute.id,
        final_status: status,
      },
    });
  }

  return { paymentRequestId: existing?.payment_request_id ?? null };
}
```

- [ ] **Step 2: Wire into dispatcher**

```typescript
import {
  handleChargeDisputeCreated,
  handleChargeDisputeClosed,
} from "@/lib/stripe/webhook/handlers/charge-dispute";

const HANDLERS: Record<string, Handler> = {
  // others …
  "charge.dispute.created": handleChargeDisputeCreated,
  "charge.dispute.closed": handleChargeDisputeClosed,
};
```

- [ ] **Step 3: Verify tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/stripe/webhook/handlers/charge-dispute.ts src/app/api/stripe/webhook/route.ts
git commit -m "feat(17c): webhook handler — charge.dispute.created + .closed (minimal tracking)"
```

---

## Task 20: QuickBooks retry endpoint

**Files:**
- Create: `src/app/api/payments/[id]/retry-qb-sync/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/payments/[id]/retry-qb-sync/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth";
import { syncPaymentToQb } from "@/lib/qb/sync/stripe-payment-bridge";
import { createServiceClient } from "@/lib/supabase-api";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requirePermission(req, "record_payments");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const supabase = createServiceClient();

  // Mark pending before attempting, so the UI badge flips quickly.
  await supabase
    .from("payments")
    .update({
      quickbooks_sync_status: "pending",
      quickbooks_sync_attempted_at: new Date().toISOString(),
      quickbooks_sync_error: null,
    })
    .eq("id", id);

  try {
    await syncPaymentToQb(id);
    return NextResponse.json({ ok: true, status: "synced" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("payments")
      .update({
        quickbooks_sync_status: "failed",
        quickbooks_sync_error: msg,
        quickbooks_sync_attempted_at: new Date().toISOString(),
      })
      .eq("id", id);
    return NextResponse.json({ error: msg, status: "failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/payments/[id]/retry-qb-sync/route.ts
git commit -m "feat(17c): /api/payments/[id]/retry-qb-sync — manual QB retry endpoint"
```

---

## Task 21: Wire new template fields into `/settings/payments`

**Files:**
- Modify: `src/app/api/settings/payment-email/route.ts`
- Modify: `src/app/settings/payments/payments-settings-client.tsx` (or wherever the template editor lives)

**Context:** The six new template pairs need editors in the Settings → Payment Emails page. Follow the existing dirty-flag + Save pattern — do NOT auto-save.

- [ ] **Step 1: Extend the PATCH body allowlist in the API route**

Read `src/app/api/settings/payment-email/route.ts`. The PATCH handler likely has an allowlist of editable columns. Add the new columns (11 of them):

```typescript
const ALLOWED_KEYS = new Set([
  // … existing keys …
  "payment_receipt_subject_template",
  "payment_receipt_body_template",
  "refund_confirmation_subject_template",
  "refund_confirmation_body_template",
  "payment_received_internal_subject_template",
  "payment_received_internal_body_template",
  "payment_failed_internal_subject_template",
  "payment_failed_internal_body_template",
  "refund_issued_internal_subject_template",
  "refund_issued_internal_body_template",
  "internal_notification_to_email",
]);
```

Adjust the name `ALLOWED_KEYS` to match whatever the file currently uses (could be a literal array, could be named differently).

- [ ] **Step 2: Add template editors to the settings client**

In `src/app/settings/payments/payments-settings-client.tsx`, locate the existing section that renders the "Payment Request" / "Payment Reminder" template editors (likely uses a Tiptap component + a subject Input). Add three grouped sub-sections beneath:

1. **"Customer Receipt"** — subject + body template editors for `payment_receipt_subject_template` / `payment_receipt_body_template`.
2. **"Refund Confirmation (to customer)"** — `refund_confirmation_subject_template` / `refund_confirmation_body_template`.
3. **"Internal Notifications"** — with a single Input for `internal_notification_to_email` (placeholder "leave blank to use send-from address"), followed by three pairs:
   - "Payment Received" → `payment_received_internal_*`
   - "Payment Failed" → `payment_failed_internal_*`
   - "Refund Issued" → `refund_issued_internal_*`

Reuse the existing Tiptap component (from Build 15 — do not create a new one per DO-NOT section Part 13). Reuse the existing subject Input component. Wire each editor to the dirty-flag state and the shared Save button. Preserve the merge-field picker sidebar — it now lists the new fields automatically because Task 7 extended `PAYMENT_MERGE_FIELDS`.

Concretely: if the existing client has shape like

```typescript
const [form, setForm] = useState<PaymentEmailSettings>(initial);
const setField = <K extends keyof PaymentEmailSettings>(k: K, v: PaymentEmailSettings[K]) => {
  setForm((f) => ({ ...f, [k]: v }));
  setDirty(true);
};
```

then each new editor just uses `setField('payment_receipt_subject_template', v)` etc.

- [ ] **Step 3: Preview-verify**

Navigate to `/settings/payments`. Confirm:
- Three new sections render below the existing two.
- Editing any field turns the Save button active.
- Clicking Save posts the updated values; refreshing the page shows them persisted.
- The merge-field sidebar lists the new fields (paid_at, payer_name, etc.).

- [ ] **Step 4: Verify tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/payment-email/route.ts src/app/settings/payments/payments-settings-client.tsx
git commit -m "feat(17c): /settings/payments — receipt/refund/internal template editors"
```

---

## Task 22: Billing section UI — method icon, QB badge, refund/receipt/retry actions

**Files:**
- Create: `src/components/payments/qb-sync-badge.tsx`
- Modify: `src/components/payments/online-payment-requests-subsection.tsx`

**Context:** The existing `STATUS_STYLES` map already covers all 17c statuses. The row content is the gap: we need a method icon (card vs. bank), QB sync pill, and three new actions on paid rows (View Receipt, Refund, Retry QB).

- [ ] **Step 1: Write the QB sync badge**

Create `src/components/payments/qb-sync-badge.tsx`:

```typescript
"use client";

import { Badge } from "@/components/ui/badge";
import { Check, X, Loader2 } from "lucide-react";

export type QbSyncStatus =
  | "pending"
  | "synced"
  | "failed"
  | "not_applicable"
  | null;

export function QbSyncBadge({ status }: { status: QbSyncStatus }) {
  if (status === null || status === "not_applicable") return null;
  if (status === "synced")
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
        <Check className="h-3 w-3 mr-1" />
        Synced to QB
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30">
        <X className="h-3 w-3 mr-1" />
        QB sync failed
      </Badge>
    );
  if (status === "pending")
    return (
      <Badge className="bg-muted text-muted-foreground">
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        Syncing to QB…
      </Badge>
    );
  return null;
}
```

- [ ] **Step 2: Extend the subsection row query to fetch new fields**

In `src/components/payments/online-payment-requests-subsection.tsx`, extend the `PaymentRequestRow` interface (the local one):

```typescript
interface PaymentRequestRow {
  id: string;
  title: string;
  amount: number;
  status: string;
  request_type: string;
  created_at: string;
  link_expires_at: string | null;
  link_token: string | null;
  paid_at: string | null;
  payer_name: string | null;
  payment_method_type: "card" | "us_bank_account" | null;
  receipt_pdf_path: string | null;
  quickbooks_sync_status: "pending" | "synced" | "failed" | "not_applicable" | null;
}
```

Verify the API route `/api/payment-requests` returns these fields. If it projects only a subset, extend the SELECT. Fast check:

```bash
grep -n "select(" src/app/api/payment-requests/route.ts
```

Adjust the projection if needed.

- [ ] **Step 3: Render the new action set on paid rows**

Replace the status-gated action block in `online-payment-requests-subsection.tsx`. Where the current file does:

```typescript
{(r.status === "sent" || r.status === "viewed") && (
  <>
    <Button … >Copy link</Button>
    <Button … >View as customer</Button>
    <Button … >Void</Button>
  </>
)}
```

Add a new branch for paid / partially_refunded:

```typescript
{(r.status === "paid" || r.status === "partially_refunded") && (
  <>
    <QbSyncBadge status={r.quickbooks_sync_status} />
    <Button
      variant="outline"
      size="sm"
      onClick={() => void onViewReceipt(r.id)}
    >
      View receipt
    </Button>
    {r.quickbooks_sync_status === "failed" && (
      <Button
        variant="outline"
        size="sm"
        onClick={() => void onRetryQb(r.id)}
      >
        Retry QB sync
      </Button>
    )}
    <Button
      variant="destructive"
      size="sm"
      onClick={() => void onOpenRefund(r)}
    >
      Refund
    </Button>
  </>
)}
```

Where the handlers are:

```typescript
const onViewReceipt = async (id: string) => {
  // Open the PDF in a new tab via a signed URL
  const res = await fetch(`/api/payment-requests/${id}/receipt-url`);
  if (!res.ok) {
    toast.error("Receipt PDF not available yet — it generates after Stripe confirms the payment.");
    return;
  }
  const { url } = (await res.json()) as { url: string };
  window.open(url, "_blank", "noopener,noreferrer");
};

const onRetryQb = async (id: string) => {
  const res = await fetch(`/api/payments/${id}/retry-qb-sync`, { method: "POST" });
  if (!res.ok) {
    const { error } = (await res.json()) as { error?: string };
    toast.error(error ?? "Retry failed");
    return;
  }
  toast.success("Synced to QuickBooks");
  await refresh();
};

const [refundTarget, setRefundTarget] = useState<PaymentRequestRow | null>(null);
const [refundRemaining, setRefundRemaining] = useState(0);

const onOpenRefund = async (r: PaymentRequestRow) => {
  // Compute remaining refundable via a lightweight endpoint
  const res = await fetch(`/api/payment-requests/${r.id}/refundable`);
  if (!res.ok) {
    toast.error("Cannot refund this payment.");
    return;
  }
  const { remaining } = (await res.json()) as { remaining: number };
  setRefundRemaining(remaining);
  setRefundTarget(r);
};
```

Note: `onViewReceipt` hits a new helper route `/api/payment-requests/[id]/receipt-url` that returns a signed storage URL for `receipt_pdf_path`. And `onOpenRefund` hits `/api/payment-requests/[id]/refundable` that computes `amount − sum(refunds)`. Add both as sub-steps.

- [ ] **Step 4: Add the two helper routes**

Create `src/app/api/payment-requests/[id]/receipt-url/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAuth(req);
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const supabase = createServiceClient();
  const { data: pr } = await supabase
    .from("payment_requests")
    .select("receipt_pdf_path")
    .eq("id", id)
    .maybeSingle<{ receipt_pdf_path: string | null }>();
  if (!pr?.receipt_pdf_path) {
    return NextResponse.json({ error: "no receipt PDF" }, { status: 404 });
  }
  const { data, error } = await supabase.storage
    .from("receipts")
    .createSignedUrl(pr.receipt_pdf_path, 300);
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "signed URL failed" }, { status: 500 });
  }
  return NextResponse.json({ url: data.signedUrl });
}
```

Create `src/app/api/payment-requests/[id]/refundable/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase-api";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAuth(req);
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const supabase = createServiceClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("id, amount")
    .eq("payment_request_id", id)
    .eq("source", "stripe")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; amount: number }>();
  if (!payment) {
    return NextResponse.json({ error: "no Stripe payment" }, { status: 404 });
  }
  const { data: refunds } = await supabase
    .from("refunds")
    .select("amount, status")
    .eq("payment_id", payment.id)
    .in("status", ["pending", "succeeded"]);
  const refundedSum = (refunds ?? []).reduce(
    (s: number, r: { amount: number }) => s + Number(r.amount),
    0,
  );
  const remaining = Number(payment.amount) - refundedSum;
  return NextResponse.json({ remaining });
}
```

- [ ] **Step 5: Also ensure the receipt PDF gets saved to storage when the webhook generates it**

In `src/lib/payment-emails.ts` → `sendPaymentReceiptEmail`, after the PDF is generated, save it to Supabase Storage and update `payment_requests.receipt_pdf_path`:

```typescript
  // After: const pdf = await generateReceiptPdf(...)
  const storagePath = `${pr.job_id}/${pr.id}.pdf`;
  try {
    await supabase.storage.from("receipts").upload(storagePath, pdf, {
      contentType: "application/pdf",
      upsert: true,
    });
    await supabase
      .from("payment_requests")
      .update({ receipt_pdf_path: storagePath })
      .eq("id", pr.id);
  } catch (e) {
    console.warn(`receipt PDF storage upload failed: ${e instanceof Error ? e.message : e}`);
  }
```

Add this block inside the existing `try { ... } catch { ... }` around PDF generation so a storage failure also doesn't break the email send.

**Storage bucket requirement:** The `receipts` bucket must exist. Add a check to the migration or flag as a manual step. Quick sub-step:

- Navigate to Supabase Storage console, create a private bucket named `receipts`. RLS: service-role only. Document this in the final verification checklist.

- [ ] **Step 6: Mount the refund modal in the subsection**

At the bottom of the subsection JSX:

```typescript
{refundTarget && (
  <RefundModal
    open={Boolean(refundTarget)}
    onOpenChange={(v) => { if (!v) setRefundTarget(null); }}
    paymentRequestId={refundTarget.id}
    paymentRequestTitle={refundTarget.title}
    remainingRefundable={refundRemaining}
    onRefunded={async () => { setRefundTarget(null); await refresh(); }}
  />
)}
```

Add the import at the top:
```typescript
import { RefundModal } from "./refund-modal";
import { QbSyncBadge } from "./qb-sync-badge";
```

- [ ] **Step 7: Preview-verify**

Navigate to a job with a paid payment request (use a test payment from Task 23 verification). Confirm:
- Row shows method icon or payment method display.
- QB sync badge renders the correct state.
- "View receipt" opens the PDF in a new tab.
- "Refund" opens the modal; submitting creates a refund row.
- "Retry QB sync" (when visible) triggers the retry.

- [ ] **Step 8: Verify tsc + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errors; build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/components/payments/online-payment-requests-subsection.tsx src/components/payments/qb-sync-badge.tsx src/app/api/payment-requests/[id]/receipt-url/ src/app/api/payment-requests/[id]/refundable/ src/lib/payment-emails.ts
git commit -m "feat(17c): Billing UI — QB sync badge, view receipt, refund, retry QB; receipt PDF storage"
```

---

## Task 23: End-to-end verification (the prompt's 20-point checklist)

This task is the Part 14 checklist from the prompt. All previous tasks must be complete and committed. Perform these against a running dev server with Stripe CLI forwarding webhooks to `localhost:3000/api/stripe/webhook`, OR against a Vercel staging deploy with the webhook endpoint registered in Stripe test mode.

**Setup:**

```bash
# In one terminal (assumes stripe CLI is installed and logged in):
stripe listen --forward-to localhost:3000/api/stripe/webhook
# Copy the whsec_... from the CLI output and paste into /settings/stripe → Webhook Configuration.

# In another terminal:
npm run dev
```

Also ensure these `qb_mappings` rows exist (manually via SQL editor if the settings UI doesn't expose them yet):
- `type='payment_method', platform_value='stripe_card', qb_entity_id=<Stripe card bank account>`
- `type='payment_method', platform_value='stripe_ach', qb_entity_id=<Stripe bank account>`
- `type='stripe_fee_account', platform_value='stripe_processing_fees', qb_entity_id=<Payment Processing Fees expense account>`
- `type='generic_income_account', platform_value='stripe_deposits', qb_entity_id=<Deposits income account>` (only needed for standalone deposits without an invoice)

And a Supabase Storage bucket `receipts` must exist (create via Supabase dashboard → Storage → New bucket → private).

### Webhook setup and signature verification

- [ ] **1. Fresh `npm run build` passes with no type errors.**

Run: `npm run build`
Expected: successful build, no errors.

- [ ] **2. build41 migration applied cleanly.**

Run the verification SQL from Task 2 Step 2. All widened CHECKs, new columns, seeded templates, and tables present.

- [ ] **3. `/settings/stripe` shows the new webhook configuration section.**

Navigate to `/settings/stripe`. Paste a webhook secret (use the whsec_ from `stripe listen`). Save. Badge flips from "No webhook configured" → "Configured — no events received yet" (amber).

- [ ] **4. Test event from Stripe CLI is received and verified.**

Run: `stripe trigger payment_intent.succeeded`
Inspect `stripe_events` table: one row added, `processed_at` is set.

Bad signature test: post to the webhook URL with `curl` and a bogus signature:
```bash
curl -X POST http://localhost:3000/api/stripe/webhook \
  -H "stripe-signature: t=1,v1=bogus" \
  -H "Content-Type: application/json" \
  -d '{}'
```
Expected: `400` response with `Stripe webhook signature verification failed` in the body.

- [ ] **5. Duplicate event delivery is processed only once.**

From the Stripe Dashboard → Developers → Events, select a recent event and click "Resend". Inspect `stripe_events` — should still be only one row for that `stripe_event_id`. No duplicate `payments` row. The webhook returns 200 with `duplicate: true`.

### End-to-end happy paths

- [ ] **6. ACH payment happy path.**

Create a payment request from an invoice. Open `/pay/<token>` in incognito. Complete a test ACH payment using Stripe's test bank (e.g., routing `110000000`, account `000123456789`). Within seconds:
- `payment_requests.status = 'paid'`
- `payments` row exists with `source='stripe'`, `method='stripe_ach'`, matching amount
- `receipts/<job_id>/<payment_request_id>.pdf` exists in Supabase Storage
- Receipt email arrives at the payer address with PDF attached
- Internal notification email arrives at `internal_notification_to_email` (or `send_from_email` if blank)
- Notification bell shows the event

- [ ] **7. Card payment happy path.**

Same as (6) with test card `4242 4242 4242 4242`. Confirm `method='stripe_card'`, card icon renders in Billing section.

- [ ] **8. QuickBooks sync after payment.**

Inspect the `payments` row from (6) or (7): `quickbooks_sync_status='synced'`, `qb_payment_id` is populated. In QuickBooks, confirm:
- A Payment entry was created linked to the invoice (or deposited to income if standalone).
- A Purchase / expense entry was created for the Stripe processing fee against the "Payment Processing Fees" account.
- "Synced to QB" badge shows in the Billing UI.

### Failure paths

- [ ] **9. Declined card triggers `payment_intent.payment_failed`.**

Test card `4000 0000 0000 0002` (decline). Confirm:
- `payment_requests.status = 'failed'`
- Internal notification email arrives with failure reason
- In-app notification fires
- NO customer email from us (Stripe sends its own)

- [ ] **10. QuickBooks disconnected → sync fails gracefully.**

Disconnect QB (Settings → QuickBooks → Disconnect). Make a test payment. Confirm:
- `payments.quickbooks_sync_status = 'not_applicable'` (because `getValidToken` returned null)
- OR if a residual token still works, eventually `quickbooks_sync_status = 'failed'`
- "Retry QuickBooks sync" action appears in UI
- Reconnect QB, click Retry — sync succeeds.

### Refund paths

- [ ] **11. Partial refund via our UI.**

On a paid payment, open the Billing row → Refund. Pick Partial, enter $10, add a reason, check "Include reason in customer email". Submit. Confirm:
- `refunds` row inserted with `status='pending'`
- Stripe CLI shows `charge.refunded` event delivered
- `refunds.status` flips to `succeeded`
- `payment_requests.status = 'partially_refunded'`
- Customer receives refund email with reason inline
- Internal notification fires
- QB sync posts the refund (RefundReceipt)

- [ ] **12. Full refund works and removes refund action.**

On a different paid payment, click Refund → Full. Submit. Confirm:
- Row flips to `refunded` (gray + strikethrough)
- Refund action no longer available
- Customer email fires (without reason if not checked)

- [ ] **13. Dashboard-initiated refund is captured.**

In Stripe Dashboard → Payments, find a completed test charge, click Refund. Wait for webhook. Confirm:
- `refunds` row auto-created with `refunded_by = null`, `reason = 'Initiated from Stripe dashboard'`
- Reconciliation proceeds normally (status flip, email, QB sync)

### Dispute paths

- [ ] **14. Dispute opened is captured and flagged.**

Run: `stripe trigger charge.dispute.created`
Confirm:
- `stripe_disputes` row inserted
- Internal notification email arrives with "DISPUTE OPENED — " subject prefix
- In-app notification has `priority='high'`

- [ ] **15. Dispute closed updates status.**

Run: `stripe trigger charge.dispute.closed`
Confirm `stripe_disputes.status` updated and `closed_at` set.

### Cross-flow verification

- [ ] **16. `/sign/<token>` flow (17b carryover).**

Create a contract, send signing request, open `/sign/<token>` in incognito, complete signing. Confirm still works end-to-end (verifies 17b's middleware fix holds with 17c's changes).

- [ ] **17. Amount mismatch is logged but not blocking.**

Manually create a test payment where `pr.total_charged` differs from the actual Stripe amount_received (e.g., adjust `total_charged` via SQL before paying). Confirm webhook logs a discrepancy in `stripe_events.payload` and `contract_events.metadata.amount_mismatch` but still marks paid.

### Regression checks

- [ ] **18. Manual `+ Record Payment` still works.**

On a job, click `+ Record Payment` (non-Stripe path), record a check. Confirm the row appears in Billing and co-exists cleanly with Stripe payments. No regressions in the existing manual-payment flow.

- [ ] **19. Dark mode renders correctly across all new UI.**

Toggle dark theme. Navigate to `/settings/stripe`, `/settings/payments`, a job's Billing section with paid/refunded rows, and the notification bell. All elements render correctly — no light-theme bleed.

- [ ] **20. Existing Build 15 contract flow works.**

Send a signing request, sign via `/sign/<token>`, confirm the signed PDF is generated and emailed. Unaffected by 17c changes.

### Completion commit

- [ ] **Final commit with verification report**

When all 20 pass, commit the empty verification-complete marker:

```bash
git commit --allow-empty -m "test(17c): all 20 verification checkpoints pass — build 17c complete"
```

Report to the user:
1. Whether the 17b Checkout Session creation needed modification for receipt suppression (yes — Task 10 added `payment_intent_data.receipt_email: null`).
2. Any `stripe_checkout_session_id`-as-correlation-key anti-patterns found and corrected (none found — all handlers use `payment_intent.metadata.payment_request_id` per the briefing's guidance).
3. Notification integration outcome: Option A chosen / Option B deferred (whichever was picked in Task 1).
4. Full list of merge fields available to payment email templates after Task 7.

---

## Notes on scope and deviations from spec

1. **Notifications infrastructure added as a minimal stub (Option A).** The prompt flagged that Build 14g may not exist and asked to surface this. Default choice was Option A — includes a `notifications` table, a write helper, GET/PATCH API, and a header bell. If the user chose Option B, Task 14 was dropped and the `writeNotification` stub created in Task 13 stays as a no-op.
2. **Migration widens `payments` CHECKs beyond what prompt Part 4 specified.** Prompt only mentioned `method`. In practice, `source='stripe'` and `status='refunded'` are also needed. Widened all three in Task 2.
3. **QB column naming follows existing `qb_payment_id` convention.** Prompt uses `quickbooks_entity_id` in places; plan uses `qb_payment_id` to match the current QB-sync code.
4. **`syncPayment()` extended in place rather than wrapped.** An earlier draft considered wrapping in a bridge, but the cleanest change is extending the no-invoice branch directly. The bridge (`stripe-payment-bridge.ts`) remains as the webhook's call site but composes `syncPayment` + `postStripeFee` rather than duplicating.
5. **Dispute handler reuses the `payment_failed_internal_*` template with a subject prefix.** Prompt Part 6 explicitly allows this compromise to avoid a seventh template pair. Documented inline.
6. **Stripe default receipt suppressed via `payment_intent_data.receipt_email: null`.** Cleaner than relying on Dashboard settings. Requires a one-line edit to the 17b checkout route (Task 10); flagged in the final report.
7. **QB refund posts via RefundReceipt.** Alternative pattern is a negative payment; RefundReceipt is the idiomatic QBO entity for this case and keeps the books tidy.
8. **Vercel Hobby cron constraint respected.** No scheduled work added in 17c — QB retry is a manual user-initiated action. Reminder scheduler stays 17d scope.
9. **Stripe SDK `apiVersion` pin.** Copied from `src/lib/stripe.ts`; update in `src/lib/stripe/webhook/verify.ts` if the main client pin changes.

---

## Self-review summary

**Spec-section → task mapping:**

- Prompt Part 0 (Read First) → Preflight + conflicts section.
- Prompt Part 1 (Resolved Decisions) → All five decisions honored in handler design (Tasks 12, 13, 18, 19; receipt PDF Task 8; CHECK widening Task 2).
- Prompt Part 2 (Mission & Context) → Tasks 3–20 cover every feature surface.
- Prompt Part 3 (Reuse) → Tasks 7 (merge fields extend), 9 (email orchestrators extend), 15 (QB sync extend) all reuse rather than rebuild.
- Prompt Part 4 (Migration) → Task 2.
- Prompt Part 5 (Webhook secret UI) → Task 11.
- Prompt Part 6 (Webhook handler) → Tasks 3, 4, 5, 12, 13, 16, 18, 19.
- Prompt Part 7 (Merge fields) → Task 7.
- Prompt Part 8 (Branded receipt PDF) → Task 8.
- Prompt Part 9 (In-app notifications) → Task 14 (Option A) or skipped (Option B).
- Prompt Part 10 (QuickBooks auto-sync) → Tasks 13 (webhook side), 15 (bridge + fees), 20 (retry).
- Prompt Part 11 (Refund UX) → Task 17.
- Prompt Part 12 (Billing UI updates) → Task 22.
- Prompt Part 13 (DO NOT CHANGE) → Enforced via file-touch list + commit discipline. The one exception (17b checkout route edit) is flagged in Task 10 and in the completion report.
- Prompt Part 14 (Verification checklist) → Task 23 enumerates all 20.

**Placeholder scan:** No `TODO`, `TBD`, "implement later", or "similar to Task N" placeholders remain. Every code block is intended to compile.

**Type consistency:** Names cross-verified:
- `PaymentRow`, `RefundRow`, `StripeDisputeRow`, `NotificationRow` (Task 6) → used in Tasks 13, 17, 18, 19.
- `PaymentMergeExtras` (Task 7) → used in Tasks 9, 13, 16, 18, 19.
- `writeNotification` stub (Task 13) → replaced in Task 14, consumed from Tasks 13, 16, 18, 19, 20.
- `syncPaymentToQb` stub (Task 13) → replaced in Task 15, consumed from Tasks 13, 20.
- `qb_payment_id` column name consistent throughout (not `quickbooks_entity_id`).
- `quickbooks_sync_status` enum `pending|synced|failed|not_applicable` consistent in all call sites.

**Known compile-time fragility:** Stripe SDK types for `payment_method_details.us_bank_account.bank_name` vary by version. Task 13 Step 5 includes a fallback cast if needed. Flagged inline.

**Known runtime gaps (documented, not fixed in 17c):**
- Storage bucket `receipts` must be created manually in Supabase (flagged in Task 23 setup).
- `qb_mappings` rows for `stripe_fee_account`, `generic_income_account`, and optionally `refund_item` must be seeded manually (flagged in Task 23 setup). A future build could add a UI for these.

---

## Execution notes

- **Every task ends in a commit.** Preserve granularity so `git log` tells a readable story and rollback is straightforward.
- **Every task verifies tsc.** This is the project's only automated check — keep it clean at every step.
- **Preview verification for UI tasks.** Use `preview_*` tools per the project's workflow — no manual "please check" asks to the user.
- **When Stripe CLI tests fail locally,** the webhook secret in `stripe_connection.webhook_signing_secret_encrypted` must match `stripe listen`'s whsec. Re-paste it in `/settings/stripe` if it changes (the CLI rotates per session).

