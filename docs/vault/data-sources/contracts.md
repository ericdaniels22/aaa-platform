---
table: contracts
type: supabase
created_in: build-15b
related_builds: ["[[build-15a]]", "[[build-15b]]", "[[build-15c]]", "[[build-18a]]", "[[build-18b]]"]
---

#data-source #area/contracts

# `contracts`

Customer-signed contracts with token-based public access. Created in [[build-15b]]; reminders/multi-signer added in [[build-15c]].

## Created in

- [supabase/migration-build33-contracts.sql](../../../supabase/migration-build33-contracts.sql) ([[build-15b]]) — `contracts` (with `link_token` UNIQUE), [[contract_signers]], `contract_events`.

## Altered by

- **[[build-15c]]** ([build34](../../../supabase/migration-build34-contract-reminders.sql)) — reminder tracking columns (`last_reminder_at`, etc.); cron support.
- **[[build-18a]]** — `organization_id`; per-org number generator (build47).
- **[[build-18b]]** ([build59](../../../supabase/migration-build59-contract-event-rpcs-organization-id.sql)) — patches 7 contract RPCs to include `organization_id` in `contract_events` INSERTs.
- **[[build-17b]]** ([build40](../../../supabase/migration-build40-payment-emails.sql)) — relax `contract_events.contract_id` (not strictly contract-scoped after payments share the events table).

## RLS

- **18b:** `tenant_isolation_contracts`.
- **Public access** via `/sign/[token]` and `/api/sign/[token]` — derives `organization_id` from the contract row, not the AAA fallback (per [[build-18c]] public-route audit).

## Used by

`/contracts`, `/contracts/[id]`, `/contracts/[id]/sign-in-person`, `/sign/[token]`, contract template editor, email-attachment send, in-person tablet flow, daily reminder cron (`/api/contracts/reminders` 13:00 UTC).
