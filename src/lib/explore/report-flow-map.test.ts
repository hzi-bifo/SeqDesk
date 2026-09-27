import { describe, expect, it } from "vitest";
import { MAX_FLOW_MAP_SVG, ReportBlockSchema, ReportInputSchema, parseStoredBlocks } from "./report-blocks";
import { renderReportDocument, type RenderInput } from "./report-export";
import { resolveReportBlocks, type ReportView } from "./reports";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200pt" height="80pt" viewBox="0 0 200 80"><rect width="200" height="80" fill="#ffffff"/><text x="4" y="12">1 Filter</text></svg>';
const block = { id: "fm1", type: "flow-map" as const, flowId: "flow-1", revision: 7, runId: "run-3", runNumber: 3, options: { values: true, inputs: true, outputs: false, caption: true, widthMm: 183 as const }, svg, span: 2 as const };

describe("the analysis map block", () => {
  it("validates strictly and survives the stored round trip", () => {
    expect(ReportBlockSchema.safeParse(block).success).toBe(true);
    expect(ReportInputSchema.safeParse({ title: "R", blocks: [block] }).success).toBe(true);
    expect(parseStoredBlocks([block])).toEqual([block]);
    expect(ReportBlockSchema.safeParse({ ...block, extra: 1 }).success).toBe(false);
    expect(ReportBlockSchema.safeParse({ ...block, options: { ...block.options, colour: true } }).success).toBe(false);
    expect(ReportBlockSchema.safeParse({ ...block, svg: "<div>not a map</div>" }).success).toBe(false);
    expect(ReportBlockSchema.safeParse({ ...block, svg: `<svg>${"x".repeat(MAX_FLOW_MAP_SVG)}</svg>` }).success).toBe(false);
    expect(ReportBlockSchema.safeParse({ ...block, options: { ...block.options, widthMm: 120 } }).success).toBe(false);
  });

  it("resolves without reading tables", async () => {
    const [resolved] = await resolveReportBlocks([block], { figures: [], tables: [], analyses: [] }, async () => { throw new Error("no table"); });
    expect(resolved).toEqual(block);
  });

  it("exports the map as an inert SVG image with its run", () => {
    const report = { id: "r1", targetKey: "study:s1", title: "Airway", share: null, filters: [], sharing: { inputRows: false }, draft: false, updatedAt: "2026-09-27T10:00:00.000Z",
      blocks: [{ ...block, svg: svg.replace("</svg>", '<script>alert(1)</script></svg>') }], outputs: { figures: [], tables: [], analyses: [] } } as unknown as ReportView;
    const input: RenderInput = { report, scopeLabel: "Study", tables: new Map(), artifacts: new Map(), lists: [], curation: { memberships: {}, artifacts: [] }, active: {}, plotly: { src: "/p.js" }, generatedAt: new Date("2026-09-27T12:00:00Z") } as unknown as RenderInput;
    const html = renderReportDocument(input);
    const match = /<img class="flow-map" src="data:image\/svg\+xml;base64,([^"]+)"/.exec(html);
    expect(match).not.toBeNull();
    expect(Buffer.from(match![1], "base64").toString("utf8")).toContain("1 Filter");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Analysis map, Run #3");
  });
});
