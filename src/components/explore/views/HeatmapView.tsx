"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { Skeleton } from "@/components/ui/skeleton";
import { PlotlyChart } from "@/components/explore/PlotlyChart";
import { fetcher } from "@/lib/explore/client";
import type { HeatmapPayload } from "@/lib/explore/views/heatmap/compute";

export type HeatmapResponse = HeatmapPayload & { cacheToken: string; groups: string[] };

export interface HeatmapOptions {
  group?: string | null;
  value?: "log10_ra" | "ra" | "reads";
  order?: "prevalence" | "abundance";
  nTaxa?: number;
}

export function heatmapQuery(options: HeatmapOptions): string {
  const query = new URLSearchParams({ value: options.value ?? "log10_ra", order: options.order ?? "prevalence", n: String(options.nTaxa ?? 35) });
  if (options.group) query.set("group", options.group);
  return query.toString();
}

/**
 * Taxa by samples for one table. `compact` draws a small, static version for
 * cards; otherwise the full interactive chart with the group strip above it.
 */
export function HeatmapView({ datasetId, options = {}, compact = false, height, onLoaded }: { datasetId: string; options?: HeatmapOptions; compact?: boolean; height?: number; onLoaded?: (data: HeatmapResponse) => void }) {
  const query = heatmapQuery(compact ? { ...options, nTaxa: Math.min(options.nTaxa ?? 20, 20) } : options);
  const { data, error } = useSWR<HeatmapResponse>(`/api/explore/datasets/${datasetId}/views/heatmap?${query}`, fetcher, onLoaded ? { onSuccess: onLoaded } : undefined);
  const value = options.value ?? "log10_ra";

  const traces = useMemo(() => {
    if (!data) return [];
    return [
      {
        type: "heatmap",
        z: data.values,
        x: data.samples.map((sample) => sample.sample),
        y: data.taxa.map((taxon) => taxon.taxon),
        colorscale: "Viridis",
        hoverongaps: false,
        showscale: !compact,
        colorbar: { title: { text: value === "log10_ra" ? "log10 RA %" : value === "ra" ? "RA %" : "reads" }, thickness: 12 },
        customdata: data.samples.map((sample) => `${sample.subject}, ${sample.group}, day ${sample.timepoint}`),
        hovertemplate: "%{y}<br>%{x}<br>%{customdata}<br>%{z}<extra></extra>",
      },
    ];
  }, [data, value, compact]);

  const groupStrip = useMemo(() => {
    if (!data) return [];
    const groups = [...new Set(data.samples.map((sample) => sample.group))];
    return [
      {
        type: "heatmap",
        z: [data.samples.map((sample) => groups.indexOf(sample.group))],
        x: data.samples.map((sample) => sample.sample),
        y: ["group"],
        showscale: false,
        colorscale: "Portland",
        hovertemplate: "%{x}<extra></extra>",
      },
    ];
  }, [data]);

  if (error) return <p className="text-sm text-destructive">{String(error.message)}</p>;
  if (!data) return <Skeleton className={compact ? "h-full w-full" : "h-[520px] w-full"} />;
  if (data.samples.length === 0) return <p className="text-sm text-muted-foreground">No samples match.</p>;

  if (compact) {
    return (
      <PlotlyChart
        data={traces}
        height={height ?? 160}
        staticPlot
        layout={{ margin: { l: 4, r: 4, t: 4, b: 4 }, xaxis: { visible: false }, yaxis: { visible: false, autorange: "reversed" } }}
        className="w-full"
      />
    );
  }

  return (
    <div className="space-y-1">
      <PlotlyChart data={groupStrip} height={40} layout={{ margin: { l: 200, r: 90, t: 4, b: 4 }, xaxis: { visible: false }, yaxis: { visible: false } }} />
      <PlotlyChart
        data={traces}
        height={height ?? Math.max(360, 18 * data.taxa.length + 120)}
        layout={{
          margin: { l: 200, r: 16, t: 8, b: 90 },
          xaxis: { title: { text: `${data.samples.length} samples` }, tickangle: -60, tickfont: { size: 9 }, automargin: true },
          yaxis: { autorange: "reversed", tickfont: { size: 10 } },
        }}
      />
      <p className="text-xs text-muted-foreground">
        {data.taxa.length} taxa across {data.nSamplesTotal} samples; the first taxon is present in {Math.round(data.taxa[0].prevalence * 100)} % of them.
      </p>
    </div>
  );
}
