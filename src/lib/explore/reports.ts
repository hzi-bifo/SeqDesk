/**
 * Reports: the final page of a scope. A report is an ordered list of blocks
 * (text, figure, table) that point at outputs by stable identity, so a re-run
 * of an analysis updates the report in place. Without a saved report the page
 * shows a draft assembled from every output of the scope.
 */
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
  MAX_REPORT_BLOCKS,
  parseStoredBlocks,
  ReportBlockSchema,
  ReportInputSchema,
  tableBlockId,
  type ReportBlock,
  type ReportInput,
} from "./report-blocks";
import { figureBlockId, parseStoredBlocks, ReportInputSchema, tableBlockId, type ReportBlock } from "./report-blocks";

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
  | (Extract<ReportBlock, { type: "view" }> & { table: ReportTableMeta | null; available: boolean });

export interface ReportView {
  id: string | null;
  title: string;
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

/** Figures and tables of a scope, from the same graph the canvas shows. */
export async function collectReportOutputs(targetKey: string): Promise<ReportOutputs> {
  const graph = await loadCanvasGraph(targetKey);
  const analysisNames = new Map<string, string>();
  for (const node of graph.nodes) if (node.data.kind === "analysis") analysisNames.set(node.data.analysisId, node.data.name);
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
      });
    }
  }
  tables.sort((a, b) => Number(b.output) - Number(a.output));
  return { figures, tables };
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

export async function getReportView(targetKey: string, scopeLabel: string): Promise<ReportView> {
  const outputs = await collectReportOutputs(targetKey);
  const stored = await db.exploreReport.findFirst({ where: { targetKey }, orderBy: { createdAt: "asc" } });
  const blocks = stored ? parseStoredBlocks(stored.blocks) : suggestReportBlocks(outputs);
  return {
    id: stored?.id ?? null,
    title: stored?.title ?? scopeLabel,
    draft: !stored,
    updatedAt: stored ? stored.updatedAt.toISOString() : null,
    blocks: await resolveReportBlocks(blocks, outputs, loadTableContent),
    outputs,
  };
}

/** Validate and store a report; one report per scope for now. */
export async function saveReport(targetKey: string, raw: unknown, userId: string, scopeLabel: string): Promise<ReportView> {
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
  const blocks = parsed.data.blocks as unknown as Prisma.InputJsonValue;
  const existing = await db.exploreReport.findFirst({ where: { targetKey }, orderBy: { createdAt: "asc" } });
  if (existing) {
    await db.exploreReport.update({ where: { id: existing.id }, data: { title: parsed.data.title, blocks } });
  } else {
    await db.exploreReport.create({ data: { targetKey, title: parsed.data.title, blocks, createdById: userId } });
  }
  return getReportView(targetKey, scopeLabel);
}

/** Drop the saved report so the page goes back to the draft assembled from the outputs. */
export async function resetReport(targetKey: string, scopeLabel: string): Promise<ReportView> {
  await db.exploreReport.deleteMany({ where: { targetKey } });
  return getReportView(targetKey, scopeLabel);
}
