/**
 * Proposals and glosses against a real PostgreSQL database (see
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
import { createAnalysis, createRevision } from "./analyses";
import { codeRegions } from "./code-regions";
import { acceptGloss, listGlosses, patchGloss, putGlosses } from "./glosses";
import { acceptProposal, createProposals, discardProposal, listProposals, patchProposal } from "./proposals";
import { getRecipeView } from "./recipe-view";

const suffix = randomUUID().slice(0, 8);
const targetKey = `project:proposaltest-${suffix}`;
let userId = "";
let flowId = "";
let datasetId = "";
let stepId = "";
const actor = () => ({ userId, memberId: "member-3" });
const CODE = "import seqdesk_explore as sx\n\ncounts = sx.input('counts')\nkeep = counts[counts.reads >= 10]\n\nsx.output('filtered', keep)\nsx.finish()\n";

describe.skipIf(!url)("proposals and glosses (PostgreSQL)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/flow/.test(parsed.pathname) || !/(check|test)/.test(parsed.pathname)) throw new Error("Use a local flow check database");
    userId = (await db.user.create({ data: { email: `proposaltest-${suffix}@example.invalid`, password: "!disabled", firstName: "P", lastName: "T", isActive: false } })).id;
    flowId = (await db.exploreFlow.create({ data: { targetKey, name: "Proposals", createdById: userId } })).id;
    const dataset = await db.exploreDataset.create({ data: { targetKey, kind: "external", name: "counts", createdById: userId } });
    const version = await db.exploreDatasetVersion.create({ data: { datasetId: dataset.id, number: 1, contentHash: "c".repeat(64), schema: JSON.stringify({ columns: [{ key: "reads", label: "Reads", type: "number" }] }), rowCount: 5, provenance: "{}", buildSource: "import" } });
    await db.exploreDataset.update({ where: { id: dataset.id }, data: { currentVersionId: version.id } });
    datasetId = dataset.id;
    stepId = (await createAnalysis({ targetKey, flowId, name: "Filter", code: CODE, inputs: [{ alias: "counts", datasetId, versionId: null }], createdById: userId })).id;
  });

  afterAll(async () => {
    if (!url || !userId) return;
    await db.exploreFlow.deleteMany({ where: { targetKey } });
    await db.exploreAnalysis.deleteMany({ where: { targetKey } });
    await db.exploreDataset.deleteMany({ where: { targetKey } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it("stores pencil steps from a goal, shows them in the recipe and accepts them in order", async () => {
    const proposals = await createProposals(flowId, {
      kind: "step", goal: "Which genes change?", origin: { kind: "goal", ref: "goal-1" }, activityId: "act-1", actor: actor(),
      items: [
        { afterStepId: stepId, purpose: "Normalise", why: "Depth differs", assumes: [{ text: "Counts are raw", inferred: true }], inputs: [{ alias: "filtered", from: { stepId, output: "filtered" } }], outputs: [{ name: "normalised", kind: "table" }], code: "print('n')" },
        { purpose: "Test genes", inputs: [{ alias: "normalised", fromProposal: { proposalId: "later", output: "normalised" } }], code: "print('t')", refusals: [{ text: "Batch correction", reason: "No batch column" }] },
      ],
    });
    expect(proposals.map((proposal) => [proposal.state, proposal.purpose])).toEqual([["pending", "Normalise"], ["pending", "Test genes"]]);
    expect(proposals[1].position > proposals[0].position).toBe(true);
    const recipe = await getRecipeView(flowId, { canEdit: true, proposals: await listProposals(flowId, "pending") });
    expect(recipe.proposals).toHaveLength(2);

    await patchProposal(proposals[1].id, { inputs: [{ alias: "normalised", fromProposal: { proposalId: proposals[0].id, output: "normalised" } }] });
    await expect(acceptProposal(proposals[1].id, null, undefined, actor())).rejects.toMatchObject({ code: "output_not_ready" });
    expect((await listProposals(flowId, "pending")).map((proposal) => proposal.id)).toContain(proposals[1].id);

    const first = await acceptProposal(proposals[0].id, { name: "Normalise to CPM" }, undefined, actor());
    expect(first.proposal).toMatchObject({ state: "accepted", acceptedById: userId });
    const second = await acceptProposal(proposals[1].id, null, undefined, actor());
    const after = await getRecipeView(flowId, { canEdit: true });
    expect(after.steps.map((step) => [step.label, step.name])).toEqual([["1", "Filter"], ["2", "Normalise to CPM"], ["3", "Test genes"]]);
    expect(after.steps[2].inputs[0].from).toMatchObject({ stepId: first.stepId, output: "normalised" });
    expect(second.stepId).toBe(after.steps[2].id);
    await expect(acceptProposal(proposals[0].id, null, undefined, actor())).rejects.toMatchObject({ code: "proposal_settled", extra: { state: "accepted" } });
  });

  it("discards, and accepts methods sentences and findings", async () => {
    const [methods] = await createProposals(flowId, { kind: "methods", actor: actor(), items: [{ analysisId: stepId, text: "Genes with fewer than 10 reads were removed.", values: [{ token: "min_count", value: 10 }] }] });
    await acceptProposal(methods.id, null, undefined, actor());
    const analysis = await db.exploreAnalysis.findUnique({ where: { id: stepId } });
    expect(analysis?.methodsSentence).toMatchObject({ text: "Genes with fewer than 10 reads were removed.", author: "assistant", acceptedById: userId });
    await expect(createProposals(flowId, { kind: "finding", actor: actor(), items: [{ text: "x", flowRunId: "nope" }] })).rejects.toMatchObject({ code: "invalid_request" });
    const run = await db.exploreFlowRun.create({ data: { flowId, number: 1, kind: "full", status: "completed", startedById: userId, plan: [] } });
    const [finding] = await createProposals(flowId, { kind: "finding", actor: actor(), items: [{ flowRunId: run.id, analysisId: stepId, text: "{n} genes kept", values: [{ ref: `labdesk://value/${run.id}/${stepId}/n_kept` }], notChecked: ["Batch effects"] }] });
    const accepted = await acceptProposal(finding.id, null, undefined, actor());
    expect(accepted.finding).toMatchObject({ text: "{n} genes kept", caveats: ["Batch effects"] });
    const [other] = await createProposals(flowId, { kind: "step", actor: actor(), items: [{ purpose: "Plot", code: "x" }] });
    expect((await discardProposal(other.id, "Not now")).state).toBe("discarded");
    await expect(patchProposal(other.id, { purpose: "y" })).rejects.toMatchObject({ code: "proposal_settled" });
  });

  it("keeps glosses per code region, marks them stale when the code changes, and rewrites them", async () => {
    const listed = await listGlosses(stepId);
    expect(listed.regions).toHaveLength(3);
    const region = listed.regions[1];
    await expect(putGlosses(stepId, listed.revisionId, [{ regionHash: "0".repeat(64), type: "does", text: "x" }], actor())).rejects.toMatchObject({ code: "region_mismatch" });
    const put = await putGlosses(stepId, listed.revisionId, [
      { regionHash: region.regionHash, lineStart: region.lineStart, lineEnd: region.lineEnd, type: "chooses", text: "Keeps genes with at least 10 reads.", author: "assistant" },
      { regionHash: listed.regions[0].regionHash, type: "does", text: "Loads the helper.", author: "person" },
    ], actor());
    expect(put.glosses.map((gloss) => [gloss.type, gloss.state, gloss.stale])).toEqual([["does", "accepted", false], ["chooses", "pencil", false]]);
    const pencil = put.glosses[1];
    expect(pencil.ref).toBe(`labdesk://gloss/${pencil.id}@${region.regionHash}`);
    expect((await patchGloss(pencil.id, { checkStatus: "failed", checkNotes: ["names min_cnt, which this code does not have"] })).checkStatus).toBe("failed");
    const [rewrite] = await createProposals(flowId, { kind: "gloss-rewrite", actor: actor(), items: [{ glossId: pencil.id, text: "Keeps genes with at least min_count reads." }] });
    await acceptProposal(rewrite.id, null, undefined, actor());
    const rewritten = (await listGlosses(stepId)).glosses.find((gloss) => gloss.id === pencil.id);
    expect(rewritten).toMatchObject({ text: "Keeps genes with at least min_count reads.", state: "accepted", checkStatus: "unchecked" });

    await createRevision({ analysisId: stepId, code: CODE.replace(">= 10", ">= 20"), author: "user", authorUserId: userId });
    const stale = await listGlosses(stepId);
    expect(stale.glosses.find((gloss) => gloss.id === pencil.id)?.stale).toBe(true);
    expect(stale.glosses.find((gloss) => gloss.type === "does")?.stale).toBe(false);
    expect((await getRecipeView(flowId, { canEdit: true })).steps[0].glossSummary).toEqual({ count: 2, pencil: 0, stale: 1 });
    expect((await acceptGloss(pencil.id, actor())).state).toBe("accepted");
    expect(codeRegions(CODE)[1].regionHash).toBe(region.regionHash);
  });
});
