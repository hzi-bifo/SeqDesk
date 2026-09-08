import { describe, expect, it } from "vitest";
import { computeCacheToken } from "./cache-token";

const base = {
  versionHash: "abc",
  samplesUpdatedAt: "2026-09-04T10:00:00.000Z",
  editCount: 2,
  editsUpdatedAt: "2026-09-04T11:00:00.000Z",
  curationVersion: 3,
};

describe("explore cache token", () => {
  it("is stable for identical inputs", () => {
    expect(computeCacheToken(base)).toBe(computeCacheToken({ ...base }));
  });

  it("changes when any input changes", () => {
    const token = computeCacheToken(base);
    expect(computeCacheToken({ ...base, versionHash: "def" })).not.toBe(token);
    expect(computeCacheToken({ ...base, samplesUpdatedAt: "2026-09-05T10:00:00.000Z" })).not.toBe(token);
    expect(computeCacheToken({ ...base, editCount: 3 })).not.toBe(token);
    expect(computeCacheToken({ ...base, editsUpdatedAt: null })).not.toBe(token);
    expect(computeCacheToken({ ...base, curationVersion: 4 })).not.toBe(token);
  });
});
