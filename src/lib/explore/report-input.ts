/**
 * The saved page as the editor's draft: every field an author can set on a
 * block, and nothing the server resolved (tables, figures, analyses). Any
 * field left out here would be lost on the first autosave, so the test next
 * to this file checks the round trip for every block type.
 */
import type { ReportBlock } from "./report-blocks";
import type { ReportInput, ReportView } from "./reports";

export function toInput(report: ReportView): ReportInput {
  return {
    title: report.title,
    filters: report.filters,
    blocks: report.blocks.map((block): ReportBlock => {
      if (block.type === "text") return { id: block.id, type: "text", markdown: block.markdown, span: block.span };
      if (block.type === "figure") {
        return { id: block.id, type: "figure", analysisId: block.analysisId, figureName: block.figureName, caption: block.caption, span: block.span };
      }
      if (block.type === "chart") {
        return { id: block.id, type: "chart", datasetId: block.datasetId, chart: block.chart, x: block.x, y: block.y, color: block.color, caption: block.caption, span: block.span };
      }
      if (block.type === "metric") return { id: block.id, type: "metric", datasetId: block.datasetId, column: block.column, stats: block.stats, label: block.label, span: block.span };
      if (block.type === "view") return { id: block.id, type: "view", datasetId: block.datasetId, view: block.view, options: block.options, caption: block.caption, span: block.span };
      if (block.type === "taxon-explorer") return { id: block.id, type: "taxon-explorer", datasetId: block.datasetId, taxon: block.taxon, caption: block.caption, span: block.span };
      if (block.type === "subject") return { id: block.id, type: "subject", datasetId: block.datasetId, subject: block.subject, measure: block.measure, caption: block.caption, span: block.span };
      if (block.type === "curated") return { id: block.id, type: "curated", datasetId: block.datasetId, role: block.role, lists: block.lists, limit: block.limit, caption: block.caption, span: block.span };
      if (block.type === "run-metric") return { id: block.id, type: "run-metric", analysisId: block.analysisId, metrics: block.metrics, figures: block.figures, order: block.order, labels: block.labels, digits: block.digits, units: block.units, targets: block.targets, columns: block.columns, trend: block.trend, trends: block.trends, timeline: block.timeline, label: block.label, span: block.span };
      return { id: block.id, type: "table", datasetId: block.datasetId, caption: block.caption, rows: block.rows, columns: block.columns, sort: block.sort, filter: block.filter, search: block.search, sortable: block.sortable, download: block.download, span: block.span };
    }),
  };
}

