# Job Files Section — Design

**Date:** 2026-04-10
**Status:** Approved, pending implementation plan

## Overview

Add a "Files" section to the job detail page that lets users view, upload (drag-drop or button), preview, rename, and delete arbitrary documents attached to a job. Files live in a new private Supabase storage bucket and a new `job_files` table. All I/O goes through new API routes that use the service role, matching the existing `email-attachments` pattern.

This is a sibling section to the existing Photos section — photos stay where they are; this section holds everything else (contracts, estimates, invoices, PDFs, spreadsheets, etc.).

## Requirements

- View a list of files attached to a job
- Upload files via drag-and-drop anywhere on the section, or via an "Upload Files" button
- Download any file
- Preview PDFs inline in a modal; non-PDFs fall back to "not previewable"
- Rename a file (display name only)
- Delete a file (with confirm)
- No file type restrictions, no size cap
- Files are private — access via short-lived signed URLs

## Data Model

### New table: `job_files`

| Column         | Type         | Notes                                                       |
|----------------|--------------|-------------------------------------------------------------|
| `id`           | uuid         | primary key, default `gen_random_uuid()`                    |
| `job_id`       | uuid         | references `jobs(id)` on delete cascade, not null           |
| `filename`     | text         | display name; user-editable via rename                      |
| `storage_path` | text         | immutable path inside the bucket, unique                    |
| `size_bytes`   | bigint       | file size at upload time                                    |
| `mime_type`    | text         | used to pick icon and decide preview vs. download           |
| `created_at`   | timestamptz  | default `now()`                                             |

Index: `(job_id, created_at desc)` to support the list query.

Storage path convention: `job-files/{job_id}/{uuid}-{original_filename}`. The UUID prefix guarantees uniqueness even if the same filename is uploaded twice. Display name is decoupled from the path so renames are a cheap `UPDATE`.

### New storage bucket: `job-files`

- Private (`public = false`)
- Policy: allow all ops via service role only, matching `email-attachments`
- Created via `supabase/migration-build30-job-files.sql` (next sequential migration per the project convention)

No RLS on the `job_files` table — all reads/writes flow through API routes that authenticate using `SUPABASE_SERVICE_ROLE_KEY`. This is consistent with how `photos`, `email-attachments`, and other existing tables in this codebase are accessed.

### Cascade behavior

`ON DELETE CASCADE` on `job_id` removes table rows when a job is deleted. Storage objects are not automatically removed — they become orphaned, same as `photos` and `email-attachments` today. Acceptable trade-off; batch cleanup can be added later if it becomes a problem.

## API Routes

All routes live under `src/app/api/jobs/[id]/files/`. Each uses the server Supabase client with the service role key, matching existing `/api/jobs/...` routes in this codebase.

### `POST /api/jobs/[id]/files`

- Body: `multipart/form-data` with one or more `file` fields
- For each file:
  1. Generate `storage_path = job-files/{job_id}/{uuid}-{original_filename}`
  2. Upload to the `job-files` bucket via service role
  3. Insert row into `job_files` (filename, storage_path, size_bytes, mime_type)
- Returns `{ succeeded: JobFile[], failed: { filename: string, error: string }[] }`
- Status: `200` if all succeed, `207` if partial, `500` if none
- Accepts multiple files in one request so a drag-drop of N files is one round trip

### `GET /api/jobs/[id]/files`

- Returns `JobFile[]` ordered by `created_at desc`
- Called by the `JobFiles` component on mount and after mutations

### `GET /api/jobs/[id]/files/[fileId]/url`

- Returns `{ url: string, expiresAt: string }`
- Calls `supabase.storage.from('job-files').createSignedUrl(path, 600)` (10-minute expiry)
- Fetched on demand when the user clicks Download or opens Preview — URLs are never embedded in initial page HTML

### `PATCH /api/jobs/[id]/files/[fileId]`

- Body: `{ filename: string }`
- Validation: trim, reject empty, cap at 255 chars
- Updates the `filename` column only; storage path is untouched
- Returns the updated row

### `DELETE /api/jobs/[id]/files/[fileId]`

- Order of operations: delete storage object first, then delete the DB row
- If storage delete fails, leave the row intact and return 500 so the client can retry
- Inverse ordering (row gone, object orphaned) would be worse — chosen ordering avoids phantom rows pointing at dead paths only on the failure path, which a retry fixes

## UI Components

### `src/components/job-files.tsx`

- The section card, rendered inside `job-detail.tsx`
- Props: `{ jobId: string }`
- Owns state: `files`, `uploading`, `dragOver`, `renamingId`, `previewFile`
- Manages its own fetch via the API routes (keeps `job-detail.tsx` from growing — it's already 1165 lines)

#### Layout

Matches the Photos section shell: `bg-card rounded-xl border border-border p-5 mb-6`. Header row has a `Paperclip` lucide icon, `Files ({count})` title, and a gradient `+ Upload Files` button on the right styled identically to the existing Photos upload button.

#### Drag-and-drop

The card body is the drop target. `onDragEnter` sets `dragOver: true`, which paints an overlay (`absolute inset-0 border-2 border-dashed border-primary bg-primary/5 rounded-lg`) with "Drop files to upload" text. `onDrop` triggers the upload flow. Matches the pattern already in `photo-upload.tsx`.

#### File list

Simple rows, not a grid. Each row:

```
[icon] filename.pdf              2.4 MB · Apr 10, 2026    [⋯]
```

- Icon picked from MIME type: `FileText` (PDF), `FileSpreadsheet` (xlsx/csv), `File` fallback
- Click on the row → Preview (PDFs) or Download (everything else)
- `⋯` menu: Download, Rename, Delete

#### Empty state

Mirrors Photos: centered icon, "No files yet.", "Drop files here or click Upload Files above."

#### Rename (inline)

Click Rename → filename text swaps for an `<input>`. Enter or blur saves via PATCH. Escape cancels. Optimistic update; revert on server error.

#### Delete (with confirm)

Small `Dialog` → "Delete {filename}? This cannot be undone." Cancel/Delete buttons. Calls DELETE. No undo / no trash.

#### Upload progress

Per-file inline rows during upload: `Loader2` spinner + filename + "Uploading…". When the response comes back, the row swaps into the real list (or is removed with a toast on failure). No percentage bar — the existing photo upload doesn't have one either, and `fetch` doesn't expose upload progress without dropping to XHR.

### `src/components/job-file-preview.tsx`

- Props: `{ file: JobFile | null, open: boolean, onOpenChange: (open: boolean) => void }`
- For PDFs (`mime_type === 'application/pdf'`): renders a large `Dialog` with `<iframe src={signedUrl}>` at ~80vh
- For non-PDFs: shows "Preview not available for this file type" with a Download button
- Signed URL is fetched when the modal opens and discarded when it closes

### Integration into `job-detail.tsx`

Add `<JobFiles jobId={jobId} />` between the Photos section and the Reports section. No changes to the existing fetch logic in `job-detail.tsx` — `JobFiles` manages its own data independently.

## Error Handling & Edge Cases

- **Partial upload failure** — per-file, not all-or-nothing. Server returns 207 with `{ succeeded, failed }`. Client shows success toast for the winners and error toast listing the failures. The list updates with whatever succeeded.
- **Signed URL expiry** — 10 minutes. Per-click generation for downloads makes expiry irrelevant there. For the preview iframe, if it's open past 10 minutes, refresh the URL on next interaction.
- **Rename validation** — trim whitespace, reject empty, cap at 255 chars. Extension not enforced — if the user renames `foo.pdf` to `bar`, MIME type in the DB still drives preview/icon behavior.
- **Delete race** — storage first, then row. If storage delete fails, row stays, user can retry. The inverse failure (orphaned object but no row) is silent and worse, so we avoid it.
- **Job cascade** — `ON DELETE CASCADE` removes rows; bucket objects become orphaned, same as today's Photos behavior.

## Testing

Per project memory: no test framework (no jest/vitest/playwright). Verification is manual preview + `tsc --noEmit`.

Manual verification checklist:

1. Upload a single file via button
2. Upload multiple files via button
3. Upload via drag-and-drop (single and multiple)
4. Download each of: PDF, DOCX, XLSX
5. Preview a PDF (opens in modal iframe, closes cleanly)
6. Preview a non-PDF (shows fallback with Download button)
7. Rename inline (save on Enter, save on blur, cancel on Escape)
8. Delete with confirm dialog
9. Empty state renders correctly on a job with no files
10. Partial upload failure surfaces a useful toast (force with an oversized or malformed file)
11. `tsc --noEmit` clean after the change

## Out of Scope

- File categories/tags
- Per-file descriptions or notes
- "Uploaded by" display
- Versioning
- Bulk download / zip
- Search across files
- Trash / undo delete
- Non-PDF preview (Word, Excel, etc.)
- Orphan cleanup job for deleted files on storage
- Upload progress percentage

## File Changes

New files:
- `supabase/migration-build30-job-files.sql`
- `src/app/api/jobs/[id]/files/route.ts` — POST + GET
- `src/app/api/jobs/[id]/files/[fileId]/route.ts` — PATCH + DELETE
- `src/app/api/jobs/[id]/files/[fileId]/url/route.ts` — GET signed URL
- `src/components/job-files.tsx`
- `src/components/job-file-preview.tsx`

Modified files:
- `src/lib/types.ts` — add `JobFile` type
- `src/components/job-detail.tsx` — render `<JobFiles jobId={jobId} />` between Photos and Reports
