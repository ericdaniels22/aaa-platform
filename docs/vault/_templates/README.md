# Templates

Templater plugin templates used in Obsidian to scaffold new vault entries with the right frontmatter and section structure.

The actual template content (handoff body, build card body, etc.) is authored in **Build 66c**, when the `end-of-session-handoff` and related skills define the exact structures. The files in this folder are stubs until then.

## Conventions

- **Filename:** matches the destination folder's singular form: `handoff.md` for `handoffs/`, `build.md` for `builds/`, etc.
- **Templater configuration:** Obsidian → Settings → Templater → "Template folder location" set to `docs/vault/_templates`.
- **Reference Templater syntax:** `<% tp.date.now("YYYY-MM-DD") %>`, `<% tp.file.title %>`, etc.

## Files

- `handoff.md` — for `handoffs/{YYYY-MM-DD}-build-{id}.md`
- `build.md` — for `builds/build-{id}.md`
- `agent.md` — for `agents/{name}.md`
- `platform-skill.md` — for `platform-skills/{name}.md`
- `decision.md` — for `decisions/{YYYY-MM-DD}-{slug}.md`
