---
build_id: 1-10
title: Phase 1 platform (Builds 1–10)
status: shipped
phase: core
started: null
shipped: null
guide_doc: "v1.3 §Builds 1–10"
plan_file: null
handoff: null
related: ["[[build-11]]", "[[build-12]]"]
---

#status/shipped #area/core #build/1-10

## What shipped

Initial Phase 1 platform — committed as a single bundle (`ec28e05 Initial commit: AAA Disaster Recovery Platform (Builds 1-10)`). Covers the foundational tables and surfaces:

- **Schema:** [supabase/schema.sql](../../../supabase/schema.sql) (contacts, jobs, job_number_seq, activities, etc.) and [supabase/schema-photos.sql](../../../supabase/schema-photos.sql) (photos, annotations).
- **Routes:** `/jobs`, `/jobs/[id]`, `/contacts`, `/photos`, `/intake`, `/login`, `/logout`.
- **Job number generator:** `WTR-YYYY-NNNN` / `FIR-YYYY-NNNN` etc., damage-type prefixed, sequence resets yearly (function `generate_job_number(damage)`).
- **Damage types:** water, fire, mold, storm, biohazard, contents, rebuild.
- **Contact roles:** homeowner, tenant, property_manager, adjuster, insurance.

The exact split of sub-builds 1 through 10 is documented in v1.3 of the build guide doc and is not recoverable from the repo alone — git history starts at the bundled commit.

## Source

- Commit: `ec28e05 Initial commit: AAA Disaster Recovery Platform (Builds 1-10)`
- Schema: [supabase/schema.sql](../../../supabase/schema.sql)
- Photos schema: [supabase/schema-photos.sql](../../../supabase/schema-photos.sql)
- Guide: v1.3 §Builds 1–10 (.docx, not in repo)
