/**
 * Prune the outputs of old Explore runs (see src/lib/explore/housekeeping.ts).
 *
 *   npx tsx scripts/explore-prune.ts                 # dry run: list what would go
 *   npx tsx scripts/explore-prune.ts --apply         # prune and remove the files now
 *   npx tsx scripts/explore-prune.ts --days 60 --target project:p1
 *
 * Kept: current runs, runs a report or Writer cites, held (pinned) runs, runs a
 * kept run reuses or reads, and runs younger than --days (default
 * SEQDESK_EXPLORE_PRUNE_AFTER_DAYS or 30). Pruned runs keep their record,
 * manifest, logs and checksums.
 */
import { db } from "../src/lib/db";
import { processCleanupJobs, pruneRuns } from "../src/lib/explore/housekeeping";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (flag: string) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined; };
  const apply = args.includes("--apply");
  const days = value("--days") ? Number(value("--days")) : undefined;
  const result = await pruneRuns({ dryRun: !apply, olderThanDays: days, targetKey: value("--target") ?? null });
  console.log(`${apply ? "Pruned" : "Would prune"} ${result.runs.length} runs finished before ${result.cutoff.slice(0, 10)} (older than ${result.olderThanDays} days).`);
  console.log(`Kept: ${Object.entries(result.kept).map(([reason, n]) => `${n} ${reason}`).join(", ")}; already pruned: ${result.alreadyPruned}.`);
  for (const run of result.runs) {
    console.log(`  ${run.flowName} · ${run.number ? `run #${run.number}` : `trial ${run.trialNumber}`} · ${run.finishedAt.slice(0, 10)} · ${run.stepRuns.length} step folders · ${run.versions.length} table versions`);
  }
  if (apply) console.log(`Files: ${JSON.stringify(await processCleanupJobs(50))}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
