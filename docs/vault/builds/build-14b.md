---
build_id: 14b
title: Appearance settings (dark mode + brand colors)
status: shipped
phase: settings
started: null
shipped: null
guide_doc: "v1.4 §Build 14b"
plan_file: null
handoff: null
related: ["[[build-14a]]"]
---

#status/shipped #area/settings #build/14b

## What shipped

Appearance settings: dark/light theme via `next-themes`, configurable brand colors via [src/components/brand-colors-provider.tsx](../../../src/components/brand-colors-provider.tsx).

- **No migration** — preferences persisted in `company_settings` (added in [[build-14a]]).
- **Routes:** `/settings/appearance`, `/api/settings/appearance`.

## Source

- Commit: `0de2d84 Build 14b: Appearance settings with dark mode and brand colors`
- Provider: [src/components/brand-colors-provider.tsx](../../../src/components/brand-colors-provider.tsx)
- Guide: v1.4 §Build 14b
