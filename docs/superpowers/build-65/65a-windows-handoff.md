# Build 65a — Windows Handoff

**Status:** PARTIAL — Windows steps 1-7 complete, Mac steps 8-10 pending
**Branch:** `claude/trusting-yalow-7a1741` (worktree off main); not merged
**Plan:** [docs/superpowers/plans/2026-04-26-build-65-mobile-platform.md](../plans/2026-04-26-build-65-mobile-platform.md) §5.1, §11.1
**Surface area:** Capacitor scaffolding only; iOS Xcode project generated; zero src/ changes

---

## 1. Summary

Build 65a's Windows-doable portion is complete. Capacitor 8.3.1 is installed, `capacitor.config.ts` is written with the live-bundle decision (server.url → `https://aaaplatform.vercel.app`), the `ios/` Xcode project tree is generated and synced, and an offline-fallback stub at `out/index.html` is committed.

The remaining work — opening the project in Xcode on a Mac, wiring Eric's Apple ID for free-tier signing, running on his iPhone via USB, and the smoke test list (login, navigate, logout, deep-link, workspace switch) — is gated on Mac access and deferred to a follow-up session. **Do not merge to main and do not tag `mobile-v0.1.0` until the Mac smoke tests pass.**

## 2. Pre-state (verified 2026-04-26)

| Check | Value |
|---|---|
| Build 64 shipped (trigger + orphan cleanup) | YES (commit `1b287a4`) |
| Latest `main` HEAD before 65a | `84a5f32` (email Promotions fix) |
| `npm run build` clean on main pre-Capacitor | YES (exit 0) |
| Existing Capacitor / mobile code in `src/` | NONE |
| Eric's hardware available this session | Windows only; Mac later |
| Apple Developer Program enrollment status | In progress (parallel critical-path per plan §6.1) |

## 3. What got applied (Windows steps 1-7)

### Step 1 — Capacitor packages installed

```
@capacitor/core       ^8.3.1   dependency
@capacitor/ios        ^8.3.1   dependency
@capacitor/cli        ^8.3.1   devDependency
```

Capacitor 8 uses **Swift Package Manager** for plugin dependencies — no CocoaPods, no `Podfile`, no `pod install` step on the Mac. `Package.swift` is generated under `ios/App/CapApp-SPM/`.

### Step 2-3 — `cap init` + live-bundle config

`capacitor.config.ts` (committed at repo root):

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

- `appId` and `appName` are permanent per plan §8 locked decision 15. Phase 5 white-label rebuild swaps these via per-target Capacitor configs, not by editing this file.
- `server.url` implements §5.1's locked Live Web Bundle decision for 65a/b/c development. Capacitor's docs annotate this option with "not intended for use in production" — that's the App Store concern §5.5 already plans to revisit (switch to bundled-static for App Store builds).
- `server.errorPath: 'index.html'` makes the WebView fall back to our committed offline stub when Vercel is unreachable on cold launch.
- `backgroundColor: '#0a0a0aff'` matches the stub's dark background to avoid a white flash on cold launch.
- `ios.contentInset: 'automatic'` respects iOS safe areas (notch, home indicator) without per-page CSS work.

### Step 4 — `cap add ios` (iOS Xcode project)

Generated `ios/` tree:

```
ios/
├── .gitignore                     # Capacitor-managed; ignores derived artifacts
├── App/
│   ├── App.xcodeproj/             # Xcode project — committed
│   ├── App/
│   │   ├── AppDelegate.swift      # Capacitor default — committed
│   │   ├── Info.plist             # See step 6 — committed
│   │   ├── Assets.xcassets/       # Icon + splash placeholders — committed
│   │   ├── Base.lproj/            # LaunchScreen.storyboard, Main.storyboard
│   │   ├── config.xml             # GENERATED on cap sync (gitignored)
│   │   ├── capacitor.config.json  # GENERATED on cap sync (gitignored)
│   │   └── public/                # GENERATED on cap sync (gitignored)
│   └── CapApp-SPM/                # Swift Package Manager root
│       └── Package.swift
├── capacitor-cordova-ios-plugins/ # GENERATED (gitignored)
└── debug.xcconfig
```

Capacitor authored its own `ios/.gitignore` and `ios/App/CapApp-SPM/.gitignore` to mark derived files. Source-of-truth files (Swift, Info.plist, .xcodeproj, Assets.xcassets) are committed; `cap sync`-generated files (`public/`, `capacitor.config.json`, `config.xml`) are not.

### Step 5-6 — Icon, splash, Info.plist sanity check

- App icon: Capacitor's default placeholder at `Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`. Final AAA-logo asset lands in 65e per plan §5.5.
- Splash: Capacitor's default placeholder at `Assets.xcassets/Splash.imageset/`. Final asset also in 65e.
- Info.plist: defaults are sufficient for 65a — `CFBundleDisplayName: "AAA Disaster Recovery"`, HTTPS-only via ATS default, portrait + landscape orientations. No camera or mic usage descriptions yet (those are 65b §5.2.A — to be added before the camera plugin lands).

### Step 7 — `npm run build && npx cap sync ios` on Windows

Both passed:
- `npm run build` → exit 0; full Next.js 16 route table rendered (mix of static `○` and dynamic `ƒ` routes); zero new errors versus pre-Capacitor baseline.
- `npx cap sync ios` → 0.542s; copied web assets, wrote `Package.swift`, no plugin updates needed.

## 4. What was NOT done (Mac steps 8-10) — to resume

These five plan items are gated on Mac + iPhone access. The exact verification list is from plan §10:

### Mac-side resume sequence

```bash
# 1. Borrow Mac. Pull this branch.
git fetch && git checkout claude/trusting-yalow-7a1741
npm install                          # restores node_modules incl. @capacitor/* (Mac side)

# 2. Open the iOS project in Xcode
npx cap open ios                      # launches Xcode with App.xcworkspace

# 3. In Xcode:
#    - Select the App target → Signing & Capabilities
#    - Team: select Eric's free Apple ID (paid Developer Program also fine)
#    - Bundle Identifier: confirmed as com.aaacontracting.platform
#    - Capacitor 8 uses SPM, so first build will resolve packages automatically
#      (no pod install)

# 4. Plug iPhone in via USB. Trust the device.
#    Xcode: select iPhone as run target. Press the Run button.

# 5. First-run iPhone permissions:
#    - On iPhone, Settings → General → VPN & Device Management → trust Apple ID

# 6. Run smoke tests (plan §10 65a checklist)
```

### Smoke-test checklist for the Mac session

- [ ] App launches on iPhone, shows splash, transitions to live Vercel-served app
- [ ] Login (email + password) succeeds in WebView
- [ ] Cookie-based session persists across page navigations
- [ ] Sidebar navigation works (mobile menu toggle visible at iPhone width)
- [ ] Navigate to a job detail page (`/jobs/[id]`), back to list
- [ ] Workspace switcher (build62/62b) works mid-session
- [ ] Logout flow returns to login, no stale state
- [ ] Reopen from Home Screen — state preservation reasonable
- [ ] Deep link from URL opens the right route — **expected to PARTIAL FAIL**: Universal Links need Apple Developer enrollment + Associated Domains entitlement + AASA file at `https://aaaplatform.vercel.app/.well-known/apple-app-site-association`. The custom-scheme variant (`capacitor://localhost/jobs/<id>`) works internally but iOS Mail/Messages won't recognize it. Mark deep-link verification as deferred to 65e (post-enrollment) and proceed.
- [ ] No regression on the desktop web app (verify `aaaplatform.vercel.app` still loads in Safari/Chrome on the Mac)

If everything else passes, **then** merge `claude/trusting-yalow-7a1741` → `main` and tag `mobile-v0.1.0`. If the Mac session reveals material issues (per Rule C), stop for Eric.

## 5. Files added / changed

| Path | Change |
|---|---|
| `package.json` | +3 lines: `@capacitor/core`, `@capacitor/ios` deps; `@capacitor/cli` devDep |
| `package-lock.json` | +804 lines: Capacitor + transitive deps |
| `.gitignore` | `/out/` → `/out/*` + `!/out/index.html` exception so the offline stub gets committed |
| `capacitor.config.ts` | NEW — root-level Capacitor config |
| `out/index.html` | NEW — offline-fallback stub (dark spinner page) |
| `ios/` | NEW — entire Xcode project tree (27 source-of-truth files committed; derived artifacts gitignored by Capacitor) |

`src/` is **not modified**. No application code touched.

## 6. Open concerns and forward flags

### 6.1 `server.url` and App Review (carry to 65e)

Capacitor's official docs annotate `server.url`, `cleartext`, and `allowNavigation` with "not intended for use in production." The plan already addresses this in §5.5 (recommendation: bundle-static for App Store, live-bundle for TestFlight dev/beta). Live-bundle is fine for 65a/b/c development and TestFlight; the architectural decision check at the start of 65e should flip the App Store target to bundled-static.

### 6.2 Bundled-static + Next.js 16 Server Components (forward flag for 65e)

The plan's "switch to bundled-static for App Store" is non-trivial because this codebase uses Next.js 16's App Router with Server Components, API routes, and SSR. `output: 'export'` would break all of those. Options to evaluate at 65e:

- **(a)** Build a separate static-only mobile bundle (a stripped Next.js export that only includes the routes the mobile app needs, with the rest fetched live via API). Substantial scaffolding work.
- **(b)** Ship live-bundle through App Review with a robust offline-fallback story (the `errorPath` stub is a start; would need explicit "offline" state handling). May get rejected.
- **(c)** Use Capacitor's "Live Updates" / Ionic Appflow tier — bundle a snapshot at App Store build time, OTA-update web bundle between releases. Adds a paid dependency.

Recommend **brainstorming this at 65d→65e transition**, not 65a. Flagged here so it's not a surprise at submission time.

### 6.3 Universal Links require enrollment

Plan §5.1 verification step 4 ("Test by tapping a Vercel URL in iOS Mail or Messages — should give 'Open in app' option") cannot fully pass until Apple Developer Program is active and AASA file is hosted. Mac smoke-test checklist (above) marks this as deferred to 65e.

### 6.4 Free Apple ID 7-day limit

If Apple Developer Program enrollment isn't active by the time we run on iPhone, the dev build expires after 7 days. That's enough for 65a verification but not for 65b's camera-iteration weeks. Plan §6.1 starts enrollment in parallel; status to confirm before 65b kicks off.

### 6.5 Capacitor scripts not added to package.json

The plan didn't call for npm scripts like `cap:sync` or `cap:open`. Eric runs `npx cap …` directly. If we want shorthand later, add `"scripts": { "cap:sync": "cap sync ios", "cap:open": "cap open ios" }` — defer until friction shows up.

## 7. Verification carried forward to the Mac session

The 65a "complete when" criteria from plan §10 still pending:

- [ ] iOS project committed to repo at `ios/` — **DONE** in this commit
- [ ] `npm run build && npx cap sync ios` runs cleanly on Eric's Windows laptop — **DONE**
- [ ] Eric installs the dev build on his iPhone via Xcode — pending Mac
- [ ] Login, navigation, logout all work in the WebView — pending Mac
- [ ] Workspace switch works mid-session in WebView — pending Mac
- [ ] App icon and splash visible (placeholder OK at this stage) — pending Mac (Capacitor placeholders are in place)
- [ ] Deep link from URL opens the right route — **partial pending** Apple Developer enrollment
- [ ] No regression on the desktop web app — **DONE** for build; Mac session re-verifies in Safari/Chrome

## 8. Rollback path

If the Mac session reveals material issues with the scaffold itself (not just smoke-test bugs that have a forward fix), the rollback is:

```bash
git revert <commit-sha>      # reverts capacitor.config.ts, ios/, .gitignore, package*
npm install                   # restores pre-Capacitor node_modules state
```

No prod data, no migrations, no Vercel deploy were touched. This commit is fully self-contained and reversible.

---

*End of Windows handoff. Final 65a-handoff.md gets written after Mac smoke tests pass.*
