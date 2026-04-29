---
build_id: 14h-14i
title: Report defaults & data export
status: shipped
phase: settings
started: null
shipped: null
guide_doc: "v1.4 §Builds 14h–14i"
plan_file: null
handoff: null
related: ["[[build-14a]]"]
---

#status/shipped #area/settings #build/14h #build/14i

## What shipped

Two settings sub-pages bundled in a single commit:

- **14h — Report defaults:** template-level defaults for inspection/scope reports. Routes `/settings/reports`, `/reports`, `/reports/new`, `/reports/[id]`, `/reports/templates`.
- **14i — Data export:** CSV export of jobs, contacts, photos. Routes `/settings/export`, `/api/settings/export`.

No migration files specifically tagged 14h/14i — both reuse existing tables (reports, photos, contacts).

## Source

- Commit: `16d2b29 Build 14h + 14i: Report defaults and data export`
- Components: [src/components/report-template-builder.tsx](../../../src/components/report-template-builder.tsx), [src/components/report-pdf-document.tsx](../../../src/components/report-pdf-document.tsx)
- Guide: v1.4 §Builds 14h–14i
