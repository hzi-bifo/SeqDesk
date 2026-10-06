import { describe, expect, it } from "vitest";
import { nameKey, outputNameOf, proposalStepInputs, resolveNamedInput, type ProposalInputContext } from "./proposal-inputs";

const ctx = (over: Partial<ProposalInputContext> = {}): ProposalInputContext => ({
  datasets: [
    { id: "d-meta", name: "metadata", producer: null, artifactName: null },
    { id: "d-genus", name: "genus", producer: null, artifactName: null },
    { id: "d-sum", name: "summary (Table summary)", producer: "s1", artifactName: "summary" },
    { id: "d-other", name: "other (Elsewhere)", producer: "s-other-flow", artifactName: "other" },
  ],
  stepIds: new Set(["s1"]),
  flowDatasetIds: new Set(["d-genus"]),
  siblings: [],
  ...over,
});

describe("proposal inputs", () => {
  it("compares names by their words, without a version or the producing step", () => {
    expect(nameKey("metadata v1")).toBe("metadata");
    expect(nameKey("summary (Table summary)")).toBe("summary");
    expect(nameKey("Sample counts by diagnosis")).toBe(nameKey("sample_counts_by_diagnosis"));
    expect(outputNameOf("Sample counts by diagnosis")).toBe("sample_counts_by_diagnosis");
  });

  it("resolves a Data table, a step output and an accepted pencil step's output", () => {
    expect(resolveNamedInput("metadata v1", ctx())).toEqual({ datasetId: "d-meta" });
    expect(resolveNamedInput("summary", ctx())).toEqual({ from: { stepId: "s1", output: "summary" } });
    const siblings = [{ id: "p1", purpose: "Count samples", state: "accepted", acceptedAnalysisId: "s1", outputs: [{ kind: "table", name: "Sample counts by diagnosis" }] }];
    expect(resolveNamedInput("Sample counts by diagnosis", ctx({ siblings }))).toEqual({ from: { stepId: "s1", output: "sample_counts_by_diagnosis" } });
  });

  it("asks for the upstream pencil step first, and refuses names it cannot find or another flow's outputs", () => {
    const siblings = [{ id: "p1", purpose: "Count samples", state: "pending", acceptedAnalysisId: null, outputs: [{ name: "Sample counts" }] }];
    expect(() => resolveNamedInput("Sample counts", ctx({ siblings }))).toThrow(/Accept "Count samples" first/);
    expect(() => resolveNamedInput("Input data", ctx())).toThrow(/not a table in this analysis/);
    expect(() => resolveNamedInput("other", ctx())).toThrow(/not a table in this analysis/);
  });

  it("prefers the flow's own table when the study has two of that name", () => {
    const datasets = [...ctx().datasets, { id: "d-genus-2", name: "genus", producer: null, artifactName: null }];
    expect(resolveNamedInput("genus", ctx({ datasets }))).toEqual({ datasetId: "d-genus" });
    expect(() => resolveNamedInput("genus", ctx({ datasets, flowDatasetIds: new Set() }))).toThrow(/2 tables of that name/);
  });

  it("keeps typed references and valid aliases, drops aliases that are names, and reads one table once", () => {
    expect(proposalStepInputs([
      { alias: "metadata v1" },
      { alias: "counts", datasetId: "d-genus" },
      { alias: "metadata" },
      { alias: "s", from: { stepId: "s1", output: "summary" } },
    ], ctx())).toEqual([
      { datasetId: "d-meta" },
      { alias: "counts", datasetId: "d-genus" },
      { alias: "s", from: { stepId: "s1", output: "summary" } },
    ]);
  });
});
