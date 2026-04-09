"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { createClient } from "@/lib/supabase";
import type { JobStatus, DamageType } from "@/lib/types";

// Fallback defaults used before DB data loads
const DEFAULT_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  new: { bg: "#FAEEDA", text: "#633806" },
  in_progress: { bg: "#E1F5EE", text: "#085041" },
  pending_invoice: { bg: "#EEEDFE", text: "#3C3489" },
  completed: { bg: "#F1EFE8", text: "#5F5E5A" },
  cancelled: { bg: "#F1EFE8", text: "#5F5E5A" },
};

const DEFAULT_STATUS_LABELS: Record<string, string> = {
  new: "New",
  in_progress: "In Progress",
  pending_invoice: "Pending Invoice",
  completed: "Completed",
  cancelled: "Cancelled",
};

const DEFAULT_DAMAGE_COLORS: Record<string, { bg: string; text: string }> = {
  water: { bg: "#E6F1FB", text: "#0C447C" },
  fire: { bg: "#FAECE7", text: "#712B13" },
  mold: { bg: "#EAF3DE", text: "#27500A" },
  storm: { bg: "#EEEDFE", text: "#3C3489" },
  biohazard: { bg: "#FCEBEB", text: "#791F1F" },
  contents: { bg: "#FFF8E6", text: "#7A5E00" },
  rebuild: { bg: "#F1EFE8", text: "#5F5E5A" },
  other: { bg: "#F1EFE8", text: "#5F5E5A" },
};

const DEFAULT_DAMAGE_LABELS: Record<string, string> = {
  water: "Water",
  fire: "Fire",
  mold: "Mold",
  storm: "Storm",
  biohazard: "Biohazard",
  contents: "Contents",
  rebuild: "Rebuild",
  other: "Other",
};

interface ConfigContextType {
  statuses: JobStatus[];
  damageTypes: DamageType[];
  loading: boolean;
  refresh: () => Promise<void>;
  getStatusColor: (name: string) => string;
  getStatusLabel: (name: string) => string;
  getDamageTypeColor: (name: string) => string;
  getDamageTypeLabel: (name: string) => string;
}

const ConfigContext = createContext<ConfigContextType | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState<JobStatus[]>([]);
  const [damageTypes, setDamageTypes] = useState<DamageType[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [statusRes, damageRes] = await Promise.all([
      supabase.from("job_statuses").select("*").order("sort_order"),
      supabase.from("damage_types").select("*").order("sort_order"),
    ]);
    if (statusRes.data) setStatuses(statusRes.data as JobStatus[]);
    if (damageRes.data) setDamageTypes(damageRes.data as DamageType[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function getStatusColor(name: string): string {
    const s = statuses.find((st) => st.name === name);
    if (s) return `bg-[${s.bg_color}] text-[${s.text_color}] ring-1 ring-[${s.text_color}]/20`;
    const d = DEFAULT_STATUS_COLORS[name];
    if (d) return `bg-[${d.bg}] text-[${d.text}] ring-1 ring-[${d.text}]/20`;
    return "bg-muted text-muted-foreground ring-1 ring-border";
  }

  function getStatusLabel(name: string): string {
    const s = statuses.find((st) => st.name === name);
    if (s) return s.display_label;
    return DEFAULT_STATUS_LABELS[name] || name;
  }

  function getDamageTypeColor(name: string): string {
    const dt = damageTypes.find((d) => d.name === name);
    if (dt) return `bg-[${dt.bg_color}] text-[${dt.text_color}] ring-1 ring-[${dt.text_color}]/20`;
    const d = DEFAULT_DAMAGE_COLORS[name];
    if (d) return `bg-[${d.bg}] text-[${d.text}] ring-1 ring-[${d.text}]/20`;
    return "bg-muted text-muted-foreground ring-1 ring-border";
  }

  function getDamageTypeLabel(name: string): string {
    const dt = damageTypes.find((d) => d.name === name);
    if (dt) return dt.display_label;
    return DEFAULT_DAMAGE_LABELS[name] || name;
  }

  return (
    <ConfigContext.Provider
      value={{
        statuses,
        damageTypes,
        loading,
        refresh,
        getStatusColor,
        getStatusLabel,
        getDamageTypeColor,
        getDamageTypeLabel,
      }}
    >
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) {
    throw new Error("useConfig must be used within ConfigProvider");
  }
  return ctx;
}
