"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/explore/client";
import { cn } from "@/lib/utils";
import type { SubjectsTablePayload } from "@/lib/explore/views/subject-timeline/types";

export type SubjectsResponse = SubjectsTablePayload & { cacheToken: string; groups: string[]; dropped: { missingKeys: number; control: number; isolate: number } };

export const PALETTE = [
  "#4C72B0", "#DD8452", "#55A868", "#C44E52", "#8172B3", "#937860", "#DA8BC3", "#8C8C8C", "#CCB974", "#64B5CD",
  "#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD", "#8C564B", "#E377C2", "#7F7F7F", "#BCBD22",
];
export const OTHER_COLOR = "#d9d9d9";

/** Text exported as a missing value by pandas and friends is treated as missing. */
function present(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed && !/^(none|nan|na|null|n\/a)$/i.test(trimmed) ? trimmed : null;
}

/**
 * One subject's sampling days on a shared day axis, one lane per specimen group.
 * Dots are laid out in percent so the timeline fills whatever width the column has.
 */
export function MiniTimeline({ row, dayMin, dayMax, groups, compact = false }: { row: SubjectsTablePayload["patients"][number]; dayMin: number; dayMax: number; groups: string[]; compact?: boolean }) {
  const span = Math.max(dayMax - dayMin, 1);
  const dot = compact ? "h-2 w-2" : "h-2.5 w-2.5";
  return (
    <div className={cn("relative w-full min-w-[7rem]", compact ? "h-4" : "h-6")} aria-hidden="true">
      <div className="absolute inset-x-1 top-1/2 border-t border-border" />
      {groups.map((group, groupIndex) =>
        (row.days_by_sampletype[group] ?? []).map((day) => (
          <span
            key={`${group}-${day}`}
            title={`${group}, day ${day}`}
            className={cn("absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-background", dot)}
            style={{ left: `${4 + ((day - dayMin) / span) * 92}%`, top: groups.length > 1 ? `${28 + (44 * groupIndex) / (groups.length - 1)}%` : "50%", backgroundColor: PALETTE[groupIndex % PALETTE.length] }}
          />
        ))
      )}
    </div>
  );
}

/**
 * Every subject of a table as one row with its sampling days: the overview
 * of the subject timeline. The page adds selection and the per-subject panels;
 * cards and the report show it as it is.
 */
export function SubjectTimelineOverview({
  datasetId,
  filter = "",
  limit,
  compact = false,
  activeSubject = null,
  onSelect,
  onLoaded,
  className,
}: {
  datasetId: string;
  filter?: string;
  limit?: number;
  compact?: boolean;
  activeSubject?: string | null;
  onSelect?: (subject: string) => void;
  onLoaded?: (data: SubjectsResponse) => void;
  className?: string;
}) {
  const { data, error } = useSWR<SubjectsResponse>(`/api/explore/datasets/${datasetId}/views/subject-timeline?part=subjects`, fetcher, onLoaded ? { onSuccess: onLoaded } : undefined);
  const groups = useMemo(() => data?.groups ?? [], [data]);
  const visible = useMemo(() => {
    const lower = filter.trim().toLowerCase();
    const rows = (data?.patients ?? []).filter((row) => !lower || row.patient.toLowerCase().includes(lower));
    return typeof limit === "number" ? rows.slice(0, limit) : rows;
  }, [data, filter, limit]);

  if (error) return <p className="text-sm text-destructive">{String(error.message)}</p>;
  if (!data) {
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-full" />
      </div>
    );
  }
  const hidden = data.patients.length - visible.length;

  return (
    <div className={className}>
      <table className={cn("w-full", compact ? "text-[11px]" : "text-sm")}>
        <thead className={cn("sticky top-0 z-10 bg-card text-left uppercase tracking-wide text-muted-foreground shadow-[inset_0_-1px_0_0_hsl(var(--border))]", compact ? "text-[9px]" : "text-xs")}>
          <tr>
            <th className={cn("font-medium", compact ? "px-2 py-1" : "px-3 py-1.5")}>Subject</th>
            <th className={cn("text-right font-medium", compact ? "px-1 py-1" : "px-2 py-1.5")}>Days</th>
            {!compact && <th className="px-2 py-1.5 text-right font-medium">Span</th>}
            <th className={cn("w-full font-medium", compact ? "px-1 py-1" : "px-2 py-1.5")}>
              <span className="flex items-center gap-2">
                <span>Timeline</span>
                {!compact && <span className="normal-case tracking-normal">day {data.day_min} to {data.day_max}</span>}
                {!compact && groups.map((group, index) => (
                  <span key={group} className="inline-flex items-center gap-1 normal-case tracking-normal">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: PALETTE[index % PALETTE.length] }} />
                    {group}
                  </span>
                ))}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr
              key={row.patient}
              className={cn("border-t", onSelect && "cursor-pointer", row.patient === activeSubject ? "bg-secondary" : onSelect && "hover:bg-muted/30")}
              onClick={onSelect ? () => onSelect(row.patient) : undefined}
            >
              <td className={cn("whitespace-nowrap font-medium", compact ? "px-2 py-0.5" : "px-3 py-1.5")}>
                {row.patient}
                {present(row.site) && !compact ? <span className="ml-1 text-xs text-muted-foreground">{present(row.site)}</span> : null}
              </td>
              <td className={cn("text-right tabular-nums", compact ? "px-1 py-0.5" : "px-2 py-1.5")}>{row.n_days}</td>
              {!compact && <td className="px-2 py-1.5 text-right tabular-nums">{row.span}</td>}
              <td className={compact ? "px-1 py-0.5" : "px-2 py-1.5"}>
                <MiniTimeline row={row} dayMin={data.day_min} dayMax={data.day_max} groups={groups} compact={compact} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 && <p className={cn("px-2 py-1 text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>+{hidden} more subjects</p>}
    </div>
  );
}
