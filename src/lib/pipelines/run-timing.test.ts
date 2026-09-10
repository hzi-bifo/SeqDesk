import { describe, expect, it } from "vitest";
import { formatRunDateTime, formatRunDuration, getRunTiming } from "./run-timing";

const now = Date.parse("2026-09-09T12:00:00Z");
const run = {
  status: "completed",
  createdAt: "2026-09-07T11:50:00Z",
  startedAt: "2026-09-07T12:00:00Z",
  completedAt: "2026-09-07T12:21:00Z",
};

describe("pipeline run timing", () => {
  it("shows when execution started and its duration, excluding queue time", () => {
    expect(getRunTiming(run, now)).toMatchObject({
      relativeLabel: "2 days ago", durationLabel: "Took 21 min", duration: "21 min",
      dateTime: "2026-09-07T12:00:00.000Z",
    });
    expect(getRunTiming(run, now).exactTimes).toBe([
      `Added: ${formatRunDateTime(run.createdAt)}`,
      `Started: ${formatRunDateTime(run.startedAt)}`,
      `Ended: ${formatRunDateTime(run.completedAt)}`,
    ].join("\n"));
  });

  it("updates elapsed time only while running", () => {
    const active = { ...run, status: "running", startedAt: "2026-09-09T11:39:00Z", completedAt: null };
    expect(getRunTiming(active, now).durationLabel).toBe("21 min so far");
    expect(getRunTiming(active, now + 60_000).durationLabel).toBe("22 min so far");
    expect(getRunTiming(run, now + 60_000).durationLabel).toBe("Took 21 min");
  });

  it.each(["queued", "pending"])("does not count queue time as runtime for %s", (status) => {
    expect(getRunTiming({ ...run, status, startedAt: null, completedAt: null }, now)).toMatchObject({
      relativeLabel: "Added 2 days ago", durationLabel: "Not started", duration: null,
    });
  });

  it.each(["completed", "failed", "cancelled"])("does not invent an end time for %s", (status) => {
    expect(getRunTiming({ ...run, status, completedAt: null }, now).durationLabel).toBe("Duration not recorded");
    expect(getRunTiming({ ...run, status, completedAt: null }, now + 86_400_000).duration).toBeNull();
  });

  it.each(["failed", "cancelled"])("shows the actual runtime for a %s attempt", (status) => {
    expect(getRunTiming({ ...run, status }, now).durationLabel).toBe("Took 21 min");
  });

  it("uses the end time explicitly when the start time was not recorded", () => {
    expect(getRunTiming({ ...run, startedAt: null }, now)).toMatchObject({
      relativeLabel: "Ended 1 day ago", durationLabel: "Duration not recorded",
    });
  });

  it("handles invalid timestamps, clock skew and zero-duration runs", () => {
    expect(getRunTiming({ status: "completed", startedAt: "invalid", completedAt: null, createdAt: null }, now)).toMatchObject({
      relativeLabel: "Time not recorded", durationLabel: "Duration not recorded", dateTime: undefined,
    });
    expect(getRunTiming({ ...run, completedAt: run.createdAt }, now).duration).toBeNull();
    expect(getRunTiming({ ...run, completedAt: run.startedAt }, now).durationLabel).toBe("Took 0 sec");
    expect(getRunTiming(run, Date.parse(run.createdAt)).relativeLabel).toBe("just now");
    expect(formatRunDateTime("invalid")).toBe("Not recorded");
  });

  it.each([
    [15_000, "15 sec"], [3_660_000, "1 hr 1 min"], [7_200_000, "2 hr"],
    [90_000_000, "1 day 1 hr"], [172_800_000, "2 days"], [-1, null], [NaN, null],
  ])("formats %s ms as %s", (milliseconds, expected) => {
    expect(formatRunDuration(milliseconds)).toBe(expected);
  });
});
