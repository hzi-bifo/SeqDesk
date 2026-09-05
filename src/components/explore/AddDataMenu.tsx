"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Code2, Database, Loader2, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { fetcher, postJson } from "@/lib/explore/client";
import { DATASET_KIND_DEFINITIONS, TABLE_KIND_DEFINITIONS } from "@/lib/explore/dataset-kinds";
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
  /** Called after a table was built so the caller can refresh what it shows. */
  onBuilt?: () => void | Promise<unknown>;
  /** Show the entries that start an analysis or import a file, not only the tables built from SeqDesk data. */
  withAnalysis?: boolean;
  label?: string;
  variant?: "default" | "outline";
  className?: string;
}

/**
 * Everything that can be added to a scope, in one menu: tables built from the
 * study's samples, its sequencing runs or a pipeline output, an imported file,
 * and a new analysis. Used by the list view and the canvas alike.
 */
export function AddDataMenu({ scope, onBuilt, withAnalysis = true, label = "Add", variant = "default", className }: AddDataMenuProps) {
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant={variant} disabled={building !== null} className={className}>
          {building ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Tables from SeqDesk data</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void build("samples", undefined, "Samples")}>
          <Database className="mr-2 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">Samples</div>
            <div className="text-xs text-muted-foreground">{DATASET_KIND_DEFINITIONS.samples.description}</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void build("sequencing", undefined, "Sequencing")}>
          <Database className="mr-2 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">Sequencing</div>
            <div className="text-xs text-muted-foreground">{DATASET_KIND_DEFINITIONS.sequencing.description}</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Tables from pipeline outputs</DropdownMenuLabel>
        {pipelineTables.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No completed pipeline run of this scope produced a table output yet.</div>
        )}
        {pipelineTables.map((source) => (
          <DropdownMenuItem
            key={`${source.pipelineId}:${source.outputId}`}
            onSelect={() => void build("pipeline-table", { pipelineId: source.pipelineId, outputId: source.outputId }, source.label)}
          >
            <Database className="mr-2 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">{source.label}</div>
              <div className="text-xs text-muted-foreground">
                {TABLE_KIND_DEFINITIONS[source.tableKind]?.label ?? source.tableKind} from {source.runs.length} completed run{source.runs.length === 1 ? "" : "s"}
              </div>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/explore/datasets/import?scope=${encodeURIComponent(scope)}`}>
            <Upload className="mr-2 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">Import a table</div>
              <div className="text-xs text-muted-foreground">A TSV, CSV or Excel file from your computer</div>
            </div>
          </Link>
        </DropdownMenuItem>
        {withAnalysis && (
          <DropdownMenuItem asChild>
            <Link href={`/explore/analyses/new?scope=${encodeURIComponent(scope)}`}>
              <Code2 className="mr-2 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">New analysis</div>
                <div className="text-xs text-muted-foreground">From a template or a blank script; or press Analyse on a table card</div>
              </div>
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
