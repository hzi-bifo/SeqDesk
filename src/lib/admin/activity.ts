import fs from "fs/promises";
import path from "path";
import { getPipelinesDir } from "@/lib/pipelines/package-loader";
import {
  getAllDatabaseDownloadJobStatuses,
  getDatabaseDownloadJobStatus,
  getPipelineDatabaseDefinition,
  type PipelineDatabaseDownloadJobStatus,
} from "@/lib/pipelines/database-downloads";

const ACTIVITY_FILE = ".admin-activity-status.json";
const RECENT_JOB_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_LOG_LINES = 24;

export type AdminActivityState = "running" | "success" | "error";
export type AdminActivityType =
  | "pipeline-db-download"
  | "dummy-seed"
  | "example-dataset";

export interface AdminActivityJob {
  id: string;
  type: AdminActivityType;
  label: string;
  state: AdminActivityState;
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

type ActivityIndex = Record<string, AdminActivityJob | undefined>;

function getActivityFilePath(): string {
  return path.join(getPipelinesDir(), ACTIVITY_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asActivityState(value: unknown): AdminActivityState {
  return value === "success" || value === "error" ? value : "running";
}

function asActivityType(value: unknown): AdminActivityType {
  if (value === "pipeline-db-download" || value === "dummy-seed") return value;
  return "example-dataset";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeJob(value: unknown, fallbackId: string): AdminActivityJob | null {
  if (!isRecord(value)) return null;
  const id = optionalString(value.id) || fallbackId;
  const label = optionalString(value.label);
  if (!id || !label) return null;
  const progressPercent = optionalNumber(value.progressPercent);
  const speedBytesPerSecond = optionalNumber(value.speedBytesPerSecond);
  const etaSeconds = optionalNumber(value.etaSeconds);
  const rawExcerpt = Array.isArray(value.logExcerpt) ? value.logExcerpt : undefined;
  return {
    id,
    type: asActivityType(value.type),
    label,
    state: asActivityState(value.state),
    ...(optionalString(value.phase) ? { phase: optionalString(value.phase) } : {}),
    ...(optionalNumber(value.bytesDownloaded) !== undefined
      ? { bytesDownloaded: optionalNumber(value.bytesDownloaded) }
      : {}),
    ...(optionalNumber(value.totalBytes) !== undefined
      ? { totalBytes: optionalNumber(value.totalBytes) }
      : {}),
    ...(progressPercent !== undefined ? { progressPercent } : {}),
    ...(speedBytesPerSecond !== undefined ? { speedBytesPerSecond } : {}),
    ...(etaSeconds !== undefined ? { etaSeconds } : {}),
    ...(optionalString(value.startedAt) ? { startedAt: optionalString(value.startedAt) } : {}),
    ...(optionalString(value.updatedAt) ? { updatedAt: optionalString(value.updatedAt) } : {}),
    ...(optionalString(value.finishedAt) ? { finishedAt: optionalString(value.finishedAt) } : {}),
    ...(optionalString(value.targetPath) ? { targetPath: optionalString(value.targetPath) } : {}),
    ...(optionalString(value.error) ? { error: optionalString(value.error) } : {}),
    ...(typeof value.logAvailable === "boolean" ? { logAvailable: value.logAvailable } : {}),
    ...(rawExcerpt
      ? { logExcerpt: rawExcerpt.filter((line): line is string => typeof line === "string") }
      : {}),
  };
}

async function readActivityIndex(): Promise<ActivityIndex> {
  try {
    const raw = await fs.readFile(getActivityFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const index: ActivityIndex = {};
    for (const [id, value] of Object.entries(parsed)) {
      const job = normalizeJob(value, id);
      if (job) index[id] = job;
    }
    return index;
  } catch {
    return {};
  }
}

async function writeActivityIndex(index: ActivityIndex): Promise<void> {
  const filePath = getActivityFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(index, null, 2));
}

function shouldKeepJob(job: AdminActivityJob, now = Date.now()): boolean {
  if (job.state === "running") return true;
  const stamp = job.finishedAt || job.updatedAt || job.startedAt;
  if (!stamp) return true;
  const parsed = new Date(stamp).getTime();
  return Number.isNaN(parsed) || now - parsed <= RECENT_JOB_WINDOW_MS;
}

export async function updateAdminActivityJob(
  id: string,
  update: Omit<Partial<AdminActivityJob>, "id"> & {
    type: AdminActivityType;
    label: string;
  }
): Promise<AdminActivityJob> {
  const index = await readActivityIndex();
  const existing = index[id];
  const now = new Date().toISOString();
  const job: AdminActivityJob = {
    id,
    state: existing?.state || "running",
    ...existing,
    ...update,
    updatedAt: now,
    startedAt: update.startedAt || existing?.startedAt || now,
  };
  index[id] = job;
  const compacted = Object.fromEntries(
    Object.entries(index).filter(([, value]) => value && shouldKeepJob(value))
  ) as ActivityIndex;
  await writeActivityIndex(compacted);
  return job;
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/(Authorization:\s*Bearer\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]")
    .replace(/(--(?:key|token|password|profile-code)\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(/(password|passwd|token|secret|key)=([^&\s"']+)/gi, "$1=[redacted]")
    .replace(/https?:\/\/\S+/gi, "[url]");
}

export async function readRedactedLogTail(
  logPath: string | undefined,
  maxLines = MAX_LOG_LINES
): Promise<string[]> {
  if (!logPath) return [];
  try {
    const raw = await fs.readFile(logPath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-maxLines)
      .map(redactDiagnosticText);
  } catch {
    return [];
  }
}

function calculateProgressPercent(
  bytesDownloaded: number | undefined,
  totalBytes: number | undefined
): number | null {
  if (
    typeof bytesDownloaded !== "number" ||
    typeof totalBytes !== "number" ||
    !Number.isFinite(bytesDownloaded) ||
    !Number.isFinite(totalBytes) ||
    totalBytes <= 0
  ) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round((bytesDownloaded / totalBytes) * 1000) / 10));
}

function deriveTransfer(job: {
  bytesDownloaded?: number;
  totalBytes?: number;
  startedAt?: string;
  finishedAt?: string;
}) {
  const bytesDownloaded = optionalNumber(job.bytesDownloaded);
  const totalBytes = optionalNumber(job.totalBytes);
  const progressPercent = calculateProgressPercent(bytesDownloaded, totalBytes);
  const startedAtMs = job.startedAt ? new Date(job.startedAt).getTime() : Number.NaN;
  const endedAtMs = job.finishedAt ? new Date(job.finishedAt).getTime() : Date.now();
  const elapsedSeconds =
    !Number.isNaN(startedAtMs) && endedAtMs > startedAtMs
      ? (endedAtMs - startedAtMs) / 1000
      : null;
  const speedBytesPerSecond =
    typeof bytesDownloaded === "number" && elapsedSeconds && elapsedSeconds > 0
      ? bytesDownloaded / elapsedSeconds
      : null;
  const etaSeconds =
    typeof bytesDownloaded === "number" &&
    typeof totalBytes === "number" &&
    totalBytes > bytesDownloaded &&
    speedBytesPerSecond &&
    speedBytesPerSecond > 0
      ? (totalBytes - bytesDownloaded) / speedBytesPerSecond
      : null;
  return { progressPercent, speedBytesPerSecond, etaSeconds };
}

function databaseJobToActivity(job: PipelineDatabaseDownloadJobStatus): AdminActivityJob {
  const definition = getPipelineDatabaseDefinition(job.pipelineId, job.databaseId);
  const transfer = deriveTransfer(job);
  return {
    id: `pipeline-db:${job.pipelineId}:${job.databaseId}`,
    type: "pipeline-db-download",
    label: `${definition?.label || job.databaseId} (${job.pipelineId})`,
    state: job.state,
    phase: job.phase || (job.state === "running" ? "downloading" : undefined),
    bytesDownloaded: job.bytesDownloaded,
    totalBytes: job.totalBytes,
    progressPercent:
      typeof job.progressPercent === "number" ? job.progressPercent : transfer.progressPercent,
    speedBytesPerSecond: transfer.speedBytesPerSecond,
    etaSeconds: transfer.etaSeconds,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    targetPath: job.targetPath,
    error: job.error ? redactDiagnosticText(job.error) : undefined,
    logAvailable: Boolean(job.logPath),
  };
}

export async function listAdminActivityJobs(): Promise<AdminActivityJob[]> {
  const [storedIndex, dbJobs] = await Promise.all([
    readActivityIndex(),
    getAllDatabaseDownloadJobStatuses(),
  ]);

  const storedJobs = Object.values(storedIndex)
    .filter((job): job is AdminActivityJob => Boolean(job))
    .filter((job) => shouldKeepJob(job));

  const databaseJobs = await Promise.all(
    dbJobs
      .filter((job) => shouldKeepJob(databaseJobToActivity(job)))
      .map(async (job) => {
        const activity = databaseJobToActivity(job);
        if (activity.state === "error" && job.logPath) {
          activity.logExcerpt = await readRedactedLogTail(job.logPath);
        }
        return activity;
      })
  );

  return [...databaseJobs, ...storedJobs].sort((a, b) => {
    const aRunning = a.state === "running" ? 1 : 0;
    const bRunning = b.state === "running" ? 1 : 0;
    if (aRunning !== bRunning) return bRunning - aRunning;
    const aTime = new Date(a.updatedAt || a.finishedAt || a.startedAt || 0).getTime();
    const bTime = new Date(b.updatedAt || b.finishedAt || b.startedAt || 0).getTime();
    return bTime - aTime;
  });
}

export async function getAdminActivityJob(id: string): Promise<AdminActivityJob | null> {
  const jobs = await listAdminActivityJobs();
  return jobs.find((job) => job.id === id) || null;
}

export async function getAdminActivityLogExcerpt(id: string): Promise<string[]> {
  if (id.startsWith("pipeline-db:")) {
    const [, pipelineId, databaseId] = id.split(":");
    if (!pipelineId || !databaseId) return [];
    const job = await getDatabaseDownloadJobStatus(pipelineId, databaseId);
    return readRedactedLogTail(job?.logPath);
  }

  const stored = (await readActivityIndex())[id];
  return stored?.logExcerpt || [];
}
