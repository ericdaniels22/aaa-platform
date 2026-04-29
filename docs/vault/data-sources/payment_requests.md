---
table: payment_requests
type: supabase
created_in: build-17a
related_builds: ["[[build-17a]]", "[[build-17b]]", "[[build-17c]]", "[[build-18a]]", "[[build-18c]]"]
---

#data-source #area/payments #area/stripe

# `payment_requests`

Stripe Checkout sessions sent to customers (deposit or invoice-online-pay). Created in [[build-17a]].

## Created in

- [supabase/migration-build39-stripe-payments.sql](../../../supabase/migration-build39-stripe-payments.sql) ([[build-17a]]) — initial table, `link_token` UNIQUE, capped session expiry, partial index for unprocessed events.

## Altered by

- **[[build-17b]]** ([build40](../../../supabase/migration-build40-payment-emails.sql)) — sent/viewed status badges; recipient email override.
- **[[build-17c]]** ([build41](../../../supabase/migration-build41-webhook-receipts-refunds.sql)) — refund/dispute columns, branded receipt path.
- **[[build-18a]]** — `organization_id`.
- **[[build-18c]]** — public-route audit fix: `/pay/[token]` now scopes related queries by `pr.organization_id` rather than the AAA fallback.

## RLS

- **18b:** `tenant_isolation_payment_requests`.
- **Public access** via `/pay/[token]` — `organization_id` derived from the row.

## Used by

`/pay/[token]`, `/pay/[token]/success`, `/api/pay/[token]/checkout`, `/api/payment-requests/*` (send, void, refund, refundable, receipt-url), Billing UI on job detail (Send/Copy/View actions), Stripe webhook handler.
