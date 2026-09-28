import { describe, expect, it } from "vitest";
import { ReportBlockSchema } from "./report-blocks";
import { topPerGroup } from "./report-export";

describe("table block: top N per group", () => {
  it("accepts a group column and a count, and rejects out-of-range counts", () => {
    const block = { id: "table:go", type: "table", datasetId: "d1", sort: { column: "padj", direction: "asc" }, perGroup: { column: "pattern", n: 5 } };
    expect(ReportBlockSchema.parse(block)).toMatchObject({ perGroup: { column: "pattern", n: 5 } });
    expect(() => ReportBlockSchema.parse({ ...block, perGroup: { column: "pattern", n: 0 } })).toThrow();
    expect(() => ReportBlockSchema.parse({ ...block, perGroup: { column: "", n: 3 } })).toThrow();
    expect(() => ReportBlockSchema.parse({ ...block, perGroup: { column: "pattern", n: 3, extra: 1 } })).toThrow();
  });
  it("keeps the first n rows of each group in the given order", () => {
    const rows = [{ g: "P1", v: 1 }, { g: "P2", v: 2 }, { g: "P1", v: 3 }, { g: "P1", v: 4 }, { g: "P2", v: 5 }, { g: null, v: 6 }];
    expect(topPerGroup(rows, "g", 2).map((row) => row.v)).toEqual([1, 2, 3, 5, 6]);
  });
});
