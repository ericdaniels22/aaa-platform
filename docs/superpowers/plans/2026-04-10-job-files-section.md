# Job Files Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Files" section to the job detail page that lets users view, upload (drag-drop + button), preview, rename, and delete arbitrary documents attached to a job.

**Architecture:** New `job_files` table and private `job-files` Supabase storage bucket. All I/O flows through new API routes under `src/app/api/jobs/[id]/files/`, matching the existing `email-attachments` pattern. A new `JobFiles` component owns its own state and is embedded in `job-detail.tsx` between the Photos and Reports sections.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres + Storage), Tailwind, shadcn/ui, lucide-react.

**Spec:** `docs/superpowers/specs/2026-04-10-job-files-section-design.md`

**Context for the engineer:**
- This is an internal CRM. Jobs are restoration-industry projects.
- `job-detail.tsx` is the big job page (~1165 lines). It has existing sections for Photos, Reports, Payments, Emails. The new section lives there.
- The project has **no test framework** (no jest/vitest/playwright). "Tests" = manual preview + `tsc --noEmit`. Do not add jest/vitest, do not write `.test.ts` files.
- Migration convention: `supabase/migration-build<NN>-<name>.sql`, sequential, applied manually by the developer in the Supabase SQL editor. Next is **build30**. Not idempotent unless the existing migrations use `IF NOT EXISTS`.
- There are 39 pre-existing `tsc` errors in `jarvis/neural-network`. Ignore them — only worry about errors you introduce.
- API routes use `createApiClient()` from `src/lib/supabase-api.ts` — this is the anon key. The bucket policy is permissive enough that anon ops work, matching `email-attachments`.
- Supabase Storage signed URLs: `supabase.storage.from(bucket).createSignedUrl(path, ttlSeconds)` returns `{ data: { signedUrl }, error }`.

---

## File Structure

**New files:**
- `supabase/migration-build30-job-files.sql` — table + bucket + policy
- `src/app/api/jobs/[id]/files/route.ts` — `POST` (upload) + `GET` (list)
- `src/app/api/jobs/[id]/files/[fileId]/route.ts` — `PATCH` (rename) + `DELETE`
- `src/app/api/jobs/[id]/files/[fileId]/url/route.ts` — `GET` signed URL
- `src/components/job-files.tsx` — section card with list, drag-drop, upload, rename, delete
- `src/components/job-file-preview.tsx` — modal for PDF preview / download fallback

**Modified files:**
- `src/lib/types.ts` — add `JobFile` interface
- `src/components/job-detail.tsx` — import and render `<JobFiles jobId={jobId} />` between Photos and Reports sections

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migration-build30-job-files.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migration-build30-job-files.sql`:

```sql
-- Build 30: job_files table + job-files storage bucket
--
-- Adds a "Files" section to the job detail page. Sibling of the Photos
-- section — this holds arbitrary documents (contracts, estimates,
-- invoices, PDFs, spreadsheets, etc.) that aren't photos.
--
-- All I/O goes through the /api/jobs/[id]/files/* API routes; the
-- bucket policy matches email-attachments (permissive; API routes are
-- the only caller).

-- 1. Table
CREATE TABLE job_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  filename      text NOT NULL,
  storage_path  text NOT NULL UNIQUE,
  size_bytes    bigint NOT NULL,
  mime_type     text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_files_job_id_created_at
  ON job_files (job_id, created_at DESC);

-- 2. Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-files', 'job-files', false)
ON CONFLICT (id) DO NOTHING;

-- 3. Bucket policy (matches email-attachments — API routes are the only caller)
CREATE POLICY "Allow all on job-files"
  ON storage.objects FOR ALL
  USING (bucket_id = 'job-files')
  WITH CHECK (bucket_id = 'job-files');
```

- [ ] **Step 2: Apply the migration in Supabase**

The developer must run this in the Supabase SQL editor (per project convention — migrations are applied manually). Paste the contents of `supabase/migration-build30-job-files.sql` into the SQL editor and run it.

Expected: no errors; `job_files` table appears in the `public` schema; `job-files` bucket appears in Storage.

- [ ] **Step 3: Verify in psql / SQL editor**

Run in the Supabase SQL editor:

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'job_files'
ORDER BY ordinal_position;
```

Expected rows: `id | uuid`, `job_id | uuid`, `filename | text`, `storage_path | text`, `size_bytes | bigint`, `mime_type | text`, `created_at | timestamp with time zone`.

Then:

```sql
SELECT id, name, public FROM storage.buckets WHERE id = 'job-files';
```

Expected: one row `job-files | job-files | false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-build30-job-files.sql
git commit -m "feat(db): add job_files table + job-files storage bucket"
```

---

## Task 2: Add `JobFile` type

**Files:**
- Modify: `src/lib/types.ts` (insert new interface after `EmailAttachment` around line 202)

- [ ] **Step 1: Add the type**

Open `src/lib/types.ts`. After the `EmailAttachment` interface (line 194–202), add:

```typescript
export interface JobFile {
  id: string;
  job_id: string;
  filename: string;
  storage_path: string;
  size_bytes: number;
  mime_type: string;
  created_at: string;
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no new errors (there are 39 pre-existing errors in `jarvis/neural-network` — ignore those; only worry about new ones from this change).

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add JobFile interface"
```

---

## Task 3: `POST` + `GET` route — upload and list

**Files:**
- Create: `src/app/api/jobs/[id]/files/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/jobs/[id]/files/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";
import { randomUUID } from "crypto";

// GET /api/jobs/[id]/files — list files for a job
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;
  const supabase = createApiClient();

  const { data, error } = await supabase
    .from("job_files")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

// POST /api/jobs/[id]/files — upload one or more files
// Returns { succeeded: JobFile[], failed: { filename: string, error: string }[] }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;
  const formData = await request.formData();
  const files = formData.getAll("file") as File[];

  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const supabase = createApiClient();
  const succeeded: unknown[] = [];
  const failed: { filename: string; error: string }[] = [];

  for (const file of files) {
    try {
      const uuid = randomUUID();
      const storagePath = `${jobId}/${uuid}-${file.name}`;

      const arrayBuffer = await file.arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from("job-files")
        .upload(storagePath, arrayBuffer, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });

      if (uploadError) {
        failed.push({ filename: file.name, error: uploadError.message });
        continue;
      }

      const { data: row, error: insertError } = await supabase
        .from("job_files")
        .insert({
          job_id: jobId,
          filename: file.name,
          storage_path: storagePath,
          size_bytes: file.size,
          mime_type: file.type || "application/octet-stream",
        })
        .select()
        .single();

      if (insertError) {
        // Roll back the storage upload so we don't orphan the object
        await supabase.storage.from("job-files").remove([storagePath]);
        failed.push({ filename: file.name, error: insertError.message });
        continue;
      }

      succeeded.push(row);
    } catch (e) {
      failed.push({
        filename: file.name,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  // 200 = all good, 207 = partial, 500 = all failed
  const status =
    failed.length === 0 ? 200 : succeeded.length === 0 ? 500 : 207;

  return NextResponse.json({ succeeded, failed }, { status });
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Manually test `GET` with curl**

Start the dev server if it's not running (use `preview_start`). Then:

```bash
curl http://localhost:3000/api/jobs/<any-real-job-id>/files
```

Expected: `[]` (empty array — there are no files yet).

- [ ] **Step 4: Manually test `POST` with curl**

```bash
curl -X POST http://localhost:3000/api/jobs/<any-real-job-id>/files \
  -F "file=@/path/to/any/test.pdf"
```

Expected: `{"succeeded":[{"id":"...","job_id":"...","filename":"test.pdf",...}],"failed":[]}`.

Then re-run the `GET` — it should now return the file you just uploaded.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/jobs/[id]/files/route.ts
git commit -m "feat(api): job files list and upload routes"
```

---

## Task 4: `PATCH` + `DELETE` route — rename and delete

**Files:**
- Create: `src/app/api/jobs/[id]/files/[fileId]/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/jobs/[id]/files/[fileId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

// PATCH /api/jobs/[id]/files/[fileId] — rename
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const { fileId } = await params;

  const body = await request.json().catch(() => null);
  const rawFilename = typeof body?.filename === "string" ? body.filename : "";
  const filename = rawFilename.trim();

  if (!filename) {
    return NextResponse.json({ error: "Filename is required" }, { status: 400 });
  }
  if (filename.length > 255) {
    return NextResponse.json(
      { error: "Filename must be 255 characters or fewer" },
      { status: 400 }
    );
  }

  const supabase = createApiClient();

  const { data, error } = await supabase
    .from("job_files")
    .update({ filename })
    .eq("id", fileId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// DELETE /api/jobs/[id]/files/[fileId] — delete storage object, then row
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const { fileId } = await params;
  const supabase = createApiClient();

  // 1. Look up storage_path
  const { data: row, error: lookupError } = await supabase
    .from("job_files")
    .select("storage_path")
    .eq("id", fileId)
    .single();

  if (lookupError || !row) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  // 2. Delete storage object first
  const { error: storageError } = await supabase.storage
    .from("job-files")
    .remove([row.storage_path]);

  if (storageError) {
    return NextResponse.json(
      { error: `Storage delete failed: ${storageError.message}` },
      { status: 500 }
    );
  }

  // 3. Delete row (if this fails, the object is already gone — acceptable;
  //    the next list fetch will still show the row and user can retry)
  const { error: deleteError } = await supabase
    .from("job_files")
    .delete()
    .eq("id", fileId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Manually test `PATCH`**

Using a real file id from Task 3's upload:

```bash
curl -X PATCH http://localhost:3000/api/jobs/<job-id>/files/<file-id> \
  -H "Content-Type: application/json" \
  -d '{"filename":"renamed.pdf"}'
```

Expected: JSON with `filename: "renamed.pdf"`. Verify by re-running the `GET` list route.

- [ ] **Step 4: Manually test `DELETE`**

```bash
curl -X DELETE http://localhost:3000/api/jobs/<job-id>/files/<file-id>
```

Expected: `{"ok":true}`. Verify with `GET` that the file is gone from the list, and verify in Supabase Storage that the object is gone from the bucket.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/jobs/[id]/files/[fileId]/route.ts
git commit -m "feat(api): job file rename and delete routes"
```

---

## Task 5: `GET` signed URL route

**Files:**
- Create: `src/app/api/jobs/[id]/files/[fileId]/url/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/jobs/[id]/files/[fileId]/url/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

// GET /api/jobs/[id]/files/[fileId]/url — short-lived signed URL
// Returns { url: string, expiresAt: string }
// The URL is "inline" (no forced Content-Disposition: attachment) so the
// same URL works for both iframe preview (PDFs) and direct download via
// an <a download> link on the client. Do NOT pass the `download` option
// to createSignedUrl — that forces Content-Disposition: attachment and
// breaks iframe preview.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const { fileId } = await params;
  const supabase = createApiClient();

  const { data: row, error: lookupError } = await supabase
    .from("job_files")
    .select("storage_path")
    .eq("id", fileId)
    .single();

  if (lookupError || !row) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from("job-files")
    .createSignedUrl(row.storage_path, 600);

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Failed to create signed URL" },
      { status: 500 }
    );
  }

  const expiresAt = new Date(Date.now() + 600 * 1000).toISOString();
  return NextResponse.json({ url: data.signedUrl, expiresAt });
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Manually test**

Upload a file first (if you don't have one from earlier tasks, use the curl from Task 3 step 4). Then:

```bash
curl http://localhost:3000/api/jobs/<job-id>/files/<file-id>/url
```

Expected: `{"url":"https://<project>.supabase.co/storage/v1/object/sign/job-files/...","expiresAt":"..."}`.

Open the returned `url` in a browser — for a PDF it should render in the browser tab. For a DOCX it should download (browsers can't render Office formats).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/jobs/[id]/files/[fileId]/url/route.ts
git commit -m "feat(api): signed URL endpoint for job files"
```

---

## Task 6: `JobFilePreview` modal component

**Files:**
- Create: `src/components/job-file-preview.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/job-file-preview.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { JobFile } from "@/lib/types";
import { Download, Loader2, FileWarning } from "lucide-react";

export default function JobFilePreview({
  jobId,
  file,
  open,
  onOpenChange,
}: {
  jobId: string;
  file: JobFile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPdf = file?.mime_type === "application/pdf";

  useEffect(() => {
    if (!open || !file) {
      setUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/jobs/${jobId}/files/${file.id}/url`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
        } else {
          setUrl(data.url);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, file, jobId]);

  function handleDownload() {
    if (!url || !file) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b border-border">
          <DialogTitle className="truncate pr-8">
            {file?.filename || "File"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 flex items-center justify-center bg-muted/30">
          {loading && (
            <Loader2 className="animate-spin text-muted-foreground" size={32} />
          )}
          {!loading && error && (
            <div className="text-center p-8">
              <FileWarning
                className="mx-auto text-muted-foreground/50 mb-2"
                size={40}
              />
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          )}
          {!loading && !error && url && isPdf && (
            <iframe
              src={url}
              title={file?.filename || "PDF preview"}
              className="w-full h-full"
            />
          )}
          {!loading && !error && url && !isPdf && (
            <div className="text-center p-8">
              <FileWarning
                className="mx-auto text-muted-foreground/50 mb-2"
                size={40}
              />
              <p className="text-sm text-muted-foreground mb-4">
                Preview not available for this file type.
              </p>
              <Button onClick={handleDownload}>
                <Download size={14} className="mr-2" />
                Download
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/job-file-preview.tsx
git commit -m "feat(ui): job file preview modal"
```

---

## Task 7: `JobFiles` section component

**Files:**
- Create: `src/components/job-files.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/job-files.tsx`:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { JobFile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Paperclip,
  Download,
  Pencil,
  Trash2,
  MoreVertical,
  Loader2,
  File as FileIcon,
  FileText,
  FileSpreadsheet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import JobFilePreview from "@/components/job-file-preview";

interface UploadingFile {
  id: string;
  filename: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function iconForMime(mime: string) {
  if (mime === "application/pdf") return FileText;
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime === "text/csv"
  )
    return FileSpreadsheet;
  if (mime.startsWith("text/") || mime.includes("document")) return FileText;
  return FileIcon;
}

export default function JobFiles({ jobId }: { jobId: string }) {
  const [files, setFiles] = useState<JobFile[]>([]);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [previewFile, setPreviewFile] = useState<JobFile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    const res = await fetch(`/api/jobs/${jobId}/files`);
    if (!res.ok) return;
    const data = await res.json();
    setFiles(data);
  }, [jobId]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const arr = Array.from(fileList);
      if (arr.length === 0) return;

      const placeholders: UploadingFile[] = arr.map((f) => ({
        id: `${Date.now()}-${Math.random()}-${f.name}`,
        filename: f.name,
      }));
      setUploading((prev) => [...prev, ...placeholders]);

      const formData = new FormData();
      for (const f of arr) formData.append("file", f);

      try {
        const res = await fetch(`/api/jobs/${jobId}/files`, {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (data.succeeded?.length) {
          toast.success(
            data.succeeded.length === 1
              ? "File uploaded"
              : `${data.succeeded.length} files uploaded`
          );
        }
        if (data.failed?.length) {
          toast.error(
            `Failed to upload: ${data.failed
              .map((f: { filename: string }) => f.filename)
              .join(", ")}`
          );
        }

        await fetchFiles();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading((prev) =>
          prev.filter((u) => !placeholders.some((p) => p.id === u.id))
        );
      }
    },
    [jobId, fetchFiles]
  );

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      uploadFiles(e.target.files);
      e.target.value = "";
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    if (e.currentTarget === e.target) setDragOver(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  }

  async function handleRowClick(file: JobFile) {
    if (file.mime_type === "application/pdf") {
      setPreviewFile(file);
    } else {
      await downloadFile(file);
    }
  }

  async function downloadFile(file: JobFile) {
    try {
      const res = await fetch(`/api/jobs/${jobId}/files/${file.id}/url`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const a = document.createElement("a");
      a.href = data.url;
      a.download = file.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  }

  function startRename(file: JobFile) {
    setRenamingId(file.id);
    setRenameValue(file.filename);
  }

  async function saveRename(file: JobFile) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === file.filename) {
      setRenamingId(null);
      return;
    }
    setRenamingId(null);
    // Optimistic
    setFiles((prev) =>
      prev.map((f) => (f.id === file.id ? { ...f, filename: trimmed } : f))
    );
    try {
      const res = await fetch(`/api/jobs/${jobId}/files/${file.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Rename failed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rename failed");
      // Revert
      await fetchFiles();
    }
  }

  async function confirmDelete(file: JobFile) {
    setDeleteTarget(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/files/${file.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Delete failed");
      }
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      toast.success("File deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-foreground">
          <Paperclip size={16} className="inline mr-2 -mt-0.5" />
          Files ({files.length})
        </h3>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 bg-[image:var(--gradient-primary)] text-white shadow-sm hover:brightness-110 hover:shadow-md transition-colors"
        >
          + Upload Files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative rounded-lg transition-colors",
          dragOver && "bg-primary/5"
        )}
      >
        {dragOver && (
          <div className="absolute inset-0 border-2 border-dashed border-primary rounded-lg flex items-center justify-center bg-primary/5 pointer-events-none z-10">
            <p className="text-sm font-medium text-primary">
              Drop files to upload
            </p>
          </div>
        )}

        {files.length === 0 && uploading.length === 0 ? (
          <div className="text-center py-8">
            <Paperclip
              size={40}
              className="mx-auto text-muted-foreground/40 mb-2"
            />
            <p className="text-sm text-muted-foreground/60">No files yet.</p>
            <p className="text-xs text-muted-foreground/40 mt-1">
              Drop files here or click Upload Files above.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {uploading.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 py-2.5 px-2 text-sm"
              >
                <Loader2
                  size={18}
                  className="animate-spin text-muted-foreground flex-shrink-0"
                />
                <span className="flex-1 truncate text-muted-foreground">
                  {u.filename}
                </span>
                <span className="text-xs text-muted-foreground">
                  Uploading…
                </span>
              </li>
            ))}
            {files.map((file) => {
              const Icon = iconForMime(file.mime_type);
              const isRenaming = renamingId === file.id;
              return (
                <li
                  key={file.id}
                  className="group flex items-center gap-3 py-2.5 px-2 text-sm hover:bg-accent/50 rounded transition-colors"
                >
                  <Icon
                    size={18}
                    className="text-muted-foreground flex-shrink-0"
                  />
                  {isRenaming ? (
                    <Input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => saveRename(file)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRename(file);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="h-7 flex-1"
                    />
                  ) : (
                    <button
                      onClick={() => handleRowClick(file)}
                      className="flex-1 min-w-0 text-left truncate hover:underline"
                    >
                      {file.filename}
                    </button>
                  )}
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {formatSize(file.size_bytes)} ·{" "}
                    {format(new Date(file.created_at), "MMM d, yyyy")}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
                      >
                        <MoreVertical size={14} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => downloadFile(file)}>
                        <Download size={14} className="mr-2" />
                        Download
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => startRename(file)}>
                        <Pencil size={14} className="mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setDeleteTarget(file)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 size={14} className="mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <JobFilePreview
        jobId={jobId}
        file={previewFile}
        open={!!previewFile}
        onOpenChange={(open) => {
          if (!open) setPreviewFile(null);
        }}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete file</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete <span className="font-medium text-foreground">{deleteTarget?.filename}</span>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && confirmDelete(deleteTarget)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Verify the dropdown-menu component exists**

```bash
ls src/components/ui/dropdown-menu.tsx
```

If it doesn't exist, add it via shadcn: `npx shadcn@latest add dropdown-menu`. (This CRM uses shadcn/ui — the CLI is already configured if `src/components/ui/` has other shadcn components.)

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/job-files.tsx
git commit -m "feat(ui): JobFiles section component"
```

---

## Task 8: Integrate `JobFiles` into `job-detail.tsx`

**Files:**
- Modify: `src/components/job-detail.tsx` — add import and render between Photos and Reports

- [ ] **Step 1: Add the import**

Open `src/components/job-detail.tsx`. Near the other component imports (around lines 17–23, which import `ActivityTimeline`, `RecordPaymentModal`, `PhotoUploadModal`, etc.), add:

```typescript
import JobFiles from "@/components/job-files";
```

- [ ] **Step 2: Render the component between Photos and Reports**

Find the closing of the Photos/PhotoAnnotator block (around line 628 — the `</PhotoAnnotator>` / end of annotator wrapper) and the start of the Reports block (around line 630 — `{/* Reports */}`).

Insert between them:

```tsx
      <JobFiles jobId={jobId} />
```

So the order becomes: Photos section → PhotoDetailModal → PhotoAnnotator → **JobFiles** → Reports section.

Verify the exact insertion point by searching for `{/* Reports */}` in the file — insert the `<JobFiles />` line immediately before that comment.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/job-detail.tsx
git commit -m "feat(ui): add JobFiles section to job detail page"
```

---

## Task 9: Manual verification in preview

**Files:**
- None (verification only)

- [ ] **Step 1: Start the dev server**

Use `preview_start` with the existing launch config (or create one if `.claude/launch.json` doesn't exist — `npm run dev`, default port).

- [ ] **Step 2: Open a job detail page**

Navigate to `/jobs/<any-real-job-id>` in the preview.

- [ ] **Step 3: Verify empty state**

Expected: Files section card appears between Photos and Reports. Header shows "Files (0)" with a `+ Upload Files` button. Body shows the empty state: Paperclip icon, "No files yet.", "Drop files here or click Upload Files above."

Take a screenshot with `preview_screenshot` to confirm layout.

- [ ] **Step 4: Upload a single file via button**

Click `+ Upload Files`, select a small PDF. Expected: brief "Uploading…" row, then the file appears in the list with filename, size, and date. Toast: "File uploaded". Header updates to "Files (1)".

- [ ] **Step 5: Upload multiple files via button**

Click `+ Upload Files`, select 3 files (mix of PDF, DOCX, XLSX). Expected: all three appear. Toast: "3 files uploaded". Header updates to "Files (4)".

- [ ] **Step 6: Upload via drag-and-drop**

Drag a file from the OS into the Files section card. Expected: dashed-border overlay appears during drag, file uploads on drop, appears in the list.

- [ ] **Step 7: Preview a PDF**

Click a PDF row. Expected: modal opens, spinner briefly, then PDF renders in an iframe at ~80vh. Close the modal — it closes cleanly.

- [ ] **Step 8: Click a non-PDF row**

Click a DOCX row. Expected: browser downloads the file with its original filename (not `<uuid>-filename.docx`).

- [ ] **Step 9: Use the `⋯` menu Download**

Hover a row, click `⋯`, click Download. Expected: file downloads.

- [ ] **Step 10: Rename a file**

`⋯` → Rename. Expected: filename swaps to an input box, autofocused. Type a new name, press Enter. Expected: filename updates, no page refresh, `tsc --noEmit` still clean. Re-rename another file and press Escape — expect the rename to cancel with no changes.

- [ ] **Step 11: Delete a file**

`⋯` → Delete. Expected: confirm dialog appears with "Delete filename.pdf? This cannot be undone." Click Cancel — file stays. Click Delete again and confirm — file disappears from the list, toast: "File deleted". Verify in Supabase Storage that the object is gone from the bucket.

- [ ] **Step 12: Check browser console for errors**

Use `preview_console_logs` with `level: "error"`. Expected: no errors from the files flows. (Pre-existing unrelated errors are fine.)

- [ ] **Step 13: Run the final typecheck**

```bash
npx tsc --noEmit
```

Expected: same number of errors as baseline (39 in `jarvis/neural-network`), no new ones.

- [ ] **Step 14: Take a final screenshot**

Use `preview_screenshot` with a job that has multiple files uploaded, to capture the finished state for the PR description.

---

## Out of scope (do not add)

Per the spec, do not implement any of the following — they are deliberately excluded:

- File categories or tags
- Per-file descriptions
- "Uploaded by" display
- Versioning
- Bulk download / zip
- Search across files
- Trash / undo delete
- Non-PDF preview (Word, Excel, etc.)
- Orphan cleanup job
- Upload progress percentage
