# Platform skills

Reusable capabilities that platform agents (e.g. [[jarvis]]) compose. Examples: `send-email-via-resend`, `query-job-context`, `claude-api-call`.

**This is distinct from `.claude/skills/`** at the repo root. Those are Claude Code developer-tooling skills. The skills in this folder are platform-internal capabilities used by agents like Jarvis at runtime.

## Conventions

- **Filename:** `{skill-name}.md` using kebab-case verb-noun (e.g. `send-email-via-resend.md`, `query-job-context.md`).
- **Tags:** `#platform-skill`, plus `#status/shipped`, `#status/planned`, etc.
- **Frontmatter:** `skill_name`, `status`, `consumed_by` (which agents use it), `source` (file paths), `related`.
- **Wikilinks:** link to `[[agent-name]]` cards that use the skill, and to any `[[data-source-name]]` cards it touches.

Most platform skills will be backfilled from the existing Jarvis code in Build 66b.
