"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { BookOpen, Compass, Database, FileText, FlaskConical, Inbox, Info, LayoutGrid, List, Loader2, Pencil, Plus, Upload } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ExploreCanvas } from "@/components/explore/ExploreCanvas";
import { ExploreReport } from "@/components/explore/ExploreReport";
import { useStoredPreference } from "@/lib/explore/use-stored-preference";
import { DATASET_KIND_DEFINITIONS, TABLE_KIND_DEFINITIONS } from "@/lib/explore/dataset-kinds";
import { fetcher, formatDateTime, postJson, SCOPE_STORAGE_KEY } from "@/lib/explore/client";
import { isValidTargetKey } from "@/lib/explore/target-key";
import type { ExploreDatasetSummary, ExploreScope } from "@/lib/explore/types";

interface PipelineTableSource {
  pipelineId: string;
  pipelineName: string;
  outputId: string;
  label: string;
  tableKind: string;
  scope: string;
  runs: Array<{ id: string; runNumber: string; completedAt: string | null; selected: boolean; artifactCount: number }>;
}

interface AnalysisSummary {
  id: string;
  name: string;
  language: string;
  kitId: string | null;
  updatedAt: string;
  latestRun: { runNumber: string; status: string } | null;
}

const VIEW_STORAGE_KEY = "seqdesk:explore:view";
const MODE_STORAGE_KEY = "seqdesk:explore:mode";

export default function ExplorePage() {
  return (
    <Suspense fallback={<PageContainer><Skeleton className="h-8 w-48" /></PageContainer>}>
      <ExploreHome />
    </Suspense>
  );
}

function ExploreHome() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedScope = searchParams.get("scope");
  const [scope, setScope] = useState<string | null>(null);
  const [building, setBuilding] = useState<string | null>(null);
  const [view, setView] = useStoredPreference<"list" | "canvas">(VIEW_STORAGE_KEY, "list", ["list", "canvas"]);
  // The report is the final page of a scope; list and canvas are where it is made.
  // Until the user picks, a scope with outputs or a saved report opens on the report.
  const [mode, setMode] = useStoredPreference<"auto" | "report" | "edit">(MODE_STORAGE_KEY, "auto", ["auto", "report", "edit"]);

  const { data: scopesData, error: scopesError, isLoading: scopesLoading } = useSWR<{ scopes: ExploreScope[] }>(
    "/api/explore/scopes",
    fetcher
  );
  const scopes = useMemo(() => scopesData?.scopes ?? [], [scopesData]);

  useEffect(() => {
    if (scopes.length === 0) return;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(SCOPE_STORAGE_KEY) : null;
    const candidates = [requestedScope, scope, stored].filter((value): value is string => Boolean(value && isValidTargetKey(value)));
    const chosen = candidates.find((value) => scopes.some((entry) => entry.targetKey === value)) ?? scopes[0].targetKey;
    if (chosen !== scope) setScope(chosen);
    // The URL names the scope so the sidebar shows the study or order it belongs to.
    if (chosen !== requestedScope) router.replace(`/explore?scope=${encodeURIComponent(chosen)}`);
  }, [scopes, requestedScope, scope, router]);

  const selectScope = useCallback(
    (value: string) => {
      setScope(value);
      try {
        window.localStorage.setItem(SCOPE_STORAGE_KEY, value);
      } catch {
        // Storage may be unavailable; the URL still carries the scope.
      }
      router.replace(`/explore?scope=${encodeURIComponent(value)}`);
    },
    [router]
  );

  const datasetsKey = scope ? `/api/explore/datasets?targetKey=${encodeURIComponent(scope)}` : null;
  const { data: datasetsData, mutate: mutateDatasets, isLoading: datasetsLoading } = useSWR<{ datasets: ExploreDatasetSummary[] }>(
    datasetsKey,
    fetcher
  );
  const { data: sourcesData } = useSWR<{ pipelineTables: PipelineTableSource[] }>(
    scope ? `/api/explore/datasets/sources?targetKey=${encodeURIComponent(scope)}` : null,
    fetcher
  );
  const { data: analysesData } = useSWR<{ analyses: AnalysisSummary[] }>(
    scope ? `/api/explore/analyses?targetKey=${encodeURIComponent(scope)}` : null,
    fetcher,
    { shouldRetryOnError: false }
  );

  const activeScope = scopes.find((entry) => entry.targetKey === scope) ?? null;
  const { data: reportData } = useSWR<{ report: { id: string | null; outputs: { figures: unknown[]; tables: Array<{ output: boolean }> } } }>(
    scope ? `/api/explore/reports?targetKey=${encodeURIComponent(scope)}` : null,
    fetcher
  );
  const reportReady = Boolean(
    reportData?.report && (reportData.report.id || reportData.report.outputs.figures.length > 0 || reportData.report.outputs.tables.some((table) => table.output))
  );
  const effectiveMode: "report" | "edit" | null = mode === "auto" ? (reportData ? (reportReady ? "report" : "edit") : null) : mode;
  const openCanvas = () => {
    setMode("edit");
    setView("canvas");
  };
  const datasets = datasetsData?.datasets ?? [];
  const pipelineTables = sourcesData?.pipelineTables ?? [];
  const analyses = analysesData?.analyses ?? [];

  const build = useCallback(
    async (kind: "samples" | "sequencing" | "pipeline-table", options?: Record<string, unknown>, label?: string) => {
      if (!scope) return;
      const buildKey = `${kind}:${options?.pipelineId ?? ""}:${options?.outputId ?? ""}`;
      setBuilding(buildKey);
      try {
        const result = await postJson<{ dataset: ExploreDatasetSummary; version: { number: number; rowCount: number; unchanged: boolean }; warnings: string[] }>(
          "/api/explore/datasets/build",
          { targetKey: scope, kind, options }
        );
        await mutateDatasets();
        if (result.version.unchanged) {
          toast.info(`${label ?? result.dataset.name} is already up to date (${result.version.rowCount} rows)`);
        } else {
          toast.success(`${label ?? result.dataset.name}: version ${result.version.number} with ${result.version.rowCount} rows`);
        }
        for (const warning of result.warnings) toast.warning(warning);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Build failed");
      } finally {
        setBuilding(null);
      }
    },
    [scope, mutateDatasets]
  );

  return (
    <PageContainer className="pt-3 md:pt-3">
      {/* One slim row: what you are looking at, how you look at it, and what you can add. */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Compass className="h-4 w-4 text-muted-foreground" />
          Explore
        </h1>
        <span className="h-5 w-px bg-border" aria-hidden />
        {scopesLoading ? (
          <Skeleton className="h-8 w-56" />
        ) : (
          <Select value={scope ?? undefined} onValueChange={selectScope}>
            <SelectTrigger className="h-8 max-w-[22rem] gap-1.5 border-transparent bg-transparent px-1.5 text-sm font-medium shadow-none hover:bg-secondary" aria-label="Explore scope">
              {activeScope ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  {activeScope.type === "study" ? <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" /> : activeScope.type === "order" ? <Inbox className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Compass className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{activeScope.label}</span>
                </span>
              ) : (
                <SelectValue placeholder={scopes.length ? "Choose a study or order" : "No studies or orders yet"} />
              )}
            </SelectTrigger>
            <SelectContent>
              {(["study", "order", "workspace"] as const).map((type) => {
                const entries = scopes.filter((entry) => entry.type === type);
                if (entries.length === 0) return null;
                return (
                  <SelectGroup key={type}>
                    <SelectLabel>{type === "study" ? "Studies" : type === "order" ? "Sequencing orders" : "Workspace"}</SelectLabel>
                    {entries.map((entry) => (
                      <SelectItem key={entry.targetKey} value={entry.targetKey}>
                        {entry.label}
                        {entry.detail && <span className="ml-1.5 text-xs text-muted-foreground">{entry.detail}</span>}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                );
              })}
            </SelectContent>
          </Select>
        )}
        <span className="h-5 w-px bg-border" aria-hidden />
        <div className="flex rounded-md border text-xs" role="group" aria-label="Mode">
          <button type="button" onClick={() => setMode("report")} className={`inline-flex items-center gap-1 px-2 py-1.5 ${effectiveMode === "report" ? "bg-secondary font-medium" : "text-muted-foreground"}`} aria-pressed={effectiveMode === "report"} title="The final page: figures, tables and text for others">
            <FileText className="h-3.5 w-3.5" /> Report
          </button>
          <button type="button" onClick={() => setMode("edit")} className={`inline-flex items-center gap-1 px-2 py-1.5 ${effectiveMode === "edit" ? "bg-secondary font-medium" : "text-muted-foreground"}`} aria-pressed={effectiveMode === "edit"} title="Where the report is made: datasets, analyses and their outputs">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        </div>
        {effectiveMode === "edit" && (
          <div className="flex rounded-md border text-xs" role="group" aria-label="View">
            <button type="button" onClick={() => setView("canvas")} className={`inline-flex items-center gap-1 px-2 py-1.5 ${view === "canvas" ? "bg-secondary font-medium" : "text-muted-foreground"}`} aria-pressed={view === "canvas"} title="Cards connected by where the data came from">
              <LayoutGrid className="h-3.5 w-3.5" /> Canvas
            </button>
            <button type="button" onClick={() => setView("list")} className={`inline-flex items-center gap-1 px-2 py-1.5 ${view === "list" ? "bg-secondary font-medium" : "text-muted-foreground"}`} aria-pressed={view === "list"} title="Datasets and analyses as tables">
              <List className="h-3.5 w-3.5" /> List
            </button>
          </div>
        )}
        <span className="flex-1" />
        {activeScope && effectiveMode === "edit" && (
          <>
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link href={`/explore/datasets/import?scope=${encodeURIComponent(activeScope.targetKey)}`}>
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Import table
              </Link>
            </Button>
            <Button asChild size="sm" className="h-8">
              <Link href={`/explore/analyses/new?scope=${encodeURIComponent(activeScope.targetKey)}`}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                New analysis
              </Link>
            </Button>
          </>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="About Explore" title="About Explore">
              <Info className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 text-xs">
            <p className="font-medium">Explore</p>
            <p className="mt-1 text-muted-foreground">
              Bring study metadata, sequencing information and pipeline outputs together as datasets, analyse them with code you can read, and assemble the results into a report.
            </p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              <li><span className="font-medium text-foreground">Report</span> is the final page for others: figures, tables and your text.</li>
              <li><span className="font-medium text-foreground">Edit</span> is where it is made. <span className="font-medium text-foreground">Canvas</span> shows datasets, analyses and outputs as connected cards; <span className="font-medium text-foreground">List</span> shows them as tables.</li>
            </ul>
          </PopoverContent>
        </Popover>
      </div>

      {scopesError && (
        <p className="mt-4 text-sm text-destructive">Could not load your studies and orders: {String(scopesError.message)}</p>
      )}

      {!scopesLoading && scopes.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Explore works on studies and sequencing orders you own. Create one first, then come back here.
        </div>
      )}

      {activeScope && effectiveMode === null && (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {activeScope && effectiveMode === "report" && (
        <ExploreReport scope={activeScope.targetKey} canEdit={activeScope.access === "write"} onOpenCanvas={openCanvas} />
      )}

      {activeScope && effectiveMode === "edit" && view === "canvas" && (
        <div className="mt-3">
          <ExploreCanvas scope={activeScope.targetKey} fillViewport />
        </div>
      )}

      {activeScope && effectiveMode === "edit" && view === "list" && (
        <div className="mt-4 space-y-10">
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">Datasets</h2>
                <span className="text-sm text-muted-foreground">{datasets.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/explore/datasets/import?scope=${encodeURIComponent(activeScope.targetKey)}`}>
                    <Upload className="mr-2 h-4 w-4" />
                    Import table
                  </Link>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" disabled={building !== null}>
                      {building ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      Build dataset
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-80">
                    <DropdownMenuLabel>From SeqDesk data</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => void build("samples", undefined, "Samples")}>
                      <div>
                        <div className="font-medium">Samples</div>
                        <div className="text-xs text-muted-foreground">{DATASET_KIND_DEFINITIONS.samples.description}</div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void build("sequencing", undefined, "Sequencing")}>
                      <div>
                        <div className="font-medium">Sequencing</div>
                        <div className="text-xs text-muted-foreground">{DATASET_KIND_DEFINITIONS.sequencing.description}</div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>From pipeline outputs</DropdownMenuLabel>
                    {pipelineTables.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        No completed pipeline run of this scope produced a table output yet.
                      </div>
                    )}
                    {pipelineTables.map((source) => (
                      <DropdownMenuItem
                        key={`${source.pipelineId}:${source.outputId}`}
                        onSelect={() =>
                          void build("pipeline-table", { pipelineId: source.pipelineId, outputId: source.outputId }, source.label)
                        }
                      >
                        <div>
                          <div className="font-medium">{source.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {TABLE_KIND_DEFINITIONS[source.tableKind]?.label ?? source.tableKind} from {source.runs.length} completed run
                            {source.runs.length === 1 ? "" : "s"}
                          </div>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {datasetsLoading ? (
              <div className="mt-4 space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : datasets.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No datasets yet. Build one from the samples, the sequencing runs or a pipeline output of this scope, or import a table.
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
                          <Link href={`/explore/datasets/${dataset.id}?scope=${encodeURIComponent(activeScope.targetKey)}`} className="font-medium text-foreground hover:underline">
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
                        <td className="px-3 py-2 text-muted-foreground">
                          {dataset.tableKind ? TABLE_KIND_DEFINITIONS[dataset.tableKind]?.label ?? dataset.tableKind : ""}
                        </td>
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
                <h2 className="text-base font-semibold">Analyses</h2>
                <span className="text-sm text-muted-foreground">{analyses.length}</span>
              </div>
              <Button asChild size="sm" variant="outline" disabled={datasets.length === 0}>
                <Link href={`/explore/analyses/new?scope=${encodeURIComponent(activeScope.targetKey)}`}>
                  <Plus className="mr-2 h-4 w-4" />
                  New analysis
                </Link>
              </Button>
            </div>
            {analyses.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No analyses yet. Start one from a kit or with a blank Python script once a dataset exists.
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
                          <Link href={`/explore/analyses/${analysis.id}?scope=${encodeURIComponent(activeScope.targetKey)}`} className="font-medium hover:underline">
                            {analysis.name}
                          </Link>
                          {analysis.kitId && <span className="ml-2 text-xs text-muted-foreground">from {analysis.kitId}</span>}
                        </td>
                        <td className="px-3 py-2 capitalize text-muted-foreground">{analysis.language}</td>
                        <td className="px-3 py-2">
                          {analysis.latestRun ? (
                            <span>
                              <Badge variant="outline">{analysis.latestRun.status}</Badge>{" "}
                              <span className="text-muted-foreground">{analysis.latestRun.runNumber}</span>
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
      )}
    </PageContainer>
  );
}
