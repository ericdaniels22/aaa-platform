---
last_verified: 2026-04-30
---

# Nookleus — current state

This file is the always-paste briefing for fresh Claude / Claude Code sessions. If anything below contradicts your training, memory, or default knowledge, **defer to this file**. It is version-controlled and updated at the end of every working session by the `end-of-session-handoff` skill (Build 66c).

## Identity

- **Product:** Nookleus (rebrand of `aaa-platform`)
- **Repo:** `github.com/ericdaniels22/aaa-platform`
- **Live URL:** `aaaplatform.vercel.app` (will migrate to `nookleus.app` post-65e)
- **Prod Supabase project:** `rzzprgidqbnqcdupmpfe`

## Current build

[[build-67a]] **Estimates & Invoices Foundation — schema layer shipped (~13% of full 67a).** Brainstormed-and-revised the v1.0 build guide Eric handed in (which was a year stale and called itself "Build 18a", colliding with the multi-tenant infra build that already shipped). Resolved six conflicts: build label collision (18a → 67a), single-tenant assumptions vs. current multi-tenant state, drop-and-rebuild on a non-empty `invoices` table (35 source files reference it; ALTER instead), wrong migration naming, deprecated `user_permissions` shape, broken `/mnt/project/*.docx` paths. Wrote spec doc, updated build guide to v1.1, wrote implementation plan (Tasks 1–9 detailed, Tasks 10–30 outlined). Executed Tasks 1–4 of 30: deleted `INV-2026-0001` test row out-of-band, applied `migration-build67a-estimates-foundation.sql` to prod (7 new tables with RLS, alters to `invoices` + `invoice_line_items`, two atomic numbering RPCs, 12 new permission keys backfilled), added TypeScript interfaces, and the shared `formatCurrency` + `round2` helper in `src/lib/format.ts`. **26 tasks remaining** (server libs → 8 API routes → Item Library admin → estimate builder UI → drag-and-drop → auto-save → read-only view → job-detail integration → sidebar nav → final audit). On worktree branch `claude/ecstatic-cartwright-7d2405`, 4 commits ahead of main. See [[2026-04-30-build-67a]] for the full handoff.

[[build-14j]] **Intake Form Builder UX overhaul shipped.** Three-column WYSIWYG editor at `/settings/intake-form` (palette / canvas / inspector) with auto-save, drag-and-drop via `@dnd-kit`, append-only version history with restore, and per-option color picker for pill fields. Refactored intake submit to route values via `maps_to` instead of literal field IDs — fixing both 14j's needs and a pre-existing latent bug in the unchanged `/api/settings/intake-form` POST route. Schema migration `build14j_prep_form_config_versioning` swaps the singleton `form_config_org_key` (build46) for a composite `(organization_id, version)` unique. Merged via [PR #44](https://github.com/ericdaniels22/aaa-platform/pull/44) (rebase) — main HEAD `a651057`, prod Vercel deploy live. TestCo intake form seeded with AAA's exact shape (form_config v103) for ongoing testing. Eric flagged "Maps to" UX as needing a rework pass later.

[[build-65b]] Sessions A + A.5 ran end-to-end on Windows on 2026-04-29 (see [[2026-04-29-build-65b]]). Path B camera/review scaffold landed in commit `7738e8a`; the scratch Supabase standup, 53-migration replay, `seed-scratch.sql`, and `MOCK_PHOTO_TAGS` → real org-scoped fetch landed across `f244727`, `874a542`, `6362edd`. Branch `build-65b-session-a` is on origin, four commits ahead of main, awaiting the Mac session for §5.2.A real-device verification (iMessage transfer of `.env.scratch.local`, then `npx cap sync ios`, sign + install on iPhone, run the 20-rapid-plus-5-tag-after scenario).

Build 66 (Knowledge Vault & Session Continuity) is **complete**. All four sub-builds shipped: [[build-66a]] vault scaffolding (`298a072`), [[build-66b]] audit-first backfill (`ee093a3`), [[build-66c]] Claude Code skills for session continuity (`349a7f0`), [[build-66d]] per-machine Obsidian setup on TheLaunchPad (`f4fad00` + completion commit `3d5c222`). `/handoff` and `/orient` both self-tested clean. The Windows-laptop and Mac Obsidian setups are deferred — TheLaunchPad-only is sufficient for the single-machine workflow Eric is running.

[[build-65a]] (Capacitor iOS shell + Nookleus rename, PR #38 commit `57c1c67`) remains on TestFlight, awaiting a Mac session for the refreshed upload with the new display name.

## Last 3 shipped builds

- **[[build-66c]] — Claude Code skills for session continuity** (2026-04-29, commit `349a7f0`). `/handoff` + `/orient` shipped, both self-tested. `.gitignore` migrated to `.claude/*` with negations for `skills/`/`commands/`/`agents/`.
- **[[build-66d]] — per-machine Obsidian setup** (2026-04-29, commit `f4fad00` plus completion commit `3d5c222`). Obsidian + dataview + obsidian-git + templater-obsidian installed and wired on TheLaunchPad with the committed `.obsidian/` config. Multi-machine setup deferred.
- **[[build-14j]] — Intake Form Builder UX overhaul** (2026-04-30, [PR #44](https://github.com/ericdaniels22/aaa-platform/pull/44), main HEAD `a651057`). Three-column WYSIWYG builder at `/settings/intake-form` with auto-save, drag-and-drop, append-only version history + restore, per-option pill color picker, and `maps_to`-based intake submit routing. Schema prep migration `build14j_prep_form_config_versioning` (drops singleton `form_config_org_key`, adds composite `(organization_id, version)` unique). Also fixes a pre-existing latent bug in the unchanged `/api/settings/intake-form` POST route.

## Major shipped systems

- **Phase 1 platform** (Builds 1–10) — core jobs, customers, scheduling, photos. See [[build-1-10]], [[build-11]] (photo annotator).
- **Email** — inbox + attachments ([[build-12]], [[build-13]]); categories + body-pattern rules ([[build-27]], [[build-28]]).
- **Settings hub** (Build 14a–i) — company, appearance, statuses, auth, signatures, intake form, notifications, reports, export. See [[build-14a]]…[[build-14h-14i]].
- **Contracts** (Build 15a–c) — templates, remote signing, in-person/multi-signer/reminders. See [[build-15a]], [[build-15b]], [[build-15c]].
- **Accounting + QuickBooks** (Build 16a–d) — expenses, dashboard, QB connection, invoice/payment sync. See [[build-16a]], [[build-16b]], [[build-16c]], [[build-16d]].
- **Stripe payments** (Build 17a–c) — Connect + payment requests, public `/pay` page + emails, webhook + receipts/refunds + QB bridge. See [[build-17a]], [[build-17b]], [[build-17c]].
- **Jarvis AI assistant ecosystem** at `/jarvis` and `/api/jarvis`; knowledge base at `/settings/knowledge`. Four agents (Jarvis Core, R&D, Field Ops, Marketing) — see [[jarvis]]. Backed by **migrations 21, 23, 25a, 26b**. Marketing also has its own page at `/marketing` (Social Media + Chat tabs) — see [[build-26b]]. The Marketing **module** is the Jarvis Marketing sub-agent surfaced via a dedicated page.
- **Job UI iterations** — nav order ([[build-29]]), files section ([[build-30]]), insurance + photos redesign ([[build-31]]), soft-delete jobs + 30-day trash ([[build-66]]).
- **Multi-tenant infrastructure** — schema + backfill ([[build-18a]], migrations 42–54), RLS enforcement ([[build-18b]], migrations 55–60), workspace switcher ([[build-18c]], migrations 62/62b/63). `handle_new_user` trigger restoration follow-up: [[build-64]].
- **Capacitor iOS shell** — [[build-65a]]. Shipped to TestFlight as Nookleus. Live-bundle WebView per [[2026-04-26-capacitor-live-bundle]]; flips to bundled-static at 65e.
- **Knowledge vault** — scaffolding [[build-66a]], audit-first backfill [[build-66b]], skills [[build-66c]], per-machine Obsidian setup [[build-66d]]. All shipped 2026-04-29.

## Active branches

- `main` at `03cbeec` — `vault: handoff for build 14j on 2026-04-30`. Build 14j shipped via [PR #44](https://github.com/ericdaniels22/aaa-platform/pull/44).
- `claude/ecstatic-cartwright-7d2405` (worktree) — Build 67a in progress, 4 commits ahead of main: spec doc + schema migration + TypeScript types + format helper. Migration already applied to prod. Tasks 5–30 of 30 still to do.
- `build-65b-session-a` at `6362edd` on origin — 65b Sessions A + A.5 (four commits authored). Awaiting Mac session for §5.2.A real-device verification.
- `14j-form-builder-ux` on origin — content merged via PR #44; branch retained, deletable.
- Other branches on `origin` not merged into main (`git branch -r --no-merged origin/main`):
  - `65a-nookleus-rename` — content landed via PR #38; branch retained, deletable
  - `65a-scaffold` — content landed via PR #25; branch retained, deletable
  - `fix/issue-26-header-layout`
  - `fix/issue-27-copy-property-address`
  - `fix/issue-31-header-stacking`
  - `fix/issue-33-soft-delete-jobs`
  - `fix/issue-34-nav-empty-space`
  - `claude/angry-mccarthy-510971` — older Claude worktree branch

## Open threads

- [[build-67a]] continuation: 26 of 30 tasks remaining. Plan part-2 (Tasks 10–30 detail) needs writing before SDD can dispatch them. Next session should resume at Task 5 (`src/lib/estimates.ts` — code already in plan part-1) and continue through Tasks 5–14 (server libs + 8 API routes). Then 2–3 more sessions for the builder UI components.
- [[build-14j]] follow-ups: (a) "Maps to" UX rework — Eric flagged it for a later pass; current dropdown is functional but high-friction. (b) `job_custom_fields` rendering on `/jobs/[id]` not yet wired — values land in DB but aren't displayed anywhere. (c) Workspace switcher state flips back to AAA on some page reloads in the live MCP-driven preview; root cause not investigated, manual re-switch is the workaround.
- Mac session pre-flight for [[build-65b]] §5.2.A real-device verification. Eight-step chain in [[2026-04-29-build-65b]] "What's next": iMessage `.env.scratch.local` → move from `~/Downloads/` to repo root → `git pull` on `build-65b-session-a` → `npm install` → `npx dotenv -e .env.scratch.local -- npm run dev` → sign in as `eric+scratch@aaacontracting.com` (password in Eric's password manager only) → `npx cap sync ios` → sign + install on iPhone → run §5.2.A scenario.
- Refreshed TestFlight upload from Mac so the iPhone Home Screen shows "Nookleus" — pre-dates this session, still open.
- Crew bug list triage cadence — currently informal ("every few days").
- Optional: extend Obsidian vault setup to the Windows laptop and the Mac. TheLaunchPad-only is currently sufficient; the multi-machine sync, merge-conflict, and round-trip tests in the 66d spec are skipped until a second machine actually runs Obsidian.
- EXIF read for width/height/orientation before sidecar write (65b polish; current scaffold writes `0/0/1` placeholders).
- Encryption-at-rest for on-device photos. Per plan §5.3 locked decision 2 this is 65c's job, not 65b's.
- Pre-existing `/api/notifications` 500s in dev logs — [[build-14g]] bug, unrelated to 14j; surfaced during 14j verification, worth a dedicated cleanup.

## Recently learned

- **build52 lesson** — GoTrue panics on NULL token columns in `auth.users`. Use empty strings instead, never NULL. See [[2026-04-22-build52-null-tokens-lesson]].
- **Build 66 numbering collision** — "Build 66" labels two unrelated threads: (1) [[build-66]], the soft-delete jobs feature (PR #37, migration build66, shipped); and (2) [[build-66a]] / [[build-66b]] / [[build-66c]] / [[build-66d]], the Knowledge Vault meta-spec. Different scopes, same prefix because the migration counter and the meta-spec independently chose 66.
- **Jarvis migrations are 21, 23, 25a, 26b** — earlier briefings said "21, 25a, 27, 28" but 27 and 28 are email features (categories, body-patterns), not Jarvis. The actual Jarvis-ecosystem migrations are 21 (Jarvis Core), 23 (R&D), 25a (Knowledge + Field Ops), 26b (Marketing). Source: file-name reading + content checks during 66b audit.
- **Build IDs vs migration numbers diverge after Build 14.** See [[00-glossary]].
- **`.gitignore` directory exclude blocks child negation.** `.claude/` (directory pattern) cannot be re-included via `!.claude/skills/` — git can't re-include files inside an excluded parent. Use `.claude/*` (wildcard children) so each entry is evaluated against the negation list. Git docs (`gitignore(5)`): "It is not possible to re-include a file if a parent directory of that file is excluded." Same fix pattern as `.yarn/*` (lines 7–11) and `/out/*` (lines 18–20). Surfaced during [[build-66c]] when the new `.claude/skills/` files weren't trackable despite the negation lines.
- **`preview_start` ignores `launch.json` `runtimeExecutable`/`runtimeArgs`.** The Claude Preview MCP's `preview_start` always runs `npm run dev` regardless of the launch.json config name, which on TheLaunchPad loads the parent worktree's prod `.env.local` under Next.js's workspace-root inference (it detects `C:\Users\14252\package-lock.json` as the workspace root and pulls env files from there). The first scratch smoke test during [[2026-04-29-build-65b]] connected to **prod** Supabase before this was caught — the failed login was a 400 (no actual prod data modified) but the next attempt with a real password would have. Workaround: invoke the dev server directly via Bash with `npx dotenv -e .env.scratch.local -- npm run dev -- --port 3001`. Documented in `supabase/scratch-replay-notes.md`.
- **`invoice_line_items` already had `sort_order` + `xactimate_code` from Build 38.** During the [[build-67a]] migration, the v1.0 ALTER block tried to add both again and the migration failed transactionally before any other change landed. The retry only adds `section_id`, `library_item_id`, `unit`. Surface `xactimate_code` as `code` and `amount` as `total` in TS via mapper at the API-route boundary (same pattern as `invoices.total_amount` ↔ `Invoice.total`). **General lesson:** before writing an ALTER ADD against a multi-build-touched table, run `\d <table>` in SQL or query `information_schema.columns` — every prior build's ALTER is invisible from the newest migration file.

- **`form_config` had a long-standing latent bug from build46.** Migration build46 added a unique index `form_config_org_key` on `(organization_id)` alone — collapsing each tenant to a single row. The unchanged `/api/settings/intake-form` POST route did `INSERT` with `version+1`, so every save after the first per-org silently 500'd with a duplicate-key violation. Eric had been editing AAA's form for months without noticing — the toast read "Save failed" and was assumed transient. Surfaced during [[build-14j]] verification when the new always-visible version pill made the failure mode loud. Fix: [[build-14j]] Task 0 migration replaced the singleton with a composite `(organization_id, version)` unique. **Worth scanning other settings pages for the same shape** — any POST route that does `INSERT` with `version+1` against a table whose unique index is `(organization_id)` instead of `(organization_id, version)` will have the same issue.

## Last verified against repo

- **2026-04-30** — Build 67a foundation check (post-migration): 7 new tables present and RLS-enabled (`item_library`, `estimates`, `estimate_sections`, `estimate_line_items`, `estimate_templates`, `pdf_presets`, `invoice_sections`), 2 numbering RPCs callable, 14 new `invoices` columns + `UNIQUE(job_id, sequence_number)`, 3 new `invoice_line_items` columns, 14 settings keys (7 × AAA + TestCo), 12 perm keys × 2 admin memberships seeded via `set_default_permissions`, legacy `line_items` dropped. Pre-migration `INV-2026-0001` deleted. Worktree `node_modules` reinstalled clean (1165 packages).

- **2026-04-30** — Build 14j completion check: schema migration verified in prod via `pg_indexes` (`form_config_org_version_key` present, `form_config_org_key` absent), end-to-end submit verified on TestCo (job `WTR-2026-0001` created with all `contacts` + `jobs` columns populated correctly via `maps_to`), Vercel prod deploy succeeded for main `a651057` at `aaaplatform-pxgj2foyz-aaa-disaster-recovery-e5661f28.vercel.app`. PR #44 merged via rebase, 17 task commits on main. TestCo intake form seeded (form_config v103) to mirror AAA's exact shape.
- **2026-04-29** — Build 66d completion check: confirmed Obsidian config committed, three required plugins enabled, `.obsidian/app.json` `userIgnoreFilters` updated to include `node_modules`, `.gitignore` exclusions in place, no remaining `TODO(66b-audit)` items. Earlier same-day audit during [[build-66b]] grounded the repo against migrations, routes, code, commits, plan files, handoff documents. The four guide docx files (v1.3, v1.4, v1.6, v1.7) cover specs through Build 17 only; everything later is read directly from the codebase.
