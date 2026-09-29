import { ReportPagesSchema, reconcileReportPages, validateReportPages, type ReportPage } from "./report-pages";
/**
 * Reports: the final page of a scope. A report is an ordered list of blocks
 * (text, figure, table) that point at outputs by stable identity, so a re-run
 * of an analysis updates the report in place. Without a saved report the page
 * shows a draft assembled from every output of the scope.
 */
import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { loadCanvasGraph } from "./canvas";
import { fetchDatasetRows } from "./datasets";
import { parseSchema } from "./schema";
import { resolveContainedPath } from "./storage";
import type { ExploreColumn, ExploreRowData } from "./types";

export const REPORT_TABLE_ROWS = 12;
export {
  figureBlockId,
  viewBlockId,
  ReportFilterSchema,
  type ReportFilter,
  MAX_REPORT_BLOCKS,
  parseStoredBlocks,
  ReportBlockSchema,
  ReportInputSchema,
  ReportSharingSchema,
  tableBlockId,
  type ReportBlock,
  type ReportInput,
  type ReportSharing,
} from "./report-blocks";
import { figureBlockId, parseStoredBlocks, ReportFilterSchema, ReportInputSchema, ReportSharingSchema, tableBlockId, type ReportBlock, type ReportFilter, type ReportSharing } from "./report-blocks";
import type { ExploreRoleMap } from "./types";

export interface ReportFigure {
  analysisId: string;
  analysisName: string;
  figureName: string;
  runId: string;
  runNumber: string;
  /** The numbered recipe run the figure came from ("Run #8"), when the step ran as part of one. */
  flowRunNumber?: number | null;
  format: string;
  url: string;
  thumbnailUrl: string | null;
  unchanged: boolean;
  autoInclude?: boolean;
  /** The flow whose step drew the figure, when the scope has flows. */
  flowName?: string | null;
}

export interface ReportTable {
  datasetId: string;
  name: string;
  kind: string;
  /** The flow whose step wrote the table, for output tables. */
  flowName?: string | null;
  /** The step that wrote the table, for output tables. */
  producer?: string | null;
  /** True for tables written by an analysis, the ones a report is about. */
  output: boolean;
  autoInclude?: boolean;
  rowCount: number;
  columnCount: number;
  version: number | null;
  latestWrite: { runNumber: string; changed: boolean } | null;
  /** Columns a chart or a numbers block can pick from. */
  columns: ExploreColumn[];
  /** Built-in views the table's roles allow. */
  views: string[];
  roles: ExploreRoleMap;
}

/** An analysis and the numbers its latest finished run recorded. */
export interface ReportAnalysis {
  analysisId: string;
  name: string;
  /** The flow this step is on, when the scope has flows. */
  flowId?: string | null;
  flowName?: string | null;
  /** What the latest finished run wrote about its result. */
  notes?: string[];
  findings?: ReportFindingRef[];
  runNumber: string | null;
  /** The numbered recipe run the numbers come from ("Run #8"); runNumber stays the step run's own id. */
  flowRunNumber?: number | null;
  metrics: Record<string, string | number | boolean | null>;
  /** Per metric, what it counts and the filters it used, when the step recorded a definition. */
  metricDefinitions?: Record<string, import("./metric-definition").MetricDefinition>;
  /** How the page cites this step; fixed once given. */
  slug?: string | null;
  /** The newest run, which may be newer than the one the numbers come from. */
  latestRun?: { runNumber: string; flowRunNumber?: number | null; status: string } | null;
  /** Where the numbers come from: template, run, tables read and parameters used. */
  kitId?: string | null;
  runId?: string | null;
  completedAt?: string | null;
  inputs?: Array<{ alias: string; datasetId: string; name: string }>;
  params?: Record<string, unknown>;
  /** The settings the run behind `metrics` ran with; Methods cite these, not the step's current settings. */
  runParams?: Record<string, unknown>;
  /** Metrics of the last completed runs, oldest first, for trends on key figures; `params` are that run's settings. */
  history?: Array<{ runNumber: string; flowRunNumber?: number | null; completedAt: string | null; metrics: Record<string, string | number | boolean | null>; params?: Record<string, unknown> }>;
}

/** What a chart or numbers block needs to know about its table; the rows come from the rows API. */
export interface ReportTableMeta {
  datasetId: string;
  name: string;
  columns: ExploreColumn[];
  rowCount: number;
}

/** Everything of a scope that a report can point at. */
export interface ReportOutputs {
  figures: ReportFigure[];
  tables: ReportTable[];
  analyses: ReportAnalysis[];
}

export interface ReportTableContent {
  datasetId: string;
  name: string;
  version: number | null;
  columns: ExploreColumn[];
  rows: ExploreRowData[];
  rowCount: number;
  columnCount: number;
}

/** A report text a step saved (Markdown or HTML), by name. */
export interface ReportFindingRef {
  name: string;
  format: string;
  url: string;
}
/** A finding block's content: the step's notes, or the named report text. */
export interface ReportFinding {
  name: string | null;
  format: string;
  content: string;
  runNumber: string | null;
}
export const MAX_FINDING_BYTES = 200_000;

export type ResolvedReportBlock =
  | Extract<ReportBlock, { type: "text" }>
  | (Extract<ReportBlock, { type: "finding" }> & { analysis: ReportAnalysis | null; finding: ReportFinding | null })
  | (Extract<ReportBlock, { type: "figure" }> & { figure: ReportFigure | null; newer?: { runNumber: string; flowRunNumber: number | null } })
  | (Extract<ReportBlock, { type: "table" }> & { table: ReportTableContent | null })
  | (Extract<ReportBlock, { type: "chart" }> & { table: ReportTableMeta | null })
  | (Extract<ReportBlock, { type: "metric" }> & { table: ReportTableMeta | null })
  | (Extract<ReportBlock, { type: "view" }> & { table: ReportTableMeta | null; available: boolean })
  | (Extract<ReportBlock, { type: "taxon-explorer" }> & { table: ReportTableMeta | null })
  | (Extract<ReportBlock, { type: "subject" }> & { table: ReportTableMeta | null })
  | (Extract<ReportBlock, { type: "curated" }> & { table: ReportTableMeta | null })
  | (Extract<ReportBlock, { type: "run-metric" }> & { analysis: ReportAnalysis | null })
  | Extract<ReportBlock, { type: "flow-map" }>;

/** A live share link: with mode "link" anyone with the token reads the page; with "named" only invited people who signed in through the collaboration server, or members of a lab the server serves. */
export type ReportShareMode = "link" | "named";
export interface ReportShare {
  token: string;
  publishedAt: string;
  mode: ReportShareMode;
}
export const shareModeOf = (value: unknown): ReportShareMode => value === "named" ? "named" : "link";

export interface ReportView {
  id: string;
  targetKey: string;
  title: string;
  share: ReportShare | null;
  /** Page filters: columns readers can narrow every block by. */
  filters: ReportFilter[];
  /** What shared and exported copies may contain beyond the page. */
  sharing: ReportSharing;
  /** True when nothing is saved yet and the blocks were assembled from the outputs. */
  draft: boolean;
  updatedAt: string | null;
  pages?: ReportPage[];
  blocks: ResolvedReportBlock[];
  outputs: ReportOutputs;
}

export class ExploreReportError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Figures and tables of a report's canvas (or of the whole scope), from the same graph the canvas shows. */
export async function collectReportOutputs(targetKey: string, reportId: string | null = null): Promise<ReportOutputs> {
  const graph = await loadCanvasGraph(targetKey, reportId);
  const analysisNames = new Map<string, string>();
  const flowNames = new Map<string, string | null>();
  const datasetNames = new Map(graph.nodes.flatMap((node) => (node.data.kind === "dataset" ? [[node.data.datasetId, node.data.name] as const] : [])));
  const analyses: ReportAnalysis[] = [];
  for (const node of graph.nodes) {
    if (node.data.kind !== "analysis") continue;
    analysisNames.set(node.data.analysisId, node.data.name);
    flowNames.set(node.data.analysisId, node.data.flowName ?? null);
    analyses.push({
      analysisId: node.data.analysisId,
      name: node.data.name,
      flowId: node.data.flowId ?? null,
      flowName: node.data.flowName ?? null,
      notes: node.data.notes ?? [],
      findings: node.data.findings ?? [],
      runNumber: node.data.metricsRunNumber ?? null,
      flowRunNumber: node.data.metricsFlowRunNumber ?? null,
      metrics: node.data.metrics ?? {},
      metricDefinitions: node.data.metricDefinitions ?? {},
      slug: node.data.slug ?? null,
      latestRun: node.data.latestRun ? { runNumber: node.data.latestRun.runNumber, flowRunNumber: node.data.latestRun.flowRunNumber ?? null, status: node.data.latestRun.status } : null,
      kitId: node.data.kitId,
      runId: node.data.metricsRunId ?? null,
      completedAt: node.data.metricsCompletedAt ?? null,
      history: node.data.metricHistory ?? [],
      inputs: (node.data.inputs ?? []).map((binding) => ({ alias: binding.alias, datasetId: binding.datasetId, name: datasetNames.get(binding.datasetId) ?? binding.alias })),
      params: node.data.params ?? {},
      runParams: node.data.metricsRunParams ?? {},
    });
  }
  const figures: ReportFigure[] = [];
  const tables: ReportTable[] = [];
  for (const node of graph.nodes) {
    if (node.data.kind === "figure" && node.data.analysisId) {
      figures.push({
        analysisId: node.data.analysisId,
        analysisName: analysisNames.get(node.data.analysisId) ?? "Analysis",
        figureName: node.data.name,
        runId: node.data.runId,
        runNumber: node.data.runNumber ?? "",
        flowRunNumber: node.data.flowRunNumber ?? null,
        format: node.data.format,
        url: node.data.url,
        thumbnailUrl: node.data.thumbnailUrl,
        unchanged: Boolean(node.data.unchanged),
        autoInclude: node.data.autoInclude,
        flowName: flowNames.get(node.data.analysisId) ?? null,
      });
    } else if (node.data.kind === "dataset") {
      tables.push({
        datasetId: node.data.datasetId,
        name: node.data.name,
        kind: node.data.datasetKind,
        flowName: node.data.producer ? flowNames.get(node.data.producer) ?? null : null,
        producer: node.data.producer ?? null,
        output: node.data.datasetKind === "derived",
        autoInclude: node.data.autoInclude,
        rowCount: node.data.rowCount,
        columnCount: node.data.columnCount,
        version: node.data.version,
        latestWrite: node.data.latestWrite ?? null,
        columns: node.data.columns.filter((column) => !column.key.endsWith("_db_id")),
        views: node.data.views,
        roles: node.data.roles,
      });
    }
  }
  tables.sort((a, b) => Number(b.output) - Number(a.output));
  return { figures, tables, analyses };
}

/** The draft shown before anything is saved: a short intro, every figure, every output table. */
export function suggestReportBlocks(outputs: ReportOutputs): ReportBlock[] {
  const outputTables = outputs.tables.filter((table) => table.output && table.autoInclude !== false);
  const figures = outputs.figures.filter(figure => figure.autoInclude !== false);
  const hasOutputs = figures.length + outputTables.length > 0;
  const blocks: ReportBlock[] = [
    {
      id: "text:intro",
      type: "text",
      markdown: hasOutputs
        ? "The figures and tables below are the current outputs of the analyses in this scope. They update whenever an analysis runs again. Edit this page to describe the results and arrange them."
        : "Edit this page and use Browse data to add metadata, pipeline output tables or saved figures. Charts can be built directly from a table; analyses are optional.",
    },
  ];
  for (const figure of figures) {
    blocks.push({
      id: figureBlockId(figure.analysisId, figure.figureName),
      type: "figure",
      analysisId: figure.analysisId,
      figureName: figure.figureName,
      caption: `${figure.figureName} (${figure.analysisName})`,
      span: figures.length > 1 ? 1 : 2,
    });
  }
  for (const table of outputTables) {
    blocks.push({ id: tableBlockId(table.datasetId), type: "table", datasetId: table.datasetId, caption: table.name, span: 2 });
  }
  return blocks;
}

export type ReportTableLoader = (datasetId: string, limit: number) => Promise<ReportTableContent | null>;

/**
 * Attach live content to blocks. Figures and tables resolve only against the
 * outputs of the report's own scope, so a block can never show another scope's data.
 */
export type ReportFindingLoader = (url: string) => Promise<string | null>;

/** The content of a finding block: the step's notes, or the named report text the step saved with its latest finished run. */
async function resolveFinding(analysis: ReportAnalysis, name: string | undefined, loadFinding: ReportFindingLoader): Promise<ReportFinding | null> {
  if (!name) {
    // Notes the helper writes about the environment (a missing PNG exporter) are not findings.
    const notes = (analysis.notes ?? []).filter((note) => !/^(PNG export of plotly figures skipped|Kaleido|Chrome)/i.test(note.trim()));
    return notes.length ? { name: null, format: "md", content: notes.join("\n\n"), runNumber: analysis.runNumber } : null;
  }
  const ref = (analysis.findings ?? []).find((entry) => entry.name === name);
  if (!ref) return null;
  const content = await loadFinding(ref.url);
  return content === null ? null : { name, format: ref.format, content, runNumber: analysis.runNumber };
}

/** Read a saved report text of a run from disk, capped so a page never embeds a huge file. */
export async function loadFindingContent(url: string): Promise<string | null> {
  const match = url.match(/\/runs\/([^/]+)\/artifacts\/([^/?]+)/);
  if (!match) return null;
  const [, runId, artifactId] = match;
  const [run, artifact] = await Promise.all([
    db.exploreAnalysisRun.findUnique({ where: { id: runId }, select: { runFolder: true } }),
    db.exploreArtifact.findFirst({ where: { id: artifactId, runId } }),
  ]);
  if (!run?.runFolder || !artifact) return null;
  const filePath = await resolveContainedPath(run.runFolder, artifact.path).catch(() => null);
  if (!filePath) return null;
  const content = await fs.readFile(filePath).catch(() => null);
  if (!content) return null;
  return content.subarray(0, MAX_FINDING_BYTES).toString("utf8") + (content.length > MAX_FINDING_BYTES ? "\n\n… (shortened)" : "");
}

/** The figure a step drew in one of its earlier runs, for a figure pinned to that run. */
export type PinnedFigureLoader = (figure: ReportFigure, run: string) => Promise<ReportFigure | null>;
async function loadPinnedFigure(figure: ReportFigure, run: string): Promise<ReportFigure | null> {
  const found = await db.exploreAnalysisRun.findUnique({ where: { runNumber: run }, select: { id: true, analysisId: true, runNumber: true, flowRun: { select: { number: true } }, artifacts: { where: { kind: "figure", name: figure.figureName }, select: { id: true, format: true } } } }).catch(() => null);
  if (!found || found.analysisId !== figure.analysisId || !found.artifacts.length) return null;
  const main = found.artifacts.find((artifact) => artifact.format === figure.format) ?? found.artifacts.find((artifact) => ["plotly-json", "html"].includes(artifact.format)) ?? found.artifacts[0];
  const image = found.artifacts.find((artifact) => artifact.format === "png" || artifact.format === "svg");
  const url = (id: string) => `/api/explore/runs/${found.id}/artifacts/${id}`;
  return { ...figure, runId: found.id, runNumber: found.runNumber, flowRunNumber: found.flowRun?.number ?? null, format: main.format, url: url(main.id), thumbnailUrl: image ? url(image.id) : null, unchanged: false };
}

export async function resolveReportBlocks(blocks: ReportBlock[], outputs: ReportOutputs, loadTable: ReportTableLoader, loadFinding: ReportFindingLoader = loadFindingContent, loadPinned: PinnedFigureLoader = loadPinnedFigure): Promise<ResolvedReportBlock[]> {
  const figureByKey = new Map(outputs.figures.map((figure) => [`${figure.analysisId}:${figure.figureName}`, figure] as const));
  const tableById = new Map(outputs.tables.map((table) => [table.datasetId, table] as const));
  const metaOf = (datasetId: string): ReportTableMeta | null => {
    const table = tableById.get(datasetId);
    return table ? { datasetId, name: table.name, columns: table.columns, rowCount: table.rowCount } : null;
  };
  return Promise.all(
    blocks.map(async (block): Promise<ResolvedReportBlock> => {
      if (block.type === "text" || block.type === "flow-map") return block;
      if (block.type === "finding") {
        const analysis = outputs.analyses.find((entry) => entry.analysisId === block.analysisId) ?? null;
        return { ...block, analysis, finding: analysis ? await resolveFinding(analysis, block.name, loadFinding) : null };
      }
      if (block.type === "figure") {
        const latest = figureByKey.get(`${block.analysisId}:${block.figureName}`) ?? null;
        // A figure pinned to an earlier run keeps showing that run's drawing; the newer run is reported, never swapped in.
        if (!block.pin || !latest || latest.runNumber === block.pin.run) return { ...block, figure: latest };
        const pinned = await loadPinned(latest, block.pin.run);
        return { ...block, figure: pinned ?? latest, newer: { runNumber: latest.runNumber, flowRunNumber: latest.flowRunNumber ?? null } };
      }
      if (block.type === "chart" || block.type === "metric") return { ...block, table: metaOf(block.datasetId) };
      if (block.type === "view") return { ...block, table: metaOf(block.datasetId), available: Boolean(tableById.get(block.datasetId)?.views.includes(block.view)) };
      if (block.type === "taxon-explorer" || block.type === "subject" || block.type === "curated") return { ...block, table: metaOf(block.datasetId) };
      if (block.type === "run-metric") return { ...block, analysis: outputs.analyses.find((analysis) => analysis.analysisId === block.analysisId) ?? null };
      return { ...block, table: tableById.has(block.datasetId) ? await loadTable(block.datasetId, block.rows ?? REPORT_TABLE_ROWS) : null };
    })
  );
}

async function loadTableContent(datasetId: string, limit: number): Promise<ReportTableContent | null> {
  const dataset = await db.exploreDataset.findUnique({
    where: { id: datasetId },
    include: { versions: { orderBy: { number: "desc" }, take: 1 } },
  });
  if (!dataset) return null;
  const current = dataset.versions.find((version) => version.id === dataset.currentVersionId) ?? dataset.versions[0] ?? null;
  const columns = parseSchema(current?.schema).columns.filter((column) => !column.key.endsWith("_db_id"));
  const page = current ? await fetchDatasetRows(current.id, { limit }) : { rows: [] };
  return {
    datasetId,
    name: dataset.name,
    version: current?.number ?? null,
    columns,
    rows: page.rows.map((row) => row.data),
    rowCount: current?.rowCount ?? 0,
    columnCount: columns.length,
  };
}

/** Page filters as stored in settings; anything unreadable is dropped. */
export function parseStoredFilters(raw: unknown): ReportFilter[] {
  const settings = raw && typeof raw === "object" ? (raw as { filters?: unknown }) : null;
  if (!settings || !Array.isArray(settings.filters)) return [];
  const filters: ReportFilter[] = [];
  for (const entry of settings.filters) {
    const parsed = ReportFilterSchema.safeParse(entry);
    if (parsed.success) filters.push(parsed.data);
  }
  return filters;
}

/** Sharing settings as stored; input rows stay out of shared copies unless the author switched them on. */
export function parseStoredSharing(raw: unknown): ReportSharing {
  const settings = raw && typeof raw === "object" ? (raw as { sharing?: unknown }) : null;
  const parsed = settings ? ReportSharingSchema.safeParse(settings.sharing) : null;
  return parsed?.success ? parsed.data : { inputRows: false };
}

/** One report in a list: enough for a card or a sidebar entry. */
export interface ReportSummary {
  id: string;
  targetKey: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Analysis steps that belong to the report. */
  analysisCount: number;
  /** Saved blocks; zero means the page is a draft assembled from the outputs. */
  blockCount: number;
  /** At least one analysis on this report's canvas has completed successfully. */
  hasSuccessfulRun: boolean;
  /** The page's blocks as kinds and widths, enough to sketch a thumbnail of the page. */
  layout: { type: string; span: 1 | 2 }[];
  /** Whether a public share link is live. */
  shared: boolean;
}

export interface ReportListResponse {
  reports: ReportSummary[];
  canEdit: boolean;
}

const withSummary = {
  _count: { select: { analyses: true } },
  // Check the full run history, so a failed rerun does not erase an earlier success.
  analyses: {
    where: { runs: { some: { status: "completed" } } },
    select: { id: true },
    take: 1,
  },
} as const;

type StoredReportRow = Prisma.ExploreReportGetPayload<{ include: typeof withSummary }>;

function summarize(report: StoredReportRow): ReportSummary {
  return {
    id: report.id,
    targetKey: report.targetKey,
    title: report.title,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    analysisCount: report._count.analyses,
    blockCount: parseStoredBlocks(report.blocks).length,
    hasSuccessfulRun: report.analyses.length > 0,
    layout: parseStoredBlocks(report.blocks).map((block) => ({ type: block.type, span: block.span === 1 || block.span === 2 ? block.span : block.type === "figure" || block.type === "chart" || block.type === "metric" ? 1 : 2 })),
    shared: Boolean(report.shareToken && report.publishedAt),
  };
}

/** The reports of a scope, oldest first. */
export async function listReports(targetKey: string): Promise<ReportSummary[]> {
  const reports = await db.exploreReport.findMany({ where: { targetKey }, orderBy: { createdAt: "asc" }, include: withSummary });
  return reports.map(summarize);
}

/** A new, empty report: its page is a draft of its outputs until blocks are saved. */
export async function createReport(targetKey: string, userId: string, title?: string | null): Promise<ReportSummary> {
  const count = await db.exploreReport.count({ where: { targetKey } });
  const name = (title?.trim() || `Report ${count + 1}`).slice(0, 200);
  const created = await db.exploreReport.create({ data: { targetKey, title: name, blocks: [], createdById: userId }, include: withSummary });
  return summarize(created);
}

export async function getReportRecord(id: string): Promise<{ id: string; targetKey: string; title: string } | null> {
  return db.exploreReport.findUnique({ where: { id }, select: { id: true, targetKey: true, title: true } });
}

/**
 * How a report view is assembled: SeqDesk's own pages read the outputs of the
 * report's canvas and start as a draft of them; Flow pages read every flow of
 * the scope and start empty, the author composes them.
 */
export interface ReportViewOptions {
  /** "report": the report's own steps (default). "scope": every step of the scope, across flows. */
  outputs?: "report" | "scope";
  /** Whether an unsaved page is filled with every output (default true). */
  suggest?: boolean;
}

export async function getReportView(reportId: string, options: ReportViewOptions = {}): Promise<ReportView> {
  const stored = await db.exploreReport.findUnique({ where: { id: reportId } });
  if (!stored) throw new ExploreReportError(404, "Report not found");
  const outputs = await collectReportOutputs(stored.targetKey, options.outputs === "scope" ? null : stored.id);
  const storedBlocks = parseStoredBlocks(stored.blocks);
  const savedPages = stored.settings && typeof stored.settings === "object" ? (stored.settings as { pages?: unknown }).pages : undefined;
  // Explicitly saved empty pages are authored content, not an unsaved auto-generated draft.
  const draft = storedBlocks.length === 0 && !ReportPagesSchema.safeParse(savedPages).success;
  const reportBlocks = draft && options.suggest !== false ? suggestReportBlocks(outputs) : storedBlocks;
  return {
    id: stored.id,
    targetKey: stored.targetKey,
    title: stored.title,
    share: stored.shareToken && stored.publishedAt ? { token: stored.shareToken, publishedAt: stored.publishedAt.toISOString(), mode: shareModeOf(stored.shareMode) } : null,
    filters: parseStoredFilters(stored.settings),
    sharing: parseStoredSharing(stored.settings),
    draft,
    updatedAt: stored.updatedAt.toISOString(),
    pages: reconcileReportPages(savedPages, reportBlocks),
    blocks: await resolveReportBlocks(reportBlocks, outputs, loadTableContent),
    outputs,
  };
}

/** Validate and store the page of a report: title, ordered blocks and filters. */
export async function saveReport(reportId: string, raw: unknown, options: ReportViewOptions = {}): Promise<ReportView> {
  const parsed = ReportInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ExploreReportError(400, issue ? `${issue.path.join(".") || "report"}: ${issue.message}` : "Invalid report");
  }
  const ids = new Set<string>();
  for (const block of parsed.data.blocks) {
    if (ids.has(block.id)) throw new ExploreReportError(400, `Block id ${block.id} is used twice`);
    ids.add(block.id);
  }
  const existing = await db.exploreReport.findUnique({ where: { id: reportId }, select: { id: true, updatedAt: true, settings: true } });
  if (!existing) throw new ExploreReportError(404, "Report not found");
  let blocks = parsed.data.blocks as unknown as Prisma.InputJsonValue;
  const savedPages = existing.settings && typeof existing.settings === "object" ? (existing.settings as { pages?: unknown }).pages : undefined;
  const pages = parsed.data.pages ?? reconcileReportPages(savedPages, parsed.data.blocks);
  const pagesError = validateReportPages(pages, parsed.data.blocks);
  if (pagesError) throw new ExploreReportError(400, pagesError);
  if (parsed.data.pages && !parsed.data.expectedUpdatedAt) throw new ExploreReportError(400, "Saving pages requires expectedUpdatedAt");
  if (parsed.data.pages) blocks = pages.flatMap(page => page.blockIds.map(id => parsed.data.blocks.find(block => block.id === id)!)) as unknown as Prisma.InputJsonValue;
  const settings = { pages, filters: parsed.data.filters ?? [], sharing: parsed.data.sharing ?? parseStoredSharing(existing.settings) } as unknown as Prisma.InputJsonValue;
  // Two editors: the write only lands on the version the editor saw, so the
  // second save of the same version is refused instead of overwriting the first.
  const expected = parsed.data.expectedUpdatedAt ? new Date(parsed.data.expectedUpdatedAt) : null;
  if (expected && Number.isNaN(expected.getTime())) throw new ExploreReportError(400, "expectedUpdatedAt is not a date");
  const written = await db.exploreReport.updateMany({
    where: { id: reportId, ...(expected ? { updatedAt: expected } : {}) },
    data: { title: parsed.data.title, blocks, settings },
  });
  if (written.count === 0) {
    throw new ExploreReportError(409, "This page was changed elsewhere since you opened it; reload to see the latest version before editing further.");
  }
  return getReportView(reportId, options);
}

export async function renameReport(reportId: string, title: string): Promise<ReportSummary> {
  const name = title.trim().slice(0, 200);
  if (!name) throw new ExploreReportError(400, "A report needs a title");
  const existing = await db.exploreReport.findUnique({ where: { id: reportId }, select: { id: true } });
  if (!existing) throw new ExploreReportError(404, "Report not found");
  const updated = await db.exploreReport.update({ where: { id: reportId }, data: { title: name }, include: withSummary });
  return summarize(updated);
}

/** Drop the saved page so it goes back to the draft assembled from the outputs; the analysis steps stay. */
export async function resetReport(reportId: string, options: ReportViewOptions = {}): Promise<ReportView> {
  const existing = await db.exploreReport.findUnique({ where: { id: reportId }, select: { id: true } });
  if (!existing) throw new ExploreReportError(404, "Report not found");
  await db.exploreReport.update({ where: { id: reportId }, data: { blocks: [], settings: { filters: [] } } });
  return getReportView(reportId, options);
}

/** Issue (or replace) the share link of a report. */
export async function shareReport(reportId: string, mode?: ReportShareMode): Promise<ReportShare> {
  const existing = await db.exploreReport.findUnique({ where: { id: reportId }, select: { id: true, shareMode: true } });
  if (!existing) throw new ExploreReportError(404, "Report not found");
  const token = randomBytes(18).toString("base64url");
  const updated = await db.exploreReport.update({ where: { id: reportId }, data: { shareToken: token, publishedAt: new Date(), ...(mode ? { shareMode: mode } : {}) }, select: { shareToken: true, publishedAt: true, shareMode: true } });
  return { token: updated.shareToken ?? token, publishedAt: (updated.publishedAt ?? new Date()).toISOString(), mode: shareModeOf(updated.shareMode) };
}

/** Switch a live link between "anyone with the link" and "invited people"; the token stays. */
export async function setShareMode(reportId: string, mode: ReportShareMode): Promise<ReportShare> {
  const existing = await db.exploreReport.findUnique({ where: { id: reportId }, select: { shareToken: true, publishedAt: true } });
  if (!existing) throw new ExploreReportError(404, "Report not found");
  if (!existing.shareToken || !existing.publishedAt) throw new ExploreReportError(400, "Create a share link first");
  const updated = await db.exploreReport.update({ where: { id: reportId }, data: { shareMode: mode }, select: { shareToken: true, publishedAt: true, shareMode: true } });
  return { token: updated.shareToken!, publishedAt: updated.publishedAt!.toISOString(), mode: shareModeOf(updated.shareMode) };
}

/** Withdraw the share link; the old token stops working at once. */
export async function unshareReport(reportId: string): Promise<void> {
  const existing = await db.exploreReport.findUnique({ where: { id: reportId }, select: { id: true } });
  if (!existing) throw new ExploreReportError(404, "Report not found");
  await db.exploreReport.update({ where: { id: reportId }, data: { shareToken: null, publishedAt: null } });
}

/** The report a share token opens, or null when the token is unknown or withdrawn. */
export async function findSharedReportId(token: string): Promise<string | null> {
  const report = await db.exploreReport.findFirst({ where: { shareToken: token, publishedAt: { not: null } }, select: { id: true } });
  return report?.id ?? null;
}
/** The shared report behind a token with what a viewer must satisfy to read it. */
export async function findSharedReport(token: string): Promise<{ id: string; targetKey: string; mode: ReportShareMode } | null> {
  const report = await db.exploreReport.findFirst({ where: { shareToken: token, publishedAt: { not: null } }, select: { id: true, targetKey: true, shareMode: true } });
  return report ? { id: report.id, targetKey: report.targetKey, mode: shareModeOf(report.shareMode) } : null;
}

/** Delete a report with its analysis steps and their runs; the scope's tables stay. */
export async function deleteReport(reportId: string): Promise<void> {
  const existing = await db.exploreReport.findUnique({ where: { id: reportId }, select: { id: true } });
  if (!existing) throw new ExploreReportError(404, "Report not found");
  await db.exploreReport.delete({ where: { id: reportId } });
}
