/**
 * Start "Run all" for named flows of the local Analysis stack and wait for them, as the Run all button does
 * (startFlowRun; the Compute process's explore monitor advances the steps). Used by mail2
 * Scripts/real-analysis-check.py. Run with the launcher's Compute environment (state/compute-env.json):
 *
 *   node --import tsx scripts/flow-run-real.ts "Airway: dexamethasone response" "Moving Pictures: gut vs tongue"
 *
 * Missing flows are reported and skipped; the others still run. Exits non-zero when a flow is missing, a run fails or does not finish within SEQDESK_FLOW_RUN_TIMEOUT_S (default 5400).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../src/lib/db';
import { startFlowRun } from '../src/lib/explore/flow-runs';

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/seqdesk_analysis_integration_local')) throw new Error('Only a dedicated local Analysis database is allowed.');
  const dir = process.env.SEQDESK_LOCAL_ANALYSIS_DIR;
  if (!dir) throw new Error('Set SEQDESK_LOCAL_ANALYSIS_DIR to the launcher state directory.');
  const compute = JSON.parse(await readFile(join(dir, 'compute.json'), 'utf8')) as { accounts: { userId: string; memberId: string; workspaceId: string }[] };
  const account = compute.accounts[0];
  const names = process.argv.slice(2);
  if (!account || !names.length) throw new Error('usage: flow-run-real.ts <flow name>...');
  const scopes = await db.integrationExploreScope.findMany({ where: { workspaceId: account.workspaceId } });
  const targets = scopes.map((scope) => scope.targetKey);
  const runs: { name: string; id: string; started: number }[] = [];
  // A missing flow does not stop the others: run what exists, name what was missing, and fail at the end.
  const missing: string[] = [];
  for (const name of names) {
    const flow = await db.exploreFlow.findFirst({ where: { name, targetKey: { in: targets } }, orderBy: { createdAt: 'desc' } });
    if (!flow) { missing.push(name); console.log(`MISSING ${name}: no such flow in workspace ${account.workspaceId}; seed it first. Running the others.`); continue; }
    const run = await startFlowRun(flow.id, { scope: 'all', actor: { userId: account.userId, memberId: account.memberId, name: 'Real-data check' } });
    console.log(`Started ${name}: run #${run.number ?? '?'} (${run.id})`);
    runs.push({ name, id: run.id, started: Date.now() });
  }
  const timeout = Number(process.env.SEQDESK_FLOW_RUN_TIMEOUT_S || 5400) * 1000;
  let failed = false;
  const pending = new Set(runs.map((run) => run.id));
  while (pending.size) {
    for (const run of runs.filter((entry) => pending.has(entry.id))) {
      const row = await db.exploreFlowRun.findUnique({ where: { id: run.id } });
      const seconds = Math.round((Date.now() - run.started) / 1000);
      if (row && ['completed', 'failed', 'cancelled'].includes(row.status)) {
        pending.delete(run.id);
        console.log(`${run.name}: ${row.status} in ${seconds}s (${row.doneCount}/${row.stepCount} steps)${row.status === 'completed' ? '' : ` at ${row.failedStepLabel ?? '?'}: ${row.failureWords ?? ''}\n${row.failureDetail ?? ''}`}`);
        if (row.status !== 'completed') failed = true;
      } else if (Date.now() - run.started > timeout) {
        pending.delete(run.id);
        failed = true;
        console.log(`${run.name}: still ${row?.status} after ${seconds}s (${row?.doneCount}/${row?.stepCount} steps)`);
      }
    }
    if (pending.size) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  if (missing.length) console.log(`Not run (missing): ${missing.map((name) => `"${name}"`).join(', ')}`);
  if (failed || missing.length) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
