"use client";

import { ReactNode } from "react";
import { SidebarProvider, useSidebar } from "./SidebarContext";
import { FieldHelpProvider } from "@/lib/contexts/FieldHelpContext";
import { Sidebar } from "./Sidebar";
import { cn } from "@/lib/utils";

interface DashboardShellProps {
  children: ReactNode;
  user: {
    name?: string | null;
    email?: string | null;
    role?: string;
  };
}

function DashboardContent({ children, user }: DashboardShellProps) {
  const { collapsed } = useSidebar();

  return (
    <>
      <Sidebar user={user} />
      <div
        className={cn(
          "min-h-screen pb-8 transition-all duration-300",
          collapsed ? "ml-16" : "ml-64"
        )}
      >
        <main>{children}</main>
      </div>
    </>
  );
}

export function DashboardShell({ children, user }: DashboardShellProps) {
  return (
    <SidebarProvider>
      <FieldHelpProvider>
        <DashboardContent user={user}>{children}</DashboardContent>
      </FieldHelpProvider>
    </SidebarProvider>
  );
}
