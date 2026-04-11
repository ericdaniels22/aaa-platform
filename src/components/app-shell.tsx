"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/nav";
import { useSidebarCollapse } from "@/lib/sidebar-collapse-context";
import { cn } from "@/lib/utils";

const AUTH_ROUTES = ["/login", "/logout"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { collapsed } = useSidebarCollapse();
  const isAuthPage = AUTH_ROUTES.some((r) => pathname.startsWith(r));

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <>
      <Sidebar />
      <main
        className={cn(
          "pt-14 lg:pt-0 min-h-screen transition-[margin] duration-200 ease-out",
          collapsed ? "lg:ml-16" : "lg:ml-52",
        )}
      >
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </>
  );
}
