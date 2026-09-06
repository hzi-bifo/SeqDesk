import { describe, expect, it } from "vitest";
import { buildTimeline, chooseStep, detectTimeAxis, parseMeasure, suggestMeasure, timelineNote, timeValue } from "./time-axis";
import type { ExploreColumn } from "./types";

const col = (key: string, type: ExploreColumn["type"]): ExploreColumn => ({ key, label: key, type } as ExploreColumn);

describe("time in a table", () => {
  it("prefers roles, then types, then names, and finds nothing otherwise", () => {
    const columns = [col("A-ID", "string"), col("timepoint", "number"), col("sampleDate", "string"), col("collected", "string")];
    expect(detectTimeAxis(columns, { timepoint: "timepoint" })).toEqual({ column: "timepoint", kind: "day", label: "study day" });
    expect(detectTimeAxis(columns, { date: "sampleDate", timepoint: "timepoint" })).toMatchObject({ column: "sampleDate", kind: "date" });
    expect(detectTimeAxis([col("x", "number"), col("when", "date")], {})).toMatchObject({ column: "when", kind: "date" });
    expect(detectTimeAxis(columns, {})).toMatchObject({ column: "timepoint", kind: "day" });
    expect(detectTimeAxis([col("collected", "string")], {})).toMatchObject({ column: "collected", kind: "date" });
    expect(detectTimeAxis([col("value", "number")], {})).toBeNull();
  });

  it("suggests what a figure counts from its name and the roles", () => {
    const roles = { subject: "subject", sample: "A-ID", taxon: "taxonName", count: "numReads" };
    expect(suggestMeasure("n_subjects", roles)).toEqual({ kind: "distinct", column: "subject" });
    expect(suggestMeasure("n_samples", roles)).toEqual({ kind: "distinct", column: "A-ID" });
    expect(suggestMeasure("n_taxa", roles)).toEqual({ kind: "distinct", column: "taxonName" });
    expect(suggestMeasure("total_reads", roles)).toEqual({ kind: "sum", column: "numReads" });
    expect(suggestMeasure("n_rows", roles)).toEqual({ kind: "count" });
    expect(suggestMeasure("permanova_p", roles)).toBeNull();
    expect(suggestMeasure("n_subjects", {})).toBeNull();
    expect(parseMeasure("distinct:subject")).toEqual({ kind: "distinct", column: "subject" });
    expect(parseMeasure("bogus")).toBeNull();
  });

  it("reads days from numbers or D-prefixed text and dates from ISO text", () => {
    const day = { column: "timepoint", kind: "day" as const, label: "study day" };
    expect(timeValue({ timepoint: 465 }, day)).toBe(465);
    expect(timeValue({ timepoint: "D465" }, day)).toBe(465);
    expect(timeValue({ timepoint: "" }, day)).toBeNull();
    expect(timeValue({ when: "2026-03-02" }, { column: "when", kind: "date", label: "date" })).toBe(Date.parse("2026-03-02"));
  });

  it("buckets a cumulative distinct count over study days with a nice step", () => {
    expect(chooseStep(2000)).toBe(180);
    expect(chooseStep(20)).toBe(7);
    const rows = [
      { timepoint: 10, subject: "A" }, { timepoint: 12, subject: "A" }, { timepoint: 40, subject: "B" },
      { timepoint: 100, subject: "C" }, { timepoint: 130, subject: "A" }, { timepoint: null, subject: "Z" },
    ];
    const series = buildTimeline(rows, { column: "timepoint", kind: "day", label: "study day" }, { kind: "distinct", column: "subject" }, 4);
    expect(series.step).toBe(30);
    expect(series.buckets.map((bucket) => [bucket.label, bucket.value, bucket.cumulative])).toEqual([["day 0", 1, 1], ["day 30", 1, 2], ["day 90", 1, 3], ["day 120", 0, 3]]);
    expect(series.total).toBe(3);
    expect(series.rowsWithoutTime).toBe(1);
    expect(timelineNote(series, String)).toBe("+0 in the last 30 study days".replace("+0", "±0"));
  });

  it("buckets dates by month and sums a count column", () => {
    const rows = [
      { when: "2026-01-05", reads: 10 }, { when: "2026-01-20", reads: 5 }, { when: "2026-03-02", reads: 7 }, { when: "2026-06-30", reads: 1 },
    ];
    const series = buildTimeline(rows, { column: "when", kind: "date", label: "date" }, { kind: "sum", column: "reads" }, 6);
    expect(series.step).toBe(30);
    expect(series.buckets.map((bucket) => [bucket.label, bucket.value, bucket.cumulative])).toEqual([["2026-01", 15, 15], ["2026-03", 7, 22], ["2026-06", 1, 23]]);
    expect(series.total).toBe(23);
    expect(timelineNote(series, String)).toMatch(/in the last \d+ (months|weeks|days)$/);
  });
});
