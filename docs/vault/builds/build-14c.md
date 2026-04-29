---
build_id: 14c
title: Dynamic job statuses & damage types
status: shipped
phase: settings
started: null
shipped: null
guide_doc: "v1.4 §Build 14c"
plan_file: null
handoff: null
related: ["[[build-14a]]"]
---

#status/shipped #area/settings #build/14c

## What shipped

Customizable job statuses and damage types (replacing the hardcoded enum from [[build-1-10]]).

- **Migration:** [supabase/migration-build14c.sql](../../../supabase/migration-build14c.sql) — `job_statuses`, `damage_types`.
- **Routes:** `/settings/statuses`, `/settings/damage-types`, `/api/settings/statuses`, `/api/settings/damage-types`.
- **Job-card UX:** colored top border on job cards driven by damage type.

## Source

- Commit: `fd2e0fe Build 14c: Dynamic job statuses and damage types`
- Migration: [supabase/migration-build14c.sql](../../../supabase/migration-build14c.sql)
- Guide: v1.4 §Build 14c
