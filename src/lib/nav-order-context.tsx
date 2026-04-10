"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

interface NavOrderContextType {
  /** href → sort_order; empty until first fetch completes. */
  order: Map<string, number>;
  loading: boolean;
  /** Re-fetch the order from the API. Call after a save to update consumers. */
  refresh: () => Promise<void>;
}

const NavOrderContext = createContext<NavOrderContextType | null>(null);

export function NavOrderProvider({ children }: { children: ReactNode }) {
  const [order, setOrder] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/nav-order");
      if (!res.ok) return;
      const data: Array<{ href: string; sort_order: number }> = await res.json();
      const map = new Map<string, number>();
      for (const row of data) map.set(row.href, row.sort_order);
      setOrder(map);
    } catch {
      // Swallow — consumers fall back to code-default order on empty Map
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <NavOrderContext.Provider value={{ order, loading, refresh }}>
      {children}
    </NavOrderContext.Provider>
  );
}

export function useNavOrder() {
  const ctx = useContext(NavOrderContext);
  if (!ctx) {
    throw new Error("useNavOrder must be used within NavOrderProvider");
  }
  return ctx;
}
