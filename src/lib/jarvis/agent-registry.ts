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
      "consult_marketing",
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
    role: "IICRC standards-backed restoration guidance for water, mold, and fire/smoke jobs",
    model: "Claude Sonnet",
    status: "active",
    tools: [
      "get_job_context",
      "get_moisture_readings",
      "get_safety_alerts",
      "search_knowledge_base",
    ],
    endpoint: "/api/jarvis/field-ops",
    accessMethod: "@fieldops command or auto-routing from job context",
    config: { max_tokens: 8192, timeout: "60s" },
    knowledgeSources: [
      "S500 Quick Reference",
      "S520 Quick Reference",
      "S700 Reference",
      "Full standards via pgvector RAG",
    ],
    promptImportPath: "src/lib/jarvis/prompts/field-ops.ts",
  },
  {
    id: "marketing",
    name: "Marketing Department",
    shortName: "Marketing",
    role: "Digital marketing content — Google Ads, SEO, social media, GBP, website copy, review responses, LLM optimization",
    model: "Claude Sonnet",
    status: "active",
    tools: ["web_search", "get_business_info", "get_services_list"],
    endpoint: "/api/jarvis/marketing",
    accessMethod: "@marketing command or Marketing mode toggle",
    config: { max_tokens: 8192, timeout: "60s" },
    promptImportPath: "src/lib/jarvis/prompts/marketing.ts",
  },
];

export function getAgent(id: string): AgentConfig | undefined {
  return AGENT_REGISTRY.find((a) => a.id === id);
}

export function getActiveAgents(): AgentConfig[] {
  return AGENT_REGISTRY.filter((a) => a.status === "active");
}
