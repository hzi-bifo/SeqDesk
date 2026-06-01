"use client";

import Link from "next/link";
import {
  Archive,
  Bell,
  Check,
  ChevronDown,
  Eraser,
  ExternalLink,
  Loader2,
  Play,
  Square,
} from "lucide-react";
import {
  useState,
  useEffect,
  useContext,
  useMemo,
  useCallback,
  useRef,
  type CSSProperties,
} from "react";
import { useHelpText } from "@/lib/useHelpText";
import { PANEL_NOTIFICATIONS_REFRESH_EVENT } from "@/lib/notifications/client";
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SidebarContext,
} from "./SidebarContext";

const FOOTER_HEIGHT_PROPERTY = "--seqdesk-footer-height";

interface AdminActivityJob {
  id: string;
  type?: "pipeline-db-download" | "dummy-seed" | "example-dataset" | "install-profile-reload";
  label: string;
  state: "running" | "success" | "error";
  phase?: string;
  bytesDownloaded?: number;
  totalBytes?: number;
  progressPercent?: number | null;
  speedBytesPerSecond?: number | null;
  etaSeconds?: number | null;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
  targetPath?: string;
  error?: string;
  logAvailable?: boolean;
  logExcerpt?: string[];
}

interface WorkerLatest {
  id: string;
  name: string;
  pid: number;
  startedAt: string;
  stoppedAt: string | null;
  status: string;
  exitCode: number | null;
  logPath: string;
  lastErrorMsg: string | null;
  startedByEmail: string | null;
}

interface WorkerCard {
  name: string;
  label: string;
  paused: boolean;
  latest: WorkerLatest | null;
}

interface WorkerLogResponse {
  lines: string[];
  logPath?: string;
  message?: string;
}

type PipelineLoadStatusCounts = {
  pending: number;
  queued: number;
  running: number;
};

type PipelineLoadModeCounts = {
  slurm: number;
  local: number;
  unknown: number;
};

type PipelineLoadMode = keyof PipelineLoadModeCounts;

interface PipelineLoadUserSummary {
  userId: string;
  name: string;
  email: string | null;
  active: number;
  staleActive?: number;
  statuses: PipelineLoadStatusCounts;
  staleByStatus?: PipelineLoadStatusCounts;
  modes: PipelineLoadModeCounts;
}

interface PipelineLoadRunResources {
  queue: string | null;
  cores: number | null;
  memory: string | null;
  timeLimitHours: number | null;
}

interface PipelineLoadRunSummary {
  id: string;
  runNumber: string;
  pipelineId: string;
  targetType: string;
  targetLabel: string | null;
  userId: string;
  userName: string;
  userEmail: string | null;
  status: keyof PipelineLoadStatusCounts;
  mode: keyof PipelineLoadModeCounts;
  queueJobId: string | null;
  queueStatus: string | null;
  queueReason: string | null;
  activeSince: string;
  updatedAt: string;
  stale: boolean;
  resources: PipelineLoadRunResources | null;
}

interface PipelineLoadSummary {
  totalActive: number;
  statuses: PipelineLoadStatusCounts;
  modes: PipelineLoadModeCounts;
  staleActive: number;
  staleByStatus: PipelineLoadStatusCounts;
  totalUsers: number;
  visibleUsers: PipelineLoadUserSummary[];
  hiddenUserCount: number;
  activeRuns?: PipelineLoadRunSummary[];
  hiddenRunCount?: number;
  users?: PipelineLoadUserSummary[];
  updatedAt: string;
}

interface WorkerStatusPayload {
  workers: WorkerCard[];
  pipelineLoad: PipelineLoadSummary | null;
  workersError: string | null;
  pipelineLoadError: string | null;
}

interface FooterNotification {
  id: string;
  eventType: string;
  severity: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  sourceType: string;
  sourceId: string | null;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface NotificationPayload {
  enabled?: boolean;
  notifications?: FooterNotification[];
  unreadCount?: number;
}

type WorkerAction = "start" | "stop" | "clear";

interface WorkerActionError {
  action: WorkerAction;
  message: string;
}

interface BusyWorkerAction {
  name: string;
  action: WorkerAction;
}

const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

function formatBytes(value?: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(seconds?: number | null): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 1) {
    return null;
  }
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function formatActivitySummary(job: AdminActivityJob): string {
  const phase =
    job.state === "error"
      ? "Failed"
      : job.phase === "verifying"
        ? "Verifying"
        : job.phase === "installing"
          ? "Installing"
          : job.phase === "extracting"
            ? "Extracting"
            : job.phase === "seeding"
              ? "Seeding"
              : "Downloading";
  const parts = [`${phase} ${job.label}`];
  if (typeof job.progressPercent === "number") {
    parts.push(`${job.progressPercent}%`);
  }
  const downloaded = formatBytes(job.bytesDownloaded);
  const total = formatBytes(job.totalBytes);
  if (downloaded && total) {
    parts.push(`${downloaded} / ${total}`);
  } else if (downloaded) {
    parts.push(`${downloaded}`);
  }
  const speed = formatBytes(job.speedBytesPerSecond);
  if (speed && job.state === "running") {
    parts.push(`${speed}/s`);
  }
  const eta = formatDuration(job.etaSeconds);
  if (eta && job.state === "running") {
    parts.push(`ETA ${eta}`);
  }
  if (job.state === "error" && job.error) {
    parts.push(job.error);
  }
  return parts.join(" · ");
}

function formatRelative(ts: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatElapsedSince(ts: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (seconds < 60) return "<1m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function getActivityTimestamp(job: AdminActivityJob): string | undefined {
  return job.updatedAt || job.finishedAt || job.startedAt;
}

function isStaleRunningActivity(job: AdminActivityJob): boolean {
  if (job.state !== "running") return false;
  const timestamp = getActivityTimestamp(job);
  if (!timestamp) return false;
  const parsed = new Date(timestamp).getTime();
  return Number.isFinite(parsed) && Date.now() - parsed > STALE_RUNNING_MS;
}

function canHideActivity(job: AdminActivityJob): boolean {
  return job.state === "error" || isStaleRunningActivity(job);
}

function parsePipelineDatabaseActivityId(id: string) {
  const [, prefix, pipelineId, databaseId] = id.match(/^(pipeline-db):([^:]+):(.+)$/) || [];
  return prefix && pipelineId && databaseId ? { pipelineId, databaseId } : null;
}

function getWorkerStatus(worker: WorkerCard): string {
  const status = worker.latest?.status ?? "STOPPED";
  if (worker.paused && (status === "RUNNING" || status === "STOPPING")) {
    return "PAUSED";
  }
  return status;
}

function formatWorkerStatus(status: string): string {
  switch (status) {
    case "RUNNING":
      return "Running";
    case "STOPPING":
      return "Stopping";
    case "ERROR":
      return "Error";
    case "ZOMBIE":
      return "Zombie";
    case "PAUSED":
      return "Paused";
    default:
      return status.charAt(0) + status.slice(1).toLowerCase();
  }
}

function shouldShowWorker(worker: WorkerCard): boolean {
  return ["RUNNING", "STOPPING", "ERROR", "ZOMBIE", "PAUSED"].includes(getWorkerStatus(worker));
}

function canStartWorker(status: string): boolean {
  return !["RUNNING", "STOPPING", "PAUSED"].includes(status);
}

function canStopWorker(status: string): boolean {
  return status === "RUNNING" || status === "PAUSED";
}

function canClearWorker(status: string): boolean {
  return status === "ZOMBIE";
}

function workerBadgeClass(status: string): string {
  if (status === "ERROR" || status === "ZOMBIE") {
    return "border-red-200 bg-red-100 text-red-700";
  }
  if (status === "PAUSED" || status === "STOPPING") {
    return "border-amber-200 bg-amber-100 text-amber-800";
  }
  if (status === "RUNNING") {
    return "border-emerald-200 bg-emerald-100 text-emerald-800";
  }
  return "border-border bg-muted text-muted-foreground";
}

function hasPipelineLoad(load: PipelineLoadSummary | null): load is PipelineLoadSummary {
  return Boolean(load && load.totalActive > 0);
}

function formatPlural(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatSlurmModeCount(value: number, totalActive: number): string {
  return value === 1 && totalActive === 1 ? "SLURM" : `${value} on SLURM`;
}

function formatPipelineModePart(mode: PipelineLoadMode, value: number, totalActive: number): string {
  if (mode === "slurm") return formatSlurmModeCount(value, totalActive);
  if (mode === "local") return `${value} local`;
  return `${value} unknown`;
}

function formatPipelineLoadSummary(load: PipelineLoadSummary): string {
  const parts = [`${formatPlural(load.totalActive, "job")} active`];
  if (load.modes.slurm > 0) {
    parts.push(formatPipelineModePart("slurm", load.modes.slurm, load.totalActive));
  }
  if (load.modes.local > 0) {
    parts.push(formatPipelineModePart("local", load.modes.local, load.totalActive));
  }
  if (load.modes.unknown > 0) {
    parts.push(formatPipelineModePart("unknown", load.modes.unknown, load.totalActive));
  }
  return parts.join(" · ");
}

function formatCompactPipelineLoadSummary(load: PipelineLoadSummary): string {
  return formatPlural(load.totalActive, "job");
}

function formatPipelineStatusBreakdown(statuses: PipelineLoadStatusCounts): string {
  return [
    statuses.running > 0 ? `${statuses.running} running` : null,
    statuses.queued > 0 ? `${statuses.queued} queued` : null,
    statuses.pending > 0 ? `${statuses.pending} pending` : null,
  ].filter(Boolean).join(" · ") || "None";
}

function formatPipelineModeBreakdown(modes: PipelineLoadModeCounts): string {
  const total = modes.slurm + modes.local + modes.unknown;
  return [
    modes.slurm > 0 ? formatPipelineModePart("slurm", modes.slurm, total) : null,
    modes.local > 0 ? formatPipelineModePart("local", modes.local, total) : null,
    modes.unknown > 0 ? formatPipelineModePart("unknown", modes.unknown, total) : null,
  ].filter(Boolean).join(" · ") || "None";
}

function formatPipelineUserSummary(user: PipelineLoadUserSummary): string {
  const parts = [`${formatPlural(user.active, "job")} active`];
  if (user.modes.slurm > 0) {
    parts.push(formatPipelineModePart("slurm", user.modes.slurm, user.active));
  }
  if (user.modes.local > 0) {
    parts.push(formatPipelineModePart("local", user.modes.local, user.active));
  }
  if (user.modes.unknown > 0) {
    parts.push(formatPipelineModePart("unknown", user.modes.unknown, user.active));
  }
  return parts.join(" · ");
}

function pipelineLoadIndicatorClass(load: PipelineLoadSummary): string {
  return load.staleActive > 0 ? "bg-amber-500" : "bg-[#00BD7D]";
}

function pipelineLoadButtonClass(load: PipelineLoadSummary): string {
  if (load.staleActive > 0) {
    return "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
  }
  return "border-transparent text-foreground hover:border-border hover:bg-muted";
}

function getVisiblePipelineUsers(load: PipelineLoadSummary): PipelineLoadUserSummary[] {
  return Array.isArray(load.visibleUsers)
    ? load.visibleUsers
    : Array.isArray(load.users)
      ? load.users
      : [];
}

function getVisiblePipelineRuns(load: PipelineLoadSummary): PipelineLoadRunSummary[] {
  return Array.isArray(load.activeRuns) ? load.activeRuns : [];
}

function formatPipelineRunElapsed(run: PipelineLoadRunSummary): string {
  const elapsed = formatElapsedSince(run.activeSince);
  if (run.status === "running") return `Running for ${elapsed}`;
  if (run.status === "queued") return `Queued for ${elapsed}`;
  return `Pending for ${elapsed}`;
}

function formatPipelineRunResources(resources: PipelineLoadRunResources | null): string {
  if (!resources) return "Resources not recorded";
  return [
    resources.queue ? `queue ${resources.queue}` : null,
    resources.cores ? `${resources.cores} CPU` : null,
    resources.memory,
    resources.timeLimitHours ? `${resources.timeLimitHours}h limit` : null,
  ].filter(Boolean).join(" · ") || "Resources not recorded";
}

function formatRunMode(run: PipelineLoadRunSummary): string {
  if (run.mode === "slurm") return run.queueJobId ? `SLURM ${run.queueJobId}` : "SLURM";
  if (run.mode === "local") return "Local";
  return "Unknown mode";
}

function notificationSeverityClass(severity: string): string {
  if (severity === "success") return "bg-[#00BD7D]";
  if (severity === "warning") return "bg-amber-500";
  if (severity === "error") return "bg-destructive";
  return "bg-sky-500";
}

function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function Footer() {
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const [activityJobs, setActivityJobs] = useState<AdminActivityJob[]>([]);
  const [workers, setWorkers] = useState<WorkerCard[]>([]);
  const [pipelineLoad, setPipelineLoad] = useState<PipelineLoadSummary | null>(null);
  const [workersError, setWorkersError] = useState<string | null>(null);
  const [pipelineLoadError, setPipelineLoadError] = useState<string | null>(null);
  const [workerLogs, setWorkerLogs] = useState<Record<string, WorkerLogResponse>>({});
  const [openWorkerLogs, setOpenWorkerLogs] = useState<Record<string, boolean>>({});
  const [busyActivityId, setBusyActivityId] = useState<string | null>(null);
  const [busyWorkerAction, setBusyWorkerAction] = useState<BusyWorkerAction | null>(null);
  const [workerActionErrors, setWorkerActionErrors] = useState<Record<string, WorkerActionError>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pipelineLoadOpen, setPipelineLoadOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notifications, setNotifications] = useState<FooterNotification[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [expandedNotificationIds, setExpandedNotificationIds] = useState<Record<string, boolean>>({});
  const [busyNotificationId, setBusyNotificationId] = useState<string | null>(null);
  const footerRef = useRef<HTMLElement | null>(null);
  const { showHelpText, isLoaded, toggleHelpText } = useHelpText();
  const sidebarContext = useContext(SidebarContext);
  const collapsed = sidebarContext?.collapsed ?? false;
  const footerOffset = collapsed
    ? SIDEBAR_COLLAPSED_WIDTH
    : sidebarContext?.sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH;

  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) {
      return;
    }

    const root = document.documentElement;
    const syncFooterHeight = () => {
      const height = Math.ceil(footer.getBoundingClientRect().height);
      root.style.setProperty(FOOTER_HEIGHT_PROPERTY, `${height}px`);
    };

    syncFooterHeight();
    window.addEventListener("resize", syncFooterHeight);

    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.removeEventListener("resize", syncFooterHeight);
        root.style.removeProperty(FOOTER_HEIGHT_PROPERTY);
      };
    }

    const observer = new ResizeObserver(syncFooterHeight);
    observer.observe(footer);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncFooterHeight);
      root.style.removeProperty(FOOTER_HEIGHT_PROPERTY);
    };
  }, []);

  const refreshActivity = useCallback(async () => {
    const response = await fetch("/api/admin/activity", { cache: "no-store" });
    if (!response.ok) {
      setActivityJobs([]);
      return;
    }
    const payload = (await response.json()) as { jobs?: AdminActivityJob[] };
    setActivityJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
  }, []);

  const refreshWorkerLog = useCallback(async (name: string) => {
    try {
      const response = await fetch(
        `/api/admin/workers/${encodeURIComponent(name)}/logs?tail=100`,
        { cache: "no-store" }
      );
      if (!response.ok) return;
      const payload = (await response.json()) as WorkerLogResponse;
      setWorkerLogs((prev) => ({ ...prev, [name]: payload }));
    } catch (error) {
      console.error(`Failed to load worker log for ${name}`, error);
    }
  }, []);

  const loadWorkerStatus = useCallback(async (): Promise<WorkerStatusPayload> => {
    const response = await fetch("/api/admin/workers", { cache: "no-store" });
    if (!response.ok) {
      return {
        workers: [],
        pipelineLoad: null,
        workersError: null,
        pipelineLoadError: null,
      };
    }
    const payload = (await response.json()) as {
      workers?: WorkerCard[];
      pipelineLoad?: PipelineLoadSummary | null;
      workersError?: string | null;
      pipelineLoadError?: string | null;
    };
    return {
      workers: Array.isArray(payload.workers) ? payload.workers : [],
      pipelineLoad: payload.pipelineLoad ?? null,
      workersError: payload.workersError ?? null,
      pipelineLoadError: payload.pipelineLoadError ?? null,
    };
  }, []);

  const reconcileWorkerActionErrors = useCallback((nextWorkers: WorkerCard[]) => {
    setWorkerActionErrors((prev) => {
      let changed = false;
      const next = { ...prev };
      const workersByName = new Map(nextWorkers.map((worker) => [worker.name, worker]));

      for (const [name, error] of Object.entries(prev)) {
        const worker = workersByName.get(name);
        if (!worker) {
          delete next[name];
          changed = true;
          continue;
        }

        const status = getWorkerStatus(worker);
        if (
          (error.action === "start" && !canStartWorker(status)) ||
          (error.action === "stop" && !canStopWorker(status)) ||
          (error.action === "clear" && !canClearWorker(status))
        ) {
          delete next[name];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, []);

  const refreshWorkers = useCallback(async () => {
    const next = await loadWorkerStatus();
    setWorkers(next.workers);
    setPipelineLoad(next.pipelineLoad);
    setWorkersError(next.workersError);
    setPipelineLoadError(next.pipelineLoadError);
    reconcileWorkerActionErrors(next.workers);
  }, [loadWorkerStatus, reconcileWorkerActionErrors]);

  const refreshNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications?limit=20&archived=false", {
        cache: "no-store",
      });
      if (!response.ok) {
        setNotifications([]);
        setUnreadNotificationCount(0);
        return;
      }
      const payload = (await response.json()) as NotificationPayload;
      const enabled = payload.enabled !== false;
      setNotificationsEnabled(enabled);
      if (!enabled) {
        setNotificationsOpen(false);
        setNotifications([]);
        setUnreadNotificationCount(0);
        return;
      }
      setNotifications(Array.isArray(payload.notifications) ? payload.notifications : []);
      setUnreadNotificationCount(
        typeof payload.unreadCount === "number" ? payload.unreadCount : 0
      );
    } catch {
      setNotifications([]);
      setUnreadNotificationCount(0);
    }
  }, []);

  const hideActivity = async (job: AdminActivityJob) => {
    setBusyActivityId(job.id);
    try {
      const response = await fetch(
        `/api/admin/activity/jobs/${encodeURIComponent(job.id)}/hide`,
        { method: "POST" }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        jobs?: AdminActivityJob[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setActivityJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
    } catch (error) {
      console.error("Failed to hide admin activity", error);
      await refreshActivity().catch(() => undefined);
    } finally {
      setBusyActivityId(null);
    }
  };

  const runWorkerAction = async (worker: WorkerCard, action: WorkerAction) => {
    if (busyWorkerAction) return;
    if (
      action === "stop" &&
      !window.confirm(`Stop ${worker.label}? The worker can be started again from this footer or the full background workers page.`)
    ) {
      return;
    }
    if (
      action === "clear" &&
      !window.confirm(`Clear zombie status for ${worker.label}? This only clears the stale process row.`)
    ) {
      return;
    }

    setBusyWorkerAction({ name: worker.name, action });
    setWorkerActionErrors((prev) => {
      const next = { ...prev };
      delete next[worker.name];
      return next;
    });
    try {
      const endpointAction = action === "start" ? "start" : "stop";
      const response = await fetch(`/api/admin/workers/${encodeURIComponent(worker.name)}/${endpointAction}`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      await refreshWorkers();
    } catch (error) {
      setWorkerActionErrors((prev) => ({
        ...prev,
        [worker.name]: {
          action,
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    } finally {
      setBusyWorkerAction(null);
    }
  };

  const markNotificationRead = async (notification: FooterNotification) => {
    if (notification.readAt || busyNotificationId) return;
    setBusyNotificationId(notification.id);
    try {
      const response = await fetch(`/api/notifications/${encodeURIComponent(notification.id)}/read`, {
        method: "POST",
      });
      if (response.ok) {
        await refreshNotifications();
      }
    } finally {
      setBusyNotificationId(null);
    }
  };

  const archiveNotification = async (notification: FooterNotification) => {
    if (busyNotificationId) return;
    setBusyNotificationId(notification.id);
    try {
      const response = await fetch(
        `/api/notifications/${encodeURIComponent(notification.id)}/archive`,
        { method: "POST" }
      );
      if (response.ok) {
        await refreshNotifications();
      }
    } finally {
      setBusyNotificationId(null);
    }
  };

  const markAllNotificationsRead = async () => {
    if (busyNotificationId) return;
    setBusyNotificationId("__all__");
    try {
      const response = await fetch("/api/notifications/read-all", { method: "POST" });
      if (response.ok) {
        await refreshNotifications();
      }
    } finally {
      setBusyNotificationId(null);
    }
  };

  const cancelDatabaseDownload = async (job: AdminActivityJob) => {
    const ids = parsePipelineDatabaseActivityId(job.id);
    if (!ids) return;
    setBusyActivityId(job.id);
    try {
      const response = await fetch("/api/admin/settings/pipelines/download-db/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      await refreshActivity();
    } catch (error) {
      console.error("Failed to cancel database download", error);
    } finally {
      setBusyActivityId(null);
    }
  };

  useEffect(() => {
    setCurrentTime(new Date());
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadActivity() {
      try {
        const response = await fetch("/api/admin/activity", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as { jobs?: AdminActivityJob[] };
        if (!cancelled) setActivityJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
      } catch {
        if (!cancelled) setActivityJobs([]);
      }
    }

    void loadActivity();
    const timer = setInterval(() => void loadActivity(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkers() {
      try {
        const next = await loadWorkerStatus();
        if (!cancelled) {
          setWorkers(next.workers);
          setPipelineLoad(next.pipelineLoad);
          setWorkersError(next.workersError);
          setPipelineLoadError(next.pipelineLoadError);
          reconcileWorkerActionErrors(next.workers);
        }
      } catch {
        if (!cancelled) {
          setWorkers([]);
          setPipelineLoad(null);
          setWorkersError(null);
          setPipelineLoadError(null);
          reconcileWorkerActionErrors([]);
        }
      }
    }

    void loadWorkers();
    const timer = setInterval(() => void loadWorkers(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [loadWorkerStatus, reconcileWorkerActionErrors]);

  useEffect(() => {
    let cancelled = false;

    async function loadNotifications() {
      if (cancelled) return;
      await refreshNotifications();
    }

    void loadNotifications();
    const timer = setInterval(() => void loadNotifications(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshNotifications]);

  useEffect(() => {
    const handleNotificationRefresh = () => void refreshNotifications();
    window.addEventListener(PANEL_NOTIFICATIONS_REFRESH_EVENT, handleNotificationRefresh);
    return () => {
      window.removeEventListener(PANEL_NOTIFICATIONS_REFRESH_EVENT, handleNotificationRefresh);
    };
  }, [refreshNotifications]);

  const visibleJobs = useMemo(
    () =>
      activityJobs.filter(
        (job) => job.state === "running" || job.state === "error"
      ),
    [activityJobs]
  );
  const visibleWorkers = useMemo(() => workers.filter(shouldShowWorker), [workers]);
  const workerActionBusy = Boolean(busyWorkerAction);
  const activePipelineLoad = hasPipelineLoad(pipelineLoad) ? pipelineLoad : null;
  const pipelineLoadSummary = activePipelineLoad
    ? formatPipelineLoadSummary(activePipelineLoad)
    : null;
  const statusWarnings = [workersError, pipelineLoadError].filter(Boolean) as string[];
  const statusWarningSummary =
    statusWarnings.length > 0 ? "Admin status: partial data unavailable" : null;
  const primaryJob = visibleJobs[0] || null;
  const primaryWorker = primaryJob ? null : visibleWorkers[0] || null;
  const primarySummary = primaryJob
    ? formatActivitySummary(primaryJob)
    : primaryWorker
      ? `Background workers: ${primaryWorker.label} · ${formatWorkerStatus(getWorkerStatus(primaryWorker))}`
      : pipelineLoadSummary ?? statusWarningSummary;
  const secondaryPipelineLoadSummary =
    primarySummary && pipelineLoadSummary && primarySummary !== pipelineLoadSummary
      ? pipelineLoadSummary
      : null;
  const primaryIsPipelineLoad = Boolean(
    activePipelineLoad && primarySummary === pipelineLoadSummary
  );
  const visiblePipelineUsers = activePipelineLoad
    ? getVisiblePipelineUsers(activePipelineLoad)
    : [];
  const visiblePipelineRuns = activePipelineLoad
    ? getVisiblePipelineRuns(activePipelineLoad)
    : [];
  const primaryIsError =
    primaryJob?.state === "error" ||
    Boolean(primaryWorker && ["ERROR", "ZOMBIE"].includes(getWorkerStatus(primaryWorker)));
  const hasDetails =
    visibleJobs.length > 0 ||
    visibleWorkers.length > 0 ||
    statusWarnings.length > 0;

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const renderPipelineLoadButton = (
    load: PipelineLoadSummary,
    summary: string,
    maxWidthClass: string
  ) => (
    <button
      type="button"
      aria-expanded={pipelineLoadOpen}
      aria-label={`Pipeline jobs, ${summary}`}
      title={summary}
      className={`inline-flex min-w-0 items-center rounded border px-1.5 py-0.5 text-left transition-colors ${maxWidthClass} ${pipelineLoadButtonClass(
        load
      )}`}
      onClick={() => {
        setPipelineLoadOpen((open) => !open);
        setDetailsOpen(false);
      }}
    >
      <span className="min-w-0 truncate">
        <span className="hidden sm:inline">{summary}</span>
        <span className="sm:hidden">{formatCompactPipelineLoadSummary(load)}</span>
      </span>
    </button>
  );

  return (
    <footer
      ref={footerRef}
      className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background px-2 py-1 transition-all duration-300 md:left-[var(--seqdesk-sidebar-offset)] sm:px-4 sm:py-1.5"
      style={{
        "--seqdesk-sidebar-offset": `${footerOffset}px`,
        right: "var(--entity-notes-sidebar-offset, 0px)",
      } as CSSProperties}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="relative flex min-w-0 items-center gap-2 sm:gap-4">
          {isLoaded && (
            <button
              onClick={toggleHelpText}
              className={`flex shrink-0 items-center gap-1.5 hover:text-foreground transition-colors ${
                showHelpText ? "text-foreground" : ""
              }`}
              aria-label={`Help tips ${showHelpText ? "on" : "off"}`}
              title={showHelpText ? "Hide help text" : "Show help text"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${showHelpText ? "bg-foreground" : "bg-muted-foreground"}`} />
              <span className="hidden sm:inline">Help tips {showHelpText ? "on" : "off"}</span>
              <span className="sm:hidden">Tips {showHelpText ? "on" : "off"}</span>
            </button>
          )}
          {primarySummary && (
            <div className="flex min-w-0 items-center gap-2">
              {primaryIsPipelineLoad && activePipelineLoad ? (
                <>
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${pipelineLoadIndicatorClass(
                      activePipelineLoad
                    )}`}
                  />
                  {renderPipelineLoadButton(activePipelineLoad, primarySummary, "max-w-[52vw]")}
                </>
              ) : (
                <>
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      primaryIsError ? "bg-destructive" : "bg-[#00BD7D]"
                    }`}
                  />
                  <span
                    className={`max-w-[52vw] truncate ${
                      primaryIsError ? "text-destructive" : "text-foreground"
                    }`}
                    title={primarySummary}
                  >
                    {primarySummary}
                  </span>
                  {hasDetails && (
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      onClick={() => {
                        setDetailsOpen((open) => !open);
                        setPipelineLoadOpen(false);
                      }}
                    >
                      details
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {secondaryPipelineLoadSummary && activePipelineLoad && (
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${pipelineLoadIndicatorClass(
                  activePipelineLoad
                )}`}
              />
              {renderPipelineLoadButton(
                activePipelineLoad,
                secondaryPipelineLoadSummary,
                "max-w-[36vw]"
              )}
            </div>
          )}
          {pipelineLoadOpen && activePipelineLoad && (
            <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-50 max-h-[70vh] w-[min(480px,calc(100vw-2rem))] overflow-auto rounded-md border border-border bg-background p-3 text-xs shadow-lg">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <span className="font-medium text-foreground">Pipeline jobs</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    Updated {formatRelative(activePipelineLoad.updatedAt)}
                  </span>
                </div>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setPipelineLoadOpen(false)}
                >
                  Close
                </button>
              </div>

              <div className="space-y-3">
                <section className="rounded border border-border/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">
                        {formatPlural(activePipelineLoad.totalActive, "job")} active
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        {formatPipelineLoadSummary(activePipelineLoad)}
                      </p>
                    </div>
                    {activePipelineLoad.staleActive > 0 && (
                      <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                        {formatPlural(activePipelineLoad.staleActive, "stale job")}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-[11px] uppercase text-muted-foreground">Status</p>
                      <p className="mt-0.5 text-foreground">
                        {formatPipelineStatusBreakdown(activePipelineLoad.statuses)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase text-muted-foreground">Execution</p>
                      <p className="mt-0.5 text-foreground">
                        {formatPipelineModeBreakdown(activePipelineLoad.modes)}
                      </p>
                    </div>
                    {activePipelineLoad.staleActive > 0 && (
                      <div className="sm:col-span-2">
                        <p className="text-[11px] uppercase text-muted-foreground">Stale jobs</p>
                        <p className="mt-0.5 text-foreground">
                          {formatPipelineStatusBreakdown(activePipelineLoad.staleByStatus)}
                        </p>
                      </div>
                    )}
                  </div>
                </section>

                <section>
                  <p className="mb-1.5 text-[11px] uppercase text-muted-foreground">Active jobs</p>
                  {visiblePipelineRuns.length > 0 ? (
                    <div className="space-y-1.5">
                      {visiblePipelineRuns.map((run) => (
                        <div
                          key={run.id}
                          className="rounded border border-border/70 p-2"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <Link
                                href={`/analysis/${run.id}`}
                                className="font-mono text-[11px] font-medium text-foreground hover:underline"
                                onClick={() => setPipelineLoadOpen(false)}
                              >
                                {run.runNumber}
                              </Link>
                              <p className="mt-0.5 truncate text-muted-foreground">
                                {run.pipelineId}
                                {run.targetLabel ? ` · ${run.targetLabel}` : ""}
                                {" · "}
                                {run.userName}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${
                                run.stale
                                  ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                                  : "border-border bg-muted text-muted-foreground"
                              }`}
                            >
                              {formatPipelineRunElapsed(run)}
                            </span>
                          </div>
                          <div className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
                            <p>
                              {formatRunMode(run)}
                              {run.queueStatus ? ` · ${run.queueStatus}` : ""}
                            </p>
                            <p>{formatPipelineRunResources(run.resources)}</p>
                          </div>
                          {run.queueReason && (
                            <p className="mt-1 break-all text-muted-foreground">
                              Reason: {run.queueReason}
                            </p>
                          )}
                        </div>
                      ))}
                      {(activePipelineLoad.hiddenRunCount ?? 0) > 0 && (
                        <p className="text-muted-foreground">
                          +{activePipelineLoad.hiddenRunCount} more jobs
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="rounded border border-border/70 p-2 text-muted-foreground">
                      Per-job timing is not available yet.
                    </p>
                  )}
                </section>

                <section>
                  <p className="mb-1.5 text-[11px] uppercase text-muted-foreground">Users</p>
                  {visiblePipelineUsers.length > 0 ? (
                    <div className="space-y-1">
                      {visiblePipelineUsers.map((user) => (
                        <div
                          key={user.userId}
                          className="rounded border border-border/70 p-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-foreground">
                              {user.name}
                              {user.email && user.email !== user.name ? (
                                <span className="text-muted-foreground"> · {user.email}</span>
                              ) : null}
                            </span>
                            <span className="shrink-0 text-muted-foreground">
                              {formatPipelineUserSummary(user)}
                            </span>
                          </div>
                        </div>
                      ))}
                      {activePipelineLoad.hiddenUserCount > 0 && (
                        <p className="text-muted-foreground">
                          +{activePipelineLoad.hiddenUserCount} more users
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="rounded border border-border/70 p-2 text-muted-foreground">
                      No active users reported.
                    </p>
                  )}
                </section>
              </div>
            </div>
          )}
          {detailsOpen && hasDetails && (
            <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-50 max-h-[70vh] w-[min(860px,calc(100vw-2rem))] overflow-auto rounded-md border border-border bg-background p-3 text-xs shadow-lg">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium text-foreground">Admin status</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setDetailsOpen(false)}
                >
                  Close
                </button>
              </div>
              <div className="space-y-3">
                {statusWarnings.length > 0 && (
                  <section className="rounded border border-amber-200 bg-amber-50/60 p-2 text-muted-foreground">
                    <div className="mb-1 font-medium text-amber-900">Status warnings</div>
                    <div className="space-y-1">
                      {statusWarnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  </section>
                )}

                <section>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-medium text-foreground">Admin activity</span>
                    <span className="text-[11px] text-muted-foreground">
                      {visibleJobs.length} active
                    </span>
                  </div>
                  {visibleJobs.length > 0 ? (
                    <div className="space-y-2">
                      {visibleJobs.slice(0, 4).map((job) => {
                        const isBusy = busyActivityId === job.id;
                        const canCancel =
                          job.type === "pipeline-db-download" &&
                          job.state === "running" &&
                          Boolean(parsePipelineDatabaseActivityId(job.id));
                        return (
                          <div key={job.id} className="rounded border border-border/70 p-2">
                            <div className="flex items-start justify-between gap-2">
                              <p
                                className={
                                  job.state === "error" ? "text-destructive" : "text-foreground"
                                }
                              >
                                {formatActivitySummary(job)}
                              </p>
                              <div className="flex shrink-0 items-center gap-1">
                                {canCancel && (
                                  <button
                                    type="button"
                                    className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                    disabled={isBusy}
                                    onClick={() => void cancelDatabaseDownload(job)}
                                  >
                                    {isBusy ? "Cancelling" : "Cancel"}
                                  </button>
                                )}
                                {canHideActivity(job) && (
                                  <button
                                    type="button"
                                    className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                    disabled={isBusy}
                                    onClick={() => void hideActivity(job)}
                                  >
                                    {isBusy ? "Hiding" : "Hide"}
                                  </button>
                                )}
                              </div>
                            </div>
                            {job.targetPath && (
                              <p className="mt-1 break-all text-muted-foreground">
                                Target: {job.targetPath}
                              </p>
                            )}
                            {job.logExcerpt && job.logExcerpt.length > 0 && (
                              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px] text-muted-foreground">
                                {job.logExcerpt.join("\n")}
                              </pre>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="rounded border border-border/70 p-2 text-muted-foreground">
                      No running or failed admin activity.
                    </p>
                  )}
                </section>

                <section className="border-t border-border/70 pt-3">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">Background workers</span>
                    <Link
                      href="/admin/background-workers"
                      className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Open full page
                    </Link>
                  </div>
                  {visibleWorkers.length > 0 ? (
                    <div className="space-y-2">
                      {visibleWorkers.map((worker) => {
                        const status = getWorkerStatus(worker);
                        const logOpen = Boolean(openWorkerLogs[worker.name]);
                        const log = workerLogs[worker.name];
                        const isStarting =
                          busyWorkerAction?.name === worker.name && busyWorkerAction.action === "start";
                        const isStopping =
                          busyWorkerAction?.name === worker.name && busyWorkerAction.action === "stop";
                        const isClearing =
                          busyWorkerAction?.name === worker.name && busyWorkerAction.action === "clear";
                        const actionError = workerActionErrors[worker.name];
                        return (
                          <div key={worker.name} className="rounded border border-border/70 p-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-foreground">{worker.label}</span>
                                  <span
                                    className={`rounded border px-1.5 py-0.5 text-[11px] ${workerBadgeClass(
                                      status
                                    )}`}
                                  >
                                    {formatWorkerStatus(status)}
                                  </span>
                                </div>
                                {worker.latest ? (
                                  <p className="mt-1 text-muted-foreground">
                                    pid {worker.latest.pid} · started{" "}
                                    {formatRelative(worker.latest.startedAt)}
                                    {worker.latest.startedByEmail
                                      ? ` by ${worker.latest.startedByEmail}`
                                      : ""}
                                  </p>
                                ) : (
                                  <p className="mt-1 text-muted-foreground">No process row recorded.</p>
                                )}
                                {worker.latest?.lastErrorMsg && (
                                  <p className="mt-1 break-all text-destructive">
                                    {worker.latest.lastErrorMsg}
                                  </p>
                                )}
                                {actionError && (
                                  <p className="mt-1 break-all text-destructive">
                                    {actionError.message}
                                  </p>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                {canStartWorker(status) && (
                                  <button
                                    type="button"
                                    aria-label={`Start ${worker.label}`}
                                    title={`Start ${worker.label}`}
                                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                    disabled={workerActionBusy}
                                    onClick={() => void runWorkerAction(worker, "start")}
                                  >
                                    {isStarting ? (
                                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                    ) : (
                                      <Play className="h-3 w-3" aria-hidden="true" />
                                    )}
                                    {isStarting ? "Starting" : "Start"}
                                  </button>
                                )}
                                {canStopWorker(status) && (
                                  <button
                                    type="button"
                                    aria-label={`Stop ${worker.label}`}
                                    title={`Stop ${worker.label}`}
                                    className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-50 disabled:opacity-50"
                                    disabled={workerActionBusy}
                                    onClick={() => void runWorkerAction(worker, "stop")}
                                  >
                                    {isStopping ? (
                                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                    ) : (
                                      <Square className="h-3 w-3" aria-hidden="true" />
                                    )}
                                    {isStopping ? "Stopping" : "Stop"}
                                  </button>
                                )}
                                {canClearWorker(status) && (
                                  <button
                                    type="button"
                                    aria-label={`Clear zombie status for ${worker.label}`}
                                    title={`Clear zombie status for ${worker.label}`}
                                    className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-50 disabled:opacity-50"
                                    disabled={workerActionBusy}
                                    onClick={() => void runWorkerAction(worker, "clear")}
                                  >
                                    {isClearing ? (
                                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                    ) : (
                                      <Eraser className="h-3 w-3" aria-hidden="true" />
                                    )}
                                    {isClearing ? "Clearing" : "Clear"}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  aria-label={logOpen ? `Hide log for ${worker.label}` : `Show log for ${worker.label}`}
                                  title={logOpen ? `Hide log for ${worker.label}` : `Show log for ${worker.label}`}
                                  className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                                  onClick={() => {
                                    setOpenWorkerLogs((prev) => ({
                                      ...prev,
                                      [worker.name]: !prev[worker.name],
                                    }));
                                    if (!logOpen) void refreshWorkerLog(worker.name);
                                  }}
                                >
                                  {logOpen ? "Hide log" : "Show log"}
                                </button>
                              </div>
                            </div>
                            {logOpen && (
                              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px] text-muted-foreground">
                                {log?.lines?.length
                                  ? log.lines.join("\n")
                                  : log?.message || "(no log output yet)"}
                              </pre>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="rounded border border-border/70 p-2 text-muted-foreground">
                      No running workers need attention.
                    </p>
                  )}
                </section>
              </div>
            </div>
          )}
        </div>
        <div className="relative flex shrink-0 items-center gap-2 sm:gap-3">
          {notificationsEnabled && (
            <div className="relative">
              <button
                type="button"
                aria-label={`Notifications${unreadNotificationCount > 0 ? `, ${unreadNotificationCount} unread` : ""}`}
                title="Notifications"
                className="relative inline-flex h-6 items-center gap-1.5 rounded border border-transparent px-1.5 text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
                onClick={() => setNotificationsOpen((open) => !open)}
              >
                <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Notifications</span>
                {unreadNotificationCount > 0 && (
                  <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold leading-none text-white shadow-[0_0_0_1px_rgba(255,255,255,0.55)]">
                    {formatUnreadCount(unreadNotificationCount)}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <div className="fixed bottom-[calc(var(--seqdesk-footer-height,2.5rem)+0.5rem)] left-2 right-2 z-50 max-h-[70vh] w-auto overflow-auto rounded-md border border-border bg-background p-3 text-xs shadow-lg sm:absolute sm:bottom-[calc(100%+0.5rem)] sm:left-auto sm:right-0 sm:w-[min(420px,calc(100vw-2rem))]">
                  <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <span className="font-medium text-foreground">Notifications</span>
                    {unreadNotificationCount > 0 && (
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        {unreadNotificationCount} unread
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {unreadNotificationCount > 0 && (
                      <button
                        type="button"
                        className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                        disabled={busyNotificationId === "__all__"}
                        onClick={() => void markAllNotificationsRead()}
                      >
                        Mark all read
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setNotificationsOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                </div>

                {notifications.length === 0 ? (
                  <p className="rounded border border-border/70 p-3 text-muted-foreground">
                    No notifications.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {notifications.map((notification) => {
                      const isUnread = !notification.readAt;
                      const isExpanded = Boolean(expandedNotificationIds[notification.id]);
                      const isBusy = busyNotificationId === notification.id;
                      return (
                        <div
                          key={notification.id}
                          className={`rounded border border-border/70 p-2 ${
                            isUnread ? "bg-muted/40" : ""
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${notificationSeverityClass(
                                notification.severity
                              )}`}
                            />
                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                className="flex w-full items-start justify-between gap-2 text-left"
                                onClick={() =>
                                  setExpandedNotificationIds((prev) => ({
                                    ...prev,
                                    [notification.id]: !prev[notification.id],
                                  }))
                                }
                              >
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-foreground">
                                    {notification.title}
                                  </span>
                                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                    {formatRelative(notification.createdAt)}
                                    {isUnread ? " · unread" : ""}
                                  </span>
                                </span>
                                <ChevronDown
                                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
                                    isExpanded ? "rotate-180" : ""
                                  }`}
                                  aria-hidden="true"
                                />
                              </button>
                              {isExpanded && notification.body && (
                                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                                  {notification.body}
                                </p>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {!notification.readAt && (
                                  <button
                                    type="button"
                                    aria-label={`Mark ${notification.title} read`}
                                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                    disabled={isBusy}
                                    onClick={() => void markNotificationRead(notification)}
                                  >
                                    <Check className="h-3 w-3" aria-hidden="true" />
                                    Mark read
                                  </button>
                                )}
                                {notification.linkPath && (
                                  <Link
                                    href={notification.linkPath}
                                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                                    onClick={() => void markNotificationRead(notification)}
                                  >
                                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                    Open
                                  </Link>
                                )}
                                <button
                                  type="button"
                                  aria-label={`Hide ${notification.title}`}
                                  className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                  disabled={isBusy}
                                  onClick={() => void archiveNotification(notification)}
                                >
                                  <Archive className="h-3 w-3" aria-hidden="true" />
                                  Hide
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                </div>
              )}
            </div>
          )}
          {currentTime && (
            <>
              <span className="hidden sm:inline">{formatDate(currentTime)}</span>
              <span className="font-mono">{formatTime(currentTime)}</span>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
