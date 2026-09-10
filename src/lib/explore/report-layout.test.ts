import { describe, expect, it } from "vitest";
import { MAX_REPORT_BLOCKS, type ReportBlock } from "./report-blocks";
import { insertReportBlock, moveReportBlock, reportBlockSpan } from "./report-layout";

const blocks: ReportBlock[] = [
  { id: "intro", type: "text", markdown: "## Introduction", span: 2 },
  { id: "measurements", type: "table", datasetId: "d1", columns: ["signal"], sort: { column: "signal", direction: "desc" }, filter: "signal > 0", search: true, download: false, span: 1 },
  { id: "visual", type: "chart", datasetId: "d1", chart: "values", x: "sample", y: "signal", caption: "My chart", span: 1 },
];
const added: ReportBlock = { id: "note", type: "text", markdown: "Notes", span: 2 };
const ids = (value: ReportBlock[]) => value.map(block => block.id);

describe("report layout operations", () => {
  it("inserts at stable before/after anchors and at the end", () => {
    expect(ids(insertReportBlock(blocks, added, { blockId: "measurements", edge: "before" }))).toEqual(["intro", "note", "measurements", "visual"]);
    expect(ids(insertReportBlock(blocks, added, { blockId: "measurements", edge: "after" }))).toEqual(["intro", "measurements", "note", "visual"]);
    expect(ids(insertReportBlock(blocks, added))).toEqual(["intro", "measurements", "visual", "note"]);
    expect(insertReportBlock([], added)).toEqual([added]);
  });
  it("moves in either direction without replacing the destination", () => {
    expect(ids(moveReportBlock(blocks, "visual", { blockId: "intro", edge: "before" }))).toEqual(["visual", "intro", "measurements"]);
    expect(ids(moveReportBlock(blocks, "intro", { blockId: "measurements", edge: "after" }))).toEqual(["measurements", "intro", "visual"]);
    expect(ids(moveReportBlock(blocks, "intro", null))).toEqual(["measurements", "visual", "intro"]);
  });
  it("preserves every setting and leaves the original untouched for Undo", () => {
    const before = JSON.stringify(blocks);
    const moved = moveReportBlock(blocks, "measurements", null);
    expect(moved[2]).toBe(blocks[1]);
    expect(JSON.stringify(blocks)).toBe(before);
    expect(insertReportBlock(blocks, added)[1]).toBe(blocks[1]);
  });
  it("does not save no-op moves or duplicate additions", () => {
    expect(moveReportBlock(blocks, "intro", { blockId: "intro", edge: "after" })).toBe(blocks);
    expect(moveReportBlock(blocks, "intro", { blockId: "measurements", edge: "before" })).toBe(blocks);
    expect(moveReportBlock(blocks, "visual", null)).toBe(blocks);
    expect(moveReportBlock(blocks, "gone", null)).toBe(blocks);
    expect(insertReportBlock(blocks, blocks[1])).toBe(blocks);
  });
  it("rejects vanished anchors rather than silently appending in the wrong place", () => {
    expect(() => insertReportBlock(blocks, added, { blockId: "deleted", edge: "before" })).toThrow(/insertion point/);
    expect(() => moveReportBlock(blocks, "intro", { blockId: "deleted", edge: "after" })).toThrow(/insertion point/);
  });
  it("allows rearranging a full page but not adding beyond its block limit", () => {
    const full = Array.from({ length: MAX_REPORT_BLOCKS }, (_, index): ReportBlock => ({ ...added, id: `block-${index}` }));
    expect(() => insertReportBlock(full, added)).toThrow(/already has/);
    expect(moveReportBlock(full, "block-0", null)).toHaveLength(MAX_REPORT_BLOCKS);
  });
  it("keeps the existing full/half-width defaults", () => {
    expect(reportBlockSpan({ id: "text", type: "text", markdown: "" })).toBe(2);
    expect(reportBlockSpan({ id: "figure", type: "figure", analysisId: "a", figureName: "f" })).toBe(1);
    expect(reportBlockSpan({ ...blocks[2], span: 2 })).toBe(2);
    expect(reportBlockSpan(blocks[1])).toBe(1);
  });
});
