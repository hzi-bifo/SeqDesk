/**
 * Diagnostic: call startWorker() directly (same fn the API route uses) and
 * print every signal. Skips the auth and DB single-instance guard.
 *
 * Run: npx tsx scripts/diagnose-start-worker.ts
 */
import { startWorker } from "../src/lib/workers/process";
import { getWorkerSpec } from "../src/lib/workers/registry";
import { db } from "../src/lib/db";

async function main() {
  console.log("[diag] node:", process.version, "cwd:", process.cwd());
  const spec = getWorkerSpec("stream-monitor");
  if (!spec) {
    console.error("spec not found");
    process.exit(1);
  }

  try {
    const row = await startWorker(spec);
    console.log("[diag] startWorker returned:", row);
    // Clean up — kill the spawned process and mark the row stopped.
    setTimeout(async () => {
      try {
        process.kill(row.pid, "SIGTERM");
      } catch {}
      await db.backgroundWorkerProcess.update({
        where: { id: row.id },
        data: { status: "STOPPED", stoppedAt: new Date() },
      }).catch(() => undefined);
      console.log("[diag] cleaned up pid", row.pid);
      process.exit(0);
    }, 1500);
  } catch (err) {
    console.error("[diag] startWorker threw:", (err as Error).message);
    console.error("[diag] stack:", (err as Error).stack);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[diag] fatal:", err);
  process.exit(1);
});
