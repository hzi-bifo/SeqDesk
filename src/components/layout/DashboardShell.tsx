"use client";

import { ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SidebarProvider, useSidebar } from "./SidebarContext";
import { FieldHelpProvider } from "@/lib/contexts/FieldHelpContext";
import { Sidebar } from "./Sidebar";
import { StudySelector } from "./StudySelector";
import { OrderSelector } from "./OrderSelector";
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
    demoExperience?: "researcher" | "facility";
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
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Detect which view we're in
  const isOrdersView = pathname.startsWith("/orders");
  const isAdminView = pathname.startsWith("/admin") || pathname.startsWith("/messages");

  // Detect current study from URL
  const studyDetailMatch = pathname.match(/^\/studies\/([^/]+)$/);
  const currentStudyId = studyDetailMatch?.[1] ?? null;
  const [currentStudyTitle, setCurrentStudyTitle] = useState<string | null>(null);

  // Detect current order from URL
  const orderDetailMatch = pathname.match(/^\/orders\/([^/]+)(?:\/(files|studies))?$/);
  const rawOrderId = orderDetailMatch?.[1] ?? null;
  const currentOrderId = rawOrderId && rawOrderId !== "new" ? rawOrderId : null;
  const [currentOrderName, setCurrentOrderName] = useState<string | null>(null);

  useEffect(() => {
    if (!currentStudyId) {
      setCurrentStudyTitle(null);
      return;
    }

    let mounted = true;
    const fetchTitle = async () => {
      try {
        const res = await fetch(`/api/studies/${currentStudyId}`);
        if (res.ok) {
          const data = await res.json();
          if (mounted) setCurrentStudyTitle(data.title);
        }
      } catch {
        if (mounted) setCurrentStudyTitle(null);
      }
    };

    void fetchTitle();
    return () => { mounted = false; };
  }, [currentStudyId]);

  useEffect(() => {
    if (!currentOrderId) {
      setCurrentOrderName(null);
      return;
    }

    let mounted = true;
    const fetchName = async () => {
      try {
        const res = await fetch(`/api/orders/${currentOrderId}`);
        if (res.ok) {
          const data = await res.json();
          if (mounted) setCurrentOrderName(data.name);
        }
      } catch {
        if (mounted) setCurrentOrderName(null);
      }
    };

    void fetchName();
    return () => { mounted = false; };
  }, [currentOrderId]);

  // Derive page title for the centered top bar label
  // Sidebar links use ?section= for both orders and studies
  const section = searchParams.get("section");

  const derivePageTitle = (): string | null => {
    if (currentOrderId) {
      // Order sub-pages
      const orderSubPath = pathname.replace(/^\/orders\/[^/]+\/?/, "");
      if (orderSubPath === "files") return "Manage Files";
      if (orderSubPath === "studies") return "Studies";
      if (orderSubPath === "samples") return "Samples";
      if (orderSubPath.startsWith("edit")) return "Edit Order";
      if (section === "reads") return "Read Files";
      return "Order Details";
    }
    if (currentStudyId) {
      // Study sub-pages
      const studySubPath = pathname.replace(/^\/studies\/[^/]+\/?/, "");
      if (studySubPath === "edit") return "Edit Study";
      if (studySubPath === "metadata") return "MIxS Metadata";
      if (section === "samples") return "Samples";
      if (section === "reads") return "Read Files";
      if (section === "analysis") return "Analysis";
      if (section === "pipelines") return "Pipelines";
      if (section === "notes") return "Notes";
      if (section === "ena") return "ENA Submission";
      if (section === "archive") return "Archive";
      return "Overview";
    }
    return null;
  };

  const pageTitle = derivePageTitle();

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
        {/* Desktop top bar with context - hidden on admin pages */}
        {!isAdminView && (
          <div className="sticky top-0 z-20 hidden md:flex items-center h-10 border-b border-border bg-card px-4">
            <div className="flex-shrink-0">
              {isOrdersView ? (
                <OrderSelector
                  currentOrderId={currentOrderId}
                  currentOrderName={currentOrderName}
                  variant="topbar"
                />
              ) : (
                <StudySelector
                  currentStudyId={currentStudyId}
                  currentStudyTitle={currentStudyTitle}
                  variant="topbar"
                />
              )}
            </div>
            {pageTitle && (
              <div className="flex-1 text-center">
                <span className="text-sm font-medium text-foreground">
                  {pageTitle}
                </span>
              </div>
            )}
            {/* Balance spacer for centering */}
            {pageTitle && <div className="flex-shrink-0 w-0" />}
          </div>
        )}

        {!user.isDemo ? <UpdateBanner /> : null}
        {user.isDemo ? (
          <DemoBanner
            embeddedMode={embeddedMode}
            demoExperience={user.demoExperience === "facility" ? "facility" : "researcher"}
          />
        ) : null}
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
