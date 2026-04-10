# Email System Improvements

**Date:** 2026-04-09
**Scope:** Resizable panes, bulk actions, sync performance, auto-sync on load

## 1. Resizable Panes

### Current State
`EmailInbox` uses a 3-column layout with fixed Tailwind widths: `w-52` (208px) folder sidebar, `w-96` (384px) email list, `flex-1` reader pane.

### Design
Add draggable resize handles between each column pair (sidebar|list, list|reader).

**ResizeHandle component:** A 4px-wide vertical div rendered between columns. On `mousedown`, attaches `mousemove`/`mouseup` listeners to `document` to track drag delta and update the adjacent column width.

**State:** Two numeric state values in `EmailInbox`: `sidebarWidth` (default 208) and `listWidth` (default 384). Persisted to `localStorage` key `email-pane-widths` as JSON. Reader pane remains `flex-1` (takes remaining space).

**Constraints:**
- Sidebar: min 160px, max 300px
- Email list: min 280px, max 600px
- Reader: no explicit width (flex-1)

**Styling:** `cursor: col-resize` on handle. Subtle `bg-border` on hover, transparent by default. During drag, apply `select-none` to the parent container to prevent text selection.

**Files changed:**
- `src/components/email-inbox.tsx` — replace fixed `w-52`/`w-96` with inline `style={{ width }}`, add `ResizeHandle` between columns, add width state + localStorage persistence

## 2. Bulk Actions

### Selection Model
Add a `selectedIds: Set<string>` state to `EmailInbox`. Each `EmailRow` gets a checkbox as an independent click target (clicking the row still opens the email as before).

**Select-all checkbox** in the email list header selects/deselects all emails on the current page.

### Bulk Action Bar
When `selectedIds.size > 0`, render a toolbar at the top of the email list (overlays the existing "X emails (Y unread)" header). Contains:
- "N selected" label
- "Mark read" / "Mark unread" button (toggles based on majority state of selected)
- "Archive" button
- "Delete" button
- "Assign to job" button — opens a small dropdown with a search input. Queries `/api/email/contacts` (or a dedicated job-search endpoint) to find jobs by number or address. Selecting a job assigns all selected emails.
- "Cancel" / deselect-all button (X icon)

### New API Endpoint
`PATCH /api/email/bulk`

Request body:
```json
{
  "ids": ["uuid1", "uuid2"],
  "action": "mark_read" | "mark_unread" | "archive" | "trash" | "assign_job",
  "jobId": "uuid"  // only for assign_job
}
```

Implementation: Single Supabase `.update().in("id", ids)` call. For `archive`, sets `folder = "archive"`. For `trash`, sets `folder = "trash"`. For `mark_read`/`mark_unread`, sets `is_read`. For `assign_job`, sets `job_id`.

Returns `{ updated: number }`.

### UX Details
- Checkbox is a separate click target from the email row. Row click always opens email.
- "Select all" selects visible page only.
- After bulk action: clear selection, refresh email list + folder counts.
- Keyboard: no keyboard shortcuts in this iteration.

### Job Picker for Bulk Assign
Inline dropdown rendered below the "Assign to job" button. Contains:
- Search input (auto-focused)
- List of matching jobs (fetched from `/api/jobs?search=...&limit=10`)
- Each result shows job_number + property_address
- Click a job to execute the bulk assign

### New Job Search Endpoint
The job picker needs a lightweight search endpoint. No jobs API currently exists.

`GET /api/jobs/search?q=...&limit=10`

Queries `jobs` table with `ilike` on `job_number` and `property_address`. Returns `{ jobs: { id, job_number, property_address }[] }`.

**Files changed:**
- `src/components/email-inbox.tsx` — add selection state, checkboxes in `EmailRow`, bulk action bar, job picker dropdown
- `src/app/api/email/bulk/route.ts` — new endpoint
- `src/app/api/jobs/search/route.ts` — new job search endpoint for job picker

## 3. Sync Performance

### Current Bottlenecks
1. `matchEmailToJob()` fetches ALL jobs + ALL contacts from DB per email (2 queries x N emails)
2. Dedup check (`select.eq("message_id")`) runs per message (1 query x N emails)
3. Email inserts are individual (1 insert x N emails)

### Optimizations

**A. Pre-fetch job matching data**
Before the folder loop, fetch jobs and contacts once:
```
const jobs = await supabase.from("jobs").select(...)
const contacts = await supabase.from("contacts").select(...)
```
Pass `{ jobs, contacts }` to `matchEmailToJob()` instead of `supabase`. Change function signature from `(supabase, email, accountEmail)` to `(cache, email, accountEmail)` where cache is `{ jobs: JobRow[], contacts: ContactRow[] }`.

**B. Batch dedup**
Before processing each folder's messages, fetch all known message_ids for that account+folder:
```
const { data } = await supabase.from("emails")
  .select("message_id")
  .eq("account_id", accountId)
  .eq("folder", folder);
const knownIds = new Set(data.map(e => e.message_id));
```
Then check `knownIds.has(messageId)` in-memory instead of per-message DB query.

**C. Batch inserts**
Collect all parsed emails for a folder into an array, then do a single `.insert([...batch])`. Process attachment saves after the batch insert using the returned IDs.

### Query Reduction
Before: ~300+ DB queries for 100 emails across 5 folders
After: ~15 queries (1 jobs + 1 contacts + 5 dedup fetches + 5 batch inserts + attachment saves)

**Files changed:**
- `src/lib/email-matcher.ts` — change `matchEmailToJob` to accept pre-loaded cache instead of supabase client
- `src/app/api/email/sync/route.ts` — pre-fetch cache, batch dedup, batch inserts

## 4. Auto-Sync on Page Load

### Behavior
When `EmailInbox` mounts and accounts finish loading, automatically trigger sync for all active accounts. Uses the same `handleSync()` logic (shows spinning icon, toasts result).

### Debounce
Check `last_synced_at` from account data. If the most recent sync across all accounts was less than 60 seconds ago, skip auto-sync. This prevents hammering the server on rapid page navigations (e.g., navigating away and back).

### Implementation
Add a `useEffect` that fires after `accounts` state is populated. Checks the 60-second debounce, then calls `handleSync()`.

**Files changed:**
- `src/components/email-inbox.tsx` — add auto-sync useEffect after accounts load
