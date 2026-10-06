/**
 * What the assistant proposed for a flow, in pencil until a person accepts or
 * discards it (FLOW-GAPS A5, D12). The web client calls the model; SeqDesk
 * only keeps the proposals.
 */
import type { Prisma } from "@prisma/client";
import { Prisma as PrismaRuntime } from "@prisma/client";
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { addStep, type AddStepInput } from "./recipe-edit";
import { loadRecipe, type RecipeActor } from "./recipe";
import { keyBetween, sortSteps } from "./recipe-order";
import { acceptedMethodsSentence, methodsAcceptedBy } from "./methods-draft";
import { proposalStepInputs } from "./proposal-inputs";
import { analysisLanguageOf } from "./analyses";

type ProposalRecord = Prisma.ExploreStepProposalGetPayload<object>;

export function serializeProposal(proposal: ProposalRecord) {
  return {
    id: proposal.id, flowId: proposal.flowId, kind: proposal.kind, state: proposal.state,
    afterStepId: proposal.afterAnalysisId, laneOf: proposal.laneOf, position: proposal.position, canvas: proposal.canvas,
    purpose: proposal.purpose, why: proposal.why, assumes: proposal.assumes, notChecked: proposal.notChecked, refusals: proposal.refusals,
    inputs: proposal.inputs, outputs: proposal.outputs, code: proposal.code, language: proposal.language, kitId: proposal.kitId, params: proposal.params,
    values: proposal.values, text: proposal.text, analysisId: proposal.analysisId, glossId: proposal.glossId, flowRunId: proposal.flowRunId,
    goal: proposal.goal, origin: proposal.origin, requestedBy: { userId: proposal.requestedById, memberId: proposal.requestedByMemberId },
    activityId: proposal.activityId, acceptedById: proposal.acceptedById, acceptedAnalysisId: proposal.acceptedAnalysisId, acceptedFindingId: proposal.acceptedFindingId,
    discardReason: proposal.discardReason, proposedByTurnId: proposal.proposedByTurnId, revision: proposal.revision, revisedByTurnId: proposal.revisedByTurnId,
    history: proposal.history, createdAt: proposal.createdAt.toISOString(), updatedAt: proposal.updatedAt.toISOString(),
  };
}

export type Proposal = ReturnType<typeof serializeProposal>;

export async function pendingProposals(flowId: string): Promise<Proposal[]> {
  const proposals = await db.exploreStepProposal.findMany({ where: { flowId, state: "pending" }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], take: 200 });
  return proposals.map(serializeProposal);
}

// ---------------------------------------------------------------------------
// Storing, editing, accepting and discarding proposals
// ---------------------------------------------------------------------------


export const PROPOSAL_KINDS = ["step", "finding", "gloss-rewrite", "methods"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

const MAX_JSON = 20000;
const MAX_CODE = 512 * 1024;

function jsonField(value: unknown, field: string, fallback: unknown): Prisma.InputJsonValue {
  const chosen = value === undefined ? fallback : value;
  const text = JSON.stringify(chosen ?? null);
  if (text.length > MAX_JSON) throw flowError("invalid_request", `${field} is too large.`);
  return chosen as Prisma.InputJsonValue;
}

function listField(value: unknown, field: string): Prisma.InputJsonValue {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw flowError("invalid_request", `${field} must be a list.`);
  return jsonField(value, field, []);
}

const short = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

/** The fields of a proposal item, validated; shared by create and patch. */
function proposalFields(item: Record<string, unknown>, partial: boolean): Prisma.ExploreStepProposalUncheckedUpdateInput {
  const data: Prisma.ExploreStepProposalUncheckedUpdateInput = {};
  const has = (key: string) => !partial || key in item;
  if (has("purpose")) data.purpose = short(item.purpose, 200) ?? "";
  if (has("why")) data.why = short(item.why, 1000) ?? "";
  if (has("assumes")) data.assumes = listField(item.assumes, "assumes");
  if (has("notChecked")) data.notChecked = listField(item.notChecked, "notChecked");
  if (has("refusals")) data.refusals = listField(item.refusals, "refusals");
  if (has("inputs")) data.inputs = listField(item.inputs, "inputs");
  if (has("outputs")) data.outputs = listField(item.outputs, "outputs");
  if (has("code")) {
    if (item.code !== undefined && item.code !== null && typeof item.code !== "string") throw flowError("invalid_request", "code must be text.");
    if (typeof item.code === "string" && Buffer.byteLength(item.code, "utf8") > MAX_CODE) throw flowError("invalid_request", "The code is larger than 512 KB");
    data.code = (item.code as string | null | undefined) ?? null;
  }
  if (has("language") && item.language !== undefined) data.language = analysisLanguageOf(item.language);
  if (has("kitId")) data.kitId = short(item.kitId, 80);
  if (has("params")) data.params = item.params === undefined || item.params === null ? PrismaRuntime.DbNull : jsonField(item.params, "params", {});
  if (has("values")) data.values = item.values === undefined || item.values === null ? PrismaRuntime.DbNull : jsonField(item.values, "values", []);
  if (has("text")) data.text = short(item.text, 4000);
  if (has("canvas")) {
    const canvas = item.canvas as { x?: unknown; y?: unknown } | null | undefined;
    if (canvas && (typeof canvas.x !== "number" || typeof canvas.y !== "number")) throw flowError("invalid_request", "canvas needs numbers x and y.");
    data.canvas = canvas ? { x: canvas.x as number, y: canvas.y as number } : PrismaRuntime.DbNull;
  }
  if (has("laneOf")) data.laneOf = short(item.laneOf, 80);
  return data;
}

export interface CreateProposalsInput {
  kind: unknown;
  goal?: unknown;
  origin?: unknown;
  activityId?: unknown;
  items: unknown;
  /** The conversation turn that proposed these (a `proposal` turn of this flow). */
  proposedByTurnId?: unknown;
  actor: RecipeActor;
}

export async function createProposals(flowId: string, input: CreateProposalsInput): Promise<Proposal[]> {
  if (!PROPOSAL_KINDS.includes(input.kind as ProposalKind)) throw flowError("invalid_request", 'kind must be "step", "finding", "gloss-rewrite" or "methods".');
  const kind = input.kind as ProposalKind;
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 20) throw flowError("invalid_request", "items must list 1 to 20 proposals.");
  const model = await loadRecipe(flowId);
  if (!model) throw flowError("not_found", "Flow not found");
  const stepIds = new Set(model.steps.map((step) => step.id));
  const origin = input.origin === undefined || input.origin === null ? null : input.origin as { kind?: unknown; ref?: unknown };
  if (origin && (!["goal", "placeholder", "output"].includes(String(origin.kind)) || typeof origin.ref !== "string" || origin.ref.length > 500)) throw flowError("invalid_request", 'origin must be {kind:"goal"|"placeholder"|"output", ref}.');
  const proposedByTurnId = short(input.proposedByTurnId, 80);
  if (proposedByTurnId) {
    const turn = await db.exploreFlowTurn.findUnique({ where: { id: proposedByTurnId }, select: { flowId: true } });
    if (!turn || turn.flowId !== flowId) throw flowError("invalid_request", "proposedByTurnId must be a turn of this flow's conversation.");
  }
  const ordered = sortSteps(model.steps);
  let previousKey: string | null = null;
  const rows: Prisma.ExploreStepProposalUncheckedCreateInput[] = [];
  for (const raw of input.items as unknown[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw flowError("invalid_request", "Each item must be an object.");
    const item = raw as Record<string, unknown>;
    const after = short(item.afterStepId, 80);
    if (after && !stepIds.has(after)) throw flowError("invalid_request", "afterStepId must name a step of this flow.");
    const laneOf = short(item.laneOf, 80);
    if (laneOf && !stepIds.has(laneOf)) throw flowError("invalid_request", "laneOf must name a step of this flow.");
    const analysisId = short(item.analysisId, 80);
    const glossId = short(item.glossId, 80);
    const flowRunId = short(item.flowRunId, 80);
    if (kind === "methods" && (!analysisId || !stepIds.has(analysisId))) throw flowError("invalid_request", "A methods proposal needs analysisId, a step of this flow.");
    if (kind === "gloss-rewrite") {
      const gloss = glossId ? await db.exploreGloss.findUnique({ where: { id: glossId }, select: { analysisId: true } }) : null;
      if (!gloss || !stepIds.has(gloss.analysisId)) throw flowError("invalid_request", "A gloss rewrite needs glossId, a gloss of a step of this flow.");
    }
    if (kind === "finding") {
      const run = flowRunId ? await db.exploreFlowRun.findUnique({ where: { id: flowRunId }, select: { flowId: true } }) : null;
      if (!run || run.flowId !== flowId) throw flowError("invalid_request", "A finding needs flowRunId, a run of this flow.");
    }
    if (kind === "step" && !item.code && !item.kitId) throw flowError("invalid_request", "A step proposal needs code or a kitId.");
    // Pencil steps sit where they were proposed: after a step, or after the previous item of the same goal.
    let position = "";
    if (kind === "step") {
      const anchor = after ? ordered.findIndex((step) => step.id === after) : ordered.length - 1;
      const low = previousKey ?? (anchor >= 0 ? ordered[anchor].position : "");
      const next = previousKey ? null : ordered[anchor + 1]?.position ?? null;
      position = keyBetween(low, next && next > low ? next : null);
      previousKey = position;
    }
    rows.push({
      ...(proposalFields(item, false) as Omit<Prisma.ExploreStepProposalUncheckedCreateInput, "flowId" | "kind" | "requestedById">),
      flowId, kind, state: "pending", afterAnalysisId: after, laneOf, position,
      analysisId: kind === "methods" ? analysisId : kind === "gloss-rewrite" ? (await db.exploreGloss.findUnique({ where: { id: glossId! }, select: { analysisId: true } }))!.analysisId : analysisId,
      glossId, flowRunId, goal: short(input.goal, 2000), origin: origin ? (origin as Prisma.InputJsonValue) : undefined,
      requestedById: input.actor.userId, requestedByMemberId: input.actor.memberId ?? null, activityId: short(input.activityId, 128), proposedByTurnId,
    });
  }
  const created = await db.$transaction(rows.map((data) => db.exploreStepProposal.create({ data })));
  return created.map(serializeProposal);
}

export async function listProposals(flowId: string, state: "pending" | "all"): Promise<Proposal[]> {
  const proposals = await db.exploreStepProposal.findMany({ where: { flowId, ...(state === "pending" ? { state: "pending" } : {}) }, orderBy: [{ createdAt: "desc" }], take: 500 });
  return proposals.map(serializeProposal);
}

async function pendingOrThrow(id: string) {
  const proposal = await db.exploreStepProposal.findUnique({ where: { id } });
  if (!proposal) throw flowError("not_found", "Proposal not found");
  if (proposal.state !== "pending") throw flowError("proposal_settled", `This proposal was already ${proposal.state}.`, { state: proposal.state });
  return proposal;
}

export async function patchProposal(id: string, body: Record<string, unknown>): Promise<Proposal> {
  const proposal = await pendingOrThrow(id);
  const data = proposalFields(body, true);
  // A revision after an answer in the conversation: number it, link the turn, keep what it said before.
  const revisedByTurnId = short(body.revisedByTurnId, 80);
  if (revisedByTurnId) {
    const turn = await db.exploreFlowTurn.findUnique({ where: { id: revisedByTurnId }, select: { flowId: true } });
    if (!turn || turn.flowId !== proposal.flowId) throw flowError("invalid_request", "revisedByTurnId must be a turn of this flow's conversation.");
    const history = Array.isArray(proposal.history) ? proposal.history : [];
    data.history = [...history, { revision: proposal.revision, assumes: proposal.assumes, why: proposal.why, purpose: proposal.purpose, revisedByTurnId: proposal.revisedByTurnId, at: proposal.updatedAt.toISOString() }].slice(-50) as Prisma.InputJsonValue;
    data.revision = proposal.revision + 1;
    data.revisedByTurnId = revisedByTurnId;
  }
  if ("afterStepId" in body) {
    const after = short(body.afterStepId, 80);
    const model = await loadRecipe(proposal.flowId);
    const ordered = sortSteps(model?.steps ?? []);
    const index = after ? ordered.findIndex((step) => step.id === after) : -1;
    if (after && index < 0) throw flowError("invalid_request", "afterStepId must name a step of this flow.");
    data.afterAnalysisId = after;
    data.position = keyBetween(index >= 0 ? ordered[index].position : "", ordered[index + 1]?.position ?? null);
  }
  if (!Object.keys(data).length) return serializeProposal(proposal);
  const updated = await db.exploreStepProposal.updateMany({ where: { id, state: "pending" }, data: data as Prisma.ExploreStepProposalUncheckedUpdateManyInput });
  if (!updated.count) throw flowError("proposal_settled", "This proposal was settled meanwhile.", { state: "unknown" });
  return serializeProposal((await db.exploreStepProposal.findUnique({ where: { id } }))!);
}

export async function discardProposal(id: string, reason: string | null): Promise<Proposal> {
  await pendingOrThrow(id);
  const updated = await db.exploreStepProposal.updateMany({ where: { id, state: "pending" }, data: { state: "discarded", discardReason: reason?.slice(0, 500) ?? null } });
  if (!updated.count) throw flowError("proposal_settled", "This proposal was settled meanwhile.", { state: "unknown" });
  return serializeProposal((await db.exploreStepProposal.findUnique({ where: { id } }))!);
}

/** Proposal inputs as step inputs (proposal-inputs.ts): typed references pass through, names the assistant used are
 *  resolved against the study's tables and the flow's other pencil steps; one reading another needs it accepted first. */
async function stepInputsOf(raw: Prisma.JsonValue, proposal: { id: string; flowId: string; goal: string | null }): Promise<AddStepInput["inputs"]> {
  const model = await loadRecipe(proposal.flowId);
  const others = await db.exploreStepProposal.findMany({
    where: { flowId: proposal.flowId, kind: "step", id: { not: proposal.id }, state: { in: ["pending", "accepted"] } },
    select: { id: true, purpose: true, state: true, acceptedAnalysisId: true, outputs: true, goal: true }, orderBy: { createdAt: "desc" }, take: 200,
  });
  const siblings = [...others.filter((other) => other.goal === proposal.goal), ...others.filter((other) => other.goal !== proposal.goal)];
  // Named Data inputs (flow-inputs.ts reads this table the same way).
  const flowInputs = await db.$queryRaw<Array<{ datasetId: string | null }>>`SELECT "datasetId" FROM "ExploreFlowInput" WHERE "flowId" = ${proposal.flowId}`.catch(() => []);
  const flowDatasetIds = new Set([...(model?.steps.flatMap((step) => step.bindings.map((binding) => binding.datasetId)) ?? []), ...flowInputs.map((input) => input.datasetId).filter((id): id is string => !!id)]);
  return proposalStepInputs(raw, { datasets: model ? [...model.datasets.values()] : [], stepIds: new Set(model?.steps.map((step) => step.id) ?? []), flowDatasetIds, siblings });
}

export async function acceptProposal(id: string, edits: Record<string, unknown> | null, expectedRevision: number | undefined, actor: RecipeActor) {
  const proposal = await pendingOrThrow(id);
  // A change asked for by a sentence on a step someone else checked waits for that person (sheet 94).
  if (proposal.kind === "step-change") (await import("./sentence-change")).assertMayAccept(proposal, actor);
  if (edits && Object.keys(edits).length) await patchProposal(id, edits);
  const current = (await db.exploreStepProposal.findUnique({ where: { id } }))!;
  if (expectedRevision !== undefined) {
    const flow = await db.exploreFlow.findUnique({ where: { id: proposal.flowId }, select: { recipeRevision: true } });
    if (flow && flow.recipeRevision !== expectedRevision) throw flowError("revision_conflict", "The recipe changed since the proposal was shown.", { current: { recipeRevision: flow.recipeRevision } });
  }
  // Claim it first, so two people accepting at once cannot both succeed.
  const claimed = await db.exploreStepProposal.updateMany({ where: { id, state: "pending" }, data: { state: "accepted", acceptedById: actor.userId } });
  if (!claimed.count) throw flowError("proposal_settled", "This proposal was settled meanwhile.", { state: "unknown" });
  try {
    if (current.kind === "step") {
      const stepId = await addStep(current.flowId, {
        after: current.laneOf ? null : current.afterAnalysisId, laneOf: current.laneOf, laneKind: current.laneOf ? "alternative" : null,
        name: short(edits?.name, 200) ?? (current.purpose || "Proposed step"), purpose: current.purpose || null,
        kitId: current.kitId, code: current.code, language: analysisLanguageOf(current.language),
        inputs: await stepInputsOf(current.inputs, current), params: (current.params as Record<string, unknown> | null) ?? undefined, actor,
      });
      await db.exploreStepProposal.update({ where: { id }, data: { acceptedAnalysisId: stepId } });
      // "Why this step": the step keeps the turn that proposed it.
      if (current.proposedByTurnId) await db.exploreAnalysis.update({ where: { id: stepId }, data: { proposedByTurnId: current.proposedByTurnId } });
      // Sheet 94: a step drafted from a sentence typed in In words keeps that sentence as its own (a person's words).
      if (current.text?.trim()) {
        const created = await db.exploreAnalysis.findUnique({ where: { id: stepId }, select: { currentRevisionId: true } });
        await db.exploreAnalysis.update({ where: { id: stepId }, data: { methodsSentence: { text: current.text.trim().slice(0, 1000), tokens: [], revisionId: created?.currentRevisionId ?? null, author: "person", acceptedById: actor.userId, acceptedAt: new Date().toISOString(), ...methodsAcceptedBy({ memberId: actor.memberId ?? null, name: (actor as { name?: string | null }).name ?? null }) } as Prisma.InputJsonValue } });
      }
      return { proposal: serializeProposal((await db.exploreStepProposal.findUnique({ where: { id } }))!), stepId };
    }
    if (current.kind === "finding") {
      const finding = await db.exploreRunFinding.create({ data: { flowRunId: current.flowRunId!, analysisId: current.analysisId, text: current.text ?? current.purpose, values: current.values ?? [], caveats: current.notChecked ?? [], acceptedById: actor.userId } });
      await db.exploreStepProposal.update({ where: { id }, data: { acceptedFindingId: finding.id } });
      return { proposal: serializeProposal((await db.exploreStepProposal.findUnique({ where: { id } }))!), finding: { id: finding.id, analysisId: finding.analysisId, text: finding.text, values: finding.values, caveats: finding.caveats, acceptedById: finding.acceptedById, acceptedAt: finding.acceptedAt.toISOString() } };
    }
    if (current.kind === "step-change") {
      // Sheet 94: a new revision of the step from its sentence (out of date, nothing runs) and the edited sentence.
      const { applySentenceChange, tellRequester } = await import("./sentence-change");
      const applied = await applySentenceChange(current, actor);
      await tellRequester(current, actor, true);
      return { proposal: serializeProposal((await db.exploreStepProposal.findUnique({ where: { id } }))!), stepId: applied.stepId };
    }
    if (current.kind === "methods") {
      const analysis = await db.exploreAnalysis.findUnique({ where: { id: current.analysisId! }, select: { currentRevisionId: true } });
      // The accepting person (member and name, when the route's actor carries them) is who the sentence is by now.
      await db.exploreAnalysis.update({ where: { id: current.analysisId! }, data: { methodsSentence: acceptedMethodsSentence(current.values, current.text ?? "", analysis?.currentRevisionId ?? null, actor.userId, actor) as Prisma.InputJsonValue } });
      return { proposal: serializeProposal((await db.exploreStepProposal.findUnique({ where: { id } }))!), stepId: current.analysisId };
    }
    // gloss-rewrite: the new words replace the gloss's, accepted by this person.
    await db.exploreGloss.update({ where: { id: current.glossId! }, data: { text: current.text ?? "", state: "accepted", acceptedById: actor.userId, acceptedAt: new Date(), checkStatus: "unchecked", checkNotes: PrismaRuntime.DbNull } });
    return { proposal: serializeProposal((await db.exploreStepProposal.findUnique({ where: { id } }))!), glossId: current.glossId };
  } catch (error) {
    await db.exploreStepProposal.updateMany({ where: { id, state: "accepted", acceptedAnalysisId: null, acceptedFindingId: null }, data: { state: "pending", acceptedById: null } });
    throw error;
  }
}
