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

  it("returns null for non-object values in normalize", () => {
    expect(normalizeQuickPrerequisiteStatus(null)).toBeNull();
    expect(normalizeQuickPrerequisiteStatus(undefined)).toBeNull();
    expect(normalizeQuickPrerequisiteStatus("string")).toBeNull();
    expect(normalizeQuickPrerequisiteStatus(42)).toBeNull();
  });

  it("returns null when ready is not a boolean", () => {
    expect(
      normalizeQuickPrerequisiteStatus({
        ready: "yes",
        summary: "Ready",
      })
    ).toBeNull();
  });

  it("returns null when summary is missing or blank", () => {
    expect(
      normalizeQuickPrerequisiteStatus({
        ready: true,
        summary: "",
      })
    ).toBeNull();
    expect(
      normalizeQuickPrerequisiteStatus({
        ready: true,
        summary: "  ",
      })
    ).toBeNull();
    expect(
      normalizeQuickPrerequisiteStatus({
        ready: true,
        summary: 123,
      })
    ).toBeNull();
  });

  it("uses default checkedAt when value is not a finite number", () => {
    const result = normalizeQuickPrerequisiteStatus(
      {
        ready: true,
        summary: "OK",
        checkedAt: NaN,
      },
      9999
    );

    expect(result?.checkedAt).toBe(9999);
  });

  it("returns null from read cache when storage is null", () => {
    expect(readCachedQuickPrerequisiteStatus(null)).toBeNull();
  });

  it("returns in-memory cache on subsequent reads", () => {
    const storage = createStorage();
    const status = createFallbackQuickPrerequisiteStatus("OK");
    writeCachedQuickPrerequisiteStatus(status, storage);

    const first = readCachedQuickPrerequisiteStatus(storage);
    const second = readCachedQuickPrerequisiteStatus(storage);

    expect(first).toEqual(status);
    expect(second).toEqual(status);
    // Second read should not touch storage since memory cache is populated
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("removes invalid data from session storage", () => {
    const storage = createStorage();
    storage.setItem(
      "seqdesk:quick-prerequisite-status:v1",
      JSON.stringify({ ready: "invalid" })
    );

    const result = readCachedQuickPrerequisiteStatus(storage);

    expect(result).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(
      "seqdesk:quick-prerequisite-status:v1"
    );
  });

  it("removes data from storage when JSON parse fails", () => {
    const storage = createStorage();
    storage.setItem(
      "seqdesk:quick-prerequisite-status:v1",
      "not-json"
    );

    const result = readCachedQuickPrerequisiteStatus(storage);

    expect(result).toBeNull();
    expect(storage.removeItem).toHaveBeenCalled();
  });

  it("tolerates storage write failures in writeCachedQuickPrerequisiteStatus", () => {
    const storage = createStorage();
    storage.setItem.mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });

    const status = createFallbackQuickPrerequisiteStatus("OK");
    writeCachedQuickPrerequisiteStatus(status, storage);

    // Memory cache should still work
    expect(getMemoryQuickPrerequisiteStatus()).toEqual(status);
  });

  it("writes to memory only when storage is null", () => {
    const status = createFallbackQuickPrerequisiteStatus("No storage");
    writeCachedQuickPrerequisiteStatus(status, null);

    expect(getMemoryQuickPrerequisiteStatus()).toEqual(status);
  });

  it("clears both memory and session storage", () => {
    const storage = createStorage();
    const status = createFallbackQuickPrerequisiteStatus("Cached");
    writeCachedQuickPrerequisiteStatus(status, storage);

    clearQuickPrerequisiteStatusCache(storage);

    expect(getMemoryQuickPrerequisiteStatus()).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(
      "seqdesk:quick-prerequisite-status:v1"
    );
  });

  it("tolerates storage cleanup failures in clearQuickPrerequisiteStatusCache", () => {
    const storage = createStorage();
    storage.removeItem.mockImplementation(() => {
      throw new Error("Storage error");
    });

    clearQuickPrerequisiteStatusCache(storage);

    expect(getMemoryQuickPrerequisiteStatus()).toBeNull();
  });

  it("deduplicates concurrent refresh requests", async () => {
    const storage = createStorage();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ready: true,
        summary: "Ready",
      }),
    } as Response);

    const p1 = refreshQuickPrerequisiteStatus({ force: true, storage, fetchImpl });
    const p2 = refreshQuickPrerequisiteStatus({ force: true, storage, fetchImpl });

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toEqual(r2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws when response payload normalizes to null", async () => {
    const storage = createStorage();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ready: "not-boolean", summary: "" }),
    } as Response);

    await expect(
      refreshQuickPrerequisiteStatus({ force: true, storage, fetchImpl })
    ).rejects.toThrow("Could not check system");
  });

  it("uses forced refresh to bypass cache", async () => {
    const storage = createStorage();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ready: false,
        summary: "Update available",
      }),
    } as Response);

    const cached = createFallbackQuickPrerequisiteStatus("Stale");
    writeCachedQuickPrerequisiteStatus(cached, storage);

    const result = await refreshQuickPrerequisiteStatus({
      force: true,
      storage,
      fetchImpl,
    });

    expect(result.summary).toBe("Update available");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
