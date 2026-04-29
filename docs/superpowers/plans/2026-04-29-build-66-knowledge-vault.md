# Build 66: Knowledge Vault & Session Continuity (Tooling Build)

**Status:** Proposed
**Type:** Internal tooling — not customer-facing
**Sequenced:** Can ship anytime. Not a blocker for 65b–65e. Best done before Phase 2 / Jarvis planning.

---

## Scope summary

Build 66 stands up an Obsidian-backed knowledge vault inside the `aaa-platform` repo and pairs it with Claude Code skills that maintain it automatically. The goal is to eliminate the "fresh chat doesn't know where we are" problem — every new Claude or Claude Code session boots oriented from a single source of truth that lives in version control.

This is not a code build in the product sense. No new Next.js routes, no new Supabase tables, no customer-visible changes. It's developer ergonomics infrastructure. The deliverables are markdown files, Claude Code skills, and a documented workflow.

What ships:

- A `docs/vault/` Obsidian vault inside the repo, synced via git on every push/pull
- An always-paste `00-NOW.md` state file and `00-glossary.md` name registry
- Build cards backfilled from existing `docs/superpowers/` artifacts so the graph view is meaningful from day one
- Two Claude Code skills (`end-of-session-handoff` and `start-of-session-orientation`) plus matching slash commands
- Per-machine Obsidian + Obsidian Git setup (Eric's manual step on each device)
- Updated `CLAUDE.md` referencing the vault so every Claude Code session knows where to look

What this build does NOT do:

- Replace `docs/superpowers/plans/*.md` or handoff docs — those continue to be written by Claude during builds. The vault links to them, not duplicates them.
- Touch the production app or any database
- Solve memory drift across consumer Claude.ai chats (the vault helps, but consumer Claude doesn't auto-read repo files; the kickoff prompt template carries that load)

---

## Key architectural decisions

- **Vault lives in the repo, not on the desktop.** `docs/vault/` is committed to git and synced by every machine that clones `aaa-platform`. No iCloud, Dropbox, OneDrive, or paid Obsidian Sync — those duplicate work git already does and are notorious for vault corruption.
- **Vault root is the repo root, not `docs/vault/`.** Obsidian opens `aaa-platform/` itself as the vault. This makes Claude Code skills (`.claude/skills/`), platform notes (`docs/vault/`), and any other markdown in the repo all editable from one Obsidian window. The graph view spans the whole repo. Excluded folders (`node_modules`, `.next`, `.git`, etc.) keep the indexing clean. Curated knowledge content still organizes under `docs/vault/`; the wider scope is just for editor convenience.
- **Repo is the source of truth, not docs and not memory.** The four build guide docx files (v1.3, v1.4, v1.6, v1.7) cover specs through Build 17 and are *historical* — many builds shipped without making it into a guide doc. Any future Claude reading the guides as a current snapshot will be wrong. Build 66b enforces this with an audit-first discipline; the same discipline applies forever after.
- **Markdown only, no plugins required for read access.** Anything in the vault must be readable as plain markdown without Obsidian installed. Plugins enhance the experience but never gate access. A new contributor or a future Claude can read everything with `cat`.
- **Wikilinks over hard paths.** Cross-references use `[[note-name]]` syntax so files can move and Obsidian's graph stays connected. This also means the relative-path-fragility problem doesn't bite.
- **Tags drive status, frontmatter drives metadata.** `#status/shipped`, `#build/65a`, `#area/mobile` for queries. YAML frontmatter for structured fields like `build_id`, `phase`, `started`, `shipped`. Dataview queries can read either.
- **Two ground-truth files: `00-NOW.md` and `00-glossary.md`.** These are the always-paste pair for fresh chats. Everything else is reference material loaded on demand.
- **Claude Code skills enforce the discipline, not the human.** A skill that runs on every "wrap up" or "/handoff" means the vault stays current without willpower.
- **Per-machine `.obsidian/workspace.json` is gitignored.** That file is local UI state (open tabs, pane sizes) and creates noisy diffs. Vault config and plugin settings (`.obsidian/app.json`, `.obsidian/plugins/`) ARE committed so Obsidian behaves identically on every machine.

---

## Build 66a: Vault scaffolding

Stand up the directory structure and seed initial files. After this sub-build, the vault exists and `00-NOW.md` reflects current reality (Build 65a shipped, Nookleus rebrand in progress, 65b queued).

### Directory structure to create

The vault root is the **repo root** itself, not `docs/vault/`. This means Obsidian sees `.claude/skills/`, `docs/vault/`, and any other markdown in the repo as one connected vault — Eric can edit Claude Code skills and platform notes from the same window, and the graph view shows relationships across the whole repo.

```
aaa-platform/                          # ← Obsidian vault root
├── .obsidian/                         # Obsidian config (committed except workspace.json)
│   └── (created by Obsidian on first open)
├── .claude/                           # Already exists; visible in vault
│   ├── skills/                        # Claude Code skills, editable in Obsidian
│   └── commands/
├── docs/
│   └── vault/                         # The curated knowledge content
│       ├── README.md                  # what this folder is
│       ├── 00-NOW.md                  # current state — always-paste #1
│       ├── 00-glossary.md             # names and terms — always-paste #2
│       ├── agents/                    # Jarvis and future AI agents
│       │   └── README.md
│       ├── platform-skills/           # skills that agents use (NOT Claude Code skills)
│       │   └── README.md
│       ├── builds/                    # one card per build
│       │   └── README.md
│       ├── handoffs/                  # session-end notes, dated
│       │   └── README.md
│       ├── decisions/                 # ADRs — one note per non-obvious decision
│       │   └── README.md
│       ├── data-sources/              # one note per significant table or external API
│       │   └── README.md
│       └── _templates/                # Templater plugin templates
│           ├── handoff.md
│           ├── build.md
│           ├── agent.md
│           ├── platform-skill.md
│           └── decision.md
├── src/                               # Already exists; visible but excluded from graph
└── .gitignore                         # add .obsidian/workspace.json + workspace-mobile.json
```

Naming note: the vault has a `platform-skills/` folder (concepts that platform agents like Jarvis use — e.g. "send-email-via-resend", "query-job-context"). This is distinct from `.claude/skills/` at the repo root, which is Claude Code skills. The `README.md` in each folder explains its purpose so the distinction is obvious in the Obsidian sidebar.

### Initial content for `00-NOW.md`

Seed with current ground truth as of build start. Eric's job is to update this at the end of every working session — the file should always read like a one-screen briefing for tomorrow's Claude.

**The seed values below are starting points, but Build 66b's audit will produce the authoritative version.** If 66a is run before 66b, fill in the seed with what's currently known and let 66b correct it during the audit step.

Required sections (use as a template, not a fill-in):

- **Product:** Nookleus (rebrand of `aaa-platform`)
- **Repo:** `github.com/ericdaniels22/aaa-platform`
- **Live URL:** [current Vercel URL]
- **Prod Supabase project:** `rzzprgidqbnqcdupmpfe`
- **Current build:** 65a shipped to TestFlight; rename branch pushed, awaiting Mac merge
- **Last 3 shipped builds:** 65a Capacitor scaffold (Apr 28), Build 64 trigger restoration, Build 18c workspace switcher
- **Major shipped systems:** Phase 1 platform (Builds 1-14), Build 15 contracts, Build 16 accounting + QuickBooks, Build 17 Stripe, Phase 2 Jarvis AI assistant (`/jarvis`), Marketing module, multi-tenant infrastructure (18a/b/c), Capacitor iOS shell (65a)
- **Active branches:** `65a-nookleus-rename` (pushed, unmerged); `main` at [commit]
- **Open threads:**
  - Mac access for 65a-rename merge + first TestFlight upload
  - Crew bug list triage cadence ("every few days")
  - 65b camera UI kickoff after first crew feedback wave
  - Apple Developer Program enrollment status
- **Recently learned:** [build52 lesson about NULL token columns; placeholder for next learning]
- **Last verified against repo:** [date — set by Build 66b audit, refreshed periodically]

### Initial content for `00-glossary.md`

Seed with the full set of names and terms that have caused fresh chats to ask "what is X?". At minimum:

- **Nookleus** — product name (rebrand of `aaa-platform`, locked April 21, 2026)
- **AAA Disaster Recovery** — first tenant org in the multi-tenant system
- **TheLaunchPad** — Eric's wife's borrowed Mac, used for iOS work
- **Jarvis** — in-platform AI assistant; **shipped** at `/jarvis` and `/api/jarvis` with knowledge base at `/settings/knowledge` (migrations 21, 25a, 27, 28). Claude API embedded with full job context.
- **Knowledge base** — Jarvis's RAG-style knowledge store at `/settings/knowledge`
- **Marketing module** — `/marketing` route + migration 23, ad-hoc addition not in any build guide doc
- **build52 lesson** — GoTrue panics on NULL token columns in `auth.users`; use empty strings
- **superpowers** — internal name for the planning/handoff document discipline; lives in `docs/superpowers/`
- **18a / 18b / 18c** — multi-tenant SaaS schema, RLS enforcement, workspace switcher (all shipped)
- **Build 64** — `handle_new_user` trigger restoration after 18b dropped it
- **Build 65a-e** — Capacitor mobile shell (a) → camera (b) → upload pipeline (c) → mobile audit (d) → App Store (e)
- **Build guide docs are incomplete.** The .docx files in this project (v1.3, v1.4, v1.6, v1.7) cover specs through Build 17. Builds 18, 21, 23, 25a, 27, 28, 30, 31, 64, 65 were never written into a guide doc. The repo is the only source of truth for what shipped.

Format: bolded term, em-dash, definition. Keep entries one line where possible. New terms get added the moment they're coined.

### Update `CLAUDE.md` to reference the vault

Add a section to the existing `CLAUDE.md` (or create one if missing):

```
## Project state and continuity

Before starting work, read:
- docs/vault/00-NOW.md  — current state of the platform
- docs/vault/00-glossary.md  — names and terms

If anything in your training, memory, or default knowledge contradicts
00-NOW.md, defer to the file. Memory drifts; the file is ground truth.

When wrapping up a session, run the /handoff slash command (or invoke
the end-of-session-handoff skill) to update the vault.
```

### Prompt for Claude Code (Build 66a)

> Create the Obsidian vault scaffolding per the Build 66a spec. The Obsidian vault root will be the repo root itself, not `docs/vault/` — but the curated knowledge content lives at `docs/vault/`.
>
> 1. Create the directory structure under `docs/vault/` exactly as specified, including all README.md placeholders.
> 2. Write `docs/vault/00-NOW.md` using the template in the spec, populating with current state: Nookleus rebrand, Build 65a shipped to TestFlight, 65a-nookleus-rename branch pushed and unmerged, 65b queued. Get the current commit SHA from `git rev-parse HEAD` and the current branch from `git rev-parse --abbrev-ref HEAD` and include those.
> 3. Write `docs/vault/00-glossary.md` with the full seed list from the spec.
> 4. Write each folder's `README.md` to explain what goes in that folder and the wikilink/tag conventions for that folder type.
> 5. Add the following lines to the repo's root `.gitignore` (create the .gitignore entry; do not create the files):
>    ```
>    # Obsidian local UI state — vault content is committed, but per-machine UI state is not
>    .obsidian/workspace.json
>    .obsidian/workspace-mobile.json
>    .obsidian/cache
>    ```
> 6. Update `CLAUDE.md` with the "Project state and continuity" section. If `CLAUDE.md` doesn't exist, create it with that section and a one-paragraph project summary. Note in the file that the Obsidian vault root is the repo root, so Claude Code SKILL.md files at `.claude/skills/` are also editable in Obsidian.
> 7. Show me the diff. Do not commit until I approve.

---

## Build 66b: Backfill from existing artifacts (audit-first)

The vault is more useful when the graph view is populated from day one. **But the most important thing this sub-build does is audit the repo to discover what's actually shipped, rather than trusting my memory or the build guide docs.** The build guides only cover specs through Build 17; the repo has migrations through 65 and routes for features that were never written into a guide.

Whoever runs 66b — including future Claudes — should treat the repo as the only source of truth and the build guides as historical specs that are partially out of date.

### Step 1 (mandatory): repo audit

Before writing any vault cards, produce a concrete inventory by reading the repo:

- `ls supabase/migrations/` — every migration file, sorted. Each is evidence of a build.
- `find src/app -maxdepth 3 -type d | sort` — every page route. Each is a feature that exists.
- `find src/app/api -maxdepth 3 -type d | sort` — every API route.
- `ls src/components/` — major component directories.
- `ls docs/superpowers/plans/` — every plan file.
- `ls docs/superpowers/build-*/` — every handoff folder.
- `git log --oneline --since="6 months ago"` — major commits, build references.
- `cat package.json` — dependencies installed (signals which integrations are live: stripe, resend, anthropic, intuit-oauth, @capacitor/*, etc.).

Print this inventory. **Confirm with Eric that it matches reality before writing any vault cards.**

### Step 2: cross-reference against guide docs

For each of the four build-guide docx files in this project (v1.3, v1.4, v1.6, v1.7), note which specced builds map to shipped migrations/routes. This tells you which builds have a spec doc and which don't.

Builds known to ship without a corresponding guide doc include (verify against actual repo):

- Phase 2 / Jarvis (migrations 21, 25a, 27, 28; routes `/jarvis`, `/api/jarvis`, `/settings/knowledge`)
- Marketing module (migration 23; route `/marketing`)
- Builds 18a/18b/18c (migrations 42–63; multi-tenant infrastructure)
- Build 30 — file attachments
- Build 31 — intake redesign
- Build 29 — navigation customization
- Build 64 — handle_new_user trigger
- Build 65a — Capacitor iOS scaffold

Anything that ships without a guide doc gets a build card written from primary sources (commit messages, plan files, handoffs, the migration SQL itself), not from any docx.

### Step 3: write the cards

For each build identified in the audit, write a vault card at `docs/vault/builds/build-{id}.md` with:

- YAML frontmatter (`build_id`, `title`, `status`, `phase`, `started`, `shipped`, `related`)
- A "What shipped" section with concrete deliverables: migrations, routes, components, API endpoints
- A "Source" section linking to whichever exists: guide doc + section, plan file, handoff, commit range
- Tags for status (`#status/shipped` if there's evidence it's live; `#status/in-progress` if a branch exists; `#status/planned` if there's a plan but no migration)
- Wikilinks to related builds

For each handoff in `docs/superpowers/build-*/handoff.md`, write a corresponding vault entry at `docs/vault/handoffs/{YYYY-MM-DD}-build-{id}.md`. Use the date from the file's git history if not in the filename.

### Step 4: fill in the data-sources folder

For each Supabase table referenced by 3+ builds, write a card at `docs/vault/data-sources/{table-name}.md` with: which migrations created/altered it, which builds use it, key columns, and any RLS policy notes.

### Step 5: agents and platform skills

For Jarvis specifically (since it's shipped):

- `agents/jarvis.md` — `#status/shipped`. Document: route, API endpoint, knowledge-base settings page, which migrations relate, what context it has access to. Source: the actual `src/app/jarvis/` and `src/app/api/jarvis/` code, plus migrations 21/25a/27/28.

If Jarvis turns out to compose any reusable internal capabilities (a job-context-loader, a knowledge-search, a Claude-API-call wrapper), write those as `platform-skills/{name}.md` cards. Read `src/app/api/jarvis/` to identify them.

For Phase 2 items that may or may not be shipped (AI-drafted emails, automated alerts, analytics dashboard) — DO NOT assume their status. Check the repo. Write the card with whatever status the evidence supports.

### Step 6: link integrity check

After all cards are written, walk every `[[wikilink]]` in the vault and confirm the target file exists. Print orphans. Either fix them (if the target should exist) or remove them (if they reference something genuinely not in scope).

### Naming conventions

- Build cards: `build-{id}.md` (e.g. `build-65a.md`, `build-18c.md`)
- Handoff notes: `{YYYY-MM-DD}-build-{id}.md` (e.g. `2026-04-28-build-65a.md`)
- Decision notes: `{YYYY-MM-DD}-{slug}.md` (e.g. `2026-04-21-rename-to-nookleus.md`)
- Agent notes: `{agent-name}.md` (e.g. `jarvis.md`)
- Platform skill notes: `{skill-name}.md` (e.g. `send-email-via-resend.md`)
- Data-source notes: `{table-name}.md` (e.g. `jobs.md`, `payments.md`)

### Frontmatter shape per build card

```yaml
---
build_id: 65a
title: Capacitor iOS scaffold
status: shipped
phase: mobile
started: 2026-04-26
shipped: 2026-04-28
guide_doc: null              # or "v1.7 §Build 17" if specced in a docx
plan_file: docs/superpowers/plans/2026-04-26-build-65a-scaffold.md
handoff: 2026-04-28-build-65a.md
related: ["[[build-65b]]", "[[build-18c]]"]
---
```

### Prompt for Claude Code (Build 66b)

> Backfill the vault at `docs/vault/` per the Build 66b spec. **The audit-first discipline in step 1 is non-negotiable** — do not write any vault cards from memory or from the build guide docs alone.
>
> 1. Run the audit commands in step 1 of the spec. Print the full inventory: migrations, routes, API endpoints, plan files, handoff folders, recent commits, key dependencies. Wait for Eric's confirmation that the inventory looks right before proceeding.
> 2. Cross-reference the inventory against the four build guide docx files (v1.3, v1.4, v1.6, v1.7) in this project's files. Identify every shipped build, every spec'd-but-unshipped build, and every shipped-but-undocumented build.
> 3. Write the build cards per the naming and frontmatter conventions in the spec. Treat the repo as ground truth; cite guide docs as `guide_doc:` only when a spec genuinely exists.
> 4. Write the handoff entries from `docs/superpowers/build-*/handoff.md`.
> 5. Write data-source cards for tables referenced by 3+ builds.
> 6. Write `agents/jarvis.md` from the actual Jarvis code in the repo. Identify any internal skills it composes and write those as `platform-skills/*.md` cards.
> 7. Run the link integrity check from step 6. Print orphans.
> 8. Show me a tree of the populated vault and three sample cards: `build-65a.md`, `jarvis.md`, and one from a build that has no guide doc (e.g. Build 30 file attachments). Wait for approval before committing.

---

## Build 66c: Claude Code skills for session continuity

Two skills plus two slash commands. After this sub-build, every Claude Code session in the repo can be opened with `/orient` and closed with `/handoff`, and the vault stays current automatically.

The full file contents are below — Claude Code's job in 66c is to write these files exactly as specified, then run a self-test.

---

### File: `.claude/skills/end-of-session-handoff/SKILL.md`

````markdown
---
name: end-of-session-handoff
description: "End-of-session handoff for the aaa-platform / Nookleus repo. Writes a dated handoff doc to docs/vault/handoffs/ and updates docs/vault/00-NOW.md. Invoke when the user signals they're wrapping up — phrases like 'wrap up', 'end of session', 'write the handoff', 'do the handoff', '/handoff', 'we're done for today', 'calling it'. Also offer proactively when a session has produced meaningful work (a build merged, a migration applied, a multi-step task completed) and the user is stopping. Do NOT invoke for short or purely conversational sessions where no work was done unless the user explicitly requests it."
---

# End of Session Handoff

## Purpose

Capture the state of a Claude Code session into the Nookleus knowledge vault so the next session — possibly with a different Claude on a different machine — can pick up oriented. Updates two files: a new dated handoff in `docs/vault/handoffs/` and the always-paste `docs/vault/00-NOW.md`.

This skill is the primary maintenance mechanism for the vault. Without it, the vault goes stale within days.

## Prerequisites

Before doing any work:

1. Confirm working directory is the Nookleus repo. Run `git remote -v` — origin should include `ericdaniels22/aaa-platform`. If not, abort and tell the user this skill is repo-specific.
2. Confirm the vault exists. Required: `docs/vault/00-NOW.md` and `docs/vault/handoffs/` directory. If either is missing, abort and tell the user to run Build 66a first.
3. If the user has not specified a build context for this session, ask: "What build is this handoff for? (e.g. 65b, 64, 18c, or 'misc' for non-build work)". Do not guess.

## Steps

### 1. Capture mechanical state

Run these commands and capture output:

```bash
git rev-parse HEAD
git rev-parse --abbrev-ref HEAD
git log --oneline -10
git status --short
git log --since="6 hours ago" --oneline
ls -1t supabase/migrations/ 2>/dev/null | head -3
```

If any command fails (not in a git repo, etc.), abort with a clear error.

### 2. Determine session character

From conversation context, classify as one of:

- **focused** — worked one specific build/issue start to finish
- **exploratory** — discussed, planned, no concrete commits
- **mixed** — some work, some discussion

This goes in the handoff frontmatter as `session_type`.

### 3. Compose the handoff

Generate today's date as `YYYY-MM-DD`. Filename: `docs/vault/handoffs/{YYYY-MM-DD}-build-{id}.md`. If that file exists already (multiple sessions in a day), append `-2`, `-3`, etc.

Write the file using this exact structure:

```markdown
---
date: YYYY-MM-DD
build_id: <id>
session_type: focused | exploratory | mixed
machine: <hostname>
related: ["[[build-XX]]"]
---

# Build {build_id} Handoff — {date}

## What shipped this session
- [bullet list of completed work, with commit SHAs where applicable]
- [if exploratory: "No commits — see 'Notes for next session'"]

## What's next
- [bullet list of queued items, in rough priority order]

## Decisions locked
- [decisions explicitly confirmed by the user this session]
- [if none: "None this session."]

## Open threads
- [unresolved questions]
- [blockers and what would unblock them]
- [awaiting external dependencies — which ones, expected timing]

## Mechanical state
- **Branch:** {branch}
- **Commit at session end:** {sha_short} ({first_line_of_commit_msg})
- **Uncommitted changes:** {count} files | "none"
- **Migrations applied this session:** [list or "none"]
- **Deployed to Vercel:** yes | no | n/a

## Notes for next session
[Free-form prose: anything the next Claude needs that isn't obvious from the code or commits. Include lessons learned, gotchas, surprises, decisions you considered but didn't make.]

## Links
- Build card: [[build-{build_id}]]
- Current state: [[00-NOW]]
- Related: [other relevant wikilinks]
```

### 4. Update `docs/vault/00-NOW.md`

Read the current file. Update only these fields, preserving everything else:

- **Current build:** revise to reflect post-session state
- **Last 3 shipped builds:** if a build genuinely shipped this session, push oldest off and add newest with date. Do NOT add a build that didn't ship.
- **Active branches:** update to reflect current branch list
- **Open threads:** revise — items resolved this session removed, new items added
- **Recently learned:** add a one-liner if the session produced a hard-won lesson worth preserving (don't pad)
- **Last verified against repo:** today's date

Do NOT touch:
- Product, Repo, Live URL, Prod Supabase project (these change rarely)
- Major shipped systems (only changes when a major system actually ships)
- Sections that didn't materially change

### 5. Show diffs

Print before writing:
- Full content of the new handoff file
- Diff of `00-NOW.md` (before vs after)

### 6. Confirmation

Ask: "Commit and push these to the vault? (y/n)"

- **y**: 
  ```bash
  git add docs/vault/00-NOW.md docs/vault/handoffs/
  git commit -m "vault: handoff for build {build_id} on {date}"
  git push
  ```
  Confirm push succeeded; print the new handoff path.
- **n**: leave files in working tree. Tell the user the files are written but uncommitted.

## Non-negotiable rules

- **Never invent progress.** If no commits were made, say so. "Discussed X, no implementation yet" is a valid handoff.
- **Decisions locked = explicitly confirmed by the user.** Never an inference. Never something the user nodded along to. The user must have said "yes, locked" or equivalent.
- **Do not modify 00-NOW.md beyond the fields listed in step 4.** Its structure is sacred; only specific fields change.
- **Do not summarize or compress past handoffs.** Each handoff is its own dated record. Old handoffs are never edited.
- **If the session was clearly off-topic** (user asked unrelated questions, no Nookleus work done), confirm before writing a handoff. Empty handoffs are noise.
- **Sensitive data check.** Before committing, scan the diff for accidentally-included secrets (API keys, tokens, passwords). If any found, abort the commit and warn the user.

## Examples

**Productive build session.** User: "ok let's wrap this up". After running: new file `docs/vault/handoffs/2026-04-29-build-65b.md` describing camera component work; 00-NOW.md "Current build" line now reads "65b camera UI scaffolded; tap-to-capture working, tag-after-capture toggle pending"; two-file commit pushed.

**Exploratory session, no commits.** User: "/handoff". After running: new file with `session_type: exploratory`; body notes Jarvis skill boundaries discussed but not decided; 00-NOW "Open threads" updated with "Jarvis skill granularity decision pending"; commit pushed.

**Off-topic session.** User has been chatting unrelated for 10 minutes, then says "wrap up." Skill response: "This session doesn't appear to have produced Nookleus-related work — no commits, no migrations, no platform discussion. Should I still write a handoff? (y/n)"
````

---

### File: `.claude/skills/start-of-session-orientation/SKILL.md`

````markdown
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
````

---

### File: `.claude/commands/handoff.md`

```markdown
Run the end-of-session-handoff skill.

Use the build context from this session. If multiple builds were touched
or the build is unclear, ask before proceeding. Capture mechanical state
via git, write the dated handoff file, update docs/vault/00-NOW.md, show
diffs, and wait for confirmation before committing.
```

---

### File: `.claude/commands/orient.md`

```markdown
Run the start-of-session-orientation skill.

Read docs/vault/00-NOW.md and the most recent file in docs/vault/handoffs/.
Capture current git state. Detect drift between the handoff's recorded
commit and current HEAD. Write a single-paragraph orientation, then wait
for direction before starting any work.
```

---

### Prompt for Claude Code (Build 66c)

> Implement the Build 66c skills and slash commands. The full file contents are in the Build 66c spec — write them exactly as specified, including the YAML frontmatter, the runbook structure, the embedded rules, and the examples.
>
> 1. Create `.claude/skills/end-of-session-handoff/SKILL.md` with the full content from the spec.
> 2. Create `.claude/skills/start-of-session-orientation/SKILL.md` with the full content from the spec.
> 3. Create `.claude/commands/handoff.md` and `.claude/commands/orient.md` with the content from the spec.
> 4. Verify the vault prerequisites the skills depend on actually exist: `docs/vault/00-NOW.md`, `docs/vault/handoffs/` directory. If either is missing, surface the issue and ask whether to run a partial Build 66a first.
> 5. **Self-test the handoff skill on this session.** Run the skill end-to-end, treating Build 66c itself as the build context. The skill should produce a real handoff file for the work done in this session (creating the skills). Show me the result. If the skill misbehaves on its own runbook, fix the SKILL.md before committing — the bug will compound forever.
> 6. **Self-test the orient skill.** Quit and re-enter, or simulate by re-reading the vault state. The orient skill should produce a one-paragraph briefing referencing the handoff just written. Confirm it works.
> 7. Once both skills self-test cleanly, commit with: `tooling: claude code skills for session continuity (build 66c)`. Push to origin.

---

## Build 66d: Per-machine Obsidian setup (manual)

Eric does this on each of the three machines: Windows desktop, Windows laptop, TheLaunchPad (Mac). Each takes about 5 minutes.

### Steps per machine

1. Install Obsidian from `obsidian.md`. Free download.
2. After repo is pulled (so `docs/vault/` and the seeded `.obsidian/` config exist locally), open Obsidian → "Open folder as vault" → select **the repo root** (`aaa-platform/`), not `docs/vault/`. This makes `.claude/skills/` (Claude Code skills) and `docs/vault/` (knowledge content) both editable in the same Obsidian window, and lets the graph view show relationships across the whole repo.
3. **Configure exclusions immediately** so the graph and quick-switcher aren't drowned in code:
   - Settings → **Files & Links** → **Excluded files**: add the following patterns one per line:
     ```
     node_modules
     .next
     .vercel
     dist
     build
     out
     coverage
     .git
     supabase/.branches
     ```
   - Settings → **Files & Links** → turn on **Use [[Wikilinks]]**, set **New link format** to **Shortest path when possible**.
   - Settings → **Files & Links** → **Default location for new notes**: `docs/vault/handoffs` (or whatever folder you write to most). Prevents new notes from landing in random places.
4. Settings → Community plugins → Turn on community plugins → Browse:
   - Install **Obsidian Git**. Configure: pull on startup ON, auto-pull every 10 min, auto-push every 10 min, commit message template `vault: {{date}} {{hostname}}`.
   - Install **Templater**. In settings, set "Template folder location" to `docs/vault/_templates`.
   - Install **Dataview**. Default settings are fine. Most queries you'll write will scope themselves with `FROM "docs/vault/builds"` etc.
5. **Test cross-folder editing.** Open `.claude/skills/end-of-session-handoff/SKILL.md` from Obsidian's file tree. Confirm it opens, renders, and saves correctly. This is the proof that Path 1 (repo root as vault) works for skill editing.
6. **Test the graph view.** Open Obsidian's graph view (Ctrl/Cmd+G). Confirm `docs/vault/` notes are connected via wikilinks and that `.claude/skills/`, `src/`, etc. don't pollute it (they should be excluded or appear as orphaned nodes — adjust filters if needed).
7. Make a tiny edit to a scratch note, save, wait 10 minutes (or trigger Source Control: Push from Obsidian Git's command palette). Confirm the commit appears in `git log` on another machine after pulling.

### Vault config that lives in git

After installing plugins on the first machine, the `.obsidian/` folder gets populated **at the repo root**. Most of it should be committed:

- `.obsidian/app.json` — committed (general settings, including excluded files)
- `.obsidian/community-plugins.json` — committed (which plugins are enabled)
- `.obsidian/plugins/*/data.json` — committed (plugin settings)
- `.obsidian/workspace.json` — **gitignored** (local UI state, noisy diffs)
- `.obsidian/workspace-mobile.json` — **gitignored** (same)
- `.obsidian/cache` — **gitignored** (Obsidian's index, regenerated on launch)

Build 66a handles the `.gitignore` lines. After Build 66d on the first machine, second and third machines pull the committed config and Obsidian behaves identically — same exclusions, same plugins, same hotkeys — without re-configuring.

### Failure modes to watch for

- **Merge conflicts on `00-NOW.md`** if two machines edit it without pulling. Mitigation: discipline of pulling before editing; Obsidian Git's "pull on startup" handles most cases.
- **Obsidian Git pushing without committing first** on certain platforms — usually a setting issue. Confirm "Commit and sync" not just "Push".
- **The `.obsidian/` folder being committed before the gitignore lines exist** creates `workspace.json` in the repo. If it happens, run `git rm --cached .obsidian/workspace.json` after adding the gitignore line.
- **Forgetting exclusions and watching the graph view explode** — when Obsidian indexes `node_modules`, the graph becomes unusable. If this happens, add the missing pattern to "Excluded files" and restart Obsidian; the index will rebuild without the noise.
- **Editing a SKILL.md in Obsidian and a `.tsx` file in VS Code on the same repo simultaneously** is fine in practice — both editors watch the filesystem and reload. But avoid having both open to the *same file* at the same time; whoever saves last wins.

---

## Pre-launch checklist for Build 66

- 66a: vault directory structure created and committed
- 66a: `00-NOW.md` reflects current state (Nookleus, 65a TestFlight, branch state) and reads like a useful briefing
- 66a: `00-glossary.md` covers every term that has caused a "what is X?" moment in past sessions
- 66a: `CLAUDE.md` updated with the "Project state and continuity" section
- 66a: `.gitignore` updated for `.obsidian/workspace.json`
- 66b: every existing plan and handoff in `docs/superpowers/` has a corresponding vault card
- 66b: graph view opens with no orphaned wikilinks
- 66b: Phase 2 placeholders (Jarvis, three platform skills, build-67) exist as cards
- 66c: `/handoff` slash command runs end-to-end and produces a real handoff file
- 66c: `/orient` slash command reads the vault and gives a sane one-paragraph briefing
- 66c: handoff skill correctly skips invented progress on a no-op session
- 66d: Obsidian opens **the repo root** as the vault on Windows desktop, Windows laptop, and TheLaunchPad
- 66d: Excluded files configured (node_modules, .next, .git, etc.) — graph view is clean
- 66d: Editing `.claude/skills/end-of-session-handoff/SKILL.md` from Obsidian works end-to-end (open, edit, save, commit via Obsidian Git)
- 66d: Obsidian Git auto-push verified by editing on one machine, pulling on another
- 66d: vault config in `.obsidian/` synced across machines (graph view settings, plugin choices, exclusions match)
- 66d: a deliberate merge conflict on a scratch note resolved correctly
- 66d: one full end-to-end test — work session on Windows, /handoff, switch to TheLaunchPad, /orient — produces a coherent continuation

---

## Future enhancements (Build 66.5 territory)

- **Auto-generated Dataview dashboards** — `99-dashboard.md` with live tables: open builds, recent handoffs, orphaned skills, decisions in last 30 days
- **Daily notes template** — Templater-driven daily note that pre-fills with current branch, last 5 commits, the morning's intent
- **Pre-commit hook** that warns if a session produced commits to `src/` without updating `00-NOW.md`
- **Obsidian Canvas for Phase 2 planning** — visual map of Jarvis's agent boundaries, separate from the auto-graph
- **Sync `.claude/skills/` SKILL.md files into the vault as readable cards** so the graph shows which Claude Code skills exist alongside platform skills
- **Voice memo intake** — short-script tool that takes a voice memo, runs it through the Claude API, and drops a structured note into `decisions/` or `handoffs/`
- **Vault-aware Jarvis** — once Phase 2 ships, Jarvis can read its own design docs from the vault as context

---

*End of Build 66 spec — Knowledge Vault & Session Continuity*
