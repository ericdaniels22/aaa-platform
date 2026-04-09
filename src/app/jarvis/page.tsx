"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { JarvisConversation } from "@/lib/types";
import JarvisChat from "@/components/jarvis/JarvisChat";
import JarvisConversationList from "@/components/jarvis/JarvisConversationList";
import { Sparkles, PanelLeftClose, PanelLeft } from "lucide-react";

export default function JarvisPage() {
  const { user, profile } = useAuth();
  const [conversations, setConversations] = useState<JarvisConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(true);

  const isAdmin = profile?.role === "admin";

  const fetchConversations = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();

    let query = supabase
      .from("jarvis_conversations")
      .select("*")
      .eq("context_type", "general")
      .order("updated_at", { ascending: false });

    if (!isAdmin) {
      query = query.eq("user_id", user.id);
    }

    const { data } = await query;
    if (data) {
      setConversations(data as JarvisConversation[]);
    }
    setLoading(false);
  }, [user, isAdmin]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  function handleNewConversation() {
    setActiveConversationId(null);
  }

  function handleSelectConversation(id: string) {
    setActiveConversationId(id);
  }

  function handleConversationCreated(id: string) {
    setActiveConversationId(id);
    fetchConversations();
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] lg:h-screen flex -m-6 lg:-m-8">
      {/* Conversation sidebar */}
      <div
        className={`bg-white border-r border-gray-200 flex-shrink-0 transition-all duration-200 ${
          sidebarOpen ? "w-72" : "w-0"
        } overflow-hidden hidden lg:block`}
      >
        <JarvisConversationList
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={handleSelectConversation}
          onNew={handleNewConversation}
        />
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="hidden lg:flex items-center justify-center w-8 h-8 rounded-lg hover:bg-gray-100 transition-colors text-[#666666]"
            >
              {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
            </button>
            <div className="flex items-center gap-2">
              <Sparkles size={20} className="text-[#1B2434]" />
              <h1 className="text-lg font-semibold text-[#1A1A1A]">Jarvis</h1>
              <span className="w-2 h-2 rounded-full bg-emerald-500" title="Connected" />
            </div>
          </div>

          {/* Mobile: new conversation button */}
          <button
            onClick={handleNewConversation}
            className="lg:hidden text-sm text-[#2B5EA7] font-medium"
          >
            New Chat
          </button>
        </div>

        {/* Chat */}
        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="flex-1 flex items-center justify-center h-full">
              <p className="text-sm text-[#999999]">Loading...</p>
            </div>
          ) : (
            <JarvisChat
              key={activeConversationId || "new"}
              contextType="general"
              conversationId={activeConversationId}
              onConversationCreated={handleConversationCreated}
            />
          )}
        </div>
      </div>
    </div>
  );
}
