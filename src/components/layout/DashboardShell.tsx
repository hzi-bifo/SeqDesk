"use client";

import { ReactNode } from "react";
import { SidebarProvider, useSidebar } from "./SidebarContext";
import { FieldHelpProvider } from "@/lib/contexts/FieldHelpContext";
import { Sidebar } from "./Sidebar";
import { UpdateBanner } from "@/components/admin/UpdateBanner";
import { cn } from "@/lib/utils";
import { Menu } from "lucide-react";

interface DashboardShellProps {
  children: ReactNode;
  user: {
    name?: string | null;
    email?: string | null;
    role?: string;
  };
  version?: string;
}

function DashboardContent({ children, user, version }: DashboardShellProps) {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar();

  return (
    <>
      <Sidebar user={user} version={version} />

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile top bar */}
      <div className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 bg-card border-b border-border md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-1.5 -ml-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="inline-flex items-center px-2 py-0.5 bg-foreground text-background text-xs font-semibold rounded-md">
          SeqDesk
        </span>
      </div>

      <div
        className={cn(
          "min-h-screen pb-8 transition-all duration-300",
          // Desktop: offset by sidebar width
          "md:transition-[margin-left]",
          collapsed ? "md:ml-16" : "md:ml-64"
        )}
      >
        <UpdateBanner />
        <main>{children}</main>
      </div>
    </>
  );
}

export function DashboardShell({ children, user, version }: DashboardShellProps) {
  return (
    <SidebarProvider>
      <FieldHelpProvider>
        <DashboardContent user={user} version={version}>
          {children}
        </DashboardContent>
      </FieldHelpProvider>
    </SidebarProvider>
  );
}
