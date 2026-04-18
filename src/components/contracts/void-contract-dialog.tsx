"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ContractListItem } from "@/lib/contracts/types";

interface Props {
  contract: ContractListItem | null;
  onClose: () => void;
  onVoided: () => void | Promise<void>;
}

export default function VoidContractDialog({ contract, onClose, onVoided }: Props) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (contract) setReason("");
  }, [contract]);

  async function confirm() {
    if (!contract) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Void failed");
      toast.success("Contract voided");
      await onVoided();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Void failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!contract} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-300">
            <Ban size={16} />
            Void contract
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          This will invalidate the signing link for{" "}
          <span className="text-foreground font-medium">{contract?.title}</span>. The contract record
          will be kept for audit purposes.
        </p>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Reason (optional)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why is this contract being voided?"
            className="mt-1 w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-red-500/20"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors disabled:opacity-60"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
            Void contract
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
