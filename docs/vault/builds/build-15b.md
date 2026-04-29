---
build_id: 15b
title: Remote contract signing
status: shipped
phase: contracts
started: null
shipped: null
guide_doc: "v1.6 §Build 15"
plan_file: null
handoff: null
related: ["[[build-15a]]", "[[build-15c]]"]
---

#status/shipped #area/contracts #build/15b

## What shipped

Customer-facing remote signing flow. Tokenized public route, signature capture via [signature_pad](https://www.npmjs.com/package/signature_pad), generated PDF with embedded signature, email notification on send/sign.

- **Migration:** [supabase/migration-build33-contracts.sql](../../../supabase/migration-build33-contracts.sql) — `contracts`, `contract_signers`, `contract_events`.
- **Routes:** `/contracts`, `/contracts/[id]`, `/sign/[token]` (public), `/api/contracts`, `/api/contracts/[id]`, `/api/contracts/[id]/pdf`, `/api/contracts/[id]/sign`, `/api/contracts/[id]/void`, `/api/contracts/[id]/resend`, `/api/contracts/send`, `/api/contracts/preview`, `/api/sign/[token]`.
- **PDF generation:** [pdf-lib](https://www.npmjs.com/package/pdf-lib).

## Source

- Commit: `f8849ea feat: add remote contract signing flow (Build 15b)`
- Migration: [supabase/migration-build33-contracts.sql](../../../supabase/migration-build33-contracts.sql)
- Guide: v1.6 §Build 15
