import { describe, expect, it } from "vitest";
import { ReportBlockSchema, type ReportBlock } from "./report-blocks";
import { toInput } from "./report-input";
import type { ReportView } from "./reports";

/** One block of every type with every optional field set. */
const blocks: ReportBlock[] = [
  { id: "t1", type: "text", markdown: "## Hi\n\n`r step.n`", span: 2 },
  { id: "f1", type: "figure", analysisId: "a1", figureName: "plot", caption: "A plot", span: 1 },
  { id: "tb", type: "table", datasetId: "d1", caption: "Rows", rows: 20, columns: ["a", "b"], sort: { column: "a", direction: "desc" }, filter: 'a > 1 & b == "x"', search: true, sortable: true, download: true, span: 2 },
  { id: "c1", type: "chart", datasetId: "d1", chart: "box", x: "a", y: "b", color: "c", caption: "Box", span: 1 },
  { id: "m1", type: "metric", datasetId: "d1", column: "a", stats: ["mean", "max"], label: "A", span: 1 },
  { id: "v1", type: "view", datasetId: "d1", view: "heatmap", options: { top: 10 }, caption: "Heat", span: 2 },
  { id: "x1", type: "taxon-explorer", datasetId: "d1", taxon: "E. coli", caption: "Taxon", span: 2 },
  { id: "s1", type: "subject", datasetId: "d1", subject: "A0001", measure: "ra", caption: "Subject", span: 2 },
  { id: "u1", type: "curated", datasetId: "d1", role: "pathogen", lists: ["l1"], limit: 10, caption: "Curated", span: 2 },
  {
    id: "r1",
    type: "run-metric",
    analysisId: "a1",
    metrics: ["n_subjects", "n_taxa"],
    figures: [{ id: "g1", datasetId: "d1", column: "reads", stat: "median" }],
    order: ["f:g1", "n_taxa", "n_subjects"],
    labels: { n_subjects: "Subjects" },
    digits: { n_taxa: 0 },
    units: { n_subjects: "people" },
    targets: { n_subjects: { min: 300 } },
    columns: 3,
    trend: "previous",
    trends: { n_taxa: "timeline" },
    timeline: { n_taxa: "distinct:taxon" },
    label: "In numbers",
    span: 2,
  },
];

describe("the editor's draft of a saved page", () => {
  it("keeps every field an author can set, for every block type", () => {
    for (const block of blocks) expect(ReportBlockSchema.safeParse(block).success, `${block.type} fixture is valid`).toBe(true);
    const view = { title: "Report", filters: [], blocks: blocks.map((block) => ({ ...block, table: null, figure: null, analysis: null, available: true })) } as unknown as ReportView;
    expect(toInput(view)).toEqual({ title: "Report", filters: [], blocks });
  });
});
