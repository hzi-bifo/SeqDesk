import { spawn } from "child_process";
import { promises as fs, createWriteStream, existsSync } from "fs";
import path from "path";
import os from "os";
import { db } from "@/lib/db";
import { getWorkerSpec, type WorkerSpec } from "./registry";

const REPO_ROOT = path.resolve(process.cwd());
const LOG_DIR = path.join(REPO_ROOT, "logs");
const FS_ROOT = path.parse(REPO_ROOT).root;

/**
 * Returns true if a process with this PID is currently running and we have
 * permission to signal it. The kill(pid, 0) trick is the canonical way to
 * check liveness without affecting the process.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH: no such process. EPERM: process exists but we can't signal it
    // (still alive — typically root-owned; treat as alive for status display).
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

async function ensureLogDir() {
  await fs.mkdir(LOG_DIR, { recursive: true });
}

function buildLogPath(name: string, pid: number): string {
  return path.join(LOG_DIR, `${name}-${pid}.log`);
}

function resolveTsxBinary(): string {
  // Walk up from REPO_ROOT looking for `node_modules/.bin/tsx`. Handles both
  // the normal install (tsx lives in repo's node_modules) and the worktree
  // case where node_modules is shared with the parent repo a few levels up.
  let dir = REPO_ROOT;
  while (true) {
    const candidate = path.join(dir, "node_modules", ".bin", "tsx");
    if (existsSync(candidate)) return candidate;
    if (dir === FS_ROOT) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Last resort — let PATH find it; works if Next was started via npm.
  return "tsx";
}

/**
 * Resolve the command + script path used to spawn a worker.
 * Production releases ship a pre-bundled `.js` next to the `.ts` source;
 * dev runs from source via `tsx`.
 */
function resolveSpawnTarget(script: string): { cmd: string; scriptPath: string } {
  if (script.endsWith(".ts")) {
    const jsPath = path.join(REPO_ROOT, script.replace(/\.ts$/, ".js"));
    if (existsSync(jsPath)) {
      return { cmd: process.execPath, scriptPath: jsPath };
    }
  }
  return { cmd: resolveTsxBinary(), scriptPath: path.join(REPO_ROOT, script) };
}

/**
 * Spawn the configured script as a detached child, redirect stdout+stderr to a
 * log file, and create a tracking row in the DB. Returns the row.
 *
 * Caller must verify there is no other RUNNING row for this worker before
 * calling — single-instance constraint is enforced at the API layer.
 */
export async function startWorker(
  spec: WorkerSpec,
  options: { startedById?: string } = {},
): Promise<{ id: string; pid: number; logPath: string }> {
  await ensureLogDir();

  const { cmd, scriptPath } = resolveSpawnTarget(spec.script);
  const args = [scriptPath, ...(spec.args ?? [])];

  // Open the log file FIRST so we can wire stdio into it. Detached + ignored
  // stdin so the child outlives this Next.js request handler.
  const child = spawn(cmd, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...(spec.envOverrides ?? {}) },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Capture the async 'error' event so a failed spawn (ENOENT/EACCES/etc.)
  // surfaces with a real reason instead of the generic "no PID assigned".
  let asyncSpawnError: NodeJS.ErrnoException | null = null;
  child.once("error", (err) => {
    asyncSpawnError = err as NodeJS.ErrnoException;
  });

  if (!child.pid) {
    // spawn() returned without assigning a pid — the underlying exec failed.
    // Wait briefly for the async 'error' event so we can include its reason.
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    const reasonParts: string[] = [];
    if (asyncSpawnError) {
      const e = asyncSpawnError as NodeJS.ErrnoException;
      if (e.code) reasonParts.push(e.code);
      if (e.syscall) reasonParts.push(e.syscall);
      reasonParts.push(e.message);
    } else {
      reasonParts.push(
        `no PID assigned (cmd=${cmd} cwd=${REPO_ROOT}). cmd-exists=${existsSync(cmd)} script-exists=${existsSync(scriptPath)}`,
      );
    }
    throw new Error(`Failed to spawn ${spec.name}: ${reasonParts.join(" ")}`);
  }

  const logPath = buildLogPath(spec.name, child.pid);
  const logStream = createWriteStream(logPath, { flags: "a" });
  logStream.write(`[${new Date().toISOString()}] [seqdesk] starting ${spec.name} pid=${child.pid} on ${os.hostname()}\n`);
  logStream.write(`[${new Date().toISOString()}] [seqdesk] cmd: ${cmd} ${args.join(" ")}\n`);
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  // Detach so the parent (Next.js) can exit/reload without taking the child.
  child.unref();

  const row = await db.backgroundWorkerProcess.create({
    data: {
      name: spec.name,
      pid: child.pid,
      status: "RUNNING",
      logPath,
      startedById: options.startedById ?? null,
    },
    select: { id: true, pid: true, logPath: true },
  });

  // Capture exit asynchronously so we can mark the row STOPPED/ERROR if the
  // child dies inside the same Next process — best-effort, since after a Next
  // restart we'd lose the listener. The polling liveness check covers that case.
  child.on("exit", (code, signal) => {
    void db.backgroundWorkerProcess
      .update({
        where: { id: row.id },
        data: {
          status: code === 0 ? "STOPPED" : "ERROR",
          stoppedAt: new Date(),
          exitCode: code,
          lastErrorMsg: signal ? `exited via signal ${signal}` : null,
        },
      })
      .catch(() => undefined);
    logStream.end();
  });

  return row;
}

/**
 * Send SIGTERM, then SIGKILL after a grace period. Returns when the process is
 * no longer alive or the deadline elapses. Updates the DB row to STOPPING then
 * STOPPED on success.
 */
export async function stopWorker(rowId: string, opts: { graceMs?: number } = {}): Promise<{ stopped: boolean }> {
  const grace = opts.graceMs ?? 10_000;
  const row = await db.backgroundWorkerProcess.findUnique({
    where: { id: rowId },
    select: { id: true, pid: true, status: true },
  });
  if (!row) return { stopped: false };
  if (row.status === "STOPPED" || row.status === "ERROR") return { stopped: true };

  await db.backgroundWorkerProcess.update({
    where: { id: row.id },
    data: { status: "STOPPING" },
  });

  try {
    process.kill(row.pid, "SIGTERM");
  } catch {
    // Process already gone — fall through to mark stopped.
  }

  const start = Date.now();
  while (Date.now() - start < grace) {
    if (!isProcessAlive(row.pid)) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  if (isProcessAlive(row.pid)) {
    try { process.kill(row.pid, "SIGKILL"); } catch { /* ignore */ }
  }

  await db.backgroundWorkerProcess.update({
    where: { id: row.id },
    data: { status: "STOPPED", stoppedAt: new Date() },
  });
  return { stopped: true };
}

/**
 * The latest known DB row for a worker (most recent by startedAt), reconciled
 * against actual PID liveness. If the row says RUNNING but the PID is dead,
 * the row is updated to ZOMBIE inline.
 */
export interface ReconciledWorkerStatus {
  spec: WorkerSpec;
  row: {
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
  } | null;
}

export async function reconcileWorker(name: string): Promise<ReconciledWorkerStatus> {
  const spec = getWorkerSpec(name);
  if (!spec) throw new Error(`unknown worker: ${name}`);

  const row = await db.backgroundWorkerProcess.findFirst({
    where: { name },
    orderBy: { startedAt: "desc" },
    include: { startedBy: { select: { email: true } } },
  });

  if (!row) {
    return { spec, row: null };
  }

  let status = row.status;
  if ((status === "RUNNING" || status === "STOPPING") && !isProcessAlive(row.pid)) {
    // Process died without us knowing — flip to ZOMBIE so the UI shows the gap.
    status = "ZOMBIE";
    await db.backgroundWorkerProcess
      .update({ where: { id: row.id }, data: { status: "ZOMBIE", stoppedAt: row.stoppedAt ?? new Date() } })
      .catch(() => undefined);
  }

  return {
    spec,
    row: {
      id: row.id,
      name: row.name,
      pid: row.pid,
      startedAt: row.startedAt.toISOString(),
      stoppedAt: row.stoppedAt?.toISOString() ?? null,
      status,
      exitCode: row.exitCode,
      logPath: row.logPath,
      lastErrorMsg: row.lastErrorMsg,
      startedByEmail: row.startedBy?.email ?? null,
    },
  };
}

/**
 * Read the last N lines of a worker's log file. Returns an empty array if the
 * file doesn't exist (e.g. fresh install).
 */
export async function tailLog(logPath: string, lines = 200): Promise<string[]> {
  try {
    const content = await fs.readFile(logPath, "utf8");
    return content.split("\n").slice(-lines - 1, -1);
  } catch {
    return [];
  }
}
