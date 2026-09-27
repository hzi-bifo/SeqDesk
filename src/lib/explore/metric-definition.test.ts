import { describe, expect, it } from "vitest";
import { formatMetricDefinition, parseMetricDefinition } from "./metric-definition";

describe("metric definitions", () => {
  it("keeps well-formed filters and formats them for people", () => {
    const definition = parseMetricDefinition({
      what: "DE genes", contrast: "trt vs untrt", method: "DESeq2 1.50.2", extra: "dropped",
      filters: [{ param: "padj_cutoff", op: "<", value: 0.05, column: "padj" }, { param: "lfc_cutoff", op: "|x| >=", value: 1, column: "log2FC" }, { param: "x" }],
    });
    expect(definition?.filters).toHaveLength(2);
    expect(definition).not.toHaveProperty("extra");
    expect(formatMetricDefinition(definition!)).toBe("trt vs untrt · padj < 0.05 · |log2FC| ≥ 1 · DESeq2 1.50.2");
  });
  it("accepts one filter object and op aliases, and rejects empty definitions", () => {
    expect(parseMetricDefinition({ filters: { param: "fdr", op: "<=", value: "0.1" } })?.filters[0]).toEqual({ param: "fdr", op: "<=", value: "0.1" });
    expect(parseMetricDefinition({ filters: [{ param: "lfc", op: "abs>=", value: 2 }] })?.filters[0].op).toBe("|x| >=");
    expect(parseMetricDefinition({ label: "only a label" })).toBeNull();
    expect(parseMetricDefinition("nope")).toBeNull();
  });
});
