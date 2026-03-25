"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { getSampleResultPreview } from "@/lib/pipelines/sample-result";
import type { PipelineSampleResult } from "@/lib/pipelines/types";
import {
  AlertCircle,
  Clock,
  ExternalLink,
  Info,
  Loader2,
  MoreHorizontal,
  Play,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { OrderSequencingSummaryResponse } from "@/lib/sequencing/types";
import { useQuickPrerequisiteStatus } from "@/lib/pipelines/useQuickPrerequisiteStatus";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function getApiErrorMessage(
  payload: { error?: unknown; details?: unknown } | null,
  fallback: string
): string {
  if (!payload) return fallback;
  if (Array.isArray(payload.details) && payload.details.length > 0) {
    return payload.details
      .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
      .join("\n");
  }
  if (typeof payload.details === "string" && payload.details.trim()) {
    return payload.details;
  }
  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }
  return fallback;
}

type ConfigSchemaProperty = {
  type: string;
  title?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
};

type AdminPipeline = {
  pipelineId: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  config: Record<string, unknown>;
  defaultConfig: Record<string, unknown>;
  sampleResult?: PipelineSampleResult;
  configSchema?: {
    properties?: Record<string, ConfigSchemaProperty>;
  };
  input: {
    supportedScopes: string[];
    perSample: {
      reads: boolean;
      pairedEnd: boolean;
    };
  };
};

type PipelineRun = {
  id: string;
  runNumber: string;
  pipelineId: string;
  pipelineName: string;
  status: string;
  currentStep: string | null;
  progress: number | null;
  inputSampleIds: string | null;
  errorTail?: string | null;
  config?: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  user?: {
    firstName: string | null;
    lastName: string | null;
    email: string;
  } | null;
};

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "completed", label: "Completed" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "-";
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const diffMs = endDate.getTime() - startDate.getTime();
  if (diffMs < 0) return "-";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSecs}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return `${hours}h ${remainingMins}m`;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge className="bg-emerald-600 text-white">Completed</Badge>;
    case "running":
      return <Badge className="bg-blue-600 text-white">Running</Badge>;
    case "queued":
      return <Badge variant="secondary">Queued</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "cancelled":
      return <Badge variant="outline">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getRunDetails(run: PipelineRun): string {
  if (run.status === "failed" && run.errorTail?.trim()) {
    return run.errorTail.trim();
  }
  if (run.currentStep?.trim()) {
    return run.currentStep.trim();
  }
  if (run.status === "completed") return "Completed successfully";
  if (run.status === "queued") return "Waiting for execution";
  if (run.status === "running") return "Currently running";
  return "";
}

function getSampleCount(run: PipelineRun): number | null {
  if (!run.inputSampleIds) return null;
  try {
    const ids = JSON.parse(run.inputSampleIds);
    return Array.isArray(ids) ? ids.length : null;
  } catch {
    return null;
  }
}

function getUserDisplay(run: PipelineRun): string {
  if (!run.user) return "-";
  const name = [run.user.firstName, run.user.lastName].filter(Boolean).join(" ");
  return name || run.user.email;
}

interface OrderPipelineViewProps {
  orderId: string;
  pipelineId: string;
  samples: OrderSequencingSummaryResponse["samples"];
  onRunCompleted?: () => void;
  onSampleDataChanged?: () => void;
  isDemo?: boolean;
}

export function OrderPipelineView({
  orderId,
  pipelineId,
  samples,
  onRunCompleted,
  onSampleDataChanged,
  isDemo,
}: OrderPipelineViewProps) {
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>({});
  const [pendingRunSampleIds, setPendingRunSampleIds] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState<PipelineRun | null>(null);
  const [deletingRun, setDeletingRun] = useState(false);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [detailRun, setDetailRun] = useState<PipelineRun | null>(null);
  const [changeSourceSample, setChangeSourceSample] = useState<{
    id: string;
    sampleId: string;
    currentRunId?: string | null;
  } | null>(null);
  const [changingSource, setChangingSource] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ path: string; label: string } | null>(null);
  const {
    systemReady,
    checkingSystem,
    refreshSystemReady,
    initialCheckPending,
    systemBlocked,
  } = useQuickPrerequisiteStatus();

  const pipelinesResponse = useSWR<{ pipelines: AdminPipeline[] }>(
    "/api/admin/settings/pipelines?enabled=true&catalog=order",
    fetcher
  );
  const runsResponse = useSWR<{ runs: PipelineRun[]; total: number }>(
    `/api/pipelines/runs?orderId=${orderId}&pipelineId=${pipelineId}&limit=50`,
    fetcher,
    { refreshInterval: 10000 }
  );

  const pipeline = useMemo(
    () =>
      (pipelinesResponse.data?.pipelines ?? []).find(
        (p) => p.pipelineId === pipelineId && p.enabled
      ) ?? null,
    [pipelinesResponse.data?.pipelines, pipelineId]
  );

  const allRuns = useMemo(() => runsResponse.data?.runs ?? [], [runsResponse.data?.runs]);

  const hasActiveRuns = useMemo(
    () => allRuns.some((run) => run.status === "queued" || run.status === "running"),
    [allRuns]
  );

  // Derive running sample IDs from active pipeline runs + pending API calls
  const runningSampleIds = useMemo(() => {
    const ids = new Set(pendingRunSampleIds);
    for (const run of allRuns) {
      if (run.status === "queued" || run.status === "running") {
        if (run.inputSampleIds) {
          try {
            const parsed = JSON.parse(run.inputSampleIds) as string[];
            for (const id of parsed) ids.add(id);
          } catch {
            // inputSampleIds might be comma-separated
            for (const id of run.inputSampleIds.split(",")) {
              const trimmed = id.trim();
              if (trimmed) ids.add(trimmed);
            }
          }
        }
      }
    }
    return ids;
  }, [allRuns, pendingRunSampleIds]);

  // Detect when a previously active run transitions to "completed" and notify parent
  const prevActiveRunIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentActiveIds = new Set(
      allRuns
        .filter((r) => r.status === "queued" || r.status === "running")
        .map((r) => r.id)
    );
    const justCompleted = [...prevActiveRunIdsRef.current].some(
      (id) => !currentActiveIds.has(id) && allRuns.some((r) => r.id === id && r.status === "completed")
    );
    if (justCompleted) {
      onRunCompleted?.();
    }
    prevActiveRunIdsRef.current = currentActiveIds;
  }, [allRuns, onRunCompleted]);

  const filteredRuns = useMemo(
    () =>
      statusFilter === "all"
        ? allRuns
        : allRuns.filter((run) => run.status === statusFilter),
    [allRuns, statusFilter]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const run of allRuns) {
      counts[run.status] = (counts[run.status] || 0) + 1;
    }
    return counts;
  }, [allRuns]);

  useEffect(() => {
    if (!pipeline) return;
    setLocalConfig({ ...(pipeline.config || pipeline.defaultConfig || {}) });
  }, [pipeline]);

  const getSampleReadiness = useCallback(
    (sample: (typeof samples)[0]): { ready: boolean; reason?: string } => {
      if (!pipeline) return { ready: false, reason: "Pipeline not loaded" };
      if (pipeline.input.perSample.reads && !sample.read?.file1) {
        return { ready: false, reason: "Missing reads" };
      }
      if (pipeline.input.perSample.pairedEnd && !sample.read?.file2) {
        return { ready: false, reason: "Missing R2 file" };
      }
      return { ready: true };
    },
    [pipeline]
  );

  const readySamples = useMemo(
    () => samples.filter((s) => getSampleReadiness(s).ready),
    [samples, getSampleReadiness]
  );

  const runPipeline = useCallback(
    async (sampleIds: string[]) => {
      if (!pipeline) return;
      setError("");

      try {
        const createRes = await fetch("/api/pipelines/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pipelineId: pipeline.pipelineId,
            orderId,
            sampleIds,
            config: localConfig,
          }),
        });

        const createPayload = await createRes.json().catch(() => null);
        if (!createRes.ok) {
          throw new Error(
            getApiErrorMessage(createPayload, "Failed to create pipeline run")
          );
        }

        const runId = createPayload?.run?.id as string | undefined;
        if (!runId) throw new Error("Pipeline run created without an id");

        const startRes = await fetch(`/api/pipelines/runs/${runId}/start`, {
          method: "POST",
        });
        const startPayload = await startRes.json().catch(() => null);
        if (!startRes.ok) {
          throw new Error(
            getApiErrorMessage(startPayload, "Failed to start pipeline run")
          );
        }

        await runsResponse.mutate();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start pipeline");
      }
    },
    [localConfig, orderId, pipeline, runsResponse]
  );

  const handleDeleteRun = useCallback(
    async (runId: string) => {
      setDeletingRun(true);
      try {
        const res = await fetch(`/api/pipelines/runs/${runId}/delete`, {
          method: "POST",
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(getApiErrorMessage(payload, "Failed to delete run"));
        }
        await runsResponse.mutate();
        setDeleteTarget(null);
        onSampleDataChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete run");
      } finally {
        setDeletingRun(false);
      }
    },
    [runsResponse, onSampleDataChanged]
  );

  const handleBulkDelete = useCallback(async () => {
    if (selectedRunIds.size === 0) return;
    setBulkDeleting(true);
    try {
      for (const runId of selectedRunIds) {
        const res = await fetch(`/api/pipelines/runs/${runId}/delete`, {
          method: "POST",
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(getApiErrorMessage(payload, "Failed to delete run"));
        }
      }
      await runsResponse.mutate();
      setSelectedRunIds(new Set());
      setShowBulkDeleteConfirm(false);
      onSampleDataChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete runs");
    } finally {
      setBulkDeleting(false);
    }
  }, [selectedRunIds, runsResponse, onSampleDataChanged]);

  // Deletable runs are those not currently running
  const deletableFilteredRuns = useMemo(
    () => filteredRuns.filter((r) => r.status !== "running"),
    [filteredRuns]
  );

  const allFilteredSelected =
    deletableFilteredRuns.length > 0 &&
    deletableFilteredRuns.every((r) => selectedRunIds.has(r.id));

  const toggleSelectAll = useCallback(() => {
    if (allFilteredSelected) {
      setSelectedRunIds(new Set());
    } else {
      setSelectedRunIds(new Set(deletableFilteredRuns.map((r) => r.id)));
    }
  }, [allFilteredSelected, deletableFilteredRuns]);

  const toggleSelectRun = useCallback((runId: string) => {
    setSelectedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!hasActiveRuns) return;

    const interval = window.setInterval(() => {
      void runsResponse.mutate();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [hasActiveRuns, runsResponse]);

  const handleRunSingle = useCallback(
    async (sampleId: string) => {
      setPendingRunSampleIds((prev) => new Set(prev).add(sampleId));
      await runPipeline([sampleId]);
      setPendingRunSampleIds((prev) => {
        const next = new Set(prev);
        next.delete(sampleId);
        return next;
      });
    },
    [runPipeline]
  );

  const handleRunAllReady = useCallback(async () => {
    if (readySamples.length === 0) return;
    setRunningAll(true);
    await runPipeline(readySamples.map((s) => s.id));
    setRunningAll(false);
  }, [readySamples, runPipeline]);


  const handleClearSampleResult = useCallback(
    async (sampleId: string) => {
      if (!pipeline?.sampleResult) return;
      setError("");
      const fields = pipeline.sampleResult.values
        .map((v) => {
          const parts = v.path.split(".");
          return parts.length === 2 && parts[0] === "read" ? parts[1] : null;
        })
        .filter((f): f is string => f !== null);

      if (fields.length === 0) return;

      try {
        const res = await fetch(`/api/orders/${orderId}/sequencing/reads`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sampleId, clearFields: fields }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(getApiErrorMessage(payload, "Failed to clear result"));
        }
        onSampleDataChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to clear result");
      }
    },
    [orderId, pipeline?.sampleResult, onSampleDataChanged]
  );

  const completedRunsForSample = useMemo(() => {
    if (!changeSourceSample) return [];
    return allRuns.filter((run) => {
      if (run.status !== "completed") return false;
      // null means "all samples" — the run covered the entire order
      if (!run.inputSampleIds) return true;
      try {
        const ids = JSON.parse(run.inputSampleIds) as string[];
        return Array.isArray(ids) && ids.includes(changeSourceSample.id);
      } catch {
        return false;
      }
    });
  }, [allRuns, changeSourceSample]);

  const handleChangeSource = useCallback(
    async (runId: string) => {
      if (!changeSourceSample) return;
      setChangingSource(true);
      setError("");
      try {
        const res = await fetch(
          `/api/pipelines/runs/${runId}/resolve-outputs/sample`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sampleId: changeSourceSample.id }),
          }
        );
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(
            getApiErrorMessage(payload, "Failed to change source")
          );
        }
        onSampleDataChanged?.();
        setChangeSourceSample(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to change source");
      } finally {
        setChangingSource(false);
      }
    },
    [changeSourceSample, onSampleDataChanged]
  );

  if (pipelinesResponse.isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div className="rounded-lg border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
        Pipeline not found or not enabled.
      </div>
    );
  }

  const sampleResultConfig = pipeline.sampleResult;
  const columnCount = (sampleResultConfig ? 5 : 4) + 1; // +1 for Source column

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{pipeline.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pipeline.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isDemo ? (
            <Badge
              variant="outline"
              className="border-blue-200 bg-blue-50 px-3 py-1.5 text-blue-700"
            >
              <Info className="mr-1.5 h-3.5 w-3.5" />
              Demo mode — pipeline execution is view-only
            </Badge>
          ) : initialCheckPending ? (
            <Button size="sm" disabled>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Checking env...
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                disabled={readySamples.length === 0 || runningAll || systemBlocked}
                onClick={handleRunAllReady}
                title={systemBlocked ? systemReady?.summary : undefined}
              >
                {runningAll ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                )}
                Run All Ready ({readySamples.length})
              </Button>
              {systemBlocked ? (
                <Badge
                  variant="outline"
                  className="border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-700"
                >
                  <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
                  {systemReady?.summary}
                </Badge>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={checkingSystem}
                onClick={() => void refreshSystemReady()}
              >
                <RefreshCw
                  className={`mr-1.5 h-3.5 w-3.5 ${
                    checkingSystem ? "animate-spin" : ""
                  }`}
                />
                {checkingSystem ? "Re-checking..." : "Re-check env"}
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Pipeline settings — hidden in demo mode */}
      {!isDemo && pipeline?.configSchema?.properties && Object.entries(pipeline.configSchema.properties).some(
        ([, s]) => s.enum || s.type === "boolean" || s.type === "number"
      ) && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Settings</h3>
          <div className="flex flex-wrap items-end gap-4">
            {Object.entries(pipeline.configSchema.properties).map(([key, schema]) => {
              const value = localConfig[key] ?? schema.default;

              if (schema.enum) {
                const ENUM_LABELS: Record<string, string> = {
                  shortReadPaired: "Paired-end",
                  shortReadSingle: "Single-end",
                  longRead: "Long read",
                };
                const fieldId = `config-${key}`;
                return (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs" htmlFor={fieldId}>
                      {schema.title || key}
                    </Label>
                    <Select
                      value={String(value ?? "")}
                      onValueChange={(v) => setLocalConfig((prev) => ({ ...prev, [key]: v }))}
                    >
                      <SelectTrigger
                        id={fieldId}
                        aria-label={schema.title || key}
                        className="h-8 w-[160px] text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {schema.enum.map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {ENUM_LABELS[opt] || opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              }

              if (schema.type === "boolean") {
                const fieldId = `config-${key}`;
                return (
                  <div key={key} className="flex items-center gap-2 pb-1">
                    <Switch
                      id={fieldId}
                      checked={!!value}
                      onCheckedChange={(checked) =>
                        setLocalConfig((prev) => ({ ...prev, [key]: !!checked }))
                      }
                    />
                    <Label htmlFor={fieldId} className="text-xs">
                      {schema.title || key}
                    </Label>
                  </div>
                );
              }

              if (schema.type === "number") {
                const fieldId = `config-${key}`;
                return (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs" htmlFor={fieldId}>
                      {schema.title || key}
                    </Label>
                    <Input
                      id={fieldId}
                      type="number"
                      className="h-8 w-[120px] text-xs"
                      value={value != null ? String(value) : ""}
                      onChange={(e) =>
                        setLocalConfig((prev) => ({
                          ...prev,
                          [key]: e.target.value ? Number(e.target.value) : undefined,
                        }))
                      }
                    />
                  </div>
                );
              }

              return null;
            })}
          </div>
        </div>
      )}

      {/* Sample table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-secondary/30">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">#</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Sample
              </th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Reads
              </th>
              {sampleResultConfig ? (
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  {sampleResultConfig.columnLabel}
                </th>
              ) : null}
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Source
              </th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {samples.map((sample, idx) => {
              const { ready, reason } = getSampleReadiness(sample);
              const isRunning = runningSampleIds.has(sample.id);
              const sampleResultPreview = getSampleResultPreview(
                sample,
                sampleResultConfig,
              );

              return (
                <tr
                  key={sample.id}
                  className="border-b last:border-0 transition-colors hover:bg-secondary/20"
                >
                  <td className="px-4 py-3 text-muted-foreground tabular-nums">
                    {idx + 1}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{sample.sampleId}</div>
                    {sample.sampleAlias && (
                      <div className="text-xs text-muted-foreground">
                        {sample.sampleAlias}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {sample.read?.file1 ? (
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-emerald-700 border-emerald-200 bg-emerald-50">
                          {sample.read.file2 ? "Paired-end" : "Single-end"}
                        </Badge>
                        {sample.read.filesMissing && (
                          <Badge
                            variant="outline"
                            className="text-orange-700 border-orange-200 bg-orange-50"
                            title={[
                              sample.read.file1 && sample.read.fileSize1 == null && "R1 file missing from disk",
                              sample.read.file2 && sample.read.fileSize2 == null && "R2 file missing from disk",
                            ].filter(Boolean).join("; ") || "Source files missing from disk"}
                          >
                            Stale
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50">
                        No reads
                      </Badge>
                    )}
                  </td>
                  {sampleResultConfig ? (
                    <td className="px-4 py-3">
                      {sampleResultPreview && sampleResultPreview.items.length > 0 ? (
                        <div className="flex items-start gap-1.5">
                          <div className="space-y-1">
                            {sampleResultPreview.items.map((item) => (
                              <div
                                key={`${item.label ?? "value"}-${item.value}`}
                                className="text-xs flex items-center gap-1"
                              >
                                {item.label ? (
                                  <span className="mr-1 text-muted-foreground">
                                    {item.label}
                                  </span>
                                ) : null}
                                {item.previewPath ? (
                                  <button
                                    type="button"
                                    className={cn(
                                      "font-mono text-blue-600 hover:text-blue-800 hover:underline cursor-pointer inline-flex items-center gap-0.5",
                                      sample.read?.filesMissing && "line-through text-muted-foreground pointer-events-none"
                                    )}
                                    onClick={() => setPreviewFile({ path: item.previewPath!, label: `${item.label ? item.label + " — " : ""}${item.value}` })}
                                    disabled={!!sample.read?.filesMissing}
                                  >
                                    {item.value}
                                    <ExternalLink className="h-2.5 w-2.5" />
                                  </button>
                                ) : (
                                  <span className={cn("font-mono", sample.read?.filesMissing && "line-through text-muted-foreground")}>{item.value}</span>
                                )}
                              </div>
                            ))}
                            {sample.read?.filesMissing && (
                              <div className="text-xs text-orange-600">
                                Source files deleted
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Clear result"
                            onClick={() => void handleClearSampleResult(sample.id)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          <span className="text-xs text-muted-foreground">
                            {sampleResultConfig.emptyText ?? "No result yet"}
                          </span>
                          {sample.read?.filesMissing && (
                            <div className="text-xs text-orange-600">
                              Source files deleted
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  ) : null}
                  {(() => {
                    // Per-pipeline source: check pipelineSources map first, fall back to pipelineRunId
                    const sourceRunId =
                      sample.read?.pipelineSources?.[pipelineId] ??
                      sample.read?.pipelineRunId ??
                      null;
                    const sourceRun = sourceRunId
                      ? allRuns.find((r) => r.id === sourceRunId)
                      : null;
                    const sourceLabel = sourceRun?.runNumber
                      ?? (sourceRunId ? sample.read?.pipelineRunNumber : null);

                    return (
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className={cn(
                            "text-xs transition-colors hover:text-foreground hover:underline",
                            sourceLabel
                              ? "font-mono text-muted-foreground"
                              : "text-muted-foreground"
                          )}
                          onClick={() =>
                            setChangeSourceSample({
                              id: sample.id,
                              sampleId: sample.sampleId,
                              currentRunId: sourceRunId,
                            })
                          }
                        >
                          {sourceLabel
                            ? sourceLabel
                            : sample.read
                              ? "Manual"
                              : "Not linked"}
                        </button>
                      </td>
                    );
                  })()}

                  <td className="px-4 py-3 text-right">
                    {initialCheckPending ? (
                      <Button size="sm" variant="outline" disabled>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Checking...
                      </Button>
                    ) : isRunning ? (
                      <Button size="sm" variant="outline" disabled>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Running...
                      </Button>
                    ) : ready ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={systemBlocked || !!isDemo}
                        onClick={() => void handleRunSingle(sample.id)}
                        title={isDemo ? "Disabled in demo" : systemBlocked ? systemReady?.summary : undefined}
                      >
                        {systemBlocked ? (
                          <>
                            <AlertCircle className="mr-1.5 h-3.5 w-3.5" />
                            Blocked
                          </>
                        ) : (
                          <>
                            <Play className="mr-1.5 h-3.5 w-3.5" />
                            Run
                          </>
                        )}
                      </Button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-amber-700">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {reason}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {samples.length === 0 && (
              <tr>
                <td
                  colSpan={columnCount}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No samples in this order.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pipeline Runs table */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">Pipeline Runs</h2>
            {allRuns.length > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">
                {allRuns.length}
              </span>
            )}
          </div>
          {allRuns.length > 0 && (
            <div className="flex items-center gap-2">
              {selectMode ? (
                <>
                  <span className="text-xs text-muted-foreground">
                    {selectedRunIds.size} selected
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setShowBulkDeleteConfirm(true)}
                    disabled={bulkDeleting || selectedRunIds.size === 0 || !!isDemo}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setSelectMode(false);
                      setSelectedRunIds(new Set());
                    }}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setSelectMode(true)}
                  >
                    Select
                  </Button>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-8 w-[160px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                          {opt.value !== "all" && statusCounts[opt.value] ? (
                            <span className="ml-1 text-muted-foreground">
                              ({statusCounts[opt.value]})
                            </span>
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {statusFilter !== "all" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setStatusFilter("all")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {allRuns.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No runs started for this pipeline yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-secondary/30">
                  <tr>
                    {selectMode && (
                      <th className="w-[40px] px-3 py-2.5">
                        <Checkbox
                          checked={allFilteredSelected && deletableFilteredRuns.length > 0}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all runs"
                        />
                      </th>
                    )}
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Run
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Details
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Samples
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Started
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Duration
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Started by
                    </th>
                    <th className="w-[48px] px-4 py-2.5">
                      {/* Actions */}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredRuns.map((run) => {
                    const details = getRunDetails(run);
                    const sampleCount = getSampleCount(run);

                    return (
                      <tr
                        key={run.id}
                        className={cn(
                          "transition-colors hover:bg-secondary/20",
                          selectMode && selectedRunIds.has(run.id) && "bg-secondary/30"
                        )}
                      >
                        {selectMode && (
                          <td className="px-3 py-3 align-top">
                            <Checkbox
                              checked={selectedRunIds.has(run.id)}
                              onCheckedChange={() => toggleSelectRun(run.id)}
                              disabled={run.status === "running"}
                              aria-label={`Select run ${run.runNumber}`}
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 align-top">
                          <code
                            className="rounded bg-muted px-2 py-0.5 text-xs font-mono"
                            title={run.runNumber}
                          >
                            #{run.runNumber.split("-").pop()}
                          </code>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center gap-2">
                            {getStatusBadge(run.status)}
                            {run.status === "running" && run.progress != null && run.progress > 0 && (
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {run.progress}%
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="max-w-[280px] px-4 py-3 align-top">
                          {details ? (
                            <span
                              className={`text-xs ${
                                run.status === "failed"
                                  ? "font-mono text-destructive"
                                  : "text-muted-foreground"
                              }`}
                              title={details}
                            >
                              <span className="line-clamp-2">{details}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top text-xs text-muted-foreground tabular-nums">
                          {sampleCount != null ? sampleCount : "-"}
                        </td>
                        <td className="px-4 py-3 align-top whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(run.startedAt || run.createdAt)}
                        </td>
                        <td className="px-4 py-3 align-top whitespace-nowrap text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {run.status === "running"
                              ? formatDuration(run.startedAt, null)
                              : formatDuration(run.startedAt, run.completedAt)}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top whitespace-nowrap text-xs text-muted-foreground">
                          {getUserDisplay(run)}
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label={`Actions for ${run.runNumber}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onSelect={(event) => {
                                  event.preventDefault();
                                  setDetailRun(run);
                                }}
                              >
                                <Info className="h-4 w-4" />
                                View details
                              </DropdownMenuItem>
                              {!isDemo && (
                                <DropdownMenuItem
                                  variant="destructive"
                                  disabled={run.status === "running" || deletingRun}
                                  onSelect={(event) => {
                                    event.preventDefault();
                                    setDeleteTarget(run);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete run
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredRuns.length === 0 && statusFilter !== "all" && (
                    <tr>
                      <td
                        colSpan={selectMode ? 9 : 8}
                        className="px-4 py-8 text-center text-muted-foreground"
                      >
                        No {statusFilter} runs found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
            <h3 className="text-base font-semibold">Delete Pipeline Run</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Are you sure you want to delete run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                {deleteTarget.runNumber}
              </code>
              ? This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteTarget(null)}
                disabled={deletingRun}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deletingRun}
                onClick={() => void handleDeleteRun(deleteTarget.id)}
              >
                {deletingRun ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Bulk delete confirmation dialog */}
      {/* Run details modal */}
      {detailRun && (() => {
        let parsedConfig: Record<string, unknown> | null = null;
        try {
          parsedConfig = detailRun.config ? JSON.parse(detailRun.config) : null;
        } catch { /* ignore */ }

        const ENUM_LABELS: Record<string, string> = {
          shortReadPaired: "Paired-end",
          shortReadSingle: "Single-end",
          longRead: "Long read",
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="mx-4 w-full max-w-lg rounded-xl border bg-card p-6 shadow-lg">
              <h3 className="text-base font-semibold">
                Run Details
                <code className="ml-2 rounded bg-muted px-2 py-0.5 text-xs font-mono font-normal">
                  {detailRun.runNumber}
                </code>
              </h3>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Status:</span>
                  {getStatusBadge(detailRun.status)}
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground">Started:</span>
                  <span>{formatDateTime(detailRun.startedAt || detailRun.createdAt)}</span>
                </div>
                {detailRun.completedAt && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground">Completed:</span>
                    <span>{formatDateTime(detailRun.completedAt)}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <span className="text-muted-foreground">Duration:</span>
                  <span>
                    {detailRun.status === "running"
                      ? formatDuration(detailRun.startedAt, null)
                      : formatDuration(detailRun.startedAt, detailRun.completedAt)}
                  </span>
                </div>
                {detailRun.user && (
                  <div className="flex gap-2">
                    <span className="text-muted-foreground">Started by:</span>
                    <span>
                      {[detailRun.user.firstName, detailRun.user.lastName]
                        .filter(Boolean)
                        .join(" ") || detailRun.user.email}
                    </span>
                  </div>
                )}
                {parsedConfig && Object.keys(parsedConfig).length > 0 && (
                  <>
                    <div className="border-t pt-3">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Settings
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {Object.entries(parsedConfig).map(([key, value]) => {
                        const schemaProp = pipeline?.configSchema?.properties?.[key];
                        const label = schemaProp?.title || key;
                        let displayValue: string;
                        if (typeof value === "boolean") {
                          displayValue = value ? "Yes" : "No";
                        } else if (typeof value === "string" && ENUM_LABELS[value]) {
                          displayValue = ENUM_LABELS[value];
                        } else {
                          displayValue = String(value ?? "-");
                        }
                        return (
                          <div key={key} className="contents">
                            <span className="text-muted-foreground">{label}:</span>
                            <span className="font-mono text-xs">{displayValue}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                {detailRun.errorTail && (
                  <>
                    <div className="border-t pt-3">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Error
                      </span>
                    </div>
                    <pre className="max-h-40 overflow-auto rounded bg-muted p-3 text-xs font-mono text-destructive">
                      {detailRun.errorTail}
                    </pre>
                  </>
                )}
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDetailRun(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* Change source modal */}
      {changeSourceSample && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
            <h3 className="text-base font-semibold">
              Change Source
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Select which pipeline run provides results for{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                {changeSourceSample.sampleId}
              </code>
            </p>
            {completedRunsForSample.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No completed runs available for this sample.
              </p>
            ) : (
              <div className="mt-4 max-h-64 space-y-1 overflow-y-auto">
                {completedRunsForSample.map((run) => {
                  const isCurrent = run.id === changeSourceSample.currentRunId;
                  return (
                    <button
                      key={run.id}
                      type="button"
                      disabled={changingSource}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        isCurrent
                          ? "border-primary/40 bg-primary/5"
                          : "hover:bg-muted/50"
                      )}
                      onClick={() => {
                        if (!isCurrent) void handleChangeSource(run.id);
                      }}
                    >
                      <div>
                        <span className="font-mono text-xs font-medium">
                          {run.runNumber}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {formatDateTime(run.completedAt || run.createdAt)}
                        </span>
                        {run.user && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {getUserDisplay(run)}
                          </span>
                        )}
                      </div>
                      {isCurrent && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          Current
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setChangeSourceSample(null)}
                disabled={changingSource}
              >
                {changingSource ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Applying...
                  </>
                ) : (
                  "Close"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-xl border bg-card p-6 shadow-lg">
            <h3 className="text-base font-semibold">Delete Pipeline Runs</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Are you sure you want to delete{" "}
              <strong>{selectedRunIds.size}</strong> run{selectedRunIds.size !== 1 ? "s" : ""}?
              This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBulkDeleteConfirm(false)}
                disabled={bulkDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={bulkDeleting}
                onClick={() => void handleBulkDelete()}
              >
                {bulkDeleting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Delete {selectedRunIds.size} run{selectedRunIds.size !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* HTML Report Preview Modal */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="relative flex h-[90vh] w-[90vw] max-w-6xl flex-col rounded-xl border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-medium truncate">{previewFile.label}</h3>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/files/preview?path=${encodeURIComponent(previewFile.path)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  Open in new tab
                  <ExternalLink className="h-3 w-3" />
                </a>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  onClick={() => setPreviewFile(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <iframe
              src={`/api/files/preview?path=${encodeURIComponent(previewFile.path)}`}
              className="flex-1 w-full rounded-b-xl"
              title={previewFile.label}
              sandbox="allow-same-origin allow-scripts"
            />
          </div>
        </div>
      )}
    </div>
  );
}
