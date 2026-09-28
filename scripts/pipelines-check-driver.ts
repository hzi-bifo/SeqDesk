/**
 * The Compute side of scripts/elektra-pipelines-check.py: start, read, cancel and resume a pipeline run on an
 * Analysis study's Data the way the web app does (same services, same plain status), and print JSON. Runs inside the
 * Compute tree with its environment (compute.env): `node --import tsx scripts/pipelines-check-driver.ts <command>`.
 *
 *   target <analysis name>                         the study's target key and the user who owns its Data
 *   start <targetKey> <pipelineId> <local|slurm>   start a run; prints { runId, runNumber, status }
 *   status <runId>                                 { status, shape, sentence, action, kind, queueStatus, queueReason }
 *   cancel <runId> | resume <runId> [time] [memory] [force]
 *   other-target <targetKey>                       another Analysis study of the same owner
 *   seed-copy <fromKey> <toKey>                    copy the FASTQ files of one study's Data into another's (a second study)
 *   reads-add <targetKey> | reads-drop <targetKey> add, then remove, one extra FASTQ file (the reads change under a run)
 *   unseed <targetKey>                             remove the files seed-copy made
 */
import fs from 'fs/promises';
import path from 'path';
import { resolveContainedPath, resolveExploreStorage } from '../src/lib/explore/storage';
import { db } from '../src/lib/db';
import { ensureDataStudy, readsChangedSinceRun } from '../src/lib/pipelines/data-study';
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
  if (command === 'other-target') {
    // A second Analysis study of the same owner (another project), for runs in two studies at once.
    const first = await db.exploreFlow.findFirst({ where: { targetKey: args[0] }, select: { createdById: true } });
    const other = await db.exploreFlow.findFirst({ where: { targetKey: { not: args[0], startsWith: 'project:' }, createdById: first?.createdById }, orderBy: { createdAt: 'asc' }, select: { targetKey: true, name: true } });
    return out(other ?? { error: 'No second Analysis study of this owner' });
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
    return out({ ...raw, readsChanged: (view as { readsChanged?: unknown } | null)?.readsChanged ?? null, shape: view?.plain.shape, sentence: view?.plain.sentence, action: view?.plain.action?.kind ?? null, kind: view?.plain.error?.kind ?? null, firstLines: view?.plain.error?.firstLines ?? [] });
  }
  if (command === 'cancel') {
    const result = await cancelPipelineRunForOperator(args[0]);
    return out({ status: result.status, body: result.body });
  }
  if (command === 'resume') {
    // The web app's rule (integration/pipelines.ts): a changed Data answers 409 reads_changed unless forced.
    const run = await db.pipelineRun.findUnique({ where: { id: args[0] }, select: { study: { select: { alias: true } } } });
    const key = run?.study?.alias?.replace(/^seqdesk-data:/, '') ?? null;
    const changed = args[3] !== 'force' && key ? await readsChangedSinceRun(args[0], key) : null;
    if (changed) return out({ status: 409, body: { code: 'reads_changed', error: changed } });
    const result = await resumePipelineRun(args[0], { time: args[1] || null, memory: args[2] || null, ...(args[3] === 'force' ? { force: true } : {}) });
    return out({ status: result.status, body: result.body });
  }
  const filesRoot = async () => path.join((await resolveExploreStorage()).importsRoot, 'files');
  const copyFile = async (file: { storagePath: string; originalName: string; mimeType: string; sizeBytes: bigint; checksumSha256: string; createdById: string }, targetKey: string, name: string, tag: string) => {
    const root = await filesRoot();
    const storagePath = `${path.dirname(file.storagePath)}/${tag}-${Date.now()}-${path.basename(file.storagePath)}`;
    const source = await resolveContainedPath(root, file.storagePath);
    await fs.copyFile(source, path.join(path.dirname(source), path.basename(storagePath)));
    return db.managedFile.create({ data: { targetKey, originalName: name, storagePath, mimeType: file.mimeType, sizeBytes: file.sizeBytes, checksumSha256: file.checksumSha256, createdById: file.createdById, tags: [tag] }, select: { id: true } });
  };
  const fastqs = (targetKey: string) => db.managedFile.findMany({ where: { targetKey, removedAt: null, originalName: { contains: '.f' } }, orderBy: { originalName: 'asc' } });
  if (command === 'seed-copy') {
    const [from, to] = args;
    if ((await fastqs(to)).some((f) => f.tags.includes('check-seed'))) return out({ seeded: 0, already: true });
    const files = (await fastqs(from)).filter((f) => /\.(fastq|fq)(\.gz)?$/.test(f.originalName));
    for (const f of files) await copyFile(f, to, f.originalName, 'check-seed');
    return out({ seeded: files.length });
  }
  if (command === 'reads-add') {
    const [first] = (await fastqs(args[0])).filter((f) => /\.(fastq|fq)(\.gz)?$/.test(f.originalName));
    const made = await copyFile(first, args[0], `check_extra_R1.fastq.gz`, 'check-extra');
    return out({ added: made.id });
  }
  if (command === 'reads-drop' || command === 'unseed') {
    const tag = command === 'unseed' ? 'check-seed' : 'check-extra';
    const rows = await db.managedFile.findMany({ where: { targetKey: args[0], tags: { has: tag } } });
    const root = await filesRoot();
    for (const r of rows) {
      await fs.rm(await resolveContainedPath(root, r.storagePath), { force: true });
      await db.managedFile.delete({ where: { id: r.id } }).catch(() => db.managedFile.update({ where: { id: r.id }, data: { removedAt: new Date() } }));
    }
    return out({ removed: rows.length });
  }
  throw new Error(`Unknown command ${command}`);
}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
