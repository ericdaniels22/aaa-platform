---
skill: jarvis-tools
status: shipped
location: src/lib/jarvis/tools.ts
related_agents: ["[[jarvis]]"]
---

#platform-skill #area/jarvis #status/shipped

# `jarvis-tools`

Anthropic tool definitions and dispatcher for Jarvis Core. Defined in [src/lib/jarvis/tools.ts](../../../src/lib/jarvis/tools.ts).

## What it provides

- `jarvisToolDefinitions: Tool[]` — Anthropic SDK `Tool` array passed to Claude on every Jarvis-Core message.
- `executeJarvisTool(name, input, context)` — dispatcher that runs each tool against Supabase and returns the result for the Claude tool-use loop ([[claude-tool-loop]]).
- `ToolExecutionContext` — `{ userId, userName, userRole, jobId?, supabase }` plumbed through every tool call.

## Tools (Jarvis Core)

| Tool | What it does |
|---|---|
| `get_job_details` | Fetch job by UUID — customer info, billing, activities, photos, emails |
| `search_jobs` | Search across jobs (query, status, damage_type, limit ≤25) |
| `get_business_metrics` | KPIs over a period (today/week/month/quarter): revenue, job counts, outstanding, overdue |
| `log_activity` | Write a row to the job activity timeline (note/photo/milestone/insurance/equipment) |
| `create_alert` | Write a `jarvis_alerts` row with priority + due_date |
| `consult_rnd` | Call the R&D specialist endpoint and return its answer |
| `consult_marketing` | Call the Marketing specialist endpoint and return its answer |

## Notes

- Tools that take a `job_id` use the active org's RLS scope automatically (the `supabase` client in context is service-role for tool execution).
- `consult_rnd` / `consult_marketing` are the routing primitive — Jarvis Core calls them when it judges domain expertise is needed.
- Each specialist endpoint (`/api/jarvis/rnd`, `/api/jarvis/marketing`, `/api/jarvis/field-ops`) has its own tool set defined inline in its route, not in this file.
