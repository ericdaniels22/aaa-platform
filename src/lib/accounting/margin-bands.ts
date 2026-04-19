// src/lib/accounting/margin-bands.ts
// Pure client-safe helper. Split out of margins.ts so client components can
// import it without dragging in the server-only Supabase bundle.

export type MarginBand = "green" | "amber" | "red" | "none";

export function marginPctBand(pct: number | null): MarginBand {
  if (pct === null) return "none";
  if (pct >= 30) return "green";
  if (pct >= 10) return "amber";
  return "red";
}
