"use client";

import Link from "next/link";
import { PanelLeftClose } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppMode } from "./app-mode";

interface SidebarHeaderProps {
  collapsed: boolean;
  toggle: () => void;
  version?: string;
  mode?: AppMode;
}

export function SidebarHeader({
  collapsed,
  toggle,
  version,
  mode = "lab",
}: SidebarHeaderProps) {
  const isWorkbench = mode === "workbench";

  return (
    <div className={cn("p-3", collapsed && "px-2")}>
      <div className="flex items-center justify-between">
        {collapsed ? (
          <button
            onClick={toggle}
            className="flex items-center justify-center w-full py-0.5"
            title={isWorkbench ? "Expand SeqDesk Bench sidebar" : "Expand sidebar"}
          >
            <span
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-semibold",
                isWorkbench ? "bg-teal-700 text-white" : "bg-foreground text-background",
              )}
            >
              {isWorkbench ? "B" : "S"}
            </span>
          </button>
        ) : (
          <>
            <Link
              href={isWorkbench ? "/workbench/data" : "/orders"}
              className="flex min-w-0 items-center gap-2.5"
            >
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-2.5 py-1 text-sm font-semibold",
                  isWorkbench ? "bg-teal-700 text-white" : "bg-foreground text-background",
                )}
              >
                SeqDesk
              </span>
              {isWorkbench && (
                <span className="truncate text-sm font-semibold text-teal-800">
                  Bench
                </span>
              )}
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
