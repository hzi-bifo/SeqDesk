import { db } from "@/lib/db";
import { fetchDatasetRows } from "./datasets";
import { parseInputBindings } from "./analyses";
import { parseJsonObject, parseRoles, parseSchema } from "./schema";
import type { ExploreProvenance, ExploreRoleMap } from "./types";
import { pickPreviewColumns, PREVIEW_ROWS, type CanvasEdge, type CanvasFigureData, type CanvasGraph, type CanvasNode } from "./canvas-layout";

const ACTIVE_RUN = new Set(["pending", "queued", "running"]);

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

/** One line saying where a dataset came from. */
export function originLabel(sources: ExploreProvenance["sources"], datasetKind: string): string {
  const file = sources.find((source) => source.type === "file");
  if (file) return `Imported from ${file.label ?? file.id}`;
  const runs = sources.filter((source) => source.type === "pipeline-run");
  if (runs.length === 1) return `From pipeline run ${runs[0].label ?? runs[0].id}`;
  if (runs.length > 1) return `From ${runs.length} pipeline runs`;
  const study = sources.find((source) => source.type === "study");
  if (study) return datasetKind === "sequencing" ? "Sequencing runs of the study" : "Built from the study";
  const order = sources.find((source) => source.type === "order");
  if (order) return datasetKind === "sequencing" ? "Sequencing runs of the order" : "Built from the sequencing order";
  return datasetKind === "derived" ? "Written by an analysis" : "";
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
    const sourceConfig = parseJsonObject(dataset.sourceConfig);
    const producingRunId = typeof sourceConfig?.runId === "string" ? sourceConfig.runId : null;
    const producingAnalysis =
      (typeof sourceConfig?.analysisId === "string" ? sourceConfig.analysisId : null) ?? (producingRunId ? runToAnalysis.get(producingRunId) : null) ?? null;
    const producerActive = producingAnalysis ? ACTIVE_RUN.has(latestRunByAnalysis.get(producingAnalysis)?.status ?? "") : false;
    const sources = provenanceSources(current?.provenance);
    nodes.push({
      id: nodeId,
      data: {
        kind: "dataset",
        datasetId: dataset.id,
        name: dataset.name,
        datasetKind: dataset.kind,
        tableKind: dataset.tableKind,
        sensitivity: dataset.sensitivity,
        origin: producingAnalysis ? "Written by an analysis" : originLabel(sources, dataset.kind),
        version: current?.number ?? null,
        rowCount: current?.rowCount ?? 0,
        columnCount: schema.columns.length,
        previewColumns,
        columns: schema.columns,
        roles,
        previewRows: preview.rows.map((row) => row.data),
        views: timelineReady ? ["subject-timeline", "heatmap"] : [],
        ...(producerActive ? { refreshing: true } : {}),
      },
    });

    if (producingAnalysis) {
      edges.push({ id: `wrote:${producingAnalysis}:${dataset.id}`, source: `analysis:${producingAnalysis}`, target: nodeId, label: "wrote" });
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
        active: latest ? ACTIVE_RUN.has(latest.status) : false,
      },
    });
    const active = latest ? ACTIVE_RUN.has(latest.status) : false;
    for (const binding of parseInputBindings(revision?.inputs)) {
      const datasetNodeId = `dataset:${binding.datasetId}`;
      if (!datasetNodeIds.has(datasetNodeId)) continue;
      edges.push({ id: `input:${binding.datasetId}:${analysis.id}:${binding.alias}`, source: datasetNodeId, target: nodeId, label: binding.alias });
    }
    const completed = latestCompletedByAnalysis.get(analysis.id);
    if (active && !completed && latest) {
      // Nothing to show yet: a placeholder stands where the outputs will appear.
      const pendingId = `pending:${analysis.id}`;
      nodes.push({ id: pendingId, data: { kind: "pending", analysisId: analysis.id, runId: latest.id, runNumber: latest.runNumber, status: latest.status } });
      edges.push({ id: `pending:${analysis.id}`, source: nodeId, target: pendingId, label: latest.runNumber });
    }
    // One node per figure name. The interactive version is the node; a PNG or
    // SVG twin written by the same run becomes its thumbnail.
    const figures = new Map<string, { interactive: (typeof runs)[number]["artifacts"][number] | null; image: (typeof runs)[number]["artifacts"][number] | null }>();
    for (const artifact of completed?.artifacts ?? []) {
      if (artifact.kind !== "figure" || !["plotly-json", "png", "svg", "html"].includes(artifact.format)) continue;
      const entry = figures.get(artifact.name) ?? { interactive: null, image: null };
      if (artifact.format === "png" || artifact.format === "svg") entry.image = entry.image ?? artifact;
      else entry.interactive = entry.interactive ?? artifact;
      figures.set(artifact.name, entry);
    }
    for (const [name, entry] of figures) {
      const main = entry.interactive ?? entry.image!;
      const figureNodeId = `figure:${completed!.id}:${name}`;
      const artifactUrl = (artifact: { id: string }) => `/api/explore/runs/${completed!.id}/artifacts/${artifact.id}`;
      const data: CanvasFigureData = {
        kind: "figure",
        artifactId: main.id,
        runId: completed!.id,
        name,
        format: main.format,
        url: artifactUrl(main),
        thumbnailUrl: entry.image ? artifactUrl(entry.image) : null,
        ...(active ? { refreshing: true } : {}),
      };
      nodes.push({ id: figureNodeId, data });
      edges.push({ id: `figure:${completed!.id}:${name}`, source: nodeId, target: figureNodeId, label: completed!.runNumber });
    }
  }

  return { nodes, edges };
}

