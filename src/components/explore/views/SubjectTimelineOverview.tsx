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

export function MiniTimeline({ row, dayMin, dayMax, groups }: { row: SubjectsTablePayload["patients"][number]; dayMin: number; dayMax: number; groups: string[] }) {
  const span = Math.max(dayMax - dayMin, 1);
  return (
    <svg viewBox="0 0 120 12" className="h-3 w-28" aria-hidden="true">
      <line x1="0" y1="6" x2="120" y2="6" stroke="currentColor" strokeOpacity="0.15" />
      {groups.map((group, groupIndex) =>
        (row.days_by_sampletype[group] ?? []).map((day) => (
          <circle key={`${group}-${day}`} cx={((day - dayMin) / span) * 116 + 2} cy={groupIndex === 0 ? 4 : 8} r="2" fill={PALETTE[groupIndex % PALETTE.length]} />
        ))
      )}
    </svg>
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
  const groups = useMemo(() => data?.groups.slice(0, 2) ?? [], [data]);
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
        <thead className={cn("sticky top-0 bg-muted/60 text-left uppercase tracking-wide text-muted-foreground", compact ? "text-[9px]" : "text-xs")}>
          <tr>
            <th className={cn("font-medium", compact ? "px-2 py-1" : "px-3 py-1.5")}>Subject</th>
            <th className={cn("text-right font-medium", compact ? "px-1 py-1" : "px-2 py-1.5")}>Days</th>
            {!compact && <th className="px-2 py-1.5 text-right font-medium">Span</th>}
            <th className={cn("font-medium", compact ? "px-1 py-1" : "px-2 py-1.5")}>Timeline</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr
              key={row.patient}
              className={cn("border-t", onSelect && "cursor-pointer", row.patient === activeSubject ? "bg-secondary" : onSelect && "hover:bg-muted/30")}
              onClick={onSelect ? () => onSelect(row.patient) : undefined}
            >
              <td className={cn("font-medium", compact ? "px-2 py-0.5" : "px-3 py-1.5")}>
                {row.patient}
                {row.site && !compact ? <span className="ml-1 text-xs text-muted-foreground">{row.site}</span> : null}
              </td>
              <td className={cn("text-right tabular-nums", compact ? "px-1 py-0.5" : "px-2 py-1.5")}>{row.n_days}</td>
              {!compact && <td className="px-2 py-1.5 text-right tabular-nums">{row.span}</td>}
              <td className={compact ? "px-1 py-0.5" : "px-2 py-1.5"}>
                <MiniTimeline row={row} dayMin={data.day_min} dayMax={data.day_max} groups={groups} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 && <p className={cn("px-2 py-1 text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>+{hidden} more subjects</p>}
    </div>
  );
}
