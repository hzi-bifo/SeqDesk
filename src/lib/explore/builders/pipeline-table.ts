import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { getPackage, type PackageOutputTable } from "@/lib/pipelines/package-loader";
import { getTableKind, suggestRoles } from "../dataset-kinds";
import { parseDelimited } from "../parsers/delimited";
import { inferSchema } from "../schema";
import type { ExploreProvenanceSource, ExploreRole, ExploreRoleMap, ExploreRowData } from "../types";
import { knownPipelineTable } from "../pipeline-tables";
import { ExploreBuildInputError, type BuildContext, type BuiltDataset } from "./types";
import { COHORT_LABELS, cohortColumns, cohortMembershipSelection, exploreSampleWhere } from "../sample-scope";
import { resolveContainedPath } from "../storage";

const MAX_TABLE_FILE_BYTES = 200 * 1024 * 1024;

export interface PipelineTableOptions {
  pipelineId: string;
  outputId: string;
  /** Restrict to these runs; otherwise prefer the selected run, then latest results per sample. */
  runIds?: string[];
  /** Explicit table description, used when the manifest does not declare one. */
  table?: PackageOutputTable;
}

export interface PipelineTableSource {
  pipelineId: string;
  pipelineName: string;
  outputId: string;
  label: string;
  tableKind: string;
  scope: string;
  runs: Array<{ id: string; runNumber: string; completedAt: string | null; selected: boolean; artifactCount: number }>;
}

async function loadScopeSamples(context: BuildContext) {
  return db.sample.findMany({
    where: exploreSampleWhere(context),
    select: { id: true, sampleId: true, sampleAlias: true, studyId: true,
      studyMemberships: cohortMembershipSelection(context) },
    orderBy: [{ sampleId: "asc" }, { id: "asc" }],
  });
}

async function completedRunsForTarget(context: BuildContext, sampleIds: Set<string>, pipelineId?: string) {
  if (!sampleIds.size) return [];
  const targetWhere = context.target.type === "study" ? { studyId: context.target.id }
    : context.target.type === "order" ? { orderId: context.target.id } : { id: { in: [] as string[] } };
  return db.pipelineRun.findMany({
    where: { status: "completed", ...(pipelineId ? { pipelineId } : {}),
      OR: [targetWhere, { artifacts: { some: { sampleId: { in: [...sampleIds] } } } }] },
    select: {
      id: true,
      pipelineId: true,
      runNumber: true,
      completedAt: true,
      studyId: true,
      orderId: true,
      inputSampleIds: true,
      runFolder: true,
      artifacts: { select: { id: true, outputId: true, sampleId: true, path: true, checksum: true } },
    },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
  });
}

type SourceRun = Awaited<ReturnType<typeof completedRunsForTarget>>[number];

function frozenSampleIds(run: SourceRun): string[] {
  try {
    const ids: unknown = JSON.parse(run.inputSampleIds ?? "null");
    return Array.isArray(ids) && ids.length && ids.every(id => typeof id === "string" && id)
      ? [...new Set(ids as string[])] : [];
  } catch { return []; }
}

function eligibleArtifacts(run: SourceRun, context: BuildContext, sampleIds: Set<string>) {
  const sameTarget = context.target.type === "study" ? run.studyId === context.target.id
    : context.target.type === "order" && run.orderId === context.target.id;
  const frozen = frozenSampleIds(run);
  // A whole-study result can contain unlinked/foreign samples. Never infer its
  // membership from today's cohort or from the source order alone.
  const aggregateAllowed = sameTarget && frozen.length > 0 && frozen.every(id => sampleIds.has(id));
  return run.artifacts.filter(artifact => artifact.sampleId ? sampleIds.has(artifact.sampleId) : aggregateAllowed);
}

function resolveTableSpec(pipelineId: string, outputId: string, explicit?: PackageOutputTable) {
  const pkg = getPackage(pipelineId);
  const output = pkg?.manifest.outputs.find((entry) => entry.id === outputId) ?? null;
  const spec = output?.table ?? knownPipelineTable(pipelineId, outputId) ?? explicit ?? null;
  return { pkg, output, spec };
}

/** Which pipeline table outputs exist for a scope, with the completed runs that produced them. */
export async function listPipelineTableSources(context: BuildContext): Promise<PipelineTableSource[]> {
  const samples = await loadScopeSamples(context);
  const sampleIds = new Set(samples.map(sample => sample.id));
  const runs = await completedRunsForTarget(context, sampleIds);
  const selections = await db.pipelineResultSelection.findMany({
    where: { targetKey: context.targetKey },
    select: { pipelineId: true, selectedRunId: true },
  });
  const selectedByPipeline = new Map(selections.map((entry) => [entry.pipelineId, entry.selectedRunId] as const));

  const grouped = new Map<string, PipelineTableSource>();
  for (const run of runs) {
    const pkg = getPackage(run.pipelineId);
    const artifacts = eligibleArtifacts(run, context, sampleIds);
    const outputIds = new Set(artifacts.map((artifact) => artifact.outputId).filter((id): id is string => Boolean(id)));
    for (const outputId of outputIds) {
      const { output, spec } = resolveTableSpec(run.pipelineId, outputId);
      if (!spec) continue;
      const key = `${run.pipelineId}:${outputId}`;
      const entry =
        grouped.get(key) ??
        {
          pipelineId: run.pipelineId,
          pipelineName: pkg?.manifest.package.name ?? run.pipelineId,
          outputId,
          label:
            (spec as { label?: string }).label ??
            `${pkg?.manifest.package.name ?? run.pipelineId}: ${outputId}`,
          tableKind: spec.tableKind,
          scope: output?.scope ?? "sample",
          runs: [],
        };
      entry.runs.push({
        id: run.id,
        runNumber: run.runNumber,
        completedAt: run.completedAt ? run.completedAt.toISOString() : null,
        selected: selectedByPipeline.get(run.pipelineId) === run.id,
        artifactCount: artifacts.filter((artifact) => artifact.outputId === outputId).length,
      });
      grouped.set(key, entry);
    }
  }
  return [...grouped.values()];
}

/**
 * Build a dataset from the table artifacts of pipeline runs. Per-sample
 * artifacts get `sample_db_id` from the artifact's sample; scope-level tables
 * with a `sampleColumn` are matched to samples by their sample id label.
 */
export async function buildPipelineTableDataset(
  context: BuildContext,
  options: PipelineTableOptions
): Promise<BuiltDataset | null> {
  const { pkg, output, spec } = resolveTableSpec(options.pipelineId, options.outputId, options.table);
  if (!spec) {
    throw new Error(`Output ${options.outputId} of ${options.pipelineId} is not declared as a table`);
  }
  const tableKind = getTableKind(spec.tableKind);
  const warnings: string[] = [];

  const samples = await loadScopeSamples(context);
  const sampleIds = new Set(samples.map(sample => sample.id));
  const runs = await completedRunsForTarget(context, sampleIds, options.pipelineId);
  let chosen = runs;
  if (options.runIds) {
    const wanted = new Set(options.runIds);
    chosen = runs.filter((run) => wanted.has(run.id));
    if (chosen.length !== wanted.size) warnings.push("Some requested runs are not completed runs of this scope and were skipped.");
  } else {
    const selection = await db.pipelineResultSelection.findUnique({
      where: { pipelineId_targetKey: { pipelineId: options.pipelineId, targetKey: context.targetKey } },
      select: { selectedRunId: true },
    });
    const selected = selection ? runs.find((run) => run.id === selection.selectedRunId) : undefined;
    // A selected study run may cover only part of a cohort. Fill the remaining
    // samples from their latest completed source runs, without double counting.
    chosen = selected ? [selected, ...runs.filter(run => run.id !== selected.id)] : runs;
  }
  if (chosen.length === 0) return null;

  const covered = new Set<string>();
  const artifacts = chosen.flatMap(run => {
    const newSamples = new Set<string>();
    const eligible = eligibleArtifacts(run, context, sampleIds).filter(artifact => artifact.outputId === options.outputId);
    const selected = eligible.filter(artifact => {
      const ids = artifact.sampleId ? [artifact.sampleId] : frozenSampleIds(run);
      if (ids.some(id => covered.has(id))) return false;
      ids.forEach(id => newSamples.add(id));
      return true;
    });
    if (options.runIds && selected.length < eligible.length) warnings.push("Overlapping older results were skipped: only one profiling result per sample is used.");
    newSamples.forEach(id => covered.add(id));
    return selected.map(artifact => ({ ...artifact, runId: run.id, runNumber: run.runNumber,
      runFolder: run.runFolder, inputSampleIds: frozenSampleIds(run) }));
  });
  if (artifacts.length === 0) return null;

  const sampleById = new Map(samples.map((sample) => [sample.id, sample] as const));
  const sampleByLabel = new Map<string, Set<string>>();
  for (const sample of samples) {
    for (const label of new Set([sample.id, sample.sampleId, sample.sampleAlias].filter((label): label is string => Boolean(label)))) {
      const ids = sampleByLabel.get(label) ?? new Set<string>();
      ids.add(sample.id);
      sampleByLabel.set(label, ids);
    }
  }

  const rows: ExploreRowData[] = [];
  const sources: ExploreProvenanceSource[] = [];
  const usedRuns = new Set<string>();
  let usedFiles = 0;
  let unmatched = 0;
  for (const artifact of artifacts) {
    let text: string;
    try {
      if (!artifact.runFolder) throw new Error("Missing run folder");
      const file = await resolveContainedPath(artifact.runFolder, artifact.path);
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_TABLE_FILE_BYTES) {
        warnings.push(`${path.basename(artifact.path)} exceeds the size limit and was skipped.`);
        continue;
      }
      text = await fs.readFile(file, "utf8");
    } catch {
      warnings.push(`${path.basename(artifact.path)} could not be read and was skipped.`);
      continue;
    }
    let parsed: ReturnType<typeof parseDelimited>;
    try {
      parsed = parseDelimited(text, {
        delimiter: spec.format === "csv" ? "," : spec.format === "tsv" ? "\t" : "auto",
        skipLinesStartingWith: spec.skipLinesStartingWith,
        headerLinePrefix: spec.headerLinePrefix,
      });
    } catch {
      warnings.push(`${path.basename(artifact.path)} does not match its declared table format and was skipped.`);
      continue;
    }
    if (parsed.columns.length === 0) continue;
    const artifactSample = artifact.sampleId ? sampleById.get(artifact.sampleId) ?? null : null;
    const before = rows.length;
    for (const row of parsed.rows) {
      const label = spec.sampleColumn ? String(row[spec.sampleColumn] ?? "") : "";
      const matches = sampleByLabel.get(label);
      const sample = artifactSample ?? (matches?.size === 1 ? sampleById.get([...matches][0]) : null);
      if (!artifactSample && spec.sampleColumn && (!sample || !artifact.inputSampleIds.includes(sample.id))) { unmatched++; continue; }
      rows.push({
        ...row,
        // Source columns cannot replace server-resolved identities or groups.
        sample_db_id: sample?.id ?? null,
        sample_id: sample?.sampleId ?? null,
        pipeline_run: artifact.runNumber,
        ...(sample ? cohortColumns(sample, context) : { source_study_id: null, cohort_group: null, cohort_role: null }),
      });
    }
    if (rows.length > before) {
      usedFiles++;
      if (!usedRuns.has(artifact.runId)) {
        sources.push({ type: "pipeline-run", id: artifact.runId, label: artifact.runNumber });
        usedRuns.add(artifact.runId);
      }
      sources.push({ type: "artifact", id: artifact.id, label: path.basename(artifact.path), checksum: artifact.checksum ?? undefined });
    }
  }
  if (rows.length === 0) {
    throw new ExploreBuildInputError(unmatched
      ? "No rows could be matched unambiguously to this run's accessible samples. Check the table's sample labels or use per-sample outputs."
      : "No readable table rows were found in the eligible outputs. Check the output files and their manifest-declared format.");
  }

  const columnKeys = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const roles: ExploreRoleMap = {};
  for (const [role, column] of Object.entries(spec.roles ?? {})) {
    if (columnKeys.includes(column)) roles[role as ExploreRole] = column;
    else warnings.push(`Declared column ${column} for role ${role} is missing from the table.`);
  }
  // Sample identity and cohort groups always come from SeqDesk, not table roles.
  if (rows.some(row => row.sample_db_id)) roles.sample = "sample_db_id";
  else delete roles.sample;
  if (rows.some(row => row.cohort_group)) roles.group = "cohort_group";
  const suggested = suggestRoles(columnKeys.filter((key) => !["sample_db_id", "sample_id", "pipeline_run"].includes(key)), spec.tableKind);
  for (const [role, column] of Object.entries(suggested)) {
    if (!roles[role as ExploreRole] && role !== "sample") roles[role as ExploreRole] = column;
  }
  if (unmatched > 0) warnings.push(`${unmatched} rows with unknown or ambiguous sample labels were excluded.`);
  const represented = new Set(rows.map(row => row.sample_db_id).filter(Boolean));
  if (represented.size && represented.size < samples.length) warnings.push(`${samples.length - represented.size} accessible samples have no usable result in this dataset.`);

  const labels: Record<string, string> = { ...COHORT_LABELS, sample_db_id: "Sample record", sample_id: "Sample ID", pipeline_run: "Pipeline run" };
  const groups: Record<string, string> = Object.fromEntries(columnKeys.map((key) => [key, key.startsWith("sample") || key === "pipeline_run" ? "identity" : "pipeline"]));
  const schema = inferSchema(rows, { labels, roles, groups });
  const pipelineName = pkg?.manifest.package.name ?? options.pipelineId;
  const label = (spec as { label?: string }).label ?? `${pipelineName}: ${options.outputId}`;
  return {
    kind: "pipeline-table",
    tableKind: spec.tableKind,
    name: label,
    description: `${tableKind?.description ?? "Pipeline table"} Built from ${usedFiles} ${output?.scope ?? "sample"}-scoped output files of ${usedRuns.size} run${usedRuns.size === 1 ? "" : "s"}.`,
    sensitivity: "standard",
    roles,
    schema,
    rows,
    provenance: {
      builtAt: new Date().toISOString(),
      builder: "pipeline-table@2",
      sources,
      notes: [`${rows.length} rows from ${usedFiles} files`, "Selected results take precedence; remaining samples use their latest eligible completed run."],
    },
    keys: { sample: "sample_db_id", key: roles.taxon_id ?? roles.taxon },
    sourceConfig: {
      builder: "pipeline-table",
      pipelineId: options.pipelineId,
      outputId: options.outputId,
      ...(options.runIds ? { runIds: options.runIds } : {}),
      ...(options.table ? { table: options.table } : {}),
    },
    warnings,
  };
}
