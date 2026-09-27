/**
 * Seed a real RNA-seq Flow study: Bioconductor airway (GEO GSE52778; Himes et
 * al. 2014), dexamethasone vs untreated in four airway smooth muscle cell
 * lines. Imports the counts and the sample sheet as tables, adds the four R
 * steps of scripts/flow-rnaseq/recipe.json (code from scripts/flow-rnaseq/steps)
 * chained through their output tables, and a report whose key figures are the
 * DE counts. Idempotent per collaboration workspace. Modelled on
 * flow-example-seed.ts; run with the same environment as the Compute process:
 *
 *   SEQDESK_LOCAL_ANALYSIS_DIR=<launcher state dir> \
 *   SEQDESK_RNASEQ_DATA=/Users/pmu15/testdata/explore/rnaseq-GSE52778 \
 *   node --import tsx scripts/flow-rnaseq-seed.ts
 *
 * After a completed flow run (Run all on the canvas), check the cited value:
 *
 *   ... node --import tsx scripts/flow-rnaseq-seed.ts --cite
 *
 * which resolves labdesk://value/<currentRun>/<DESeq2 step>/n_de through the
 * same code the Writer uses (with checksum verification) and runs the
 * independent verifier scripts/flow-rnaseq/verify.py on that step's run folder
 * with the resolved value as the report citation.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { db } from '../src/lib/db';
import { storeLibraryFile } from '../src/lib/files/library';
import { importDatasetFromForm } from '../src/lib/explore/dataset-import';
import { createReport, listReports, saveReport } from '../src/lib/explore/reports';
import { createFlow, listFlows } from '../src/lib/explore/flows';
import { addStep } from '../src/lib/explore/recipe-edit';
import { loadRecipe } from '../src/lib/explore/recipe';
import { getAnalysisDetail, createRevision } from '../src/lib/explore/analyses';
import { resolveValues } from '../src/lib/explore/values';

const AUTHORITY = process.env.SEQDESK_FLOW_AUTHORITY ?? `http://127.0.0.1:${process.env.SEQDESK_LOCAL_ANALYSIS_COLLABORATION_PORT ?? '18586'}`;
const HERE = join(process.cwd(), 'scripts', 'flow-rnaseq');

interface RecipeStep { key: string; name: string; file: string; purpose: string; inputs: Record<string, { table?: string; step?: string; output?: string }>; params: Record<string, unknown>; packages: string[] }
interface Recipe { study: string; flow: string; question: string; tables: Record<string, { file: string; sha256: string; roles: Record<string, string> }>; steps: RecipeStep[] }

async function context() {
  const dir = process.env.SEQDESK_LOCAL_ANALYSIS_DIR;
  if (!dir) throw new Error('Set SEQDESK_LOCAL_ANALYSIS_DIR to the launcher state directory.');
  const collaboration = JSON.parse(await readFile(join(dir, 'collaboration.json'), 'utf8')) as { workspaceId: string };
  const compute = JSON.parse(await readFile(join(dir, 'compute.json'), 'utf8')) as { accounts: { userId: string }[] };
  const userId = compute.accounts[0]?.userId;
  if (!userId) throw new Error('compute.json has no account mapping.');
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('The mapped SeqDesk user does not exist.');
  const session = { user: { id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email, role: user.role, systemRole: user.systemRole, facilityWorkflowRole: user.facilityWorkflowRole, isDemo: false, authorizationValid: true } };
  return { workspaceId: collaboration.workspaceId, user, session };
}

async function findProject(workspaceId: string, name: string) {
  const links = await db.integrationExploreScope.findMany({ where: { authority: AUTHORITY, workspaceId, projectId: '' } });
  return (await db.exploreProject.findMany({ where: { id: { in: links.map(link => link.targetKey.replace(/^project:/, '')) }, name } }))[0] ?? null;
}

async function seed(recipe: Recipe) {
  const dataDir = process.env.SEQDESK_RNASEQ_DATA;
  if (!dataDir) throw new Error('Set SEQDESK_RNASEQ_DATA to the folder with airway_counts.csv and airway_samples.csv.');
  const { workspaceId, user, session } = await context();

  let project = await findProject(workspaceId, recipe.study);
  if (!project) {
    project = await db.exploreProject.create({ data: { name: recipe.study, description: 'Bioconductor airway 1.32.0 (GEO GSE52778, Himes et al. 2014, PLoS ONE 9:e99625): 8 samples, 4 airway smooth muscle cell lines, dexamethasone vs untreated. Real counts.', ownerId: user.id } });
    await db.integrationExploreScope.create({ data: { id: randomUUID(), authority: AUTHORITY, workspaceId, projectId: '', targetKey: `project:${project.id}`, createdBy: user.id } });
    console.log('Created study', recipe.study);
  }
  const targetKey = `project:${project.id}`;

  const tables = new Map<string, string>();
  for (const [name, table] of Object.entries(recipe.tables)) {
    let dataset = await db.exploreDataset.findFirst({ where: { targetKey, name } });
    if (!dataset) {
      const bytes = await readFile(join(dataDir, table.file));
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== table.sha256) throw new Error(`${table.file}: sha256 ${digest} does not match recipe.json (${table.sha256})`);
      const stored = await storeLibraryFile({ targetKey, file: new File([bytes], table.file, { type: 'text/csv' }), createdById: user.id });
      const form = new FormData();
      form.set('targetKey', targetKey);
      form.set('fileId', stored.id);
      form.set('name', name);
      form.set('roles', JSON.stringify(table.roles));
      const result = await importDatasetFromForm(session as never, form, false);
      const created = result.body.dataset as { id: string } | null;
      if (!created) throw new Error(`Import of ${table.file} returned no dataset: ${JSON.stringify(result.body)}`);
      dataset = await db.exploreDataset.findUniqueOrThrow({ where: { id: created.id } });
      console.log(`Imported table ${name} from ${table.file}`);
    }
    tables.set(name, dataset.id);
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
      if (detail && detail.code !== code) { await createRevision({ analysisId: found.id, code, author: 'user', authorUserId: user.id, message: `Code from ${step.file}` }); console.log('Updated the code of', step.name); }
      continue;
    }
    const inputs = Object.entries(step.inputs).map(([alias, source]) => source.table
      ? { alias, datasetId: tables.get(source.table)! }
      : { alias, from: { stepId: stepIds.get(source.step!)!, output: source.output! } });
    const previous = [...stepIds.values()].at(-1) ?? null;
    const id = await addStep(flow.id, { after: previous, name: step.name, purpose: step.purpose, code, language: 'r', inputs, params: step.params, actor: { userId: user.id } });
    stepIds.set(step.key, id);
    console.log('Added step', step.name);
  }
  // Per-step extra conda packages (ExploreAnalysis.packages, migration 20260927120000_step_environments).
  // The airway recipe needs none beyond seqdesk-explore-r; written only when a step lists some.
  for (const step of recipe.steps) {
    if (!step.packages.length) continue;
    await db.exploreAnalysis.update({ where: { id: stepIds.get(step.key)! }, data: { packages: { packages: step.packages, channels: [] } } as never });
    console.log('Set packages of', step.name, step.packages.join(' '));
  }

  const qc = stepIds.get('qc')!, pca = stepIds.get('pca')!, de = stepIds.get('de')!, top = stepIds.get('top')!;
  const reports = await listReports(targetKey);
  let report = reports.find(entry => entry.title === 'Airway: dexamethasone response');
  if (!report) { report = await createReport(targetKey, user.id, 'Airway: dexamethasone response'); console.log('Created report'); }
  await saveReport(report.id, {
    title: 'Airway: dexamethasone response',
    blocks: [
      { id: 'text:intro', type: 'text', span: 2, markdown: '## Dexamethasone in airway smooth muscle cells\n\nReal RNA-seq counts from Bioconductor *airway* 1.32.0 (GEO GSE52778; Himes et al. 2014, PLoS ONE 9:e99625): four cell lines, each untreated and treated with 1 µM dexamethasone for 18 h. DESeq2 models `~ cell + dex`, so the contrast is paired by cell line.' },
      { id: `run-metric:${de}`, type: 'run-metric', analysisId: de, metrics: ['n_tested', 'n_de', 'n_up', 'n_down'], labels: { n_tested: 'Genes tested (padj defined)', n_de: 'DE genes (padj < 0.05, |log2FC| ≥ 1)', n_up: 'Up with dexamethasone', n_down: 'Down with dexamethasone' }, digits: { n_tested: 0, n_de: 0, n_up: 0, n_down: 0 }, span: 2 },
      { id: `figure:${qc}:library_sizes`, type: 'figure', analysisId: qc, figureName: 'library_sizes', caption: 'Library size per sample; dashed line is the QC threshold.' },
      { id: `figure:${pca}:pca`, type: 'figure', analysisId: pca, figureName: 'pca', caption: 'PCA of VST counts: treatment and cell line.' },
      { id: `figure:${de}:volcano`, type: 'figure', analysisId: de, figureName: 'volcano', caption: 'DESeq2 trt vs untrt; dashed lines are the padj and |log2FC| cutoffs.' },
      { id: `figure:${top}:top_genes_heatmap`, type: 'figure', analysisId: top, figureName: 'top_genes_heatmap', caption: 'Top 30 DE genes, row-scaled VST.' },
      { id: `finding:${de}`, type: 'finding', analysisId: de, span: 2, caption: 'What the DESeq2 step found' },
    ],
    filters: [],
  });
  console.log(`Ready: study "${recipe.study}", flow "${flow.name}" (${recipe.steps.length} R steps), report "${report.title}". Press Run all on the canvas, then run this script with --cite.`);
}

async function cite(recipe: Recipe) {
  const { workspaceId } = await context();
  const project = await findProject(workspaceId, recipe.study);
  if (!project) throw new Error('Seed the study first.');
  const flow = (await listFlows(`project:${project.id}`)).find(entry => entry.name === recipe.flow);
  const record = flow ? await db.exploreFlow.findUnique({ where: { id: flow.id }, select: { currentRunId: true } }) : null;
  if (!flow || !record?.currentRunId) throw new Error('The flow has no current run yet: press Run all and wait for it to finish.');
  const de = (await loadRecipe(flow.id))!.steps.find(step => step.name === recipe.steps.find(entry => entry.key === 'de')!.name)!;
  const ref = `labdesk://value/${record.currentRunId}/${de.id}/n_de`;
  const resolved = await resolveValues([ref], async () => true, { verify: true });
  console.log(JSON.stringify(resolved, null, 2));
  const stepRun = await db.exploreAnalysisRun.findFirst({ where: { flowRunId: record.currentRunId, analysisId: de.id }, select: { runFolder: true, reusedFromRunId: true } });
  const source = stepRun?.reusedFromRunId ? await db.exploreAnalysisRun.findUnique({ where: { id: stepRun.reusedFromRunId }, select: { runFolder: true } }) : stepRun;
  if (!source?.runFolder) throw new Error('No run folder recorded for the DESeq2 step of the current run.');
  const value = JSON.stringify(resolved).match(/"value":\s*(\d+)/)?.[1];
  if (!value) throw new Error('The citation did not resolve to a number.');
  console.log(`Citation ${ref} = ${value}; run folder ${source.runFolder}`);
  const check = spawnSync('python3', [join(HERE, 'verify.py'), '--run-dir', source.runFolder, '--cite', `n_de=${value}`], { stdio: 'inherit' });
  process.exitCode = check.status ?? 1;
}

async function main() {
  const recipe = JSON.parse(await readFile(join(HERE, 'recipe.json'), 'utf8')) as Recipe;
  if (process.argv.includes('--cite')) await cite(recipe); else await seed(recipe);
}

main().catch(error => { console.error(error); process.exit(1); }).finally(() => db.$disconnect());
