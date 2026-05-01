"use client";

import { useState } from "react";
import { AlertOctagon } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/format";
import type { Contact, Job } from "@/lib/types";
import type { EstimateWithContents } from "@/lib/types";
import { HeaderBar } from "./header-bar";
import { MetadataBar } from "./metadata-bar";
import { CustomerBlock } from "./customer-block";
import { StatementEditor } from "./statement-editor";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BuilderState {
  estimate: EstimateWithContents;
  saveStatus: "idle" | "saving" | "saved" | "error";
  lastSavedAt: Date | null;
}

export interface EstimateBuilderProps {
  estimate: EstimateWithContents;
  job: Job & { contact: Contact | null };
  defaultValidDays: number;
  defaultOpeningStatement: string;
  defaultClosingStatement: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot label — small label shown inside each placeholder slot
// ─────────────────────────────────────────────────────────────────────────────

function SlotLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2 font-medium">
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Placeholder slot wrapper — dashed border box used for all 7 scaffold slots
// ─────────────────────────────────────────────────────────────────────────────

function Slot({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-dashed border-border bg-card p-4 ${className}`}
    >
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EstimateBuilder — central state container (client component)
// ─────────────────────────────────────────────────────────────────────────────

export function EstimateBuilder({
  estimate,
  job,
  defaultValidDays,
  defaultOpeningStatement,
  defaultClosingStatement,
}: EstimateBuilderProps) {
  const [state, setState] = useState<BuilderState>({
    estimate,
    saveStatus: "idle",
    lastSavedAt: null,
  });

  // Separate transient flag — not part of BuilderState because it's purely UI.
  const [isVoiding, setIsVoiding] = useState(false);

  // ── Callbacks ──────────────────────────────────────────────────────────────

  function onTitleChange(title: string) {
    setState((prev) => ({ ...prev, estimate: { ...prev.estimate, title } }));
    // Task 28 auto-save will pick this up.
  }

  function onIssuedDateChange(d: string | null) {
    setState((prev) => {
      const next = { ...prev, estimate: { ...prev.estimate, issued_date: d } };
      // Auto-default valid_until if issued date is set and valid_until is currently null.
      // Use UTC components to avoid timezone off-by-one on the day-add.
      if (d && prev.estimate.valid_until === null) {
        const [y, m, day] = d.split("-").map(Number);
        const issued = new Date(Date.UTC(y, m - 1, day));
        issued.setUTCDate(issued.getUTCDate() + defaultValidDays);
        const yyyy = issued.getUTCFullYear();
        const mm = String(issued.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(issued.getUTCDate()).padStart(2, "0");
        next.estimate.valid_until = `${yyyy}-${mm}-${dd}`;
      }
      return next;
    });
    // Task 28 auto-save will pick this up.
  }

  function onValidUntilChange(d: string | null) {
    setState((prev) => ({ ...prev, estimate: { ...prev.estimate, valid_until: d } }));
    // Task 28 auto-save will pick this up.
  }

  function onOpeningStatementChange(next: string | null) {
    setState((prev) => ({ ...prev, estimate: { ...prev.estimate, opening_statement: next } }));
    // Task 28 auto-save will pick this up.
  }

  function onClosingStatementChange(next: string | null) {
    setState((prev) => ({ ...prev, estimate: { ...prev.estimate, closing_statement: next } }));
    // Task 28 auto-save will pick this up.
  }

  async function onVoid(reason: string) {
    if (isVoiding) return;
    setIsVoiding(true);
    try {
      const url = `/api/estimates/${state.estimate.id}?reason=${encodeURIComponent(reason)}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Failed to void estimate");
        return;
      }
      // Optimistic update — voided_at uses client clock; server's value is canonical
      // and will be reconciled on the next read. Display-only divergence today.
      setState((prev) => ({
        ...prev,
        estimate: {
          ...prev.estimate,
          status: "voided",
          void_reason: reason,
          voided_at: new Date().toISOString(),
        },
      }));
      toast.success("Estimate voided");
    } finally {
      setIsVoiding(false);
    }
  }

  const isVoided = state.estimate.status === "voided";

  // Count sections and items for the sections-list placeholder.
  const sections = state.estimate.sections;
  const totalItems = sections.reduce(
    (acc, sec) =>
      acc +
      sec.items.length +
      sec.subsections.reduce((a, sub) => a + sub.items.length, 0),
    0,
  );

  return (
    <div className="relative min-h-screen bg-background">
      {/* Voided banner */}
      {isVoided && (
        <div className="w-full bg-destructive/10 border-b border-destructive/20 px-4 py-2 flex items-center gap-2 text-sm text-destructive font-medium">
          <AlertOctagon size={16} />
          This estimate has been voided
          {state.estimate.void_reason && (
            <span className="font-normal text-destructive/80">
              — {state.estimate.void_reason}
            </span>
          )}
        </div>
      )}

      {/* Main content column
          TODO: refine padding-right in Task 27 to avoid TotalsPanel overlap on small screens */}
      <main className="max-w-4xl mx-auto px-4 py-6 pb-24 space-y-4">

        {/* ── SLOT 1: HeaderBar ────────────────────────────────────────────── */}
        <HeaderBar
          estimate={state.estimate}
          onTitleChange={onTitleChange}
          onVoid={onVoid}
          onSend={() => {}}
          onPdfExport={() => {}}
          isSaving={state.saveStatus === "saving"}
          isVoiding={isVoiding}
        />

        {/* ── SLOT 2: MetadataBar ──────────────────────────────────────────── */}
        <MetadataBar
          estimate={state.estimate}
          onIssuedDateChange={onIssuedDateChange}
          onValidUntilChange={onValidUntilChange}
        />

        {/* ── SLOT 3: CustomerBlock ────────────────────────────────────────── */}
        <CustomerBlock job={job} />

        {/* ── SLOT 4: Opening statement ────────────────────────────────────── */}
        <StatementEditor
          label="Opening statement"
          value={state.estimate.opening_statement}
          onChange={onOpeningStatementChange}
          defaultText={defaultOpeningStatement}
          readOnly={isVoided}
        />

        {/* ── SLOT 5: Sections list ────────────────────────────────────────── */}
        <Slot>
          <SlotLabel>Task 24 · Sections List (SectionCard per section)</SlotLabel>
          {sections.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">
              No sections yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {sections.map((sec) => (
                <li key={sec.id} className="text-sm">
                  <div className="font-medium text-foreground">{sec.title}</div>
                  <div className="text-muted-foreground text-xs">
                    {sec.items.length} direct item
                    {sec.items.length !== 1 ? "s" : ""}
                    {sec.subsections.length > 0 && (
                      <>
                        {" · "}
                        {sec.subsections.length} subsection
                        {sec.subsections.length !== 1 ? "s" : ""}
                        {" ("}
                        {sec.subsections.reduce(
                          (a, sub) => a + sub.items.length,
                          0,
                        )}{" "}
                        items
                        {")"}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
            {sections.length} section{sections.length !== 1 ? "s" : ""} ·{" "}
            {totalItems} total item{totalItems !== 1 ? "s" : ""}
          </div>
        </Slot>

        {/* ── SLOT 6: Closing statement ────────────────────────────────────── */}
        <StatementEditor
          label="Closing statement"
          value={state.estimate.closing_statement}
          onChange={onClosingStatementChange}
          defaultText={defaultClosingStatement}
          readOnly={isVoided}
        />
      </main>

      {/* ── SLOT 7: TotalsPanel (sticky bottom-right) ───────────────────────
          TODO: refine position + overflow handling in Task 27 */}
      <div
        className="fixed bottom-4 right-4 z-10 w-64 rounded-lg border border-dashed border-border bg-card p-4 shadow-lg"
        aria-label="Totals panel placeholder"
      >
        <SlotLabel>Task 27 · TotalsPanel</SlotLabel>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="text-foreground font-mono">
              {formatCurrency(state.estimate.subtotal)}
            </span>
          </div>
          {state.estimate.markup_amount !== 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Markup</span>
              <span className="text-foreground font-mono">
                {formatCurrency(state.estimate.markup_amount)}
              </span>
            </div>
          )}
          {state.estimate.discount_amount !== 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discount</span>
              <span className="text-foreground font-mono">
                −{formatCurrency(state.estimate.discount_amount)}
              </span>
            </div>
          )}
          {state.estimate.tax_amount !== 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax</span>
              <span className="text-foreground font-mono">
                {formatCurrency(state.estimate.tax_amount)}
              </span>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-1 mt-1 font-semibold">
            <span className="text-foreground">Total</span>
            <span className="text-foreground font-mono">
              {formatCurrency(state.estimate.total)}
            </span>
          </div>
        </div>
        {/* Task 27: add SaveIndicator (saveStatus, lastSavedAt) here */}
        <div className="mt-2 text-xs text-muted-foreground">
          Save indicator — Task 28
        </div>
      </div>
    </div>
  );
}
