---
table: photos
type: supabase
created_in: build-1-10
related_builds: ["[[build-1-10]]", "[[build-11]]", "[[build-31]]", "[[build-18a]]"]
---

#data-source #area/photos

# `photos`

Job photos with annotation support (built on Fabric.js — see [[build-11]]).

## Created in

- [supabase/schema-photos.sql](../../../supabase/schema-photos.sql) — `photos`, `photo_tags`, `photo_annotations`, plus storage bucket policy. `photo_annotations.fabric_data jsonb` stores Fabric.js scene state.

## Altered by

- **[[build-11]]** — saves cropped versions back to Supabase Storage; arrow tool annotations stored in `fabric_data`.
- **[[build-31]]** — photos tab redesign (no schema change but heavy I/O via `/api/jobs/[id]/photos`).
- **[[build-18a]]** — `organization_id` (build43 nullable → build44 backfill → build45 NOT NULL + FK).

## RLS

- **18b:** `tenant_isolation_photos` keyed on `organization_id`.

## Used by

`/photos`, photo detail modal, photo annotator, job detail Photos tab, reports (PDF generation), bulk download (JSZip), Jarvis (`get_job_details` returns recent photos).
