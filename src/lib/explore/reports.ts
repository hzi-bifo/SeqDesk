/**
 * Reports: the final page of a scope. A report is an ordered list of blocks
 * (text, figure, table) that point at outputs by stable identity, so a re-run
 * of an analysis updates the report in place. Without a saved report the page
 * shows a draft assembled from every output of the scope.
 */
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { loadCanvasGraph } from "./canvas";
import { fetchDatasetRows } from "./datasets";
import { parseSchema } from "./schema";
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
  tableBlockId,
  type ReportBlock,
  type ReportInput,
} from "./report-blocks";
import { figureBlockId, parseStoredBlocks, ReportFilterSchema, ReportInputSchema, tableBlockId, type ReportBlock, type ReportFilter } from "./report-blocks";
import type { ExploreRoleMap } from "./types";

export interface ReportFigure {
  analysisId: string;
  analysisName: string;
  figureName: string;
  runId: string;
  runNumber: string;
  format: string;
  url: string;
  thumbnailUrl: string | null;
  unchanged: boolean;
}

export interface ReportTable {
  datasetId: string;
  name: string;
  kind: string;
  /** True for tables written by an analysis, the ones a report is about. */
  output: boolean;
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
  runNumber: string | null;
  metrics: Record<string, string | number | boolean | null>;
  /** How the page cites this step; fixed once given. */
  slug?: string | null;
  /** The newest run, which may be newer than the one the numbers come from. */
  latestRun?: { runNumber: string; status: string } | null;
  /** Where the numbers come from: template, run, tables read and parameters used. */
  kitId?: string | null;
  runId?: string | null;
  completedAt?: string | null;
  inputs?: Array<{ alias: string; datasetId: string; name: string }>;
  params?: Record<string, unknown>;
  /** Metrics of the last completed runs, oldest first, for trends on key figures. */
  history?: Array<{ runNumber: string; completedAt: string | null; metrics: Record<string, string | number | boolean | null> }>;
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

export type ResolvedReportBlock =
  | Extract<ReportBlock, { type: "text" }>
  | (Extract<ReportBlock, { type: "figure" }> & { figure: ReportFigure | null })
  | (Extract<ReportBlock, { type: "table" }> & { table: ReportTableContent | null })
  | (Extract<ReportBlock, { type: "chart" }> & { table: ReportTableMeta | null })
  | (Extract<ReportBlock, { type: "metric" }> & { table: ReportTableMeta | null })
  | (Extract<ReportBlock, { type: "view" }> & { table: ReportTableMeta | null; available: boolean })
  | (Extract<ReportBlock, { type: "taxon-explorer" }> & { table: ReportTableMeta | null })
  | (Extract<ReportBlock, { type: "subject" }> & { table: ReportTableMeta | null })
  | (Extract<ReportBlock, { type: "curated" }> & { table: ReportTableMeta | null })
  | (Extract<ReportBlock, { type: "run-metric" }> & { analysis: ReportAnalysis | null });

/** A live share link: anyone with the token reads the page without signing in. */
export interface ReportShare {
  token: string;
  publishedAt: string;
}

export interface ReportView {
  id: string;
  targetKey: string;
  title: string;
  share: ReportShare | null;
  /** Page filters: columns readers can narrow every block by. */
  filters: ReportFilter[];
  /** True when nothing is saved yet and the blocks were assembled from the outputs. */
  draft: boolean;
  updatedAt: string | null;
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
  const datasetNames = new Map(graph.nodes.flatMap((node) => (node.data.kind === "dataset" ? [[node.data.datasetId, node.data.name] as const] : [])));
  const analyses: ReportAnalysis[] = [];
  for (const node of graph.nodes) {
    if (node.data.kind !== "analysis") continue;
    analysisNames.set(node.data.analysisId, node.data.name);
    analyses.push({
      analysisId: node.data.analysisId,
      name: node.data.name,
      runNumber: node.data.metricsRunNumber ?? null,
      metrics: node.data.metrics ?? {},
      slug: node.data.slug ?? null,
      latestRun: node.data.latestRun ? { runNumber: node.data.latestRun.runNumber, status: node.data.latestRun.status } : null,
      kitId: node.data.kitId,
      runId: node.data.metricsRunId ?? null,
      completedAt: node.data.metricsCompletedAt ?? null,
      history: node.data.metricHistory ?? [],
      inputs: (node.data.inputs ?? []).map((binding) => ({ alias: binding.alias, datasetId: binding.datasetId, name: datasetNames.get(binding.datasetId) ?? binding.alias })),
      params: node.data.params ?? {},
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
        format: node.data.format,
        url: node.data.url,
        thumbnailUrl: node.data.thumbnailUrl,
        unchanged: Boolean(node.data.unchanged),
      });
    } else if (node.data.kind === "dataset") {
      tables.push({
        datasetId: node.data.datasetId,
        name: node.data.name,
        kind: node.data.datasetKind,
        output: node.data.datasetKind === "derived",
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
  const outputTables = outputs.tables.filter((table) => table.output);
  const hasOutputs = outputs.figures.length + outputTables.length > 0;
  const blocks: ReportBlock[] = [
    {
      id: "text:intro",
      type: "text",
      markdown: hasOutputs
        ? "The figures and tables below are the current outputs of the analyses in this scope. They update whenever an analysis runs again. Edit this page to describe the results and arrange them."
        : "No analysis has produced a figure or table yet. Run one on the canvas and its outputs appear here.",
    },
  ];
  for (const figure of outputs.figures) {
    blocks.push({
      id: figureBlockId(figure.analysisId, figure.figureName),
      type: "figure",
      analysisId: figure.analysisId,
      figureName: figure.figureName,
      caption: `${figure.figureName} (${figure.analysisName})`,
      span: outputs.figures.length > 1 ? 1 : 2,
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
export async function resolveReportBlocks(blocks: ReportBlock[], outputs: ReportOutputs, loadTable: ReportTableLoader): Promise<ResolvedReportBlock[]> {
  const figureByKey = new Map(outputs.figures.map((figure) => [`${figure.analysisId}:${figure.figureName}`, figure] as const));
  const tableById = new Map(outputs.tables.map((table) => [table.datasetId, table] as const));
  const metaOf = (datasetId: string): ReportTableMeta | null => {
    const table = tableById.get(datasetId);
    return table ? { datasetId, name: table.name, columns: table.columns, rowCount: table.rowCount } : null;
  };
  return Promise.all(
    blocks.map(async (block): Promise<ResolvedReportBlock> => {
      if (block.type === "text") return block;
      if (block.type === "figure") return { ...block, figure: figureByKey.get(`${block.analysisId}:${block.figureName}`) ?? null };
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
}

type StoredReportRow = { id: string; targetKey: string; title: string; blocks: unknown; createdAt: Date; updatedAt: Date; _count: { analyses: number } };

const withCounts = { _count: { select: { analyses: true } } } as const;

function summarize(report: StoredReportRow): ReportSummary {
  return {
    id: report.id,
    targetKey: report.targetKey,
    title: report.title,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    analysisCount: report._count.analyses,
    blockCount: parseStoredBlocks(report.blocks).length,
  };
}

/** The reports of a scope, oldest first. */
export async function listReports(targetKey: string): Promise<ReportSummary[]> {
  const reports = await db.exploreReport.findMany({ where: { targetKey }, orderBy: { createdAt: "asc" }, include: withCounts });
  return reports.map(summarize);
}

/** A new, empty report: its page is a draft of its outputs until blocks are saved. */
export async function createReport(targetKey: string, userId: string, title?: string | null): Promise<ReportSummary> {
  const count = await db.exploreReport.count({ where: { targetKey } });
  const name = (title?.trim() || `Report ${count + 1}`).slice(0, 200);
  const created = await db.exploreReport.create({ data: { targetKey, title: name, blocks: [], createdById: userId }, include: withCounts });
  return summarize(created);
}

export async function getReportRecord(id: string): Promise<{ id: string; targetKey: string; title: string } | null> {
  return db.exploreReport.findUnique({ where: { id }, select: { id: true, targetKey: true, title: true } });
}

export async function getReportView(reportId: string): Promise<ReportView> {
  const stored = await db.exploreReport.findUnique({ where: { id: reportId } });
  if (!stored) throw new ExploreReportError(404, "Report not found");
  const outputs = await collectReportOutputs(stored.targetKey, stored.id);
  const storedBlocks = parseStoredBlocks(stored.blocks);
  const draft = storedBlocks.length === 0;
  return {
    id: stored.id,
    targetKey: stored.targetKey,
    title: stored.title,
    share: stored.shareToken && stored.publishedAt ? { token: stored.shareToken, publishedAt: stored.publishedAt.toISOString() } : null,
    filters: parseStoredFilters(stored.settings),
    draft,
    updatedAt: stored.updatedAt.toISOString(),
    blocks: await resolveReportBlocks(draft ? suggestReportBlocks(outputs) : storedBlocks, outputs, loadTableContent),
    outputs,
  };
}

/** Validate and store the page of a report: title, ordered blocks and filters. */
export async function saveReport(reportId: string, raw: unknown): Promise<ReportView> {
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
  const existing = await db.exploreReport.findUnique({ where: { id: reportId }, select: { id: true, updatedAt: true } });
  if (!existing) throw new ExploreReportError(404, "Report not found");
  // Two editors: the second save of the same version is refused instead of overwriting the first.
  if (parsed.data.expectedUpdatedAt && parsed.data.expectedUpdatedAt !== existing.updatedAt.toISOString()) {
    throw new ExploreReportError(409, "This page was changed elsewhere since you opened it; reload to see the latest version before editing further.");
  }
  const blocks = parsed.data.blocks as unknown as Prisma.InputJsonValue;
  const settings = { filters: parsed.data.filters ?? [] } as unknown as Prisma.InputJsonValue;
  await db.exploreReport.update({ where: { id: reportId }, data: { title: parsed.data.title, blocks, settings } });
  return getReportView(reportId);
}

export async function renameReport(reportId: string, title: string): Promise<ReportSummary> {
  const name = title.trim().slice(0, 200);
  if (!name) throw new ExploreReportError(400, "A report needs a title");
  const existing = await db.exploreReport.findUnique({ where: { id: reportId }, select: { id: true } });
  if (!existing) throw new ExploreReportError(404, "Report not found");
  const updated = await db.exploreReport.update({ where: { id: reportId }, data: { title: name }, include: withCounts });
  return summarize(updated);
}

/** Drop the saved page so it goes back to the draft assembled from the outputs; the analysis steps stay. */
export async function resetReport(reportId: string): Promise<ReportView> {
  const existing = await db.exploreReport.findUnique({ where: { id: reportId }, select: { id: true } });
  if (!existing) throw new ExploreReportError(404, "Report not found");
  await db.exploreReport.update({ where: { id: reportId }, data: { blocks: [], settings: { filters: [] } } });
  return getReportView(reportId);
}

/** Issue (or replace) the share link of a report. */
export async function shareReport(reportId: string): Promise<ReportShare> {
  const existing = await db.exploreReport.findUnique({ where: { id: reportId }, select: { id: true } });
  if (!existing) throw new ExploreReportError(404, "Report not found");
  const token = randomBytes(18).toString("base64url");
  const updated = await db.exploreReport.update({ where: { id: reportId }, data: { shareToken: token, publishedAt: new Date() }, select: { shareToken: true, publishedAt: true } });
  return { token: updated.shareToken ?? token, publishedAt: (updated.publishedAt ?? new Date()).toISOString() };
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

/** Delete a report with its analysis steps and their runs; the scope's tables stay. */
export async function deleteReport(reportId: string): Promise<void> {
  const existing = await db.exploreReport.findUnique({ where: { id: reportId }, select: { id: true } });
  if (!existing) throw new ExploreReportError(404, "Report not found");
  await db.exploreReport.delete({ where: { id: reportId } });
}
