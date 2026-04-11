"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import NotificationBell from "@/components/notification-bell";
import { navItems } from "@/lib/nav-items";
import { useNavOrder } from "@/lib/nav-order-context";
import { useSidebarCollapse } from "@/lib/sidebar-collapse-context";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut } = useAuth();
  const { order } = useNavOrder();
  const { collapsed, toggle } = useSidebarCollapse();

  // Sort the canonical nav items by DB sort_order.
  // Items missing from the DB fall to the bottom in code-defined order.
  const sortedNavItems = [...navItems].sort((a, b) => {
    const aOrder = order.get(a.href) ?? Infinity;
    const bOrder = order.get(b.href) ?? Infinity;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return navItems.indexOf(a) - navItems.indexOf(b);
  });

  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  const initials = profile?.full_name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 gradient-sidebar border-b border-white/10 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="AAA Logo" width={120} height={44} />
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="text-white/70 hover:text-white transition-colors"
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-md"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-40 h-full gradient-sidebar flex flex-col transition-[transform,width] duration-200 ease-out",
          "lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Mobile overlay is always full sidebar width. Collapse only applies at lg+.
          collapsed ? "w-52 lg:w-16" : "w-52",
        )}
      >
        {/* Logo area */}
        <div className="px-4 py-1 border-b border-white/10 flex items-center justify-between overflow-hidden">
          <Image src="/logo.png" alt="AAA Disaster Recovery" width={140} height={51} className="-my-2" />
          <div className="hidden lg:flex items-center gap-1">
            <NotificationBell />
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {sortedNavItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            // In collapsed mode on desktop, we render an icon-only square centered
            // in the rail. On mobile, the sidebar is always full-width (the mobile
            // overlay ignores `collapsed`), so we keep the expanded layout there.
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                aria-label={collapsed ? item.label : undefined}
                className={cn(
                  "rounded-lg text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-[image:var(--gradient-primary)] text-white shadow-lg shadow-[oklch(0.45_0.18_165_/_25%)]"
                    : "text-white/60 hover:text-white hover:bg-white/10",
                  collapsed
                    ? "flex items-center justify-center w-10 h-10 mx-auto"
                    : "flex items-center gap-2.5 px-2.5 py-2",
                )}
              >
                <item.icon size={18} />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="px-3 py-3 border-t border-white/10">
          {profile ? (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[image:var(--gradient-primary)] flex items-center justify-center shrink-0 shadow-sm">
                <span className="text-xs font-semibold text-white">{initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/90 truncate">{profile.full_name}</p>
                <p className="text-[10px] text-white/40 capitalize">{profile.role.replace("_", " ")}</p>
              </div>
              <button
                onClick={handleSignOut}
                className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-colors"
                title="Sign out"
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <p className="text-white/30 text-xs">AAA Platform v1.0</p>
          )}
        </div>
      </aside>
    </>
  );
}
