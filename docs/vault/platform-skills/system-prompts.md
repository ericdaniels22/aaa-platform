---
skill: system-prompts
status: shipped
location: src/lib/jarvis/prompts/
related_agents: ["[[jarvis]]"]
related_builds: ["[[build-21]]", "[[build-23]]", "[[build-25a]]", "[[build-26b]]"]
---

#platform-skill #area/jarvis #status/shipped

# `system-prompts`

Per-agent system prompt files. Extracted from each route into shared modules so the same prompt content is visible to the chat route, the agent registry, and the detail-panel sheets that explain "what does this agent do" (commit `dbcc434 refactor: extract system prompts to shared files for reuse by detail panel`).

## Files

- [src/lib/jarvis/prompts/jarvis-core.ts](../../../src/lib/jarvis/prompts/jarvis-core.ts) — orchestrator persona, departmental routing rules, mission-driven values. Exports `JARVIS_CORE_STATIC_PROMPT` plus a `buildSystemPrompt(context)` builder that interpolates job/business snapshot data.
- [src/lib/jarvis/prompts/rnd.ts](../../../src/lib/jarvis/prompts/rnd.ts) — R&D specialist; bug diagnosis + spec generation focus.
- [src/lib/jarvis/prompts/field-ops.ts](../../../src/lib/jarvis/prompts/field-ops.ts) — Field Operations; IICRC standards-grounded (S500, S520, S700).
- [src/lib/jarvis/prompts/marketing.ts](../../../src/lib/jarvis/prompts/marketing.ts) — Marketing; Google Ads + SEO + social + GBP + LLM-optimization persona.

The agent registry references each via `promptImportPath`.

## Why it's a skill

Prompts are the largest non-tabular configuration surface in the platform — keeping them in modules (not inlined in routes) means they version with the agents and stay grep-able.

## Source

- Builds: [[build-21]], [[build-23]], [[build-25a]], [[build-26b]]
- Refactor commit: `dbcc434 refactor: extract system prompts to shared files for reuse by detail panel`
