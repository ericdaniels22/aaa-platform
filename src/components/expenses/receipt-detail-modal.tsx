"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, Trash2, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import type { Expense, ExpenseCategory, Vendor } from "@/lib/types";
import { paymentMethodLabel, formatAmount } from "@/lib/expenses-constants";
import LogExpenseModal from "./log-expense-modal";

type ExpenseWithRelations = Expense & {
  vendor?: Vendor | null;
  category?: ExpenseCategory | null;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  expense: ExpenseWithRelations | null;
  onChanged: () => void;
}

export default function ReceiptDetailModal({ open, onOpenChange, expense, onChanged }: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!open || !expense) { setImageUrl(null); return; }
    let cancelled = false;
    fetch(`/api/expenses/${expense.id}/receipt-url`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (!cancelled && j?.url) setImageUrl(j.url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, expense]);

  async function handleDelete() {
    if (!expense) return;
    setDeleting(true);
    const res = await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) {
      toast.success("Expense deleted");
      onChanged();
      setConfirmDelete(false);
      onOpenChange(false);
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Failed to delete");
    }
  }

  if (!expense) return null;

  return (
    <>
      <Dialog open={open && !editOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Receipt</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4">
            {imageUrl ? (
              <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="block">
                <img src={imageUrl} alt="Receipt" className="w-full max-h-[60vh] object-contain rounded-lg bg-accent/30" />
                <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1"><ExternalLink size={12} /> Open original</div>
              </a>
            ) : expense.receipt_path ? (
              <div className="h-48 rounded-lg bg-accent animate-pulse" />
            ) : (
              <div className="h-48 rounded-lg bg-accent/30 flex items-center justify-center text-muted-foreground text-sm">
                No receipt image
              </div>
            )}

            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Vendor</dt>
                <dd className="font-medium text-foreground">{expense.vendor?.name ?? expense.vendor_name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Amount</dt>
                <dd className="font-medium text-foreground">{formatAmount(expense.amount)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Date</dt>
                <dd className="font-medium text-foreground">{format(new Date(expense.expense_date), "MMM d, yyyy")}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Category</dt>
                <dd>
                  {expense.category ? (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                      style={{ backgroundColor: expense.category.bg_color, color: expense.category.text_color }}>
                      {expense.category.display_label}
                    </span>
                  ) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Payment Method</dt>
                <dd className="font-medium text-foreground">{paymentMethodLabel(expense.payment_method)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Submitted By</dt>
                <dd className="font-medium text-foreground">{expense.submitter_name}</dd>
              </div>
              {expense.description && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Description</dt>
                  <dd className="text-foreground">{expense.description}</dd>
                </div>
              )}
              <div className="col-span-2 text-xs text-muted-foreground">
                Logged {format(new Date(expense.created_at), "MMM d, yyyy h:mm a")}
              </div>
            </dl>
          </div>

          <DialogFooter className="border-t border-border pt-3">
            {confirmDelete ? (
              <>
                <span className="text-sm text-destructive mr-auto">Delete this expense? This cannot be undone.</span>
                <button onClick={() => setConfirmDelete(false)}
                  className="px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent">Cancel</button>
                <button onClick={handleDelete} disabled={deleting}
                  className="px-3 py-2 rounded-lg text-sm font-medium bg-destructive text-white hover:bg-destructive/90 inline-flex items-center gap-2">
                  {deleting && <Loader2 size={14} className="animate-spin" />}
                  Delete
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setConfirmDelete(true)}
                  className="mr-auto px-3 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/10 inline-flex items-center gap-1.5">
                  <Trash2 size={14} /> Delete
                </button>
                <button onClick={() => setEditOpen(true)}
                  className="px-3 py-2 rounded-lg text-sm text-foreground border border-border hover:bg-accent inline-flex items-center gap-1.5">
                  <Pencil size={14} /> Edit
                </button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LogExpenseModal
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) { onChanged(); /* close the detail modal too so the caller can re-open with fresh data */ onOpenChange(false); }
        }}
        jobId={expense.job_id}
        existing={expense}
        onSaved={onChanged}
      />
    </>
  );
}
