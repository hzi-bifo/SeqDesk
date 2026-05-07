import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    siteSettings: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import {
  isWorkerPaused,
  listPausedWorkers,
  setWorkerPaused,
} from "./pause";

describe("workers/pause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.siteSettings.upsert.mockResolvedValue({});
  });

  describe("isWorkerPaused", () => {
    it("returns false when SiteSettings row is missing", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue(null);

      expect(await isWorkerPaused("stream-monitor")).toBe(false);
    });

    it("returns false when extraSettings is null", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({ extraSettings: null });

      expect(await isWorkerPaused("stream-monitor")).toBe(false);
    });

    it("returns false when extraSettings is invalid JSON", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({ extraSettings: "{not-json" });

      expect(await isWorkerPaused("stream-monitor")).toBe(false);
    });

    it("returns false when extraSettings has no workerPause key", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({ other: { foo: true } }),
      });

      expect(await isWorkerPaused("stream-monitor")).toBe(false);
    });

    it("returns false when workerPause map does not contain the name", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({ workerPause: { "other-worker": true } }),
      });

      expect(await isWorkerPaused("stream-monitor")).toBe(false);
    });

    it("returns true when workerPause[name] is truthy", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({ workerPause: { "stream-monitor": true } }),
      });

      expect(await isWorkerPaused("stream-monitor")).toBe(true);
    });

    it("returns false when workerPause[name] is falsy", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({ workerPause: { "stream-monitor": false } }),
      });

      expect(await isWorkerPaused("stream-monitor")).toBe(false);
    });

    it("treats a non-object parsed extraSettings as empty", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify("just a string"),
      });

      expect(await isWorkerPaused("stream-monitor")).toBe(false);
    });
  });

  describe("setWorkerPaused", () => {
    it("upserts with workerPause[name]=true when pausing a worker on a missing row", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue(null);

      await setWorkerPaused("stream-monitor", true);

      expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
      const call = mocks.db.siteSettings.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ id: "singleton" });
      const written = JSON.parse(call.update.extraSettings as string);
      expect(written).toEqual({ workerPause: { "stream-monitor": true } });
      expect(call.create).toEqual({
        id: "singleton",
        extraSettings: call.update.extraSettings,
      });
    });

    it("preserves other extraSettings keys when pausing a worker", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({
          minknowStream: { host: "localhost" },
          workerPause: { "pipeline-monitor": true },
        }),
      });

      await setWorkerPaused("stream-monitor", true);

      const written = JSON.parse(
        mocks.db.siteSettings.upsert.mock.calls[0][0].update.extraSettings as string,
      );
      expect(written).toEqual({
        minknowStream: { host: "localhost" },
        workerPause: { "pipeline-monitor": true, "stream-monitor": true },
      });
    });

    it("removes only the requested name when unpausing", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({
          workerPause: { "stream-monitor": true, "pipeline-monitor": true },
        }),
      });

      await setWorkerPaused("stream-monitor", false);

      const written = JSON.parse(
        mocks.db.siteSettings.upsert.mock.calls[0][0].update.extraSettings as string,
      );
      expect(written).toEqual({ workerPause: { "pipeline-monitor": true } });
    });

    it("handles unpausing a worker that wasn't paused (no-op)", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({ workerPause: { "pipeline-monitor": true } }),
      });

      await setWorkerPaused("stream-monitor", false);

      const written = JSON.parse(
        mocks.db.siteSettings.upsert.mock.calls[0][0].update.extraSettings as string,
      );
      expect(written).toEqual({ workerPause: { "pipeline-monitor": true } });
    });

    it("recovers when the existing extraSettings is invalid JSON", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({ extraSettings: "{bad" });

      await setWorkerPaused("stream-monitor", true);

      const written = JSON.parse(
        mocks.db.siteSettings.upsert.mock.calls[0][0].update.extraSettings as string,
      );
      expect(written).toEqual({ workerPause: { "stream-monitor": true } });
    });

    it("ignores a non-object existing workerPause value", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({ workerPause: "garbage" }),
      });

      await setWorkerPaused("stream-monitor", true);

      const written = JSON.parse(
        mocks.db.siteSettings.upsert.mock.calls[0][0].update.extraSettings as string,
      );
      expect(written).toEqual({ workerPause: { "stream-monitor": true } });
    });
  });

  describe("listPausedWorkers", () => {
    it("returns an empty list when SiteSettings is missing", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue(null);

      expect(await listPausedWorkers()).toEqual([]);
    });

    it("returns names with truthy values only", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({
          workerPause: {
            "stream-monitor": true,
            "pipeline-monitor": false,
            "discover-simulator": 1,
            "stream-simulator": null,
          },
        }),
      });

      const names = await listPausedWorkers();
      expect(names.sort()).toEqual(["discover-simulator", "stream-monitor"]);
    });

    it("returns an empty list when workerPause is absent", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({ minknowStream: { host: "localhost" } }),
      });

      expect(await listPausedWorkers()).toEqual([]);
    });
  });
});
