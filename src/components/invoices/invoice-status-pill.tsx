"use client";

import type { InvoiceStatus } from "@/lib/invoices/types";

const MAP: Record<InvoiceStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  sent: { label: "Sent", className: "bg-blue-500/10 text-blue-700" },
  partial: { label: "Partial", className: "bg-amber-500/10 text-amber-700" },
  paid: { label: "Paid", className: "bg-green-500/10 text-green-700" },
  voided: { label: "Voided", className: "bg-red-500/10 text-red-700 line-through" },
};

export function InvoiceStatusPill({ status }: { status: InvoiceStatus }) {
  const v = MAP[status];
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${v.className}`}>
      {v.label}
    </span>
  );
}
