/**
 * Pipelines on an Analysis study's Data (S-25P): the reads a pipeline runs on are the FASTQ files in the study's
 * Data (managed files of `project:<id>`). SeqDesk pipelines run on a SeqDesk study's samples, so each Analysis study
 * gets one backing SeqDesk study ("<name> · Data", marked by its alias) whose samples mirror the FASTQ pairs in Data.
 * The mirror is additive and idempotent: a pair already mirrored keeps its sample; files are linked by their
 * original names under <explore>/pipeline-reads/<project id>/, never copied or moved.
 */
import fs from 'fs/promises';
import path from 'path';
import { db } from '@/lib/db';
import { resolveContainedPath, resolveExploreStorage } from '@/lib/explore/storage';
import { parseTargetKey } from '@/lib/explore/target-key';

export const dataStudyAlias = (targetKey: string) => `seqdesk-data:${targetKey}`;

const FASTQ = /\.(?:fastq|fq)(?:\.gz)?$/i;
const MATE = /^(.+?)(?:[._-](?:R)?([12]))(?:_001)?\.(?:fastq|fq)(?:\.gz)?$/i;

export interface DataFastq { id: string; name: string; sizeBytes: number }
export interface DataReadPair { sampleId: string; r1: DataFastq; r2: DataFastq | null }

/** FASTQ files → samples: `<name>_1/_2`, `_R1/_R2` (with an optional `_001`) pair up; anything else is single-end. */
export function pairFastqFiles(files: DataFastq[]): DataReadPair[] {
  const bySample = new Map<string, { r1?: DataFastq; r2?: DataFastq; single?: DataFastq }>();
  for (const file of files.filter((f) => FASTQ.test(f.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const mate = MATE.exec(file.name);
    const key = mate ? mate[1] : file.name.replace(FASTQ, '');
    const entry = bySample.get(key) ?? {};
    if (mate?.[2] === '2') entry.r2 ??= file;
    else if (mate?.[2] === '1') entry.r1 ??= file;
    else entry.single ??= file;
    bySample.set(key, entry);
  }
  const pairs: DataReadPair[] = [];
  const used = new Set<string>();
  for (const [sampleId, entry] of bySample) {
    const r1 = entry.r1 ?? entry.single ?? entry.r2;
    if (!r1) continue;
    // Names that differ only in spaces or accents ("Probe ä 1", "Probe ö 1") must not become the same sample id:
    // Nextflow would publish both samples' outputs to one file name.
    const base = sampleId.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 76) || 'sample';
    let id = base;
    for (let n = 2; used.has(id.toLowerCase()); n += 1) id = `${base}_${n}`;
    used.add(id.toLowerCase());
    pairs.push({ sampleId: id, r1, r2: entry.r1 && entry.r2 ? entry.r2 : null });
  }
  return pairs;
}

export function readsWords(pairs: DataReadPair[]): string {
  if (!pairs.length) return 'no FASTQ files';
  const paired = pairs.filter((p) => p.r2).length;
  const single = pairs.length - paired;
  return [paired ? `${paired} FASTQ pair${paired === 1 ? '' : 's'}` : '', single ? `${single} single FASTQ file${single === 1 ? '' : 's'}` : ''].filter(Boolean).join(' + ');
}

/** The FASTQ files in a study's Data, paired into samples. */
export async function readsInData(targetKey: string): Promise<{ files: DataFastq[]; pairs: DataReadPair[]; words: string }> {
  const rows = await db.managedFile.findMany({
    where: { targetKey, removedAt: null, OR: [{ originalName: { endsWith: '.fastq.gz' } }, { originalName: { endsWith: '.fq.gz' } }, { originalName: { endsWith: '.fastq' } }, { originalName: { endsWith: '.fq' } }] },
    select: { id: true, originalName: true, sizeBytes: true }, orderBy: { originalName: 'asc' }, take: 2000,
  });
  const files = rows.map((row) => ({ id: row.id, name: row.originalName, sizeBytes: Number(row.sizeBytes) }));
  const pairs = pairFastqFiles(files);
  return { files, pairs, words: readsWords(pairs) };
}

/** The backing SeqDesk study of an Analysis study, when it exists. */
export async function findDataStudy(targetKey: string): Promise<{ id: string } | null> {
  return db.study.findFirst({ where: { alias: dataStudyAlias(targetKey) }, select: { id: true }, orderBy: { createdAt: 'asc' } });
}

/** Link a Data file under its original name (pipelines read the name: FastQC and seqkit look at the extension). */
async function linkDataFile(fileId: string, linkDir: string): Promise<string> {
  const file = await db.managedFile.findUniqueOrThrow({ where: { id: fileId }, select: { storagePath: true, originalName: true } });
  const storage = await resolveExploreStorage();
  const source = await resolveContainedPath(path.join(storage.importsRoot, 'files'), file.storagePath);
  const name = file.originalName.replace(/[/\\]/g, '_');
  const link = path.join(linkDir, name);
  const current = await fs.readlink(link).catch(() => null);
  if (current !== source) {
    await fs.rm(link, { force: true });
    await fs.symlink(source, link);
  }
  return link;
}

/**
 * Create (once) the backing SeqDesk study for an Analysis study and mirror its FASTQ pairs as samples with reads.
 * Returns the study id and the sample ids that mirror the given pairs (all pairs when none are named).
 */
export async function ensureDataStudy(input: { targetKey: string; userId: string; onlySamples?: string[] }): Promise<{ studyId: string; sampleIds: string[]; pairs: DataReadPair[] }> {
  const target = parseTargetKey(input.targetKey);
  if (!target || target.type !== 'project') throw new Error('Pipelines run on an Analysis study’s Data.');
  const project = await db.exploreProject.findUnique({ where: { id: target.id }, select: { name: true } });
  if (!project) throw new Error('Study not found.');
  const alias = dataStudyAlias(input.targetKey);
  let study = await findDataStudy(input.targetKey);
  if (!study) {
    study = await db.study.create({ data: { title: `${project.name} · Data`.slice(0, 200), alias, userId: input.userId,
      description: 'Holds the reads of an Analysis study’s Data so pipelines can run on them. Managed by SeqDesk; the files stay in the study’s Data.' }, select: { id: true } });
  }
  const { pairs } = await readsInData(input.targetKey);
  const wanted = input.onlySamples?.length ? pairs.filter((p) => input.onlySamples!.includes(p.sampleId)) : pairs;
  const storage = await resolveExploreStorage();
  const linkDir = path.join(storage.baseDir, 'pipeline-reads', target.id);
  await fs.mkdir(linkDir, { recursive: true });
  const existing = await db.sample.findMany({ where: { studyId: study.id }, select: { id: true, sampleId: true, reads: { where: { isActive: true }, select: { id: true, file1: true, file2: true } } } });
  const sampleIds: string[] = [];
  for (const pair of wanted) {
    const file1 = await linkDataFile(pair.r1.id, linkDir);
    const file2 = pair.r2 ? await linkDataFile(pair.r2.id, linkDir) : null;
    let sample = existing.find((s) => s.sampleId === pair.sampleId);
    if (!sample) {
      const created = await db.sample.create({ data: { sampleId: pair.sampleId, sampleAlias: pair.sampleId, sampleTitle: pair.sampleId, studyId: study.id }, select: { id: true, sampleId: true } });
      sample = { ...created, reads: [] };
    }
    const same = sample.reads.find((r) => r.file1 === file1 && (r.file2 ?? null) === file2);
    if (!same) {
      if (sample.reads.length) await db.read.updateMany({ where: { sampleId: sample.id, isActive: true }, data: { isActive: false } });
      await db.read.create({ data: { sampleId: sample.id, file1, file2, dataClass: 'raw', dataClassSource: 'analysis_data' } });
    }
    sampleIds.push(sample.id);
  }
  return { studyId: study.id, sampleIds, pairs: wanted };
}
