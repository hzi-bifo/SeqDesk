import { describe, expect, it } from "vitest";
import { MAX_REPORT_BLOCKS, parseStoredBlocks, ReportInputSchema, resolveReportBlocks, suggestReportBlocks, type ReportOutputs } from "./reports";

const outputs: ReportOutputs = {
  figures: [
    { analysisId: "a1", analysisName: "Table summary", figureName: "distributions", runId: "r2", runNumber: "EXP-2", format: "plotly-json", url: "/f", thumbnailUrl: "/f.png", unchanged: true },
    { analysisId: "a2", analysisName: "Composition", figureName: "bars", runId: "r3", runNumber: "EXP-3", format: "png", url: "/g", thumbnailUrl: null, unchanged: false },
  ],
  tables: [
    { datasetId: "d-out", name: "Column summary (Table summary)", kind: "derived", output: true, rowCount: 15, columnCount: 14, version: 2, latestWrite: { runNumber: "EXP-2", changed: false }, columns: [] },
    { datasetId: "d-in", name: "Samples", kind: "samples", output: false, rowCount: 120, columnCount: 35, version: 1, latestWrite: null, columns: [{ key: "reads", label: "Reads", type: "number" }] },
  ],
};

describe("suggestReportBlocks", () => {
  it("opens with an intro, then every figure, then every output table", () => {
    const blocks = suggestReportBlocks(outputs);
    expect(blocks.map((block) => block.type)).toEqual(["text", "figure", "figure", "table"]);
    expect(blocks[1]).toMatchObject({ id: "figure:a1:distributions", analysisId: "a1", figureName: "distributions", span: 1 });
    expect(blocks[3]).toMatchObject({ id: "table:d-out", datasetId: "d-out", span: 2 });
    // Input datasets are not part of the draft; the report is about results.
    expect(blocks.some((block) => block.type === "table" && block.datasetId === "d-in")).toBe(false);
  });

  it("explains what to do when nothing has been computed", () => {
    const blocks = suggestReportBlocks({ figures: [], tables: [] });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "text" });
    expect((blocks[0] as { markdown: string }).markdown).toContain("Run one on the canvas");
  });
});

describe("resolveReportBlocks", () => {
  it("attaches live figures and tables, and marks what is gone", async () => {
    const loaded: string[] = [];
    const resolved = await resolveReportBlocks(
      [
        { id: "t", type: "text", markdown: "Hello" },
        { id: "f", type: "figure", analysisId: "a1", figureName: "distributions" },
        { id: "f-gone", type: "figure", analysisId: "a1", figureName: "removed" },
        { id: "tab", type: "table", datasetId: "d-out", rows: 5 },
        { id: "tab-foreign", type: "table", datasetId: "other-scope" },
        { id: "chart", type: "chart", datasetId: "d-in", chart: "histogram", x: "reads" },
        { id: "metric-foreign", type: "metric", datasetId: "other-scope", column: "reads", stats: ["mean"] },
      ],
      outputs,
      async (datasetId, limit) => {
        loaded.push(`${datasetId}:${limit}`);
        return { datasetId, name: "Column summary", version: 2, columns: [], rows: [], rowCount: 15, columnCount: 14 };
      }
    );
    expect(resolved[0]).toEqual({ id: "t", type: "text", markdown: "Hello" });
    expect(resolved[1]).toMatchObject({ type: "figure", figure: { runNumber: "EXP-2", unchanged: true } });
    expect(resolved[2]).toMatchObject({ type: "figure", figure: null });
    expect(resolved[3]).toMatchObject({ type: "table", table: { name: "Column summary" } });
    // A dataset outside the scope is never loaded, so a stored id cannot leak another scope's rows.
    expect(resolved[4]).toMatchObject({ type: "table", table: null });
    // Charts and numbers carry the table's columns; their rows come from the rows API on the page.
    expect(resolved[5]).toMatchObject({ type: "chart", table: { name: "Samples", columns: [{ key: "reads" }], rowCount: 120 } });
    expect(resolved[6]).toMatchObject({ type: "metric", table: null });
    expect(loaded).toEqual(["d-out:5"]);
  });
});

describe("report validation", () => {
  it("accepts the three block types and rejects unknown fields and oversized reports", () => {
    expect(
      ReportInputSchema.safeParse({
        title: "Cohort",
        blocks: [
          { id: "a", type: "text", markdown: "x" },
          { id: "b", type: "figure", analysisId: "a1", figureName: "f", span: 1 },
          { id: "c", type: "table", datasetId: "d", rows: 10 },
          { id: "d", type: "chart", datasetId: "d", chart: "scatter", x: "a", y: "b", color: "c" },
          { id: "e", type: "metric", datasetId: "d", column: "a", stats: ["count", "mean"] },
        ],
      }).success
    ).toBe(true);
    expect(ReportInputSchema.safeParse({ title: "x", blocks: [{ id: "a", type: "chart", datasetId: "d", chart: "pie", x: "a" }] }).success).toBe(false);
    expect(ReportInputSchema.safeParse({ title: "x", blocks: [{ id: "a", type: "metric", datasetId: "d", column: "a", stats: [] }] }).success).toBe(false);
    expect(ReportInputSchema.safeParse({ title: "", blocks: [] }).success).toBe(false);
    expect(ReportInputSchema.safeParse({ title: "x", blocks: [{ id: "a", type: "text", markdown: "x", extra: 1 }] }).success).toBe(false);
    expect(ReportInputSchema.safeParse({ title: "x", blocks: [{ id: "a", type: "video", url: "x" }] }).success).toBe(false);
    const many = Array.from({ length: MAX_REPORT_BLOCKS + 1 }, (_, index) => ({ id: `b${index}`, type: "text", markdown: "" }));
    expect(ReportInputSchema.safeParse({ title: "x", blocks: many }).success).toBe(false);
  });

  it("drops stored blocks it no longer understands instead of failing the page", () => {
    const blocks = parseStoredBlocks([{ id: "a", type: "text", markdown: "ok" }, { id: "b", type: "widget" }, "junk"]);
    expect(blocks).toEqual([{ id: "a", type: "text", markdown: "ok" }]);
    expect(parseStoredBlocks(null)).toEqual([]);
  });
});
