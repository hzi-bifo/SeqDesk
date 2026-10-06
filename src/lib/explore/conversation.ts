/**
 * The shared conversation of a flow (sheet 46, SERVER-FOLLOWUPS "Flow
 * conversation"): one thread per flow, seen by everyone who can open it.
 * Turns are numbered per flow (`seq`); the flow's `conversationVersion` is the
 * newest seq, so a client appends optimistically with `expectedVersion`.
 *
 * Assistant turns are written by the web client, which runs the model through
 * the collaboration server's AI routes; SeqDesk never calls a model. The
 * member who asked owns a working assistant turn and closes it (done, stopped,
 * failed).
 */
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { flowError } from "@/lib/integration/flow-contract";
import type { RecipeActor } from "./recipe";

export const TURN_KINDS = ["goal", "proposal", "question", "answer", "revision", "message", "check"] as const;
export type TurnKind = (typeof TURN_KINDS)[number];
/** What a person may post; answers go through the question route and checks come from holds. */
const PERSON_KINDS = new Set<TurnKind>(["goal", "message"]);
const ASSISTANT_KINDS = new Set<TurnKind>(["proposal", "question", "revision", "message"]);
const STATUSES = ["working", "done", "stopped", "failed"] as const;
export type TurnStatus = (typeof STATUSES)[number];
const PAGE = 20;
const MAX_TEXT = 20000;

export interface ConversationActor extends RecipeActor {
  name?: string | null;
  admin?: boolean;
}

type TurnRecord = Prisma.ExploreFlowTurnGetPayload<object>;
type QuestionRecord = Prisma.ExploreFlowQuestionGetPayload<object>;

export function serializeTurn(turn: TurnRecord, question?: QuestionRecord | null) {
  const data = (turn.data ?? {}) as Record<string, unknown>;
  return {
    id: turn.id,
    seq: turn.seq,
    at: turn.createdAt.toISOString(),
    updatedAt: turn.updatedAt.toISOString(),
    author: turn.authorKind === "assistant" ? "assistant" as const : { id: turn.authorMemberId ?? turn.authorUserId, name: turn.authorName ?? null },
    kind: turn.kind as TurnKind,
    stepIds: turn.stepIds,
    text: turn.text,
    ...(turn.authorKind === "assistant" ? { requestedBy: turn.requestedByMemberId, model: turn.model, inputsLabel: turn.inputsLabel, status: (turn.status ?? "done") as TurnStatus } : {}),
    ...(Array.isArray(data.proposalIds) ? { proposalIds: data.proposalIds as string[] } : {}),
    ...(data.revision ? { revision: data.revision } : {}),
    ...(data.answer ? { answer: data.answer } : {}),
    ...(data.check ? { check: data.check } : {}),
    ...(question ? { question: serializeQuestion(question) } : {}),
  };
}

export function serializeQuestion(question: QuestionRecord) {
  return {
    questionId: question.id, stepId: question.stepId, text: question.text, options: question.options,
    answeredBy: question.answeredAt ? question.answeredByMemberId ?? question.answeredByUserId : null,
    answeredAt: question.answeredAt?.toISOString() ?? null, answerTurnId: question.answerTurnId,
    answer: question.answeredAt ? { optionId: question.answerOptionId, text: question.answerText } : null,
  };
}

export type Turn = ReturnType<typeof serializeTurn>;

async function withQuestions(turns: TurnRecord[]): Promise<Turn[]> {
  const questionTurns = turns.filter((turn) => turn.kind === "question").map((turn) => turn.id);
  const questions = questionTurns.length ? await db.exploreFlowQuestion.findMany({ where: { turnId: { in: questionTurns } } }) : [];
  return turns.map((turn) => serializeTurn(turn, questions.find((question) => question.turnId === turn.id)));
}

/** How long an assistant turn may stay `working`. The web client that asked runs the model and closes the turn; when
 *  that page closed or lost its connection mid-turn nothing else would, and the thread would say "working" forever. */
export const STALE_TURN_MS = 10 * 60 * 1000;
export const STALE_TURN_TEXT = "The assistant stopped: it did not finish within 10 minutes (the page that asked may have been closed). Nothing more will arrive for this turn.";

/** Close the flow's assistant turns that stayed working past STALE_TURN_MS as failed; returns how many. */
export async function closeStaleTurns(flowId: string, now = Date.now()): Promise<number> {
  const closed = await db.exploreFlowTurn.updateMany({
    where: { flowId, authorKind: "assistant", status: "working", updatedAt: { lt: new Date(now - STALE_TURN_MS) } },
    data: { status: "failed", text: STALE_TURN_TEXT },
  });
  if (closed.count) await conversationChanged(flowId);
  return closed.count;
}

/**
 * A page of the conversation, oldest first: the newest `limit` turns, or those
 * before the `before` seq; with `stepId` only turns about that step; with
 * `after` only turns newer than that seq (catching up after a `turn` event).
 */
export async function readConversation(flowId: string, options: { before?: number | null; after?: number | null; limit?: number; stepId?: string | null } = {}) {
  const flow = await db.exploreFlow.findUnique({ where: { id: flowId }, select: { conversationVersion: true } });
  if (!flow) throw flowError("not_found", "Flow not found");
  await closeStaleTurns(flowId);
  const limit = Math.min(Math.max(options.limit ?? PAGE, 1), 100);
  const filter: Prisma.ExploreFlowTurnWhereInput = { flowId, ...(options.stepId ? { stepIds: { has: options.stepId } } : {}) };
  const where: Prisma.ExploreFlowTurnWhereInput = {
    ...filter,
    ...(options.after !== null && options.after !== undefined ? { seq: { gt: options.after } } : options.before ? { seq: { lt: options.before } } : {}),
  };
  const newestFirst = options.after !== null && options.after !== undefined
    ? await db.exploreFlowTurn.findMany({ where, orderBy: { seq: "asc" }, take: limit + 1 })
    : (await db.exploreFlowTurn.findMany({ where, orderBy: { seq: "desc" }, take: limit + 1 }));
  const hasMore = newestFirst.length > limit;
  const page = newestFirst.slice(0, limit);
  const ascending = options.after !== null && options.after !== undefined ? page : [...page].reverse();
  const total = await db.exploreFlowTurn.count({ where: filter });
  return {
    version: flow.conversationVersion,
    turns: await withQuestions(ascending),
    total,
    hasMore,
    nextBefore: hasMore && !(options.after !== null && options.after !== undefined) ? ascending[0]?.seq ?? null : null,
  };
}

/** Wait (polling the database) until the conversation passes `version`, at most `waitMs`. */
export async function waitForTurns(flowId: string, version: number, waitMs: number, signal?: AbortSignal): Promise<void> {
  const until = Date.now() + Math.min(waitMs, 30000);
  while (Date.now() < until && !signal?.aborted) {
    const flow = await db.exploreFlow.findUnique({ where: { id: flowId }, select: { conversationVersion: true } });
    if (!flow || flow.conversationVersion > version) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export interface AppendTurnInput {
  kind: TurnKind;
  authorKind: "person" | "assistant";
  text?: string | null;
  stepIds?: string[];
  data?: Record<string, unknown> | null;
  model?: string | null;
  inputsLabel?: string | null;
  status?: TurnStatus | null;
  requestedByMemberId?: string | null;
  expectedVersion?: number;
  id?: string;
  question?: { stepId?: string | null; text: string; options: Array<{ id: string; label: string }> } | null;
}

/**
 * Append one turn. `expectedVersion` makes it optimistic (409
 * conversation_conflict with the current version when someone else wrote in
 * between). Runs in the caller's transaction when one is given.
 */
export async function appendTurn(flowId: string, input: AppendTurnInput, actor: ConversationActor, client?: Prisma.TransactionClient): Promise<{ turn: Turn; version: number }> {
  const run = async (tx: Prisma.TransactionClient) => {
    if (input.id) {
      const existing = await tx.exploreFlowTurn.findUnique({ where: { id: input.id } });
      if (existing) {
        if (existing.flowId !== flowId || existing.authorUserId !== actor.userId) throw flowError("invalid_request", "This request ID belongs to another turn.");
        const question = existing.kind === "question" ? await tx.exploreFlowQuestion.findUnique({ where: { turnId: existing.id } }) : null;
        const flow = await tx.exploreFlow.findUnique({ where: { id: flowId }, select: { conversationVersion: true } });
        return { turn: serializeTurn(existing, question), version: flow?.conversationVersion ?? existing.seq };
      }
    }
    const bumped = await tx.exploreFlow.updateMany({
      where: { id: flowId, ...(input.expectedVersion !== undefined ? { conversationVersion: input.expectedVersion } : {}) },
      data: { conversationVersion: { increment: 1 } },
    });
    if (!bumped.count) {
      const flow = await tx.exploreFlow.findUnique({ where: { id: flowId }, select: { conversationVersion: true } });
      if (!flow) throw flowError("not_found", "Flow not found");
      throw flowError("conversation_conflict", "The conversation changed. Read the new turns and send again.", { version: flow.conversationVersion });
    }
    const flow = await tx.exploreFlow.findUnique({ where: { id: flowId }, select: { conversationVersion: true } });
    const seq = flow!.conversationVersion;
    const turn = await tx.exploreFlowTurn.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        flowId, seq, kind: input.kind, authorKind: input.authorKind, authorUserId: actor.userId, authorMemberId: actor.memberId ?? null,
        authorName: input.authorKind === "person" ? actor.name?.slice(0, 200) ?? null : null,
        requestedByMemberId: input.authorKind === "assistant" ? input.requestedByMemberId ?? actor.memberId ?? null : null,
        stepIds: [...new Set(input.stepIds ?? [])].slice(0, 50), text: input.text ?? null,
        data: input.data ? (input.data as Prisma.InputJsonValue) : undefined,
        model: input.model ?? null, inputsLabel: input.inputsLabel ?? null, status: input.authorKind === "assistant" ? input.status ?? "done" : null,
      },
    });
    let question: QuestionRecord | null = null;
    if (input.kind === "question" && input.question) {
      question = await tx.exploreFlowQuestion.create({ data: { flowId, turnId: turn.id, stepId: input.question.stepId ?? null, text: input.question.text, options: input.question.options } });
    }
    return { turn: serializeTurn(turn, question), version: seq };
  };
  const result = client ? await run(client) : await db.$transaction(run);
  if (!client) await conversationChanged(flowId);
  return result;
}

/** Tell the collaboration server a turn arrived (the `turn` event); best effort. */
export async function conversationChanged(flowId: string): Promise<void> {
  try {
    const { enqueueConversationTurn } = await import("@/lib/integration/events");
    await enqueueConversationTurn(flowId);
  } catch (error) {
    console.error("[flow] could not queue the turn event", flowId, error);
  }
}

const text = (value: unknown, max = MAX_TEXT): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

async function stepIdsOf(flowId: string, raw: unknown): Promise<string[]> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 50 || !raw.every((id) => typeof id === "string")) throw flowError("invalid_request", "stepIds must be a list of step ids.");
  const ids = [...new Set(raw as string[])];
  if (!ids.length) return [];
  const steps = await db.exploreAnalysis.findMany({ where: { id: { in: ids }, flowId }, select: { id: true } });
  if (steps.length !== ids.length) throw flowError("invalid_request", "A step id is not a step of this flow.");
  return ids;
}

/** A turn a person or the web's assistant posts (POST …/conversation/turns). */
export async function postTurn(flowId: string, body: Record<string, unknown>, actor: ConversationActor): Promise<{ turn: Turn; version: number }> {
  const kind = body.kind as TurnKind;
  if (!TURN_KINDS.includes(kind)) throw flowError("invalid_request", `kind must be one of ${TURN_KINDS.join(", ")}.`);
  const assistant = body.author === "assistant";
  if (assistant ? !ASSISTANT_KINDS.has(kind) : !PERSON_KINDS.has(kind)) {
    throw flowError("invalid_request", assistant ? "The assistant posts proposal, question, revision and message turns." : "People post goal and message turns; answers go through the question, checks through holds.");
  }
  if (assistant && body.requestedBy !== undefined && body.requestedBy !== actor.memberId) throw flowError("forbidden", "Assistant turns are posted for the member who asked.");
  const status = body.status === undefined ? (assistant ? "done" : null) : body.status;
  if (assistant && !STATUSES.includes(status as TurnStatus)) throw flowError("invalid_request", 'status must be "working", "done", "stopped" or "failed".');
  const expectedVersion = body.expectedVersion === undefined ? undefined : Number(body.expectedVersion);
  if (expectedVersion !== undefined && !Number.isInteger(expectedVersion)) throw flowError("invalid_request", "expectedVersion must be a whole number.");
  const stepIds = await stepIdsOf(flowId, body.stepIds);
  const data: Record<string, unknown> = {};
  let question: AppendTurnInput["question"] = null;
  if (kind === "proposal" || kind === "revision") {
    const ids = Array.isArray(body.proposalIds) ? (body.proposalIds as unknown[]).filter((id): id is string => typeof id === "string").slice(0, 50) : [];
    if (ids.length) {
      const count = await db.exploreStepProposal.count({ where: { id: { in: ids }, flowId } });
      if (count !== ids.length) throw flowError("invalid_request", "A proposal id is not a proposal of this flow.");
      data.proposalIds = ids;
    }
  }
  if (kind === "question") {
    const raw = body.question as { stepId?: unknown; text?: unknown; options?: unknown } | undefined;
    const questionText = text(raw?.text, 2000) ?? text(body.text, 2000);
    const options = Array.isArray(raw?.options) ? (raw!.options as Array<{ id?: unknown; label?: unknown }>) : [];
    if (!questionText || options.length > 10 || !options.every((option) => typeof option?.id === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(option.id) && typeof option.label === "string" && option.label.trim())) {
      throw flowError("invalid_request", "A question needs text and at most 10 options {id, label}.");
    }
    if (new Set(options.map((option) => option.id)).size !== options.length) throw flowError("invalid_request", "Option ids must be different.");
    const stepId = typeof raw?.stepId === "string" ? raw.stepId : null;
    if (stepId) await stepIdsOf(flowId, [stepId]);
    question = { stepId, text: questionText, options: options.map((option) => ({ id: option.id as string, label: (option.label as string).trim().slice(0, 200) })) };
    if (stepId && !stepIds.includes(stepId)) stepIds.push(stepId);
  }
  const requestId = body.requestId === undefined ? undefined : typeof body.requestId === "string" && /^flow_[A-Za-z0-9_-]{16,80}$/.test(body.requestId) ? body.requestId : (() => { throw flowError("invalid_request", "Invalid request ID."); })();
  return appendTurn(flowId, {
    kind, authorKind: assistant ? "assistant" : "person", text: text(body.text) ?? question?.text ?? null, stepIds, data: Object.keys(data).length ? data : null,
    model: assistant ? text(body.model, 120) : null, inputsLabel: assistant ? text(body.inputsLabel, 280) : null, status: assistant ? (status as TurnStatus) : null,
    requestedByMemberId: assistant ? actor.memberId ?? null : null, expectedVersion, id: requestId, question,
  }, actor);
}

/** Close (or rewrite) a working assistant turn: only the member who asked, or an admin. */
export async function updateAssistantTurn(flowId: string, turnId: string, body: Record<string, unknown>, actor: ConversationActor): Promise<Turn> {
  const turn = await db.exploreFlowTurn.findUnique({ where: { id: turnId } });
  if (!turn || turn.flowId !== flowId) throw flowError("not_found", "Turn not found");
  if (turn.authorKind !== "assistant") throw flowError("forbidden", "Only assistant turns change after they are written.");
  if (!actor.admin && (!actor.memberId || turn.requestedByMemberId !== actor.memberId)) throw flowError("forbidden", "Only the member who asked (or an admin) can update this turn.");
  const status = body.status;
  if (status !== undefined && !["done", "stopped", "failed"].includes(String(status))) throw flowError("invalid_request", 'status must be "done", "stopped" or "failed".');
  const data: Prisma.ExploreFlowTurnUpdateManyMutationInput = {};
  if (status !== undefined) data.status = String(status);
  if (body.text !== undefined) data.text = text(body.text);
  if (body.inputsLabel !== undefined) data.inputsLabel = text(body.inputsLabel, 280);
  const updated = await db.exploreFlowTurn.updateMany({ where: { id: turnId, status: "working" }, data });
  if (!updated.count) throw flowError("turn_closed", "This turn is no longer working.", { status: turn.status });
  await conversationChanged(flowId);
  return serializeTurn((await db.exploreFlowTurn.findUnique({ where: { id: turnId } }))!);
}

/** Answer a question: one answer wins, the rest get 409 with the winning answer. */
export async function answerQuestion(flowId: string, questionId: string, body: Record<string, unknown>, actor: ConversationActor) {
  const question = await db.exploreFlowQuestion.findUnique({ where: { id: questionId } });
  if (!question || question.flowId !== flowId) throw flowError("not_found", "Question not found");
  const conflict = async () => {
    const won = (await db.exploreFlowQuestion.findUnique({ where: { id: questionId } }))!;
    return flowError("question_answered", "Someone answered this question first.", { answer: serializeQuestion(won) });
  };
  // A closed question answers with the winning answer, whatever was sent.
  if (question.answeredAt) throw await conflict();
  const options = (Array.isArray(question.options) ? question.options : []) as Array<{ id: string; label: string }>;
  const optionId = typeof body.optionId === "string" ? body.optionId : null;
  const answerText = text(body.text, 4000);
  if (!optionId && !answerText) throw flowError("invalid_request", "Answer with optionId or text.");
  const option = optionId ? options.find((candidate) => candidate.id === optionId) : undefined;
  if (optionId && !option) throw flowError("invalid_request", "That is not one of the question's options.");
  try {
    const result = await db.$transaction(async (tx) => {
      const turnId = randomUUID();
      const claimed = await tx.exploreFlowQuestion.updateMany({
        where: { id: questionId, answeredAt: null },
        data: { answeredAt: new Date(), answeredByUserId: actor.userId, answeredByMemberId: actor.memberId ?? null, answerTurnId: turnId, answerOptionId: option?.id ?? null, answerText },
      });
      if (!claimed.count) throw new Error("answered");
      const appended = await appendTurn(flowId, {
        kind: "answer", authorKind: "person", text: answerText ?? option?.label ?? null, stepIds: question.stepId ? [question.stepId] : [],
        data: { answer: { questionId, optionId: option?.id ?? null, label: option?.label ?? null, text: answerText } }, id: turnId,
      }, actor, tx);
      return { turn: appended.turn, version: appended.version, question: serializeQuestion((await tx.exploreFlowQuestion.findUnique({ where: { id: questionId } }))!) };
    });
    await conversationChanged(flowId);
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === "answered") throw await conflict();
    throw error;
  }
}

/** A `check` turn when a person marks a run, a step, a row or a value (from holds). */
export async function appendCheckTurn(flowRunId: string, key: string, actor: ConversationActor): Promise<void> {
  const run = await db.exploreFlowRun.findUnique({ where: { id: flowRunId }, select: { flowId: true, number: true } });
  if (!run) return;
  const step = /#step\/([A-Za-z0-9_.-]{1,128})/.exec(key)?.[1] ?? /^labdesk:\/\/value\/[^/]+\/([^/]+)\//.exec(key)?.[1] ?? null;
  const known = step ? await db.exploreAnalysis.count({ where: { id: step, flowId: run.flowId } }) : 0;
  await appendTurn(run.flowId, {
    kind: "check", authorKind: "person", text: null, stepIds: known ? [step!] : [],
    data: { check: { key, runId: flowRunId, runNumber: run.number } },
  }, actor);
}
