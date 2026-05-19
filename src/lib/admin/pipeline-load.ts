import { db } from "@/lib/db";

const ACTIVE_STATUSES = ["pending", "queued", "running"] as const;
const DEFAULT_VISIBLE_USER_LIMIT = 6;
const DEFAULT_VISIBLE_RUN_LIMIT = 6;
export const PIPELINE_LOAD_STALE_AFTER_MS = 10 * 60 * 1000;

export type PipelineLoadStatus = (typeof ACTIVE_STATUSES)[number];
export type PipelineLoadMode = "slurm" | "local" | "unknown";

export type PipelineLoadStatusCounts = Record<PipelineLoadStatus, number>;
export type PipelineLoadModeCounts = Record<PipelineLoadMode, number>;

export interface PipelineLoadUserSummary {
  userId: string;
  name: string;
  email: string | null;
  active: number;
  staleActive: number;
  statuses: PipelineLoadStatusCounts;
  staleByStatus: PipelineLoadStatusCounts;
  modes: PipelineLoadModeCounts;
}

export interface PipelineLoadRunResources {
  queue: string | null;
  cores: number | null;
  memory: string | null;
  timeLimitHours: number | null;
}

export interface PipelineLoadRunSummary {
  id: string;
  runNumber: string;
  pipelineId: string;
  targetType: string;
  targetLabel: string | null;
  userId: string;
  userName: string;
  userEmail: string | null;
  status: PipelineLoadStatus;
  mode: PipelineLoadMode;
  queueJobId: string | null;
  queueStatus: string | null;
  queueReason: string | null;
  activeSince: string;
  updatedAt: string;
  stale: boolean;
  resources: PipelineLoadRunResources | null;
}

export interface PipelineLoadSummary {
  totalActive: number;
  statuses: PipelineLoadStatusCounts;
  modes: PipelineLoadModeCounts;
  staleActive: number;
  staleByStatus: PipelineLoadStatusCounts;
  totalUsers: number;
  visibleUsers: PipelineLoadUserSummary[];
  hiddenUserCount: number;
  activeRuns: PipelineLoadRunSummary[];
  hiddenRunCount: number;
  /** Back-compat alias for older footer payload consumers. */
  users: PipelineLoadUserSummary[];
  updatedAt: string;
}

interface PipelineLoadOptions {
  now?: Date;
  staleAfterMs?: number;
  visibleUserLimit?: number;
  visibleRunLimit?: number;
}

type ActiveRunRow = {
  id: string;
  runNumber: string;
  pipelineId: string;
  status: string;
  targetType: string;
  study: { title: string | null } | null;
  order: { name: string | null; orderNumber: string | null } | null;
  executionMode: string | null;
  executionProfile: string | null;
  queueJobId: string | null;
  queueStatus: string | null;
  queueReason: string | null;
  userId: string;
  startedAt: Date | null;
  queuedAt: Date | null;
  queueUpdatedAt: Date | null;
  lastEventAt: Date | null;
  lastTraceAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type UserRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

function emptyStatusCounts(): PipelineLoadStatusCounts {
  return { pending: 0, queued: 0, running: 0 };
}

function emptyModeCounts(): PipelineLoadModeCounts {
  return { slurm: 0, local: 0, unknown: 0 };
}

function normalizeStatus(value: string): PipelineLoadStatus | null {
  const status = value.trim().toLowerCase();
  return ACTIVE_STATUSES.includes(status as PipelineLoadStatus)
    ? (status as PipelineLoadStatus)
    : null;
}

function isSlurmLikeJobId(value: string): boolean {
  return /^\d+(?:[._-][A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(value);
}

function inferMode(run: { executionMode: string | null; queueJobId: string | null }): PipelineLoadMode {
  const executionMode = (run.executionMode || "").trim().toLowerCase();
  if (executionMode === "slurm" || executionMode === "local") {
    return executionMode;
  }

  const queueJobId = (run.queueJobId || "").trim();
  if (!queueJobId) return "unknown";
  if (queueJobId.startsWith("local-")) return "local";
  return isSlurmLikeJobId(queueJobId) ? "slurm" : "unknown";
}

function displayName(user: UserRow | null | undefined): string {
  if (!user) return "Unknown user";
  const fullName = [user.firstName, user.lastName]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(" ");
  return fullName || user.email || "Unknown user";
}

function latestKnownActivity(run: Pick<ActiveRunRow, "queueUpdatedAt" | "lastEventAt" | "lastTraceAt" | "updatedAt">): Date {
  return run.queueUpdatedAt || run.lastEventAt || run.lastTraceAt || run.updatedAt;
}

function activeSince(run: Pick<ActiveRunRow, "status" | "startedAt" | "queuedAt" | "createdAt">): Date {
  const status = normalizeStatus(run.status);
  if (status === "running") return run.startedAt || run.queuedAt || run.createdAt;
  return run.queuedAt || run.startedAt || run.createdAt;
}

function isStaleRun(
  run: Pick<ActiveRunRow, "queueUpdatedAt" | "lastEventAt" | "lastTraceAt" | "updatedAt">,
  nowMs: number,
  staleAfterMs: number
): boolean {
  const timestamp = latestKnownActivity(run).getTime();
  return Number.isFinite(timestamp) && nowMs - timestamp > staleAfterMs;
}

function createUserSummary(userId: string, user: UserRow | null | undefined): PipelineLoadUserSummary {
  return {
    userId,
    name: displayName(user),
    email: user?.email ?? null,
    active: 0,
    staleActive: 0,
    statuses: emptyStatusCounts(),
    staleByStatus: emptyStatusCounts(),
    modes: emptyModeCounts(),
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const next = Math.trunc(value);
    return next > 0 ? next : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function parseRunResources(rawProfile: string | null): PipelineLoadRunResources | null {
  if (!rawProfile) return null;
  try {
    const profile = toRecord(JSON.parse(rawProfile));
    if (!profile) return null;
    const request = toRecord(profile.request);
    const slurm = toRecord(profile.slurm) || toRecord(request?.slurm) || profile;
    if (!slurm) return null;

    const resources: PipelineLoadRunResources = {
      queue: optionalString(slurm.queue ?? slurm.slurmQueue),
      cores: optionalPositiveInt(slurm.cores ?? slurm.slurmCores),
      memory: optionalString(slurm.memory ?? slurm.slurmMemory),
      timeLimitHours: optionalPositiveInt(slurm.timeLimit ?? slurm.slurmTimeLimit),
    };
    return Object.values(resources).some((value) => value !== null) ? resources : null;
  } catch {
    return null;
  }
}

function targetLabel(run: Pick<ActiveRunRow, "study" | "order">): string | null {
  if (run.order) {
    return run.order.orderNumber || run.order.name || null;
  }
  return run.study?.title || null;
}

function createRunSummary(
  run: ActiveRunRow,
  user: UserRow | null | undefined,
  status: PipelineLoadStatus,
  mode: PipelineLoadMode,
  stale: boolean
): PipelineLoadRunSummary {
  return {
    id: run.id,
    runNumber: run.runNumber,
    pipelineId: run.pipelineId,
    targetType: run.targetType,
    targetLabel: targetLabel(run),
    userId: run.userId,
    userName: displayName(user),
    userEmail: user?.email ?? null,
    status,
    mode,
    queueJobId: run.queueJobId,
    queueStatus: run.queueStatus,
    queueReason: run.queueReason,
    activeSince: activeSince(run).toISOString(),
    updatedAt: latestKnownActivity(run).toISOString(),
    stale,
    resources: mode === "slurm" ? parseRunResources(run.executionProfile) : null,
  };
}

export async function getPipelineLoadSummary(
  options: PipelineLoadOptions = {}
): Promise<PipelineLoadSummary> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const staleAfterMs = options.staleAfterMs ?? PIPELINE_LOAD_STALE_AFTER_MS;
  const visibleUserLimit = Math.max(0, options.visibleUserLimit ?? DEFAULT_VISIBLE_USER_LIMIT);
  const visibleRunLimit = Math.max(0, options.visibleRunLimit ?? DEFAULT_VISIBLE_RUN_LIMIT);

  const runs: ActiveRunRow[] = await db.pipelineRun.findMany({
    where: { status: { in: [...ACTIVE_STATUSES] } },
    select: {
      id: true,
      runNumber: true,
      pipelineId: true,
      status: true,
      targetType: true,
      study: { select: { title: true } },
      order: { select: { name: true, orderNumber: true } },
      executionMode: true,
      executionProfile: true,
      queueJobId: true,
      queueStatus: true,
      queueReason: true,
      userId: true,
      startedAt: true,
      queuedAt: true,
      queueUpdatedAt: true,
      lastEventAt: true,
      lastTraceAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const normalizedRuns = runs
    .map((run) => {
      const status = normalizeStatus(run.status);
      if (!status) return null;
      return {
        raw: run,
        userId: run.userId,
        status,
        mode: inferMode(run),
        stale: isStaleRun(run, nowMs, staleAfterMs),
      };
    })
    .filter(
      (run): run is {
        raw: ActiveRunRow;
        userId: string;
        status: PipelineLoadStatus;
        mode: PipelineLoadMode;
        stale: boolean;
      } => run !== null
    );

  const userIds = Array.from(new Set(normalizedRuns.map((run) => run.userId)));
  const userRows: UserRow[] =
    userIds.length > 0
      ? await db.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        })
      : [];
  const usersById = new Map(userRows.map((user) => [user.id, user]));

  const statuses = emptyStatusCounts();
  const modes = emptyModeCounts();
  const staleByStatus = emptyStatusCounts();
  const users = new Map<string, PipelineLoadUserSummary>();
  const runSummaries: PipelineLoadRunSummary[] = [];
  let totalActive = 0;
  let staleActive = 0;

  for (const run of normalizedRuns) {
    const { status, mode, stale } = run;
    totalActive += 1;
    statuses[status] += 1;
    modes[mode] += 1;
    if (stale) {
      staleActive += 1;
      staleByStatus[status] += 1;
    }

    const userId = run.userId;
    const existing = users.get(userId);
    const summary = existing || createUserSummary(userId, usersById.get(userId));

    summary.active += 1;
    summary.statuses[status] += 1;
    summary.modes[mode] += 1;
    if (stale) {
      summary.staleActive += 1;
      summary.staleByStatus[status] += 1;
    }
    users.set(userId, summary);
    runSummaries.push(
      createRunSummary(run.raw, usersById.get(userId), status, mode, stale)
    );
  }

  const allUsers = Array.from(users.values()).sort((a, b) => {
    if (b.active !== a.active) return b.active - a.active;
    return a.name.localeCompare(b.name);
  });
  const visibleUsers = allUsers.slice(0, visibleUserLimit);
  const activeRuns = runSummaries
    .sort((a, b) => {
      if (a.stale !== b.stale) return a.stale ? -1 : 1;
      return new Date(a.activeSince).getTime() - new Date(b.activeSince).getTime();
    })
    .slice(0, visibleRunLimit);

  return {
    totalActive,
    statuses,
    modes,
    staleActive,
    staleByStatus,
    totalUsers: allUsers.length,
    visibleUsers,
    hiddenUserCount: Math.max(0, allUsers.length - visibleUsers.length),
    activeRuns,
    hiddenRunCount: Math.max(0, runSummaries.length - activeRuns.length),
    users: visibleUsers,
    updatedAt: now.toISOString(),
  };
}
