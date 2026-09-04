import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { getPackage, type PackageOutputTable } from "@/lib/pipelines/package-loader";
import { getTableKind, suggestRoles } from "../dataset-kinds";
import { parseDelimited } from "../parsers/delimited";
import { inferSchema } from "../schema";
import type { ExploreProvenanceSource, ExploreRole, ExploreRoleMap, ExploreRowData } from "../types";
import { knownPipelineTable } from "../pipeline-tables";
import type { BuildContext, BuiltDataset } from "./types";

const MAX_TABLE_FILE_BYTES = 200 * 1024 * 1024;

export interface PipelineTableOptions {
  pipelineId: string;
  outputId: string;
  /** Restrict to these runs; default is the selected final run or the latest completed run. */
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

async function completedRunsForTarget(context: BuildContext, pipelineId?: string) {
  const runWhere =
    context.target.type === "study"
      ? {
          OR: [
            { studyId: context.target.id },
            { order: { samples: { some: { studyId: context.target.id } } } },
          ],
        }
      : context.target.type === "order"
        ? { orderId: context.target.id }
        : { id: "__none__" };
  return db.pipelineRun.findMany({
    where: { status: "completed", ...(pipelineId ? { pipelineId } : {}), ...runWhere },
    select: {
      id: true,
      pipelineId: true,
      runNumber: true,
      completedAt: true,
      studyId: true,
      orderId: true,
      artifacts: { select: { id: true, outputId: true, sampleId: true, path: true, checksum: true } },
    },
    orderBy: { completedAt: "desc" },
  });
}

function resolveTableSpec(pipelineId: string, outputId: string, explicit?: PackageOutputTable) {
  const pkg = getPackage(pipelineId);
  const output = pkg?.manifest.outputs.find((entry) => entry.id === outputId) ?? null;
  const spec = explicit ?? output?.table ?? knownPipelineTable(pipelineId, outputId) ?? null;
  return { pkg, output, spec };
}

/** Which pipeline table outputs exist for a scope, with the completed runs that produced them. */
export async function listPipelineTableSources(context: BuildContext): Promise<PipelineTableSource[]> {
  const runs = await completedRunsForTarget(context);
  const selections = await db.pipelineResultSelection.findMany({
    where: { targetKey: context.targetKey },
    select: { pipelineId: true, selectedRunId: true },
  });
  const selectedByPipeline = new Map(selections.map((entry) => [entry.pipelineId, entry.selectedRunId] as const));

  const grouped = new Map<string, PipelineTableSource>();
  for (const run of runs) {
    const pkg = getPackage(run.pipelineId);
    const outputIds = new Set(run.artifacts.map((artifact) => artifact.outputId).filter((id): id is string => Boolean(id)));
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
        artifactCount: run.artifacts.filter((artifact) => artifact.outputId === outputId).length,
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

  const runs = await completedRunsForTarget(context, options.pipelineId);
  let chosen = runs;
  if (options.runIds?.length) {
    const wanted = new Set(options.runIds);
    chosen = runs.filter((run) => wanted.has(run.id));
    if (chosen.length !== wanted.size) warnings.push("Some requested runs are not completed runs of this scope and were skipped.");
  } else {
    const selection = await db.pipelineResultSelection.findUnique({
      where: { pipelineId_targetKey: { pipelineId: options.pipelineId, targetKey: context.targetKey } },
      select: { selectedRunId: true },
    });
    const selected = selection ? runs.find((run) => run.id === selection.selectedRunId) : undefined;
    chosen = selected ? [selected] : runs.slice(0, 1);
  }
  if (chosen.length === 0) return null;

  const artifacts = chosen.flatMap((run) =>
    run.artifacts
      .filter((artifact) => artifact.outputId === options.outputId)
      .map((artifact) => ({ ...artifact, runId: run.id, runNumber: run.runNumber }))
  );
  if (artifacts.length === 0) return null;

  const sampleIds = new Set(artifacts.map((artifact) => artifact.sampleId).filter((id): id is string => Boolean(id)));
  const sampleWhere =
    context.target.type === "study" ? { studyId: context.target.id } : context.target.type === "order" ? { orderId: context.target.id } : { id: "__none__" };
  const samples = await db.sample.findMany({
    where: sampleIds.size ? { OR: [{ id: { in: [...sampleIds] } }, sampleWhere] } : sampleWhere,
    select: { id: true, sampleId: true, sampleAlias: true },
  });
  const sampleById = new Map(samples.map((sample) => [sample.id, sample] as const));
  const sampleByLabel = new Map<string, (typeof samples)[number]>();
  for (const sample of samples) {
    sampleByLabel.set(sample.sampleId, sample);
    if (sample.sampleAlias) sampleByLabel.set(sample.sampleAlias, sample);
  }

  const rows: ExploreRowData[] = [];
  const sources: ExploreProvenanceSource[] = chosen.map((run) => ({ type: "pipeline-run", id: run.id, label: run.runNumber }));
  let firstColumns: string[] | null = null;
  for (const artifact of artifacts) {
    let text: string;
    try {
      const stat = await fs.stat(artifact.path);
      if (stat.size > MAX_TABLE_FILE_BYTES) {
        warnings.push(`${path.basename(artifact.path)} exceeds the size limit and was skipped.`);
        continue;
      }
      text = await fs.readFile(artifact.path, "utf8");
    } catch {
      warnings.push(`${path.basename(artifact.path)} could not be read and was skipped.`);
      continue;
    }
    const parsed = parseDelimited(text, {
      delimiter: spec.format === "csv" ? "," : spec.format === "tsv" ? "\t" : "auto",
      skipLinesStartingWith: spec.skipLinesStartingWith,
    });
    if (parsed.columns.length === 0) continue;
    if (!firstColumns) firstColumns = parsed.columns;
    sources.push({ type: "artifact", id: artifact.id, label: path.basename(artifact.path), checksum: artifact.checksum ?? undefined });
    const artifactSample = artifact.sampleId ? sampleById.get(artifact.sampleId) ?? null : null;
    for (const row of parsed.rows) {
      const sample =
        artifactSample ??
        (spec.sampleColumn && row[spec.sampleColumn] !== null && row[spec.sampleColumn] !== undefined
          ? sampleByLabel.get(String(row[spec.sampleColumn])) ?? null
          : null);
      rows.push({
        sample_db_id: sample?.id ?? artifact.sampleId ?? null,
        sample_id: sample?.sampleId ?? (spec.sampleColumn ? (row[spec.sampleColumn] ?? null) : null),
        pipeline_run: artifact.runNumber,
        ...row,
      });
    }
  }
  if (rows.length === 0) return null;

  const columnKeys = Object.keys(rows[0]);
  const roles: ExploreRoleMap = { sample: "sample_db_id" };
  for (const [role, column] of Object.entries(spec.roles ?? {})) {
    if (columnKeys.includes(column)) roles[role as ExploreRole] = column;
    else warnings.push(`Declared column ${column} for role ${role} is missing from the table.`);
  }
  const suggested = suggestRoles(columnKeys.filter((key) => !["sample_db_id", "sample_id", "pipeline_run"].includes(key)), spec.tableKind);
  for (const [role, column] of Object.entries(suggested)) {
    if (!roles[role as ExploreRole] && role !== "sample") roles[role as ExploreRole] = column;
  }
  const unmatched = rows.filter((row) => !row.sample_db_id).length;
  if (unmatched > 0) warnings.push(`${unmatched} rows could not be matched to a sample of this scope.`);

  const labels: Record<string, string> = { sample_db_id: "Sample record", sample_id: "Sample ID", pipeline_run: "Pipeline run" };
  const groups: Record<string, string> = Object.fromEntries(columnKeys.map((key) => [key, key.startsWith("sample") || key === "pipeline_run" ? "identity" : "pipeline"]));
  const schema = inferSchema(rows, { labels, roles, groups });
  const pipelineName = pkg?.manifest.package.name ?? options.pipelineId;
  const label = (spec as { label?: string }).label ?? `${pipelineName}: ${options.outputId}`;
  return {
    kind: "pipeline-table",
    tableKind: spec.tableKind,
    name: label,
    description: `${tableKind?.description ?? "Pipeline table"} Built from ${artifacts.length} ${output?.scope ?? "sample"}-scoped output files of ${chosen.length} run${chosen.length === 1 ? "" : "s"}.`,
    sensitivity: "standard",
    roles,
    schema,
    rows,
    provenance: {
      builtAt: new Date().toISOString(),
      builder: "pipeline-table@1",
      sources,
      notes: [`${rows.length} rows from ${artifacts.length} files`],
    },
    keys: { sample: "sample_db_id", key: roles.taxon_id ?? roles.taxon },
    sourceConfig: {
      builder: "pipeline-table",
      pipelineId: options.pipelineId,
      outputId: options.outputId,
      ...(options.runIds?.length ? { runIds: options.runIds } : {}),
      ...(options.table ? { table: options.table } : {}),
    },
    warnings,
  };
}
