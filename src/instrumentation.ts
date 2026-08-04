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
 * The autostarted monitor is also stopped when this server process receives a
 * termination signal. The worker is spawned detached (so an admin-started one
 * survives a Next.js reload), but for the autostarted one we want it tied to the
 * app lifecycle: otherwise it lingers after the app stops, holding the release's
 * node_modules/.prisma engine open. On an NFS install that breaks teardown of
 * the old release dir (the open file becomes an undeletable `.nfs*` silly-rename
 * file, so `rm -rf` fails with "Directory not empty"), and after an update the
 * stale monitor keeps running old code from a release dir that should be removed.
 *
 * Public demos and Vercel deployments never run local/SLURM pipelines, and a
 * polling daemon there would only keep the remote database awake. Set
 * SEQDESK_DISABLE_WORKER_AUTOSTART=1 to opt out explicitly elsewhere (e.g. when
 * running the monitor as an external/PM2 process).
 */
export function shouldAutostartPipelineMonitor(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.NEXT_RUNTIME !== "nodejs") return false;
  if (env.SEQDESK_DISABLE_WORKER_AUTOSTART === "1") return false;
  if (
    env.SEQDESK_ENABLE_PUBLIC_DEMO === "true" ||
    env.NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO === "true"
  ) {
    return false;
  }
  if (env.VERCEL === "1") return false;
  return true;
}

export async function register() {
  // Next invokes instrumentation in both Node and Edge runtimes. Keep the
  // runtime-specific import directly inside this compile-time branch so the
  // Edge bundle never traverses Node-only worker dependencies.
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    shouldAutostartPipelineMonitor()
  ) {
    const { registerNodeInstrumentation } = await import(
      "./instrumentation-node"
    );
    await registerNodeInstrumentation();
  }
}
