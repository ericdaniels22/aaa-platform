# Nookleus knowledge vault

This folder is the curated knowledge content for the Nookleus platform (formerly `aaa-platform`). It is opened in Obsidian as part of a vault that has the **repo root** itself as its root, so `.claude/skills/`, `src/`, and the rest of the repo are visible alongside this folder. Curated knowledge — what's shipped, what's queued, what was decided and why — lives here.

## Always-paste pair

When booting a fresh Claude or Claude Code session, the two ground-truth files are:

- [[00-NOW]] — current state of the platform, refreshed at the end of every working session
- [[00-glossary]] — names, terms, and shorthand that recur in conversations

If your training, memory, or default knowledge contradicts these files, defer to the files. They are version-controlled and updated continuously; memory drifts.

## Folders

- `agents/` — Nookleus-internal AI agents (Jarvis, future agents)
- `platform-skills/` — reusable capabilities that platform agents compose
- `builds/` — one card per build with shipped / in-progress / planned status
- `handoffs/` — dated session-end notes
- `decisions/` — non-obvious decisions worth preserving (ADR-style)
- `data-sources/` — significant Supabase tables and external APIs
- `_templates/` — Templater plugin templates (filled in by Build 66c)

## Conventions

- **Wikilinks over hard paths.** Cross-references use `[[note-name]]` so files can move without breakage.
- **Tags drive status.** `#status/shipped`, `#status/in-progress`, `#status/planned`, `#build/65a`, `#area/mobile`.
- **Frontmatter drives metadata.** `build_id`, `phase`, `started`, `shipped`, etc.
- **Markdown only.** Anything in the vault must read sensibly as plain markdown without Obsidian.
- **The repo is the source of truth.** Build guide docx files cover specs through Build 17 only — anything later is read from migrations, routes, and commits, not from a guide doc.

## Maintenance

The vault is kept current by Claude Code skills (Build 66c), not by willpower:

- `/handoff` (or the `end-of-session-handoff` skill) writes a dated handoff and updates `00-NOW.md` at the end of a working session.
- `/orient` (or the `start-of-session-orientation` skill) reads the vault and gives a one-paragraph briefing at the start of a session.

Build 66 (this scaffolding plus the skills) is specified in [`docs/superpowers/plans/2026-04-29-build-66-knowledge-vault.md`](../superpowers/plans/2026-04-29-build-66-knowledge-vault.md).
