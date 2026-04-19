"use client";
import type { RangePreset } from "@/lib/accounting/date-ranges";
export default function ExportMenu({ range }: { range: RangePreset }) {
  return <button disabled className="text-xs text-muted-foreground">Export stub ({range}) — Task 21</button>;
}
