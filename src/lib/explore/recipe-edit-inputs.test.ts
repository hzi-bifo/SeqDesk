import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadRecipe, createRevision, tx, db } = vi.hoisted(() => ({
  loadRecipe: vi.fn(),
  createRevision: vi.fn(),
  tx: {
    exploreDataset: { findMany: vi.fn(), delete: vi.fn() },
    exploreAnalysisRevision: { count: vi.fn() },
    exploreFlowInput: { count: vi.fn() },
    exploreAnalysis: { count: vi.fn() },
  },
  db: { exploreFlowTurn: { updateMany: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("./recipe", async (original) => ({ ...(await original<typeof import("./recipe")>()), loadRecipe: (...args: unknown[]) => loadRecipe(...args) }));
vi.mock("./analyses", async (original) => ({ ...(await original<typeof import("./analyses")>()), createRevision: (...args: unknown[]) => createRevision(...args) }));
vi.mock("@/lib/integration/events", () => ({ enqueueConversationTurn: vi.fn() }));

import { setStepInputs } from "./recipe-edit";
import { computeStepStates, type DatasetInfo, type RecipeModel, type StepRecord } from "./recipe";
import { removeUnwrittenOutputs } from "./analyses";
import { closeStaleTurns, STALE_TURN_MS } from "./conversation";

const dataset = (id: string, over: Partial<DatasetInfo> = {}): DatasetInfo => ({
  id, name: id, kind: "upload", tableKind: null, roles: null, sensitivity: "standard", currentVersionId: `${id}-v1`, producer: null, artifactName: null,
  current: { id: `${id}-v1`, number: 1, contentHash: "h", rowCount: 3, schema: "[]", createdAt: new Date() }, ...over,
});
const step = (id: string, position: string, bindings: Array<{ alias: string; datasetId: string }>) => ({
  id, name: `Step ${id}`, position, createdAt: new Date(), kitId: null, laneKind: null, laneOf: null, laneLabel: null,
  bindings: bindings.map((binding) => ({ ...binding, versionId: null })),
  revision: { id: `${id}-r1`, codeHash: "c", params: "{}" },
});
function recipe(): RecipeModel {
  const steps = [step("a", "a0", [{ alias: "metadata", datasetId: "metadata" }]), step("b", "a1", [{ alias: "out_a", datasetId: "out_a" }]), step("c", "a2", [])];
  return {
    flow: { id: "f1", targetKey: "study:1" }, steps, labels: new Map([["a", "1"], ["b", "2"], ["c", "3"]]),
    upstream: new Map([["b", new Set(["a"])]]),
    datasets: new Map([dataset("metadata"), dataset("genus"), dataset("out_a", { kind: "derived", producer: "a", artifactName: "out_a", currentVersionId: null, current: null }),
      dataset("out_c", { kind: "derived", producer: "c", artifactName: "out_c", currentVersionId: null, current: null })].map((d) => [d.id, d])),
  } as unknown as RecipeModel;
}
const actor = { userId: "u1", memberId: "m1" };

beforeEach(() => {
  vi.clearAllMocks();
  loadRecipe.mockResolvedValue(recipe());
  createRevision.mockResolvedValue({ id: "r2" });
});

describe("changing what an existing step reads", () => {
  it("saves a new revision with the chosen tables, placing an unnamed one under its own name", async () => {
    expect(await setStepInputs("f1", "b", { inputs: [{ alias: "out_a", datasetId: "out_a" }, { datasetId: "genus" }], actor })).toBe(true);
    expect(createRevision).toHaveBeenCalledTimes(1);
    const call = createRevision.mock.calls[0][0];
    expect(call).toMatchObject({ analysisId: "b", expectedRevisionId: "b-r1", author: "user", authorUserId: "u1" });
    expect(call.inputs).toEqual([{ alias: "out_a", datasetId: "out_a", versionId: null }, { alias: "genus", datasetId: "genus", versionId: null }]);
    expect(call.message).toBe("Reads out_a, genus");
  });

  it("does nothing when the step already reads exactly those tables", async () => {
    expect(await setStepInputs("f1", "b", { inputs: [{ alias: "out_a", datasetId: "out_a" }], actor })).toBe(false);
    expect(createRevision).not.toHaveBeenCalled();
  });

  it("refuses a table of a step below it, and its own table", async () => {
    await expect(setStepInputs("f1", "b", { inputs: [{ from: { stepId: "c", output: "out_c" } }], actor })).rejects.toMatchObject({ code: "incompatible" });
    await expect(setStepInputs("f1", "b", { inputs: [{ datasetId: "out_c" }], actor })).rejects.toMatchObject({ code: "incompatible" });
    await expect(setStepInputs("f1", "c", { inputs: [{ datasetId: "out_c" }], actor })).rejects.toMatchObject({ code: "incompatible" });
    expect(createRevision).not.toHaveBeenCalled();
  });

  it("answers step_conflict when the step changed since the caller saw it", async () => {
    await expect(setStepInputs("f1", "b", { inputs: [{ datasetId: "genus" }], expectedRevisionId: "b-r0", actor })).rejects.toMatchObject({ code: "step_conflict" });
  });

  it("refuses a step of another flow", async () => {
    await expect(setStepInputs("f1", "zz", { inputs: [], actor })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("a step whose inputs changed since its run", () => {
  it("is out of date even when the new table is written by an upstream step", () => {
    const model = recipe();
    const b = model.steps[1];
    b.revision = { ...b.revision!, id: "b-r2" };
    b.bindings = [{ alias: "out_a", datasetId: "out_a", versionId: null }, { alias: "genus", datasetId: "genus", versionId: null }];
    const record = (stepId: string, revisionId: string, pins: StepRecord["inputPins"]): StepRecord => ({ stepRunId: `${stepId}-run`, revisionId, status: "completed", inputPins: pins, flowRunId: "fr", flowRunNumber: 1, reusedFrom: null });
    const records = new Map([["a", record("a", "a-r1", [{ alias: "metadata", datasetId: "metadata", versionId: "metadata-v1" }])], ["b", record("b", "b-r1", [{ alias: "out_a", datasetId: "out_a", versionId: "x" }])]]);
    const used = new Map([["a-r1", { codeHash: "c", params: "{}" }], ["b-r1", { codeHash: "c", params: "{}" }]]);
    const states = computeStepStates({ model, records, revisionsUsed: used });
    expect(states.get("a")?.state).toBe("current");
    expect(states.get("b")).toMatchObject({ state: "outOfDate", reason: "inputChanged" });
  });
});

describe("removing a step's never-written outputs", () => {
  it("deletes empty placeholders of the removed step (or of a step already gone) that nothing reads, and keeps the rest", async () => {
    tx.exploreDataset.findMany.mockResolvedValue([
      { id: "d1", sourceConfig: JSON.stringify({ builder: "analysis-run", analysisId: "s1", artifactName: "x" }) },
      { id: "d2", sourceConfig: JSON.stringify({ builder: "analysis-run", analysisId: "s1", artifactName: "y" }) },
      { id: "d3", sourceConfig: JSON.stringify({ builder: "analysis-run", analysisId: "s10", artifactName: "z" }) },
      { id: "d4", sourceConfig: "not json" },
      { id: "d5", sourceConfig: JSON.stringify({ builder: "analysis-run", analysisId: "gone", artifactName: "w" }) },
    ]);
    tx.exploreAnalysis.count.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "s10" ? 1 : 0));
    tx.exploreAnalysisRevision.count.mockImplementation(async ({ where }: { where: { inputs: { contains: string } } }) => (where.inputs.contains === "d2" ? 1 : 0));
    tx.exploreFlowInput.count.mockResolvedValue(0);
    const removed = await removeUnwrittenOutputs(tx as never, "s1", "study:1");
    expect(removed).toEqual(["d1", "d5"]);
    expect(tx.exploreDataset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ targetKey: "study:1", kind: "derived", currentVersionId: null, versions: { none: {} } }) }));
    expect(tx.exploreDataset.delete).toHaveBeenCalledTimes(2);
  });
});

describe("assistant turns left working", () => {
  it("closes turns working past the limit as failed, with the reason in words", async () => {
    db.exploreFlowTurn.updateMany.mockResolvedValue({ count: 1 });
    const now = Date.parse("2026-10-06T10:00:00Z");
    expect(await closeStaleTurns("f1", now)).toBe(1);
    const call = db.exploreFlowTurn.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ flowId: "f1", authorKind: "assistant", status: "working" });
    expect(call.where.updatedAt.lt.getTime()).toBe(now - STALE_TURN_MS);
    expect(call.data.status).toBe("failed");
    expect(call.data.text).toMatch(/^The assistant stopped: /);
  });
});
