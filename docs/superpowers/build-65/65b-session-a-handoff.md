# Build 65b Session A Handoff — 2026-04-29

**Status:** Path B (Windows-only, scratch-deferred) scaffold complete.
**Branch:** `build-65b-session-a` (worktree at `.claude/worktrees/build-65b-session-a`).
**Plan:** `docs/superpowers/plans/2026-04-26-build-65-mobile-platform.md` §5.2.A.

## Path B re-scope (why this isn't full Session A)

The plan's Session A specifies "author the camera shell against Eric's
scratch Supabase project" with a real-iPhone verification step gated on Mac
access. Two pre-flight items weren't actually green at session start:

1. **No scratch Supabase project exists.** The platform runs on a single
   shared Supabase (`rzzprgidqbnqcdupmpfe`) where dev = prod. Standing up a
   scratch project + replaying every `supabase/migration-build*.sql` against
   it is real work that hadn't happened.
2. **No Mac in this session** — work happened on TheLaunchPad (Windows
   desktop). Step 9 of the prompt (Apple-ID-signed dev build, install via
   Xcode + USB) requires the Mac.

Eric chose Path B: do steps 1–8 of the prompt on Windows, with mocked
photo_tags reads in the review screen, and defer steps 9–10 to the next
Mac/iPhone session. tsc-clean is the strongest meaningful verification
available without a real device.

## What shipped in this session

### iOS native side

- **`ios/App/App/Info.plist`** — added `NSCameraUsageDescription` and
  `NSMicrophoneUsageDescription`. Mic declared even though video isn't in
  v1 scope (per plan §5.2.A; declaring up front avoids App Review
  re-submission if 65b's video stretch goal ever lands).
- **`npx cap sync ios` was NOT run.** The sync step requires Mac + Xcode
  to do its full work; running it on Windows only copies the web bundle.
  The Mac session must run `npx cap sync ios` before installing.

### Web shell

- **`src/lib/mobile/`** — new module for mobile-only code.
  - `capture-types.ts` — `CaptureMode` (`'rapid' | 'tag-after'`) and the
    `CaptureSidecar` JSON schema (see § "Hand-off contract to 65c" below).
  - `capture-storage.ts` — Capacitor `Filesystem` wrapper.
    `writeCapture`, `readSidecar`, `readPhotoDataUrl`,
    `listSessionCaptures`, `updateSidecar`, `deleteCapture`. All keyed
    against `Directory.Documents` (app-private sandbox).
  - `use-capacitor.ts` — `{ isNative, ready }` mount-aware hook around
    `Capacitor.isNativePlatform()`. Returns `ready: false` during SSR.
  - `use-capture-mode.ts` — localStorage-backed mode persistence under
    key `mobile-capture-mode`. Default `'rapid'`. Validates stored
    values before applying.
  - `mock-photo-tags.ts` — five mocked `PhotoTag` rows (Before, During,
    After, Damage, Equipment) so the review screen renders something
    reviewable without scratch Supabase. Real fetch from `photo_tags`
    wires up in the next Mac/iPhone session against scratch creds.
- **`src/app/(mobile)/jobs/[id]/capture/page.tsx`** — server component
  that awaits `params` (Next.js 16 convention) and hands `jobId` to the
  client orchestrator.
- **`src/app/(mobile)/jobs/[id]/capture/capture-flow.tsx`** — client
  orchestrator. Generates one `capture_session_id` UUID per flow,
  switches between camera step and review step, redirects desktop
  visitors to a fallback card, redirects native visitors back to
  `/jobs/<id>` on Save & exit / abort.
- **`src/components/mobile/camera-view.tsx`** — full-screen capture UI.
  - `CameraPreview.start({ position, parent: 'camera-preview-mount',
    toBack: true, ... })` mounts the native preview behind the WebView.
  - Top bar: cancel (X), mode toggle (Rapid / Tag after), flash cycle
    (off → auto → on).
  - Bottom bar: flip camera, shutter, Done (with capture counter).
  - Tag-after mode opens a bottom sheet with caption input + tag chips
    after each capture; "Continue" persists sidecar updates and resumes
    capture.
  - Permission-denied surface: replaces the camera UI with an
    instruction card pointing to iOS Settings → Nookleus → Camera.
- **`src/components/mobile/review-screen.tsx`** — post-capture review.
  - Thumbnail grid (3 columns, aspect-square).
  - Tap → expanded full-screen view with Delete button.
  - Swipe-left on a tile (≥80px) deletes that capture from Filesystem
    and re-renders.
  - "Select" toggle enters multi-select mode; footer surfaces
    Caption / Tag / Delete batch actions on the selected set.
  - Batch caption / batch tags use the intersection of existing values
    as the editor's starting state.
  - "Save & exit" returns to `/jobs/<id>`. "Camera" returns to capture
    flow with the same `capture_session_id` (additional shots land in
    the same directory, ready for 65c to pick up as one batch).
- **`src/components/mobile/capture-fab.tsx`** — Capacitor-detected FAB,
  hidden entirely on desktop (`return null` when `!isNative`). Linked
  via `next/link` to `/jobs/<id>/capture`.
- **`src/components/job-detail.tsx`** — single import + single
  `<CaptureFab jobId={jobId} />` render at the top of the main return.
  Component is `position: fixed` so JSX placement is purely a render
  trigger; no layout impact.

### Plan file the previous orient skill couldn't find

`docs/superpowers/plans/2026-04-26-build-65-mobile-platform.md` had been
referenced from `docs/vault/builds/build-65a.md` but never committed.
Eric provided the file from his Downloads folder during this session;
it's now committed at the expected path. The file's appName text says
"AAA Disaster Recovery" throughout — the Nookleus rename (PR #38) shipped
afterwards and supersedes those references; otherwise the plan is still
authoritative for 65b–65e.

## Hand-off contract to 65c

This is the hard interface. Don't change without updating this section
and the plan §5.3.A.

### Filesystem layout

All paths are relative to Capacitor's `Directory.Documents`:

```
pending-uploads/
  {job_id}/
    {capture_session_id}/
      {client_capture_id}.jpg     # base64 JPEG written by writeCapture
      {client_capture_id}.json    # CaptureSidecar (UTF-8 JSON)
```

- `job_id` — UUID from the URL `/jobs/[id]/capture`. Same `job_id` used
  in the Supabase `photos` table.
- `capture_session_id` — UUID generated once per CaptureFlow mount.
  Re-entering capture mid-flow ("Camera" button on review screen) keeps
  the same session id so additional shots land in the same directory.
  Closing and reopening the capture flow generates a new session id.
- `client_capture_id` — UUID per shot. This is the same identifier 65c
  must use as the Supabase `photos.client_capture_id` value for the
  partial-unique-index idempotency story (per plan §5.3 locked
  decision 6).

### Sidecar JSON schema

```jsonc
{
  "client_capture_id": "uuid",       // matches the .jpg filename
  "job_id": "uuid",                  // mirrors the directory
  "capture_session_id": "uuid",      // mirrors the directory
  "taken_at": "2026-04-29T17:32:11.043Z",  // ISO 8601, local-clock at capture
  "capture_mode": "rapid",           // "rapid" | "tag-after"
  "width": 0,                         // TODO Session B: read EXIF before write
  "height": 0,                        // TODO Session B
  "orientation": 1,                   // TODO Session B
  "caption": null,                    // string | null
  "tag_ids": []                       // string[] of PhotoTag ids
}
```

Width / height / orientation are stubbed at `0 / 0 / 1` in Session A.
`CameraPreview.capture()` returns just a base64 string; reading EXIF
before write is a Session B follow-up. The sidecar shape is final, the
values for those three fields aren't.

### What 65c needs to do, top to bottom

1. On app launch / network event / background-fetch wake, scan
   `pending-uploads/**/*.json` via `Filesystem.readdir`.
2. For each sidecar, read the matching `.jpg` blob.
3. Encrypt the blob (AES-256-GCM, key in iOS Keychain) before sending —
   per plan §5.3 locked decision 2, the on-device file should already be
   encrypted at rest. **Session A writes plaintext.** This is a
   deliberate Session A → 65c gap; 65c's Session A will introduce
   encryption-at-rest as part of the upload-queue scaffolding.
4. POST to Supabase Storage at the existing path convention
   `{organization_id}/{job_id}/{timestamp}-{rand6}.{ext}`.
5. INSERT into `photos` with `client_capture_id`, `uploaded_from =
   'mobile'`, `taken_at`, `caption`, plus tag assignments per
   `tag_ids`. The partial unique index on `(organization_id,
   client_capture_id) WHERE client_capture_id IS NOT NULL` (added by
   `build65c-photos-mobile-fields.sql`) makes retries idempotent.
6. On 200, delete both the `.jpg` and the `.json` from Filesystem
   (plan §5.3 locked decision 3 — auto-delete after sync).

## Deferred from this session (next-Mac-session work)

These need to happen before the §5.2.A real-device verification step:

- [ ] Stand up scratch Supabase project + replay all
      `supabase/migration-build*.sql`. Seed at least one job + one
      `photo_tags` row.
- [ ] `.env.scratch.local` (or build flag) wiring so a Session A build
      can target scratch — never prod.
- [ ] Replace `MOCK_PHOTO_TAGS` reads in `review-screen.tsx` and
      `camera-view.tsx` with a real fetch from `photo_tags` scoped to
      `getActiveOrganizationId(supabase)`.
- [ ] EXIF read for width / height / orientation before write.
- [ ] `npx cap sync ios` on Mac to copy the new web bundle into the iOS
      project.
- [ ] Mac: `npx cap open ios`, sign with Eric's developer account,
      install on iPhone via USB.
- [ ] §5.2.A verification: 20 rapid + 5 tag-after, review screen,
      delete 3, Done, 22 .jpg + 22 .json under `pending-uploads/...`,
      battery drain check after 100-shot rapid, permission-denied
      recovery flow.
- [ ] Battery / heat sanity check on a 100-rapid session.

## Path B verification done in this session

- `npx tsc --noEmit` exits 0.
- `next dev` (Turbopack) compiles with no errors and no warnings beyond
  pre-existing image-LCP warnings on the login page.
- The new route compiles and is correctly auth-gated by `src/proxy.ts`
  (a request to `/jobs/<id>/capture` without cookies redirects to
  `/login`). The fallback card itself can only be rendered post-login,
  which is gated on Supabase access — deferred per Path B.
- The CaptureFab is rendered into `job-detail.tsx` but returns null on
  desktop (verified by code review of `useCapacitor` + the FAB's
  `if (!ready || !isNative) return null` short-circuit).

## Locked decisions surfaced this session

1. **`(mobile)` route group, not separate root layout.** Avoids the
   "multiple root layouts" full-page-reload caveat from the Next.js 16
   docs. The capture flow renders full-screen via `position: fixed
   inset-0 z-[1000]` so it covers AppShell without needing its own
   `<html>`/`<body>`.
2. **`Capacitor.isNativePlatform()` is the single source of truth for
   "are we in the iOS app?"** All gating (FAB visibility, capture page
   render path, future plugin wiring) goes through `useCapacitor`.
3. **Session ids stable across review → camera round-trip.** A user who
   captures 20, reviews, deletes 3, then taps "Camera" to grab 5 more
   ends up with 22 captures under one `capture_session_id`. Closing
   the capture flow entirely and reopening starts a new session.
4. **Plaintext on-device in Session A; encryption is 65c's job.** Plan
   §5.3 locked decision 2 said encrypted at rest; that gets introduced
   alongside the upload-queue scaffolding so the encryption test path
   and the upload test path move together.

## Branch state

- One commit on `build-65b-session-a` (this session's work + this
  handoff).
- **Do NOT merge to main.** Session C handles the merge after the
  TestFlight rollout per plan §5.2.C. This branch lives in the worktree
  at `.claude/worktrees/build-65b-session-a` and on `origin` once
  pushed.
- Untouched on `main`: prior 66d Obsidian work + uncommitted skill
  edits. The worktree isolated this work from those.

## Links

- Plan: [docs/superpowers/plans/2026-04-26-build-65-mobile-platform.md](../plans/2026-04-26-build-65-mobile-platform.md)
- Build doc: [docs/vault/builds/build-65a.md](../../vault/builds/build-65a.md)
- Previous handoff: [docs/superpowers/build-65/65a-handoff.md](./65a-handoff.md)
- 65a Windows handoff: [docs/superpowers/build-65/65a-windows-handoff.md](./65a-windows-handoff.md)
