"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type PayerFilter = "all" | "insurance" | "homeowner";
type Bucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

type Row = {
  invoiceId: string;
  jobId: string;
  jobNumber: string | null;
  jobAddress: string | null;
  invoiceNumber: string | null;
  payerType: string | null;
  outstanding: number;
  ageDays: number;
  bucket: Bucket;
  lastContact: string | null;
};

const BUCKET_LABEL: Record<Bucket, string> = {
  current: "Current",
  "1-30": "1-30d",
  "31-60": "31-60d",
  "61-90": "61-90d",
  "90+": "90+d",
};
const BUCKET_COLOR: Record<Bucket, string> = {
  current: "#a3a3a3",
  "1-30": "#a3a3a3",
  "31-60": "#FAC775",
  "61-90": "#F0B060",
  "90+": "#F09595",
};

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function ArAgingTab() {
  const router = useRouter();
  const [payer, setPayer] = useState<PayerFilter>("all");
  const [data, setData] = useState<{ buckets: Record<Bucket, { total: number; count: number }>; rows: Row[] } | null>(null);

  useEffect(() => {
    fetch(`/api/accounting/ar-aging?payer=${payer}`)
      .then((r) => r.json())
      .then(setData);
  }, [payer]);

  const nudge = (row: Row) => {
    const subject = `Invoice ${row.invoiceNumber} - Payment follow-up`;
    const body =
      row.payerType === "insurance"
        ? `Hi,\n\nFollowing up on invoice ${row.invoiceNumber} for job ${row.jobNumber}. Current outstanding balance is ${fmt(row.outstanding)}. Please let me know if you need anything from our side to process payment.\n\nThank you.`
        : `Hi,\n\nJust a quick reminder about invoice ${row.invoiceNumber} (${fmt(row.outstanding)} outstanding). Please let me know if you have any questions.\n\nThank you.`;
    const params = new URLSearchParams({
      compose: "1",
      subject,
      body,
      jobId: row.jobId,
    });
    router.push(`/email?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      {/* 5 bucket cards */}
      <div className="grid grid-cols-5 gap-3">
        {(["current", "1-30", "31-60", "61-90", "90+"] as Bucket[]).map((b) => {
          const bk = data?.buckets?.[b] ?? { total: 0, count: 0 };
          return (
            <div
              key={b}
              className="rounded-lg p-4"
              style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${BUCKET_COLOR[b]}40` }}
            >
              <div className="text-xs uppercase" style={{ color: BUCKET_COLOR[b] }}>
                {BUCKET_LABEL[b]}
              </div>
              <div className="mt-1 text-xl font-semibold">{fmt(bk.total)}</div>
              <div className="text-xs text-muted-foreground">{bk.count} invoices</div>
            </div>
          );
        })}
      </div>

      {/* Payer filter pills */}
      <div className="inline-flex rounded-md border border-border overflow-hidden">
        {(["all", "insurance", "homeowner"] as PayerFilter[]).map((p) => (
          <button
            key={p}
            onClick={() => setPayer(p)}
            className={`px-3 py-1.5 text-sm capitalize ${payer === p ? "text-white" : "text-muted-foreground"}`}
            style={payer === p ? { background: "#0F6E56" } : undefined}
          >
            {p === "all" ? "All payers" : p}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Job / Invoice</th>
              <th className="text-left px-3 py-2">Payer</th>
              <th className="text-right px-3 py-2">Outstanding</th>
              <th className="text-left px-3 py-2">Age</th>
              <th className="text-left px-3 py-2">Last contact</th>
              <th className="text-right px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => (
              <tr key={r.invoiceId} className="border-t border-border">
                <td className="px-3 py-2">
                  <div>{r.jobAddress ?? r.jobNumber}</div>
                  <div className="text-xs text-muted-foreground">
                    #{r.invoiceNumber} • {r.jobNumber}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {r.payerType ? <PayerBadge value={r.payerType} /> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="text-right px-3 py-2">{fmt(r.outstanding)}</td>
                <td className="px-3 py-2">
                  <span
                    className="inline-flex rounded px-2 py-0.5 text-xs"
                    style={{ color: BUCKET_COLOR[r.bucket], background: `${BUCKET_COLOR[r.bucket]}20` }}
                  >
                    {r.ageDays}d
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.lastContact ? new Date(r.lastContact).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                </td>
                <td className="text-right px-3 py-2">
                  <button onClick={() => nudge(r)} className="text-sm rounded px-2 py-1 hover:bg-muted">
                    Nudge ↗
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PayerBadge({ value }: { value: string }) {
  const m: Record<string, { bg: string; color: string; label: string }> = {
    insurance: { bg: "rgba(139, 92, 246, 0.15)", color: "#C4B5FD", label: "Insurance" },
    homeowner: { bg: "rgba(59, 130, 246, 0.15)", color: "#93C5FD", label: "Homeowner" },
    mixed: { bg: "rgba(250, 199, 117, 0.15)", color: "#FAC775", label: "Mixed" },
  };
  const s = m[value] ?? { bg: "rgba(255,255,255,0.05)", color: "#a3a3a3", label: value };
  return (
    <span className="inline-flex rounded px-2 py-0.5 text-xs" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}
