"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, BookOpen, Send, FlaskConical, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SidebarGlobalNavProps {
  collapsed: boolean;
  counts: {
    orders: number;
    studies: number;
    submissions: number;
    analysis: number;
  };
  showAdminControls: boolean;
  hasEntityContext: boolean;
  showEntityLinks?: boolean;
}

export function SidebarGlobalNav({
  collapsed,
  counts,
  showAdminControls,
  hasEntityContext,
  showEntityLinks = true,
}: SidebarGlobalNavProps) {
  const pathname = usePathname();

  const isActive = (path: string) => {
    if (path === "/admin" && pathname === "/admin") return true;
    if (path !== "/admin" && pathname.startsWith(path)) return true;
    return false;
  };

  const navIconClass = collapsed ? "h-5 w-5 shrink-0" : "h-4 w-4 shrink-0";

  const navItemClass = (path: string) =>
    cn(
      "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm",
      collapsed && "justify-center px-0 py-2.5",
      isActive(path)
        ? "bg-secondary text-foreground font-medium"
        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
      hasEntityContext && !isActive(path) && "opacity-70"
    );

  const items = [
    {
      href: "/orders",
      label: "Orders",
      icon: FileText,
      count: counts.orders,
      show: true,
      hasSubNav: true,
      isEntityLink: true,
    },
    {
      href: "/studies",
      label: "Studies",
      icon: BookOpen,
      count: counts.studies,
      show: true,
      hasSubNav: true,
      isEntityLink: true,
    },
    {
      href: "/submissions",
      label: "ENA Submissions",
      icon: Send,
      count: counts.submissions,
      show: showAdminControls,
      hasSubNav: false,
      isEntityLink: false,
    },
    {
      href: "/analysis",
      label: "Analysis",
      icon: FlaskConical,
      count: counts.analysis,
      show: true,
      hasSubNav: false,
      isEntityLink: false,
    },
  ];

  return (
    <div className="space-y-1">
      {items
        .filter((item) => item.show && (showEntityLinks || !item.isEntityLink))
        .map((item) => {
          const link = (
            <Link
              key={item.href}
              href={item.href}
              className={navItemClass(item.href)}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className={navIconClass} />
              {!collapsed && (
                <>
                  <span className="flex-1">{item.label}</span>
                  {item.count > 0 && (
                    <span className="flex items-center justify-center text-xs font-medium text-muted-foreground bg-secondary rounded-full h-5 min-w-5 px-1.5">
                      {item.count > 99 ? "99+" : item.count}
                    </span>
                  )}
                  {item.hasSubNav && (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                  )}
                </>
              )}
            </Link>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {item.label}
                  {item.count > 0 && ` (${item.count})`}
                </TooltipContent>
              </Tooltip>
            );
          }

          return link;
        })}
    </div>
  );
}
