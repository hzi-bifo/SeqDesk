"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HeatmapView, type HeatmapResponse } from "@/components/explore/views/HeatmapView";
import { fetcher } from "@/lib/explore/client";
import type { ExploreDatasetDetail } from "@/lib/explore/types";

const ALL = "__all__";

export default function HeatmapPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [group, setGroup] = useState<string>(ALL);
  const [value, setValue] = useState<"log10_ra" | "ra" | "reads">("log10_ra");
  const [order, setOrder] = useState<"prevalence" | "abundance">("prevalence");
  const [nTaxa, setNTaxa] = useState<string>("35");

  const { data: detail } = useSWR<{ dataset: ExploreDatasetDetail }>(`/api/explore/datasets/${id}`, fetcher);
  const [loaded, setLoaded] = useState<HeatmapResponse | null>(null);

  return (
    <PageContainer>
      <Link href={`/explore/datasets/${id}?scope=${encodeURIComponent(detail?.dataset.targetKey ?? "")}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
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
              {(loaded?.groups ?? []).map((entry) => <SelectItem key={entry} value={entry}>{entry}</SelectItem>)}
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

      <div className="mt-6">
        <HeatmapView datasetId={id} options={{ group: group === ALL ? null : group, value, order, nTaxa: Number(nTaxa) }} onLoaded={setLoaded} />
      </div>
    </PageContainer>
  );
}
