/**
 * The Flow redesign's routes on the Analysis integration API (FLOW-GAPS §3.1):
 * numbered runs of a recipe, the recipe itself, proposals, glosses, values
 * and capsules. `handleExploreRequest` hands every request here first; a
 * route this module does not know answers null and falls through.
 */
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { canManageExplore, requireTargetAccess, resolveTargetAccess } from "@/lib/explore/authorization";
import { answerQuestion, postTurn, readConversation, updateAssistantTurn, waitForTurns, type ConversationActor } from "@/lib/explore/conversation";
import { addStep, applyRecipeOps, listRecipeRevisions, parseRecipeOps, stepOptions, type AddStepInput } from "@/lib/explore/recipe-edit";
import { getRecipeView } from "@/lib/explore/recipe-view";
import { parseMethodsDraft, saveMethodsDraft } from "@/lib/explore/methods-draft";
import { acceptProposal, createProposals, discardProposal, listProposals, patchProposal, pendingProposals } from "@/lib/explore/proposals";
import { flowValues, resolveValues } from "@/lib/explore/values";
import { outputLineage, plotSource, requestCapsule, serializeCapsule } from "@/lib/explore/capsules";
import { NextResponse } from "next/server";
import { createReadStream } from "fs";
import fs from "fs/promises";
import { Readable } from "stream";
import { enqueueFlowRecord } from "./events";
import { acceptGloss, deleteGloss, glossRecord, listGlosses, patchGloss, putGlosses } from "@/lib/explore/glosses";
import { checkTemplateInputs, createFlowFromTemplate, listTemplates, serializeTemplate } from "@/lib/explore/templates";
import { attachFlowInput, listFlowInputs } from "@/lib/explore/flow-inputs";
import { addHold, listHolds, removeHold, cancelFlowRun, compareFlowRuns, flowRunOutputs, getFlowRunDetail, listFlowRuns, makeRunCurrent, startFlowRun, type FlowActor, type StartFlowRunInput } from "@/lib/explore/flow-runs";
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
    if (segments.length === 3 && sub === "holds") {
      if (method === "GET") {
        await flowRunFor(session, id, "read");
        return json({ holds: await listHolds(id) });
      }
      // Reported by the web client: a person marked the run or its values, or a document cites them.
      if (method === "POST") {
        await flowRunFor(session, id, "read");
        const body = await readBody(request);
        return json({ holds: await addHold(id, body.kind, body.key, actorOf(session)) });
      }
      if (method === "DELETE") {
        await flowRunFor(session, id, "read");
        return json({ holds: await removeHold(id, query.get("kind"), query.get("key")) });
      }
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
  flows: new Set(["recipe", "runs", "revisions", "step-options", "steps", "proposals", "values", "lineage", "from-template", "conversation", "inputs"]),
  analyses: new Set(["glosses", "methods-draft"]),
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
  if (head === "templates" && id === "check" && segments.length === 2 && method === "POST") {
    const body = await readBody(request);
    const targetKey = optionalText(body.targetKey, 200);
    if (!targetKey || typeof body.templateId !== "string") throw flowError("invalid_request", "targetKey and templateId are required.");
    await requireTargetAccess(session, targetKey, "read");
    const checked = await checkTemplateInputs({ targetKey, templateId: body.templateId, datasets: body.datasets, columns: body.columns });
    return json({ inputs: checked.inputs, columns: checked.columns });
  }
  if (head === "flows" && id === "from-template" && segments.length === 2 && method === "POST") {
    const body = await readBody(request);
    const targetKey = optionalText(body.targetKey, 200);
    if (!targetKey || typeof body.templateId !== "string" || (typeof body.datasetId !== "string" && (!body.datasets || typeof body.datasets !== "object"))) throw flowError("invalid_request", "targetKey, templateId and datasetId (or datasets) are required.");
    await requireTargetAccess(session, targetKey, "write");
    // "Start from a template with this table" fills the blank analysis the table was added to.
    const into = typeof body.intoFlowId === "string" && body.intoFlowId ? await flowFor(session, body.intoFlowId, "write") : null;
    if (into && into.targetKey !== targetKey) throw flowError("invalid_request", "Choose an analysis of this study.");
    const flowId = await createFlowFromTemplate({ targetKey, templateId: body.templateId, name: optionalText(body.name, 200), datasetId: typeof body.datasetId === "string" ? body.datasetId : null, datasets: body.datasets, columns: body.columns, intoFlowId: into?.id ?? null, slots: body.slots, actor: actorOf(session) });
    await flowChanged(flowId);
    const { getFlow } = await import("@/lib/explore/flows");
    return json({ flow: await getFlow(flowId), recipe: await recipeFor(session, { id: flowId, targetKey }) }, 201);
  }
  if (head !== "flows" || segments.length !== 3) return null;
  if (sub === "inputs" && method === "GET") {
    const flow = await flowFor(session, id, "read");
    return json({ inputs: await listFlowInputs(flow.id, flow.targetKey) });
  }
  if (sub === "inputs" && method === "POST") {
    const flow = await flowFor(session, id, "write");
    const body = await readBody(request);
    if (typeof body.datasetId !== "string") throw flowError("invalid_request", "datasetId is required: a step reads only tables in Data.");
    await attachFlowInput({ flowId: flow.id, targetKey: flow.targetKey, key: optionalText(body.key, 40), label: optionalText(body.label, 80), datasetId: body.datasetId, actor: actorOf(session) });
    await flowChanged(flow.id);
    return json({ inputs: await listFlowInputs(flow.id, flow.targetKey), recipe: await recipeFor(session, flow) });
  }
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
    return json(await stepOptions(id, { after: query.get("after"), output: query.get("output"), dataset: query.get("dataset") }));
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
      return json({ proposals: await createProposals(id, { kind: body.kind, goal: body.goal, origin: body.origin, activityId: body.activityId, items: body.items, proposedByTurnId: body.proposedByTurnId, actor: actorOf(session) }) }, 201);
    }
  }
  // A methods sentence the assistant drafted for a step, kept in pencil (accepted through proposals/:id/accept).
  if (head === "analyses" && sub === "methods-draft" && segments.length === 3 && method === "POST") {
    const analysis = await db.exploreAnalysis.findUnique({ where: { id }, select: { flowId: true } });
    if (!analysis?.flowId) throw flowError("not_found", "Step not found");
    await flowFor(session, analysis.flowId, "write");
    return json({ proposal: await saveMethodsDraft(id, parseMethodsDraft(await readBody(request)), actorOf(session)) }, 201);
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

async function artifactFor(session: IntegrationSession, id: string, level: "read" | "write") {
  const artifact = await db.exploreArtifact.findUnique({ where: { id }, select: { id: true, run: { select: { analysis: { select: { targetKey: true } } } } } });
  if (!artifact) throw flowError("not_found", "Output not found");
  await requireTargetAccess(session, artifact.run.analysis.targetKey, level);
  return artifact;
}

/** Lineage, capsules and plot source (`explore.capsules`). */
async function handleCapsules({ request, session, segments, json }: FlowRouteContext): Promise<Response | null> {
  const method = request.method;
  const query = request.nextUrl.searchParams;
  const [head, id, sub] = segments;
  if (head === "flows" && sub === "lineage" && segments.length === 3 && method === "GET") {
    await flowFor(session, id, "read");
    const artifactId = query.get("artifact");
    if (!artifactId) throw flowError("invalid_request", "Name the output with artifact=.");
    await artifactFor(session, artifactId, "read");
    return json(await outputLineage(id, artifactId, query.get("run")));
  }
  if (head === "artifacts" && segments.length === 3 && sub === "capsule" && method === "POST") {
    await artifactFor(session, id, "read");
    const body = await readBody(request);
    const result = await requestCapsule(id, session.user.id, optionalText(body.flowRunId, 80));
    return json({ capsule: result.capsule }, result.created ? 202 : 200);
  }
  if (head === "artifacts" && segments.length === 3 && sub === "plot-source" && method === "GET") {
    await artifactFor(session, id, "read");
    return json(await plotSource(id));
  }
  if (head === "capsules" && (segments.length === 2 || (segments.length === 3 && sub === "download")) && method === "GET") {
    const capsule = await db.exploreCapsule.findUnique({ where: { id } });
    if (!capsule) throw flowError("not_found", "Capsule not found");
    const run = await db.exploreFlowRun.findUnique({ where: { id: capsule.flowRunId }, select: { flowId: true } });
    if (!run) throw flowError("not_found", "Capsule not found");
    await flowFor(session, run.flowId, "read");
    if (segments.length === 2) return json({ capsule: serializeCapsule(capsule) });
    if (capsule.status !== "ready" || !capsule.path) throw flowError("not_found", "The capsule is not ready.");
    const stat = await fs.stat(capsule.path).catch(() => null);
    if (!stat?.isFile()) throw flowError("not_found", "The capsule file is gone. Request it again.");
    const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin", "Content-Type": "application/zip", "Content-Length": String(stat.size), "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="capsule-${capsule.id}.zip"` });
    const origin = request.headers.get("origin");
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    return new NextResponse(Readable.toWeb(createReadStream(capsule.path)) as ReadableStream, { headers });
  }
  return null;
}

function conversationActor(session: IntegrationSession): ConversationActor {
  return { ...actorOf(session), admin: canManageExplore(session) };
}

const whole = (value: string | null): number | null => (value !== null && /^\d{1,9}$/.test(value) ? Number(value) : null);

/** The flow's shared conversation (`explore.flow-conversation`); access follows the flow. */
async function handleConversation({ request, session, segments, json }: FlowRouteContext): Promise<Response | null> {
  const [head, id, sub, part, partId, action] = segments;
  if (head !== "flows" || sub !== "conversation") return null;
  const method = request.method;
  const query = request.nextUrl.searchParams;
  if (segments.length === 3 && method === "GET") {
    await flowFor(session, id, "read");
    const after = whole(query.get("after"));
    const wait = whole(query.get("wait"));
    // Long-poll: with after= and wait=<seconds>, answer as soon as a newer turn exists.
    if (after !== null && wait) await waitForTurns(id, after, wait * 1000, request.signal);
    return json(await readConversation(id, { before: whole(query.get("before")), after, limit: whole(query.get("limit")) ?? undefined, stepId: query.get("stepId") }));
  }
  if ((segments.length === 3 || (segments.length === 4 && part === "turns")) && method === "POST") {
    await flowFor(session, id, "read");
    return json(await postTurn(id, await readBody(request), conversationActor(session)), 201);
  }
  if (segments.length === 5 && part === "turns" && method === "PATCH") {
    await flowFor(session, id, "read");
    return json({ turn: await updateAssistantTurn(id, partId, await readBody(request), conversationActor(session)) });
  }
  if (segments.length === 6 && part === "questions" && action === "answer" && method === "POST") {
    await flowFor(session, id, "read");
    return json(await answerQuestion(id, partId, await readBody(request), conversationActor(session)), 201);
  }
  return null;
}

type Handler = (context: FlowRouteContext) => Promise<Response | null>;
const handlers: Handler[] = [handleConversation, handleRecipe, handleRuns, handleProposals, handleGlosses, handleValues, handleCapsules];

/** The Flow routes; null when the path is not one of them. */
export async function handleFlowRequest(context: FlowRouteContext): Promise<Response | null> {
  for (const handler of handlers) {
    const response = await handler(context);
    if (response) return response;
  }
  return null;
}
