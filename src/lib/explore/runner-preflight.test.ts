import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ analysis: vi.fn(), dataset: vi.fn(), version: vi.fn(), createRun: vi.fn(), environment: vi.fn(), existingRun: vi.fn(), findRun: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { exploreAnalysis: { findUnique: mocks.analysis }, exploreDataset: { findFirst: mocks.dataset }, exploreDatasetVersion: { findFirst: mocks.version }, exploreAnalysisRun: { create: mocks.createRun, findUnique: mocks.existingRun, findFirst: mocks.findRun } } }));
vi.mock("@/lib/pipelines/execution-settings", () => ({ getExecutionSettings: async () => ({ useSlurm: false }) }));
vi.mock("./environments", () => ({ resolveReadyEnvironment: mocks.environment }));
vi.mock("./kits/loader", () => ({ getKit: vi.fn(), stageHelperLibrary: vi.fn() }));
import { createAndStartRun } from "./runner";
import { serializeInputs } from "./input-validation";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.analysis.mockResolvedValue({ id: "a1", targetKey: "order:one", currentRevisionId: "r1", revisions: [{ id: "r1", inputs: serializeInputs([{ alias: "qc", datasetId: "d1", versionId: "v1" }], [{ alias: "qc", label: "Quality data", requiredRoles: [], optionalRoles: [], requiredColumns: { quality: { type: "number", unit: "Phred" } } }]) }] });
  mocks.dataset.mockResolvedValue({ id: "d1", roles: "{}", tableKind: "sample-summary" });
  mocks.version.mockResolvedValue({ id: "v1", rowCount: 1, schema: '{"columns":[]}' });
  mocks.existingRun.mockResolvedValue(null);
  mocks.findRun.mockResolvedValue(null);
});
describe("run creation preflight boundary", () => {
  it("rejects incompatible inputs before allocating a run or preparing an environment", async () => {
    await expect(createAndStartRun({ analysisId: "a1", createdById: "owner" })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("quality") });
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.environment).not.toHaveBeenCalled();
  });
  it("rejects cross-scope data even if a caller bypasses the creation wizard", async () => {
    mocks.dataset.mockResolvedValue(null);
    await expect(createAndStartRun({ analysisId: "a1", createdById: "owner" })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("this scope") });
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.environment).not.toHaveBeenCalled();
  });
  const previous = { id: "stable", analysisId: "a1", createdById: "owner", runNumber: "EXP-001", status: "running", revision: { number: 1 }, _count: { artifacts: 0 }, createdAt: new Date() };
  it("reuses a persisted request after reload, before touching inputs or launching anything", async () => {
    mocks.existingRun.mockResolvedValue(previous);
    expect(await createAndStartRun({ analysisId: "a1", runId: "stable", createdById: "owner" })).toMatchObject({ id: "stable", status: "running" });
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.analysis).not.toHaveBeenCalled();
  });
  it("uses the unique run identity to stop concurrent requests launching twice", async () => {
    mocks.version.mockResolvedValue({ id: "v1", rowCount: 1, schema: '{"columns":[{"key":"quality","label":"Quality","type":"number","unit":"Phred"}]}' });
    mocks.environment.mockResolvedValue({ prefixPath: "/env" });
    mocks.existingRun.mockResolvedValueOnce(null).mockResolvedValueOnce(previous);
    mocks.createRun.mockRejectedValue({ code: "P2002" });
    expect(await createAndStartRun({ analysisId: "a1", runId: "stable", createdById: "owner" })).toMatchObject({ id: "stable" });
    expect(mocks.createRun).toHaveBeenCalledOnce();
  });
  it("rejects an identity collision with another author or analysis", async () => {
    mocks.existingRun.mockResolvedValue({ ...previous, createdById: "different" });
    await expect(createAndStartRun({ analysisId: "a1", runId: "stable", createdById: "owner" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.createRun).not.toHaveBeenCalled();
  });
});
