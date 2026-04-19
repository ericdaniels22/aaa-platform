"use client";

import type { RangePreset } from "@/lib/accounting/date-ranges";

const OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "last_30", label: "Last 30 days" },
  { value: "this_quarter", label: "This quarter" },
  { value: "ytd", label: "Year to date" },
  { value: "all_time", label: "All time" },
];

export default function DateRangeSelector({ value, onChange }: { value: RangePreset; onChange: (v: RangePreset) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-sm ${value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
