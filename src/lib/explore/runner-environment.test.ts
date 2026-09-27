import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ analysis: vi.fn(), dataset: vi.fn(), version: vi.fn(), createRun: vi.fn(), ready: vi.fn(), existingRun: vi.fn(), findRun: vi.fn(), resolve: vi.fn(), prepare: vi.fn(), byName: vi.fn(), prepareByName: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { exploreAnalysis: { findUnique: mocks.analysis }, exploreDataset: { findFirst: mocks.dataset }, exploreDatasetVersion: { findFirst: mocks.version }, exploreAnalysisRun: { create: mocks.createRun, findUnique: mocks.existingRun, findFirst: mocks.findRun } } }));
vi.mock("@/lib/pipelines/execution-settings", () => ({ getExecutionSettings: async () => ({ useSlurm: false }) }));
vi.mock("./environments", () => ({ resolveReadyEnvironment: mocks.ready }));
vi.mock("./step-environments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./step-environments")>();
  return { condaErrorExcerpt: actual.condaErrorExcerpt, preparingWords: actual.preparingWords, resolveStepEnvironment: mocks.resolve, prepareStepEnvironment: mocks.prepare, stepEnvironmentByName: mocks.byName, prepareEnvironmentByName: mocks.prepareByName };
});
vi.mock("./kits/loader", () => ({ getKit: vi.fn(), stageHelperLibrary: vi.fn() }));
import { createAndStartRun } from "./runner";
import { serializeInputs } from "./input-validation";

const derived = (status: string, extra: Record<string, unknown> = {}) => ({ name: "seqdesk-explore-r+abc", baseName: "seqdesk-explore-r", derived: true, status, specHash: "s", packages: { packages: ["r-lme4", "bioconductor-fgsea", "r-nlme"], channels: [] }, prefixPath: null, lockDigest: null, builtAt: null, log: null, error: null, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.analysis.mockResolvedValue({ id: "a1", targetKey: "order:one", language: "r", environmentName: "seqdesk-explore-r", packages: { packages: ["r-lme4"] }, currentRevisionId: "r1", revisions: [{ id: "r1", inputs: serializeInputs([{ alias: "qc", datasetId: "d1", versionId: "v1" }], [{ alias: "qc", label: "Quality data", requiredRoles: [], optionalRoles: [], requiredColumns: {} }]) }] });
  mocks.dataset.mockResolvedValue({ id: "d1", roles: "{}", tableKind: "sample-summary" });
  mocks.version.mockResolvedValue({ id: "v1", rowCount: 1, schema: '{"columns":[]}' });
  mocks.existingRun.mockResolvedValue(null);
  mocks.findRun.mockResolvedValue(null);
});

describe("runner and step environments", () => {
  it("waits while the step's derived environment builds: starts the build, allocates no run, installs nothing", async () => {
    mocks.resolve.mockResolvedValue(derived("missing"));
    mocks.prepare.mockResolvedValue(derived("building"));
    await expect(createAndStartRun({ analysisId: "a1", createdById: "owner" })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Preparing environment · installing 3 packages") });
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.ready).not.toHaveBeenCalled();
  });
  it("fails with the conda error when the build failed, without rebuilding", async () => {
    mocks.resolve.mockResolvedValue(derived("failed", { error: "conda env create exited with 1\nnoise\nLibMambaUnsatisfiableError: nothing provides r-nope" }));
    await expect(createAndStartRun({ analysisId: "a1", createdById: "owner" })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Could not build the environment[\s\S]*LibMambaUnsatisfiableError: nothing provides r-nope/) });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
  });
  it("runs in the derived environment once it is ready", async () => {
    mocks.resolve.mockResolvedValue(derived("ready"));
    mocks.ready.mockResolvedValue(null);
    await expect(createAndStartRun({ analysisId: "a1", createdById: "owner" })).rejects.toMatchObject({ status: 409 });
    expect(mocks.ready).toHaveBeenCalledWith("seqdesk-explore-r+abc");
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("uses the environment a flow run fixed at its start, not the step's current packages", async () => {
    mocks.byName.mockResolvedValue(derived("ready", { name: "seqdesk-explore-r+fixed" }));
    mocks.ready.mockResolvedValue(null);
    await expect(createAndStartRun({ analysisId: "a1", createdById: "owner", flowRun: { id: "f1", stepLabel: "A", trial: false, environmentName: "seqdesk-explore-r+fixed" } })).rejects.toMatchObject({ status: 409 });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.ready).toHaveBeenCalledWith("seqdesk-explore-r+fixed");
  });
});
