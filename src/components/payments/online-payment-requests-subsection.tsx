"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { PaymentRequestModal } from "./payment-request-modal";

interface PaymentRequestRow {
  id: string;
  title: string;
  amount: number;
  status: string;
  request_type: string;
  created_at: string;
  link_expires_at: string | null;
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-foreground" },
  sent: { label: "Sent", className: "bg-blue-500/20 text-blue-700 dark:text-blue-300" },
  viewed: { label: "Viewed", className: "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300" },
  paid: { label: "Paid", className: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" },
  failed: { label: "Failed", className: "bg-red-500/20 text-red-700 dark:text-red-300" },
  refunded: { label: "Refunded", className: "bg-slate-500/20 text-slate-700 dark:text-slate-300" },
  partially_refunded: {
    label: "Partial refund",
    className: "bg-slate-500/20 text-slate-700 dark:text-slate-300",
  },
  expired: { label: "Expired", className: "bg-muted text-muted-foreground" },
  voided: { label: "Voided", className: "bg-muted text-muted-foreground line-through" },
};

export function OnlinePaymentRequestsSubsection({
  jobId,
  stripeConnected,
}: {
  jobId: string;
  stripeConnected: boolean;
}) {
  const [rows, setRows] = useState<PaymentRequestRow[]>([]);
  const [depositOpen, setDepositOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const res = await fetch(`/api/payment-requests?job_id=${encodeURIComponent(jobId)}`);
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const { payment_requests } = (await res.json()) as { payment_requests: PaymentRequestRow[] };
    setRows(payment_requests ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const onVoid = async (id: string) => {
    const res = await fetch(`/api/payment-requests/${id}/void`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "User voided from billing section" }),
    });
    if (!res.ok) {
      toast.error("Failed to void");
      return;
    }
    toast.success("Voided");
    await refresh();
  };

  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-medium">Online Payment Requests</h3>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading&hellip;</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No online payment requests yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const s = STATUS_STYLES[r.status] ?? STATUS_STYLES.draft;
            return (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded border bg-card p-3"
              >
                <div>
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground">
                    ${Number(r.amount).toFixed(2)} &middot; {r.request_type}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={s.className}>{s.label}</Badge>
                  {r.status === "draft" && (
                    <Button variant="outline" size="sm" onClick={() => onVoid(r.id)}>
                      Void
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {stripeConnected && (
        <Button variant="secondary" onClick={() => setDepositOpen(true)}>
          + Request Deposit
        </Button>
      )}

      <PaymentRequestModal
        open={depositOpen}
        onOpenChange={setDepositOpen}
        jobId={jobId}
        defaultTitle=""
        defaultRequestType="deposit"
        onCreated={() => void refresh()}
      />
    </div>
  );
}
