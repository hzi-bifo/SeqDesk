/**
 * Report blocks: the stored shape of a report page. Client-safe (zod only), so
 * the canvas, the report page and the server share one definition.
 */
import { z } from "zod";

export const MAX_REPORT_BLOCKS = 60;

const BlockId = z.string().min(1).max(120);
const Span = z.union([z.literal(1), z.literal(2)]).optional();
/** Free size: width in twelfths of the page (span stays the coarse fallback) and a height in pixels. */
const Size = z.object({ columns: z.number().int().min(2).max(12).optional(), height: z.number().int().min(120).max(2000).optional() }).strict().optional();
const TextBlockSchema = z.object({ id: BlockId, type: z.literal("text"), markdown: z.string().max(20000), span: Span, size: Size }).strict();
const FigureBlockSchema = z
  .object({
    id: BlockId,
    type: z.literal("figure"),
    analysisId: z.string().min(1).max(80),
    figureName: z.string().min(1).max(120),
    caption: z.string().max(500).optional(),
    /** The step run the figure was placed from: a newer run marks it ◇ until a person updates it (sheet 48 F1). */
    pin: z.object({ run: z.string().min(1).max(80) }).strict().optional(),
    span: Span, size: Size,
  })
  .strict();
/** A table of the scope as the page shows it: which columns, which rows, in what order, and what readers may do. */
const TableBlockSchema = z
  .object({
    id: BlockId,
    type: z.literal("table"),
    datasetId: z.string().min(1).max(80),
    caption: z.string().max(500).optional(),
    rows: z.number().int().min(1).max(500).optional(),
    /** Columns to show, in this order; absent means every column. */
    columns: z.array(z.string().min(1).max(200)).max(60).optional(),
    sort: z.object({ column: z.string().min(1).max(200), direction: z.enum(["asc", "desc"]) }).strict().optional(),
    /** A row filter in R notation, e.g. `specimen_type == "Urine" & q_value < 0.05`. */
    filter: z.string().max(500).optional(),
    /** What readers may do with the table. */
    search: z.boolean().optional(),
    sortable: z.boolean().optional(),
    download: z.boolean().optional(),
    span: Span, size: Size,
  })
  .strict();

/** Charts a report can draw straight from a table, without an analysis. */
export const CHART_KINDS = ["values", "histogram", "bar", "scatter", "box"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];
export const CHART_KIND_LABELS: Record<ChartKind, { label: string; description: string; needsY: boolean }> = {
  values: { label: "Values by sample", description: "A saved measurement for each sample or category; values are not summed", needsY: true },
  histogram: { label: "Histogram", description: "How the values of one numeric column are distributed", needsY: false },
  bar: { label: "Category counts", description: "How many rows fall into each value of a column, not measured read counts", needsY: false },
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
    span: Span, size: Size,
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
    span: Span, size: Size,
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
    span: Span, size: Size,
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
    span: Span, size: Size,
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
    span: Span, size: Size,
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
    span: Span, size: Size,
  })
  .strict();

/**
 * Key figures: numbers an analysis recorded with its latest run, shown as
 * cards. Authors pick which, name them, fix their decimals and show how they
 * moved over the analysis's runs.
 */
const MetricKey = z.string().min(1).max(120);
const TrendChoice = z.enum(["none", "previous", "history", "timeline"]);
const TableFigureSchema = z
  .object({
    id: z.string().min(1).max(40),
    datasetId: z.string().min(1).max(80),
    column: z.string().min(1).max(120),
    stat: z.enum(METRIC_STATS),
  })
  .strict();
const FigureTargetSchema = z.object({ min: z.number().finite().optional(), max: z.number().finite().optional() }).strict();
const RunMetricBlockSchema = z
  .object({
    id: BlockId,
    type: z.literal("run-metric"),
    /** The analysis whose run metrics the block shows; a block of table figures only has none. */
    analysisId: z.string().max(80).optional(),
    /** Run metrics, by key. */
    metrics: z.array(MetricKey).max(8),
    /** Statistics of table columns, each a card like a run metric; stored under the key f:<id>. */
    figures: z.array(TableFigureSchema).max(8).optional(),
    /** Display order over run keys and f:<id> keys; missing means run figures, then table figures. */
    order: z.array(z.string().max(120)).max(16).optional(),
    /** Units by key, shown after the number ("reads", "%"). */
    units: z.record(MetricKey, z.string().max(24)).optional(),
    /** Targets by key. Accepted for pages that stored them; not shown. */
    targets: z.record(MetricKey, FigureTargetSchema).optional(),
    /** Card labels by metric key; a missing entry reads the key as words. */
    labels: z.record(MetricKey, z.string().max(80)).optional(),
    /** Decimals by metric key; a missing entry rounds for reading. */
    digits: z.record(MetricKey, z.number().int().min(0).max(6)).optional(),
    /** Cards per row; missing means as many as there are, up to four. */
    columns: z.number().int().min(1).max(6).optional(),
    /** The block's default trend: none, the change since the previous run, the run history, or the table's own timeline. */
    trend: TrendChoice.optional(),
    /** A figure's own trend, overriding the block's default. */
    trends: z.record(MetricKey, TrendChoice).optional(),
    /** What a figure counts along the timeline (distinct:<column>, sum:<column>, count); missing means suggested from its name. */
    timeline: z.record(MetricKey, z.string().max(160)).optional(),
    label: z.string().max(200).optional(),
    /** The step run the numbers were placed from, with the values then: shown until a person updates them. */
    pin: z.object({ run: z.string().min(1).max(80), values: z.record(MetricKey, z.union([z.string().max(200), z.number(), z.boolean(), z.null()])) }).strict().optional(),
    span: Span, size: Size,
  })
  .strict()
  .refine((block) => block.metrics.length + (block.figures?.length ?? 0) > 0, { message: "A key figures block needs at least one figure" })
  .refine((block) => block.metrics.length === 0 || Boolean(block.analysisId), { message: "Run figures need an analysis" });

/**
 * A finding: what a step wrote about its result, verbatim. Without a name the
 * block shows the step's notes; with a name, the Markdown or HTML report the
 * step saved under that name.
 */
const FindingBlockSchema = z
  .object({
    id: BlockId,
    type: z.literal("finding"),
    analysisId: z.string().min(1).max(80),
    name: z.string().max(120).optional(),
    caption: z.string().max(500).optional(),
    span: Span, size: Size,
  })
  .strict();

/**
 * The recipe's Map as a figure: live-linked to a flow and the recipe revision it was drawn from (and the run whose
 * values it shows). The SVG is the drawing as of then; the export shows it as an image, so it can never run script.
 */
export const MAX_FLOW_MAP_SVG = 200_000;
const FlowMapBlockSchema = z
  .object({
    id: BlockId,
    type: z.literal("flow-map"),
    flowId: z.string().min(1).max(80),
    revision: z.number().int().min(0),
    runId: z.string().min(1).max(80).optional(),
    runNumber: z.number().int().min(0).optional(),
    options: z
      .object({
        values: z.boolean(),
        inputs: z.boolean(),
        outputs: z.boolean(),
        caption: z.boolean(),
        widthMm: z.union([z.literal(89), z.literal(183)]).optional(),
        layout: z.enum(["simple", "full"]).optional(),
      })
      .strict(),
    svg: z.string().max(MAX_FLOW_MAP_SVG).regex(/^<svg[\s>]/, "The map must be an SVG drawing"),
    caption: z.string().max(500).optional(),
    span: Span, size: Size,
  })
  .strict();

export const ReportBlockSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  FindingBlockSchema,
  FigureBlockSchema,
  TableBlockSchema,
  ChartBlockSchema,
  MetricBlockSchema,
  ViewBlockSchema,
  TaxonExplorerBlockSchema,
  SubjectBlockSchema,
  CuratedBlockSchema,
  RunMetricBlockSchema,
  FlowMapBlockSchema,
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
/** What a shared or exported copy may contain beyond the page itself. */
export const ReportSharingSchema = z
  .object({
    /** Whether input tables (uploaded data, not step outputs) show their rows in shared copies. Off by default. */
    inputRows: z.boolean(),
  })
  .strict();
export type ReportSharing = z.infer<typeof ReportSharingSchema>;
export const ReportInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    blocks: z.array(ReportBlockSchema).max(MAX_REPORT_BLOCKS),
    filters: z.array(ReportFilterSchema).max(MAX_REPORT_FILTERS).optional(),
    sharing: ReportSharingSchema.optional(),
    /** The version the editor started from (updatedAt); a save against an older version is refused. */
    expectedUpdatedAt: z.string().max(40).optional(),
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
