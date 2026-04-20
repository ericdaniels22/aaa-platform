"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, RefreshCw, Settings as SettingsIcon, X } from "lucide-react";
import { toast } from "sonner";
import type { QbSyncLogRow } from "@/lib/qb/types";

// Focused modal for resolving a single failed row. Error-type dispatch
// matches the spec:
//   * Class not mapped  → link to mapping UI
//   * API rate limit    → show retry countdown + manual retry
//   * Other             → show raw error + manual retry
export default function QbFixModal({
  row,
  onClose,
  onRetried,
}: {
  row: QbSyncLogRow;
  onClose: () => void;
  onRetried: () => void;
}) {
  const [retrying, setRetrying] = useState(false);

  const isRateLimit =
    row.error_code === "ThrottleExceeded" ||
    /rate limit|too many/i.test(row.error_message ?? "");
  const isClassNotMapped =
    /class.*(not|un)mapped|ClassRef/i.test(row.error_message ?? "");

  async function handleRetry() {
    setRetrying(true);
    const res = await fetch(`/api/qb/sync-log/${row.id}/retry`, { method: "POST" });
    setRetrying(false);
    if (res.ok) {
      toast.success("Re-queued. The next sync will pick it up.");
      onRetried();
      onClose();
    } else {
      toast.error("Failed to re-queue");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-card rounded-xl border border-border p-6 max-w-lg w-full">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="text-red-500" size={20} />
            Fix sync error
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{entityLabel(row.entity_type)}</span>
            {" · "}
            <span>Retry {row.retry_count} of 5</span>
          </div>

          {isClassNotMapped ? (
            <div className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/30 text-sm">
              <p className="font-medium text-amber-700">QuickBooks Class is not mapped</p>
              <p className="text-amber-600/90 mt-1">
                Open the mapping configuration and pick a Class for this damage type. The sync will retry automatically after.
              </p>
              <Link
                href="/settings/accounting/setup?tab=mappings"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 hover:underline"
              >
                <SettingsIcon size={14} /> Open mapping config
              </Link>
            </div>
          ) : isRateLimit ? (
            <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/30 text-sm">
              <p className="font-medium text-blue-700">QuickBooks rate limit hit</p>
              <p className="text-blue-600/90 mt-1">
                The sync will auto-retry shortly
                {row.next_retry_at ? ` (scheduled ${formatAbs(row.next_retry_at)})` : ""}.
                You can also trigger a manual retry below.
              </p>
            </div>
          ) : (
            <div className="p-3 bg-red-500/5 rounded-lg border border-red-500/20 text-sm">
              <p className="font-medium text-red-700">Error</p>
              <pre className="mt-1 text-xs text-red-600/80 whitespace-pre-wrap break-words">
                {row.error_message ?? "Unknown error"}
              </pre>
              {row.error_code && (
                <p className="mt-1 text-xs text-red-600/60">Code: {row.error_code}</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent"
            >
              Close
            </button>
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="px-4 py-2 rounded-lg bg-[var(--brand-primary,#0F6E56)] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
            >
              {retrying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Retry now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function entityLabel(type: QbSyncLogRow["entity_type"]): string {
  if (type === "customer") return "Customer";
  if (type === "sub_customer") return "Sub-customer";
  if (type === "invoice") return "Invoice";
  if (type === "payment") return "Payment";
  return type;
}

function formatAbs(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}
