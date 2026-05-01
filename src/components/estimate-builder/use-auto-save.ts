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
const FETCH_TIMEOUT_MS = 30_000;

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

  // ── Timers + in-flight guards ─────────────────────────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineItemTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const sectionsReorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineItemsReorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffMsRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const inFlightItemsRef = useRef<Set<string>>(new Set());
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
      if (sectionsReorderTimerRef.current) clearTimeout(sectionsReorderTimerRef.current);
      if (lineItemsReorderTimerRef.current) clearTimeout(lineItemsReorderTimerRef.current);
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
    setSaveStatus("error");
    toast.error("Modified by another user — refresh to see changes", {
      duration: Infinity,
      id: "stale-conflict",
    });
  }, []);

  /** Handles a 5xx / network error — sets error state and schedules retry on the given timer ref. */
  const handleSaveError = useCallback(
    (
      timerRef: { current: ReturnType<typeof setTimeout> | null },
      retryFn: () => void,
    ) => {
      setSaveStatus("error");
      const delay = backoffMsRef.current === 0 ? 1000 : Math.min(backoffMsRef.current * 2, MAX_BACKOFF_MS);
      backoffMsRef.current = delay;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(retryFn, delay);
    },
    [],
  );

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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const body = {
        ...current,
        updated_at_snapshot: updatedAtRef.current,
      };
      const res = await fetch(`/api/estimates/${estimate.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
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
        handleSaveError(saveTimerRef, performEstimateSave);
      }
    } catch (err) {
      // AbortError (timeout) is treated the same as a network error
      if (err instanceof Error && err.name === "AbortError") {
        handleSaveError(saveTimerRef, performEstimateSave);
      } else {
        handleSaveError(saveTimerRef, performEstimateSave);
      }
    } finally {
      clearTimeout(timeoutId);
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

      // C2: per-item in-flight guard — if already saving this item, early-return;
      // the watch effect will re-pick it up on the next render (still-dirty).
      if (inFlightItemsRef.current.has(item.id)) return;

      // I1: schedule a retry of this item via lineItemTimersRef. Re-typing the
      // same item clears this timer in the watch effect, replacing it with a
      // fresh debounce that reads the latest state.
      const scheduleLineItemRetry = () => {
        const delay = backoffMsRef.current === 0 ? 1000 : Math.min(backoffMsRef.current * 2, MAX_BACKOFF_MS);
        backoffMsRef.current = delay;
        const existing = lineItemTimersRef.current.get(item.id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => void performLineItemSave(item), delay);
        lineItemTimersRef.current.set(item.id, timer);
      };

      inFlightItemsRef.current.add(item.id);
      setSaveStatus("saving");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(
          `/api/estimates/${estimate.id}/line-items/${item.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...currentSubset,
              updated_at_snapshot: updatedAtRef.current,
            }),
            signal: controller.signal,
          }
        );

        if (res.ok) {
          const data = (await res.json()) as { line_item: EstimateLineItem; updated_at?: string | null };
          lastSavedLineItemsRef.current.set(item.id, currentSubset);
          if (data.updated_at) updatedAtRef.current = data.updated_at;
          transitionToSaved();
        } else if (res.status === 409 || res.status === 404) {
          // I3: 404 (item gone — likely deleted by another user) is also a stale signal.
          handleStaleConflict();
        } else {
          // 5xx / other 4xx — schedule retry with exp backoff.
          setSaveStatus("error");
          scheduleLineItemRetry();
        }
      } catch (err) {
        // AbortError (timeout) and network errors — schedule retry.
        setSaveStatus("error");
        scheduleLineItemRetry();
        // Reference err to keep the catch typed without an unused-var warning.
        void err;
      } finally {
        clearTimeout(timeoutId);
        inFlightItemsRef.current.delete(item.id);
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

      // A new reorder supersedes any pending retry — clear before issuing.
      if (sectionsReorderTimerRef.current) {
        clearTimeout(sectionsReorderTimerRef.current);
        sectionsReorderTimerRef.current = null;
      }

      setSaveStatus("saving");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(`/api/estimates/${estimate.id}/sections`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sections, updated_at_snapshot: updatedAtRef.current }),
          signal: controller.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as { ok: true; updated_at?: string | null };
          if (data.updated_at) updatedAtRef.current = data.updated_at;
          transitionToSaved();
          return true;
        } else if (res.status === 409 || res.status === 404) {
          // I3: 404 (a section we're reordering is gone) is treated as stale.
          handleStaleConflict();
          return false;
        } else {
          // I1: retry with the same payload after exp backoff.
          handleSaveError(sectionsReorderTimerRef, () => void saveSectionsReorder(sections));
          return false;
        }
      } catch (err) {
        // AbortError (timeout) and network errors — retry with same payload.
        handleSaveError(sectionsReorderTimerRef, () => void saveSectionsReorder(sections));
        void err;
        return false;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    [estimate.id, transitionToSaved, handleStaleConflict, handleSaveError]
  );

  const saveLineItemsReorder = useCallback(
    async (items: ReorderedLineItem[]): Promise<boolean> => {
      if (staleConflictRef.current) return false;

      if (lineItemsReorderTimerRef.current) {
        clearTimeout(lineItemsReorderTimerRef.current);
        lineItemsReorderTimerRef.current = null;
      }

      setSaveStatus("saving");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(`/api/estimates/${estimate.id}/line-items`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items, updated_at_snapshot: updatedAtRef.current }),
          signal: controller.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as { ok: true; updated_at?: string | null };
          if (data.updated_at) updatedAtRef.current = data.updated_at;
          transitionToSaved();
          return true;
        } else if (res.status === 409 || res.status === 404) {
          handleStaleConflict();
          return false;
        } else {
          handleSaveError(lineItemsReorderTimerRef, () => void saveLineItemsReorder(items));
          return false;
        }
      } catch (err) {
        handleSaveError(lineItemsReorderTimerRef, () => void saveLineItemsReorder(items));
        void err;
        return false;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    [estimate.id, transitionToSaved, handleStaleConflict, handleSaveError]
  );

  // ── Public interface ──────────────────────────────────────────────────────

  return {
    saveStatus,
    lastSavedAt,
    saveSectionsReorder,
    saveLineItemsReorder,
  };
}
