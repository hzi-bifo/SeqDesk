"use client";

import Link from "next/link";
import { PanelLeftClose } from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarHeaderProps {
  collapsed: boolean;
  toggle: () => void;
  version?: string;
}

export function SidebarHeader({ collapsed, toggle, version }: SidebarHeaderProps) {
  return (
    <div className={cn("p-3", collapsed && "px-2")}>
      <div className="flex items-center justify-between">
        {collapsed ? (
          <button
            onClick={toggle}
            className="flex items-center justify-center w-full py-0.5"
            title="Expand sidebar"
          >
            <span className="inline-flex items-center justify-center h-8 w-8 bg-foreground text-background text-sm font-semibold rounded-md">
              S
            </span>
          </button>
        ) : (
          <>
            <Link href="/orders" className="flex items-center gap-2.5">
              <span className="inline-flex items-center px-2.5 py-1 bg-foreground text-background text-sm font-semibold rounded-md">
                SeqDesk
              </span>
              {version && (
                <span className="text-[10px] leading-none text-muted-foreground font-geist-pixel">
                  v{version}
                </span>
              )}
            </Link>
            <button
              onClick={toggle}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
