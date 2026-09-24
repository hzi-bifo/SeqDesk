/**
 * The Flow redesign's routes on the Analysis integration API (FLOW-GAPS §3.1):
 * numbered runs of a recipe, the recipe itself, proposals, glosses, values
 * and capsules. `handleExploreRequest` hands every request here first; a
 * route this module does not know answers null and falls through.
 */
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { cancelFlowRun, compareFlowRuns, flowRunOutputs, getFlowRunDetail, listFlowRuns, makeRunCurrent, startFlowRun, type FlowActor, type StartFlowRunInput } from "@/lib/explore/flow-runs";
import { flowError, requestIdOf } from "./flow-contract";
import type { IntegrationSession } from "./identity";

export type Json = (body: unknown, status?: number) => Response;

export interface FlowRouteContext {
  request: NextRequest;
  session: IntegrationSession;
  segments: string[];
  json: Json;
}

export function actorOf(session: IntegrationSession): FlowActor {
  return { userId: session.user.id, memberId: session.integration.memberId || null, name: session.user.name ?? null };
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text().catch(() => "");
  if (!text) return {};
  if (text.length > 2 * 1024 * 1024) throw flowError("invalid_request", "The request is too large.");
  try {
    const body = JSON.parse(text) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return body as Record<string, unknown>;
  } catch {
    throw flowError("invalid_request", "The request body must be a JSON object.");
  }
}

export async function flowFor(session: IntegrationSession, flowId: string, level: "read" | "write") {
  const flow = await db.exploreFlow.findUnique({ where: { id: flowId }, select: { id: true, targetKey: true, name: true } });
  if (!flow) throw flowError("not_found", "Flow not found");
  await requireTargetAccess(session, flow.targetKey, level);
  return flow;
}

export async function flowRunFor(session: IntegrationSession, flowRunId: string, level: "read" | "write") {
  const run = await db.exploreFlowRun.findUnique({ where: { id: flowRunId }, select: { id: true, flowId: true } });
  if (!run) throw flowError("not_found", "Run not found");
  const flow = await flowFor(session, run.flowId, level);
  return { run, flow };
}

function parseScope(raw: unknown): StartFlowRunInput["scope"] {
  if (raw === undefined || raw === null || raw === "all") return "all";
  if (raw === "outOfDate") return "outOfDate";
  if (raw && typeof raw === "object" && Array.isArray((raw as { steps?: unknown }).steps)) {
    const steps = (raw as { steps: unknown[] }).steps;
    if (!steps.length || steps.length > 200 || !steps.every((id) => typeof id === "string" && id.length <= 80)) throw flowError("invalid_request", "scope.steps must list step ids.");
    return { steps: steps as string[] };
  }
  throw flowError("invalid_request", 'scope must be "all", "outOfDate" or {"steps":[…]}.');
}

/** Numbered runs of the recipe (`explore.flow-runs`). */
async function handleRuns({ request, session, segments, json }: FlowRouteContext): Promise<Response | null> {
  const method = request.method;
  const query = request.nextUrl.searchParams;
  const [head, id, sub] = segments;
  if (head === "flows" && sub === "runs" && segments.length === 3) {
    if (method === "GET") {
      await flowFor(session, id, "read");
      return json(await listFlowRuns(id, { trials: query.get("trials") === "0" ? false : undefined }));
    }
    if (method === "POST") {
      await flowFor(session, id, "write");
      const body = await readBody(request);
      if (body.proposalIds !== undefined) throw flowError("invalid_request", "Trial runs of proposals are not supported yet: accept the proposal, then start a trial of that step.");
      const sample = body.sample === undefined ? undefined : Number(body.sample);
      if (sample !== undefined && (!Number.isInteger(sample) || sample < 1 || sample > 50)) throw flowError("invalid_request", "sample must be a whole number from 1 to 50.");
      const run = await startFlowRun(id, {
        scope: parseScope(body.scope),
        trial: body.kind === "trial",
        sample,
        notify: body.notify === true,
        requestId: requestIdOf(body.requestId),
        actor: actorOf(session),
      });
      return json({ run }, 201);
    }
  }
  if (head === "flow-runs") {
    if (segments.length === 2 && id === "compare" && method === "GET") {
      const a = query.get("a") ?? "";
      const b = query.get("b") ?? "";
      if (!a || !b) throw flowError("invalid_request", "Name the two runs to compare with a= and b=.");
      await flowRunFor(session, a, "read");
      await flowRunFor(session, b, "read");
      return json(await compareFlowRuns(a, b, query.get("step")));
    }
    if (segments.length === 2 && method === "GET") {
      await flowRunFor(session, id, "read");
      return json({ run: await getFlowRunDetail(id) });
    }
    if (segments.length === 3 && sub === "cancel" && method === "POST") {
      await flowRunFor(session, id, "write");
      return json({ run: await cancelFlowRun(id) });
    }
    if (segments.length === 3 && sub === "current" && method === "POST") {
      await flowRunFor(session, id, "write");
      return json(await makeRunCurrent(id));
    }
    if (segments.length === 3 && sub === "outputs" && method === "GET") {
      await flowRunFor(session, id, "read");
      return json(await flowRunOutputs(id));
    }
  }
  return null;
}

const FLOW_HEADS = new Set(["flow-runs", "proposals", "glosses", "values", "capsules", "templates"]);
const FLOW_SUBS: Record<string, Set<string>> = {
  flows: new Set(["recipe", "runs", "revisions", "step-options", "steps", "proposals", "values", "lineage", "from-template"]),
  analyses: new Set(["glosses"]),
  artifacts: new Set(["capsule", "plot-source"]),
};

/** Whether a path is one of the Flow routes (their errors always carry a code). */
export function isFlowPath(segments: string[]): boolean {
  const [head, id, sub] = segments;
  if (FLOW_HEADS.has(head)) return true;
  if (head === "flows" && id === "from-template") return true;
  return Boolean(sub && FLOW_SUBS[head]?.has(sub));
}

type Handler = (context: FlowRouteContext) => Promise<Response | null>;
const handlers: Handler[] = [handleRuns];

/** The Flow routes; null when the path is not one of them. */
export async function handleFlowRequest(context: FlowRouteContext): Promise<Response | null> {
  for (const handler of handlers) {
    const response = await handler(context);
    if (response) return response;
  }
  return null;
}
