import { describe, it, expect } from "vitest";
import { ReportInputSchema } from "./report-blocks";
import { reconcileReportPages, validateReportPages } from "./report-pages";
const blocks = [{ id: "a" }, { id: "b" }];
const pages = [{ id: "overview", title: "Overview", blockIds: ["a"] }, { id: "qc", title: "QC", blockIds: ["b"] }];
describe("named report pages", () => {
  it("upgrades legacy reports without copying or dropping any blocks", () => {
    expect(reconcileReportPages(undefined, blocks)).toEqual([{ id: "overview", title: "Overview", blockIds: ["a", "b"] }]);
  });
  it("keeps old-client edits on their pages and assigns new blocks to the first page", () => {
    expect(reconcileReportPages(pages, [{id:"b"},{id:"c"}])).toEqual([{id:"overview",title:"Overview",blockIds:["c"]},{id:"qc",title:"QC",blockIds:["b"]}]);
  });
  it("rejects duplicate pages, unknown blocks, multiple ownership and unassigned content", () => {
    expect(validateReportPages(pages, blocks)).toBeNull();
    expect(validateReportPages([pages[0], pages[0]], blocks)).toMatch(/Page id/);
    expect(validateReportPages([{...pages[0],blockIds:["missing"]}],blocks)).toMatch(/unknown block/);
    expect(validateReportPages([pages[0],{...pages[1],blockIds:["a","b"]}],blocks)).toMatch(/more than one/);
    expect(validateReportPages([pages[0]],blocks)).toMatch(/Every block/);
  });
  it("bounds page count, rejects empty titles and accepts empty pages", () => {
    const input={title:"Study",blocks:[],pages:[{id:"a",title:"Empty",blockIds:[]}]};
    expect(ReportInputSchema.safeParse(input).success).toBe(true);
    expect(ReportInputSchema.safeParse({...input,pages:[]}).success).toBe(false);
    expect(ReportInputSchema.safeParse({...input,pages:[{...input.pages[0],title:" "}]}).success).toBe(false);
    expect(ReportInputSchema.safeParse({...input,pages:Array.from({length:21},(_,i)=>({id:String(i),title:"Page",blockIds:[]}))}).success).toBe(false);
  });
});
