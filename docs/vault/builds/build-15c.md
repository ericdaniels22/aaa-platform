---
build_id: 15c
title: In-person signing, multi-signer & reminders
status: shipped
phase: contracts
started: null
shipped: null
guide_doc: "v1.6 §Build 15"
plan_file: null
handoff: null
related: ["[[build-15a]]", "[[build-15b]]"]
---

#status/shipped #area/contracts #build/15c

## What shipped

Tablet-mode in-person signing, multi-signer support, daily reminder cron for unsigned contracts.

- **Migration:** [supabase/migration-build34-contract-reminders.sql](../../../supabase/migration-build34-contract-reminders.sql) — adds reminder columns to `contracts`, `contract_signers`.
- **Routes:** `/contracts/[id]/sign-in-person`, `/api/contracts/in-person`, `/api/contracts/in-person/start`, `/api/contracts/[id]/remind`, `/api/contracts/reminders`.
- **Cron:** `/api/contracts/reminders` runs daily at 13:00 UTC ([vercel.json](../../../vercel.json)).
- **Mobile fixes:** widened modals, mobile-friendly signer rows, white signature pad for tablet visibility (commits `de9ceb6`, `2637266`, `227a977`, `ea8eeff`).

## Source

- Commit: `1ff02bb feat: add in-person signing, multi-signer, and reminders (Build 15c)`
- Migration: [supabase/migration-build34-contract-reminders.sql](../../../supabase/migration-build34-contract-reminders.sql)
- Guide: v1.6 §Build 15
