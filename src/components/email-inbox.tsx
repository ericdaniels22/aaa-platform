"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { format, isToday, isYesterday } from "date-fns";
import {
  Inbox,
  Send,
  FileEdit,
  Trash2,
  Archive,
  AlertCircle,
  Star,
  Search,
  RefreshCw,
  Paperclip,
  Briefcase,
  MailPlus,
  MailCheck,
  ChevronDown,
  Settings,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Email, EmailAccount } from "@/lib/types";
import EmailReader from "@/components/email-reader";
import ComposeEmailModal from "@/components/compose-email";

interface FolderCounts {
  [key: string]: { total: number; unread: number };
}

interface ListResponse {
  emails: Email[];
  total: number;
  page: number;
  hasMore: boolean;
}

const FOLDERS = [
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "sent", label: "Sent", icon: Send },
  { key: "drafts", label: "Drafts", icon: FileEdit },
  { key: "trash", label: "Trash", icon: Trash2 },
  { key: "archive", label: "Archive", icon: Archive },
  { key: "spam", label: "Spam", icon: AlertCircle },
  { key: "starred", label: "Starred", icon: Star },
];

function formatEmailDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d");
}

export default function EmailInbox() {
  const [folder, setFolder] = useState("inbox");
  const [emails, setEmails] = useState<Email[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [counts, setCounts] = useState<FolderCounts>({});

  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);

  // Resizable pane widths
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return 208;
    try {
      const saved = localStorage.getItem("email-pane-widths");
      if (saved) return JSON.parse(saved).sidebar ?? 208;
    } catch {}
    return 208;
  });
  const [listWidth, setListWidth] = useState(() => {
    if (typeof window === "undefined") return 384;
    try {
      const saved = localStorage.getItem("email-pane-widths");
      if (saved) return JSON.parse(saved).list ?? 384;
    } catch {}
    return 384;
  });

  // Persist widths to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        "email-pane-widths",
        JSON.stringify({ sidebar: sidebarWidth, list: listWidth })
      );
    } catch {}
  }, [sidebarWidth, listWidth]);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === emails.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(emails.map((e) => e.id)));
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Bulk actions
  const [bulkLoading, setBulkLoading] = useState(false);
  const [jobPickerOpen, setJobPickerOpen] = useState(false);
  const [jobSearch, setJobSearch] = useState("");
  const [jobResults, setJobResults] = useState<{ id: string; job_number: string; property_address: string }[]>([]);
  const jobPickerRef = useRef<HTMLDivElement>(null);

  async function executeBulkAction(action: string, jobId?: string) {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const res = await fetch("/api/email/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), action, jobId }),
      });
      if (!res.ok) throw new Error("Bulk action failed");
      const data = await res.json();
      toast.success(`Updated ${data.updated} email${data.updated !== 1 ? "s" : ""}`);
      clearSelection();
      loadEmails();
      loadCounts();
    } catch {
      toast.error("Bulk action failed");
    }
    setBulkLoading(false);
    setJobPickerOpen(false);
  }

  // Debounced job search for picker
  useEffect(() => {
    if (!jobPickerOpen || jobSearch.length < 1) {
      setJobResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/jobs/search?q=${encodeURIComponent(jobSearch)}&limit=8`);
        const data = await res.json();
        setJobResults(data.jobs || []);
      } catch {
        setJobResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [jobSearch, jobPickerOpen]);

  // Close job picker on outside click
  useEffect(() => {
    if (!jobPickerOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (jobPickerRef.current && !jobPickerRef.current.contains(e.target as Node)) {
        setJobPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [jobPickerOpen]);

  // Clear selection when navigating
  useEffect(() => {
    setSelectedIds(new Set());
  }, [folder, selectedAccountId, searchDebounced, page]);

  // Compose state
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"compose" | "reply" | "forward">("compose");
  const [replyTo, setReplyTo] = useState<{
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    body: string;
    messageId: string;
    jobId: string;
    draftId?: string;
    accountId?: string;
  } | null>(null);

  // Load accounts on mount
  useEffect(() => {
    fetch("/api/email/accounts")
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          const active = data.filter((a: EmailAccount) => a.is_active);
          setAccounts(active);
        }
      })
      .catch(() => {});
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Load emails when folder, account, search, or page changes
  const loadEmails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (folder === "starred") {
        params.set("starred", "true");
      } else {
        params.set("folder", folder);
      }
      if (selectedAccountId) params.set("accountId", selectedAccountId);
      if (searchDebounced) params.set("search", searchDebounced);
      params.set("page", page.toString());

      const res = await fetch(`/api/email/list?${params}`);
      const data: ListResponse = await res.json();
      setEmails(data.emails);
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch {
      toast.error("Failed to load emails");
    }
    setLoading(false);
  }, [folder, selectedAccountId, searchDebounced, page]);

  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  // Load folder counts
  const loadCounts = useCallback(async () => {
    try {
      const params = selectedAccountId
        ? `?accountId=${selectedAccountId}`
        : "";
      const res = await fetch(`/api/email/counts${params}`);
      const data = await res.json();
      setCounts(data);
    } catch {
      // silent
    }
  }, [selectedAccountId]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  // Sync all accounts
  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    const toSync = selectedAccountId
      ? accounts.filter((a) => a.id === selectedAccountId)
      : accounts;

    let totalSynced = 0;
    for (const acc of toSync) {
      try {
        const res = await fetch("/api/email/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: acc.id }),
        });
        const data = await res.json();
        totalSynced += data.total_synced || 0;
      } catch {
        toast.error(`Sync failed for ${acc.label}`);
      }
    }

    toast.success(`Synced ${totalSynced} new email${totalSynced !== 1 ? "s" : ""}`);
    setSyncing(false);
    loadEmails();
    loadCounts();
  }

  // Mark all as read
  async function handleMarkAllRead() {
    try {
      await fetch("/api/email/mark-all-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder,
          accountId: selectedAccountId || undefined,
        }),
      });
      setEmails((prev) => prev.map((e) => ({ ...e, is_read: true })));
      loadCounts();
      toast.success("All marked as read");
    } catch {
      toast.error("Failed to mark all as read");
    }
  }

  // Toggle star
  async function handleStarToggle(id: string, starred: boolean) {
    await fetch(`/api/email/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_starred: starred }),
    });
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, is_starred: starred } : e))
    );
    loadCounts();
  }

  // Mark read/unread
  async function handleReadToggle(id: string, read: boolean) {
    await fetch(`/api/email/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_read: read }),
    });
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, is_read: read } : e))
    );
    loadCounts();
  }

  // Open email (or resume draft)
  function handleSelectEmail(email: Email) {
    if (folder === "drafts") {
      // Resume draft in compose modal
      const toList = (email.to_addresses || []).map((a) => a.email).join(", ");
      const ccList = (email.cc_addresses || []).map((a) => a.email).join(", ");
      const bccList = (email.bcc_addresses || []).map((a) => a.email).join(", ");
      setComposeMode("compose");
      setReplyTo({
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject: email.subject,
        body: email.body_html || email.body_text || "",
        messageId: email.thread_id || "",
        jobId: email.job_id || "",
        draftId: email.id,
        accountId: email.account_id,
      });
      setComposeOpen(true);
      return;
    }
    setSelectedEmailId(email.id);
    if (!email.is_read) {
      handleReadToggle(email.id, true);
    }
  }

  // Build quoted HTML for reply/forward
  function buildQuotedHtml(email: Email): string {
    const date = format(new Date(email.received_at), "MMM d, yyyy 'at' h:mm a");
    const from = email.from_name
      ? `${email.from_name} &lt;${email.from_address}&gt;`
      : email.from_address;
    const originalBody = email.body_html || `<p>${(email.body_text || "").replace(/\n/g, "<br>")}</p>`;
    return `<br><div style="border-left: 2px solid #ccc; padding-left: 12px; margin-left: 0; color: #666;">
      <p style="margin: 0 0 8px; font-size: 12px;">On ${date}, ${from} wrote:</p>
      ${originalBody}
    </div>`;
  }

  // Reply
  function handleReply(email: Email) {
    setComposeMode("reply");
    setReplyTo({
      to: email.from_address,
      cc: "",
      subject: email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`,
      body: buildQuotedHtml(email),
      messageId: email.message_id,
      jobId: email.job_id || "",
      bcc: "",
    });
    setComposeOpen(true);
  }

  // Reply All
  function handleReplyAll(email: Email) {
    setComposeMode("reply");
    // CC = original To + CC minus our own accounts
    const ownEmails = new Set(accounts.map((a) => a.email_address.toLowerCase()));
    const allRecipients = [
      ...(email.to_addresses || []),
      ...(email.cc_addresses || []),
    ].filter((r) => !ownEmails.has(r.email.toLowerCase()) && r.email.toLowerCase() !== email.from_address.toLowerCase());
    const ccList = allRecipients.map((r) => r.email).join(", ");

    setReplyTo({
      to: email.from_address,
      cc: ccList,
      bcc: "",
      subject: email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`,
      body: buildQuotedHtml(email),
      messageId: email.message_id,
      jobId: email.job_id || "",
    });
    setComposeOpen(true);
  }

  // Forward
  function handleForward(email: Email) {
    setComposeMode("forward");
    setReplyTo({
      to: "",
      cc: "",
      bcc: "",
      subject: email.subject.startsWith("Fwd:") ? email.subject : `Fwd: ${email.subject}`,
      body: buildQuotedHtml(email),
      messageId: email.message_id,
      jobId: email.job_id || "",
    });
    setComposeOpen(true);
  }

  // New compose
  function handleCompose() {
    setComposeMode("compose");
    setReplyTo(null);
    setComposeOpen(true);
  }

  function handleFolderChange(key: string) {
    setFolder(key);
    setPage(1);
    setSelectedEmailId(null);
    setSelectedIds(new Set());
  }

  return (
    <div className="h-[calc(100vh-2rem)] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border shrink-0">
        <h1 className="text-lg font-bold text-foreground mr-2">Email</h1>

        {/* Account filter */}
        <div className="relative">
          <select
            value={selectedAccountId}
            onChange={(e) => {
              setSelectedAccountId(e.target.value);
              setPage(1);
            }}
            className="text-sm border border-border rounded-lg pl-3 pr-8 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none"
          >
            <option value="">All Inboxes</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none"
          />
        </div>

        {/* Search */}
        <div className="flex-1 max-w-md relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
          />
          <input
            type="text"
            placeholder="Search emails..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={handleSync}
            disabled={syncing || accounts.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground border border-border rounded-lg hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              className={syncing ? "animate-spin" : ""}
            />
            {syncing ? "Syncing..." : "Sync"}
          </button>
          <button
            onClick={handleCompose}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-[image:var(--gradient-primary)] text-white rounded-lg text-sm font-medium shadow-sm hover:brightness-110 hover:shadow-md transition-all"
          >
            <MailPlus size={14} />
            Compose
          </button>
          <a
            href="/settings/email"
            className="p-1.5 text-muted-foreground/60 hover:text-muted-foreground hover:bg-accent rounded"
            title="Email Settings"
          >
            <Settings size={16} />
          </a>
        </div>
      </div>

      {/* 3-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Column 1: Folder sidebar */}
        <div style={{ width: sidebarWidth }} className="border-r border-border bg-muted/50 shrink-0 flex flex-col">
          <nav className="flex-1 py-2">
            {FOLDERS.map(({ key, label, icon: Icon }) => {
              const isActive = folder === key;
              const unread = counts[key]?.unread || 0;
              const total2 = counts[key]?.total || 0;

              return (
                <button
                  key={key}
                  onClick={() => handleFolderChange(key)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-primary/5"
                  }`}
                >
                  <Icon size={16} />
                  <span className="flex-1 text-left">{label}</span>
                  {key === "starred" && total2 > 0 && (
                    <span className="text-xs text-muted-foreground/60">{total2}</span>
                  )}
                  {key !== "starred" && unread > 0 && (
                    <span className="text-xs font-bold text-primary bg-primary/10 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                      {unread}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <ResizeHandle
          onResize={(delta) => {
            setSidebarWidth((prev: number) => Math.min(300, Math.max(160, prev + delta)));
          }}
        />

        {/* Column 2: Email list */}
        <div
          style={{ width: listWidth }}
          className={`border-r border-border flex flex-col bg-card shrink-0 ${
            selectedEmailId ? "hidden lg:flex" : "flex"
          }`}
        >
          {/* List header / Bulk action bar */}
          <div className="px-4 py-2 border-b border-border/50 text-xs text-muted-foreground/60 flex items-center justify-between">
            {selectedIds.size > 0 ? (
              <>
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === emails.length}
                    onChange={toggleSelectAll}
                    className="rounded border-border accent-primary"
                  />
                  <span className="font-medium text-foreground">
                    {selectedIds.size} selected
                  </span>
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      const allRead = emails
                        .filter((e) => selectedIds.has(e.id))
                        .every((e) => e.is_read);
                      executeBulkAction(allRead ? "mark_unread" : "mark_read");
                    }}
                    disabled={bulkLoading}
                    className="px-2 py-1 rounded hover:bg-accent disabled:opacity-50"
                    title="Toggle read/unread"
                  >
                    <MailCheck size={14} />
                  </button>
                  <button
                    onClick={() => executeBulkAction("archive")}
                    disabled={bulkLoading}
                    className="px-2 py-1 rounded hover:bg-accent disabled:opacity-50"
                    title="Archive"
                  >
                    <Archive size={14} />
                  </button>
                  <button
                    onClick={() => executeBulkAction("trash")}
                    disabled={bulkLoading}
                    className="px-2 py-1 rounded hover:bg-accent disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                  <div className="relative" ref={jobPickerRef}>
                    <button
                      onClick={() => {
                        setJobPickerOpen(!jobPickerOpen);
                        setJobSearch("");
                        setJobResults([]);
                      }}
                      disabled={bulkLoading}
                      className="px-2 py-1 rounded hover:bg-accent disabled:opacity-50"
                      title="Assign to job"
                    >
                      <Briefcase size={14} />
                    </button>
                    {jobPickerOpen && (
                      <div className="absolute right-0 top-full mt-1 w-72 bg-card border border-border rounded-lg shadow-lg z-50 p-2">
                        <input
                          type="text"
                          placeholder="Search jobs..."
                          value={jobSearch}
                          onChange={(e) => setJobSearch(e.target.value)}
                          autoFocus
                          className="w-full px-2 py-1.5 text-sm border border-border rounded mb-1 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        <div className="max-h-48 overflow-y-auto">
                          {jobResults.length === 0 && jobSearch.length > 0 && (
                            <p className="text-xs text-muted-foreground/60 px-2 py-2">No jobs found</p>
                          )}
                          {jobResults.map((job) => (
                            <button
                              key={job.id}
                              onClick={() => executeBulkAction("assign_job", job.id)}
                              className="w-full text-left px-2 py-1.5 text-sm hover:bg-accent rounded flex items-center gap-2"
                            >
                              <span className="font-medium text-primary">{job.job_number}</span>
                              <span className="truncate text-muted-foreground">{job.property_address}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={clearSelection}
                    className="px-2 py-1 rounded hover:bg-accent ml-1"
                    title="Clear selection"
                  >
                    <X size={14} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={emails.length > 0 && selectedIds.size === emails.length}
                    onChange={toggleSelectAll}
                    className="rounded border-border accent-primary"
                  />
                  {total} email{total !== 1 ? "s" : ""}
                  {folder !== "starred" && counts[folder]?.unread
                    ? ` (${counts[folder].unread} unread)`
                    : ""}
                </span>
                <div className="flex items-center gap-2">
                  {counts[folder]?.unread > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="flex items-center gap-1 text-primary hover:underline"
                      title="Mark all as read"
                    >
                      <MailCheck size={12} />
                      Mark all read
                    </button>
                  )}
                  {hasMore && (
                    <button
                      onClick={() => setPage((p) => p + 1)}
                      className="text-primary hover:underline"
                    >
                      Load more
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Email rows */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground/60 text-sm">
                Loading...
              </div>
            ) : emails.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/60">
                <Inbox size={32} className="mb-2 opacity-40" />
                <p className="text-sm">No emails</p>
              </div>
            ) : (
              emails.map((email) => (
                <EmailRow
                  key={email.id}
                  email={email}
                  isSelected={email.id === selectedEmailId}
                  isChecked={selectedIds.has(email.id)}
                  folder={folder}
                  onSelect={() => handleSelectEmail(email)}
                  onStar={() =>
                    handleStarToggle(email.id, !email.is_starred)
                  }
                  onToggleCheck={() => toggleSelect(email.id)}
                />
              ))
            )}

            {/* Pagination */}
            {!loading && total > 50 && (
              <div className="flex items-center justify-center gap-2 py-3 border-t border-border/50">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 text-xs border border-border rounded disabled:opacity-30 hover:bg-accent"
                >
                  Previous
                </button>
                <span className="text-xs text-muted-foreground/60">Page {page}</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasMore}
                  className="px-3 py-1 text-xs border border-border rounded disabled:opacity-30 hover:bg-accent"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>

        <ResizeHandle
          onResize={(delta) => {
            setListWidth((prev: number) => Math.min(600, Math.max(280, prev + delta)));
          }}
        />

        {/* Column 3: Reading pane */}
        <div
          className={`flex-1 bg-muted/50 ${
            selectedEmailId ? "flex" : "hidden lg:flex"
          }`}
        >
          {selectedEmailId ? (
            <EmailReader
              emailId={selectedEmailId}
              onBack={() => setSelectedEmailId(null)}
              onReply={handleReply}
              onReplyAll={handleReplyAll}
              onForward={handleForward}
              onStarToggle={handleStarToggle}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/60">
              <Inbox size={48} className="mb-3 opacity-30" />
              <p className="text-sm">Select an email to read</p>
            </div>
          )}
        </div>
      </div>

      {/* Compose modal */}
      <ComposeEmailModal
        open={composeOpen}
        onOpenChange={setComposeOpen}
        mode={composeMode}
        jobId={replyTo?.jobId || ""}
        draftId={replyTo?.draftId}
        defaultTo={replyTo?.to || ""}
        defaultCc={replyTo?.cc || ""}
        defaultBcc={replyTo?.bcc || ""}
        defaultSubject={replyTo?.subject || ""}
        defaultBody={replyTo?.body || ""}
        defaultAccountId={replyTo?.accountId}
        replyToMessageId={replyTo?.messageId}
        onSent={() => {
          loadEmails();
          loadCounts();
        }}
      />
    </div>
  );
}

function ResizeHandle({
  onResize,
}: {
  onResize: (delta: number) => void;
}) {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    let lastX = e.clientX;
    const parent = (e.target as HTMLElement).closest(".flex");
    if (parent) parent.classList.add("select-none");

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - lastX;
      lastX = moveEvent.clientX;
      onResize(delta);
    };

    const handleMouseUp = () => {
      if (parent) parent.classList.remove("select-none");
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      className="w-1 shrink-0 cursor-col-resize hover:bg-primary/20 transition-colors"
    />
  );
}

// Email row component
function EmailRow({
  email,
  isSelected,
  isChecked,
  folder,
  onSelect,
  onStar,
  onToggleCheck,
}: {
  email: Email;
  isSelected: boolean;
  isChecked: boolean;
  folder: string;
  onSelect: () => void;
  onStar: () => void;
  onToggleCheck: () => void;
}) {
  // Show recipient for sent/drafts, sender for everything else
  const isSentView = folder === "sent" || folder === "drafts";
  const displayName = isSentView
    ? email.to_addresses?.[0]?.name || email.to_addresses?.[0]?.email || "Unknown"
    : email.from_name || email.from_address;

  return (
    <div
      onClick={onSelect}
      className={`flex items-start gap-3 px-4 py-3 cursor-pointer border-b border-border/50 transition-colors ${
        isSelected
          ? "bg-primary/5 border-l-2 border-l-primary"
          : email.is_read
          ? "hover:bg-primary/5"
          : "bg-primary/5 hover:bg-primary/10"
      }`}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={isChecked}
        onChange={(e) => {
          e.stopPropagation();
          onToggleCheck();
        }}
        onClick={(e) => e.stopPropagation()}
        className="mt-1 shrink-0 rounded border-border accent-primary"
      />

      {/* Star */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onStar();
        }}
        className="mt-0.5 shrink-0"
      >
        <Star
          size={14}
          className={
            email.is_starred
              ? "fill-yellow-400 text-yellow-400"
              : "text-gray-300 hover:text-gray-400"
          }
        />
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm truncate ${
              email.is_read ? "text-muted-foreground" : "font-semibold text-foreground"
            }`}
          >
            {displayName}
          </span>
          <span className="text-xs text-muted-foreground/60 shrink-0 ml-auto">
            {formatEmailDate(email.received_at)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span
            className={`text-sm truncate ${
              email.is_read ? "text-muted-foreground/60" : "text-foreground"
            }`}
          >
            {email.subject || "(no subject)"}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground/40 truncate flex-1">
            {email.snippet}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {email.has_attachments && (
              <Paperclip size={12} className="text-muted-foreground/40" />
            )}
            {email.job && (
              <span className="flex items-center gap-0.5 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                <Briefcase size={10} />
                {email.job.job_number}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
