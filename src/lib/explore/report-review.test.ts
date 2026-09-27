import { describe, expect, it } from "vitest";
import { appendVersion, mergeChecks, parseChecks, parseVersions, versionBlocks, MAX_REPORT_VERSIONS } from "./report-review";
import { buildVariables, formatVariableValue, resolveVariablesForCopy } from "./variables";
import type { ReportAnalysis } from "./reports";

describe("report review (checks and versions on the server)", () => {
  it("merges check changes and drops unchecked sections", () => {
    const stored = { a: { by: "Amara", at: "2026-09-27T10:00:00Z" } };
    expect(mergeChecks(stored, { b: { by: "Jonas", at: "2026-09-27T10:01:00Z" }, a: null })).toEqual({ b: { by: "Jonas", at: "2026-09-27T10:01:00Z" } });
    expect(mergeChecks(stored, { c: { by: 1 }, "": { by: "x", at: "2026-09-27T10:00:00Z" } })).toEqual(stored);
    expect(parseChecks({ a: { by: "A", at: "not a date" }, b: { by: "B", at: "2026-09-27T10:00:00Z", extra: 1 } })).toEqual({ b: { by: "B", at: "2026-09-27T10:00:00Z" } });
  });

  it("amends the newest version for the same person within ten minutes, otherwise adds one", () => {
    let list = appendVersion([], { at: "2026-09-27T10:00:00Z", by: "A", title: "t", blocks: [] }).versions;
    list = appendVersion(list, { at: "2026-09-27T10:05:00Z", by: "A", title: "t2", blocks: [] }).versions;
    expect(list.map((v) => [v.n, v.title])).toEqual([[1, "t2"]]);
    const next = appendVersion(list, { at: "2026-09-27T10:06:00Z", by: "B", title: "t3", blocks: [] });
    expect(next.current.n).toBe(2);
    let many = next.versions;
    for (let i = 0; i < MAX_REPORT_VERSIONS + 5; i++) many = appendVersion(many, { at: new Date(Date.UTC(2026, 8, 28, i)).toISOString(), by: `P${i}`, title: "t", blocks: [] }).versions;
    expect(many).toHaveLength(MAX_REPORT_VERSIONS);
    expect(parseVersions([{ n: 2, at: "x", by: "", title: "", blocks: [] }, { bad: true }, { n: 1, at: "x", by: "", title: "", blocks: [] }]).map((v) => v.n)).toEqual([1, 2]);
  });

  it("keeps stored blocks only: no resolved data or map drawings", () => {
    expect(versionBlocks([{ id: "f", type: "figure", figure: { url: "x" }, pin: { run: "R" } }, { id: "m", type: "flow-map", svg: "<svg/>" }])).toEqual([{ id: "f", type: "figure", pin: { run: "R" } }, { id: "m", type: "flow-map" }]);
  });
});

describe("shared copies of report text (B2, B7, B10)", () => {
  const analyses = [{ analysisId: "a", name: "Temporal patterns", slug: "temporal_patterns", runNumber: "EXP-8", metrics: { n_clustered: 1874 } }] as unknown as ReportAnalysis[];
  it("keeps the pinned run's value with ◇ and marks missing sources", () => {
    const counts = { stale: 0, missing: 0 };
    const text = resolveVariablesForCopy("`r temporal_patterns.n_clustered @EXP-7=1,998` and `r gone.x @EXP-7=48` and `r temporal_patterns.lost`", buildVariables(analyses), counts);
    expect(text).toBe("1,998 ◇ and 48 △ source missing (gone.x) and △ source missing (temporal_patterns.lost)");
    expect(counts).toEqual({ stale: 1, missing: 2 });
  });
  it("formats numbers like the web client", () => {
    expect([34681, 65.7, 20.876, 0.001, 0.000741, 1234.5, 0.062867, 49178386.2].map((value) => formatVariableValue(value))).toEqual(["34,681", "65.7", "20.88", "0.001", "0.000741", "1,234.5", "0.0629", "49.2M"]);
    expect(formatVariableValue(0.01, 4)).toBe("0.0100");
  });
});
