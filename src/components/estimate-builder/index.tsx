"use client";

import { useState } from "react";
import { FileText, AlertOctagon } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { Contact, Job } from "@/lib/types";
import type { EstimateWithContents } from "@/lib/types";

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

export function EstimateBuilder({ estimate, job }: EstimateBuilderProps) {
  const [state] = useState<BuilderState>({
    estimate,
    saveStatus: "idle",
    lastSavedAt: null,
  });

  const isVoided = state.estimate.status === "voided";

  const { contact } = job;
  const customerName = contact
    ? `${contact.first_name} ${contact.last_name}`.trim()
    : "—";

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
        <Slot>
          <SlotLabel>Task 21 · HeaderBar</SlotLabel>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-muted-foreground shrink-0" />
                <span
                  className={`text-base font-semibold text-foreground ${
                    isVoided ? "line-through text-muted-foreground" : ""
                  }`}
                >
                  {state.estimate.title}
                </span>
                {isVoided && (
                  <span className="ml-2 px-2 py-0.5 text-xs font-bold rounded bg-destructive text-destructive-foreground">
                    VOIDED
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
                <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                  {state.estimate.estimate_number}
                </span>
                <span className="capitalize">{state.estimate.status}</span>
              </div>
            </div>
          </div>
        </Slot>

        {/* ── SLOT 2: MetadataBar ──────────────────────────────────────────── */}
        <Slot>
          <SlotLabel>Task 22 · MetadataBar</SlotLabel>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Issued date: </span>
              <span className="text-foreground">
                {state.estimate.issued_date ?? "—"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Valid until: </span>
              <span className="text-foreground">
                {state.estimate.valid_until ?? "—"}
              </span>
            </div>
          </div>
        </Slot>

        {/* ── SLOT 3: CustomerBlock ────────────────────────────────────────── */}
        <Slot>
          <SlotLabel>Task 22 · CustomerBlock</SlotLabel>
          <div className="text-sm space-y-1">
            <div className="font-medium text-foreground">{customerName}</div>
            <div className="text-muted-foreground">{job.property_address}</div>
            {contact?.email && (
              <div className="text-muted-foreground">{contact.email}</div>
            )}
            {contact?.phone && (
              <div className="text-muted-foreground">{contact.phone}</div>
            )}
          </div>
        </Slot>

        {/* ── SLOT 4: Opening statement ────────────────────────────────────── */}
        <Slot>
          <SlotLabel>Task 23 · Opening Statement (Tiptap editor)</SlotLabel>
          <div className="text-sm text-muted-foreground italic">
            {state.estimate.opening_statement
              ? state.estimate.opening_statement.slice(0, 200)
              : "(no opening statement)"}
          </div>
        </Slot>

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
        <Slot>
          <SlotLabel>Task 23 · Closing Statement (Tiptap editor)</SlotLabel>
          <div className="text-sm text-muted-foreground italic">
            {state.estimate.closing_statement
              ? state.estimate.closing_statement.slice(0, 200)
              : "(no closing statement)"}
          </div>
        </Slot>
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
