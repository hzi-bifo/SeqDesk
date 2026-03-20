"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Building2,
  FileText,
  FlaskConical,
  HardDrive,
  Send,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SidebarEntityContext } from "./useSidebarEntity";
import { useOrderFormSteps } from "./useOrderFormSteps";
import { useOrderPipelines } from "./useOrderPipelines";
import { useStudyFormSteps } from "./useStudyFormSteps";
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
  const {
    overviewSections: studyOverviewSections,
    facilitySections: studyFacilitySections,
  } = useStudyFormSteps(showAdminControls, entityType === "study" ? entityId : null);
  const orderPipelines = useOrderPipelines(
    showAdminControls,
    entityType === "order" ? entityId : null
  );
  const facilityStep = orderFormSteps.find((step) => step.id === "_facility");
  const detailOrderSteps = orderFormSteps.filter((step) => step.id !== "_facility");
  const isEntityRoute = pathname.startsWith("/orders") || pathname.startsWith("/studies");

  // Derive active tab from URL
  const activeTab = pathname.startsWith("/studies") ? "studies" : "orders";
  const currentStudyTab = searchParams.get("tab");
  const currentStudySubview =
    pathname.match(/^\/studies\/[^/]+\/(facility|edit|metadata)$/)?.[1] ?? null;
  const currentStudySection =
    currentStudySubview === "facility" || searchParams.get("section") === "facility"
      ? "facility"
      : "overview";
  const currentStudySubsection = searchParams.get("subsection");
  const currentStudyOverviewSubsection =
    currentStudySection === "overview" ? currentStudySubsection : null;
  const currentStudyFacilitySubsection =
    currentStudySection === "facility" ? currentStudySubsection : null;

  // ── Study nav items ──
  const studyItems: NavItem[] = [
    { key: "overview", label: "Overview", href: entityId ? `/studies/${entityId}` : undefined, icon: FileText, show: true },
    {
      key: "facility",
      label: "Facility Fields",
      href: entityId ? `/studies/${entityId}/facility` : undefined,
      icon: Building2,
      show: showAdminControls && studyFacilitySections.length > 0,
    },
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
      icon: Building2,
      show: showAdminControls && !!facilityStep,
    },
    { key: "sequencing", label: "Sequencing Data", href: entityId ? `/orders/${entityId}/sequencing` : undefined, icon: HardDrive, show: showAdminControls && !isDemoUser },
    { key: "analysis", label: "Analysis", href: entityId ? `/orders/${entityId}/sequencing?view=analysis` : undefined, icon: FlaskConical, show: showAdminControls && !isDemoUser && orderPipelines.length > 0 },
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
      const isStudyOverviewTab =
        currentStudySubview === null &&
        (currentStudyTab === null || currentStudyTab === "overview" || currentStudyTab === "notes");
      if (item.key === "overview") return isStudyOverviewTab && currentStudySection === "overview";
      if (item.key === "facility") return currentStudySubview === "facility";
      if (item.key === "samples") return currentStudyTab === "samples";
      if (item.key === "reads") return currentStudyTab === "reads";
      if (item.key === "analysis") return currentStudyTab === "pipelines";
      if (item.key === "archive") return currentStudyTab === "ena";
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
      const hasPipelineParam = !!searchParams.get("pipeline");
      const hasAnalysisView = searchParams.get("view") === "analysis";
      return (currentOrderSubview === "sequencing" && !hasPipelineParam && !hasAnalysisView) || currentOrderSubview === "files" || (!currentOrderSubview && currentOrderSection === "reads");
    }
    if (item.key === "analysis") {
      return currentOrderSubview === "sequencing" && (!!searchParams.get("pipeline") || searchParams.get("view") === "analysis");
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
          const shouldShowStudyOverviewSubitems =
            !collapsed &&
            activeTab === "studies" &&
            item.key === "overview" &&
            !!entityId &&
            studyOverviewSections.length > 0;
          const shouldShowStudyFacilitySubitems =
            !collapsed &&
            activeTab === "studies" &&
            item.key === "facility" &&
            !!entityId &&
            studyFacilitySections.length > 0;
          const shouldShowFacilitySubitems =
            !collapsed &&
            activeTab === "orders" &&
            item.key === "facility" &&
            !!entityId &&
            facilitySections.length > 0;
          const shouldShowSequencingDataSubitems =
            !collapsed &&
            activeTab === "orders" &&
            item.key === "sequencing" &&
            !!entityId;
          const shouldShowSequencingSubitems =
            !collapsed &&
            activeTab === "orders" &&
            item.key === "analysis" &&
            !!entityId &&
            orderPipelines.length > 0;

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

          if (
            !shouldShowOrderSubitems &&
            !shouldShowFacilitySubitems &&
            !shouldShowSequencingDataSubitems &&
            !shouldShowSequencingSubitems &&
            !shouldShowStudyOverviewSubitems &&
            !shouldShowStudyFacilitySubitems
          ) {
            return link;
          }

          return (
            <div key={item.key} className="space-y-1">
              {link}
              {shouldShowStudyOverviewSubitems && (
                <div className="ml-5 border-l border-border/70 pl-2">
                  {studyOverviewSections.map((section) => {
                    const isSectionActive =
                      currentStudyOverviewSubsection === section.id;
                    return (
                      <Link
                        key={section.id}
                        href={`/studies/${entityId}?subsection=${section.id}`}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                          isSectionActive
                            ? "bg-secondary text-foreground font-medium"
                            : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
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
              {shouldShowStudyFacilitySubitems && (
                <div className="ml-5 border-l border-slate-200 pl-2">
                  {studyFacilitySections.map((section) => {
                    const isSectionActive =
                      currentStudyFacilitySubsection === section.id;
                    return (
                      <Link
                        key={section.id}
                        href={`/studies/${entityId}/facility?subsection=${section.id}`}
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
              {shouldShowSequencingDataSubitems && (() => {
                const seqSubItems = [
                  { id: "overview", label: "Overview", href: `/orders/${entityId}/sequencing` },
                  { id: "discover", label: "Associate", href: `/orders/${entityId}/sequencing?view=discover` },
                ];
                return (
                  <div className="ml-5 border-l border-border/70 pl-2">
                    {seqSubItems.map((sub) => {
                      const isSubActive =
                        sub.id === "discover"
                          ? currentOrderSubview === "sequencing" && searchParams.get("view") === "discover"
                          : currentOrderSubview === "sequencing" && !searchParams.get("view") && !searchParams.get("pipeline");
                      return (
                        <Link
                          key={sub.id}
                          href={sub.href}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                            isSubActive
                              ? "bg-secondary text-foreground font-medium"
                              : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                          )}
                        >
                          <span className="h-2 w-2 rounded-full shadow-sm bg-slate-300" aria-hidden="true" />
                          <span className="truncate">{sub.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                );
              })()}
              {shouldShowSequencingSubitems && (
                <div className="ml-5 border-l border-border/70 pl-2">
                  {orderPipelines.map((pipeline) => {
                    const isPipelineActive =
                      currentOrderSubview === "sequencing" &&
                      searchParams.get("pipeline") === pipeline.pipelineId;
                    return (
                      <Link
                        key={pipeline.pipelineId}
                        href={`/orders/${entityId}/sequencing?pipeline=${encodeURIComponent(pipeline.pipelineId)}`}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                          isPipelineActive
                            ? "bg-secondary text-foreground font-medium"
                            : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                        )}
                      >
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full shadow-sm",
                            getOrderProgressIndicatorClassName(pipeline.status),
                            isPipelineActive && "ring-2 ring-background"
                          )}
                          aria-hidden="true"
                        />
                        <span className="truncate">{pipeline.name}</span>
                        <span className="sr-only">
                          {getOrderProgressIndicatorLabel(pipeline.status)}
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
