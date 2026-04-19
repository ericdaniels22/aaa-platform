"use client";
import type { RangePreset } from "@/lib/accounting/date-ranges";
export default function JobProfitabilityTab({ range }: { range: RangePreset }) {
  return <div className="text-sm text-muted-foreground p-4">Job profitability ({range}) — filled by Task 24</div>;
}
