"use client";

import Link from "next/link";
import { Briefcase, Network } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface WorkbenchSidebarNavProps {
  collapsed: boolean;
}

export function WorkbenchSidebarNav({ collapsed }: WorkbenchSidebarNavProps) {
  if (collapsed) {
    return (
      <div className="space-y-2">
        <div className="px-2 pb-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex h-10 w-full items-center justify-center rounded-md bg-teal-50 text-teal-800 ring-1 ring-teal-200">
                <Briefcase className="h-4 w-4" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              Private Workbench
            </TooltipContent>
          </Tooltip>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/workbench/data"
              aria-current="page"
              className="flex items-center justify-center rounded-lg bg-teal-50 p-2.5 text-teal-800 ring-1 ring-teal-200"
              title="Canvas"
            >
              <Network className="h-5 w-5 shrink-0" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            Canvas
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <>
      <div className="px-3 pb-3">
        <div className="rounded-lg border border-teal-100 bg-teal-50/60 px-3 py-2.5">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-card text-teal-700 ring-1 ring-teal-200">
              <Briefcase className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-foreground">Private Workbench</p>
                <span className="rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-teal-800">
                  Workspace
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">Personal analysis space</p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <Link
          href="/workbench/data"
          aria-current="page"
          className={cn(
            "flex items-center gap-3 rounded-lg border-l-2 border-teal-600 bg-teal-50 px-3 py-2.5 text-sm text-teal-950 transition-colors"
          )}
        >
          <Network className="h-4 w-4 shrink-0 text-teal-700" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Canvas</span>
            <span className="block truncate text-xs text-muted-foreground">Visual analysis browser</span>
          </span>
        </Link>
      </div>
    </>
  );
}
