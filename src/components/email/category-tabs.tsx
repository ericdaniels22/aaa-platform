"use client";

import type { Category } from "@/lib/email-categorizer";

interface CategoryTabsProps {
  category: Category;
  categoryCounts: Record<string, number>;
  onChange: (cat: Category) => void;
}

const TABS: { key: Category; label: string }[] = [
  { key: "general", label: "General" },
  { key: "promotions", label: "Promotions" },
  { key: "social", label: "Social" },
  { key: "purchases", label: "Purchases" },
];

export default function CategoryTabs({
  category,
  categoryCounts,
  onChange,
}: CategoryTabsProps) {
  return (
    <div className="flex overflow-x-auto border-b border-border/50 shrink-0">
      {TABS.map(({ key, label }) => {
        const isActive = category === key;
        const unread = categoryCounts[key] || 0;

        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`px-4 py-2 text-sm flex items-center gap-2 border-b-2 whitespace-nowrap transition-colors ${
              isActive
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
            {unread > 0 && (
              <span className="text-xs font-bold text-primary bg-primary/10 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                {unread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
