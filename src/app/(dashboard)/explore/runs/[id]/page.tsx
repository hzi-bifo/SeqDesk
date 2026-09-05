"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, Loader2, Square } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { CodeEditor } from "@/components/explore/CodeEditor";
import { FigureView } from "@/components/explore/FigureView";
import { fetcher, formatDateTime, postJson } from "@/lib/explore/client";

interface Artifact {
  id: string;
  kind: string;
  format: string;
  name: string;
  fileName: string | undefined;
  size: number | null;
  derivedDatasetId: string | null;
  url: string;
}

interface RunDetail {
  id: string;
  runNumber: string;
  status: string;
  executionMode: string | null;
  revisionNumber: number;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  exitCode: number | null;
  createdAt: string;
  analysis: { id: string; name: string; targetKey: string; language: "python" | "r" };
  results: { notes?: string[]; metrics?: Record<string, unknown>; warnings?: string[]; error?: string } | null;
  outputTail: string | null;
  errorTail: string | null;
  runFolder: string | null;
  code: string;
  artifacts: Artifact[];
}

const ACTIVE = new Set(["pending", "queued", "running"]);
const FIGURE_FORMATS = new Set(["plotly-json", "png", "svg", "html"]);

export default function ExploreRunPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const key = `/api/explore/runs/${id}`;
  const { data, error, mutate } = useSWR<{ run: RunDetail }>(key, fetcher, {
    refreshInterval: (latest) => (latest?.run && ACTIVE.has(latest.run.status) ? 4000 : 0),
  });
  const run = data?.run ?? null;
  const active = run ? ACTIVE.has(run.status) : false;
  const { data: logs } = useSWR<{ status: string; outputTail: string | null; errorTail: string | null }>(active ? `${key}/logs` : null, fetcher, {
    refreshInterval: 3000,
  });
  const [cancelling, setCancelling] = useState(false);

  const cancel = useCallback(async () => {
    setCancelling(true);
    try {
      await postJson(`${key}/cancel`);
      await mutate();
      toast.success("Run cancelled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel the run");
    } finally {
      setCancelling(false);
    }
  }, [key, mutate]);

  if (error) return <PageContainer><p className="text-sm text-destructive">Could not load the run: {String(error.message)}</p></PageContainer>;
  if (!run) return <PageContainer><Skeleton className="h-8 w-64" /><Skeleton className="mt-4 h-64 w-full" /></PageContainer>;

  const outputTail = logs?.outputTail ?? run.outputTail;
  const errorTail = logs?.errorTail ?? run.errorTail;
  const figures = run.artifacts.filter((artifact) => artifact.kind === "figure" && FIGURE_FORMATS.has(artifact.format));
  const tables = run.artifacts.filter((artifact) => artifact.kind === "table");
  const reports = run.artifacts.filter((artifact) => artifact.kind === "report" || (artifact.kind === "figure" && !FIGURE_FORMATS.has(artifact.format)));

  return (
    <PageContainer>
      <Link href={`/explore/analyses/${run.analysis.id}?scope=${encodeURIComponent(run.analysis.targetKey)}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        {run.analysis.name}
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{run.runNumber}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={run.status === "completed" ? "secondary" : "outline"}>{run.status}</Badge>
            {active && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <span className="text-muted-foreground">version {run.revisionNumber}</span>
            {run.executionMode && <span className="text-muted-foreground">{run.executionMode}</span>}
            {run.exitCode !== null && <span className="text-muted-foreground">exit code {run.exitCode}</span>}
            <span className="text-muted-foreground">
              {run.startedAt ? `started ${formatDateTime(run.startedAt)}` : run.queuedAt ? `queued ${formatDateTime(run.queuedAt)}` : ""}
              {run.completedAt ? `, finished ${formatDateTime(run.completedAt)}` : ""}
            </span>
          </div>
        </div>
        {active && (
          <Button variant="outline" size="sm" onClick={() => void cancel()} disabled={cancelling}>
            {cancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}
            Cancel
          </Button>
        )}
      </div>

      {run.results?.error && <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{run.results.error}</p>}
      {run.results?.warnings && run.results.warnings.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {run.results.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      <Tabs defaultValue={run.status === "completed" ? "outputs" : "logs"} className="mt-6">
        <TabsList>
          <TabsTrigger value="outputs">Outputs ({run.artifacts.length})</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="code">Code</TabsTrigger>
        </TabsList>

        <TabsContent value="outputs" className="mt-4 space-y-6">
          {run.artifacts.length === 0 && (
            <p className="text-sm text-muted-foreground">{active ? "Outputs appear here when the run finishes." : "This run produced no outputs."}</p>
          )}
          {run.results?.metrics && Object.keys(run.results.metrics).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(run.results.metrics).map(([metric, value]) => (
                <div key={metric} className="rounded-md border px-3 py-1.5 text-sm">
                  <span className="text-muted-foreground">{metric}</span> <span className="font-medium tabular-nums">{String(value)}</span>
                </div>
              ))}
            </div>
          )}
          {run.results?.notes && run.results.notes.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {run.results.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
          {figures.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {figures.map((artifact) => (
                <FigureView key={artifact.id} url={artifact.url} format={artifact.format as "plotly-json"} title={artifact.name} height={380} />
              ))}
            </div>
          )}
          {tables.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">Tables</h3>
              <ul className="mt-2 divide-y rounded-lg border text-sm">
                {tables.map((artifact) => (
                  <li key={artifact.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <span className="font-medium">{artifact.name}</span>
                    <span className="text-xs text-muted-foreground">{artifact.fileName}{artifact.size !== null ? `, ${Math.round(artifact.size / 1024)} KB` : ""}</span>
                    <span className="flex-1" />
                    {artifact.derivedDatasetId && (
                      <Link href={`/explore/datasets/${artifact.derivedDatasetId}`} className="text-sm underline">Open as table</Link>
                    )}
                    <a href={`${artifact.url}?download=1`} className="text-sm underline" download>Download</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {reports.length > 0 && (
            <div className="space-y-4">
              {reports.map((artifact) => (
                <FigureView key={artifact.id} url={artifact.url} format={artifact.format as "html"} title={artifact.name} height={480} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="logs" className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">Standard output</h3>
            <pre className="mt-2 max-h-[480px] overflow-auto rounded-md border bg-muted/40 p-3 text-xs">{outputTail || "(empty)"}</pre>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Standard error</h3>
            <pre className="mt-2 max-h-[480px] overflow-auto rounded-md border bg-muted/40 p-3 text-xs">{errorTail || "(empty)"}</pre>
          </div>
          {run.runFolder && <p className="text-xs text-muted-foreground lg:col-span-2">Run folder: <span className="font-mono">{run.runFolder}</span></p>}
        </TabsContent>

        <TabsContent value="code" className="mt-4">
          <p className="mb-2 text-xs text-muted-foreground">The exact code of version {run.revisionNumber} that this run executed.</p>
          <CodeEditor value={run.code} language={run.analysis.language} readOnly height="520px" ariaLabel="Executed code" />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
