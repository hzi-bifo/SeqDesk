"use client";

import { ReactNode, useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { SidebarProvider, useSidebar } from "./SidebarContext";
import { FieldHelpProvider } from "@/lib/contexts/FieldHelpContext";
import { Sidebar } from "./Sidebar";
import { UpdateBanner } from "@/components/admin/UpdateBanner";
import { cn } from "@/lib/utils";
import { Menu } from "lucide-react";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { DEMO_READY_MESSAGE, isEmbeddedFrame, postDemoFrameMessage } from "@/lib/demo/client";

interface DashboardShellProps {
  children: ReactNode;
  user: {
    name?: string | null;
    email?: string | null;
    role?: string;
    isDemo?: boolean;
  };
  version?: string;
}

const subscribeToEmbedState = () => () => {};

function DashboardContent({
  children,
  user,
  version,
  embeddedMode,
}: DashboardShellProps & { embeddedMode: boolean }) {
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
        {user.isDemo ? <DemoBanner embeddedMode={embeddedMode} /> : null}
        <main>{children}</main>
      </div>
    </>
  );
}

export function DashboardShell({ children, user, version }: DashboardShellProps) {
  const pathname = usePathname();
  const isEmbedded = useSyncExternalStore(subscribeToEmbedState, isEmbeddedFrame, () => false);
  const embeddedMode = Boolean(user.isDemo) && isEmbedded;

  useEffect(() => {
    if (embeddedMode) {
      document.body.dataset.demoEmbedded = "true";
    } else {
      delete document.body.dataset.demoEmbedded;
    }

    return () => {
      delete document.body.dataset.demoEmbedded;
    };
  }, [embeddedMode]);

  useEffect(() => {
    if (!embeddedMode) {
      return;
    }

    postDemoFrameMessage(DEMO_READY_MESSAGE, { path: pathname });
  }, [embeddedMode, pathname]);

  return (
    <SidebarProvider embeddedMode={embeddedMode}>
      <FieldHelpProvider>
        <DashboardContent
          user={user}
          version={version}
          embeddedMode={embeddedMode}
        >
          {children}
        </DashboardContent>
      </FieldHelpProvider>
    </SidebarProvider>
  );
}
