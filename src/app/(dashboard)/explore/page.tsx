"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { BookOpen, Compass, Database, FileText, FlaskConical, FolderOpen, FolderPlus, Inbox, Info, LayoutGrid, List, Loader2, Pencil, Plus, Upload } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AddDataMenu } from "@/components/explore/AddDataMenu";
import { ExploreCanvas } from "@/components/explore/ExploreCanvas";
import { ExploreReport } from "@/components/explore/ExploreReport";
import { useStoredPreference } from "@/lib/explore/use-stored-preference";
import { DATASET_KIND_DEFINITIONS, TABLE_KIND_DEFINITIONS } from "@/lib/explore/dataset-kinds";
import { fetcher, formatDateTime, postJson, SCOPE_STORAGE_KEY } from "@/lib/explore/client";
import { isValidTargetKey } from "@/lib/explore/target-key";
import type { ExploreDatasetSummary, ExploreScope } from "@/lib/explore/types";

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
  const requestedMode = searchParams.get("mode");
  const requestedView = searchParams.get("view");
  const requestedFocus = searchParams.get("focus");
  // A link from the report ("Show on canvas") names the mode, the view and the
  // card to focus. Those override the stored preference while they are in the
  // URL; the next click on a toggle stores the choice and drops them.
  const urlMode = requestedMode === "edit" || requestedMode === "report" ? requestedMode : null;
  const urlView = requestedView === "canvas" || requestedView === "list" ? requestedView : null;
  const [storedScope, setStoredScope] = useStoredPreference<string>(SCOPE_STORAGE_KEY, "");
  const [projectDialog, setProjectDialog] = useState<{ name: string; description: string } | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [view, setView] = useStoredPreference<"list" | "canvas">(VIEW_STORAGE_KEY, "list", ["list", "canvas"]);
  // The report is the final page of a scope; list and canvas are where it is made.
  // Until the user picks, a scope with outputs or a saved report opens on the report.
  const [mode, setMode] = useStoredPreference<"auto" | "report" | "edit">(MODE_STORAGE_KEY, "auto", ["auto", "report", "edit"]);

  const { data: scopesData, error: scopesError, isLoading: scopesLoading, mutate: mutateScopes } = useSWR<{ scopes: ExploreScope[] }>(
    "/api/explore/scopes",
    fetcher
  );
  const scopes = useMemo(() => scopesData?.scopes ?? [], [scopesData]);

  // The scope comes from the URL, else from the last choice, else the first study or order.
  const scope = useMemo(() => {
    if (scopes.length === 0) return null;
    const candidates = [requestedScope, storedScope].filter((value): value is string => Boolean(value && isValidTargetKey(value)));
    return candidates.find((value) => scopes.some((entry) => entry.targetKey === value)) ?? scopes[0].targetKey;
  }, [scopes, requestedScope, storedScope]);

  // The URL names the scope so the sidebar shows the study or order it belongs to.
  useEffect(() => {
    if (scope && scope !== requestedScope) router.replace(`/explore?scope=${encodeURIComponent(scope)}`);
  }, [scope, requestedScope, router]);

  const selectScope = useCallback(
    (value: string) => {
      setStoredScope(value);
      router.replace(`/explore?scope=${encodeURIComponent(value)}`);
    },
    [router, setStoredScope]
  );

  const datasetsKey = scope ? `/api/explore/datasets?targetKey=${encodeURIComponent(scope)}` : null;
  const { data: datasetsData, mutate: mutateDatasets, isLoading: datasetsLoading } = useSWR<{ datasets: ExploreDatasetSummary[] }>(
    datasetsKey,
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
  const storedMode: "report" | "edit" | null = mode === "auto" ? (reportData ? (reportReady ? "report" : "edit") : null) : mode;
  const effectiveMode = urlMode ?? storedMode;
  const activeView = urlView ?? view;
  const dropUrlOverrides = () => {
    if ((urlMode || urlView || requestedFocus) && scope) router.replace(`/explore?scope=${encodeURIComponent(scope)}`);
  };
  const chooseMode = (value: "report" | "edit") => {
    setMode(value);
    dropUrlOverrides();
  };
  const chooseView = (value: "canvas" | "list") => {
    setView(value);
    dropUrlOverrides();
  };
  const openCanvas = () => {
    chooseMode("edit");
    chooseView("canvas");
  };
  const datasets = datasetsData?.datasets ?? [];
  const analyses = analysesData?.analyses ?? [];

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
                  {activeScope.type === "study" ? (
                    <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : activeScope.type === "order" ? (
                    <Inbox className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : activeScope.type === "project" ? (
                    <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Compass className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{activeScope.label}</span>
                </span>
              ) : (
                <SelectValue placeholder={scopes.length ? "Choose a study or order" : "No studies or orders yet"} />
              )}
            </SelectTrigger>
            <SelectContent>
              {(["project", "study", "order", "workspace"] as const).map((type) => {
                const entries = scopes.filter((entry) => entry.type === type);
                if (entries.length === 0) return null;
                return (
                  <SelectGroup key={type}>
                    <SelectLabel>{type === "study" ? "Studies" : type === "order" ? "Sequencing orders" : type === "project" ? "Projects" : "Workspace"}</SelectLabel>
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
        <button
          type="button"
          onClick={() => setProjectDialog({ name: "", description: "" })}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="New project"
          title="New project: a scope of its own for tables that belong to no study or order"
        >
          <FolderPlus className="h-4 w-4" />
        </button>
        <span className="h-5 w-px bg-border" aria-hidden />
        <div className="flex rounded-md border text-xs" role="group" aria-label="Mode">
          <button type="button" onClick={() => chooseMode("report")} className={`inline-flex items-center gap-1 px-2 py-1.5 ${effectiveMode === "report" ? "bg-secondary font-medium" : "text-muted-foreground"}`} aria-pressed={effectiveMode === "report"} title="The final page: figures, tables and text for others">
            <FileText className="h-3.5 w-3.5" /> Report
          </button>
          <button type="button" onClick={() => chooseMode("edit")} className={`inline-flex items-center gap-1 px-2 py-1.5 ${effectiveMode === "edit" ? "bg-secondary font-medium" : "text-muted-foreground"}`} aria-pressed={effectiveMode === "edit"} title="Where the report is made: datasets, analyses and their outputs">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        </div>
        {effectiveMode === "edit" && (
          <div className="flex rounded-md border text-xs" role="group" aria-label="View">
            <button type="button" onClick={() => chooseView("canvas")} className={`inline-flex items-center gap-1 px-2 py-1.5 ${activeView === "canvas" ? "bg-secondary font-medium" : "text-muted-foreground"}`} aria-pressed={activeView === "canvas"} title="Cards connected by where the data came from">
              <LayoutGrid className="h-3.5 w-3.5" /> Canvas
            </button>
            <button type="button" onClick={() => chooseView("list")} className={`inline-flex items-center gap-1 px-2 py-1.5 ${activeView === "list" ? "bg-secondary font-medium" : "text-muted-foreground"}`} aria-pressed={activeView === "list"} title="Datasets and analyses as tables">
              <List className="h-3.5 w-3.5" /> List
            </button>
          </div>
        )}
        <span className="flex-1" />
        {activeScope && effectiveMode === "edit" && (
          <>
            <Button asChild variant="outline" size="sm" className="h-8" title="Import a TSV, CSV or Excel file as a table">
              <Link href={`/explore/datasets/import?scope=${encodeURIComponent(activeScope.targetKey)}`}>
                <Upload className="h-3.5 w-3.5 lg:mr-1.5" />
                <span className="hidden lg:inline">Import table</span>
              </Link>
            </Button>
            <Button asChild size="sm" className="h-8" title="Start an analysis from a template or a blank script">
              <Link href={`/explore/analyses/new?scope=${encodeURIComponent(activeScope.targetKey)}`}>
                <Plus className="h-3.5 w-3.5 lg:mr-1.5" />
                <span className="hidden lg:inline">New analysis</span>
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
              Bring study metadata, sequencing information and pipeline outputs together as tables, analyse them with code you can read, and assemble the results into a report.
            </p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              <li><span className="font-medium text-foreground">Report</span> is the final page for others: figures, tables and your text.</li>
              <li><span className="font-medium text-foreground">Edit</span> is where it is made. <span className="font-medium text-foreground">Canvas</span> shows tables, analyses and outputs as connected cards; <span className="font-medium text-foreground">List</span> lists them.</li>
            </ul>
          </PopoverContent>
        </Popover>
      </div>

      {scopesError && (
        <p className="mt-4 text-sm text-destructive">Could not load your studies and orders: {String(scopesError.message)}</p>
      )}

      {!scopesLoading && scopes.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>Explore works on a study or a sequencing order you own, or on a project of its own.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setProjectDialog({ name: "", description: "" })}>
            <FolderPlus className="mr-2 h-4 w-4" />
            New project
          </Button>
        </div>
      )}

      <Dialog open={projectDialog !== null} onOpenChange={(open) => !open && setProjectDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>A scope of its own: bring in tables, analyse them and write the report, without a study or sequencing order behind it.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!projectDialog || !projectDialog.name.trim()) return;
              setCreatingProject(true);
              try {
                const result = await postJson<{ project: { targetKey: string } }>("/api/explore/projects", { name: projectDialog.name.trim(), description: projectDialog.description.trim() || undefined });
                await mutateScopes();
                setProjectDialog(null);
                selectScope(result.project.targetKey);
                toast.success("Project created");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not create the project");
              } finally {
                setCreatingProject(false);
              }
            }}
          >
            <label className="block text-sm">
              <span className="font-medium">Name</span>
              <Input className="mt-1" value={projectDialog?.name ?? ""} onChange={(event) => setProjectDialog((current) => (current ? { ...current, name: event.target.value } : current))} placeholder="Clinical metagenomics cohort" autoFocus />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Description</span>
              <Textarea className="mt-1" rows={2} value={projectDialog?.description ?? ""} onChange={(event) => setProjectDialog((current) => (current ? { ...current, description: event.target.value } : current))} placeholder="What the tables in this project are about" />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setProjectDialog(null)} disabled={creatingProject}>Cancel</Button>
              <Button type="submit" disabled={creatingProject || !projectDialog?.name.trim()}>
                {creatingProject ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderPlus className="mr-2 h-4 w-4" />}
                Create project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {activeScope && effectiveMode === null && (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {activeScope && effectiveMode === "report" && (
        <ExploreReport scope={activeScope.targetKey} canEdit={activeScope.access === "write"} onOpenCanvas={openCanvas} />
      )}

      {activeScope && effectiveMode === "edit" && activeView === "canvas" && (
        <div className="mt-3">
          <ExploreCanvas scope={activeScope.targetKey} fillViewport focusNodeId={requestedFocus} />
        </div>
      )}

      {activeScope && effectiveMode === "edit" && activeView === "list" && (
        <div className="mt-4 space-y-10">
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">Tables</h2>
                <span className="text-sm text-muted-foreground">{datasets.length}</span>
              </div>
              <AddDataMenu scope={activeScope.targetKey} onBuilt={() => mutateDatasets()} withAnalysis={false} label="Add table" />
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
                No analyses yet. Press Analyse on a table card, or start one here from a template or a blank Python script.
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
                          {analysis.kitId && <span className="ml-2 text-xs text-muted-foreground">template {analysis.kitId}</span>}
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
