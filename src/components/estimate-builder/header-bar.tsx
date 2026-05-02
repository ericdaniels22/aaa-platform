"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Ban, ArrowLeft, CheckCircle, XCircle, Receipt, CreditCard, Send } from "lucide-react";
import { toast } from "sonner";
import { SaveIndicator } from "./save-indicator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Estimate, Invoice, TemplateWithContents } from "@/lib/types";
import { getStatusBadgeClasses, formatStatusLabel } from "@/lib/estimate-status";

// ─────────────────────────────────────────────────────────────────────────────
// Discriminated-union props — lets TypeScript narrow `entity` from `mode`
// ─────────────────────────────────────────────────────────────────────────────

type CommonProps = {
  onTitleChange: (title: string) => void;
  onVoid: (reason: string) => void;
  saveStatus: "idle" | "saving" | "saved" | "error";
  lastSavedAt: Date | null;
  isVoiding: boolean;
  // New optional callbacks for non-estimate modes
  onSaveTemplate?: () => void;
  onSendPaymentRequest?: () => void;
  onConvertClick?: () => void;
};

export type HeaderBarProps =
  | ({ mode: "estimate"; entity: Estimate } & CommonProps)
  | ({ mode: "invoice";  entity: Invoice }  & CommonProps)
  | ({ mode?: "template"; entity: TemplateWithContents } & CommonProps);

// ─────────────────────────────────────────────────────────────────────────────
// VoidDialog — confirm dialog with required reason field
// ─────────────────────────────────────────────────────────────────────────────

function VoidDialog({
  open,
  onOpenChange,
  onConfirm,
  entityLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  entityLabel: string;
}) {
  const [reason, setReason] = useState("");

  // Reset reason when dialog opens
  useEffect(() => {
    if (open) {
      setReason("");
    }
  }, [open]);

  const canConfirm = reason.trim().length > 0;
  const remaining = 500 - reason.length;

  function handleConfirm() {
    if (!canConfirm) return;
    onConfirm(reason.trim());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={true}>
        <DialogHeader>
          <DialogTitle>Void this {entityLabel}?</DialogTitle>
          <DialogDescription>
            Voiding is irreversible. The {entityLabel} will be marked as voided and
            no further edits will be allowed. Please provide a reason.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Textarea
            autoFocus
            rows={3}
            placeholder="Reason for voiding…"
            value={reason}
            onChange={(e) => {
              if (e.target.value.length <= 500) setReason(e.target.value);
            }}
            maxLength={500}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onOpenChange(false);
              }
            }}
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
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            Void {entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HeaderBar
// ─────────────────────────────────────────────────────────────────────────────

export function HeaderBar(props: HeaderBarProps) {
  const {
    onTitleChange,
    onVoid,
    saveStatus,
    lastSavedAt,
    isVoiding,
    onSaveTemplate,
    onSendPaymentRequest,
    onConvertClick,
  } = props;

  const resolvedMode = props.mode ?? "template";
  const entity = props.entity;

  const router = useRouter();

  // Derive entity title: EstimateTemplate uses `name`, everything else uses `title`
  const entityTitle =
    resolvedMode === "template"
      ? (entity as TemplateWithContents).name
      : (entity as Estimate | Invoice).title;

  // Derive whether entity is voided (templates have no status)
  const isVoided =
    resolvedMode !== "template" &&
    (entity as Estimate | Invoice).status === "voided";

  // ── Title inline-edit state ──────────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(entityTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync edit value if title changes from outside
  useEffect(() => {
    if (!isEditing) {
      setEditValue(entityTitle);
    }
  }, [entityTitle, isEditing]);

  // Auto-focus the input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  function startEdit() {
    if (isVoided) return;
    setEditValue(entityTitle);
    setIsEditing(true);
  }

  function saveEdit() {
    const trimmed = editValue.trim();
    if (!trimmed) {
      setEditValue(entityTitle);
    } else if (trimmed !== entityTitle) {
      onTitleChange(trimmed);
    }
    setIsEditing(false);
  }

  function cancelEdit() {
    setEditValue(entityTitle);
    setIsEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }

  // ── Void dialog state ────────────────────────────────────────────────────
  const [voidOpen, setVoidOpen] = useState(false);

  // ── Status transition ────────────────────────────────────────────────────
  async function transitionStatus(next: string) {
    const base = resolvedMode === "invoice" ? "invoices" : "estimates";
    const res = await fetch(`/api/${base}/${entity.id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next, updated_at_snapshot: entity.updated_at }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast.error("Modified by another user — refresh to see changes.");
        return;
      }
      toast.error((err as { error?: string }).error || `Failed to ${next}`);
      return;
    }
    router.refresh();
  }

  // ── Back link ─────────────────────────────────────────────────────────────
  const backHref =
    resolvedMode === "template"
      ? "/settings/estimate-templates"
      : `/jobs/${(entity as Estimate | Invoice).job_id}`;

  // ── Entity number label (estimate_number / invoice_number / none) ─────────
  const entityNumberLabel =
    resolvedMode === "estimate"
      ? (entity as Estimate).estimate_number
      : resolvedMode === "invoice"
      ? (entity as Invoice).invoice_number
      : null;

  // ── Status badge ──────────────────────────────────────────────────────────
  const statusBadgeClasses =
    resolvedMode !== "template"
      ? getStatusBadgeClasses(
          resolvedMode,
          (entity as Estimate | Invoice).status
        )
      : null;
  const statusLabel =
    resolvedMode !== "template"
      ? formatStatusLabel((entity as Estimate | Invoice).status)
      : null;

  // ── Void dialog label ─────────────────────────────────────────────────────
  const entityLabel =
    resolvedMode === "invoice"
      ? "invoice"
      : resolvedMode === "template"
      ? "template"
      : "estimate";

  // ── Action buttons ────────────────────────────────────────────────────────
  function renderActions() {
    if (resolvedMode === "template") {
      return (
        <Button
          variant="default"
          size="sm"
          onClick={onSaveTemplate}
          disabled={!onSaveTemplate}
        >
          Save Template
        </Button>
      );
    }

    if (resolvedMode === "invoice") {
      const inv = entity as Invoice;
      return (
        <>
          {inv.status === "draft" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => transitionStatus("sent")}
            >
              <Send size={14} />
              Mark as Sent
            </Button>
          )}
          {(inv.status === "sent" || inv.status === "partial") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => transitionStatus("paid")}
            >
              <CheckCircle size={14} />
              Mark as Paid
            </Button>
          )}
          {inv.status !== "voided" && inv.status !== "paid" && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSendPaymentRequest}
              disabled={!onSendPaymentRequest}
            >
              <CreditCard size={14} />
              Send Payment Request
            </Button>
          )}
          {inv.status !== "voided" && inv.status !== "paid" && (
            <Button
              variant="destructive"
              size="sm"
              disabled={isVoiding}
              title={isVoiding ? "Voiding…" : undefined}
              onClick={() => setVoidOpen(true)}
            >
              <Ban size={14} />
              Void
            </Button>
          )}
        </>
      );
    }

    // mode === "estimate"
    const est = entity as Estimate;
    return (
      <>
        {est.status === "draft" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => transitionStatus("sent")}
          >
            <Send size={14} />
            Mark as Sent
          </Button>
        )}
        {est.status === "sent" && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => transitionStatus("approved")}
            >
              <CheckCircle size={14} />
              Mark Approved
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => transitionStatus("rejected")}
            >
              <XCircle size={14} />
              Mark Rejected
            </Button>
          </>
        )}
        {est.status === "approved" && (
          <Button
            variant="outline"
            size="sm"
            onClick={onConvertClick}
            disabled={!onConvertClick}
            title={!onConvertClick ? "Convert flow lands in Task 38" : undefined}
          >
            <Receipt size={14} />
            Convert to Invoice
          </Button>
        )}
        {est.status !== "voided" && est.status !== "converted" && (
          <Button
            variant="destructive"
            size="sm"
            disabled={isVoided || isVoiding}
            title={isVoided ? "Already voided" : isVoiding ? "Voiding…" : undefined}
            onClick={() => setVoidOpen(true)}
          >
            <Ban size={14} />
            Void
          </Button>
        )}
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
        {/* ── Left: back link + entity number + status badge ──────────── */}
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 px-2 py-1 -ml-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title={resolvedMode === "template" ? "Back to templates" : "Back to job"}
            aria-label={resolvedMode === "template" ? "Back to templates" : "Back to job"}
          >
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Back</span>
          </Link>
          <FileText size={16} className="text-muted-foreground" />
          {entityNumberLabel && (
            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground">
              {entityNumberLabel}
            </span>
          )}
          {statusBadgeClasses && statusLabel && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClasses}`}
            >
              {statusLabel}
            </span>
          )}
        </div>

        {/* ── Middle: editable title ────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <Input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={handleKeyDown}
              className="h-7 text-sm font-semibold"
            />
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className={`w-full text-left text-sm font-semibold truncate px-1 rounded hover:bg-muted/60 transition-colors ${
                isVoided
                  ? "line-through text-muted-foreground cursor-default"
                  : "text-foreground cursor-text"
              }`}
              title={isVoided ? undefined : "Click to edit title"}
            >
              {entityTitle}
            </button>
          )}
        </div>

        {/* ── Right: action buttons + save indicator ────────────────────── */}
        <div className="flex items-center gap-2 shrink-0">
          <SaveIndicator status={saveStatus} lastSavedAt={lastSavedAt} mode={resolvedMode} />
          {renderActions()}
        </div>
      </div>

      {/* Void confirmation dialog */}
      <VoidDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        onConfirm={onVoid}
        entityLabel={entityLabel}
      />
    </>
  );
}
