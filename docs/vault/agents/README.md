# Agents

Cards for Nookleus-internal AI agents. One file per agent.

Currently:

- `jarvis.md` — shipped (planned for Build 66b backfill). Lives at `/jarvis` and `/api/jarvis`.

## Conventions

- **Filename:** `{agent-name}.md` (e.g. `jarvis.md`).
- **Tags:** `#agent`, plus a status tag — `#status/shipped`, `#status/in-progress`, or `#status/planned`.
- **Frontmatter:** `agent_name`, `status`, `route`, `api_route`, `migrations`, `related`.
- **Wikilinks:** link out to relevant `[[build-XX]]` cards, `[[platform-skill-name]]` cards, and `[[data-source-name]]` cards.
- **Source:** when a card describes shipped behavior, cite the actual code paths (e.g. `src/app/api/jarvis/route.ts`) — not a build guide doc.

This folder is distinct from `.claude/skills/` at the repo root, which is **Claude Code skills** (developer tooling). Agents in this folder are **product features**.
