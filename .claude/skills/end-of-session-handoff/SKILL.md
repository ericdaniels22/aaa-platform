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
