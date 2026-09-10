import { describe, expect, it } from "vitest";
import { suggestCharts, suggestedChartTitle } from "./chart-suggestions";
import { buildChart } from "./report-widgets";
import type { ExploreColumn } from "./types";

const columns: ExploreColumn[] = [
  { key: "record_number", label: "Record", type: "number", role: "subject" },
  { key: "specimen", label: "Specimen", type: "string", role: "sample" },
  { key: "other_measurement", label: "Amount", type: "number", unit: "mg" },
  { key: "signal", label: "Signal", type: "number", role: "value", unit: "mV" },
  { key: "reference", label: "Reference signal", type: "number", unit: "mV" },
  { key: "arm", label: "Group", type: "string", role: "group" },
];
const rows = [
  { record_number: 1, specimen: "A", signal: 4, reference: 5, other_measurement: 100, arm: "Case" },
  { record_number: 2, specimen: "B", signal: 0, reference: 1, other_measurement: 110, arm: "Case" },
  { record_number: 3, specimen: "C", signal: 8, reference: 9, other_measurement: 120, arm: "Control" },
  { record_number: 4, specimen: "D", signal: 9, reference: 10, other_measurement: 130, arm: "Control" },
];

describe("pipeline-independent chart suggestions", () => {
  it("uses roles instead of field order or pipeline names and offers at most three views", () => {
    const suggestions = suggestCharts(columns, rows);
    expect(suggestions).toHaveLength(3);
    expect(suggestions[0].spec).toEqual({ chart: "values", x: "specimen", y: "signal" });
    expect(suggestions[1].spec).toEqual({ chart: "box", x: "arm", y: "signal" });
    expect(suggestions[2].spec).toEqual({ chart: "scatter", x: "signal", y: "reference" });
    expect(suggestions[0].title).toBe("Signal (mV) by Specimen");
    for (const suggestion of suggestions) expect(buildChart(rows, columns, suggestion.spec).data.length).toBeGreaterThan(0);
  });

  it("does not suggest group or distribution plots from a single row", () => {
    expect(suggestCharts(columns, rows.slice(0, 1)).map(suggestion => suggestion.id)).toEqual(["values"]);
  });

  it("skips all-null measurements and keeps real zero values", () => {
    const data = rows.map(row => ({ ...row, signal: null }));
    const choices = suggestCharts(columns, data);
    expect(choices[0].spec.y).toBe("other_measurement");
    expect(buildChart(rows, columns, suggestCharts(columns, rows)[0].spec).data[0].y).toEqual([4, 0, 8, 9]);
  });

  it("does not reinterpret missing or invalid measurements as category counts", () => {
    const summary = [columns[1], columns[3]];
    expect(suggestCharts(summary, [{ specimen: "A", signal: null }, { specimen: "B", signal: "NaN" }])).toEqual([]);
    expect(suggestCharts(summary, [{ specimen: "A", signal: true }])).toEqual([]);
    expect(suggestCharts(summary, [])).toEqual([]);
  });

  it("separates repeated labels using a real distinguishing column without summing", () => {
    const paired = [columns[1], columns[3], { key: "mate", label: "Mate", type: "string" as const }];
    const data = [{ specimen: "A", mate: "R1", signal: 10 }, { specimen: "A", mate: "R2", signal: 8 }];
    const suggestion = suggestCharts(paired, data)[0];
    expect(suggestion.spec).toEqual({ chart: "values", x: "specimen", y: "signal", color: "mate" });
    expect(buildChart(data, paired, suggestion.spec).data.map(trace => trace.y)).toEqual([[10], [8]]);
    expect(suggestCharts(paired.slice(0, 2), data).some(suggestion => suggestion.id === "values")).toBe(false);
  });

  it("does not suggest a box plot with one observation in a group", () => {
    expect(suggestCharts(columns, rows.slice(1)).some(suggestion => suggestion.id === "box")).toBe(false);
  });

  it("counts metadata categories as rows, preferring groups over unique sample IDs", () => {
    const suggestion = suggestCharts(columns.filter(column => column.type === "string"), rows)[0];
    expect(suggestion.spec).toEqual({ chart: "bar", x: "arm" });
    expect(suggestion.title).toBe("Rows by Group");
    expect(suggestCharts([columns[1]], rows)).toEqual([]);
  });

  it("preserves arbitrary units and fractions without normalization or conversion", () => {
    const percentage: ExploreColumn[] = [{ key: "category", label: "Category", type: "string" }, { key: "abundance", label: "Abundance", type: "number", unit: "fraction", role: "value" }];
    const data = [{ category: "A", abundance: 0.125 }, { category: "B", abundance: 0.875 }];
    const suggested = suggestCharts(percentage, data)[0];
    expect(buildChart(data, percentage, suggested.spec).data[0].y).toEqual([0.125, 0.875]);
    expect(suggested.title).toBe("Abundance (fraction) by Category");
  });

  it("does not use internal IDs or JSON fields as measurements or chart labels", () => {
    const technical: ExploreColumn[] = [{ key: "sample_db_id", label: "Record", type: "string", role: "sample" }, { key: "opaque", label: "Raw", type: "json" }, { key: "numeric_identity", label: "Record number", type: "number", group: "identity" }];
    expect(suggestCharts(technical, [{ sample_db_id: "internal", opaque: "{}", numeric_identity: 1 }])).toEqual([]);
  });

  it("does not mutate source data or column order", () => {
    const before = JSON.stringify({ rows, columns });
    suggestCharts(columns, rows);
    expect(JSON.stringify({ rows, columns })).toBe(before);
  });

  it("derives titles from selected axes and keeps captions within the report limit", () => {
    expect(suggestedChartTitle(columns, { chart: "scatter", x: "signal", y: "other_measurement" })).toBe("Amount (mg) vs Signal (mV)");
    expect(suggestedChartTitle(columns, { chart: "histogram", x: "signal" })).toBe("Distribution of Signal (mV)");
    const huge = [{ ...columns[3], label: "long ".repeat(150) }];
    expect(suggestedChartTitle(huge, { chart: "histogram", x: "signal" }).length).toBeLessThanOrEqual(500);
  });
});
