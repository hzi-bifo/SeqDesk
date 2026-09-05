"use client";

import Link from "next/link";
import useSWR from "swr";
import { Database, FlaskConical, Plus } from "lucide-react";
import { AddDataMenu } from "@/components/explore/AddDataMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DATASET_KIND_DEFINITIONS, TABLE_KIND_DEFINITIONS } from "@/lib/explore/dataset-kinds";
import { fetcher, formatDateTime } from "@/lib/explore/client";
import type { ExploreDatasetSummary } from "@/lib/explore/types";

interface AnalysisRow {
  id: string;
  name: string;
  language: string;
  kitId: string | null;
  updatedAt: string;
  latestRun: { runNumber: string; status: string } | null;
}

/** The tables of the scope and the analysis steps of one report, as plain lists. */
export function ExploreListView({ scope, reportId }: { scope: string; reportId: string }) {
  const scopeQuery = `?scope=${encodeURIComponent(scope)}`;
  const { data: datasetsData, mutate: mutateDatasets, isLoading: datasetsLoading } = useSWR<{ datasets: ExploreDatasetSummary[] }>(
    `/api/explore/datasets?targetKey=${encodeURIComponent(scope)}`,
    fetcher
  );
  const { data: analysesData } = useSWR<{ analyses: AnalysisRow[] }>(
    `/api/explore/analyses?targetKey=${encodeURIComponent(scope)}&reportId=${encodeURIComponent(reportId)}`,
    fetcher,
    { shouldRetryOnError: false }
  );
  const datasets = datasetsData?.datasets ?? [];
  const analyses = analysesData?.analyses ?? [];

  return (
    <div className="mt-4 space-y-10">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Tables</h2>
            <span className="text-sm text-muted-foreground">{datasets.length}</span>
            <span className="text-xs text-muted-foreground">shared by every report of this scope</span>
          </div>
          <AddDataMenu scope={scope} reportId={reportId} onBuilt={() => mutateDatasets()} withAnalysis={false} label="Add table" />
        </div>

        {datasetsLoading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : datasets.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No tables yet. Add one from the samples, the sequencing runs or a pipeline output of this scope, or import a file.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 font-medium">Table</th>
                  <th className="px-3 py-2 text-right font-medium">Rows</th>
                  <th className="px-3 py-2 text-right font-medium">Version</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {datasets.map((dataset) => (
                  <tr key={dataset.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link href={`/explore/datasets/${dataset.id}${scopeQuery}`} className="font-medium text-foreground hover:underline">
                        {dataset.name}
                      </Link>
                      {dataset.sensitivity !== "standard" && (
                        <Badge variant="outline" className="ml-2">
                          {dataset.sensitivity}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary">{DATASET_KIND_DEFINITIONS[dataset.kind]?.label ?? dataset.kind}</Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{dataset.tableKind ? TABLE_KIND_DEFINITIONS[dataset.tableKind]?.label ?? dataset.tableKind : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{dataset.currentVersion?.rowCount ?? 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{dataset.currentVersion ? `v${dataset.currentVersion.number}` : ""}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDateTime(dataset.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Analysis steps</h2>
            <span className="text-sm text-muted-foreground">{analyses.length}</span>
            <span className="text-xs text-muted-foreground">of this report</span>
          </div>
          <Button asChild size="sm" variant="outline" disabled={datasets.length === 0}>
            <Link href={`/explore/analyses/new${scopeQuery}&report=${encodeURIComponent(reportId)}`}>
              <Plus className="mr-2 h-4 w-4" />
              New analysis
            </Link>
          </Button>
        </div>
        {analyses.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No analysis steps yet. Press Analyse on a table card of the canvas, or start one here from a template or a blank Python script.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Language</th>
                  <th className="px-3 py-2 font-medium">Latest run</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {analyses.map((analysis) => (
                  <tr key={analysis.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link href={`/explore/analyses/${analysis.id}${scopeQuery}`} className="font-medium hover:underline">
                        {analysis.name}
                      </Link>
                      {analysis.kitId && <span className="ml-2 text-xs text-muted-foreground">template {analysis.kitId}</span>}
                    </td>
                    <td className="px-3 py-2 capitalize text-muted-foreground">{analysis.language}</td>
                    <td className="px-3 py-2">
                      {analysis.latestRun ? (
                        <span>
                          <Badge variant="outline">{analysis.latestRun.status}</Badge> <span className="text-muted-foreground">{analysis.latestRun.runNumber}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">never run</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDateTime(analysis.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
