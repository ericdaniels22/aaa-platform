# Build 16d — Invoice & Payment Sync (+ minimal invoice UI)

**Status:** Design approved 2026-04-19. Implementation to follow via writing-plans skill.
**Migration number:** `build38-invoice-payment-sync`.
**Source of truth for spec:** This document plus the user's chat brief. The user referenced v1.5; only `v1_6.docx` exists on disk. v1.6 Section 7 (SaaS Readiness) still applies.
**Depends on:** 16a (expenses), 16b (accounting dashboard), 16c (QB OAuth + customer/sub-customer sync infrastructure).

## Goal

Close out the Accounting stack by shipping:

1. The minimal invoice data model + creation/edit/send UI (Build 6 never delivered the UI — only the bare `invoices` row).
2. Status-gated QB invoice sync (draft → sent transition is the only sync trigger).
3. Immediate QB payment sync on recording.
4. Hardened scheduler — retry/backoff, idempotency, concurrency guard, manual retry & override, per-entity filtering on the sync tab.
5. Stripe webhook stub so Build 17 has a slot to land in without reshaping 16d.

## Out of scope (explicit)

- Expense sync. Ever. Not in this build, not in any future build per the spec.
- Draft invoice sync — drafts stay platform-only.
- Stripe payment flow beyond signature verification and event logging — Build 17 fills in the body.
- Sub-daily cron — Hobby plan cap. Daily cron + manual **Sync now** covers operational needs.
- Xactimate estimate import, estimate carryover into invoices, recurring invoices, invoice templates, custom branding.
- Sales-tax presets, tax codes, tax rates on individual line items, tax jurisdictions — invoices carry a single adjustable rate.
- `organization_id` on `qb_connection` (v1.6 Phase 5).
- Modifications to Build 15 (contracts) or Build 16a (expenses) internals; only clean hook points.

## Database changes — `supabase/migration-build38-invoice-payment-sync.sql`

### Extend `invoices`

- `qb_invoice_id text` nullable — QB Invoice entity id once synced.
- `sent_at timestamptz` nullable — set when status transitions to `'sent'`.
- `voided_at timestamptz` nullable.
- `voided_by uuid references user_profiles(id)` nullable.
- `due_date timestamptz` nullable. UI defaults to `issued_date + 30 days`, editable.
- `subtotal numeric(10,2) not null default 0`.
- `tax_rate numeric(6,4) not null default 0` — stored as decimal (e.g. `0.0875` = 8.75%). UI accepts a percent, converts on save.
- `tax_amount numeric(10,2) not null default 0` — `round(subtotal * tax_rate, 2)` on every write; the column exists so historical invoices stay stable if rates change.
- `po_number text` nullable.
- `memo text` nullable (distinct from internal `notes`).
- Extend `status` CHECK to include `'voided'`. Allowed set: `{draft, sent, partial, paid, voided}`.

### New `invoice_line_items`

```sql
create table invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  sort_order integer not null default 0,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(10,2) not null default 0,
  amount numeric(10,2) not null default 0,
  xactimate_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on invoice_line_items (invoice_id, sort_order);
```

Amount is stored (not computed) so historical line items don't drift if rounding rules change. Route handlers enforce `amount = round(quantity * unit_price, 2)` on write.

### Extend `payments`

- `qb_payment_id text` nullable.
- `stripe_payment_intent_id text` nullable — Build 17 populates.

### Invoice status auto-transition trigger

No existing trigger transitions `invoices.status` based on payments. Add in this migration, mirroring the Build 16b `payments_update_payer_type` pattern:

- PL/pgSQL function `recompute_invoice_status(p_invoice_id uuid)`:
  - Load invoice + sum of `payments.amount` where `status = 'received'` and `invoice_id = p_invoice_id`.
  - If current status ∈ `{voided}` → no change.
  - If current status = `draft` → no change (payments shouldn't exist on drafts; guard in route handler, not here).
  - If `collected >= total` → `paid`.
  - If `0 < collected < total` → `partial`.
  - Else (`collected = 0`) → `sent` (if previously `partial`/`paid`, this path is a reversal — rare, happens when a payment is deleted).
- Trigger `payments_update_invoice_status AFTER INSERT OR UPDATE OR DELETE ON payments`: call `recompute_invoice_status` for the affected invoice(s). On UPDATE, recompute both old and new `invoice_id` when the row moved between invoices.

**QB side consideration:** when invoice status flips from `sent` → `partial`/`paid` as a side effect of payment sync, we do **not** enqueue an invoice UPDATE to QB. QB automatically reflects paid status based on the linked Payment transaction — double-syncing would be redundant and risk payload conflicts.

### Extend `qb_sync_log`

- Extend `action` CHECK to add `'void'`. Allowed set: `{create, update, delete, void}`.
- Extend `status` CHECK to add `'processing'` if we go the claim-status route (see §Concurrency). If we go the advisory-lock route (recommended), no status change.
- Add index `(status, next_retry_at)` to speed the processor's candidate query.

### Scheduler concurrency — advisory lock

Instead of the spec's `FOR UPDATE SKIP LOCKED` pattern (which requires a transient processing status and doesn't survive across the supabase-js request boundary), wrap the entire `processQueue` run in a Postgres advisory lock keyed on a fixed integer (e.g. `pg_try_advisory_lock(4216042)`). If the lock is held, the caller returns `{ ok: true, skipped: "already_running" }`. Rationale: daily cron + occasional manual button means at most two scheduler invocations can collide — advisory lock is simpler, has the same safety property, and keeps the state machine flat.

An RPC `try_acquire_sync_lock()` + `release_sync_lock()` wraps `pg_try_advisory_lock` / `pg_advisory_unlock`.

### Token-refresh serialization

Wrap the refresh path in `pg_try_advisory_lock(4216043)` (different key). Loser re-reads the connection row after a short sleep and reuses the newly-refreshed access token. Prevents double-refresh when two workers hit `getValidAccessToken` simultaneously.

## Sync layer

### Enqueue helper — `src/lib/qb/sync/enqueue.ts`

Single entry point used by every platform mutation that should trigger a QB sync. Responsibilities:

1. **Dedupe** — before insert, look up `qb_sync_log` where `entity_type, entity_id, status IN ('queued')` exists. If found, patch that row's `action`/`payload_hint` rather than insert a new one. Collapses rapid edit storms into one sync.
2. **Void/create coalescing** — if enqueuing a `void` for an entity that already has a `queued create` row (invoice sent then voided before scheduler runs), delete the queued create row entirely. QB never sees the invoice; we just mark both logs synced with a `coalesced` note.
3. **Dependency linking** — on invoice enqueue, check that the job has `qb_subcustomer_id` and the contact has `qb_customer_id`. Missing? Enqueue those first and set `depends_on_log_id` on the invoice row. On payment enqueue, check the parent invoice has `qb_invoice_id` the same way.
4. **sync_start_date gate (per spec clarification)** — enqueue unconditionally; `syncInvoice`/`syncPayment` short-circuit when `record.created_at < qb_connection.sync_start_date`, logging status `synced` with a `pre_sync_start_date` note. This keeps the queue truthful about what was decided.

All route handlers call `enqueueSync({ entityType, entityId, action })` inside a try/catch; a queue failure logs an application error but does **not** block the underlying mutation. Better to lose a sync than lose a payment record.

### Processor — modify `src/lib/qb/sync/processor.ts`

- Acquire advisory lock at entry. Release on exit.
- Keep existing candidate fetch (extend order to include the new entity types: `customer` → `sub_customer` → `invoice` → `payment`).
- Extend the dispatch switch to route `invoice` + `payment` entity types to `syncInvoice`, `voidInvoice`, `syncPayment`, `updatePayment`, `deletePayment`.
- Replace backoff table:
  ```ts
  const BACKOFF_MINUTES = [5, 25, 120, 600, 1440]; // 5m, 25m, 2h, 10h, 1d
  ```
- Detect HTTP 429 rate-limit errors by error code (`code === "ThrottleExceeded"` or HTTP 429 signature) and override backoff to 5 min regardless of retry count — keeps normal errors on the long schedule but doesn't stall on throttles.
- On `AuthenticationFailure` (Intuit's 401), abort remaining batch (already implemented) and surface Reconnect banner.

### Invoice sync — `src/lib/qb/sync/invoices.ts`

`syncInvoice(supabase, token, mode, invoiceId, action)`:

1. Load invoice + line items + job + contact (one round trip via joined select).
2. Load damage-type → class mapping (`qb_mappings` where type = `'damage_type'`) matching `job.damage_type`. Missing → throw with code `"class_not_mapped"` so the Fix modal can route.
3. Build payload:
   - `CustomerRef = { value: job.qb_subcustomer_id }`
   - `Line[]` from `invoice_line_items` (map to `{ DetailType: "SalesItemLineDetail", Amount, Description: xactimate_code ? `[${code}] ${description}` : description, SalesItemLineDetail: { ... } }`)
   - `ClassRef` from damage-type mapping
   - `TxnDate` = `invoice.issued_date`
   - `DueDate` = `invoice.due_date` (if present)
   - `DocNumber` = `invoice.invoice_number`
   - `PrivateNote` = `Job ${job.job_number}`
   - `TxnTaxDetail.TotalTax = invoice.tax_amount` when > 0. Note: US QB accepts pre-calculated `TotalTax` at the invoice level without a jurisdiction-specific tax code. Non-US regions will need tax code mapping; documented as a known limitation.
4. Dry-run: return payload with status `'skipped_dry_run'`. No QB call.
5. Live — action routing:
   - `create` + no `qb_invoice_id` → `createInvoice(token, payload)` → write `qb_invoice_id` back to `invoices`.
   - `update` + has `qb_invoice_id` → `getInvoice(qbId)` for SyncToken → `updateInvoice(token, {...payload, Id, SyncToken})`.
   - `update` + no `qb_invoice_id` → fall through to create (shouldn't happen; guard).
   - `create` + has `qb_invoice_id` → no-op `synced`.

`voidInvoice(supabase, token, mode, invoiceId)`:

1. Load invoice. If no `qb_invoice_id`, return `{ status: 'synced', note: 'never_synced' }` — the enqueue coalescer usually catches this first.
2. Dry-run: return `skipped_dry_run`.
3. Live: `getInvoice(qbId)` for SyncToken → POST `/invoice?operation=void` with `{ Id, SyncToken }` → log synced. QB preserves the voided invoice (amount zero, status Voided) — matches the platform "preserved for audit" semantics.

### Payment sync — `src/lib/qb/sync/payments.ts`

`syncPayment(supabase, token, mode, paymentId, action)`:

1. Load payment + invoice + job + contact.
2. Resolve customer/sub-customer refs from job.
3. Map `payments.method` → deposit account via `qb_mappings` (type `'payment_method'`). Missing → throw with code `"deposit_account_not_mapped"`.
4. Build payload:
   - `CustomerRef = { value: job.qb_subcustomer_id }`
   - `TotalAmt = payment.amount`
   - `PaymentMethodRef` — optional; derive from `payments.method` if a PaymentMethod mapping exists, otherwise omit.
   - `DepositToAccountRef = { value: mapping.qb_entity_id }`
   - `Line = [{ Amount: payment.amount, LinkedTxn: [{ TxnId: invoice.qb_invoice_id, TxnType: "Invoice" }] }]`
   - `TxnDate = payment.received_date`
   - `PrivateNote = payment.reference_number || payment.notes`
5. Create/update routing mirrors invoice: `create` writes `qb_payment_id` back; `update` fetches SyncToken first.

`deletePayment(supabase, token, mode, paymentId, snapshot)`:

Payment is deleted platform-side before this runs, so we pass a `snapshot` of the payment row (captured before the DELETE) via the `payload` column on the log. If `qb_payment_id` absent, no-op. Else hard-delete via QB's Payment endpoint. **Document in a code comment: payments are hard-deleted on QB side (not voided) because a mis-entered payment is a data error, not an auditable transaction — QB best practice.**

`updatePayment`: standard SyncToken fetch + update payload.

## API routes

### Invoice routes

- `POST /api/invoices` — create draft. Body: `{ jobId, issuedDate, dueDate?, lineItems[], taxRate, poNumber?, memo?, notes? }`. Inserts invoice + line items in a single RPC (for atomicity).
- `GET /api/invoices?jobId=&status=&limit=&offset=` — list with filters.
- `GET /api/invoices/[id]` — detail with line items joined.
- `PATCH /api/invoices/[id]` — edit. Guards:
  - Draft: all fields editable.
  - Sent/partial/paid: cosmetic fields only unless `{ confirmLineItemEdit: true }` passed. If so, enqueue `update` sync.
  - Voided: reject.
- `POST /api/invoices/[id]/send` — transitions draft → sent, sets `sent_at`, enqueues `create`. Called by the email composer's `onSent` callback.
- `POST /api/invoices/[id]/mark-sent` — same state change, no email.
- `POST /api/invoices/[id]/void` — guard against existing payments, set voided fields, enqueue `void`.
- `GET /api/invoices/[id]/pdf` — streams generated PDF (used for the email attachment and user download).

### Payment routes

- `POST /api/payments` — body `{ jobId, invoiceId?, source, method, amount, referenceNumber?, payerName?, receivedDate, notes? }`. Insert, enqueue `create`. After insert, the `payments_update_payer_type` trigger from 16b recomputes `jobs.payer_type` automatically.
- `PATCH /api/payments/[id]` — edit. Enqueue `update`.
- `DELETE /api/payments/[id]` — capture snapshot → delete row → enqueue `delete` with snapshot in payload.
- `GET /api/payments?invoiceId=&jobId=` — list.

### QB sync routes

- `POST /api/qb/sync-log/[id]/retry` — exists in 16c. Ensure it works for `failed`-state rows: reset status to `queued`, `retry_count=0`, clear error fields.
- `POST /api/qb/sync-log/[id]/mark-synced` — new. Body `{ qbEntityId }`. Writes `qb_entity_id` to the platform record, marks log `synced` with note `"manually_marked"`.
- `POST /api/qb/sync-log/cleanup` — new. Deletes synced logs older than 90 days. Admin only.
- `POST /api/qb/sync-now` — exists. Verify it takes the advisory lock and skips if busy.

### Settings routes

- `GET /api/settings/invoice-email`, `PATCH /api/settings/invoice-email` — mirror `contract-email` shape. Stored in `settings` table as JSON on a single row (same pattern as contract-email).
  - Subject template (default: `Invoice {{invoice_number}} - {{job_address}}`)
  - Body template (rich-text) — merge fields: `{{invoice_number}}, {{invoice_total}}, {{due_date}}, {{job_address}}, {{customer_name}}, {{company_name}}`
  - Reply-to override (optional)
  - Default email account (Resend vs. user email account) — same radio as contracts

### Stripe stub — `POST /api/stripe/webhooks`

- Verify signature with `STRIPE_WEBHOOK_SECRET`.
- Match `event.type` — log `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`.
- Return 200 for all events so Stripe stops retrying.
- TODO block at the top marks the Build 17 landing site:
  ```ts
  // TODO(build-17): On payment_intent.succeeded, look up the invoice by
  // metadata.invoice_id, insert a platform payment row, then enqueueSync.
  // All wiring is in place — this is the only place Build 17 needs to edit.
  ```

## UI

### Invoice list — `src/app/invoices/page.tsx`

Permission gate: `view_accounting`. Dark theme, teal accents.

- Filter pills: All · Draft · Sent · Partial · Paid · Voided
- Search: invoice number, job address, customer name
- Sort: Issued date (default desc) · Due date · Amount · Status
- Row: invoice_number, customer, job address, issued date, due date, total, status pill, QB sync indicator (✓ / ⚠ / pending)
- Row click → invoice detail
- "New Invoice" button top-right → picks a job → invoice create form

### Invoice detail/edit — `src/app/invoices/[id]/page.tsx`

Single page handles create, edit, view. URL params drive mode.

- **Header:** invoice_number + status pill. Actions on right depend on status:
  - Draft: Save · Send Invoice · Mark as Sent · Delete
  - Sent/Partial/Paid: Edit Cosmetic Fields · Record Payment · Void Invoice · Download PDF
  - Voided: Download PDF only (read-only with strikethrough)
- **Job header block:** read-only job summary (customer, address, damage type, job number). Link to job.
- **Line items table:** add/remove/reorder rows (drag handle), description (textarea), quantity, unit_price, amount (auto = qty × price). Xactimate code field per row (optional, pill-styled).
- **Totals panel:** Subtotal · Tax rate (%) · Tax amount · Total. Tax rate is a percent input; stored as decimal. Changing rate recomputes amount.
- **Meta block:** Issued date · Due date (defaults to issued + 30) · PO number · Memo · Notes (internal).
- **Send Invoice action:**
  1. Validates form, warns if line items empty.
  2. `POST /api/invoices/[id]/pdf` to generate + upload PDF to storage.
  3. Opens `ComposeEmail` modal with `defaultTo` (adjuster contact for insurance jobs, else homeowner), `defaultSubject/Body` from invoice-email settings (merge fields resolved), attachment pre-populated.
  4. On send success, the modal's `onSent` callback hits `POST /api/invoices/[id]/send` → status becomes `sent`, `sent_at` set, enqueue runs.
- **Mark as Sent action:** confirmation dialog → `POST /api/invoices/[id]/mark-sent`.
- **Edit after sent:** line items + totals render read-only with an Edit button. Click → confirmation dialog ("This invoice has been sent…") → unlock form → Save enqueues `update`.
- **Void action:** confirmation dialog. Blocked if payments exist (client-side check + server-side guard).

### Record Payment modal — `src/components/payments/record-payment-modal.tsx`

- Invoked from: invoice detail (prefills `invoiceId`), job detail Financials tab, `/payments` list (future).
- Fields: Source (insurance/homeowner/other) · Method (check/ach/venmo_zelle/cash/credit_card) · Amount · Reference number · Payer name · Received date (default today) · Notes.
- On submit: `POST /api/payments` → toast "Payment recorded · QB sync queued" → close modal → invoice detail refreshes. Status auto-transitions to `partial` or `paid` via the new `payments_update_invoice_status` trigger added in this migration (see Database changes).

### Job detail Financials tab integration

Already has invoice/payment summary sections from 16b. Add:
- "Create Invoice" button at the top of the invoice section → opens the invoice create form prefilled with `jobId`.
- "Record Payment" button — opens the modal.
- Invoice list in the Financials tab gets links to `/invoices/[id]`.

### `/settings/invoices` — mirror `/settings/contracts`

Exact layout clone of the 16b contract-email settings:
- Header + subtitle
- Email provider radio (Resend vs. email account)
- Default from/reply-to
- Subject template (single line, merge-field autocomplete)
- Body template (Tiptap editor, merge-field dropdown)
- Save/Reset with dirty-flag guard

### QB sync tab hardening (inside `accounting-dashboard`)

Additions to the existing 16c sync tab:
- **Filters row above the activity table:**
  - Entity type pill group: All · Customers · Invoices · Payments · Voids
  - Status pill group: All · Synced · Queued · Failed · Dry run
  - Search input over `record_summary` (free text)
- **View full sync log →** link to `/accounting/sync-log` (existing from 16c).
- **Clear old log entries** admin button (confirmation dialog → `POST /api/qb/sync-log/cleanup`).

### Sync error Fix modal — `src/components/accounting/sync-error-fix-modal.tsx`

Classifies the `error_code` and routes:

| Code | UI |
|---|---|
| `class_not_mapped` | Copy: "Damage type '{x}' isn't mapped to a QB Class." Button: **Go to mappings** → `/settings/accounting/setup`. |
| `deposit_account_not_mapped` | Copy: "Payment method '{x}' isn't mapped to a QB deposit account." Button: **Go to mappings**. |
| `AuthenticationFailure` | Copy: "Your QuickBooks connection has expired." Button: **Reconnect** → `/api/qb/authorize`. |
| `ThrottleExceeded` / HTTP 429 | Copy: "QuickBooks rate limit reached. Auto-retry in X minutes." Button: **Retry now** (bypasses backoff via retry endpoint). |
| `DuplicateNameExists` / `BusinessValidationException` (duplicate-ish) | Copy: "This record may already exist in QuickBooks. Review and mark synced if correct." Button: **Mark as synced** → prompts for `qb_entity_id` → `POST /api/qb/sync-log/[id]/mark-synced`. |
| _default_ | Full `error_message` in a monospace block. Buttons: **Retry** and **Copy error**. |

### Pre-launch checklist — in `/settings/accounting`

Small section above the dry-run toggle:

- ✓ / ✗ CPA has completed QB cleanup _(manual checkbox stored in `qb_connection.cpa_cleanup_confirmed`)_
- ✓ / ✗ Damage type → class mappings complete _(auto — count of `qb_mappings` where type = 'damage_type' ≥ 1 AND covers all used damage types)_
- ✓ / ✗ Payment method → deposit account mappings complete _(auto — same check for payment_method)_
- ✓ / ✗ Dry run active for 7+ days _(auto — `qb_connection.dry_run_mode = true AND setup_completed_at < now() - interval '7 days'`)_
- ✓ / ✗ Would-have-synced log reviewed _(manual checkbox, `qb_connection.dry_run_review_confirmed`)_

Two new boolean columns on `qb_connection` for the manual checkboxes — added in the same migration. Non-blocking: the Go Live toggle works regardless. Checklist is a visible moment of review, not a gate.

## PDF generation

New: `src/components/invoices/invoice-pdf-document.tsx` (React-PDF document) + `src/lib/invoices/generate-invoice-pdf.tsx` (wrapper). Mirrors the Build 11 report-pdf pattern: returns a Buffer that gets uploaded to Supabase Storage under `invoice-pdfs/{invoiceId}/{timestamp}.pdf`. The stored path is what the email composer attaches.

Template (single page):
- Header: company name/logo from `company_settings`, company address/phone/email, INVOICE title, invoice_number, issued date, due date.
- Bill-to block: customer name, job address.
- Line items table: description (+ xactimate code prefix), qty, unit price, amount.
- Totals panel: subtotal, tax (rate + amount if > 0), total.
- Footer: payment instructions text from settings, memo if set.

Plain and boring — no design polish. Can iterate later.

## Hooking into existing flows

- **Contract signed (Build 15)** — no change here. Build 15 doesn't currently trigger invoice creation; leaving that integration for a later build.
- **Invoice send** — as described above.
- **Invoice edit after sent** — `PATCH /api/invoices/[id]` with `confirmLineItemEdit: true` enqueues `update`.
- **Invoice void** — `POST /api/invoices/[id]/void` enqueues `void`.
- **Payment record/edit/delete** — routes enqueue `create`/`update`/`delete`.

Every enqueue is try/catch-wrapped. Queue failures → application log + toast warning; the underlying mutation succeeds regardless.

## Env / config changes

- `STRIPE_WEBHOOK_SECRET` — new. Documented in `.env.example` (if that file exists; otherwise wherever env is tracked).
- Existing `CRON_SECRET`, `QUICKBOOKS_*`, `RESEND_API_KEY` — unchanged.
- `vercel.json` — unchanged. The QB sync cron stays daily (`30 13 * * *`) per Hobby plan cap. Manual **Sync now** covers same-day needs.

## End-to-end reference flows

### Send Invoice (draft → QB)

```
User on invoice detail (draft) clicks Send Invoice
  → generateInvoicePdf(invoiceId) → uploads PDF to Supabase Storage, returns storage_path
  → <ComposeEmail> opens with defaultTo/Subject/Body from /settings/invoices, attachment = stored PDF
  → user sends
  → Resend delivers email (existing Build 12/13 flow)
  → onSent callback → POST /api/invoices/[id]/send
    → UPDATE invoices SET status='sent', sent_at=now()
    → enqueueSync({ entityType: 'invoice', entityId, action: 'create' })
      → enqueue checks job.qb_subcustomer_id; missing? enqueue sub_customer + customer first, link depends_on_log_id
  → (later) Vercel cron hits /api/qb/sync-scheduled
    → advisory lock acquired
    → processQueue selects queued rows, processes customer → sub_customer → invoice
    → syncInvoice loads rows, builds payload, calls createInvoice(token, payload)
    → QB returns invoice id, we write qb_invoice_id back to invoices
    → qb_sync_log row marked synced, synced_at set
    → advisory lock released
```

### Record Payment (platform → QB)

```
User on invoice detail clicks Record Payment → modal
  → submit → POST /api/payments
    → INSERT into payments
    → Build 16b payments_update_payer_type trigger fires (already live)
    → enqueueSync({ entityType: 'payment', entityId, action: 'create' })
      → parent invoice has qb_invoice_id? If not, enqueue invoice sync first + link depends_on_log_id
  → (later) scheduler runs
    → syncPayment loads row, maps method → deposit account, builds payload with LinkedTxn to invoice
    → createPayment(token, payload), writes qb_payment_id back
    → log synced
```

### Void Invoice

```
User clicks Void Invoice on a sent/partial/paid invoice
  → server guards: any payments on this invoice? → reject if yes
  → confirmation dialog → POST /api/invoices/[id]/void
    → UPDATE invoices SET status='voided', voided_at=now(), voided_by=:user
    → enqueueSync({ entityType: 'invoice', entityId, action: 'void' })
      → coalescer checks for a queued 'create' row on the same invoice. Found? Delete both rows (invoice never reached QB; nothing to void).
  → scheduler runs
    → voidInvoice: getInvoice(qbId) for SyncToken → POST /invoice?operation=void
    → log synced
    → both platform + QB show Voided
```

## Known limitations / follow-ups

- **Tax model is US-flat.** Non-US QB companies need `TxnTaxDetail.TaxLine[]` with jurisdiction-specific tax codes; documented for future work.
- **Line-item-level tax not supported** — single invoice-level rate only.
- **Stripe wiring is a stub.** Build 17 fills it in.
- **Contract → invoice auto-creation** deferred. Build 15 contracts don't yet trigger invoice drafts; this is a future integration.
- **5-minute cron** deferred until Vercel plan upgrade. Manual Sync now button covers same-day operational needs.
- **`SELECT FOR UPDATE SKIP LOCKED`** not used — we use a single advisory lock on the whole scheduler. Equivalent safety at our scale; simpler to reason about.

## Review gate

The user reviews this spec before we proceed to `writing-plans`. Changes requested → edit this doc and re-review. Approval → invoke `writing-plans` with a pointer to this file.
