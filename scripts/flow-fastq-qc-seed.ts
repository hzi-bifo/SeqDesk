/**
 * Seed a real sequencing-QC Flow study with shell (bash) steps. The reads come in through Data, not from a local file:
 * ENA run ERR10419931 (E. coli, HiSeq X Ten, paired; 2 gzip FASTQ files, about 2.2 MiB together).
 *
 *   1. Run this script once: it creates the study (an Analysis scope for the collaboration workspace) and stops,
 *      because the FASTQ files are not in it yet.
 *   2. In the web app: Data > Find data > ERR10419931 > Preview > Import. When the import is done, Imports >
 *      Use in Analysis > into this study > Add as file for both FASTQ files (Web/scripts/test-flow-shell-browser.mjs
 *      PHASE=import does this). SeqDesk re-checks the SHA-256 recorded at download time; the file's description names
 *      the ENA run and its MD5.
 *   3. Run this script again: it checks both files came from that ENA import, then adds the two shell steps and the
 *      Python summary of scripts/flow-fastq-qc/recipe.json (step 1 with fastp and jq as step packages) and a report.
 *
 *   SEQDESK_LOCAL_ANALYSIS_DIR=<launcher state dir> SEQDESK_LOCAL_ANALYSIS_COLLABORATION_PORT=<port> \
 *   DATABASE_URL=... node --import tsx scripts/flow-fastq-qc-seed.ts [--cite | --negative]
 *
 * --cite resolves labdesk://value/<currentRun>/<fastp step>/reads_in with checksum verification and runs the
 * independent verifier scripts/flow-fastq-qc/verify.py (standard-library Python reading the FASTQ with gzip).
 * --negative runs three shell steps that must fail inside the sandbox (a download, reading ~/.ssh, writing outside
 * the run folder) and checks each failure says why.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Prisma } from '@prisma/client';
import { db } from '../src/lib/db';
import { createReport, listReports, saveReport } from '../src/lib/explore/reports';
import { createFlow, listFlows } from '../src/lib/explore/flows';
import { addStep } from '../src/lib/explore/recipe-edit';
import { loadRecipe } from '../src/lib/explore/recipe';
import { createAnalysis, createRevision, getAnalysisDetail } from '../src/lib/explore/analyses';
import { createAndStartRun } from '../src/lib/explore/runner';
import { resolveValues } from '../src/lib/explore/values';

const AUTHORITY = process.env.SEQDESK_FLOW_AUTHORITY ?? `http://127.0.0.1:${process.env.SEQDESK_LOCAL_ANALYSIS_COLLABORATION_PORT ?? '18586'}`;
const HERE = join(process.cwd(), 'scripts', 'flow-fastq-qc');

interface RecipeStep { key: string; name: string; file: string; language: 'shell' | 'python' | 'r'; purpose: string; files: string[]; inputs: Record<string, { step: string; output: string }>; params: Record<string, unknown>; packages: string[] }
interface Recipe {
  study: string; flow: string; question: string;
  source: { connector: string; accession: string; note: string };
  files: Record<string, { file: string }>;
  steps: RecipeStep[];
  // macOS (Seatbelt) denies with EPERM; under bubblewrap the home directory is absent and the rest read-only.
  negative: { name: string; code: string; expect: string | string[] }[];
}

async function context() {
  const dir = process.env.SEQDESK_LOCAL_ANALYSIS_DIR;
  if (!dir) throw new Error('Set SEQDESK_LOCAL_ANALYSIS_DIR to the launcher state directory.');
  const collaboration = JSON.parse(await readFile(join(dir, 'collaboration.json'), 'utf8')) as { workspaceId: string };
  const compute = JSON.parse(await readFile(join(dir, 'compute.json'), 'utf8')) as { accounts: { userId: string }[] };
  const userId = compute.accounts[0]?.userId;
  if (!userId) throw new Error('compute.json has no account mapping.');
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('The mapped SeqDesk user does not exist.');
  return { workspaceId: collaboration.workspaceId, user };
}

async function findProject(workspaceId: string, name: string) {
  const links = await db.integrationExploreScope.findMany({ where: { authority: AUTHORITY, workspaceId, projectId: '' } });
  return (await db.exploreProject.findMany({ where: { id: { in: links.map(link => link.targetKey.replace(/^project:/, '')) }, name } }))[0] ?? null;
}

/** The study file must be the connector's: added from the ENA import of this run, with the bytes the importer checked. */
async function connectorFile(targetKey: string, alias: string, recipe: Recipe) {
  const spec = recipe.files[alias]!;
  const file = await db.managedFile.findFirst({ where: { targetKey, originalName: spec.file, removedAt: null }, orderBy: { createdAt: 'asc' } });
  if (!file) return null;
  if (!file.description?.startsWith(`From ENA ${recipe.source.accession}`)) throw new Error(`${spec.file} is in the study but not from the ENA import (description: ${file.description ?? 'none'}). Add it through Data > Imports > Use in Analysis > Add as file.`);
  const job = await db.workbenchImportJob.findFirst({ where: { providerId: 'ena-fastq-accession', status: 'success', resultDataset: { sourceMetadata: { contains: file.checksumSha256 } } }, include: { resultDataset: true } });
  if (!job) throw new Error(`${spec.file}: no successful ENA import holds these bytes (sha256 ${file.checksumSha256}).`);
  const meta = JSON.parse(job.resultDataset!.sourceMetadata ?? '{}') as { files?: { filename: string; sha256: string; md5?: string; verifiedMd5?: string; sourceUrl?: string }[] };
  const entry = meta.files?.find(f => f.sha256 === file.checksumSha256);
  if (!entry || entry.filename !== spec.file || !entry.verifiedMd5 || entry.verifiedMd5 !== entry.md5) throw new Error(`${spec.file}: the ENA import did not verify its MD5.`);
  return { file, entry };
}

async function seed(recipe: Recipe) {
  const { workspaceId, user } = await context();
  let project = await findProject(workspaceId, recipe.study);
  if (!project) {
    project = await db.exploreProject.create({ data: { name: recipe.study, description: `Public reads from ENA run ${recipe.source.accession}. ${recipe.source.note} Data comes in through Data > Find data (ENA FASTQ connector).`, ownerId: user.id } });
    await db.integrationExploreScope.create({ data: { id: randomUUID(), authority: AUTHORITY, workspaceId, projectId: '', targetKey: `project:${project.id}`, createdBy: user.id } });
    console.log('Created study', recipe.study);
  }
  const targetKey = `project:${project.id}`;

  const files = new Map<string, string>();
  const missing: string[] = [];
  for (const alias of Object.keys(recipe.files)) {
    const found = await connectorFile(targetKey, alias, recipe);
    if (!found) { missing.push(recipe.files[alias]!.file); continue; }
    files.set(alias, found.file.id);
    console.log(`File ${alias}: ${found.entry.filename} from ${found.entry.sourceUrl}, md5 ${found.entry.verifiedMd5} (verified), sha256 ${found.file.checksumSha256.slice(0, 16)}…`);
  }
  if (missing.length) {
    console.log(`Study ready; files missing: ${missing.join(', ')}. Import ${recipe.source.accession} in Data > Find data, then Imports > Use in Analysis > "${recipe.study}" > Add as file. Run this script again after.`);
    return;
  }

  let flow = (await listFlows(targetKey)).find(entry => entry.name === recipe.flow) ?? null;
  if (!flow) { flow = await createFlow(targetKey, user.id, recipe.flow, recipe.question); console.log('Created flow', flow.name); }

  const stepIds = new Map<string, string>();
  const existing = (await loadRecipe(flow.id))?.steps ?? [];
  for (const step of recipe.steps) {
    const code = await readFile(join(HERE, step.file), 'utf8');
    const fileInputs = step.files.map(alias => ({ alias, fileId: files.get(alias)! }));
    const found = existing.find(entry => entry.name === step.name);
    if (found) {
      stepIds.set(step.key, found.id);
      const detail = await getAnalysisDetail(found.id);
      if (detail && detail.code !== code) {
        await createRevision({ analysisId: found.id, code, author: 'user', authorUserId: user.id, message: `Code from ${step.file}` });
        console.log('Updated', step.name, '(code)');
      }
      continue;
    }
    const inputs = Object.entries(step.inputs).map(([alias, source]) => ({ alias, from: { stepId: stepIds.get(source.step)!, output: source.output } }));
    const previous = [...stepIds.values()].at(-1) ?? null;
    const id = await addStep(flow.id, { after: previous, name: step.name, purpose: step.purpose, code, language: step.language, inputs, params: step.params, actor: { userId: user.id } });
    // File inputs (the FASTQ files) ride on the step's revision, next to its table inputs.
    if (fileInputs.length) await createRevision({ analysisId: id, code, fileInputs, author: 'user', authorUserId: user.id, message: `Reads ${fileInputs.map(input => input.alias).join(', ')} from Data (ENA ${recipe.source.accession})` });
    stepIds.set(step.key, id);
    console.log('Added step', step.name, `(${step.language})`);
  }
  for (const step of recipe.steps) {
    const id = stepIds.get(step.key)!;
    await db.exploreAnalysis.update({ where: { id }, data: { packages: step.packages.length ? { packages: step.packages, channels: [] } : Prisma.DbNull } } as never);
    if (step.packages.length) console.log('Set packages of', step.name, step.packages.join(' '));
  }

  const id = (key: string) => stepIds.get(key)!;
  const title = 'FASTQ QC: ERR10419931';
  let report = (await listReports(targetKey)).find(entry => entry.title === title);
  if (!report) { report = await createReport(targetKey, user.id, title); console.log('Created report'); }
  await saveReport(report.id, {
    title,
    blocks: [
      { id: 'text:intro', type: 'text', span: 2, markdown: `## Read QC of ENA ${recipe.source.accession}\n\nE. coli, Illumina HiSeq X Ten, paired-end; imported through Data > Find data (ENA FASTQ connector, MD5-checked). Two shell steps run fastp and seqkit inside the analysis sandbox; a Python step summarises their tables.` },
      { id: `run-metric:${id('fastp')}`, type: 'run-metric', analysisId: id('fastp'), metrics: ['reads_in', 'reads_out', 'pct_q30', 'gc_pct', 'mean_quality'], labels: { reads_in: 'Reads in', reads_out: 'Reads after fastp', pct_q30: 'Bases ≥ Q30 (%)', gc_pct: 'GC (%)', mean_quality: 'Mean base quality' }, digits: { reads_in: 0, reads_out: 0, pct_q30: 2, gc_pct: 2, mean_quality: 2 }, span: 2 },
      { id: `run-metric:${id('lengths')}`, type: 'run-metric', analysisId: id('lengths'), metrics: ['n_reads', 'mean_length'], labels: { n_reads: 'Reads (seqkit)', mean_length: 'Mean read length (bp)' }, digits: { n_reads: 0, mean_length: 2 }, span: 1 },
      { id: `run-metric:${id('summary')}`, type: 'run-metric', analysisId: id('summary'), metrics: ['pct_kept', 'modal_length'], labels: { pct_kept: 'Reads kept (%)', modal_length: 'Most common length (bp)' }, digits: { pct_kept: 2, modal_length: 0 }, span: 1 },
      { id: `figure:${id('summary')}:qc_summary`, type: 'figure', analysisId: id('summary'), figureName: 'qc_summary', caption: 'Reads before and after fastp, and the read-length distribution per mate (log scale).', span: 2 },
    ],
    filters: [],
  });
  console.log(`Ready: study "${recipe.study}", flow "${flow.name}" (${recipe.steps.length} steps: ${recipe.steps.map(step => step.language).join(', ')}), report "${title}". Press Run recipe, then run this script with --cite.`);
}

async function runFolder(flowRunId: string, analysisId: string) {
  const stepRun = await db.exploreAnalysisRun.findFirst({ where: { flowRunId, analysisId }, select: { runFolder: true, reusedFromRunId: true } });
  const source = stepRun?.reusedFromRunId ? await db.exploreAnalysisRun.findUnique({ where: { id: stepRun.reusedFromRunId }, select: { runFolder: true } }) : stepRun;
  if (!source?.runFolder) throw new Error(`No run folder for step ${analysisId} in the current run.`);
  return source.runFolder;
}

async function cite(recipe: Recipe) {
  const { workspaceId } = await context();
  const project = await findProject(workspaceId, recipe.study);
  if (!project) throw new Error('Seed the study first.');
  const flow = (await listFlows(`project:${project.id}`)).find(entry => entry.name === recipe.flow);
  const record = flow ? await db.exploreFlow.findUnique({ where: { id: flow.id }, select: { currentRunId: true } }) : null;
  if (!flow || !record?.currentRunId) throw new Error('The flow has no current run yet: press Run recipe and wait for it to finish.');
  const steps = (await loadRecipe(flow.id))!.steps;
  const idOf = (key: string) => steps.find(step => step.name === recipe.steps.find(entry => entry.key === key)!.name)!.id;
  const ref = `labdesk://value/${record.currentRunId}/${idOf('fastp')}/reads_in`;
  const resolved = await resolveValues([ref], async () => true, { verify: true });
  console.log(JSON.stringify(resolved, null, 2));
  const value = JSON.stringify(resolved).match(/"value":\s*(\d+)/)?.[1];
  if (!value) throw new Error('The citation did not resolve to a number.');
  console.log(`Citation ${ref} = ${value}`);
  const folders = Object.fromEntries(await Promise.all(recipe.steps.map(async step => [step.key, await runFolder(record.currentRunId!, idOf(step.key))] as const)));
  const check = spawnSync('python3', [join(HERE, 'verify.py'), '--cite', `reads_in=${value}`, ...Object.entries(folders).flatMap(([key, folder]) => [`--${key}`, folder])], { stdio: 'inherit' });
  process.exitCode = check.status ?? 1;
}

/** Three shell steps that must fail in the sandbox, each with a message that says why. */
async function negative(recipe: Recipe) {
  const { workspaceId, user } = await context();
  const project = await findProject(workspaceId, recipe.study);
  if (!project) throw new Error('Seed the study first.');
  const targetKey = `project:${project.id}`;
  let ok = true;
  for (const check of recipe.negative) {
    const code = check.code.replaceAll('$HOST_HOME', homedir());
    const found = await db.exploreAnalysis.findFirst({ where: { targetKey, name: check.name, flowId: null } });
    const analysis = found ?? await createAnalysis({ targetKey, name: check.name, language: 'shell', code, inputs: [], createdById: user.id });
    if (found) {
      const detail = await getAnalysisDetail(found.id);
      if (detail && detail.code !== code) await createRevision({ analysisId: found.id, code, author: 'user', authorUserId: user.id, message: 'Sandbox check' });
    }
    const run = await createAndStartRun({ analysisId: analysis.id, createdById: user.id, executionMode: 'local' });
    let state = await db.exploreAnalysisRun.findUnique({ where: { id: run.id } });
    for (let i = 0; i < 90 && state && ['pending', 'queued', 'running'].includes(state.status); i += 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      state = await db.exploreAnalysisRun.findUnique({ where: { id: run.id } });
    }
    const err = state?.runFolder && existsSync(join(state.runFolder, 'logs', 'pipeline.err')) ? await readFile(join(state.runFolder, 'logs', 'pipeline.err'), 'utf8') : '';
    const out = state?.runFolder && existsSync(join(state.runFolder, 'logs', 'pipeline.out')) ? await readFile(join(state.runFolder, 'logs', 'pipeline.out'), 'utf8') : '';
    const sandboxed = /Sandbox: seatbelt|Sandbox: bubblewrap/.test(out);
    const failed = state?.status === 'failed';
    const said = [check.expect].flat().some(expect => err.includes(expect) || (state?.errorTail ?? '').includes(expect));
    const escaped = check.name.includes('outside') && existsSync(join(homedir(), 'seqdesk-shell-escape.txt'));
    // The step itself must have been refused, not the sandbox tool failing to set up.
    const setupFailed = /^bwrap: /m.test(err);
    const pass = failed && said && sandboxed && !escaped && !setupFailed;
    ok &&= pass;
    console.log(`${pass ? 'ok      ' : 'MISMATCH'} ${check.name}: run #${state?.runNumber} ${state?.status}, ${sandboxed ? 'sandboxed' : 'NOT sandboxed'}; stderr: ${err.trim().split('\n').filter(Boolean).slice(-2).join(' | ')}`);
  }
  console.log(ok ? 'NEGATIVE CHECKS: PASSED' : 'NEGATIVE CHECKS: FAILED');
  process.exitCode = ok ? 0 : 1;
}

async function main() {
  const recipe = JSON.parse(await readFile(join(HERE, 'recipe.json'), 'utf8')) as Recipe;
  if (process.argv.includes('--cite')) await cite(recipe);
  else if (process.argv.includes('--negative')) await negative(recipe);
  else await seed(recipe);
}

main().catch(error => { console.error(error); process.exit(1); }).finally(() => db.$disconnect());
