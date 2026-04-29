---
build_id: 21
title: Jarvis Chat UI + Claude API backend
status: shipped
phase: jarvis-ecosystem
started: null
shipped: null
guide_doc: null
plan_file: docs/superpowers/plans/2026-04-09-agent-architecture-map.md
handoff: null
related: ["[[build-23]]", "[[build-25a]]", "[[build-26b]]", "[[jarvis]]"]
---

#status/shipped #area/jarvis #build/21

## What shipped

Jarvis Core — the orchestrator AI assistant. Chat UI + Claude API backend with tool use, conversation persistence, job context, and (later) routing to specialist sub-agents.

- **Migration:** [supabase/migration-build21-jarvis.sql](../../../supabase/migration-build21-jarvis.sql) — `jarvis_conversations`, `jarvis_alerts`.
- **Routes:** `/jarvis`, `/api/jarvis/chat`.
- **Tools** (Jarvis Core): `get_job_details`, `search_jobs`, `get_business_metrics`, `log_activity`, `create_alert`, `consult_rnd`, `consult_marketing` — see [src/lib/jarvis/tools.ts](../../../src/lib/jarvis/tools.ts).
- **System prompt:** [src/lib/jarvis/prompts/jarvis-core.ts](../../../src/lib/jarvis/prompts/jarvis-core.ts).
- **Components:** [src/components/jarvis/](../../../src/components/jarvis/) — chat, conversation list, message, welcome, job panel, quick actions.
- **Library added:** `@anthropic-ai/sdk`.

## Source

- Commits: `f97e4d6 Build 2.1: Jarvis Chat UI`, `4384bb8 Add Jarvis Claude API backend`, `3cd0d9b Bold & vibrant design overhaul + Jarvis UX improvements`
- Plan: [docs/superpowers/plans/2026-04-09-agent-architecture-map.md](../../../docs/superpowers/plans/2026-04-09-agent-architecture-map.md)
- Migration: [supabase/migration-build21-jarvis.sql](../../../supabase/migration-build21-jarvis.sql)
- Guide: none
