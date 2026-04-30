---
last_verified: 2026-04-29
---

# Nookleus — current state

This file is the always-paste briefing for fresh Claude / Claude Code sessions. If anything below contradicts your training, memory, or default knowledge, **defer to this file**. It is version-controlled and updated at the end of every working session by the `end-of-session-handoff` skill (Build 66c).

## Identity

- **Product:** Nookleus (rebrand of `aaa-platform`)
- **Repo:** `github.com/ericdaniels22/aaa-platform`
- **Live URL:** `aaaplatform.vercel.app` (will migrate to `nookleus.app` post-65e)
- **Prod Supabase project:** `rzzprgidqbnqcdupmpfe`

## Current build

Build 66 (Knowledge Vault & Session Continuity) is **complete**. All four sub-builds shipped: [[build-66a]] vault scaffolding (`298a072`), [[build-66b]] audit-first backfill (`ee093a3`), [[build-66c]] Claude Code skills for session continuity (`349a7f0`), [[build-66d]] per-machine Obsidian setup on TheLaunchPad (`f4fad00` + this session's completion commit). `/handoff` and `/orient` both self-tested clean. The Windows-laptop and Mac Obsidian setups are deferred — TheLaunchPad-only is sufficient for the single-machine workflow Eric is running.

[[build-65a]] (Capacitor iOS shell + Nookleus rename, PR #38 commit `57c1c67`) remains on TestFlight, awaiting a Mac session for the refreshed upload with the new display name. [[build-65b]] (camera UI) queued after the first wave of crew bug feedback.

## Last 3 shipped builds

- **[[build-66a]] — vault scaffolding** (2026-04-29, commit `298a072`). Empty `docs/vault/` tree + always-paste pair + Templater stubs.
- **[[build-66c]] — Claude Code skills for session continuity** (2026-04-29, commit `349a7f0`). `/handoff` + `/orient` shipped, both self-tested. `.gitignore` migrated to `.claude/*` with negations for `skills/`/`commands/`/`agents/`.
- **[[build-66d]] — per-machine Obsidian setup** (2026-04-29, commit `f4fad00` plus this session's `node_modules` exclusion + `00-NOW` refresh). Obsidian + dataview + obsidian-git + templater-obsidian installed and wired on TheLaunchPad with the committed `.obsidian/` config. Multi-machine setup deferred.

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

- `main` at `f4fad00` — `vault: 2026-04-29 17:20:26 TheLaunchPad` (Obsidian config landed). The 66d completion commit from this session lands directly on top.
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

- Next Mac session: upload refreshed TestFlight build with merged Nookleus rename so Eric's iPhone Home Screen shows "Nookleus."
- Crew bug list triage cadence — currently informal ("every few days").
- Build 65b camera UI kickoff after first crew feedback wave.
- Apple Developer Program enrollment status.
- Optional: extend Obsidian vault setup to the Windows laptop and the Mac. TheLaunchPad-only is currently sufficient; the multi-machine sync, merge-conflict, and round-trip tests in the 66d spec are skipped until a second machine actually runs Obsidian.

## Recently learned

- **build52 lesson** — GoTrue panics on NULL token columns in `auth.users`. Use empty strings instead, never NULL. See [[2026-04-22-build52-null-tokens-lesson]].
- **Build 66 numbering collision** — "Build 66" labels two unrelated threads: (1) [[build-66]], the soft-delete jobs feature (PR #37, migration build66, shipped); and (2) [[build-66a]] / [[build-66b]] / [[build-66c]] / [[build-66d]], the Knowledge Vault meta-spec. Different scopes, same prefix because the migration counter and the meta-spec independently chose 66.
- **Jarvis migrations are 21, 23, 25a, 26b** — earlier briefings said "21, 25a, 27, 28" but 27 and 28 are email features (categories, body-patterns), not Jarvis. The actual Jarvis-ecosystem migrations are 21 (Jarvis Core), 23 (R&D), 25a (Knowledge + Field Ops), 26b (Marketing). Source: file-name reading + content checks during 66b audit.
- **Build IDs vs migration numbers diverge after Build 14.** See [[00-glossary]].
- **`.gitignore` directory exclude blocks child negation.** `.claude/` (directory pattern) cannot be re-included via `!.claude/skills/` — git can't re-include files inside an excluded parent. Use `.claude/*` (wildcard children) so each entry is evaluated against the negation list. Git docs (`gitignore(5)`): "It is not possible to re-include a file if a parent directory of that file is excluded." Same fix pattern as `.yarn/*` (lines 7–11) and `/out/*` (lines 18–20). Surfaced during [[build-66c]] when the new `.claude/skills/` files weren't trackable despite the negation lines.

## Last verified against repo

- **2026-04-29** — Build 66d completion check: confirmed Obsidian config committed, three required plugins enabled, `.obsidian/app.json` `userIgnoreFilters` updated to include `node_modules`, `.gitignore` exclusions in place, no remaining `TODO(66b-audit)` items. Earlier same-day audit during [[build-66b]] grounded the repo against migrations, routes, code, commits, plan files, handoff documents. The four guide docx files (v1.3, v1.4, v1.6, v1.7) cover specs through Build 17 only; everything later is read directly from the codebase.
