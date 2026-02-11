"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Dna, FlaskConical, Upload, MoreHorizontal, Square } from "lucide-react";
import Link from "next/link";

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

function getPipelineIcon(icon: string) {
  switch (icon) {
    case "Dna":
      return <Dna className="h-4 w-4" />;
    case "Upload":
      return <Upload className="h-4 w-4" />;
    default:
      return <FlaskConical className="h-4 w-4" />;
  }
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "-";
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const diff = endDate.getTime() - startDate.getTime();

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
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

function getLatestTimestamp(...values: Array<string | null | undefined>): string | null {
  const sorted = values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return sorted[0] || null;
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

type RunData = {
  id: string;
  runNumber: string;
  pipelineName: string;
  pipelineIcon: string;
  study: { id: string; title: string } | null;
  status: string;
  progress: number | null;
  currentStep: string | null;
  startedAt: string | null;
  completedAt: string | null;
  queuedAt: string | null;
  lastEventAt?: string | null;
  lastWeblogAt?: string | null;
  lastTraceAt?: string | null;
  queueUpdatedAt?: string | null;
  updatedAt?: string;
  user: { firstName: string; lastName: string; email?: string };
  createdAt: string;
  queueStatus?: string | null;
  queueReason?: string | null;
  queueJobId?: string | null;
  _count: { assembliesCreated: number; binsCreated: number };
};

export default function AnalysisDashboardPage() {
  const [pipelineFilter, setPipelineFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deleteTarget, setDeleteTarget] = useState<RunData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [stopTarget, setStopTarget] = useState<RunData | null>(null);
  const [stopping, setStopping] = useState(false);
  const [syncDisabled, setSyncDisabled] = useState(false);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  // Build query params
  const params = new URLSearchParams();
  if (pipelineFilter !== "all") params.set("pipelineId", pipelineFilter);
  if (statusFilter !== "all") params.set("status", statusFilter);

  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR(`/api/pipelines/runs?${params.toString()}`, fetcher, {
    refreshInterval: 10000, // Refresh every 10 seconds for running jobs
  });

  const syncRun = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/pipelines/runs/${runId}/sync`, { method: "POST" });
      if (!res.ok) {
        if (res.status === 403) {
          setSyncDisabled(true);
          setSyncWarning("Auto-sync unavailable for your role (HTTP 403). Last event may be stale.");
          return;
        }
        setSyncWarning(`Auto-sync failed (HTTP ${res.status}).`);
        return;
      }
      setSyncWarning(null);
    } catch {
      setSyncWarning("Auto-sync failed due to a network or server error.");
    }
  }, []);

  const handleRefresh = async () => {
    if (!syncDisabled && data?.runs?.length) {
      const activeRuns = data.runs.filter((run: { status: string; queueStatus?: string | null }) =>
        ["running", "queued", "pending"].includes(run.status) || isQueueStateLikelyActive(run.queueStatus)
      );
      if (activeRuns.length > 0) {
        await Promise.allSettled(
          activeRuns.map((run: { id: string }) => syncRun(run.id))
        );
      }
    }
    mutate();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/pipelines/runs/${deleteTarget.id}/delete`, {
        method: "POST",
      });
      if (res.ok) {
        setDeleteTarget(null);
        mutate();
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleStop = async () => {
    if (!stopTarget) return;
    setStopping(true);
    try {
      const res = await fetch(`/api/pipelines/runs/${stopTarget.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setStopTarget(null);
        mutate();
      }
    } finally {
      setStopping(false);
    }
  };

  // Derive a stable key from active run IDs so the effect only re-runs
  // when the set of active runs actually changes, not on every SWR fetch.
  const activeIds = (data?.runs ?? [])
    .filter((run: { status: string; queueStatus?: string | null }) =>
      ["running", "queued", "pending"].includes(run.status) || isQueueStateLikelyActive(run.queueStatus)
    )
    .map((run: { id: string }) => run.id) as string[];
  const activeKey = activeIds.join(",");

  useEffect(() => {
    if (syncDisabled || !activeKey) return;
    const ids = activeKey.split(",");
    let active = true;

    const tick = async () => {
      await Promise.allSettled(
        ids.map((runId) => syncRun(runId))
      );
      if (active) {
        mutate();
      }
    };

    const interval = setInterval(tick, 20000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [activeKey, mutate, syncDisabled, syncRun]);

  return (
    <PageContainer>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Analysis Runs</h1>
          <p className="text-muted-foreground">
            Monitor and manage pipeline executions
          </p>
          {syncWarning && (
            <p className="text-xs text-amber-700 mt-1">{syncWarning}</p>
          )}
        </div>
        <Button variant="outline" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <Select value={pipelineFilter} onValueChange={setPipelineFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Pipeline" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Pipelines</SelectItem>
            <SelectItem value="mag">MAG Pipeline</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Runs Table */}
      <GlassCard>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-12 text-destructive">
            Failed to load pipeline runs
          </div>
        ) : data?.runs?.length === 0 ? (
          <div className="text-center py-12">
            <FlaskConical className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground font-medium">No pipeline runs found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Pipeline runs are started from the study page. Open a study and go to the Pipelines tab to launch an analysis.
            </p>
            <Button variant="outline" className="mt-4" asChild>
              <Link href="/dashboard/studies">View Studies</Link>
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Pipeline</TableHead>
                <TableHead>Study</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Started By</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.runs?.map((run: RunData) => (
                (() => {
                  const effectiveStatus =
                    ["completed", "failed", "cancelled"].includes(run.status) &&
                    isQueueStateLikelyActive(run.queueStatus)
                      ? queueStateToDisplayStatus(run.queueStatus)
                      : run.status;
                  return (
                <TableRow
                  key={run.id}
                  className={effectiveStatus === "running" ? "bg-blue-50/60 dark:bg-blue-950/30" : undefined}
                >
                  <TableCell>
                    <Link
                      href={`/dashboard/analysis/${run.id}`}
                      className="font-mono text-sm hover:underline"
                    >
                      {run.runNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getPipelineIcon(run.pipelineIcon)}
                      <span>{run.pipelineName}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {run.study ? (
                      <Link
                        href={`/dashboard/studies/${run.study.id}`}
                        className="hover:underline"
                      >
                        {run.study.title}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {getStatusBadge(effectiveStatus)}
                      <span className="text-xs text-muted-foreground">
                        Last event: {formatRelativeTime(getLatestTimestamp(
                          run.lastEventAt,
                          run.lastWeblogAt,
                          run.lastTraceAt,
                          run.queueUpdatedAt,
                          run.completedAt,
                          run.startedAt,
                          run.queuedAt,
                          run.updatedAt,
                          run.createdAt
                        ))}
                      </span>
                      {run.queueStatus && (
                        <Badge
                          variant="outline"
                          className="text-xs w-fit"
                          title={run.queueReason ? `Reason: ${run.queueReason}` : undefined}
                        >
                          {run.queueJobId?.startsWith("local-") ? "Local" : "Queue"}: {run.queueStatus}
                          {run.queueReason ? ` (${run.queueReason})` : ""}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {effectiveStatus === "running" ? (
                      <div className="flex flex-col">
                        <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-600 transition-all"
                            style={{ width: `${run.progress || 0}%` }}
                          />
                        </div>
                        {run.currentStep && (
                          <span className="text-xs text-muted-foreground mt-1">
                            {run.currentStep}
                          </span>
                        )}
                      </div>
                    ) : effectiveStatus === "completed" ? (
                      <span className="text-sm text-muted-foreground">
                        {run._count.assembliesCreated} assemblies, {run._count.binsCreated} bins
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDuration(run.startedAt, run.completedAt)}
                  </TableCell>
                  <TableCell>
                    {[run.user?.firstName, run.user?.lastName].filter(Boolean).join(" ") || run.user?.email || "Unknown"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(run.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {effectiveStatus === "running" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setStopTarget(run)}
                        >
                          <Square className="h-4 w-4" />
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={effectiveStatus === "running"}
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setDeleteTarget(run)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
                  );
                })()
              ))}
            </TableBody>
          </Table>
        )}
      </GlassCard>

      {/* Summary stats */}
      {data?.runs && data.runs.length > 0 && (
        <div className="mt-4 text-sm text-muted-foreground">
          Showing {data.runs.length} of {data.total} runs
        </div>
      )}

      {/* Stop confirmation dialog */}
      <Dialog open={!!stopTarget} onOpenChange={(open) => { if (!open) setStopTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop Run {stopTarget?.runNumber}?</DialogTitle>
            <DialogDescription>
              This will stop the pipeline run. If the underlying process is still
              running it will be terminated. If the process has already died, the
              run will be marked as failed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStopTarget(null)} disabled={stopping}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleStop} disabled={stopping}>
              {stopping ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Stop Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Run {deleteTarget?.runNumber}?</DialogTitle>
            <DialogDescription>
              This will permanently delete the run folder and all related database
              records (steps, artifacts, assemblies, and bins created by this run).
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
