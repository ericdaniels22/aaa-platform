"use client";

import { Plus, MessageSquare } from "lucide-react";
import type { JarvisConversation } from "@/lib/types";

interface JarvisConversationListProps {
  conversations: JarvisConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

function formatRelativeDate(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString([], { month: "short", day: "numeric" });
}

function getLastMessagePreview(conversation: JarvisConversation): string {
  const msgs = conversation.messages;
  if (!msgs || msgs.length === 0) return "No messages yet";
  const last = msgs[msgs.length - 1];
  const text = last.content;
  return text.length > 60 ? text.slice(0, 57) + "..." : text;
}

export default function JarvisConversationList({
  conversations,
  activeId,
  onSelect,
  onNew,
}: JarvisConversationListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-100">
        <button
          onClick={onNew}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#1B2434] text-white text-sm font-medium hover:bg-[#2a3a52] transition-colors"
        >
          <Plus size={16} />
          New Conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <p className="text-xs text-[#999999] text-center py-8 px-4">
            No conversations yet. Start a new one!
          </p>
        )}
        {conversations.map((conv) => {
          const isActive = conv.id === activeId;
          const title = conv.title || "New conversation";
          const preview = getLastMessagePreview(conv);
          const time = formatRelativeDate(conv.updated_at);

          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={`w-full text-left px-3 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                isActive ? "bg-[#F5F5F5]" : ""
              }`}
            >
              <div className="flex items-start gap-2.5">
                <MessageSquare size={16} className="text-[#999999] flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-[#1A1A1A] truncate">{title}</p>
                    <span className="text-[10px] text-[#999999] flex-shrink-0">{time}</span>
                  </div>
                  <p className="text-xs text-[#999999] truncate mt-0.5">{preview}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
