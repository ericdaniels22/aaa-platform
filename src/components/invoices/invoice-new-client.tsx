"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import LineItemsEditor, { blankLine, toInputs, type EditableLineItem } from "./line-items-editor";
import InvoiceTotalsPanel from "./invoice-totals-panel";

interface JobOption {
  id: string;
  job_number: string;
  property_address: string | null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function InvoiceNewClient({ prefillJobId }: { prefillJobId: string | null }) {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [jobId, setJobId] = useState<string>(prefillJobId ?? "");
  const [items, setItems] = useState<EditableLineItem[]>([blankLine()]);
  const [taxRate, setTaxRate] = useState(0);
  const [issuedDate, setIssuedDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => addDays(new Date().toISOString(), 30));
  const [poNumber, setPoNumber] = useState("");
  const [memo, setMemo] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const loadJobs = useCallback(async () => {
    const res = await fetch("/api/jobs/search?limit=50");
    if (!res.ok) return;
    const data = (await res.json()) as { jobs?: JobOption[] };
    setJobs(data.jobs ?? []);
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const inputs = useMemo(() => toInputs(items), [items]);

  async function save(action: "draft" | "send" | "mark-sent") {
    if (!jobId) {
      toast.error("Select a job");
      return;
    }
    if (items.length === 0 || items.every((li) => !li.description)) {
      toast.error("Add at least one line item");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        issuedDate: new Date(issuedDate).toISOString(),
        dueDate: new Date(dueDate).toISOString(),
        taxRate,
        poNumber: poNumber || null,
        memo: memo || null,
        notes: notes || null,
        lineItems: inputs,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Create failed");
      return;
    }
    const invoice = (await res.json()) as { id: string };
    if (action === "draft") {
      router.push(`/invoices/${invoice.id}`);
    } else {
      router.push(`/invoices/${invoice.id}?action=${action}`);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <h1 className="text-2xl font-semibold">New invoice</h1>

      <section className="bg-card border border-border rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="text-sm">
          Job
          <select
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
          >
            <option value="">Select a job…</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.job_number} — {j.property_address ?? "(no address)"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          PO number
          <input
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
          />
        </label>
        <label className="text-sm">
          Issued
          <input
            type="date"
            value={issuedDate}
            onChange={(e) => setIssuedDate(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
          />
        </label>
        <label className="text-sm">
          Due
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
          />
        </label>
        <label className="text-sm md:col-span-2">
          Memo (shows on PDF)
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
          />
        </label>
        <label className="text-sm md:col-span-2">
          Internal notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full border border-border rounded-lg px-3 py-2 bg-background"
          />
        </label>
      </section>

      <LineItemsEditor items={items} onChange={setItems} />

      <InvoiceTotalsPanel items={inputs} taxRate={taxRate} onTaxRateChange={setTaxRate} />

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => save("draft")}
          disabled={saving}
          className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : "Save draft"}
        </button>
        <button
          onClick={() => save("mark-sent")}
          disabled={saving}
          className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          Save &amp; mark sent
        </button>
        <button
          onClick={() => save("send")}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-[#0F6E56] text-white text-sm font-medium hover:brightness-110 disabled:opacity-50"
        >
          Save &amp; send
        </button>
      </div>
    </div>
  );
}
