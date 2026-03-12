"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { FileText, BookOpen, Layers, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SidebarEntityContext } from "./useSidebarEntity";

interface EntityItem {
  id: string;
  label: string;
  sublabel: string;
  status: string;
}

interface SidebarEntitySwitcherProps {
  entityContext: SidebarEntityContext;
  collapsed: boolean;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    DRAFT: "bg-secondary text-muted-foreground",
    SUBMITTED: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    COMPLETED: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    PUBLISHED: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    READY: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  };

  return (
    <span
      className={cn(
        "text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0",
        colors[status] || "bg-secondary text-muted-foreground"
      )}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

export function SidebarEntitySwitcher({
  entityContext,
  collapsed,
}: SidebarEntitySwitcherProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [orders, setOrders] = useState<EntityItem[]>([]);
  const [studies, setStudies] = useState<EntityItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEntities = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sidebar/entities");
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
        setStudies(data.studies || []);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch entities when popover opens
  useEffect(() => {
    if (open) {
      void fetchEntities();
      setSearch("");
    }
  }, [open, fetchEntities]);

  const filteredOrders = search
    ? orders.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          o.sublabel.toLowerCase().includes(search.toLowerCase())
      )
    : orders;

  const filteredStudies = search
    ? studies.filter(
        (s) =>
          s.label.toLowerCase().includes(search.toLowerCase()) ||
          s.sublabel.toLowerCase().includes(search.toLowerCase())
      )
    : studies;

  const { entityType, entityId, entityData, isLoading: entityLoading } = entityContext;

  // Determine trigger display
  let triggerIcon = Layers;
  let triggerLabel = "Orders & Studies";
  let triggerSublabel: string | null = null;
  let contextType: string | null = null;

  if (entityType === "order" && entityData) {
    triggerIcon = FileText;
    triggerLabel = entityData.label;
    triggerSublabel = entityData.sublabel;
    contextType = "Order";
  } else if (entityType === "study" && entityData) {
    triggerIcon = BookOpen;
    triggerLabel = entityData.label;
    triggerSublabel = entityData.sublabel;
    contextType = "Study";
  } else if (entityType && entityLoading) {
    triggerIcon = entityType === "order" ? FileText : BookOpen;
    triggerLabel = "Loading...";
    contextType = entityType === "order" ? "Order" : "Study";
  }

  const TriggerIcon = triggerIcon;

  const triggerButton = (
    <button
      className={cn(
        "flex items-center gap-2 w-full rounded-lg transition-colors text-sm",
        "border border-border hover:bg-secondary/50",
        collapsed ? "justify-center p-2" : "px-3 py-2"
      )}
    >
      <TriggerIcon className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4")} />
      {!collapsed && (
        <>
          <div className="flex-1 min-w-0 text-left">
            {contextType && (
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-none mb-0.5">
                {contextType}
              </p>
            )}
            <p className="text-sm font-medium truncate leading-tight">
              {triggerLabel}
            </p>
            {triggerSublabel && !contextType && (
              <p className="text-xs text-muted-foreground truncate">
                {triggerSublabel}
              </p>
            )}
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180"
            )}
          />
        </>
      )}
    </button>
  );

  return (
    <div className={cn("px-3 pb-2", collapsed && "px-2")}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>{triggerButton}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {contextType ? `${contextType}: ${triggerLabel}` : triggerLabel}
              </TooltipContent>
            </Tooltip>
          ) : (
            triggerButton
          )}
        </PopoverTrigger>
        <PopoverContent
          className="w-[340px] p-0"
          side={collapsed ? "right" : "bottom"}
          align="start"
          sideOffset={collapsed ? 12 : 4}
        >
          {/* Search input */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search orders & studies..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-8 pl-8 pr-3 text-sm bg-transparent border border-border rounded-md outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                autoFocus
              />
            </div>
          </div>

          {/* Entity list */}
          <ScrollArea className="max-h-[300px]">
            <div className="p-1">
              {loading && orders.length === 0 && studies.length === 0 ? (
                <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                  Loading...
                </div>
              ) : (
                <>
                  {/* Orders section */}
                  {filteredOrders.length > 0 && (
                    <>
                      <p className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Orders
                      </p>
                      {filteredOrders.map((order) => (
                        <Link
                          key={order.id}
                          href={`/orders/${order.id}`}
                          className={cn(
                            "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm",
                            "hover:bg-secondary transition-colors",
                            entityType === "order" &&
                              entityId === order.id &&
                              "bg-secondary font-medium"
                          )}
                          onClick={() => setOpen(false)}
                        >
                          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1">{order.label}</span>
                          <StatusBadge status={order.status} />
                        </Link>
                      ))}
                    </>
                  )}

                  {/* Studies section */}
                  {filteredStudies.length > 0 && (
                    <>
                      <p className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider mt-1">
                        Studies
                      </p>
                      {filteredStudies.map((study) => (
                        <Link
                          key={study.id}
                          href={`/studies/${study.id}`}
                          className={cn(
                            "flex items-center gap-2 px-2 py-1.5 rounded-md text-sm",
                            "hover:bg-secondary transition-colors",
                            entityType === "study" &&
                              entityId === study.id &&
                              "bg-secondary font-medium"
                          )}
                          onClick={() => setOpen(false)}
                        >
                          <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1">{study.label}</span>
                          <StatusBadge status={study.status} />
                        </Link>
                      ))}
                    </>
                  )}

                  {filteredOrders.length === 0 && filteredStudies.length === 0 && (
                    <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                      {search ? "No results found" : "No orders or studies yet"}
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>

          {/* Footer links */}
          <div className="p-1.5 border-t border-border flex gap-1">
            <Link
              href="/orders"
              className="flex-1 text-center px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
              onClick={() => setOpen(false)}
            >
              All orders
            </Link>
            <Link
              href="/studies"
              className="flex-1 text-center px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
              onClick={() => setOpen(false)}
            >
              All studies
            </Link>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
