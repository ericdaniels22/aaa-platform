---
build_id: 13
title: Email attachments
status: shipped
phase: email
started: null
shipped: null
guide_doc: "v1.3 §Builds 12–13"
plan_file: null
handoff: null
related: ["[[build-12]]", "[[build-27]]"]
---

#status/shipped #area/email #build/13

## What shipped

Email attachments — upload, download, signed URLs, attached-file inbox display. Bundled with [[build-12]] in commit `120f334`.

- **Migrations:** [supabase/migration-build13.sql](../../../supabase/migration-build13.sql), [supabase/migration-build13-attachments.sql](../../../supabase/migration-build13-attachments.sql).
- **Routes:** `/api/email/attachments`, `/api/email/attachments/[id]`, `/api/email/attachments/upload`.
- **Storage bucket:** `email-attachments` (private; API-routed access).

## Source

- Commit: `120f334 Build 12-13: Full email inbox, compose, reply/forward, attachments, and drafts`
- Migrations: [supabase/migration-build13.sql](../../../supabase/migration-build13.sql), [supabase/migration-build13-attachments.sql](../../../supabase/migration-build13-attachments.sql)
- Guide: v1.3 §Builds 12–13
