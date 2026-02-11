"use client";

import { use, useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  AlertTriangle,
  Check,
  Copy,
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
      return (
        <Badge variant="default" className="bg-blue-600">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-white/70 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
          </span>
          Running
        </Badge>
      );
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

function formatStatusSource(source?: string | null): string {
  if (!source) return "unknown";
  switch (source) {
    case "weblog":
      return "Weblog";
    case "trace":
      return "Trace";
    case "process":
      return "Process";
    case "queue":
      return "Queue";
    case "launcher":
      return "Launcher";
    default:
      return source.replace(/_/g, " ");
  }
}

function formatEventType(value?: string | null): string {
  if (!value) return "Event";
  return value.replace(/_/g, " ");
}

function formatHumanEventTitle(eventType?: string | null, processName?: string | null): string {
  const normalized = (eventType || "event").toLowerCase();

  if (normalized.includes("workflow_start") || normalized.includes("workflow_begin")) {
    return "Workflow started";
  }
  if (normalized.includes("workflow_complete") || normalized.includes("workflow_finish")) {
    return "Workflow completed";
  }
  if (normalized.includes("workflow_error") || normalized.includes("workflow_fail")) {
    return "Workflow failed";
  }
  if (normalized.includes("process_start") || normalized.includes("task_start")) {
    return processName ? `${processName} started` : "Process started";
  }
  if (normalized.includes("process_complete") || normalized.includes("task_complete")) {
    return processName ? `${processName} completed` : "Process completed";
  }
  if (normalized.includes("process_error") || normalized.includes("task_error")) {
    return processName ? `${processName} failed` : "Process failed";
  }

  const prettyType = formatEventType(eventType);
  return processName ? `${prettyType}: ${processName}` : prettyType;
}

function formatAbsoluteTime(timestamp?: string | null): string {
  if (!timestamp) return "-";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function getLastLogLine(content?: string | null): string | null {
  if (!content) return null;
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
    const line = lines[idx];
    if (line.toLowerCase().startsWith("pipeline completed with exit code")) {
      continue;
    }
    return line;
  }
  return null;
}

function buildFailureSignals(signals: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const signal of signals) {
    const value = signal?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
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
  lastEventAt?: string | null;
  lastWeblogAt?: string | null;
  lastTraceAt?: string | null;
  statusSource?: string | null;
  createdAt: string;
  updatedAt: string;
  queueJobId?: string | null;
  queueStatus?: string | null;
  queueReason?: string | null;
  queueUpdatedAt?: string | null;
  executionCommands?: {
    scriptPath: string | null;
    launchCommand: string | null;
    scriptCommand: string | null;
    pipelineCommand: string | null;
  };
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
  inputFiles: { id: string; name: string; path: string; type: string; sampleId?: string; checksum?: string; size?: number }[];
  inputSampleIds?: string[] | null;
  detectedLogFiles?: { id: string; name: string; path: string; type: string; size?: number }[];
  fileSizeByPath?: Record<string, number>;
  outputPathSize?: number | null;
  errorPathSize?: number | null;
  events?: {
    id: string;
    eventType: string;
    processName: string | null;
    stepId: string | null;
    status: string | null;
    message: string | null;
    source: string | null;
    occurredAt: string;
  }[];
}

interface QueueStatus {
  available: boolean;
  type?: "slurm" | "local";
  status?: string;
  reason?: string;
  elapsed?: string;
  exitCode?: string;
  pid?: number;
  source?: "squeue" | "sacct";
  message?: string;
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
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [checkingQueue, setCheckingQueue] = useState(false);
  const [copyingDebugBundle, setCopyingDebugBundle] = useState(false);
  const [debugBundleCopied, setDebugBundleCopied] = useState(false);
  const [debugBundleError, setDebugBundleError] = useState<string | null>(null);
  const [copiedCommandKey, setCopiedCommandKey] = useState<string | null>(null);
  const [commandCopyError, setCommandCopyError] = useState<string | null>(null);
  const [showPipelineProgress, setShowPipelineProgress] = useState(true);
  const [activeTab, setActiveTab] = useState<"activity" | "files" | "details" | "health">("activity");
  const [queueHeartbeatAt, setQueueHeartbeatAt] = useState<string | null>(null);
  const [syncForbidden, setSyncForbidden] = useState(false);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const router = useRouter();

  const { data, error, isLoading, mutate } = useSWR(
    `/api/pipelines/runs/${id}`,
    fetcher,
    {
      refreshInterval: (latestData) => {
        const s = latestData?.run?.status;
        return s === "running" || s === "queued" || s === "pending" ? 15000 : 0;
      },
    }
  );

  const run: Run | undefined = data?.run;
  const runIsActive = ["running", "queued", "pending"].includes(run?.status || "");
  const assemblies = run?.assembliesCreated || [];
  const bins = run?.binsCreated || [];
  const resultErrors = Array.isArray(run?.results?.errors)
    ? run?.results?.errors
    : run?.results?.errors
      ? [String(run?.results?.errors)]
      : [];
  const startedBy = run?.user
    ? [run.user.firstName, run.user.lastName].filter(Boolean).join(" ") || run.user.email || "Unknown"
    : "Unknown";

  // Tick every 30s so relative timestamps ("5s ago") stay fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const active = run?.status === "running" || run?.status === "queued" || run?.status === "pending";
    if (!active) return;
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, [run?.status]);

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
  const fileSizeByPath = run?.fileSizeByPath || {};

  const outputFiles: PipelineOutputFile[] = (() => {
    if (!run) return [];

    const outputs: PipelineOutputFile[] = [];
    const outputPaths = new Set<string>();
    const addOutput = (file: PipelineOutputFile) => {
      if (outputPaths.has(file.path)) return;
      outputPaths.add(file.path);
      outputs.push(file);
    };
    const sampleIdMap = new Map<string, string>();

    run.study?.samples?.forEach((sample) => {
      sampleIdMap.set(sample.id, sample.sampleId);
    });

    for (const artifact of run.artifacts || []) {
      addOutput({
        id: `artifact:${artifact.id}`,
        name: artifact.name || artifact.path.split("/").pop() || artifact.path,
        path: artifact.path,
        type: artifact.type,
        sampleId: artifact.sampleId ? sampleIdMap.get(artifact.sampleId) : undefined,
        size: artifact.size ?? fileSizeByPath[artifact.path],
        producedByStepId: artifact.producedByStepId,
        checksum: artifact.checksum,
        metadata: artifact.metadata,
      });
    }

    const assemblyStepId = run.pipelineId === "mag" ? "assembly" : undefined;
    for (const assembly of run.assembliesCreated || []) {
      if (!assembly.assemblyFile) continue;
      addOutput({
        id: `assembly:${assembly.id}`,
        name:
          assembly.assemblyName ||
          assembly.assemblyFile.split("/").pop() ||
          assembly.assemblyFile,
        path: assembly.assemblyFile,
        type: "assembly",
        sampleId: assembly.sample?.sampleId,
        size: fileSizeByPath[assembly.assemblyFile],
        producedByStepId: assemblyStepId,
      });
    }

    const binStepId = run.pipelineId === "mag" ? "binning" : undefined;
    for (const bin of run.binsCreated || []) {
      if (!bin.binFile) continue;
      addOutput({
        id: `bin:${bin.id}`,
        name: bin.binName || bin.binFile.split("/").pop() || bin.binFile,
        path: bin.binFile,
        type: "bins",
        sampleId: bin.sample?.sampleId,
        size: fileSizeByPath[bin.binFile],
        producedByStepId: binStepId,
      });
    }

    // Standard run artifacts (logs/reports)
    if (run.outputPath) {
      addOutput({
        id: "log:stdout",
        name: run.outputPath.split("/").pop() || "pipeline.out",
        path: run.outputPath,
        type: "log",
        size: run.outputPathSize ?? fileSizeByPath[run.outputPath],
      });
    }
    if (run.errorPath) {
      addOutput({
        id: "log:stderr",
        name: run.errorPath.split("/").pop() || "pipeline.err",
        path: run.errorPath,
        type: "log",
        size: run.errorPathSize ?? fileSizeByPath[run.errorPath],
      });
    }
    for (const logFile of run.detectedLogFiles || []) {
      addOutput({
        id: logFile.id,
        name: logFile.name,
        path: logFile.path,
        type: logFile.type,
        size: logFile.size ?? fileSizeByPath[logFile.path],
      });
    }
    if (run.runFolder) {
      addOutput({
        id: "run:trace",
        name: "trace.txt",
        path: `${run.runFolder}/trace.txt`,
        type: "log",
        size: fileSizeByPath[`${run.runFolder}/trace.txt`],
      });
      addOutput({
        id: "run:report",
        name: "report.html",
        path: `${run.runFolder}/report.html`,
        type: "report",
        size: fileSizeByPath[`${run.runFolder}/report.html`],
      });
      addOutput({
        id: "run:timeline",
        name: "timeline.html",
        path: `${run.runFolder}/timeline.html`,
        type: "report",
        size: fileSizeByPath[`${run.runFolder}/timeline.html`],
      });
      addOutput({
        id: "run:dag",
        name: "dag.dot",
        path: `${run.runFolder}/dag.dot`,
        type: "dag",
        size: fileSizeByPath[`${run.runFolder}/dag.dot`],
      });
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
  run?.steps?.forEach((step) => stepStatusMap.set(step.stepId, step));
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

  const extraSteps = run?.steps?.filter((step) => !orderedNodeIds.has(step.stepId)) || [];

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

  const syncRun = useCallback(async () => {
    try {
      const res = await fetch(`/api/pipelines/runs/${id}/sync`, { method: "POST" });
      if (!res.ok) {
        if (res.status === 403) {
          setSyncForbidden(true);
          setSyncWarning("Auto-sync unavailable for your role (HTTP 403). Last event may be stale.");
          return;
        }
        setSyncWarning(`Auto-sync failed (HTTP ${res.status}).`);
        return;
      }
      setSyncWarning(null);
    } catch (err) {
      console.error("Failed to sync run:", err);
      setSyncWarning("Auto-sync failed due to a network or server error.");
    }
  }, [id]);

  const handleRefresh = async () => {
    if (runIsActive && !syncForbidden) {
      await syncRun();
    }
    mutate();
  };

  useEffect(() => {
    if (!runIsActive || syncForbidden) return;
    let active = true;

    const tick = async () => {
      await syncRun();
      if (active) {
        mutate();
      }
    };

    void tick();
    const interval = setInterval(tick, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [runIsActive, mutate, syncForbidden, syncRun]);

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

  const handleCopyDebugBundle = async () => {
    setCopyingDebugBundle(true);
    setDebugBundleError(null);
    setDebugBundleCopied(false);
    try {
      const res = await fetch(`/api/pipelines/runs/${id}/debug?format=text`);
      if (!res.ok) {
        setDebugBundleError(`Failed to build session info (HTTP ${res.status})`);
        return;
      }

      const text = await res.text();
      if (!text.trim()) {
        setDebugBundleError("Session info is empty");
        return;
      }

      await navigator.clipboard.writeText(text);
      setDebugBundleCopied(true);
      setTimeout(() => setDebugBundleCopied(false), 3000);
    } catch {
      setDebugBundleError("Failed to copy session info");
    } finally {
      setCopyingDebugBundle(false);
    }
  };

  const handleCopyCommand = async (command: string, key: string) => {
    setCommandCopyError(null);
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommandKey(key);
      setTimeout(() => {
        setCopiedCommandKey((current) => (current === key ? null : current));
      }, 3000);
    } catch {
      setCommandCopyError("Failed to copy command");
    }
  };

  const goToSection = useCallback((sectionId: string) => {
    setActiveTab("activity");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
  }, []);

  const fetchQueueStatus = useCallback(async () => {
    const runId = run?.id;
    const queueJobId = run?.queueJobId;
    if (!runId || !queueJobId) return;

    setCheckingQueue(true);
    try {
      const res = await fetch(`/api/pipelines/runs/${runId}/queue`);
      if (!res.ok) {
        setQueueStatus({
          available: false,
          message: `Failed to fetch queue status (HTTP ${res.status})`,
        });
        return;
      }
      setQueueHeartbeatAt(new Date().toISOString());
      const data = (await res.json()) as QueueStatus;
      setQueueStatus(data);
    } catch {
      setQueueStatus({
        available: false,
        message: "Failed to fetch queue status",
      });
    } finally {
      setCheckingQueue(false);
    }
  }, [run?.id, run?.queueJobId]);

  useEffect(() => {
    if (!run?.queueJobId) return;

    if (!["running", "queued", "pending"].includes(run.status)) {
      void fetchQueueStatus();
      return;
    }

    void fetchQueueStatus();
    const interval = setInterval(fetchQueueStatus, 20000);
    return () => clearInterval(interval);
  }, [run?.queueJobId, run?.status, fetchQueueStatus]);

  useEffect(() => {
    setShowPipelineProgress(run?.status !== "failed");
  }, [run?.id, run?.status]);

  useEffect(() => {
    setActiveTab("activity");
    setQueueHeartbeatAt(null);
    setSyncForbidden(false);
    setSyncWarning(null);
  }, [run?.id]);

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

  const latestEventSnapshot = (() => {
    if (!run) {
      return {
        timestamp: null as string | null,
        source: null as string | null,
      };
    }

    const candidates: Array<{ timestamp?: string | null; source?: string | null }> = [
      { timestamp: run.lastEventAt, source: run.statusSource || null },
      { timestamp: run.events?.[0]?.occurredAt || null, source: run.events?.[0]?.source || null },
      { timestamp: run.lastWeblogAt, source: "weblog" },
      { timestamp: run.lastTraceAt, source: "trace" },
      { timestamp: run.queueUpdatedAt, source: "queue" },
      { timestamp: run.completedAt, source: run.statusSource || null },
      {
        timestamp: ["running", "queued", "pending"].includes(run.status)
          ? queueHeartbeatAt
          : null,
        source: "queue",
      },
      { timestamp: run.startedAt, source: "launcher" },
      { timestamp: run.queuedAt, source: "queue" },
      { timestamp: run.updatedAt, source: null },
      { timestamp: run.createdAt, source: null },
    ];

    let latest: { timestamp: string; source: string | null; time: number } | null = null;
    for (const candidate of candidates) {
      if (!candidate.timestamp) continue;
      const time = new Date(candidate.timestamp).getTime();
      if (Number.isNaN(time)) continue;
      if (!latest || time > latest.time) {
        latest = {
          timestamp: candidate.timestamp,
          source: candidate.source || null,
          time,
        };
      }
    }

    if (!latest) {
      return {
        timestamp: null,
        source: run.statusSource || null,
      };
    }

    return {
      timestamp: latest.timestamp,
      source: latest.source || run.statusSource || null,
    };
  })();
  const lastEventAt = latestEventSnapshot.timestamp;
  const lastEventSource = latestEventSnapshot.source;
  const lastUpdateAgeMs = lastEventAt
    ? Date.now() - new Date(lastEventAt).getTime()
    : null;
  const isLive = run?.status === "running" && lastUpdateAgeMs !== null && lastUpdateAgeMs <= 60_000;
  const isStale = run?.status === "running" && lastUpdateAgeMs !== null && lastUpdateAgeMs > 300_000;
  const persistedQueueBadge =
    run?.queueStatus
      ? {
          status: run.queueStatus,
          reason: run.queueReason || undefined,
          type: run.queueJobId?.startsWith("local-") ? "local" : "slurm",
        }
      : null;
  const queueBadge =
    queueStatus?.available && queueStatus.status
      ? {
          status: queueStatus.status,
          reason: queueStatus.reason,
          type: queueStatus.type,
        }
      : persistedQueueBadge;
  const queueStatusLine = queueStatus
    ? queueStatus.available
      ? `${queueStatus.type === "local" ? "Local process" : "SLURM"}: ${queueStatus.status || "unknown"}${queueStatus.elapsed ? ` (${queueStatus.elapsed})` : ""}${queueStatus.reason ? ` — ${queueStatus.reason}` : ""}`
      : queueStatus.message || "Queue status unavailable"
    : run?.queueStatus
      ? `${run.queueJobId?.startsWith("local-") ? "Local process" : "SLURM"}: ${run.queueStatus}${run.queueReason ? ` — ${run.queueReason}` : ""}`
      : null;
  const queueStatusTone = queueStatus
    ? queueStatus.available
      ? "text-muted-foreground"
      : "text-yellow-600"
    : run?.queueStatus
      ? "text-muted-foreground"
      : "text-muted-foreground";
  const detectedSlurmLogs = (run.detectedLogFiles || []).filter((file) =>
    file.name.startsWith("slurm-")
  );
  const failureSignals = buildFailureSignals([
    run.status === "failed" ? getLastLogLine(run.errorTail) : null,
    run.status === "failed" ? getLastLogLine(run.outputTail) : null,
    run.status === "failed" && queueBadge?.reason
      ? `Queue reason: ${queueBadge.reason}`
      : null,
    run.status === "failed" ? resultErrors[0] : null,
  ]);
  const primaryFailureSignal =
    failureSignals[0] ||
    (run.status === "failed"
      ? "Run failed before Nextflow completed. Open logs for details."
      : null);
  const secondaryFailureSignals = failureSignals.slice(1, 4);
  const commandEntries: Array<{
    key: string;
    label: string;
    description: string;
    value: string;
  }> = [];

  if (run.executionCommands?.launchCommand) {
    commandEntries.push({
      key: "launch",
      label: "SeqDesk launcher command",
      description:
        "This is the same command SeqDesk uses to submit the run.",
      value: run.executionCommands.launchCommand,
    });
  }

  if (run.executionCommands?.scriptCommand) {
    commandEntries.push({
      key: "script",
      label: "Run script directly",
      description:
        "Use this to execute the generated run script manually.",
      value: run.executionCommands.scriptCommand,
    });
  }

  if (run.executionCommands?.pipelineCommand) {
    commandEntries.push({
      key: "pipeline",
      label: "Pipeline command in run.sh",
      description:
        "Primary command found inside run.sh (variables are resolved in the script).",
      value: run.executionCommands.pipelineCommand,
    });
  }

  const recentEvents = (run.events || []).slice(0, 60);
  const completedStepCount = stepRows.filter((step) => step.status === "completed").length;
  const runningStepCount = stepRows.filter((step) => step.status === "running").length;
  const failedStepCount = stepRows.filter((step) => step.status === "failed").length;

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
              {isLive && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-blue-500/70 opacity-75 animate-ping" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600" />
                  </span>
                  Live
                </span>
              )}
            </div>
            <p className="text-muted-foreground mt-1">{run.pipelineName}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
              <span>Last event: {formatRelativeTime(lastEventAt)}</span>
              <Badge variant="outline" className="text-xs">
                Source: {formatStatusSource(lastEventSource)}
              </Badge>
              {queueBadge && queueBadge.status && (
                <Badge
                  variant="outline"
                  className={`text-xs ${
                    queueBadge.type === "slurm"
                      ? "bg-slate-50 text-slate-700 border-slate-200"
                      : "bg-indigo-50 text-indigo-700 border-indigo-200"
                  }`}
                  title={queueBadge.reason ? `Reason: ${queueBadge.reason}` : undefined}
                >
                  {queueBadge.type === "local" ? "Local process" : "Queue"}: {queueBadge.status}
                  {queueBadge.reason ? ` (${queueBadge.reason})` : ""}
                </Badge>
              )}
              {isLive && (
                <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                  Live
                </Badge>
              )}
              {isStale && (
                <Badge variant="outline" className="text-xs bg-yellow-50 text-yellow-700 border-yellow-200">
                  No updates
                </Badge>
              )}
              {syncWarning && (
                <Badge
                  variant="outline"
                  className="text-xs bg-amber-50 text-amber-700 border-amber-200"
                  title={syncWarning}
                >
                  Sync warning
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefresh}>
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

      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          setActiveTab(value as "activity" | "files" | "details" | "health")
        }
        className="mb-6"
      >
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="activity">Live Activity</TabsTrigger>
          <TabsTrigger value="files">Pipeline Files</TabsTrigger>
          <TabsTrigger value="details">Run Details</TabsTrigger>
          <TabsTrigger value="health">Run Health</TabsTrigger>
        </TabsList>

        <TabsContent value="activity" className="mt-4 space-y-6">
          <GlassCard>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">What Is Happening Now</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Live status summary with recent pipeline activity.
                </p>
              </div>
              <div className="flex gap-2">
                {run.queueJobId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchQueueStatus}
                    disabled={checkingQueue}
                  >
                    {checkingQueue ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    Check queue
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setActiveTab("files")}>
                  Open files
                </Button>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 text-sm">
              <div className="rounded-md border bg-background/70 p-3">
                <dt className="text-muted-foreground">Run Status</dt>
                <dd className="font-medium mt-1 capitalize">{run.status}</dd>
              </div>
              <div className="rounded-md border bg-background/70 p-3">
                <dt className="text-muted-foreground">Current Step</dt>
                <dd className="font-medium mt-1">{run.currentStep || currentStepLabel || "-"}</dd>
              </div>
              <div className="rounded-md border bg-background/70 p-3">
                <dt className="text-muted-foreground">Steps</dt>
                <dd className="font-medium mt-1">
                  {completedStepCount} done
                  {runningStepCount > 0 ? ` • ${runningStepCount} running` : ""}
                  {failedStepCount > 0 ? ` • ${failedStepCount} failed` : ""}
                </dd>
              </div>
              <div className="rounded-md border bg-background/70 p-3">
                <dt className="text-muted-foreground">Last Update</dt>
                <dd className="font-medium mt-1">{formatRelativeTime(lastEventAt)}</dd>
              </div>
              <div className="rounded-md border bg-background/70 p-3">
                <dt className="text-muted-foreground">Queue</dt>
                <dd className={`font-medium mt-1 ${queueStatusTone}`}>
                  {queueStatusLine || "Not available"}
                </dd>
              </div>
            </dl>

            {run.status === "running" && run.progress != null && (
              <div className="mt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Overall Progress</span>
                  <span>{run.progress}%</span>
                </div>
                <div className="w-full h-3 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${run.progress}%` }}
                  />
                </div>
              </div>
            )}

            {run.status === "failed" && (
              <div className="mt-4 space-y-2">
                <div className="flex items-start gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p className="text-sm font-medium">{primaryFailureSignal}</p>
                </div>
                {secondaryFailureSignals.map((signal) => (
                  <p key={signal} className="text-sm text-muted-foreground">
                    {signal}
                  </p>
                ))}
              </div>
            )}
          </GlassCard>

          <GlassCard>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-semibold">Live Event Feed</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Human-readable timeline of workflow and process updates.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link
                    href={`/api/pipelines/runs/${run.id}/weblog`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Raw weblog API
                  </Link>
                </Button>
                <Badge variant="outline">{recentEvents.length} recent events</Badge>
              </div>
            </div>

            {recentEvents.length > 0 ? (
              <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
                {recentEvents.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-md border bg-background/70 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">
                        {formatHumanEventTitle(event.eventType, event.processName)}
                      </p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(event.occurredAt)}
                        </span>
                        {event.status && (
                          <Badge variant="outline" className="text-xs">
                            {event.status}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatAbsoluteTime(event.occurredAt)}</span>
                      <Badge variant="outline" className="text-[11px]">
                        {formatEventType(event.eventType)}
                      </Badge>
                      {event.source && (
                        <Badge variant="outline" className="text-[11px]">
                          {formatStatusSource(event.source)}
                        </Badge>
                      )}
                      {event.processName && (
                        <span className="font-mono">{event.processName}</span>
                      )}
                    </div>
                    {event.message && (
                      <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap break-words">
                        {event.message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No events received yet.</p>
            )}
          </GlassCard>

          {showPipelineProgress ? (
            <GlassCard>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Pipeline Progress</h2>
                <div className="flex items-center gap-2">
                  {run.status === "failed" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowPipelineProgress(false)}
                    >
                      Hide for now
                    </Button>
                  )}
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
          ) : (
            <GlassCard>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Pipeline Progress</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Hidden to keep failure diagnostics in focus.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPipelineProgress(true)}
                >
                  Show progress
                </Button>
              </div>
            </GlassCard>
          )}

          <GlassCard id="logs-section">
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

          {run.status === "completed" && (
            <>
              {assemblies.length > 0 && (
                <GlassCard>
                  <h2 className="text-lg font-semibold mb-4">
                    Assemblies ({assemblies.length})
                  </h2>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sample</TableHead>
                        <TableHead>Assembly</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assemblies.map((assembly) => (
                        <TableRow key={assembly.id}>
                          <TableCell>{assembly.sample?.sampleId || "-"}</TableCell>
                          <TableCell className="font-mono text-sm">
                            {assembly.assemblyName}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </GlassCard>
              )}

              {bins.length > 0 && (
                <GlassCard>
                  <h2 className="text-lg font-semibold mb-4">
                    Bins ({bins.length})
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
                      {bins.map((bin) => (
                        <TableRow key={bin.id}>
                          <TableCell>{bin.sample?.sampleId || "-"}</TableCell>
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

          {resultErrors.length > 0 && (
            <GlassCard className="border-destructive">
              <h2 className="text-lg font-semibold mb-4 text-destructive">
                Errors
              </h2>
              <ul className="space-y-2 text-sm">
                {resultErrors.map((err, i) => (
                  <li key={i} className="text-destructive">
                    {err}
                  </li>
                ))}
              </ul>
            </GlassCard>
          )}
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <GlassCard id="files-section">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Pipeline Files</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Input and output files with file size, sample, and type filters.
              </p>
            </div>
            <PipelineFileBrowser
              inputFiles={inputFiles}
              outputFiles={outputFiles}
              runId={run.id}
              runFolder={run.runFolder}
              runStatus={run.status}
            />
          </GlassCard>
        </TabsContent>

        <TabsContent value="details" className="mt-4 space-y-6">
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
                <dd>{startedBy}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Created</dt>
                <dd>{formatAbsoluteTime(run.createdAt)}</dd>
              </div>
              {run.queuedAt && (
                <div>
                  <dt className="text-sm text-muted-foreground">Queued</dt>
                  <dd>{formatAbsoluteTime(run.queuedAt)}</dd>
                </div>
              )}
              {run.startedAt && (
                <div>
                  <dt className="text-sm text-muted-foreground">Started</dt>
                  <dd>{formatAbsoluteTime(run.startedAt)}</dd>
                </div>
              )}
              {run.completedAt && (
                <div>
                  <dt className="text-sm text-muted-foreground">Completed</dt>
                  <dd>{formatAbsoluteTime(run.completedAt)}</dd>
                </div>
              )}
            </dl>
          </GlassCard>

          {run.queueJobId && (
            <GlassCard>
              <h2 className="text-lg font-semibold mb-4">Queue Job</h2>
              <div className="space-y-2">
                <p className="font-mono text-sm">{run.queueJobId}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchQueueStatus}
                  disabled={checkingQueue}
                >
                  {checkingQueue ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : null}
                  Check queue
                </Button>
                {queueStatusLine && (
                  <p className={`text-xs ${queueStatusTone}`}>{queueStatusLine}</p>
                )}
              </div>
            </GlassCard>
          )}

          {run.config && Object.keys(run.config).length > 0 && (
            <GlassCard>
              <h2 className="text-lg font-semibold mb-4">Configuration</h2>
              <dl className="space-y-2 text-sm">
                {Object.entries(run.config).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{key}</dt>
                    <dd className="font-mono text-right break-all">
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
        </TabsContent>

        <TabsContent value="health" className="mt-4">
          <GlassCard
            className={
              run.status === "failed"
                ? "border-destructive/40 bg-destructive/5"
                : undefined
            }
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Run Health</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {run.status === "failed"
                    ? "Primary failure reason and queue diagnostics."
                    : "Current queue and launcher status at a glance."}
                </p>
              </div>
              <div className="flex gap-2">
                {run.queueJobId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchQueueStatus}
                    disabled={checkingQueue}
                  >
                    {checkingQueue ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    Check queue
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyDebugBundle}
                  disabled={copyingDebugBundle}
                >
                  {copyingDebugBundle ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : debugBundleCopied ? (
                    <Check className="h-4 w-4 mr-2 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4 mr-2" />
                  )}
                  Copy session info
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => goToSection("logs-section")}
                >
                  Go to logs
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab("files")}
                >
                  Go to files
                </Button>
              </div>
            </div>
            {debugBundleError && (
              <p className="mt-3 text-sm text-destructive">{debugBundleError}</p>
            )}
            {debugBundleCopied && (
              <p className="mt-3 text-sm text-green-700">
                Session info copied. Paste it directly in chat.
              </p>
            )}

            <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div className="rounded-md border bg-background/70 p-3">
                <dt className="text-muted-foreground">Queue</dt>
                <dd className="font-medium mt-1">
                  {queueStatusLine || "Not available"}
                </dd>
              </div>
              <div className="rounded-md border bg-background/70 p-3">
                <dt className="text-muted-foreground">Status Source</dt>
                <dd className="font-medium mt-1">
                  {formatStatusSource(lastEventSource)}
                </dd>
              </div>
              <div className="rounded-md border bg-background/70 p-3">
                <dt className="text-muted-foreground">Last Event</dt>
                <dd className="font-medium mt-1">
                  {lastEventAt ? new Date(lastEventAt).toLocaleString() : "-"}
                </dd>
              </div>
              <div className="rounded-md border bg-background/70 p-3">
                <dt className="text-muted-foreground">Queue Job ID</dt>
                <dd className="font-mono text-sm mt-1">{run.queueJobId || "-"}</dd>
              </div>
            </dl>

            {(run.executionCommands?.scriptPath || commandEntries.length > 0) && (
              <div className="mt-4 rounded-md border bg-background/70 p-3">
                <h3 className="text-sm font-semibold">Reproduce Manually</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Run these on the same host where SeqDesk starts pipelines.
                </p>

                {run.executionCommands?.scriptPath && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Script:{" "}
                    <span className="font-mono break-all">
                      {run.executionCommands.scriptPath}
                    </span>
                  </p>
                )}

                <div className="mt-3 space-y-3">
                  {commandEntries.map((entry) => (
                    <div key={entry.key} className="rounded-md border bg-muted/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium">{entry.label}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleCopyCommand(entry.value, entry.key)}
                        >
                          {copiedCommandKey === entry.key ? (
                            <Check className="h-4 w-4 mr-2 text-green-600" />
                          ) : (
                            <Copy className="h-4 w-4 mr-2" />
                          )}
                          {copiedCommandKey === entry.key ? "Copied" : "Copy"}
                        </Button>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {entry.description}
                      </p>
                      <pre className="mt-2 overflow-x-auto rounded bg-background p-2 text-xs font-mono">
                        {entry.value}
                      </pre>
                    </div>
                  ))}
                </div>
                {commandCopyError && (
                  <p className="mt-2 text-xs text-destructive">{commandCopyError}</p>
                )}
              </div>
            )}

            {run.status === "failed" && (
              <div className="mt-4 space-y-2">
                <div className="flex items-start gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p className="text-sm font-medium">{primaryFailureSignal}</p>
                </div>
                {secondaryFailureSignals.map((signal) => (
                  <p key={signal} className="text-sm text-muted-foreground">
                    {signal}
                  </p>
                ))}
                {detectedSlurmLogs.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Detected SLURM logs:{" "}
                    <span className="font-mono">
                      {detectedSlurmLogs.map((file) => file.name).join(", ")}
                    </span>
                  </p>
                )}
              </div>
            )}
          </GlassCard>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
