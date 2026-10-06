/**
 * Cancelling a recipe run in the second its pipeline run is being launched (live CRC, 6 Oct): SeqDesk refuses with 409
 * until the process id is recorded. The step waits for it and cancels then, instead of leaving the pipeline running.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ run: { status: "running", queueJobId: null as string | null }, calls: 0, answers: [] as Array<{ status: number; body: Record<string, unknown> }> }));
vi.mock("@/lib/db", () => ({ db: { pipelineRun: { findUnique: vi.fn(async () => ({ ...state.run })) } } }));
vi.mock("@/lib/pipelines/pipeline-run-ops-service", () => ({
  cancelPipelineRunForOperator: vi.fn(async () => {
    state.calls += 1;
    const answer = state.answers.shift() ?? { status: 200, body: {} };
    if (state.calls === 2) state.run.queueJobId = "local-42";
    if (answer.status < 300) state.run.status = "cancelled";
    return answer;
  }),
}));
vi.mock("@/lib/pipelines/pipeline-run-service", () => ({ createPipelineRunForOperator: vi.fn(), startPipelineRunForOperator: vi.fn() }));

import { cancelLaunchingPipelineRun } from "./pipeline-step-runs";

const launching = { status: 409, body: { error: "Cancellation could not verify the running job because no queue job ID is recorded" } };
beforeEach(() => { state.run = { status: "running", queueJobId: null }; state.calls = 0; state.answers = []; });

describe("cancelling a pipeline run while it launches", () => {
  it("waits for the process id and cancels then", async () => {
    state.answers = [launching, launching];
    await cancelLaunchingPipelineRun("prun", 8, 1);
    expect(state.calls).toBe(3);
    expect(state.run.status).toBe("cancelled");
  });
  it("does not retry a refusal that is the run's own end (outputs being saved)", async () => {
    state.run.queueJobId = "local-42";
    state.answers = [{ status: 409, body: { error: "Run output finalization is already in progress" } }];
    await cancelLaunchingPipelineRun("prun", 8, 1);
    expect(state.calls).toBe(1);
  });
  it("gives up after its attempts", async () => {
    state.answers = Array.from({ length: 10 }, () => launching);
    state.run.queueJobId = null;
    const original = state.answers.length;
    await cancelLaunchingPipelineRun("prun", 3, 1);
    expect(original - state.answers.length).toBe(3);
  });
});
