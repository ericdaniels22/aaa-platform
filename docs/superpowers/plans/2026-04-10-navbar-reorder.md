# Navbar Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins globally reorder the sidebar nav items from a new `/settings/navigation` page, persisting the order in a `nav_items` table.

**Architecture:** A new `nav_items` table stores only `(href, sort_order)` — labels and icons stay in code. A `NavOrderProvider` loads the order once at layout mount and exposes it via `useNavOrder()`. The sidebar sorts its hardcoded items by the DB order at render time, with a stable fallback for items not yet in the DB. An admin-only settings page reuses the exact up/down button pattern from `/settings/statuses`.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (Postgres + RLS + SSR auth), TypeScript, Tailwind, lucide-react, sonner (toasts).

**Spec:** `docs/superpowers/specs/2026-04-10-navbar-reorder-design.md`

**Verification note:** This codebase has no test framework (only ESLint). Each task's verification is a manual check against the dev preview server, following the same pattern the existing features use. The final task runs through the full 10-item verification checklist from the spec.

---

## Task 1: DB migration for `nav_items` table

**Files:**
- Create: `supabase/migration-build29-nav-order.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migration-build29-nav-order.sql` with this exact content:

```sql
-- Build 29: nav_items table for admin-configurable sidebar order
-- (Numbered 29 because Build 27 and 28 are occupied by email categories)
--
-- Stores only the href and sort_order for each top-level sidebar item.
-- Labels, icons, and the canonical set of items live in src/lib/nav-items.ts.
-- Items missing from this table fall to the bottom of the sidebar in the
-- code-defined order (see src/components/nav.tsx sort logic).

CREATE TABLE nav_items (
  href        text PRIMARY KEY,
  sort_order  integer NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_nav_items_updated_at
  BEFORE UPDATE ON nav_items FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Seed with the 10 current items in their current code-defined order
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

-- Any authenticated user can read the order
CREATE POLICY "nav_items read"
  ON nav_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only admins can insert/update/delete
CREATE POLICY "nav_items admin write"
  ON nav_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
```

- [ ] **Step 2: Apply the migration to Supabase**

Open the Supabase SQL editor for your project (from `.env.local` → `NEXT_PUBLIC_SUPABASE_URL`), paste the contents of `supabase/migration-build29-nav-order.sql`, and run it.

Expected: success, no errors.

- [ ] **Step 3: Verify the table was created with 10 rows**

In the Supabase SQL editor, run:

```sql
SELECT href, sort_order FROM nav_items ORDER BY sort_order;
```

Expected output: 10 rows in the order `/`, `/jarvis`, `/marketing`, `/intake`, `/jobs`, `/photos`, `/reports`, `/contacts`, `/email`, `/settings` with `sort_order` values 1–10.

- [ ] **Step 4: Commit**

```bash
git add supabase/migration-build29-nav-order.sql
git commit -m "$(cat <<'EOF'
feat(nav): add nav_items migration for configurable sidebar order

Creates a nav_items table with (href, sort_order) that stores the
admin-chosen order for top-level sidebar items. Labels and icons
remain in code; only the order is in the DB. RLS allows any signed-in
user to read but restricts writes to admins.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extract `navItems` to a shared lib file

**Files:**
- Create: `src/lib/nav-items.ts`
- Modify: `src/components/nav.tsx` (remove inline array, import from lib)

- [ ] **Step 1: Create the shared `nav-items.ts` lib file**

Create `src/lib/nav-items.ts` with:

```ts
import {
  LayoutDashboard,
  ClipboardPlus,
  Briefcase,
  Users,
  Camera,
  FileText,
  Mail,
  Settings,
  Sparkles,
  Megaphone,
} from "lucide-react";
import type { ComponentType } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
}

/**
 * Canonical source of truth for which sidebar items exist.
 * The order in this array is the default fallback used when an
 * item is not yet present in the nav_items DB table (e.g., a new
 * page added in code before its migration row is created).
 *
 * The actual rendered order is determined by nav_items.sort_order
 * from the database — see src/lib/nav-order-context.tsx and
 * src/components/nav.tsx.
 */
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

- [ ] **Step 2: Update `nav.tsx` to import from the new lib**

In `src/components/nav.tsx`, replace:

```tsx
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardPlus,
  Briefcase,
  Users,
  Camera,
  FileText,
  Mail,
  Settings,
  Menu,
  X,
  LogOut,
  Sparkles,
  Megaphone,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import NotificationBell from "@/components/notification-bell";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jarvis", label: "Jarvis", icon: Sparkles },
  { href: "/marketing", label: "Marketing", icon: Megaphone },
  { href: "/intake", label: "New Intake", icon: ClipboardPlus },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/photos", label: "Photos", icon: Camera },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/email", label: "Email", icon: Mail },
  { href: "/settings", label: "Settings", icon: Settings },
];
```

with:

```tsx
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import NotificationBell from "@/components/notification-bell";
import { navItems } from "@/lib/nav-items";
```

Leave the rest of the file (component body, mobile bar, rendered nav) unchanged. The `navItems.map(...)` call in the `<nav>` element will now iterate the imported array.

- [ ] **Step 3: Verify the sidebar still renders correctly**

Open the preview at http://localhost:3000. The sidebar should render exactly as before: Dashboard, Jarvis, Marketing, New Intake, Jobs, Photos, Reports, Contacts, Email, Settings — all in that order, with the same icons and styling. Click a few items to confirm navigation still works.

Run verification:

```
preview_screenshot → confirm sidebar renders with all 10 items in correct order
preview_console_logs → confirm no errors
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/nav-items.ts src/components/nav.tsx
git commit -m "$(cat <<'EOF'
refactor(nav): extract navItems array to shared lib

Moves the canonical navItems definition from nav.tsx into
src/lib/nav-items.ts so the settings page can import the same
list. No functional change — sidebar still renders identically.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: API route for GET/PUT nav order

**Files:**
- Create: `src/app/api/settings/nav-order/route.ts`

- [ ] **Step 1: Create the API route**

Create `src/app/api/settings/nav-order/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

// GET /api/settings/nav-order — returns the admin-configured order.
// Any signed-in user can read (RLS enforces this).
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("nav_items")
    .select("href, sort_order")
    .order("sort_order");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

// PUT /api/settings/nav-order — admin-only. Body: { order: string[] }
// where `order` is an array of hrefs in the desired display order.
// Upserts each href with sort_order = index + 1.
export async function PUT(request: Request) {
  const supabase = await createServerSupabaseClient();

  // Auth check
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Admin check (defense-in-depth; RLS also enforces this)
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 }
    );
  }

  // Validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const order = (body as { order?: unknown })?.order;
  if (!Array.isArray(order)) {
    return NextResponse.json(
      { error: "order must be an array" },
      { status: 400 }
    );
  }
  for (const href of order) {
    if (typeof href !== "string" || href.length === 0) {
      return NextResponse.json(
        { error: "order must contain non-empty strings" },
        { status: 400 }
      );
    }
  }

  // Upsert each href with its new sort_order
  const rows = (order as string[]).map((href, i) => ({
    href,
    sort_order: i + 1,
  }));

  const { error } = await supabase
    .from("nav_items")
    .upsert(rows, { onConflict: "href" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Verify GET works (as signed-in user)**

In the running preview at http://localhost:3000, open DevTools → Console and run:

```js
fetch("/api/settings/nav-order").then(r => r.json()).then(console.log)
```

Expected output:
```js
[
  { href: "/", sort_order: 1 },
  { href: "/jarvis", sort_order: 2 },
  { href: "/marketing", sort_order: 3 },
  { href: "/intake", sort_order: 4 },
  { href: "/jobs", sort_order: 5 },
  { href: "/photos", sort_order: 6 },
  { href: "/reports", sort_order: 7 },
  { href: "/contacts", sort_order: 8 },
  { href: "/email", sort_order: 9 },
  { href: "/settings", sort_order: 10 },
]
```

- [ ] **Step 3: Verify PUT rejects an invalid body**

In the browser console:

```js
fetch("/api/settings/nav-order", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ notAnArray: true }),
}).then(r => r.status).then(console.log)
```

Expected: `400`

- [ ] **Step 4: Verify PUT accepts a valid body (as admin)**

If you are signed in as an admin:

```js
fetch("/api/settings/nav-order", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    order: ["/", "/jarvis", "/marketing", "/intake", "/jobs",
            "/photos", "/reports", "/contacts", "/email", "/settings"]
  }),
}).then(r => r.json()).then(console.log)
```

Expected: `{ success: true }`

Re-run the GET from Step 2 to confirm nothing changed visibly (because we sent the same order).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/nav-order/route.ts
git commit -m "$(cat <<'EOF'
feat(nav): add admin-gated API route for nav order

GET /api/settings/nav-order returns the current order; PUT accepts
{ order: string[] } and upserts each href with sort_order = index+1.
PUT enforces an explicit admin role check in addition to RLS.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: NavOrderProvider context + wire into layout

**Files:**
- Create: `src/lib/nav-order-context.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create the context provider**

Create `src/lib/nav-order-context.tsx` with:

```tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

interface NavOrderContextType {
  /** href → sort_order; empty until first fetch completes. */
  order: Map<string, number>;
  loading: boolean;
  /** Re-fetch the order from the API. Call after a save to update consumers. */
  refresh: () => Promise<void>;
}

const NavOrderContext = createContext<NavOrderContextType | null>(null);

export function NavOrderProvider({ children }: { children: ReactNode }) {
  const [order, setOrder] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/nav-order");
      if (!res.ok) return;
      const data: Array<{ href: string; sort_order: number }> = await res.json();
      const map = new Map<string, number>();
      for (const row of data) map.set(row.href, row.sort_order);
      setOrder(map);
    } catch {
      // Swallow — consumers fall back to code-default order on empty Map
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <NavOrderContext.Provider value={{ order, loading, refresh }}>
      {children}
    </NavOrderContext.Provider>
  );
}

export function useNavOrder() {
  const ctx = useContext(NavOrderContext);
  if (!ctx) {
    throw new Error("useNavOrder must be used within NavOrderProvider");
  }
  return ctx;
}
```

- [ ] **Step 2: Wire `NavOrderProvider` into `src/app/layout.tsx`**

Add the import near the other provider imports:

```tsx
import { NavOrderProvider } from "@/lib/nav-order-context";
```

Then wrap `<AppShell>` inside `<ConfigProvider>`. The current JSX is:

```tsx
<AuthProvider>
  <ConfigProvider>
    <BrandColorsProvider />
    <AppShell>{children}</AppShell>
    <Toaster />
  </ConfigProvider>
</AuthProvider>
```

Change it to:

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

- [ ] **Step 3: Verify nothing broke**

Reload the preview at http://localhost:3000. The sidebar should render as before. Check:

```
preview_console_logs → no errors (especially no "useNavOrder must be used within..." errors)
preview_screenshot → sidebar still renders with all 10 items in default order
```

The context is loading but `nav.tsx` isn't consuming it yet — that's Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/lib/nav-order-context.tsx src/app/layout.tsx
git commit -m "$(cat <<'EOF'
feat(nav): add NavOrderProvider context

Fetches nav order from /api/settings/nav-order on mount and exposes
it via useNavOrder(). Provides refresh() so the settings page can
trigger live updates in the sidebar after a save. Wired into the
root layout inside ConfigProvider.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Sort sidebar items by DB order in `nav.tsx`

**Files:**
- Modify: `src/components/nav.tsx`

- [ ] **Step 1: Import `useNavOrder` and compute sorted items**

At the top of `src/components/nav.tsx`, add the import (alongside the existing `navItems` import):

```tsx
import { useNavOrder } from "@/lib/nav-order-context";
```

Inside the `Sidebar` component, immediately after the existing `const { profile, signOut } = useAuth();` line, add:

```tsx
const { order } = useNavOrder();

// Sort the canonical nav items by DB sort_order.
// Items missing from the DB fall to the bottom in code-defined order.
const sortedNavItems = [...navItems].sort((a, b) => {
  const aOrder = order.get(a.href) ?? Infinity;
  const bOrder = order.get(b.href) ?? Infinity;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return navItems.indexOf(a) - navItems.indexOf(b);
});
```

- [ ] **Step 2: Render `sortedNavItems` instead of `navItems`**

In the same file, find the existing JSX:

```tsx
{navItems.map((item) => {
```

and replace it with:

```tsx
{sortedNavItems.map((item) => {
```

Everything inside the map stays the same.

- [ ] **Step 3: Verify default order is preserved**

Reload the preview at http://localhost:3000. The sidebar should show items in the same order as before (Dashboard, Jarvis, Marketing, New Intake, Jobs, Photos, Reports, Contacts, Email, Settings) because the DB seed matches the code order.

```
preview_screenshot → sidebar order unchanged
preview_console_logs → no errors
preview_network → GET /api/settings/nav-order returns 200 with 10 rows
```

- [ ] **Step 4: Verify the sort actually applies (manual DB test)**

In the Supabase SQL editor, temporarily swap two rows' order:

```sql
UPDATE nav_items SET sort_order = 99 WHERE href = '/';
UPDATE nav_items SET sort_order = 1  WHERE href = '/jobs';
UPDATE nav_items SET sort_order = 100 WHERE href = '/';
```

(Using a two-step update with an intermediate value to avoid a unique-constraint conflict, though with no unique index on sort_order this isn't strictly needed — harmless extra safety.)

Reload the preview. Expected: "Jobs" now appears at the top of the sidebar, "Dashboard" appears at the bottom. Then revert:

```sql
UPDATE nav_items SET sort_order = 1  WHERE href = '/';
UPDATE nav_items SET sort_order = 5  WHERE href = '/jobs';
```

Reload again and confirm the default order is restored.

- [ ] **Step 5: Commit**

```bash
git add src/components/nav.tsx
git commit -m "$(cat <<'EOF'
feat(nav): apply admin-set order to sidebar

Sidebar now sorts nav items by the sort_order from nav_items via
the NavOrderProvider context. Items not in the DB fall to the
bottom in code-defined order, so adding a new page in code works
without a migration.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Settings page for reordering

**Files:**
- Create: `src/app/settings/navigation/page.tsx`
- Modify: `src/lib/settings-nav.ts`

- [ ] **Step 1: Add "Navigation" entry to the settings sub-nav**

In `src/lib/settings-nav.ts`, add `Menu` to the existing `lucide-react` import:

```ts
import {
  Building2,
  Palette,
  ListChecks,
  Flame,
  Users,
  Mail,
  FileSignature,
  ClipboardList,
  Bell,
  FileText,
  Download,
  BookOpen,
  Menu,
} from "lucide-react";
```

Then add a new entry to the `settingsNavItems` array, immediately after `{ href: "/settings/appearance", label: "Appearance", icon: Palette }`:

```ts
{ href: "/settings/navigation", label: "Navigation", icon: Menu },
```

The resulting array:

```ts
export const settingsNavItems: SettingsNavItem[] = [
  { href: "/settings/company", label: "Company Profile", icon: Building2 },
  { href: "/settings/appearance", label: "Appearance", icon: Palette },
  { href: "/settings/navigation", label: "Navigation", icon: Menu },
  { href: "/settings/statuses", label: "Job Statuses", icon: ListChecks },
  { href: "/settings/damage-types", label: "Damage Types", icon: Flame },
  { href: "/settings/users", label: "Users & Crew", icon: Users },
  { href: "/settings/email", label: "Email Accounts", icon: Mail },
  { href: "/settings/signatures", label: "Email Signatures", icon: FileSignature },
  { href: "/settings/intake-form", label: "Intake Form", icon: ClipboardList },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/reports", label: "Reports", icon: FileText },
  { href: "/settings/export", label: "Data Export", icon: Download },
  { href: "/settings/knowledge", label: "Knowledge Base", icon: BookOpen },
];
```

- [ ] **Step 2: Create the settings page**

Create `src/app/settings/navigation/page.tsx` with:

```tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useNavOrder } from "@/lib/nav-order-context";
import { navItems, type NavItem } from "@/lib/nav-items";

export default function NavigationSettingsPage() {
  const { profile, loading: authLoading } = useAuth();
  const { order, loading: orderLoading, refresh } = useNavOrder();
  const [items, setItems] = useState<NavItem[]>([]);
  const prevItemsRef = useRef<NavItem[] | null>(null);

  // Whenever the DB order changes, compute the sorted items for this page.
  // Mirrors the sort logic in src/components/nav.tsx.
  useEffect(() => {
    if (orderLoading) return;
    const sorted = [...navItems].sort((a, b) => {
      const aOrder = order.get(a.href) ?? Infinity;
      const bOrder = order.get(b.href) ?? Infinity;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return navItems.indexOf(a) - navItems.indexOf(b);
    });
    setItems(sorted);
  }, [order, orderLoading]);

  const saveOrder = useCallback(
    async (next: NavItem[]) => {
      const res = await fetch("/api/settings/nav-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: next.map((i) => i.href) }),
      });
      if (res.ok) {
        toast.success("Order saved");
        refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to save order");
        // Revert to the snapshot we took before the optimistic move
        if (prevItemsRef.current) setItems(prevItemsRef.current);
      }
      prevItemsRef.current = null;
    },
    [refresh]
  );

  function moveUp(index: number) {
    if (index === 0) return;
    prevItemsRef.current = items;
    const updated = [...items];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    setItems(updated);
    saveOrder(updated);
  }

  function moveDown(index: number) {
    if (index === items.length - 1) return;
    prevItemsRef.current = items;
    const updated = [...items];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    setItems(updated);
    saveOrder(updated);
  }

  if (authLoading || orderLoading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  if (profile?.role !== "admin") {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Admins only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Navigation</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Use the up and down arrows to reorder items in the sidebar.
          Changes apply to every user immediately.
        </p>
      </div>

      <div className="space-y-1">
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <div
              key={item.href}
              className="bg-card rounded-xl border border-border p-3 flex items-center gap-3"
            >
              {/* Reorder buttons — mirror /settings/statuses */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                  className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
                  aria-label={`Move ${item.label} up`}
                >
                  <GripVertical size={14} className="rotate-180" />
                </button>
                <button
                  onClick={() => moveDown(index)}
                  disabled={index === items.length - 1}
                  className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
                  aria-label={`Move ${item.label} down`}
                >
                  <GripVertical size={14} />
                </button>
              </div>

              {/* Icon */}
              <div className="shrink-0 text-foreground">
                <Icon size={18} />
              </div>

              {/* Label */}
              <div className="flex-1 min-w-0">
                <span className="text-sm text-foreground font-medium">
                  {item.label}
                </span>
              </div>

              {/* Href (dimmed, for reference) */}
              <div className="text-xs text-muted-foreground font-mono">
                {item.href}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the Navigation entry appears in the settings sub-nav**

Reload the preview and navigate to `/settings`. In the left sub-nav (desktop) or the dropdown (mobile), you should see "Navigation" between "Appearance" and "Job Statuses".

```
preview_click → click "Settings" in the main sidebar, then "Navigation" in the sub-nav
preview_screenshot → page loads, shows all 10 nav items with up/down buttons
```

- [ ] **Step 4: Verify reorder works end-to-end (as admin)**

On `/settings/navigation`, click the down button next to "Dashboard". Expected:
- "Dashboard" and "Jarvis" swap positions on the page
- Toast: "Order saved"
- Main sidebar on the left also updates within ~1 second (Jarvis now first, Dashboard second)

Click the up button next to "Dashboard" to return it to the top, and verify the main sidebar also reverts.

```
preview_screenshot → after first click, verify Jarvis/Dashboard swapped in BOTH the settings list AND the main sidebar
preview_network → filter to "/api/settings/nav-order" and confirm a PUT request with status 200
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings-nav.ts src/app/settings/navigation/page.tsx
git commit -m "$(cat <<'EOF'
feat(settings): add Navigation settings page for reordering sidebar

New admin-only /settings/navigation page with up/down buttons that
reorder the sidebar nav items. Uses the same pattern as the existing
/settings/statuses page. Saves optimistically with revert on API
failure and triggers the NavOrderProvider to refresh so the main
sidebar updates live.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: End-to-end verification

**Files:** None (verification only)

Run the full 10-item verification checklist from the spec. Each check is a manual step against the dev preview; any failure means returning to the relevant task to debug.

- [ ] **Check 1: Migration applied cleanly**

Run in Supabase SQL editor:

```sql
SELECT COUNT(*) FROM nav_items;
```

Expected: `10`.

- [ ] **Check 2: "Navigation" entry visible in settings sub-nav**

Log in as admin, visit `/settings`, confirm "Navigation" appears between "Appearance" and "Job Statuses" in the left sub-nav.

- [ ] **Check 3: Admin reorder round-trip**

On `/settings/navigation`:
1. Move Dashboard down one position → toast "Order saved", main sidebar updates live
2. Verify `nav_items` table in Supabase shows Dashboard with `sort_order = 2` and Jarvis with `sort_order = 1`
3. Move Dashboard back to the top → toast + sidebar + DB all revert

- [ ] **Check 4: Non-admin sees "Admins only"**

Log in as a non-admin user. Visit `/settings/navigation` directly via URL. Expected: the page shows "Admins only." and no list.

- [ ] **Check 5: API rejects non-admin PUT (403)**

While signed in as non-admin, in DevTools:

```js
fetch("/api/settings/nav-order", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ order: ["/"] }),
}).then(r => r.status).then(console.log)
```

Expected: `403`.

- [ ] **Check 6: RLS rejects direct non-admin write**

While signed in as non-admin, in DevTools:

```js
// Use the in-page supabase client if accessible, or construct one from the env vars
const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);
const { error } = await sb.from("nav_items").update({ sort_order: 99 }).eq("href", "/");
console.log("error:", error);
```

Expected: error (RLS policy violation) OR update silently affects 0 rows.

- [ ] **Check 7: "New item in code" fallback**

In `src/lib/nav-items.ts`, temporarily add a dummy entry at the top:

```ts
{ href: "/nonexistent", label: "Dummy", icon: LayoutDashboard },
```

Reload `/settings/navigation`. Expected: "Dummy" appears at the bottom of the list (not the top where it's coded) because it's not in the DB, and falls to `Infinity` via the sort algorithm. The main sidebar also shows it at the bottom.

Remove the dummy entry. Reload. Confirm sidebar and settings page return to 10 items.

- [ ] **Check 8: Optimistic revert on API failure**

In `src/app/api/settings/nav-order/route.ts`, temporarily make PUT always return 500 — add this as the first line of the PUT handler:

```ts
return NextResponse.json({ error: "forced failure" }, { status: 500 });
```

On `/settings/navigation`, click the down button next to Dashboard. Expected:
- Dashboard/Jarvis briefly appear swapped
- Toast: "forced failure"
- List snaps back to original order

Revert the forced failure line and reload.

- [ ] **Check 9: Mobile menu respects order**

Resize the preview to mobile width (375px) with `preview_resize`. Tap the hamburger icon. Confirm the items appear in the same order as the desktop sidebar. Change the order on `/settings/navigation`, return to mobile view, confirm the mobile menu reflects the new order.

- [ ] **Check 10: No flash of wrong order on cold reload**

Open a fresh incognito window, sign in, navigate to `/`. Watch the sidebar as the page loads. Expected: the sidebar renders in default code order for a brief moment, then settles into the DB order. No empty sidebar, no layout flicker.

- [ ] **Final: Mark complete**

If all 10 checks pass, the feature is complete. If any check fails, diagnose and fix before declaring done.

No additional commit — verification is the final step.

---

## Self-Review (already performed)

**Spec coverage:** Every section of the spec is covered by a task:
- Spec §1 (Data Model) → Task 1
- Spec §2 (Architecture) → Tasks 2, 3, 4
- Spec §3 (Sort Algorithm) → Task 5
- Spec §4 (Settings Page UX) → Task 6
- Spec §5 (Error Handling) → covered within Tasks 3 and 6
- Spec §6 (Verification Plan) → Task 7

**Placeholder scan:** No TBDs, no "implement later", no vague "handle edge cases" — every step contains concrete code or a specific command.

**Type consistency:** `NavItem` defined in `src/lib/nav-items.ts` is used identically in `nav.tsx` and the settings page. The sort algorithm is duplicated verbatim in two places (nav.tsx and the settings page) — this is intentional so the settings page and the live sidebar agree on order during the loading window. The API request/response shapes are consistent between the route handler and both the NavOrderProvider and the settings page.
