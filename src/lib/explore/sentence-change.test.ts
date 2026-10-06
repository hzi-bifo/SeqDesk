/**
 * Words and steps, both ways (sheet 94, `explore.sentence-changes`): the body of a sentence change, the server's own
 * checks before a proposal is kept, the request to whoever checked the step, Accept as a new revision (nothing runs)
 * and Undo — over an in-memory database, with the recipe, environments and revisions stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  memory: null as null | import("./__fixtures__/memory-db").MemoryDb,
  revisions: [] as Array<Record<string, unknown>>,
  inputs: [] as Array<Record<string, unknown>>,
  code: "",
}));

vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./__fixtures__/memory-db");
  state.memory = createMemoryDb({ exploreStepProposal: { state: "pending", purpose: "", why: "", assumes: [], notChecked: [], refusals: [], inputs: [], outputs: [], revision: 1, history: [], language: "python" } });
  return { db: state.memory.db };
});
vi.mock("./environments", () => ({ readEnvironmentSpecs: async () => new Map([["seqdesk-explore-r", "name: seqdesk-explore-r\ndependencies:\n  - r-base=4.5.*\n  - bioconductor-deseq2\n  - r-vegan\n"]]) }));
vi.mock("./analyses", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./analyses")>()),
  createRevision: async (input: Record<string, unknown>) => {
    const db = state.memory!.db;
    const step = await db.exploreAnalysis.findUnique({ where: { id: input.analysisId } });
    if (input.expectedRevisionId !== undefined && input.expectedRevisionId !== step.currentRevisionId) {
      const { RevisionConflict } = await import("./analyses");
      throw new RevisionConflict("This step changed in another session.");
    }
    const previous = await db.exploreAnalysisRevision.findUnique({ where: { id: step.currentRevisionId } });
    const revision = await db.exploreAnalysisRevision.create({ data: { analysisId: input.analysisId, number: (previous?.number ?? 0) + 1, code: input.code ?? previous?.code ?? "", codeHash: `h${state.revisions.length + 2}`,
      params: JSON.stringify(input.params ?? JSON.parse(previous?.params ?? "{}")), inputs: JSON.stringify(input.inputs ?? JSON.parse(previous?.inputs ?? "[]")), fileInputs: "[]", author: input.author, authorUserId: input.authorUserId } });
    state.revisions.push(input);
    await db.exploreAnalysis.update({ where: { id: input.analysisId }, data: { currentRevisionId: revision.id } });
    return revision;
  },
}));
vi.mock("./recipe-edit", () => ({ setStepInputs: async (_flowId: string, stepId: string, input: Record<string, unknown>) => { state.inputs.push({ stepId, ...input }); return true; } }));
vi.mock("./recipe", async () => ({
  loadRecipe: async (flowId: string) => {
    const db = state.memory!.db;
    const steps = (await db.exploreAnalysis.findMany({ where: { flowId } })).sort((a: { position: string }, b: { position: string }) => a.position.localeCompare(b.position));
    const withRevisions = await Promise.all(steps.map(async (step: Record<string, unknown>) => {
      const revision = await db.exploreAnalysisRevision.findUnique({ where: { id: step.currentRevisionId } });
      return { ...step, revision, bindings: JSON.parse((revision?.inputs as string) ?? "[]"), stepKind: "code", pipeline: null };
    }));
    return {
      flow: { id: flowId }, steps: withRevisions, labels: new Map(withRevisions.map((step: { id: string }, index: number) => [step.id, String(index + 1)])), upstream: new Map(),
      datasets: new Map([
        ["d-counts", { id: "d-counts", name: "counts.tsv", artifactName: null, producer: null }],
        ["d-filtered", { id: "d-filtered", name: "filtered_counts", artifactName: "filtered_counts", producer: "s-filter" }],
        ["d-res", { id: "d-res", name: "de_results", artifactName: "de_results", producer: "s-de" }],
      ]),
    };
  },
}));

import { db } from "@/lib/db";
import { applySentenceChange, assertMayAccept, checkSentenceChange, checkerOf, codePackage, codeTables, literalNumbers, namedPackages, parseMethodsMismatch, parseSentenceChange, proposeSentenceChange, specPackages, undoSentenceChange, type StepForCheck } from "./sentence-change";

const CODE = 'counts <- sx.input("filtered_counts")\nfdr <- sx.param("fdr", 0.05)\ndds <- DESeq(dds, test = "Wald")\nsx.output("de_results", res)\n';
const me = { userId: "u-me", memberId: "m-me", name: "Ines Varga" };
const anna = { userId: "u-anna", memberId: "m-anna" };

async function seed() {
  const memory = state.memory!;
  memory.reset();
  state.revisions = []; state.inputs = [];
  await db.user.create({ data: { id: "u-anna", firstName: "Anna", lastName: "Weber" } });
  await db.exploreFlow.create({ data: { id: "f1", name: "DE", currentRunId: "run14" } });
  await db.exploreAnalysisRevision.create({ data: { id: "r-filter", analysisId: "s-filter", number: 1, code: 'x <- sx.input("counts.tsv")\nsx.output("filtered_counts", x)', codeHash: "hf", params: "{}", inputs: '[{"alias":"counts","datasetId":"d-counts","versionId":null}]', fileInputs: "[]", author: "user" } });
  await db.exploreAnalysisRevision.create({ data: { id: "r-de", analysisId: "s-de", number: 7, code: CODE, codeHash: "h1", params: '{"fdr":0.05}', inputs: '[{"alias":"counts","datasetId":"d-filtered","versionId":null}]', fileInputs: "[]", author: "user" } });
  await db.exploreAnalysis.create({ data: { id: "s-filter", flowId: "f1", name: "Filter", position: "a", currentRevisionId: "r-filter", language: "r", environmentName: "seqdesk-explore-r", packages: null, paramMeta: null, methodsSentence: null } });
  await db.exploreAnalysis.create({ data: { id: "s-de", flowId: "f1", name: "DESeq2", position: "b", currentRevisionId: "r-de", language: "r", environmentName: "seqdesk-explore-r", packages: null,
    paramMeta: { fdr: { label: "FDR", min: 0, max: 0.2 } }, methodsSentence: { text: "Tested with DESeq2 (Wald test, FDR {fdr}).", tokens: [{ key: "fdr", value: 0.05 }], author: "person" } } });
  await db.exploreAnalysisRun.create({ data: { analysisId: "s-de", status: "completed", results: JSON.stringify({ metrics: { n_called: 1146 }, ledger: [{ label: "Genes", in: 16884, out: 1146 }] }) } });
}
const body = (over: Record<string, unknown> = {}) => parseSentenceChange({
  before: "Tested with DESeq2 (Wald test, FDR {fdr}).", after: "Tested with DESeq2 (likelihood ratio test, FDR {fdr}).", baseRevisionId: "r-de",
  params: {}, code: CODE.replace('test = "Wald"', 'test = "LRT", reduced = ~ 1'), why: "LRT against the reduced model.",
  checks: [{ ok: true, text: "Every number in the sentence is a setting or a run value" }, { ok: true, note: true, text: "Needs a new run; Run #14 keeps the old result" }], ...over,
});

describe("sentence changes: parsing and the server's checks", () => {
  it("validates the body", () => {
    expect(() => parseSentenceChange({ before: "a", baseRevisionId: "r" })).toThrow(/needs the edited sentence/);
    expect(() => parseSentenceChange({ after: "a" })).toThrow(/baseRevisionId/);
    expect(() => parseSentenceChange({ after: "a", baseRevisionId: "r", params: { "bad key": 1 } })).toThrow(/not a setting name/);
    expect(() => parseSentenceChange({ after: "a", baseRevisionId: "r", params: { x: { nested: 1 } } })).toThrow(/needs a number, text or yes\/no/);
    expect(() => parseSentenceChange({ after: "x".repeat(1001), baseRevisionId: "r" })).toThrow(/too long/);
    const parsed = parseSentenceChange({ after: " b ", baseRevisionId: "r", ignored: ["also delete step 1", 5], inputs: [{ alias: "counts", table: "qc" }, { alias: "x" }] });
    expect(parsed.after).toBe("b");
    expect(parsed.ignored).toEqual(["also delete step 1"]);
    expect(parsed.inputs).toEqual([{ alias: "counts", table: "qc" }]);
  });
  it("keeps a mismatch on a sentence only in its known shape", () => {
    expect(parseMethodsMismatch({ words: "step 3 uses TMM", previous: "Counts were normalised with {method}.", changeTo: "median of ratios", key: "bad key!", value: { x: 1 } }))
      .toEqual({ words: "step 3 uses TMM", previous: "Counts were normalised with {method}.", changeTo: "median of ratios" });
    expect(parseMethodsMismatch({ words: "" })).toBeNull();
    expect(parseMethodsMismatch("text")).toBeNull();
  });
  it("reads packages, tables, names and numbers", () => {
    expect(specPackages("name: x\nchannels:\n  - conda-forge\ndependencies:\n  - r-base=4.5.*\n  - bioconductor-deseq2\n")).toEqual(["r-base", "bioconductor-deseq2"]);
    expect(codePackage("bioconductor-deseq2")).toBe("deseq2");
    expect(codePackage("scikit-bio>=0.6")).toBe("skbio");
    expect(codeTables(CODE)).toEqual({ reads: ["filtered_counts"], writes: ["de_results"] });
    expect(namedPackages('library(vegan)\nx <- coin::wilcox_test(y)\n# z::w()', "r")).toEqual(["coin", "vegan"]);
    expect(namedPackages("from scipy import stats\nimport skbio.diversity\n", "python")).toEqual(["skbio", "scipy"]);
    expect(literalNumbers("At 6 h, {n_called} genes passed FDR {fdr}% and 2-fold, version 1.38.0")).toEqual([6, 2]);
  });
  it("refuses settings, numbers, tables and packages that do not fit, and a change that changes nothing", () => {
    const step: StepForCheck = { label: "4", language: "r", params: [{ key: "fdr", value: 0.05, label: "FDR", min: 0, max: 0.2 }, { key: "shrink", value: "apeglm", options: ["apeglm", "ashr"] }], code: CODE,
      runValues: [1146], ledgerNumbers: [16884, 1146], envPackages: ["r-base=4.5.*", "bioconductor-deseq2"] };
    const tables = new Set(["counts.tsv", "filtered_counts"]);
    const ok = checkSentenceChange({ before: "a", after: "Tested (LRT) at FDR {fdr}; 1,146 of 16,884 genes.", params: { fdr: 0.01 }, code: null, inputs: [] }, step, tables);
    expect(ok.problems).toEqual([]);
    expect(ok.params).toEqual({ fdr: { from: 0.05, to: 0.01 } });
    const problems = (input: Partial<Parameters<typeof checkSentenceChange>[0]>) => checkSentenceChange({ before: "", after: "Tested.", params: {}, code: null, inputs: [], ...input }, step, tables).problems.join(" | ");
    expect(problems({ params: { fdr: 0.5 } })).toMatch(/FDR can be at most 0.2/);
    expect(problems({ params: { fdr: "low" } })).toMatch(/FDR needs a number/);
    expect(problems({ params: { shrink: "normal" } })).toMatch(/shrink is one of apeglm, ashr/);
    expect(problems({ params: { other: 1 } })).toMatch(/other is not a setting of step 4/);
    expect(problems({ params: { fdr: 0.01 }, after: "Tested in 12 batches." })).toMatch(/12 in the sentence is neither a setting nor a recorded value/);
    expect(problems({ code: CODE.replace('sx.output("de_results", res)', 'sx.output("all_results", res)') })).toMatch(/writes all_results instead of de_results/);
    expect(problems({ code: `${CODE}x <- coin::wilcox_test(y)\n` })).toMatch(/coin is not in the step’s environment/);
    expect(problems({ inputs: [{ alias: "counts", table: "secret_table" }] })).toMatch(/secret_table is not a table in Data or made by an earlier step/);
    expect(problems({})).toMatch(/leaves step 4 as it is/);
    expect(problems({ code: `${CODE}# more`, params: {} })).toBe("");
  });
});

describe("sentence changes: propose, request, accept, undo", () => {
  beforeEach(seed);

  it("keeps a checked change in pencil; a newer edit replaces it; another step's id is never touched", async () => {
    const first = await proposeSentenceChange("s-de", body(), me);
    expect(first).toMatchObject({ kind: "step-change", state: "pending", analysisId: "s-de", text: "Tested with DESeq2 (likelihood ratio test, FDR {fdr})." });
    expect((first.values as Record<string, unknown>).requestTo).toBeNull();
    const second = await proposeSentenceChange("s-de", body({ why: "again" }), me);
    expect((await db.exploreStepProposal.findUnique({ where: { id: first.id } })).state).toBe("discarded");
    expect(second.state).toBe("pending");
    // The step and its sentence do not change until Accept.
    expect((await db.exploreAnalysis.findUnique({ where: { id: "s-de" } })).currentRevisionId).toBe("r-de");
    const filter = await db.exploreAnalysis.findUnique({ where: { id: "s-filter" } });
    expect(filter.currentRevisionId).toBe("r-filter");
  });

  it("refuses an edit made on an older revision or older words, and a change that does not pass the checks", async () => {
    await expect(proposeSentenceChange("s-de", body({ baseRevisionId: "r-old" }), me)).rejects.toMatchObject({ code: "step_conflict" });
    await expect(proposeSentenceChange("s-de", body({ before: "Other words." }), me)).rejects.toMatchObject({ code: "sentence_conflict" });
    await expect(proposeSentenceChange("s-de", body({ params: { fdr: 0.9 } }), me)).rejects.toMatchObject({ code: "invalid_request", extra: { problems: ["FDR can be at most 0.2"] } });
    expect(await db.exploreStepProposal.count({ where: { kind: "step-change" } })).toBe(0);
  });

  it("on a step someone else checked on the current run, it is a request to them: they are told and only they accept", async () => {
    await db.exploreRunHold.create({ data: { flowRunId: "run14", kind: "check", key: "labdesk://run/run14#step/s-de", memberId: anna.memberId, createdById: anna.userId } });
    expect(await checkerOf("f1", "s-de", me)).toEqual({ userId: "u-anna", memberId: "m-anna", name: "Anna Weber" });
    expect(await checkerOf("f1", "s-de", anna)).toBeNull();
    const proposal = await proposeSentenceChange("s-de", body(), me);
    expect((proposal.values as Record<string, unknown>).requestTo).toEqual({ userId: "u-anna", memberId: "m-anna", name: "Anna Weber" });
    const told = await db.inAppNotification.findMany({ where: { userId: "u-anna" } });
    expect(told).toHaveLength(1);
    expect(told[0].title).toMatch(/Ines Varga asks to change step 2 of DE, which you checked/);
    const row = await db.exploreStepProposal.findUnique({ where: { id: proposal.id } });
    expect(() => assertMayAccept(row, me)).toThrow(/Only Anna Weber can accept this change/);
    expect(() => assertMayAccept(row, anna)).not.toThrow();
  });

  it("Accept makes a new revision with the settings and code and keeps the edited sentence; Undo goes back", async () => {
    const proposal = await proposeSentenceChange("s-de", body({ params: { fdr: 0.01 } }), me);
    const row = await db.exploreStepProposal.findUnique({ where: { id: proposal.id } });
    await applySentenceChange(row, me);
    expect(state.revisions).toHaveLength(1);
    expect(state.revisions[0]).toMatchObject({ analysisId: "s-de", expectedRevisionId: "r-de", author: "agent", params: { fdr: 0.01 } });
    expect(state.revisions[0].code).toMatch(/test = "LRT", reduced = ~ 1/);
    const step = await db.exploreAnalysis.findUnique({ where: { id: "s-de" } });
    expect(step.currentRevisionId).not.toBe("r-de");
    expect(step.methodsSentence).toMatchObject({ text: "Tested with DESeq2 (likelihood ratio test, FDR {fdr}).", tokens: [{ key: "fdr", value: 0.01 }], author: "person", acceptedById: "u-me", acceptedByMemberId: "m-me", acceptedByName: "Ines Varga" });
    // Undo is refused for a proposal that was not accepted, then restores the previous revision and sentence.
    await expect(undoSentenceChange(proposal.id, me)).rejects.toMatchObject({ code: "invalid_request" });
    await db.exploreStepProposal.update({ where: { id: proposal.id }, data: { state: "accepted" } });
    const undone = await undoSentenceChange(proposal.id, me);
    expect(undone.proposal.state).toBe("undone");
    expect(state.revisions[1]).toMatchObject({ code: CODE, params: { fdr: 0.05 }, message: "Undo: back to revision 7" });
    expect((await db.exploreAnalysis.findUnique({ where: { id: "s-de" } })).methodsSentence).toMatchObject({ text: "Tested with DESeq2 (Wald test, FDR {fdr})." });
  });

  it("Accept is refused when the step changed meanwhile; Undo is refused when it changed again after", async () => {
    const proposal = await proposeSentenceChange("s-de", body(), me);
    await db.exploreAnalysis.update({ where: { id: "s-de" }, data: { currentRevisionId: "r-other" } });
    const row = await db.exploreStepProposal.findUnique({ where: { id: proposal.id } });
    await expect(applySentenceChange(row, me)).rejects.toMatchObject({ code: "step_conflict" });
    await db.exploreAnalysis.update({ where: { id: "s-de" }, data: { currentRevisionId: "r-de" } });
    await applySentenceChange(row, me);
    await db.exploreStepProposal.update({ where: { id: proposal.id }, data: { state: "accepted" } });
    await db.exploreAnalysis.update({ where: { id: "s-de" }, data: { currentRevisionId: "r-someone-else" } });
    await expect(undoSentenceChange(proposal.id, me)).rejects.toMatchObject({ code: "step_conflict" });
  });

  it("a table read instead goes through the step's input check on Accept", async () => {
    const proposal = await proposeSentenceChange("s-de", body({ code: null, inputs: [{ alias: "counts", table: "counts.tsv" }] }), me);
    expect((proposal.values as { inputs: unknown[] }).inputs).toEqual([{ alias: "counts", from: "filtered_counts", to: "counts.tsv", datasetId: "d-counts" }]);
    await applySentenceChange((await db.exploreStepProposal.findUnique({ where: { id: proposal.id } })), me);
    expect(state.inputs).toEqual([{ stepId: "s-de", inputs: [{ alias: "counts", datasetId: "d-counts" }], expectedRevisionId: "r-de", actor: me }]);
    expect(state.revisions).toHaveLength(0);
  });
});
