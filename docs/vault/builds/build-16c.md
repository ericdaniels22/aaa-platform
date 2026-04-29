---
build_id: 16c
title: QuickBooks Online connection + customer sync
status: shipped
phase: accounting
started: null
shipped: null
guide_doc: "v1.6 §Build 16"
plan_file: null
handoff: null
related: ["[[build-16b]]", "[[build-16d]]", "[[build-17c]]"]
---

#status/shipped #area/accounting #area/quickbooks #build/16c

## What shipped

OAuth 2.0 connection to QuickBooks Online (single-tenant Eric's company), QB customer sync, account/class catalogs, mappings between platform entities and QB accounts. Foundation for invoice/payment sync in [[build-16d]] and the Stripe-fee/refund QB bridge in [[build-17c]].

- **Migration:** [supabase/migration-build37-quickbooks.sql](../../../supabase/migration-build37-quickbooks.sql) — `qb_connection`, `qb_mappings`, `qb_sync_log`.
- **Routes:** `/settings/accounting`, `/settings/accounting/setup`, `/api/qb/authorize`, `/api/qb/callback`, `/api/qb/connection`, `/api/qb/disconnect`, `/api/qb/accounts`, `/api/qb/classes`, `/api/qb/mappings`, `/api/qb/sync-now`, `/api/qb/sync-scheduled`, `/api/qb/sync-log`, `/api/qb/sync-log/[id]`, `/api/qb/sync-log/cleanup`, `/api/settings/accounting/checklist`.
- **Cron:** `/api/qb/sync-scheduled` runs daily at 13:30 UTC ([vercel.json](../../../vercel.json)).
- Libraries added: `intuit-oauth`, `node-quickbooks`.

## Source

- Commit: `d039b03 feat(16c): QuickBooks Online connection + customer sync`
- Migration: [supabase/migration-build37-quickbooks.sql](../../../supabase/migration-build37-quickbooks.sql)
- Guide: v1.6 §Build 16
