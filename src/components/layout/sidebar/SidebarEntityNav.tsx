"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  FileText,
  FlaskConical,
  HardDrive,
  Send,
  Shield,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SidebarEntityContext } from "./useSidebarEntity";
import { useOrderFormSteps } from "./useOrderFormSteps";
import {
  getOrderProgressIndicatorClassName,
  getOrderProgressIndicatorLabel,
} from "@/lib/orders/progress-status";

interface SidebarEntityNavProps {
  entityContext: SidebarEntityContext;
  collapsed: boolean;
  isDemoUser?: boolean;
  showAdminControls?: boolean;
}

interface NavItem {
  key: string;
  label: string;
  href: string | undefined;
  icon: React.ComponentType<{ className?: string }>;
  show: boolean;
}

export function SidebarEntityNav({
  entityContext,
  collapsed,
  isDemoUser = false,
  showAdminControls = false,
}: SidebarEntityNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { entityType, entityId } = entityContext;
  const { steps: orderFormSteps, facilitySections } = useOrderFormSteps(
    showAdminControls,
    entityType === "order" ? entityId : null
  );
  const facilityStep = orderFormSteps.find((step) => step.id === "_facility");
  const detailOrderSteps = orderFormSteps.filter((step) => step.id !== "_facility");
  const isEntityRoute = pathname.startsWith("/orders") || pathname.startsWith("/studies");

  // Derive active tab from URL
  const activeTab = pathname.startsWith("/studies") ? "studies" : "orders";

  // ── Study nav items ──
  const studyItems: NavItem[] = [
    { key: "overview", label: "Overview", href: entityId ? `/studies/${entityId}` : undefined, icon: FileText, show: true },
    { key: "samples", label: "Samples", href: entityId ? `/studies/${entityId}?tab=samples` : undefined, icon: FlaskConical, show: true },
    { key: "reads", label: "Read Files", href: entityId ? `/studies/${entityId}?tab=reads` : undefined, icon: HardDrive, show: !isDemoUser },
    { key: "analysis", label: "Analysis", href: entityId ? `/studies/${entityId}?tab=pipelines` : undefined, icon: Workflow, show: showAdminControls && !isDemoUser },
    { key: "archive", label: "Archive", href: entityId ? `/studies/${entityId}?tab=ena` : undefined, icon: Send, show: !isDemoUser },
  ];

  // ── Order nav items ──
  const currentOrderSubview =
    pathname.match(/^\/orders\/[^/]+\/(edit|files|sequencing|studies)$/)?.[1] ?? null;
  const requestedOrderSection = searchParams.get("section");
  const currentOrderSection =
    requestedOrderSection === "reads"
      ? "reads"
      : requestedOrderSection === "facility"
        ? "facility"
        : "overview";
  const currentOrderSubsection = searchParams.get("subsection");
  const currentOrderOverviewSubsection =
    currentOrderSection === "overview" ? currentOrderSubsection : null;
  const currentOrderFacilitySubsection =
    currentOrderSection === "facility" ? currentOrderSubsection : null;
  const currentOrderEditStep =
    currentOrderSubview === "edit" ? searchParams.get("step") : null;
  const currentOrderEditScope =
    currentOrderSubview === "edit" ? searchParams.get("scope") : null;

  const orderItems: NavItem[] = [
    { key: "details", label: "Overview", href: entityId ? `/orders/${entityId}` : undefined, icon: FileText, show: true },
    {
      key: "facility",
      label: "Facility Fields",
      href: entityId ? `/orders/${entityId}?section=facility` : undefined,
      icon: Shield,
      show: showAdminControls && !!facilityStep,
    },
    { key: "sequencing", label: "Sequencing Data", href: entityId ? `/orders/${entityId}/sequencing` : undefined, icon: HardDrive, show: showAdminControls && !isDemoUser },
  ];

  const items = activeTab === "studies" ? studyItems : orderItems;
  const hasEntity = activeTab === "studies"
    ? entityType === "study" && !!entityId
    : entityType === "order" && !!entityId;

  if (!isEntityRoute && !hasEntity) {
    return null;
  }

  // Determine active state
  const getIsActive = (item: NavItem): boolean => {
    if (!hasEntity) return false;

    if (activeTab === "studies") {
      const currentTab = searchParams.get("tab");
      if (item.key === "overview") return currentTab === null || currentTab === "overview" || currentTab === "notes";
      if (item.key === "samples") return currentTab === "samples";
      if (item.key === "reads") return currentTab === "reads";
      if (item.key === "analysis") return currentTab === "pipelines";
      if (item.key === "archive") return currentTab === "ena";
      return false;
    }

    // Orders
    if (item.key === "details") {
      if (currentOrderSubview === "edit") {
        return currentOrderEditStep !== "_facility" && currentOrderEditScope !== "facility";
      }
      return currentOrderSection === "overview" && currentOrderOverviewSubsection !== "_facility";
    }
    if (item.key === "facility") {
      return (
        currentOrderSection === "facility" ||
        currentOrderEditStep === "_facility" ||
        (currentOrderEditScope === "facility" && currentOrderEditStep === "samples")
      );
    }
    if (item.key === "sequencing") {
      return currentOrderSubview === "sequencing" || currentOrderSubview === "files" || (!currentOrderSubview && currentOrderSection === "reads");
    }
    return false;
  };

  return (
    <div className="space-y-1">
      {items
        .filter((item) => item.show)
        .map((item) => {
          const isActive = getIsActive(item);
          const isDisabled = !hasEntity;
          const shouldShowOrderSubitems =
            !collapsed &&
            activeTab === "orders" &&
            item.key === "details" &&
            !!entityId &&
            detailOrderSteps.length > 0;
          const shouldShowFacilitySubitems =
            !collapsed &&
            activeTab === "orders" &&
            item.key === "facility" &&
            !!entityId &&
            facilitySections.length > 0;

          if (isDisabled) {
            const disabledItem = (
              <span
                key={item.key}
                className={cn(
                  "flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm text-muted-foreground/40 cursor-default",
                  collapsed && "justify-center px-0 py-2"
                )}
              >
                <item.icon className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4")} />
                {!collapsed && <span className="flex-1">{item.label}</span>}
              </span>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.key}>
                  <TooltipTrigger asChild>{disabledItem}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              );
            }

            return disabledItem;
          }

          const link = (
            <Link
              key={item.key}
              href={item.href || (activeTab === "studies" ? "/studies" : "/orders")}
              className={cn(
                "flex items-center gap-3 px-3 py-1.5 rounded-lg transition-colors text-sm",
                collapsed && "justify-center px-0 py-2",
                isActive
                  ? "bg-secondary text-foreground font-medium"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
              )}
            >
              <item.icon className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4")} />
              {!collapsed && <span className="flex-1">{item.label}</span>}
            </Link>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.key}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          }

          if (!shouldShowOrderSubitems && !shouldShowFacilitySubitems) {
            return link;
          }

          return (
            <div key={item.key} className="space-y-1">
              {link}
              {shouldShowOrderSubitems && (
                <div className="ml-5 border-l border-border/70 pl-2">
                  {detailOrderSteps.map((step) => {
                    const isStepActive =
                      currentOrderSubview === "edit"
                        ? currentOrderEditStep === step.id
                        : currentOrderOverviewSubsection === step.id;
                    const indicatorStatus = step.status || "empty";
                    return (
                      <Link
                        key={step.id}
                        href={`/orders/${entityId}/edit?step=${step.id}`}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                          isStepActive
                            ? "bg-secondary text-foreground font-medium"
                            : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                        )}
                      >
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full shadow-sm",
                            getOrderProgressIndicatorClassName(indicatorStatus),
                            isStepActive && "ring-2 ring-background"
                          )}
                          aria-hidden="true"
                        />
                        <span className="truncate">{step.label}</span>
                        <span className="sr-only">
                          {getOrderProgressIndicatorLabel(indicatorStatus)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
              {shouldShowFacilitySubitems && (
                <div className="ml-5 border-l border-slate-200 pl-2">
                  {facilitySections.map((section) => {
                    const facilitySectionHref =
                      section.id === "order-fields"
                        ? `/orders/${entityId}/edit?step=_facility&scope=facility`
                        : section.id === "sample-fields"
                          ? `/orders/${entityId}/edit?step=samples&scope=facility`
                          : `/orders/${entityId}?section=facility&subsection=${section.id}`;
                    const isSectionActive =
                      currentOrderFacilitySubsection === section.id ||
                      (currentOrderEditScope === "facility" &&
                        ((section.id === "order-fields" && currentOrderEditStep === "_facility") ||
                          (section.id === "sample-fields" && currentOrderEditStep === "samples")));
                    return (
                      <Link
                        key={section.id}
                        href={facilitySectionHref}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                          isSectionActive
                            ? "bg-slate-100 text-slate-900 font-medium"
                            : "text-muted-foreground hover:bg-slate-100/80 hover:text-foreground"
                        )}
                      >
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full shadow-sm",
                            getOrderProgressIndicatorClassName(section.status),
                            isSectionActive && "ring-2 ring-background"
                          )}
                          aria-hidden="true"
                        />
                        <span className="truncate">{section.label}</span>
                        <span className="sr-only">
                          {getOrderProgressIndicatorLabel(section.status)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
