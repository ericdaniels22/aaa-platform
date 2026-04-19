"use client";
import type { RangePreset } from "@/lib/accounting/date-ranges";
export default function DateRangeSelector({ value, onChange }: { value: RangePreset; onChange: (v: RangePreset) => void }) {
  return <div className="text-xs text-muted-foreground">Date range stub ({value}) — filled by Task 21</div>;
}
