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
    sharing: { inputRows: false },
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
 it("exports a configured explorer using mapped fields and saved subject",()=>{
 const value=input();value.report.blocks=[{id:"custom",type:"subject",datasetId:"d-in",subject:"S2",explorer:{version:1,label:"Device",subject:"sample_id",time:"reads",panels:[{id:"values",kind:"measurement",title:"Mapped <measurement>",column:"reads",scope:"subject"}]}}];
 const html=renderReportDocument(value);expect(html).toContain("Device: S2");expect(html).toContain("Mapped &lt;measurement&gt;");const plots=JSON.parse(html.match(/id="plot-data">([\s\S]*?)<\/script>/)![1]);expect(plots[0].data[0].y).toEqual([3000]);
 });
  it("exports clinical-only visits for the selected patient without substituting another patient", () => {
    const value = input();
    value.report.blocks = [{id:"patient",type:"subject",datasetId:"patients",subject:"P2"}];
    const keys = ["patient_id","visit_day","library_id","sample_type","taxon","taxon_reads","aki"];
    value.tables.set("patients", {datasetId:"patients",name:"Patient records",roles:{subject:"patient_id",timepoint:"visit_day",sample:"library_id",group:"sample_type",taxon:"taxon",count:"taxon_reads"},columns:keys.map(key=>({key,label:key,type:"string" as const})),records:[
      {rowIndex:0,sampleId:"L1",subjectId:"P1",key:null,data:{patient_id:"P1",visit_day:1,library_id:"L1",sample_type:"Urine",taxon:"Organism",taxon_reads:50,aki:"no"}},
      {rowIndex:1,sampleId:null,subjectId:"P2",key:null,data:{patient_id:"P2",visit_day:7,library_id:"",sample_type:"",taxon:"",taxon_reads:null,aki:"yes"}},
    ]});
    const html = renderReportDocument(value);
    expect(html).toContain("Clinical visits · P2");
    expect(html).toContain("No retained sequenced libraries for P2");
    expect(html).toContain("<td>yes</td>");
    expect(html).not.toContain("<strong>P1</strong>");
  });

  it("exports named pages in order, escapes page titles and includes every block once", () => {
    const value = input();
    value.report.pages = [
      { id: "results", title: "Results <checked>", blockIds: value.report.blocks.slice(1).map(b => b.id) },
      { id: "intro", title: "Overview", blockIds: [value.report.blocks[0].id] },
    ];
    const html = renderReportDocument(value);
    expect(html).toContain("Results &lt;checked&gt;");
    expect(html.indexOf("Results &lt;checked&gt;")).toBeLessThan(html.indexOf("<h2>Overview</h2>"));
    expect(html.match(/class="report-named-page"/g)).toHaveLength(2);
    expect(html.match(/id="block-t1"/g)).toHaveLength(1);
    expect(html).toContain("break-before:page");
  });

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

describe("shared copies of Flow pages", () => {
  const inputTable = { datasetId: "d-in", name: "Samples", kind: "table", output: false, rowCount: 3, columnCount: 3, version: 1, latestWrite: null, columns, views: [], roles: {} };
  it("withholds the rows of uploaded tables unless the author allowed them", () => {
    const view = report();
    view.outputs = { figures: [], tables: [inputTable], analyses: [] };
    const html = renderReportDocument(input({ report: view }));
    expect(html).toContain("The rows are not part of this shared copy.");
    expect(html).toContain("3 rows × 3 columns");
    expect(html).not.toContain("<td>S1</td>");
    expect(html).toContain("1,500"); // aggregates of the same table stay: the numbers block
    view.sharing = { inputRows: true };
    expect(renderReportDocument(input({ report: view }))).toContain("<td>S1</td>");
  });
  it("shows what a step produced: output tables keep their rows", () => {
    const view = report();
    view.outputs = { figures: [], tables: [{ ...inputTable, output: true, producer: "a1" }], analyses: [] };
    expect(renderReportDocument(input({ report: view }))).toContain("<td>S1</td>");
  });
  it("renders findings as Markdown, other formats as text, and names the run", () => {
    const view = report();
    const analysis = { analysisId: "a1", name: "Alpha diversity", flowName: "Diversity", runNumber: "EXP-9", metrics: {} };
    view.blocks = [
      { id: "n", type: "finding", analysisId: "a1", analysis, finding: { name: null, format: "md", content: "Shannon **differs** between groups.\n\n<script>x()</script>", runNumber: "EXP-9" } },
      { id: "h", type: "finding", analysisId: "a1", name: "summary", caption: "Summary", analysis, finding: { name: "summary", format: "html", content: "<b>bold</b>", runNumber: "EXP-9" } },
      { id: "gone", type: "finding", analysisId: "a1", name: "old", analysis, finding: null },
    ] as ReportView["blocks"];
    const html = renderReportDocument(input({ report: view }));
    expect(html).toContain("Shannon <strong>differs</strong> between groups.");
    expect(html).not.toContain("<script>x()</script>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).toContain("Diversity · Alpha diversity · EXP-9");
    expect(html).toContain("The step no longer saves this text.");
  });
  it("appends the provenance of every cited step", () => {
    const html = renderReportDocument(input({ provenance: [
      { analysisId: "a1", flow: "Diversity", step: "Alpha diversity", kit: "alpha-diversity", revision: 3, codeHash: "abc123def456", runNumber: "EXP-9", completedAt: "2026-09-05T10:00:00.000Z", environment: "seqdesk-explore-python", inputs: [{ alias: "table", name: "Samples", version: 2, hash: "0123456789ab", pinned: false }] },
    ] }));
    expect(html).toContain('<section class="provenance"');
    expect(html).toContain("<code>abc123def456</code>");
    expect(html).toContain("Samples v2 <code>0123456789ab</code> (current at run time)");
    expect(html).toContain("kit alpha-diversity");
    expect(renderReportDocument(input())).not.toContain('class="provenance"');
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

  it("shows release state, keeps pinned key figures and figures, and warns about stale or missing values (B2, B7)", () => {
    const base = report();
    const value: RenderInput = input({
      checks: { t1: { by: "Amara", at: "2026-09-05T11:00:00Z" } },
      report: {
        ...base,
        outputs: { ...base.outputs, analyses: [{ analysisId: "a1", name: "Beta diversity", slug: "beta", runNumber: "EXP-9", metrics: { n_samples: 874 } } as never] },
        blocks: base.blocks.map((block) =>
          block.type === "text" ? { ...block, markdown: "## Intro\n\n`r beta.n_samples @EXP-8=870` and `r gone.x`" }
          : block.type === "run-metric" ? { ...block, pin: { run: "EXP-8", values: { n_samples: 870, permanova_group_R2: 0.0629 } } }
          : block.id === "fig" ? { ...block, pin: { run: "EXP-8" }, newer: { runNumber: "EXP-9", flowRunNumber: 9 } }
          : block) as ReportView["blocks"],
      },
    });
    const html = renderReportDocument(value);
    expect(html).toContain("Released · all 1 section checked by a person");
    expect(html).toContain("870 ◇");
    expect(html).toContain("△ source missing (gone.x)");
    expect(html).toMatch(/◇ 3 values are from an older run/);
    expect(html).toContain("◇ EXP-9 has 874");
    expect(html).toContain("a newer run (Run #9) redrew it");
    expect(renderReportDocument(input())).not.toContain("class=\"release");
  });
});
