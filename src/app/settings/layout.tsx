"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { settingsNavItems } from "@/lib/settings-nav";
import { cn } from "@/lib/utils";
import { Settings, ChevronDown } from "lucide-react";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const currentItem = settingsNavItems.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  );

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Settings size={22} className="text-[#0F6E56]" />
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Settings</h1>
      </div>

      {/* Mobile nav dropdown */}
      <div className="md:hidden mb-4">
        <div className="relative">
          <select
            value={currentItem?.href || ""}
            onChange={(e) => router.push(e.target.value)}
            className="w-full appearance-none bg-white border border-gray-200 rounded-lg px-4 py-2.5 pr-10 text-sm font-medium text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#0F6E56]/20 focus:border-[#0F6E56]"
          >
            {settingsNavItems
              .filter((item) => !item.disabled)
              .map((item) => (
                <option key={item.href} value={item.href}>
                  {item.label}
                </option>
              ))}
          </select>
          <ChevronDown
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#999999] pointer-events-none"
          />
        </div>
      </div>

      <div className="flex gap-6">
        {/* Desktop sidebar */}
        <aside className="hidden md:block w-52 shrink-0">
          <nav className="space-y-0.5">
            {settingsNavItems.map((item) => {
              const isActive =
                pathname === item.href ||
                pathname.startsWith(item.href + "/");
              const Icon = item.icon;

              if (item.disabled) {
                return (
                  <div
                    key={item.href}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-[#BBBBBB] cursor-not-allowed"
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </div>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-[#0F6E56]/10 text-[#0F6E56]"
                      : "text-[#666666] hover:text-[#1A1A1A] hover:bg-gray-100"
                  )}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
