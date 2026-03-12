"use client";

import Link from "next/link";
import { useRef, useState, useEffect } from "react";
import { LogOut, Settings, ChevronUp, Shield } from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";

interface SidebarUserMenuProps {
  user: {
    name?: string | null;
    email?: string | null;
    role?: string;
    isDemo?: boolean;
    demoExperience?: "researcher" | "facility";
  };
  collapsed: boolean;
}

export function SidebarUserMenu({ user, collapsed }: SidebarUserMenuProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const isFacilityAdmin = user.role === "FACILITY_ADMIN";
  const isDemoUser = user.isDemo === true;
  const isFacilityDemoUser = user.demoExperience === "facility";
  const userRoleLabel = isFacilityDemoUser
    ? "Facility Demo"
    : isFacilityAdmin
      ? "Facility Admin"
      : isDemoUser
        ? "Researcher Demo"
        : "Researcher";

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    await signOut({ redirect: false });
    window.location.href = "/login";
  };

  return (
    <div
      className={cn("p-4 border-t border-border relative", collapsed && "p-2")}
      ref={userMenuRef}
    >
      {/* User menu dropdown - expanded */}
      {userMenuOpen && !collapsed && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden">
          <Link
            href="/settings"
            onClick={() => setUserMenuOpen(false)}
            className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-secondary transition-colors"
          >
            <Settings className="h-4 w-4" />
            Account Settings
          </Link>
          {isFacilityAdmin && !isFacilityDemoUser && (
            <Link
              href="/admin"
              onClick={() => setUserMenuOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-secondary transition-colors"
            >
              <Shield className="h-4 w-4" />
              Administration
            </Link>
          )}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors w-full text-left text-red-600"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}

      {/* User menu dropdown - collapsed */}
      {collapsed && userMenuOpen && (
        <div className="absolute bottom-full left-2 right-2 mb-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden w-48">
          <div className="px-4 py-2 border-b border-border">
            <p className="text-sm font-medium truncate">{user.name}</p>
            <p className="text-xs text-muted-foreground">{userRoleLabel}</p>
          </div>
          <Link
            href="/settings"
            onClick={() => setUserMenuOpen(false)}
            className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-secondary transition-colors"
          >
            <Settings className="h-4 w-4" />
            Account Settings
          </Link>
          {isFacilityAdmin && !isFacilityDemoUser && (
            <Link
              href="/admin"
              onClick={() => setUserMenuOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-secondary transition-colors"
            >
              <Shield className="h-4 w-4" />
              Administration
            </Link>
          )}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors w-full text-left text-red-600"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}

      <button
        onClick={() => setUserMenuOpen(!userMenuOpen)}
        className={cn(
          "flex items-center gap-3 w-full rounded-xl p-2 hover:bg-secondary transition-colors",
          collapsed && "justify-center p-1.5"
        )}
        title={collapsed ? (user.name || "User") : undefined}
      >
        <div
          className={cn(
            "rounded-full flex items-center justify-center text-sm font-medium bg-foreground text-background shrink-0",
            collapsed ? "h-8 w-8" : "h-9 w-9"
          )}
        >
          {user.name?.charAt(0) || "U"}
        </div>
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-xs text-muted-foreground truncate">{userRoleLabel}</p>
            </div>
            <ChevronUp
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform shrink-0",
                userMenuOpen && "rotate-180"
              )}
            />
          </>
        )}
      </button>
    </div>
  );
}
