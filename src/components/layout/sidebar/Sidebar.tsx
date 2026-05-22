"use client";

import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { ArrowLeft, Settings } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebar,
} from "../SidebarContext";
import { useFieldHelp } from "@/lib/contexts/FieldHelpContext";
import { useSidebarEntity } from "./useSidebarEntity";

import { SidebarHeader } from "./SidebarHeader";
import { SidebarEntitySwitcher } from "./SidebarEntitySwitcher";
import { SidebarEntityNav } from "./SidebarEntityNav";
import { WorkbenchSidebarNav } from "./WorkbenchSidebarNav";
import { SidebarFieldHelp } from "./SidebarFieldHelp";
import { SidebarAdminNav } from "./SidebarAdminNav";
import { SidebarSupportNav } from "./SidebarSupportNav";
import { SidebarUserMenu } from "./SidebarUserMenu";
import { isWorkbenchAppSurface } from "@/lib/app-surface";

interface SidebarProps {
  user: {
    name?: string | null;
    email?: string | null;
    role?: string;
    isDemo?: boolean;
    demoExperience?: "researcher" | "facility";
  };
  version?: string;
}

export function Sidebar({ user, version }: SidebarProps) {
  const pathname = usePathname();
  const {
    collapsed,
    toggle,
    mobileOpen,
    setMobileOpen,
    sidebarWidth,
    setSidebarWidth,
  } = useSidebar();
  const { focusedField } = useFieldHelp();
  const entityContext = useSidebarEntity();
  const [isResizing, setIsResizing] = useState(false);
  const workbenchAppMode = isWorkbenchAppSurface();

  const isFacilityAdmin = user.role === "FACILITY_ADMIN";
  const isDemoUser = user.isDemo === true;
  const showAdminControls = isFacilityAdmin && !workbenchAppMode;

  const isAdminPage = !workbenchAppMode && (pathname.startsWith("/admin") || pathname.startsWith("/messages"));
  const appMode = workbenchAppMode ? "workbench" : "lab";
  const isWorkbenchMode = appMode === "workbench";
  const effectiveSidebarWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
  const canResize = !collapsed && !mobileOpen;
  const isResizeActive = isResizing && canResize;

  const [unreadMessages, setUnreadMessages] = useState(0);

  // Fetch unread message count
  useEffect(() => {
    const fetchUnreadCount = async () => {
      try {
        const res = await fetch("/api/tickets/unread");
        if (res.ok) {
          const data = await res.json();
          setUnreadMessages(data.count);
        }
      } catch {
        // Silently fail
      }
    };

    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, []);

  // Close mobile sidebar on navigation
  useEffect(() => {
    setMobileOpen((isOpen) => (isOpen ? false : isOpen));
  }, [pathname, setMobileOpen]);

  useEffect(() => {
    if (!isResizeActive) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizeActive]);

  const handleResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!canResize || event.button !== 0) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsResizing(true);
      setSidebarWidth(event.clientX);
    },
    [canResize, setSidebarWidth]
  );

  const handleResizePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isResizeActive) return;

      event.preventDefault();
      setSidebarWidth(event.clientX);
    },
    [isResizeActive, setSidebarWidth]
  );

  const handleResizePointerEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isResizeActive) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setIsResizing(false);
  }, [isResizeActive]);

  const handleResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 32 : 16;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSidebarWidth(sidebarWidth - step);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setSidebarWidth(sidebarWidth + step);
      } else if (event.key === "Home") {
        event.preventDefault();
        setSidebarWidth(SIDEBAR_MIN_WIDTH);
      } else if (event.key === "End") {
        event.preventDefault();
        setSidebarWidth(SIDEBAR_MAX_WIDTH);
      }
    },
    [setSidebarWidth, sidebarWidth]
  );

  return (
    <aside
      className={cn(
        "fixed top-0 left-0 bottom-0 z-40 flex flex-col overflow-hidden border-r border-border bg-card",
        isResizeActive ? "transition-none" : "transition-[width,transform] duration-300",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        "md:translate-x-0"
      )}
      style={{ width: `${effectiveSidebarWidth}px` }}
    >
      {isWorkbenchMode && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-teal-600/75" />
      )}

      {/* Header */}
      <SidebarHeader
        collapsed={collapsed}
        toggle={toggle}
        version={version}
        mode={isWorkbenchMode ? "workbench" : "lab"}
      />

      {isAdminPage && showAdminControls ? (
        <>
          {/* Admin mode: back button */}
          <div className={cn("px-3 pb-2", collapsed && "px-2")}>
            <Link
              href="/orders"
              className={cn(
                "flex items-center gap-2 w-full rounded-lg transition-colors text-sm",
                "border border-border hover:bg-secondary/50",
                collapsed ? "justify-center p-2" : "px-3 py-2"
              )}
            >
              <ArrowLeft className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4")} />
              {!collapsed && (
                <span className="text-sm font-medium">Back to App</span>
              )}
            </Link>
          </div>

          {/* Admin navigation */}
          <nav className={cn("flex-1 p-3 space-y-1 overflow-y-auto", collapsed && "px-2")}>
            <SidebarAdminNav collapsed={collapsed} unreadMessages={unreadMessages} />
          </nav>
        </>
      ) : (
        <>
          {isWorkbenchMode ? (
            <nav className={cn("flex-1 overflow-y-auto p-3 pt-0", collapsed && "px-2")}>
              <WorkbenchSidebarNav collapsed={collapsed} />
            </nav>
          ) : (
            <>
              {/* Regular lab mode: Entity Switcher */}
              <SidebarEntitySwitcher entityContext={entityContext} collapsed={collapsed} />

              {/* Navigation */}
              <nav className={cn("flex-1 p-3 space-y-1 overflow-y-auto", collapsed && "px-2")}>
                <SidebarEntityNav
                  entityContext={entityContext}
                  collapsed={collapsed}
                  isDemoUser={isDemoUser}
                  showAdminControls={showAdminControls}
                />
              </nav>

              {/* Field Help Panel */}
              {focusedField && !collapsed && (
                <div className="px-3 pb-2">
                  <SidebarFieldHelp />
                </div>
              )}

              {/* Support section - Researchers only */}
              {!isFacilityAdmin && !isDemoUser && (
                <SidebarSupportNav collapsed={collapsed} unreadMessages={unreadMessages} />
              )}
            </>
          )}
        </>
      )}

      {/* Application Settings - admin shortcut */}
      {showAdminControls && !isAdminPage && (
        <div className={cn("px-3 pb-1", collapsed && "px-2")}>
          <Link
            href="/admin/settings"
            className={cn(
              "flex items-center gap-2 w-full rounded-lg text-sm transition-colors",
              "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              collapsed ? "justify-center p-2" : "px-3 py-2"
            )}
            title={collapsed ? "Application Settings" : undefined}
          >
            <Settings className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4")} />
            {!collapsed && <span>Application Settings</span>}
          </Link>
        </div>
      )}

      {/* User Menu */}
      <SidebarUserMenu user={user} collapsed={collapsed} />

      {canResize && (
        <div
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          className={cn(
            "group absolute inset-y-0 right-0 z-50 hidden w-2 cursor-col-resize touch-none items-stretch justify-center outline-none md:flex",
            "focus-visible:bg-secondary/40",
            isResizeActive && "bg-secondary/40"
          )}
          title="Resize sidebar"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
          onKeyDown={handleResizeKeyDown}
        >
          <span
            className={cn(
              "my-3 w-px rounded-full bg-transparent transition-colors",
              isWorkbenchMode
                ? "group-hover:bg-teal-600/70 group-focus-visible:bg-teal-600/70"
                : "group-hover:bg-foreground/35 group-focus-visible:bg-foreground/45",
              isResizeActive && (isWorkbenchMode ? "bg-teal-600/80" : "bg-foreground/55")
            )}
          />
        </div>
      )}
    </aside>
  );
}
