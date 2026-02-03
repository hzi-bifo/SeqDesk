"use client";

import { ReactNode } from "react";
import { SidebarProvider, useSidebar } from "./SidebarContext";
import { FieldHelpProvider } from "@/lib/contexts/FieldHelpContext";
import { Sidebar } from "./Sidebar";
import { UpdateBanner } from "@/components/admin/UpdateBanner";
import { cn } from "@/lib/utils";

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
  const { collapsed } = useSidebar();

  return (
    <>
      <Sidebar user={user} version={version} />
      <div
        className={cn(
          "min-h-screen pb-8 transition-all duration-300",
          collapsed ? "ml-16" : "ml-64"
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
