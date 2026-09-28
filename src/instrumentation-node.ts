import {
  ensureWorkerStarted,
  wireMonitorLifecycle,
} from "@/lib/workers/process";

/** Start the Node-only monitors without exposing their dependencies to Edge. */
export async function registerNodeInstrumentation(): Promise<void> {
  try {
    const { startWorkbenchImportWorker } = await import("@/lib/workbench/import-worker");
    startWorkbenchImportWorker();
  } catch {
    console.error("[instrumentation] Workbench import worker could not start.");
  }
  await startMonitor("pipeline-monitor");
  await startMonitor("explore-monitor");
  superviseMonitors();
}

const SUPERVISED = ["pipeline-monitor", "explore-monitor"] as const;

/**
 * Start a monitor again when it has died. It was started once at boot: a monitor that crashed left runs
 * waiting for a share of this server waiting forever and finished runs unfinalized, with nothing but a card that
 * said its status was last checked long ago. `ensureWorkerStarted` does nothing while the monitor is alive.
 */
export function superviseMonitors(
  ensure: typeof ensureWorkerStarted = ensureWorkerStarted,
  intervalMs = 60_000,
  onStarted: (pid: number) => void = wireMonitorLifecycle,
): () => void {
  const state = globalThis as unknown as { __seqdeskMonitorWatchdog?: ReturnType<typeof setInterval> };
  if (state.__seqdeskMonitorWatchdog) clearInterval(state.__seqdeskMonitorWatchdog);
  const check = async () => {
    for (const name of SUPERVISED) {
      try {
        const result = await ensure(name);
        if (result.action === "started") {
          console.warn(`[instrumentation] ${name} had stopped and was started again (pid=${result.pid})`);
          if (typeof result.pid === "number") onStarted(result.pid);
        }
      } catch (error) {
        console.error(`[instrumentation] ${name} watchdog:`, error instanceof Error ? error.message : error);
      }
    }
  };
  const timer = setInterval(() => void check(), intervalMs);
  timer.unref?.();
  state.__seqdeskMonitorWatchdog = timer;
  return () => { clearInterval(timer); if (state.__seqdeskMonitorWatchdog === timer) state.__seqdeskMonitorWatchdog = undefined; };
}

async function startMonitor(name: "pipeline-monitor" | "explore-monitor"): Promise<void> {
  try {
    const result = await ensureWorkerStarted(name);
    const detail = [
      result.pid ? `pid=${result.pid}` : null,
      result.reason ? result.reason : null,
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      `[instrumentation] ${name} autostart: ${result.action}${detail ? ` (${detail})` : ""}`,
    );

    // Tie the monitor we started to this server's lifecycle so it cannot pin a
    // stale release directory after a clean shutdown.
    if (result.action === "started" && typeof result.pid === "number") {
      wireMonitorLifecycle(result.pid);
    }
  } catch (error) {
    // Best-effort: never let worker startup break server boot. An admin can
    // still start the worker manually from the worker panel.
    console.error(
      `[instrumentation] ${name} autostart failed:`,
      error instanceof Error ? error.message : error,
    );
  }
}
