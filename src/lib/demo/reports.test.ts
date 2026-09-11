import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { study: { findMany: vi.fn() } },
  buildDataset: vi.fn(),
  createReport: vi.fn(),
  saveReport: vi.fn(),
  createAnalysis: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/explore/build", () => ({ buildDataset: mocks.buildDataset }));
vi.mock("@/lib/explore/reports", () => ({ createReport: mocks.createReport, saveReport: mocks.saveReport }));
vi.mock("@/lib/explore/analyses", () => ({ createAnalysis: mocks.createAnalysis }));
vi.mock("@/lib/explore/datasets", () => ({ getDatasetRecord: vi.fn().mockResolvedValue(null) }));

import { ReportInputSchema } from "@/lib/explore/report-blocks";
import { STUDY_HUMAN_GUT_PRJEB54724, STUDY_MOUSE_GUT_PRJDB6165, STUDY_SURFACE_RESISTOME } from "@/lib/seed/templates";
import { humanGutBlocks, numbersBlock, seedDemoReports } from "./reports";

const built = (id: string, columns: string[]) => ({ dataset: { id, schema: { columns: columns.map((key) => ({ key, label: key, type: "string" })) } }, version: { versionId: "v1" }, warnings: [] });

describe("demo reports", () => {
  beforeEach(() => {
    for (const fn of [mocks.db.study.findMany, mocks.buildDataset, mocks.createReport, mocks.saveReport, mocks.createAnalysis]) fn.mockReset();
    mocks.createReport.mockImplementation(async (_target: string, _user: string, title: string) => ({ id: `report-${title.slice(0, 5)}`, title }));
    mocks.saveReport.mockResolvedValue({});
    mocks.createAnalysis.mockResolvedValue({ id: "a1" });
  });

  it("composes blocks only for columns the table really has", () => {
    const numbers = numbersBlock({ datasetId: "d1", columns: new Set(["sample_id", "reads"]) }, [
      { column: "sample_id", stat: "count", label: "Samples" },
      { column: "missing", stat: "mean", label: "Nothing" },
    ], "Numbers");
    expect(numbers).toMatchObject({ type: "run-metric", figures: [{ datasetId: "d1", column: "sample_id", stat: "count" }] });
    expect(numbersBlock({ datasetId: "d1", columns: new Set(["x"]) }, [{ column: "y", stat: "count", label: "y" }], "Numbers")).toBeNull();
    const withoutTables = humanGutBlocks(null, null);
    expect(withoutTables.every((block) => block.type === "text")).toBe(true);
  });

  it("seeds one valid report per showcase study and an analysis step for the mouse QC table", async () => {
    mocks.db.study.findMany.mockResolvedValue([
      { id: "s-human", title: STUDY_HUMAN_GUT_PRJEB54724.titleBase },
      { id: "s-mouse", title: STUDY_MOUSE_GUT_PRJDB6165.titleBase },
      { id: "s-pilot", title: STUDY_SURFACE_RESISTOME.titleBase },
    ]);
    mocks.buildDataset.mockImplementation(async (request: { context: { targetKey: string }; kind: string; options?: { pipelineId?: string } }) => {
      if (request.kind === "samples") return built(`samples-${request.context.targetKey}`, ["sample_id", "site"]);
      if (request.options?.pipelineId === "kraken2-bracken") return built("taxa", ["sample_id", "top_taxon", "new_est_reads", "fraction_total_reads"]);
      if (request.options?.pipelineId === "fastqc") return built(`qc-${request.context.targetKey}`, ["sample_id", "r1_read_count", "r1_avg_quality", "r1_fail"]);
      if (request.options?.pipelineId === "simulate-reads") throw new Error("no artifacts");
      return null;
    });
    const result = await seedDemoReports("user-1");
    expect(result.reports).toBe(3);
    for (const call of mocks.saveReport.mock.calls) {
      expect(ReportInputSchema.safeParse(call[1]).success, JSON.stringify(call[1]).slice(0, 200)).toBe(true);
    }
    const human = mocks.saveReport.mock.calls.find((call) => call[1].title.startsWith("Human"))![1];
    expect(human.blocks.map((block: { type: string }) => block.type)).toEqual(["text", "run-metric", "chart", "chart", "table", "table", "text"]);
    expect(mocks.createAnalysis).toHaveBeenCalledWith(expect.objectContaining({ kitId: "fastqc-overview", reportId: "report-Mouse", inputs: [{ alias: "qc", datasetId: "qc-study:s-mouse", versionId: null }] }));
    const pilot = mocks.saveReport.mock.calls.find((call) => call[1].title.startsWith("Surface"))![1];
    // The simulation table failed to build and is simply absent.
    expect(pilot.blocks.filter((block: { type: string }) => block.type === "table")).toHaveLength(1);
  });

  it("never fails the demo when the lookup itself fails", async () => {
    mocks.db.study.findMany.mockRejectedValue(new Error("db down"));
    await expect(seedDemoReports("user-1")).resolves.toEqual({ reports: 0 });
  });
});
