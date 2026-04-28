# Build 65a — Handoff

**Status:** SHIPPED 2026-04-28
**Branch:** `65a-scaffold` → squash-merged into `main`
**Tag:** `mobile-v0.1.0`
**Plan:** [docs/superpowers/plans/2026-04-26-build-65-mobile-platform.md](../plans/2026-04-26-build-65-mobile-platform.md) §5.1, §11.1
**Surface area:** Capacitor scaffolding + iOS Xcode project tree; offline-fallback stub at `out/index.html`; one `.gitignore` adjustment. **Zero `src/` changes.**

---

## 1. Summary

Build 65a stands up the native iOS shell around the existing Next.js app via Capacitor 8.3.1, configured for live-bundle WebView load against `https://aaaplatform.vercel.app` per plan §5.1's locked decision. The native shell builds in Xcode, signs via Eric's free-tier Apple ID, runs on his iPhone, and serves the live AAA platform — login, navigation, workspace switching, and logout all functional in the WebView.

This is foundation work. No application behavior changed for desktop users; mobile users (with the dev build installed via Xcode) get the same web app rendered inside a native iOS app shell. Build 65b layers on the custom camera UI; 65c adds the upload pipeline; 65d sweeps mobile-responsiveness; 65e ships to the App Store.

The 65a/Windows portion was authored 2026-04-26 (commit `7492bb9`) on a Windows-only laptop; the Mac/iPhone smoke-test session 2026-04-28 (Eric driving) verified the build runs correctly end-to-end on real hardware.

## 2. Real-iPhone verification (2026-04-28, Eric driving on Mac)

All twelve smoke-test items from plan §10's 65a checklist plus a few platform-feature regressions — **all green, no findings.**

| # | Test | Result |
|---|---|---|
| 1 | App launches on Eric's iPhone; AAA dashboard renders | ✅ Pass |
| 2 | Login (email + password) succeeds; authenticated session preserved through WebView | ✅ Pass |
| 3 | Sidebar nav works; navigation to `/jobs`, `/photos`, `/email` all functional | ✅ Pass |
| 4 | Job detail page loads (verified with `WTR-2026-0016`); data renders correctly | ✅ Pass |
| 5 | Workspace switcher: AAA → Test Company → AAA round-trip works | ✅ Pass |
| 5a | Tenant isolation confirmed (TestCo empty, AAA shows 8 jobs) | ✅ Pass |
| 6 | Logout works cleanly, lands on login screen | ✅ Pass |
| 7 | App backgrounding preserves state — reopen still authenticated | ✅ Pass |
| 8 | Deep link smoke: `https://aaaplatform.vercel.app/jobs/<id>` pasted in iOS Notes opens correctly when tapped | ✅ Pass |
| 9 | App icon visible on Home Screen (placeholder; final asset in 65e) | ✅ Pass |
| 10 | No JavaScript console errors observed during testing | ✅ Pass |
| 11 | Notification bell with unread count rendering (Build 14g intact) | ✅ Pass |
| 12 | Brand assets (AAA logo, dark theme, status badges) all rendering | ✅ Pass |

Rule C: zero findings, no adjudication needed. Build 65a is production-ready in the sense that the scaffold itself is correct; the live-bundle approach inherits all production behavior of the existing web app.

## 3. Capacitor versions

| Package | Version | Type |
|---|---|---|
| `@capacitor/core` | ^8.3.1 | dependency |
| `@capacitor/ios` | ^8.3.1 | dependency |
| `@capacitor/cli` | ^8.3.1 | devDependency |

Capacitor 8 uses **Swift Package Manager** for plugin dependencies, not CocoaPods. There is no `Podfile`, no `Podfile.lock`, no `pod install` step. Package resolution happens automatically when Xcode opens the project; transitive native deps are declared in `ios/App/CapApp-SPM/Package.swift`.

## 4. Configuration

`capacitor.config.ts` (root):

```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aaacontracting.platform',
  appName: 'AAA Disaster Recovery',
  webDir: 'out',
  backgroundColor: '#0a0a0aff',
  server: {
    url: 'https://aaaplatform.vercel.app',
    cleartext: false,
    errorPath: 'index.html',
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#0a0a0aff',
  },
};

export default config;
```

- `appId` and `appName` are permanent per plan §8 locked decision 15. Phase 5 white-label rebuilds swap these via per-target Capacitor configs, not by editing this file.
- `server.url` implements §5.1's locked Live Web Bundle decision for 65a/b/c development. Capacitor's docs annotate this as "not intended for use in production"; plan §5.5's architectural decision check at 65e start should flip the App Store target to bundled-static. See §6.1 below.
- `server.errorPath: 'index.html'` makes the WebView fall back to `out/index.html` (committed offline-fallback stub) when Vercel is unreachable on cold launch.
- `backgroundColor: '#0a0a0aff'` matches the stub's dark background to avoid a white flash before WebView paints.
- `ios.contentInset: 'automatic'` respects iOS safe areas (notch, home indicator) without per-page CSS.

## 5. Files added

| Path | Purpose |
|---|---|
| `capacitor.config.ts` | Root Capacitor config (live-bundle, errorPath, ios safe-area) |
| `out/index.html` | Offline-fallback stub (dark spinner page) |
| `ios/` | Xcode project tree — 27 source-of-truth files |
| `ios/App/App.xcodeproj/` | Xcode project descriptor |
| `ios/App/App/AppDelegate.swift` | Capacitor default app delegate |
| `ios/App/App/Info.plist` | iPhone-only, portrait + landscape, HTTPS-only via ATS default |
| `ios/App/App/Assets.xcassets/AppIcon.appiconset/` | Capacitor placeholder icon (final in 65e) |
| `ios/App/App/Assets.xcassets/Splash.imageset/` | Capacitor placeholder splash (final in 65e) |
| `ios/App/App/Base.lproj/{LaunchScreen,Main}.storyboard` | Default launch/main storyboards |
| `ios/App/CapApp-SPM/Package.swift` | Swift Package Manager root for plugin deps |
| `ios/.gitignore` + `ios/App/CapApp-SPM/.gitignore` | Capacitor-managed; correctly excludes derived `cap sync` artifacts |
| `docs/superpowers/build-65/65a-windows-handoff.md` | Phase-1 handoff (Windows steps 1-7), historical |
| `docs/superpowers/build-65/65a-handoff.md` | This document |

Files **modified**:

| Path | Change |
|---|---|
| `package.json` | Capacitor deps + devDep (3 new lines) |
| `package-lock.json` | Transitive deps for Capacitor + SPM tooling (~804 lines) |
| `.gitignore` | `/out/` → `/out/*` + `!/out/index.html` exception so the offline stub gets committed |

`src/` is **not modified**. No application code touched. No migration. No Vercel envvar changes.

## 6. Deferred items (forward flags)

### 6.1 `server.url` and App Review (carry to 65e)

Capacitor's official docs annotate `server.url`, `server.cleartext`, and `server.allowNavigation` as "not intended for use in production." Plan §5.5 already plans for this: bundle-static for App Store, live-bundle for TestFlight dev/beta. The architectural decision check at 65e start should implement this split via per-config-target Capacitor configs.

### 6.2 Bundled-static + Next.js 16 Server Components (forward flag for 65e)

The plan's "switch to bundled-static for App Store" is non-trivial because this codebase uses Next.js 16's App Router with Server Components, API routes, and SSR. `output: 'export'` would break all of those. Three options to evaluate at 65e:

- **(a)** Build a separate static-only mobile bundle that ships a stripped Next.js export — only the routes the mobile app cold-launches into, with the rest fetched live via API. Substantial scaffolding work.
- **(b)** Ship live-bundle through App Review with a robust offline-fallback story (the `errorPath` stub is a start; would need explicit "offline" state UX). May get rejected.
- **(c)** Use Capacitor "Live Updates" / Ionic Appflow tier — bundle a snapshot at App Store build time, OTA-update web bundle between releases. Adds a paid dependency.

Recommend **brainstorming this at 65d→65e transition**, not 65a or 65b. Flagged here so it's not a surprise at submission time.

### 6.3 Universal Links — formal setup deferred to 65e

The smoke-test deep-link case (paste URL in iOS Notes, tap) opened correctly during the verification session. For the formal "Open in app" Universal Links UX (so iOS Mail, Messages, etc. give a "Open in AAA Disaster Recovery" prompt), three pieces are needed and are **not** wired in 65a:

- Apple Developer Program enrollment (in progress per plan §6.1; gating)
- AASA file hosted at `https://aaaplatform.vercel.app/.well-known/apple-app-site-association`
- `Associated Domains` capability in Xcode + entitlement

Defer to 65e (App Store submission), where Apple Developer enrollment will be active.

### 6.4 Free Apple ID 7-day signing limit (operational note for 65b)

The current dev build is signed via Eric's free-tier Apple ID, which expires every 7 days. 65b's camera-iteration weeks need longer-lived signing. Plan §6.1 starts paid Apple Developer Program enrollment in parallel; status to confirm before 65b kicks off so we don't burn iteration time on weekly re-signing.

### 6.5 Final app icon and splash assets (65e)

Capacitor's default placeholder icon and splash ship in this commit. Plan §5.5 deliverable 2 lands the AAA-logo final assets at 65e along with the App Store screenshots. Per SaaS Readiness Principle 1, the icon/splash will be parameterized so a Phase 5 white-label rebuild swaps a single asset bundle without touching Capacitor config.

## 7. What's next

- **Build 65b** — Custom camera UI on `@capacitor-community/camera-preview`. Three-session A/B/C protocol. Adds NSCameraUsageDescription / NSMicrophoneUsageDescription to `Info.plist`, the floating action button on `/jobs/[id]`, capture/review screens, and the local-storage hand-off interface for 65c.
- **Pre-65b gate**: confirm Apple Developer Program enrollment is active OR accept the 7-day re-sign cycle for the camera-iteration weeks.

## 8. Rollback

If a regression is discovered post-merge:

```bash
# Find the squash-merge commit on main
git log --oneline --grep "build65a" main
# Revert it
git revert <merge-sha>
git push
```

The merge is fully self-contained: no migration, no Vercel envvar changes, no third-party API changes. `src/` was untouched, so the desktop web app is unaffected by any revert.

The mobile app installs (dev builds on Eric's iPhone) survive the revert independently — they're separate iOS app installs, not Vercel deploys.

---

*65a complete. Foundation is in place; camera work begins in 65b.*
