---
table: invoices
type: supabase
created_in: build-16d
related_builds: ["[[build-16d]]", "[[build-16c]]", "[[build-17a]]", "[[build-18a]]"]
---

#data-source #area/invoices #area/accounting

# `invoices`

Invoices and their line items, with QuickBooks sync state and email-send tracking.

## Created in

- [supabase/migration-build38-invoice-payment-sync.sql](../../../supabase/migration-build38-invoice-payment-sync.sql) ([[build-16d]]) — initial table; `invoice_line_items`, status flow (`draft` → `sent` → `paid` / `void`), QB sync triggers, `invoice_email_settings`.

## Altered by

- **[[build-17a]]** ([build39](../../../supabase/migration-build39-stripe-payments.sql)) — flags for online-pay request linkage.
- **[[build-18a]]** — `organization_id`; per-org invoice number generator from build47.

## RLS

- **18b:** `tenant_isolation_invoices`.

## Used by

`/invoices`, `/invoices/new`, `/invoices/[id]`, `/api/invoices` family, invoice PDF generator, ComposeEmail (with PDF pre-attach), QB invoice sync module, accounting dashboard (AR aging, profitability).
