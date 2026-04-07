"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
  ArrowLeft,
  Reply,
  ReplyAll,
  Forward,
  Star,
  Paperclip,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Download,
  FileIcon,
} from "lucide-react";
import type { Email } from "@/lib/types";

interface EmailReaderProps {
  emailId: string;
  onBack: () => void;
  onReply: (email: Email) => void;
  onReplyAll: (email: Email) => void;
  onForward: (email: Email) => void;
  onStarToggle: (id: string, starred: boolean) => void;
}

export default function EmailReader({
  emailId,
  onBack,
  onReply,
  onReplyAll,
  onForward,
  onStarToggle,
}: EmailReaderProps) {
  const [thread, setThread] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailId]);

  async function loadThread() {
    setLoading(true);
    try {
      // First get the email to find its thread_id
      const emailRes = await fetch(`/api/email/${emailId}`);
      const email = await emailRes.json();

      if (email.thread_id) {
        const threadRes = await fetch(
          `/api/email/thread/${encodeURIComponent(email.thread_id)}`
        );
        const threadEmails = await threadRes.json();
        if (Array.isArray(threadEmails) && threadEmails.length > 1) {
          setThread(threadEmails);
          // Expand the last email by default
          setExpandedIds(new Set([threadEmails[threadEmails.length - 1].id]));
        } else {
          setThread([email]);
          setExpandedIds(new Set([email.id]));
        }
      } else {
        setThread([email]);
        setExpandedIds(new Set([email.id]));
      }

      // Mark as read
      if (!email.is_read) {
        await fetch(`/api/email/${emailId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_read: true }),
        });
      }
    } catch {
      // fallback
    }
    setLoading(false);
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[#999]">
        Loading...
      </div>
    );
  }

  if (thread.length === 0) return null;

  const latestEmail = thread[thread.length - 1];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
        <button
          onClick={onBack}
          className="lg:hidden p-1 text-[#666] hover:text-[#333] rounded"
        >
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-base font-semibold text-[#333] truncate flex-1">
          {latestEmail.subject || "(no subject)"}
        </h2>
        {thread.length > 1 && (
          <span className="text-xs text-[#999] bg-gray-100 rounded-full px-2 py-0.5">
            {thread.length} messages
          </span>
        )}
        <button
          onClick={() => onStarToggle(latestEmail.id, !latestEmail.is_starred)}
          className="p-1 hover:bg-gray-100 rounded"
        >
          <Star
            size={16}
            className={
              latestEmail.is_starred
                ? "fill-yellow-400 text-yellow-400"
                : "text-[#ccc]"
            }
          />
        </button>
        <button
          onClick={() => onReply(latestEmail)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2B5EA7] text-white rounded-lg text-sm font-medium hover:bg-[#234b87]"
        >
          <Reply size={14} />
          Reply
        </button>
        <button
          onClick={() => onReplyAll(latestEmail)}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-[#666] rounded-lg text-sm font-medium hover:bg-gray-50"
          title="Reply All"
        >
          <ReplyAll size={14} />
        </button>
        <button
          onClick={() => onForward(latestEmail)}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-[#666] rounded-lg text-sm font-medium hover:bg-gray-50"
          title="Forward"
        >
          <Forward size={14} />
        </button>
      </div>

      {/* Thread messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {thread.map((email) => {
          const isExpanded = expandedIds.has(email.id);
          return (
            <div
              key={email.id}
              className="border border-gray-200 rounded-lg overflow-hidden bg-white"
            >
              {/* Collapsed header — always shown */}
              <button
                onClick={() => toggleExpand(email.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
              >
                <div className="w-8 h-8 rounded-full bg-[#2B5EA7] text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {(email.from_name || email.from_address)
                    .charAt(0)
                    .toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#333] truncate">
                      {email.from_name || email.from_address}
                    </span>
                    <span className="text-xs text-[#999]">
                      {format(new Date(email.received_at), "MMM d, yyyy h:mm a")}
                    </span>
                  </div>
                  {!isExpanded && (
                    <p className="text-xs text-[#999] truncate mt-0.5">
                      {email.snippet}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {email.has_attachments && (
                    <Paperclip size={14} className="text-[#999]" />
                  )}
                  {email.job && (
                    <span className="flex items-center gap-1 text-xs bg-blue-50 text-[#2B5EA7] px-2 py-0.5 rounded-full">
                      <Briefcase size={10} />
                      {email.job.job_number}
                    </span>
                  )}
                  {isExpanded ? (
                    <ChevronUp size={14} className="text-[#999]" />
                  ) : (
                    <ChevronDown size={14} className="text-[#999]" />
                  )}
                </div>
              </button>

              {/* Expanded body */}
              {isExpanded && (
                <div className="border-t border-gray-100">
                  {/* To/CC details */}
                  <div className="px-4 py-2 text-xs text-[#999] bg-gray-50/50 space-y-0.5">
                    <div>
                      <span className="font-medium text-[#666]">From:</span>{" "}
                      {email.from_name ? `${email.from_name} <${email.from_address}>` : email.from_address}
                    </div>
                    <div>
                      <span className="font-medium text-[#666]">To:</span>{" "}
                      {email.to_addresses
                        ?.map(
                          (a: { email: string; name?: string }) =>
                            a.name ? `${a.name} <${a.email}>` : a.email
                        )
                        .join(", ")}
                    </div>
                    {email.cc_addresses && email.cc_addresses.length > 0 && (
                      <div>
                        <span className="font-medium text-[#666]">CC:</span>{" "}
                        {email.cc_addresses
                          .map(
                            (a: { email: string; name?: string }) =>
                              a.name ? `${a.name} <${a.email}>` : a.email
                          )
                          .join(", ")}
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  <div className="px-4 py-4">
                    {email.body_html ? (
                      <div
                        className="prose prose-sm max-w-none text-[#333] [&_img]:max-w-full [&_a]:text-[#2B5EA7]"
                        dangerouslySetInnerHTML={{ __html: email.body_html }}
                      />
                    ) : (
                      <pre className="text-sm text-[#333] whitespace-pre-wrap font-sans leading-relaxed">
                        {email.body_text || "(empty)"}
                      </pre>
                    )}
                  </div>

                  {/* Attachments */}
                  {email.attachments && email.attachments.length > 0 && (
                    <div className="px-4 py-3 border-t border-gray-100">
                      <p className="text-xs font-medium text-[#666] mb-2 flex items-center gap-1">
                        <Paperclip size={12} />
                        {email.attachments.length} attachment{email.attachments.length !== 1 ? "s" : ""}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {email.attachments.map((att) => (
                          <a
                            key={att.id}
                            href={`/api/email/attachments/${att.id}`}
                            download={att.filename}
                            className="inline-flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors group"
                          >
                            <FileIcon size={16} className="text-[#2B5EA7] shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm text-[#333] truncate max-w-[200px]">
                                {att.filename}
                              </p>
                              {att.file_size && (
                                <p className="text-[10px] text-[#999]">
                                  {att.file_size > 1024 * 1024
                                    ? `${(att.file_size / (1024 * 1024)).toFixed(1)}MB`
                                    : `${(att.file_size / 1024).toFixed(0)}KB`}
                                </p>
                              )}
                            </div>
                            <Download size={14} className="text-[#999] group-hover:text-[#2B5EA7] shrink-0" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
