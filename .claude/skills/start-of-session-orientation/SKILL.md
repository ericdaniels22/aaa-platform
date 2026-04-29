---
name: start-of-session-orientation
description: "Boot a Claude Code session in the aaa-platform / Nookleus repo into the correct context. Reads docs/vault/00-NOW.md and the most recent handoff to produce a one-paragraph orientation. Invoke when the user says 'where did we leave off', 'what's the state', 'catch me up', 'what's current', '/orient'. Also invoke implicitly at the start of a fresh Claude Code session in this repo if the user's first message is a generic greeting or open-ended request and the vault exists."
---

# Start of Session Orientation

## Purpose

Eliminate the "Claude doesn't know where I am" failure mode. Reads the vault's two ground-truth files plus current git state, compares against the most recent handoff, and gives the user a concise one-paragraph orientation before any work begins.

This skill is the counterpart to `end-of-session-handoff`. Used together they keep continuity across machines, sessions, and Claude instances.

## Prerequisites

1. Confirm working directory is the Nookleus repo (`git remote -v` shows `ericdaniels22/aaa-platform`).
2. Confirm `docs/vault/00-NOW.md` exists. If not, fall back: "vault not initialized — please run Build 66a, then we can use this skill."

## Steps

### 1. Read state files

- Read `docs/vault/00-NOW.md` in full.
- Read `docs/vault/00-glossary.md` in full (so unknown terms in the briefing get resolved).
- List `docs/vault/handoffs/` sorted by filename (date-prefixed). Read the most recent file in full.

### 2. Capture current mechanical state

```bash
git rev-parse HEAD
git rev-parse --abbrev-ref HEAD
git log --oneline -5
git status --short
```

### 3. Detect drift

Compare the most recent handoff's "Commit at session end" against current `HEAD`:

- **Same commit:** nothing has happened since last handoff. Note this.
- **Newer commits on the same branch:** something happened (you committed from another machine, etc.). Note count and any obvious build references in messages.
- **Different branch:** mention current branch and the branch the handoff was on.
- **Uncommitted changes:** mention so the user knows their working tree state.

### 4. Compose orientation

Write a single paragraph (3–6 sentences) covering, in order:

1. What 00-NOW.md says is current ("Per 00-NOW: 65a shipped, rename branch awaiting Mac merge…")
2. What the most recent handoff said was next ("Last handoff queued: 65b camera UI kickoff after first crew feedback…")
3. Drift detection results ("Since the last handoff at commit abc1234, two commits on main: …")
4. Current branch + uncommitted state if relevant
5. The one-question close: "Continuing on [last build] or starting something new?"

The orientation is a **distillation**, not a dump. Do not paste the full 00-NOW or full handoff. The files are linked for the user to read if they want detail.

### 5. Stop and wait

After delivering the orientation, do not start any work. Wait for the user's direction. The point of this skill is to orient *before* acting, not to launch into the next task.

## Non-negotiable rules

- **No fabrication.** If 00-NOW.md is empty or vague, say so. Don't fill in details from your own knowledge.
- **Stale handoffs are flagged, not corrected.** If the most recent handoff is from 30+ days ago, mention that. Don't try to update it.
- **Memory does not override the vault.** If your training or memory contains information about this project that contradicts 00-NOW.md, defer to 00-NOW.md. Mention the contradiction but trust the file.
- **One paragraph, then stop.** Don't ramble. Don't suggest next steps unless asked. The user will direct.

## Examples

**Clean handoff state.** User: "/orient". Response:
> Per 00-NOW (last verified Apr 29): Nookleus is on Build 65a — Capacitor iOS shell shipped to TestFlight, rename branch `65a-nookleus-rename` pushed but unmerged pending Mac access. Last handoff (Apr 28) ended at commit `5482702` on `main`; current HEAD is `5482702` (no drift). Last handoff queued: 65b camera UI to start after first wave of crew bug feedback. Working tree is clean. Continuing on the rename merge or pivoting to something else?

**Drift detected.** User: "where did we leave off". Response:
> Per 00-NOW (last verified Apr 24): platform was on 18c session B prep. But there are 14 commits on `main` since the last handoff at `3208053` — looks like 18c shipped, Build 64 merged, and 65a scaffolding landed. The vault is stale. Want to run /handoff first to capture current state, or update 00-NOW directly?

**Vault missing.** User: "catch me up". Response:
> `docs/vault/` doesn't exist in this repo yet — Build 66 (the knowledge vault) hasn't shipped. Without the vault I can only orient from git history: current branch is `main` at `abc1234`, working tree clean. I can do my best from session context if you tell me what we're working on, or we can ship Build 66a now to set up the vault first.
