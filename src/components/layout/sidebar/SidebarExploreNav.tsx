"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useModuleEnabled } from "@/lib/modules";

interface SidebarExploreNavProps {
  collapsed: boolean;
}

/**
 * Global entry to the Explore section. Rendered in both the lab and the
 * workbench sidebar; hidden entirely when the `explore` module is off.
 */
export function SidebarExploreNav({ collapsed }: SidebarExploreNavProps) {
  const pathname = usePathname();
  const enabled = useModuleEnabled("explore");
  if (!enabled) return null;

  const active = pathname.startsWith("/explore");
  const link = (
    <Link
      href="/explore"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        collapsed && "justify-center px-0 py-2.5",
        active
          ? "bg-secondary font-medium text-foreground"
          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
      )}
      title={collapsed ? "Explore" : undefined}
    >
      <Compass className={collapsed ? "h-5 w-5 shrink-0" : "h-4 w-4 shrink-0"} />
      {!collapsed && (
        <span className="min-w-0 flex-1">
          <span className="block">Explore</span>
          <span className="block truncate text-xs text-muted-foreground">Datasets, analyses and figures</span>
        </span>
      )}
    </Link>
  );

  return (
    <div className={cn("px-3 pb-2", collapsed && "px-2")}>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            Explore
          </TooltipContent>
        </Tooltip>
      ) : (
        link
      )}
    </div>
  );
}
