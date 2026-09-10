import { describe, expect, it } from "vitest";
import { withPipelineOutputUsage } from "./pipeline-output-usage";
import type { PipelineOutputSource } from "./pipeline-output-types";

const output: PipelineOutputSource = { id: "custom:table", pipelineId: "custom", pipelineName: "Custom", outputId: "table", label: "Measurements", kind: "table", table: { pipelineId: "custom", pipelineName: "Custom", outputId: "table", label: "Measurements", tableKind: "custom", format: "tsv", scope: "sample", runs: [] }, templates: [], runs: [{ id: "run1", runNumber: "RUN-1", completedAt: null, files: [{ id: "artifact1", name: "table.tsv", size: 10, kind: "table", sample: null, previewable: true }] }] };
const dataset = { id: "d1", sourceConfig: JSON.stringify({ builder: "pipeline-table", pipelineId: "custom", outputId: "table" }), currentVersionId: "v1", versions: [{ id: "v1", rowCount: 1, provenance: JSON.stringify({ sources: [{ type: "pipeline-run", id: "run1" }, { type: "artifact", id: "artifact1" }] }) }] };
const usage = (datasets = [dataset], blocks: unknown = []) => withPipelineOutputUsage([output], datasets, blocks)[0].runs[0].usage;
describe("pipeline table membership", () => {
  it("distinguishes available, in workspace, and placed on this report", () => {
    expect(usage([])).toBeUndefined();
    expect(usage()).toEqual({ datasetId: "d1", state: "workspace" });
    expect(usage([dataset], [{ id: "table:d1", type: "table", datasetId: "d1" }])).toEqual({ datasetId: "d1", state: "report" });
  });
  it("uses actual provenance, not source configuration or a different run", () => {
    expect(usage([{ ...dataset, sourceConfig: JSON.stringify({ builder: "pipeline-table", pipelineId: "custom", outputId: "table", runIds: ["run1"] }), versions: [{ ...dataset.versions[0], provenance: JSON.stringify({ sources: [{ type: "pipeline-run", id: "run2" }] }) }] }])).toBeUndefined();
  });
  it("does not count an empty, mixed-run or partially built table as added", () => {
    expect(usage([{ ...dataset, versions: [{ ...dataset.versions[0], rowCount: 0 }] }])).toBeUndefined();
    expect(usage([{ ...dataset, versions: [{ ...dataset.versions[0], provenance: JSON.stringify({ sources: [{ type: "pipeline-run", id: "run1" }, { type: "pipeline-run", id: "run2" }] }) }] }])).toBeUndefined();
    expect(usage([{ ...dataset, versions: [{ ...dataset.versions[0], provenance: JSON.stringify({ sources: [{ type: "pipeline-run", id: "run1" }] }) }] }])).toBeUndefined();
  });
  it("prefers the copy shown on the report if older data has duplicate datasets", () => {
    expect(usage([dataset, { ...dataset, id: "d2" }], [{ id: "on-page", type: "table", datasetId: "d2" }])).toEqual({ datasetId: "d2", state: "report" });
  });
});
