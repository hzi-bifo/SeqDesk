/**
 * The Compute side of scripts/elektra-pipelines-check.py: start, read, cancel and resume a pipeline run on an
 * Analysis study's Data the way the web app does (same services, same plain status), and print JSON. Runs inside the
 * Compute tree with its environment (compute.env): `node --import tsx scripts/pipelines-check-driver.ts <command>`.
 *
 *   target <analysis name>                         the study's target key and the user who owns its Data
 *   start <targetKey> <pipelineId> <local|slurm>   start a run; prints { runId, runNumber, status }
 *   status <runId>                                 { status, shape, sentence, action, kind, queueStatus, queueReason }
 *   cancel <runId> | resume <runId> [time] [memory]
 */
import { db } from '../src/lib/db';
import { ensureDataStudy } from '../src/lib/pipelines/data-study';
import { getDataRun } from '../src/lib/pipelines/pipeline-data-service';
import { createPipelineRunForOperator, startPipelineRunForOperator } from '../src/lib/pipelines/pipeline-run-service';
import { cancelPipelineRunForOperator } from '../src/lib/pipelines/pipeline-run-ops-service';
import { resumePipelineRun } from '../src/lib/pipelines/run-resume';

const out = (value: unknown) => { console.log(JSON.stringify(value)); };

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'target') {
    const flow = await db.exploreFlow.findFirst({ where: { name: args.join(' ') }, select: { targetKey: true, createdById: true } });
    if (!flow) throw new Error(`No analysis called ${args.join(' ')}`);
    return out({ targetKey: flow.targetKey, userId: flow.createdById });
  }
  if (command === 'start') {
    const [targetKey, pipelineId, mode] = args;
    const flow = await db.exploreFlow.findFirst({ where: { targetKey }, select: { createdById: true } });
    const userId = flow!.createdById;
    const { studyId } = await ensureDataStudy({ targetKey, userId });
    const created = await createPipelineRunForOperator({ body: { pipelineId, studyId, executionMode: mode }, userId, accessScope: 'installation', canManageConfig: false });
    const body = created.body as { run?: { id?: string }; runId?: string; id?: string; error?: string };
    const runId = body.run?.id ?? body.runId ?? body.id;
    if (!runId) return out({ error: body.error ?? `create answered ${created.status}` });
    const started = await startPipelineRunForOperator({ runId, body: { executionMode: mode }, userId, accessScope: 'installation' });
    const run = await db.pipelineRun.findUnique({ where: { id: runId }, select: { runNumber: true, status: true } });
    return out({ runId, runNumber: run?.runNumber, status: run?.status, start: started.status, error: (started.body as { error?: string }).error ?? null });
  }
  if (command === 'status') {
    const view = await getDataRun(args[0]);
    const raw = await db.pipelineRun.findUnique({ where: { id: args[0] }, select: { status: true, queueStatus: true, queueReason: true, queueJobId: true } });
    return out({ ...raw, shape: view?.plain.shape, sentence: view?.plain.sentence, action: view?.plain.action?.kind ?? null, kind: view?.plain.error?.kind ?? null, firstLines: view?.plain.error?.firstLines ?? [] });
  }
  if (command === 'cancel') {
    const result = await cancelPipelineRunForOperator(args[0]);
    return out({ status: result.status, body: result.body });
  }
  if (command === 'resume') {
    const result = await resumePipelineRun(args[0], { time: args[1] || null, memory: args[2] || null });
    return out({ status: result.status, body: result.body });
  }
  throw new Error(`Unknown command ${command}`);
}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
