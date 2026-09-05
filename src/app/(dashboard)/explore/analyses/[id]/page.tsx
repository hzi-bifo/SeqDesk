"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, GitCompare, Loader2, Play, Save, Trash2 } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { CodeDiff } from "@/components/explore/CodeDiff";
import { CodeEditor } from "@/components/explore/CodeEditor";
import { FigureView } from "@/components/explore/FigureView";
import { ParamsForm, type ParamsSchema } from "@/components/explore/ParamsForm";
import { fetcher, formatDateTime, postJson } from "@/lib/explore/client";
import type { AnalysisDetail, RevisionSummary, RunSummary } from "@/lib/explore/analyses";
import type { ExploreDatasetSummary } from "@/lib/explore/types";

interface KitSummary {
  id: string;
  params?: ParamsSchema;
}

interface RunDetail extends RunSummary {
  artifacts: Array<{ id: string; kind: string; format: string; name: string; url: string; derivedDatasetId: string | null }>;
  results: { notes?: string[]; metrics?: Record<string, unknown>; warnings?: string[] } | null;
}

const STATUS_VARIANT: Record<string, "secondary" | "outline"> = { completed: "secondary" };

export default function ExploreAnalysisPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const key = `/api/explore/analyses/${id}`;
  const { data, error, mutate } = useSWR<{ analysis: AnalysisDetail }>(key, fetcher, { refreshInterval: 15000 });
  const analysis = data?.analysis ?? null;
  const { data: datasetsData } = useSWR<{ datasets: ExploreDatasetSummary[] }>(
    analysis ? `/api/explore/datasets?targetKey=${encodeURIComponent(analysis.targetKey)}` : null,
    fetcher
  );
  const { data: kitsData } = useSWR<{ kits: KitSummary[] }>("/api/explore/kits", fetcher);
  const { data: environmentsData } = useSWR<{ environments: Array<{ name: string; status: string }> }>("/api/explore/environments", fetcher);
  const latestRunId = analysis?.latestRun?.id ?? null;
  const { data: latestRunData } = useSWR<{ run: RunDetail }>(latestRunId ? `/api/explore/runs/${latestRunId}` : null, fetcher, {
    refreshInterval: analysis?.latestRun && ["pending", "queued", "running"].includes(analysis.latestRun.status) ? 5000 : 0,
  });

  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});
  const [compare, setCompare] = useState<{ a: string; b: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (analysis) {
      setCode(analysis.code);
      setParamValues(analysis.currentRevision?.params ?? {});
    }
  }, [analysis?.currentRevision?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const kit = useMemo(() => kitsData?.kits.find((entry) => entry.id === analysis?.kitId) ?? null, [kitsData, analysis?.kitId]);
  const datasets = datasetsData?.datasets ?? [];
  const environment = environmentsData?.environments.find((entry) => entry.name === analysis?.environmentName) ?? null;
  const dirty = analysis ? code !== analysis.code : false;

  const saveRevision = useCallback(
    async (extra?: { params?: Record<string, unknown> }) => {
      setBusy("save");
      try {
        await postJson(`${key}/revisions`, { code, params: extra?.params ?? paramValues, message: message.trim() || undefined });
        setMessage("");
        await mutate();
        toast.success("New revision saved");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not save the revision");
      } finally {
        setBusy(null);
      }
    },
    [key, code, paramValues, message, mutate]
  );

  const run = useCallback(async () => {
    setBusy("run");
    try {
      if (dirty) await postJson(`${key}/revisions`, { code, params: paramValues, message: "Saved before run" });
      const result = await postJson<{ run: RunSummary }>(`${key}/runs`, {});
      await mutate();
      toast.success(`Run ${result.run.runNumber} started`);
      router.push(`/explore/runs/${result.run.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the run");
    } finally {
      setBusy(null);
    }
  }, [dirty, key, code, paramValues, mutate, router]);

  const remove = useCallback(async () => {
    if (!analysis || !window.confirm(`Delete "${analysis.name}" with all revisions and runs?`)) return;
    setBusy("delete");
    try {
      await postJson(key, undefined, "DELETE");
      toast.success("Analysis deleted");
      router.push(`/explore?scope=${encodeURIComponent(analysis.targetKey)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
      setBusy(null);
    }
  }, [analysis, key, router]);

  const setEnvironment = useCallback(
    async (environmentName: string) => {
      try {
        await postJson(key, { environmentName }, "PATCH");
        await mutate();
        toast.success("Environment updated");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not update the environment");
      }
    },
    [key, mutate]
  );

  if (error) {
    return <PageContainer><p className="text-sm text-destructive">Could not load the analysis: {String(error.message)}</p></PageContainer>;
  }
  if (!analysis) {
    return <PageContainer><Skeleton className="h-8 w-64" /><Skeleton className="mt-4 h-64 w-full" /></PageContainer>;
  }

  const revisionsById = new Map(analysis.revisions.map((revision) => [revision.id, revision] as const));
  const latestRun = latestRunData?.run ?? null;
  const latestFigures = latestRun?.artifacts.filter((artifact) => artifact.kind === "figure" && ["plotly-json", "png", "svg", "html"].includes(artifact.format)) ?? [];

  return (
    <PageContainer>
      <Link href={`/explore?scope=${encodeURIComponent(analysis.targetKey)}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Explore
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{analysis.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className="capitalize">{analysis.language}</Badge>
            {analysis.kitId && <Badge variant="secondary">kit {analysis.kitId}</Badge>}
            <Badge variant="outline">{analysis.environmentName}</Badge>
            {environment && environment.status !== "ready" && (
              <span className="text-amber-700">
                environment {environment.status}, <Link href="/explore/environments" className="underline">manage</Link>
              </span>
            )}
            {analysis.currentRevision && <span className="text-muted-foreground">revision {analysis.currentRevision.number}</span>}
          </div>
          {analysis.description && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{analysis.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void run()} disabled={busy !== null || (environment !== null && environment.status !== "ready")}>
            {busy === "run" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Run
          </Button>
          <Button variant="outline" size="sm" onClick={() => void remove()} disabled={busy !== null}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="mt-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="code">Code{dirty ? " (unsaved)" : ""}</TabsTrigger>
          <TabsTrigger value="runs">Runs ({analysis.runs.length})</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border p-4 text-sm">
              <h3 className="font-semibold">Inputs</h3>
              {analysis.currentRevision && analysis.currentRevision.inputs.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {analysis.currentRevision.inputs.map((binding) => {
                    const dataset = datasets.find((entry) => entry.id === binding.datasetId);
                    return (
                      <li key={binding.alias} className="flex flex-wrap items-center gap-2">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{binding.alias}</code>
                        {dataset ? (
                          <Link href={`/explore/datasets/${dataset.id}`} className="hover:underline">{dataset.name}</Link>
                        ) : (
                          <span className="text-muted-foreground">{binding.datasetId}</span>
                        )}
                        <span className="text-xs text-muted-foreground">{binding.versionId ? "pinned version" : "current version at run time"}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-muted-foreground">No datasets connected.</p>
              )}
            </div>
            <div className="rounded-lg border p-4 text-sm">
              <h3 className="font-semibold">Latest run</h3>
              {analysis.latestRun ? (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANT[analysis.latestRun.status] ?? "outline"}>{analysis.latestRun.status}</Badge>
                    <Link href={`/explore/runs/${analysis.latestRun.id}?scope=${encodeURIComponent(analysis.targetKey)}`} className="hover:underline">{analysis.latestRun.runNumber}</Link>
                    <span className="text-muted-foreground">revision {analysis.latestRun.revisionNumber}</span>
                  </div>
                  <div className="text-muted-foreground">{formatDateTime(analysis.latestRun.completedAt ?? analysis.latestRun.startedAt ?? analysis.latestRun.createdAt)}</div>
                  {latestRun?.results?.warnings && latestRun.results.warnings.length > 0 && (
                    <ul className="text-xs text-amber-700">{latestRun.results.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-muted-foreground">Not run yet.</p>
              )}
            </div>
          </div>
          {latestFigures.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold">Figures from {latestRun?.runNumber}</h3>
              <div className="mt-2 grid gap-4 lg:grid-cols-2">
                {latestFigures.map((artifact) => (
                  <FigureView key={artifact.id} url={artifact.url} format={artifact.format as "plotly-json"} title={artifact.name} height={360} />
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="code" className="mt-4 space-y-4">
          <CodeEditor value={code} language={analysis.language} onChange={setCode} height="480px" ariaLabel="Analysis code" />
          <div className="flex flex-wrap items-center gap-2">
            <Input className="max-w-md" placeholder="What changed (optional)" value={message} onChange={(event) => setMessage(event.target.value)} />
            <Button variant="outline" onClick={() => void saveRevision()} disabled={busy !== null || !dirty}>
              {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save as new revision
            </Button>
            {dirty && <span className="text-xs text-muted-foreground">Unsaved changes; Run saves them first.</span>}
          </div>
          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h3 className="text-sm font-semibold">Revisions</h3>
              {compare && (
                <Button variant="ghost" size="sm" onClick={() => setCompare(null)}>Close comparison</Button>
              )}
            </div>
            <ul className="divide-y">
              {analysis.revisions.map((revision, index) => (
                <RevisionRow
                  key={revision.id}
                  revision={revision}
                  current={revision.id === analysis.currentRevision?.id}
                  previous={analysis.revisions[index + 1] ?? null}
                  onCompare={(a, b) => setCompare({ a, b })}
                  onRestore={async () => {
                    const restored = revision.code ?? code;
                    setCode(restored);
                    await postJson(`${key}/revisions`, { code: restored, message: `Restored revision ${revision.number}` }).catch(() => {});
                    await mutate();
                  }}
                />
              ))}
            </ul>
            {compare && (
              <div className="border-t p-3">
                <CodeDiff
                  original={revisionCode(analysis, compare.a)}
                  modified={revisionCode(analysis, compare.b)}
                  language={analysis.language}
                  labels={[`Revision ${revisionsById.get(compare.a)?.number ?? "?"}`, `Revision ${revisionsById.get(compare.b)?.number ?? "?"}`]}
                />
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          {analysis.runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet. Press Run to execute the current revision.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Run</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Revision</th>
                    <th className="px-3 py-2 font-medium">Mode</th>
                    <th className="px-3 py-2 font-medium">Started</th>
                    <th className="px-3 py-2 font-medium">Finished</th>
                    <th className="px-3 py-2 text-right font-medium">Outputs</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.runs.map((entry) => (
                    <tr key={entry.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-2"><Link href={`/explore/runs/${entry.id}?scope=${encodeURIComponent(analysis.targetKey)}`} className="font-medium hover:underline">{entry.runNumber}</Link></td>
                      <td className="px-3 py-2"><Badge variant={STATUS_VARIANT[entry.status] ?? "outline"}>{entry.status}</Badge></td>
                      <td className="px-3 py-2 tabular-nums">{entry.revisionNumber}</td>
                      <td className="px-3 py-2 text-muted-foreground">{entry.executionMode ?? ""}</td>
                      <td className="px-3 py-2 text-muted-foreground">{formatDateTime(entry.startedAt ?? entry.queuedAt)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{formatDateTime(entry.completedAt)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{entry.artifactCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="settings" className="mt-4 space-y-6">
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold">Parameters</h3>
            <div className="mt-3">
              <ParamsForm schema={kit?.params ?? { type: "object", properties: Object.fromEntries(Object.keys(paramValues).map((k) => [k, {}])) }} values={paramValues} onChange={setParamValues} />
            </div>
            <Button className="mt-4" variant="outline" size="sm" onClick={() => void saveRevision({ params: paramValues })} disabled={busy !== null}>
              Save parameters as new revision
            </Button>
          </div>
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold">Environment</h3>
            <p className="mt-1 text-xs text-muted-foreground">The conda environment the code runs in. Environments are built by a facility admin.</p>
            <Select value={analysis.environmentName} onValueChange={(value) => void setEnvironment(value)}>
              <SelectTrigger className="mt-3 w-80" aria-label="Environment"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(environmentsData?.environments ?? [{ name: analysis.environmentName, status: "unknown" }]).map((entry) => (
                  <SelectItem key={entry.name} value={entry.name}>{entry.name} ({entry.status})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function revisionCode(analysis: AnalysisDetail, revisionId: string): string {
  const revision = analysis.revisions.find((entry) => entry.id === revisionId);
  return revision?.code ?? (revisionId === analysis.currentRevision?.id ? analysis.code : "");
}

function RevisionRow({
  revision,
  current,
  previous,
  onCompare,
}: {
  revision: RevisionSummary;
  current: boolean;
  previous: RevisionSummary | null;
  onCompare: (a: string, b: string) => void;
  onRestore: () => Promise<void>;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
      <span className="w-8 tabular-nums font-medium">{revision.number}</span>
      <Badge variant={revision.author === "agent" ? "secondary" : "outline"}>{revision.author}</Badge>
      <span className="min-w-0 flex-1 truncate">{revision.message ?? ""}</span>
      <span className="text-xs text-muted-foreground">{formatDateTime(revision.createdAt)}</span>
      {current && <Badge variant="secondary">current</Badge>}
      {previous && (
        <Button variant="ghost" size="sm" onClick={() => onCompare(previous.id, revision.id)} title="Compare with the previous revision">
          <GitCompare className="h-4 w-4" />
        </Button>
      )}
    </li>
  );
}
