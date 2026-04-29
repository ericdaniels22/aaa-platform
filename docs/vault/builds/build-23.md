---
build_id: 23
title: R&D Department sub-agent
status: shipped
phase: jarvis-ecosystem
started: null
shipped: null
guide_doc: null
plan_file: null
handoff: null
related: ["[[build-21]]", "[[build-25a]]", "[[build-26b]]", "[[jarvis]]"]
---

#status/shipped #area/jarvis #build/23

## What shipped

R&D specialist sub-agent for Jarvis: platform improvement, technology research, bug diagnosis, build spec generation. Runs Claude Opus with longer timeouts and a wider toolset (filesystem reads, DB queries, web search).

- **Migration:** [supabase/migration-build23-rnd.sql](../../../supabase/migration-build23-rnd.sql) — `execute_readonly_query()` SQL function (SELECT-only, 100-row limit, blocked dangerous keywords).
- **Routes:** `/api/jarvis/rnd` (specialist endpoint, also reachable via `consult_rnd` tool from Jarvis Core).
- **Tools** (R&D-specific): `read_project_structure`, `read_file`, `check_system_health`, `check_recent_errors`, `query_database`, `web_search`.
- **Config:** Claude Opus, `max_tokens: 16384`, `timeout: 120s`.
- **System prompt:** [src/lib/jarvis/prompts/rnd.ts](../../../src/lib/jarvis/prompts/rnd.ts).

## Source

- Commits: `a1b6e79 Build 2.3: R&D Department sub-agent for Jarvis`, `9e1b648 Fix R&D agent model ID`, `c8191b6 Fix R&D timeouts`
- Migration: [supabase/migration-build23-rnd.sql](../../../supabase/migration-build23-rnd.sql)
- Guide: none
