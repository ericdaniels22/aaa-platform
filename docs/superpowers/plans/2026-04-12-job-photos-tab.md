# Job Photos Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the job detail page into Overview + Photos tabs, with a compact photo preview on Overview and a full-featured Photos tab with date grouping, filters, bulk selection, and infinite scroll.

**Architecture:** URL search param `?tab=overview|photos` controls tab state in `job-detail.tsx`. The Photos tab is a new `JobPhotosTab` component that manages its own paginated data fetching. Three new API routes handle bulk operations (delete, tag, download).

**Tech Stack:** Next.js (App Router), React, Supabase (client + API), date-fns, Tailwind CSS, JSZip (new dependency for bulk download)

---

### Task 1: Install JSZip dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install JSZip**

```bash
npm install jszip
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('jszip'); console.log('JSZip OK')"
```

Expected: `JSZip OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add jszip dependency for bulk photo download"
```

---

### Task 2: Add tab bar and split job-detail.tsx into Overview / Photos conditional render

**Files:**
- Modify: `src/components/job-detail.tsx`

This task adds the tab bar UI and wraps existing content in an Overview conditional. The Photos tab renders a placeholder until Task 3 builds the real component.

- [ ] **Step 1: Add `useSearchParams` import and tab state**

At the top of `src/components/job-detail.tsx`, add to the existing imports:

```typescript
import { useSearchParams, useRouter } from "next/navigation";
```

Inside the `JobDetail` component function (after the existing `useState` declarations around line 89), add:

```typescript
const searchParams = useSearchParams();
const router = useRouter();
const activeTab = searchParams.get("tab") || "overview";

const setActiveTab = (tab: string) => {
  const params = new URLSearchParams(searchParams.toString());
  if (tab === "overview") {
    params.delete("tab");
  } else {
    params.set("tab", tab);
  }
  router.push(`?${params.toString()}`, { scroll: false });
};
```

- [ ] **Step 2: Add the tab bar below the header**

In the return JSX, immediately after the closing `</div>` of the Header section (after the status `<select>` around line 262), and before the Info card comment `{/* Info card — 3 columns */}`, add:

```tsx
{/* Tab bar */}
<div className="flex gap-0 border-b-2 border-border mb-6">
  <button
    onClick={() => setActiveTab("overview")}
    className={cn(
      "px-6 py-2.5 text-sm font-medium -mb-[2px] border-b-2 transition-colors",
      activeTab === "overview"
        ? "text-[#2B5EA7] border-[#2B5EA7] font-semibold"
        : "text-muted-foreground border-transparent hover:text-foreground"
    )}
  >
    Overview
  </button>
  <button
    onClick={() => setActiveTab("photos")}
    className={cn(
      "px-6 py-2.5 text-sm font-medium -mb-[2px] border-b-2 transition-colors flex items-center gap-1.5",
      activeTab === "photos"
        ? "text-[#2B5EA7] border-[#2B5EA7] font-semibold"
        : "text-muted-foreground border-transparent hover:text-foreground"
    )}
  >
    Photos
    <span className={cn(
      "text-[11px] px-1.5 py-0 rounded-full",
      activeTab === "photos"
        ? "bg-[#dbeafe] text-[#2B5EA7]"
        : "bg-muted text-muted-foreground"
    )}>
      {photos.length}
    </span>
  </button>
</div>
```

- [ ] **Step 3: Wrap existing content in Overview conditional**

Wrap all content from the Info card (`{/* Info card — 3 columns */}` line 264) through the end of the ActivityTimeline (line 843) in an Overview conditional. The dialogs (EditJobInfoDialog, EditContactDialog, EditInsuranceDialog, AddAdjusterDialog) and the PhotoDetailModal/PhotoAnnotator stay outside the conditional since both tabs need them.

Replace the structure so it looks like:

```tsx
{/* Tab bar */}
{/* ... tab bar from step 2 ... */}

{activeTab === "overview" ? (
  <>
    {/* Info card — 3 columns */}
    {/* ... all existing content through ActivityTimeline ... */}
  </>
) : (
  <div className="text-center py-12 text-muted-foreground/60">
    Photos tab — coming in Task 3
  </div>
)}

{/* Dialogs — always rendered regardless of tab */}
<EditJobInfoDialog ... />
<EditContactDialog ... />
<EditInsuranceDialog ... />
<AddAdjusterDialog ... />

{/* Photo modals — always rendered regardless of tab */}
<PhotoDetailModal ... />
<PhotoAnnotator ... />
```

Important: Move the `PhotoUploadModal` from inside the photo section to outside the conditional (next to PhotoDetailModal), since both tabs may need to trigger uploads.

- [ ] **Step 4: Verify build compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | head -20
```

Expected: No new errors (pre-existing jarvis errors are fine to ignore).

- [ ] **Step 5: Commit**

```bash
git add src/components/job-detail.tsx
git commit -m "feat: add tab bar to job detail with Overview/Photos split"
```

---

### Task 3: Simplify photo preview in Overview tab

**Files:**
- Modify: `src/components/job-detail.tsx`

Replace the current full photo grid (lines 573-654) with a compact 8-column preview showing the 12 most recent.

- [ ] **Step 1: Replace the photo section in Overview**

Find the `{/* Photos */}` section inside the Overview conditional and replace the entire `<div className="bg-card rounded-xl border border-border p-5 mb-6">` block (that contains the photo grid and upload button) with:

```tsx
{/* Photo Preview */}
<div className="bg-card rounded-xl border border-border p-5 mb-6">
  <div className="flex items-center justify-between mb-3">
    <h3 className="text-base font-semibold text-foreground">
      <Camera size={16} className="inline mr-2 -mt-0.5" />
      Photos
    </h3>
    <div className="flex items-center gap-3">
      {photos.length > 0 && (
        <Link
          href={`/reports/new?jobId=${jobId}`}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium px-3 py-1.5 border border-gray-200 bg-white text-primary hover:bg-[#E8F0FE] transition-colors gap-1.5"
        >
          <FileText size={14} />
          Generate Report
        </Link>
      )}
      <button
        onClick={() => setActiveTab("photos")}
        className="text-sm font-medium text-[#2B5EA7] hover:underline"
      >
        View all {photos.length} photos →
      </button>
    </div>
  </div>
  {photos.length === 0 ? (
    <div className="text-center py-8">
      <ImageIcon size={40} className="mx-auto text-muted-foreground/40 mb-2" />
      <p className="text-sm text-muted-foreground/60">No photos yet.</p>
      <p className="text-xs text-muted-foreground/40 mt-1">
        Switch to the Photos tab to upload.
      </p>
    </div>
  ) : (
    <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1.5">
      {photos.slice(0, 12).map((photo) => (
        <button
          key={photo.id}
          onClick={() => setSelectedPhoto(photo)}
          className="aspect-square bg-muted rounded-md overflow-hidden"
        >
          <img
            src={`${supabaseUrl}/storage/v1/object/public/photos/${photo.annotated_path || photo.storage_path}`}
            alt={photo.caption || "Job photo"}
            className="w-full h-full object-cover"
          />
        </button>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 2: Verify build compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/components/job-detail.tsx
git commit -m "feat: replace photo grid with compact 8-col preview in Overview tab"
```

---

### Task 4: Build JobPhotosTab component — core grid with date grouping

**Files:**
- Create: `src/components/job-photos-tab.tsx`

This is the main new component. This task builds the paginated grid with date grouping and photo tiles. Filters and bulk actions come in later tasks.

- [ ] **Step 1: Create the component file**

Create `src/components/job-photos-tab.tsx`:

```tsx
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase";
import { Photo, PhotoTag } from "@/lib/types";
import { format } from "date-fns";
import { Loader2, Plus } from "lucide-react";
import PhotoUploadModal from "@/components/photo-upload";

interface JobPhotosTabProps {
  jobId: string;
  tags: PhotoTag[];
  supabaseUrl: string;
  onPhotosAdded: () => void;
  onPhotoUpdated: () => void;
  onSelectPhoto: (photo: Photo) => void;
}

const PAGE_SIZE = 50;

export default function JobPhotosTab({
  jobId,
  tags,
  supabaseUrl,
  onPhotosAdded,
  onPhotoUpdated,
  onSelectPhoto,
}: JobPhotosTabProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);

  // Filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [viewSize, setViewSize] = useState<"compact" | "comfortable">("compact");

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchPhotos = useCallback(async (offset: number, append: boolean) => {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);

    const supabase = createClient();
    let query = supabase
      .from("photos")
      .select("*, photo_tag_assignments(tag_id)")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (startDate) query = query.gte("created_at", startDate);
    if (endDate) query = query.lte("created_at", endDate + "T23:59:59");
    if (selectedUsers.length > 0) query = query.in("taken_by", selectedUsers);

    const { data } = await query;
    const fetched = (data || []) as Photo[];

    // Client-side tag filter (Supabase can't filter on joined table easily)
    let filtered = fetched;
    if (selectedTags.length > 0) {
      filtered = fetched.filter((p) => {
        const photoTagIds = ((p as Record<string, unknown>).photo_tag_assignments as { tag_id: string }[] | undefined)?.map((a) => a.tag_id) || [];
        return selectedTags.some((t) => photoTagIds.includes(t));
      });
    }

    if (append) {
      setPhotos((prev) => [...prev, ...filtered]);
    } else {
      setPhotos(filtered);
    }
    setHasMore(fetched.length === PAGE_SIZE);
    setLoading(false);
    setLoadingMore(false);
  }, [jobId, startDate, endDate, selectedUsers, selectedTags]);

  // Initial load + reset on filter change
  useEffect(() => {
    setPhotos([]);
    setHasMore(true);
    setSelectedIds(new Set());
    fetchPhotos(0, false);
  }, [fetchPhotos]);

  // Infinite scroll observer
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
          fetchPhotos(photos.length, true);
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, photos.length, fetchPhotos]);

  // Group photos by date
  const groupedPhotos = photos.reduce<{ date: string; label: string; photos: Photo[] }[]>(
    (groups, photo) => {
      const dateKey = format(new Date(photo.created_at), "yyyy-MM-dd");
      const existing = groups.find((g) => g.date === dateKey);
      if (existing) {
        existing.photos.push(photo);
      } else {
        groups.push({
          date: dateKey,
          label: format(new Date(photo.created_at), "EEEE, MMMM do, yyyy"),
          photos: [photo],
        });
      }
      return groups;
    },
    []
  );

  // Unique users for filter
  const uniqueUsers = [...new Set(photos.map((p) => p.taken_by))].sort();

  // Selection helpers
  const toggleSelect = (photoId: string, shiftKey: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedRef.current) {
        // Range select
        const allIds = photos.map((p) => p.id);
        const startIdx = allIds.indexOf(lastClickedRef.current);
        const endIdx = allIds.indexOf(photoId);
        if (startIdx !== -1 && endIdx !== -1) {
          const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          for (let i = lo; i <= hi; i++) next.add(allIds[i]);
        }
      } else {
        if (next.has(photoId)) next.delete(photoId);
        else next.add(photoId);
      }
      lastClickedRef.current = photoId;
      return next;
    });
  };

  const toggleGroupSelect = (groupPhotos: Photo[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const groupIds = groupPhotos.map((p) => p.id);
      const allSelected = groupIds.every((id) => next.has(id));
      if (allSelected) {
        groupIds.forEach((id) => next.delete(id));
      } else {
        groupIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const isGroupSelected = (groupPhotos: Photo[]) =>
    groupPhotos.length > 0 && groupPhotos.every((p) => selectedIds.has(p.id));

  const gridCols = viewSize === "compact"
    ? "grid-template-columns: repeat(auto-fill, minmax(120px, 1fr))"
    : "grid-template-columns: repeat(auto-fill, minmax(160px, 1fr))";

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2.5 mb-5 flex-wrap">
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          placeholder="Start Date"
          className="px-3 py-1.5 border border-border rounded-lg bg-card text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          placeholder="End Date"
          className="px-3 py-1.5 border border-border rounded-lg bg-card text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        {/* Users dropdown */}
        <div className="relative group">
          <button className="px-3 py-1.5 border border-border rounded-lg bg-card text-sm text-foreground flex items-center gap-1.5 hover:border-muted-foreground/40 transition-colors">
            Users {selectedUsers.length > 0 && `(${selectedUsers.length})`} ▾
          </button>
          <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[180px] z-50 hidden group-focus-within:block hover:block">
            {uniqueUsers.map((user) => (
              <label key={user} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded">
                <input
                  type="checkbox"
                  checked={selectedUsers.includes(user)}
                  onChange={() => {
                    setSelectedUsers((prev) =>
                      prev.includes(user) ? prev.filter((u) => u !== user) : [...prev, user]
                    );
                  }}
                  className="rounded"
                />
                {user}
              </label>
            ))}
            {uniqueUsers.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-1">No users yet</p>
            )}
          </div>
        </div>
        {/* Tags dropdown */}
        <div className="relative group">
          <button className="px-3 py-1.5 border border-border rounded-lg bg-card text-sm text-foreground flex items-center gap-1.5 hover:border-muted-foreground/40 transition-colors">
            Tags {selectedTags.length > 0 && `(${selectedTags.length})`} ▾
          </button>
          <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[200px] z-50 hidden group-focus-within:block hover:block">
            {tags.map((tag) => (
              <label key={tag.id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded">
                <input
                  type="checkbox"
                  checked={selectedTags.includes(tag.id)}
                  onChange={() => {
                    setSelectedTags((prev) =>
                      prev.includes(tag.id) ? prev.filter((t) => t !== tag.id) : [...prev, tag.id]
                    );
                  }}
                  className="rounded"
                />
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </label>
            ))}
          </div>
        </div>

        <div className="flex-1" />

        {/* View toggle */}
        <button
          onClick={() => setViewSize((v) => (v === "compact" ? "comfortable" : "compact"))}
          className="px-3 py-1.5 border border-border rounded-lg bg-card text-sm text-foreground hover:border-muted-foreground/40 transition-colors"
        >
          {viewSize === "compact" ? "Comfortable" : "Compact"}
        </button>

        {/* Upload */}
        <button
          onClick={() => setUploadOpen(true)}
          className="px-4 py-1.5 rounded-lg bg-[#2B5EA7] text-white text-sm font-semibold flex items-center gap-1.5 hover:bg-[#234b8a] transition-colors"
        >
          <Plus size={14} />
          Upload Photos
        </button>
      </div>

      <PhotoUploadModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        jobId={jobId}
        tags={tags}
        onPhotosAdded={() => {
          onPhotosAdded();
          fetchPhotos(0, false);
        }}
      />

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-[#2B5EA7] text-white rounded-xl mb-4 text-sm sticky top-0 z-40">
          <span className="font-semibold">{selectedIds.size} photos selected</span>
          <button
            className="px-3 py-1 border border-white/30 rounded-md hover:bg-white/15 transition-colors text-xs"
            onClick={() => {/* Task 6: bulk tag */}}
          >
            Tag
          </button>
          <button
            className="px-3 py-1 border border-white/30 rounded-md hover:bg-white/15 transition-colors text-xs"
            onClick={() => {/* Task 7: bulk download */}}
          >
            Download
          </button>
          <button
            className="px-3 py-1 border border-white/30 rounded-md hover:bg-white/15 transition-colors text-xs"
            onClick={() => {/* Task 5: bulk delete */}}
          >
            Delete
          </button>
          <div className="flex-1" />
          <button
            className="opacity-70 hover:opacity-100 transition-opacity text-xs"
            onClick={() => setSelectedIds(new Set())}
          >
            ✕ Clear
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : photos.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground">No photos found.</p>
          {(startDate || endDate || selectedUsers.length > 0 || selectedTags.length > 0) && (
            <button
              className="text-sm text-[#2B5EA7] hover:underline mt-2"
              onClick={() => {
                setStartDate("");
                setEndDate("");
                setSelectedUsers([]);
                setSelectedTags([]);
              }}
            >
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        <div>
          {groupedPhotos.map((group) => (
            <div key={group.date} className="mb-6">
              {/* Date header */}
              <div className="flex items-center gap-2.5 mb-3">
                <input
                  type="checkbox"
                  checked={isGroupSelected(group.photos)}
                  onChange={() => toggleGroupSelect(group.photos)}
                  className="w-4 h-4 rounded border-2 border-muted-foreground/30 accent-[#2B5EA7] cursor-pointer"
                />
                <span className="text-[15px] font-semibold text-foreground">{group.label}</span>
              </div>
              {/* Photo grid */}
              <div
                className="grid gap-2.5"
                style={{ [viewSize === "compact" ? "gridTemplateColumns" : "gridTemplateColumns"]: viewSize === "compact" ? "repeat(auto-fill, minmax(120px, 1fr))" : "repeat(auto-fill, minmax(160px, 1fr))" }}
              >
                {group.photos.map((photo) => {
                  const isSelected = selectedIds.has(photo.id);
                  return (
                    <div key={photo.id} className="cursor-pointer">
                      <div
                        className={`aspect-square rounded-lg overflow-hidden relative transition-transform hover:scale-[1.03] ${
                          isSelected ? "ring-[3px] ring-[#2B5EA7]" : ""
                        }`}
                        onClick={(e) => {
                          if (e.shiftKey || selectedIds.size > 0) {
                            toggleSelect(photo.id, e.shiftKey);
                          } else {
                            onSelectPhoto(photo);
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          toggleSelect(photo.id, false);
                        }}
                      >
                        <img
                          src={`${supabaseUrl}/storage/v1/object/public/photos/${photo.annotated_path || photo.storage_path}`}
                          alt={photo.caption || "Photo"}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        {/* User avatar */}
                        <div className="absolute bottom-1.5 left-1.5 w-6 h-6 rounded-full bg-[#2B5EA7] border-2 border-white flex items-center justify-center">
                          <span className="text-[9px] font-bold text-white">{getInitials(photo.taken_by)}</span>
                        </div>
                        {/* Selection checkmark */}
                        {isSelected && (
                          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#2B5EA7] flex items-center justify-center">
                            <span className="text-white text-[10px]">✓</span>
                          </div>
                        )}
                      </div>
                      {/* Meta */}
                      <div className="pt-1 px-0.5">
                        <span className="text-[11px] text-muted-foreground">
                          {format(new Date(photo.created_at), "h:mm a")}
                        </span>
                        <span className="text-[11px] text-muted-foreground/60"> · </span>
                        <span className="text-[11px] text-muted-foreground/60">{photo.taken_by}</span>
                        <div className="flex gap-1 mt-0.5">
                          {photo.before_after_role === "before" && (
                            <span className="text-[9px] px-1 py-0 rounded bg-[#FCEBEB] text-[#791F1F]">Before</span>
                          )}
                          {photo.before_after_role === "after" && (
                            <span className="text-[9px] px-1 py-0 rounded bg-[#E1F5EE] text-[#085041]">After</span>
                          )}
                          {photo.annotated_path && (
                            <span className="text-[9px] px-1 py-0 rounded bg-[#dbeafe] text-[#2B5EA7]">Edited</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-4" />
          {loadingMore && (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={20} className="animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/components/job-photos-tab.tsx
git commit -m "feat: add JobPhotosTab component with date grouping and infinite scroll"
```

---

### Task 5: Wire JobPhotosTab into job-detail.tsx

**Files:**
- Modify: `src/components/job-detail.tsx`

- [ ] **Step 1: Import and render JobPhotosTab**

Add at the top of `src/components/job-detail.tsx`:

```typescript
import JobPhotosTab from "@/components/job-photos-tab";
```

Replace the placeholder `<div>Photos tab — coming in Task 3</div>` in the `activeTab !== "overview"` branch with:

```tsx
<JobPhotosTab
  jobId={jobId}
  tags={tags}
  supabaseUrl={supabaseUrl}
  onPhotosAdded={fetchData}
  onPhotoUpdated={fetchData}
  onSelectPhoto={(photo) => setSelectedPhoto(photo)}
/>
```

- [ ] **Step 2: Verify build compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/components/job-detail.tsx
git commit -m "feat: wire JobPhotosTab into job detail page"
```

---

### Task 6: Bulk delete API route

**Files:**
- Create: `src/app/api/jobs/[id]/photos/bulk/route.ts`

- [ ] **Step 1: Create the bulk delete route**

Create `src/app/api/jobs/[id]/photos/bulk/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;
  const { photoIds } = await request.json() as { photoIds: string[] };

  if (!photoIds || photoIds.length === 0) {
    return NextResponse.json({ error: "No photo IDs provided" }, { status: 400 });
  }

  const supabase = createApiClient();

  // Fetch photos to get storage paths
  const { data: photos, error: fetchError } = await supabase
    .from("photos")
    .select("id, storage_path, annotated_path, thumbnail_path")
    .eq("job_id", jobId)
    .in("id", photoIds);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!photos || photos.length === 0) {
    return NextResponse.json({ error: "No matching photos found" }, { status: 404 });
  }

  // Collect all storage paths to delete
  const storagePaths: string[] = [];
  for (const photo of photos) {
    storagePaths.push(photo.storage_path);
    if (photo.annotated_path) storagePaths.push(photo.annotated_path);
    if (photo.thumbnail_path) storagePaths.push(photo.thumbnail_path);
    // Also try to delete the backup original
    const ext = photo.storage_path.split(".").pop();
    const basePath = photo.storage_path.replace(`.${ext}`, "");
    storagePaths.push(`${basePath}-original.${ext}`);
  }

  // Delete storage files (ignore errors for missing files like backups)
  await supabase.storage.from("photos").remove(storagePaths);

  // Delete DB records (cascade handles photo_tag_assignments and photo_annotations)
  const { error: deleteError } = await supabase
    .from("photos")
    .delete()
    .eq("job_id", jobId)
    .in("id", photoIds);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: photos.length });
}
```

- [ ] **Step 2: Wire bulk delete into JobPhotosTab**

In `src/components/job-photos-tab.tsx`, add the delete handler. After the `isGroupSelected` function, add:

```typescript
const [deleteConfirm, setDeleteConfirm] = useState(false);

const handleBulkDelete = async () => {
  const ids = Array.from(selectedIds);
  const res = await fetch(`/api/jobs/${jobId}/photos/bulk`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoIds: ids }),
  });
  if (res.ok) {
    setPhotos((prev) => prev.filter((p) => !selectedIds.has(p.id)));
    setSelectedIds(new Set());
    setDeleteConfirm(false);
    onPhotoUpdated();
  }
};
```

Update the Delete button in the bulk action bar:

```tsx
<button
  className="px-3 py-1 border border-white/30 rounded-md hover:bg-white/15 transition-colors text-xs"
  onClick={() => setDeleteConfirm(true)}
>
  Delete
</button>
```

Add a confirmation dialog right after the bulk action bar div:

```tsx
{deleteConfirm && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <div className="bg-card rounded-xl border border-border p-6 max-w-sm shadow-xl">
      <h3 className="text-base font-semibold text-foreground mb-2">Delete {selectedIds.size} photos?</h3>
      <p className="text-sm text-muted-foreground mb-4">This cannot be undone. Photos and their annotations will be permanently deleted.</p>
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => setDeleteConfirm(false)}
          className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleBulkDelete}
          className="px-4 py-2 rounded-lg bg-[#C41E2A] text-white text-sm font-medium hover:bg-[#a01823] transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Verify build compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/jobs/[id]/photos/bulk/route.ts src/components/job-photos-tab.tsx
git commit -m "feat: add bulk photo delete API route and wire into Photos tab"
```

---

### Task 7: Bulk tag API route

**Files:**
- Create: `src/app/api/jobs/[id]/photos/bulk-tag/route.ts`

- [ ] **Step 1: Create the bulk tag route**

Create `src/app/api/jobs/[id]/photos/bulk-tag/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;
  const { photoIds, tagIds, action } = await request.json() as {
    photoIds: string[];
    tagIds: string[];
    action: "add" | "remove";
  };

  if (!photoIds?.length || !tagIds?.length || !action) {
    return NextResponse.json({ error: "Missing photoIds, tagIds, or action" }, { status: 400 });
  }

  const supabase = createApiClient();

  // Verify photos belong to this job
  const { data: photos } = await supabase
    .from("photos")
    .select("id")
    .eq("job_id", jobId)
    .in("id", photoIds);

  const validIds = (photos || []).map((p) => p.id);

  if (action === "add") {
    const rows = validIds.flatMap((photoId) =>
      tagIds.map((tagId) => ({ photo_id: photoId, tag_id: tagId }))
    );
    const { error } = await supabase
      .from("photo_tag_assignments")
      .upsert(rows, { onConflict: "photo_id,tag_id", ignoreDuplicates: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from("photo_tag_assignments")
      .delete()
      .in("photo_id", validIds)
      .in("tag_id", tagIds);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ updated: validIds.length });
}
```

- [ ] **Step 2: Wire bulk tag into JobPhotosTab**

In `src/components/job-photos-tab.tsx`, add a tag popover state and handler. Add after the `handleBulkDelete` function:

```typescript
const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

const handleBulkTag = async (tagId: string, action: "add" | "remove") => {
  const ids = Array.from(selectedIds);
  await fetch(`/api/jobs/${jobId}/photos/bulk-tag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoIds: ids, tagIds: [tagId], action }),
  });
  // Refresh photos to reflect new tags
  fetchPhotos(0, false);
  setSelectedIds(new Set());
  setTagPopoverOpen(false);
  onPhotoUpdated();
};
```

Update the Tag button in the bulk action bar:

```tsx
<div className="relative">
  <button
    className="px-3 py-1 border border-white/30 rounded-md hover:bg-white/15 transition-colors text-xs"
    onClick={() => setTagPopoverOpen(!tagPopoverOpen)}
  >
    Tag
  </button>
  {tagPopoverOpen && (
    <div className="absolute top-full left-0 mt-2 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[200px] z-50">
      <p className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">Apply tag to selected:</p>
      {tags.map((tag) => (
        <button
          key={tag.id}
          onClick={() => handleBulkTag(tag.id, "add")}
          className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-foreground hover:bg-accent rounded cursor-pointer"
        >
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: tag.color }}
          />
          {tag.name}
        </button>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 3: Verify build compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/jobs/[id]/photos/bulk-tag/route.ts src/components/job-photos-tab.tsx
git commit -m "feat: add bulk photo tag API route and wire into Photos tab"
```

---

### Task 8: Bulk download API route and client zip

**Files:**
- Create: `src/app/api/jobs/[id]/photos/download/route.ts`
- Modify: `src/components/job-photos-tab.tsx`

- [ ] **Step 1: Create the download route**

Create `src/app/api/jobs/[id]/photos/download/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createApiClient } from "@/lib/supabase-api";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params;
  const { photoIds } = await request.json() as { photoIds: string[] };

  if (!photoIds || photoIds.length === 0) {
    return NextResponse.json({ error: "No photo IDs provided" }, { status: 400 });
  }

  const supabase = createApiClient();

  const { data: photos, error } = await supabase
    .from("photos")
    .select("id, storage_path, caption")
    .eq("job_id", jobId)
    .in("id", photoIds);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!photos?.length) return NextResponse.json({ error: "No matching photos" }, { status: 404 });

  // Generate signed URLs (1 hour expiry)
  const urls = await Promise.all(
    photos.map(async (photo) => {
      const { data } = await supabase.storage
        .from("photos")
        .createSignedUrl(photo.storage_path, 3600);
      return {
        id: photo.id,
        url: data?.signedUrl || null,
        filename: photo.storage_path.split("/").pop() || "photo.jpg",
        caption: photo.caption,
      };
    })
  );

  return NextResponse.json({ urls: urls.filter((u) => u.url !== null) });
}
```

- [ ] **Step 2: Wire bulk download into JobPhotosTab**

In `src/components/job-photos-tab.tsx`, add JSZip import at the top:

```typescript
import JSZip from "jszip";
```

Add the download handler after `handleBulkTag`:

```typescript
const [downloading, setDownloading] = useState(false);

const handleBulkDownload = async () => {
  setDownloading(true);
  const ids = Array.from(selectedIds);
  const res = await fetch(`/api/jobs/${jobId}/photos/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoIds: ids }),
  });
  const { urls } = await res.json() as { urls: { url: string; filename: string }[] };

  const zip = new JSZip();
  await Promise.all(
    urls.map(async ({ url, filename }) => {
      const blob = await fetch(url).then((r) => r.blob());
      zip.file(filename, blob);
    })
  );

  const content = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(content);
  a.download = `photos-${jobId.slice(0, 8)}.zip`;
  a.click();
  URL.revokeObjectURL(a.href);
  setDownloading(false);
  setSelectedIds(new Set());
};
```

Update the Download button in the bulk action bar:

```tsx
<button
  className="px-3 py-1 border border-white/30 rounded-md hover:bg-white/15 transition-colors text-xs"
  onClick={handleBulkDownload}
  disabled={downloading}
>
  {downloading ? "Zipping..." : "Download"}
</button>
```

- [ ] **Step 3: Verify build compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/jobs/[id]/photos/download/route.ts src/components/job-photos-tab.tsx
git commit -m "feat: add bulk photo download with client-side zip"
```

---

### Task 9: Final integration check and cleanup

**Files:**
- Modify: `src/components/job-detail.tsx` (cleanup)
- Modify: `src/components/job-photos-tab.tsx` (cleanup)

- [ ] **Step 1: Clean up job-detail.tsx photo data fetching**

In `job-detail.tsx`, the `fetchData` function currently fetches all photos. Since the Overview only needs 12, update the photos query to add `.limit(12)`:

In the `fetchData` function, change:

```typescript
supabase
  .from("photos")
  .select("*")
  .eq("job_id", jobId)
  .order("created_at", { ascending: false }),
```

to:

```typescript
supabase
  .from("photos")
  .select("*")
  .eq("job_id", jobId)
  .order("created_at", { ascending: false })
  .limit(12),
```

Note: The `photos.length` shown in the tab count badge will now show max 12. We need a separate count query. Add to the `fetchData` parallel array:

```typescript
supabase
  .from("photos")
  .select("id", { count: "exact", head: true })
  .eq("job_id", jobId),
```

Add a new state variable:

```typescript
const [photoCount, setPhotoCount] = useState(0);
```

In the results handling:

```typescript
if (countRes.count != null) setPhotoCount(countRes.count);
```

Then use `photoCount` instead of `photos.length` in the tab badge and "View all X photos" link.

- [ ] **Step 2: Verify build compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "jarvis/neural-network" | head -20
```

- [ ] **Step 3: Manual test in browser**

Start the dev server and verify:
1. Job detail loads with Overview tab active
2. Tab bar shows Overview and Photos with count
3. Overview shows compact 8-col photo preview
4. "View all" link switches to Photos tab
5. Photos tab shows date-grouped grid with filters
6. Scrolling loads more photos
7. Bulk select (click, shift-click, group checkbox) works
8. Bulk delete, tag, download actions work
9. Upload from Photos tab works and refreshes grid
10. Photo detail modal opens from both tabs
11. Browser back button returns to correct tab state

- [ ] **Step 4: Commit**

```bash
git add src/components/job-detail.tsx src/components/job-photos-tab.tsx
git commit -m "feat: optimize photo queries and finalize tab integration"
```
