# Sidebar Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggle button to the desktop sidebar that shrinks it to an icon-only rail (`w-16`) with tooltips on hover, persisting the choice per browser via localStorage.

**Architecture:** A new client-side `SidebarCollapseProvider` (mirrors the existing `NavOrderProvider` pattern) holds `{ collapsed, toggle, setCollapsed }`. It defaults to `false` on both server and first client render, then hydrates from localStorage in an effect — same pattern as the existing email `listWidth` feature. Both `src/components/nav.tsx` and `src/components/app-shell.tsx` consume the context so the sidebar width and the `main` element's left offset stay in sync. The existing `@base-ui/react` dep provides the tooltip primitives (`@base-ui/react/tooltip`, which exposes `Tooltip.Provider`, `Tooltip.Root`, `Tooltip.Trigger`, `Tooltip.Portal`, `Tooltip.Positioner`, `Tooltip.Popup`). Mobile (`<lg`) behavior is completely untouched.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 4, `@base-ui/react` (Tooltip), `lucide-react` (`PanelLeftClose`, `PanelLeftOpen`).

**Spec:** `docs/superpowers/specs/2026-04-10-sidebar-collapse-design.md`

**Verification note:** This codebase has no test framework (no jest/vitest/playwright). Each task is verified by running `npx tsc --noEmit` for type safety and by running the dev preview server (`preview_start` with the `next-dev` launch config) and checking the specific observable behavior. The 39 pre-existing tsc errors in `src/app/jarvis/neural-network/**` are known and unrelated — only new errors introduced by this work should block a commit.

---

## Task 1: Create the `SidebarCollapseProvider` context

**Files:**
- Create: `src/lib/sidebar-collapse-context.tsx`

- [ ] **Step 1: Create the new file with the full provider**

Create `src/lib/sidebar-collapse-context.tsx` with this exact content:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "sidebar-collapsed";

type SidebarCollapseContextValue = {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
};

const SidebarCollapseContext =
  createContext<SidebarCollapseContextValue | null>(null);

export function SidebarCollapseProvider({ children }: { children: ReactNode }) {
  // Initial state matches the server render (expanded) to avoid a hydration
  // mismatch. We hydrate from localStorage in an effect after mount — same
  // pattern as the email list width feature.
  const [collapsed, setCollapsedState] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "1") {
      setCollapsedState(true);
    }
  }, []);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // localStorage can throw (e.g. private browsing / quota). The in-memory
      // state still updates, so the UI remains functional for the session.
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // See note above.
      }
      return next;
    });
  }, []);

  return (
    <SidebarCollapseContext.Provider
      value={{ collapsed, toggle, setCollapsed }}
    >
      {children}
    </SidebarCollapseContext.Provider>
  );
}

export function useSidebarCollapse(): SidebarCollapseContextValue {
  const ctx = useContext(SidebarCollapseContext);
  if (!ctx) {
    throw new Error(
      "useSidebarCollapse must be used within a SidebarCollapseProvider",
    );
  }
  return ctx;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`

Expected: No new errors in `src/lib/sidebar-collapse-context.tsx`. (Pre-existing errors in `src/app/jarvis/neural-network/**` are unrelated and can be ignored.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/sidebar-collapse-context.tsx
git commit -m "feat(nav): add SidebarCollapseProvider context"
```

---

## Task 2: Wire `SidebarCollapseProvider` into the root layout

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Add the import and wrap `<AppShell>` with the new provider**

In `src/app/layout.tsx`, add the import after the existing `NavOrderProvider` import (around line 9), and wrap `<AppShell>` so the provider sits inside `<NavOrderProvider>` and outside `<AppShell>`.

Change the import section from:

```tsx
import { NavOrderProvider } from "@/lib/nav-order-context";
import AppShell from "@/components/app-shell";
```

to:

```tsx
import { NavOrderProvider } from "@/lib/nav-order-context";
import { SidebarCollapseProvider } from "@/lib/sidebar-collapse-context";
import AppShell from "@/components/app-shell";
```

Change the JSX block from:

```tsx
<NavOrderProvider>
  <BrandColorsProvider />
  <AppShell>{children}</AppShell>
  <Toaster />
</NavOrderProvider>
```

to:

```tsx
<NavOrderProvider>
  <SidebarCollapseProvider>
    <BrandColorsProvider />
    <AppShell>{children}</AppShell>
    <Toaster />
  </SidebarCollapseProvider>
</NavOrderProvider>
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`

Expected: No new errors.

- [ ] **Step 3: Start the preview server and verify the app still loads**

Run: `preview_start` with name `"next-dev"`.

Then run: `preview_console_logs` with `level: "error"`.

Expected: No React errors about missing providers, no hydration mismatches. The home page should render normally with the sidebar in its current (expanded) state.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(nav): wire SidebarCollapseProvider into root layout"
```

---

## Task 3: Make `AppShell` react to collapsed state

**Files:**
- Modify: `src/components/app-shell.tsx`

- [ ] **Step 1: Replace the file contents to consume the hook**

Replace `src/components/app-shell.tsx` entirely with:

```tsx
"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/nav";
import { useSidebarCollapse } from "@/lib/sidebar-collapse-context";
import { cn } from "@/lib/utils";

const AUTH_ROUTES = ["/login", "/logout"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { collapsed } = useSidebarCollapse();
  const isAuthPage = AUTH_ROUTES.some((r) => pathname.startsWith(r));

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <>
      <Sidebar />
      <main
        className={cn(
          "pt-14 lg:pt-0 min-h-screen transition-[margin] duration-200 ease-out",
          collapsed ? "lg:ml-16" : "lg:ml-52",
        )}
      >
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </>
  );
}
```

Note: `collapsed` defaults to `false`, and there's no UI to toggle it yet, so this task produces no visible change. It only prepares the main content area to react when Task 4 adds the toggle button.

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`

Expected: No new errors.

- [ ] **Step 3: Visually verify the home page looks unchanged**

With the dev server running, run: `preview_screenshot`.

Expected: Home page looks identical to before this task — sidebar on the left at `w-52`, main content offset by `ml-52`.

Then run: `preview_inspect` with selector `"main"` and styles `["marginLeft"]`.

Expected: `marginLeft` is `208px` (= `lg:ml-52` at desktop width).

- [ ] **Step 4: Commit**

```bash
git add src/components/app-shell.tsx
git commit -m "feat(nav): make AppShell react to sidebar collapsed state"
```

---

## Task 4: Add toggle button, sidebar width branching, and nav-item collapse in `nav.tsx`

This is the first task with visible behavior. After this commit, clicking the toggle will shrink the sidebar to `w-16`, hide nav labels, and shift the main content. The logo area and user footer will look cramped in collapsed mode — Task 5 fixes that.

**Files:**
- Modify: `src/components/nav.tsx`

- [ ] **Step 1: Update imports**

In `src/components/nav.tsx`, replace the existing import block (lines 1-12) with:

```tsx
"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import NotificationBell from "@/components/notification-bell";
import { navItems } from "@/lib/nav-items";
import { useNavOrder } from "@/lib/nav-order-context";
import { useSidebarCollapse } from "@/lib/sidebar-collapse-context";
```

- [ ] **Step 2: Read the collapsed state inside the component**

Directly after the existing `const { order } = useNavOrder();` line, add:

```tsx
  const { collapsed, toggle } = useSidebarCollapse();
```

- [ ] **Step 3: Branch the `<aside>` width**

Change the `<aside>` opening tag (currently a fixed `w-52`) from:

```tsx
<aside
  className={cn(
    "fixed top-0 left-0 z-40 h-full w-52 gradient-sidebar flex flex-col transition-transform duration-200",
    "lg:translate-x-0",
    mobileOpen ? "translate-x-0" : "-translate-x-full"
  )}
>
```

to:

```tsx
<aside
  className={cn(
    "fixed top-0 left-0 z-40 h-full gradient-sidebar flex flex-col transition-[transform,width] duration-200 ease-out",
    "lg:translate-x-0",
    mobileOpen ? "translate-x-0" : "-translate-x-full",
    // Mobile overlay is always full sidebar width. Collapse only applies at lg+.
    collapsed ? "w-52 lg:w-16" : "w-52",
  )}
>
```

Rationale: on mobile the slide-out overlay should always show the full-width sidebar (even if the user had collapsed it on desktop earlier), so `w-52` is unconditional below `lg` and `lg:w-16` only applies at desktop when collapsed.

- [ ] **Step 4: Add the toggle button to the existing (expanded) header**

Change the header `<div>` (currently lines 78-83) from:

```tsx
<div className="px-4 py-1 border-b border-white/10 flex items-center justify-between overflow-hidden">
  <Image src="/logo.png" alt="AAA Disaster Recovery" width={140} height={51} className="-my-2" />
  <div className="hidden lg:block">
    <NotificationBell />
  </div>
</div>
```

to:

```tsx
<div className="px-4 py-1 border-b border-white/10 flex items-center justify-between overflow-hidden">
  <Image src="/logo.png" alt="AAA Disaster Recovery" width={140} height={51} className="-my-2" />
  <div className="hidden lg:flex items-center gap-1">
    <NotificationBell />
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
    >
      {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
    </button>
  </div>
</div>
```

Note: this adds the toggle button in the expanded layout only. Task 5 will introduce a second layout branch for collapsed mode. For this task, the button still works in collapsed mode — it just won't look pretty until Task 5.

- [ ] **Step 5: Branch the nav item layout**

Replace the entire nav map (currently lines 86-110) from:

```tsx
<nav className="flex-1 px-3 py-4 space-y-1">
  {sortedNavItems.map((item) => {
    const isActive =
      item.href === "/"
        ? pathname === "/"
        : pathname.startsWith(item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-200",
          isActive
            ? "bg-[image:var(--gradient-primary)] text-white shadow-lg shadow-[oklch(0.45_0.18_165_/_25%)]"
            : "text-white/60 hover:text-white hover:bg-white/10"
        )}
      >
        <item.icon size={18} />
        {item.label}
      </Link>
    );
  })}
</nav>
```

to:

```tsx
<nav className="flex-1 px-3 py-4 space-y-1">
  {sortedNavItems.map((item) => {
    const isActive =
      item.href === "/"
        ? pathname === "/"
        : pathname.startsWith(item.href);

    // In collapsed mode on desktop, we render an icon-only square centered
    // in the rail. On mobile, the sidebar is always full-width (the mobile
    // overlay ignores `collapsed`), so we keep the expanded layout there.
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        aria-label={collapsed ? item.label : undefined}
        className={cn(
          "rounded-lg text-sm font-medium transition-all duration-200",
          isActive
            ? "bg-[image:var(--gradient-primary)] text-white shadow-lg shadow-[oklch(0.45_0.18_165_/_25%)]"
            : "text-white/60 hover:text-white hover:bg-white/10",
          collapsed
            ? "flex items-center justify-center w-10 h-10 mx-auto"
            : "flex items-center gap-2.5 px-2.5 py-2",
        )}
      >
        <item.icon size={18} />
        {!collapsed && item.label}
      </Link>
    );
  })}
</nav>
```

Notes:
- `aria-label` is added only in collapsed mode, because in expanded mode the visible text label already gives the link its accessible name.
- `{!collapsed && item.label}` omits the label node entirely when collapsed — there's no text to overflow during the width transition.
- Mobile behavior: because the mobile overlay renders the `<aside>` at `w-52` regardless of `collapsed`, the collapsed-layout classes (`w-10 h-10 mx-auto`) still apply inside the overlay if the user happens to have collapsed the desktop sidebar. This is cosmetically a minor edge case; accepted for v1.

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`

Expected: No new errors.

- [ ] **Step 7: Verify the toggle works end-to-end**

With the dev server running:

1. Run: `preview_screenshot` — confirm expanded sidebar looks the same as before, now with a toggle icon next to the bell.
2. Run: `preview_click` with selector `'button[aria-label="Collapse sidebar"]'`.
3. Run: `preview_inspect` with selector `"aside"` and styles `["width"]`. Expected: `64px` (= `w-16`).
4. Run: `preview_inspect` with selector `"main"` and styles `["marginLeft"]`. Expected: `64px`.
5. Run: `preview_snapshot` — confirm nav items now show icons only (no label text).
6. Run: `preview_click` with selector `'button[aria-label="Expand sidebar"]'`.
7. Run: `preview_inspect` with selector `"aside"` and styles `["width"]`. Expected: `208px` (= `w-52`).

Expected overall: toggling flips the sidebar between 208px and 64px, the main content margin follows, and the nav labels appear/disappear accordingly. The logo and user footer will look visually awkward in collapsed mode at this point — that is expected and fixed in Task 5.

- [ ] **Step 8: Verify persistence**

1. Run: `preview_click` with selector `'button[aria-label="Collapse sidebar"]'` to collapse.
2. Run: `preview_eval` with expression `localStorage.getItem("sidebar-collapsed")`. Expected: `"1"`.
3. Run: `preview_eval` with expression `window.location.reload()`.
4. Run: `preview_inspect` with selector `"aside"` and styles `["width"]`. Expected: `64px` (or briefly `208px` during the hydration flash, then `64px` — re-inspect after a short delay if needed).
5. Run: `preview_click` with selector `'button[aria-label="Expand sidebar"]'` to expand again (leave the app in expanded state for the next task).

- [ ] **Step 9: Commit**

```bash
git add src/components/nav.tsx
git commit -m "feat(nav): add sidebar collapse toggle and icon-only nav items"
```

---

## Task 5: Collapse the logo header and user footer to icon-only layouts

**Files:**
- Modify: `src/components/nav.tsx`

- [ ] **Step 1: Branch the header layout on `collapsed`**

Replace the entire header `<div>` block (the one created in Task 4) with a conditional that renders one of two layouts. Find this block:

```tsx
<div className="px-4 py-1 border-b border-white/10 flex items-center justify-between overflow-hidden">
  <Image src="/logo.png" alt="AAA Disaster Recovery" width={140} height={51} className="-my-2" />
  <div className="hidden lg:flex items-center gap-1">
    <NotificationBell />
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-expanded={!collapsed}
      className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
    >
      {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
    </button>
  </div>
</div>
```

Replace it with:

```tsx
{collapsed ? (
  <div className="px-2 py-2 border-b border-white/10 flex flex-col items-center gap-1.5 overflow-hidden">
    {/* Logo mark (AAA initials square) */}
    <div className="w-10 h-10 rounded-lg bg-[image:var(--gradient-primary)] flex items-center justify-center shrink-0 shadow-sm">
      <span className="text-[11px] font-bold text-white tracking-tight">
        AAA
      </span>
    </div>
    <div className="hidden lg:flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={toggle}
        aria-label="Expand sidebar"
        aria-expanded={false}
        className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
      >
        <PanelLeftOpen size={18} />
      </button>
      <NotificationBell />
    </div>
  </div>
) : (
  <div className="px-4 py-1 border-b border-white/10 flex items-center justify-between overflow-hidden">
    <Image
      src="/logo.png"
      alt="AAA Disaster Recovery"
      width={140}
      height={51}
      className="-my-2"
    />
    <div className="hidden lg:flex items-center gap-1">
      <NotificationBell />
      <button
        type="button"
        onClick={toggle}
        aria-label="Collapse sidebar"
        aria-expanded={true}
        className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
      >
        <PanelLeftClose size={18} />
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 2: Branch the user footer layout on `collapsed`**

Replace the entire footer `<div className="px-3 py-3 border-t border-white/10">` block (currently the last block inside `<aside>`) — find this block:

```tsx
<div className="px-3 py-3 border-t border-white/10">
  {profile ? (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-[image:var(--gradient-primary)] flex items-center justify-center shrink-0 shadow-sm">
        <span className="text-xs font-semibold text-white">{initials}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white/90 truncate">{profile.full_name}</p>
        <p className="text-[10px] text-white/40 capitalize">{profile.role.replace("_", " ")}</p>
      </div>
      <button
        onClick={handleSignOut}
        className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors"
        title="Sign out"
      >
        <LogOut size={16} />
      </button>
    </div>
  ) : (
    <p className="text-white/30 text-xs">AAA Platform v1.0</p>
  )}
</div>
```

Replace it with:

```tsx
<div className="px-3 py-3 border-t border-white/10">
  {profile ? (
    collapsed ? (
      <div className="flex flex-col items-center gap-2">
        <div
          className="w-8 h-8 rounded-full bg-[image:var(--gradient-primary)] flex items-center justify-center shrink-0 shadow-sm"
          title={`${profile.full_name} — ${profile.role.replace("_", " ")}`}
        >
          <span className="text-xs font-semibold text-white">{initials}</span>
        </div>
        <button
          onClick={handleSignOut}
          className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut size={16} />
        </button>
      </div>
    ) : (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-[image:var(--gradient-primary)] flex items-center justify-center shrink-0 shadow-sm">
          <span className="text-xs font-semibold text-white">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white/90 truncate">
            {profile.full_name}
          </p>
          <p className="text-[10px] text-white/40 capitalize">
            {profile.role.replace("_", " ")}
          </p>
        </div>
        <button
          onClick={handleSignOut}
          className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut size={16} />
        </button>
      </div>
    )
  ) : (
    <p className="text-white/30 text-xs">AAA Platform v1.0</p>
  )}
</div>
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`

Expected: No new errors.

- [ ] **Step 4: Visually verify collapsed and expanded states**

With the dev server running:

1. Start in expanded state. Run: `preview_screenshot`. Expected: full logo, full user footer with name/role — identical to before this task.
2. Run: `preview_click` with selector `'button[aria-label="Collapse sidebar"]'`.
3. Run: `preview_screenshot`. Expected: sidebar is narrow (`w-16`), shows:
   - At top: small "AAA" initials square, then the expand-sidebar toggle button, then the notification bell — all centered vertically.
   - In the middle: nav item icons centered, no labels.
   - At bottom: avatar circle centered, sign-out button centered directly below it, no name/role text.
4. Run: `preview_inspect` with selector `'aside >div:first-child'` and styles `["flexDirection", "alignItems"]`. Expected: `column` / `center`.
5. Run: `preview_click` with selector `'button[aria-label="Expand sidebar"]'`.
6. Run: `preview_screenshot`. Expected: back to the full expanded layout.

- [ ] **Step 5: Verify mobile behavior is unaffected**

Run: `preview_resize` with `preset: "mobile"`.

Run: `preview_screenshot`. Expected: mobile top bar visible with hamburger menu; no sidebar visible on the page. The collapse toggle should NOT be visible anywhere.

Run: `preview_click` with selector `'button[aria-label]'` that corresponds to the mobile hamburger — or, more reliably, run `preview_eval` with expression `document.querySelector('header button[class*="text-white"]')?.click()` then screenshot. Expected: the mobile slide-out sidebar appears in its original full-width layout (`w-52`), regardless of whether `collapsed` is true in localStorage.

Run: `preview_resize` with `preset: "desktop"` to reset.

- [ ] **Step 6: Commit**

```bash
git add src/components/nav.tsx
git commit -m "feat(nav): collapse logo header and user footer to icon-only layouts"
```

---

## Task 6: Add tooltips on collapsed nav items and the sign-out button

**Files:**
- Modify: `src/components/nav.tsx`

- [ ] **Step 1: Add the Tooltip import**

In `src/components/nav.tsx`, add this import directly below the existing `import { useSidebarCollapse } ...` line:

```tsx
import { Tooltip } from "@base-ui/react/tooltip";
```

- [ ] **Step 2: Wrap the entire `<aside>` in a `Tooltip.Provider` and branch the nav map on `collapsed`**

The Provider lives once at the top of the sidebar DOM tree so every tooltip inside the aside (nav items in this step, sign-out button in the next step) shares the same 300ms open delay.

Wrap the existing `<aside>` element in `Tooltip.Provider`. Change:

```tsx
{/* Sidebar */}
<aside
  className={cn(
```

to:

```tsx
{/* Sidebar */}
<Tooltip.Provider delay={300}>
  <aside
    className={cn(
```

And at the matching closing tag, change:

```tsx
      </div>
    </aside>
  </>
);
```

to:

```tsx
      </div>
    </aside>
  </Tooltip.Provider>
</>
);
```

(The exact indentation inside `<aside>` is unchanged — only the wrapping Provider and closing tag are added.)

Then replace the entire `<nav>` block that was written in Task 4:

```tsx
<nav className="flex-1 px-3 py-4 space-y-1">
  {sortedNavItems.map((item) => {
    const isActive =
      item.href === "/"
        ? pathname === "/"
        : pathname.startsWith(item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        aria-label={collapsed ? item.label : undefined}
        className={cn(
          "rounded-lg text-sm font-medium transition-all duration-200",
          isActive
            ? "bg-[image:var(--gradient-primary)] text-white shadow-lg shadow-[oklch(0.45_0.18_165_/_25%)]"
            : "text-white/60 hover:text-white hover:bg-white/10",
          collapsed
            ? "flex items-center justify-center w-10 h-10 mx-auto lg:w-10 lg:h-10"
            : "flex items-center gap-2.5 px-2.5 py-2",
        )}
      >
        <item.icon size={18} />
        {!collapsed && item.label}
      </Link>
    );
  })}
</nav>
```

with:

```tsx
<nav className="flex-1 px-3 py-4 space-y-1">
  {sortedNavItems.map((item) => {
    const isActive =
      item.href === "/"
        ? pathname === "/"
        : pathname.startsWith(item.href);

    const linkClassName = cn(
      "rounded-lg text-sm font-medium transition-all duration-200",
      isActive
        ? "bg-[image:var(--gradient-primary)] text-white shadow-lg shadow-[oklch(0.45_0.18_165_/_25%)]"
        : "text-white/60 hover:text-white hover:bg-white/10",
      collapsed
        ? "flex items-center justify-center w-10 h-10 mx-auto"
        : "flex items-center gap-2.5 px-2.5 py-2",
    );

    if (!collapsed) {
      // Expanded mode: no tooltip — the visible label is the accessible name.
      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setMobileOpen(false)}
          className={linkClassName}
        >
          <item.icon size={18} />
          {item.label}
        </Link>
      );
    }

    // Collapsed mode: wrap the Link as a Tooltip.Trigger render target.
    return (
      <Tooltip.Root key={item.href}>
        <Tooltip.Trigger
          render={
            <Link
              href={item.href}
              onClick={() => setMobileOpen(false)}
              aria-label={item.label}
              className={linkClassName}
            >
              <item.icon size={18} />
            </Link>
          }
        />
        <Tooltip.Portal>
          <Tooltip.Positioner side="right" sideOffset={8}>
            <Tooltip.Popup className="z-50 rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-lg ring-1 ring-white/10">
              {item.label}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  })}
</nav>
```

Notes:
- Each branch returns a top-level element with its own `key={item.href}` — no extra `<div>` wrapper, so the `<nav>`'s `space-y-1` rule still spaces items the same way it did before.
- `Tooltip.Trigger`'s `render` prop swaps the default `<button>` for our `<Link>`, the same pattern used in `src/components/ui/dialog.tsx` for `DialogPrimitive.Close`'s `render={<Button ... />}`.
- `Tooltip.Root` itself does not render a DOM wrapper; the Trigger's element is what the `<nav>` sees as a direct child, so `space-y-1` continues to work in collapsed mode.

- [ ] **Step 3: Add a tooltip to the collapsed sign-out button**

The `Tooltip.Provider` is already in place around the whole `<aside>` from Step 2, so this step just wraps the sign-out button in a `Tooltip.Root` that inherits the 300ms delay.

In the collapsed branch of the user footer (added in Task 5), find the sign-out button:

```tsx
<button
  onClick={handleSignOut}
  className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors"
  aria-label="Sign out"
  title="Sign out"
>
  <LogOut size={16} />
</button>
```

Replace it with:

```tsx
<Tooltip.Root>
  <Tooltip.Trigger
    render={
      <button
        onClick={handleSignOut}
        className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="Sign out"
      >
        <LogOut size={16} />
      </button>
    }
  />
  <Tooltip.Portal>
    <Tooltip.Positioner side="right" sideOffset={8}>
      <Tooltip.Popup className="z-50 rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-lg ring-1 ring-white/10">
        Sign out
      </Tooltip.Popup>
    </Tooltip.Positioner>
  </Tooltip.Portal>
</Tooltip.Root>
```

Note: the `title="Sign out"` attribute has been removed to avoid the native browser tooltip competing with the base-ui tooltip. `aria-label` still provides the accessible name.

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`

Expected: No new errors. If `Tooltip.Trigger`'s `render` prop type complains about the `<Link>` ref, verify that `next/link` forwards refs (it does in Next.js 13+). No change should be needed.

- [ ] **Step 5: Verify tooltips work**

With the dev server running:

1. Start in expanded state. Run: `preview_screenshot`. Expected: no change from Task 5 in expanded mode.
2. Run: `preview_click` with selector `'button[aria-label="Collapse sidebar"]'`.
3. Run: `preview_eval` with expression:
   ```js
   (() => {
     const link = document.querySelector('aside a[href="/jobs"]');
     if (!link) return "no link";
     const event = new MouseEvent("pointerenter", { bubbles: true });
     link.dispatchEvent(event);
     return "dispatched";
   })()
   ```
4. Wait ~400ms (pass `duration: 0` to a `preview_eval` timeout, or simply run the next command after a brief pause): run `preview_snapshot`. Look for a tooltip element in the rendered text tree containing the text `"Jobs"`.
5. Run: `preview_eval` with expression:
   ```js
   (() => {
     const link = document.querySelector('aside a[href="/jobs"]');
     const event = new MouseEvent("pointerleave", { bubbles: true });
     link.dispatchEvent(event);
     return "dispatched";
   })()
   ```
6. Run: `preview_snapshot`. Expected: tooltip gone.

If automating the hover via `preview_eval` proves flaky, fall back to `preview_screenshot` after calling `preview_click` on the sign-out button's trigger — the click opens the tooltip in base-ui the same way hover does (for the purposes of verification only; don't actually sign out, because the click handler will fire). Alternative: temporarily set `defaultOpen` on one `Tooltip.Root` to visually confirm the popup styles in a screenshot, then revert before committing.

7. Verify the expand button still works: run `preview_click` with selector `'button[aria-label="Expand sidebar"]'`.
8. Run: `preview_screenshot`. Expected: expanded state — no tooltips visible, labels inline as before.

- [ ] **Step 6: Commit**

```bash
git add src/components/nav.tsx
git commit -m "feat(nav): add tooltips for collapsed nav items and sign-out"
```

---

## Task 7: Full manual verification checklist

**Files:**
- None (verification-only task)

- [ ] **Step 1: Confirm types are clean**

Run: `npx tsc --noEmit`

Expected: No new errors beyond the 39 pre-existing errors in `src/app/jarvis/neural-network/**`. If a count is handy: `npx tsc --noEmit 2>&1 | grep -c "error TS"` should be 39 (unchanged from baseline).

- [ ] **Step 2: Run the full verification checklist from the spec**

With the dev server running, walk through each item from the spec's "Manual Verification" section:

1. **Default state is expanded.** Reload with `preview_eval: window.location.reload()`. Screenshot — expanded `w-52`.
2. **Clicking toggle collapses.** `preview_click 'button[aria-label="Collapse sidebar"]'`. Inspect `aside` width → `64px`, inspect `main` marginLeft → `64px`. Screenshot → logo/footer/nav all icon-only.
3. **Hover shows tooltip on the right with the item's label after ~300ms.** (Covered in Task 6; re-verify by hovering one item.)
4. **Reload persists collapsed state.** `preview_eval: window.location.reload()`. After a brief delay, inspect `aside` width → `64px`. `preview_eval: localStorage.getItem("sidebar-collapsed")` → `"1"`.
5. **Clicking toggle expands.** `preview_click 'button[aria-label="Expand sidebar"]'`. Inspect widths → back to 208 / 208. Reload → stays expanded. `preview_eval: localStorage.getItem("sidebar-collapsed")` → `"0"`.
6. **Mobile is untouched.** `preview_resize preset: "mobile"`. Screenshot → hamburger top bar, no sidebar, no toggle visible. Open the hamburger → overlay sidebar is full-width regardless of desktop collapsed state.
7. **Active-state highlighting still works in both modes.** Navigate to `/jobs`, `/email`, `/settings` in each mode via `preview_click` on the corresponding links. In each case, inspect the active link's classes to confirm the gradient-primary background is present.
8. **Accessibility — toggle button.** `preview_eval: document.querySelector('button[aria-label*="sidebar"]').getAttribute("aria-expanded")` → `"true"` when expanded, `"false"` when collapsed.
9. **Accessibility — nav links in collapsed mode have aria-label.** In collapsed mode, `preview_eval: document.querySelector('aside a[href="/jobs"]').getAttribute("aria-label")` → `"Jobs"`.
10. **No new console errors.** `preview_console_logs level: "error"` → empty or unchanged from baseline.

- [ ] **Step 3: Grep for any other hardcoded `ml-52` references**

Run the Grep tool with pattern `ml-52` across all of `src/`.

Expected: only `src/components/app-shell.tsx` appears, and that file already uses the conditional class. If any other file shows up with a hardcoded `ml-52`, update it to consume `useSidebarCollapse()` and branch between `lg:ml-52` and `lg:ml-16` the same way `app-shell.tsx` does. Commit separately:

```bash
git add <file>
git commit -m "fix(nav): honor sidebar collapsed state in <file>"
```

- [ ] **Step 4: Stop the dev server**

Run: `preview_stop` with the server ID from `preview_list`.

- [ ] **Step 5: Summarize the finished work**

No commit in this step — verification only. The feature is complete.

---

## Summary

After all tasks complete, the user will have:

- A persistent-per-browser collapsible sidebar with a toggle button in the desktop header
- Icon-only nav items, logo mark, and user footer when collapsed
- Tooltips on the right of each nav item and the sign-out button when collapsed
- Smooth 200ms width/margin transitions
- Unchanged mobile behavior
- No database or migration changes
- No new dependencies (uses existing `@base-ui/react` Tooltip and `lucide-react` icons)
