---
build_id: 66
title: Soft-delete jobs + 30-day trash
status: shipped
phase: jobs
started: null
shipped: null
guide_doc: null
plan_file: null
handoff: null
related: ["[[build-1-10]]", "[[build-66a]]"]
---

#status/shipped #area/jobs #build/66

## What shipped

Soft-delete for jobs with a 30-day trash window before permanent purge. Independent feature work that — by coincidence of the global migration counter — landed under "build66" while the Knowledge Vault meta-spec also chose **Build 66** as its label. They are unrelated; see [[00-glossary]] for the convention.

- **Migration:** [supabase/migration-build66-soft-delete-jobs.sql](../../../supabase/migration-build66-soft-delete-jobs.sql).
- **Routes:** `/api/jobs/[id]/delete`, `/api/jobs/[id]/restore`, `/api/jobs/trash`.

## Source

- Commit: `9b91f14 feat: soft-delete jobs with 30-day trash + permanent purge (#37)`
- Migration: [supabase/migration-build66-soft-delete-jobs.sql](../../../supabase/migration-build66-soft-delete-jobs.sql)
- Guide: none
