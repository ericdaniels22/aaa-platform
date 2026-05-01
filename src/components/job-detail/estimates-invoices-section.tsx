"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Eye, Pencil, Ban, Plus, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import type { Estimate, EstimateStatus } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Status badge color map (all 6 statuses)
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_BADGE_CLASSES: Record<EstimateStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  converted: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  voided: "bg-destructive text-destructive-foreground",
};

const STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  rejected: "Rejected",
  converted: "Converted",
  voided: "Voided",
};

// ─────────────────────────────────────────────────────────────────────────────
// Inline void confirm dialog
// ─────────────────────────────────────────────────────────────────────────────

function VoidConfirmDialog({
  open,
  onOpenChange,
  estimateNumber,
  onConfirm,
  isVoiding,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimateNumber: string;
  onConfirm: (reason: string) => void;
  isVoiding: boolean;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const canConfirm = reason.trim().length > 0 && !isVoiding;
  const remaining = 500 - reason.length;

  function handleConfirm() {
    if (!canConfirm) return;
    onConfirm(reason.trim());
  }

  return (
    <Dialog open={open} onOpenChange={isVoiding ? undefined : onOpenChange}>
      <DialogContent showCloseButton={!isVoiding}>
        <DialogHeader>
          <DialogTitle>Void estimate {estimateNumber}?</DialogTitle>
          <DialogDescription>
            Voiding is irreversible. The estimate will be marked as voided and
            no further edits will be allowed. Please provide a reason.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Input
            autoFocus
            placeholder="Reason for voiding…"
            value={reason}
            maxLength={500}
            onChange={(e) => {
              if (e.target.value.length <= 500) setReason(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canConfirm) handleConfirm();
              if (e.key === "Escape" && !isVoiding) onOpenChange(false);
            }}
            disabled={isVoiding}
          />
          <p
            className={`text-xs text-right ${
              remaining <= 50 ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {remaining} characters remaining
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isVoiding}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {isVoiding ? "Voiding…" : "Void Estimate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EstimatesInvoicesSection
// ─────────────────────────────────────────────────────────────────────────────

interface EstimatesInvoicesSectionProps {
  jobId: string;
}

export function EstimatesInvoicesSection({ jobId }: EstimatesInvoicesSectionProps) {
  const { hasPermission, loading: authLoading } = useAuth();

  const [estimates, setEstimates] = useState<Estimate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<Estimate | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);

  async function fetchEstimates() {
    try {
      const res = await fetch(`/api/estimates?job_id=${jobId}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Failed to load estimates");
        return;
      }
      const data = (await res.json()) as { estimates: Estimate[] };
      setEstimates(data.estimates);
      setError(null);
    } catch {
      setError("Failed to load estimates");
    }
  }

  useEffect(() => {
    fetchEstimates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function handleVoidConfirm(reason: string) {
    if (!voidTarget || isVoiding) return;
    setIsVoiding(true);
    try {
      const res = await fetch(
        `/api/estimates/${voidTarget.id}?reason=${encodeURIComponent(reason)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Failed to void estimate");
        return;
      }
      toast.success(`Estimate ${voidTarget.estimate_number} voided`);
      setVoidTarget(null);
      await fetchEstimates();
    } catch {
      toast.error("Failed to void estimate");
    } finally {
      setIsVoiding(false);
    }
  }

  const canView = !authLoading && hasPermission("view_estimates");
  const canEdit = !authLoading && hasPermission("edit_estimates");
  const canCreate = !authLoading && hasPermission("create_estimates");

  return (
    <div className="space-y-6 mb-6">
      {/* ── Estimates card ─────────────────────────────────────────────────── */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-foreground">Estimates</h3>
          {authLoading ? null : canCreate ? (
            <Link href={`/jobs/${jobId}/estimates/new`}>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plus size={14} />
                New Estimate
              </Button>
            </Link>
          ) : null}
        </div>

        {/* Loading state */}
        {estimates === null && !error && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {/* Error state */}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Empty state */}
        {estimates !== null && !error && estimates.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No estimates yet — create one to get started.
          </p>
        )}

        {/* Table */}
        {estimates !== null && !error && estimates.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">#</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="w-32 text-right">Total</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-36">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {estimates.map((est) => (
                <TableRow key={est.id}>
                  {/* Estimate number — monospace */}
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">
                      {est.estimate_number}
                    </span>
                  </TableCell>

                  {/* Title */}
                  <TableCell className="max-w-xs truncate">
                    {est.title}
                  </TableCell>

                  {/* Total */}
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(est.total)}
                  </TableCell>

                  {/* Status badge */}
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[est.status]}`}
                    >
                      {STATUS_LABELS[est.status]}
                    </span>
                  </TableCell>

                  {/* Actions */}
                  <TableCell>
                    {authLoading ? (
                      <span className="text-xs text-muted-foreground">Loading…</span>
                    ) : (
                      <div className="flex items-center gap-1">
                        {canView && (
                          <Link href={`/estimates/${est.id}`}>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 gap-1 text-xs"
                              title="View estimate"
                            >
                              <Eye size={12} />
                              View
                            </Button>
                          </Link>
                        )}
                        {canEdit && est.status !== "voided" && est.status !== "converted" && (
                          <Link href={`/estimates/${est.id}/edit`}>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 gap-1 text-xs"
                              title="Edit estimate"
                            >
                              <Pencil size={12} />
                              Edit
                            </Button>
                          </Link>
                        )}
                        {canEdit && est.status !== "voided" && est.status !== "converted" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 gap-1 text-xs text-destructive hover:text-destructive"
                            title="Void estimate"
                            onClick={() => setVoidTarget(est)}
                          >
                            <Ban size={12} />
                            Void
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* ── Invoices placeholder card ───────────────────────────────────────── */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-foreground">Invoices</h3>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lock size={14} />
          <span>Available in build 67b</span>
        </div>
      </div>

      {/* ── Void confirm dialog ─────────────────────────────────────────────── */}
      <VoidConfirmDialog
        open={voidTarget !== null}
        onOpenChange={(open) => {
          if (!open) setVoidTarget(null);
        }}
        estimateNumber={voidTarget?.estimate_number ?? ""}
        onConfirm={handleVoidConfirm}
        isVoiding={isVoiding}
      />
    </div>
  );
}
