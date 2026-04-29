---
last_verified: 2026-04-29
---

# Nookleus — current state

This file is the always-paste briefing for fresh Claude / Claude Code sessions. If anything below contradicts your training, memory, or default knowledge, **defer to this file**. It is version-controlled and updated at the end of every working session by the `end-of-session-handoff` skill (Build 66c).

> **Open audit items** are tagged `TODO(66b-audit): <hint>`. Run `grep -rn "TODO(66b-audit)" docs/vault/` to surface every unresolved seed value the next sub-build needs to nail down.

## Identity

- **Product:** Nookleus (rebrand of `aaa-platform`)
- **Repo:** `github.com/ericdaniels22/aaa-platform`
- **Live URL:** TODO(66b-audit): resolve from vercel.json or project settings
- **Prod Supabase project:** `rzzprgidqbnqcdupmpfe`

## Current build

Build 65a complete — Capacitor iOS shell on TestFlight, Nookleus rename merged to main (PR #38, commit 57c1c67). Next Mac session uploads a refreshed TestFlight build with the new display name. Build 65b (camera UI) queued after first wave of crew bug feedback.

In-progress: **Build 66a — vault scaffolding** (this file).

## Last 3 shipped builds

- **Build 65a — Capacitor iOS scaffold** (2026-04-28). iOS shell shipped to TestFlight as Nookleus.
- **Build 64 — `handle_new_user` trigger restoration**. Re-added the trigger that 18b dropped. TODO(66b-audit): confirm ship date — no commit found via `git log --grep="build 64|handle_new_user"`.
- **Build 18c — Workspace switcher** (2026-04-26). Multi-tenant workspace UI.

## Major shipped systems

- **Phase 1 platform** (Builds 1–14) — core jobs, customers, scheduling, photos
- **Build 15** — contracts
- **Build 16** — accounting + QuickBooks integration
- **Build 17** — Stripe payments
- **Phase 2 — Jarvis AI assistant** at `/jarvis` and `/api/jarvis` (migrations 21, 25a, 27, 28); knowledge base at `/settings/knowledge`. Embeds the Claude API with full job context.
- **Marketing module** at `/marketing` (migration 23). Not in any build guide doc.
- **Multi-tenant infrastructure** — 18a (schema + backfill), 18b (RLS enforcement), 18c (workspace switcher). Migrations 42–63.
- **Capacitor iOS shell** — Build 65a. Shipped to TestFlight as Nookleus.

## Active branches

- `main` at `9e986b2` — `fix(auth): decode JWT directly for active_organization_id claim (#39)` _(this file is being committed on top of `9e986b2`; refresh after the Build 66a merge lands)_
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
- Build 66b (vault backfill from existing artifacts) is queued — will produce the authoritative version of this file.

## Recently learned

- **build52 lesson** — GoTrue panics on NULL token columns in `auth.users`. Use empty strings instead, never NULL. See [[00-glossary]].

## Last verified against repo

- 2026-04-29 — initial seed during Build 66a (vault scaffolding). Build 66b will run an audit-first backfill that may correct items above; refresh this date whenever the file is reconciled with the repo.
