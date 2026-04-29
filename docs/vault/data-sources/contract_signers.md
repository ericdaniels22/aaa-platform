---
table: contract_signers
type: supabase
created_in: build-15b
related_builds: ["[[build-15b]]", "[[build-15c]]", "[[build-18a]]"]
---

#data-source #area/contracts

# `contract_signers`

Per-signer rows on a [[contracts|contract]]. Supports multi-signer contracts (added in [[build-15c]]).

## Created in

- [supabase/migration-build33-contracts.sql](../../../supabase/migration-build33-contracts.sql) ([[build-15b]]) — initial table.

## Altered by

- **[[build-15c]]** — multi-signer columns; signer order; signed-by metadata.
- **[[build-18a]]** — `organization_id`.

## RLS

- **18b:** `tenant_isolation_contract_signers`.

## Used by

Contract signing UI (sign in-person, remote sign), PDF generator (embeds each signer's signature), reminder cron (filters un-signed).
