"use client";

import { use, useState } from "react";
import useSWR from "swr";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  StopCircle,
  RotateCcw,
  Dna,
  FlaskConical,
  CheckCircle2,
  XCircle,
  Clock,
  GitBranch,
  List,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LiveLogViewer } from "@/components/pipelines/LiveLogViewer";
import {
  PipelineProgressViewer,
  type DagNode,
  type DagEdge,
  type StepStatus,
  type PipelineInputFile,
  type PipelineOutputFile,
} from "@/components/pipelines/PipelineProgressViewer";
import { PipelineFileBrowser } from "@/components/pipelines/PipelineFileBrowser";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge variant="default" className="bg-green-600">Completed</Badge>;
    case "running":
      return <Badge variant="default" className="bg-blue-600">Running</Badge>;
    case "queued":
      return <Badge variant="secondary">Queued</Badge>;
    case "pending":
      return <Badge variant="outline">Pending</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "cancelled":
      return <Badge variant="outline" className="text-muted-foreground">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getStepIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-5 w-5 text-green-600" />;
    case "running":
      return <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />;
    case "failed":
      return <XCircle className="h-5 w-5 text-destructive" />;
    case "skipped":
      return <Clock className="h-5 w-5 text-muted-foreground" />;
    default:
      return <Clock className="h-5 w-5 text-muted-foreground" />;
  }
}

function getPipelineIcon(icon: string) {
  switch (icon) {
    case "Dna":
      return <Dna className="h-6 w-6" />;
    default:
      return <FlaskConical className="h-6 w-6" />;
  }
}

function formatRelativeTime(timestamp?: string | null): string {
  if (!timestamp) return "-";
  const time = new Date(timestamp).getTime();
  if (Number.isNaN(time)) return "-";
  const diffMs = Date.now() - time;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface Run {
  id: string;
  runNumber: string;
  pipelineId: string;
  pipelineName: string;
  pipelineIcon: string;
  pipelineDescription: string;
  status: string;
  progress: number | null;
  currentStep: string | null;
  config: Record<string, unknown> | null;
  results: { assembliesCreated?: number; binsCreated?: number; errors?: string[] } | null;
  runFolder: string | null;
  outputPath: string | null;
  errorPath: string | null;
  outputTail: string | null;
  errorTail: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  study: {
    id: string;
    title: string;
    samples: {
      id: string;
      sampleId: string;
      reads: { id: string; file1: string | null; file2: string | null; checksum1: string | null; checksum2: string | null }[];
    }[];
  } | null;
  user: { firstName: string; lastName: string; email: string };
  steps: { id: string; stepId: string; stepName: string; status: string; startedAt: string | null; completedAt: string | null }[];
  assembliesCreated: { id: string; assemblyName: string; assemblyFile: string | null; sample: { sampleId: string } }[];
  binsCreated: { id: string; binName: string; binFile: string | null; completeness: number | null; contamination: number | null; sample: { sampleId: string } }[];
  artifacts: { id: string; type: string; name: string; path: string; size?: bigint; checksum?: string; producedByStepId?: string; metadata?: string; sampleId?: string }[];
  inputFiles: { id: string; name: string; path: string; type: string; sampleId?: string; checksum?: string }[];
  inputSampleIds?: string[] | null;
}

export default function AnalysisRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [viewMode, setViewMode] = useState<"dag" | "list">("dag");
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const router = useRouter();

  const { data, error, isLoading, mutate } = useSWR(
    `/api/pipelines/runs/${id}`,
    fetcher,
    {
      refreshInterval: (data) =>
        data?.run?.status === "running" ? 5000 : 0, // Only refresh if running
    }
  );

  const run: Run | undefined = data?.run;

  // Load pipeline definition for DAG view
  const { data: defData } = useSWR<{
    nodes: DagNode[];
    edges: DagEdge[];
    definition: { id: string; name: string };
  }>(
    run?.pipelineId ? `/api/pipelines/definitions/${run.pipelineId}` : null,
    fetcher
  );

  const inputFiles = (run?.inputFiles || []) as PipelineInputFile[];

  const outputFiles: PipelineOutputFile[] = (() => {
    if (!run) return [];

    const outputs: PipelineOutputFile[] = [];
    const sampleIdMap = new Map<string, string>();

    run.study?.samples?.forEach((sample) => {
      sampleIdMap.set(sample.id, sample.sampleId);
    });

    for (const artifact of run.artifacts || []) {
      outputs.push({
        id: `artifact:${artifact.id}`,
        name: artifact.name || artifact.path.split("/").pop() || artifact.path,
        path: artifact.path,
        type: artifact.type,
        sampleId: artifact.sampleId ? sampleIdMap.get(artifact.sampleId) : undefined,
        size: artifact.size,
        producedByStepId: artifact.producedByStepId,
        checksum: artifact.checksum,
        metadata: artifact.metadata,
      });
    }

    const assemblyStepId = run.pipelineId === "mag" ? "assembly" : undefined;
    for (const assembly of run.assembliesCreated || []) {
      if (!assembly.assemblyFile) continue;
      outputs.push({
        id: `assembly:${assembly.id}`,
        name:
          assembly.assemblyName ||
          assembly.assemblyFile.split("/").pop() ||
          assembly.assemblyFile,
        path: assembly.assemblyFile,
        type: "assembly",
        sampleId: assembly.sample?.sampleId,
        producedByStepId: assemblyStepId,
      });
    }

    const binStepId = run.pipelineId === "mag" ? "binning" : undefined;
    for (const bin of run.binsCreated || []) {
      if (!bin.binFile) continue;
      outputs.push({
        id: `bin:${bin.id}`,
        name: bin.binName || bin.binFile.split("/").pop() || bin.binFile,
        path: bin.binFile,
        type: "bins",
        sampleId: bin.sample?.sampleId,
        producedByStepId: binStepId,
      });
    }

    // Standard run artifacts (logs/reports)
    if (run.outputPath) {
      outputs.push({
        id: "log:stdout",
        name: run.outputPath.split("/").pop() || "pipeline.out",
        path: run.outputPath,
        type: "log",
      });
    }
    if (run.errorPath) {
      outputs.push({
        id: "log:stderr",
        name: run.errorPath.split("/").pop() || "pipeline.err",
        path: run.errorPath,
        type: "log",
      });
    }
    if (run.runFolder) {
      outputs.push(
        {
          id: "run:trace",
          name: "trace.txt",
          path: `${run.runFolder}/trace.txt`,
          type: "log",
        },
        {
          id: "run:report",
          name: "report.html",
          path: `${run.runFolder}/report.html`,
          type: "report",
        },
        {
          id: "run:timeline",
          name: "timeline.html",
          path: `${run.runFolder}/timeline.html`,
          type: "report",
        },
        {
          id: "run:dag",
          name: "dag.dot",
          path: `${run.runFolder}/dag.dot`,
          type: "dag",
        }
      );
    }

    return outputs;
  })();

  const outputFilesByStep = new Map<string, string[]>();
  for (const file of outputFiles) {
    if (!file.producedByStepId) continue;
    if (!outputFilesByStep.has(file.producedByStepId)) {
      outputFilesByStep.set(file.producedByStepId, []);
    }
    outputFilesByStep.get(file.producedByStepId)!.push(file.path);
  }

  const stepStatusMap = new Map<string, Run["steps"][number]>();
  run?.steps.forEach((step) => stepStatusMap.set(step.stepId, step));
  const orderedNodes = defData?.nodes
    ? [...defData.nodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];
  const orderedNodeIds = new Set(orderedNodes.map((n) => n.id));

  // Convert run steps to step statuses for the DAG viewer (include pending)
  const stepStatuses: StepStatus[] | undefined = run
    ? orderedNodes.map((node) => {
        const step = stepStatusMap.get(node.id);
        return {
          stepId: node.id,
          status: (step?.status as StepStatus["status"]) || "pending",
          startedAt: step?.startedAt || undefined,
          completedAt: step?.completedAt || undefined,
          outputFiles: outputFilesByStep.get(node.id),
        };
      })
    : undefined;

  const extraSteps = run?.steps.filter((step) => !orderedNodeIds.has(step.stepId)) || [];

  const stepRows = [
    ...orderedNodes.map((node) => {
      const step = stepStatusMap.get(node.id);
      return {
        id: node.id,
        name: node.name,
        status: (step?.status as StepStatus["status"]) || "pending",
        startedAt: step?.startedAt || null,
        completedAt: step?.completedAt || null,
      };
    }),
    ...extraSteps.map((step) => ({
      id: step.stepId,
      name: step.stepName || step.stepId,
      status: step.status as StepStatus["status"],
      startedAt: step.startedAt,
      completedAt: step.completedAt,
    })),
  ];

  const normalizedCurrent = run?.currentStep?.toLowerCase();
  const currentStepLabel = run?.currentStep
    ? run.currentStep.replace(/^failed at\s+/i, "")
    : null;
  const runningStepId = stepStatuses?.find((s) => s.status === "running")?.stepId;
  const currentStepId =
    runningStepId ||
    (normalizedCurrent
      ? orderedNodes.find((node) => {
          const name = node.name?.toLowerCase() || "";
          const idLabel = node.id.replace(/_/g, " ");
          return (
            normalizedCurrent.includes(name) ||
            name.includes(normalizedCurrent) ||
            normalizedCurrent.includes(idLabel)
          );
        })?.id
      : undefined);

  const handleCancel = async () => {
    if (!confirm("Are you sure you want to cancel this run?")) return;

    try {
      const res = await fetch(`/api/pipelines/runs/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        mutate();
      }
    } catch (err) {
      console.error("Failed to cancel run:", err);
    }
  };

  const handleRetry = async () => {
    if (!run) return;
    if (!run.study?.id) {
      setRetryError("Run is missing an associated study");
      return;
    }

    setRetrying(true);
    setRetryError(null);

    try {
      const sampleIds =
        run.inputSampleIds && run.inputSampleIds.length > 0
          ? run.inputSampleIds
          : undefined;

      const createRes = await fetch("/api/pipelines/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId: run.pipelineId,
          studyId: run.study.id,
          sampleIds,
          config: run.config || {},
        }),
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        setRetryError(createData.error || "Failed to create retry run");
        return;
      }

      const newRunId = createData.run?.id;
      if (!newRunId) {
        setRetryError("Retry run created but missing run ID");
        return;
      }

      const startRes = await fetch(`/api/pipelines/runs/${newRunId}/start`, {
        method: "POST",
      });
      const startData = await startRes.json();

      if (!startRes.ok) {
        setRetryError(startData.error || "Failed to start retry run");
        return;
      }

      router.push(`/dashboard/analysis/${newRunId}`);
    } catch (err) {
      setRetryError(
        err instanceof Error ? err.message : "Failed to retry pipeline"
      );
    } finally {
      setRetrying(false);
    }
  };

  if (isLoading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PageContainer>
    );
  }

  if (error || !run) {
    return (
      <PageContainer>
        <div className="text-center py-24">
          <p className="text-destructive">Failed to load run details</p>
          <Button variant="outline" className="mt-4" asChild>
            <Link href="/dashboard/analysis">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Analysis
            </Link>
          </Button>
        </div>
      </PageContainer>
    );
  }

  const lastUpdateAgeMs = run?.updatedAt
    ? Date.now() - new Date(run.updatedAt).getTime()
    : null;
  const isLive = run?.status === "running" && lastUpdateAgeMs !== null && lastUpdateAgeMs <= 60_000;
  const isStale = run?.status === "running" && lastUpdateAgeMs !== null && lastUpdateAgeMs > 300_000;

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/analysis">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              {getPipelineIcon(run.pipelineIcon)}
              <h1 className="text-2xl font-bold font-mono">{run.runNumber}</h1>
              {getStatusBadge(run.status)}
            </div>
            <p className="text-muted-foreground mt-1">{run.pipelineName}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
              <span>Last update: {formatRelativeTime(run.updatedAt)}</span>
              {isLive && <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">Live</Badge>}
              {isStale && <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700 border-yellow-200">No updates</Badge>}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => mutate()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {["pending", "queued", "running"].includes(run.status) && (
            <Button variant="destructive" onClick={handleCancel}>
              <StopCircle className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          )}
          {run.status === "failed" && (
            <Button onClick={handleRetry} disabled={retrying}>
              {retrying ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Retry
            </Button>
          )}
        </div>
      </div>

      {retryError && (
        <div className="mb-4 text-sm text-destructive">{retryError}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content - 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          {/* Pipeline Steps - DAG or List View */}
          <GlassCard>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Pipeline Progress</h2>
              <div className="flex items-center gap-1 bg-muted rounded-md p-1">
                <Button
                  variant={viewMode === "dag" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setViewMode("dag")}
                >
                  <GitBranch className="h-4 w-4 mr-1" />
                  DAG
                </Button>
                <Button
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setViewMode("list")}
                >
                  <List className="h-4 w-4 mr-1" />
                  List
                </Button>
              </div>
            </div>

            {viewMode === "dag" && defData?.nodes && defData?.edges ? (
              <PipelineProgressViewer
                nodes={defData.nodes}
                edges={defData.edges}
                stepStatuses={stepStatuses}
                inputFiles={inputFiles}
                outputFiles={outputFiles}
                showFiles={true}
                runStatus={run.status}
                currentStepId={currentStepId}
                currentStepLabel={currentStepLabel}
                className="min-h-[500px]"
              />
            ) : viewMode === "dag" && !defData ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="relative">
                {stepRows.map((step, index) => (
                  <div key={step.id} className="flex items-start gap-4 mb-4 last:mb-0">
                    <div className="flex flex-col items-center">
                      {getStepIcon(step.status)}
                      {index < stepRows.length - 1 && (
                        <div className="w-0.5 h-8 bg-border mt-2" />
                      )}
                    </div>
                    <div className="flex-1 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{step.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {step.status}
                        </Badge>
                      </div>
                      {step.startedAt && (
                        <p className="text-sm text-muted-foreground">
                          Started: {new Date(step.startedAt).toLocaleString()}
                          {step.completedAt && (
                            <> - Completed: {new Date(step.completedAt).toLocaleString()}</>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                ))}

                {stepRows.length === 0 && (
                  <p className="text-muted-foreground text-center py-4">
                    No steps recorded yet
                  </p>
                )}
              </div>
            )}
          </GlassCard>

          {/* Pipeline Files Browser */}
          <GlassCard>
            <h2 className="text-lg font-semibold mb-4">Pipeline Files</h2>
            <PipelineFileBrowser
              inputFiles={inputFiles}
              outputFiles={outputFiles}
              runFolder={run.runFolder}
              runStatus={run.status}
            />
          </GlassCard>

          {/* Results - Assemblies and Bins */}
          {run.status === "completed" && (
            <>
              {run.assembliesCreated.length > 0 && (
                <GlassCard>
                  <h2 className="text-lg font-semibold mb-4">
                    Assemblies ({run.assembliesCreated.length})
                  </h2>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sample</TableHead>
                        <TableHead>Assembly</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {run.assembliesCreated.map((assembly) => (
                        <TableRow key={assembly.id}>
                          <TableCell>{assembly.sample.sampleId}</TableCell>
                          <TableCell className="font-mono text-sm">
                            {assembly.assemblyName}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </GlassCard>
              )}

              {run.binsCreated.length > 0 && (
                <GlassCard>
                  <h2 className="text-lg font-semibold mb-4">
                    Bins ({run.binsCreated.length})
                  </h2>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sample</TableHead>
                        <TableHead>Bin</TableHead>
                        <TableHead>Completeness</TableHead>
                        <TableHead>Contamination</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {run.binsCreated.map((bin) => (
                        <TableRow key={bin.id}>
                          <TableCell>{bin.sample.sampleId}</TableCell>
                          <TableCell className="font-mono text-sm">
                            {bin.binName}
                          </TableCell>
                          <TableCell>
                            {bin.completeness != null
                              ? `${bin.completeness.toFixed(1)}%`
                              : "-"}
                          </TableCell>
                          <TableCell>
                            {bin.contamination != null
                              ? `${bin.contamination.toFixed(1)}%`
                              : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </GlassCard>
              )}
            </>
          )}

          {/* Logs */}
          <GlassCard>
            <h2 className="text-lg font-semibold mb-4">
              Logs
              {run.status === "running" && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  (live)
                </span>
              )}
            </h2>
            <LiveLogViewer
              runId={run.id}
              isRunning={run.status === "running"}
              initialOutputTail={run.outputTail}
              initialErrorTail={run.errorTail}
            />
          </GlassCard>
        </div>

        {/* Sidebar - 1 column */}
        <div className="space-y-6">
          {/* Run Info */}
          <GlassCard>
            <h2 className="text-lg font-semibold mb-4">Run Information</h2>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm text-muted-foreground">Study</dt>
                <dd>
                  {run.study ? (
                    <Link
                      href={`/dashboard/studies/${run.study.id}`}
                      className="hover:underline"
                    >
                      {run.study.title}
                    </Link>
                  ) : (
                    "-"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Samples</dt>
                <dd>{run.study?.samples.length || 0}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Started By</dt>
                <dd>{run.user.firstName} {run.user.lastName}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Created</dt>
                <dd>{new Date(run.createdAt).toLocaleString()}</dd>
              </div>
              {run.queuedAt && (
                <div>
                  <dt className="text-sm text-muted-foreground">Queued</dt>
                  <dd>{new Date(run.queuedAt).toLocaleString()}</dd>
                </div>
              )}
              {run.startedAt && (
                <div>
                  <dt className="text-sm text-muted-foreground">Started</dt>
                  <dd>{new Date(run.startedAt).toLocaleString()}</dd>
                </div>
              )}
              {run.completedAt && (
                <div>
                  <dt className="text-sm text-muted-foreground">Completed</dt>
                  <dd>{new Date(run.completedAt).toLocaleString()}</dd>
                </div>
              )}
            </dl>
          </GlassCard>

          {/* Progress */}
          {run.status === "running" && run.progress != null && (
            <GlassCard>
              <h2 className="text-lg font-semibold mb-4">Progress</h2>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Overall</span>
                  <span>{run.progress}%</span>
                </div>
                <div className="w-full h-3 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${run.progress}%` }}
                  />
                </div>
                {run.currentStep && (
                  <p className="text-sm text-muted-foreground">
                    {run.currentStep}
                  </p>
                )}
              </div>
            </GlassCard>
          )}

          {/* Configuration */}
          {run.config && Object.keys(run.config).length > 0 && (
            <GlassCard>
              <h2 className="text-lg font-semibold mb-4">Configuration</h2>
              <dl className="space-y-2 text-sm">
                {Object.entries(run.config).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <dt className="text-muted-foreground">{key}</dt>
                    <dd className="font-mono">
                      {typeof value === "boolean"
                        ? value
                          ? "Yes"
                          : "No"
                        : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </GlassCard>
          )}

          {/* Errors */}
          {run.results?.errors && run.results.errors.length > 0 && (
            <GlassCard className="border-destructive">
              <h2 className="text-lg font-semibold mb-4 text-destructive">
                Errors
              </h2>
              <ul className="space-y-2 text-sm">
                {run.results.errors.map((err, i) => (
                  <li key={i} className="text-destructive">
                    {err}
                  </li>
                ))}
              </ul>
            </GlassCard>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
