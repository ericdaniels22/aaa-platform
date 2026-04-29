---
skill: claude-tool-loop
status: shipped
location: src/app/api/jarvis/chat/route.ts
related_agents: ["[[jarvis]]"]
related_builds: ["[[build-21]]"]
---

#platform-skill #area/jarvis #status/shipped

# `claude-tool-loop`

The Anthropic-SDK iteration pattern shared by every Jarvis route — call Claude, if `stop_reason === "tool_use"` execute the tools, append results, and call Claude again until `end_turn` or a hard cap.

## Pattern

Implemented inline in [src/app/api/jarvis/chat/route.ts](../../../src/app/api/jarvis/chat/route.ts) (and analogously in `/api/jarvis/rnd`, `/api/jarvis/field-ops`, `/api/jarvis/marketing`):

```ts
const MAX_TOOL_ITERATIONS = 5;
const MAX_CONVERSATION_MESSAGES = 30;

while (response.stop_reason === "tool_use" && iterations < MAX_TOOL_ITERATIONS) {
  for (const block of response.content) {
    if (block.type === "tool_use") {
      const result = await executeJarvisTool(block.name, block.input, context);
      // append tool_result block, re-call Claude
    }
  }
  // ...
}
```

- **`maxDuration = 120`** at module level — Vercel function timeout cap.
- **`MAX_CONVERSATION_MESSAGES = 30`** — older messages are dropped from the conversation history fed to Claude (the most recent 30).
- **`MAX_TOOL_ITERATIONS = 5`** — guard against tool loops.
- Per-agent overrides for `max_tokens` and timeout come from [[agent-registry]] `config`.

## Why it's a "skill"

Currently inlined in each route file. If we add a fifth agent, that route would also paste this loop. Worth extracting if/when the duplication starts to drift, but the pattern itself is the reusable concept.

## Source

- Build: [[build-21]]
- Routes: `/api/jarvis/chat`, `/api/jarvis/rnd`, `/api/jarvis/field-ops`, `/api/jarvis/marketing`
- SDK: `@anthropic-ai/sdk`
