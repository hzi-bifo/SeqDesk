import {
  ensureWorkerStarted,
  wireMonitorLifecycle,
} from "@/lib/workers/process";

/** Start the Node-only pipeline monitor without exposing its dependencies to Edge. */
export async function registerNodeInstrumentation(): Promise<void> {
  try {
    const result = await ensureWorkerStarted("pipeline-monitor");
    const detail = [
      result.pid ? `pid=${result.pid}` : null,
      result.reason ? result.reason : null,
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      `[instrumentation] pipeline-monitor autostart: ${result.action}${detail ? ` (${detail})` : ""}`,
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
      "[instrumentation] pipeline-monitor autostart failed:",
      error instanceof Error ? error.message : error,
    );
  }
}
