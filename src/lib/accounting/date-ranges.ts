// src/lib/accounting/date-ranges.ts
// Date range presets for /accounting, plus prior-period math.
//
// Activity-based scoping: a job is "in range" if ANY of (invoice created,
// payment received, expense logged) falls inside the range. This is NOT
// "job created in range" — the decision was made deliberately because a job
// created in March but paid out in June should appear in June's view.
// See design spec 2026-04-19-build-16b-accounting.

export type RangePreset = "last_30" | "this_quarter" | "ytd" | "all_time";

export type DateRange = {
  preset: RangePreset;
  startISO: string | null; // null for "all_time"
  endISO: string | null;   // null for "all_time"; otherwise today's date
  priorStartISO: string | null;
  priorEndISO: string | null;
  label: string;
};

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resolveRange(preset: RangePreset, now: Date = new Date()): DateRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endISO = iso(today);

  if (preset === "all_time") {
    return {
      preset,
      startISO: null, endISO: null,
      priorStartISO: null, priorEndISO: null,
      label: "All time",
    };
  }

  if (preset === "last_30") {
    const start = new Date(today); start.setDate(start.getDate() - 29);
    const priorEnd = new Date(start); priorEnd.setDate(priorEnd.getDate() - 1);
    const priorStart = new Date(priorEnd); priorStart.setDate(priorStart.getDate() - 29);
    return {
      preset,
      startISO: iso(start), endISO,
      priorStartISO: iso(priorStart), priorEndISO: iso(priorEnd),
      label: "Last 30 days",
    };
  }

  if (preset === "this_quarter") {
    const qStartMonth = Math.floor(today.getMonth() / 3) * 3;
    const start = new Date(today.getFullYear(), qStartMonth, 1);
    const priorStart = new Date(start); priorStart.setMonth(priorStart.getMonth() - 3);
    const priorEnd = new Date(start); priorEnd.setDate(priorEnd.getDate() - 1);
    return {
      preset,
      startISO: iso(start), endISO,
      priorStartISO: iso(priorStart), priorEndISO: iso(priorEnd),
      label: "This quarter",
    };
  }

  // ytd
  const start = new Date(today.getFullYear(), 0, 1);
  const priorStart = new Date(today.getFullYear() - 1, 0, 1);
  const priorEnd = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  return {
    preset: "ytd",
    startISO: iso(start), endISO,
    priorStartISO: iso(priorStart), priorEndISO: iso(priorEnd),
    label: "Year to date",
  };
}

export function computeDelta(current: number, prior: number): { amount: number; pct: number | null; direction: "up" | "down" | "flat" } {
  const amount = current - prior;
  const pct = prior === 0 ? null : (amount / prior) * 100;
  const direction = amount > 0 ? "up" : amount < 0 ? "down" : "flat";
  return { amount, pct, direction };
}
