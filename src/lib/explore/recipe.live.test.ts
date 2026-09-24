/**
 * The recipe routes' services against a real PostgreSQL database: templates,
 * the recipe view, moves with the binding guard, lanes, layout, adding steps
 * with the fit guard, step options and recipe revisions. Set
 * SEQDESK_FLOW_DATABASE_URL (see flow-runs.live.test.ts); the test removes
 * what it writes.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.SEQDESK_FLOW_DATABASE_URL;
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { db: new PrismaClient({ datasourceUrl: process.env.SEQDESK_FLOW_DATABASE_URL || "postgresql://invalid@127.0.0.1:1/none" }) };
});

import { db } from "@/lib/db";
import { addStep, applyRecipeOps, listRecipeRevisions, stepOptions } from "./recipe-edit";
import { getRecipeView } from "./recipe-view";
import { createFlowFromTemplate, listTemplates } from "./templates";

const suffix = randomUUID().slice(0, 8);
const targetKey = `project:recipetest-${suffix}`;
let userId = "";
let datasetId = "";
let flowId = "";
const actor = () => ({ userId, memberId: "member-7" });
const columns = ["gene", "c1", "c2", "c3", "t1", "t2", "t3"];

describe.skipIf(!url)("recipes (PostgreSQL)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/flow/.test(parsed.pathname) || !/(check|test)/.test(parsed.pathname)) throw new Error("Use a local flow check database");
    userId = (await db.user.create({ data: { email: `recipetest-${suffix}@example.invalid`, password: "!disabled", firstName: "Recipe", lastName: "Test", isActive: false } })).id;
    const dataset = await db.exploreDataset.create({ data: { targetKey, kind: "external", name: "counts", createdById: userId } });
    const version = await db.exploreDatasetVersion.create({ data: { datasetId: dataset.id, number: 1, contentHash: "ab12cd".padEnd(64, "0"),
      schema: JSON.stringify({ rowEntity: "gene", columns: columns.map((key) => ({ key, label: key, type: key === "gene" ? "string" : "number" })) }), rowCount: 58302, provenance: "{}", buildSource: "import" } });
    await db.exploreDataset.update({ where: { id: dataset.id }, data: { currentVersionId: version.id } });
    datasetId = dataset.id;
  });

  afterAll(async () => {
    if (!url || !userId) return;
    await db.exploreFlow.deleteMany({ where: { targetKey } });
    await db.exploreAnalysis.deleteMany({ where: { targetKey } });
    await db.exploreDataset.deleteMany({ where: { targetKey } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  it("creates a flow from the RNA-seq template with chained steps", async () => {
    expect((await listTemplates()).map((template) => template.id)).toEqual(["rnaseq-de", "survey-likert"]);
    await expect(createFlowFromTemplate({ targetKey, templateId: "rnaseq-de", datasetId, slots: { gene: "gene", control: ["c1"], treated: ["nope"] }, actor: actor() })).rejects.toMatchObject({ code: "invalid_request" });
    flowId = await createFlowFromTemplate({ targetKey, templateId: "rnaseq-de", datasetId, name: "Differential expression, 0–24 h", slots: { gene: "gene", control: ["c1", "c2", "c3"], treated: ["t1", "t2", "t3"] }, actor: actor() });
    const recipe = await getRecipeView(flowId, { canEdit: true });
    expect(recipe.flow).toMatchObject({ name: "Differential expression, 0–24 h", recipeRevision: 4, currentRunId: null, ownerMemberId: "member-7" });
    expect(recipe.steps.map((step) => [step.label, step.name, step.state])).toEqual([["1", "Filter low counts", "notRun"], ["2", "Normalise to log CPM", "notRun"], ["3", "Test genes", "notRun"], ["4", "Volcano plot", "notRun"]]);
    expect(recipe.inputs).toEqual([expect.objectContaining({ datasetId, name: "counts", version: 1, rows: 58302, cols: 7, dims: "58,302 genes × 7 columns", usedBy: [recipe.steps[0].id], newer: null })]);
    const normalise = recipe.steps[1];
    expect(normalise.inputs[0]).toMatchObject({ alias: "filtered", from: { stepId: recipe.steps[0].id, label: "1", output: "filtered" }, check: { ok: true, sentence: "Fills when step 1 runs." } });
    const filter = recipe.steps[0];
    expect(filter.params.find((param) => param.key === "min_count")).toMatchObject({ value: 10, label: "Minimum reads", consequence: "Higher removes more genes." });
    expect(filter.params.find((param) => param.key === "samples")?.value).toEqual(["c1", "c2", "c3", "t1", "t2", "t3"]);
    expect(filter.outputs).toContainEqual({ name: "filtered", kind: "table", label: "filtered" });
    expect(recipe.counts).toEqual({ steps: 4, current: 0, notRun: 4, outOfDate: 0, failed: 0, running: 0 });
  });

  it("refuses moves that would read from a later step and checks the revision", async () => {
    const recipe = await getRecipeView(flowId, { canEdit: true });
    const [filter, normalise, test, volcano] = recipe.steps;
    await expect(applyRecipeOps(flowId, [{ op: "move", stepId: volcano.id, after: null }], 4, actor())).rejects.toMatchObject({ status: 422, code: "binding_lost", extra: expect.objectContaining({ stepId: volcano.id, fix: { stepId: volcano.id, after: test.id } }) });
    await expect(applyRecipeOps(flowId, [{ op: "move", stepId: volcano.id, after: test.id }], 3, actor())).rejects.toMatchObject({ code: "revision_conflict", extra: { current: { recipeRevision: 4 } } });
    await expect(applyRecipeOps(flowId, [{ op: "lane", stepId: volcano.id, laneKind: "alternative", laneOf: test.id, laneLabel: "plot" }], undefined, actor())).rejects.toMatchObject({ code: "invalid_request" });
    await applyRecipeOps(flowId, [{ op: "purpose", stepId: filter.id, text: "Drop genes nobody can test." }, { op: "layout", nodes: { [filter.id]: { x: 10, y: 20 } }, snap: false },
      { op: "group", groups: [{ id: "g1", name: "Preparation", stepIds: [filter.id, normalise.id, "unknown"], collapsed: false }] }, { op: "headline", value: `${test.id}.n_called` }], undefined, actor());
    const after = await getRecipeView(flowId, { canEdit: true });
    expect(after.flow.recipeRevision).toBe(4);
    expect(after.flow.headlineValue).toBe(`${test.id}.n_called`);
    expect(after.flow.layout).toEqual({ nodes: { [filter.id]: { x: 10, y: 20 } }, groups: [{ id: "g1", name: "Preparation", stepIds: [filter.id, normalise.id], collapsed: false }], snap: false });
    expect(after.steps.map((step) => step.groupId)).toEqual(["g1", "g1", null, null]);
    expect(after.steps[0].purpose).toBe("Drop genes nobody can test.");
  });

  it("adds steps after a step, as a lane, from an upstream output, with the fit guard", async () => {
    const recipe = await getRecipeView(flowId, { canEdit: true });
    const [, normalise, test] = recipe.steps;
    const qc = await addStep(flowId, { after: normalise.id, name: "Sample QC", code: "import seqdesk_explore as sx\nsx.finish()\n", inputs: [{ alias: "normalised", from: { stepId: normalise.id, output: "normalised" } }], actor: actor() });
    const edger = await addStep(flowId, { laneOf: test.id, laneKind: "alternative", laneLabel: "edgeR", name: "Test genes (edgeR)", code: "print(1)\n", inputs: [{ alias: "normalised", from: { stepId: normalise.id, output: "normalised" } }], actor: actor(), requestId: `flow_${suffix}edgerstep01` });
    expect(await addStep(flowId, { laneOf: test.id, name: "again", code: "x", inputs: [], actor: actor(), requestId: `flow_${suffix}edgerstep01` })).toBe(edger);
    const after = await getRecipeView(flowId, { canEdit: true });
    expect(after.steps.map((step) => [step.label, step.name])).toEqual([["1", "Filter low counts"], ["2", "Normalise to log CPM"], ["3", "Sample QC"], ["4", "Test genes"], ["4b", "Test genes (edgeR)"], ["5", "Volcano plot"]]);
    // Both read the one table step 2 writes.
    expect(after.steps.find((step) => step.id === qc)?.inputs[0].datasetId).toBe(after.steps[3].inputs[0].datasetId);
    expect(after.flow.recipeRevision).toBe(6);
    await expect(addStep(flowId, { name: "Alpha", kitId: "alpha-diversity", inputs: [{ alias: "profiles", datasetId }], actor: actor() })).rejects.toMatchObject({ status: 422, code: "incompatible" });
    await expect(addStep(flowId, { name: "x", code: "x", inputs: [{ alias: "t", from: { stepId: "nope", output: "x" } }], actor: actor() })).rejects.toMatchObject({ code: "invalid_request" });
    const options = await stepOptions(flowId, { after: after.steps[0].id });
    expect(options.source).toMatchObject({ stepId: after.steps[0].id, output: "filtered" });
    expect(options.fits.map((fit) => fit.kitId)).toContain("table-summary");
    expect(options.fits.map((fit) => fit.kitId)).not.toContain("alpha-diversity");
    expect(options.templates.map((template) => template.id)).toEqual(["rnaseq-de", "survey-likert"]);
    const revisions = await listRecipeRevisions(flowId);
    expect(revisions.map((revision) => revision.number)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(revisions[0].message).toBe("Added step Test genes (edgeR)");
  });
});
