/**
 * Seed a real RNA-seq time-course Flow study whose data comes in through a Data connector, not from a local file:
 * Zenodo record 15152686 (CC-BY-4.0; MRC-5 lung fibroblasts, TGF-b1 0/5/10/15 ng/mL x 24/48/72 h, 4 replicates).
 *
 *   1. Run this script once: it creates the study (an Analysis scope for the collaboration workspace) and stops,
 *      because the two tables are not there yet.
 *   2. In the web app: Data > Find data > paste 10.5281/zenodo.15152686 > Preview > Import. When the import is
 *      done, Imports > Use in Analysis > into this study > Make table for normalized_counts_TGFB1.txt and
 *      Phenodata_TGFB1.xlsx. SeqDesk re-checks the SHA-256 recorded at download time and stores the source
 *      (record, DOI, version, licence, checksums) on each table.
 *   3. Run this script again: it checks both tables came from that Zenodo record with the published MD5s, then adds
 *      the six R steps of scripts/flow-timecourse/recipe.json (the GO step with its own packages) and a report.
 *
 *   SEQDESK_LOCAL_ANALYSIS_DIR=<launcher state dir> SEQDESK_LOCAL_ANALYSIS_COLLABORATION_PORT=<port> \
 *   DATABASE_URL=... node --import tsx scripts/flow-timecourse-seed.ts [--cite]
 *
 * --cite resolves labdesk://value/<currentRun>/<LRT step>/n_significant with checksum verification and runs the
 * independent verifier scripts/flow-timecourse/verify.py on the run folders.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Prisma } from '@prisma/client';
import { db } from '../src/lib/db';
import { createReport, listReports, saveReport } from '../src/lib/explore/reports';
import { createFlow, listFlows } from '../src/lib/explore/flows';
import { addStep } from '../src/lib/explore/recipe-edit';
import { loadRecipe } from '../src/lib/explore/recipe';
import { getAnalysisDetail, createRevision, parseInputBindings } from '../src/lib/explore/analyses';
import { resolveValues } from '../src/lib/explore/values';

const AUTHORITY = process.env.SEQDESK_FLOW_AUTHORITY ?? `http://127.0.0.1:${process.env.SEQDESK_LOCAL_ANALYSIS_COLLABORATION_PORT ?? '18586'}`;
const HERE = join(process.cwd(), 'scripts', 'flow-timecourse');

interface RecipeStep { key: string; name: string; file: string; purpose: string; inputs: Record<string, { table?: string; resource?: string; step?: string; output?: string }>; params: Record<string, unknown>; packages: string[] }
interface Recipe {
  study: string; flow: string; question: string;
  source: { connector: string; record: string; doi: string; license: string; title: string };
  tables: Record<string, { file: string; md5: string; roles: Record<string, string> }>;
  /** Reference tables from Data > Resources (SeqDesk's reference-resource connector), by table name. */
  resources?: Record<string, { resource: string; file: string; version: string; license: string }>;
  steps: RecipeStep[];
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

/** The table must be the connector's: from this Zenodo record, and the very file Zenodo published (MD5). */
async function connectorTable(targetKey: string, name: string, recipe: Recipe) {
  const table = recipe.tables[name]!;
  const dataset = await db.exploreDataset.findFirst({ where: { targetKey, name }, orderBy: { createdAt: 'desc' } });
  if (!dataset) return null;
  const origin = (JSON.parse(dataset.sourceConfig ?? '{}') as { origin?: { source?: string; record?: string; detail?: string; file?: { filename?: string; md5?: string; sha256?: string } } }).origin;
  if (!origin) throw new Error(`Table ${name} has no connector origin: make it from the Zenodo import (Data > Imports > Use in Analysis), not from an upload.`);
  if (origin.record !== recipe.source.record) throw new Error(`Table ${name} came from ${origin.source} ${origin.record}, not Zenodo ${recipe.source.record}.`);
  if (origin.file?.filename !== table.file || origin.file.md5 !== table.md5) throw new Error(`Table ${name}: file ${origin.file?.filename} md5 ${origin.file?.md5} is not ${table.file} md5 ${table.md5} as Zenodo published it.`);
  return { dataset, origin };
}

/** A reference table must come from Data > Resources: the pinned release of that resource, verified at install. */
async function resourceTable(targetKey: string, name: string, recipe: Recipe) {
  const spec = recipe.resources![name]!;
  const dataset = await db.exploreDataset.findFirst({ where: { targetKey, name }, orderBy: { createdAt: 'asc' } });
  if (!dataset) return null;
  const origin = (JSON.parse(dataset.sourceConfig ?? '{}') as { origin?: { kind?: string; record?: string; version?: string; licence?: string; file?: { filename?: string; sha256?: string } } }).origin;
  if (origin?.kind !== 'reference' || origin.record !== spec.resource) throw new Error(`Table ${name} is not the ${spec.resource} reference resource: install it in Data > Resources and make the table from there.`);
  if (origin.version !== spec.version) throw new Error(`Table ${name} is release ${origin.version}, the recipe pins ${spec.version}.`);
  return { dataset, origin };
}

async function seed(recipe: Recipe) {
  const { workspaceId, user } = await context();
  let project = await findProject(workspaceId, recipe.study);
  if (!project) {
    project = await db.exploreProject.create({ data: { name: recipe.study, description: `${recipe.source.title} (Zenodo ${recipe.source.record}, DOI ${recipe.source.doi}, ${recipe.source.license}). TGF-b1 arm: 0/5/10/15 ng/mL x 24/48/72 h, 4 replicates. Data comes in through Data > Find data (Zenodo connector).`, ownerId: user.id } });
    await db.integrationExploreScope.create({ data: { id: randomUUID(), authority: AUTHORITY, workspaceId, projectId: '', targetKey: `project:${project.id}`, createdBy: user.id } });
    console.log('Created study', recipe.study);
  }
  const targetKey = `project:${project.id}`;

  const tables = new Map<string, string>();
  const missing: string[] = [];
  for (const name of Object.keys(recipe.tables)) {
    const found = await connectorTable(targetKey, name, recipe);
    if (!found) { missing.push(name); continue; }
    tables.set(name, found.dataset.id);
    console.log(`Table ${name}: from ${found.origin.source} ${found.origin.record} (${found.origin.detail}), md5 ${found.origin.file?.md5}, sha256 ${found.origin.file?.sha256?.slice(0, 16)}…`);
  }
  for (const name of Object.keys(recipe.resources ?? {})) {
    const found = await resourceTable(targetKey, name, recipe);
    if (!found) { missing.push(name); continue; }
    tables.set(name, found.dataset.id);
    console.log(`Resource ${name}: ${found.origin.record} ${found.origin.version} (${found.origin.licence}), sha256 ${found.origin.file?.sha256?.slice(0, 16)}…`);
  }
  if (missing.length) {
    console.log(`Study ready; tables missing: ${missing.join(', ')}. Import ${recipe.source.doi} in Data > Find data, then Imports > Use in Analysis > "${recipe.study}" > Make table for ${missing.map(name => recipe.tables[name]!.file).join(' and ')}. Run this script again after.`);
    return;
  }

  let flow = (await listFlows(targetKey)).find(entry => entry.name === recipe.flow) ?? null;
  if (!flow) { flow = await createFlow(targetKey, user.id, recipe.flow, recipe.question); console.log('Created flow', flow.name); }

  const stepIds = new Map<string, string>();
  const existing = (await loadRecipe(flow.id))?.steps ?? [];
  for (const step of recipe.steps) {
    const code = await readFile(join(HERE, step.file), 'utf8');
    const found = existing.find(entry => entry.name === step.name);
    if (found) {
      stepIds.set(step.key, found.id);
      const detail = await getAnalysisDetail(found.id);
      // Table inputs the recipe adds to an existing step (a reference resource replacing packages) come with its code.
      const current = await db.exploreAnalysisRevision.findUnique({ where: { id: (await db.exploreAnalysis.findUnique({ where: { id: found.id }, select: { currentRevisionId: true } }))!.currentRevisionId! }, select: { inputs: true } });
      const bindings = parseInputBindings(current?.inputs);
      const added = Object.entries(step.inputs).filter(([alias, source]) => (source.table || source.resource) && !bindings.some(binding => binding.alias === alias))
        .map(([alias, source]) => ({ alias, datasetId: tables.get((source.table ?? source.resource)!)!, versionId: null }));
      if (detail && (detail.code !== code || added.length)) {
        await createRevision({ analysisId: found.id, code, ...(added.length ? { inputs: [...bindings, ...added] } : {}), author: 'user', authorUserId: user.id, message: `Code from ${step.file}${added.length ? `; reads ${added.map(input => input.alias).join(', ')} from Data` : ''}` });
        console.log('Updated', step.name, added.length ? `(inputs + ${added.map(input => input.alias).join(', ')})` : '(code)');
      }
      continue;
    }
    const inputs = Object.entries(step.inputs).map(([alias, source]) => source.table || source.resource
      ? { alias, datasetId: tables.get((source.table ?? source.resource)!)! }
      : { alias, from: { stepId: stepIds.get(source.step!)!, output: source.output! } });
    const previous = [...stepIds.values()].at(-1) ?? null;
    const id = await addStep(flow.id, { after: previous, name: step.name, purpose: step.purpose, code, language: 'r', inputs, params: step.params, actor: { userId: user.id } });
    stepIds.set(step.key, id);
    console.log('Added step', step.name);
  }
  // Per-step conda packages (ExploreAnalysis.packages): the GO step adds org.Hs.eg.db and GO.db to its base.
  for (const step of recipe.steps) {
    const id = stepIds.get(step.key)!;
    if (!step.packages.length) {
      // A step that no longer needs its own packages (the GO step reads a reference table now) drops them.
      const had = await db.exploreAnalysis.findUnique({ where: { id }, select: { packages: true } }) as { packages?: unknown } | null;
      if (had?.packages) { await db.exploreAnalysis.update({ where: { id }, data: { packages: Prisma.DbNull } } as never); console.log('Cleared packages of', step.name); }
      continue;
    }
    await db.exploreAnalysis.update({ where: { id }, data: { packages: { packages: step.packages, channels: [] } } as never });
    console.log('Set packages of', step.name, step.packages.join(' '));
  }

  const id = (key: string) => stepIds.get(key)!;
  const title = 'TGF-b1: time-dependent dose response';
  let report = (await listReports(targetKey)).find(entry => entry.title === title);
  if (!report) { report = await createReport(targetKey, user.id, title); console.log('Created report'); }
  await saveReport(report.id, {
    title,
    blocks: [
      { id: 'text:intro', type: 'text', span: 2, markdown: `## TGF-b1 dose x time in MRC-5 lung fibroblasts\n\nData imported through the Zenodo connector from record ${recipe.source.record} (DOI ${recipe.source.doi}, ${recipe.source.license}): 0, 5, 10 and 15 ng/mL TGF-b1 for 24, 48 and 72 h, four replicates each. DESeq2 tests \`~ dose + time + dose:time\` against \`~ dose + time\` (likelihood-ratio test), so a significant gene is one whose dose response changes over time. The record holds size-factor-normalised counts; they are rounded and size factors are fixed at 1.` },
      { id: `run-metric:${id('qc')}`, type: 'run-metric', analysisId: id('qc'), metrics: ['n_samples_kept', 'n_genes_kept'], labels: { n_samples_kept: 'Samples kept', n_genes_kept: 'Genes kept' }, digits: { n_samples_kept: 0, n_genes_kept: 0 }, span: 1 },
      { id: `run-metric:${id('lrt')}`, type: 'run-metric', analysisId: id('lrt'), metrics: ['n_tested', 'n_significant'], labels: { n_tested: 'Genes tested', n_significant: 'Time-dependent dose response (padj < 0.01)' }, digits: { n_tested: 0, n_significant: 0 }, span: 1 },
      { id: `figure:${id('pca')}:pca`, type: 'figure', analysisId: id('pca'), figureName: 'pca', caption: 'PCA of VST values: dose (shade) and time (shape).' },
      { id: `figure:${id('lrt')}:pvalue_histogram`, type: 'figure', analysisId: id('lrt'), figureName: 'pvalue_histogram', caption: 'LRT p-values: the spike near 0 is the interaction signal.' },
      { id: `figure:${id('patterns')}:pattern_profiles`, type: 'figure', analysisId: id('patterns'), figureName: 'pattern_profiles', caption: 'Mean z-score per pattern over time, one line per dose.', span: 2 },
      { id: `run-metric:${id('go')}`, type: 'run-metric', analysisId: id('go'), metrics: ['n_sets_tested', 'n_enriched_terms', 'n_patterns_with_terms'], labels: { n_sets_tested: 'GO BP sets tested', n_enriched_terms: 'Enriched terms (padj < 0.05)', n_patterns_with_terms: 'Patterns with terms' }, digits: { n_sets_tested: 0, n_enriched_terms: 0, n_patterns_with_terms: 0 }, span: 2 },
      { id: `figure:${id('go')}:go_dotplot`, type: 'figure', analysisId: id('go'), figureName: 'go_dotplot', caption: 'Top GO Biological Process terms per pattern (fgsea::fora; GO BP gene sets from the go-bp-human reference resource, Bioconductor 3.22).' },
      { id: `figure:${id('heatmap')}:pattern_heatmap`, type: 'figure', analysisId: id('heatmap'), figureName: 'pattern_heatmap', caption: 'Pattern genes, row z-score of the dose x time mean VST.' },
      { id: `finding:${id('lrt')}`, type: 'finding', analysisId: id('lrt'), span: 2, caption: 'What the LRT step found' },
    ],
    filters: [],
  });
  console.log(`Ready: study "${recipe.study}", flow "${flow.name}" (${recipe.steps.length} R steps), report "${title}". Press Run all on the canvas, then run this script with --cite.`);
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
  if (!flow || !record?.currentRunId) throw new Error('The flow has no current run yet: press Run all and wait for it to finish.');
  const steps = (await loadRecipe(flow.id))!.steps;
  const idOf = (key: string) => steps.find(step => step.name === recipe.steps.find(entry => entry.key === key)!.name)!.id;
  const ref = `labdesk://value/${record.currentRunId}/${idOf('lrt')}/n_significant`;
  const resolved = await resolveValues([ref], async () => true, { verify: true });
  console.log(JSON.stringify(resolved, null, 2));
  const value = JSON.stringify(resolved).match(/"value":\s*(\d+)/)?.[1];
  if (!value) throw new Error('The citation did not resolve to a number.');
  const folders = Object.fromEntries(await Promise.all(recipe.steps.map(async step => [step.key, await runFolder(record.currentRunId!, idOf(step.key))] as const)));
  console.log(`Citation ${ref} = ${value}`);
  const args = [join(HERE, 'verify.py'), '--cite', `n_significant=${value}`, ...Object.entries(folders).flatMap(([key, folder]) => [`--${key}`, folder])];
  const check = spawnSync('python3', args, { stdio: 'inherit' });
  process.exitCode = check.status ?? 1;
}

async function main() {
  const recipe = JSON.parse(await readFile(join(HERE, 'recipe.json'), 'utf8')) as Recipe;
  if (process.argv.includes('--cite')) await cite(recipe); else await seed(recipe);
}

main().catch(error => { console.error(error); process.exit(1); }).finally(() => db.$disconnect());
