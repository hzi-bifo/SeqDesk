import { db } from "@/lib/db";
import { fetchDatasetRows } from "./datasets";
import { parseInputBindings } from "./analyses";
import { getKit } from "./kits/loader";
import { viewRoleHints } from "./dataset-kinds";
import { parseStoredBlocks } from "./report-blocks";
import { parseJsonObject, parseRoles, parseSchema } from "./schema";
import type { ExploreProvenance, ExploreRoleMap } from "./types";
import { BUILT_IN_VIEWS, pickPreviewColumns, PREVIEW_ROWS, usedColumnKeys, type CanvasEdge, type CanvasFigureData, type CanvasGraph, type CanvasNode, type CanvasParamsSchema } from "./canvas-layout";

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

/** The metrics a run recorded, flattened to values a card can show. */
function runMetrics(results: string | null | undefined): Record<string, string | number | boolean | null> | undefined {
  const parsed = parseJsonObject(results);
  const metrics = parsed && typeof parsed.metrics === "object" && parsed.metrics ? (parsed.metrics as Record<string, unknown>) : null;
  if (!metrics) return undefined;
  const flat: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") flat[key] = value;
  }
  return flat;
}

/** Assemble the graph of one scope from the database. */
/**
 * The graph of one report's canvas: the scope's tables, the report's analysis
 * steps and their outputs. Without a report id the whole scope is drawn.
 */
export async function loadCanvasGraph(targetKey: string, reportId: string | null = null): Promise<CanvasGraph> {
  const analysisWhere = reportId ? { targetKey, reportId } : { targetKey };
  const [allDatasets, analyses, runs] = await Promise.all([
    db.exploreDataset.findMany({
      where: { targetKey },
      include: { versions: { orderBy: { number: "desc" }, take: 1 } },
      orderBy: { createdAt: "asc" },
    }),
    db.exploreAnalysis.findMany({
      where: analysisWhere,
      include: { revisions: { orderBy: { number: "desc" }, take: 1 } },
      orderBy: { createdAt: "asc" },
    }),
    db.exploreAnalysisRun.findMany({
      where: { analysis: analysisWhere },
      orderBy: { createdAt: "desc" },
      include: { artifacts: true, revision: { select: { number: true } } },
    }),
  ]);

  // What the report page shows: the saved blocks, or (as a draft) every output.
  // An empty page is a draft too, so it shows every output like no page at all.
  const storedReport = reportId
    ? await db.exploreReport.findUnique({ where: { id: reportId }, select: { blocks: true } })
    : await db.exploreReport.findFirst({ where: { targetKey }, orderBy: { createdAt: "asc" }, select: { blocks: true } });
  const storedBlocks = storedReport ? parseStoredBlocks(storedReport.blocks) : [];
  const reportBlocks = storedBlocks.length > 0 ? storedBlocks : null;

  const analysisIds = new Set(analyses.map((analysis) => analysis.id));
  const runToAnalysis = new Map(runs.map((run) => [run.id, run.analysisId] as const));
  const producerOf = (dataset: (typeof allDatasets)[number]): string | null => {
    const sourceConfig = parseJsonObject(dataset.sourceConfig);
    const runId = typeof sourceConfig?.runId === "string" ? sourceConfig.runId : null;
    return (typeof sourceConfig?.analysisId === "string" ? sourceConfig.analysisId : null) ?? (runId ? runToAnalysis.get(runId) : null) ?? null;
  };
  // Inside a report, tables written by other reports' analyses stay out of the
  // picture unless one of this report's analyses reads them.
  const inputDatasetIds = new Set(analyses.flatMap((analysis) => parseInputBindings(analysis.revisions[0]?.inputs).map((binding) => binding.datasetId)));
  const datasets = reportId
    ? allDatasets.filter((dataset) => {
        if (dataset.kind !== "derived" || inputDatasetIds.has(dataset.id)) return true;
        const producer = producerOf(dataset);
        return Boolean(producer && analysisIds.has(producer));
      })
    : allDatasets;
  const reportFigures = new Set(reportBlocks?.filter((block) => block.type === "figure").map((block) => `${block.analysisId}:${block.figureName}`) ?? []);
  const reportTables = new Set(reportBlocks?.filter((block) => block.type === "table").map((block) => block.datasetId) ?? []);
  const reportViews = new Set(reportBlocks?.filter((block) => block.type === "view").map((block) => `${block.datasetId}:${block.view}`) ?? []);
  const figureInReport = (analysisId: string, name: string) => (reportBlocks ? reportFigures.has(`${analysisId}:${name}`) : true);
  const tableInReport = (datasetId: string, derived: boolean) => (reportBlocks ? reportTables.has(datasetId) : derived);

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const datasetNodeIds = new Set(datasets.map((dataset) => `dataset:${dataset.id}`));
  const analysisNames = new Map(analyses.map((analysis) => [analysis.id, analysis.name] as const));
  const latestRunByAnalysis = new Map<string, (typeof runs)[number]>();
  for (const run of runs) if (!latestRunByAnalysis.has(run.analysisId)) latestRunByAnalysis.set(run.analysisId, run);
  // Finished runs per analysis, newest first: the first one owns the outputs shown, the second tells whether they changed.
  const completedByAnalysis = new Map<string, Array<(typeof runs)[number]>>();
  for (const run of runs) {
    if (run.status !== "completed") continue;
    const list = completedByAnalysis.get(run.analysisId) ?? [];
    list.push(run);
    completedByAnalysis.set(run.analysisId, list);
  }

  const datasetInfo = new Map(
    datasets.map((dataset) => {
      const current = dataset.versions.find((version) => version.id === dataset.currentVersionId) ?? dataset.versions[0] ?? null;
      return [dataset.id, { current, schema: parseSchema(current?.schema), roles: parseRoles(dataset.roles) }] as const;
    })
  );

  // Which columns each analysis reads from each of its inputs, from its code and its kit.
  const usage = new Map<string, Map<string, Set<string>>>();
  const kits = new Map<string, Awaited<ReturnType<typeof getKit>>>();
  for (const analysis of analyses) {
    const revision = analysis.revisions[0];
    if (!revision) continue;
    let kit: Awaited<ReturnType<typeof getKit>> = null;
    if (analysis.kitId) {
      if (!kits.has(analysis.kitId)) kits.set(analysis.kitId, await getKit(analysis.kitId));
      kit = kits.get(analysis.kitId) ?? null;
    }
    for (const binding of parseInputBindings(revision.inputs)) {
      const info = datasetInfo.get(binding.datasetId);
      if (!info) continue;
      const kitInput = kit?.manifest.inputs.find((input) => input.alias === binding.alias);
      const declaredRoles = kitInput ? [...kitInput.requiredRoles, ...kitInput.optionalRoles] : [];
      const byColumn = usage.get(binding.datasetId) ?? new Map<string, Set<string>>();
      for (const key of usedColumnKeys({ code: revision.code, columns: info.schema.columns, roles: info.roles, declaredRoles })) {
        const names = byColumn.get(key) ?? new Set<string>();
        names.add(analysis.name);
        byColumn.set(key, names);
      }
      if (byColumn.size > 0) usage.set(binding.datasetId, byColumn);
    }
  }

  for (const dataset of datasets) {
    const { current, schema, roles } = datasetInfo.get(dataset.id)!;
    const previewColumns = pickPreviewColumns(schema.columns, roles);
    const preview = current ? await fetchDatasetRows(current.id, { limit: PREVIEW_ROWS }) : { rows: [] };
    const nodeId = `dataset:${dataset.id}`;
    const timelineReady = ["sample", "subject", "timepoint", "taxon", "count"].every((role) => Boolean(roles[role as keyof ExploreRoleMap]));
    const producingAnalysis = producerOf(dataset);
    const producerActive = producingAnalysis ? ACTIVE_RUN.has(latestRunByAnalysis.get(producingAnalysis)?.status ?? "") : false;
    const sources = provenanceSources(current?.provenance);
    // The run that wrote the current version versus the latest finished run:
    // when they differ, the latest run produced the same table again.
    const versionRun = sources.find((source) => source.type === "analysis-run");
    const latestFinished = producingAnalysis ? completedByAnalysis.get(producingAnalysis)?.[0] : undefined;
    const latestWrite = latestFinished ? { runNumber: latestFinished.runNumber, changed: versionRun?.id === latestFinished.id } : null;
    const producerName = producingAnalysis ? analysisNames.get(producingAnalysis) : undefined;
    const usedColumns = Object.fromEntries([...(usage.get(dataset.id) ?? new Map<string, Set<string>>())].map(([key, names]) => [key, [...names]]));
    nodes.push({
      id: nodeId,
      data: {
        kind: "dataset",
        datasetId: dataset.id,
        name: dataset.name,
        datasetKind: dataset.kind,
        tableKind: dataset.tableKind,
        sensitivity: dataset.sensitivity,
        origin: producingAnalysis ? `Written by ${producerName ?? "an analysis"}` : originLabel(sources, dataset.kind),
        version: current?.number ?? null,
        rowCount: current?.rowCount ?? 0,
        columnCount: schema.columns.length,
        previewColumns,
        columns: schema.columns,
        roles,
        previewRows: preview.rows.map((row) => row.data),
        views: timelineReady ? ["subject-timeline", "heatmap"] : [],
        usedColumns,
        latestWrite,
        roleHints: viewRoleHints(roles),
        inReport: tableInReport(dataset.id, dataset.kind === "derived"),
        ...(producerActive ? { refreshing: true } : {}),
      },
    });

    if (producingAnalysis) {
      edges.push({ id: `wrote:${producingAnalysis}:${dataset.id}`, source: `analysis:${producingAnalysis}`, target: nodeId, label: "wrote" });
    }
    // Built-in views are elements of their own: drawn from the table, placeable on the report.
    if (timelineReady) {
      for (const view of ["subject-timeline", "heatmap"] as const) {
        const viewNodeId = `view:${dataset.id}:${view}`;
        nodes.push({
          id: viewNodeId,
          data: {
            kind: "view",
            datasetId: dataset.id,
            view,
            name: BUILT_IN_VIEWS[view].label,
            tableName: dataset.name,
            url: `/explore/datasets/${dataset.id}/${view}`,
            inReport: reportBlocks ? reportViews.has(`${dataset.id}:${view}`) : false,
          },
        });
        edges.push({ id: viewNodeId, source: nodeId, target: viewNodeId, label: "built-in view" });
      }
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
        codePreview: codePreviewOf(revision?.code ?? "", 80),
        codeLines: revision?.code ? revision.code.split("\n").length : 0,
        latestRun: latest
          ? { id: latest.id, runNumber: latest.runNumber, status: latest.status, errorTail: latest.errorTail, completedAt: latest.completedAt?.toISOString() ?? null }
          : null,
        active: latest ? ACTIVE_RUN.has(latest.status) : false,
        metrics: runMetrics(completedByAnalysis.get(analysis.id)?.[0]?.results),
        metricsRunNumber: completedByAnalysis.get(analysis.id)?.[0]?.runNumber,
        metricsRunId: completedByAnalysis.get(analysis.id)?.[0]?.id,
        metricsCompletedAt: completedByAnalysis.get(analysis.id)?.[0]?.completedAt?.toISOString() ?? null,
        params: parseJsonObject(revision?.params) ?? {},
        paramsSchema: ((analysis.kitId ? kits.get(analysis.kitId)?.manifest.params : null) ?? null) as CanvasParamsSchema | null,
        inputs: parseInputBindings(revision?.inputs).map((binding) => ({ alias: binding.alias, datasetId: binding.datasetId })),
      },
    });
    const active = latest ? ACTIVE_RUN.has(latest.status) : false;
    for (const binding of parseInputBindings(revision?.inputs)) {
      const datasetNodeId = `dataset:${binding.datasetId}`;
      if (!datasetNodeIds.has(datasetNodeId)) continue;
      edges.push({ id: `input:${binding.datasetId}:${analysis.id}:${binding.alias}`, source: datasetNodeId, target: nodeId, label: binding.alias });
    }
    const finished = completedByAnalysis.get(analysis.id) ?? [];
    const completed = finished[0];
    const previous = finished[1];
    if (active && !completed && latest) {
      // Nothing to show yet: a placeholder stands where the outputs will appear.
      const pendingId = `pending:${analysis.id}`;
      nodes.push({ id: pendingId, data: { kind: "pending", analysisId: analysis.id, runId: latest.id, runNumber: latest.runNumber, status: latest.status } });
      edges.push({ id: `pending:${analysis.id}`, source: nodeId, target: pendingId, label: latest.runNumber });
    }
    if (!completed) continue;
    // One card per figure name, owned by the analysis rather than the run, so a
    // re-run replaces the figure in place. The interactive version is the card;
    // a PNG or SVG twin written by the same run becomes its thumbnail.
    type Artifact = (typeof runs)[number]["artifacts"][number];
    const figures = new Map<string, { interactive: Artifact | null; image: Artifact | null }>();
    for (const artifact of completed.artifacts) {
      if (artifact.kind !== "figure" || !["plotly-json", "png", "svg", "html"].includes(artifact.format)) continue;
      const entry = figures.get(artifact.name) ?? { interactive: null, image: null };
      if (artifact.format === "png" || artifact.format === "svg") entry.image = entry.image ?? artifact;
      else entry.interactive = entry.interactive ?? artifact;
      figures.set(artifact.name, entry);
    }
    for (const [name, entry] of figures) {
      const main = entry.interactive ?? entry.image!;
      const before = previous?.artifacts.find((artifact) => artifact.name === name && artifact.format === main.format);
      const figureNodeId = `figure:${analysis.id}:${name}`;
      const artifactUrl = (artifact: { id: string }) => `/api/explore/runs/${completed.id}/artifacts/${artifact.id}`;
      const data: CanvasFigureData = {
        kind: "figure",
        artifactId: main.id,
        analysisId: analysis.id,
        runId: completed.id,
        runNumber: completed.runNumber,
        name,
        format: main.format,
        url: artifactUrl(main),
        thumbnailUrl: entry.image ? artifactUrl(entry.image) : null,
        unchanged: Boolean(before && main.checksum && before.checksum === main.checksum),
        inReport: figureInReport(analysis.id, name),
        ...(active ? { refreshing: true } : {}),
      };
      nodes.push({ id: figureNodeId, data });
      edges.push({ id: figureNodeId, source: nodeId, target: figureNodeId, label: completed.runNumber });
    }
  }

  return { nodes, edges };
}
