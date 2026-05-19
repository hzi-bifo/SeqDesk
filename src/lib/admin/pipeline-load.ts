import { db } from "@/lib/db";

const ACTIVE_STATUSES = ["pending", "queued", "running"] as const;
const DEFAULT_VISIBLE_USER_LIMIT = 6;
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

export interface PipelineLoadSummary {
  totalActive: number;
  statuses: PipelineLoadStatusCounts;
  modes: PipelineLoadModeCounts;
  staleActive: number;
  staleByStatus: PipelineLoadStatusCounts;
  totalUsers: number;
  visibleUsers: PipelineLoadUserSummary[];
  hiddenUserCount: number;
  /** Back-compat alias for older footer payload consumers. */
  users: PipelineLoadUserSummary[];
  updatedAt: string;
}

interface PipelineLoadOptions {
  now?: Date;
  staleAfterMs?: number;
  visibleUserLimit?: number;
}

type ActiveRunRow = {
  status: string;
  executionMode: string | null;
  queueJobId: string | null;
  userId: string;
  queueUpdatedAt: Date | null;
  lastEventAt: Date | null;
  lastTraceAt: Date | null;
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

export async function getPipelineLoadSummary(
  options: PipelineLoadOptions = {}
): Promise<PipelineLoadSummary> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const staleAfterMs = options.staleAfterMs ?? PIPELINE_LOAD_STALE_AFTER_MS;
  const visibleUserLimit = Math.max(0, options.visibleUserLimit ?? DEFAULT_VISIBLE_USER_LIMIT);

  const runs: ActiveRunRow[] = await db.pipelineRun.findMany({
    where: { status: { in: [...ACTIVE_STATUSES] } },
    select: {
      status: true,
      executionMode: true,
      queueJobId: true,
      userId: true,
      queueUpdatedAt: true,
      lastEventAt: true,
      lastTraceAt: true,
      updatedAt: true,
    },
  });

  const normalizedRuns = runs
    .map((run) => {
      const status = normalizeStatus(run.status);
      if (!status) return null;
      return {
        userId: run.userId,
        status,
        mode: inferMode(run),
        stale: isStaleRun(run, nowMs, staleAfterMs),
      };
    })
    .filter(
      (run): run is {
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
  }

  const allUsers = Array.from(users.values()).sort((a, b) => {
    if (b.active !== a.active) return b.active - a.active;
    return a.name.localeCompare(b.name);
  });
  const visibleUsers = allUsers.slice(0, visibleUserLimit);

  return {
    totalActive,
    statuses,
    modes,
    staleActive,
    staleByStatus,
    totalUsers: allUsers.length,
    visibleUsers,
    hiddenUserCount: Math.max(0, allUsers.length - visibleUsers.length),
    users: visibleUsers,
    updatedAt: now.toISOString(),
  };
}
