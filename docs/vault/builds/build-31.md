---
build_id: 31
title: Job-detail insurance redesign + photos tab redesign
status: shipped
phase: jobs
started: null
shipped: null
guide_doc: null
plan_file: docs/superpowers/plans/2026-04-12-job-detail-insurance-redesign.md
handoff: null
related: ["[[build-30]]", "[[build-11]]"]
---

#status/shipped #area/jobs #build/31

## What shipped

Two coordinated job-detail redesigns shipped under the build31 migration:

- **Insurance redesign:** 3-column layout, multi-adjuster support, in-place insurance editing.
- **Photos tab redesign:** dedicated tab with date grouping, filters, bulk actions (delete/tag/download via JSZip), infinite scroll. Removes the photo preview from the Overview tab.

- **Migration:** [supabase/migration-build31-insurance-redesign.sql](../../../supabase/migration-build31-insurance-redesign.sql).
- **Routes:** `/api/jobs/[id]/photos` (with bulk endpoints).
- **Components:** [src/components/job-detail/](../../../src/components/job-detail/), [src/components/job-photos-tab.tsx](../../../src/components/job-photos-tab.tsx).

## Source

- Commit range (insurance): `dbc4a3b` (spec) → `b37f4ba` (3-column redesign)
- Commit range (photos): `3aeb08d` (spec) → `280c4ed` (remove old preview)
- Plans: [docs/superpowers/plans/2026-04-12-job-detail-insurance-redesign.md](../../../docs/superpowers/plans/2026-04-12-job-detail-insurance-redesign.md), [docs/superpowers/plans/2026-04-12-job-photos-tab.md](../../../docs/superpowers/plans/2026-04-12-job-photos-tab.md)
- Migration: [supabase/migration-build31-insurance-redesign.sql](../../../supabase/migration-build31-insurance-redesign.sql)
- Guide: none
