/**
 * Pushing Flow to the collaboration server (FLOW-GAPS A6, D22, D23): run
 * events for the notebook and the Inbox (`POST /api/compute/notebook-events`)
 * and compute records with titles, states and projects of flows, runs,
 * values and outputs (`POST /api/compute/records`, compute-records-v1).
 *
 * Every change is written to an outbox first; the explore monitor delivers it
 * with retries (2 s doubling to 10 min, given up after 24 h). Event ids are
 * stable per change, and records carry an increasing updatedAt, so replays
 * and reordering are harmless on the receiving side. Trial runs push nothing.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { planOf, runValues, serializeFlowRunById } from "@/lib/explore/flow-runs";
import type { FlowRunChange } from "@/lib/explore/flow-events";
import { integrationConfig, type IntegrationConfig } from "./config";

const SEGMENT = /^[A-Za-z0-9_.-]{1,128}$/;
const MEMBER = /^[A-Za-z0-9_-]{1,256}$/;
const MAX_ATTEMPT_DELAY_MS = 10 * 60 * 1000;
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;

export interface NotebookEvent {
  eventId: string;
  kind: "run.started" | "run.finished" | "run.failed";
  ref: string;
  flowRef: string;
  summary: string;
  severity: "info" | "failed";
  at: number;
  visibleTo: "lab" | string[];
  notify?: string[];
}

export interface ComputeRecord {
  ref: string;
  kind: "flow" | "run" | "value" | "output";
  title: string;
  subtitle: string;
  state: string;
  progress: { done: number; total: number; current: string };
  projectId: string;
  flowRef: string;
  at: number;
  updatedAt: number;
  visibleTo: "lab" | string[];
  payload?: Record<string, unknown>;
}

/** Whether this installation pushes at all: integration configured and not switched off. */
export function eventsConfig(): IntegrationConfig | null {
  if (process.env.SEQDESK_EXPLORE_EVENTS === "0") return null;
  try {
    return integrationConfig();
  } catch {
    return null;
  }
}

let lastStamp = 0;
/** A strictly increasing clock, so two changes in one millisecond still order. */
export function stamp(now = Date.now()): number {
  lastStamp = Math.max(now, lastStamp + 1);
  return lastStamp;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const formatValue = (value: unknown) => (typeof value === "number" ? value.toLocaleString("en-US") : value === null || value === undefined ? "" : String(value));

interface Audience {
  authority: string;
  workspaceId: string;
  projectId: string;
  visibleTo: "lab" | string[];
}

/** The workspaces a flow's study is shared with through this installation's collaboration server. */
async function audiencesOf(targetKey: string, config: IntegrationConfig): Promise<Audience[]> {
  const scopes = await db.integrationExploreScope.findMany({ where: { authority: config.collaborationOrigin, targetKey } });
  return scopes.map((scope): Audience => ({
    authority: scope.authority,
    workspaceId: scope.workspaceId,
    projectId: MEMBER.test(scope.projectId) && scope.projectId.length <= 128 ? scope.projectId : "",
    visibleTo: scope.visibility === "private" ? (MEMBER.test(scope.ownerMemberId) ? [scope.ownerMemberId] : []) : "lab",
  })).filter((audience) => audience.visibleTo === "lab" || audience.visibleTo.length > 0);
}

type OutboxInput = { id: string; kind: "notebook-event" | "record"; target: "notebook" | "records"; audience: Audience; payload: unknown };

async function enqueue(rows: OutboxInput[]) {
  if (!rows.length) return;
  await db.exploreEventOutbox.createMany({
    data: rows.map((row) => ({ id: row.id.slice(0, 400), kind: row.kind, target: row.target, authority: row.audience.authority, workspaceId: row.audience.workspaceId, payload: row.payload as Prisma.InputJsonValue })),
    skipDuplicates: true,
  });
}

function recordRows(audiences: Audience[], records: Omit<ComputeRecord, "projectId" | "visibleTo">[]): OutboxInput[] {
  return audiences.flatMap((audience) => records.map((record) => ({
    id: `rec:${audience.workspaceId}:${record.ref}@${record.updatedAt}`, kind: "record" as const, target: "records" as const, audience,
    payload: { ...record, projectId: audience.projectId, visibleTo: audience.visibleTo } satisfies ComputeRecord,
  })));
}

/** A payload that fits the server's 8 KB limit: long lists are cut first. */
export function boundedPayload(payload: Record<string, unknown>): Record<string, unknown> {
  let copy = { ...payload };
  for (const key of ["values", "steps"]) {
    while (JSON.stringify(copy).length > 8000 && Array.isArray(copy[key]) && (copy[key] as unknown[]).length) copy = { ...copy, [key]: (copy[key] as unknown[]).slice(0, -1) };
  }
  if (JSON.stringify(copy).length > 8000) copy = { number: copy.number, recipeRevision: copy.recipeRevision };
  return copy;
}

// ---------------------------------------------------------------------------
// What is pushed for flows and runs
// ---------------------------------------------------------------------------

export async function flowRecord(flowId: string, updatedAt = stamp()): Promise<Omit<ComputeRecord, "projectId" | "visibleTo"> | null> {
  const flow = await db.exploreFlow.findUnique({ where: { id: flowId }, select: { id: true, name: true, recipeRevision: true, currentRunId: true, createdAt: true, _count: { select: { analyses: true } } } });
  if (!flow || !SEGMENT.test(flow.id)) return null;
  const steps = flow._count.analyses;
  return {
    ref: `labdesk://flow/${flow.id}`, kind: "flow", title: clip(flow.name || "Flow", 200),
    subtitle: clip(`Recipe rev ${flow.recipeRevision} · ${steps} step${steps === 1 ? "" : "s"}`, 280), state: flow.currentRunId ? "current" : "",
    progress: { done: 0, total: 0, current: "" }, flowRef: "", at: flow.createdAt.getTime(), updatedAt,
    payload: { recipeRevision: flow.recipeRevision, stepCount: steps, currentRunId: flow.currentRunId },
  };
}

/** Push (or refresh) a flow's record: on create, rename, recipe change. */
export async function enqueueFlowRecord(flowId: string): Promise<void> {
  const config = eventsConfig();
  if (!config) return;
  const flow = await db.exploreFlow.findUnique({ where: { id: flowId }, select: { targetKey: true } });
  if (!flow) return;
  const audiences = await audiencesOf(flow.targetKey, config);
  const record = await flowRecord(flowId);
  if (record) await enqueue(recordRows(audiences, [record]));
}

/**
 * Before a flow is deleted: note its runs, and return what hides the flow's
 * and runs' records afterwards (null when nothing is pushed).
 */
export async function prepareFlowRemoval(flowId: string, targetKey: string): Promise<(() => Promise<void>) | null> {
  const config = eventsConfig();
  if (!config) return null;
  const audiences = await audiencesOf(targetKey, config);
  if (!audiences.length) return null;
  const runIds = (await db.exploreFlowRun.findMany({ where: { flowId, kind: { not: "trial" } }, select: { id: true } })).map((run) => run.id);
  return () => enqueueFlowRemoval(flowId, audiences, runIds);
}

/** Hide a deleted flow's records. */
async function enqueueFlowRemoval(flowId: string, audiences: Audience[], runIds: string[]): Promise<void> {
  const refs = [`labdesk://flow/${flowId}`, ...runIds.map((id) => `labdesk://run/${id}`)].filter((ref) => SEGMENT.test(ref.split("/").pop() ?? ""));
  await enqueue(audiences.flatMap((audience) => refs.map((ref) => ({ id: `del:${audience.workspaceId}:${ref}@${stamp()}`, kind: "record" as const, target: "records" as const, audience, payload: { removed: ref } }))));
}

function runTitle(number: number | null, flowName: string): string {
  return clip(`Run #${number ?? "?"} · ${flowName}`, 200);
}

/** Queue what a change of a flow run means for the collaboration server. */
export async function enqueueFlowRunChange(flowRunId: string, change: FlowRunChange): Promise<void> {
  const config = eventsConfig();
  if (!config) return;
  const run = await db.exploreFlowRun.findUnique({ where: { id: flowRunId }, include: { flow: { select: { id: true, name: true, targetKey: true, createdByMemberId: true, headlineValue: true } } } });
  if (!run || run.kind === "trial" || !SEGMENT.test(run.id) || !SEGMENT.test(run.flowId)) return;
  const audiences = await audiencesOf(run.flow.targetKey, config);
  if (!audiences.length) return;
  const summary = await serializeFlowRunById(run.id);
  const plan = planOf(run);
  const ref = `labdesk://run/${run.id}`;
  const flowRef = `labdesk://flow/${run.flowId}`;
  const now = stamp();
  const at = (run.startedAt ?? run.queuedAt).getTime();
  const headline = summary.headline ? `${formatValue(summary.headline.value)} ${summary.headline.label}`.trim() : "";
  const executed = summary.progress.total;
  const current = summary.progress.current;
  const subtitle =
    run.status === "completed" ? [`${plan.length} of ${plan.length} steps`, headline].filter(Boolean).join(" · ")
    : run.status === "failed" ? `Failed at step ${run.failedStepLabel ?? "?"}${run.failureWords ? ` · ${run.failureWords}` : ""}`
    : run.status === "cancelled" ? "Stopped"
    : current ? `Step ${current.label} of ${plan.length} · ${current.name}` : `${summary.progress.done} of ${executed} steps`;
  const stepsPayload = await (async () => {
    const stepRuns = await db.exploreAnalysisRun.findMany({ where: { flowRunId: run.id }, select: { analysisId: true, status: true } });
    return plan.map((entry) => ({ label: entry.label, status: entry.execute ? stepRuns.filter((stepRun) => stepRun.analysisId === entry.analysisId).at(-1)?.status ?? "queued" : entry.reusedFrom ? "reused" : "notRun" }));
  })();
  const values = ((run.summary as { values?: Array<{ label: string; value: unknown; unit: string | null; stepLabel: string; stepId: string; metric: string }> } | null)?.values ?? []);
  const records: Omit<ComputeRecord, "projectId" | "visibleTo">[] = [{
    ref, kind: "run", title: runTitle(run.number, run.flow.name), subtitle: clip(subtitle, 280), state: run.status,
    progress: { done: summary.progress.done, total: executed, current: clip(current?.name ?? "", 120) }, flowRef, at, updatedAt: now,
    payload: boundedPayload({ number: run.number, recipeRevision: run.recipeRevision, startedBy: run.startedByMemberId, headline: summary.headline ? { label: summary.headline.label, value: formatValue(summary.headline.value) } : null,
      values: values.slice(0, 10).map((value) => ({ label: value.label, value: formatValue(value.value), unit: value.unit, stepLabel: value.stepLabel })), steps: stepsPayload,
      failed: summary.failed ? { stepLabel: summary.failed.stepLabel, words: summary.failed.words } : null }),
  }];

  // A run that finished or became current: its values and outputs are the current ones; earlier runs' are superseded.
  if (change === "finished" || change === "current") {
    const flowNow = await db.exploreFlow.findUnique({ where: { id: run.flowId }, select: { currentRunId: true } });
    const isCurrent = flowNow?.currentRunId === run.id;
    records.push(...(await valueAndOutputRecords(run.id, isCurrent ? "current" : "superseded", now)));
    if (isCurrent) {
      const others = await db.exploreFlowRun.findMany({ where: { flowId: run.flowId, status: "completed", kind: { not: "trial" }, id: { not: run.id } }, orderBy: { completedAt: "desc" }, take: 5, select: { id: true } });
      for (const other of others) records.push(...(await valueAndOutputRecords(other.id, "superseded", now)));
      const flow = await flowRecord(run.flowId, now);
      if (flow) records.push(flow);
    }
  }

  const rows = recordRows(audiences, records);
  const kind = change === "started" ? "run.started" : change === "finished" ? "run.finished" : change === "failed" ? "run.failed" : null;
  if (kind) {
    const notify = kind === "run.failed" ? [run.startedByMemberId, run.flow.createdByMemberId] : kind === "run.finished" && run.notifyOnFinish ? [run.startedByMemberId] : [];
    const eventSummary =
      kind === "run.started" ? `Run #${run.number} started · ${executed} of ${plan.length} steps`
      : kind === "run.finished" ? [`Run #${run.number}`, `${plan.length} of ${plan.length} steps`, headline].filter(Boolean).join(" · ")
      : `Run #${run.number} failed at step ${run.failedStepLabel ?? "?"}${run.failureWords ? ` · ${run.failureWords}` : ""}`;
    for (const audience of audiences) {
      const event: NotebookEvent = {
        eventId: `${run.id}:${kind.slice(4)}`, kind, ref, flowRef, summary: clip(eventSummary, 280), severity: kind === "run.failed" ? "failed" : "info",
        at: (run.completedAt ?? run.startedAt ?? run.queuedAt).getTime(), visibleTo: audience.visibleTo,
        notify: [...new Set(notify.filter((member): member is string => Boolean(member && MEMBER.test(member))))].slice(0, 50),
      };
      if (!event.notify?.length) delete event.notify;
      rows.push({ id: `evt:${audience.workspaceId}:${event.eventId}`, kind: "notebook-event", target: "notebook", audience, payload: event });
    }
  }
  await enqueue(rows);
}

async function valueAndOutputRecords(flowRunId: string, state: "current" | "superseded", updatedAt: number): Promise<Omit<ComputeRecord, "projectId" | "visibleTo">[]> {
  const run = await db.exploreFlowRun.findUnique({ where: { id: flowRunId }, include: { flow: { select: { name: true, headlineValue: true } } } });
  if (!run || run.status !== "completed") return [];
  const flowRef = `labdesk://flow/${run.flowId}`;
  const at = (run.completedAt ?? run.queuedAt).getTime();
  const plan = planOf(run);
  const stored = (run.summary as { values?: Array<{ stepId: string; stepLabel: string; metric: string; label: string; unit: string | null; value: unknown }> } | null)?.values;
  const values = stored ?? runValues(plan, new Map(), run.flow.headlineValue).values;
  const records: Omit<ComputeRecord, "projectId" | "visibleTo">[] = [];
  for (const value of values.slice(0, 50)) {
    if (!SEGMENT.test(value.stepId) || !SEGMENT.test(value.metric)) continue;
    records.push({
      ref: `labdesk://value/${run.id}/${value.stepId}/${value.metric}`, kind: "value", title: clip(value.label || value.metric, 200),
      subtitle: clip(`${formatValue(value.value)}${value.unit ? ` ${value.unit}` : ""} · Run #${run.number} step ${value.stepLabel}`, 280), state,
      progress: { done: 0, total: 0, current: "" }, flowRef, at, updatedAt, payload: { value: value.value ?? null, unit: value.unit, stepLabel: value.stepLabel, number: run.number },
    });
  }
  const stepRunIds = await db.exploreAnalysisRun.findMany({ where: { flowRunId: run.id }, select: { id: true, analysisId: true } });
  const reused = plan.filter((entry) => !entry.execute && entry.reusedFrom).map((entry) => ({ id: entry.reusedFrom!.stepRunId, analysisId: entry.analysisId }));
  const byRun = new Map([...stepRunIds, ...reused].map((entry) => [entry.id, entry.analysisId] as const));
  const artifacts = byRun.size ? await db.exploreArtifact.findMany({ where: { runId: { in: [...byRun.keys()] }, kind: { in: ["figure", "table"] } }, select: { id: true, runId: true, kind: true, name: true, format: true }, take: 200 }) : [];
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    // One record per output: the first format of a figure stands for it.
    const key = `${artifact.runId}:${artifact.kind}:${artifact.name}`;
    if (seen.has(key) || !SEGMENT.test(artifact.id)) continue;
    seen.add(key);
    const stepLabel = plan.find((entry) => entry.analysisId === byRun.get(artifact.runId))?.label ?? "?";
    records.push({
      ref: `labdesk://output/${run.id}/${artifact.id}`, kind: "output", title: clip(artifact.name, 200), subtitle: clip(`${artifact.kind === "figure" ? "Figure" : "Table"} · Run #${run.number} step ${stepLabel}`, 280),
      state, progress: { done: 0, total: 0, current: "" }, flowRef, at, updatedAt, payload: { kind: artifact.kind, format: artifact.format, stepLabel, number: run.number },
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export interface DeliveryResult {
  delivered: number;
  retried: number;
  failed: number;
}

type OutboxRow = Prisma.ExploreEventOutboxGetPayload<object>;

/** How long to wait before attempt `attempts + 1`: 2 s doubling, at most 10 minutes. */
export function retryDelayMs(attempts: number): number {
  return Math.min(2000 * 2 ** Math.max(0, attempts), MAX_ATTEMPT_DELAY_MS);
}

/** Deliver what is due. Permanent refusals (400, 403, 404) stop at once; the rest retry until 24 h have passed. */
export async function deliverOutbox(options: { fetch?: typeof fetch; now?: () => number; limit?: number } = {}): Promise<DeliveryResult> {
  const config = eventsConfig();
  const result: DeliveryResult = { delivered: 0, retried: 0, failed: 0 };
  if (!config) return result;
  const now = options.now?.() ?? Date.now();
  const send = options.fetch ?? fetch;
  const due = await db.exploreEventOutbox.findMany({ where: { deliveredAt: null, failedAt: null, nextAttemptAt: { lte: new Date(now) } }, orderBy: { createdAt: "asc" }, take: options.limit ?? 1000 });
  const groups = new Map<string, OutboxRow[]>();
  for (const row of due) {
    if (row.authority !== config.collaborationOrigin) continue;
    const key = `${row.target}\n${row.workspaceId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const rows of groups.values()) {
    for (let index = 0; index < rows.length; index += BATCH) {
      const chunk = rows.slice(index, index + BATCH);
      const target = chunk[0].target;
      const workspaceId = chunk[0].workspaceId;
      let body: unknown;
      if (target === "notebook") body = { workspaceId, events: chunk.map((row) => row.payload) };
      else {
        // The newest version of each record wins; removals travel apart.
        const newest = new Map<string, ComputeRecord>();
        const removed = new Set<string>();
        for (const row of chunk) {
          const payload = row.payload as unknown as ComputeRecord & { removed?: string };
          if (payload.removed) { removed.add(payload.removed); newest.delete(payload.removed); continue; }
          const known = newest.get(payload.ref);
          if (!known || known.updatedAt < payload.updatedAt) newest.set(payload.ref, payload);
          removed.delete(payload.ref);
        }
        body = { workspaceId, records: [...newest.values()], removed: [...removed] };
      }
      const path = target === "notebook" ? "/api/compute/notebook-events" : "/api/compute/records";
      let status = 0;
      let error = "";
      try {
        const response = await send(`${config.collaborationOrigin}${path}`, {
          method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${config.secret}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        status = response.status;
        if (!response.ok) error = `${response.status} ${(await response.text().catch(() => "")).slice(0, 300)}`;
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
      }
      const ids = chunk.map((row) => row.id);
      if (status >= 200 && status < 300) {
        await db.exploreEventOutbox.updateMany({ where: { id: { in: ids } }, data: { deliveredAt: new Date(now), lastError: null } });
        result.delivered += ids.length;
        continue;
      }
      // An older collaboration server without the route answers 404: nothing to retry.
      const permanent = status === 400 || status === 403 || status === 404 || status === 413;
      for (const row of chunk) {
        const expired = now - row.createdAt.getTime() >= GIVE_UP_AFTER_MS;
        await db.exploreEventOutbox.update({ where: { id: row.id }, data: {
          attempts: { increment: 1 }, lastError: error.slice(0, 500) || "failed",
          ...(permanent || expired ? { failedAt: new Date(now) } : { nextAttemptAt: new Date(now + retryDelayMs(row.attempts)) }),
        } });
        if (permanent || expired) result.failed += 1;
        else result.retried += 1;
      }
    }
  }
  return result;
}
