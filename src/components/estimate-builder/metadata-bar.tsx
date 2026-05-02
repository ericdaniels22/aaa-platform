"use client";

import type { BuilderMode, Estimate } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// MetadataBar — horizontal strip with Issued date + Valid until date pickers.
// Both fields are disabled when the estimate is voided.
// MetadataBar is purely presentational: the parent computes the auto-default
// for valid_until before calling onValidUntilChange.
// ─────────────────────────────────────────────────────────────────────────────

interface MetadataBarProps {
  estimate: Estimate;
  onIssuedDateChange: (d: string | null) => void;
  onValidUntilChange: (d: string | null) => void;
  mode?: BuilderMode;
}

export function MetadataBar({
  estimate,
  onIssuedDateChange,
  onValidUntilChange,
  mode = "estimate",
}: MetadataBarProps) {
  const isVoided = estimate.status === "voided";

  function handleIssuedChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    onIssuedDateChange(val === "" ? null : val);
  }

  function handleValidUntilChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    onValidUntilChange(val === "" ? null : val);
  }

  return (
    <div className="flex flex-row gap-6 px-4 py-3 rounded-lg border border-border/50 bg-card">
      <label className="flex flex-col gap-1 text-xs min-w-[140px]">
        <span className="uppercase tracking-wide text-muted-foreground font-medium">
          Issued date
        </span>
        <input
          type="date"
          disabled={isVoided}
          value={estimate.issued_date ?? ""}
          onChange={handleIssuedChange}
          className="border border-border rounded-md px-2 py-1 bg-background text-sm disabled:opacity-70 disabled:cursor-not-allowed"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs min-w-[140px]">
        <span className="uppercase tracking-wide text-muted-foreground font-medium">
          Valid until
        </span>
        <input
          type="date"
          disabled={isVoided}
          value={estimate.valid_until ?? ""}
          onChange={handleValidUntilChange}
          className="border border-border rounded-md px-2 py-1 bg-background text-sm disabled:opacity-70 disabled:cursor-not-allowed"
        />
      </label>
    </div>
  );
}
