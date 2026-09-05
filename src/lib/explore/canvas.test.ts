import { describe, expect, it } from "vitest";
import { CANVAS_SIZES, CANVAS_EXPANDED_DATASET, layoutCanvas, pickPreviewColumns, type CanvasGraph } from "./canvas-layout";

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
      { id: "dataset:d1", data: { kind: "dataset", datasetId: "d1", name: "Samples", datasetKind: "samples", tableKind: null, sensitivity: "standard", origin: "", version: 1, rowCount: 3, columnCount: 2, previewColumns: [], columns: [], roles: {}, previewRows: [], views: [] } },
      { id: "analysis:a1", data: { kind: "analysis", analysisId: "a1", name: "Summary", kitId: "table-summary", language: "python", revision: 1, codePreview: "print(1)", codeLines: 1, latestRun: null, active: false } },
      { id: "dataset:d2", data: { kind: "dataset", datasetId: "d2", name: "Derived", datasetKind: "derived", tableKind: null, sensitivity: "standard", origin: "", version: 1, rowCount: 1, columnCount: 1, previewColumns: [], columns: [], roles: {}, previewRows: [], views: [] } },
      { id: "figure:r1:overview", data: { kind: "figure", artifactId: "f1", runId: "r1", name: "overview", format: "plotly-json", url: "/x", thumbnailUrl: null } },
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
    expect(expanded["dataset:d2"].y - collapsed["dataset:d2"].y).toBe(CANVAS_EXPANDED_DATASET.height - CANVAS_SIZES.dataset.height);
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
        { id: "dataset:in", data: { kind: "dataset", datasetId: "in", name: "In", datasetKind: "pipeline-table", tableKind: null, sensitivity: "standard", origin: "", version: 1, rowCount: 1, columnCount: 1, previewColumns: [], columns: [], roles: {}, previewRows: [], views: [] } },
        { id: "analysis:a", data: { kind: "analysis", analysisId: "a", name: "A", kitId: null, language: "python", revision: 1, codePreview: "", codeLines: 0, latestRun: null, active: false } },
        { id: "dataset:out", data: { kind: "dataset", datasetId: "out", name: "Out", datasetKind: "derived", tableKind: null, sensitivity: "standard", origin: "", version: 1, rowCount: 1, columnCount: 1, previewColumns: [], columns: [], roles: {}, previewRows: [], views: [] } },
        { id: "figure:r:f", data: { kind: "figure", artifactId: "f", runId: "r", name: "f", format: "png", url: "/f", thumbnailUrl: null } },
        { id: "analysis:b", data: { kind: "analysis", analysisId: "b", name: "B", kitId: null, language: "python", revision: 1, codePreview: "", codeLines: 0, latestRun: null, active: false } },
        { id: "dataset:out2", data: { kind: "dataset", datasetId: "out2", name: "Out 2", datasetKind: "derived", tableKind: null, sensitivity: "standard", origin: "", version: 1, rowCount: 1, columnCount: 1, previewColumns: [], columns: [], roles: {}, previewRows: [], views: [] } },
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

describe("originLabel", () => {
  it("describes where a dataset came from", async () => {
    const { originLabel } = await import("./canvas");
    expect(originLabel([{ type: "file", id: "x.tsv", label: "x.tsv" }], "external")).toBe("Imported from x.tsv");
    expect(originLabel([{ type: "pipeline-run", id: "r1", label: "MET-1" }], "pipeline-table")).toBe("From pipeline run MET-1");
    expect(originLabel([{ type: "pipeline-run", id: "r1" }, { type: "pipeline-run", id: "r2" }], "pipeline-table")).toBe("From 2 pipeline runs");
    expect(originLabel([{ type: "study", id: "s1" }], "samples")).toBe("Built from the study");
    expect(originLabel([{ type: "study", id: "s1" }], "sequencing")).toBe("Sequencing runs of the study");
    expect(originLabel([], "derived")).toBe("Written by an analysis");
  });
});

describe("nodeSize", () => {
  it("prefers a user size, then the expanded preset, then the default", async () => {
    const { nodeSize, CANVAS_SIZES, CANVAS_EXPANDED_DATASET } = await import("./canvas-layout");
    const node = { id: "dataset:d", data: { kind: "dataset" as const, datasetId: "d", name: "D", datasetKind: "samples", tableKind: null, sensitivity: "standard", origin: "", version: 1, rowCount: 1, columnCount: 1, previewColumns: [], columns: [], roles: {}, previewRows: [], views: [] } };
    expect(nodeSize(node)).toEqual(CANVAS_SIZES.dataset);
    expect(nodeSize(node, { expanded: new Set(["dataset:d"]) })).toEqual(CANVAS_EXPANDED_DATASET);
    expect(nodeSize(node, { expanded: new Set(["dataset:d"]), sizes: { "dataset:d": { width: 500, height: 300 } } })).toEqual({ width: 500, height: 300 });
  });
});

describe("usedColumnKeys", () => {
  const table = [
    { key: "sample_db_id", label: "Sample record", type: "string" as const },
    { key: "sample_id", label: "Sample ID", type: "string" as const },
    { key: "speciesName", label: "speciesName", type: "string" as const },
    { key: "numReads", label: "numReads", type: "number" as const },
    { key: "depth", label: "depth", type: "number" as const },
  ];

  it("maps the roles the code asks for and the keys it quotes onto columns", async () => {
    const { usedColumnKeys } = await import("./canvas-layout");
    const code = 'sample = sx.role_column(df, "sample", required=False)\ncounts = df["numReads"].sum()\nprint("depth is unused text")';
    // The code names a role, so the roles the kit declares (value) do not count; "depth" only appears inside a longer string.
    expect(usedColumnKeys({ code, columns: table, roles: { sample: "sample_db_id", count: "numReads", value: "depth" }, declaredRoles: ["value"] })).toEqual([
      "sample_db_id",
      "sample_id",
      "numReads",
    ]);
  });

  it("does not mistake a role name passed to the helper for a column of the same name", async () => {
    const { usedColumnKeys } = await import("./canvas-layout");
    const columns = [...table, { key: "sample", label: "sample", type: "string" as const }];
    expect(usedColumnKeys({ code: 'sx.role_column(df, "sample")', columns, roles: { sample: "sample_id" } })).toEqual(["sample_id"]);
  });

  it("falls back to the roles a kit declares when the code names none", async () => {
    const { usedColumnKeys } = await import("./canvas-layout");
    expect(usedColumnKeys({ code: "df.describe()", columns: table, roles: { taxon: "speciesName", count: "numReads" }, declaredRoles: ["taxon", "group"] })).toEqual(["speciesName"]);
    expect(usedColumnKeys({ code: "df.describe()", columns: table, roles: { taxon: "speciesName" } })).toEqual([]);
  });
});

describe("foldColumns", () => {
  const cols = ["a", "b", "c", "d", "e", "f"].map((key) => ({ key, label: key, type: "string" as const }));

  it("keeps anchor columns open and folds the runs between them", async () => {
    const { foldColumns } = await import("./canvas-layout");
    const segments = foldColumns(cols, new Set(["a", "d"]));
    expect(segments.map((segment) => (segment.kind === "fold" ? `+${segment.columns.length}` : segment.column.key))).toEqual(["a", "+2", "d", "+2"]);
  });

  it("opens a fold on request and marks its first column", async () => {
    const { foldColumns } = await import("./canvas-layout");
    const segments = foldColumns(cols, new Set(["a", "d"]), new Set([0]));
    expect(segments.map((segment) => (segment.kind === "fold" ? `+${segment.columns.length}` : segment.column.key))).toEqual(["a", "b", "c", "d", "+2"]);
    expect(segments[1]).toMatchObject({ kind: "column", fold: 0, firstOfFold: true });
    expect(segments[2]).toMatchObject({ kind: "column", fold: 0, firstOfFold: false });
  });

  it("shows the plain table when nothing is worth keeping", async () => {
    const { foldColumns } = await import("./canvas-layout");
    expect(foldColumns(cols, new Set(["zzz"])).every((segment) => segment.kind === "column")).toBe(true);
  });

  it("fits segments into a width and counts what stays hidden", async () => {
    const { fitSegments, foldColumns, CANVAS_COLUMN_WIDTH, CANVAS_FOLD_WIDTH } = await import("./canvas-layout");
    const segments = foldColumns(cols, new Set(["a", "d", "f"]));
    const { shown, hiddenColumns } = fitSegments(segments, CANVAS_COLUMN_WIDTH * 2 + CANVAS_FOLD_WIDTH);
    expect(shown.map((segment) => segment.kind)).toEqual(["column", "fold", "column"]);
    expect(hiddenColumns).toBe(4);
    expect(fitSegments(segments, 10).shown).toHaveLength(1);
  });
});
