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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export interface RefundModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentRequestId: string;
  paymentRequestTitle: string;
  remainingRefundable: number;
  onRefunded?: () => void;
}

export function RefundModal({
  open,
  onOpenChange,
  paymentRequestId,
  paymentRequestTitle,
  remainingRefundable,
  onRefunded,
}: RefundModalProps) {
  const [refundType, setRefundType] = useState<"full" | "partial">("full");
  const [amount, setAmount] = useState(remainingRefundable.toFixed(2));
  const [reason, setReason] = useState("");
  const [includeReason, setIncludeReason] = useState(false);
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Reset state when the modal opens or the refundable amount changes.
  useEffect(() => {
    if (open) {
      setRefundType("full");
      setAmount(remainingRefundable.toFixed(2));
      setReason("");
      setIncludeReason(false);
      setNotifyCustomer(true);
      setSubmitting(false);
    }
  }, [open, remainingRefundable]);

  const onSubmit = async () => {
    const amt = refundType === "full" ? remainingRefundable : Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter a positive amount.");
      return;
    }
    if (amt - remainingRefundable > 0.01) {
      toast.error(
        `Amount exceeds refundable ($${remainingRefundable.toFixed(2)}).`,
      );
      return;
    }
    setSubmitting(true);
    const res = await fetch(
      `/api/payment-requests/${paymentRequestId}/refund`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          reason: reason || null,
          include_reason_in_customer_email: includeReason,
          notify_customer: notifyCustomer,
        }),
      },
    );
    setSubmitting(false);
    if (!res.ok) {
      const { error } = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      toast.error(error ?? "Refund failed");
      return;
    }
    toast.success("Refund initiated. Stripe will confirm in a few seconds.");
    onOpenChange(false);
    onRefunded?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund — {paymentRequestTitle}</DialogTitle>
          <DialogDescription>
            Refundable: ${remainingRefundable.toFixed(2)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="radio"
                id="rf-full"
                name="refund-type"
                value="full"
                checked={refundType === "full"}
                onChange={() => setRefundType("full")}
                className="size-4 accent-primary"
              />
              <Label htmlFor="rf-full" className="cursor-pointer">
                Full refund
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="radio"
                id="rf-partial"
                name="refund-type"
                value="partial"
                checked={refundType === "partial"}
                onChange={() => setRefundType("partial")}
                className="size-4 accent-primary"
              />
              <Label htmlFor="rf-partial" className="cursor-pointer">
                Partial refund
              </Label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rf-amount">Amount</Label>
            <Input
              id="rf-amount"
              type="number"
              step="0.01"
              min="0.01"
              max={remainingRefundable}
              disabled={refundType === "full"}
              value={
                refundType === "full"
                  ? remainingRefundable.toFixed(2)
                  : amount
              }
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rf-reason">Reason</Label>
            <Textarea
              id="rf-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Internal note. Shown to customer only if you check the box below."
              rows={3}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="rf-include-reason"
              checked={includeReason}
              onChange={(e) => setIncludeReason(e.target.checked)}
              className="size-4 accent-primary"
            />
            <Label htmlFor="rf-include-reason" className="text-sm cursor-pointer">
              Include reason in customer email
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="rf-notify"
              checked={notifyCustomer}
              onChange={(e) => setNotifyCustomer(e.target.checked)}
              className="size-4 accent-primary"
            />
            <Label htmlFor="rf-notify" className="text-sm cursor-pointer">
              Notify customer by email when Stripe confirms the refund
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void onSubmit()}
            disabled={submitting}
          >
            {submitting ? "Submitting…" : "Confirm refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
