import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ dataset: vi.fn(), version: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { exploreDataset: { findFirst: mocks.dataset }, exploreDatasetVersion: { findFirst: mocks.version } } }));
import { inputContractSnapshot, serializeInputs, validateAnalysisInputs } from "./input-validation";
import type { KitInput } from "./kits/schema";
const binding = { alias: "table", datasetId: "d1", versionId: null };
const contract: KitInput[] = [{ alias: "table", label: "Measurements", requiredRoles: [], optionalRoles: [], requiredColumns: { quality: { type: "number", unit: "Phred" } } }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dataset.mockResolvedValue({ id: "d1", targetKey: "order:one", currentVersionId: "v2", roles: "{}", tableKind: "sample-summary" });
  mocks.version.mockResolvedValue({ id: "v2", rowCount: 1, schema: JSON.stringify({ columns: [{ key: "quality", label: "Quality", type: "number", unit: "Phred" }] }) });
});
describe("analysis preflight", () => {
  it("pins validated versions before a run is allocated", async () => {
    expect(await validateAnalysisInputs("order:one", [binding], contract)).toEqual([{ ...binding, versionId: "v2" }]);
    expect(mocks.dataset).toHaveBeenCalledWith({ where: { id: "d1", targetKey: "order:one" } });
  });
  it("validates the explicitly pinned version, not the current one", async () => {
    await validateAnalysisInputs("order:one", [{ ...binding, versionId: "old" }], contract);
    expect(mocks.version).toHaveBeenCalledWith({ where: { datasetId: "d1", id: "old" } });
  });
  it("blocks missing columns with a useful explanation", async () => {
    mocks.version.mockResolvedValue({ id: "v2", rowCount: 1, schema: '{"columns":[]}' });
    await expect(validateAnalysisInputs("order:one", [binding], contract)).rejects.toThrow(/Measurements.*quality/);
  });
  it("blocks missing required input bindings", async () => {
    await expect(validateAnalysisInputs("order:one", [], contract)).rejects.toThrow(/choose a table/);
  });
  it("blocks unknown template inputs and duplicate aliases", async () => {
    await expect(validateAnalysisInputs("order:one", [binding, binding], contract)).rejects.toThrow(/unique/);
    await expect(validateAnalysisInputs("order:one", [binding], [])).rejects.toThrow(/Unknown template input/);
  });
  it("blocks data from a different scope and removed versions", async () => {
    mocks.dataset.mockResolvedValueOnce(null);
    await expect(validateAnalysisInputs("order:two", [binding], contract)).rejects.toThrow(/not available/);
    mocks.version.mockResolvedValueOnce(null);
    await expect(validateAnalysisInputs("order:one", [binding], contract)).rejects.toThrow(/version is unavailable/);
  });
  it("blocks empty tables", async () => {
    mocks.version.mockResolvedValueOnce({ id: "v2", rowCount: 0, schema: "{}" });
    await expect(validateAnalysisInputs("order:one", [binding], contract)).rejects.toThrow(/no rows/);
  });
  it("round-trips immutable requirements while retaining legacy inputs", () => {
    expect(inputContractSnapshot(serializeInputs([binding], contract))).toEqual(contract);
    expect(inputContractSnapshot(serializeInputs([binding], null))).toBeNull();
  });
});
