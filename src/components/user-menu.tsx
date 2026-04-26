"use client";

// Top-right workspace switcher dropdown.
//
// Locked decision (plan §10.1): switcher placement is the top-right user
// avatar menu, not a sidebar control or settings page.
//
// The component hides itself entirely when the user has fewer than 2
// memberships (plan §5.2): a one-item menu has no purpose, and the sidebar
// footer already provides sign-out for the single-org case (today's reality
// pre-Eric-being-added-to-Test-Company).
//
// Rendered by AppShell on authenticated, non-public, non-fullscreen routes.
// See src/components/app-shell.tsx.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase";
import { switchWorkspace } from "@/lib/supabase/switch-workspace";

interface Membership {
  organization_id: string;
  organization_name: string;
  is_active: boolean;
}

interface MembershipRow {
  organization_id: string;
  is_active: boolean;
  organizations: { name: string } | { name: string }[] | null;
}

export default function UserMenu() {
  const { user, profile, signOut } = useAuth();
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load memberships once user is known. user_organizations RLS
  // (tenant_isolation_user_orgs_select) lets the user read all their own
  // memberships — we don't need to be in a specific org to query them.
  useEffect(() => {
    if (!user) {
      setMemberships([]);
      setLoaded(false);
      return;
    }
    const supabase = createClient();
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_organizations")
        .select("organization_id, is_active, organizations(name)")
        .eq("user_id", user.id)
        .returns<MembershipRow[]>();
      if (cancelled || !data) {
        if (!cancelled) setLoaded(true);
        return;
      }
      const rows: Membership[] = data
        .map((r) => {
          const orgRel = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations;
          return {
            organization_id: r.organization_id,
            organization_name: orgRel?.name ?? "Unknown",
            is_active: r.is_active,
          };
        })
        .sort((a, b) => a.organization_name.localeCompare(b.organization_name));
      setMemberships(rows);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  // Hide when single-membership (or membership list not yet loaded). Keeps
  // the UI quiet for the single-org case, which is today's prod reality.
  if (!loaded || memberships.length < 2) return null;

  const active = memberships.find((m) => m.is_active);
  const initials =
    profile?.full_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

  async function onSwitch(orgId: string) {
    if (switching) return;
    setError(null);
    setSwitching(orgId);
    try {
      await switchWorkspace(orgId);
      // switchWorkspace reloads the page on success; code below this line
      // typically does not run.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Switch failed");
      setSwitching(null);
    }
  }

  async function onSignOut() {
    setOpen(false);
    await signOut();
    router.push("/login");
  }

  return (
    <div ref={containerRef} className="fixed top-3 right-3 z-50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open workspace menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full bg-white/95 backdrop-blur px-2 py-1 text-sm shadow-md ring-1 ring-black/5 transition-colors hover:bg-white"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[image:var(--gradient-primary)] shadow-sm">
          <span className="text-[11px] font-semibold text-white">{initials}</span>
        </div>
        <span className="max-w-[140px] truncate text-xs font-medium text-gray-700">
          {active?.organization_name ?? "Workspace"}
        </span>
        <ChevronDown size={14} className="text-gray-500" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-64 overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-black/5"
        >
          <div className="border-b border-gray-100 px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
              Workspaces
            </div>
          </div>
          <ul className="py-1">
            {memberships.map((m) => {
              const isCurrent = m.is_active;
              const isLoading = switching === m.organization_id;
              return (
                <li key={m.organization_id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => !isCurrent && onSwitch(m.organization_id)}
                    disabled={isCurrent || switching !== null}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      isCurrent
                        ? "cursor-default bg-gray-50 font-medium text-gray-900"
                        : "text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    }`}
                  >
                    <span className="truncate">{m.organization_name}</span>
                    {isCurrent ? (
                      <Check size={14} className="shrink-0 text-emerald-600" />
                    ) : isLoading ? (
                      <Loader2 size={14} className="shrink-0 animate-spin text-gray-400" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {error && (
            <div className="border-t border-gray-100 px-3 py-2 text-xs text-red-600">{error}</div>
          )}
          <div className="border-t border-gray-100">
            <button
              type="button"
              role="menuitem"
              onClick={onSignOut}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <LogOut size={14} className="text-gray-500" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
