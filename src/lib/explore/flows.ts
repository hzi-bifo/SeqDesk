import { db } from "@/lib/db";
import { deleteFlowWithOutputs } from "./housekeeping";
import { ExploreReportError } from "./reports";

/** A flow as its list shows it: what is on the canvas and what it produced last. */
export interface FlowSummary {
  id: string;
  targetKey: string;
  name: string;
  description: string | null;
  stepCount: number;
  /** The newest run of any step, for the status line. */
  latestRun: { runNumber: string; status: string; completedAt: string | null } | null;
  /** Counts of the outputs the steps' latest finished runs produced. */
  outputs: { figures: number; tables: number; findings: number; metrics: number };
  /** The recipe (Flow redesign): its revision, the run shown as current, the newest numbered run and the headline value. */
  recipeRevision: number;
  currentRunId: string | null;
  latestFlowRun: { id: string; number: number | null; status: string; completedAt: string | null } | null;
  headlineValue: string | null;
  createdAt: string;
  updatedAt: string;
}

const ACTIVE = new Set(["pending", "queued", "running"]);
const DEFAULT_NAME = "Flow";

type ResultsSummary = { figures?: unknown; tables?: unknown; reports?: unknown; notes?: unknown[]; metrics?: Record<string, unknown> };
/** Run results record outputs as counts (newer runs) or lists (older ones). */
const countOf = (value: unknown): number => typeof value === "number" ? value : Array.isArray(value) ? value.length : 0;
function parseResults(raw: string | null | undefined): ResultsSummary {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as ResultsSummary) : {};
  } catch {
    return {};
  }
}

const flowInclude = {
  analyses: {
    select: {
      id: true,
      runs: { orderBy: { createdAt: "desc" as const }, take: 6, select: { runNumber: true, status: true, completedAt: true, createdAt: true, results: true } },
    },
  },
  runs: { where: { kind: { not: "trial" } }, orderBy: { createdAt: "desc" as const }, take: 1, select: { id: true, number: true, status: true, completedAt: true } },
};
type FlowRecord = { id: string; targetKey: string; name: string; description: string | null; createdAt: Date; updatedAt: Date;
  recipeRevision?: number; currentRunId?: string | null; headlineValue?: string | null;
  runs?: { id: string; number: number | null; status: string; completedAt: Date | null }[]; analyses: { id: string; runs: { runNumber: string; status: string; completedAt: Date | null; createdAt: Date; results: string | null }[] }[] };

function summarize(flow: FlowRecord): FlowSummary {
  // The status line shows a running step if there is one, otherwise the newest run.
  const newest = flow.analyses.flatMap((analysis) => analysis.runs.slice(0, 1)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latest = newest.find((run) => ACTIVE.has(run.status)) ?? newest[0] ?? null;
  const outputs = { figures: 0, tables: 0, findings: 0, metrics: 0 };
  for (const analysis of flow.analyses) {
    const finished = analysis.runs.find((run) => run.status === "completed");
    if (!finished) continue;
    const results = parseResults(finished.results);
    outputs.figures += countOf(results.figures);
    outputs.tables += countOf(results.tables);
    outputs.findings += countOf(results.reports) + (Array.isArray(results.notes) && results.notes.length ? 1 : 0);
    outputs.metrics += results.metrics && typeof results.metrics === "object" ? Object.keys(results.metrics).length : 0;
  }
  return {
    id: flow.id,
    targetKey: flow.targetKey,
    name: flow.name,
    description: flow.description,
    stepCount: flow.analyses.length,
    latestRun: latest ? { runNumber: latest.runNumber, status: latest.status, completedAt: latest.completedAt?.toISOString() ?? null } : null,
    outputs,
    recipeRevision: flow.recipeRevision ?? 0,
    currentRunId: flow.currentRunId ?? null,
    latestFlowRun: flow.runs?.[0] ? { id: flow.runs[0].id, number: flow.runs[0].number, status: flow.runs[0].status, completedAt: flow.runs[0].completedAt?.toISOString() ?? null } : null,
    headlineValue: flow.headlineValue ?? null,
    createdAt: flow.createdAt.toISOString(),
    updatedAt: flow.updatedAt.toISOString(),
  };
}

export async function listFlows(targetKey: string): Promise<FlowSummary[]> {
  const flows = await db.exploreFlow.findMany({ where: { targetKey }, include: flowInclude, orderBy: { createdAt: "asc" } });
  return flows.map(summarize);
}

export async function getFlowRecord(id: string): Promise<{ id: string; targetKey: string; name: string } | null> {
  return db.exploreFlow.findUnique({ where: { id }, select: { id: true, targetKey: true, name: true } });
}

export async function getFlow(id: string): Promise<FlowSummary> {
  const flow = await db.exploreFlow.findUnique({ where: { id }, include: flowInclude });
  if (!flow) throw new ExploreReportError(404, "Flow not found");
  return summarize(flow);
}

/** Create a flow; without a name it is numbered after the flows the scope already has. */
export async function createFlow(targetKey: string, userId: string, name?: string | null, description?: string | null, memberId?: string | null, id?: string): Promise<FlowSummary> {
  let title = name?.trim().slice(0, 200) ?? "";
  if (!title) {
    const count = await db.exploreFlow.count({ where: { targetKey } });
    title = count ? `${DEFAULT_NAME} ${count + 1}` : DEFAULT_NAME;
  }
  const flow = await db.exploreFlow.create({ data: { ...(id ? { id } : {}), targetKey, name: title, description: description?.trim().slice(0, 2000) || null, createdById: userId, createdByMemberId: memberId ?? null }, include: flowInclude });
  return summarize(flow);
}

export async function updateFlow(id: string, changes: { name?: string; description?: string | null }): Promise<FlowSummary> {
  const data: { name?: string; description?: string | null } = {};
  if (changes.name !== undefined) {
    const name = changes.name.trim().slice(0, 200);
    if (!name) throw new ExploreReportError(400, "A flow needs a name");
    data.name = name;
  }
  if (changes.description !== undefined) data.description = changes.description?.trim().slice(0, 2000) || null;
  const existing = await db.exploreFlow.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new ExploreReportError(404, "Flow not found");
  const flow = await db.exploreFlow.update({ where: { id }, data, include: flowInclude });
  return summarize(flow);
}

/** Delete a flow with its steps and their runs. Tables the steps wrote stay in the scope; reports that cite the steps show them as gone. */
export async function deleteFlow(id: string): Promise<void> {
  const existing = await db.exploreFlow.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new ExploreReportError(404, "Flow not found");
  // Inputs, steps, runs, output tables and their files go too (housekeeping.ts); refused while cited.
  await deleteFlowWithOutputs(id);
}
