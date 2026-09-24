import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flowFind: vi.fn(), flowRunFind: vi.fn(), requireAccess: vi.fn(), moduleEnabled: vi.fn(),
  createProposals: vi.fn(), discardProposal: vi.fn(), acceptProposal: vi.fn(), proposalFind: vi.fn(), analysisFind: vi.fn(), glossRecord: vi.fn(), listGlosses: vi.fn(), putGlosses: vi.fn(), deleteGloss: vi.fn(),
  flowValues: vi.fn(), resolveValues: vi.fn(), outputLineage: vi.fn(), requestCapsule: vi.fn(), artifactFind: vi.fn(), capsuleFind: vi.fn(),
  getRecipeView: vi.fn(), applyRecipeOps: vi.fn(), addStep: vi.fn(), stepOptions: vi.fn(), listRecipeRevisions: vi.fn(), resolveAccess: vi.fn(), scopeFind: vi.fn(),
  startFlowRun: vi.fn(), listFlowRuns: vi.fn(), getFlowRunDetail: vi.fn(), cancelFlowRun: vi.fn(), makeRunCurrent: vi.fn(), compareFlowRuns: vi.fn(), flowRunOutputs: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { exploreFlow: { findUnique: mocks.flowFind }, exploreFlowRun: { findUnique: mocks.flowRunFind }, integrationExploreScope: { findFirst: mocks.scopeFind }, exploreStepProposal: { findUnique: mocks.proposalFind }, exploreAnalysis: { findUnique: mocks.analysisFind }, exploreArtifact: { findUnique: mocks.artifactFind }, exploreCapsule: { findUnique: mocks.capsuleFind } } }));
vi.mock("@/lib/explore/module", () => ({ isExploreModuleEnabled: mocks.moduleEnabled }));
vi.mock("@/lib/explore/authorization", async () => {
  const actual = await vi.importActual<typeof import("@/lib/explore/authorization")>("@/lib/explore/authorization");
  return { ...actual, requireTargetAccess: mocks.requireAccess, resolveTargetAccess: mocks.resolveAccess };
});
vi.mock("@/lib/explore/recipe-view", async () => ({ ...(await vi.importActual<object>("@/lib/explore/recipe-view")), getRecipeView: mocks.getRecipeView }));
vi.mock("@/lib/explore/recipe-edit", async () => ({ ...(await vi.importActual<object>("@/lib/explore/recipe-edit")), applyRecipeOps: mocks.applyRecipeOps, addStep: mocks.addStep, stepOptions: mocks.stepOptions, listRecipeRevisions: mocks.listRecipeRevisions }));
vi.mock("@/lib/explore/proposals", () => ({ pendingProposals: vi.fn().mockResolvedValue([]), createProposals: mocks.createProposals, listProposals: vi.fn(), patchProposal: vi.fn(), discardProposal: mocks.discardProposal, acceptProposal: mocks.acceptProposal }));
vi.mock("@/lib/explore/glosses", () => ({ glossRecord: mocks.glossRecord, listGlosses: mocks.listGlosses, putGlosses: mocks.putGlosses, patchGloss: vi.fn(), acceptGloss: vi.fn(), deleteGloss: mocks.deleteGloss }));
vi.mock("@/lib/explore/capsules", () => ({ outputLineage: mocks.outputLineage, plotSource: vi.fn(), requestCapsule: mocks.requestCapsule, serializeCapsule: (capsule: unknown) => capsule }));
vi.mock("@/lib/explore/values", () => ({ flowValues: mocks.flowValues, resolveValues: mocks.resolveValues }));
vi.mock("@/lib/explore/flow-runs", () => ({
  startFlowRun: mocks.startFlowRun, listFlowRuns: mocks.listFlowRuns, getFlowRunDetail: mocks.getFlowRunDetail, cancelFlowRun: mocks.cancelFlowRun,
  makeRunCurrent: mocks.makeRunCurrent, compareFlowRuns: mocks.compareFlowRuns, flowRunOutputs: mocks.flowRunOutputs,
}));

import { NextRequest } from "next/server";
import { ExploreAuthorizationError } from "@/lib/explore/authorization";
import { flowError } from "./flow-contract";
import { handleExploreRequest } from "./explore";
import type { IntegrationSession } from "./identity";

const session = { user: { id: "u1", name: "Amara Okafor" }, integration: { authority: "https://collab.example", workspaceId: "team", memberId: "m1", projectId: "" } } as IntegrationSession;
const call = async (method: string, path: string, body?: unknown) => {
  const request = new NextRequest(new URL(`http://compute.test/api/integration/v1/explore/${path}`), { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  const response = await handleExploreRequest(request, session, path.split("?")[0].split("/"), new Headers());
  return { status: response.status, body: await response.json() };
};

describe("Flow run routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.moduleEnabled.mockResolvedValue(true);
    mocks.flowFind.mockResolvedValue({ id: "f1", targetKey: "project:p1", name: "DE" });
    mocks.flowRunFind.mockResolvedValue({ id: "r1", flowId: "f1" });
    mocks.requireAccess.mockResolvedValue({ type: "project", id: "p1" });
    mocks.resolveAccess.mockResolvedValue({ level: "write", target: { type: "project", id: "p1" } });
    mocks.scopeFind.mockResolvedValue({ projectId: "proj1", visibility: "lab", ownerMemberId: "" });
    mocks.getRecipeView.mockImplementation(async (id: string, options: unknown) => ({ id, options, steps: [{ id: "s9" }] }));
  });

  it("starts a run with the caller as starter and the scope it asked for", async () => {
    mocks.startFlowRun.mockResolvedValue({ id: "r1", number: 14 });
    const response = await call("POST", "flows/f1/runs", { scope: { steps: ["s4"] }, notify: true, requestId: "flow_abcdefghijklmnopq" });
    expect(response).toEqual({ status: 201, body: { run: { id: "r1", number: 14 } } });
    expect(mocks.requireAccess).toHaveBeenCalledWith(session, "project:p1", "write");
    expect(mocks.startFlowRun).toHaveBeenCalledWith("f1", { scope: { steps: ["s4"] }, trial: false, sample: undefined, notify: true, requestId: "flow_abcdefghijklmnopq", actor: { userId: "u1", memberId: "m1", name: "Amara Okafor" } });
  });

  it("answers errors with a code", async () => {
    expect(await call("POST", "flows/f1/runs", { scope: "sometimes" })).toEqual({ status: 400, body: { error: 'scope must be "all", "outOfDate" or {"steps":[…]}.', code: "invalid_request" } });
    mocks.startFlowRun.mockRejectedValue(flowError("run_active", "Run #3 of this flow is still running.", { run: { id: "r3", number: 3 } }));
    expect(await call("POST", "flows/f1/runs", {})).toEqual({ status: 409, body: { error: "Run #3 of this flow is still running.", code: "run_active", run: { id: "r3", number: 3 } } });
    mocks.requireAccess.mockRejectedValue(new ExploreAuthorizationError(404, "Not found"));
    expect(await call("GET", "flows/f1/runs")).toEqual({ status: 404, body: { error: "Not found", code: "not_found" } });
    mocks.flowFind.mockResolvedValue(null);
    expect((await call("GET", "flow-runs/r1")).body.code).toBe("not_found");
  });

  it("reads, stops, compares and makes runs current", async () => {
    mocks.listFlowRuns.mockResolvedValue({ runs: [], earlierStepRuns: 2, counts: {} });
    expect((await call("GET", "flows/f1/runs?trials=0")).body.earlierStepRuns).toBe(2);
    expect(mocks.listFlowRuns).toHaveBeenCalledWith("f1", { trials: false });
    mocks.getFlowRunDetail.mockResolvedValue({ id: "r1" });
    expect((await call("GET", "flow-runs/r1")).body).toEqual({ run: { id: "r1" } });
    mocks.cancelFlowRun.mockResolvedValue({ id: "r1", status: "cancelled" });
    expect((await call("POST", "flow-runs/r1/cancel")).body.run.status).toBe("cancelled");
    mocks.makeRunCurrent.mockResolvedValue({ run: { id: "r1" }, flow: { id: "f1", currentRunId: "r1" } });
    expect((await call("POST", "flow-runs/r1/current")).body.flow.currentRunId).toBe("r1");
    mocks.compareFlowRuns.mockResolvedValue({ words: "same" });
    expect((await call("GET", "flow-runs/compare?a=r1&b=r2&step=s4")).body.words).toBe("same");
    expect(mocks.compareFlowRuns).toHaveBeenCalledWith("r1", "r2", "s4");
    expect((await call("GET", "flow-runs/compare?a=r1")).body.code).toBe("invalid_request");
    mocks.flowRunOutputs.mockResolvedValue({ outputs: [], values: [] });
    expect((await call("GET", "flow-runs/r1/outputs")).body).toEqual({ outputs: [], values: [] });
  });
});

describe("Flow recipe routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.moduleEnabled.mockResolvedValue(true);
    mocks.flowFind.mockResolvedValue({ id: "f1", targetKey: "project:p1", name: "DE" });
    mocks.requireAccess.mockResolvedValue({ type: "project", id: "p1" });
    mocks.resolveAccess.mockResolvedValue({ level: "read", target: { type: "project", id: "p1" } });
    mocks.scopeFind.mockResolvedValue({ projectId: "proj1", visibility: "lab", ownerMemberId: "" });
    mocks.getRecipeView.mockImplementation(async (id: string, options: unknown) => ({ id, options, steps: [{ id: "s9" }] }));
  });

  it("reads the recipe of the viewed run with the caller's rights and the scope's project", async () => {
    const response = await call("GET", "flows/f1/recipe?run=r7");
    expect(response.status).toBe(200);
    expect(mocks.getRecipeView).toHaveBeenCalledWith("f1", { runId: "r7", canEdit: false, scope: { projectId: "proj1", visibility: "lab", ownerMemberId: "" }, proposals: [] });
  });

  it("validates recipe changes before applying them", async () => {
    expect((await call("PATCH", "flows/f1/recipe", { ops: [{ op: "spin" }] })).body).toEqual({ error: "Unknown recipe change: spin", code: "invalid_request" });
    await call("PATCH", "flows/f1/recipe", { expectedRevision: 7, ops: [{ op: "move", stepId: "s2", after: null }] });
    expect(mocks.applyRecipeOps).toHaveBeenCalledWith("f1", [{ op: "move", stepId: "s2", after: null }], 7, { userId: "u1", memberId: "m1", name: "Amara Okafor" });
    mocks.applyRecipeOps.mockRejectedValue(flowError("binding_lost", "Test reads Filter.", { stepId: "s2", words: "Test reads Filter.", fix: { stepId: "s2", after: "s1" } }));
    expect(await call("PATCH", "flows/f1/recipe", { expectedRevision: 7, ops: [{ op: "move", stepId: "s2", after: null }] })).toEqual({ status: 422, body: { error: "Test reads Filter.", code: "binding_lost", stepId: "s2", words: "Test reads Filter.", fix: { stepId: "s2", after: "s1" } } });
  });

  it("adds a step and answers with it and the recipe", async () => {
    mocks.addStep.mockResolvedValue("s9");
    const response = await call("POST", "flows/f1/steps", { after: "s2", kitId: "table-summary", inputs: [{ alias: "table", from: { stepId: "s2", output: "normalised" } }] });
    expect(response.status).toBe(201);
    expect(response.body.step).toEqual({ id: "s9" });
    expect(mocks.addStep.mock.calls[0][1]).toMatchObject({ after: "s2", kitId: "table-summary", inputs: [{ alias: "table", from: { stepId: "s2", output: "normalised" } }] });
    expect((await call("POST", "flows/f1/steps", { inputs: [{ alias: "x" }] })).body.code).toBe("invalid_request");
  });

  it("lists templates", async () => {
    const response = await call("GET", "templates");
    expect(response.body.templates.map((template: { id: string }) => template.id)).toEqual(["rnaseq-de", "survey-likert"]);
    expect(response.body.templates[0].slots[0]).toMatchObject({ key: "gene", kind: "column" });
  });
});

describe("Flow proposal and gloss routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.moduleEnabled.mockResolvedValue(true);
    mocks.flowFind.mockResolvedValue({ id: "f1", targetKey: "project:p1", name: "DE" });
    mocks.requireAccess.mockResolvedValue({ type: "project", id: "p1" });
    mocks.resolveAccess.mockResolvedValue({ level: "write", target: { type: "project", id: "p1" } });
    mocks.scopeFind.mockResolvedValue(null);
    mocks.getRecipeView.mockResolvedValue({ steps: [{ id: "s5" }] });
  });

  it("stores proposals for the caller and accepts them into steps", async () => {
    mocks.createProposals.mockResolvedValue([{ id: "p1" }]);
    const created = await call("POST", "flows/f1/proposals", { kind: "step", goal: "Which genes change?", items: [{ purpose: "Test", code: "x" }] });
    expect(created).toEqual({ status: 201, body: { proposals: [{ id: "p1" }] } });
    expect(mocks.createProposals.mock.calls[0][1]).toMatchObject({ kind: "step", goal: "Which genes change?", actor: { userId: "u1", memberId: "m1" } });
    mocks.proposalFind.mockResolvedValue({ id: "p1", flowId: "f1" });
    mocks.acceptProposal.mockResolvedValue({ proposal: { id: "p1", kind: "step" }, stepId: "s5" });
    expect((await call("POST", "proposals/p1/accept", { edits: { name: "Test genes" }, expectedRevision: 3 })).body).toEqual({ proposal: { id: "p1", kind: "step" }, step: { id: "s5" }, recipe: { steps: [{ id: "s5" }] } });
    expect(mocks.acceptProposal).toHaveBeenCalledWith("p1", { name: "Test genes" }, 3, expect.objectContaining({ userId: "u1" }));
    mocks.discardProposal.mockResolvedValue({ id: "p1", state: "discarded" });
    expect((await call("POST", "proposals/p1/discard", { reason: "no" })).body.proposal.state).toBe("discarded");
    mocks.proposalFind.mockResolvedValue(null);
    expect((await call("POST", "proposals/p9/discard")).body.code).toBe("not_found");
  });

  it("reads and replaces a step's glosses with the step's access", async () => {
    mocks.analysisFind.mockResolvedValue({ targetKey: "project:p1" });
    mocks.listGlosses.mockResolvedValue({ revisionId: "r1", regions: [], glosses: [] });
    expect((await call("GET", "analyses/a1/glosses?revision=r1")).body.revisionId).toBe("r1");
    expect(mocks.listGlosses).toHaveBeenCalledWith("a1", "r1");
    mocks.putGlosses.mockResolvedValue({ revisionId: "r1", regions: [], glosses: [{ id: "g1" }] });
    expect((await call("PUT", "analyses/a1/glosses", { revisionId: "r1", glosses: [] })).body.glosses).toEqual([{ id: "g1" }]);
    expect(mocks.requireAccess).toHaveBeenLastCalledWith(session, "project:p1", "write");
    mocks.glossRecord.mockResolvedValue({ id: "g1", analysis: { targetKey: "project:p1" } });
    expect((await call("DELETE", "glosses/g1")).body).toEqual({ deleted: true });
  });
});

describe("Flow value routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.moduleEnabled.mockResolvedValue(true);
    mocks.flowFind.mockResolvedValue({ id: "f1", targetKey: "project:p1", name: "DE" });
    mocks.requireAccess.mockResolvedValue({ type: "project", id: "p1" });
  });

  it("feeds a flow's values and resolves references with the caller's access", async () => {
    mocks.flowValues.mockResolvedValue({ run: { id: "r1", number: 1 }, values: [], planned: [] });
    expect((await call("GET", "flows/f1/values?run=current&planned=1")).body.run.number).toBe(1);
    expect(mocks.flowValues).toHaveBeenCalledWith("f1", { run: "current", planned: true });
    mocks.resolveValues.mockImplementation(async (refs: string[], canRead: (flow: { targetKey: string }) => Promise<boolean>) => ({ values: [], unknown: refs, readable: await canRead({ targetKey: "project:p1" }) }));
    mocks.resolveAccess.mockResolvedValue({ level: "none", target: null });
    const resolved = await call("GET", "values/resolve?refs=labdesk://value/r1/s1/n,labdesk://value/r1/s1/m&verify=1");
    expect(resolved.body).toEqual({ values: [], unknown: ["labdesk://value/r1/s1/n", "labdesk://value/r1/s1/m"], readable: false });
    expect(mocks.resolveValues.mock.calls[0][2]).toEqual({ verify: true });
    expect((await call("GET", "values/resolve")).body.code).toBe("invalid_request");
  });
});

describe("Flow capsule routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.moduleEnabled.mockResolvedValue(true);
    mocks.flowFind.mockResolvedValue({ id: "f1", targetKey: "project:p1", name: "DE" });
    mocks.flowRunFind.mockResolvedValue({ id: "r1", flowId: "f1" });
    mocks.requireAccess.mockResolvedValue({ type: "project", id: "p1" });
    mocks.artifactFind.mockResolvedValue({ id: "a1", run: { analysis: { targetKey: "project:p1" } } });
  });

  it("answers lineage, starts a capsule once and hides capsules that are not ready", async () => {
    mocks.outputLineage.mockResolvedValue({ steps: [] });
    expect((await call("GET", "flows/f1/lineage?artifact=a1")).body).toEqual({ steps: [] });
    expect((await call("GET", "flows/f1/lineage")).body.code).toBe("invalid_request");
    mocks.requestCapsule.mockResolvedValueOnce({ capsule: { id: "c1", status: "building" }, created: true }).mockResolvedValueOnce({ capsule: { id: "c1", status: "building" }, created: false });
    expect((await call("POST", "artifacts/a1/capsule", {})).status).toBe(202);
    expect((await call("POST", "artifacts/a1/capsule", {})).status).toBe(200);
    mocks.capsuleFind.mockResolvedValue({ id: "c1", flowRunId: "r1", status: "building", path: null });
    expect((await call("GET", "capsules/c1")).body.capsule.status).toBe("building");
    expect((await call("GET", "capsules/c1/download")).body).toEqual({ error: "The capsule is not ready.", code: "not_found" });
  });
});
