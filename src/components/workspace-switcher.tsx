"use client";

// Sidebar-embedded workspace switcher.
//
// Locked decision (plan §10.1 / build65 layout fix): the switcher lives in
// the sidebar above the user footer, not viewport-fixed. This avoids
// overlap with right-aligned content on full-bleed pages (e.g. /email).
// Sign-out is provided by the sidebar footer — this component only handles
// workspace switching.
//
// Hides itself when the user has fewer than 2 memberships (today's prod
// reality: only multi-org accounts like Eric see this).

import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Tooltip } from "@base-ui/react/tooltip";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase";
import { switchWorkspace } from "@/lib/supabase/switch-workspace";
import { cn } from "@/lib/utils";

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

export default function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { user } = useAuth();
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

  if (!loaded || memberships.length < 2) return null;

  const active = memberships.find((m) => m.is_active);

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

  // Dropdown menu — same content for both modes; placement differs.
  // Expanded: opens upward, full-width inside the sidebar column.
  // Collapsed: opens to the right (sidebar is icon-only at lg+).
  const dropdown = open && (
    <div
      role="menu"
      className={cn(
        "absolute z-50 w-64 overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-black/5",
        collapsed ? "bottom-0 left-full ml-2" : "bottom-full left-0 right-0 mb-2 w-auto",
      )}
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
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                  isCurrent
                    ? "cursor-default bg-gray-50 font-medium text-gray-900"
                    : "text-gray-700 hover:bg-gray-50 disabled:opacity-50",
                )}
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
    </div>
  );

  if (collapsed) {
    return (
      <div className="shrink-0 px-2 py-2 border-t border-white/10">
        <div ref={containerRef} className="relative flex justify-center">
          <Tooltip.Root>
            <Tooltip.Trigger
              render={
                <button
                  type="button"
                  onClick={() => setOpen((o) => !o)}
                  aria-label={`Workspace: ${active?.organization_name ?? "Switch"}`}
                  aria-expanded={open}
                  aria-haspopup="menu"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Building2 size={18} />
                </button>
              }
            />
            <Tooltip.Portal>
              <Tooltip.Positioner side="right" sideOffset={8}>
                <Tooltip.Popup className="z-50 rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-lg ring-1 ring-white/10">
                  {active?.organization_name ?? "Workspace"}
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
          {dropdown}
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-3 py-2 border-t border-white/10">
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Switch workspace"
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors text-white/70 hover:text-white hover:bg-white/10"
        >
          <Building2 size={16} className="shrink-0 text-white/50" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">
              Workspace
            </div>
            <div className="truncate text-sm font-medium text-white/90">
              {active?.organization_name ?? "Select"}
            </div>
          </div>
          <ChevronsUpDown size={14} className="shrink-0 text-white/50" />
        </button>
        {dropdown}
      </div>
    </div>
  );
}
