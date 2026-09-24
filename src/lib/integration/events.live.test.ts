/**
 * The push to the collaboration server against a real PostgreSQL database:
 * what a flow run queues (events, records, notify lists, private scopes),
 * how the outbox coalesces records and retries. The step runner is replaced
 * and the server is a recording fetch. See flow-runs.live.test.ts for
 * SEQDESK_FLOW_DATABASE_URL.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.SEQDESK_FLOW_DATABASE_URL;
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { db: new PrismaClient({ datasourceUrl: process.env.SEQDESK_FLOW_DATABASE_URL || "postgresql://invalid@127.0.0.1:1/none" }) };
});
vi.mock("@/lib/explore/environments", () => ({ resolveReadyEnvironment: vi.fn().mockResolvedValue({ prefixPath: "/envs/python", specHash: "spec1" }) }));
vi.mock("@/lib/explore/environment-lock", () => ({ pinEnvironment: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/explore/runner", async () => {
  const actual = await vi.importActual<typeof import("@/lib/explore/runner")>("@/lib/explore/runner");
  const { db } = await import("@/lib/db");
  return {
    ...actual,
    createAndStartRun: vi.fn(async (input: Parameters<typeof actual.createAndStartRun>[0]) => {
      const existing = input.runId ? await db.exploreAnalysisRun.findUnique({ where: { id: input.runId } }) : null;
      if (existing) return { id: existing.id, runNumber: existing.runNumber, status: existing.status };
      const run = await db.exploreAnalysisRun.create({ data: { id: input.runId, analysisId: input.analysisId, revisionId: input.revisionId!, runNumber: `EXP-EVT-${randomUUID().slice(0, 12)}`, status: "running", startedAt: new Date(), createdById: input.createdById, flowRunId: input.flowRun?.id, stepLabel: input.flowRun?.stepLabel } });
      return { id: run.id, runNumber: run.runNumber, status: run.status };
    }),
  };
});

import { db } from "@/lib/db";
import { createAnalysis } from "@/lib/explore/analyses";
import { advanceFlowRun, startFlowRun } from "@/lib/explore/flow-runs";
import { deliverOutbox, enqueueFlowRecord, prepareFlowRemoval, retryDelayMs } from "./events";

const suffix = randomUUID().slice(0, 8);
const targetKey = `project:eventtest-${suffix}`;
const origin = "https://collab-events.example";
const labWorkspace = `ws-lab-${suffix}`;
const privateWorkspace = `ws-private-${suffix}`;
let userId = "";
let flowId = "";
const steps: string[] = [];
const actor = () => ({ userId, memberId: "m-starter", name: "Amara" });

async function finish(flowRunId: string, analysisId: string, status: "completed" | "failed", metrics: Record<string, unknown> = {}, errorTail?: string) {
  const stepRun = await db.exploreAnalysisRun.findFirst({ where: { flowRunId, analysisId } });
  await db.exploreAnalysisRun.update({ where: { id: stepRun!.id }, data: { status, completedAt: new Date(), results: JSON.stringify({ metrics, metricMeta: { n_called: { label: "DE genes" } } }), errorTail: errorTail ?? null } });
}

type Sent = { url: string; body: { workspaceId: string; events?: Array<Record<string, unknown>>; records?: Array<Record<string, unknown>>; removed?: string[] } };
function recorder(status = 200) {
  const sent: Sent[] = [];
  const fetcher = vi.fn(async (target: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(target), body: JSON.parse(String(init?.body)) });
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${"s".repeat(40)}`);
    return new Response(JSON.stringify({ received: 1 }), { status });
  });
  return { sent, fetcher: fetcher as unknown as typeof fetch };
}

describe.skipIf(!url)("pushing Flow to the collaboration server (PostgreSQL)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/flow/.test(parsed.pathname) || !/(check|test)/.test(parsed.pathname)) throw new Error("Use a local flow check database");
    process.env.SEQDESK_INTEGRATION_CONFIG = JSON.stringify({ installationId: "compute-1", name: "Compute", collaborationOrigin: origin, secret: "s".repeat(40), webOrigins: ["https://web.example"], accounts: [] });
    userId = (await db.user.create({ data: { email: `eventtest-${suffix}@example.invalid`, password: "!disabled", firstName: "E", lastName: "T", isActive: false } })).id;
    flowId = (await db.exploreFlow.create({ data: { targetKey, name: "Differential expression, 0–24 h", createdById: userId, createdByMemberId: "m-owner" } })).id;
    await db.integrationExploreScope.createMany({ data: [
      { id: randomUUID(), authority: origin, workspaceId: labWorkspace, projectId: "proj-1", targetKey, createdBy: userId },
      { id: randomUUID(), authority: origin, workspaceId: privateWorkspace, targetKey, createdBy: userId, visibility: "private", ownerMemberId: "m-owner" },
      { id: randomUUID(), authority: "https://other.example", workspaceId: `ws-other-${suffix}`, targetKey, createdBy: userId },
    ] });
    const dataset = await db.exploreDataset.create({ data: { targetKey, kind: "external", name: "counts", createdById: userId } });
    const version = await db.exploreDatasetVersion.create({ data: { datasetId: dataset.id, number: 1, contentHash: "d".repeat(64), schema: "{\"columns\":[]}", rowCount: 3, provenance: "{}", buildSource: "import" } });
    await db.exploreDataset.update({ where: { id: dataset.id }, data: { currentVersionId: version.id } });
    for (const name of ["Filter", "Test genes"]) steps.push((await createAnalysis({ targetKey, flowId, name, code: "x", inputs: [{ alias: "counts", datasetId: dataset.id, versionId: null }], createdById: userId })).id);
  });

  afterAll(async () => {
    if (!url || !userId) return;
    delete process.env.SEQDESK_INTEGRATION_CONFIG;
    await db.exploreEventOutbox.deleteMany({ where: { workspaceId: { in: [labWorkspace, privateWorkspace] } } });
    await db.integrationExploreScope.deleteMany({ where: { targetKey } });
    await db.exploreFlow.deleteMany({ where: { targetKey } });
    await db.exploreAnalysis.deleteMany({ where: { targetKey } });
    await db.exploreDataset.deleteMany({ where: { targetKey } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it("queues run events and records for every workspace of the study, and delivers them coalesced", async () => {
    await enqueueFlowRecord(flowId);
    const run = await startFlowRun(flowId, { scope: "all", actor: actor(), notify: true });
    for (const step of steps) await finish(run.id, step, "completed", step === steps[1] ? { n_called: 1146 } : {});
    await advanceFlowRun(run.id);

    const { sent, fetcher } = recorder();
    const result = await deliverOutbox({ fetch: fetcher });
    expect(result.failed).toBe(0);
    expect(sent.every((request) => request.url.startsWith(origin))).toBe(true);
    const events = sent.filter((request) => request.url.endsWith("/api/compute/notebook-events"));
    const lab = events.find((request) => request.body.workspaceId === labWorkspace)!.body.events!;
    expect(lab.map((event) => event.kind)).toEqual(["run.started", "run.finished"]);
    expect(lab[1]).toMatchObject({ eventId: `${run.id}:finished`, ref: `labdesk://run/${run.id}`, flowRef: `labdesk://flow/${flowId}`, summary: "Run #1 · 2 of 2 steps · 1,146 DE genes", severity: "info", visibleTo: "lab", notify: ["m-starter"] });
    expect(lab[0].notify).toBeUndefined();
    const privateEvents = events.find((request) => request.body.workspaceId === privateWorkspace)!.body.events!;
    expect(privateEvents[0].visibleTo).toEqual(["m-owner"]);

    const records = sent.filter((request) => request.url.endsWith("/api/compute/records") && request.body.workspaceId === labWorkspace).flatMap((request) => request.body.records!);
    const runRecords = records.filter((record) => record.kind === "run");
    expect(runRecords).toHaveLength(1);
    expect(runRecords[0]).toMatchObject({ ref: `labdesk://run/${run.id}`, title: "Run #1 · Differential expression, 0–24 h", subtitle: "2 of 2 steps · 1,146 DE genes", state: "completed", projectId: "proj-1", visibleTo: "lab", progress: { done: 2, total: 2, current: "" } });
    expect(records.find((record) => record.kind === "value")).toMatchObject({ ref: `labdesk://value/${run.id}/${steps[1]}/n_called`, title: "DE genes", state: "current", subtitle: "1,146 · Run #1 step 2" });
    expect(records.find((record) => record.kind === "flow")).toMatchObject({ ref: `labdesk://flow/${flowId}`, state: "current", subtitle: "Recipe rev 2 · 2 steps" });
    expect(sent.some((request) => request.body.workspaceId === `ws-other-${suffix}`)).toBe(false);
    expect((await deliverOutbox({ fetch: fetcher })).delivered).toBe(0);
  });

  it("names the starter and the flow owner when a run fails, and retries or gives up on delivery", async () => {
    const run = await startFlowRun(flowId, { scope: "all", actor: actor() });
    await finish(run.id, steps[0], "failed", {}, "KeyError: 'sample'");
    await advanceFlowRun(run.id);
    const unavailable = recorder(503);
    const now = Date.now();
    const first = await deliverOutbox({ fetch: unavailable.fetcher, now: () => now });
    expect(first.retried).toBeGreaterThan(0);
    const waiting = await db.exploreEventOutbox.findMany({ where: { workspaceId: labWorkspace, deliveredAt: null } });
    expect(waiting.every((row) => row.attempts === 1 && row.nextAttemptAt.getTime() === now + retryDelayMs(0))).toBe(true);
    expect((await deliverOutbox({ fetch: unavailable.fetcher, now: () => now + 1000 })).retried).toBe(0);

    const ok = recorder();
    await deliverOutbox({ fetch: ok.fetcher, now: () => now + 2500 });
    const failed = ok.sent.find((request) => request.body.workspaceId === labWorkspace && request.body.events)!.body.events!.find((event) => event.kind === "run.failed")!;
    expect(failed).toMatchObject({ summary: "Run #2 failed at step 1 · Step 1 needs a column named sample, which the table does not have.", severity: "failed", notify: ["m-starter", "m-owner"] });

    const removal = await prepareFlowRemoval(flowId, targetKey);
    await removal!();
    const missing = recorder(404);
    const gone = await deliverOutbox({ fetch: missing.fetcher });
    expect(gone.failed).toBeGreaterThan(0);
    expect(missing.sent.find((request) => request.body.workspaceId === labWorkspace)!.body).toMatchObject({ records: [], removed: expect.arrayContaining([`labdesk://flow/${flowId}`, `labdesk://run/${run.id}`]) });
    expect(retryDelayMs(20)).toBe(10 * 60 * 1000);
  });
});
