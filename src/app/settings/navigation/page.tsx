"use client";

import { useState, useEffect, useCallback } from "react";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useNavOrder } from "@/lib/nav-order-context";
import { navItems, type NavItem } from "@/lib/nav-items";

export default function NavigationSettingsPage() {
  const { profile, loading: authLoading } = useAuth();
  const { order, loading: orderLoading, refresh } = useNavOrder();
  const [items, setItems] = useState<NavItem[]>([]);

  // Whenever the DB order changes, compute the sorted items for this page.
  // Mirrors the sort logic in src/components/nav.tsx.
  useEffect(() => {
    if (orderLoading) return;
    const sorted = [...navItems].sort((a, b) => {
      const aOrder = order.get(a.href) ?? Infinity;
      const bOrder = order.get(b.href) ?? Infinity;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return navItems.indexOf(a) - navItems.indexOf(b);
    });
    setItems(sorted);
  }, [order, orderLoading]);

  const saveOrder = useCallback(
    async (next: NavItem[], snapshot: NavItem[]) => {
      const res = await fetch("/api/settings/nav-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: next.map((i) => i.href) }),
      });
      if (res.ok) {
        toast.success("Order saved");
        refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to save order");
        // Revert to the snapshot taken before the optimistic move
        setItems(snapshot);
      }
    },
    [refresh]
  );

  function moveUp(index: number) {
    if (index === 0) return;
    const snapshot = items;
    const updated = [...items];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    setItems(updated);
    saveOrder(updated, snapshot);
  }

  function moveDown(index: number) {
    if (index === items.length - 1) return;
    const snapshot = items;
    const updated = [...items];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    setItems(updated);
    saveOrder(updated, snapshot);
  }

  if (authLoading || orderLoading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  if (profile?.role !== "admin") {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Admins only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Navigation</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Use the up and down arrows to reorder items in the sidebar.
          Changes apply to every user immediately.
        </p>
      </div>

      <div className="space-y-1">
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <div
              key={item.href}
              className="bg-card rounded-xl border border-border p-3 flex items-center gap-3"
            >
              {/* Reorder buttons — mirror /settings/statuses */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                  className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
                  aria-label={`Move ${item.label} up`}
                >
                  <GripVertical size={14} className="rotate-180" />
                </button>
                <button
                  onClick={() => moveDown(index)}
                  disabled={index === items.length - 1}
                  className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
                  aria-label={`Move ${item.label} down`}
                >
                  <GripVertical size={14} />
                </button>
              </div>

              {/* Icon */}
              <div className="shrink-0 text-foreground">
                <Icon size={18} />
              </div>

              {/* Label */}
              <div className="flex-1 min-w-0">
                <span className="text-sm text-foreground font-medium">
                  {item.label}
                </span>
              </div>

              {/* Href (dimmed, for reference) */}
              <div className="text-xs text-muted-foreground font-mono">
                {item.href}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
