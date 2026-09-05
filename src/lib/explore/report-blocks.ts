/**
 * Report blocks: the stored shape of a report page. Client-safe (zod only), so
 * the canvas, the report page and the server share one definition.
 */
import { z } from "zod";

export const MAX_REPORT_BLOCKS = 60;

const BlockId = z.string().min(1).max(120);
const Span = z.union([z.literal(1), z.literal(2)]).optional();
const TextBlockSchema = z.object({ id: BlockId, type: z.literal("text"), markdown: z.string().max(20000), span: Span }).strict();
const FigureBlockSchema = z
  .object({
    id: BlockId,
    type: z.literal("figure"),
    analysisId: z.string().min(1).max(80),
    figureName: z.string().min(1).max(120),
    caption: z.string().max(500).optional(),
    span: Span,
  })
  .strict();
const TableBlockSchema = z
  .object({
    id: BlockId,
    type: z.literal("table"),
    datasetId: z.string().min(1).max(80),
    caption: z.string().max(500).optional(),
    rows: z.number().int().min(1).max(50).optional(),
    span: Span,
  })
  .strict();

/** Charts a report can draw straight from a table, without an analysis. */
export const CHART_KINDS = ["histogram", "bar", "scatter", "box"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];
export const CHART_KIND_LABELS: Record<ChartKind, { label: string; description: string; needsY: boolean }> = {
  histogram: { label: "Histogram", description: "How the values of one numeric column are distributed", needsY: false },
  bar: { label: "Bar chart", description: "How many rows fall into each value of a column", needsY: false },
  scatter: { label: "Dot plot", description: "One dot per row, two numeric columns against each other", needsY: true },
  box: { label: "Box plot", description: "A numeric column summarised per group", needsY: true },
};

/** Summary numbers a report can show for one column. */
export const METRIC_STATS = ["count", "distinct", "missing", "mean", "median", "min", "max", "sum"] as const;
export type MetricStat = (typeof METRIC_STATS)[number];
export const METRIC_STAT_LABELS: Record<MetricStat, string> = {
  count: "Rows",
  distinct: "Distinct values",
  missing: "Missing",
  mean: "Mean",
  median: "Median",
  min: "Minimum",
  max: "Maximum",
  sum: "Sum",
};

const ChartBlockSchema = z
  .object({
    id: BlockId,
    type: z.literal("chart"),
    datasetId: z.string().min(1).max(80),
    chart: z.enum(CHART_KINDS),
    /** The column on the x axis: the values for a histogram or bar chart, the groups for a box plot. */
    x: z.string().min(1).max(200),
    /** The second numeric column of a dot plot, or the values of a box plot. */
    y: z.string().max(200).optional(),
    /** A column whose values colour the dots or split the bars. */
    color: z.string().max(200).optional(),
    caption: z.string().max(500).optional(),
    span: Span,
  })
  .strict();

const MetricBlockSchema = z
  .object({
    id: BlockId,
    type: z.literal("metric"),
    datasetId: z.string().min(1).max(80),
    column: z.string().min(1).max(200),
    stats: z.array(z.enum(METRIC_STATS)).min(1).max(4),
    label: z.string().max(200).optional(),
    span: Span,
  })
  .strict();

export const BUILT_IN_VIEW_IDS = ["subject-timeline", "heatmap"] as const;

const ViewBlockSchema = z
  .object({
    id: BlockId,
    type: z.literal("view"),
    datasetId: z.string().min(1).max(80),
    view: z.enum(BUILT_IN_VIEW_IDS),
    /** View-specific choices, for example the heatmap's value, order and taxa count. */
    options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    caption: z.string().max(500).optional(),
    span: Span,
  })
  .strict();

/** One organism of a long profile table: prevalence and abundance per group, carriers on the timeline. */
const TaxonExplorerBlockSchema = z
  .object({
    id: BlockId,
    type: z.literal("taxon-explorer"),
    datasetId: z.string().min(1).max(80),
    /** The organism shown first; readers can pick another. */
    taxon: z.string().max(200).optional(),
    caption: z.string().max(500).optional(),
    span: Span,
  })
  .strict();

/** One subject of a long profile table: its composition over time per group. */
const SubjectBlockSchema = z
  .object({
    id: BlockId,
    type: z.literal("subject"),
    datasetId: z.string().min(1).max(80),
    subject: z.string().max(200).optional(),
    measure: z.enum(["ra", "reads"]).optional(),
    caption: z.string().max(500).optional(),
    span: Span,
  })
  .strict();

/** Organisms of interest: the taxa on the scope's curation lists that a long profile table contains. */
const CuratedBlockSchema = z
  .object({
    id: BlockId,
    type: z.literal("curated"),
    datasetId: z.string().min(1).max(80),
    /** Which lists count: pathogen (default), flora, or every list. */
    role: z.enum(["pathogen", "flora", "all"]).optional(),
    /** Restrict to these lists by id; absent or empty means every list of the role. */
    lists: z.array(z.string().min(1).max(64)).max(20).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    caption: z.string().max(500).optional(),
    span: Span,
  })
  .strict();

/** A number an analysis recorded with its latest run, shown as a summary card. */
const RunMetricBlockSchema = z
  .object({
    id: BlockId,
    type: z.literal("run-metric"),
    analysisId: z.string().min(1).max(80),
    metrics: z.array(z.string().min(1).max(120)).min(1).max(4),
    label: z.string().max(200).optional(),
    span: Span,
  })
  .strict();

export const ReportBlockSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  FigureBlockSchema,
  TableBlockSchema,
  ChartBlockSchema,
  MetricBlockSchema,
  ViewBlockSchema,
  TaxonExplorerBlockSchema,
  SubjectBlockSchema,
  CuratedBlockSchema,
  RunMetricBlockSchema,
]);

/** A page-level filter: a column of a table; every block reading a table with that column honours it. */
export const ReportFilterSchema = z
  .object({
    id: z.string().min(1).max(120),
    datasetId: z.string().min(1).max(80),
    column: z.string().min(1).max(200),
    label: z.string().max(120).optional(),
  })
  .strict();
export type ReportFilter = z.infer<typeof ReportFilterSchema>;
export const MAX_REPORT_FILTERS = 6;
export const ReportInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    blocks: z.array(ReportBlockSchema).max(MAX_REPORT_BLOCKS),
    filters: z.array(ReportFilterSchema).max(MAX_REPORT_FILTERS).optional(),
  })
  .strict();

export type ReportBlock = z.infer<typeof ReportBlockSchema>;
export type ReportInput = z.infer<typeof ReportInputSchema>;

export function figureBlockId(analysisId: string, figureName: string): string {
  return `figure:${analysisId}:${figureName}`;
}

export function tableBlockId(datasetId: string): string {
  return `table:${datasetId}`;
}

export function viewBlockId(datasetId: string, view: string): string {
  return `view:${datasetId}:${view}`;
}

/** Stored blocks are validated on the way out too: a block the code no longer understands is dropped, not crashed on. */
export function parseStoredBlocks(raw: unknown): ReportBlock[] {
  if (!Array.isArray(raw)) return [];
  const blocks: ReportBlock[] = [];
  for (const entry of raw) {
    const parsed = ReportBlockSchema.safeParse(entry);
    if (parsed.success) blocks.push(parsed.data);
  }
  return blocks;
}
