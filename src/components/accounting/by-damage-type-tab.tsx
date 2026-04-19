"use client";
import type { RangePreset } from "@/lib/accounting/date-ranges";
export default function ByDamageTypeTab({ range }: { range: RangePreset }) {
  return <div className="text-sm text-muted-foreground p-4">By damage type ({range}) — filled by Task 27</div>;
}
