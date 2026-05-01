"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { EstimateWithContents, EstimateLineItem } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 2000;
const SAVED_DURATION_MS = 3000;
const MAX_BACKOFF_MS = 30_000;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface ReorderedSection {
  id: string;
  sort_order: number;
  parent_section_id: string | null;
}

export interface ReorderedLineItem {
  id: string;
  section_id: string;
  sort_order: number;
}

export interface UseAutoSaveResult {
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  hasStaleConflict: boolean;
  saveSectionsReorder: (sections: ReorderedSection[]) => Promise<boolean>;
  saveLineItemsReorder: (items: ReorderedLineItem[]) => Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Saveable field subsets
// ─────────────────────────────────────────────────────────────────────────────

const ESTIMATE_FIELDS = [
  "title",
  "opening_statement",
  "closing_statement",
  "issued_date",
  "valid_until",
  "markup_type",
  "markup_value",
  "discount_type",
  "discount_value",
  "tax_rate",
  "status",
] as const;

type EstimateFieldKey = typeof ESTIMATE_FIELDS[number];
type EstimateFieldsSubset = Pick<EstimateWithContents, EstimateFieldKey>;

const LINE_ITEM_FIELDS = [
  "description",
  "code",
  "quantity",
  "unit",
  "unit_price",
  "section_id",
  "sort_order",
] as const;

type LineItemFieldKey = typeof LINE_ITEM_FIELDS[number];
type LineItemSubset = Pick<EstimateLineItem, LineItemFieldKey>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pickEstimateFields(estimate: EstimateWithContents): EstimateFieldsSubset {
  const result = {} as EstimateFieldsSubset;
  for (const k of ESTIMATE_FIELDS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any)[k] = estimate[k];
  }
  return result;
}

function pickLineItemFields(item: EstimateLineItem): LineItemSubset {
  const result = {} as LineItemSubset;
  for (const k of LINE_ITEM_FIELDS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any)[k] = item[k];
  }
  return result;
}

function collectLineItems(estimate: EstimateWithContents): Map<string, LineItemSubset> {
  const map = new Map<string, LineItemSubset>();
  for (const sec of estimate.sections) {
    for (const item of sec.items) {
      map.set(item.id, pickLineItemFields(item));
    }
    for (const sub of sec.subsections) {
      for (const item of sub.items) {
        map.set(item.id, pickLineItemFields(item));
      }
    }
  }
  return map;
}

function getAllLineItems(estimate: EstimateWithContents): EstimateLineItem[] {
  const items: EstimateLineItem[] = [];
  for (const sec of estimate.sections) {
    items.push(...sec.items);
    for (const sub of sec.subsections) {
      items.push(...sub.items);
    }
  }
  return items;
}

/** Returns true if two subsets differ (shallow compare on field values). */
function diffSubset<T extends Record<string, unknown>>(a: T, b: T): boolean {
  for (const k in a) {
    if (a[k] !== b[k]) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// useAutoSave
// ─────────────────────────────────────────────────────────────────────────────

export function useAutoSave(estimate: EstimateWithContents): UseAutoSaveResult {
  // ── Snapshots of last successfully-saved data ─────────────────────────────
  const lastSavedSnapshotRef = useRef<EstimateFieldsSubset | null>(null);
  const lastSavedLineItemsRef = useRef<Map<string, LineItemSubset>>(new Map());
  // The updated_at value from the server (sent as updated_at_snapshot for 409 guard).
  const updatedAtRef = useRef<string>(estimate.updated_at ?? "");

  // ── State machine ─────────────────────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [hasStaleConflict, setHasStaleConflict] = useState(false);

  // ── Timers + in-flight guard ──────────────────────────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineItemTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const backoffMsRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const staleConflictRef = useRef<boolean>(false);

  // ── Mount: initialize snapshots ────────────────────────────────────────────
  useEffect(() => {
    if (lastSavedSnapshotRef.current === null) {
      lastSavedSnapshotRef.current = pickEstimateFields(estimate);
      lastSavedLineItemsRef.current = collectLineItems(estimate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      for (const t of lineItemTimersRef.current.values()) clearTimeout(t);
    };
  }, []);

  // ── Core save flow helpers ────────────────────────────────────────────────

  const transitionToSaved = useCallback(() => {
    setSaveStatus("saved");
    setLastSavedAt(new Date());
    backoffMsRef.current = 0;
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => {
      setSaveStatus("idle");
    }, SAVED_DURATION_MS);
  }, []);

  /** Handles a 409 stale-conflict response. */
  const handleStaleConflict = useCallback(() => {
    staleConflictRef.current = true;
    setHasStaleConflict(true);
    setSaveStatus("error");
    toast.error("Modified by another user — refresh to see changes", {
      duration: Infinity,
      id: "stale-conflict",
    });
  }, []);

  /** Handles a 5xx / network error — sets error state and schedules retry. */
  const handleSaveError = useCallback((retryFn: () => void) => {
    setSaveStatus("error");
    const delay = backoffMsRef.current === 0 ? 1000 : Math.min(backoffMsRef.current * 2, MAX_BACKOFF_MS);
    backoffMsRef.current = delay;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(retryFn, delay);
  }, []);

  // ── Estimate-level auto-save ──────────────────────────────────────────────

  const performEstimateSave = useCallback(async () => {
    if (staleConflictRef.current) return;
    if (lastSavedSnapshotRef.current === null) return;

    const current = pickEstimateFields(estimate);
    if (!diffSubset(current, lastSavedSnapshotRef.current)) {
      // No changes — stay idle (or go back to idle if we were in error from a prior run)
      return;
    }

    if (inFlightRef.current) {
      // Re-schedule: another save is in flight, check again after it finishes
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(performEstimateSave, DEBOUNCE_MS);
      return;
    }

    inFlightRef.current = true;
    setSaveStatus("saving");

    try {
      const body = {
        ...current,
        updated_at_snapshot: updatedAtRef.current,
      };
      const res = await fetch(`/api/estimates/${estimate.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = (await res.json()) as { estimate: EstimateWithContents };
        lastSavedSnapshotRef.current = pickEstimateFields(data.estimate);
        if (data.estimate.updated_at) {
          updatedAtRef.current = data.estimate.updated_at;
        }
        transitionToSaved();
      } else if (res.status === 409) {
        handleStaleConflict();
      } else {
        // 4xx other than 409: treat as error too
        handleSaveError(performEstimateSave);
      }
    } catch {
      handleSaveError(performEstimateSave);
    } finally {
      inFlightRef.current = false;

      // After in-flight completes, check if there are still unsaved changes
      if (!staleConflictRef.current && lastSavedSnapshotRef.current !== null) {
        const after = pickEstimateFields(estimate);
        if (diffSubset(after, lastSavedSnapshotRef.current)) {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(performEstimateSave, DEBOUNCE_MS);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate, transitionToSaved, handleStaleConflict, handleSaveError]);

  // ── Watch estimate-level fields, schedule debounced save ─────────────────
  useEffect(() => {
    if (staleConflictRef.current) return;
    if (lastSavedSnapshotRef.current === null) return; // not yet initialized

    const current = pickEstimateFields(estimate);
    if (!diffSubset(current, lastSavedSnapshotRef.current)) return; // no change

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(performEstimateSave, DEBOUNCE_MS);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [
    // Individual estimate-level fields — each triggers re-check
    estimate.title,
    estimate.opening_statement,
    estimate.closing_statement,
    estimate.issued_date,
    estimate.valid_until,
    estimate.markup_type,
    estimate.markup_value,
    estimate.discount_type,
    estimate.discount_value,
    estimate.tax_rate,
    estimate.status,
    performEstimateSave,
  ]);

  // ── Per-line-item auto-save ───────────────────────────────────────────────

  const performLineItemSave = useCallback(
    async (item: EstimateLineItem) => {
      if (staleConflictRef.current) return;

      const savedSubset = lastSavedLineItemsRef.current.get(item.id);
      const currentSubset = pickLineItemFields(item);

      if (savedSubset && !diffSubset(currentSubset, savedSubset)) return; // no change

      setSaveStatus("saving");

      try {
        const res = await fetch(
          `/api/estimates/${estimate.id}/line-items/${item.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(currentSubset),
          }
        );

        if (res.ok) {
          lastSavedLineItemsRef.current.set(item.id, currentSubset);
          transitionToSaved();
        } else if (res.status === 409) {
          handleStaleConflict();
        } else {
          setSaveStatus("error");
          toast.error("Failed to save line item");
        }
      } catch {
        setSaveStatus("error");
        toast.error("Network error — could not save line item");
      }
    },
    [estimate.id, transitionToSaved, handleStaleConflict]
  );

  // Watch line-item changes — debounce per item
  useEffect(() => {
    if (staleConflictRef.current) return;

    const allItems = getAllLineItems(estimate);
    for (const item of allItems) {
      const saved = lastSavedLineItemsRef.current.get(item.id);
      if (!saved) {
        // New item (just added by server round-trip) — record it without saving
        lastSavedLineItemsRef.current.set(item.id, pickLineItemFields(item));
        continue;
      }
      const current = pickLineItemFields(item);
      if (!diffSubset(current, saved)) continue; // unchanged

      // Changed — schedule debounced save
      const existing = lineItemTimersRef.current.get(item.id);
      if (existing) clearTimeout(existing);

      // Capture the item snapshot at scheduling time so closure captures correct value
      const capturedItem = item;
      const timer = setTimeout(() => {
        void performLineItemSave(capturedItem);
      }, DEBOUNCE_MS);
      lineItemTimersRef.current.set(item.id, timer);
    }
  // We intentionally use the raw sections to detect item changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate.sections, performLineItemSave]);

  // ── Reorder save methods (called immediately from handleDragEnd) ──────────

  const saveSectionsReorder = useCallback(
    async (sections: ReorderedSection[]): Promise<boolean> => {
      if (staleConflictRef.current) return false;

      setSaveStatus("saving");
      try {
        const res = await fetch(`/api/estimates/${estimate.id}/sections`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sections }),
        });
        if (res.ok) {
          transitionToSaved();
          return true;
        } else if (res.status === 409) {
          handleStaleConflict();
          return false;
        } else {
          setSaveStatus("error");
          toast.error("Failed to save section order");
          return false;
        }
      } catch {
        setSaveStatus("error");
        toast.error("Network error — could not save section order");
        return false;
      }
    },
    [estimate.id, transitionToSaved, handleStaleConflict]
  );

  const saveLineItemsReorder = useCallback(
    async (items: ReorderedLineItem[]): Promise<boolean> => {
      if (staleConflictRef.current) return false;

      setSaveStatus("saving");
      try {
        const res = await fetch(`/api/estimates/${estimate.id}/line-items`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        if (res.ok) {
          transitionToSaved();
          return true;
        } else if (res.status === 409) {
          handleStaleConflict();
          return false;
        } else {
          setSaveStatus("error");
          toast.error("Failed to save line item order");
          return false;
        }
      } catch {
        setSaveStatus("error");
        toast.error("Network error — could not save line item order");
        return false;
      }
    },
    [estimate.id, transitionToSaved, handleStaleConflict]
  );

  // ── Public interface ──────────────────────────────────────────────────────

  return {
    saveStatus,
    lastSavedAt,
    hasStaleConflict,
    saveSectionsReorder,
    saveLineItemsReorder,
  };
}
