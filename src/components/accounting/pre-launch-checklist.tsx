"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

interface ChecklistItem {
  key: string;
  label: string;
  checked: boolean;
  manual: boolean;
}

export default function PreLaunchChecklist() {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/settings/accounting/checklist");
    if (res.ok) {
      const data = (await res.json()) as { items: ChecklistItem[] };
      setItems(data.items);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggle(key: string, next: boolean) {
    const res = await fetch("/api/settings/accounting/checklist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: next }),
    });
    if (!res.ok) {
      toast.error("Update failed");
      return;
    }
    await refresh();
  }

  if (loading) {
    return (
      <div className="py-6 text-center text-muted-foreground">
        <Loader2 className="animate-spin mx-auto" size={18} />
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="bg-card border border-border rounded-xl p-5 space-y-3">
      <div>
        <h2 className="font-semibold">Pre-launch checklist</h2>
        <p className="text-sm text-muted-foreground">
          Review these before turning off dry run. Non-blocking — they&apos;re a moment of reflection.
        </p>
      </div>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.key} className="flex items-start gap-3 text-sm">
            {it.manual ? (
              <input
                type="checkbox"
                checked={it.checked}
                onChange={(e) => toggle(it.key, e.target.checked)}
                className="mt-0.5"
              />
            ) : it.checked ? (
              <Check size={16} className="text-green-600 mt-0.5" />
            ) : (
              <X size={16} className="text-red-500 mt-0.5" />
            )}
            <span className={it.checked ? "text-foreground" : "text-muted-foreground"}>
              {it.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
