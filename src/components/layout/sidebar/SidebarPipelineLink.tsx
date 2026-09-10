"use client";

import Link from "next/link";
import { Check, LoaderCircle, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getPipelineProgressIndicatorLabel } from "./pipelineProgress";
import type { EntityPipelineNavItem } from "./useEntityPipelines";

const compatibilityClasses = {
  compatible: "bg-slate-600 dark:bg-slate-300",
  partial: "overflow-hidden border border-slate-500 dark:border-slate-300",
  incompatible: "bg-slate-300 dark:bg-slate-600",
  unknown: "border border-slate-400 bg-transparent dark:border-slate-500",
};

export function SidebarPipelineLink({
  pipeline,
  href,
  active,
}: {
  pipeline: EntityPipelineNavItem;
  href: string;
  active: boolean;
}) {
  const { compatibility, status } = pipeline;
  const runLabel = getPipelineProgressIndicatorLabel(status);
  const RunIcon = status === "active" ? LoaderCircle : status === "complete" ? Check : X;
  const reasons = compatibility.reasons
    .map(({ count, reason }) => `${count}: ${reason}`)
    .join("; ");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
            active
              ? "bg-secondary text-foreground font-medium"
              : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
          )}
        >
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              compatibilityClasses[compatibility.status],
              active && "ring-2 ring-background"
            )}
            data-compatibility={compatibility.status}
            aria-hidden="true"
          >
            {compatibility.status === "partial" && (
              <span className="block h-full w-1/2 bg-slate-600 dark:bg-slate-300" />
            )}
          </span>
          <span className="truncate">{pipeline.name}</span>
          <span className="sr-only">
            {`. ${compatibility.summary}${reasons ? `. ${reasons}` : ""}`}
            {status !== "empty" ? `. ${runLabel}` : ""}
          </span>
          {status !== "empty" && (
            <RunIcon
              className={cn(
                "ml-auto h-3 w-3 shrink-0",
                status === "active" && "text-blue-500 motion-safe:animate-spin",
                status === "complete" && "text-emerald-600 dark:text-emerald-400",
                status === "failed" && "text-red-500"
              )}
              data-run-status={status}
              aria-hidden="true"
            />
          )}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-72 text-left">
        <p className="font-medium">{compatibility.summary}</p>
        {compatibility.reasons.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {compatibility.reasons.map(({ count, reason }) => (
              <li key={reason}>{count}: {reason}</li>
            ))}
          </ul>
        )}
        {status !== "empty" && <p className="mt-1">{runLabel}</p>}
      </TooltipContent>
    </Tooltip>
  );
}
