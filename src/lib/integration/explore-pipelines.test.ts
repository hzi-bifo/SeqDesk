/**
 * The pipeline-step routes (capability `explore.pipeline-steps`): each route reaches its service with the caller's
 * lab, rights and actor, answers with the Flow error contract, and the capability is advertised only when the
 * migration is in place.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flowFind: vi.fn(), analysisFind: vi.fn(), requireAccess: vi.fn(), resolveAccess: vi.fn(), moduleEnabled: vi.fn(), scopeFind: vi.fn(), getRecipeView: vi.fn(),
  addPipelineStep: vi.fn(), updatePipelineStep: vi.fn(), preflightPipeline: vi.fn(), pinnableRuns: vi.fn(), requirePipelineSteps: vi.fn(),
  listPresets: vi.fn(), savePreset: vi.fn(), deletePreset: vi.fn(), createInstallRequest: vi.fn(), listInstallRequests: vi.fn(), installRequestView: vi.fn(), decideInstallRequest: vi.fn(), withdrawInstallRequest: vi.fn(), pipelineStore: vi.fn(), dataSummary: vi.fn(),
  previewRunPlan: vi.fn(), resumePipelineStep: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { exploreFlow: { findUnique: mocks.flowFind }, exploreAnalysis: { findUnique: mocks.analysisFind }, integrationExploreScope: { findFirst: mocks.scopeFind } } }));
vi.mock("@/lib/explore/module", () => ({ isExploreModuleEnabled: mocks.moduleEnabled }));
vi.mock("./events", () => ({ enqueueFlowRecord: vi.fn().mockResolvedValue(undefined), prepareFlowRemoval: vi.fn() }));
vi.mock("@/lib/explore/authorization", async () => ({ ...(await vi.importActual<object>("@/lib/explore/authorization")), requireTargetAccess: mocks.requireAccess, resolveTargetAccess: mocks.resolveAccess }));
vi.mock("@/lib/explore/recipe-view", async () => ({ ...(await vi.importActual<object>("@/lib/explore/recipe-view")), getRecipeView: mocks.getRecipeView }));
vi.mock("@/lib/explore/proposals", () => ({ pendingProposals: vi.fn().mockResolvedValue([]), createProposals: vi.fn(), listProposals: vi.fn(), patchProposal: vi.fn(), discardProposal: vi.fn(), acceptProposal: vi.fn() }));
vi.mock("@/lib/explore/pipeline-steps", async () => ({
  ...(await vi.importActual<object>("@/lib/explore/pipeline-steps")),
  addPipelineStep: mocks.addPipelineStep, updatePipelineStep: mocks.updatePipelineStep, preflightPipeline: mocks.preflightPipeline, pinnableRuns: mocks.pinnableRuns, requirePipelineSteps: mocks.requirePipelineSteps,
}));
vi.mock("@/lib/explore/pipeline-lab", () => ({
  listPresets: mocks.listPresets, savePreset: mocks.savePreset, deletePreset: mocks.deletePreset, createInstallRequest: mocks.createInstallRequest, listInstallRequests: mocks.listInstallRequests,
  installRequestView: mocks.installRequestView, decideInstallRequest: mocks.decideInstallRequest, withdrawInstallRequest: mocks.withdrawInstallRequest, pipelineStore: mocks.pipelineStore, dataSummary: mocks.dataSummary,
}));
vi.mock("@/lib/explore/run-plan", () => ({ previewRunPlan: mocks.previewRunPlan, resumePipelineStep: mocks.resumePipelineStep }));

import { NextRequest } from "next/server";
import { flowError } from "./flow-contract";
import { exploreIntegrationCapabilities, handleExploreRequest } from "./explore";
import type { IntegrationSession } from "./identity";

const session = { user: { id: "u1", name: "Amara Okafor" }, integration: { authority: "https://collab.example", workspaceId: "team", memberId: "m1", projectId: "" } } as IntegrationSession;
const lab = "https://collab.example|team";
const call = async (method: string, path: string, body?: unknown) => {
  const request = new NextRequest(new URL(`http://compute.test/api/integration/v1/explore/${path}`), { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  const response = await handleExploreRequest(request, session, path.split("?")[0].split("/"), new Headers());
  return { status: response.status, body: await response.json() };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.moduleEnabled.mockResolvedValue(true);
  mocks.flowFind.mockResolvedValue({ id: "f1", targetKey: "project:p1", name: "Microbiome diversity" });
  mocks.requireAccess.mockResolvedValue({ type: "project", id: "p1" });
  mocks.resolveAccess.mockResolvedValue({ level: "write", target: { type: "project", id: "p1" } });
  mocks.scopeFind.mockResolvedValue({ projectId: "proj1", visibility: "lab", ownerMemberId: "" });
  mocks.requirePipelineSteps.mockResolvedValue(undefined);
  mocks.getRecipeView.mockImplementation(async (id: string) => ({ id, steps: [{ id: "s2", stepKind: "pipeline" }] }));
});

describe("pipeline step routes", () => {
  it("adds a pipeline step with its settings, sample list and kept tables, for the caller's lab", async () => {
    mocks.addPipelineStep.mockResolvedValue("s2");
    const response = await call("POST", "flows/f1/steps", { after: "s1", pipeline: { pipelineId: "ampliseq", version: "2.9.0", params: { trunclenf: 230 }, presetId: "preset1", samples: { from: "table", fromStep: { stepId: "s1", output: "sample_list" }, column: "sample" }, outputs: ["asv_table"] }, requestId: "flow_abcdefghijklmnopq" });
    expect(response.status).toBe(201);
    expect(response.body.step).toEqual({ id: "s2", stepKind: "pipeline" });
    expect(mocks.addPipelineStep).toHaveBeenCalledWith("f1", expect.objectContaining({
      pipelineId: "ampliseq", version: "2.9.0", params: { trunclenf: 230 }, presetId: "preset1", outputs: ["asv_table"], after: "s1", requestId: "flow_abcdefghijklmnopq", labKey: lab, pinnedRunId: null, request: null,
      samples: { from: "table", datasetId: null, column: "sample", fromStep: { stepId: "s1", output: "sample_list" } }, actor: { userId: "u1", memberId: "m1", name: "Amara Okafor" },
    }));
    await call("POST", "flows/f1/steps", { pipeline: { runId: "prun-3" } });
    expect(mocks.addPipelineStep.mock.calls[1][1]).toMatchObject({ pinnedRunId: "prun-3", pipelineId: null });
    await call("POST", "flows/f1/steps", { pipeline: { pipelineId: "ampliseq", request: { reason: "Taxa for the CRC samples" } } });
    expect(mocks.addPipelineStep.mock.calls[2][1]).toMatchObject({ request: { reason: "Taxa for the CRC samples" } });
  });

  it("changes a step's settings, reads its checks, previews a run and resumes it", async () => {
    mocks.updatePipelineStep.mockResolvedValue(true);
    expect((await call("PUT", "flows/f1/steps/s2/pipeline", { params: { kmers: 6 }, expectedRevisionId: "rev1", presetId: null })).body).toMatchObject({ changed: true, step: { id: "s2" } });
    expect(mocks.updatePipelineStep).toHaveBeenCalledWith("f1", "s2", expect.objectContaining({ params: { kmers: 6 }, expectedRevisionId: "rev1", presetId: null, labKey: lab }));

    mocks.preflightPipeline.mockResolvedValue({ ready: false, words: "4 of 5 checks pass" });
    expect((await call("GET", "flows/f1/steps/s2/preflight")).body).toEqual({ preflight: { ready: false, words: "4 of 5 checks pass" } });
    expect(mocks.preflightPipeline).toHaveBeenCalledWith("f1", { stepId: "s2" }, expect.objectContaining({ userId: "u1" }), lab);

    mocks.preflightPipeline.mockResolvedValue({ ready: true });
    await call("POST", "flows/f1/pipeline-preflight", { pipelineId: "fastqc", params: { kmers: 5 }, samples: { from: "table", datasetId: "d1" } });
    expect(mocks.preflightPipeline).toHaveBeenLastCalledWith("f1", { draft: { pipelineId: "fastqc", version: null, params: { kmers: 5 }, presetId: null, samples: { from: "table", datasetId: "d1", column: null } } }, expect.anything(), lab);

    mocks.previewRunPlan.mockResolvedValue({ ask: true, words: "Starts ampliseq: about 41 min" });
    expect((await call("POST", "flows/f1/run-plan", { scope: { steps: ["s3"] } })).body.plan).toEqual({ ask: true, words: "Starts ampliseq: about 41 min" });
    expect(mocks.previewRunPlan).toHaveBeenCalledWith("f1", { steps: ["s3"] }, { userId: "u1", memberId: "m1", name: "Amara Okafor" }, expect.objectContaining({ userId: "u1" }), "https://collab.example|team");

    mocks.resumePipelineStep.mockResolvedValue({ id: "run9", number: 9 });
    const resumed = await call("POST", "flows/f1/steps/s2/resume", { memory: "64 GB" });
    expect(resumed).toEqual({ status: 201, body: { run: { id: "run9", number: 9 } } });
    expect(mocks.resumePipelineStep).toHaveBeenCalledWith("f1", "s2", expect.objectContaining({ memory: "64 GB", time: null, force: false }));

    mocks.pinnableRuns.mockResolvedValue([{ id: "prun-3" }]);
    expect((await call("GET", "flows/f1/pipeline-runs?pipelineId=fastqc")).body).toEqual({ runs: [{ id: "prun-3" }] });
    expect(mocks.pinnableRuns).toHaveBeenCalledWith("project:p1", "fastqc");
  });

  it("answers with the Flow error contract, including before the migration", async () => {
    mocks.requirePipelineSteps.mockRejectedValue(flowError("invalid_request", "Pipeline steps need a database update on this Compute server."));
    expect(await call("GET", "pipeline-presets")).toEqual({ status: 400, body: { error: "Pipeline steps need a database update on this Compute server.", code: "invalid_request" } });
    mocks.requirePipelineSteps.mockResolvedValue(undefined);
    mocks.resumePipelineStep.mockRejectedValue(flowError("reads_changed", "The reads in Data changed since this run (1 file added).", { stepId: "s2" }));
    expect(await call("POST", "flows/f1/steps/s2/resume", {})).toEqual({ status: 409, body: { error: "The reads in Data changed since this run (1 file added).", code: "reads_changed", stepId: "s2" } });
  });
});

describe("lab routes", () => {
  it("keeps presets per lab", async () => {
    mocks.listPresets.mockResolvedValue([{ id: "preset1" }]);
    expect((await call("GET", "pipeline-presets?pipelineId=ampliseq")).body).toEqual({ presets: [{ id: "preset1" }] });
    expect(mocks.listPresets).toHaveBeenCalledWith(lab, "ampliseq", expect.objectContaining({ userId: "u1" }));
    mocks.savePreset.mockResolvedValue({ id: "preset2" });
    expect((await call("POST", "pipeline-presets", { pipelineId: "ampliseq", name: "V4 16S", params: { trunclenf: 230 } })).status).toBe(201);
    expect(mocks.savePreset).toHaveBeenCalledWith(lab, expect.objectContaining({ pipelineId: "ampliseq", name: "V4 16S", params: { trunclenf: 230 } }), expect.objectContaining({ userId: "u1" }), expect.objectContaining({ userId: "u1" }));
    await call("PATCH", "pipeline-presets/preset2", { note: "MiSeq 2×300" });
    expect(mocks.savePreset.mock.calls[1][1]).toMatchObject({ id: "preset2", note: "MiSeq 2×300" });
    mocks.deletePreset.mockResolvedValue(undefined);
    expect((await call("DELETE", "pipeline-presets/preset2")).body).toEqual({ deleted: true });
  });

  it("asks to install, lists requests, and lets the admin decide", async () => {
    mocks.createInstallRequest.mockResolvedValue({ id: "req1" });
    mocks.installRequestView.mockResolvedValue({ id: "req1", status: "pending" });
    const asked = await call("POST", "pipeline-requests", { pipelineId: "ampliseq", version: "2.9.0", reason: "Taxa for the CRC samples", flowId: "f1", after: "s1" });
    expect(asked).toEqual({ status: 201, body: { request: { id: "req1", status: "pending" } } });
    expect(mocks.createInstallRequest).toHaveBeenCalledWith(expect.objectContaining({ labKey: lab, kind: "install", pipelineId: "ampliseq", version: "2.9.0", reason: "Taxa for the CRC samples", targetKey: "project:p1", flowId: "f1", stepPosition: "s1" }));
    mocks.listInstallRequests.mockResolvedValue([{ id: "req1" }]);
    expect((await call("GET", "pipeline-requests?status=pending")).body).toEqual({ requests: [{ id: "req1" }] });
    mocks.decideInstallRequest.mockResolvedValue({ id: "req1", status: "installed" });
    expect((await call("POST", "pipeline-requests/req1/decide", { decision: "install" })).body).toEqual({ request: { id: "req1", status: "installed" } });
    expect(mocks.decideInstallRequest).toHaveBeenCalledWith("req1", { decision: "install", note: undefined }, expect.objectContaining({ userId: "u1" }), expect.objectContaining({ canManage: expect.any(Boolean) }));
  });

  it("reads the store and a study's data summary with the study's access", async () => {
    mocks.pipelineStore.mockResolvedValue({ pipelines: [], goals: [] });
    expect((await call("GET", "pipeline-store?targetKey=project:p1")).body).toEqual({ pipelines: [], goals: [] });
    expect(mocks.requireAccess).toHaveBeenCalledWith(session, "project:p1", "read");
    expect(mocks.pipelineStore).toHaveBeenCalledWith(expect.objectContaining({ targetKey: "project:p1", labKey: lab }));
    mocks.dataSummary.mockResolvedValue({ words: "708 samples · paired FASTQ 2×250 · 16S V4 amplicons" });
    expect((await call("GET", "data-summary?targetKey=project:p1")).body).toEqual({ summary: { words: "708 samples · paired FASTQ 2×250 · 16S V4 amplicons" } });
    expect((await call("GET", "data-summary?targetKey=study:s1")).body).toEqual({ error: "Choose an Analysis study.", code: "invalid_request" });
  });
});

describe("the capability", () => {
  it("is advertised only when the pipeline-steps migration is in place", () => {
    expect(exploreIntegrationCapabilities({ pipelineSteps: true })).toContain("explore.pipeline-steps");
    expect(exploreIntegrationCapabilities({ pipelineSteps: false })).not.toContain("explore.pipeline-steps");
    expect(exploreIntegrationCapabilities()).not.toContain("explore.pipeline-steps");
  });
});
