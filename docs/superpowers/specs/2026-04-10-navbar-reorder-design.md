# Sidebar Navigation Reorder

**Date:** 2026-04-10
**Scope:** Let admins change the order of the top-level sidebar items globally for all users

## Summary

Add a new admin-only settings sub-page at `/settings/navigation` where an admin can reorder the ten top-level sidebar items (Dashboard, Jarvis, Marketing, New Intake, Jobs, Photos, Reports, Contacts, Email, Settings). The chosen order is stored in a new `nav_items` table and applied globally to every user's sidebar on both desktop and mobile. Labels, icons, and the set of available items stay in code — only the order lives in the database.

## Decisions (from brainstorming)

1. **Scope: global, admin-set.** One nav order for everyone; only admins can change it.
2. **Reorder only.** No hide/show. All ten items are always present.
3. **Edit UI: new settings sub-page.** Mirrors the existing `/settings/statuses` pattern — up/down arrow buttons, not drag-and-drop.
4. **New items added in code are handled by a manual `INSERT ... ON CONFLICT DO NOTHING` migration.** No lazy auto-insert at page load.

## 1. Data Model

### New table

```sql
CREATE TABLE nav_items (
  href        text PRIMARY KEY,
  sort_order  integer NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_nav_items_updated_at
  BEFORE UPDATE ON nav_items FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Seed with the 10 current items in their current order
INSERT INTO nav_items (href, sort_order) VALUES
  ('/',          1),
  ('/jarvis',    2),
  ('/marketing', 3),
  ('/intake',    4),
  ('/jobs',      5),
  ('/photos',    6),
  ('/reports',   7),
  ('/contacts',  8),
  ('/email',     9),
  ('/settings', 10);

ALTER TABLE nav_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nav_items read"
  ON nav_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "nav_items admin write"
  ON nav_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
```

### Design rationale

- **`href` is the primary key.** Hrefs are already globally unique and stable route paths — no reason to introduce a UUID plus an unused `name` column. Joining code → DB is a direct `row.href === item.href` lookup.
- **Only the order lives in DB.** Labels and icons stay in code. Icons are JSX imports from `lucide-react` and can't meaningfully live in a DB row. Keeping labels in code also avoids a data migration every time a label changes.
- **`updated_at`** is included for debugging only. No `created_at` — seeding is a one-time migration.
- **RLS is the bottom layer of defense.** Reads require auth; writes require `user_profiles.role = 'admin'`. The API route also performs an explicit admin check, making this defense-in-depth.

### Migration file

New file: `supabase/migration-build29-nav-order.sql`

Contains the CREATE TABLE, trigger, seed INSERT, and two RLS policies above.

## 2. Architecture

### Files touched

```
NEW  supabase/migration-build29-nav-order.sql       # table + RLS + seed
NEW  src/lib/nav-items.ts                           # canonical navItems array (extracted)
NEW  src/lib/nav-order-context.tsx                  # NavOrderProvider + useNavOrder()
NEW  src/app/api/settings/nav-order/route.ts        # GET + PUT (admin-gated)
NEW  src/app/settings/navigation/page.tsx           # the admin edit UI

EDIT src/components/nav.tsx                         # import navItems from lib; read order from context; sort
EDIT src/app/layout.tsx                             # wrap children in NavOrderProvider
EDIT src/lib/settings-nav.ts                        # add "Navigation" entry between Appearance and Job Statuses
```

### `src/lib/nav-items.ts`

Holds the canonical `navItems` array, moved verbatim from `nav.tsx`:

```ts
import { LayoutDashboard, ClipboardPlus, Briefcase, Users, Camera, FileText, Mail, Settings, Sparkles, Megaphone } from "lucide-react";
import type { ComponentType } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
}

export const navItems: NavItem[] = [
  { href: "/",          label: "Dashboard",  icon: LayoutDashboard },
  { href: "/jarvis",    label: "Jarvis",     icon: Sparkles },
  { href: "/marketing", label: "Marketing",  icon: Megaphone },
  { href: "/intake",    label: "New Intake", icon: ClipboardPlus },
  { href: "/jobs",      label: "Jobs",       icon: Briefcase },
  { href: "/photos",    label: "Photos",     icon: Camera },
  { href: "/reports",   label: "Reports",    icon: FileText },
  { href: "/contacts",  label: "Contacts",   icon: Users },
  { href: "/email",     label: "Email",      icon: Mail },
  { href: "/settings",  label: "Settings",   icon: Settings },
];
```

The array's index order is used as a tiebreaker when DB order is missing (see Section 3).

### `src/lib/nav-order-context.tsx`

Mirrors the shape of the existing `ConfigProvider`:

```ts
interface NavOrderContextType {
  order: Map<string, number>;  // href → sort_order
  loading: boolean;
  refresh: () => Promise<void>;
}
```

On mount, calls `GET /api/settings/nav-order`, builds the Map, exposes it via a hook `useNavOrder()`. Exposes a `refresh()` function the settings page calls after a successful save so the sidebar updates without a full page reload.

A Provider (rather than a hook inside `nav.tsx`) is required because both the sidebar and the settings page need a single shared source of truth — when the settings page saves, the sidebar should re-render.

### `src/app/api/settings/nav-order/route.ts`

Uses `createServerSupabaseClient()` (not the anonymous `createApiClient` pattern used by the existing statuses route), so `auth.uid()` is populated from session cookies and RLS works correctly.

**GET**: returns `[{ href, sort_order }]` ordered by `sort_order`. Any signed-in user can read.

**PUT**: request body `{ order: string[] }` — an ordered list of hrefs. Handler:
1. Resolves the current user via `supabase.auth.getUser()`.
2. Looks up `user_profiles.role` for that user. If not `admin`, returns 403.
3. Validates: `order` must be an array of strings, each a non-empty href.
4. For each href in `order`, runs an **UPSERT** (`INSERT ... ON CONFLICT (href) DO UPDATE SET sort_order = EXCLUDED.sort_order`) setting `sort_order = index + 1`. Upsert (rather than plain update) ensures that when an admin reorders a code-new item whose row doesn't yet exist in the DB, the first move creates the row. This is still an admin-triggered write, not a passive auto-insert at read time.
5. Returns `{ success: true }`.

No POST or DELETE — item management is a code/migration concern, not a runtime one.

### `src/app/layout.tsx`

Wrap `<AppShell>` with the new provider, inside `ConfigProvider`:

```tsx
<AuthProvider>
  <ConfigProvider>
    <NavOrderProvider>
      <BrandColorsProvider />
      <AppShell>{children}</AppShell>
      <Toaster />
    </NavOrderProvider>
  </ConfigProvider>
</AuthProvider>
```

### `src/components/nav.tsx`

- Remove the inline `navItems` array; import it from `@/lib/nav-items`.
- Call `useNavOrder()` to get the DB order Map.
- Before rendering, sort the imported array by the Map (see Section 3).

### `src/lib/settings-nav.ts`

Add one entry between `Appearance` and `Job Statuses` (topically all three are visual layout):

```ts
{ href: "/settings/navigation", label: "Navigation", icon: Menu }
```

## 3. Sort Algorithm

When the sidebar renders, it merges the canonical code array with the DB order:

```ts
const { order } = useNavOrder(); // Map<href, sort_order>

const rendered = [...navItems].sort((a, b) => {
  const aOrder = order.get(a.href) ?? Infinity;
  const bOrder = order.get(b.href) ?? Infinity;
  if (aOrder !== bOrder) return aOrder - bOrder;
  // Tiebreaker: preserve code-defined order for items missing from DB
  return navItems.indexOf(a) - navItems.indexOf(b);
});
```

### Scenarios

| Scenario | Behavior |
|---|---|
| Item in code AND in DB | Uses DB `sort_order` |
| Item added in code, not in DB | Falls to the bottom, in code-defined order. No crash. A developer adds an `INSERT ... ON CONFLICT DO NOTHING` line in a follow-up migration to give it a permanent position. |
| Item in DB but removed from code | Ignored (`.sort()` only iterates the code array). Stale row is harmless; a future migration can clean it up. |
| Loading state (DB not yet fetched) | `order` is an empty Map → all items fall to `Infinity` and sort by code order. The sidebar renders immediately with the default code order; when the DB fetch completes, it re-renders in the admin-chosen order. No flash of empty sidebar. |

## 4. Settings Page UX

`/settings/navigation` — single page, mirrors `/settings/statuses` styling.

### Layout

```
┌─ Navigation ────────────────────────────────┐
│ Use the up and down arrows to reorder       │
│ items in the sidebar. Changes apply to      │
│ every user immediately.                     │
│                                             │
│  ▲                                          │
│  ▼  🏠  Dashboard              /            │
│                                             │
│  ▲                                          │
│  ▼  ✨  Jarvis                 /jarvis      │
│  ... (all 10 items) ...                     │
└─────────────────────────────────────────────┘
```

Each row renders: up button, down button, icon, label, and the href dimmed on the right for admin reference.

Reuses the `GripVertical` icon (rotated for up, normal for down) exactly as `/settings/statuses` does.

### Behavior

- `moveUp(index)` / `moveDown(index)`: swap adjacent elements in a local state array; immediately call `PUT /api/settings/nav-order` with the new order; call `refresh()` on the NavOrderContext.
- First row's up button and last row's down button are disabled.
- On successful save: `toast.success("Order saved")` and the sidebar updates live (via the context refresh).
- On save failure: `toast.error(...)` and local state reverts to the pre-move order. The settings page captures the pre-move array in a local variable before the optimistic mutation, so the revert is a direct `setState(prevOrder)`.
- While the API request is in flight, the buttons are not disabled — the optimistic update is the whole point; a failure is rare and is handled by the revert.

### Admin gate

- At the top of the page component: `if (!loading && profile?.role !== "admin") return <p>Admins only.</p>;`
- Server-side admin check in the API route (Section 2.4) is the second layer.
- RLS policy on the table is the third layer.

### Loading

`loading` state shows the same `"Loading..."` placeholder as `/settings/statuses`.

## 5. Error Handling

| Failure mode | Handling |
|---|---|
| DB fetch fails on initial page load (context) | `loading` stays true briefly, then resolves with an empty Map. Sidebar shows code-default order (safe fallback). A retry is not attempted in this iteration. |
| API PUT fails (network, 500, etc.) | Toast error; local state reverts to pre-move order. |
| Non-admin somehow hits the settings page | Page shows "Admins only." The admin check runs after `profile` loads, so the page doesn't flash the list. |
| Non-admin somehow calls the PUT endpoint | API returns 403. |
| Body validation fails (non-array, non-string entries) | API returns 400 with a descriptive error. |
| Href in the request body doesn't match any DB row | Upserted (new row created). Handles the "admin reorders a code-new item before its migration has been added" case. |

## 6. Verification Plan

No automated tests (the codebase has no test framework). Manual verification against the dev preview after implementation:

| # | Check | Method |
|---|---|---|
| 1 | Migration applies cleanly | Run SQL against Supabase; confirm 10 rows exist in `nav_items` |
| 2 | "Navigation" entry appears in settings sub-nav | Log in as admin; visit `/settings`; scan sub-nav |
| 3 | Admin can reorder | Click down-arrow on Dashboard; verify row order updates locally; verify network tab shows PUT with new order; verify `nav_items` DB table reflects the change; verify main sidebar order updates live without a page reload |
| 4 | Non-admin sees "Admins only" on the page | Log in as a non-admin user; navigate to `/settings/navigation`; confirm the list is not rendered |
| 5 | API rejects non-admin PUT | From a non-admin browser session, run `fetch('/api/settings/nav-order', { method: 'PUT', ... })` in DevTools; confirm 403 |
| 6 | RLS rejects direct non-admin client writes | From a non-admin browser session, run `supabase.from('nav_items').update({ sort_order: 1 }).eq('href', '/')` in DevTools; confirm error |
| 7 | "New item in code" case | Temporarily add a dummy entry to `src/lib/nav-items.ts`; reload; confirm it appears at the bottom of the sidebar without a crash; remove the dummy |
| 8 | Optimistic revert on API failure | Temporarily break the route handler to always return 500; click a move; confirm toast.error fires and local order reverts to pre-move position; restore the route |
| 9 | Mobile menu respects the order | Resize preview to mobile width; open the hamburger menu; confirm items appear in the same order |
| 10 | No flash of wrong order on page load | Cold reload `/`; observe sidebar — it should appear in code-default order for a few ms, then settle into the DB order. No empty sidebar or flicker. |

## Out of Scope

- Per-user overrides on top of the global order
- Hiding/showing nav items
- Adding or removing nav items at runtime (code + migration is the mechanism)
- Drag-and-drop interaction (up/down buttons match house style)
- Automated tests (no test framework exists)
- Fixing the existing `/api/settings/*` routes that use the anonymous client pattern (separate cleanup)
