---
build_id: 15a
title: Contract template system
status: shipped
phase: contracts
started: null
shipped: null
guide_doc: "v1.6 §Build 15"
plan_file: null
handoff: null
related: ["[[build-15b]]", "[[build-15c]]"]
---

#status/shipped #area/contracts #build/15a

## What shipped

Reusable contract templates with merge fields (job/customer/billing) and a template editor.

- **Migration:** [supabase/migration-build32-contract-templates.sql](../../../supabase/migration-build32-contract-templates.sql) — `contract_templates`.
- **Routes:** `/settings/contract-templates`, `/settings/contract-templates/[id]`, `/api/settings/contract-templates`, `/api/settings/contract-templates/[id]`, `/api/settings/contract-templates/preview`, `/api/settings/contract-templates/jobs`.

## Source

- Commit: `657f0b8 feat: add contract template system (Build 15a)`
- Migration: [supabase/migration-build32-contract-templates.sql](../../../supabase/migration-build32-contract-templates.sql)
- Guide: v1.6 §Build 15
