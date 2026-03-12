"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HelpCircle, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarSupportNavProps {
  collapsed: boolean;
  unreadMessages: number;
}

export function SidebarSupportNav({ collapsed, unreadMessages }: SidebarSupportNavProps) {
  const pathname = usePathname();

  const isActive = (path: string) => pathname.startsWith(path);

  const navIconClass = collapsed ? "h-5 w-5 shrink-0" : "h-4 w-4 shrink-0";

  const navItemClass = (path: string) =>
    cn(
      "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm",
      collapsed && "justify-center px-0 py-2.5",
      isActive(path)
        ? "bg-secondary text-foreground font-medium"
        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
    );

  return (
    <div className={cn("px-3 pb-2", collapsed && "px-2")}>
      <div className={cn("mb-2", collapsed ? "mx-1" : "mx-3")}>
        <div className="h-px bg-border" />
      </div>
      {!collapsed && (
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2 px-3">
          Support
        </p>
      )}
      <div className="space-y-1">
        <Link href="/help" className={navItemClass("/help")} title="Help">
          <HelpCircle className={navIconClass} />
          {!collapsed && "Help & Guide"}
        </Link>
        <Link href="/messages" className={navItemClass("/messages")} title="Support">
          <MessageSquare className={navIconClass} />
          {!collapsed && "Support"}
          {!collapsed && unreadMessages > 0 && (
            <span className="flex items-center justify-center text-xs font-medium text-white bg-foreground rounded-full ml-auto h-5 min-w-5 px-1.5">
              {unreadMessages > 9 ? "9+" : unreadMessages}
            </span>
          )}
        </Link>
      </div>
    </div>
  );
}
