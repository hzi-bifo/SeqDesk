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

export const SIDEBAR_COLLAPSED_WIDTH = 64;
export const SIDEBAR_DEFAULT_WIDTH = 256;
export const SIDEBAR_MIN_WIDTH = 224;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_WIDTH_STORAGE_KEY = "sidebar-width";

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return SIDEBAR_DEFAULT_WIDTH;
  }

  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

interface SidebarContextType {
  collapsed: boolean;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
  toggle: () => void;
  mobileOpen: boolean;
  setMobileOpen: Dispatch<SetStateAction<boolean>>;
  sidebarWidth: number;
  setSidebarWidth: Dispatch<SetStateAction<number>>;
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
  const [sidebarWidth, setSidebarWidthValue] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [readyToPersist, setReadyToPersist] = useState(false);

  const setSidebarWidth = useCallback<Dispatch<SetStateAction<number>>>((nextWidth) => {
    setSidebarWidthValue((currentWidth) => {
      const value =
        typeof nextWidth === "function"
          ? nextWidth(currentWidth)
          : nextWidth;

      return clampSidebarWidth(value);
    });
  }, []);

  // Embedded mode uses a desktop-width default without persisting state.
  useEffect(() => {
    if (embeddedMode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(window.innerWidth < EMBEDDED_SIDEBAR_COLLAPSE_BREAKPOINT);
      setSidebarWidthValue(SIDEBAR_DEFAULT_WIDTH);
      setReadyToPersist(false);
      return;
    }

    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored) {
      setCollapsed(stored === "true");
    }

    const storedWidth = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (storedWidth) {
      setSidebarWidthValue(clampSidebarWidth(Number(storedWidth)));
    }

    setReadyToPersist(true);
  }, [embeddedMode]);

  useEffect(() => {
    if (embeddedMode || !readyToPersist) return;
    localStorage.setItem("sidebar-collapsed", String(collapsed));
  }, [collapsed, embeddedMode, readyToPersist]);

  useEffect(() => {
    if (embeddedMode || !readyToPersist) return;
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [embeddedMode, readyToPersist, sidebarWidth]);

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
    <SidebarContext.Provider
      value={{
        collapsed,
        setCollapsed,
        toggle,
        mobileOpen,
        setMobileOpen,
        sidebarWidth,
        setSidebarWidth,
      }}
    >
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
