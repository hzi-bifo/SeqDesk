/**
 * Numbered runs of a recipe against a real PostgreSQL database. The step
 * runner is replaced (no processes are started); everything else, including
 * the recipe model, plans, reuse, states and the one-active-run index, runs
 * for real. Set SEQDESK_FLOW_DATABASE_URL to a migrated local database whose
 * name contains "flow" and "check" or "test"; the test removes what it writes.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.SEQDESK_FLOW_DATABASE_URL;
const state = vi.hoisted(() => ({ counter: 0, started: [] as string[] }));

vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { db: new PrismaClient({ datasourceUrl: process.env.SEQDESK_FLOW_DATABASE_URL || "postgresql://invalid@127.0.0.1:1/none" }) };
});
vi.mock("./environments", () => ({ resolveReadyEnvironment: vi.fn().mockResolvedValue({ prefixPath: "/envs/python", specHash: "spec1" }) }));
vi.mock("./environment-lock", () => ({ pinEnvironment: vi.fn().mockResolvedValue({ name: "seqdesk-explore-python", specHash: "spec1", lockDigest: "5c1e9a".padEnd(64, "0"), label: "Python 3.12 · lock 5c1e9a", language: "python", languageVersion: "3.12", host: "test" }) }));
vi.mock("./runner", async () => {
  const actual = await vi.importActual<typeof import("./runner")>("./runner");
  const { db } = await import("@/lib/db");
  return {
    ...actual,
    // Record the step run as the real runner would, without starting a process.
    createAndStartRun: vi.fn(async (input: Parameters<typeof actual.createAndStartRun>[0]) => {
      const existing = input.runId ? await db.exploreAnalysisRun.findUnique({ where: { id: input.runId } }) : null;
      if (existing) return { id: existing.id, runNumber: existing.runNumber, status: existing.status };
      state.counter += 1;
      const run = await db.exploreAnalysisRun.create({ data: {
        id: input.runId, analysisId: input.analysisId, revisionId: input.revisionId!, runNumber: `EXP-FLOWTEST-${randomUUID().slice(0, 8)}-${state.counter}`,
        status: "running", startedAt: new Date(), createdById: input.createdById,
        flowRunId: input.flowRun?.id, stepLabel: input.flowRun?.stepLabel, trial: input.flowRun?.trial ?? false,
      } });
      state.started.push(input.analysisId);
      return { id: run.id, runNumber: run.runNumber, status: run.status, executionMode: null, revisionNumber: 1, queuedAt: null, startedAt: null, completedAt: null, exitCode: null, artifactCount: 0, createdAt: run.createdAt.toISOString() };
    }),
  };
});

import { db } from "@/lib/db";
import { createAnalysis, createRevision } from "./analyses";
import { addHold, advanceFlowRun, cancelFlowRun, compareFlowRuns, getFlowRunDetail, listFlowRuns, listHolds, makeRunCurrent, removeHold, runRecords, revisionsUsedBy, startFlowRun } from "./flow-runs";
import { getRecipeView } from "./recipe-view";
import { computeStepStates, loadRecipe } from "./recipe";
import { flowValues, resolveValues } from "./values";

const suffix = randomUUID().slice(0, 8);
const targetKey = `project:flowtest-${suffix}`;
let userId = "";
let flowId = "";
const steps: Record<string, string> = {};
const actor = () => ({ userId, memberId: "member-1", name: "Amara" });

async function finishStep(flowRunId: string, analysisId: string, status: "completed" | "failed", results: Record<string, unknown> = {}, errorTail?: string) {
  const stepRun = await db.exploreAnalysisRun.findFirst({ where: { flowRunId, analysisId }, orderBy: { createdAt: "desc" } });
  if (!stepRun) throw new Error(`No step run for ${analysisId}`);
  const pins = await db.exploreAnalysis.findUnique({ where: { id: analysisId }, include: { revisions: { orderBy: { number: "desc" }, take: 1 } } });
  const bindings = JSON.parse(pins!.revisions[0].inputs) as Array<{ alias: string; datasetId: string }>;
  const inputPins = [];
  for (const binding of bindings) {
    const dataset = await db.exploreDataset.findUnique({ where: { id: binding.datasetId } });
    const version = dataset?.currentVersionId ? await db.exploreDatasetVersion.findUnique({ where: { id: dataset.currentVersionId } }) : null;
    inputPins.push({ alias: binding.alias, datasetId: binding.datasetId, versionId: version?.id ?? "", versionNumber: version?.number ?? null, contentHash: version?.contentHash ?? null, name: dataset?.name });
  }
  await db.exploreAnalysisRun.update({ where: { id: stepRun.id }, data: { status, completedAt: new Date(), durationMs: 1000, results: JSON.stringify(results), errorTail: errorTail ?? null, exitCode: status === "completed" ? 0 : 1, inputPins } });
  if (status === "completed") {
    // A finished step writes a new version of the tables it produces.
    const produced = await db.exploreDataset.findMany({ where: { targetKey, kind: "derived" } });
    for (const dataset of produced.filter((entry) => JSON.parse(entry.sourceConfig ?? "{}").analysisId === analysisId)) {
      const count = await db.exploreDatasetVersion.count({ where: { datasetId: dataset.id } });
      const version = await db.exploreDatasetVersion.create({ data: { datasetId: dataset.id, number: count + 1, contentHash: randomUUID().replace(/-/g, ""), schema: JSON.stringify({ columns: [{ key: "gene", label: "Gene", type: "string" }] }), rowCount: 3, provenance: "{}", buildSource: "analysis-run" } });
      await db.exploreDataset.update({ where: { id: dataset.id }, data: { currentVersionId: version.id } });
    }
  }
}

describe.skipIf(!url)("flow runs (PostgreSQL)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/flow/.test(parsed.pathname) || !/(check|test)/.test(parsed.pathname)) {
      throw new Error("Use a local database whose name contains flow and check or test");
    }
    const user = await db.user.create({ data: { email: `flowtest-${suffix}@example.invalid`, password: "!disabled", firstName: "Flow", lastName: "Test", isActive: false } });
    userId = user.id;
    const flow = await db.exploreFlow.create({ data: { targetKey, name: "Differential expression, 0–24 h", createdById: userId } });
    flowId = flow.id;
    const counts = await db.exploreDataset.create({ data: { targetKey, kind: "external", name: "counts", createdById: userId, roles: JSON.stringify({ sample: "sample" }) } });
    const version = await db.exploreDatasetVersion.create({ data: { datasetId: counts.id, number: 2, contentHash: "8be04d".padEnd(64, "1"), schema: JSON.stringify({ columns: [{ key: "sample", label: "Sample", type: "string" }] }), rowCount: 24, provenance: "{}", buildSource: "import" } });
    await db.exploreDataset.update({ where: { id: counts.id }, data: { currentVersionId: version.id } });
    const filter = await createAnalysis({ targetKey, flowId, name: "Filter low counts", inputs: [{ alias: "counts", datasetId: counts.id, versionId: null }], createdById: userId });
    steps.filter = filter.id;
    const filtered = await db.exploreDataset.create({ data: { targetKey, kind: "derived", name: "filtered", createdById: userId, sourceConfig: JSON.stringify({ builder: "analysis-run", analysisId: filter.id, artifactName: "filtered" }) } });
    const test = await createAnalysis({ targetKey, flowId, name: "Test genes", inputs: [{ alias: "filtered", datasetId: filtered.id, versionId: null }], createdById: userId });
    steps.test = test.id;
    const qc = await createAnalysis({ targetKey, flowId, name: "Sample QC", inputs: [{ alias: "counts", datasetId: counts.id, versionId: null }], createdById: userId });
    steps.qc = qc.id;
  });

  afterAll(async () => {
    if (!url || !userId) return;
    await db.exploreFlow.deleteMany({ where: { targetKey } });
    await db.exploreAnalysis.deleteMany({ where: { targetKey } });
    await db.exploreDataset.deleteMany({ where: { targetKey } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it("runs the whole recipe as run #1, step by step, and makes it current", async () => {
    const recipe = await loadRecipe(flowId);
    expect(recipe!.steps.map((step) => recipe!.labels.get(step.id))).toEqual(["1", "2", "3"]);
    expect([...recipe!.upstream.get(steps.test)!]).toEqual([steps.filter]);

    const run = await startFlowRun(flowId, { scope: "all", actor: actor(), notify: true });
    expect(run).toMatchObject({ number: 1, kind: "full", status: "running", recipeRevision: 3, stepCount: 3, progress: { done: 0, total: 3 } });
    expect(state.started.sort()).toEqual([steps.filter, steps.qc].sort());
    await expect(startFlowRun(flowId, { scope: "all", actor: actor() })).rejects.toMatchObject({ status: 409, code: "run_active" });

    await finishStep(run.id, steps.filter, "completed", { metrics: { n_kept: 17904 }, metricMeta: { n_kept: { label: "Genes kept" } } });
    await advanceFlowRun(run.id);
    expect(state.started).toContain(steps.test);
    await finishStep(run.id, steps.test, "completed", { metrics: { n_called: 1146 }, metricMeta: { n_called: { label: "DE genes" } } });
    await finishStep(run.id, steps.qc, "completed", {});
    await advanceFlowRun(run.id);

    const detail = await getFlowRunDetail(run.id);
    expect(detail).toMatchObject({ status: "completed", current: true, headline: { label: "Genes kept", value: 17904 }, progress: { done: 3, total: 3, etaMs: null } });
    expect(detail.inputsLabel).toBe("counts v2 8be04d");
    expect(detail.codeLabel).toMatch(/^rev 3 [0-9a-f]{6}$/);
    expect(detail.steps.map((step) => step.status)).toEqual(["completed", "completed", "completed"]);
    expect((await db.exploreFlow.findUnique({ where: { id: flowId } }))!.currentRunId).toBe(run.id);
  });

  it("re-runs only what is out of date and reuses the rest", async () => {
    await createRevision({ analysisId: steps.test, code: "print('edgeR')", author: "user", authorUserId: userId });
    const model = await loadRecipe(flowId);
    const current = (await runRecords(model!.flow.currentRunId!))!.records;
    const states = computeStepStates({ model: model!, records: current, revisionsUsed: await revisionsUsedBy(current) });
    expect(states.get(steps.test)).toMatchObject({ state: "outOfDate", reason: "codeChanged" });
    expect(states.get(steps.filter)?.state).toBe("current");
    // Three steps added, then a new code revision of one: recipe rev 4, with a snapshot per change.
    expect((await db.exploreFlow.findUnique({ where: { id: flowId } }))!.recipeRevision).toBe(4);
    expect(await db.exploreFlowRevision.count({ where: { flowId } })).toBe(4);

    state.started = [];
    const run = await startFlowRun(flowId, { scope: "outOfDate", actor: actor() });
    expect(run).toMatchObject({ number: 2, kind: "outOfDate", reusedCount: 2, progress: { total: 1 } });
    expect(state.started).toEqual([steps.test]);
    await finishStep(run.id, steps.test, "completed", { metrics: { n_called: 1152 }, metricMeta: { n_called: { label: "DE genes" } } });
    await advanceFlowRun(run.id);
    const detail = await getFlowRunDetail(run.id);
    expect(detail.status).toBe("completed");
    expect(detail.steps.find((step) => step.stepId === steps.filter)).toMatchObject({ status: "reused", reusedFrom: { number: 1 } });

    const runs = await listFlowRuns(flowId);
    expect(runs.runs.map((entry) => [entry.number, entry.current, entry.superseded])).toEqual([[2, true, false], [1, false, true]]);
    const first = runs.runs[1].id;
    const comparison = await compareFlowRuns(first, run.id, steps.test);
    expect(comparison.code.map((entry) => entry.label)).toEqual(["2"]);
    expect(comparison.steps[0].lines[0]).toEqual({ label: "DE genes", from: 1146, to: 1152 });
    expect(comparison.words).toBe("Step 2's code changed; step 2: DE genes 1,146 → 1,152.");
    await expect(startFlowRun(flowId, { scope: "outOfDate", actor: actor() })).rejects.toMatchObject({ code: "invalid_request" });

    // The values feed: the current run's values, and references resolved with the caller's access.
    const feed = await flowValues(flowId, { run: "current", planned: true });
    const called = feed.values.find((value) => value.metric === "n_called")!;
    expect(called).toMatchObject({ key: `${steps.test}.n_called`, label: "DE genes", value: 1152, stepLabel: "2", runNumber: 2, verified: true });
    expect(feed.planned).toEqual([]);
    const resolved = await resolveValues([called.ref, "labdesk://value/nope/x/y", "not a ref"], async () => true);
    expect(resolved.values[0]).toMatchObject({ value: 1152, current: true, flowName: "Differential expression, 0–24 h" });
    expect(resolved.unknown).toEqual(["labdesk://value/nope/x/y", "not a ref"]);
    expect((await resolveValues([called.ref], async () => false)).unknown).toEqual([called.ref]);
    // Nothing on disk to check the checksums against here, so verification says no.
    expect((await resolveValues([called.ref], async () => true, { verify: true })).values[0].verified).toBe(false);

    await makeRunCurrent(first);
    expect((await db.exploreFlow.findUnique({ where: { id: flowId } }))!.currentRunId).toBe(first);
    await makeRunCurrent(run.id);
  });

  it("fails a run at the step that failed, in words, and blocks the steps after it", async () => {
    const run = await startFlowRun(flowId, { scope: { steps: [steps.filter] }, actor: actor() });
    expect(run.kind).toBe("steps");
    await finishStep(run.id, steps.filter, "failed", {}, "Traceback (most recent call last):\nKeyError: 'sample'");
    await advanceFlowRun(run.id);
    const detail = await getFlowRunDetail(run.id);
    expect(detail.status).toBe("failed");
    expect(detail.failed).toEqual({ stepId: steps.filter, stepLabel: "1", words: "Step 1 needs a column named sample, which the table does not have." });
    expect(detail.steps.find((step) => step.stepId === steps.test)).toMatchObject({ status: "cancelled", blockedBy: "1" });
    expect(detail.steps.find((step) => step.stepId === steps.qc)?.status).toBe("reused");
  });

  it("numbers trials apart, never makes them current, and stops a run on request", async () => {
    const before = (await db.exploreFlow.findUnique({ where: { id: flowId } }))!.currentRunId;
    const trial = await startFlowRun(flowId, { scope: "all", trial: true, sample: 2, actor: actor() });
    expect(trial).toMatchObject({ number: null, trialNumber: 1, kind: "trial" });
    const stepRuns = await db.exploreAnalysisRun.findMany({ where: { flowRunId: trial.id } });
    expect(stepRuns.every((stepRun) => stepRun.trial)).toBe(true);
    const cancelled = await cancelFlowRun(trial.id);
    expect(cancelled.status).toBe("cancelled");
    expect((await db.exploreFlow.findUnique({ where: { id: flowId } }))!.currentRunId).toBe(before);
    await expect(makeRunCurrent(trial.id)).rejects.toMatchObject({ code: "not_completed" });
    const again = await startFlowRun(flowId, { scope: "all", actor: actor(), requestId: `flow_${suffix}abcdefghijkl` });
    expect(await startFlowRun(flowId, { scope: "all", actor: actor(), requestId: `flow_${suffix}abcdefghijkl` })).toMatchObject({ id: again.id });
    await cancelFlowRun(again.id);
  });

  it("keeps a marked or cited current run in place: a newer run completes as newer, not current, until someone makes it current", async () => {
    const current = (await db.exploreFlow.findUnique({ where: { id: flowId } }))!.currentRunId!;
    const citedRef = `labdesk://value/${current}/${steps.test}/n_called`;
    await expect(addHold(current, "writer", "labdesk://value/other/x/y", actor())).rejects.toMatchObject({ code: "invalid_request" });
    await addHold(current, "writer", citedRef, actor());
    expect((await addHold(current, "check", `labdesk://run/${current}`, actor())).map((hold) => hold.kind)).toEqual(["writer", "check"]);

    await createRevision({ analysisId: steps.test, code: "print('voom')", author: "user", authorUserId: userId });
    const run = await startFlowRun(flowId, { scope: "outOfDate", actor: actor() });
    await finishStep(run.id, steps.test, "completed", { metrics: { n_called: 1160 }, metricMeta: { n_called: { label: "DE genes" } } });
    await advanceFlowRun(run.id);
    expect((await db.exploreFlow.findUnique({ where: { id: flowId } }))!.currentRunId).toBe(current);
    const detail = await getFlowRunDetail(run.id);
    expect(detail).toMatchObject({ status: "completed", current: false, newer: true, superseded: false });
    const recipe = await getRecipeView(flowId, { canEdit: true });
    expect(recipe.flow.newerRun).toMatchObject({ id: run.id, number: run.number });
    expect(recipe.flow.currentHolds).toEqual({ checks: 1, writer: 1 });
    expect((await listFlowRuns(flowId)).runs.find((entry) => entry.id === current)?.holds).toEqual({ checks: 1, writer: 1 });
    expect((await resolveValues([citedRef], async () => true)).values[0]).toMatchObject({ value: 1152, current: true, changed: false, currentValue: null });

    const made = await makeRunCurrent(run.id);
    expect(made.flow).toEqual({ id: flowId, currentRunId: run.id, previousRunId: current });
    expect(made.affected).toEqual([{ ref: citedRef, stepId: steps.test, metric: "n_called", label: "DE genes", from: 1152, to: 1160, changed: true, currentRef: `labdesk://value/${run.id}/${steps.test}/n_called` }]);
    expect((await resolveValues([citedRef], async () => true)).values[0]).toMatchObject({ value: 1152, current: false, changed: true, currentValue: { value: 1160, runId: run.id } });
    expect(await removeHold(current, "check", `labdesk://run/${current}`)).toHaveLength(1);
    expect(await listHolds(current)).toHaveLength(1);
  });
});
