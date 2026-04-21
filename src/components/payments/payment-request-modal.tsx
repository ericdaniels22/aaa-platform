"use client";

import { useEffect, useState } from "react";
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
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState<string | null>(null);
  const [recipientLoaded, setRecipientLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Prefill the recipient email from the job's linked contact each time the
  // modal opens. User can edit the field to override before submitting.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRecipientLoaded(false);
    fetch(`/api/jobs/${jobId}/contact-email`)
      .then((r) => (r.ok ? r.json() : { email: null, name: null }))
      .then((d: { email: string | null; name: string | null }) => {
        if (cancelled) return;
        setRecipientEmail(d.email ?? "");
        setRecipientName(d.name ?? null);
        setRecipientLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setRecipientLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, jobId]);

  const onSubmit = async () => {
    if (!title.trim() || typeof amount !== "number" || amount <= 0) {
      toast.error("Title and positive amount are required");
      return;
    }
    if (expiryDays < 1 || expiryDays > 30) {
      toast.error("Expiry must be 1\u201330 days");
      return;
    }
    const trimmedEmail = recipientEmail.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error("A valid recipient email is required");
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
        payer_email: trimmedEmail,
        payer_name: recipientName,
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
    toast.success("Payment request created \u2014 click Send to email the customer");
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
            Creates a secure Stripe Checkout link. Click Send on the row to email
            it to the recipient.
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
            <Label htmlFor="pr_recipient">Recipient email</Label>
            <Input
              id="pr_recipient"
              type="email"
              value={recipientEmail}
              placeholder={
                recipientLoaded
                  ? "customer@example.com"
                  : "Loading customer email\u2026"
              }
              onChange={(e) => setRecipientEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Pre-filled from the job&apos;s homeowner contact. Edit to send to a
              different address.
            </p>
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
