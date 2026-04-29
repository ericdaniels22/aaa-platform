---
build_id: 14e
title: Email signatures (rich text)
status: shipped
phase: settings
started: null
shipped: null
guide_doc: "v1.4 §Build 14e"
plan_file: null
handoff: null
related: ["[[build-14a]]", "[[build-12]]"]
---

#status/shipped #area/settings #area/email #build/14e

## What shipped

Per-user rich text email signatures with image support, applied automatically to outgoing email.

- **Migration:** [supabase/migration-build14e.sql](../../../supabase/migration-build14e.sql) — `email_signatures` table.
- **Routes:** `/settings/signatures`, `/api/settings/signatures`.
- **Editor:** [src/components/tiptap-editor.tsx](../../../src/components/tiptap-editor.tsx) (TipTap StarterKit + Link).

## Source

- Commit: `823acf0 Build 14e: Email signatures with rich text editor and dark mode fixes`
- Migration: [supabase/migration-build14e.sql](../../../supabase/migration-build14e.sql)
- Guide: v1.4 §Build 14e
