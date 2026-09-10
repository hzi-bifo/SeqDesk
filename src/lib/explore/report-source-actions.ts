/** Shared editor actions. Only explicit clicks add blocks; no analysis is created or run. */
import { fetcher, postJson } from "./client";
import { toInput } from "./report-input";
import { MAX_REPORT_BLOCKS, ReportBlockSchema, type ChartKind, type ReportBlock } from "./report-blocks";
import type { ReportTable, ReportView } from "./reports";
import type { ExploreColumn } from "./types";
import type { ChartSpec } from "./report-widgets";

export type ChartTable = Pick<ReportTable, "datasetId" | "name" | "columns" | "rowCount" | "version">;

export function chartChoices(columns: ExploreColumn[]): ChartKind[] {
  const numeric = columns.filter(column => column.type === "number");
  const labels = columns.some(column => column.type === "string" || column.type === "boolean" || column.type === "date");
  return [
    ...(numeric.length && labels ? ["values" as const] : []),
    ...(numeric.length ? ["histogram" as const] : []),
    ...(columns.some(column => column.type !== "json") ? ["bar" as const] : []),
    ...(numeric.length >= 2 ? ["scatter" as const] : []),
    ...(numeric.length && labels ? ["box" as const] : []),
  ];
}

export function initialChartSpec(columns: ExploreColumn[], preferred?: ChartKind): ChartSpec {
  const choices = chartChoices(columns);
  const chart = preferred && choices.includes(preferred) ? preferred : choices[0] ?? "bar";
  const numeric = columns.filter(column => column.type === "number");
  const labels = columns.filter(column => column.type !== "number" && column.type !== "json");
  const label = labels.find(column => column.key === "sample_id" || column.role === "sample") ?? labels[0];
  return { chart, x: (chart === "histogram" || chart === "scatter" ? numeric[0] : label ?? numeric[0])?.key ?? "", ...(chart === "values" || chart === "box" ? { y: numeric[0]?.key } : chart === "scatter" ? { y: numeric[1]?.key } : {}) };
}

export async function appendReportBlock(reportId: string, scope: string, block: ReportBlock): Promise<void> {
  const parsed = ReportBlockSchema.parse(block);
  const key = `/api/explore/reports/${encodeURIComponent(reportId)}`;
  const { report } = await fetcher(key) as { report: ReportView };
  if (report.targetKey !== scope) throw new Error("This report belongs to a different data scope.");
  const input = toInput(report);
  if (input.blocks.some(entry => entry.id === parsed.id)) return;
  if (input.blocks.length >= MAX_REPORT_BLOCKS) throw new Error(`This page already has ${MAX_REPORT_BLOCKS} blocks. Remove a block before adding another.`);
  // Never retry a conflict automatically or drop settings on unrelated blocks.
  await postJson(key, { ...input, blocks: [...input.blocks, parsed], expectedUpdatedAt: report.updatedAt ?? undefined }, "PUT");
}
