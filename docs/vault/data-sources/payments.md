---
table: payments
type: supabase
created_in: build-16d
related_builds: ["[[build-16d]]", "[[build-17a]]", "[[build-17c]]", "[[build-18a]]"]
---

#data-source #area/payments

# `payments`

Recorded payments — both manual (recorded after the fact) and automated (synthesized by the Stripe webhook on `payment_intent.succeeded`).

## Created in

- [supabase/migration-build38-invoice-payment-sync.sql](../../../supabase/migration-build38-invoice-payment-sync.sql) ([[build-16d]]) — initial table with manual record-payment flow and QuickBooks sync columns.

## Altered by

- **[[build-17a]]** ([build39](../../../supabase/migration-build39-stripe-payments.sql)) — `stripe_payment_intent_id`, link to `payment_requests`.
- **[[build-17c]]** ([build41](../../../supabase/migration-build41-webhook-receipts-refunds.sql)) — branded receipt path, refund linkage, additional CHECKs; `UNIQUE(stripe_payment_intent_id)` (commit `a3bfcb3`).
- **[[build-18a]]** — `organization_id`.

## RLS

- **18b:** `tenant_isolation_payments`.

## Used by

`/api/payments`, record-payment modal ([[build-16d]]), Stripe webhook handler ([[build-17c]]), retry-qb-sync endpoint, accounting dashboard (revenue, AR aging), Billing UI (status badges, view receipt, refund, retry-QB).
