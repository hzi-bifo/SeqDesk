import path from "path";
import { getPackage } from "@/lib/pipelines/package-loader";
import { completedRunsForTarget, eligibleArtifacts, loadScopeSamples, listPipelineTableSources, resolveTableSpec, tableContractSignature } from "./builders/pipeline-table";
import type { BuildContext } from "./builders/types";
import { loadKits } from "./kits/loader";
import { datasetFitsInput } from "./dataset-kinds";
import type { ExploreRoleMap, ExploreSchema } from "./types";
import { outputFileView, type PipelineOutputSource } from "./pipeline-output-types";
import { outputSummary } from "./report-generation";

/** The same authorization filter is used for catalog, tables and each file request. */
export async function accessiblePipelineArtifacts(context: BuildContext) {
  const samples = await loadScopeSamples(context);
  const sampleIds = new Set(samples.map(sample => sample.id));
  const names = new Map(samples.map(sample => [sample.id, sample.sampleAlias || sample.sampleId]));
  const runs = await completedRunsForTarget(context, sampleIds);
  return runs.flatMap(run => eligibleArtifacts(run, context, sampleIds).map(artifact => ({
    run, artifact, sample: artifact.sampleId ? names.get(artifact.sampleId) ?? null : null,
  })));
}

export async function listPipelineOutputs(context: BuildContext) {
  const [files, tables, { kits }] = await Promise.all([
    accessiblePipelineArtifacts(context), listPipelineTableSources(context), loadKits(),
  ]);
  const grouped = new Map<string, PipelineOutputSource>();
  for (const { run, artifact, sample } of files) {
    const pkg = getPackage(run.pipelineId);
    const output = pkg?.manifest.outputs.find(output => output.id === artifact.outputId);
    const { spec } = resolveTableSpec(run.pipelineId, artifact.outputId ?? "", undefined, artifact.metadata);
    const signature = spec ? tableContractSignature(spec) : "";
    const table = tables.find(table => table.pipelineId === run.pipelineId && table.outputId === artifact.outputId && table.table && tableContractSignature(table.table) === signature);
    const view = outputFileView(artifact.path);
    const key = `${run.pipelineId}:${artifact.outputId ?? view.kind}:${signature}`;
    let entry = grouped.get(key);
    if (!entry) {
      entry = { id: key, pipelineId: run.pipelineId, pipelineName: pkg?.manifest.package.name ?? run.pipelineId,
        outputId: artifact.outputId, label: table?.label ?? output?.result?.preview?.label
          ?? pkg?.definition?.outputs?.find(output => output.id === artifact.outputId)?.name
          ?? artifact.outputId?.replace(/[_-]+/g, " ") ?? "Other files",
        description: table?.description ?? output?.result?.preview?.description,
        kind: table ? "table" : view.kind, table, runs: [], templates: [] };
      if (table?.table) {
        const spec = table.table;
        const schema: ExploreSchema = { schemaId: spec.schemaId, schemaVersion: spec.schemaVersion, rowEntity: spec.rowEntity,
          columns: Object.entries(spec.columns ?? {}).map(([key, column]) => ({ key, ...column, label: column.label ?? spec.columnLabels?.[key] ?? key })) };
        const roles: ExploreRoleMap = { ...spec.roles };
        // Only an attached sample or explicit sample column can provide sample identity.
        if (artifact.sampleId || spec.sampleColumn) {
          roles.sample = "sample_db_id";
          schema.columns.push({ key: "sample_db_id", label: "Sample", type: "string" });
        } else delete roles.sample;
        entry.templates = kits.flatMap(kit => {
          const input = kit.manifest.inputs.find(input => datasetFitsInput({ tableKind: spec.tableKind, roles, schema }, input).ok);
          return input ? [{ id: kit.manifest.id, name: kit.manifest.name, inputAlias: input.alias, description: kit.manifest.description, outputSummary: outputSummary(kit.manifest.outputs) }] : [];
        });
      }
      grouped.set(key, entry);
    }
    let producingRun = entry.runs.find(entry => entry.id === run.id);
    if (!producingRun) {
      producingRun = { id: run.id, runNumber: run.runNumber, completedAt: run.completedAt?.toISOString() ?? null, files: [] };
      entry.runs.push(producingRun);
    }
    producingRun.files.push({ id: artifact.id, name: path.basename(artifact.path), sample,
      size: artifact.size == null ? null : Number(artifact.size), kind: table ? "table" : view.kind,
      previewable: output?.result?.preview?.previewable !== false && (Boolean(table) || Boolean(view.contentType)) });
  }
  return [...grouped.values()].sort((a, b) => a.pipelineName.localeCompare(b.pipelineName) || Number(b.kind === "table") - Number(a.kind === "table") || a.label.localeCompare(b.label));
}
