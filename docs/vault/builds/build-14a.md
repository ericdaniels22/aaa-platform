---
build_id: 14a
title: Settings hub + company profile
status: shipped
phase: settings
started: null
shipped: null
guide_doc: "v1.4 §Build 14a"
plan_file: null
handoff: null
related: ["[[build-14b]]", "[[build-14c]]", "[[build-14d]]", "[[build-14e]]", "[[build-14f]]", "[[build-14g]]"]
---

#status/shipped #area/settings #build/14a

## What shipped

The settings hub at `/settings` plus the first sub-page: company profile (name, address, logo, phone, etc.).

- **Migration:** [supabase/migration-build14a.sql](../../../supabase/migration-build14a.sql) — `company_settings` table.
- **Routes:** `/settings`, `/settings/company`, `/api/settings/company`, `/api/settings/company/logo`.

## Source

- Commit: `bd11ee3 Build 14a: Settings hub with company profile`
- Migration: [supabase/migration-build14a.sql](../../../supabase/migration-build14a.sql)
- Guide: v1.4 §Build 14a
