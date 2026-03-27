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
  Download,
  Loader2,
  RefreshCw,
  StopCircle,
  RotateCcw,
  Dna,
  FlaskConical,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LiveLogViewer } from "@/components/pipelines/LiveLogViewer";
import {
  type PipelineInputFile,
  type PipelineOutputFile,
} from "@/components/pipelines/PipelineProgressViewer";
import { PipelineFileBrowser } from "@/components/pipelines/PipelineFileBrowser";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge variant="default" className="bg-[#00BD7D]">Completed</Badge>;
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
  const bg = "rounded-full bg-white";
  switch (status) {
    case "completed":
      return <CheckCircle2 className={`h-5 w-5 ${bg}`} style={{ color: "#00BD7D" }} />;
    case "running":
      return <Loader2 className={`h-5 w-5 text-blue-600 animate-spin ${bg}`} />;
    case "failed":
      return <XCircle className={`h-5 w-5 text-destructive ${bg}`} />;
    case "skipped":
      return <Clock className={`h-5 w-5 text-muted-foreground ${bg}`} />;
    default:
      return <Clock className={`h-5 w-5 text-muted-foreground ${bg}`} />;
  }
}

function normalizeStepStatus(status: string, completedAt?: string | null): string {
  if (!completedAt) return status;
  if (status === "running" || status === "pending") return "completed";
  return status;
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

function isQueueStateLikelyActive(state?: string | null): boolean {
  if (!state) return false;
  const normalized = state.trim().toUpperCase();
  if (!normalized || normalized === "UNKNOWN") return false;
  if (
    normalized === "COMPLETED" ||
    normalized === "EXITED" ||
    normalized === "REVOKED" ||
    normalized === "TIMEOUT" ||
    normalized === "OUT_OF_MEMORY" ||
    normalized === "NODE_FAIL" ||
    normalized === "BOOT_FAIL" ||
    normalized === "PREEMPTED" ||
    normalized === "DEADLINE"
  ) {
    return false;
  }
  return !normalized.startsWith("CANCELLED")
    && !normalized.startsWith("CANCELED")
    && !normalized.startsWith("FAILED");
}

function queueStateToDisplayStatus(state?: string | null): "queued" | "running" {
  const normalized = state?.trim().toUpperCase() || "";
  if (normalized === "PENDING" || normalized === "CONFIGURING") {
    return "queued";
  }
  return "running";
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
  pipelineVersion?: string | null;
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
  order: {
    id: string;
    name: string;
    orderNumber: string;
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
  jobs?: {
    jobId: string;
    partition: string;
    name: string;
    user: string;
    state: string;
    elapsed: string;
    nodes: string;
    nodeList: string;
  }[];
}

export default function AnalysisRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [checkingQueue, setCheckingQueue] = useState(false);
  const [copyingDebugBundle, setCopyingDebugBundle] = useState(false);
  const [debugBundleCopied, setDebugBundleCopied] = useState(false);
  const [debugBundleError, setDebugBundleError] = useState<string | null>(null);
  const [copiedCommandKey, setCopiedCommandKey] = useState<string | null>(null);
  const [copiedOutputKey, setCopiedOutputKey] = useState<string | null>(null);
  const [outputCopyError, setOutputCopyError] = useState<string | null>(null);
  const [commandCopyError, setCommandCopyError] = useState<string | null>(null);
  const [showPipelineProgress, setShowPipelineProgress] = useState(true);
  const [activeTab, setActiveTab] = useState<"activity" | "files" | "details">("activity");
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
  const assemblies = run?.assembliesCreated || [];
  const bins = run?.binsCreated || [];
  const materializedOutputCount =
    assemblies.length + bins.length + (run?.artifacts?.length || 0);
  const queueStateForUi = queueStatus?.status || run?.queueStatus || null;
  const completionPendingOutputs =
    run?.pipelineId === "mag" &&
    run?.status === "completed" &&
    materializedOutputCount === 0;
  const effectiveRunStatus =
    completionPendingOutputs
      ? "running"
      : run &&
        ["completed", "failed", "cancelled"].includes(run.status) &&
        isQueueStateLikelyActive(queueStateForUi)
          ? queueStateToDisplayStatus(queueStateForUi)
          : run?.status || "pending";
  const runIsActive = ["running", "queued", "pending"].includes(effectiveRunStatus);
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
    if (!runIsActive) return;
    const timer = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(timer);
  }, [runIsActive]);

  // Load pipeline definition for ordered step labels in the progress list
  const { data: defData } = useSWR<{
    nodes: Array<{
      id: string;
      name: string;
      order?: number;
      nodeType?: "step" | "input" | "output";
    }>;
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

  const stepStatusMap = new Map<string, Run["steps"][number]>();
  run?.steps?.forEach((step) => stepStatusMap.set(step.stepId, step));
  const orderedSteps = defData?.nodes
    ? [...defData.nodes]
        .filter((node) => (node.nodeType ?? "step") === "step")
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];
  const orderedNodeIds = new Set(orderedSteps.map((n) => n.id));

  const extraSteps = run?.steps?.filter((step) => !orderedNodeIds.has(step.stepId)) || [];

  const stepRows = [
    ...orderedSteps.map((node) => {
      const step = stepStatusMap.get(node.id);
      const normalizedStatus = normalizeStepStatus(step?.status || "pending", step?.completedAt);
      return {
        id: node.id,
        name: node.name,
        status: normalizedStatus,
        startedAt: step?.startedAt || null,
        completedAt: step?.completedAt || null,
      };
    }),
    ...extraSteps.map((step) => {
      const normalizedStatus = normalizeStepStatus(step.status, step.completedAt);
      return {
        id: step.stepId,
        name: step.stepName || step.stepId,
        status: normalizedStatus,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
      };
    }),
  ];

  const currentStepLabel = run?.currentStep
    ? run.currentStep.replace(/^failed at\s+/i, "")
    : null;
  const effectiveCurrentStep = completionPendingOutputs
    ? "Finalizing outputs..."
    : run?.currentStep || currentStepLabel || "-";

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
    if (!syncForbidden && run?.runFolder) {
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

      router.push(`/analysis/${newRunId}`);
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

  const handleCopyOutputPath = async (filePath: string, key: string) => {
    setOutputCopyError(null);
    try {
      await navigator.clipboard.writeText(filePath);
      setCopiedOutputKey(key);
      setTimeout(() => {
        setCopiedOutputKey((current) => (current === key ? null : current));
      }, 3000);
    } catch {
      setOutputCopyError("Failed to copy file path");
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
      void mutate();
    } catch {
      setQueueStatus({
        available: false,
        message: "Failed to fetch queue status",
      });
    } finally {
      setCheckingQueue(false);
    }
  }, [mutate, run?.id, run?.queueJobId]);

  useEffect(() => {
    if (!run?.queueJobId) return;

    void fetchQueueStatus();
    if (!runIsActive) return;
    const interval = setInterval(fetchQueueStatus, 20000);
    return () => clearInterval(interval);
  }, [run?.queueJobId, fetchQueueStatus, runIsActive]);

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
            <Link href="/analysis">
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
        timestamp:
          (["running", "queued", "pending"].includes(effectiveRunStatus) ||
            isQueueStateLikelyActive(queueStateForUi))
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
  const isLive = runIsActive && lastUpdateAgeMs !== null && lastUpdateAgeMs <= 60_000;
  const isStale = runIsActive && lastUpdateAgeMs !== null && lastUpdateAgeMs > 300_000;
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
  const liveSlurmJobs =
    queueStatus?.available && queueStatus.type === "slurm" && Array.isArray(queueStatus.jobs)
      ? queueStatus.jobs
      : [];
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

  const tabTriggerClass =
    "relative h-[52px] border-0 border-b-2 border-b-transparent rounded-none px-4 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:text-foreground data-[state=active]:border-b-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent hover:text-foreground";

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) =>
        setActiveTab(value as "activity" | "files" | "details")
      }
    >
      {/* Sticky header bar — matching form-builder style */}
      <div className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="flex items-center h-[52px] px-6 lg:px-8 gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" asChild>
              <Link href={
                run.study
                  ? `/studies/${run.study.id}?tab=pipelines&pipeline=${run.pipelineId}`
                  : run.order
                    ? `/orders/${run.order.id}/sequencing?pipeline=${run.pipelineId}`
                    : "/analysis"
              }>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <span className="text-sm font-medium">{run.pipelineName}</span>
          </div>
          <TabsList className="h-[52px] bg-transparent rounded-none p-0 gap-1 flex-1 justify-center">
            <TabsTrigger value="activity" className={tabTriggerClass}>Status</TabsTrigger>
            <TabsTrigger value="files" className={tabTriggerClass}>Pipeline Output</TabsTrigger>
            <TabsTrigger value="details" className={tabTriggerClass}>Run Details</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 shrink-0">
            {isLive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-blue-500/70 opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600" />
                </span>
                Live
              </span>
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
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </Button>
            {["pending", "queued", "running"].includes(effectiveRunStatus) && (
              <Button variant="destructive" size="sm" onClick={handleCancel}>
                <StopCircle className="h-3.5 w-3.5 mr-1.5" />
                Cancel
              </Button>
            )}
            {run.status === "failed" && (
              <Button size="sm" onClick={handleRetry} disabled={retrying}>
                {retrying ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                )}
                Retry
              </Button>
            )}
          </div>
        </div>
      </div>

      {retryError && (
        <div className="px-6 lg:px-8 mt-4 text-sm text-destructive">{retryError}</div>
      )}

    <PageContainer>

        <TabsContent value="activity" className="mt-4 space-y-6">
          <GlassCard>
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 text-sm">
              <div>
                <dt className="text-muted-foreground mb-0.5">Status</dt>
                <dd className={`font-medium capitalize ${effectiveRunStatus === "completed" ? "text-[#00BD7D]" : effectiveRunStatus === "failed" ? "text-destructive" : effectiveRunStatus === "running" ? "text-blue-600" : ""}`}>{effectiveRunStatus}</dd>
              </div>
              {!["completed", "failed"].includes(effectiveRunStatus) && (
                <div>
                  <dt className="text-muted-foreground mb-0.5">Current Step</dt>
                  <dd className="font-medium">{effectiveCurrentStep}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground mb-0.5">Last Update</dt>
                <dd className="font-medium">{formatRelativeTime(lastEventAt)}</dd>
              </div>
              {effectiveRunStatus === "running" && (
                <div>
                  <dt className="text-muted-foreground mb-0.5">Progress</dt>
                  <dd className="font-medium">
                    {completedStepCount} of {stepRows.length} steps done
                    {runningStepCount > 0 ? ` (${runningStepCount} running)` : ""}
                    {failedStepCount > 0 ? ` (${failedStepCount} failed)` : ""}
                  </dd>
                </div>
              )}
            </dl>

            {effectiveRunStatus === "running" && run.progress != null && (
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
              <div className="mt-4 pt-4 border-t space-y-2">
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

            {liveSlurmJobs.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="text-sm font-semibold">Live SLURM Jobs</h3>
                  <Badge variant="outline" className="text-xs">
                    {liveSlurmJobs.length} row{liveSlurmJobs.length === 1 ? "" : "s"}
                  </Badge>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Job ID</TableHead>
                        <TableHead>Partition</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Nodes</TableHead>
                        <TableHead>Node/Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {liveSlurmJobs.map((job) => (
                        <TableRow key={`${job.jobId}-${job.name}-${job.state}`}>
                          <TableCell className="font-mono text-xs">{job.jobId || "-"}</TableCell>
                          <TableCell>{job.partition || "-"}</TableCell>
                          <TableCell>{job.name || "-"}</TableCell>
                          <TableCell>{job.user || "-"}</TableCell>
                          <TableCell>{job.state || "-"}</TableCell>
                          <TableCell>{job.elapsed || "-"}</TableCell>
                          <TableCell>{job.nodes || "-"}</TableCell>
                          <TableCell className="max-w-[220px] truncate" title={job.nodeList || "-"}>
                            {job.nodeList || "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {recentEvents.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-muted-foreground">Recent Events ({recentEvents.length})</h3>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={`/api/pipelines/runs/${run.id}/weblog`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Raw weblog API
                    </a>
                  </Button>
                </div>
                <div className="space-y-2 max-h-[320px] overflow-auto pr-1">
                  {recentEvents.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center justify-between gap-3 text-sm py-1.5 border-b last:border-0"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">
                          {formatHumanEventTitle(event.eventType, event.processName)}
                        </span>
                        {event.status && (
                          <Badge variant="outline" className="text-xs shrink-0">
                            {event.status}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatRelativeTime(event.occurredAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </GlassCard>

          {showPipelineProgress ? (
            <GlassCard>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Pipeline Steps</h2>
                {run.status === "failed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPipelineProgress(false)}
                  >
                    Hide for now
                  </Button>
                )}
              </div>

              <div className="relative">
                {stepRows.map((step, index) => {
                  const duration = step.startedAt && step.completedAt
                    ? (() => {
                        const ms = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
                        if (ms < 1000) return "<1s";
                        const s = Math.floor(ms / 1000);
                        if (s < 60) return `${s}s`;
                        const m = Math.floor(s / 60);
                        return `${m}m ${s % 60}s`;
                      })()
                    : null;
                  return (
                    <div key={step.id} className="relative flex gap-3">
                      {/* Line segment to next step */}
                      {index < stepRows.length - 1 && (
                        <div className="absolute left-[9px] top-[20px] bottom-0 w-0.5" style={{ backgroundColor: "#00BD7D", opacity: 0.3 }} />
                      )}
                      {/* Icon sits on top of the line */}
                      <div className="relative z-10 shrink-0 mt-0.5">
                        {getStepIcon(step.status)}
                      </div>
                      {/* Content */}
                      <div className={`flex-1 ${index < stepRows.length - 1 ? "pb-4" : ""}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{step.name}</span>
                          {step.status !== "completed" && (
                            <Badge variant={step.status === "failed" ? "destructive" : step.status === "running" ? "secondary" : "outline"} className="text-xs">
                              {step.status}
                            </Badge>
                          )}
                          {duration !== null && (
                            <span className="text-xs text-muted-foreground">&middot; {duration}</span>
                          )}
                        </div>
                        {step.startedAt && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatRelativeTime(step.startedAt)}
                            {step.completedAt && step.status === "completed" && (
                              <> &middot; finished {formatRelativeTime(step.completedAt)}</>
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}

                {stepRows.length === 0 && (
                  <p className="text-muted-foreground text-center py-4">
                    No steps recorded yet
                  </p>
                )}
              </div>
            </GlassCard>
          ) : (
            <GlassCard>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Pipeline Steps</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Hidden to keep failure diagnostics in focus.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPipelineProgress(true)}
                >
                  Show steps
                </Button>
              </div>
            </GlassCard>
          )}

          <GlassCard id="logs-section">
            <h2 className="text-lg font-semibold mb-4">
              Logs
              {effectiveRunStatus === "running" && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  (live)
                </span>
              )}
            </h2>
            <LiveLogViewer
              runId={run.id}
              isRunning={effectiveRunStatus === "running"}
              initialOutputTail={run.outputTail}
              initialErrorTail={run.errorTail}
            />
          </GlassCard>

          {(assemblies.length > 0 || bins.length > 0) && (
            <GlassCard>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-semibold">Detected Outputs</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Paths and quick actions for assemblies and bins created by this run.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setActiveTab("files")}>
                  Open full file browser
                </Button>
              </div>

              {assemblies.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold mb-2">Assemblies ({assemblies.length})</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sample</TableHead>
                        <TableHead>Assembly</TableHead>
                        <TableHead>Path</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assemblies.map((assembly) => (
                        <TableRow key={assembly.id}>
                          <TableCell>{assembly.sample?.sampleId || "-"}</TableCell>
                          <TableCell className="font-mono text-sm">
                            {assembly.assemblyName}
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[480px] truncate" title={assembly.assemblyFile || "-"}>
                            {assembly.assemblyFile || "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {assembly.assemblyFile && (
                                <>
                                  <Button variant="outline" size="sm" asChild>
                                    <a
                                      href={`/api/pipelines/runs/${run.id}/file?path=${encodeURIComponent(
                                        assembly.assemblyFile
                                      )}&download=1`}
                                    >
                                      <Download className="h-4 w-4 mr-2" />
                                      Download
                                    </a>
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      void handleCopyOutputPath(
                                        assembly.assemblyFile!,
                                        `assembly:${assembly.id}`
                                      )
                                    }
                                  >
                                    {copiedOutputKey === `assembly:${assembly.id}` ? (
                                      <Check className="h-4 w-4 mr-2 text-[#00BD7D]" />
                                    ) : (
                                      <Copy className="h-4 w-4 mr-2" />
                                    )}
                                    {copiedOutputKey === `assembly:${assembly.id}` ? "Copied" : "Copy path"}
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {bins.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Bins ({bins.length})</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sample</TableHead>
                        <TableHead>Bin</TableHead>
                        <TableHead>Completeness</TableHead>
                        <TableHead>Contamination</TableHead>
                        <TableHead>Path</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
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
                          <TableCell className="font-mono text-xs max-w-[420px] truncate" title={bin.binFile || "-"}>
                            {bin.binFile || "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {bin.binFile && (
                                <>
                                  <Button variant="outline" size="sm" asChild>
                                    <a
                                      href={`/api/pipelines/runs/${run.id}/file?path=${encodeURIComponent(
                                        bin.binFile
                                      )}&download=1`}
                                    >
                                      <Download className="h-4 w-4 mr-2" />
                                      Download
                                    </a>
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      void handleCopyOutputPath(
                                        bin.binFile!,
                                        `bin:${bin.id}`
                                      )
                                    }
                                  >
                                    {copiedOutputKey === `bin:${bin.id}` ? (
                                      <Check className="h-4 w-4 mr-2 text-[#00BD7D]" />
                                    ) : (
                                      <Copy className="h-4 w-4 mr-2" />
                                    )}
                                    {copiedOutputKey === `bin:${bin.id}` ? "Copied" : "Copy path"}
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {outputCopyError && (
                <p className="mt-3 text-sm text-destructive">{outputCopyError}</p>
              )}
            </GlassCard>
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
              runStatus={effectiveRunStatus}
            />
          </GlassCard>
        </TabsContent>

        <TabsContent value="details" className="mt-4 space-y-6">
          <GlassCard>
            <h2 className="text-lg font-semibold mb-4">Run Information</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4 text-sm">
              <div>
                <dt className="text-muted-foreground mb-0.5">Study</dt>
                <dd className="font-medium">
                  {run.study ? (
                    <Link
                      href={`/studies/${run.study.id}`}
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
                <dt className="text-muted-foreground mb-0.5">Samples</dt>
                <dd className="font-medium">{run.study?.samples.length || 0}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-0.5">Started By</dt>
                <dd className="font-medium">{startedBy}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-0.5">Run Number</dt>
                <dd className="font-medium font-mono">{run.runNumber}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-0.5">Pipeline</dt>
                <dd className="font-medium">
                  {run.pipelineName}
                  {run.pipelineVersion ? (
                    <span className="text-muted-foreground font-normal"> v{run.pipelineVersion}</span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-0.5">Status</dt>
                <dd className={`font-medium capitalize ${effectiveRunStatus === "completed" ? "text-[#00BD7D]" : effectiveRunStatus === "failed" ? "text-destructive" : effectiveRunStatus === "running" ? "text-blue-600" : ""}`}>{effectiveRunStatus}</dd>
              </div>
            </dl>

            <div className="mt-6 pt-4 border-t">
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">Timeline</h3>
              <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Created</span>{" "}
                  <span className="font-medium">{formatAbsoluteTime(run.createdAt)}</span>
                </div>
                {run.queuedAt && (
                  <div>
                    <span className="text-muted-foreground">Queued</span>{" "}
                    <span className="font-medium">{formatAbsoluteTime(run.queuedAt)}</span>
                  </div>
                )}
                {run.startedAt && (
                  <div>
                    <span className="text-muted-foreground">Started</span>{" "}
                    <span className="font-medium">{formatAbsoluteTime(run.startedAt)}</span>
                  </div>
                )}
                {run.completedAt && (
                  <div>
                    <span className="text-muted-foreground">Completed</span>{" "}
                    <span className="font-medium">{formatAbsoluteTime(run.completedAt)}</span>
                  </div>
                )}
              </div>
            </div>

            {run.queueJobId && (
              <div className="mt-6 pt-4 border-t">
                <h3 className="text-sm font-semibold text-muted-foreground mb-3">Queue</h3>
                <div className="flex items-center gap-3 text-sm">
                  <span className="font-mono">{run.queueJobId}</span>
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
                    <span className={`text-xs ${queueStatusTone}`}>{queueStatusLine}</span>
                  )}
                </div>
              </div>
            )}
          </GlassCard>

          {run.config && Object.entries(run.config).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0)).length > 0 && (
            <GlassCard>
              <h2 className="text-lg font-semibold mb-4">Configuration</h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                {Object.entries(run.config).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0)).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{key}</dt>
                    <dd className="font-mono font-medium text-right break-all">
                      {typeof value === "boolean"
                        ? value
                          ? "Yes"
                          : "No"
                        : Array.isArray(value)
                          ? value.join(", ")
                          : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </GlassCard>
          )}

          {run.status === "failed" && (
            <GlassCard className="border-destructive/40 bg-destructive/5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                <div>
                  <h2 className="text-lg font-semibold text-destructive">Failure Detected</h2>
                  <p className="text-sm font-medium mt-1">{primaryFailureSignal}</p>
                  {secondaryFailureSignals.map((signal) => (
                    <p key={signal} className="text-sm text-muted-foreground mt-1">
                      {signal}
                    </p>
                  ))}
                  {detectedSlurmLogs.length > 0 && (
                    <p className="text-sm text-muted-foreground mt-1">
                      Detected SLURM logs:{" "}
                      <span className="font-mono">
                        {detectedSlurmLogs.map((file) => file.name).join(", ")}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </GlassCard>
          )}

          <GlassCard>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Diagnostics</h2>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyDebugBundle}
                  disabled={copyingDebugBundle}
                >
                  {copyingDebugBundle ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : debugBundleCopied ? (
                    <Check className="h-4 w-4 mr-1.5 text-[#00BD7D]" />
                  ) : (
                    <Copy className="h-4 w-4 mr-1.5" />
                  )}
                  Copy session info
                </Button>
                {run.queueJobId && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchQueueStatus}
                    disabled={checkingQueue}
                  >
                    {checkingQueue ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : null}
                    Check queue
                  </Button>
                )}
              </div>
            </div>
            {debugBundleError && (
              <p className="mb-3 text-sm text-destructive">{debugBundleError}</p>
            )}
            {debugBundleCopied && (
              <p className="mb-3 text-sm text-[#00BD7D]">
                Session info copied. Paste it directly in chat.
              </p>
            )}

            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-4 text-sm">
              <div>
                <dt className="text-muted-foreground mb-0.5">Queue</dt>
                <dd className="font-medium">{queueStatusLine || "Not available"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-0.5">Status Source</dt>
                <dd className="font-medium">{formatStatusSource(lastEventSource)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-0.5">Last Event</dt>
                <dd className="font-medium">{lastEventAt ? new Date(lastEventAt).toLocaleString() : "-"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground mb-0.5">Queue Job ID</dt>
                <dd className="font-mono">{run.queueJobId || "-"}</dd>
              </div>
            </dl>
          </GlassCard>

          {(run.executionCommands?.scriptPath || commandEntries.length > 0) && (
            <GlassCard>
              <h2 className="text-lg font-semibold mb-1">Reproduce Manually</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Run these on the same host where SeqDesk starts pipelines.
              </p>

              {run.executionCommands?.scriptPath && (
                <p className="text-sm text-muted-foreground mb-3">
                  Script:{" "}
                  <span className="font-mono break-all">
                    {run.executionCommands.scriptPath}
                  </span>
                </p>
              )}

              <div className="space-y-3">
                {commandEntries.map((entry) => (
                  <div key={entry.key} className="rounded-md border bg-muted/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{entry.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {entry.description}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleCopyCommand(entry.value, entry.key)}
                      >
                        {copiedCommandKey === entry.key ? (
                          <Check className="h-4 w-4 mr-1.5 text-[#00BD7D]" />
                        ) : (
                          <Copy className="h-4 w-4 mr-1.5" />
                        )}
                        {copiedCommandKey === entry.key ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <pre className="mt-2 overflow-x-auto rounded bg-background p-2 text-xs font-mono">
                      {entry.value}
                    </pre>
                  </div>
                ))}
              </div>
              {commandCopyError && (
                <p className="mt-2 text-xs text-destructive">{commandCopyError}</p>
              )}
            </GlassCard>
          )}
        </TabsContent>
      </PageContainer>
    </Tabs>
  );
}
