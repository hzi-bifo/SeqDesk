/**
 * A report as one HTML document: the page's blocks with their live data, so it
 * can be downloaded as a file or served behind a share link. The renderer is a
 * pure function over data the loader gathers; figures use Plotly in the page.
 */
import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { listCurationForViews } from "./curation";
import { fetchAllDatasetRows, getDatasetRecord } from "./datasets";
import { applyEditsToRows, listActiveEdits } from "./edits";
import { applyFilters, cellText, groupBy, relativeAbundance, toNumber, type ActiveFilters } from "./frame";
import { renderMarkdownHtml } from "./markdown-html";
import { applyRowFilter } from "./row-filter";
import { METRIC_STAT_LABELS, type ReportFilter } from "./report-blocks";
import { buildChart, computeStats, formatStat, WIDGET_ROW_LIMIT } from "./report-widgets";
import { formatWithDigits, metricTrend, sparklinePoints, trendNote } from "./metric-trend";
import { analysisTimeline, buildTimeline, detectTimeAxis, parseMeasure, suggestMeasure, timelineNote } from "./time-axis";
import { figureKeys, tableFigureKey, withUnit } from "./key-figures";
import { getReportView, type ReportAnalysis, type ReportView, type ResolvedReportBlock } from "./reports";
import { parseRoles, parseSchema } from "./schema";
import { parseTargetKey } from "./target-key";
import { buildVariables, resolveVariablesInMarkdown, type ReportVariables } from "./variables";
import { resolveContainedPath } from "./storage";
import type { ExploreColumn, ExploreRoleMap, ExploreRowData, ExploreRowRecord } from "./types";
import { computeHeatmap } from "./views/heatmap/compute";
import { adaptRowsForSubjectTimeline, curationFromLists, type CurationListLike } from "./views/subject-timeline/adapter";
import { curatedMarks, subjectComposition, subjectsTable } from "./views/subject-timeline/compute";
import type { SubjectTimelineCuration } from "./views/subject-timeline/types";

export const PLOTLY_CDN_URL = "https://cdn.plot.ly/plotly-cartesian-3.7.0.min.js";
const PLOTLY_BUNDLE = path.join("plotly.js-cartesian-dist-min", "plotly-cartesian.min.js");
const GROUP_PALETTE = ["#4C72B0", "#DD8452", "#55A868", "#C44E52", "#8172B3", "#937860", "#DA8BC3", "#8C8C8C", "#CCB974", "#64B5CD"];
const TAXON_PALETTE = ["#4C72B0", "#DD8452", "#55A868", "#C44E52", "#8172B3", "#937860", "#DA8BC3", "#8C8C8C", "#CCB974", "#64B5CD", "#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD", "#8C564B", "#E377C2", "#7F7F7F", "#BCBD22"];
const MAX_TABLE_ROWS = 500;
const MAX_SUBJECT_ROWS = 80;

export interface ExportTable {
  datasetId: string;
  name: string;
  columns: ExploreColumn[];
  roles: ExploreRoleMap;
  /** Every row of the current version with curation edits applied. */
  records: ExploreRowRecord[];
}

export interface ExportArtifact {
  format: string;
  content: Buffer;
}

export interface RenderInput {
  report: ReportView;
  scopeLabel: string;
  /** Tables the blocks read, by dataset id. */
  tables: Map<string, ExportTable>;
  /** Figure files by `analysisId:figureName`; null when the file is gone. */
  artifacts: Map<string, ExportArtifact | null>;
  lists: CurationListLike[];
  curation: SubjectTimelineCuration;
  active: ActiveFilters;
  /** The Plotly library: its source inlined, or a script URL. */
  plotly: { inline: string } | { src: string };
  generatedAt: Date;
}

interface Plot {
  id: string;
  data: unknown[];
  layout: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function cell(value: unknown, type?: string): string {
  const text = formatValue(value, type);
  const numeric = typeof value === "number" || (type === "number" && typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));
  const exact = numeric ? String(Number(value)) : "";
  const title = numeric && exact !== text ? ` title="${escapeHtml(exact)}"` : "";
  return `<td${numeric ? ` class="num"${title}` : ""}>${escapeHtml(text)}</td>`;
}

// Same rounding as the app's tables: compact millions, whole thousands, two decimals, three significant digits below one.
function formatValue(value: unknown, type?: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? formatStat(value) : "";
  if (type === "number" && typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return formatStat(Number(value));
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function metricLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\bpct\b/g, "%").trim();
}

function columnLabel(columns: ExploreColumn[], key: string): string {
  return columns.find((column) => column.key === key)?.label ?? key;
}


function filteredRows(table: ExportTable, filters: ReportFilter[], active: ActiveFilters): ExploreRowData[] {
  const columns = new Set(table.columns.map((column) => column.key));
  return applyFilters(table.records.map((record) => record.data), columns, filters, active);
}

function filteredRecords(table: ExportTable, filters: ReportFilter[], active: ActiveFilters): ExploreRowRecord[] {
  const kept = new Set(filteredRows(table, filters, active));
  return table.records.filter((record) => kept.has(record.data));
}

function filtersApply(table: ExportTable, filters: ReportFilter[], active: ActiveFilters): boolean {
  const keys = new Set(table.columns.map((column) => column.key));
  return filters.some((filter) => keys.has(filter.column) && (active[filter.id]?.length ?? 0) > 0);
}

function note(text: string): string {
  return `<p class="note">${escapeHtml(text)}</p>`;
}

function empty(text: string): string {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function htmlTable(columns: Array<{ key: string; label: string; type?: string }>, rows: ExploreRowData[]): string {
  const head = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${columns.map((column) => cell(row[column.key], column.type)).join("")}</tr>`)
    .join("");
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function cards(entries: Array<{ label: string; value: string; note?: string | null; extra?: string }>, columns?: number): string {
  const style = columns ? ` style="grid-template-columns:repeat(${Math.max(1, Math.min(6, columns))},minmax(0,1fr))"` : "";
  return `<div class="cards"${style}>${entries.map((entry) => `<div class="card"><div class="value">${escapeHtml(entry.value)}</div><div class="label">${escapeHtml(entry.label)}</div>${entry.extra ?? ""}${entry.note ? `<div class="note">${escapeHtml(entry.note)}</div>` : ""}</div>`).join("")}</div>`;
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export function renderReportDocument(input: RenderInput): string {
  const { report, active } = input;
  // Page filters are set aside for now (see ExploreReport); the shared page matches the app.
  const filters: ReportFilter[] = [];
  const plots: Plot[] = [];
  const addPlot = (data: unknown[], layout: Record<string, unknown>, height: number): string => {
    const id = `plot-${plots.length + 1}`;
    plots.push({ id, data, layout: { ...layout, height } });
    return `<div class="plot" id="${id}" style="height:${height}px"></div>`;
  };
  const tableOf = (datasetId: string) => input.tables.get(datasetId) ?? null;
  const variables = buildVariables(report.outputs.analyses);

  const sections = report.blocks.map((block) => renderBlock(block, { input, filters, active, addPlot, tableOf, variables }));
  const headings = report.blocks.flatMap((block) =>
    block.type === "text"
      ? block.markdown
          .split("\n")
          .filter((line) => /^##\s+/.test(line))
          .slice(0, 1)
          .map((line) => ({ id: `block-${block.id}`, title: line.replace(/^##\s+/, "").trim() }))
      : []
  );
  const activeFilters = filters.flatMap((filter) => {
    const values = active[filter.id] ?? [];
    return values.length ? [`${filter.label ?? columnLabel(tableOf(filter.datasetId)?.columns ?? [], filter.column)}: ${values.join(", ")}`] : [];
  });

  const plotJson = JSON.stringify(plots).replace(/</g, "\\u003c");
  const plotlyTag = "inline" in input.plotly ? `<script>${input.plotly.inline.replace(/<\/script/gi, "<\\/script")}</script>` : `<script src="${escapeHtml(input.plotly.src)}"></script>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(report.title)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <p class="eyebrow">${escapeHtml(input.scopeLabel)}</p>
  <h1>${escapeHtml(report.title)}</h1>
  <p class="meta">Exported from SeqDesk on ${escapeHtml(input.generatedAt.toISOString().slice(0, 16).replace("T", " "))} UTC${report.updatedAt ? `; page last changed ${escapeHtml(report.updatedAt.slice(0, 10))}` : ""}. Figures and tables show the latest run of their analysis at export time.</p>
  ${activeFilters.length ? `<p class="filters">Filtered: ${escapeHtml(activeFilters.join("; "))}</p>` : ""}
  ${headings.length > 1 ? `<nav class="toc"><p class="toc-title">Contents</p><ol>${headings.map((heading) => `<li><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.title)}</a></li>`).join("")}</ol></nav>` : ""}
</header>
<main class="grid">
${sections.join("\n")}
</main>
<footer>Made with SeqDesk. Interactive figures need JavaScript.</footer>
${plotlyTag}
<script type="application/json" id="plot-data">${plotJson}</script>
<script>${INIT_SCRIPT}</script>
</body>
</html>
`;
}

interface BlockContext {
  input: RenderInput;
  filters: ReportFilter[];
  active: ActiveFilters;
  addPlot: (data: unknown[], layout: Record<string, unknown>, height: number) => string;
  tableOf: (datasetId: string) => ExportTable | null;
  variables: ReportVariables;
}

function section(block: ResolvedReportBlock, title: string | null, body: string, footer?: string): string {
  const span = block.span ?? (block.type === "figure" || block.type === "chart" || block.type === "metric" ? 1 : 2);
  return `<section class="block span-${span}" id="block-${escapeHtml(block.id)}">${title ? `<h3>${escapeHtml(title)}</h3>` : ""}${body}${footer ? `<p class="footer">${escapeHtml(footer)}</p>` : ""}</section>`;
}

function renderBlock(block: ResolvedReportBlock, context: BlockContext): string {
  const { input, filters, active, addPlot, tableOf } = context;
  switch (block.type) {
    case "text": {
      const html = renderMarkdownHtml(resolveVariablesInMarkdown(block.markdown, context.variables)).replace(/<h2>/, `<h2 id="block-${escapeHtml(block.id)}">`);
      return `<section class="block span-${block.span ?? 2} prose">${html}</section>`;
    }
    case "figure": {
      const figure = block.figure;
      if (!figure) return section(block, block.caption ?? block.figureName, empty("This figure is not produced by the analysis any more."));
      const artifact = input.artifacts.get(`${block.analysisId}:${block.figureName}`) ?? null;
      const footer = `${figure.analysisName}, ${figure.runNumber}`;
      if (!artifact) return section(block, block.caption ?? block.figureName, empty("The figure file could not be read."), footer);
      if (artifact.format === "plotly-json") {
        try {
          const parsed = JSON.parse(artifact.content.toString("utf8")) as { data?: unknown[]; layout?: Record<string, unknown> };
          const layout = parsed.layout ?? {};
          const height = typeof layout.height === "number" ? Math.min(Math.max(layout.height, 240), 900) : 420;
          return section(block, block.caption ?? block.figureName, addPlot(parsed.data ?? [], layout, height), footer);
        } catch {
          return section(block, block.caption ?? block.figureName, empty("The figure file is not valid Plotly JSON."), footer);
        }
      }
      if (artifact.format === "png" || artifact.format === "svg") {
        const mime = artifact.format === "png" ? "image/png" : "image/svg+xml";
        return section(block, block.caption ?? block.figureName, `<img src="data:${mime};base64,${artifact.content.toString("base64")}" alt="${escapeHtml(block.caption ?? block.figureName)}">`, footer);
      }
      return section(block, block.caption ?? block.figureName, empty(`A ${artifact.format} figure is not included in the export.`), footer);
    }
    case "table": {
      const table = tableOf(block.datasetId);
      if (!table) return section(block, block.caption ?? "Table", empty("This table is not in the scope any more."));
      let rows = filteredRows(table, filters, active);
      let filterNote = "";
      if (block.filter) {
        try {
          rows = applyRowFilter(rows, block.filter, { aliases: Object.fromEntries(table.columns.map((column) => [column.label, column.key])) });
          filterNote = ", row filter applied";
        } catch {
          filterNote = ", row filter could not be applied";
        }
      }
      if (block.sort) {
        const { column, direction } = block.sort;
        rows = [...rows].sort((a, b) => {
          const left = a[column];
          const right = b[column];
          const missingA = left === null || left === undefined || left === "";
          const missingB = right === null || right === undefined || right === "";
          if (missingA || missingB) return missingA && missingB ? 0 : missingA ? 1 : -1;
          const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
          return direction === "asc" ? order : -order;
        });
      }
      const limit = Math.min(block.rows ?? 12, MAX_TABLE_ROWS);
      const all = table.columns.filter((column) => !column.key.endsWith("_db_id"));
      const columns = block.columns && block.columns.length > 0 ? block.columns.map((key) => all.find((column) => column.key === key)).filter((column): column is ExploreColumn => Boolean(column)) : all;
      return section(block, block.caption ?? table.name, htmlTable(columns, rows.slice(0, limit)), `${Math.min(limit, rows.length).toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} rows, ${columns.length} columns${filtersApply(table, filters, active) ? ", page filters applied" : ""}${filterNote}`);
    }
    case "chart": {
      const table = tableOf(block.datasetId);
      if (!table) return section(block, block.caption ?? "Chart", empty("This table is not in the scope any more."));
      const rows = filteredRows(table, filters, active);
      const result = buildChart(rows.slice(0, WIDGET_ROW_LIMIT), table.columns, { chart: block.chart, x: block.x, y: block.y, color: block.color }, rows.length);
      return section(block, block.caption ?? `${columnLabel(table.columns, block.x)} (${table.name})`, addPlot(result.data, result.layout, 340) + result.notes.map(note).join(""), filtersApply(table, filters, active) ? "Page filters applied" : undefined);
    }
    case "metric": {
      const table = tableOf(block.datasetId);
      if (!table) return section(block, block.label ?? "Numbers", empty("This table is not in the scope any more."));
      const rows = filteredRows(table, filters, active);
      const stats = computeStats(rows, block.column);
      return section(block, block.label ?? `${columnLabel(table.columns, block.column)} (${table.name})`, cards(block.stats.map((stat) => ({ label: METRIC_STAT_LABELS[stat], value: formatStat(stats[stat]) }))), `${rows.length.toLocaleString("en-US")} rows${filtersApply(table, filters, active) ? ", page filters applied" : ""}`);
    }
    case "run-metric": {
      const analysis = block.analysis;
      if (block.metrics.length > 0 && !analysis) return section(block, block.label ?? "Dashboard numbers", empty("This analysis is not in the report any more."));
      const source = analysisTimeline(analysis, [...input.tables.values()]);
      const keys = figureKeys(block);
      type Entry = { label: string; value: string; note?: string | null; extra?: string };
      const entries = keys.flatMap((key): Entry[] => {
        const figure = (block.figures ?? []).find((entry) => tableFigureKey(entry) === key) ?? null;
        const table = figure ? input.tables.get(figure.datasetId) ?? null : null;
        let value: string | number | boolean | null | undefined;
        let defaultLabel: string;
        let history: ReportAnalysis["history"] | null = null;
        let timeline: ReturnType<typeof analysisTimeline> = null;
        if (figure) {
          if (!table) return [{ label: figure.column, value: "n/a", note: "table missing" }];
          value = computeStats(table.records.map((record) => record.data), figure.column)[figure.stat];
          defaultLabel = `${METRIC_STAT_LABELS[figure.stat]} of ${columnLabel(table.columns, figure.column)}`;
          const axis = detectTimeAxis(table.columns, table.roles);
          timeline = axis ? { datasetId: table.datasetId, tableName: table.name, axis, roles: table.roles } : null;
        } else {
          if (!analysis) return [];
          value = analysis.metrics[key];
          defaultLabel = metricLabel(key);
          history = analysis.history ?? null;
          timeline = source;
        }
        const digits = block.digits?.[key];
        const format = (amount: number) => formatWithDigits(amount, digits, formatStat);
        const text = withUnit(typeof value === "number" ? format(value) : formatValue(value) || "n/a", block.units?.[key]);
        const mode = block.trends?.[key] ?? block.trend ?? "none";
        const label = block.labels?.[key]?.trim() || defaultLabel;
        const notes: string[] = [];
        let extra = "";
        if (mode === "timeline") {
          const measure = timeline ? parseMeasure(block.timeline?.[key]) ?? (figure ? (figure.stat === "count" ? { kind: "count" as const } : figure.stat === "missing" ? null : { kind: figure.stat, column: figure.column }) : suggestMeasure(key, timeline.roles)) : null;
          const timelineTable = timeline ? input.tables.get(timeline.datasetId) : null;
          if (timeline && measure && timelineTable) {
            const series = buildTimeline(timelineTable.records.map((record) => record.data), timeline.axis, measure);
            const points = sparklinePoints(series.buckets.map((bucket) => bucket.cumulative), 160, 24);
            extra = points.length >= 2 ? `<svg viewBox="0 0 160 24" class="spark" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points.map((point) => point.join(",")).join(" ")}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>` : "";
            const note = timelineNote(series, format) ?? (series.buckets.length > 0 ? `${series.buckets[0].label} to ${series.buckets[series.buckets.length - 1].label}` : "");
            if (note) notes.push(note);
          } else notes.push(timeline ? "no measure along the timeline" : "no timeline in this figure's table");
        } else if (mode !== "none" && history) {
          const movement = typeof value === "number" ? metricTrend(history, key, mode) : null;
          const note = trendNote(movement, mode, format);
          if (note) notes.push(note);
        }
        return [{ label, value: text, note: notes.join("; ") || null, extra }];
      });
      const footer = [analysis && block.metrics.length > 0 ? `${analysis.name}${analysis.runNumber ? `, ${analysis.runNumber}` : ""}` : null, ...new Set((block.figures ?? []).map((figure) => input.tables.get(figure.datasetId)?.name ?? "a table"))].filter(Boolean).join("; ");
      return section(block, block.label ?? (analysis && block.metrics.length > 0 ? `${analysis.name} in numbers` : "Dashboard numbers"), cards(entries, block.columns), footer);
    }
    case "view": {
      const table = tableOf(block.datasetId);
      if (!table) return section(block, block.caption ?? "View", empty("This table is not in the scope any more."));
      if (!block.available) return section(block, block.caption ?? table.name, empty("The table no longer has the roles this view needs."));
      const adapted = adaptRowsForSubjectTimeline(filteredRecords(table, filters, active), table.roles, table.columns.map((column) => column.key));
      if (block.view === "heatmap") return renderHeatmap(block, table, adapted.rows, context);
      return renderSubjectTimeline(block, table, adapted.rows, context);
    }
    case "taxon-explorer":
      return renderTaxonExplorer(block, context);
    case "subject":
      return renderSubject(block, context);
    case "curated":
      return renderCurated(block, context);
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Views computed on the server, drawn like their in-app counterparts
// ---------------------------------------------------------------------------

type Adapted = ReturnType<typeof adaptRowsForSubjectTimeline>["rows"];

function renderHeatmap(block: Extract<ResolvedReportBlock, { type: "view" }>, table: ExportTable, rows: Adapted, context: BlockContext): string {
  const options = block.options ?? {};
  const value = options.value === "ra" || options.value === "reads" ? options.value : "log10_ra";
  const payload = computeHeatmap(rows, {
    nTaxa: typeof options.nTaxa === "number" ? options.nTaxa : 35,
    value,
    order: options.order === "abundance" ? "abundance" : "prevalence",
    artifacts: context.input.curation.artifacts,
    memberships: context.input.curation.memberships,
  });
  if (payload.samples.length === 0) return section(block, block.caption ?? `Heatmap of ${table.name}`, empty("No samples match."));
  const labels = payload.taxa.map((taxon) => (taxon.curated ? `<span style="color:${taxon.curated.color ?? "#C0392B"}">&#9679;</span> ${taxon.taxon}` : taxon.taxon));
  const plot = context.addPlot(
    [
      {
        type: "heatmap",
        z: payload.values,
        x: payload.samples.map((sample) => sample.sample),
        y: payload.taxa.map((taxon) => taxon.taxon),
        colorscale: "Viridis",
        hoverongaps: false,
        colorbar: { title: { text: value === "log10_ra" ? "log10 RA %" : value === "ra" ? "RA %" : "reads" }, thickness: 12 },
        customdata: payload.samples.map((sample) => `${sample.subject}, ${sample.group}, day ${sample.timepoint}`),
        hovertemplate: "%{y}<br>%{x}<br>%{customdata}<br>%{z}<extra></extra>",
      },
    ],
    {
      margin: { l: 200, r: 16, t: 8, b: 90 },
      xaxis: { title: { text: `${payload.samples.length} samples` }, tickangle: -60, tickfont: { size: 9 }, automargin: true },
      yaxis: { autorange: "reversed", tickfont: { size: 10 }, tickmode: "array", tickvals: payload.taxa.map((taxon) => taxon.taxon), ticktext: labels },
    },
    Math.max(360, 18 * payload.taxa.length + 120)
  );
  const marked = new Map<string, { label: string; count: number }>();
  for (const taxon of payload.taxa) if (taxon.curated) marked.set(taxon.curated.listId, { label: taxon.curated.label, count: (marked.get(taxon.curated.listId)?.count ?? 0) + 1 });
  return section(block, block.caption ?? `Heatmap of ${table.name}`, plot, `${payload.taxa.length} taxa across ${payload.nSamplesTotal} samples${marked.size ? `; marked: ${[...marked.values()].map((entry) => `${entry.label} (${entry.count})`).join(", ")}` : ""}${filtersApply(table, context.filters, context.active) ? "; page filters applied" : ""}`);
}

function renderSubjectTimeline(block: Extract<ResolvedReportBlock, { type: "view" }>, table: ExportTable, rows: Adapted, context: BlockContext): string {
  const groups = [...new Set(rows.map((row) => row.group))].sort();
  const payload = subjectsTable(rows, { primaryGroups: groups.slice(0, 2) });
  if (payload.patients.length === 0) return section(block, block.caption ?? `Subject timeline of ${table.name}`, empty("No subjects match."));
  const span = Math.max(payload.day_max - payload.day_min, 1);
  const shown = payload.patients.slice(0, MAX_SUBJECT_ROWS);
  const body = shown
    .map((patient) => {
      const dots = groups
        .map((group, index) =>
          (patient.days_by_sampletype[group] ?? [])
            .map((day) => `<circle cx="${(((day - payload.day_min) / span) * 116 + 2).toFixed(1)}" cy="${index % 2 === 0 ? 4 : 8}" r="2" fill="${GROUP_PALETTE[index % GROUP_PALETTE.length]}"/>`)
            .join("")
        )
        .join("");
      return `<tr><td>${escapeHtml(patient.patient)}</td><td>${escapeHtml(patient.sampletypes.join(", "))}</td><td class="num">${patient.n_samples}</td><td class="num">${patient.n_days}</td><td class="num">${patient.day_min} to ${patient.day_max}</td><td><svg viewBox="0 0 120 12" width="120" height="12"><line x1="0" y1="6" x2="120" y2="6" stroke="#ddd"/>${dots}</svg></td></tr>`;
    })
    .join("");
  const legend = groups.map((group, index) => `<span class="chip" style="color:${GROUP_PALETTE[index % GROUP_PALETTE.length]}">&#9679; ${escapeHtml(group)}</span>`).join(" ");
  return section(block, block.caption ?? `Subject timeline of ${table.name}`, `<p class="note">${legend}</p><div class="scroll"><table><thead><tr><th>Subject</th><th>Groups</th><th>Samples</th><th>Days</th><th>Span</th><th>Timeline (day ${payload.day_min} to ${payload.day_max})</th></tr></thead><tbody>${body}</tbody></table></div>`, `${payload.patients.length} subjects${shown.length < payload.patients.length ? `, the first ${shown.length} shown` : ""}${filtersApply(table, context.filters, context.active) ? ", page filters applied" : ""}`);
}

function renderTaxonExplorer(block: Extract<ResolvedReportBlock, { type: "taxon-explorer" }>, context: BlockContext): string {
  const table = context.tableOf(block.datasetId);
  const title = block.caption ?? `Taxon explorer${table ? `: ${table.name}` : ""}`;
  if (!table) return section(block, title, empty("This table is not in the scope any more."));
  const roles = table.roles;
  if (!roles.sample || !roles.taxon || !roles.count) return section(block, title, empty(`${table.name} needs sample, taxon and count roles for a taxon explorer.`));
  const rows = filteredRows(table, context.filters, context.active);
  const ra = relativeAbundance(rows, roles.sample, roles.count);
  const sampleKey = roles.sample;
  const taxonKey = roles.taxon;
  const groupKey = roles.group ?? null;
  const subjectKey = roles.subject ?? null;
  const timeKey = roles.timepoint ?? null;
  const samplesByTaxon = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!ra.has(row)) continue;
    const name = cellText(row[taxonKey]);
    const set = samplesByTaxon.get(name) ?? new Set<string>();
    set.add(cellText(row[sampleKey]));
    samplesByTaxon.set(name, set);
  }
  const current = block.taxon && samplesByTaxon.has(block.taxon) ? block.taxon : ([...samplesByTaxon.entries()].sort((a, b) => b[1].size - a[1].size)[0]?.[0] ?? null);
  if (!current) return section(block, title, empty("No organism occurs in the rows the page filters leave."));
  const allSamples = groupBy(rows, sampleKey);
  const sampleGroup = new Map<string, string>();
  for (const [sample, list] of allSamples) sampleGroup.set(sample, groupKey ? cellText(list[0][groupKey]) || "(none)" : "all");
  const hitSamples = new Map<string, { ra: number; row: ExploreRowData }>();
  for (const row of rows) {
    if (cellText(row[taxonKey]) !== current || !ra.has(row)) continue;
    const sample = cellText(row[sampleKey]);
    const value = ra.get(row) ?? 0;
    const existing = hitSamples.get(sample);
    if (!existing || existing.ra < value) hitSamples.set(sample, { ra: value, row });
  }
  const groups = [...new Set(sampleGroup.values())];
  const perGroup = groups.map((group, index) => {
    const total = [...sampleGroup.values()].filter((entry) => entry === group).length;
    const present = [...hitSamples.entries()].filter(([sample]) => sampleGroup.get(sample) === group);
    return { group, colour: GROUP_PALETTE[index % GROUP_PALETTE.length], total, present: present.length, prevalence: total ? (100 * present.length) / total : 0, ras: present.map(([, entry]) => entry.ra), hits: present.map(([, entry]) => entry) };
  });
  const parts: string[] = [];
  parts.push(`<p class="note"><strong>${escapeHtml(current)}</strong>: ${hitSamples.size} of ${allSamples.size} samples</p>`);
  parts.push('<div class="pair">');
  parts.push(context.addPlot([{ type: "bar", x: perGroup.map((entry) => `${entry.group} (n=${entry.total})`), y: perGroup.map((entry) => entry.prevalence), marker: { color: perGroup.map((entry) => entry.colour) }, hovertemplate: "%{x}<br>present in %{y:.1f} % of samples<extra></extra>" }], { title: { text: "Prevalence per group", font: { size: 12 } }, yaxis: { title: { text: "% of samples" }, range: [0, 100] }, margin: { l: 48, r: 8, t: 30, b: 60 }, showlegend: false }, 260));
  parts.push(context.addPlot(perGroup.filter((entry) => entry.ras.length > 0).map((entry) => ({ type: "box", name: entry.group, y: entry.ras, boxpoints: "all", jitter: 0.4, pointpos: 0, marker: { size: 4, color: entry.colour }, line: { color: entry.colour } })), { title: { text: "Relative abundance when present", font: { size: 12 } }, yaxis: { title: { text: "%" }, type: "log" }, margin: { l: 48, r: 8, t: 30, b: 40 }, showlegend: false }, 260));
  parts.push("</div>");
  if (subjectKey && timeKey) {
    const subjects = new Set([...hitSamples.values()].map((entry) => cellText(entry.row[subjectKey])));
    parts.push(
      context.addPlot(
        perGroup.map((entry) => ({ type: "scatter", mode: "markers", name: entry.group, x: entry.hits.map((hit) => toNumber(hit.row[timeKey]) ?? hit.row[timeKey]), y: entry.hits.map((hit) => cellText(hit.row[subjectKey])), marker: { size: 7, color: entry.colour }, text: entry.hits.map((hit) => `${hit.ra.toFixed(2)} %`), hovertemplate: "%{y}<br>%{x}: %{text}<extra>" + entry.group + "</extra>" })),
        { title: { text: `Carriers on the timeline (${subjects.size} subjects)`, font: { size: 12 } }, xaxis: { title: { text: columnLabel(table.columns, timeKey) } }, yaxis: { title: { text: columnLabel(table.columns, subjectKey) }, tickfont: { size: 9 }, type: "category" }, margin: { l: 80, r: 8, t: 30, b: 40 }, legend: { orientation: "h", y: -0.2 } },
        Math.min(520, Math.max(220, 16 * subjects.size + 100))
      )
    );
  }
  return section(block, title, parts.join(""), `${table.name}${filtersApply(table, context.filters, context.active) ? ", page filters applied" : ""}`);
}

function renderSubject(block: Extract<ResolvedReportBlock, { type: "subject" }>, context: BlockContext): string {
  const table = context.tableOf(block.datasetId);
  const title = block.caption ?? `Subject${table ? `: ${table.name}` : ""}`;
  if (!table) return section(block, title, empty("This table is not in the scope any more."));
  const adapted = adaptRowsForSubjectTimeline(filteredRecords(table, context.filters, context.active), table.roles, table.columns.map((column) => column.key));
  if (adapted.missingRoles.length > 0) return section(block, title, empty(`${table.name} needs the roles ${adapted.missingRoles.join(", ")} for a subject view.`));
  const counts = new Map<string, number>();
  for (const row of adapted.rows) counts.set(row.group, (counts.get(row.group) ?? 0) + 1);
  const primaryGroups = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([group]) => group);
  const overview = subjectsTable(adapted.rows, { primaryGroups });
  const subject = block.subject && overview.patients.some((patient) => patient.patient === block.subject) ? block.subject : (overview.patients[0]?.patient ?? null);
  if (!subject) return section(block, title, empty("No subject matches."));
  const patient = overview.patients.find((entry) => entry.patient === subject)!;
  const measure = block.measure ?? "ra";
  const parts: string[] = [`<p class="note"><strong>${escapeHtml(subject)}</strong>: ${patient.n_samples} libraries on ${patient.n_days} days, ${escapeHtml(patient.sampletypes.join(" and "))}</p>`];
  for (const group of primaryGroups.filter((entry) => patient.sampletypes.includes(entry))) {
    const composition = subjectComposition(adapted.rows, subject, group, context.input.curation, { primaryGroups });
    if (composition.days.length === 0) {
      parts.push(note(`${group}: no retained taxa on any day.`));
      continue;
    }
    const marks = curatedMarks(composition.taxa, context.input.curation, group);
    const stacked = measure === "ra" ? composition.stacked : composition.stacked_reads;
    parts.push(
      `<h4>${escapeHtml(group)} <span class="muted">${composition.n_libraries} libraries, ${composition.collection_days.length} collection days</span></h4>` +
        context.addPlot(
          composition.taxa.map((taxon, index) => {
            const mark = marks[taxon];
            const name = mark ? `<span style="color:${mark.color ?? (mark.role === "pathogen" ? "#C0392B" : "#2E8B57")}">&#9679;</span> ${taxon}` : taxon;
            return { type: "bar", name, x: composition.days.map((day) => `Day ${day}`), y: stacked[taxon] ?? [], marker: { color: taxon === "Other" ? "#d9d9d9" : TAXON_PALETTE[index % TAXON_PALETTE.length] }, hovertemplate: `${taxon}<br>%{x}: %{y:.2f}${measure === "ra" ? " %" : " reads"}<extra></extra>` };
          }),
          { barmode: "stack", yaxis: { title: { text: measure === "ra" ? "Relative abundance (%)" : "Assigned reads" }, rangemode: "tozero" }, xaxis: { title: { text: "Study day" } }, legend: { orientation: "h", y: -0.3, font: { size: 10 } }, margin: { l: 56, r: 16, t: 8, b: 48 } },
          360
        )
    );
  }
  return section(block, title, parts.join(""), `${table.name}${filtersApply(table, context.filters, context.active) ? ", page filters applied" : ""}`);
}

function renderCurated(block: Extract<ResolvedReportBlock, { type: "curated" }>, context: BlockContext): string {
  const table = context.tableOf(block.datasetId);
  const title = block.caption ?? `Organisms of interest${table ? `: ${table.name}` : ""}`;
  if (!table) return section(block, title, empty("This table is not in the scope any more."));
  const roles = table.roles;
  if (!roles.sample || !roles.taxon || !roles.count) return section(block, title, empty(`${table.name} needs sample, taxon and count roles for organisms of interest.`));
  const role = block.role ?? "pathogen";
  const index = new Map<string, CurationListLike[]>();
  for (const list of context.input.lists) {
    if (list.role === "artifact") continue;
    if (role !== "all" && list.role !== role) continue;
    if (block.lists && block.lists.length > 0 && !block.lists.includes(list.listId)) continue;
    for (const entry of list.entries) {
      const key = entry.trim().toLowerCase();
      if (!key) continue;
      const bucket = index.get(key) ?? [];
      if (!bucket.includes(list)) bucket.push(list);
      index.set(key, bucket);
    }
  }
  if (index.size === 0) return section(block, title, empty(`This scope has no ${role === "all" ? "curation" : role} lists.`));
  const rows = filteredRows(table, context.filters, context.active);
  const ra = relativeAbundance(rows, roles.sample, roles.count);
  const groupKey = roles.group ?? null;
  const subjectKey = roles.subject ?? null;
  const allSamples = new Set<string>();
  const hits = new Map<string, { name: string; lists: CurationListLike[]; samples: Set<string>; subjects: Set<string>; groups: Map<string, Set<string>>; peak: number; peakGroup: string | null }>();
  for (const row of rows) {
    const value = ra.get(row);
    if (value === undefined) continue;
    const sample = cellText(row[roles.sample]);
    allSamples.add(sample);
    if (value <= 0) continue;
    const name = cellText(row[roles.taxon]);
    const key = name.trim().toLowerCase();
    const matched = index.get(key);
    if (!matched) continue;
    const hit = hits.get(key) ?? { name, lists: matched, samples: new Set<string>(), subjects: new Set<string>(), groups: new Map<string, Set<string>>(), peak: 0, peakGroup: null };
    hit.samples.add(sample);
    if (subjectKey) hit.subjects.add(cellText(row[subjectKey]));
    const group = groupKey ? cellText(row[groupKey]) || "(none)" : null;
    if (group) {
      const set = hit.groups.get(group) ?? new Set<string>();
      set.add(sample);
      hit.groups.set(group, set);
    }
    if (value > hit.peak) {
      hit.peak = value;
      hit.peakGroup = group;
    }
    hits.set(key, hit);
  }
  const ranked = [...hits.values()].sort((a, b) => b.samples.size - a.samples.size || b.peak - a.peak || a.name.localeCompare(b.name));
  const shown = ranked.slice(0, block.limit ?? 25);
  const chip = (list: CurationListLike) => {
    const color = list.color ?? (list.role === "pathogen" ? "#C0392B" : "#2E8B57");
    const text = list.tier ? `${list.site ? `${list.site} ` : ""}${list.tier}` : list.label;
    return `<span class="chip" style="background:${color}22;color:${color}" title="${escapeHtml(list.label)}">${escapeHtml(text)}</span>`;
  };
  const body = shown
    .map((hit) => {
      const share = allSamples.size ? (100 * hit.samples.size) / allSamples.size : 0;
      return `<tr><td><strong>${escapeHtml(hit.name)}</strong></td><td>${hit.lists.map(chip).join(" ")}</td><td class="num">${hit.samples.size} <span class="muted">(${share.toFixed(0)} %)</span></td>${subjectKey ? `<td class="num">${hit.subjects.size}</td>` : ""}${groupKey ? `<td>${[...hit.groups.entries()].sort((a, b) => b[1].size - a[1].size).map(([group, samples]) => `<span class="chip plain">${escapeHtml(group)} <span class="muted">${samples.size}</span></span>`).join(" ")}</td>` : ""}<td class="num">${hit.peak.toFixed(hit.peak >= 10 ? 0 : 2)}${hit.peakGroup ? ` <span class="muted">${escapeHtml(hit.peakGroup)}</span>` : ""}</td></tr>`;
    })
    .join("");
  const head = `<tr><th>Organism</th><th>Lists</th><th>Samples</th>${subjectKey ? "<th>Subjects</th>" : ""}${groupKey ? `<th>Per ${escapeHtml(columnLabel(table.columns, groupKey).toLowerCase())}</th>` : ""}<th>Peak RA %</th></tr>`;
  return section(block, title, `<p class="note"><strong>${ranked.length}</strong> of ${index.size} ${role === "all" ? "listed" : role} organisms occur in ${allSamples.size.toLocaleString("en-US")} samples${ranked.length > shown.length ? `; the ${shown.length} most frequent are shown` : ""}.</p>` + (shown.length ? `<div class="scroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>` : empty("None of the listed organisms occurs in the rows the page filters leave.")), `${table.name}${filtersApply(table, context.filters, context.active) ? ", page filters applied" : ""}`);
}

// ---------------------------------------------------------------------------
// Loading the data behind a report
// ---------------------------------------------------------------------------

export interface ExportOptions {
  active?: ActiveFilters;
  /** Inline the Plotly library (a self-contained file) or reference a script URL. */
  plotly: "inline" | { src: string };
}

/** Page filter values from a query string: `f.<filterId>=value`, repeatable. */
export function activeFiltersFromSearchParams(params: URLSearchParams): ActiveFilters {
  const active: ActiveFilters = {};
  for (const [key, value] of params.entries()) {
    if (!key.startsWith("f.") || !value) continue;
    const id = key.slice(2);
    (active[id] ??= []).push(value);
  }
  return active;
}

async function scopeLabelFor(targetKey: string): Promise<string> {
  const parsed = parseTargetKey(targetKey);
  if (!parsed) return "SeqDesk";
  if (parsed.type === "study") return (await db.study.findUnique({ where: { id: parsed.id }, select: { title: true } }))?.title ?? "Study";
  if (parsed.type === "order") {
    const order = await db.order.findUnique({ where: { id: parsed.id }, select: { name: true, orderNumber: true } });
    return order?.name || order?.orderNumber || "Sequencing order";
  }
  if (parsed.type === "project") return (await db.exploreProject.findUnique({ where: { id: parsed.id }, select: { name: true } }))?.name ?? "Project";
  return "Workspace";
}

async function loadExportTable(datasetId: string): Promise<ExportTable | null> {
  const record = await getDatasetRecord(datasetId);
  if (!record) return null;
  const versionId = record.currentVersionId ?? record.versions[0]?.id ?? null;
  const version = versionId ? (record.versions.find((entry) => entry.id === versionId) ?? null) : null;
  const schema = parseSchema(version?.schema);
  const edits = await listActiveEdits(datasetId);
  const records = versionId ? applyEditsToRows(await fetchAllDatasetRows(versionId), edits) : [];
  return { datasetId, name: record.name, columns: schema.columns, roles: parseRoles(record.roles), records };
}

async function loadArtifact(url: string): Promise<ExportArtifact | null> {
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
  return content ? { format: artifact.format, content } : null;
}

/** The Plotly library source from node_modules, or null when it is not there. */
export async function readPlotlyBundle(): Promise<string | null> {
  const candidates = [path.join(process.cwd(), "node_modules", PLOTLY_BUNDLE)];
  for (const candidate of candidates) {
    const content = await fs.readFile(candidate, "utf8").catch(() => null);
    if (content) return content;
  }
  return null;
}

/** Render one report to HTML with its live data. */
export async function renderReportHtml(reportId: string, options: ExportOptions): Promise<{ html: string; title: string }> {
  const report = await getReportView(reportId);
  const datasetIds = new Set<string>();
  for (const block of report.blocks) if ("datasetId" in block) datasetIds.add(block.datasetId);
  for (const filter of report.filters) datasetIds.add(filter.datasetId);
  const tables = new Map<string, ExportTable>();
  for (const datasetId of datasetIds) {
    const table = await loadExportTable(datasetId);
    if (table) tables.set(datasetId, table);
  }
  const artifacts = new Map<string, ExportArtifact | null>();
  for (const block of report.blocks) {
    if (block.type !== "figure" || !block.figure) continue;
    artifacts.set(`${block.analysisId}:${block.figureName}`, await loadArtifact(block.figure.url));
  }
  const lists = await listCurationForViews(report.targetKey);
  let plotly: RenderInput["plotly"];
  if (options.plotly === "inline") {
    const bundle = await readPlotlyBundle();
    plotly = bundle ? { inline: bundle } : { src: PLOTLY_CDN_URL };
  } else {
    plotly = options.plotly;
  }
  const html = renderReportDocument({
    report,
    scopeLabel: await scopeLabelFor(report.targetKey),
    tables,
    artifacts,
    lists,
    curation: curationFromLists(lists),
    active: options.active ?? {},
    plotly,
    generatedAt: new Date(),
  });
  return { html, title: report.title };
}

const CSS = `
:root{color-scheme:light;--ink:#1f2328;--muted:#656d76;--line:#d9dde3;--paper:#fff;--soft:#f6f8fa;--accent:#0f5f8f}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
header,main,footer{max-width:1120px;margin:0 auto;padding:0 20px}
header{padding-top:36px}
.eyebrow{margin:0;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
h1{margin:6px 0 4px;font-size:28px;line-height:1.2;letter-spacing:-.01em}
.meta,.filters{margin:4px 0;color:var(--muted);font-size:13px}
.filters{color:var(--accent)}
.toc{margin:16px 0 0;padding:10px 16px;border:1px solid var(--line);border-radius:8px;background:var(--soft);font-size:13px}
.toc-title{margin:0 0 4px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.toc ol{margin:0;padding-left:1.4em;columns:2;column-gap:32px}
@media (max-width:640px){.toc ol{columns:1}}
.toc li{padding:2px 0;break-inside:avoid}
.toc a{color:var(--accent);text-decoration:none}
.toc a:hover{text-decoration:underline}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding-top:20px;padding-bottom:40px}
.block{min-width:0;border:1px solid var(--line);border-radius:8px;padding:16px;background:var(--paper)}
.span-2{grid-column:1/-1}
@media (max-width:820px){.grid{grid-template-columns:1fr}.span-1{grid-column:1/-1}}
.block h3{margin:0 0 10px;font-size:14px}
.block h4{margin:12px 0 4px;font-size:13px}
.prose{border:0;padding:8px 16px}
.prose h2{margin:0 0 8px;font-size:20px}
.prose h3{margin:12px 0 4px;font-size:16px}
.prose p{margin:0 0 10px}
.prose table{border-collapse:collapse;font-size:13px;margin:8px 0}
.prose th,.prose td{border-bottom:1px solid var(--line);padding:4px 10px;text-align:left}
.prose th{background:var(--soft)}
.prose code{background:var(--soft);padding:1px 4px;border-radius:3px;font-size:12px}
.prose blockquote{margin:0 0 10px;padding-left:12px;border-left:2px solid var(--line);color:var(--muted)}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:4px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:12px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.card{border:1px solid var(--line);border-radius:6px;padding:10px 12px}
.card .value{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}
.card .label{font-size:12px;color:var(--muted)}
.card .spark{display:block;width:100%;height:24px;margin-top:4px;color:var(--muted)}
.plot{width:100%}
.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media (max-width:820px){.pair{grid-template-columns:1fr}}
.note{margin:6px 0;font-size:12px;color:var(--muted)}
.footer{margin:10px 0 0;font-size:11px;color:var(--muted)}
.empty{border:1px dashed var(--line);border-radius:6px;padding:20px;text-align:center;color:var(--muted);font-size:13px}
.chip{display:inline-block;border-radius:999px;padding:0 7px;font-size:11px;white-space:nowrap}
.chip.plain{border:1px solid var(--line)}
.muted{color:var(--muted);font-weight:400}
img{max-width:100%;height:auto}
footer{padding:12px 20px 32px;color:var(--muted);font-size:12px;border-top:1px solid var(--line)}
`;

const INIT_SCRIPT = `(function(){var el=document.getElementById('plot-data');if(!el||typeof Plotly==='undefined')return;var plots=JSON.parse(el.textContent||'[]');plots.forEach(function(p){var node=document.getElementById(p.id);if(!node)return;var layout=Object.assign({autosize:true,margin:{l:50,r:20,t:40,b:50},paper_bgcolor:'rgba(0,0,0,0)'},p.layout);Plotly.newPlot(node,p.data,layout,{responsive:true,displaylogo:false});});})();`;
