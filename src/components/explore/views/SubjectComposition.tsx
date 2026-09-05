"use client";

import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PlotlyChart } from "@/components/explore/PlotlyChart";
import { fetcher } from "@/lib/explore/client";
import type { SubjectCompositionPayload } from "@/lib/explore/views/subject-timeline/types";
import { curatedLabel } from "./HeatmapView";
import { OTHER_COLOR, PALETTE } from "./SubjectTimelineOverview";

/**
 * One subject's community composition over its sampling days in one group:
 * stacked bars of the retained taxa, as relative abundance or reads.
 */
export function SubjectCompositionPanel({
  datasetId,
  subject,
  group,
  groups,
  measure = "ra",
  height = 340,
}: {
  datasetId: string;
  subject: string;
  group: string;
  /** The primary groups of the table, so the server keeps the same taxa across panels. */
  groups: string[];
  measure?: "ra" | "reads";
  height?: number;
}) {
  const groupsParam = groups.length ? `&groups=${encodeURIComponent(groups.join(","))}` : "";
  const { data, error } = useSWR<SubjectCompositionPayload>(
    `/api/explore/datasets/${datasetId}/views/subject-timeline?part=composition&subject=${encodeURIComponent(subject)}&group=${encodeURIComponent(group)}${groupsParam}`,
    fetcher
  );
  if (error) return <p className="text-sm text-destructive">{String(error.message)}</p>;
  if (!data) return <Skeleton className="h-72 w-full" />;
  if (data.days.length === 0) return <p className="text-sm text-muted-foreground">{group}: no retained taxa on any day.</p>;
  const stacked = measure === "ra" ? data.stacked : data.stacked_reads;
  const traces = data.taxa.map((taxon, index) => ({
    type: "bar",
    name: curatedLabel(taxon, data.curated?.[taxon]),
    x: data.days.map((day) => `Day ${day}`),
    y: stacked[taxon] ?? [],
    marker: { color: taxon === "Other" ? OTHER_COLOR : PALETTE[index % PALETTE.length] },
    hovertemplate: `${taxon}<br>%{x}: %{y:.2f}${measure === "ra" ? " %" : " reads"}<extra></extra>`,
  }));
  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{group}</span>
        <span className="text-muted-foreground">{data.n_libraries} libraries, {data.collection_days.length} collection days</span>
        {data.day_support.some((day) => day.mixed_depletion) && <Badge variant="outline">mixed protocols</Badge>}
      </div>
      <PlotlyChart
        data={traces}
        height={height}
        layout={{
          barmode: "stack",
          yaxis: { title: { text: measure === "ra" ? "Relative abundance (%)" : "Assigned reads" }, rangemode: "tozero" },
          xaxis: { title: { text: "Study day" } },
          legend: { orientation: "h", y: -0.3, font: { size: 10 } },
          margin: { l: 56, r: 16, t: 8, b: 48 },
        }}
      />
    </div>
  );
}
