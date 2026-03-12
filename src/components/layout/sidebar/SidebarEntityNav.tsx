"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Eye,
  Pencil,
  FlaskConical,
  HardDrive,
  BookOpen,
  FileCode,
  FileText,
  Settings,
  ClipboardList,
  CheckCircle2,
  Table as TableIcon,
  Leaf,
  StickyNote,
  Send,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SidebarEntityContext } from "./useSidebarEntity";
import { useOrderFormSteps } from "./useOrderFormSteps";

interface SidebarEntityNavProps {
  entityContext: SidebarEntityContext;
  collapsed: boolean;
}

interface SubPageDef {
  key: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  groupHeader?: string; // Section header text before this item
}

// Map icon names from form schema to lucide icon components
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText,
  Settings,
  ClipboardList,
  CheckCircle2,
  FlaskConical,
  Table: TableIcon,
  Leaf,
  Eye,
};

function resolveIcon(name?: string): React.ComponentType<{ className?: string }> {
  if (!name) return FileText;
  return iconMap[name] || FileText;
}

function getStudySubPages(id: string): SubPageDef[] {
  return [
    // Overview
    { key: "overview", label: "Overview", href: `/studies/${id}`, icon: Eye },

    // Study Metadata section
    { key: "edit", label: "Edit Study", href: `/studies/${id}/edit`, icon: Pencil, groupHeader: "Study Metadata" },
    { key: "metadata", label: "MIxS Metadata", href: `/studies/${id}/metadata`, icon: FileCode },

    // Data section
    { key: "samples", label: "Samples", href: `/studies/${id}?tab=samples`, icon: FlaskConical, groupHeader: "Data" },
    { key: "reads", label: "Read Files", href: `/studies/${id}?tab=reads`, icon: HardDrive },

    // Pipeline section
    { key: "pipelines", label: "Pipelines", href: `/studies/${id}?tab=pipelines`, icon: Workflow, groupHeader: "Pipeline" },

    // Internal section
    { key: "notes", label: "Notes", href: `/studies/${id}?tab=notes`, icon: StickyNote, groupHeader: "Internal" },
    { key: "ena", label: "ENA Submission", href: `/studies/${id}?tab=ena`, icon: Send },
  ];
}

/** Study sub-pages when no study is selected — link to /studies list */
function getStudyGlobalPages(): SubPageDef[] {
  return [
    // Data section — always accessible, shows aggregated views
    { key: "samples", label: "Samples", href: "/studies?tab=samples", icon: FlaskConical, groupHeader: "Data" },
    { key: "reads", label: "Read Files", href: "/studies?tab=reads", icon: HardDrive },

    // Pipeline section
    { key: "pipelines", label: "Pipelines", href: "/studies?tab=pipelines", icon: Workflow, groupHeader: "Pipeline" },

    // Internal section
    { key: "notes", label: "Notes", href: "/studies?tab=notes", icon: StickyNote, groupHeader: "Internal" },
  ];
}

export function SidebarEntityNav({ entityContext, collapsed }: SidebarEntityNavProps) {
  const { entityType, entityId, currentSubPage } = entityContext;
  const searchParams = useSearchParams();
  const { steps: formSteps, loading: formStepsLoading } = useOrderFormSteps();

  let subPages: SubPageDef[];
  let isStudyGlobal = false;

  if (entityType === "order" && entityId) {
    // ── Order entity nav ──
    subPages = [
      { key: "overview", label: "Overview", href: `/orders/${entityId}`, icon: Eye },
    ];

    // Dynamic form wizard steps (from form schema)
    if (!formStepsLoading && formSteps.length > 0) {
      for (let i = 0; i < formSteps.length; i++) {
        const step = formSteps[i];
        subPages.push({
          key: `step-${step.id}`,
          label: step.label,
          href: `/orders/${entityId}/edit?step=${step.id}`,
          icon: resolveIcon(step.icon),
          groupHeader: i === 0 ? "Order Form" : undefined,
        });
      }
    }

    // Extra pages
    subPages.push({
      key: "files",
      label: "Files",
      href: `/orders/${entityId}/files`,
      icon: HardDrive,
      groupHeader: "Data",
    });
    subPages.push({
      key: "studies",
      label: "Studies",
      href: `/orders/${entityId}/studies`,
      icon: BookOpen,
    });
  } else if (entityType === "study" && entityId) {
    // ── Study entity nav ──
    subPages = getStudySubPages(entityId);
  } else {
    // ── No entity selected — show study data views ──
    subPages = getStudyGlobalPages();
    isStudyGlobal = true;
  }

  if (subPages.length === 0) return null;

  // Determine which item is active
  const getIsActive = (page: SubPageDef): boolean => {
    if (isStudyGlobal) {
      // For global study items, check tab search param
      const currentTab = searchParams.get("tab");
      return currentTab === page.key;
    }
    if (entityType === "order") {
      if (page.key === "overview") {
        return currentSubPage === "overview";
      }
      if (page.key.startsWith("step-")) {
        const stepId = page.key.replace("step-", "");
        if (currentSubPage === "edit") {
          const stepParam = searchParams.get("step");
          return stepParam === stepId;
        }
        return false;
      }
      return currentSubPage === page.key;
    }
    if (entityType === "study") {
      // Overview: on /studies/[id] with no tab param
      if (page.key === "overview") {
        return currentSubPage === "overview" && !searchParams.get("tab");
      }
      // Edit/metadata: sub-page routes
      if (page.key === "edit") return currentSubPage === "edit";
      if (page.key === "metadata") return currentSubPage === "metadata";
      // Tab-based pages: check ?tab= param
      const currentTab = searchParams.get("tab");
      return currentTab === page.key;
    }
    return false;
  };

  const navIconClass = collapsed ? "h-5 w-5 shrink-0" : "h-4 w-4 shrink-0";

  return (
    <div className="space-y-0.5">
      {subPages.map((page) => {
        const isActive = getIsActive(page);

        return (
          <div key={page.key}>
            {/* Section group header */}
            {page.groupHeader && !collapsed && (
              <div className="mt-3 mb-1 px-3">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {page.groupHeader}
                </p>
              </div>
            )}
            {page.groupHeader && collapsed && (
              <div className="mx-1 my-1.5">
                <div className="h-px bg-border" />
              </div>
            )}
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={page.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm",
                      "justify-center px-0 py-2.5",
                      isActive
                        ? "bg-secondary text-foreground font-medium border-l-2 border-foreground ml-0.5"
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                    )}
                    title={page.label}
                  >
                    <page.icon className={navIconClass} />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {page.label}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Link
                href={page.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm",
                  isActive
                    ? "bg-secondary text-foreground font-medium border-l-2 border-foreground ml-0.5"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                )}
              >
                <page.icon className={navIconClass} />
                <span className="flex-1">{page.label}</span>
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
