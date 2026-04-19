"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import type { RangePreset } from "@/lib/accounting/date-ranges";

export default function ExportMenu({ range }: { range: RangePreset }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const download = (type: "profitability" | "ar-aging" | "expenses" | "all") => {
    const url = `/api/accounting/export/${type}?range=${range}`;
    window.location.href = url;
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
      >
        Export <ChevronDown size={14} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded-md border border-border bg-popover shadow-lg z-10">
          <button onClick={() => download("profitability")} className="block w-full text-left px-3 py-2 text-sm hover:bg-accent">Export Job Profitability (CSV)</button>
          <button onClick={() => download("ar-aging")} className="block w-full text-left px-3 py-2 text-sm hover:bg-accent">Export AR Aging (CSV)</button>
          <button onClick={() => download("expenses")} className="block w-full text-left px-3 py-2 text-sm hover:bg-accent">Export Expenses (CSV)</button>
          <div className="border-t border-border" />
          <button onClick={() => download("all")} className="block w-full text-left px-3 py-2 text-sm hover:bg-accent">Export All (ZIP)</button>
        </div>
      )}
    </div>
  );
}
