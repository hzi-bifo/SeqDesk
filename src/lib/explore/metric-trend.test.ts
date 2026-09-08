import { describe, expect, it } from "vitest";
import { agoText, deltaText, formatWithDigits, metricTrend, sparklinePoints, trendNote, type MetricHistoryEntry } from "./metric-trend";

const history: MetricHistoryEntry[] = [
  { runNumber: "EXP-1", completedAt: "2026-08-01T10:00:00Z", metrics: { n_subjects: 300, note: "x" } },
  { runNumber: "EXP-2", completedAt: "2026-08-20T10:00:00Z", metrics: { n_subjects: 340 } },
  { runNumber: "EXP-3", completedAt: "2026-09-05T10:00:00Z", metrics: { n_subjects: 356, extra: 1 } },
];
const plain = (value: number) => String(value);

describe("key figure trends", () => {
  it("compares with the previous run or the first one", () => {
    expect(metricTrend(history, "n_subjects", "previous")).toMatchObject({ delta: 16, since: { runNumber: "EXP-2" } });
    const whole = metricTrend(history, "n_subjects", "history");
    expect(whole).toMatchObject({ delta: 56, since: { runNumber: "EXP-1" } });
    expect(whole?.series.map((point) => point.value)).toEqual([300, 340, 356]);
    expect(whole?.ratio).toBeCloseTo(56 / 300);
  });

  it("has no delta with one value, and none at all when trends are off", () => {
    expect(metricTrend(history, "extra", "previous")).toMatchObject({ delta: null, since: null });
    expect(metricTrend(history, "note", "history")?.series).toEqual([]);
    expect(metricTrend(history, "n_subjects", "none")).toBeNull();
    expect(metricTrend([], "n_subjects", "history")).toBeNull();
  });

  it("writes deltas and ages the way readers expect", () => {
    expect(deltaText(metricTrend(history, "n_subjects", "previous"), plain)).toBe("+16 (+4.7%)");
    expect(deltaText({ series: [], delta: -0.03, ratio: -0.5, since: null }, plain)).toBe("−0.03 (−50%)");
    expect(deltaText({ series: [], delta: 0, ratio: 0, since: null }, plain)).toBe("±0 (0%)");
    const now = new Date("2026-09-06T12:00:00Z");
    expect(agoText("2026-09-06T08:00:00Z", now)).toBe("today");
    expect(agoText("2026-09-05T08:00:00Z", now)).toBe("yesterday");
    expect(agoText("2026-08-20T10:00:00Z", now)).toBe("2 weeks ago");
    expect(agoText("2026-03-01T10:00:00Z", now)).toBe("6 months ago");
    expect(agoText(null, now)).toBeNull();
  });

  it("scales a sparkline into its box and honours requested decimals", () => {
    const points = sparklinePoints([1, 3, 2], 80, 24);
    expect(points.map((point) => point[0])).toEqual([0, 40, 80]);
    expect(points[1][1]).toBeLessThan(points[0][1]);
    expect(sparklinePoints([5])).toEqual([]);
    expect(formatWithDigits(3.14159, 2, plain)).toBe("3.14");
    expect(formatWithDigits(1234.5, 0, plain)).toBe("1,235");
    expect(formatWithDigits(3.14159, null, plain)).toBe("3.14159");
  });

  it("writes the note under a card without run numbers", () => {
    const now = new Date("2026-09-06T12:00:00Z");
    expect(trendNote(metricTrend(history, "n_subjects", "previous"), "previous", plain, now)).toBe("+16 (+4.7%) since the previous run, 2 weeks ago");
    expect(trendNote(metricTrend(history, "n_subjects", "history"), "history", plain, now)).toBe("+56 (+19%) over 3 runs since 5 weeks ago");
    expect(trendNote(metricTrend(history, "extra", "previous"), "previous", plain, now)).toBe("no earlier run to compare");
    expect(trendNote(null, "none", plain, now)).toBeNull();
  });
});
