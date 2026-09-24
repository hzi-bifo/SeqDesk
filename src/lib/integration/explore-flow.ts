/**
 * The Flow redesign's routes on the Analysis integration API (FLOW-GAPS §3.1):
 * numbered runs of a recipe, the recipe itself, proposals, glosses, values
 * and capsules. `handleExploreRequest` hands every request here first; a
 * route this module does not know answers null and falls through.
 */
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireTargetAccess, resolveTargetAccess } from "@/lib/explore/authorization";
import { addStep, applyRecipeOps, listRecipeRevisions, parseRecipeOps, stepOptions, type AddStepInput } from "@/lib/explore/recipe-edit";
import { getRecipeView } from "@/lib/explore/recipe-view";
import { acceptProposal, createProposals, discardProposal, listProposals, patchProposal, pendingProposals } from "@/lib/explore/proposals";
import { flowValues, resolveValues } from "@/lib/explore/values";
import { enqueueFlowRecord } from "./events";
import { acceptGloss, deleteGloss, glossRecord, listGlosses, patchGloss, putGlosses } from "@/lib/explore/glosses";
import { createFlowFromTemplate, listTemplates, serializeTemplate } from "@/lib/explore/templates";
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

/** The integration scope row of a study, for project, visibility and owner. */
export async function scopeInfo(session: IntegrationSession, targetKey: string) {
  const scope = await db.integrationExploreScope.findFirst({ where: { authority: session.integration.authority, workspaceId: session.integration.workspaceId, targetKey }, select: { projectId: true, visibility: true, ownerMemberId: true } });
  return scope ?? null;
}

/** The recipe as the caller may see it. */
export async function recipeFor(session: IntegrationSession, flow: { id: string; targetKey: string }, runId?: string | null) {
  const access = await resolveTargetAccess(session, flow.targetKey);
  return getRecipeView(flow.id, { runId, canEdit: access.level === "write", scope: await scopeInfo(session, flow.targetKey), proposals: await pendingProposals(flow.id) });
}

function parseStepInputs(raw: unknown): AddStepInput["inputs"] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 20) throw flowError("invalid_request", "inputs must be a list.");
  return raw.map((entry) => {
    const input = entry as Record<string, unknown>;
    if (!input || typeof input.alias !== "string") throw flowError("invalid_request", "Each input needs an alias.");
    if (typeof input.datasetId === "string") return { alias: input.alias, datasetId: input.datasetId };
    const from = input.from as Record<string, unknown> | undefined;
    if (from && typeof from.stepId === "string" && typeof from.output === "string") return { alias: input.alias, from: { stepId: from.stepId, output: from.output } };
    throw flowError("invalid_request", "Each input needs a datasetId or from:{stepId,output}.");
  });
}

const optionalText = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

/** The recipe (`explore.recipe`). */
async function handleRecipe({ request, session, segments, json }: FlowRouteContext): Promise<Response | null> {
  const method = request.method;
  const query = request.nextUrl.searchParams;
  const [head, id, sub] = segments;
  if (head === "templates" && segments.length === 1 && method === "GET") {
    return json({ templates: (await listTemplates()).map(serializeTemplate) });
  }
  if (head === "flows" && id === "from-template" && segments.length === 2 && method === "POST") {
    const body = await readBody(request);
    const targetKey = optionalText(body.targetKey, 200);
    if (!targetKey || typeof body.templateId !== "string" || typeof body.datasetId !== "string") throw flowError("invalid_request", "targetKey, templateId and datasetId are required.");
    await requireTargetAccess(session, targetKey, "write");
    const flowId = await createFlowFromTemplate({ targetKey, templateId: body.templateId, name: optionalText(body.name, 200), datasetId: body.datasetId, slots: body.slots, actor: actorOf(session) });
    await flowChanged(flowId);
    const { getFlow } = await import("@/lib/explore/flows");
    return json({ flow: await getFlow(flowId), recipe: await recipeFor(session, { id: flowId, targetKey }) }, 201);
  }
  if (head !== "flows" || segments.length !== 3) return null;
  if (sub === "recipe" && method === "GET") {
    const flow = await flowFor(session, id, "read");
    return json({ recipe: await recipeFor(session, flow, query.get("run")) });
  }
  if (sub === "recipe" && method === "PATCH") {
    const flow = await flowFor(session, id, "write");
    const body = await readBody(request);
    const expected = body.expectedRevision === undefined ? undefined : Number(body.expectedRevision);
    if (expected !== undefined && !Number.isInteger(expected)) throw flowError("invalid_request", "expectedRevision must be a whole number.");
    await applyRecipeOps(flow.id, parseRecipeOps(body.ops), expected, actorOf(session));
    await flowChanged(flow.id);
    return json({ recipe: await recipeFor(session, flow) });
  }
  if (sub === "revisions" && method === "GET") {
    await flowFor(session, id, "read");
    return json({ revisions: await listRecipeRevisions(id) });
  }
  if (sub === "step-options" && method === "GET") {
    await flowFor(session, id, "read");
    return json(await stepOptions(id, { after: query.get("after"), output: query.get("output") }));
  }
  if (sub === "steps" && method === "POST") {
    const flow = await flowFor(session, id, "write");
    const body = await readBody(request);
    const laneKind = body.laneKind === "forEach" ? "forEach" : body.laneKind === "alternative" ? "alternative" : null;
    const code = typeof body.code === "string" ? body.code : null;
    if (code && Buffer.byteLength(code, "utf8") > 512 * 1024) throw flowError("invalid_request", "The code is larger than 512 KB");
    const stepId = await addStep(flow.id, {
      after: optionalText(body.after, 80), laneOf: optionalText(body.laneOf, 80), laneKind, laneLabel: optionalText(body.laneLabel, 80),
      name: optionalText(body.name, 200), purpose: optionalText(body.purpose, 200), kitId: optionalText(body.kitId, 80), code,
      language: body.language === "r" ? "r" : "python", inputs: parseStepInputs(body.inputs),
      params: body.params && typeof body.params === "object" && !Array.isArray(body.params) ? (body.params as Record<string, unknown>) : undefined,
      requestId: requestIdOf(body.requestId), actor: actorOf(session),
    });
    await flowChanged(flow.id);
    const recipe = await recipeFor(session, flow);
    return json({ step: recipe.steps.find((step) => step.id === stepId) ?? null, recipe }, 201);
  }
  return null;
}

async function proposalFor(session: IntegrationSession, id: string, level: "read" | "write") {
  const proposal = await db.exploreStepProposal.findUnique({ where: { id }, select: { id: true, flowId: true } });
  if (!proposal) throw flowError("not_found", "Proposal not found");
  const flow = await flowFor(session, proposal.flowId, level);
  return { proposal, flow };
}

/** Proposals (`explore.proposals`): stored only, SeqDesk never calls a model. */
async function handleProposals({ request, session, segments, json }: FlowRouteContext): Promise<Response | null> {
  const method = request.method;
  const [head, id, sub] = segments;
  if (head === "flows" && sub === "proposals" && segments.length === 3) {
    if (method === "GET") {
      await flowFor(session, id, "read");
      return json({ proposals: await listProposals(id, request.nextUrl.searchParams.get("state") === "all" ? "all" : "pending") });
    }
    if (method === "POST") {
      await flowFor(session, id, "write");
      const body = await readBody(request);
      return json({ proposals: await createProposals(id, { kind: body.kind, goal: body.goal, origin: body.origin, activityId: body.activityId, items: body.items, actor: actorOf(session) }) }, 201);
    }
  }
  if (head !== "proposals") return null;
  if (segments.length === 2 && method === "PATCH") {
    await proposalFor(session, id, "write");
    return json({ proposal: await patchProposal(id, await readBody(request)) });
  }
  if (segments.length === 3 && sub === "accept" && method === "POST") {
    const { flow } = await proposalFor(session, id, "write");
    const body = await readBody(request);
    const expected = body.expectedRevision === undefined ? undefined : Number(body.expectedRevision);
    const edits = body.edits && typeof body.edits === "object" && !Array.isArray(body.edits) ? (body.edits as Record<string, unknown>) : null;
    const result = await acceptProposal(id, edits, Number.isInteger(expected) ? expected : undefined, actorOf(session));
    if (result.proposal.kind === "step") {
      await flowChanged(flow.id);
      const recipe = await recipeFor(session, flow);
      return json({ proposal: result.proposal, step: recipe.steps.find((step) => step.id === result.stepId) ?? null, recipe });
    }
    return json(result);
  }
  if (segments.length === 3 && sub === "discard" && method === "POST") {
    await proposalFor(session, id, "write");
    const body = await readBody(request);
    return json({ proposal: await discardProposal(id, optionalText(body.reason, 500)) });
  }
  return null;
}

async function glossAccess(session: IntegrationSession, id: string, level: "read" | "write") {
  const gloss = await glossRecord(id);
  await requireTargetAccess(session, gloss.analysis.targetKey, level);
  return gloss;
}

/** Glosses, the notes on code regions (`explore.glosses`). */
async function handleGlosses({ request, session, segments, json }: FlowRouteContext): Promise<Response | null> {
  const method = request.method;
  const [head, id, sub] = segments;
  if (head === "analyses" && sub === "glosses" && segments.length === 3) {
    const analysis = await db.exploreAnalysis.findUnique({ where: { id }, select: { targetKey: true } });
    if (!analysis) throw flowError("not_found", "Step not found");
    if (method === "GET") {
      await requireTargetAccess(session, analysis.targetKey, "read");
      return json(await listGlosses(id, request.nextUrl.searchParams.get("revision")));
    }
    if (method === "PUT") {
      await requireTargetAccess(session, analysis.targetKey, "write");
      const body = await readBody(request);
      return json(await putGlosses(id, body.revisionId, body.glosses, actorOf(session)));
    }
  }
  if (head !== "glosses") return null;
  if (segments.length === 2 && method === "PATCH") {
    await glossAccess(session, id, "write");
    return json({ gloss: await patchGloss(id, await readBody(request)) });
  }
  if (segments.length === 2 && method === "DELETE") {
    await glossAccess(session, id, "write");
    await deleteGloss(id);
    return json({ deleted: true });
  }
  if (segments.length === 3 && sub === "accept" && method === "POST") {
    await glossAccess(session, id, "write");
    return json({ gloss: await acceptGloss(id, actorOf(session)) });
  }
  return null;
}

/** Named values of runs (`explore.values`): the feed for Writer placeholders and peeks. */
async function handleValues({ request, session, segments, json }: FlowRouteContext): Promise<Response | null> {
  const method = request.method;
  const query = request.nextUrl.searchParams;
  const [head, id, sub] = segments;
  if (head === "flows" && sub === "values" && segments.length === 3 && method === "GET") {
    await flowFor(session, id, "read");
    return json(await flowValues(id, { run: query.get("run"), planned: query.get("planned") === "1" }));
  }
  if (head === "values" && id === "resolve" && segments.length === 2 && method === "GET") {
    const refs = query.getAll("refs").flatMap((value) => value.split(",")).map((ref) => ref.trim()).filter(Boolean);
    if (!refs.length || refs.length > 100) throw flowError("invalid_request", "Pass 1 to 100 value references in refs.");
    const canRead = async (flow: { targetKey: string }) => (await resolveTargetAccess(session, flow.targetKey)).level !== "none";
    return json(await resolveValues(refs, canRead, { verify: query.get("verify") === "1" }));
  }
  return null;
}

/** Tell the collaboration server about a changed flow; best effort. */
export async function flowChanged(flowId: string): Promise<void> {
  await enqueueFlowRecord(flowId).catch((error) => console.error("[flow] could not queue the flow record", flowId, error));
}

type Handler = (context: FlowRouteContext) => Promise<Response | null>;
const handlers: Handler[] = [handleRecipe, handleRuns, handleProposals, handleGlosses, handleValues];

/** The Flow routes; null when the path is not one of them. */
export async function handleFlowRequest(context: FlowRouteContext): Promise<Response | null> {
  for (const handler of handlers) {
    const response = await handler(context);
    if (response) return response;
  }
  return null;
}
