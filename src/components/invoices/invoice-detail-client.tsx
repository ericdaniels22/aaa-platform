"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronLeft,
  Download,
  Edit2,
  Loader2,
  Save,
  Send,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import ComposeEmailModal from "@/components/compose-email";
import RecordPaymentModal from "@/components/payments/record-payment-modal";
import { PaymentRequestModal } from "@/components/payments/payment-request-modal";
import { InvoiceStatusPill } from "./invoice-status-pill";
import LineItemsEditor, {
  blankLine,
  toInputs,
  type EditableLineItem,
} from "./line-items-editor";
import InvoiceTotalsPanel from "./invoice-totals-panel";
import type {
  InvoiceLineItemInput,
  InvoiceLineItemRow,
  InvoiceStatus,
  InvoiceWithItems,
} from "@/lib/invoices/types";

interface JobSummary {
  id: string;
  job_number: string;
  property_address: string | null;
  damage_type: string | null;
  contact_id: string;
  contacts: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
}

interface InvoiceDetailResponse extends InvoiceWithItems {
  job: JobSummary | null;
}

interface InvoiceEmailSettingsLite {
  subject_template: string;
  body_template: string;
}

interface AttachmentRef {
  filename: string;
  content_type: string;
  file_size: number;
  storage_path: string;
}

function toEditable(rows: InvoiceLineItemRow[]): EditableLineItem[] {
  return rows
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => ({
      key: r.id,
      description: r.description,
      quantity: Number(r.quantity),
      unit_price: Number(r.unit_price),
      xactimate_code: r.xactimate_code,
    }));
}

function resolveMergeFields(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? "");
}

export default function InvoiceDetailClient({
  invoiceId,
  autoAction,
  stripeConnected,
}: {
  invoiceId: string;
  autoAction: string | null;
  stripeConnected?: boolean;
}) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceWithItems | null>(null);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [emailSettings, setEmailSettings] = useState<InvoiceEmailSettingsLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState<EditableLineItem[]>([blankLine()]);
  const [taxRate, setTaxRate] = useState(0);
  const [poNumber, setPoNumber] = useState("");
  const [memo, setMemo] = useState("");
  const [notes, setNotes] = useState("");
  const [issuedDate, setIssuedDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendAttachments, setSendAttachments] = useState<AttachmentRef[]>([]);
  const [preparingSend, setPreparingSend] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [payRequestOpen, setPayRequestOpen] = useState(false);
  const [paidAmount, setPaidAmount] = useState(0);
  const [autoActionHandled, setAutoActionHandled] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/invoices/${invoiceId}`);
    if (!res.ok) {
      toast.error("Failed to load invoice");
      setLoading(false);
      return;
    }
    const data = (await res.json()) as InvoiceDetailResponse;
    const { job: joinedJob, ...inv } = data;
    setInvoice(inv);
    setJob(joinedJob);
    setItems(toEditable(inv.line_items));
    setTaxRate(Number(inv.tax_rate));
    setPoNumber(inv.po_number ?? "");
    setMemo(inv.memo ?? "");
    setNotes(inv.notes ?? "");
    setIssuedDate(inv.issued_date?.slice(0, 10) ?? "");
    setDueDate(inv.due_date?.slice(0, 10) ?? "");

    const esRes = await fetch("/api/settings/invoice-email");
    if (esRes.ok) setEmailSettings((await esRes.json()) as InvoiceEmailSettingsLite);

    const pmtRes = await fetch(`/api/payments?invoiceId=${inv.id}`);
    if (pmtRes.ok) {
      const pmtData = (await pmtRes.json()) as { rows: { amount: number; status: string }[] };
      const paid = pmtData.rows
        .filter((p) => p.status === "received")
        .reduce((acc, p) => acc + Number(p.amount), 0);
      setPaidAmount(paid);
    }

    setLoading(false);
  }, [invoiceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleOpenSend = useCallback(async () => {
    if (!invoice) return;
    setPreparingSend(true);
    const res = await fetch(`/api/invoices/${invoice.id}/pdf?mode=attachment`);
    setPreparingSend(false);
    if (!res.ok) {
      toast.error("Failed to generate invoice PDF");
      return;
    }
    const data = (await res.json()) as AttachmentRef;
    setSendAttachments([data]);
    setSendModalOpen(true);
  }, [invoice]);

  const handleMarkSent = useCallback(async () => {
    if (!invoice) return;
    if (
      !window.confirm(
        "Mark this invoice as sent? This will create the invoice in QuickBooks. Use this option if you delivered the invoice outside Nookleus.",
      )
    )
      return;
    setSaving(true);
    const res = await fetch(`/api/invoices/${invoice.id}/mark-sent`, { method: "POST" });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Action failed");
      return;
    }
    toast.success("Invoice marked as sent");
    router.replace(`/invoices/${invoice.id}`);
    await refresh();
  }, [invoice, refresh, router]);

  useEffect(() => {
    if (autoActionHandled || !invoice) return;
    if (invoice.status !== "draft") return;
    if (autoAction === "send") {
      setAutoActionHandled(true);
      void handleOpenSend();
    } else if (autoAction === "mark-sent") {
      setAutoActionHandled(true);
      void handleMarkSent();
    }
  }, [autoAction, autoActionHandled, invoice, handleOpenSend, handleMarkSent]);

  const inputs = useMemo<InvoiceLineItemInput[]>(() => toInputs(items), [items]);
  const readOnlyLineItems = !!invoice && invoice.status !== "draft" && !editing;
  const isVoided = invoice?.status === "voided";
  const isPostSent =
    !!invoice && invoice.status !== "draft" && invoice.status !== "voided";
  const balance = invoice ? Math.max(0, Number(invoice.total_amount) - paidAmount) : 0;

  async function saveCosmeticEdits() {
    if (!invoice) return;
    setSaving(true);
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        poNumber: poNumber || null,
        memo: memo || null,
        notes: notes || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Save failed");
      return;
    }
    toast.success("Invoice updated");
    await refresh();
  }

  async function saveLineItemEdits() {
    if (!invoice) return;
    const confirm =
      invoice.status !== "draft"
        ? window.confirm(
            "This invoice has been sent to the customer and synced to QuickBooks. Editing will update both. Continue?",
          )
        : true;
    if (!confirm) return;

    setSaving(true);
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        issuedDate: issuedDate ? new Date(issuedDate).toISOString() : undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        taxRate,
        poNumber: poNumber || null,
        memo: memo || null,
        notes: notes || null,
        lineItems: inputs,
        confirmLineItemEdit: invoice.status !== "draft",
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Save failed");
      return;
    }
    toast.success("Invoice updated");
    setEditing(false);
    await refresh();
  }

  async function handleAfterSend() {
    if (!invoice) return;
    const res = await fetch(`/api/invoices/${invoice.id}/send`, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Failed to flip invoice to sent");
      return;
    }
    toast.success("Invoice sent");
    router.replace(`/invoices/${invoice.id}`);
    await refresh();
  }

  async function handleVoid() {
    if (!invoice) return;
    if (
      !window.confirm(
        "Void this invoice? The invoice will be preserved for audit but marked as voided in both the platform and QuickBooks.",
      )
    )
      return;
    setSaving(true);
    const res = await fetch(`/api/invoices/${invoice.id}/void`, { method: "POST" });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Void failed");
      return;
    }
    toast.success("Invoice voided");
    await refresh();
  }

  async function handleDeleteDraft() {
    if (!invoice) return;
    if (!window.confirm("Delete this draft? This cannot be undone.")) return;
    setSaving(true);
    const res = await fetch(`/api/invoices/${invoice.id}`, { method: "DELETE" });
    setSaving(false);
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success("Draft deleted");
    router.push("/invoices");
  }

  if (loading || !invoice) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <Loader2 className="animate-spin mx-auto mb-2" size={22} /> Loading…
      </div>
    );
  }

  const customerName =
    [job?.contacts?.first_name, job?.contacts?.last_name].filter(Boolean).join(" ") ||
    "Customer";
  const ctx: Record<string, string> = {
    invoice_number: invoice.invoice_number,
    invoice_total: `$${Number(invoice.total_amount).toFixed(2)}`,
    due_date: invoice.due_date
      ? new Date(invoice.due_date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "",
    job_address: job?.property_address ?? "",
    customer_name: customerName,
    customer_first_name: job?.contacts?.first_name ?? customerName.split(" ")[0],
    company_name: "",
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <Link
        href="/invoices"
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        <ChevronLeft size={14} /> All invoices
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1
              className={`text-2xl font-semibold ${
                isVoided ? "line-through text-muted-foreground" : ""
              }`}
            >
              {invoice.invoice_number}
            </h1>
            <InvoiceStatusPill status={invoice.status as InvoiceStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            {customerName}
            {job?.property_address ? ` · ${job.property_address}` : ""}
            {job?.job_number ? ` · Job ${job.job_number}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {invoice.status === "draft" && (
            <>
              <button
                onClick={handleDeleteDraft}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50"
              >
                Delete
              </button>
              <button
                onClick={handleMarkSent}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Mark as sent
              </button>
              <button
                onClick={handleOpenSend}
                disabled={saving || preparingSend}
                className="px-3 py-1.5 rounded-lg bg-[#0F6E56] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-1.5"
              >
                {preparingSend ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                Send invoice
              </button>
            </>
          )}
          {isPostSent && (
            <>
              <a
                href={`/api/invoices/${invoice.id}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-accent flex items-center gap-1.5"
              >
                <Download size={14} /> PDF
              </a>
              <button
                onClick={() => setPaymentModalOpen(true)}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Record payment
              </button>
              {stripeConnected && (
                <button
                  onClick={() => setPayRequestOpen(true)}
                  disabled={balance <= 0}
                  title={balance <= 0 ? "Invoice is paid in full" : undefined}
                  className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50"
                >
                  Request Online Payment
                </button>
              )}
              <button
                onClick={handleVoid}
                disabled={saving}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50 flex items-center gap-1.5"
              >
                <XCircle size={14} /> Void
              </button>
            </>
          )}
          {isVoided && (
            <a
              href={`/api/invoices/${invoice.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-accent flex items-center gap-1.5"
            >
              <Download size={14} /> PDF
            </a>
          )}
        </div>
      </div>

      <section className="bg-card border border-border rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="text-sm">
          Issued
          <input
            type="date"
            disabled={readOnlyLineItems}
            value={issuedDate}
            onChange={(e) => setIssuedDate(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background disabled:opacity-70"
          />
        </label>
        <label className="text-sm">
          Due
          <input
            type="date"
            disabled={readOnlyLineItems}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background disabled:opacity-70"
          />
        </label>
        <label className="text-sm">
          PO number
          <input
            disabled={isVoided}
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background disabled:opacity-70"
          />
        </label>
        <label className="text-sm md:col-span-2">
          Memo
          <input
            disabled={isVoided}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background disabled:opacity-70"
          />
        </label>
        <label className="text-sm md:col-span-2">
          Internal notes
          <textarea
            disabled={isVoided}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background disabled:opacity-70"
          />
        </label>
      </section>

      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Line items</h2>
        {isPostSent && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            <Edit2 size={14} /> Edit line items (requires confirmation)
          </button>
        )}
      </div>

      <LineItemsEditor items={items} onChange={setItems} readOnly={readOnlyLineItems} />

      <InvoiceTotalsPanel
        items={inputs}
        taxRate={taxRate}
        onTaxRateChange={setTaxRate}
        readOnly={readOnlyLineItems}
      />

      <div className="flex items-center justify-end gap-2">
        {isPostSent && !editing && !isVoided && (
          <button
            onClick={saveCosmeticEdits}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save cosmetic edits
          </button>
        )}
        {(invoice.status === "draft" || editing) && !isVoided && (
          <button
            onClick={saveLineItemEdits}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-[#0F6E56] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save changes
          </button>
        )}
      </div>

      {isVoided && (
        <div className="flex items-center gap-2 p-3 bg-red-500/5 rounded-lg border border-red-500/20 text-sm text-red-700">
          <AlertTriangle size={16} />
          This invoice has been voided. Voided invoices are read-only and preserved for audit.
        </div>
      )}

      {emailSettings && (
        <ComposeEmailModal
          open={sendModalOpen}
          onOpenChange={setSendModalOpen}
          jobId={invoice.job_id}
          defaultTo={job?.contacts?.email ?? ""}
          defaultSubject={resolveMergeFields(emailSettings.subject_template, ctx)}
          defaultBody={resolveMergeFields(emailSettings.body_template, ctx)}
          defaultAttachments={sendAttachments}
          onSent={handleAfterSend}
        />
      )}

      <RecordPaymentModal
        open={paymentModalOpen}
        onOpenChange={setPaymentModalOpen}
        invoiceId={invoice.id}
        jobId={invoice.job_id}
        onRecorded={refresh}
      />

      <PaymentRequestModal
        open={payRequestOpen}
        onOpenChange={setPayRequestOpen}
        jobId={invoice.job_id}
        invoiceId={invoice.id}
        defaultTitle={`Invoice ${invoice.invoice_number ?? invoice.id.slice(0, 8)}`}
        defaultAmount={balance}
        defaultRequestType="invoice"
      />
    </div>
  );
}
