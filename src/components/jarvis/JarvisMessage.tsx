"use client";

import ReactMarkdown from "react-markdown";
import type { JarvisMessage as JarvisMessageType } from "@/lib/types";

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) {
    return `Yesterday at ${new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function JarvisMessage({ message }: { message: JarvisMessageType }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex items-start gap-3 px-4 ${isUser ? "flex-row-reverse" : ""}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-[#1B2434] flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-white">J</span>
        </div>
      )}
      <div className={`max-w-[80%] space-y-1 ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={
            isUser
              ? "bg-[#1B2434] text-white rounded-2xl rounded-tr-sm px-4 py-2.5"
              : "bg-[#F5F5F5] text-[#1A1A1A] rounded-2xl rounded-tl-sm px-4 py-2.5"
          }
        >
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="text-sm jarvis-markdown">
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  em: ({ children }) => <em className="italic">{children}</em>,
                  ul: ({ children }) => <ul className="list-disc ml-4 mb-2 space-y-1">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal ml-4 mb-2 space-y-1">{children}</ol>,
                  li: ({ children }) => <li>{children}</li>,
                  code: ({ children, className }) => {
                    const isBlock = className?.includes("language-");
                    if (isBlock) {
                      return (
                        <pre className="bg-[#E8E8E8] rounded-lg p-3 my-2 overflow-x-auto">
                          <code className="text-xs font-mono">{children}</code>
                        </pre>
                      );
                    }
                    return (
                      <code className="bg-[#E8E8E8] rounded px-1.5 py-0.5 text-xs font-mono">
                        {children}
                      </code>
                    );
                  },
                  a: ({ href, children }) => (
                    <a href={href} className="text-[#2B5EA7] underline" target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
        <p className={`text-[10px] text-[#999999] px-1 ${isUser ? "text-right" : "text-left"}`}>
          {formatRelativeTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}
