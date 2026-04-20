"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { QbSyncLogRow } from "@/lib/qb/types";

const PAGE_SIZE = 100;

export default function SyncLogClient() {
  const [rows, setRows] = useState<QbSyncLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<string>("");
  const [entityType, setEntityType] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Refetch on offset/filter change. Using an inline async function with
  // a cancellation flag keeps the initial setState out of the synchronous
  // effect body (satisfies react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (status) params.set("status", status);
    if (entityType) params.set("entity_type", entityType);
    fetch(`/api/qb/sync-log?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setRows(data?.rows ?? []);
        setTotal(data?.total ?? 0);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [offset, status, entityType]);

  const pageStart = offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="p-6 space-y-4">
      <Link
        href="/accounting?tab=quickbooks"
        className="text-sm text-primary hover:underline inline-flex items-center gap-1"
      >
        <ArrowLeft size={14} /> Back to QuickBooks sync
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Full sync log</h1>
          <p className="text-sm text-muted-foreground">
            Every QuickBooks sync attempt, newest first within each status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={entityType}
            onChange={(e) => {
              setOffset(0);
              setEntityType(e.target.value);
            }}
            className="border border-border rounded-lg px-3 py-1.5 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">All entities</option>
            <option value="customer">Customers</option>
            <option value="sub_customer">Sub-customers</option>
            <option value="invoice">Invoices</option>
            <option value="payment">Payments</option>
          </select>
          <select
            value={status}
            onChange={(e) => {
              setOffset(0);
              setStatus(e.target.value);
            }}
            className="border border-border rounded-lg px-3 py-1.5 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">All statuses</option>
            <option value="failed">Failed only</option>
            <option value="synced">Synced only</option>
            <option value="skipped_dry_run">Dry-run only</option>
            <option value="queued">Pending only</option>
          </select>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-xs uppercase tracking-wide text-muted-foreground">
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Entity</th>
              <th className="text-left px-4 py-2 font-medium">Action</th>
              <th className="text-left px-4 py-2 font-medium">QB id</th>
              <th className="text-left px-4 py-2 font-medium">Error</th>
              <th className="text-left px-4 py-2 font-medium">Retries</th>
              <th className="text-left px-4 py-2 font-medium">Created</th>
              <th className="text-left px-4 py-2 font-medium">Synced</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="text-center py-12 text-muted-foreground">
                  <Loader2 className="animate-spin inline mr-2" size={16} /> Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-12 text-muted-foreground">
                  No entries.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-border ${r.status === "failed" ? "bg-red-500/5" : ""}`}
                >
                  <td className="px-4 py-2 capitalize">{r.status.replace("_", " ")}</td>
                  <td className="px-4 py-2">{r.entity_type}</td>
                  <td className="px-4 py-2">{r.action}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                    {r.qb_entity_id ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-red-600">
                    {r.error_message ?? ""}
                  </td>
                  <td className="px-4 py-2">{r.retry_count}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {r.synced_at ? new Date(r.synced_at).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total > 0
            ? `Showing ${pageStart}–${pageEnd} of ${total}`
            : "0 entries"}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0 || loading}
            className="px-3 py-1 rounded border border-border hover:bg-accent disabled:opacity-40 flex items-center gap-1"
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total || loading}
            className="px-3 py-1 rounded border border-border hover:bg-accent disabled:opacity-40 flex items-center gap-1"
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
