"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

const EMBEDDED_SIDEBAR_COLLAPSE_BREAKPOINT = 1180;

interface SidebarContextType {
  collapsed: boolean;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
  toggle: () => void;
  mobileOpen: boolean;
  setMobileOpen: Dispatch<SetStateAction<boolean>>;
}

export const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({
  children,
  embeddedMode = false,
}: {
  children: ReactNode;
  embeddedMode?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Embedded mode uses a desktop-width default without persisting state.
  useEffect(() => {
    if (embeddedMode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(window.innerWidth < EMBEDDED_SIDEBAR_COLLAPSE_BREAKPOINT);
      return;
    }

    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored) {
      setCollapsed(stored === "true");
    }
  }, [embeddedMode]);

  useEffect(() => {
    if (embeddedMode) return;
    localStorage.setItem("sidebar-collapsed", String(collapsed));
  }, [collapsed, embeddedMode]);

  // Close mobile sidebar on route changes or resize past breakpoint
  const handleResize = useCallback(() => {
    if (window.innerWidth >= 768) {
      setMobileOpen(false);
    }

    if (embeddedMode) {
      setCollapsed(window.innerWidth < EMBEDDED_SIDEBAR_COLLAPSE_BREAKPOINT);
    }
  }, [embeddedMode]);

  useEffect(() => {
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

  const toggle = () => {
    setCollapsed((current) => !current);
  };

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, toggle, mobileOpen, setMobileOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}
