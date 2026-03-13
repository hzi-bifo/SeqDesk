"use client";

import { usePathname, useRouter } from "next/navigation";
import { BookOpen, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OrderSelector } from "../OrderSelector";
import { StudySelector } from "../StudySelector";
import type { SidebarEntityContext } from "./useSidebarEntity";

type SidebarTab = "orders" | "studies";

interface SidebarEntitySwitcherProps {
  entityContext: SidebarEntityContext;
  collapsed: boolean;
}

export function SidebarEntitySwitcher({
  entityContext,
  collapsed,
}: SidebarEntitySwitcherProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { entityType, entityId, entityData } = entityContext;

  const studyScopedPage = pathname.startsWith("/analysis") || pathname.startsWith("/submissions");

  const activeTab: SidebarTab = pathname.startsWith("/studies")
    ? "studies"
    : pathname.startsWith("/orders")
      ? "orders"
      : studyScopedPage
        ? "studies"
      : entityType === "study"
        ? "studies"
        : "orders";

  const handleTabClick = (tab: SidebarTab) => {
    if (tab === activeTab) return;
    router.push(tab === "studies" ? "/studies" : "/orders");
  };

  const currentOrderId = entityType === "order" ? entityId : null;
  const currentOrderName = entityType === "order" ? entityData?.label ?? null : null;
  const currentStudyId = entityType === "study" ? entityId : null;
  const currentStudyTitle = entityType === "study" ? entityData?.label ?? null : null;

  if (collapsed) {
    const ActiveIcon = activeTab === "orders" ? Inbox : BookOpen;
    const activeLabel = activeTab === "orders" ? "Orders" : "Studies";

    return (
      <>
        <div className="px-2 pb-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => handleTabClick(activeTab === "orders" ? "studies" : "orders")}
                className="flex w-full items-center justify-center rounded-md bg-secondary p-1.5 text-foreground transition-colors"
              >
                <ActiveIcon className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {activeLabel} (click to switch)
            </TooltipContent>
          </Tooltip>
        </div>

        {activeTab === "orders" ? (
          <OrderSelector
            currentOrderId={currentOrderId}
            currentOrderName={currentOrderName}
            variant="sidebar"
            collapsed
          />
        ) : (
          <StudySelector
            currentStudyId={currentStudyId}
            currentStudyTitle={currentStudyTitle}
            variant="sidebar"
            collapsed
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-2">
      <div className="px-3">
        <div className="flex rounded-lg bg-secondary/50 p-0.5">
          <button
            onClick={() => handleTabClick("orders")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
              activeTab === "orders"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Inbox className="h-3.5 w-3.5" />
            Orders
          </button>
          <button
            onClick={() => handleTabClick("studies")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
              activeTab === "studies"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Studies
          </button>
        </div>
      </div>

      {activeTab === "orders" ? (
        <OrderSelector
          currentOrderId={currentOrderId}
          currentOrderName={currentOrderName}
          variant="sidebar"
        />
      ) : (
        <StudySelector
          currentStudyId={currentStudyId}
          currentStudyTitle={currentStudyTitle}
          variant="sidebar"
        />
      )}
    </div>
  );
}
