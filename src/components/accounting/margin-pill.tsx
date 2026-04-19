// src/components/accounting/margin-pill.tsx
// Color-coded margin-percentage pill. Green ≥30, amber ≥10, red <10, em-dash when null.
import { marginPctBand } from "@/lib/accounting/margins";

export function MarginPctPill({ pct }: { pct: number | null }) {
  const band = marginPctBand(pct);
  if (band === "none") return <span className="text-muted-foreground">—</span>;
  const color = band === "green" ? "#5DCAA5" : band === "amber" ? "#FAC775" : "#F09595";
  const bg =
    band === "green"
      ? "rgba(93, 202, 165, 0.1)"
      : band === "amber"
      ? "rgba(250, 199, 117, 0.1)"
      : "rgba(240, 149, 149, 0.1)";
  return (
    <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium" style={{ background: bg, color }}>
      {pct!.toFixed(1)}%
    </span>
  );
}
