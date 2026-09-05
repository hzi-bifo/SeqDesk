"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { ElementStore, type StoreGroup } from "@/components/explore/ElementStore";
import { fetcher, postJson } from "@/lib/explore/client";
import { TABLE_KIND_DEFINITIONS } from "@/lib/explore/dataset-kinds";
import type { ExploreDatasetSummary } from "@/lib/explore/types";

export interface PipelineTableSource {
  pipelineId: string;
  pipelineName: string;
  outputId: string;
  label: string;
  tableKind: string;
  scope: string;
  runs: Array<{ id: string; runNumber: string; completedAt: string | null; selected: boolean; artifactCount: number }>;
}

interface AddDataMenuProps {
  scope: string;
  /** The report a new analysis becomes a step of. */
  reportId?: string;
  /** Called after a table was built so the caller can refresh what it shows. */
  onBuilt?: () => void | Promise<unknown>;
  /** Show the entries that start an analysis or import a file, not only the tables built from SeqDesk data. */
  withAnalysis?: boolean;
  label?: string;
  variant?: "default" | "outline";
  className?: string;
}

/**
 * Everything that can be added to a scope, as tiles in one picker: tables
 * built from the study's samples, its sequencing runs or a pipeline output, an
 * imported file, and a new analysis. Used by the list view and the canvas alike.
 */
export function AddDataMenu({ scope, reportId, onBuilt, withAnalysis = true, label = "Add", variant = "default", className }: AddDataMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [building, setBuilding] = useState<string | null>(null);
  const { data: sourcesData } = useSWR<{ pipelineTables: PipelineTableSource[] }>(`/api/explore/datasets/sources?targetKey=${encodeURIComponent(scope)}`, fetcher);
  const pipelineTables = sourcesData?.pipelineTables ?? [];

  const build = async (kind: "samples" | "sequencing" | "pipeline-table", options?: Record<string, unknown>, name?: string) => {
    const buildKey = `${kind}:${options?.pipelineId ?? ""}:${options?.outputId ?? ""}`;
    setBuilding(buildKey);
    try {
      const result = await postJson<{ dataset: ExploreDatasetSummary; version: { number: number; rowCount: number; unchanged: boolean }; warnings: string[] }>(
        "/api/explore/datasets/build",
        { targetKey: scope, kind, options }
      );
      await onBuilt?.();
      if (result.version.unchanged) {
        toast.info(`${name ?? result.dataset.name} is already up to date (${result.version.rowCount} rows)`);
      } else {
        toast.success(`${name ?? result.dataset.name}: version ${result.version.number} with ${result.version.rowCount} rows`);
      }
      for (const warning of result.warnings) toast.warning(warning);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not build the table");
    } finally {
      setBuilding(null);
    }
  };

  const groups: StoreGroup[] = [
    {
      label: "Tables from this study or order",
      items: [
        { id: "samples", title: "Samples", hint: "One row per sample with its metadata", sketch: "samples", onSelect: () => void build("samples", undefined, "Samples") },
        { id: "sequencing", title: "Sequencing", hint: "One row per sample and sequencing run", sketch: "sequencing", onSelect: () => void build("sequencing", undefined, "Sequencing") },
      ],
    },
    {
      label: "Tables from pipeline outputs",
      empty: "No completed pipeline run of this scope produced a table output yet.",
      items: pipelineTables.map((source) => ({
        id: `${source.pipelineId}:${source.outputId}`,
        title: source.label,
        hint: `${TABLE_KIND_DEFINITIONS[source.tableKind]?.label ?? source.tableKind}, ${source.runs.length} completed run${source.runs.length === 1 ? "" : "s"}`,
        sketch: "pipeline" as const,
        badge: source.pipelineName,
        onSelect: () => void build("pipeline-table", { pipelineId: source.pipelineId, outputId: source.outputId }, source.label),
      })),
    },
    {
      label: "Bring your own",
      items: [
        { id: "import", title: "Import a file", hint: "TSV, CSV or Excel from your computer", sketch: "import", onSelect: () => router.push(`/explore/datasets/import?scope=${encodeURIComponent(scope)}`) },
        ...(withAnalysis
          ? [{ id: "analysis", title: "New analysis", hint: "From a template or a blank script", sketch: "analysis" as const, onSelect: () => router.push(`/explore/analyses/new?scope=${encodeURIComponent(scope)}${reportId ? `&report=${encodeURIComponent(reportId)}` : ""}`) }]
          : []),
      ],
    },
  ];

  return (
    <>
      <Button size="sm" variant={variant} disabled={building !== null} className={className} onClick={() => setOpen(true)}>
        {building ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
        {label}
      </Button>
      <ElementStore open={open} onOpenChange={setOpen} title="Add to this scope" description="Pick what to bring in. Tables become cards on the canvas; an analysis turns them into figures and tables." groups={groups} />
    </>
  );
}
