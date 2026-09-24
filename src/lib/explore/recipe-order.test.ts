import { describe, expect, it } from "vitest";
import { downstreamOf, executionOrder, keyBetween, labelSteps, lineageOrder, sortSteps, spreadKeys, upstreamOf } from "./recipe-order";

const step = (id: string, position: string, extra: Partial<{ laneKind: string | null; laneOf: string | null; createdAt: Date }> = {}) =>
  ({ id, position, createdAt: extra.createdAt ?? new Date(0), laneKind: extra.laneKind ?? null, laneOf: extra.laneOf ?? null });

describe("recipe order keys", () => {
  it("always finds a key between two keys", () => {
    const keys = ["", "V", "V1", "k", "z", "zz"];
    for (const [a, b] of [["", null], ["V", "k"], ["V", "V1"], ["", "1"], ["z", null], ["zz", null], ["V1", "V2"], ["A", "B"]] as Array<[string, string | null]>) {
      const key = keyBetween(a, b);
      expect(key > a).toBe(true);
      if (b !== null) expect(key < b).toBe(true);
      expect(key.endsWith("0")).toBe(false);
    }
    expect(keys.length).toBe(6);
    expect(() => keyBetween("k", "V")).toThrow();
  });
  it("keeps inserting in the same gap without collisions", () => {
    let low = "V";
    const high = "W";
    for (let index = 0; index < 50; index += 1) {
      const next = keyBetween(low, high);
      expect(next > low && next < high).toBe(true);
      low = next;
    }
  });
  it("spreads fresh keys in order", () => {
    const keys = spreadKeys(6);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(spreadKeys(200)).size).toBe(200);
    expect([...spreadKeys(200)].sort()).toEqual(spreadKeys(200));
  });
});

describe("recipe numbering and lineage", () => {
  it("numbers main-lane steps and letters lanes", () => {
    const steps = sortSteps([step("s1", "1"), step("s2", "2"), step("s3", "3"), step("s4", "4"), step("s4b", "5", { laneKind: "alternative", laneOf: "s4" }),
      step("s3a", "6", { laneKind: "forEach", laneOf: "s3" }), step("s3b", "7", { laneKind: "forEach", laneOf: "s3" }), step("orphan", "8", { laneKind: "alternative", laneOf: "gone" })]);
    expect(Object.fromEntries(labelSteps(steps))).toEqual({ s1: "1", s2: "2", s3: "3", s4: "4", orphan: "5", s4b: "4b", s3a: "3a", s3b: "3b" });
  });
  it("orders a fresh recipe by lineage, then creation", () => {
    const upstream = new Map([["b", new Set(["a"])], ["a", new Set<string>()], ["c", new Set(["b"])]]);
    const steps = [step("c", "", { createdAt: new Date(1) }), step("b", "", { createdAt: new Date(2) }), step("a", "", { createdAt: new Date(3) })];
    expect(lineageOrder(steps, upstream).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(executionOrder(sortSteps([step("c", "1"), step("a", "2"), step("b", "3")]), upstream).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });
  it("walks downstream and upstream", () => {
    const upstream = new Map([["a", new Set<string>()], ["b", new Set(["a"])], ["c", new Set(["b"])], ["d", new Set<string>()]]);
    expect([...downstreamOf(["b"], upstream)].sort()).toEqual(["b", "c"]);
    expect([...upstreamOf(["c"], upstream)].sort()).toEqual(["a", "b"]);
  });
});
