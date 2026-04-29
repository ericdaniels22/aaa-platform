# Handoffs

Dated session-end notes. Written by the `end-of-session-handoff` Claude Code skill (Build 66c) at the close of every working session, so the next session — possibly with a different Claude on a different machine — can pick up oriented.

## Conventions

- **Filename:** `{YYYY-MM-DD}-build-{id}.md` (e.g. `2026-04-28-build-65a.md`). Multiple sessions in a day get `-2`, `-3`, etc.
- **Tags:** `#handoff`, plus `#build/{id}` and `#session/{focused|exploratory|mixed}`.
- **Frontmatter:** `date`, `build_id`, `session_type`, `machine`, `related`.
- **Sections:** What shipped this session · What's next · Decisions locked · Open threads · Mechanical state · Notes for next session · Links.
- **Wikilinks:** link to `[[build-{id}]]`, `[[00-NOW]]`, and any decisions, agents, or data-sources that came up.

## Discipline

- **Old handoffs are never edited.** Each is a frozen record of what was true at that moment.
- **Decisions locked = explicitly confirmed by the user.** Never an inference.
- **Empty handoffs are noise.** If nothing meaningful happened, don't write one.

The handoff structure is fully defined in the `end-of-session-handoff` SKILL.md (Build 66c).
