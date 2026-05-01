"use client";

import { useState } from "react";
import { AlertOctagon, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/format";
import type { Contact, Job } from "@/lib/types";
import type { EstimateWithContents, EstimateLineItem } from "@/lib/types";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { HeaderBar } from "./header-bar";
import { MetadataBar } from "./metadata-bar";
import { CustomerBlock } from "./customer-block";
import { StatementEditor } from "./statement-editor";
import { SectionCard } from "./section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

  // ── Slot 5: Add-section inline input state ─────────────────────────────
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");

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

  // ── Slot 5: dnd-kit sensors ────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // ── Slot 5: section CRUD ───────────────────────────────────────────────

  async function onAddSection(title: string) {
    // Plan deviation: title passed directly (spec had `() => void`, which omitted it).
    try {
      const res = await fetch(`/api/estimates/${state.estimate.id}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, parent_section_id: null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Failed to add section");
        return;
      }
      const { section } = (await res.json()) as {
        section: EstimateWithContents["sections"][number];
      };
      const newSection = { ...section, items: [], subsections: [] };
      setState((prev) => ({
        ...prev,
        estimate: {
          ...prev.estimate,
          sections: [...prev.estimate.sections, newSection],
        },
      }));
      setShowAddSection(false);
      setNewSectionTitle("");
    } catch {
      toast.error("Network error — could not add section");
    }
  }

  async function onSectionRename(id: string, title: string) {
    // Optimistic local update
    setState((prev) => ({
      ...prev,
      estimate: {
        ...prev.estimate,
        sections: prev.estimate.sections.map((s) =>
          s.id === id ? { ...s, title } : s
        ),
      },
    }));
    try {
      const res = await fetch(
        `/api/estimates/${state.estimate.id}/sections/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Failed to rename section");
      }
    } catch {
      toast.error("Network error — could not rename section");
    }
  }

  async function onSectionDelete(id: string) {
    const snapshot = state.estimate; // capture before mutation
    setState((prev) => ({
      ...prev,
      estimate: {
        ...prev.estimate,
        sections: prev.estimate.sections.filter((s) => s.id !== id),
      },
    }));
    try {
      const res = await fetch(
        `/api/estimates/${state.estimate.id}/sections/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Failed to delete section");
        setState((prev) => ({ ...prev, estimate: snapshot }));
      } else {
        toast.success("Section deleted");
      }
    } catch {
      toast.error("Network error — could not delete section");
      setState((prev) => ({ ...prev, estimate: snapshot }));
    }
  }

  // ── Slot 5: subsection CRUD ────────────────────────────────────────────

  async function onSubsectionAdd(parentId: string, title: string) {
    // Plan deviation: title passed directly (spec had `(parentId: string) => void`).
    try {
      const res = await fetch(`/api/estimates/${state.estimate.id}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, parent_section_id: parentId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Failed to add subsection");
        return;
      }
      const { section } = (await res.json()) as {
        section: import("@/lib/types").EstimateSection;
      };
      const newSub = { ...section, items: [] };
      setState((prev) => ({
        ...prev,
        estimate: {
          ...prev.estimate,
          sections: prev.estimate.sections.map((s) =>
            s.id === parentId
              ? { ...s, subsections: [...s.subsections, newSub] }
              : s
          ),
        },
      }));
    } catch {
      toast.error("Network error — could not add subsection");
    }
  }

  async function onSubsectionRename(id: string, title: string) {
    // Optimistic update
    setState((prev) => ({
      ...prev,
      estimate: {
        ...prev.estimate,
        sections: prev.estimate.sections.map((s) => ({
          ...s,
          subsections: s.subsections.map((sub) =>
            sub.id === id ? { ...sub, title } : sub
          ),
        })),
      },
    }));
    try {
      const res = await fetch(
        `/api/estimates/${state.estimate.id}/sections/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Failed to rename subsection");
      }
    } catch {
      toast.error("Network error — could not rename subsection");
    }
  }

  async function onSubsectionDelete(id: string) {
    const snapshot = state.estimate; // capture before mutation
    setState((prev) => ({
      ...prev,
      estimate: {
        ...prev.estimate,
        sections: prev.estimate.sections.map((s) => ({
          ...s,
          subsections: s.subsections.filter((sub) => sub.id !== id),
        })),
      },
    }));
    try {
      const res = await fetch(
        `/api/estimates/${state.estimate.id}/sections/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Failed to delete subsection");
        setState((prev) => ({ ...prev, estimate: snapshot }));
      } else {
        toast.success("Subsection deleted");
      }
    } catch {
      toast.error("Network error — could not delete subsection");
      setState((prev) => ({ ...prev, estimate: snapshot }));
    }
  }

  // ── Slot 5: line-item delete ───────────────────────────────────────────

  async function onLineItemDelete(id: string) {
    const snapshot = state.estimate; // capture before mutation
    // Remove from local state (works for items in sections OR subsections)
    setState((prev) => ({
      ...prev,
      estimate: {
        ...prev.estimate,
        sections: prev.estimate.sections.map((s) => ({
          ...s,
          items: s.items.filter((i) => i.id !== id),
          subsections: s.subsections.map((sub) => ({
            ...sub,
            items: sub.items.filter((i) => i.id !== id),
          })),
        })),
      },
    }));
    try {
      const res = await fetch(
        `/api/estimates/${state.estimate.id}/line-items/${id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Failed to delete line item");
        setState((prev) => ({ ...prev, estimate: snapshot }));
      } else {
        toast.success("Line item deleted");
      }
    } catch {
      toast.error("Network error — could not delete line item");
      setState((prev) => ({ ...prev, estimate: snapshot }));
    }
  }

  // ── Slot 5: stubs for Task 25 / Task 26 ──────────────────────────────

  // TODO Task 25: replace with real LineItemRow in-place edit
  function onLineItemEdit(item: EstimateLineItem) {
    toast.info(`Line item editing comes in Task 25 (item: ${item.id.slice(0, 8)}…)`);
  }

  // TODO Task 26: replace with AddItemDialog
  function onAddLineItem(sectionId: string) {
    toast.info(`Add Item dialog comes in Task 26 (section: ${sectionId.slice(0, 8)}…)`);
  }

  // ── Slot 5: drag-end handler ───────────────────────────────────────────
  // NOTE: Drag-reorder updates local state only — Task 28 will add the
  // PUT /sections bulk-reorder API call when auto-save lands.

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeType = active.data.current?.type as string | undefined;

    if (activeType === "section") {
      setState((prev) => {
        const secs = prev.estimate.sections;
        const oldIdx = secs.findIndex((s) => s.id === active.id);
        const newIdx = secs.findIndex((s) => s.id === over.id);
        if (oldIdx === -1 || newIdx === -1) return prev;
        return {
          ...prev,
          estimate: {
            ...prev.estimate,
            sections: arrayMove(secs, oldIdx, newIdx),
          },
        };
      });
      return;
    }

    if (activeType === "subsection") {
      // Cross-section drags: snap back — only allow within the same parent section.
      const activeParent = active.data.current?.parentSectionId as string | undefined;
      const overParent = over.data.current?.parentSectionId as string | undefined;
      if (activeParent !== overParent) return; // snap back

      setState((prev) => ({
        ...prev,
        estimate: {
          ...prev.estimate,
          sections: prev.estimate.sections.map((s) => {
            if (s.id !== activeParent) return s;
            const subs = s.subsections;
            const oldIdx = subs.findIndex((sub) => sub.id === active.id);
            const newIdx = subs.findIndex((sub) => sub.id === over.id);
            if (oldIdx === -1 || newIdx === -1) return s;
            return { ...s, subsections: arrayMove(subs, oldIdx, newIdx) };
          }),
        },
      }));
      return;
    }

    if (activeType === "line-item") {
      // Task 25 will register useSortable({ id, data: { type: "line-item", parentSectionId } })
      // for each LineItemRow. The parentSectionId is either a section.id or a subsection.id —
      // whichever immediate parent the line item lives in.

      // Cross-section/cross-subsection drags: snap back.
      const activeParentSectionId = active.data.current?.parentSectionId as string | undefined;
      const overParentSectionId = over.data.current?.parentSectionId as string | undefined;
      if (activeParentSectionId !== overParentSectionId) return; // snap back

      setState((prev) => ({
        ...prev,
        estimate: {
          ...prev.estimate,
          sections: prev.estimate.sections.map((s) => {
            // Check direct items
            if (s.id === activeParentSectionId) {
              const items = s.items;
              const oldIdx = items.findIndex((i) => i.id === active.id);
              const newIdx = items.findIndex((i) => i.id === over.id);
              if (oldIdx === -1 || newIdx === -1) return s;
              return { ...s, items: arrayMove(items, oldIdx, newIdx) };
            }
            // Check subsection items
            return {
              ...s,
              subsections: s.subsections.map((sub) => {
                if (sub.id !== activeParentSectionId) return sub;
                const items = sub.items;
                const oldIdx = items.findIndex((i) => i.id === active.id);
                const newIdx = items.findIndex((i) => i.id === over.id);
                if (oldIdx === -1 || newIdx === -1) return sub;
                return { ...sub, items: arrayMove(items, oldIdx, newIdx) };
              }),
            };
          }),
        },
      }));
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────
  const sections = state.estimate.sections;

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

        {/* ── SLOT 5: Sections list (Task 24) ──────────────────────────────── */}
        {/* DndContext wraps the entire sections list. Each SectionCard contains
            its own inner SortableContexts for subsections and direct items,
            providing the drag-constraint boundaries described in spec §5.1. */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          {sections.length === 0 ? (
            /* Empty state — spec §10 */
            <div className="rounded-xl border-2 border-dashed border-border bg-card p-12 flex flex-col items-center gap-4 text-center">
              <p className="text-sm text-muted-foreground">
                Add a section to get started
              </p>
              <Button
                onClick={() => setShowAddSection(true)}
                size="sm"
                className="gap-1.5"
              >
                <Plus size={14} />
                New Section
              </Button>
            </div>
          ) : (
            <SortableContext
              items={sections.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="space-y-3">
                {sections.map((sec) => (
                  <SectionCard
                    key={sec.id}
                    section={sec}
                    onRename={onSectionRename}
                    onDelete={onSectionDelete}
                    onAddSubsection={onSubsectionAdd}
                    onAddLineItem={onAddLineItem}
                    onLineItemDelete={onLineItemDelete}
                    onSubsectionRename={onSubsectionRename}
                    onSubsectionDelete={onSubsectionDelete}
                    onSubsectionLineItemDelete={onLineItemDelete}
                  />
                ))}
              </ul>
            </SortableContext>
          )}

          {/* Add Section inline input — shown below the list */}
          <div className="mt-3 pt-3 border-t border-border">
            {showAddSection ? (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={newSectionTitle}
                  maxLength={200}
                  placeholder="Section name"
                  onChange={(e) => setNewSectionTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newSectionTitle.trim()) {
                      void onAddSection(newSectionTitle.trim());
                    }
                    if (e.key === "Escape") {
                      setShowAddSection(false);
                      setNewSectionTitle("");
                    }
                  }}
                  className="h-8 text-sm flex-1"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (newSectionTitle.trim()) {
                      void onAddSection(newSectionTitle.trim());
                    }
                  }}
                  disabled={!newSectionTitle.trim()}
                >
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowAddSection(false);
                    setNewSectionTitle("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddSection(true)}
                className="flex items-center gap-1.5 px-3 py-2 w-full rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border border-dashed border-border"
              >
                <Plus size={13} />
                Add Section
              </button>
            )}
          </div>
        </DndContext>

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
