"use client";

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

interface SidebarContextValue {
  collapsed: boolean;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  toggle: () => {},
});

const STORAGE_KEY = "sellup-sidebar-collapsed";

// Helper: Get initial state from localStorage (SSR-safe)
function getInitialCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false; // SSR: default to expanded
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "true";
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  // Initialize state from localStorage synchronously during render
  // Eliminates hydration mismatch and avoids setState in effect
  const [collapsed, setCollapsed] = useState(getInitialCollapsed());

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      // Persist to localStorage immediately
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  return (
    <SidebarContext.Provider value={{ collapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
