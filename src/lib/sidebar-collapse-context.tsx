"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "sidebar-collapsed";

type SidebarCollapseContextValue = {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
};

const SidebarCollapseContext =
  createContext<SidebarCollapseContextValue | null>(null);

export function SidebarCollapseProvider({ children }: { children: ReactNode }) {
  // Initial state matches the server render (expanded) to avoid a hydration
  // mismatch. We hydrate from localStorage in an effect after mount — same
  // pattern as the email list width feature.
  const [collapsed, setCollapsedState] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "1") {
      setCollapsedState(true);
    }
  }, []);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // localStorage can throw (e.g. private browsing / quota). The in-memory
      // state still updates, so the UI remains functional for the session.
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // See note above.
      }
      return next;
    });
  }, []);

  return (
    <SidebarCollapseContext.Provider
      value={{ collapsed, toggle, setCollapsed }}
    >
      {children}
    </SidebarCollapseContext.Provider>
  );
}

export function useSidebarCollapse(): SidebarCollapseContextValue {
  const ctx = useContext(SidebarCollapseContext);
  if (!ctx) {
    throw new Error(
      "useSidebarCollapse must be used within a SidebarCollapseProvider",
    );
  }
  return ctx;
}
