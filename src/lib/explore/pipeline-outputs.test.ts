import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ samples: vi.fn(), runs: vi.fn(), selections: vi.fn(), getPackage: vi.fn(), loadKits: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { sample: { findMany: mocks.samples }, pipelineRun: { findMany: mocks.runs }, pipelineResultSelection: { findMany: mocks.selections } } }));
vi.mock("@/lib/pipelines/package-loader", () => ({ getPackage: mocks.getPackage }));
vi.mock("./kits/loader", () => ({ loadKits: mocks.loadKits }));
import { listPipelineOutputs } from "./pipeline-outputs";
import { outputFileView } from "./pipeline-output-types";
import type { BuildContext } from "./builders/types";
const context: BuildContext = { targetKey: "study:mine", target: { type: "study", id: "mine" }, userId: "owner", installation: false, isFacilityAdmin: false };
const artifact = (id: string, name: string, sampleId: string | null = "s1") => ({ id, path: `/run/${name}`, outputId: id, sampleId, name, size: BigInt(123) });
const table = { tableKind: "custom-measurement", format: "json", rowEntity: "specimen", columns: { measured: { type: "number", unit: "percent" } }, roles: { value: "measured" } };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.samples.mockResolvedValue([{ id: "s1", sampleId: "Shared control", sampleAlias: null }]);
  mocks.selections.mockResolvedValue([]);
  mocks.runs.mockResolvedValue([{ id: "run1", pipelineId: "user-contributed-tool", runNumber: "TOOL-001", completedAt: new Date("2026-09-09"), orderId: "source-order", studyId: null, inputSampleIds: '["s1","foreign"]',
    artifacts: [artifact("table", "measurements.json"), artifact("report", "report.html"), artifact("image", "figure.png"), artifact("custom", "tool.custom"), artifact("private", "private.html", "foreign"), artifact("aggregate", "all.html", null)] }]);
  mocks.getPackage.mockReturnValue({ manifest: { package: { name: "User-contributed tool" }, outputs: [{ id: "table", scope: "sample", table }] } });
  mocks.loadKits.mockResolvedValue({ kits: [{ manifest: { id: "generic-percentage", name: "Percentage overview", outputs: [{ name: "overview", kind: "figure" }], inputs: [{ alias: "values", requiredRoles: ["sample", "value"], requiredRoleTypes: { value: { type: "number", unit: "percent" } } }] } },
    { manifest: { id: "count-only", name: "Count overview", inputs: [{ alias: "counts", requiredRoles: [], requiredColumns: { count: { type: "number" } } }] } }], problems: [] });
});
describe("shared pipeline output catalog", () => {
  it("discovers tables, reports, images and unknown files without naming the pipeline in app code", async () => {
    const result = await listPipelineOutputs(context);
    expect(result.map(output => output.kind).sort()).toEqual(["file", "image", "report", "table"]);
    expect(result.every(output => output.pipelineName === "User-contributed tool")).toBe(true);
    expect(result.find(output => output.kind === "table")?.templates).toEqual([{ id: "generic-percentage", name: "Percentage overview", inputAlias: "values", outputSummary: "1 chart" }]);
  });
  it("does not expose foreign samples or a different scope's aggregate to linked controls", async () => {
    const result = await listPipelineOutputs(context);
    const files = result.flatMap(output => output.runs.flatMap(run => run.files));
    expect(files.map(file => file.id)).not.toContain("private");
    expect(files.map(file => file.id)).not.toContain("aggregate");
    expect(files[0].sample).toBe("Shared control");
    expect(JSON.stringify(result)).not.toContain("/run/");
  });
  it("keeps unknown file types download-only", async () => {
    const file = (await listPipelineOutputs(context)).find(output => output.kind === "file")!.runs[0].files[0];
    expect(file.previewable).toBe(false);
    expect(file.size).toBe(123);
  });
  it("does not invent data tables for missing package declarations", async () => {
    mocks.getPackage.mockReturnValue(null);
    const result = await listPipelineOutputs(context);
    expect(result.every(output => output.templates.length === 0)).toBe(true);
    expect(result.some(output => output.table)).toBe(false);
  });
  it.each(["payload.svg", "script.js", "binary.fastq.gz"])("does not execute unsupported formats (%s)", file => {
    expect(outputFileView(file)).toEqual({ kind: "file", contentType: null });
  });
});
