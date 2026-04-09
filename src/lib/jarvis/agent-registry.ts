export type AgentStatus = "active" | "planned";

export interface AgentConfig {
  id: string;
  name: string;
  shortName: string;
  role: string;
  model: string;
  status: AgentStatus;
  plannedBuild?: string;
  tools?: string[];
  endpoint?: string;
  accessMethod?: string;
  config?: Record<string, unknown>;
  knowledgeSources?: string[];
  promptImportPath?: string;
}

export const AGENT_REGISTRY: AgentConfig[] = [
  {
    id: "jarvis-core",
    name: "Jarvis Core",
    shortName: "Jarvis",
    role: "Orchestrator — routes to specialized departments, handles general conversation",
    model: "Claude Sonnet",
    status: "active",
    tools: [
      "get_job_details",
      "search_jobs",
      "get_business_metrics",
      "log_activity",
      "create_alert",
      "consult_rnd",
    ],
    endpoint: "/api/jarvis/chat",
    promptImportPath: "src/lib/jarvis/prompts/jarvis-core.ts",
  },
  {
    id: "rnd",
    name: "R&D Department",
    shortName: "R&D",
    role: "Platform improvement, technology research, bug diagnosis, build spec generation",
    model: "Claude Opus",
    status: "active",
    tools: [
      "read_project_structure",
      "read_file",
      "check_system_health",
      "check_recent_errors",
      "query_database",
      "web_search",
    ],
    endpoint: "/api/jarvis/rnd",
    accessMethod: "@rnd command or R&D mode toggle",
    config: { max_tokens: 16384, timeout: "120s" },
    promptImportPath: "src/lib/jarvis/prompts/rnd.ts",
  },
  {
    id: "field-ops",
    name: "Field Operations",
    shortName: "Field Ops",
    role: "IICRC standards-backed restoration guidance — water, mold, fire/smoke",
    model: "Claude Sonnet (planned)",
    status: "planned",
    plannedBuild: "Build 2.4",
    knowledgeSources: [
      "S500 Quick Reference",
      "S520 Quick Reference",
      "S700 Reference",
      "Full standards via pgvector RAG",
    ],
  },
  {
    id: "marketing",
    name: "Marketing Department",
    shortName: "Marketing",
    role: "Content creation, SEO, social media, review responses, customer communication",
    model: "TBD",
    status: "planned",
    plannedBuild: "Build 2.6",
  },
];

export function getAgent(id: string): AgentConfig | undefined {
  return AGENT_REGISTRY.find((a) => a.id === id);
}

export function getActiveAgents(): AgentConfig[] {
  return AGENT_REGISTRY.filter((a) => a.status === "active");
}
