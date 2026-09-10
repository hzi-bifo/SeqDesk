import type { PipelineOutputSource } from "./pipeline-output-types";
import { parseStoredBlocks } from "./report-blocks";

interface DatasetUsage { id: string; sourceConfig: string | null; currentVersionId: string | null; versions: Array<{ id: string; rowCount: number; provenance: string }> }
function object(raw: string | null): Record<string, unknown> {
  try { const value = JSON.parse(raw ?? "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
}

/** Match actual version provenance, not merely a configured/latest run. Never count a mixed-run table as this run's table. */
export function withPipelineOutputUsage(outputs: PipelineOutputSource[], datasets: DatasetUsage[], blocks: unknown): PipelineOutputSource[] {
  const onPage = new Set(parseStoredBlocks(blocks).flatMap(block => "datasetId" in block ? [block.datasetId] : block.type === "run-metric" ? block.figures?.map(figure => figure.datasetId) ?? [] : []));
  const usable = datasets.flatMap(dataset => {
    const source = object(dataset.sourceConfig);
    const version = dataset.versions.find(version => version.id === dataset.currentVersionId);
    const provenance = version ? object(version.provenance) : {};
    const sources = Array.isArray(provenance.sources) ? provenance.sources : [];
    const runIds = [...new Set(sources.filter(source => source?.type === "pipeline-run").map(source => source.id))];
    if (source.builder !== "pipeline-table" || !version?.rowCount || runIds.length !== 1) return [];
    const artifactIds = new Set(sources.filter(source => source?.type === "artifact").map(source => source.id));
    return [{ datasetId: dataset.id, pipelineId: source.pipelineId, outputId: source.outputId, runId: runIds[0], artifactIds }];
  });
  return outputs.map(output => ({ ...output, runs: output.runs.map(run => {
    const matches = output.table ? usable.filter(dataset => dataset.pipelineId === output.pipelineId && dataset.outputId === output.outputId && dataset.runId === run.id && run.files.every(file => dataset.artifactIds.has(file.id))) : [];
    const existing = matches.find(dataset => onPage.has(dataset.datasetId)) ?? matches[0];
    return { ...run, ...(existing ? { usage: { datasetId: existing.datasetId, state: onPage.has(existing.datasetId) ? "report" as const : "workspace" as const } } : {}) };
  }) }));
}
