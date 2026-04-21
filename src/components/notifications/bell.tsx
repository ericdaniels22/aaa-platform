"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { NotificationRow } from "@/lib/notifications/types";

export function NotificationBell() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=20");
      if (!res.ok) return;
      const { notifications } = (await res.json()) as {
        notifications: NotificationRow[];
      };
      setRows(notifications);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, []);

  const unreadCount = rows.filter((r) => !r.read_at).length;

  const markOneRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, read_at: new Date().toISOString() } : r,
      ),
    );
  };

  const markAllRead = async () => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mark_all_read: true }),
    });
    await refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {unreadCount > 0 && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline"
              onClick={() => void markAllRead()}
            >
              Mark all read
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading && rows.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            All caught up.
          </div>
        ) : (
          rows.map((r) => (
            <DropdownMenuItem
              key={r.id}
              onClick={() => void markOneRead(r.id)}
              render={
                <Link
                  href={r.href ?? "#"}
                  className={`flex flex-col gap-0.5 ${r.read_at ? "opacity-60" : ""} ${r.priority === "high" ? "border-l-2 border-red-500 pl-2" : ""}`}
                >
                  <span className="font-medium text-sm">{r.title}</span>
                  {r.body && (
                    <span className="text-xs text-muted-foreground line-clamp-2">
                      {r.body}
                    </span>
                  )}
                </Link>
              }
            />
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
