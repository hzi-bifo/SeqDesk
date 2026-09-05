import { describe, expect, it } from "vitest";
import { CANVAS_SIZES, layoutCanvas, pickPreviewColumns, type CanvasGraph } from "./canvas-layout";

const columns = [
  { key: "sample_db_id", label: "Sample record", type: "string" as const },
  { key: "sample_id", label: "Sample ID", type: "string" as const },
  { key: "pipeline_run", label: "Run", type: "string" as const },
  { key: "speciesName", label: "speciesName", type: "string" as const },
  { key: "numReads", label: "numReads", type: "number" as const },
  { key: "depth", label: "depth", type: "number" as const },
];

describe("pickPreviewColumns", () => {
  it("prefers the sample label and role columns over ids", () => {
    const picked = pickPreviewColumns(columns, { sample: "sample_db_id", taxon: "speciesName", count: "numReads" });
    expect(picked.map((column) => column.key)).toEqual(["sample_id", "speciesName", "numReads"]);
  });

  it("falls back to schema order without roles and skips database ids", () => {
    const picked = pickPreviewColumns(columns, {});
    expect(picked.map((column) => column.key)).toEqual(["sample_id", "pipeline_run", "speciesName"]);
  });

  it("uses the study table's sample id label for a samples dataset", () => {
    const studyColumns = [
      { key: "sample_db_id", label: "Sample record", type: "string" as const },
      { key: "_sampleId", label: "Sample ID", type: "string" as const },
      { key: "_organism", label: "Organism", type: "string" as const },
      { key: "checklist:host_subject_id", label: "Host Subject ID", type: "string" as const },
    ];
    const picked = pickPreviewColumns(studyColumns, { sample: "sample_db_id", subject: "checklist:host_subject_id" });
    expect(picked.map((column) => column.key)).toEqual(["_sampleId", "checklist:host_subject_id", "_organism"]);
  });
});

describe("layoutCanvas", () => {
  const graph: CanvasGraph = {
    nodes: [
      { id: "source:study:s1", data: { kind: "source", sourceType: "study", label: "Cohort" } },
      { id: "dataset:d1", data: { kind: "dataset", datasetId: "d1", name: "Samples", datasetKind: "samples", tableKind: null, sensitivity: "standard", version: 1, rowCount: 3, columnCount: 2, previewColumns: [], columns: [], roles: {}, previewRows: [], views: [] } },
      { id: "analysis:a1", data: { kind: "analysis", analysisId: "a1", name: "Summary", kitId: "table-summary", language: "python", revision: 1, codePreview: "print(1)", codeLines: 1, latestRun: null } },
      { id: "dataset:d2", data: { kind: "dataset", datasetId: "d2", name: "Derived", datasetKind: "derived", tableKind: null, sensitivity: "standard", version: 1, rowCount: 1, columnCount: 1, previewColumns: [], columns: [], roles: {}, previewRows: [], views: [] } },
      { id: "figure:r1:overview", data: { kind: "figure", artifactId: "f1", runId: "r1", name: "overview", format: "plotly-json", url: "/x" } },
    ],
    edges: [
      { id: "e1", source: "source:study:s1", target: "dataset:d1" },
      { id: "e2", source: "dataset:d1", target: "analysis:a1" },
      { id: "e3", source: "analysis:a1", target: "dataset:d2" },
      { id: "e4", source: "analysis:a1", target: "figure:r1:overview" },
    ],
  };

  it("places nodes in lineage order from left to right", () => {
    const positions = layoutCanvas(graph);
    expect(positions["source:study:s1"].x).toBeLessThan(positions["dataset:d1"].x);
    expect(positions["dataset:d1"].x).toBeLessThan(positions["analysis:a1"].x);
    expect(positions["analysis:a1"].x).toBeLessThan(positions["dataset:d2"].x);
    // The derived dataset and the figure share a rank and are stacked.
    expect(positions["dataset:d2"].x).toBe(positions["figure:r1:overview"].x);
    expect(positions["dataset:d2"].y).not.toBe(positions["figure:r1:overview"].y);
  });

  it("reserves more room for expanded datasets", () => {
    const collapsed = layoutCanvas({ ...graph, nodes: [graph.nodes[1], graph.nodes[3]], edges: [] });
    const expanded = layoutCanvas({ ...graph, nodes: [graph.nodes[1], graph.nodes[3]], edges: [] }, { expanded: new Set(["dataset:d1"]) });
    expect(expanded["dataset:d2"].y - collapsed["dataset:d2"].y).toBeGreaterThan(CANVAS_SIZES.dataset.height);
  });

  it("survives cycles", () => {
    const cyclic: CanvasGraph = { nodes: graph.nodes.slice(1, 3), edges: [{ id: "a", source: "dataset:d1", target: "analysis:a1" }, { id: "b", source: "analysis:a1", target: "dataset:d1" }] };
    expect(() => layoutCanvas(cyclic)).not.toThrow();
  });
});

describe("codePreviewOf", () => {
  it("skips docstrings, comments and blank lines and truncates long lines", async () => {
    const { codePreviewOf } = await import("./canvas");
    const code = `"""Doc\nstring."""\n\n# comment\nimport pandas as pd\n\ndf = pd.DataFrame()\n${"x".repeat(120)}\nprint(df)\n`;
    const preview = codePreviewOf(code, 3);
    expect(preview.split("\n")).toEqual(["import pandas as pd", "df = pd.DataFrame()", `${"x".repeat(87)}...`]);
    expect(codePreviewOf('"""one line"""\nprint(1)\n', 2)).toBe("print(1)");
  });
});

describe("assignCanvasHues", () => {
  it("colours inputs by kind, compute amber, and turns outputs a third of the wheel", async () => {
    const { assignCanvasHues, COMPUTE_HUE } = await import("./canvas-layout");
    const graph: CanvasGraph = {
      nodes: [
        { id: "source:study:s1", data: { kind: "source", sourceType: "study", label: "Cohort" } },
        { id: "dataset:in", data: { kind: "dataset", datasetId: "in", name: "In", datasetKind: "pipeline-table", tableKind: null, sensitivity: "standard", version: 1, rowCount: 1, columnCount: 1, previewColumns: [], columns: [], roles: {}, previewRows: [], views: [] } },
        { id: "analysis:a", data: { kind: "analysis", analysisId: "a", name: "A", kitId: null, language: "python", revision: 1, codePreview: "", codeLines: 0, latestRun: null } },
        { id: "dataset:out", data: { kind: "dataset", datasetId: "out", name: "Out", datasetKind: "derived", tableKind: null, sensitivity: "standard", version: 1, rowCount: 1, columnCount: 1, previewColumns: [], columns: [], roles: {}, previewRows: [], views: [] } },
        { id: "figure:r:f", data: { kind: "figure", artifactId: "f", runId: "r", name: "f", format: "png", url: "/f" } },
        { id: "analysis:b", data: { kind: "analysis", analysisId: "b", name: "B", kitId: null, language: "python", revision: 1, codePreview: "", codeLines: 0, latestRun: null } },
        { id: "dataset:out2", data: { kind: "dataset", datasetId: "out2", name: "Out 2", datasetKind: "derived", tableKind: null, sensitivity: "standard", version: 1, rowCount: 1, columnCount: 1, previewColumns: [], columns: [], roles: {}, previewRows: [], views: [] } },
      ],
      edges: [
        { id: "1", source: "source:study:s1", target: "dataset:in" },
        { id: "2", source: "dataset:in", target: "analysis:a" },
        { id: "3", source: "analysis:a", target: "dataset:out" },
        { id: "4", source: "analysis:a", target: "figure:r:f" },
        { id: "5", source: "dataset:out", target: "analysis:b" },
        { id: "6", source: "analysis:b", target: "dataset:out2" },
      ],
    };
    const hues = assignCanvasHues(graph);
    expect(hues["source:study:s1"]).toBeNull();
    expect(hues["dataset:in"]).toBe(140);
    expect(hues["analysis:a"]).toBe(COMPUTE_HUE);
    expect(hues["dataset:out"]).toBe(260);
    expect(hues["figure:r:f"]).toBe(260);
    expect(hues["dataset:out2"]).toBe(20);
  });
});
