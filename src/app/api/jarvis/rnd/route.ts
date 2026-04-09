import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import * as fs from "fs";
import * as path from "path";

const MAX_TOOL_ITERATIONS = 10;

const RND_SYSTEM_PROMPT = `You are the Research & Development department for AAA Disaster Recovery's business platform.

YOUR ROLE:
You are a senior software architect and researcher. You help improve the AAA platform by researching technologies, diagnosing issues, analyzing the live system, and generating build specifications. Your answers are delivered through Jarvis — keep them thorough and technical. Jarvis will translate for the audience.

TECH STACK:
- Frontend: Next.js 14+ (App Router), TypeScript, Tailwind CSS, shadcn/ui, Lucide icons
- Backend/Database: Supabase (PostgreSQL + Auth + Storage + Realtime)
- Hosting: Vercel (frontend) + Supabase Cloud (database)
- Email: IMAP/SMTP via imapflow + nodemailer
- AI: Claude API via Anthropic SDK (Sonnet for Jarvis core, Opus for R&D)

IMPORTANT: Do NOT rely on any hardcoded knowledge about what tables exist, what pages are built, or what the codebase looks like. You have tools to discover this dynamically. Always use read_project_structure and query_database to understand the current state of the platform before making recommendations.

RESPONSE RULES:
- Before suggesting anything, use your tools to understand what currently exists. Don't assume.
- When suggesting features: include what it does, why it matters, complexity estimate (small/medium/large), dependencies, and implementation approach.
- When diagnosing issues: provide what's happening, likely root cause, affected components, and proposed fix.
- When generating build specs: format them as Claude Code-ready prompts with database schema if needed, component descriptions, API routes, and testing checklists. Match the style of the project's existing build patterns.
- When researching technologies: evaluate license compatibility (prefer MIT/Apache), bundle size, maintenance activity, community adoption, and fit with the existing stack.
- Stay within the tech stack unless there's strong justification to add something new.`;

// R&D tool definitions for Claude API
const rndToolDefinitions: Anthropic.Messages.Tool[] = [
  {
    name: "read_project_structure",
    description:
      "Read the current project folder structure and key files. Returns the directory tree of src/, the contents of package.json (to see installed dependencies), and the list of API routes. Use this FIRST when you need to understand what's currently built before making recommendations.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            "Specific subdirectory to explore in detail. Default is 'src' for the full app structure. Use 'src/app' for pages, 'src/components' for components, 'src/lib' for utilities, 'src/app/api' for API routes.",
        },
        include_file_contents: {
          type: "boolean",
          description:
            "If true, also return the contents of key files like package.json and any relevant config files. Default false.",
        },
      },
    },
  },
  {
    name: "read_file",
    description:
      "Read the contents of a specific source file from the project. Use when you need to understand how a specific component, page, API route, or utility works. Provide the path relative to the project root (e.g., 'src/app/jarvis/page.tsx').",
    input_schema: {
      type: "object" as const,
      properties: {
        filepath: {
          type: "string",
          description:
            "Path to the file relative to the project root. Example: 'src/app/api/jarvis/chat/route.ts'",
        },
      },
      required: ["filepath"],
    },
  },
  {
    name: "check_system_health",
    description:
      "Check the health of the live AAA platform. Returns database connection status, table row counts, recent activity indicators, and active alerts. Use when asked to diagnose problems or check if something is working.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "check_recent_errors",
    description:
      "Check for recent errors or issues in the Jarvis system. Looks at recent conversations for error patterns and failed interactions. Use when something seems broken or a user reports an issue.",
    input_schema: {
      type: "object" as const,
      properties: {
        hours: {
          type: "number",
          description: "How many hours back to check. Default 24.",
        },
      },
    },
  },
  {
    name: "query_database",
    description:
      "Run a read-only SQL query against the Supabase database. Use for investigating data, checking table structures, examining schema, or gathering metrics. ONLY SELECT queries are allowed.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "A read-only SQL SELECT query",
        },
      },
      required: ["query"],
    },
  },
];

// Get project root — walk up from this file to find package.json
function getProjectRoot(): string {
  let dir = process.cwd();
  // In Next.js, process.cwd() should be the project root
  return dir;
}

// --- Tool Implementations ---

function readDirectoryTree(
  dirPath: string,
  prefix: string = "",
  depth: number = 0,
  maxDepth: number = 4
): string {
  if (depth >= maxDepth) return "";

  const skipDirs = new Set([
    "node_modules",
    ".next",
    ".git",
    ".claude",
    ".vercel",
    "__pycache__",
  ]);

  let result = "";
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const sorted = entries.sort((a, b) => {
      // Directories first
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i];
      if (skipDirs.has(entry.name)) continue;

      const isLast = i === sorted.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const newPrefix = isLast ? prefix + "    " : prefix + "│   ";

      result += `${prefix}${connector}${entry.name}\n`;

      if (entry.isDirectory()) {
        result += readDirectoryTree(
          path.join(dirPath, entry.name),
          newPrefix,
          depth + 1,
          maxDepth
        );
      }
    }
  } catch {
    result += `${prefix}(error reading directory)\n`;
  }

  return result;
}

async function executeRndTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  supabase: ReturnType<typeof createServiceClient>
): Promise<string> {
  try {
    switch (toolName) {
      case "read_project_structure": {
        const targetPath =
          (toolInput.path as string) || "src";
        const includeContents =
          (toolInput.include_file_contents as boolean) || false;
        const projectRoot = getProjectRoot();
        const fullPath = path.join(projectRoot, targetPath);

        let result = `Project structure: ${targetPath}/\n`;
        result += readDirectoryTree(fullPath);

        if (includeContents) {
          // Read package.json
          try {
            const pkgPath = path.join(projectRoot, "package.json");
            const pkgContent = fs.readFileSync(pkgPath, "utf-8");
            result += `\n--- package.json ---\n${pkgContent}\n`;
          } catch {
            result += "\n(package.json not found)\n";
          }

          // Read tsconfig.json
          try {
            const tscPath = path.join(projectRoot, "tsconfig.json");
            const tscContent = fs.readFileSync(tscPath, "utf-8");
            result += `\n--- tsconfig.json ---\n${tscContent}\n`;
          } catch {
            // skip
          }
        }

        return result;
      }

      case "read_file": {
        const filepath = toolInput.filepath as string;
        const projectRoot = getProjectRoot();
        const fullPath = path.join(projectRoot, filepath);

        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const lines = content.split("\n");
          const MAX_LINES = 500;

          if (lines.length > MAX_LINES) {
            const firstLines = lines.slice(0, 200).join("\n");
            const lastLines = lines.slice(-200).join("\n");
            return `--- ${filepath} (${lines.length} lines, truncated) ---\n${firstLines}\n\n... (${lines.length - 400} lines omitted) ...\n\n${lastLines}`;
          }

          return `--- ${filepath} ---\n${content}`;
        } catch {
          return `Error: File not found at ${filepath}`;
        }
      }

      case "check_system_health": {
        const results: Record<string, unknown> = {};

        // Table row counts
        const { data: tables, error: tablesErr } = await supabase.rpc(
          "execute_readonly_query",
          {
            query_text:
              "SELECT schemaname, relname as table_name, n_live_tup as row_count FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY n_live_tup DESC",
          }
        );
        results.tables = tablesErr
          ? { error: tablesErr.message }
          : tables || [];

        // Recent Jarvis activity (24h)
        const twentyFourHoursAgo = new Date(
          Date.now() - 24 * 60 * 60 * 1000
        ).toISOString();
        const { count: recentConvCount } = await supabase
          .from("jarvis_conversations")
          .select("*", { count: "exact", head: true })
          .gte("updated_at", twentyFourHoursAgo);
        results.jarvis_conversations_24h = recentConvCount || 0;

        // Active alerts
        const { count: activeAlertCount } = await supabase
          .from("jarvis_alerts")
          .select("*", { count: "exact", head: true })
          .eq("status", "active");
        results.active_alerts = activeAlertCount || 0;

        // Jobs by status
        const { data: allJobs } = await supabase
          .from("jobs")
          .select("status");
        const jobsByStatus: Record<string, number> = {};
        for (const j of allJobs || []) {
          jobsByStatus[j.status] = (jobsByStatus[j.status] || 0) + 1;
        }
        results.jobs_by_status = jobsByStatus;

        // Stale jobs (no activity in 14+ days)
        const fourteenDaysAgo = new Date(
          Date.now() - 14 * 24 * 60 * 60 * 1000
        ).toISOString();
        const { data: activeJobs } = await supabase
          .from("jobs")
          .select("id, job_number, property_address, updated_at")
          .in("status", ["new", "in_progress", "pending_invoice"]);

        const staleJobs: { job_number: string; address: string; last_update: string }[] = [];
        if (activeJobs) {
          const { data: recentActivities } = await supabase
            .from("job_activities")
            .select("job_id, created_at")
            .in("job_id", activeJobs.map((j) => j.id))
            .order("created_at", { ascending: false });

          const latestByJob: Record<string, string> = {};
          for (const a of recentActivities || []) {
            if (!latestByJob[a.job_id]) latestByJob[a.job_id] = a.created_at;
          }

          for (const j of activeJobs) {
            const last = latestByJob[j.id] || j.updated_at;
            if (last < fourteenDaysAgo) {
              staleJobs.push({
                job_number: j.job_number,
                address: j.property_address,
                last_update: last,
              });
            }
          }
        }
        results.stale_jobs_14d = staleJobs;

        results.status = "healthy";
        results.checked_at = new Date().toISOString();

        return JSON.stringify(results, null, 2);
      }

      case "check_recent_errors": {
        const hours = (toolInput.hours as number) || 24;
        const since = new Date(
          Date.now() - hours * 60 * 60 * 1000
        ).toISOString();

        const { data: conversations } = await supabase
          .from("jarvis_conversations")
          .select("id, title, messages, updated_at")
          .gte("updated_at", since)
          .order("updated_at", { ascending: false })
          .limit(50);

        const errorPatterns = [
          "hit a snag",
          "error",
          "failed",
          "something went wrong",
          "lost connection",
          "couldn't",
          "unable to",
        ];

        const issues: {
          conversation_id: string;
          title: string;
          timestamp: string;
          snippet: string;
        }[] = [];

        for (const conv of conversations || []) {
          const msgs = (conv.messages as Array<{ role: string; content: string; timestamp: string }>) || [];
          for (const msg of msgs) {
            if (msg.role !== "assistant") continue;
            const lower = msg.content.toLowerCase();
            if (errorPatterns.some((p) => lower.includes(p))) {
              issues.push({
                conversation_id: conv.id,
                title: conv.title || "Untitled",
                timestamp: msg.timestamp,
                snippet:
                  msg.content.length > 200
                    ? msg.content.slice(0, 200) + "..."
                    : msg.content,
              });
            }
          }
        }

        return JSON.stringify(
          {
            hours_checked: hours,
            conversations_scanned: (conversations || []).length,
            issues_found: issues.length,
            issues: issues.slice(0, 20),
          },
          null,
          2
        );
      }

      case "query_database": {
        const query = (toolInput.query as string || "").trim();

        // Validate read-only
        if (!query.toLowerCase().startsWith("select")) {
          return JSON.stringify({
            error: "Only SELECT queries are allowed",
          });
        }

        const forbidden = /\b(drop|delete|update|insert|alter|truncate|create|grant|revoke)\b/i;
        if (forbidden.test(query)) {
          return JSON.stringify({
            error: "Query contains forbidden keywords",
          });
        }

        const { data, error } = await supabase.rpc("execute_readonly_query", {
          query_text: query,
        });

        if (error) {
          return JSON.stringify({ error: error.message });
        }

        return JSON.stringify(data || [], null, 2);
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({
      error: `Tool execution failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { question, context }: { question: string; context?: string } = body;

    if (!question) {
      return NextResponse.json(
        { error: "question is required" },
        { status: 400 }
      );
    }

    // Authenticate — accept either cookie auth OR internal service key
    const internalKey = request.headers.get("x-service-key");
    const isInternalCall =
      internalKey && internalKey === process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!isInternalCall) {
      const authSupabase = await createServerSupabaseClient();
      const {
        data: { user },
        error: authError,
      } = await authSupabase.auth.getUser();

      if (authError || !user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const supabase = createServiceClient();

    // Build the user message
    let userContent = question;
    if (context) {
      userContent += `\n\nAdditional context: ${context}`;
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const claudeMessages: Anthropic.MessageParam[] = [
      { role: "user", content: userContent },
    ];

    // Build tools array — include web_search as a native tool
    const allTools: Anthropic.Messages.Tool[] = [
      ...rndToolDefinitions,
      {
        type: "web_search_20250305",
        name: "web_search",
      } as unknown as Anthropic.Messages.Tool,
    ];

    let response = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      system: RND_SYSTEM_PROMPT,
      messages: claudeMessages,
      tools: allTools,
    });

    // Tool use loop
    let iterations = 0;
    while (
      response.stop_reason === "tool_use" &&
      iterations < MAX_TOOL_ITERATIONS
    ) {
      iterations++;

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        // web_search is handled natively by Claude — skip execution
        if (toolUse.name === "web_search") continue;

        const result = await executeRndTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          supabase
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      claudeMessages.push({ role: "assistant", content: response.content });
      if (toolResults.length > 0) {
        claudeMessages.push({ role: "user", content: toolResults });
      }

      response = await anthropic.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 4096,
        system: RND_SYSTEM_PROMPT,
        messages: claudeMessages,
        tools: allTools,
      });
    }

    // Extract final text
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );
    const rndResponse =
      textBlocks.map((b) => b.text).join("\n") ||
      "R&D was unable to generate a response. Try rephrasing the question.";

    return NextResponse.json({ content: rndResponse });
  } catch (err) {
    console.error("R&D API error:", err);
    return NextResponse.json(
      {
        error: "R&D processing failed",
        content:
          "The R&D department hit a wall on this one. Try again or rephrase the question.",
      },
      { status: 500 }
    );
  }
}
