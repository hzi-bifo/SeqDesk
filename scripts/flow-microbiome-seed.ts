/**
 * Seed a real 16S microbiome Flow study: the QIIME 2 "Moving Pictures"
 * tutorial feature table (Caporaso et al. 2011, Genome Biology 12:R50), gut vs
 * tongue. Imports the counts, the sample sheet and the taxonomy as tables,
 * adds the four Python steps of scripts/flow-microbiome/recipe.json (code from
 * scripts/flow-microbiome/steps, scikit-bio in the base seqdesk-explore-python
 * environment) chained through their output tables, and a report whose key
 * figures are the diversity statistics. Idempotent per collaboration
 * workspace. Modelled on flow-rnaseq-seed.ts; run with the same environment as
 * the Compute process:
 *
 *   SEQDESK_LOCAL_ANALYSIS_DIR=<launcher state dir> \
 *   SEQDESK_LOCAL_ANALYSIS_COLLABORATION_PORT=<collaboration port> \
 *   SEQDESK_MICROBIOME_DATA=/Users/pmu15/testdata/explore/microbiome-moving-pictures \
 *   node --import tsx scripts/flow-microbiome-seed.ts
 *
 * After a completed flow run (Run recipe on the canvas), check the cited value:
 *
 *   ... node --import tsx scripts/flow-microbiome-seed.ts --cite
 *
 * which resolves labdesk://value/<currentRun>/<beta step>/pseudo_f through the
 * same code the Writer uses (with checksum verification) and runs the
 * independent verifier scripts/flow-microbiome/verify.py on the QC, alpha and
 * beta run folders with the resolved value as the report citation.
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
const HERE = join(process.cwd(), 'scripts', 'flow-microbiome');

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
  const dataDir = process.env.SEQDESK_MICROBIOME_DATA;
  if (!dataDir) throw new Error('Set SEQDESK_MICROBIOME_DATA to the folder with the moving_pictures_*.csv tables.');
  const { workspaceId, user, session } = await context();

  let project = await findProject(workspaceId, recipe.study);
  if (!project) {
    project = await db.exploreProject.create({ data: { name: recipe.study, description: 'QIIME 2 Moving Pictures tutorial (Caporaso et al. 2011, Genome Biology 12:R50): 16S rRNA V4 feature table of 34 samples from two people, four body sites, 2008-2009. Real counts; gut vs tongue.', ownerId: user.id } });
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
    const id = await addStep(flow.id, { after: previous, name: step.name, purpose: step.purpose, code, language: 'python', inputs, params: step.params, actor: { userId: user.id } });
    stepIds.set(step.key, id);
    console.log('Added step', step.name);
  }
  // Per-step extra conda packages (ExploreAnalysis.packages, migration 20260927120000_step_environments).
  // The Moving Pictures recipe needs none beyond seqdesk-explore-python; written only when a step lists some.
  for (const step of recipe.steps) {
    if (!step.packages.length) continue;
    await db.exploreAnalysis.update({ where: { id: stepIds.get(step.key)! }, data: { packages: { packages: step.packages, channels: [] } } as never });
    console.log('Set packages of', step.name, step.packages.join(' '));
  }

  const qc = stepIds.get('qc')!, alpha = stepIds.get('alpha')!, beta = stepIds.get('beta')!, taxa = stepIds.get('taxa')!;
  const title = 'Moving Pictures: gut vs tongue';
  const reports = await listReports(targetKey);
  let report = reports.find(entry => entry.title === title);
  if (!report) { report = await createReport(targetKey, user.id, title); console.log('Created report'); }
  await saveReport(report.id, {
    title,
    blocks: [
      { id: 'text:intro', type: 'text', span: 2, markdown: '## Gut and tongue microbiota\n\nReal 16S rRNA (V4) counts from the QIIME 2 *Moving Pictures* tutorial (Caporaso et al. 2011, Genome Biology 12:R50): two people sampled at four body sites. Samples below 1,103 reads are left out and the rest rarefied to 1,103 reads (seed 42); Bray-Curtis PERMANOVA uses 999 permutations (seed 42).' },
      { id: `run-metric:${qc}`, type: 'run-metric', analysisId: qc, metrics: ['n_samples_kept', 'n_features_kept'], labels: { n_samples_kept: 'Samples kept (gut, tongue; >= 1,103 reads)', n_features_kept: 'Features after rarefaction' }, digits: { n_samples_kept: 0, n_features_kept: 0 }, span: 2 },
      { id: `run-metric:${alpha}`, type: 'run-metric', analysisId: alpha, metrics: ['median_shannon_gut', 'median_shannon_tongue', 'p_shannon', 'median_observed_features_gut', 'median_observed_features_tongue', 'p_observed_features'], labels: { median_shannon_gut: 'Median Shannon, gut', median_shannon_tongue: 'Median Shannon, tongue', p_shannon: 'Shannon, Mann-Whitney p', median_observed_features_gut: 'Median observed features, gut', median_observed_features_tongue: 'Median observed features, tongue', p_observed_features: 'Observed features, Mann-Whitney p' }, digits: { median_shannon_gut: 2, median_shannon_tongue: 2, p_shannon: 4, median_observed_features_gut: 1, median_observed_features_tongue: 1, p_observed_features: 4 }, span: 2 },
      { id: `run-metric:${beta}`, type: 'run-metric', analysisId: beta, metrics: ['pseudo_f', 'p_permanova', 'permutations', 'pc1_explained', 'pc2_explained'], labels: { pseudo_f: 'PERMANOVA pseudo-F (body site)', p_permanova: 'PERMANOVA p-value', permutations: 'Permutations', pc1_explained: 'PC1 variance explained (%)', pc2_explained: 'PC2 variance explained (%)' }, digits: { pseudo_f: 2, p_permanova: 3, permutations: 0, pc1_explained: 1, pc2_explained: 1 }, span: 2 },
      { id: `figure:${qc}:read_depth`, type: 'figure', analysisId: qc, figureName: 'read_depth', caption: 'Reads per sample; dashed line is min_depth, red samples are left out.' },
      { id: `figure:${alpha}:alpha_by_group`, type: 'figure', analysisId: alpha, figureName: 'alpha_by_group', caption: 'Shannon (log2) and observed features after rarefaction.' },
      { id: `figure:${beta}:pcoa`, type: 'figure', analysisId: beta, figureName: 'pcoa', caption: 'PCoA of Bray-Curtis distances, gut vs tongue.' },
      { id: `figure:${taxa}:top_taxa`, type: 'figure', analysisId: taxa, figureName: 'top_taxa', caption: 'Top 15 taxa by BH q-value (Mann-Whitney on relative abundance).' },
      { id: `finding:${beta}`, type: 'finding', analysisId: beta, span: 2, caption: 'What the beta-diversity step found' },
    ],
    filters: [],
  });
  console.log(`Ready: study "${recipe.study}", flow "${flow.name}" (${recipe.steps.length} Python steps), report "${report.title}". Press Run recipe on the canvas, then run this script with --cite.`);
}

async function cite(recipe: Recipe) {
  const { workspaceId } = await context();
  const project = await findProject(workspaceId, recipe.study);
  if (!project) throw new Error('Seed the study first.');
  const flow = (await listFlows(`project:${project.id}`)).find(entry => entry.name === recipe.flow);
  const record = flow ? await db.exploreFlow.findUnique({ where: { id: flow.id }, select: { currentRunId: true } }) : null;
  if (!flow || !record?.currentRunId) throw new Error('The flow has no current run yet: press Run all and wait for it to finish.');
  const steps = (await loadRecipe(flow.id))!.steps;
  const stepOf = (key: string) => steps.find(step => step.name === recipe.steps.find(entry => entry.key === key)!.name)!;
  const beta = stepOf('beta');
  const ref = `labdesk://value/${record.currentRunId}/${beta.id}/pseudo_f`;
  const resolved = await resolveValues([ref], async () => true, { verify: true });
  console.log(JSON.stringify(resolved, null, 2));
  const folder = async (key: string) => {
    const stepRun = await db.exploreAnalysisRun.findFirst({ where: { flowRunId: record.currentRunId, analysisId: stepOf(key).id }, select: { runFolder: true, reusedFromRunId: true } });
    const source = stepRun?.reusedFromRunId ? await db.exploreAnalysisRun.findUnique({ where: { id: stepRun.reusedFromRunId }, select: { runFolder: true } }) : stepRun;
    if (!source?.runFolder) throw new Error(`No run folder recorded for the ${key} step of the current run.`);
    return source.runFolder;
  };
  const value = JSON.stringify(resolved).match(/"value":\s*([0-9.]+)/)?.[1];
  if (!value) throw new Error('The citation did not resolve to a number.');
  const [qcDir, alphaDir, betaDir] = [await folder('qc'), await folder('alpha'), await folder('beta')];
  console.log(`Citation ${ref} = ${value}; run folders ${qcDir} ${alphaDir} ${betaDir}`);
  const check = spawnSync('python3', [join(HERE, 'verify.py'), '--qc', qcDir, '--alpha', alphaDir, '--beta', betaDir, '--cite', `pseudo_f=${value}`], { stdio: 'inherit' });
  process.exitCode = check.status ?? 1;
}

async function main() {
  const recipe = JSON.parse(await readFile(join(HERE, 'recipe.json'), 'utf8')) as Recipe;
  if (process.argv.includes('--cite')) await cite(recipe); else await seed(recipe);
}

main().catch(error => { console.error(error); process.exit(1); }).finally(() => db.$disconnect());
