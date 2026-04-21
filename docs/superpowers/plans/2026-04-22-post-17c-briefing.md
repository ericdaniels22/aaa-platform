# Post-17c briefing

> **Purpose:** Hand this to a fresh Claude session before starting the next build. Captures the 17c shipped state, architectural decisions that future builds must respect, and follow-ups that were intentionally deferred.

---

## TL;DR

**17c shipped to production 2026-04-21** (PR [#23](https://github.com/ericdaniels22/aaa-platform/pull/23), merge to main). End-to-end preview verification on the `claude/great-chatelet-598282` branch confirmed the full happy path: incoming Stripe webhook → signature verify → idempotency claim → status flip to paid → `payments` row insert → branded receipt PDF → customer email → internal email → in-app notification → QB sync attempt.

**What 17c does NOT do:** reminder scheduler for unpaid requests (17d), dispute evidence submission workflow (future Build 19), payment plans / recurring ACH (future Build 18), tenant-scoped Stripe Connect (requires future multi-tenant refactor — see "SaaS readiness" below).

**Production readiness:** single-tenant, test-mode Stripe preview verified. Eric still needs to register a production webhook at `https://aaaplatform.vercel.app/api/stripe/webhook` with the whsec, and disable "Successful payments" emails in Stripe Dashboard (already done for preview). QB mappings seeded in the shared dev=prod DB; valid for both environments.

---

## 17c feature surface (what shipped)

### New tables / migrations (build41 migration applied 2026-04-21)

- `refunds` — one row per refund attempt (pending → succeeded|failed|canceled). Rows get created by `/api/payment-requests/[id]/refund` OR auto-created by the `charge.refunded` webhook when Stripe Dashboard initiated.
- `stripe_disputes` — minimal tracking; no evidence workflow yet.
- `notifications` (pre-existing from 14g) — extended with `href`, `priority`, `metadata` columns. Type CHECK widened with 5 new 17c event types (`payment_received`, `payment_failed`, `refund_issued`, `dispute_opened`, `qb_sync_failed`).
- `contract_events.event_type` CHECK widened with 6 payment-lifecycle values (`paid`, `payment_failed`, `refunded`, `partially_refunded`, `dispute_opened`, `dispute_closed`).
- `payments` — widened `source` / `method` / `status` CHECKs (adds `stripe`, `stripe_card`, `stripe_ach`, `refunded`). Added columns: `payment_request_id`, `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_fee_amount`, `net_amount`, `quickbooks_sync_status`, `quickbooks_sync_attempted_at`, `quickbooks_sync_error`.
- `payment_requests` — new columns: `stripe_receipt_url`, `qb_payment_id`, `quickbooks_sync_status`, `quickbooks_sync_attempted_at`, `quickbooks_sync_error`.
- `payment_email_settings` — 10 new template columns (3 customer-facing pairs for receipt/refund, 3 internal pairs) + `internal_notification_to_email` recipient override.
- `qb_mappings.type` CHECK widened with 2 new 17c values: `generic_income_account`, `stripe_fee_account`.
- Partial UNIQUE index on `payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL` — defense against duplicate Stripe-sourced payment rows under retry races.

### New routes

- `POST /api/stripe/webhook` — signature verify, `stripe_events` idempotency, dispatch to 6 event handlers. `runtime = "nodejs"` + `dynamic = "force-dynamic"` required for raw-body access.
- `POST /api/stripe/webhook-secret` — encrypts + stores the whsec into `stripe_connection.webhook_signing_secret_encrypted`.
- `POST /api/payment-requests/[id]/refund` — creates refunds row + calls Stripe refunds API; doesn't finalize (that's the webhook's job).
- `GET /api/payment-requests/[id]/receipt-url` — returns a 5-min signed Supabase Storage URL for the branded receipt PDF.
- `GET /api/payment-requests/[id]/refundable` — returns `{ remaining, payment_id }` for the refund modal.
- `POST /api/payments/[id]/retry-qb-sync` — manual QB retry for failed syncs.
- `/api/qb/accounts?types=Income,Expense` — optional query param (defaults to `Bank,Other Current Asset` for backward compat).

### New library modules

- `src/lib/stripe/webhook/verify.ts` — `verifyWebhook(rawBody, sig)` throws typed errors (`WebhookSecretMissingError` → 503, `WebhookSignatureInvalidError` → 400). Uses a singleton `VERIFIER = new Stripe("sk_dummy" fallback, apiVersion "2026-03-25.dahlia")`.
- `src/lib/stripe/webhook/idempotency.ts` — `claimEvent / markProcessed / releaseEvent` via `stripe_events.stripe_event_id` UNIQUE.
- `src/lib/stripe/webhook/handlers/` — one file per event type:
  - `checkout-session-completed.ts` — captures payer details only; does NOT flip status.
  - `payment-intent-succeeded.ts` — central handler (status flip, payments insert, side-effects).
  - `payment-intent-failed.ts` — status to failed + internal notification. No customer email.
  - `charge-refunded.ts` — reconciles both UI-initiated and Dashboard-initiated refunds.
  - `charge-dispute.ts` — both `.created` + `.closed` handlers; minimal tracking only.
- `src/lib/payments/receipt-pdf.ts` — `generateReceiptPdf()` via pdf-lib. Company branding loaded from the key/value `company_settings` table. Sanitizes non-WinAnsi characters (prevents crashes on emoji/CJK payer names).
- `src/lib/qb/sync/stripe-payment-bridge.ts` — entry point from the webhook handler. Composes `syncPayment()` + `postStripeFee()`. Handles no-token → `not_applicable`, deferred → throws so handler records failure.
- `src/lib/qb/sync/stripe-fees.ts` — posts Stripe processing fee as a QB Purchase (expense) against the `stripe_fee_account` mapping.
- `src/lib/qb/sync/refunds.ts` — posts refund as a QB RefundReceipt. Uses `ItemRef: { value: "1" }` fallback — a `refund_item` mapping type is a known follow-up.
- `src/lib/notifications/write.ts` — `writeNotification()` fans out to all active admins (mirrors legacy `notify_admins` plpgsql). Accepts optional `userId` for single-user scope.

### Modified library modules

- `src/lib/qb/sync/payments.ts` — extended with no-invoice branch that posts to the `generic_income_account` mapping for standalone deposits/retainers.
- `src/lib/qb/client.ts` — added `createPurchase`, `createRefundReceipt`, `listAccountsByType` helpers.
- `src/lib/payment-emails.ts` — added three new orchestrators: `sendPaymentReceiptEmail` (generates + attaches PDF, uploads to Storage, writes audit), `sendPaymentInternalNotification` (4 kinds; dispute reuses payment_failed template + subject prefix), `sendRefundConfirmationEmail`.
- `src/lib/payments/merge-fields.ts` — added 16 new merge fields via `PAYMENT_EXTENDED` constant. Fields include `paid_at_formatted`, `payer_name/email`, `payment_method_display` (multi-word card brand support), `transaction_id` (truncated ellipsis), `stripe_receipt_url`, `stripe_fee_formatted`, `net_amount_formatted`, `refund_amount_formatted`, etc. `PaymentMergeExtras` type carries runtime-only inputs from handlers to the resolver.
- `src/lib/payments/activity.ts` — widened `PaymentEventArgs.eventType` union to match build41's contract_events CHECK values.

### Modified UI

- `/settings/stripe` — new Webhook Configuration section with status badge (3 states), helper text, `whsec_` input with Show/Hide toggle + Save button. Uses the legacy dashboard URL pair based on `mode`.
- `/settings/payments` (aka `src/app/settings/payments/page.tsx`) — three new sections: Customer Receipt, Refund Confirmation, Internal Notifications (with recipient override + 3 template pairs). Reuses existing `PaymentEmailTemplateField` component.
- `src/components/payments/online-payment-requests-subsection.tsx` — extended row content for paid/partially_refunded rows: method icon, `QbSyncBadge`, View receipt, Refund, Retry QB sync actions. Refund modal mounted at the bottom.
- `src/components/notification-bell.tsx` (legacy 14g) — extended interface with `href`, `priority`, `metadata`. Icon/color maps gained 5 new types. Row rendering adds `border-l-2 border-l-destructive` for high-priority. Link target prefers `n.href ?? /jobs/${n.job_id}`.
- `src/components/payments/refund-modal.tsx` (new) — native HTML radio/checkbox inputs (Radix equivalents don't exist in this project; styled with Tailwind).

### Files intentionally deleted

- `src/app/api/stripe/webhooks/route.ts` (plural) — Build 16d stub with explicit `TODO(build-17)` comment; 17c replaced with `/api/stripe/webhook` (singular).

---

## Key architectural decisions 17c established

1. **Webhook is the single source of truth for payment lifecycle.** `/api/payment-requests/[id]/refund` creates a `pending` refunds row + calls Stripe — the `charge.refunded` webhook finalizes it. No API directly flips statuses.

2. **`payment_intent.metadata.payment_request_id` is the correlation key** — NOT `stripe_checkout_session_id` (that mutates on session regeneration). Every Stripe Checkout Session includes this metadata at creation; every handler reads it.

3. **Idempotency is layered three ways:**
   - `stripe_events.stripe_event_id` UNIQUE (transport layer).
   - `pr.status` terminal-state short-circuit at the top of each handler.
   - `payments(stripe_payment_intent_id)` partial UNIQUE index (DB-enforced last resort).
   - Plus: `payment_intent.succeeded` handler checks for existing `payments` row before short-circuiting, to handle the "status flipped but insert didn't" partial-run case.

4. **Side effects are per-`.catch()` wrapped.** Receipt email failure does NOT fail the webhook. QB sync failure does NOT fail the webhook. The status flip + `payments` insert are atomic; everything downstream is best-effort with logging + in-app surfacing for operator recovery.

5. **QB sync is inline in the webhook, not queued.** No background worker. Failed syncs surface via `quickbooks_sync_status='failed'` + high-priority notification + Retry button. Vercel Hobby cron constraint (daily-only) respected — no scheduled QB retry. 17d+ scope if needed.

6. **Stripe default customer receipt suppression lives in the Dashboard, not the code.** Initially tried `payment_intent_data.receipt_email: null` — Stripe SDK serializes null to empty string which the API rejects as invalid email. Removed that code hack; relies on Dashboard → Settings → Emails → "Successful payments" being OFF.

7. **Notifications unified with legacy 14g system** — NOT a parallel new table. `notifications` table got `href`, `priority`, `metadata` columns added; bell component at `src/components/notification-bell.tsx` extended with new type icons + priority border. `writeNotification` fans out to all active admins (matches `notify_admins` plpgsql).

8. **Card-brand title-casing handles multi-word brands.** `american_express` → `American Express` via `.split("_").map(cap).join(" ")`. Don't regress to the single-char `.charAt(0).toUpperCase() + .slice(1)` pattern — it breaks for anything with underscores.

9. **Non-WinAnsi character sanitization in receipt PDF.** `pdf-lib` StandardFonts are WinAnsi-encoded; non-Latin chars throw at `drawText` time. `winAnsiSafe()` helper wraps every `drawText` call with user-sourced content.

---

## Environment state (production)

- **Supabase migration high-water:** build41 (applied manually against the shared dev=prod project 2026-04-21).
- **Stripe test webhook endpoint on preview:** `https://aaaplatform-git-claude-gr-f6bbbe-aaa-disaster-recovery-e5661f28.vercel.app/api/stripe/webhook` — subscribed to 6 events. When the preview branch is deleted post-merge, this will die; replace with a production endpoint at `https://aaaplatform.vercel.app/api/stripe/webhook` using the same 6 events.
- **Stripe Dashboard "Successful payments" email:** ensure OFF for both test and live modes to prevent duplicate receipts.
- **Vercel env vars:** `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REDIRECT_URI`, `QUICKBOOKS_ENVIRONMENT` set at project scope (Production + Preview). Team-level duplicates are legacy leftovers from setup — safe to delete.
- **Vercel Deployment Protection:** disabled. Webhook endpoints must be publicly reachable for Stripe.
- **QB mappings seeded** (qb_entity_id values are for the sandbox company — replace when connecting a real QB company):
  - `payment_method` / `stripe_card` → `35` (Checking)
  - `payment_method` / `stripe_ach` → `35` (Checking)
  - `generic_income_account` / `stripe_deposits` → `83` (Other Income)
  - `stripe_fee_account` / `stripe_processing_fees` → `8` (Bank Charges)

---

## Known open follow-ups / deferred polish

None of these block shipping. All are "nice to have" or "fix if it surfaces in prod":

1. **`refund_item` QB mapping** — refund receipts hardcode `ItemRef: { value: "1" }` as fallback. If a realm has deleted the default Services item, refund pushes to QB will fail. Add a `qb_mappings.type='refund_item'` lookup when this hits.
2. **`charge.dispute.closed` uses plain UPDATE** — if Stripe delivers `.closed` before `.created` (rare out-of-order retry), the UPDATE finds no row and the opened_at stamp is lost. Should be upsert.
3. **`charge.refunded` picks newest-of-list refund** — if two refunds are issued on the same charge within seconds and Stripe delivers out-of-order, both events may pick the same "newest" refund. Unlikely in practice; surfaces as a stuck `pending` refund row.
4. **Refund API has a narrow double-click race window** — the in-code idempotency guard checks for existing `pending` row, but a DB-level partial UNIQUE on `refunds(payment_id) WHERE status='pending'` would close the SELECT-then-INSERT window.
5. **Long-text overflow in receipt PDF** — extremely long payer names or addresses can visually overflow the single-page layout. Graceful degradation: email still delivers without PDF, so not production-blocking.
6. **Refund UI doesn't dedupe "reason" vs "include in customer email"** — admins have to be careful about what they write in reason if they later flip the checkbox.
7. **Dry-run mode** on QB connection doesn't affect 17c's bridge (it forces `"live"` mode). Existing Build 16 UI may still show dry-run state; worth auditing for consistency.
8. **Webhook retry failure logging is in-memory only** — `releaseEvent` failure (can't DELETE the `stripe_events` row after handler throw) is silently swallowed. If Stripe retry storms happen, operator has to query `stripe_events` directly to find stuck rows.
9. **Team-level `QUICKBOOKS_*` env vars on Vercel** are redundant with project-level copies. Delete when convenient.
10. **Preview branch env vars** need manual updating if the QB sandbox connection tokens expire. Re-connect flow works but requires the preview URL in the `QUICKBOOKS_REDIRECT_URI` env var to match.

---

## SaaS readiness (for future multi-tenant pivot)

The Stripe Connect OAuth scaffolding already exists (`src/app/api/stripe/connect/*`), but 17c is single-tenant. Migration path for when customer #2 onboards:

1. Add `tenant_id` to `stripe_connection` (currently a singleton row).
2. Tenant-scope every DB query in the webhook handlers — look up `stripe_connection` by `event.account` (the connected Stripe account ID), then filter `jobs`/`payment_requests`/`invoices` by that tenant.
3. Webhook signing secret becomes the platform's single secret (not per-tenant). The `/settings/stripe` webhook section goes away; secret lives in env vars instead.
4. Stripe Checkout Sessions get `on_behalf_of: acct_XXX` so payments settle into the customer's Stripe account.
5. `payment_emails.send_from_*` and `company_settings` become tenant-scoped (probably already singleton-tenant in concept — just need the column).

This is a focused refactor, not a rewrite. A future build should be named something like 18b or 19b depending on what's prioritized first.

---

## Watch-outs for next build

1. **Migration high-water is build41.** Next migration is build42. Follow the `supabase/migration-build<NN>-<name>.sql` convention.
2. **Don't reintroduce `stripe_checkout_session_id` as a correlation key.** Session IDs mutate across regenerations. Always use `payment_intent.metadata.payment_request_id`.
3. **Don't set `payment_intent_data.receipt_email` to `null` or `""` in code** — Stripe rejects both. Rely on Dashboard setting to suppress.
4. **`.upload()` on Supabase Storage returns `{data, error}` — doesn't throw.** Always destructure `error`. Every callsite elsewhere in the codebase does this; don't regress.
5. **Don't split email/payment infrastructure across new tables.** Reuse the existing singleton pattern (`payment_email_settings`, `stripe_connection`, `company_settings` key/value).
6. **Webhook handlers must be idempotent.** If extending with a new event type, follow the `payment-intent-succeeded.ts` pattern: metadata check → PR load → terminal-state short-circuit (with existence check on downstream rows) → optimistic update with `.eq("status", pr.status)` → audit log → side effects.
7. **No new background workers / queues.** Stay on the "inline with manual retry" pattern for QB sync and any future similar integrations. Vercel Hobby cron is daily-only.

---

## Reference pointers

- **Build 17c plan:** `docs/superpowers/plans/2026-04-21-build-17c-webhook-receipts-refunds-qb.md` (4,900+ lines, comprehensive).
- **Build 17b plan:** `docs/superpowers/plans/2026-04-20-build-17b-payment-page-email.md`.
- **Build 17a plan:** `docs/superpowers/plans/2026-04-20-build-17a-stripe.md`.
- **Build 17c pre-planning briefing:** `docs/superpowers/plans/2026-04-21-build-17c-briefing.md`.
- **PR:** [#23](https://github.com/ericdaniels22/aaa-platform/pull/23).
- **Stripe webhook dashboard (preview):** configured at `https://dashboard.stripe.com/test/webhooks`.
- **Project memory:** `C:/Users/14252/.claude/projects/C--Users-14252-Desktop-aaa-platform/memory/`.
