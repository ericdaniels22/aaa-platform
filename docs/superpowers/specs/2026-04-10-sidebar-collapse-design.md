# Sidebar Collapse — Design Spec

**Date:** 2026-04-10
**Status:** Approved (brainstorming)
**Scope:** Desktop sidebar collapse-to-icons toggle

## Goal

Add a toggle button to the sidebar that shrinks it to an icon-only rail, giving the main content area more horizontal space. The user's choice persists per browser via localStorage.

## Non-Goals

- Keyboard shortcut (can be added later)
- Per-user, cross-device persistence via the database
- Auto-collapse at intermediate viewport widths
- Any change to the mobile (`<lg`) hamburger + slide-out overlay behavior

## Context

The current sidebar lives in `src/components/nav.tsx` and is a fixed `w-52` (208px) panel showing a logo, an icon+label nav list, and a user footer. `src/components/app-shell.tsx` offsets the `main` element with `lg:ml-52` to make room. Both values are hardcoded.

`src/lib/nav-order-context.tsx` already demonstrates the "client context provider wrapping the app shell" pattern, and the email list-width feature already demonstrates "default on server, hydrate from localStorage in an effect." This design reuses both patterns.

## Architecture

### New context provider

`src/lib/sidebar-collapse-context.tsx` — a client component exporting:

```tsx
type SidebarCollapseContextValue = {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
};
```

- Initial state: `collapsed = false` on both server and first client render (matches current behavior, avoids hydration mismatch).
- `useEffect` on mount reads `localStorage.getItem("sidebar-collapsed")` and calls `setCollapsed(true)` if the stored value is `"1"`.
- `toggle()` flips state and synchronously writes `"1"` or `"0"` to localStorage.
- `useSidebarCollapse()` hook throws if used outside the provider (same pattern as `useNavOrder`).

### Provider placement

`src/app/layout.tsx` — wrap `<AppShell>` in `<SidebarCollapseProvider>`, placed inside the existing `<NavOrderProvider>` so both the sidebar and the `AppShell` main element share the same state.

### Consumers

- `src/components/nav.tsx` — reads `collapsed` to conditionally render labels, adjust widths, change header/footer layout, and render the toggle button.
- `src/components/app-shell.tsx` — reads `collapsed` to switch the `main` element's left offset between `lg:ml-52` and `lg:ml-16`.

## Visual Layout

### Widths

| State     | Sidebar | Main offset  |
| --------- | ------- | ------------ |
| Expanded  | `w-52`  | `lg:ml-52`   |
| Collapsed | `w-16`  | `lg:ml-16`   |

`w-16` (64px) is tight enough to feel like an icon rail while still giving each icon a comfortable `w-10 h-10` hit area centered inside the bar.

### Header (logo area)

- **Expanded:** full logo image (140×51) on the left, `NotificationBell` on the right, toggle button on the far right. Matches the current look, plus the new toggle button.
- **Collapsed:** small logo mark centered at the top, toggle button centered below it, `NotificationBell` centered below the toggle. All inside the existing header region with the `border-b` preserved. If no logo mark asset exists, use a 40×40 square with the gradient background and "AAA" initials as a stand-in.

### Nav items

- **Expanded:** `flex items-center gap-2.5 px-2.5 py-2` with icon + label — unchanged from today.
- **Collapsed:** `flex items-center justify-center p-2` with icon only (no label). Active/hover backgrounds keep the `rounded-lg` treatment and become roughly square, `w-10 h-10` inside the `w-16` bar. The label `<span>` is omitted from the JSX entirely (not hidden via CSS) so there's nothing to overflow during the width transition.

### Footer (user area)

- **Expanded:** avatar circle + name/role + sign-out icon — unchanged.
- **Collapsed:** avatar circle centered, no name/role text. Sign-out icon stacks directly below the avatar, centered. Both remain clickable.

### Mobile (`<lg`)

Untouched. The hamburger + slide-out overlay behavior stays exactly as it is today. The collapse toggle button itself is `hidden lg:flex`, so mobile never sees it.

### Toggle button

- Icon: `PanelLeftClose` (lucide) when expanded, `PanelLeftOpen` when collapsed.
- Styled consistently with the existing `NotificationBell` button in the sidebar header.
- `aria-label` reflects state: `"Collapse sidebar"` when expanded, `"Expand sidebar"` when collapsed.
- `aria-expanded={!collapsed}`.
- Visibility: `hidden lg:flex`.

## Interactions

### Toggle

Clicking the toggle flips `collapsed` in context and writes the new value to localStorage immediately.

### Transition

Both the sidebar width and the main content offset animate via `transition-[width,margin] duration-200 ease-out`. This harmonizes with the existing `transition-transform duration-200` already used for the mobile slide-in.

Labels are omitted from the JSX (not CSS-hidden) when `collapsed` is true, so there's no awkward text overflow during the width shrink.

### Tooltips (collapsed mode only)

Use `@base-ui/react`'s `Tooltip` component (already in dependencies — no new dependency added).

- In collapsed mode, each nav `<Link>` is wrapped in `<Tooltip.Root>` → `<Tooltip.Trigger>` → `<Tooltip.Portal>` → `<Tooltip.Positioner side="right" sideOffset={8}>` → `<Tooltip.Popup>`. Tooltip content is the nav item's `label`.
- Short open delay (~300ms) so tooltips don't flash on quick mouse passes.
- In expanded mode the tooltip wrapper is omitted entirely — no runtime cost, no stray tooltips when the label is already visible.
- The sign-out button in the collapsed footer also gets a `"Sign out"` tooltip for consistency.

### Hydration behavior

- Server render: `collapsed=false` (expanded).
- First client render: `collapsed=false` (matches server — no hydration mismatch, no `suppressHydrationWarning` needed).
- After mount: the provider's `useEffect` reads localStorage; if the stored value is `"1"`, it calls `setCollapsed(true)`, and the sidebar animates to collapsed.
- This produces a brief flash of expanded state on reload for users who had it collapsed. This is the same trade-off as the existing email `listWidth` feature and is accepted.

### Accessibility

- Toggle button: `aria-label` reflects state, `aria-expanded={!collapsed}`.
- Nav links in collapsed mode get `aria-label={item.label}` since the visible label is gone.
- `@base-ui/react`'s `Tooltip` component provides correct ARIA wiring automatically.

## Data Flow

```
localStorage "sidebar-collapsed"
        │
        ▼
SidebarCollapseProvider (mount effect reads, toggle() writes)
        │
        ├── useSidebarCollapse() in nav.tsx     → conditional layout, labels, tooltips, toggle button
        └── useSidebarCollapse() in app-shell   → main element's lg:ml-52 ↔ lg:ml-16
```

Single source of truth; two consumers. No prop drilling.

## Files Touched

**New**
- `src/lib/sidebar-collapse-context.tsx`

**Modified**
- `src/app/layout.tsx` — wrap `<AppShell>` in `<SidebarCollapseProvider>`
- `src/components/nav.tsx` — consume hook, branch layout on `collapsed`, add toggle button, wrap nav links in `Tooltip` when collapsed
- `src/components/app-shell.tsx` — consume hook, branch `main` offset

**Not touched**
- `src/lib/nav-items.ts`
- `src/lib/nav-order-context.tsx`
- `supabase/` (no DB changes)
- Mobile top bar / overlay code path
- Any other page or module

## Manual Verification

After implementation, verify in the preview:

1. Start in expanded state (default).
2. Click the toggle button. Sidebar animates to `w-16`, main area animates to `ml-16`, labels disappear, logo/footer collapse to icons.
3. Hover a nav icon → tooltip appears on the right with the item's label after ~300ms.
4. Reload the page. Brief flash of expanded, then collapses. State preserved.
5. Click toggle again. Sidebar and main animate back. Labels return. Reload → stays expanded.
6. Resize below `lg` breakpoint. Mobile hamburger behavior unchanged. Collapse toggle is hidden.
7. Navigate between pages (`/`, `/jobs`, `/email`, `/settings`). Active-state highlighting still works in both modes.
8. Tab into the toggle button and nav links; `aria-label` and `aria-expanded` announce correctly.

## Risks

- **Hardcoded `ml-52` elsewhere:** unlikely but possible. Grep the codebase during implementation for any other file that assumes the sidebar width, and update it to consume the context too.
- **Nested interactive elements inside tooltip wrappers:** base-ui's `Tooltip.Trigger` with `render` (or `asChild`) semantics needs to be used correctly to avoid double-wrapping the `<Link>`. The implementation should follow the base-ui docs, not guess.
- **Flash on first load:** accepted, matches existing codebase pattern.
