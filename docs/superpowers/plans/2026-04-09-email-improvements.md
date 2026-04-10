# Email Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add resizable panes, bulk actions, sync performance optimizations, and auto-sync on load to the email inbox.

**Architecture:** Four independent improvements to the email system. Resizable panes and bulk actions modify `email-inbox.tsx`. Sync perf changes `email-matcher.ts` and `sync/route.ts`. Two new API routes added (`/api/email/bulk`, `/api/jobs/search`). Auto-sync is a small addition to the inbox component.

**Tech Stack:** Next.js 16, React 19, Supabase, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-09-email-improvements-design.md`

---

## Task 1: Resizable Panes

**Files:**
- Modify: `src/components/email-inbox.tsx`

- [ ] **Step 1: Add resize state and localStorage persistence**

At the top of `EmailInbox`, add width state with localStorage initialization:

```tsx
// Inside EmailInbox component, after existing state declarations:

// Resizable pane widths
const [sidebarWidth, setSidebarWidth] = useState(() => {
  if (typeof window === "undefined") return 208;
  try {
    const saved = localStorage.getItem("email-pane-widths");
    if (saved) return JSON.parse(saved).sidebar ?? 208;
  } catch {}
  return 208;
});
const [listWidth, setListWidth] = useState(() => {
  if (typeof window === "undefined") return 384;
  try {
    const saved = localStorage.getItem("email-pane-widths");
    if (saved) return JSON.parse(saved).list ?? 384;
  } catch {}
  return 384;
});

// Persist widths to localStorage
useEffect(() => {
  try {
    localStorage.setItem(
      "email-pane-widths",
      JSON.stringify({ sidebar: sidebarWidth, list: listWidth })
    );
  } catch {}
}, [sidebarWidth, listWidth]);
```

Add `useRef` to the imports at the top of the file (it's not currently imported).

- [ ] **Step 2: Add ResizeHandle component**

Add this component above `EmailRow` (at the bottom of the file, before the `EmailRow` function):

```tsx
function ResizeHandle({
  onResize,
}: {
  onResize: (delta: number) => void;
}) {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const parent = (e.target as HTMLElement).closest(".flex");
    if (parent) parent.classList.add("select-none");

    const handleMouseMove = (moveEvent: MouseEvent) => {
      onResize(moveEvent.clientX - startX);
    };

    const handleMouseUp = () => {
      if (parent) parent.classList.remove("select-none");
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      className="w-1 shrink-0 cursor-col-resize hover:bg-primary/20 transition-colors"
    />
  );
}
```

Note: This basic approach calls `onResize` with cumulative delta on every mouse move. The parent needs to track the starting width and clamp. We'll handle that in the next step.

- [ ] **Step 3: Wire resize handles into the layout**

Replace the 3-column layout section. Find this in the return JSX:

```tsx
{/* 3-column layout */}
<div className="flex flex-1 overflow-hidden">
  {/* Column 1: Folder sidebar */}
  <div className="w-52 border-r border-border bg-muted/50 shrink-0 flex flex-col">
```

Replace the opening of the 3-column layout and the sidebar div's className:

Change `<div className="w-52 border-r border-border bg-muted/50 shrink-0 flex flex-col">` to:
```tsx
<div style={{ width: sidebarWidth }} className="border-r border-border bg-muted/50 shrink-0 flex flex-col">
```

After the sidebar closing `</div>` and before the email list column, add the first resize handle:

```tsx
<ResizeHandle
  onResize={(delta) => {
    setSidebarWidth((prev) => Math.min(300, Math.max(160, prev + delta)));
  }}
/>
```

Change the email list column from:
```tsx
<div
  className={`w-96 border-r border-border flex flex-col bg-card shrink-0 ${
    selectedEmailId ? "hidden lg:flex" : "flex"
  }`}
>
```
to:
```tsx
<div
  style={{ width: listWidth }}
  className={`border-r border-border flex flex-col bg-card shrink-0 ${
    selectedEmailId ? "hidden lg:flex" : "flex"
  }`}
>
```

After the email list column closing `</div>` and before the reading pane column, add the second resize handle:

```tsx
<ResizeHandle
  onResize={(delta) => {
    setListWidth((prev) => Math.min(600, Math.max(280, prev + delta)));
  }}
/>
```

- [ ] **Step 4: Fix ResizeHandle to use ref-based tracking**

The basic delta approach above has a problem: each `mousemove` gives cumulative delta from `startX`, but `onResize` receives it as if it's incremental. Fix the `ResizeHandle` to track properly:

Replace the `ResizeHandle` component with:

```tsx
function ResizeHandle({
  onResize,
}: {
  onResize: (delta: number) => void;
}) {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    let lastX = e.clientX;
    const parent = (e.target as HTMLElement).closest(".flex");
    if (parent) parent.classList.add("select-none");

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - lastX;
      lastX = moveEvent.clientX;
      onResize(delta);
    };

    const handleMouseUp = () => {
      if (parent) parent.classList.remove("select-none");
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      className="w-1 shrink-0 cursor-col-resize hover:bg-primary/20 transition-colors"
    />
  );
}
```

The key difference: `lastX` tracks the previous position, so `delta` is incremental per move event.

- [ ] **Step 5: Verify resizable panes work**

Run: `npm run dev`

Open the email page at `/email`. Verify:
1. Sidebar is 208px wide, email list is 384px wide
2. Hovering the divider between sidebar and list shows a subtle highlight and col-resize cursor
3. Dragging the divider resizes the sidebar (min 160px, max 300px)
4. Dragging the divider between list and reader resizes the list (min 280px, max 600px)
5. Refresh the page — widths persist from localStorage

- [ ] **Step 6: Commit**

```bash
git add src/components/email-inbox.tsx
git commit -m "feat(email): add resizable panes with drag handles and localStorage persistence"
```

---

## Task 2: Bulk Actions API

**Files:**
- Create: `src/app/api/email/bulk/route.ts`

- [ ] **Step 1: Create the bulk endpoint**

Create `src/app/api/email/bulk/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

// PATCH /api/email/bulk — bulk update emails
// Body: { ids: string[], action: "mark_read" | "mark_unread" | "archive" | "trash" | "assign_job", jobId?: string }
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { ids, action, jobId } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array is required" }, { status: 400 });
  }

  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const supabase = createApiClient();
  let updates: Record<string, unknown> = {};

  switch (action) {
    case "mark_read":
      updates = { is_read: true };
      break;
    case "mark_unread":
      updates = { is_read: false };
      break;
    case "archive":
      updates = { folder: "archive" };
      break;
    case "trash":
      updates = { folder: "trash" };
      break;
    case "assign_job":
      if (!jobId) {
        return NextResponse.json({ error: "jobId required for assign_job" }, { status: 400 });
      }
      updates = { job_id: jobId, matched_by: "manual" };
      break;
    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  const { error, count } = await supabase
    .from("emails")
    .update(updates)
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ updated: count ?? ids.length });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/email/bulk/route.ts
git commit -m "feat(email): add bulk actions API endpoint"
```

---

## Task 3: Job Search API

**Files:**
- Create: `src/app/api/jobs/search/route.ts`

- [ ] **Step 1: Create the job search endpoint**

Create `src/app/api/jobs/search/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

// GET /api/jobs/search?q=...&limit=10
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") || "";
  const limit = parseInt(searchParams.get("limit") || "10");

  const supabase = createApiClient();

  let query = supabase
    .from("jobs")
    .select("id, job_number, property_address")
    .not("status", "eq", "cancelled")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (q) {
    query = query.or(
      `job_number.ilike.%${q}%,property_address.ilike.%${q}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ jobs: data || [] });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/jobs/search/route.ts
git commit -m "feat(jobs): add job search API endpoint for job picker"
```

---

## Task 4: Bulk Actions UI — Selection Model

**Files:**
- Modify: `src/components/email-inbox.tsx`

- [ ] **Step 1: Add selection state**

In `EmailInbox`, after the existing state declarations, add:

```tsx
// Bulk selection
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

function toggleSelect(id: string) {
  setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

function toggleSelectAll() {
  if (selectedIds.size === emails.length) {
    setSelectedIds(new Set());
  } else {
    setSelectedIds(new Set(emails.map((e) => e.id)));
  }
}

function clearSelection() {
  setSelectedIds(new Set());
}
```

Also clear selection when folder, account, search, or page changes. In `handleFolderChange`:

```tsx
function handleFolderChange(key: string) {
  setFolder(key);
  setPage(1);
  setSelectedEmailId(null);
  setSelectedIds(new Set());
}
```

And add a `useEffect` to clear selection when `loadEmails` dependencies change:

```tsx
// Clear selection when navigating
useEffect(() => {
  setSelectedIds(new Set());
}, [folder, selectedAccountId, searchDebounced, page]);
```

- [ ] **Step 2: Add checkboxes to EmailRow**

Update the `EmailRow` component signature to accept selection props:

```tsx
function EmailRow({
  email,
  isSelected,
  isChecked,
  folder,
  onSelect,
  onStar,
  onToggleCheck,
}: {
  email: Email;
  isSelected: boolean;
  isChecked: boolean;
  folder: string;
  onSelect: () => void;
  onStar: () => void;
  onToggleCheck: () => void;
}) {
```

In the `EmailRow` return JSX, add a checkbox before the star button. Find:

```tsx
{/* Star */}
<button
  onClick={(e) => {
    e.stopPropagation();
    onStar();
  }}
  className="mt-0.5 shrink-0"
>
```

Add before it:

```tsx
{/* Checkbox */}
<input
  type="checkbox"
  checked={isChecked}
  onChange={(e) => {
    e.stopPropagation();
    onToggleCheck();
  }}
  onClick={(e) => e.stopPropagation()}
  className="mt-1 shrink-0 rounded border-border accent-primary"
/>
```

Update the `EmailRow` usage in the `emails.map` call:

```tsx
emails.map((email) => (
  <EmailRow
    key={email.id}
    email={email}
    isSelected={email.id === selectedEmailId}
    isChecked={selectedIds.has(email.id)}
    folder={folder}
    onSelect={() => handleSelectEmail(email)}
    onStar={() =>
      handleStarToggle(email.id, !email.is_starred)
    }
    onToggleCheck={() => toggleSelect(email.id)}
  />
))
```

- [ ] **Step 3: Add select-all checkbox to list header**

In the list header section, find:

```tsx
<div className="px-4 py-2 border-b border-border/50 text-xs text-muted-foreground/60 flex items-center justify-between">
  <span>
    {total} email{total !== 1 ? "s" : ""}
```

Replace with:

```tsx
<div className="px-4 py-2 border-b border-border/50 text-xs text-muted-foreground/60 flex items-center justify-between">
  <span className="flex items-center gap-2">
    <input
      type="checkbox"
      checked={emails.length > 0 && selectedIds.size === emails.length}
      onChange={toggleSelectAll}
      className="rounded border-border accent-primary"
    />
    {total} email{total !== 1 ? "s" : ""}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/email-inbox.tsx
git commit -m "feat(email): add bulk selection model with checkboxes"
```

---

## Task 5: Bulk Actions UI — Action Bar and Job Picker

**Files:**
- Modify: `src/components/email-inbox.tsx`

- [ ] **Step 1: Add bulk action handler and job picker state**

Add `X` to the existing lucide-react imports at the top of the file:

```tsx
import {
  // ... existing imports ...
  X,
} from "lucide-react";
```

In `EmailInbox`, after the selection functions from Task 4, add:

```tsx
// Bulk actions
const [bulkLoading, setBulkLoading] = useState(false);
const [jobPickerOpen, setJobPickerOpen] = useState(false);
const [jobSearch, setJobSearch] = useState("");
const [jobResults, setJobResults] = useState<{ id: string; job_number: string; property_address: string }[]>([]);

async function executeBulkAction(action: string, jobId?: string) {
  if (selectedIds.size === 0) return;
  setBulkLoading(true);
  try {
    const res = await fetch("/api/email/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selectedIds), action, jobId }),
    });
    if (!res.ok) throw new Error("Bulk action failed");
    const data = await res.json();
    toast.success(`Updated ${data.updated} email${data.updated !== 1 ? "s" : ""}`);
    clearSelection();
    loadEmails();
    loadCounts();
  } catch {
    toast.error("Bulk action failed");
  }
  setBulkLoading(false);
  setJobPickerOpen(false);
}

// Debounced job search for picker
useEffect(() => {
  if (!jobPickerOpen || jobSearch.length < 1) {
    setJobResults([]);
    return;
  }
  const timer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/jobs/search?q=${encodeURIComponent(jobSearch)}&limit=8`);
      const data = await res.json();
      setJobResults(data.jobs || []);
    } catch {
      setJobResults([]);
    }
  }, 250);
  return () => clearTimeout(timer);
}, [jobSearch, jobPickerOpen]);
```

- [ ] **Step 2: Add bulk action bar to the list header**

Replace the entire list header `<div>` (the one with "X emails (Y unread)") with a conditional that shows the action bar when emails are selected:

```tsx
{/* List header / Bulk action bar */}
<div className="px-4 py-2 border-b border-border/50 text-xs text-muted-foreground/60 flex items-center justify-between">
  {selectedIds.size > 0 ? (
    <>
      <span className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={selectedIds.size === emails.length}
          onChange={toggleSelectAll}
          className="rounded border-border accent-primary"
        />
        <span className="font-medium text-foreground">
          {selectedIds.size} selected
        </span>
      </span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => {
            const allRead = emails
              .filter((e) => selectedIds.has(e.id))
              .every((e) => e.is_read);
            executeBulkAction(allRead ? "mark_unread" : "mark_read");
          }}
          disabled={bulkLoading}
          className="px-2 py-1 rounded hover:bg-accent disabled:opacity-50"
          title="Toggle read/unread"
        >
          <MailCheck size={14} />
        </button>
        <button
          onClick={() => executeBulkAction("archive")}
          disabled={bulkLoading}
          className="px-2 py-1 rounded hover:bg-accent disabled:opacity-50"
          title="Archive"
        >
          <Archive size={14} />
        </button>
        <button
          onClick={() => executeBulkAction("trash")}
          disabled={bulkLoading}
          className="px-2 py-1 rounded hover:bg-accent disabled:opacity-50"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
        <div className="relative">
          <button
            onClick={() => {
              setJobPickerOpen(!jobPickerOpen);
              setJobSearch("");
              setJobResults([]);
            }}
            disabled={bulkLoading}
            className="px-2 py-1 rounded hover:bg-accent disabled:opacity-50"
            title="Assign to job"
          >
            <Briefcase size={14} />
          </button>
          {jobPickerOpen && (
            <div className="absolute right-0 top-full mt-1 w-72 bg-card border border-border rounded-lg shadow-lg z-50 p-2">
              <input
                type="text"
                placeholder="Search jobs..."
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
                autoFocus
                className="w-full px-2 py-1.5 text-sm border border-border rounded mb-1 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="max-h-48 overflow-y-auto">
                {jobResults.length === 0 && jobSearch.length > 0 && (
                  <p className="text-xs text-muted-foreground/60 px-2 py-2">No jobs found</p>
                )}
                {jobResults.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => executeBulkAction("assign_job", job.id)}
                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded flex items-center gap-2"
                  >
                    <span className="font-medium text-primary">{job.job_number}</span>
                    <span className="truncate text-muted-foreground">{job.property_address}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <button
          onClick={clearSelection}
          className="px-2 py-1 rounded hover:bg-accent ml-1"
          title="Clear selection"
        >
          <X size={14} />
        </button>
      </div>
    </>
  ) : (
    <>
      <span className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={emails.length > 0 && selectedIds.size === emails.length}
          onChange={toggleSelectAll}
          className="rounded border-border accent-primary"
        />
        {total} email{total !== 1 ? "s" : ""}
        {folder !== "starred" && counts[folder]?.unread
          ? ` (${counts[folder].unread} unread)`
          : ""}
      </span>
      <div className="flex items-center gap-2">
        {counts[folder]?.unread > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="flex items-center gap-1 text-primary hover:underline"
            title="Mark all as read"
          >
            <MailCheck size={12} />
            Mark all read
          </button>
        )}
        {hasMore && (
          <button
            onClick={() => setPage((p) => p + 1)}
            className="text-primary hover:underline"
          >
            Load more
          </button>
        )}
      </div>
    </>
  )}
</div>
```

- [ ] **Step 3: Close job picker on outside click**

Add a ref and effect to close the job picker when clicking outside. After the `jobResults` state:

```tsx
const jobPickerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (!jobPickerOpen) return;
  function handleClickOutside(e: MouseEvent) {
    if (jobPickerRef.current && !jobPickerRef.current.contains(e.target as Node)) {
      setJobPickerOpen(false);
    }
  }
  document.addEventListener("mousedown", handleClickOutside);
  return () => document.removeEventListener("mousedown", handleClickOutside);
}, [jobPickerOpen]);
```

Then wrap the job picker `<div className="relative">` with `ref={jobPickerRef}`:

```tsx
<div className="relative" ref={jobPickerRef}>
```

- [ ] **Step 4: Verify bulk actions work**

Run: `npm run dev`

Open `/email`. Verify:
1. Checkboxes appear on each email row
2. Clicking a checkbox doesn't open the email
3. Select-all checkbox works
4. When 1+ selected, the action bar appears with read/archive/delete/assign buttons
5. "Mark read" toggles selected emails' read state
6. "Archive" moves selected emails to archive folder
7. "Delete" moves selected emails to trash
8. "Assign to job" opens a dropdown, searching for jobs works, selecting one assigns
9. Selection clears after any bulk action
10. Selection clears when changing folders

- [ ] **Step 5: Commit**

```bash
git add src/components/email-inbox.tsx
git commit -m "feat(email): add bulk action bar with job picker"
```

---

## Task 6: Sync Performance — Refactor Email Matcher

**Files:**
- Modify: `src/lib/email-matcher.ts`

- [ ] **Step 1: Add cache type and refactor matchEmailToJob**

Replace the entire contents of `src/lib/email-matcher.ts`:

```ts
interface MatchResult {
  job_id: string;
  matched_by: "contact" | "claim_number" | "address" | "job_id";
}

export interface JobRow {
  id: string;
  job_number: string;
  claim_number: string | null;
  property_address: string;
  contact_id: string;
  adjuster_contact_id: string | null;
}

export interface ContactRow {
  id: string;
  email: string | null;
}

export interface MatcherCache {
  jobs: JobRow[];
  contacts: ContactRow[];
}

/**
 * Try to match an email to a job using pre-loaded cache.
 * Returns the first match found, or null if no match.
 *
 * Priority:
 * 1. Job number in subject (e.g. WTR-2026-0001)
 * 2. Contact email address match
 * 3. Claim number in subject or body
 * 4. Property address in subject or body
 */
export function matchEmailToJob(
  cache: MatcherCache,
  email: { from_address: string; to_addresses: { email: string }[]; subject: string; body_text: string | null },
  accountEmail: string
): MatchResult | null {
  const { jobs, contacts } = cache;

  if (jobs.length === 0) return null;

  const searchText = `${email.subject} ${email.body_text || ""}`.toLowerCase();

  // 1. Match by job number in subject (most precise)
  const jobNumberMatch = jobs.find((job) => {
    return email.subject.toUpperCase().includes(job.job_number.toUpperCase());
  });
  if (jobNumberMatch) {
    return { job_id: jobNumberMatch.id, matched_by: "job_id" };
  }

  // 2. Match by contact email
  if (contacts.length > 0) {
    const firstTo = email.to_addresses?.[0]?.email || "";
    const otherEmail = email.from_address.toLowerCase() === accountEmail.toLowerCase()
      ? firstTo.toLowerCase()
      : email.from_address.toLowerCase();

    const matchedContact = contacts.find(
      (c) => c.email && c.email.toLowerCase() === otherEmail
    );

    if (matchedContact) {
      const job = jobs.find(
        (j) =>
          j.contact_id === matchedContact.id ||
          j.adjuster_contact_id === matchedContact.id
      );
      if (job) {
        return { job_id: job.id, matched_by: "contact" };
      }
    }
  }

  // 3. Match by claim number in subject or body
  const claimMatch = jobs.find((job) => {
    if (!job.claim_number) return false;
    return searchText.includes(job.claim_number.toLowerCase());
  });
  if (claimMatch) {
    return { job_id: claimMatch.id, matched_by: "claim_number" };
  }

  // 4. Match by property address in subject or body
  const addressMatch = jobs.find((job) => {
    if (!job.property_address) return false;
    const normalizedAddress = normalizeAddress(job.property_address);
    return normalizedAddress.length > 5 && searchText.includes(normalizedAddress);
  });
  if (addressMatch) {
    return { job_id: addressMatch.id, matched_by: "address" };
  }

  return null;
}

function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/\b(street|st|avenue|ave|boulevard|blvd|drive|dr|road|rd|lane|ln|court|ct|circle|cir|place|pl)\b\.?/g, "")
    .replace(/[,#.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
```

Key changes:
- Function is now synchronous (no DB calls)
- Accepts `MatcherCache` instead of `SupabaseClient`
- Removed `async` keyword
- Exported `JobRow`, `ContactRow`, `MatcherCache` types for use in sync route

- [ ] **Step 2: Commit**

```bash
git add src/lib/email-matcher.ts
git commit -m "refactor(email): make matchEmailToJob synchronous with pre-loaded cache"
```

---

## Task 7: Sync Performance — Batch Operations in Sync Route

**Files:**
- Modify: `src/app/api/email/sync/route.ts`

- [ ] **Step 1: Add cache pre-fetching**

In `src/app/api/email/sync/route.ts`, update the import:

Change:
```ts
import { matchEmailToJob } from "@/lib/email-matcher";
```
To:
```ts
import { matchEmailToJob, type MatcherCache, type JobRow, type ContactRow } from "@/lib/email-matcher";
```

After the IMAP `client.connect()` line and before the folder discovery, add cache pre-fetching:

```ts
await client.connect();

// Pre-fetch job matching cache (once for entire sync)
const { data: jobsData } = await supabase
  .from("jobs")
  .select("id, job_number, claim_number, property_address, contact_id, adjuster_contact_id")
  .not("status", "eq", "cancelled");

const jobs = (jobsData || []) as JobRow[];

const contactIds = new Set<string>();
for (const job of jobs) {
  contactIds.add(job.contact_id);
  if (job.adjuster_contact_id) contactIds.add(job.adjuster_contact_id);
}

let contacts: ContactRow[] = [];
if (contactIds.size > 0) {
  const { data: contactsData } = await supabase
    .from("contacts")
    .select("id, email")
    .in("id", Array.from(contactIds))
    .not("email", "is", null);
  contacts = (contactsData || []) as ContactRow[];
}

const matcherCache: MatcherCache = { jobs, contacts };

// Discover available folders
```

- [ ] **Step 2: Add batch dedup before folder processing**

Inside the `for (const folderPath of foldersToSync)` loop, after `const folder = mapFolder(folderPath);` and before the fetch range logic, add batch dedup:

```ts
const folder = mapFolder(folderPath);

// Batch fetch known message IDs for dedup
const { data: knownEmails } = await supabase
  .from("emails")
  .select("message_id")
  .eq("account_id", accountId)
  .eq("folder", folder);
const knownMessageIds = new Set((knownEmails || []).map((e: { message_id: string }) => e.message_id));
```

- [ ] **Step 3: Replace per-message dedup and insert with batch operations**

Replace the entire `for (const msg of messages)` loop with a batch-based approach:

```ts
// Parse all messages first
interface ParsedEmail {
  uid: number;
  messageId: string;
  threadId: string;
  fromAddr: string;
  fromName: string | null;
  toAddresses: { email: string; name?: string }[];
  ccAddresses: { email: string; name?: string }[];
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string | null;
  hasAttachments: boolean;
  receivedAt: Date;
  parsedAttachments: Attachment[];
}

const parsed: ParsedEmail[] = [];

for (const msg of messages) {
  try {
    const uid = msg.uid;
    if (uid > highestUid) highestUid = uid;

    const messageId = msg.envelope?.messageId || "uid-" + uid + "-" + folderPath;

    // In-memory dedup check
    if (knownMessageIds.has(messageId)) continue;

    let bodyText = "";
    let bodyHtml = "";
    let hasAttachments = false;
    let msgAttachments: Attachment[] = [];

    if (msg.source) {
      const parsedMsg = await simpleParser(msg.source);
      bodyText = parsedMsg.text || "";
      bodyHtml = typeof parsedMsg.html === "string" ? parsedMsg.html : "";
      msgAttachments = parsedMsg.attachments || [];
      hasAttachments = msgAttachments.length > 0;
    }

    if (!hasAttachments && msg.bodyStructure) {
      hasAttachments = checkAttachments(msg.bodyStructure);
    }

    const envelope = msg.envelope;
    if (!envelope) continue;

    const fromAddr = envelope.from?.[0]?.address || "";
    const fromName = envelope.from?.[0]?.name || "";
    const subject = envelope.subject || "";
    const date = envelope.date || new Date();

    const toAddresses = (envelope.to || []).map((a) => ({
      email: a.address || "",
      name: a.name || undefined,
    }));
    const ccAddresses = (envelope.cc || []).map((a) => ({
      email: a.address || "",
      name: a.name || undefined,
    }));

    const threadId = envelope.inReplyTo || messageId;
    const snippet = bodyText
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);

    parsed.push({
      uid,
      messageId,
      threadId,
      fromAddr,
      fromName: fromName || null,
      toAddresses,
      ccAddresses,
      subject,
      bodyText: bodyText || null,
      bodyHtml: bodyHtml || null,
      snippet: snippet || null,
      hasAttachments,
      receivedAt: date,
      parsedAttachments: msgAttachments,
    });
  } catch (msgErr) {
    errors.push(folderPath + ": " + (msgErr instanceof Error ? msgErr.message : "unknown"));
  }
}

// Batch insert emails
if (parsed.length > 0) {
  const rows = parsed.map((p) => {
    const match = matchEmailToJob(
      matcherCache,
      { from_address: p.fromAddr, to_addresses: p.toAddresses, subject: p.subject, body_text: p.bodyText },
      account.email_address
    );

    return {
      account_id: accountId,
      job_id: match?.job_id || null,
      message_id: p.messageId,
      thread_id: p.threadId,
      folder,
      from_address: p.fromAddr,
      from_name: p.fromName,
      to_addresses: p.toAddresses,
      cc_addresses: p.ccAddresses,
      bcc_addresses: [],
      subject: p.subject,
      body_text: p.bodyText,
      body_html: p.bodyHtml,
      snippet: p.snippet,
      is_read: folder === "sent" || folder === "drafts",
      is_starred: false,
      has_attachments: p.hasAttachments,
      matched_by: match?.matched_by || null,
      uid: p.uid,
      received_at: p.receivedAt,
    };
  });

  const { data: insertedEmails, error: insertError } = await supabase
    .from("emails")
    .insert(rows)
    .select("id, message_id");

  if (insertError) {
    errors.push(folderPath + " batch insert: " + insertError.message);
  } else if (insertedEmails) {
    totalSynced += insertedEmails.length;
    const matchedCount = rows.filter((r) => r.job_id).length;
    totalMatched += matchedCount;

    // Save attachments for emails that have them
    const emailIdByMessageId = new Map(
      insertedEmails.map((e: { id: string; message_id: string }) => [e.message_id, e.id])
    );

    for (const p of parsed) {
      if (p.parsedAttachments.length === 0) continue;
      const emailId = emailIdByMessageId.get(p.messageId);
      if (!emailId) continue;

      for (const att of p.parsedAttachments) {
        try {
          const storagePath = `${accountId}/${emailId}/${att.filename || "attachment"}`;
          await supabase.storage
            .from("email-attachments")
            .upload(storagePath, att.content, {
              contentType: att.contentType || "application/octet-stream",
              upsert: true,
            });
          await supabase.from("email_attachments").insert({
            email_id: emailId,
            filename: att.filename || "attachment",
            content_type: att.contentType || null,
            file_size: att.size || null,
            storage_path: storagePath,
          });
        } catch {
          // Non-fatal: skip attachment save errors
        }
      }
    }
  }
}
```

- [ ] **Step 4: Verify sync still works**

Run: `npm run dev`

Go to `/email`, click Sync. Verify:
1. No errors in terminal
2. Emails are synced correctly
3. Job matching still works (emails tagged with job numbers)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/email/sync/route.ts
git commit -m "perf(email): batch dedup, inserts, and pre-fetch cache for sync"
```

---

## Task 8: Auto-Sync on Page Load

**Files:**
- Modify: `src/components/email-inbox.tsx`

- [ ] **Step 1: Add auto-sync effect**

In `EmailInbox`, after the existing `loadCounts` effect, add:

```tsx
// Auto-sync on mount (debounced: skip if synced < 60s ago)
const hasAutoSynced = useRef(false);
useEffect(() => {
  if (hasAutoSynced.current || accounts.length === 0) return;
  hasAutoSynced.current = true;

  // Check if any account was synced recently
  const now = Date.now();
  const recentlySynced = accounts.some((acc) => {
    if (!acc.last_synced_at) return false;
    return now - new Date(acc.last_synced_at).getTime() < 60_000;
  });

  if (!recentlySynced) {
    handleSync();
  }
}, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps
```

The `hasAutoSynced` ref prevents re-triggering if `accounts` updates after sync. The eslint-disable is needed because we intentionally omit `handleSync` from deps (we only want this to run once when accounts load).

- [ ] **Step 2: Verify auto-sync works**

Run: `npm run dev`

Open `/email`. Verify:
1. Sync spinner activates automatically on page load
2. "Synced X new emails" toast appears
3. Navigate away and back — if < 60s passed, no auto-sync fires
4. If you wait > 60s and navigate back, auto-sync fires again

- [ ] **Step 3: Commit**

```bash
git add src/components/email-inbox.tsx
git commit -m "feat(email): auto-sync on page load with 60s debounce"
```
