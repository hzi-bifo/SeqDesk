import { describe, expect, it } from "vitest";
import { ReportInputSchema, resolveReportBlocks, type ReportOutputs } from "./reports";

const outputs = {
  figures: [],
  analyses: [],
  tables: [{ datasetId: "d-out", name: "Pin audit", kind: "table", output: true, rowCount: 1, columnCount: 2, version: 3, latestWrite: null, columns: [], roles: {}, views: [] }],
} as unknown as ReportOutputs;

describe("a table block that keeps the version a reader cited", () => {
  it("is accepted by the report schema and handed to the table loader", async () => {
    const parsed = ReportInputSchema.parse({ title: "T", blocks: [{ id: "tab", type: "table", datasetId: "d-out", versionId: "v-1", rows: 5 }] });
    expect(parsed.blocks[0]).toMatchObject({ versionId: "v-1" });
    const seen: Array<string | undefined> = [];
    await resolveReportBlocks(parsed.blocks, outputs, async (datasetId, limit, versionId) => {
      seen.push(versionId);
      return { datasetId, name: "Pin audit", version: 1, columns: [], rows: [], rowCount: 1, columnCount: 2 };
    });
    expect(seen).toEqual(["v-1"]);
  });

  it("passes the first row of a citation that starts below the top", async () => {
    const seen: Array<number | undefined> = [];
    await resolveReportBlocks([{ id: "tab", type: "table", datasetId: "d-out", rows: 3, from: 40 }], outputs, async (datasetId, _limit, _versionId, from) => {
      seen.push(from);
      return { datasetId, name: "Pin audit", version: 3, columns: [], rows: [], rowCount: 100, columnCount: 2 };
    });
    expect(seen).toEqual([40]);
    expect(() => ReportInputSchema.parse({ title: "T", blocks: [{ id: "tab", type: "table", datasetId: "d-out", from: 0 }] })).toThrow();
  });

  it("without a version follows the table's current one", async () => {
    const seen: Array<string | undefined> = [];
    await resolveReportBlocks([{ id: "tab", type: "table", datasetId: "d-out" }], outputs, async (datasetId, _limit, versionId) => {
      seen.push(versionId);
      return { datasetId, name: "Pin audit", version: 3, columns: [], rows: [], rowCount: 1, columnCount: 2 };
    });
    expect(seen).toEqual([undefined]);
  });
});
