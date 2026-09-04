import {
  ensureWorkerStarted,
  wireMonitorLifecycle,
} from "@/lib/workers/process";

/** Start the Node-only monitors without exposing their dependencies to Edge. */
export async function registerNodeInstrumentation(): Promise<void> {
  await startMonitor("pipeline-monitor");
  await startMonitor("explore-monitor");
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
