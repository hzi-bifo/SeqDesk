import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearQuickPrerequisiteStatusCache,
  createFallbackQuickPrerequisiteStatus,
  getMemoryQuickPrerequisiteStatus,
  normalizeQuickPrerequisiteStatus,
  readCachedQuickPrerequisiteStatus,
  refreshQuickPrerequisiteStatus,
  writeCachedQuickPrerequisiteStatus,
} from "./quick-prerequisite-status";

function createStorage() {
  const values = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

beforeEach(() => {
  clearQuickPrerequisiteStatusCache(null);
});

describe("quick-prerequisite-status", () => {
  it("normalizes stored quick check results", () => {
    const checkedAt = 1234;

    expect(
      normalizeQuickPrerequisiteStatus({
        ready: true,
        summary: " Ready to run pipelines ",
        checkedAt,
      })
    ).toEqual({
      ready: true,
      summary: "Ready to run pipelines",
      checkedAt,
    });
  });

  it("hydrates the in-memory cache from session storage", () => {
    const storage = createStorage();

    storage.setItem(
      "seqdesk:quick-prerequisite-status:v1",
      JSON.stringify({
        ready: false,
        summary: "Missing: Nextflow",
        checkedAt: 42,
      })
    );

    const status = readCachedQuickPrerequisiteStatus(storage);

    expect(status).toEqual({
      ready: false,
      summary: "Missing: Nextflow",
      checkedAt: 42,
    });
    expect(getMemoryQuickPrerequisiteStatus()).toEqual(status);
  });

  it("caches successful refreshes and reuses them within the session", async () => {
    const storage = createStorage();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ready: true,
        summary: "Ready to run pipelines",
      }),
    } as Response);

    const first = await refreshQuickPrerequisiteStatus({ storage, fetchImpl });
    const second = await refreshQuickPrerequisiteStatus({ storage, fetchImpl });

    expect(first.ready).toBe(true);
    expect(first.summary).toBe("Ready to run pipelines");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("keeps the last cached status when a forced refresh fails", async () => {
    const storage = createStorage();
    const cached = createFallbackQuickPrerequisiteStatus("Missing: Nextflow");
    writeCachedQuickPrerequisiteStatus(cached, storage);

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as Response);

    await expect(
      refreshQuickPrerequisiteStatus({ force: true, storage, fetchImpl })
    ).rejects.toThrow("Could not check system");

    expect(readCachedQuickPrerequisiteStatus(storage)).toEqual(cached);
  });
});
