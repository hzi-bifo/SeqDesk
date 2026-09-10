import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ report: vi.fn(), update: vi.fn(), analysis: vi.fn(), analyses: vi.fn(), create: vi.fn(), validate: vi.fn(), kit: vi.fn(), environment: vi.fn(), start: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { exploreReport: { findUnique: mocks.report, updateMany: mocks.update }, exploreAnalysis: { findUnique: mocks.analysis, findFirst: mocks.analysis, findMany: mocks.analyses } } }));
vi.mock("./analyses", () => ({ createAnalysis: mocks.create }));
vi.mock("./input-validation", () => ({ validateAnalysisInputs: mocks.validate }));
vi.mock("./kits/loader", () => ({ getKit: mocks.kit }));
vi.mock("./environments", () => ({ resolveReadyEnvironment: mocks.environment }));
vi.mock("./runner", () => ({ createAndStartRun: mocks.start }));
import { appendReportGeneration, createReportGeneration, listReportGenerations, startReportGeneration } from "./report-generation-service";
import type { GenerationSnapshot } from "./report-generation";

const body = { requestId: "11111111-1111-4111-8111-111111111111", kitId: "custom-overview", inputs: [{ alias: "table", datasetId: "d1", versionId: "v1" }], params: {} };
const manifest = { id: body.kitId, name: "Custom overview", description: "A custom template", inputs: [{ alias: "table", requiredRoles: [] }], outputs: [{ name: "distribution", kind: "figure" }], environment: "python", language: "python" };
let stored: Record<string, unknown> | null;
const updatedAt = "2026-09-09T17:00:00.000Z";
const record = (snapshot: GenerationSnapshot) => ({ id: "gen_test", name: manifest.name, targetKey: "order:o1", reportId: "r1", createdById: "u1", currentRevisionId: "rev1", createdAt: new Date(updatedAt),
  revisions: [{ id: "rev1", inputs: JSON.stringify({ generation: snapshot }) }],
  runs: [{ id: "gen_test_run", status: "completed", runNumber: "EXP-1", results: "{}", artifacts: [{ id: "a1", name: "distribution", kind: "figure", format: "plotly-json", derivedDatasetId: null }] }],
});
beforeEach(() => {
  vi.clearAllMocks(); stored = null;
  mocks.report.mockResolvedValue({ id: "r1", targetKey: "order:o1", blocks: [{ id: "original", type: "text", markdown: "Keep this" }], settings: { filters: ["keep"] }, updatedAt: new Date(updatedAt) });
  mocks.analysis.mockImplementation(() => stored);
  mocks.analyses.mockImplementation(() => stored ? [stored] : []);
  mocks.kit.mockResolvedValue({ manifest, code: "# test" });
  mocks.validate.mockResolvedValue(body.inputs);
  mocks.environment.mockResolvedValue({ prefixPath: "/env" });
  mocks.start.mockResolvedValue({ id: "run", status: "running" });
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.create.mockImplementation(async (_input: unknown, options: { id: string; snapshot: GenerationSnapshot }) => { stored = { ...record(options.snapshot), id: options.id }; return stored; });
});
describe("guided generation requests", () => {
  it("validates and pins input before creating an analysis, snapshots the template, and uses a stable run identity", async () => {
    await createReportGeneration("r1", "u1", body);
    expect(mocks.validate).toHaveBeenCalledWith("order:o1", body.inputs, manifest.inputs);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ reportId: "r1", inputs: body.inputs }), expect.objectContaining({ snapshot: expect.objectContaining({ outputs: manifest.outputs }) }));
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ revisionId: "rev1", createdById: "u1", runId: expect.stringMatching(/^gen_.*_run$/) }));
  });
  it("reuses a request after a lost response, even if a kit is now missing", async () => {
    await createReportGeneration("r1", "u1", body);
    mocks.kit.mockResolvedValue(null);
    await createReportGeneration("r1", "u1", body);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.start.mock.calls[0][0]).toEqual(mocks.start.mock.calls[1][0]);
  });
  it("rejects changing choices under a request that already exists", async () => {
    await createReportGeneration("r1", "u1", body);
    await expect(createReportGeneration("r1", "u1", { ...body, params: { bins: 10 } })).rejects.toMatchObject({ status: 409 });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("rejects unpinned data and unready software without creating anything", async () => {
    await expect(createReportGeneration("r1", "u1", { ...body, inputs: [{ alias: "table", datasetId: "d1" }] })).rejects.toMatchObject({ status: 400 });
    mocks.environment.mockResolvedValue(null);
    await expect(createReportGeneration("r1", "u1", body)).rejects.toMatchObject({ status: 409 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("rejects incompatible or foreign inputs on the server before launching", async () => {
    mocks.validate.mockRejectedValue(new Error("Input is not available in this scope."));
    await expect(createReportGeneration("r1", "u1", body)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("this scope") });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("reports missing reports and templates clearly", async () => {
    mocks.kit.mockResolvedValue(null);
    await expect(createReportGeneration("r1", "u1", body)).rejects.toMatchObject({ status: 400 });
    mocks.report.mockResolvedValue(null);
    await expect(createReportGeneration("missing", "u1", body)).rejects.toMatchObject({ status: 404 });
  });
  it("validates template options on the server before launching", async () => {
    mocks.kit.mockResolvedValue({ manifest: { ...manifest, params: { type: "object", properties: { bins: { type: "integer", minimum: 2, maximum: 50 } } } } });
    await expect(createReportGeneration("r1", "u1", { ...body, params: { bins: 100 } })).rejects.toMatchObject({ status: 400, message: "bins: use at most 50." });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
describe("review and append", () => {
  beforeEach(() => { stored = record({ version: 1, requestHash: "hash", name: manifest.name, description: manifest.description, outputs: [{ name: "distribution", kind: "figure" }] }); });
  it("survives reload by loading progress from persisted analysis records", async () => {
    expect(await listReportGenerations("r1")).toMatchObject([{ analysisId: "gen_test", status: "completed", items: [{ label: manifest.name }, { label: "Distribution" }] }]);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("appends only selected items and keeps existing text and settings", async () => {
    await appendReportGeneration("r1", "gen_test", { expectedUpdatedAt: updatedAt, itemIds: ["figure:gen_test:distribution"] });
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: "r1", updatedAt: new Date(updatedAt) }, data: { blocks: [{ id: "original", type: "text", markdown: "Keep this" }, expect.objectContaining({ type: "figure" })] } });
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("settings");
  });
  it("requires review again when another tab edited the report", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    await expect(appendReportGeneration("r1", "gen_test", { expectedUpdatedAt: updatedAt, itemIds: ["figure:gen_test:distribution"] })).rejects.toMatchObject({ status: 409 });
  });
  it("does not duplicate items after a retried append", async () => {
    mocks.report.mockResolvedValue({ id: "r1", targetKey: "order:o1", blocks: [{ id: "figure:gen_test:distribution", type: "figure", analysisId: "gen_test", figureName: "distribution" }], updatedAt: new Date() });
    expect(await appendReportGeneration("r1", "gen_test", { expectedUpdatedAt: updatedAt, itemIds: ["figure:gen_test:distribution"] })).toEqual({ added: 0 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects foreign, unavailable, failed or edited generation items", async () => {
    await expect(appendReportGeneration("r1", "foreign", { expectedUpdatedAt: updatedAt, itemIds: ["figure:gen_test:distribution"] })).rejects.toMatchObject({ status: 404 });
    await expect(appendReportGeneration("r1", "gen_test", { expectedUpdatedAt: updatedAt, itemIds: ["foreign-item"] })).rejects.toMatchObject({ status: 400 });
    stored = { ...stored, currentRevisionId: "edited" };
    await expect(appendReportGeneration("r1", "gen_test", { expectedUpdatedAt: updatedAt, itemIds: ["figure:gen_test:distribution"] })).rejects.toMatchObject({ status: 409 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does not let another author start an unfinished generation", async () => {
    await expect(startReportGeneration("r1", "gen_test", "someone-else")).rejects.toMatchObject({ status: 403 });
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
