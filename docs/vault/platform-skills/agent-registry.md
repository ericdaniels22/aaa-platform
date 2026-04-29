---
skill: agent-registry
status: shipped
location: src/lib/jarvis/agent-registry.ts
related_agents: ["[[jarvis]]"]
---

#platform-skill #area/jarvis #status/shipped

# `agent-registry`

Single source of truth for all Jarvis agents — the orchestrator and its specialists. Defined in [src/lib/jarvis/agent-registry.ts](../../../src/lib/jarvis/agent-registry.ts).

## Shape

```ts
type AgentStatus = "active" | "planned";

interface AgentConfig {
  id: string;
  name: string;
  shortName: string;
  role: string;
  model: string;             // "Claude Sonnet" / "Claude Opus"
  status: AgentStatus;
  plannedBuild?: string;
  tools?: string[];
  endpoint?: string;
  accessMethod?: string;
  config?: Record<string, unknown>;
  knowledgeSources?: string[];
  promptImportPath?: string;
}
```

`AGENT_REGISTRY: AgentConfig[]` exports the four currently active agents:

- `jarvis-core` — orchestrator
- `rnd` — R&D, Claude Opus
- `field-ops` — IICRC-backed restoration guidance
- `marketing` — digital marketing content

Helpers: `getAgent(id)`, `getActiveAgents()`.

## Used by

- The 3D neural-network welcome scene at `/jarvis` (commit `8b7207f` extracted the registry as the source of truth for hub-and-spoke node placement).
- Mode toggle UI on `/jarvis` for admin users.
- Detail panel sheets that show agent role/tools/endpoints.

## Why it exists

Adding a new agent shouldn't require touching the chat route + UI + 3D scene + detail panel separately. Anything that wants to know "what agents exist and what can they do" reads this registry.
