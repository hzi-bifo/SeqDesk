/**
 * The shared flow conversation against a real PostgreSQL database (see
 * flow-runs.live.test.ts for SEQDESK_FLOW_DATABASE_URL).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.SEQDESK_FLOW_DATABASE_URL;
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { db: new PrismaClient({ datasourceUrl: process.env.SEQDESK_FLOW_DATABASE_URL || "postgresql://invalid@127.0.0.1:1/none" }) };
});

import { db } from "@/lib/db";
import { createAnalysis } from "./analyses";
import { answerQuestion, postTurn, readConversation, updateAssistantTurn, waitForTurns } from "./conversation";
import { addHold } from "./flow-runs";
import { acceptProposal, createProposals, patchProposal } from "./proposals";
import { getRecipeView } from "./recipe-view";

const suffix = randomUUID().slice(0, 8);
const targetKey = `project:conversationtest-${suffix}`;
let userId = "";
let flowId = "";
let datasetId = "";
const steps: string[] = [];
const amara = () => ({ userId, memberId: "m-amara", name: "Amara Okafor" });
const tomas = () => ({ userId, memberId: "m-tomas", name: "Tomás Ruiz" });

describe.skipIf(!url)("flow conversation (PostgreSQL)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/flow/.test(parsed.pathname) || !/(check|test)/.test(parsed.pathname)) throw new Error("Use a local flow check database");
    userId = (await db.user.create({ data: { email: `conversationtest-${suffix}@example.invalid`, password: "!disabled", firstName: "C", lastName: "T", isActive: false } })).id;
    flowId = (await db.exploreFlow.create({ data: { targetKey, name: "Conversation", createdById: userId } })).id;
    const dataset = await db.exploreDataset.create({ data: { targetKey, kind: "external", name: "counts", createdById: userId } });
    const version = await db.exploreDatasetVersion.create({ data: { datasetId: dataset.id, number: 1, contentHash: "e".repeat(64), schema: "{\"columns\":[]}", rowCount: 3, provenance: "{}", buildSource: "import" } });
    await db.exploreDataset.update({ where: { id: dataset.id }, data: { currentVersionId: version.id } });
    datasetId = dataset.id;
    for (const name of ["Filter", "Hallmark enrichment"]) steps.push((await createAnalysis({ targetKey, flowId, name, code: "x", inputs: [{ alias: "counts", datasetId, versionId: null }], createdById: userId })).id);
  });

  afterAll(async () => {
    if (!url || !userId) return;
    await db.exploreFlow.deleteMany({ where: { targetKey } });
    await db.exploreAnalysis.deleteMany({ where: { targetKey } });
    await db.exploreDataset.deleteMany({ where: { targetKey } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it("appends turns optimistically, with assistant turns owned by the member who asked", async () => {
    const goal = await postTurn(flowId, { kind: "goal", text: "Which pathways change at 6 h?" }, amara());
    expect(goal).toMatchObject({ version: 1, turn: { seq: 1, kind: "goal", author: { id: "m-amara", name: "Amara Okafor" } } });
    await expect(postTurn(flowId, { kind: "message", text: "late", expectedVersion: 0 }, tomas())).rejects.toMatchObject({ status: 409, code: "conversation_conflict", extra: { version: 1 } });
    await expect(postTurn(flowId, { kind: "answer", text: "no" }, tomas())).rejects.toMatchObject({ code: "invalid_request" });
    await expect(postTurn(flowId, { kind: "proposal", author: "assistant", requestedBy: "m-other" }, amara())).rejects.toMatchObject({ code: "forbidden" });
    const working = await postTurn(flowId, { kind: "proposal", author: "assistant", status: "working", model: "claude", inputsLabel: "column names and profiles, never rows", text: "Thinking…", expectedVersion: 1, stepIds: [steps[1]] }, amara());
    expect(working.turn).toMatchObject({ seq: 2, author: "assistant", requestedBy: "m-amara", status: "working", model: "claude", stepIds: [steps[1]] });
    await expect(updateAssistantTurn(flowId, working.turn.id, { status: "stopped" }, tomas())).rejects.toMatchObject({ code: "forbidden" });
    expect((await updateAssistantTurn(flowId, working.turn.id, { status: "done", text: "Two steps." }, amara())).status).toBe("done");
    await expect(updateAssistantTurn(flowId, working.turn.id, { status: "failed" }, { ...tomas(), admin: true })).rejects.toMatchObject({ code: "turn_closed" });
    const other = await postTurn(flowId, { kind: "message", author: "assistant", status: "working" }, amara());
    expect((await updateAssistantTurn(flowId, other.turn.id, { status: "stopped" }, { ...tomas(), admin: true })).status).toBe("stopped");
    const again = await postTurn(flowId, { kind: "message", text: "once", requestId: `flow_${suffix}turnrequest1` }, amara());
    expect((await postTurn(flowId, { kind: "message", text: "once", requestId: `flow_${suffix}turnrequest1` }, amara())).turn.id).toBe(again.turn.id);
  });

  it("closes a question with the first answer; the second gets the winning answer", async () => {
    const asked = await postTurn(flowId, { kind: "question", author: "assistant", question: { stepId: steps[1], text: "Adjust for batch?", options: [{ id: "yes", label: "Yes, adjust" }, { id: "no", label: "No" }] } }, amara());
    const questionId = asked.turn.question!.questionId;
    const [first, second] = await Promise.allSettled([
      answerQuestion(flowId, questionId, { optionId: "yes" }, amara()),
      answerQuestion(flowId, questionId, { optionId: "no" }, tomas()),
    ]);
    const won = [first, second].filter((result) => result.status === "fulfilled");
    const lost = [first, second].filter((result) => result.status === "rejected") as PromiseRejectedResult[];
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const winner = (won[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof answerQuestion>>>).value;
    expect(winner.turn).toMatchObject({ kind: "answer", stepIds: [steps[1]] });
    expect(winner.question).toMatchObject({ answerTurnId: winner.turn.id, answer: { optionId: expect.any(String) } });
    expect(lost[0].reason).toMatchObject({ status: 409, code: "question_answered", extra: { answer: expect.objectContaining({ answerTurnId: winner.turn.id }) } });
    await expect(answerQuestion(flowId, questionId, { optionId: "maybe" }, tomas())).rejects.toMatchObject({ code: "question_answered" });
    const read = await readConversation(flowId, { after: asked.version - 1 });
    expect(read.turns.find((turn) => turn.kind === "question")?.question).toMatchObject({ answeredAt: expect.any(String) });
  });

  it("revises a proposal after an answer with its history, and the accepted step points back at its turn", async () => {
    const turn = await postTurn(flowId, { kind: "proposal", author: "assistant", stepIds: [] }, amara());
    const [proposal] = await createProposals(flowId, { kind: "step", proposedByTurnId: turn.turn.id, actor: amara(), items: [{ afterStepId: steps[0], purpose: "Test genes", why: "Groups differ", assumes: [{ text: "No batch effect", inferred: true }], code: "x", inputs: [{ alias: "counts", datasetId }] }] });
    expect(proposal).toMatchObject({ proposedByTurnId: turn.turn.id, revision: 1, history: [] });
    const revision = await postTurn(flowId, { kind: "revision", author: "assistant", proposalIds: [proposal.id], text: "Step 2 now adjusts for batch." }, amara());
    const revised = await patchProposal(proposal.id, { assumes: [{ text: "Batch is known", inferred: false }], why: "Adjusts for batch", revisedByTurnId: revision.turn.id });
    expect(revised).toMatchObject({ revision: 2, revisedByTurnId: revision.turn.id, history: [{ revision: 1, assumes: [{ text: "No batch effect", inferred: true }], why: "Groups differ", revisedByTurnId: null }] });
    await expect(patchProposal(proposal.id, { revisedByTurnId: "nope" })).rejects.toMatchObject({ code: "invalid_request" });
    const accepted = await acceptProposal(proposal.id, null, undefined, amara());
    const recipe = await getRecipeView(flowId, { canEdit: true });
    expect(recipe.steps.find((step) => step.id === accepted.stepId)?.proposedByTurnId).toBe(turn.turn.id);
  });

  it("shows people's checks as turns, filters by step and pages from the newest", async () => {
    const run = await db.exploreFlowRun.create({ data: { flowId, number: 1, kind: "full", status: "completed", startedById: userId, plan: [] } });
    const before = (await readConversation(flowId)).version;
    await addHold(run.id, "check", `labdesk://run/${run.id}#step/${steps[1]}`, tomas());
    await addHold(run.id, "check", `labdesk://run/${run.id}#step/${steps[1]}`, tomas());
    const checks = (await readConversation(flowId, { after: before })).turns;
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ kind: "check", author: { id: "m-tomas" }, stepIds: [steps[1]], check: { runId: run.id, runNumber: 1 } });

    for (let index = 0; index < 25; index += 1) await postTurn(flowId, { kind: "message", text: `note ${index}` }, amara());
    const newest = await readConversation(flowId);
    expect(newest.turns).toHaveLength(20);
    expect(newest.turns.at(-1)?.text).toBe("note 24");
    expect(newest.turns[0].seq).toBeLessThan(newest.turns[1].seq);
    expect(newest.hasMore).toBe(true);
    const older = await readConversation(flowId, { before: newest.nextBefore });
    expect(older.turns.at(-1)!.seq).toBe(newest.turns[0].seq - 1);
    expect(older.total).toBe(newest.total);
    const aboutStep = await readConversation(flowId, { stepId: steps[1] });
    expect(aboutStep.turns.every((turn) => turn.stepIds.includes(steps[1]))).toBe(true);
    expect(aboutStep.total).toBe(aboutStep.turns.length);
    expect(aboutStep.total).toBeGreaterThanOrEqual(4);
    const started = Date.now();
    await waitForTurns(flowId, newest.version - 1, 5000);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
