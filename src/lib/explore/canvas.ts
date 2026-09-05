import { db } from "@/lib/db";
import { fetchDatasetRows } from "./datasets";
import { parseInputBindings } from "./analyses";
import { parseJsonObject, parseRoles, parseSchema } from "./schema";
import type { ExploreProvenance, ExploreRoleMap } from "./types";
import { pickPreviewColumns, PREVIEW_ROWS, type CanvasEdge, type CanvasFigureData, type CanvasGraph, type CanvasNode, type CanvasSourceData } from "./canvas-layout";

export * from "./canvas-layout";

/** The first meaningful lines of a script: skip the module docstring and blank lines. */
export function codePreviewOf(code: string, lines = 5): string {
  const all = code.split("\n");
  let index = 0;
  // Skip a leading docstring or comment block so the preview shows code.
  if (/^\s*("""|\'\'\')/.test(all[0] ?? "")) {
    const quote = all[0].trim().slice(0, 3);
    index = 1;
    if (!(all[0].trim().length > 3 && all[0].trim().endsWith(quote))) {
      while (index < all.length && !all[index].includes(quote)) index += 1;
      index += 1;
    }
  }
  const picked: string[] = [];
  for (; index < all.length && picked.length < lines; index += 1) {
    const line = all[index];
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    picked.push(line.length > 90 ? `${line.slice(0, 87)}...` : line);
  }
  return picked.join("\n");
}

function sourceNodeId(type: string, id: string): string {
  return `source:${type}:${id}`;
}

function provenanceSources(raw: string | null | undefined): ExploreProvenance["sources"] {
  const parsed = parseJsonObject(raw) as unknown as ExploreProvenance | null;
  return Array.isArray(parsed?.sources) ? parsed!.sources : [];
}

/** Assemble the graph of one scope from the database. */
export async function loadCanvasGraph(targetKey: string): Promise<CanvasGraph> {
  const [datasets, analyses, runs] = await Promise.all([
    db.exploreDataset.findMany({
      where: { targetKey },
      include: { versions: { orderBy: { number: "desc" }, take: 1 } },
      orderBy: { createdAt: "asc" },
    }),
    db.exploreAnalysis.findMany({
      where: { targetKey },
      include: { revisions: { orderBy: { number: "desc" }, take: 1 } },
      orderBy: { createdAt: "asc" },
    }),
    db.exploreAnalysisRun.findMany({
      where: { analysis: { targetKey } },
      orderBy: { createdAt: "desc" },
      include: { artifacts: true, revision: { select: { number: true } } },
    }),
  ]);

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const sourceNodes = new Map<string, CanvasSourceData>();
  const datasetNodeIds = new Set<string>();
  const runToAnalysis = new Map(runs.map((run) => [run.id, run.analysisId] as const));
  const latestRunByAnalysis = new Map<string, (typeof runs)[number]>();
  for (const run of runs) if (!latestRunByAnalysis.has(run.analysisId)) latestRunByAnalysis.set(run.analysisId, run);
  const latestCompletedByAnalysis = new Map<string, (typeof runs)[number]>();
  for (const run of runs) if (run.status === "completed" && !latestCompletedByAnalysis.has(run.analysisId)) latestCompletedByAnalysis.set(run.analysisId, run);

  for (const dataset of datasets) {
    const current = dataset.versions.find((version) => version.id === dataset.currentVersionId) ?? dataset.versions[0] ?? null;
    const schema = parseSchema(current?.schema);
    const roles = parseRoles(dataset.roles);
    const previewColumns = pickPreviewColumns(schema.columns, roles);
    const preview = current ? await fetchDatasetRows(current.id, { limit: PREVIEW_ROWS }) : { rows: [] };
    const nodeId = `dataset:${dataset.id}`;
    datasetNodeIds.add(nodeId);
    const timelineReady = ["sample", "subject", "timepoint", "taxon", "count"].every((role) => Boolean(roles[role as keyof ExploreRoleMap]));
    nodes.push({
      id: nodeId,
      data: {
        kind: "dataset",
        datasetId: dataset.id,
        name: dataset.name,
        datasetKind: dataset.kind,
        tableKind: dataset.tableKind,
        sensitivity: dataset.sensitivity,
        version: current?.number ?? null,
        rowCount: current?.rowCount ?? 0,
        columnCount: schema.columns.length,
        previewColumns,
        columns: schema.columns,
        roles,
        previewRows: preview.rows.map((row) => row.data),
        views: timelineReady ? ["subject-timeline", "heatmap"] : [],
      },
    });

    const sourceConfig = parseJsonObject(dataset.sourceConfig);
    const producingRunId = typeof sourceConfig?.runId === "string" ? sourceConfig.runId : null;
    const producingAnalysis = producingRunId ? runToAnalysis.get(producingRunId) : null;
    if (producingAnalysis) {
      edges.push({ id: `wrote:${producingRunId}:${dataset.id}`, source: `analysis:${producingAnalysis}`, target: nodeId, label: "wrote" });
      continue;
    }
    for (const source of provenanceSources(current?.provenance)) {
      if (source.type === "artifact" || source.type === "analysis-run" || source.type === "sample") continue;
      const id = sourceNodeId(source.type, source.id);
      if (!sourceNodes.has(id)) {
        sourceNodes.set(id, { kind: "source", sourceType: source.type, label: source.label ?? source.id });
      }
      edges.push({ id: `built:${id}:${dataset.id}`, source: id, target: nodeId, label: source.type === "file" ? "imported" : "built from" });
    }
  }

  for (const analysis of analyses) {
    const nodeId = `analysis:${analysis.id}`;
    const revision = analysis.revisions[0] ?? null;
    const latest = latestRunByAnalysis.get(analysis.id) ?? null;
    nodes.push({
      id: nodeId,
      data: {
        kind: "analysis",
        analysisId: analysis.id,
        name: analysis.name,
        kitId: analysis.kitId,
        language: analysis.language,
        revision: revision?.number ?? null,
        codePreview: codePreviewOf(revision?.code ?? ""),
        codeLines: revision?.code ? revision.code.split("\n").length : 0,
        latestRun: latest ? { id: latest.id, runNumber: latest.runNumber, status: latest.status } : null,
      },
    });
    for (const binding of parseInputBindings(revision?.inputs)) {
      const datasetNodeId = `dataset:${binding.datasetId}`;
      if (!datasetNodeIds.has(datasetNodeId)) continue;
      edges.push({ id: `input:${binding.datasetId}:${analysis.id}:${binding.alias}`, source: datasetNodeId, target: nodeId, label: binding.alias });
    }
    const completed = latestCompletedByAnalysis.get(analysis.id);
    for (const artifact of completed?.artifacts ?? []) {
      if (artifact.kind !== "figure" || !["plotly-json", "png", "svg", "html"].includes(artifact.format)) continue;
      // One node per figure name: the interactive version wins over its PNG twin.
      const figureNodeId = `figure:${completed!.id}:${artifact.name}`;
      const existing = nodes.find((node) => node.id === figureNodeId);
      if (existing && existing.data.kind === "figure" && existing.data.format === "plotly-json") continue;
      const data: CanvasFigureData = {
        kind: "figure",
        artifactId: artifact.id,
        runId: completed!.id,
        name: artifact.name,
        format: artifact.format,
        url: `/api/explore/runs/${completed!.id}/artifacts/${artifact.id}`,
      };
      if (existing) existing.data = data;
      else {
        nodes.push({ id: figureNodeId, data });
        edges.push({ id: `figure:${completed!.id}:${artifact.name}`, source: nodeId, target: figureNodeId, label: completed!.runNumber });
      }
    }
  }

  for (const [id, data] of sourceNodes) nodes.unshift({ id, data });
  return { nodes, edges };
}

