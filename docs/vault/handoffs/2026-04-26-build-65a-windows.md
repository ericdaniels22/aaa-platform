---
date: 2026-04-26
build: 65a
session: windows
status: partial
---

#area/mobile #build/65a

# Build 65a — Windows handoff (steps 1–7 complete)

Windows-doable portion of Build 65a complete. Capacitor 8.3.1 installed; `capacitor.config.ts` written with the live-bundle decision (`server.url` → `https://aaaplatform.vercel.app`); `ios/` Xcode project tree generated and synced; offline-fallback stub at `out/index.html` committed. **Branch `65a-scaffold` pushed but NOT merged to main and NOT tagged `mobile-v0.1.0` until Mac smoke tests pass** — see [[2026-04-28-build-65a]].

Capacitor 8 uses Swift Package Manager (no CocoaPods, no Podfile, no `pod install`). Mac steps deferred:

- Open project in Xcode on Mac
- Wire Eric's Apple ID for free-tier signing
- Run on iPhone via USB
- Smoke tests (login, navigate, logout, deep-link, workspace switch)

## Source

- Original document: [docs/superpowers/build-65/65a-windows-handoff.md](../../../docs/superpowers/build-65/65a-windows-handoff.md)
- Build card: [[build-65a]]
- Plan: [docs/superpowers/plans/2026-04-26-build-65-mobile-platform.md](../../../docs/superpowers/plans/2026-04-26-build-65-mobile-platform.md) §5.1, §11.1
- Branch (at this handoff): `65a-scaffold` at commit `7492bb9`
