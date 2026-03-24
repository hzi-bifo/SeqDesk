"use client";

import { ReactNode, useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SidebarProvider, useSidebar } from "./SidebarContext";
import { FieldHelpProvider } from "@/lib/contexts/FieldHelpContext";
import { Sidebar } from "./sidebar";
import { UpdateBanner } from "@/components/admin/UpdateBanner";
import { cn } from "@/lib/utils";
import { Menu } from "lucide-react";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { DEMO_READY_MESSAGE, isEmbeddedFrame, postDemoFrameMessage } from "@/lib/demo/client";
import { StudySelector } from "./StudySelector";
import { OrderSelector } from "./OrderSelector";
import { useSidebarEntity } from "./sidebar/useSidebarEntity";

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

function derivePageTitle(pathname: string, section: string | null): string | null {
  // Orders
  if (pathname === "/orders") return null; // list page, no title needed
  if (pathname.match(/^\/orders\/new/)) return "New Order";
  const orderMatch = pathname.match(/^\/orders\/([^/]+)(\/(.+))?$/);
  if (orderMatch) {
    const subview = orderMatch[3];
    if (subview === "files" || subview === "sequencing") return "Sequencing Data";
    if (subview === "studies") return "Studies";
    if (subview === "edit") return "Edit Order";
    if (section === "reads") return "Sequencing Data";
    return "Order Details";
  }

  // Studies
  if (pathname === "/studies") return null;
  if (pathname.match(/^\/studies\/new/)) return "New Study";
  const studyMatch = pathname.match(/^\/studies\/([^/]+)(\/(.+))?$/);
  if (studyMatch) {
    const sub = studyMatch[3];
    if (sub === "edit") return "Edit Study";
    if (sub === "metadata") return "MIxS Metadata";
    if (section === "samples") return "Samples";
    if (section === "reads") return "Read Files";
    if (section === "pipelines" || section === "analysis") return "Analysis";
    if (section === "ena" || section === "archive") return "Archive";
    return "Overview";
  }

  if (pathname === "/analysis") return "Analysis";
  if (pathname.match(/^\/analysis\/[^/]+$/)) return "Analysis Run";
  if (pathname === "/submissions") return "ENA Submissions";
  if (pathname === "/help") return "Help & Guide";
  if (pathname === "/settings") return "Settings";

  return null;
}

function DashboardContent({
  children,
  user,
  version,
  embeddedMode,
}: DashboardShellProps & { embeddedMode: boolean }) {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const entityContext = useSidebarEntity();

  const isOrdersView = pathname.startsWith("/orders");
  const isStudiesView = pathname.startsWith("/studies");
  const isAdminView = pathname.startsWith("/admin") || pathname.startsWith("/messages");
  const currentStudyId = entityContext.entityType === "study" ? entityContext.entityId : null;
  const currentOrderId = entityContext.entityType === "order" ? entityContext.entityId : null;
  const currentStudyTitle = entityContext.entityType === "study" ? entityContext.entityData?.label ?? null : null;
  const currentOrderName = entityContext.entityType === "order" ? entityContext.entityData?.label ?? null : null;

  const section = searchParams.get("section") || searchParams.get("tab");
  const pageTitle = derivePageTitle(pathname, section);
  const selectorType = isOrdersView ? "orders" : isStudiesView ? "studies" : null;

  // In embedded demo mode, reclaim the session cookie when the iframe becomes
  // visible again.  The other demo tab may have overwritten the shared
  // next-auth session cookie while this tab was hidden.
  useEffect(() => {
    if (!embeddedMode || !user.isDemo || !user.demoExperience) {
      return;
    }

    const experience = user.demoExperience;

    const handleVisibility = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      // Fire-and-forget: re-bootstrap to reclaim the cookie for this experience
      void fetch("/api/demo/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demoExperience: experience }),
      }).catch(() => {
        // Silently ignore — the user will still see whatever was last rendered
      });
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [embeddedMode, user.isDemo, user.demoExperience]);

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
        {/* Desktop top bar with entity selector + page title */}
        {!isAdminView && (selectorType || pageTitle) && (
          <div
            className={cn(
              "sticky top-0 z-20 hidden h-10 border-b border-border bg-card px-4 md:flex",
              selectorType ? "items-center" : "items-center justify-center",
            )}
          >
            {selectorType === "orders" && (
              <div className="flex-shrink-0">
                <OrderSelector
                  currentOrderId={currentOrderId}
                  currentOrderName={currentOrderName}
                  variant="topbar"
                />
              </div>
            )}
            {selectorType === "studies" && (
              <div className="flex-shrink-0">
                <StudySelector
                  currentStudyId={currentStudyId}
                  currentStudyTitle={currentStudyTitle}
                  variant="topbar"
                />
              </div>
            )}
            {pageTitle && (
              <div className={cn("min-w-0", selectorType ? "flex-1 text-center" : "text-center")}>
                <span className="text-sm font-medium text-foreground">
                  {pageTitle}
                </span>
              </div>
            )}
            {selectorType && pageTitle && <div className="flex-shrink-0 w-0" />}
          </div>
        )}

        {!user.isDemo ? <UpdateBanner /> : null}
        {user.isDemo && !embeddedMode ? (
          <DemoBanner
            embeddedMode={false}
            demoExperience={user.demoExperience === "facility" ? "facility" : "researcher"}
          />
        ) : null}
        <main>{children}</main>

        {user.isDemo && (
          <div className="fixed bottom-3 right-3 z-50 rounded-full bg-foreground/75 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-background shadow-lg backdrop-blur-sm select-none pointer-events-none">
            DEMO
          </div>
        )}
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
