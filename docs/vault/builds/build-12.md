---
build_id: 12
title: Email inbox base
status: shipped
phase: email
started: null
shipped: null
guide_doc: "v1.3 §Builds 12–13"
plan_file: null
handoff: null
related: ["[[build-13]]", "[[build-27]]", "[[build-28]]"]
---

#status/shipped #area/email #build/12

## What shipped

Initial email inbox UX — IMAP sync via [imapflow](https://www.npmjs.com/package/imapflow), compose, reply/forward, drafts, threads. Bundled with [[build-13]] in commit `120f334`.

- **Schema:** [supabase/schema-email.sql](../../../supabase/schema-email.sql) — `email_accounts`, `emails`, `email_drafts`.
- **Migration:** [supabase/migration-build12.sql](../../../supabase/migration-build12.sql).
- **Routes:** `/email`, `/api/email/*` (list, send, sync, drafts, accounts, thread).
- Library: `imapflow` for IMAP, `mailparser` for parsing, `nodemailer` for sending.

## Source

- Commit: `120f334 Build 12-13: Full email inbox, compose, reply/forward, attachments, and drafts`
- Migrations: [supabase/migration-build12.sql](../../../supabase/migration-build12.sql)
- Schema: [supabase/schema-email.sql](../../../supabase/schema-email.sql)
- Guide: v1.3 §Builds 12–13
