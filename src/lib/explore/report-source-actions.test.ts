import { beforeEach, describe, expect, it, vi } from "vitest";
import { appendReportBlock, chartChoices, initialChartSpec } from "./report-source-actions";
import { buildChart } from "./report-widgets";
import type { ExploreColumn } from "./types";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), post: vi.fn() }));
vi.mock("./client", () => ({ fetcher: mocks.fetch, postJson: mocks.post }));
const columns: ExploreColumn[] = [
  { key: "sample_id", label: "Sample", type: "string", role: "sample" },
  { key: "reads", label: "Read count", type: "number", unit: "reads" },
  { key: "quality", label: "Mean quality", type: "number", unit: "Phred" },
  { key: "mate", label: "Read mate", type: "string" },
];

describe("data-driven chart choices", () => {
  it("prefills actual values by sample without knowing a pipeline name", () => {
    expect(chartChoices(columns)).toEqual(["values", "histogram", "bar", "scatter", "box"]);
    expect(initialChartSpec(columns)).toEqual({ chart: "values", x: "sample_id", y: "reads" });
    expect(initialChartSpec(columns, "scatter")).toEqual({ chart: "scatter", x: "reads", y: "quality" });
  });
  it("does not offer numeric charts for a metadata-only text table", () => {
    expect(chartChoices(columns.filter(column => column.type === "string"))).toEqual(["bar"]);
    expect(chartChoices([])).toEqual([]);
    expect(chartChoices([{ key: "nested", label: "Nested data", type: "json" }])).toEqual([]);
    expect(initialChartSpec([{ key: "nested", label: "Nested data", type: "json" }, columns[1]], "bar").x).toBe("reads");
    expect(initialChartSpec([columns[0]], "scatter").chart).toBe("bar");
  });
  it("draws saved measurements, not row counts; preserves zero and units", () => {
    const result = buildChart([{ sample_id: "A", reads: 1600 }, { sample_id: "B", reads: 0 }, { sample_id: "C", reads: null }], columns, { chart: "values", x: "sample_id", y: "reads" });
    expect(result.data[0].y).toEqual([1600, 0]);
    expect(result.layout.yaxis).toEqual({ title: { text: "Read count (reads)" } });
    expect(result.notes.join()).toContain("missing values are not zero");
  });
  it("never silently sums repeated samples or mates", () => {
    const rows = [{ sample_id: "A", mate: "R1", reads: 12 }, { sample_id: "A", mate: "R2", reads: 10 }];
    const spec = { chart: "values" as const, x: "sample_id", y: "reads" };
    expect(buildChart(rows, columns, spec).data).toEqual([]);
    expect(buildChart(rows, columns, { ...spec, color: "mate" }).data.map(trace => trace.y)).toEqual([[12], [10]]);
  });
  it("bounds displays and exposes truncated data", () => {
    const rows = Array.from({ length: 35 }, (_, i) => ({ sample_id: `S${i}`, reads: i }));
    const result = buildChart(rows, columns, { chart: "values", x: "sample_id", y: "reads" }, 80);
    expect(result.data[0].x).toHaveLength(30);
    expect(result.notes.join()).toContain("35 of 80");
    expect(result.notes.join()).toContain("first 30 labels");
  });
});

describe("append from the canvas without losing existing page settings", () => {
  const table = { id: "table:existing", type: "table", datasetId: "existing", columns: ["reads"], filter: "reads > 0", sort: { column: "reads", direction: "desc" }, search: true, download: true, sortable: true, table: { rows: [] } };
  const figures = { id: "metrics", type: "run-metric", metrics: [], figures: [{ id: "one", datasetId: "existing", column: "reads", stat: "sum" }], units: { "f:one": "reads" }, digits: { "f:one": 0 }, analysis: null };
  const block = { id: "table:new", type: "table" as const, datasetId: "new" };
  beforeEach(() => { vi.clearAllMocks(); mocks.fetch.mockResolvedValue({ report: { id: "report", targetKey: "order:one", title: "My report", blocks: [table, figures], filters: [], updatedAt: "2026-09-09T12:00:00Z" } }); mocks.post.mockResolvedValue({}); });
  it("preserves table configuration and dashboard metrics", async () => {
    await appendReportBlock("report", "order:one", block);
    const body = mocks.post.mock.calls[0][1];
    expect(body.blocks[0]).toMatchObject({ columns: ["reads"], filter: "reads > 0", search: true, download: true, sortable: true, sort: table.sort });
    expect(body.blocks[0]).not.toHaveProperty("table");
    expect(body.blocks[1]).toMatchObject({ figures: figures.figures, units: figures.units, digits: figures.digits });
    expect(body.expectedUpdatedAt).toBe("2026-09-09T12:00:00Z");
    expect(body.blocks[2]).toEqual(block);
  });
  it("does not duplicate an existing block", async () => {
    await appendReportBlock("report", "order:one", { ...block, id: table.id });
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("does not retry a conflicting save", async () => {
    mocks.post.mockRejectedValue(new Error("changed elsewhere"));
    await expect(appendReportBlock("report", "order:one", block)).rejects.toThrow("changed elsewhere");
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
  it("rejects a report in another scope", async () => {
    await expect(appendReportBlock("report", "order:other", block)).rejects.toThrow("different data scope");
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
