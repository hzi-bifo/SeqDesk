import { describe, expect, it } from "vitest";
import { figureKeys, tableFigureKey, targetStatus, withUnit } from "./key-figures";

describe("key figures", () => {
  it("orders run and table figures, dropping stale keys and appending new ones", () => {
    const block = { metrics: ["n_subjects", "n_taxa"], figures: [{ id: "a", datasetId: "d", column: "reads", stat: "mean" as const }], order: ["f:a", "n_taxa", "gone"] };
    expect(figureKeys(block)).toEqual(["f:a", "n_taxa", "n_subjects"]);
    expect(figureKeys({ metrics: ["x"], figures: [{ id: "b", datasetId: "d", column: "c", stat: "count" as const }] })).toEqual(["x", "f:b"]);
    expect(tableFigureKey({ id: "b" })).toBe("f:b");
  });

  it("judges a value against its target", () => {
    const plain = (value: number) => String(value);
    expect(targetStatus(356, { min: 300 }, plain)).toEqual({ status: "met", note: "meets the target (at least 300)" });
    expect(targetStatus(250, { min: 300 }, plain)).toEqual({ status: "low", note: "below the target of 300" });
    expect(targetStatus(0.2, { max: 0.05 }, plain)).toEqual({ status: "high", note: "above the limit of 0.05" });
    expect(targetStatus(0.02, { min: 0, max: 0.05 }, plain)?.note).toBe("meets the target (at least 0, at most 0.05)");
    expect(targetStatus(null, { min: 1 }, plain)).toBeNull();
    expect(targetStatus(5, {}, plain)).toBeNull();
  });

  it("attaches units the way people write them", () => {
    expect(withUnit("48.9M", "reads")).toBe("48.9M reads");
    expect(withUnit("12.5", "%")).toBe("12.5%");
    expect(withUnit("7", "")).toBe("7");
  });
});
