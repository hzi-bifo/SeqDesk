/**
 * Leave nothing of a finished local run running. A run on this server that ended badly (Nextflow was killed with
 * kill -9, a cancel reached the wrapper but not a task that changed its process group) can leave task processes
 * behind: they keep a core busy and write into a work folder the next Resume reuses. On a Linux host the run's
 * systemd scope ends with it; on a Mac there is no scope, so the leftovers are found by their command line, which
 * always names the run folder (every task runs `.command.run` under <run folder>/work).
 */
import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface LocalProcess { pid: number; pgid: number; command: string }

/** Parses `ps -axo pid=,pgid=,command=` lines. */
export function parsePs(text: string): LocalProcess[] {
  const found: LocalProcess[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) found.push({ pid: Number(m[1]), pgid: Number(m[2]), command: m[3] });
  }
  return found;
}

/** The processes that belong to the run in this folder: named by their command line, never by a recycled pid alone. */
export function leftoversOf(processes: LocalProcess[], runFolder: string, self = process.pid): LocalProcess[] {
  const marker = `${path.resolve(runFolder)}${path.sep}`;
  return processes.filter((p) => p.pid !== self && p.command.includes(marker));
}

export interface LocalCleanupDeps {
  ps: () => Promise<string>;
  kill: (pid: number, signal: NodeJS.Signals) => void;
  wait: (ms: number) => Promise<void>;
}
const DEPS: LocalCleanupDeps = {
  ps: async () => (await execFileAsync('ps', ['-axww', '-o', 'pid=,pgid=,command='], { timeout: 5000, maxBuffer: 16 * 1024 * 1024 })).stdout,
  kill: (pid, signal) => { try { process.kill(pid, signal); } catch { /* already gone */ } },
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Stops what is left of a local run: TERM first, KILL for what is still there a few seconds later. Returns the pids it signalled. */
export async function killLocalLeftovers(runFolder: string | null, deps: LocalCleanupDeps = DEPS, graceMs = 3000): Promise<number[]> {
  if (!runFolder) return [];
  let left: LocalProcess[];
  try { left = leftoversOf(parsePs(await deps.ps()), runFolder); } catch { return []; }
  if (!left.length) return [];
  for (const p of left) deps.kill(p.pid, 'SIGTERM');
  await deps.wait(graceMs);
  try {
    const still = leftoversOf(parsePs(await deps.ps()), runFolder).filter((p) => left.some((l) => l.pid === p.pid));
    for (const p of still) deps.kill(p.pid, 'SIGKILL');
  } catch { /* the TERM was sent */ }
  return left.map((p) => p.pid);
}

/** Waits until a process is gone (kill -0 fails), up to a limit; true when it is gone. */
export async function waitForExit(pid: number, limitMs: number, deps: Pick<LocalCleanupDeps, 'wait'> = DEPS, alive = (p: number) => { try { process.kill(p, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } }): Promise<boolean> {
  for (let waited = 0; waited <= limitMs; waited += 500) {
    if (!alive(pid)) return true;
    await deps.wait(500);
  }
  return !alive(pid);
}
