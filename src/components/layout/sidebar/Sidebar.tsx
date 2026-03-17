"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { ArrowLeft, Settings } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useSidebar } from "../SidebarContext";
import { useFieldHelp } from "@/lib/contexts/FieldHelpContext";
import { useSidebarEntity } from "./useSidebarEntity";

import { SidebarHeader } from "./SidebarHeader";
import { SidebarEntitySwitcher } from "./SidebarEntitySwitcher";
import { SidebarEntityNav } from "./SidebarEntityNav";
import { SidebarFieldHelp } from "./SidebarFieldHelp";
import { SidebarAdminNav } from "./SidebarAdminNav";
import { SidebarSupportNav } from "./SidebarSupportNav";
import { SidebarUserMenu } from "./SidebarUserMenu";

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
  const { collapsed, toggle, mobileOpen, setMobileOpen } = useSidebar();
  const { focusedField } = useFieldHelp();
  const entityContext = useSidebarEntity();

  const isFacilityAdmin = user.role === "FACILITY_ADMIN";
  const isDemoUser = user.isDemo === true;
  const isFacilityDemoUser = user.demoExperience === "facility";
  const showAdminControls = isFacilityAdmin && !isFacilityDemoUser;

  const isAdminPage = pathname.startsWith("/admin") || pathname.startsWith("/messages");

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

  return (
    <aside
      className={cn(
        "fixed top-0 left-0 bottom-0 bg-card border-r border-border flex flex-col z-40 transition-all duration-300",
        collapsed ? "w-16" : "w-64",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        "md:translate-x-0"
      )}
    >
      {/* Header */}
      <SidebarHeader collapsed={collapsed} toggle={toggle} version={version} />

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
          {/* Regular mode: Entity Switcher */}
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

          {/* Support section - Researchers only */}
          {!isFacilityAdmin && !isDemoUser && (
            <SidebarSupportNav collapsed={collapsed} unreadMessages={unreadMessages} />
          )}

          {/* Field Help Panel */}
          {focusedField && !collapsed && (
            <div className="px-3 pb-2">
              <SidebarFieldHelp />
            </div>
          )}

        </>
      )}

      {/* SeqDesk Settings - admin shortcut */}
      {showAdminControls && !isAdminPage && (
        <div className={cn("px-3 pb-1", collapsed && "px-2")}>
          <Link
            href="/admin/settings"
            className={cn(
              "flex items-center gap-2 w-full rounded-lg text-sm transition-colors",
              "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              collapsed ? "justify-center p-2" : "px-3 py-2"
            )}
            title={collapsed ? "SeqDesk Settings" : undefined}
          >
            <Settings className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4")} />
            {!collapsed && <span>SeqDesk Settings</span>}
          </Link>
        </div>
      )}

      {/* User Menu */}
      <SidebarUserMenu user={user} collapsed={collapsed} />
    </aside>
  );
}
