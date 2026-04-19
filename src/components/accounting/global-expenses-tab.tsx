"use client";
import type { RangePreset } from "@/lib/accounting/date-ranges";
export default function GlobalExpensesTab({ range }: { range: RangePreset }) {
  return <div className="text-sm text-muted-foreground p-4">Global expenses ({range}) — filled by Task 26</div>;
}
