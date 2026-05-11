/**
 * Diagnose stream / worker / event state. Dumps everything regardless of status
 * so we can spot zombie rows.
 */
import { db } from "../src/lib/db";

async function main() {
  console.log("--- stream-monitor worker rows (any status) ---");
  const workers = await db.backgroundWorkerProcess.findMany({
    where: { name: "stream-monitor" },
    orderBy: { startedAt: "desc" },
    take: 5,
  });
  for (const w of workers) {
    const ageSec = Math.floor((Date.now() - new Date(w.startedAt).getTime()) / 1000);
    console.log(
      `  pid=${w.pid} status=${w.status} started=${w.startedAt.toISOString()} (${ageSec}s ago) stopped=${w.stoppedAt?.toISOString() ?? "-"}`,
    );
  }

  console.log("\n--- recent stream runs (any status) ---");
  const runs = await db.streamRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 5,
  });
  for (const r of runs) {
    const ageSec = Math.floor((Date.now() - new Date(r.startedAt).getTime()) / 1000);
    console.log(
      `  id=${r.id} status=${r.status} order=${r.orderId} totalReads=${r.totalReads} totalBases=${r.totalBases} started=${r.startedAt.toISOString()} (${ageSec}s ago)`,
    );
  }

  // Focus on the most recent run regardless of status — that's almost certainly the one in their UI.
  const run = runs[0];
  if (!run) {
    console.log("\n[diag] no stream runs in DB at all");
    return;
  }

  console.log(`\n--- latest 5 FILE_INGESTED events for run ${run.id} ---`);
  const events = await db.streamRunEvent.findMany({
    where: { streamRunId: run.id, kind: "FILE_INGESTED" },
    orderBy: { ts: "desc" },
    take: 5,
  });
  for (const e of events) {
    const parsed = e.payload ? JSON.parse(e.payload) : null;
    const keys = parsed ? Object.keys(parsed).join(",") : "(none)";
    console.log(`  ${e.ts.toISOString()} keys=[${keys}] reads=${parsed?.reads ?? "MISSING"} bases=${parsed?.bases ?? "MISSING"} dup=${!!parsed?.duplicate}`);
  }

  const ingestedCount = await db.streamIngestedFile.count({ where: { streamRunId: run.id } });
  console.log(`\n[diag] StreamIngestedFile rows for run ${run.id}: ${ingestedCount}`);
}

main()
  .catch((err) => {
    console.error("[diag] fatal:", err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
