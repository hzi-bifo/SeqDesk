import { describe, expect, it } from "vitest";
import { generationItems, generationSnapshot, outputSummary, type GenerationSnapshot } from "./report-generation";
import { ReportBlockSchema } from "./report-blocks";
import { serializeInputs } from "./input-validation";

const snapshot: GenerationSnapshot = { version: 1, requestHash: "hash", name: "User-defined measurement overview", description: "Measures from a custom pipeline", outputs: [
  { name: "distribution", kind: "figure", label: "Value distribution", report: { span: 1 } },
  { name: "measurements", kind: "table", label: "Measurements" },
  { name: "optional_mate", kind: "figure", optional: true },
  { name: "debug", kind: "report", report: { include: false } },
], report: { metrics: [{ key: "count", label: "Measured samples", digits: 0 }, { key: "missing", label: "Missing", unit: "reads" }] } };
const input = { analysisId: "gen_abcdefghijklmnopqrstuvwx", runId: "run1", runNumber: "EXP-001", snapshot, artifacts: [
  { id: "a1", name: "distribution", kind: "figure", format: "plotly-json", derivedDatasetId: null },
  { id: "a2", name: "distribution", kind: "figure", format: "png", derivedDatasetId: null },
  { id: "a3", name: "measurements", kind: "table", format: "tsv", derivedDatasetId: "derived1" },
], metrics: { count: 3, missing: null } };

describe("manifest-driven report draft", () => {
  it("uses actual outputs and author labels without any pipeline-name branches", () => {
    const result = generationItems(input);
    expect(result.items.map(item => item.label)).toEqual([snapshot.name, "Summary metrics", "Value distribution", "Measurements"]);
    expect(result.items[1].block).toMatchObject({ type: "run-metric", metrics: ["count"], labels: { count: "Measured samples" } });
    expect(result.items[2].block).toMatchObject({ span: 1, figureName: "distribution" });
    expect(result.warnings).toEqual([]);
    expect(ReportBlockSchema.array().safeParse(result.items.map(item => item.block)).success).toBe(true);
  });
  it("does not create duplicate figures for multiple formats", () => {
    expect(generationItems(input).items.filter(item => item.block.type === "figure")).toHaveLength(1);
  });
  it("does not add empty placeholders for missing, unpromoted or failed outputs", () => {
    const result = generationItems({ ...input, artifacts: [], metrics: {} });
    expect(result.items).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join()).not.toContain("Optional mate");
  });
  it("preserves notes and limitations for selection onto the report", () => {
    const result = generationItems({ ...input, notes: ["Only one sample; no independent replicates."] });
    expect(result.items.at(-1)?.block).toMatchObject({ type: "text", markdown: expect.stringContaining("no independent replicates") });
  });
  it("counts output types from declarations and hides excluded outputs", () => {
    expect(outputSummary(snapshot.outputs)).toBe("2 charts · 1 table");
    expect(outputSummary([])).toContain("depend on");
  });
  it("keeps snapshots in the existing versioned envelope and reads legacy inputs", () => {
    const raw = serializeInputs([{ alias: "table", datasetId: "d1", versionId: "v1" }], [], snapshot);
    expect(generationSnapshot(raw)).toEqual(snapshot);
    expect(generationSnapshot("[]")).toBeNull();
    expect(generationSnapshot("broken")).toBeNull();
  });
  it("uses safe internal download links for report outputs and escapes artifact labels", () => {
    const result = generationItems({ ...input, snapshot: { ...snapshot, report: undefined, outputs: [{ name: "report", kind: "report", label: "[unsafe](javascript:bad)" }] }, artifacts: [{ id: "report/id", name: "report", kind: "report", format: "html", derivedDatasetId: null }], metrics: {} });
    expect(result.items.at(-1)?.block).toMatchObject({ type: "text", markdown: expect.stringContaining("/artifacts/report%2Fid?download=1") });
    expect(result.items.at(-1)?.block).toMatchObject({ markdown: expect.stringContaining("\\[unsafe\\]") });
  });
});
