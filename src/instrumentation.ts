/**
 * Next.js instrumentation hook. `register()` runs once when the server process
 * starts (Node runtime only), including after a restart or an in-app update.
 *
 * We use it to boot the `pipeline-monitor` safety-net daemon. That worker polls
 * SLURM/local process state and reconciles PipelineRun status when Nextflow
 * weblog callbacks are missing or delayed. It used to require a manual start
 * from the admin worker panel, so after any app restart/update it silently
 * stopped and finished SLURM jobs stayed stuck showing "running". Auto-starting
 * it here makes the safety net always-on.
 *
 * Set SEQDESK_DISABLE_WORKER_AUTOSTART=1 to opt out (e.g. when running the
 * monitor as an external/PM2 process or on a non-pipeline deployment).
 */
export async function register() {
  // Only the Node.js server runtime can spawn child processes; skip the Edge
  // runtime and any build-time invocation.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SEQDESK_DISABLE_WORKER_AUTOSTART === "1") return;

  try {
    const { ensureWorkerStarted } = await import("@/lib/workers/process");
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
  } catch (error) {
    // Best-effort: never let a worker-start failure break server boot. An admin
    // can still start the worker by hand from the worker panel.
    console.error(
      "[instrumentation] pipeline-monitor autostart failed:",
      error instanceof Error ? error.message : error,
    );
  }
}
