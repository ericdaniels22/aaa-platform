"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Send, FileDown, Ban } from "lucide-react";
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
import type { Estimate, EstimateStatus } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Status badge color map
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_BADGE_CLASSES: Record<EstimateStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  converted: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  voided: "bg-destructive text-destructive-foreground",
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface HeaderBarProps {
  estimate: Estimate;
  onTitleChange: (title: string) => void;
  onVoid: (reason: string) => void;
  onSend: () => void;
  onPdfExport: () => void;
  isSaving: boolean;
  isVoiding: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// VoidDialog — confirm dialog with required reason field
// ─────────────────────────────────────────────────────────────────────────────

function VoidDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  // Reset reason when dialog opens
  useEffect(() => {
    if (open) {
      setReason("");
      // Focus is handled by autoFocus on the textarea
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
          <DialogTitle>Void this estimate?</DialogTitle>
          <DialogDescription>
            Voiding is irreversible. The estimate will be marked as voided and
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
            Void Estimate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HeaderBar
// ─────────────────────────────────────────────────────────────────────────────

export function HeaderBar({
  estimate,
  onTitleChange,
  onVoid,
  onSend,
  onPdfExport,
  isSaving,
  isVoiding,
}: HeaderBarProps) {
  const isVoided = estimate.status === "voided";

  // ── Title inline-edit state ──────────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(estimate.title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync edit value if estimate.title changes from outside
  useEffect(() => {
    if (!isEditing) {
      setEditValue(estimate.title);
    }
  }, [estimate.title, isEditing]);

  // Auto-focus the input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  function startEdit() {
    if (isVoided) return;
    setEditValue(estimate.title);
    setIsEditing(true);
  }

  function saveEdit() {
    const trimmed = editValue.trim();
    if (!trimmed) {
      // Empty — revert without calling parent
      setEditValue(estimate.title);
    } else if (trimmed !== estimate.title) {
      onTitleChange(trimmed);
    }
    setIsEditing(false);
  }

  function cancelEdit() {
    setEditValue(estimate.title);
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

  // ── Status badge label ───────────────────────────────────────────────────
  const statusLabel =
    estimate.status.charAt(0).toUpperCase() + estimate.status.slice(1);

  return (
    <>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
        {/* ── Left: estimate number + status badge ──────────────────────── */}
        <div className="flex items-center gap-2 shrink-0">
          <FileText size={16} className="text-muted-foreground" />
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground">
            {estimate.estimate_number}
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[estimate.status]}`}
          >
            {statusLabel}
          </span>
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
              {estimate.title}
            </button>
          )}
        </div>

        {/* ── Right: action buttons + save indicator ────────────────────── */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Saving indicator — full SaveIndicator lands in Task 27 */}
          {isSaving && (
            <span className="text-xs text-muted-foreground">Saving…</span>
          )}

          {/* Void button */}
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

          {/* Send button — disabled in 67a */}
          <Button
            variant="outline"
            size="sm"
            disabled
            title="Available in 67b"
            onClick={onSend}
          >
            <Send size={14} />
            Send
          </Button>

          {/* Export PDF button — disabled in 67a */}
          <Button
            variant="outline"
            size="sm"
            disabled
            title="Available in 67c"
            onClick={onPdfExport}
          >
            <FileDown size={14} />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Void confirmation dialog */}
      <VoidDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        onConfirm={onVoid}
      />
    </>
  );
}
