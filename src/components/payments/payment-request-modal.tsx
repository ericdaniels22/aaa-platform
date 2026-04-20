"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export interface PaymentRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  invoiceId?: string;
  defaultTitle?: string;
  defaultAmount?: number;
  defaultRequestType?: "invoice" | "deposit" | "retainer" | "partial";
  defaultExpiryDays?: number;
  onCreated?: (paymentRequest: { id: string; job_id: string; status: string }) => void;
}

export function PaymentRequestModal({
  open,
  onOpenChange,
  jobId,
  invoiceId,
  defaultTitle = "",
  defaultAmount,
  defaultRequestType = invoiceId ? "invoice" : "deposit",
  defaultExpiryDays = 14,
  onCreated,
}: PaymentRequestModalProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [amount, setAmount] = useState<number | "">(defaultAmount ?? "");
  const [expiryDays, setExpiryDays] = useState(defaultExpiryDays);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!title.trim() || typeof amount !== "number" || amount <= 0) {
      toast.error("Title and positive amount are required");
      return;
    }
    if (expiryDays < 1 || expiryDays > 30) {
      toast.error("Expiry must be 1\u201330 days");
      return;
    }
    setSubmitting(true);
    const effectiveType =
      invoiceId && typeof defaultAmount === "number" && amount < defaultAmount
        ? "partial"
        : defaultRequestType;
    const res = await fetch("/api/payment-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        invoice_id: invoiceId ?? null,
        request_type: effectiveType,
        title: title.trim(),
        amount,
        link_expiry_days: expiryDays,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const { error } = (await res.json()) as { error?: string };
      toast.error(error ?? "Failed to create payment request");
      return;
    }
    const { payment_request } = (await res.json()) as {
      payment_request: { id: string; job_id: string; status: string };
    };
    onCreated?.(payment_request);
    toast.success("Payment request created \u2014 send it from the Billing section");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {invoiceId ? "Request online payment" : "Request deposit"}
          </DialogTitle>
          <DialogDescription>
            Creates a secure Stripe Checkout link. You can send it from the Billing
            section after Build 17b ships.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pr_title">Title</Label>
            <Input
              id="pr_title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Deposit for July re-roof"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pr_amount">Amount (USD)</Label>
            <Input
              id="pr_amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => {
                const v = e.target.value;
                setAmount(v === "" ? "" : Number(v));
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pr_expiry">Link expiry (days)</Label>
            <Input
              id="pr_expiry"
              type="number"
              min="1"
              max="30"
              value={expiryDays}
              onChange={(e) => setExpiryDays(Number(e.target.value) || 14)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting ? "Creating\u2026" : "Create Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
