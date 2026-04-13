# Job Detail — Photos Tab Redesign

## Summary

Rework the photo section in the job detail page to handle jobs with hundreds of photos. Adds a two-tab layout (Overview / Photos) to the job detail page. The Overview tab keeps a compact photo preview; the Photos tab provides a full browsing experience with date grouping, filters, bulk actions, and infinite scroll.

## Motivation

Jobs in the field typically accumulate hundreds of photos. The current single-page layout shows all photos in a flat grid, which becomes unwieldy at scale. Splitting into a dedicated Photos tab gives users filtering, date-based organization, and bulk operations while keeping the Overview page focused.

## Tab System

### Implementation
- Tab state driven by URL search param `?tab=overview|photos` (defaults to `overview`)
- Implemented inside `job-detail.tsx` — a tab bar renders below the existing header (back link, job number, name, badges, status dropdown, Jarvis button)
- Header and tab bar remain visible on both tabs
- Conditional render: Overview content or new `JobPhotosTab` component based on `?tab` value

### Tab bar
- Two tabs: **Overview** and **Photos** (with count badge showing total photo count)
- Active tab has blue underline and blue text (#2B5EA7)
- Matches the style from the approved mockup

## Overview Tab — Photo Preview

Replaces the current photo section (~lines 573-691 of `job-detail.tsx`) with a compact preview:

- **Header row**: "Photos" title left, "View all X photos →" link right (sets `?tab=photos`)
- **Grid**: `grid-template-columns: repeat(8, 1fr)`, showing the 12 most recent photos as square thumbnails
- **Minimal chrome**: no hover effects, no captions, no badges — just thumbnails with rounded corners
- **Click** a thumbnail → opens existing `PhotoDetailModal` (same behavior as today)
- **Generate Report** button stays in Overview (job-level action, not photo-browsing)
- **Upload Photos** button moves to the Photos tab filter bar

## Photos Tab — JobPhotosTab Component

New file: `src/components/job-photos-tab.tsx`

### Props
```typescript
interface JobPhotosTabProps {
  jobId: string;
  tags: PhotoTag[];
  supabaseUrl: string;
  onPhotosAdded: () => void;
  onPhotoUpdated: () => void;
  onAnnotate: (photo: Photo, url: string) => void;
}
```

Note: `photos` is **not** passed as a prop. The Photos tab manages its own paginated data fetching internally (see Pagination section). The Overview tab fetches only the 12 most recent photos for its preview independently.

### Filter Bar
Top of the tab, horizontal row of filter controls:

| Filter | Type | Behavior |
|--------|------|----------|
| Start Date | Date picker | Filters photos with `created_at >= date` |
| End Date | Date picker | Filters photos with `created_at <= date` |
| Users | Multi-select dropdown | Lists unique `taken_by` values. Filters to selected users |
| Tags | Multi-select dropdown | Lists all photo tags. Filters photos that have any selected tag |
| View | Toggle | Compact (120px min) / Comfortable (160px min) tile size |
| Upload Photos | Button | Opens existing `PhotoUploadModal` |

Filters are AND-combined (date range AND users AND tags). Changing any filter resets scroll position and re-filters.

### Date-Grouped Grid
- Photos grouped by date from `created_at` (using `date-fns` `format` for headers like "Friday, March 27th, 2026")
- Each date group has a **checkbox** that selects/deselects all photos in that group
- Grid: `grid-template-columns: repeat(auto-fill, minmax(120px, 1fr))` with 10px gap

### Photo Tile
Each tile displays:
- **Square thumbnail** with rounded corners (8px)
- **User avatar** overlay (bottom-left) — circle with initials from `taken_by`, #2B5EA7 background, white 2px border
- **Below the image**: time (from `created_at`), separator dot, uploader name (`taken_by`)
- **Badges** (optional row below meta): Before/After role badge, "Edited" badge if `annotated_path` exists
- **Click** → opens existing `PhotoDetailModal`
- **Hover** → subtle scale (1.03)

### Bulk Selection
- Click a photo toggles its selection (blue outline + checkmark badge top-right)
- Shift+click selects a range from last-clicked to shift-clicked
- Date group checkbox selects/deselects all photos in that group
- When any photos are selected, a **sticky action bar** appears at the top:
  - "{count} photos selected"
  - **Tag** button — popover with tag multi-select, applies to all selected
  - **Download** button — downloads selected photos
  - **Delete** button — confirmation dialog, then bulk delete
  - **Clear** button — deselects all

### Pagination (Infinite Scroll)
- Initial load: first 50 photos ordered by `created_at desc`
- Scroll near bottom triggers fetch of next 50
- Date grouping computed client-side from loaded photos — new date headers appear as more photos load
- Filters reset pagination and re-fetch from the top
- Loading indicator at bottom while fetching

## Data & API Changes

### Data Fetching Split
- **`job-detail.tsx` (Overview)**: Fetches only the 12 most recent photos (`.limit(12)`) for the preview grid. Lightweight — no tag assignments needed.
- **`JobPhotosTab` (Photos tab)**: Manages its own paginated fetching — 50 photos at a time, ordered by `created_at desc`, including tag assignments via `.select("*, photo_tag_assignments(tag_id)")`. Filters are applied as Supabase query params. Re-fetches when filters change.

### New API Routes

**`DELETE /api/jobs/[id]/photos/bulk`**
- Body: `{ photoIds: string[] }`
- Deletes storage files (original + annotated + thumbnail) and DB records
- Deletes associated `photo_tag_assignments` and `photo_annotations` (cascade)
- Returns count of deleted photos

**`POST /api/jobs/[id]/photos/bulk-tag`**
- Body: `{ photoIds: string[], tagIds: string[], action: "add" | "remove" }`
- Adds or removes tag assignments for the specified photos
- Upserts for "add", deletes for "remove"

**`POST /api/jobs/[id]/photos/download`**
- Body: `{ photoIds: string[] }`
- Returns array of signed URLs for the requested photos
- Client handles zipping (using JSZip) and download trigger

### No Database Migrations
All required tables and columns already exist: `photos`, `photo_tags`, `photo_tag_assignments`, `photo_annotations`. No schema changes needed.

## Component Structure

```
job-detail.tsx (modified)
├── Header (unchanged — back link, job info, badges, status)
├── Tab bar (new)
├── Overview tab (conditional)
│   ├── Info card (unchanged)
│   ├── Activity timeline (unchanged)
│   ├── Payments (unchanged)
│   ├── Photo preview (new compact version)
│   ├── Files (unchanged)
│   └── Emails (unchanged)
└── Photos tab (conditional)
    └── JobPhotosTab (new component)
        ├── Filter bar
        ├── Bulk action bar (when selection active)
        └── Date-grouped photo grid
            ├── Date header + checkbox
            └── Photo tiles

Existing components (unchanged):
├── PhotoDetailModal
├── PhotoUploadModal
└── PhotoAnnotator
```

## Files Changed

| File | Change |
|------|--------|
| `src/components/job-detail.tsx` | Add tab bar, split render into Overview/Photos, simplify photo preview |
| `src/components/job-photos-tab.tsx` | **New** — full Photos tab component |
| `src/app/api/jobs/[id]/photos/bulk/route.ts` | **New** — bulk delete endpoint |
| `src/app/api/jobs/[id]/photos/bulk-tag/route.ts` | **New** — bulk tag endpoint |
| `src/app/api/jobs/[id]/photos/download/route.ts` | **New** — bulk download signed URLs |
