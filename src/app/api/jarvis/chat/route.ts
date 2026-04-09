import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-api";
import { buildSystemPrompt } from "@/lib/jarvis/system-prompt";
import {
  jarvisToolDefinitions,
  executeJarvisTool,
} from "@/lib/jarvis/tools";
import type { JarvisMessage } from "@/lib/types";

const MAX_TOOL_ITERATIONS = 5;
const MAX_CONVERSATION_MESSAGES = 30;

export async function POST(request: NextRequest) {
  try {
    // Parse request
    const body = await request.json();
    const {
      context_type,
      job_id,
      message,
      conversation_id,
    }: {
      context_type: "general" | "job";
      job_id?: string;
      message: string;
      conversation_id?: string;
    } = body;

    if (!message || !context_type) {
      return NextResponse.json(
        { error: "message and context_type are required" },
        { status: 400 }
      );
    }

    // Authenticate
    const authSupabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await authSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Service client for broad data access
    const supabase = createServiceClient();

    // Fetch user profile
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("full_name, role")
      .eq("id", user.id)
      .single();

    const userName = profile?.full_name || "User";
    const userRole = profile?.role || "crew_member";

    // Build context for system prompt
    let jobData = null;
    let businessSnapshot = null;

    if (context_type === "job" && job_id) {
      // Fetch job context
      const { data: job } = await supabase
        .from("jobs")
        .select(
          "*, contact:contacts!contact_id(first_name, last_name), adjuster:contacts!adjuster_contact_id(first_name, last_name, email)"
        )
        .eq("id", job_id)
        .single();

      if (job) {
        jobData = {
          id: job.id,
          jobNumber: job.job_number,
          customerName: job.contact
            ? `${job.contact.first_name} ${job.contact.last_name}`
            : "Unknown",
          address: job.property_address,
          status: job.status,
          damageType: job.damage_type,
          urgency: job.urgency,
          insuranceCompany: job.insurance_company,
          claimNumber: job.claim_number,
          adjusterName: job.adjuster
            ? `${job.adjuster.first_name} ${job.adjuster.last_name}`
            : null,
          adjusterEmail: job.adjuster?.email || null,
          createdAt: job.created_at,
        };
      }
    } else {
      // Fetch business snapshot for general context
      const activeStatuses = ["new", "in_progress", "pending_invoice"];

      const { data: allJobs } = await supabase
        .from("jobs")
        .select("status");

      const jobsByStatus: Record<string, number> = {};
      let activeCount = 0;
      for (const j of allJobs || []) {
        jobsByStatus[j.status] = (jobsByStatus[j.status] || 0) + 1;
        if (activeStatuses.includes(j.status)) activeCount++;
      }

      // Outstanding balance
      const { data: activeJobIds } = await supabase
        .from("jobs")
        .select("id")
        .in("status", activeStatuses);

      let totalOutstanding = 0;
      if (activeJobIds && activeJobIds.length > 0) {
        const ids = activeJobIds.map((j) => j.id);
        const { data: invoices } = await supabase
          .from("invoices")
          .select("total_amount")
          .in("job_id", ids)
          .in("status", ["draft", "sent", "partial"]);

        const { data: payments } = await supabase
          .from("payments")
          .select("amount")
          .in("job_id", ids)
          .eq("status", "received");

        const totalInvoiced = (invoices || []).reduce(
          (s, i) => s + Number(i.total_amount),
          0
        );
        const totalPaid = (payments || []).reduce(
          (s, p) => s + Number(p.amount),
          0
        );
        totalOutstanding = Math.max(0, totalInvoiced - totalPaid);
      }

      // Overdue follow-ups
      const sevenDaysAgo = new Date(
        Date.now() - 7 * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data: activeJobs } = await supabase
        .from("jobs")
        .select("id, updated_at")
        .in("status", activeStatuses);

      let overdueCount = 0;
      if (activeJobs && activeJobs.length > 0) {
        const { data: recentActivities } = await supabase
          .from("job_activities")
          .select("job_id, created_at")
          .in(
            "job_id",
            activeJobs.map((j) => j.id)
          )
          .order("created_at", { ascending: false });

        const latestByJob: Record<string, string> = {};
        for (const a of recentActivities || []) {
          if (!latestByJob[a.job_id]) latestByJob[a.job_id] = a.created_at;
        }

        for (const j of activeJobs) {
          const last = latestByJob[j.id] || j.updated_at;
          if (last < sevenDaysAgo) overdueCount++;
        }
      }

      businessSnapshot = {
        activeJobCount: activeCount,
        jobsByStatus,
        totalOutstanding,
        overdueCount,
      };
    }

    // Build system prompt
    const systemPrompt = buildSystemPrompt({
      userName,
      userRole,
      contextType: context_type,
      jobData,
      businessSnapshot,
    });

    // Load conversation history
    let conversationMessages: JarvisMessage[] = [];
    if (conversation_id) {
      const { data: conv } = await supabase
        .from("jarvis_conversations")
        .select("messages")
        .eq("id", conversation_id)
        .single();

      if (conv?.messages) {
        conversationMessages = conv.messages as JarvisMessage[];
      }
    }

    // Build messages for Claude — truncate if needed
    const historyMessages = conversationMessages.slice(
      -MAX_CONVERSATION_MESSAGES
    );

    const claudeMessages: Anthropic.MessageParam[] = historyMessages.map(
      (m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })
    );

    // Add the new user message
    claudeMessages.push({ role: "user", content: message });

    // Call Claude API
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    let response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: claudeMessages,
      tools: jarvisToolDefinitions,
    });

    // Tool use loop
    let iterations = 0;
    while (response.stop_reason === "tool_use" && iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      // Extract tool use blocks
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      // Execute each tool
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        const result = await executeJarvisTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          {
            userId: user.id,
            userName,
            userRole,
            jobId: job_id,
            supabase,
          }
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      // Continue conversation with tool results
      claudeMessages.push({ role: "assistant", content: response.content });
      claudeMessages.push({ role: "user", content: toolResults });

      response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages: claudeMessages,
        tools: jarvisToolDefinitions,
      });
    }

    // Extract final text response
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );
    const assistantContent =
      textBlocks.map((b) => b.text).join("\n") ||
      "I ran into an issue processing that. Could you try again?";

    // Save messages to conversation
    const now = new Date().toISOString();
    const userMsg: JarvisMessage = {
      role: "user",
      content: message,
      timestamp: now,
    };
    const assistantMsg: JarvisMessage = {
      role: "assistant",
      content: assistantContent,
      timestamp: new Date().toISOString(),
    };

    const updatedMessages = [...conversationMessages, userMsg, assistantMsg];

    if (conversation_id) {
      // Auto-title on first response if no title yet
      const { data: conv } = await supabase
        .from("jarvis_conversations")
        .select("title")
        .eq("id", conversation_id)
        .single();

      const updates: Record<string, unknown> = {
        messages: updatedMessages,
        updated_at: new Date().toISOString(),
      };

      // Set title from first user message if it's still the default
      if (
        conv &&
        (!conv.title || conv.title === message.slice(0, 47) + "..." || conv.title === message)
      ) {
        const words = message.split(" ");
        let title = "";
        for (const word of words) {
          if ((title + " " + word).trim().length > 50) break;
          title = (title + " " + word).trim();
        }
        if (title.length < message.length) title += "...";
        updates.title = title;
      }

      await supabase
        .from("jarvis_conversations")
        .update(updates)
        .eq("id", conversation_id);
    }

    return NextResponse.json({
      content: assistantContent,
      conversation_id: conversation_id || null,
    });
  } catch (err) {
    console.error("Jarvis API error:", err);
    return NextResponse.json(
      {
        error: "Something went wrong",
        content:
          "I hit a snag — give me a sec and try again. If this keeps happening, let Eric know.",
      },
      { status: 500 }
    );
  }
}
