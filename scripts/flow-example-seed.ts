/**
 * Seed an example Flow study on the local Compute: a growth-assay table, a
 * kit step, a custom Python step that draws several Plotly figures, and a
 * report that shows them. Idempotent per collaboration workspace. Run it with
 * the same environment as the local Analysis launcher's Compute process:
 *
 *   node --import tsx scripts/flow-example-seed.ts
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { storeLibraryFile } from '../src/lib/files/library';
import { importDatasetFromForm } from '../src/lib/explore/dataset-import';
import { createReport, listReports, saveReport } from '../src/lib/explore/reports';
import { createAnalysis, listAnalyses } from '../src/lib/explore/analyses';
import { createFlow, listFlows, updateFlow } from '../src/lib/explore/flows';

const STUDY_NAME = 'Example: growth assay';
const AUTHORITY = 'http://127.0.0.1:18586';

function csv(): string {
  // Deterministic pseudo-random data so the example looks the same on every machine.
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const groups = ['control', 'low_dose', 'high_dose'];
  const days = ['day0', 'day7', 'day14'];
  const organisms = ['Escherichia coli', 'Bacillus subtilis', 'Pseudomonas putida'];
  const rows = ['sample,group,timepoint,organism,concentration,od600,reads,quality'];
  let index = 1;
  for (const group of groups) for (const day of days) for (let replicate = 0; replicate < 6; replicate++) {
    const dose = group === 'control' ? 0 : group === 'low_dose' ? 0.5 : 2.0;
    const time = days.indexOf(day);
    const growth = 0.2 + 0.35 * time * (1 - 0.32 * dose) + (random() - 0.5) * 0.12;
    const reads = Math.round(9000 + 4000 * random() + 1500 * time);
    const quality = Math.round((31 + 4 * random() - 1.2 * dose) * 10) / 10;
    const concentration = Math.round((dose + (random() - 0.5) * 0.2 * (dose || 0.4)) * 100) / 100;
    rows.push(`S${String(index++).padStart(2, '0')},${group},${day},${organisms[replicate % 3]},${Math.max(0, concentration)},${growth.toFixed(3)},${reads},${quality}`);
  }
  return rows.join('\n') + '\n';
}

const FIGURES_CODE = `"""Example figures for the growth assay.

Reads the example table and saves four Plotly figures, a summary table and a
few metrics so the report and the canvas have something to show.
"""
import pandas as pd
import plotly.express as px
from seqdesk_explore import load_dataset, save_figure, save_table, save_report_markdown, metric, note, finish

df = load_dataset("table")
df["timepoint"] = pd.Categorical(df["timepoint"], ["day0", "day7", "day14"], ordered=True)
df["group"] = pd.Categorical(df["group"], ["control", "low_dose", "high_dose"], ordered=True)

by_group = df.groupby(["group", "timepoint"], observed=True)["od600"].mean().reset_index()
fig = px.bar(by_group, x="timepoint", y="od600", color="group", barmode="group", title="Mean growth (OD600) by group and time point")
save_figure(fig, "growth_by_group", title="Mean growth by group and time point")

fig = px.scatter(df, x="concentration", y="od600", color="group", symbol="organism", title="Dose response: concentration against growth")
save_figure(fig, "dose_response", title="Dose response")

fig = px.box(df, x="timepoint", y="od600", color="group", title="Growth spread per time point")
save_figure(fig, "growth_spread", title="Growth spread per time point")

fig = px.line(by_group, x="timepoint", y="od600", color="group", markers=True, title="Growth over time")
save_figure(fig, "growth_over_time", title="Growth over time")

summary = df.groupby("group", observed=True).agg(samples=("sample", "count"), mean_od600=("od600", "mean"), mean_reads=("reads", "mean"), mean_quality=("quality", "mean")).reset_index()
save_table(summary, "group_summary", title="Summary per group")

metric("samples", int(len(df)))
metric("mean_od600", round(float(df["od600"].mean()), 3))
metric("max_od600", round(float(df["od600"].max()), 3))

# What the step found, in words: notes are short lines, a report text is a Markdown page.
final = df[df["timepoint"] == "day14"].groupby("group", observed=True)["od600"].mean()
slowdown = 100 * (1 - final["high_dose"] / final["control"])
note(f"At day 14 the high dose group grew {slowdown:.0f}% less than the control group.")
note(f"{len(df)} samples over {df['organism'].nunique()} organisms were measured.")
save_report_markdown(
    "## Dose response\\n\\n"
    f"Growth at day 14 was **{final['control']:.2f}** (control), **{final['low_dose']:.2f}** (low dose) and **{final['high_dose']:.2f}** (high dose) OD600. "
    f"The high dose slowed growth by about {slowdown:.0f}% relative to the control.\\n\\n"
    "Replicates agree within their groups; see the box plot for the spread per time point.",
    "dose_response_summary", title="Dose response summary")
finish()
`;

async function main() {
  const dir = process.env.SEQDESK_LOCAL_ANALYSIS_DIR;
  if (!dir) throw new Error('Set SEQDESK_LOCAL_ANALYSIS_DIR to the launcher state directory.');
  const collaboration = JSON.parse(await readFile(join(dir, 'collaboration.json'), 'utf8')) as { workspaceId: string };
  const compute = JSON.parse(await readFile(join(dir, 'compute.json'), 'utf8')) as { accounts: { userId: string }[] };
  const userId = compute.accounts[0]?.userId;
  if (!userId) throw new Error('compute.json has no account mapping.');
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('The mapped SeqDesk user does not exist.');
  const session = { user: { id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email, role: user.role, systemRole: user.systemRole, facilityWorkflowRole: user.facilityWorkflowRole, isDemo: false, authorizationValid: true } };

  const links = await db.integrationExploreScope.findMany({ where: { authority: AUTHORITY, workspaceId: collaboration.workspaceId, projectId: '' } });
  const projects = await db.exploreProject.findMany({ where: { id: { in: links.map(link => link.targetKey.replace(/^project:/, '')) }, name: STUDY_NAME } });
  let project = projects[0];
  if (!project) {
    project = await db.exploreProject.create({ data: { name: STUDY_NAME, description: 'A synthetic growth assay: three dose groups, three time points, six replicates each. Made to try Flow out.', ownerId: user.id } });
    await db.integrationExploreScope.create({ data: { id: randomUUID(), authority: AUTHORITY, workspaceId: collaboration.workspaceId, projectId: '', targetKey: `project:${project.id}`, createdBy: user.id } });
    console.log('Created study', STUDY_NAME);
  }
  const targetKey = `project:${project.id}`;

  let dataset = await db.exploreDataset.findFirst({ where: { targetKey, name: 'growth-assay' } });
  if (!dataset) {
    const stored = await storeLibraryFile({ targetKey, file: new File([csv()], 'growth-assay.csv', { type: 'text/csv' }), createdById: user.id });
    const form = new FormData();
    form.set('targetKey', targetKey);
    form.set('fileId', stored.id);
    form.set('name', 'growth-assay');
    form.set('roles', JSON.stringify({ sample: 'sample', group: 'group', value: 'od600', timepoint: 'timepoint' }));
    const result = await importDatasetFromForm(session as never, form, false);
    const created = result.body.dataset as { id: string } | null;
    if (!created) throw new Error('Import returned no dataset');
    dataset = await db.exploreDataset.findUniqueOrThrow({ where: { id: created.id } });
    console.log('Imported table growth-assay from growth-assay.csv');
  }

  const reports = await listReports(targetKey);
  let report = reports.find(entry => entry.title === 'Example report') ?? reports[0];
  if (!report) { report = await createReport(targetKey, user.id, 'Example report'); console.log('Created report'); }

  // One flow explores the growth assay; the report cites what it produced.
  const flows = await listFlows(targetKey);
  const FLOW_DESCRIPTION = 'Does the dose slow growth, and how do the replicates spread?';
  let exampleFlow = flows.find(entry => entry.name === 'Growth assay') ?? null;
  const migrated = flows.find(entry => entry.id === report.id);
  if (!exampleFlow && migrated) { exampleFlow = await updateFlow(migrated.id, { name: 'Growth assay', description: FLOW_DESCRIPTION }); console.log('Renamed the migrated flow to', exampleFlow.name); }
  if (!exampleFlow) { exampleFlow = await createFlow(targetKey, user.id, 'Growth assay', FLOW_DESCRIPTION); console.log('Created flow', exampleFlow.name); }

  const analyses = await listAnalyses(targetKey, null, exampleFlow.id);
  let summary = analyses.find(entry => entry.kitId === 'table-summary');
  if (!summary) {
    summary = await createAnalysis({ targetKey, flowId: exampleFlow.id, kitId: 'table-summary', language: 'python', inputs: [{ alias: 'table', datasetId: dataset.id, versionId: null }], params: { max_columns: 4 }, createdById: user.id });
    console.log('Created kit step', summary.name);
  }
  let figures = analyses.find(entry => entry.name === 'Example figures');
  if (figures) {
    // Keep the example's code current so a rerun records the finding as well.
    const { getAnalysisDetail, createRevision } = await import('../src/lib/explore/analyses');
    const detail = await getAnalysisDetail(figures.id);
    if (detail && detail.code !== FIGURES_CODE) { await createRevision({ analysisId: figures.id, code: FIGURES_CODE, author: 'user', authorUserId: user.id, message: 'Example figures with a written finding' }); console.log('Updated the code of', figures.name); }
  }
  if (!figures) {
    figures = await createAnalysis({ targetKey, flowId: exampleFlow.id, name: 'Example figures', description: 'Four Plotly figures, a per-group summary and a written finding from the growth assay.', language: 'python', inputs: [{ alias: 'table', datasetId: dataset.id, versionId: null }], createdById: user.id });
    const { createRevision } = await import('../src/lib/explore/analyses');
    await createRevision({ analysisId: figures.id, code: FIGURES_CODE, author: 'user', authorUserId: user.id, message: 'Example figures' });
    console.log('Created script step', figures.name);
  }

  await saveReport(report.id, {
    title: 'Example report',
    blocks: [
      { id: 'text:intro', type: 'text', span: 2, markdown: '## Growth assay\n\nA synthetic experiment: **three dose groups** (control, low dose, high dose) measured at **three time points** with six replicates each. Growth is the optical density at 600 nm. Everything on this page comes from the *growth-assay* table and the two analysis steps on the Flow canvas.' },
      { id: 'metric:od600', type: 'metric', datasetId: dataset.id, column: 'od600', stats: ['count', 'mean', 'max'], label: 'Growth (OD600)' },
      { id: 'chart:reads', type: 'chart', datasetId: dataset.id, chart: 'box', x: 'group', y: 'reads', caption: 'Sequencing depth per dose group.' },
      { id: `figure:${figures.id}:growth_by_group`, type: 'figure', analysisId: figures.id, figureName: 'growth_by_group', caption: 'Mean growth by group and time point.' },
      { id: `figure:${figures.id}:dose_response`, type: 'figure', analysisId: figures.id, figureName: 'dose_response', caption: 'Higher concentrations slow growth.' },
      { id: `figure:${figures.id}:growth_over_time`, type: 'figure', analysisId: figures.id, figureName: 'growth_over_time', span: 2, caption: 'Growth over time per group.' },
      { id: `finding:${figures.id}:dose_response_summary`, type: 'finding', analysisId: figures.id, name: 'dose_response_summary', span: 2, caption: 'What the figures step found' },
      { id: `figure:${summary.id}:distributions`, type: 'figure', analysisId: summary.id, figureName: 'distributions', span: 2, caption: 'Distributions of the numeric columns, from the Table summary kit.' },
      { id: `table:${dataset.id}`, type: 'table', datasetId: dataset.id, rows: 8, columns: ['sample', 'group', 'timepoint', 'od600', 'reads'], span: 2, caption: 'The first rows of the input table.' },
      { id: 'text:outro', type: 'text', span: 2, markdown: 'Run the two steps on the **Flow** canvas (Run all) to refresh every figure above. Figures show up here and on the canvas as soon as a run finishes.' },
    ],
    filters: [],
  });
  console.log(`Ready: study "${STUDY_NAME}" with flow "${exampleFlow.name}" (steps "${summary.name}" and "${figures.name}"), table ${dataset.name} and report "${report.title}". Press Run all on the flow's canvas.`);
}

main().catch(error => { console.error(error); process.exit(1); }).finally(() => db.$disconnect());
