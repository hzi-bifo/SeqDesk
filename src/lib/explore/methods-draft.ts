/**
 * A methods sentence drafted by the assistant for one step (D32, "In words"):
 * kept in pencil as a `methods` proposal of the step's flow until a person
 * accepts, edits or discards it. The web client asks the model and checks the
 * numbers; SeqDesk only keeps the draft with the revision it describes, the
 * prompt it came from and the parameter values it names (its tokens).
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import { serializeProposal, type Proposal } from "./proposals";
import type { RecipeActor } from "./recipe";

export type MethodsToken = { key: string; value: unknown };
export type MethodsDraft = { text: string; tokens: MethodsToken[]; prompt: string; model: string | null; notVerified: string[] };

const MAX_TEXT = 1000;
const MAX_PROMPT = 12000;

/** The draft as the route receives it, validated. */
export function parseMethodsDraft(body: Record<string, unknown>): MethodsDraft {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) throw flowError("invalid_request", "A methods draft needs text.");
  if (text.length > MAX_TEXT) throw flowError("invalid_request", "The methods sentence is too long.");
  if (body.tokens !== undefined && (!Array.isArray(body.tokens) || body.tokens.length > 50)) throw flowError("invalid_request", "tokens must list at most 50 parameters.");
  const tokens = ((body.tokens as unknown[] | undefined) ?? []).map((raw) => {
    const token = raw as { key?: unknown; value?: unknown };
    if (!token || typeof token !== "object" || typeof token.key !== "string" || !/^[A-Za-z0-9_]{1,80}$/.test(token.key)) throw flowError("invalid_request", "Each token needs a parameter key.");
    const value = token.value;
    // Settings are JSON values (a list of genes, a design formula); a token keeps the value it was written for.
    if (value !== undefined && JSON.stringify(value).length > 2000) throw flowError("invalid_request", "A token value is too large to keep.");
    return { key: token.key, value: (value ?? null) as MethodsToken["value"] };
  });
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (prompt.length > MAX_PROMPT) throw flowError("invalid_request", "The prompt is too long to keep.");
  if (body.notVerified !== undefined && (!Array.isArray(body.notVerified) || body.notVerified.length > 10)) throw flowError("invalid_request", "notVerified must list at most 10 notes.");
  const notVerified = ((body.notVerified as unknown[] | undefined) ?? []).map((note) => String(note ?? "").slice(0, 300)).filter(Boolean);
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 120) : null;
  return { text, tokens, prompt, model, notVerified };
}

/** Keeps the draft in pencil on the step's current revision; an earlier open draft of the step is set aside. */
export async function saveMethodsDraft(stepId: string, draft: MethodsDraft, actor: RecipeActor): Promise<Proposal> {
  const analysis = await db.exploreAnalysis.findUnique({ where: { id: stepId }, select: { id: true, flowId: true, currentRevisionId: true } });
  if (!analysis?.flowId) throw flowError("not_found", "This step is not part of an analysis.");
  const revision = analysis.currentRevisionId ? await db.exploreAnalysisRevision.findUnique({ where: { id: analysis.currentRevisionId }, select: { codeHash: true } }) : null;
  await db.exploreStepProposal.updateMany({ where: { flowId: analysis.flowId, kind: "methods", state: "pending", analysisId: stepId }, data: { state: "discarded", discardReason: "Drafted again" } });
  const created = await db.exploreStepProposal.create({
    data: {
      flowId: analysis.flowId, kind: "methods", state: "pending", analysisId: stepId, purpose: "Methods sentence", text: draft.text,
      values: { tokens: draft.tokens, prompt: draft.prompt, model: draft.model, notVerified: draft.notVerified, revisionId: analysis.currentRevisionId, codeHash: revision?.codeHash || null, author: "assistant" } as Prisma.InputJsonValue,
      requestedById: actor.userId, requestedByMemberId: actor.memberId ?? null,
    },
  });
  return serializeProposal(created);
}

/** What an accepted methods proposal keeps on its step: the draft's revision, tokens and provenance. */
export function acceptedMethodsSentence(values: unknown, text: string, currentRevisionId: string | null, userId: string, by?: MethodsPerson) {
  const draft = values && typeof values === "object" && !Array.isArray(values) ? values as Record<string, unknown> : null;
  return {
    text, tokens: (draft ? draft.tokens ?? [] : values ?? []) as MethodsToken[],
    revisionId: (draft && typeof draft.revisionId === "string" ? draft.revisionId : currentRevisionId) ?? null,
    ...(draft && typeof draft.codeHash === "string" ? { codeHash: draft.codeHash } : {}),
    ...(draft && typeof draft.prompt === "string" && draft.prompt ? { prompt: draft.prompt } : {}),
    ...(draft && Array.isArray(draft.notVerified) && draft.notVerified.length ? { notVerified: draft.notVerified } : {}),
    ...(draft && typeof draft.model === "string" ? { model: draft.model } : {}),
    author: "assistant", acceptedById: userId, acceptedAt: new Date().toISOString(), ...methodsAcceptedBy(by),
  };
}

/** The person who last wrote or accepted a sentence, as the lab knows them. */
export type MethodsPerson = { memberId?: string | null; name?: string | null };

/** Who saved a sentence's words, kept beside `acceptedById`/`acceptedAt` (the time of that person's edit or accept):
 *  their collaboration member and the name SeqDesk has for them, so In words reads "Written by Amara · 12 Oct".
 *  Sentences saved before this carry neither; the recipe view resolves those from `acceptedById`. */
export function methodsAcceptedBy(by: MethodsPerson | undefined): { acceptedByMemberId?: string; acceptedByName?: string } {
  const memberId = typeof by?.memberId === "string" ? by.memberId.trim().slice(0, 200) : "";
  const name = typeof by?.name === "string" ? by.name.trim().slice(0, 200) : "";
  return { ...(memberId ? { acceptedByMemberId: memberId } : {}), ...(name ? { acceptedByName: name } : {}) };
}
