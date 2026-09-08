import { describe, expect, it } from "vitest";
import { activeFiltersFromSearchParams, escapeHtml, renderReportDocument, type ExportTable, type RenderInput } from "./report-export";
import type { ReportView } from "./reports";

const columns = [
  { key: "sample_id", label: "Sample", type: "string" as const },
  { key: "reads", label: "Reads", type: "number" as const },
  { key: "site", label: "Site", type: "string" as const },
];

const samples: ExportTable = {
  datasetId: "d-in",
  name: "Samples",
  columns,
  roles: {},
  records: [
    { rowIndex: 0, sampleId: "S1", subjectId: null, key: null, data: { sample_id: "S1", reads: 1000, site: "Urine" } },
    { rowIndex: 1, sampleId: "S2", subjectId: null, key: null, data: { sample_id: "S2", reads: 3000, site: "Urine" } },
    { rowIndex: 2, sampleId: "S3", subjectId: null, key: null, data: { sample_id: "S3", reads: 500, site: "Stool" } },
  ] as ExportTable["records"],
};

function report(): ReportView {
  return {
    id: "r1",
    targetKey: "study:s1",
    title: "Cohort <report>",
    share: null,
    filters: [{ id: "f-site", datasetId: "d-in", column: "site", label: "Site" }],
    draft: false,
    updatedAt: "2026-09-05T10:00:00.000Z",
    blocks: [
      { id: "t1", type: "text", markdown: "## Intro\n\nA table:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>" },
      { id: "tab", type: "table", datasetId: "d-in", rows: 2, table: null },
      { id: "chart", type: "chart", datasetId: "d-in", chart: "histogram", x: "reads", table: null },
      { id: "metric", type: "metric", datasetId: "d-in", column: "reads", stats: ["count", "mean"], table: null },
      { id: "run", type: "run-metric", analysisId: "a1", metrics: ["n_samples", "permanova_group_R2"], analysis: { analysisId: "a1", name: "Beta diversity", runNumber: "EXP-9", metrics: { n_samples: 874, permanova_group_R2: 0.0629 } } },
      {
        id: "fig",
        type: "figure",
        analysisId: "a1",
        figureName: "pcoa",
        figure: { analysisId: "a1", analysisName: "Beta diversity", figureName: "pcoa", runId: "run1", runNumber: "EXP-9", format: "plotly-json", url: "/api/explore/runs/run1/artifacts/art1", thumbnailUrl: null, unchanged: false },
      },
      { id: "fig-gone", type: "figure", analysisId: "a1", figureName: "removed", figure: null },
    ] as ReportView["blocks"],
    outputs: { figures: [], tables: [], analyses: [] },
  };
}

function input(overrides: Partial<RenderInput> = {}): RenderInput {
  return {
    report: report(),
    scopeLabel: "Demo study",
    tables: new Map([["d-in", samples]]),
    artifacts: new Map([["a1:pcoa", { format: "plotly-json", content: Buffer.from(JSON.stringify({ data: [{ type: "scatter", x: [1, 2], y: [3, 4], name: "</script><b>" }], layout: { title: "PCoA", height: 300 } })) }]]),
    lists: [],
    curation: { memberships: {}, artifacts: [] },
    active: {},
    plotly: { src: "/share/assets/plotly.js" },
    generatedAt: new Date("2026-09-05T12:00:00Z"),
    ...overrides,
  };
}

describe("renderReportDocument", () => {
  it("renders every block kind with escaped text and embedded plots", () => {
    const html = renderReportDocument(input());
    expect(html).toContain("<title>Cohort &lt;report&gt;</title>");
    expect(html).toContain('<h2 id="block-t1">Intro</h2>');
    expect(html).toContain("<table>"); // the GFM table of the text block
    expect(html).not.toContain("<script>alert(1)</script>"); // raw HTML in markdown is dropped
    expect(html).toContain("<td>S1</td>");
    expect(html).not.toContain("<td>S3</td>"); // rows: 2
    expect(html).toContain("2 of 3 rows, 3 columns");
    expect(html).toContain("1,500"); // mean of reads in the numbers block
    expect(html).toContain(">874<");
    expect(html).toContain("permanova group R2");
    expect(html).toContain('id="plot-1"'); // histogram
    expect(html).toContain('id="plot-2"'); // pcoa figure
    expect(html).toContain("This figure is not produced by the analysis any more.");
    expect(html).toContain('<script src="/share/assets/plotly.js"></script>');
    // Plot JSON never closes the data script early, even when a trace name contains </script>.
    const plotData = html.slice(html.indexOf('id="plot-data">') + 15, html.indexOf("</script>", html.indexOf('id="plot-data">')));
    expect(plotData).not.toContain("</script>");
    expect(JSON.parse(plotData)).toHaveLength(2);
  });

  it("sets page filters aside for now: every row is shown even when a filter is active", () => {
    const html = renderReportDocument(input({ active: { "f-site": ["Stool"] } }));
    expect(html).not.toContain("Filtered:");
    expect(html).toContain("<td>S1</td>");
    expect(html).not.toContain("page filters applied");
  });

  it("inlines the Plotly source when asked", () => {
    const html = renderReportDocument(input({ plotly: { inline: "window.Plotly={};</script><script>alert(2)" } }));
    expect(html).toContain("<script>window.Plotly={};<\\/script><script>alert(2)</script>");
  });
});

describe("activeFiltersFromSearchParams", () => {
  it("reads repeatable f.<id> parameters and ignores the rest", () => {
    const params = new URLSearchParams("f.site=Urine&f.site=Stool&f.empty=&plotly=cdn");
    expect(activeFiltersFromSearchParams(params)).toEqual({ site: ["Urine", "Stool"] });
    expect(escapeHtml('<a href="x">')).toBe("&lt;a href=&quot;x&quot;&gt;");
  });
});

describe("dashboard numbers on the shared page", () => {
  const profile: ExportTable = {
    datasetId: "d-time",
    name: "Profiles",
    columns: [
      { key: "sample", label: "Sample", type: "string" as const },
      { key: "timepoint", label: "Study day", type: "number" as const },
      { key: "reads", label: "Reads", type: "number" as const },
    ],
    roles: { sample: "sample", timepoint: "timepoint", count: "reads" },
    records: [
      { rowIndex: 0, sampleId: "S1", subjectId: null, key: null, data: { sample: "S1", timepoint: 10, reads: 100 } },
      { rowIndex: 1, sampleId: "S2", subjectId: null, key: null, data: { sample: "S2", timepoint: 40, reads: 300 } },
      { rowIndex: 2, sampleId: "S3", subjectId: null, key: null, data: { sample: "S3", timepoint: 400, reads: 500 } },
    ] as ExportTable["records"],
  };

  it("renders table figures with units and a timeline sparkline, and says when a table is gone", () => {
    const base = report();
    const view: ReportView = {
      ...base,
      blocks: [
        {
          id: "kf",
          type: "run-metric",
          metrics: [],
          figures: [
            { id: "g1", datasetId: "d-time", column: "reads", stat: "median" },
            { id: "g2", datasetId: "d-gone", column: "x", stat: "count" },
          ],
          labels: { "f:g1": "Reads per sample" },
          units: { "f:g1": "reads" },
          trends: { "f:g1": "timeline" },
          analysis: null,
        } as ReportView["blocks"][number],
      ],
    };
    const tables = new Map<string, ExportTable>([["d-time", profile]]);
    const html = renderReportDocument(input({ report: view, tables }));
    expect(html).toContain("300 reads");
    expect(html).toContain("Reads per sample");
    expect(html).toContain('class="spark"');
    expect(html).toMatch(/from day \d+ to day \d+/);
    expect(html).toContain("table missing");
    expect(html).toContain("Profiles");
  });
});
