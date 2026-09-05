import { describe, expect, it } from "vitest";
import { buildChart, computeStats, formatStat, numericColumns } from "./report-widgets";

const columns = [
  { key: "reads", label: "Reads", type: "number" as const },
  { key: "depth", label: "Depth", type: "number" as const },
  { key: "site", label: "Site", type: "string" as const },
];
const rows = [
  { reads: 10, depth: 1.5, site: "gut" },
  { reads: 20, depth: 2.5, site: "gut" },
  { reads: 30, depth: null, site: "skin" },
  { reads: "40", depth: 4, site: "" },
];

describe("computeStats", () => {
  it("summarises a numeric column, reading numbers stored as text", () => {
    const stats = computeStats(rows, "reads");
    expect(stats).toEqual({ count: 4, distinct: 4, missing: 0, mean: 25, median: 25, min: 10, max: 40, sum: 100 });
  });

  it("counts missing values and leaves arithmetic empty for text columns", () => {
    expect(computeStats(rows, "depth")).toMatchObject({ count: 4, missing: 1, distinct: 3, min: 1.5, max: 4 });
    expect(computeStats(rows, "site")).toMatchObject({ count: 4, distinct: 2, missing: 1, mean: null, sum: null });
  });

  it("formats numbers for people", () => {
    expect(formatStat(null)).toBe("n/a");
    expect(formatStat(1234)).toBe("1,234");
    expect(formatStat(2.34567)).toBe("2.35");
    expect(formatStat(123.456)).toBe("123.5");
  });
});

describe("buildChart", () => {
  it("draws a histogram of a numeric column and one trace per colour group", () => {
    const plain = buildChart(rows, columns, { chart: "histogram", x: "reads" });
    expect(plain.data).toHaveLength(1);
    expect(plain.data[0]).toMatchObject({ type: "histogram", x: [10, 20, 30, 40] });
    const coloured = buildChart(rows, columns, { chart: "histogram", x: "reads", color: "site" });
    expect(coloured.data.map((trace) => trace.name)).toEqual(["gut", "skin", "(missing)"]);
    expect(coloured.layout).toMatchObject({ barmode: "overlay" });
  });

  it("falls back to counting values when a histogram column is text, and says so", () => {
    const result = buildChart(rows, columns, { chart: "histogram", x: "site" });
    expect(result.data[0]).toMatchObject({ type: "bar", x: ["gut", "skin", "(missing)"], y: [2, 1, 1] });
    expect(result.notes[0]).toContain("not numeric");
  });

  it("draws dots for two numeric columns and skips rows with a missing value", () => {
    const result = buildChart(rows, columns, { chart: "scatter", x: "reads", y: "depth" });
    expect(result.data[0]).toMatchObject({ type: "scatter", x: [10, 20, 40], y: [1.5, 2.5, 4] });
    expect(buildChart(rows, columns, { chart: "scatter", x: "reads" }).notes[0]).toContain("second column");
  });

  it("draws one box per group and notes when rows were cut", () => {
    const result = buildChart(rows, columns, { chart: "box", x: "site", y: "reads" }, 5000);
    expect(result.data.map((trace) => trace.name)).toEqual(["gut", "skin", "(missing)"]);
    expect(result.data[0]).toMatchObject({ type: "box", y: [10, 20] });
    expect(result.notes[0]).toContain("first 4 of 5,000 rows");
  });

  it("knows which columns are numeric", () => {
    expect(numericColumns(columns).map((column) => column.key)).toEqual(["reads", "depth"]);
  });
});
