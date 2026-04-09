"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { JarvisConversation, JarvisMessage as JarvisMessageType } from "@/lib/types";
import JarvisMessage from "./JarvisMessage";
import JarvisInput from "./JarvisInput";
import JarvisQuickActions from "./JarvisQuickActions";
import JarvisTypingIndicator from "./JarvisTypingIndicator";
import JarvisWelcome from "./JarvisWelcome";

export interface JarvisChatProps {
  contextType: "general" | "job";
  jobId?: string;
  jobContext?: {
    customerName: string;
    address: string;
    status: string;
    damageType: string;
  };
  conversationId?: string | null;
  onConversationCreated?: (id: string) => void;
}

export default function JarvisChat({
  contextType,
  jobId,
  jobContext,
  conversationId,
  onConversationCreated,
}: JarvisChatProps) {
  const { user } = useAuth();
  const [conversation, setConversation] = useState<JarvisConversation | null>(null);
  const [messages, setMessages] = useState<JarvisMessageType[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  // Load conversation
  const loadConversation = useCallback(async (id: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("jarvis_conversations")
      .select("*")
      .eq("id", id)
      .single();

    if (data) {
      const conv = data as JarvisConversation;
      setConversation(conv);
      setMessages(conv.messages || []);
    }
    setLoading(false);
  }, []);

  // For job context: find or await the active conversation for this job
  const loadJobConversation = useCallback(async () => {
    if (!jobId || !user) {
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("jarvis_conversations")
      .select("*")
      .eq("job_id", jobId)
      .eq("user_id", user.id)
      .eq("context_type", "job")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      const conv = data as JarvisConversation;
      setConversation(conv);
      setMessages(conv.messages || []);
      onConversationCreated?.(conv.id);
    }
    setLoading(false);
  }, [jobId, user, onConversationCreated]);

  useEffect(() => {
    if (conversationId) {
      loadConversation(conversationId);
    } else if (contextType === "job") {
      loadJobConversation();
    } else {
      setLoading(false);
    }
  }, [conversationId, contextType, loadConversation, loadJobConversation]);

  // Auto-scroll
  useEffect(() => {
    if (!userScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isTyping]);

  function handleScroll() {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    userScrolledUp.current = scrollHeight - scrollTop - clientHeight > 100;
  }

  async function createConversation(firstMessage: JarvisMessageType): Promise<JarvisConversation> {
    const supabase = createClient();
    const title = firstMessage.content.length > 50
      ? firstMessage.content.slice(0, 47) + "..."
      : firstMessage.content;

    const { data, error } = await supabase
      .from("jarvis_conversations")
      .insert({
        user_id: user?.id,
        job_id: jobId || null,
        context_type: contextType,
        title,
        messages: [firstMessage],
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    const conv = data as JarvisConversation;
    onConversationCreated?.(conv.id);
    return conv;
  }

  async function saveMessages(convId: string, msgs: JarvisMessageType[]) {
    const supabase = createClient();
    await supabase
      .from("jarvis_conversations")
      .update({
        messages: msgs,
        updated_at: new Date().toISOString(),
      })
      .eq("id", convId);
  }

  function getMockResponse(): string {
    if (contextType === "job" && jobContext) {
      return `I can see I'm on the ${jobContext.customerName} job at ${jobContext.address}. My full intelligence gets connected in the next build — once that's done, ask me anything about this job and I'll pull from the database in real time. For now, just know I'm here and I'm ready.`;
    }
    return "Hey Eric! I'm Jarvis — your AI partner for AAA Disaster Recovery. My brain gets fully connected in the next build, but I can already see that my conversation system is working perfectly. Once I'm wired up, ask me anything about the business. I'll be ready.";
  }

  async function handleSend(content: string) {
    const userMsg: JarvisMessageType = {
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsTyping(true);
    userScrolledUp.current = false;

    let conv = conversation;

    // Create or update conversation
    if (!conv) {
      conv = await createConversation(userMsg);
      setConversation(conv);
    } else {
      await saveMessages(conv.id, newMessages);
    }

    // Mock response with delay
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const assistantMsg: JarvisMessageType = {
      role: "assistant",
      content: getMockResponse(),
      timestamp: new Date().toISOString(),
    };

    const finalMessages = [...newMessages, assistantMsg];
    setMessages(finalMessages);
    setIsTyping(false);

    if (conv) {
      await saveMessages(conv.id, finalMessages);
    }
  }

  function handleQuickAction(text: string) {
    handleSend(text);
  }

  const showQuickActions = messages.length < 2 && !isTyping;
  const showWelcome = messages.length === 0 && !loading;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-[#999999]">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Job context banner */}
      {contextType === "job" && jobContext && (
        <div className="px-4 py-2.5 bg-[#F5F5F5] border-b border-gray-100 flex items-center gap-2">
          <span className="text-xs text-[#666666]">Viewing:</span>
          <span className="text-xs font-medium text-[#1A1A1A]">
            {jobContext.customerName} — {jobContext.address}
          </span>
        </div>
      )}

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {showWelcome ? (
          <JarvisWelcome
            contextType={contextType}
            jobContext={jobContext ? { customerName: jobContext.customerName, address: jobContext.address } : undefined}
            onQuickAction={handleQuickAction}
          />
        ) : (
          <div className="py-4 space-y-4">
            {messages.map((msg, i) => (
              <JarvisMessage key={i} message={msg} />
            ))}
            {isTyping && <JarvisTypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Quick actions */}
      {showQuickActions && !showWelcome && (
        <JarvisQuickActions contextType={contextType} onSelect={handleQuickAction} />
      )}

      {/* Input */}
      <JarvisInput onSend={handleSend} disabled={isTyping} />
    </div>
  );
}
