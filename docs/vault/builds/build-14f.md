---
build_id: 14f
title: Intake form builder
status: shipped
phase: settings
started: null
shipped: null
guide_doc: "v1.4 §Build 14f"
plan_file: null
handoff: null
related: ["[[build-14a]]"]
---

#status/shipped #area/settings #build/14f

## What shipped

Configurable public intake form: admins define fields in `/settings/intake-form`; the form renders dynamically at `/intake`.

- **Migration:** [supabase/migration-build14f.sql](../../../supabase/migration-build14f.sql) — `intake_form_fields`, `intake_form_settings`.
- **Routes:** `/settings/intake-form`, `/intake`, `/api/settings/intake-form`, `/api/settings/intake-form/custom-fields`.
- **Component:** [src/components/intake-form.tsx](../../../src/components/intake-form.tsx).

## Source

- Commit: `6fe0af1 Build 14f: Intake form builder with dynamic rendering`
- Migration: [supabase/migration-build14f.sql](../../../supabase/migration-build14f.sql)
- Guide: v1.4 §Build 14f
