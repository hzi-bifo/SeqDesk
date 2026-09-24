import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flowFind: vi.fn(), flowRunFind: vi.fn(), requireAccess: vi.fn(), moduleEnabled: vi.fn(),
  startFlowRun: vi.fn(), listFlowRuns: vi.fn(), getFlowRunDetail: vi.fn(), cancelFlowRun: vi.fn(), makeRunCurrent: vi.fn(), compareFlowRuns: vi.fn(), flowRunOutputs: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { exploreFlow: { findUnique: mocks.flowFind }, exploreFlowRun: { findUnique: mocks.flowRunFind } } }));
vi.mock("@/lib/explore/module", () => ({ isExploreModuleEnabled: mocks.moduleEnabled }));
vi.mock("@/lib/explore/authorization", async () => {
  const actual = await vi.importActual<typeof import("@/lib/explore/authorization")>("@/lib/explore/authorization");
  return { ...actual, requireTargetAccess: mocks.requireAccess };
});
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
