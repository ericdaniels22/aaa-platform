"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Vendor, ExpenseCategory } from "@/lib/types";
import { vendorTypeConfig } from "@/lib/expenses-constants";

type VendorWithCategory = Vendor & { default_category?: ExpenseCategory | null };

interface Props {
  value: VendorWithCategory | null;
  onChange: (v: VendorWithCategory | null) => void;
  disabled?: boolean;
}

export default function VendorAutocomplete({ value, onChange, disabled }: Props) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<VendorWithCategory[]>([]);
  const [adding, setAdding] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value?.name ?? ""); }, [value]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ active: "true" });
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/settings/vendors?${params}`);
      if (res.ok) setResults(await res.json());
    }, 150);
    return () => clearTimeout(t);
  }, [query, open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const showAddOption = useMemo(() =>
    query.trim().length > 0 && !results.some((r) => r.name.toLowerCase() === query.trim().toLowerCase()),
    [query, results],
  );

  async function handleAddInline() {
    setAdding(true);
    const res = await fetch("/api/settings/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: query.trim(), vendor_type: "other" }),
    });
    setAdding(false);
    if (res.ok) {
      const v = (await res.json()) as Vendor;
      onChange(v as VendorWithCategory);
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          disabled={disabled}
          onChange={(e) => { setQuery(e.target.value); onChange(null); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search or add a vendor"
          className="pl-9 h-11 text-base"
        />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto rounded-xl bg-card border border-border shadow-xl">
          {results.map((v) => {
            const t = vendorTypeConfig(v.vendor_type);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => { onChange(v); setQuery(v.name); setOpen(false); }}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-accent text-left"
              >
                <span className="text-sm text-foreground font-medium truncate">{v.name}</span>
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: t.bg, color: t.text }}>{t.label}</span>
                  {v.default_category && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                      style={{ backgroundColor: v.default_category.bg_color, color: v.default_category.text_color }}>
                      {v.default_category.display_label}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          {showAddOption && (
            <button
              type="button"
              disabled={adding}
              onClick={handleAddInline}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2.5 text-left border-t border-border",
                "text-primary hover:bg-primary/5",
              )}
            >
              <Plus size={14} />
              <span className="text-sm">{adding ? "Adding..." : `Add "${query.trim()}" as new vendor`}</span>
            </button>
          )}
          {!showAddOption && results.length === 0 && (
            <div className="px-3 py-3 text-sm text-muted-foreground">Type a name to search or add a vendor.</div>
          )}
        </div>
      )}
    </div>
  );
}
