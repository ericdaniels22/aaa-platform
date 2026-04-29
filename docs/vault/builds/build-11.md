---
build_id: 11
title: Photo crop & annotation tool
status: shipped
phase: core
started: null
shipped: null
guide_doc: "v1.3 §Build 11"
plan_file: null
handoff: null
related: ["[[build-1-10]]", "[[build-31]]"]
---

#status/shipped #area/core #area/photos #build/11

## What shipped

Photo annotator and crop tool built on Fabric.js v7. UI-only — no DB changes. Long iteration series (~30 commits) ending in the labeled-arrow + crop-overlay implementation:

- **Crop tool** with dark overlay, grid lines, floating panel, backup/restore original; cropped image saves back to Supabase Storage.
- **Arrow tool** with draggable endpoint handles, attached text labels (perpendicular to shaft, smart placement above/below), real-time preview, multi-arrow selection, locked label-to-arrow grouping.
- Components: [src/components/photo-annotator.tsx](../../../src/components/photo-annotator.tsx), [src/components/photo-detail.tsx](../../../src/components/photo-detail.tsx).

## Source

- Commit range: `3dd7ce0` (first crop tool improvement) through `4b7f260` (final arrow rendering fix) — roughly 30 commits in the initial worktree.
- No migration; uses tables from [[build-1-10]].
- Guide: v1.3 §Build 11 (.docx, not in repo)
