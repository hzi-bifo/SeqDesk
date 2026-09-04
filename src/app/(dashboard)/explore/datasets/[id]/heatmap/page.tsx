"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PlotlyChart } from "@/components/explore/PlotlyChart";
import { fetcher } from "@/lib/explore/client";
import type { HeatmapPayload } from "@/lib/explore/views/heatmap/compute";
import type { ExploreDatasetDetail } from "@/lib/explore/types";

type HeatmapResponse = HeatmapPayload & { cacheToken: string; groups: string[] };

const ALL = "__all__";

export default function HeatmapPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [group, setGroup] = useState<string>(ALL);
  const [value, setValue] = useState<"log10_ra" | "ra" | "reads">("log10_ra");
  const [order, setOrder] = useState<"prevalence" | "abundance">("prevalence");
  const [nTaxa, setNTaxa] = useState<string>("35");

  const { data: detail } = useSWR<{ dataset: ExploreDatasetDetail }>(`/api/explore/datasets/${id}`, fetcher);
  const query = new URLSearchParams({ value, order, n: nTaxa });
  if (group !== ALL) query.set("group", group);
  const { data, error } = useSWR<HeatmapResponse>(`/api/explore/datasets/${id}/views/heatmap?${query.toString()}`, fetcher);

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
        colorbar: { title: { text: value === "log10_ra" ? "log10 RA %" : value === "ra" ? "RA %" : "reads" }, thickness: 12 },
        customdata: data.samples.map((sample) => `${sample.subject}, ${sample.group}, day ${sample.timepoint}`),
        hovertemplate: "%{y}<br>%{x}<br>%{customdata}<br>%{z}<extra></extra>",
      },
    ];
  }, [data, value]);

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

  return (
    <PageContainer>
      <Link href={`/explore/datasets/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        {detail?.dataset.name ?? "Dataset"}
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Sample heatmap</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Taxa by samples. Abundances are renormalized per sample after curated artifacts are removed; samples are ordered by
            specimen type, subject and study day.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className="w-44" aria-label="Specimen type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All specimen types</SelectItem>
              {(data?.groups ?? []).map((entry) => <SelectItem key={entry} value={entry}>{entry}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={value} onValueChange={(next) => setValue(next as typeof value)}>
            <SelectTrigger className="w-40" aria-label="Values"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="log10_ra">log10 abundance</SelectItem>
              <SelectItem value="ra">Relative abundance</SelectItem>
              <SelectItem value="reads">Reads</SelectItem>
            </SelectContent>
          </Select>
          <Select value={order} onValueChange={(next) => setOrder(next as typeof order)}>
            <SelectTrigger className="w-40" aria-label="Taxon order"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="prevalence">By prevalence</SelectItem>
              <SelectItem value="abundance">By abundance</SelectItem>
            </SelectContent>
          </Select>
          <Select value={nTaxa} onValueChange={setNTaxa}>
            <SelectTrigger className="w-28" aria-label="Number of taxa"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["20", "35", "50", "80", "120"].map((entry) => <SelectItem key={entry} value={entry}>{entry} taxa</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && <p className="mt-6 text-sm text-destructive">{String(error.message)}</p>}
      {!data && !error && <Skeleton className="mt-6 h-[520px] w-full" />}
      {data && data.samples.length === 0 && <p className="mt-6 text-sm text-muted-foreground">No samples match.</p>}
      {data && data.samples.length > 0 && (
        <div className="mt-6 space-y-1">
          <PlotlyChart data={groupStrip} height={40} layout={{ margin: { l: 200, r: 90, t: 4, b: 4 }, xaxis: { visible: false }, yaxis: { visible: false } }} />
          <PlotlyChart
            data={traces}
            height={Math.max(360, 18 * data.taxa.length + 120)}
            layout={{
              margin: { l: 200, r: 16, t: 8, b: 90 },
              xaxis: { title: { text: `${data.samples.length} samples` }, tickangle: -60, tickfont: { size: 9 }, automargin: true },
              yaxis: { autorange: "reversed", tickfont: { size: 10 } },
            }}
          />
          <p className="text-xs text-muted-foreground">
            {data.taxa.length} taxa shown out of {data.nSamplesTotal} samples; prevalence of the first taxon {Math.round(data.taxa[0].prevalence * 100)} %.
          </p>
        </div>
      )}
    </PageContainer>
  );
}
