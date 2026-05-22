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
  DEFAULT_MINKNOW_CONFIG,
  loadMinknowConfig,
  parseMinknowConfig,
  saveMinknowConfig,
  type MinknowStreamConfig,
} from "./config";

describe("minknow/config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.siteSettings.upsert.mockResolvedValue({});
  });

  describe("parseMinknowConfig", () => {
    it("returns a fresh defaults object for null", () => {
      const result = parseMinknowConfig(null);
      expect(result).toEqual(DEFAULT_MINKNOW_CONFIG);
      expect(result).not.toBe(DEFAULT_MINKNOW_CONFIG);
    });

    it("returns defaults for undefined", () => {
      expect(parseMinknowConfig(undefined)).toEqual(DEFAULT_MINKNOW_CONFIG);
    });

    it("returns defaults for empty string", () => {
      expect(parseMinknowConfig("")).toEqual(DEFAULT_MINKNOW_CONFIG);
    });

    it("returns defaults when JSON cannot be parsed", () => {
      expect(parseMinknowConfig("{garbage")).toEqual(DEFAULT_MINKNOW_CONFIG);
    });

    it("returns defaults when JSON has no minknowStream key", () => {
      const result = parseMinknowConfig(JSON.stringify({ workerPause: { foo: true } }));
      expect(result).toEqual(DEFAULT_MINKNOW_CONFIG);
    });

    it("merges parsed values with defaults (partial overrides)", () => {
      const result = parseMinknowConfig(
        JSON.stringify({ minknowStream: { enabled: true, host: "minion-1" } }),
      );
      expect(result).toEqual({
        ...DEFAULT_MINKNOW_CONFIG,
        enabled: true,
        host: "minion-1",
      });
    });

    it("accepts a fully specified minknowStream object", () => {
      const full: MinknowStreamConfig = {
        enabled: true,
        host: "10.0.0.5",
        grpcPort: 9502,
        tlsCaCertPath: "/etc/ca.crt",
        outputRoot: "/data/minknow",
        pollIntervalMs: 1000,
        usePolling: true,
        stabilityThresholdMs: 5000,
      };
      expect(parseMinknowConfig(JSON.stringify({ minknowStream: full }))).toEqual(full);
    });
  });

  describe("loadMinknowConfig", () => {
    it("returns defaults when SiteSettings row is missing", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue(null);

      expect(await loadMinknowConfig()).toEqual(DEFAULT_MINKNOW_CONFIG);
      expect(mocks.db.siteSettings.findUnique).toHaveBeenCalledWith({
        where: { id: "singleton" },
        select: { extraSettings: true },
      });
    });

    it("returns defaults when extraSettings is null", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({ extraSettings: null });

      expect(await loadMinknowConfig()).toEqual(DEFAULT_MINKNOW_CONFIG);
    });

    it("returns the saved minknowStream merged with defaults", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({
          minknowStream: { enabled: true, outputRoot: "/data/runs" },
        }),
      });

      expect(await loadMinknowConfig()).toEqual({
        ...DEFAULT_MINKNOW_CONFIG,
        enabled: true,
        outputRoot: "/data/runs",
      });
    });
  });

  describe("saveMinknowConfig", () => {
    const next: MinknowStreamConfig = {
      enabled: true,
      host: "minion-1",
      grpcPort: 9502,
      tlsCaCertPath: "",
      outputRoot: "/data/runs",
      pollIntervalMs: 5000,
      usePolling: false,
      stabilityThresholdMs: 2000,
    };

    it("upserts with the new minknowStream when SiteSettings is missing", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue(null);

      await saveMinknowConfig(next);

      expect(mocks.db.siteSettings.upsert).toHaveBeenCalledTimes(1);
      const call = mocks.db.siteSettings.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ id: "singleton" });
      expect(JSON.parse(call.update.extraSettings as string)).toEqual({
        minknowStream: next,
      });
      expect(call.create).toEqual({
        id: "singleton",
        extraSettings: call.update.extraSettings,
      });
    });

    it("preserves other extraSettings keys when saving minknowStream", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({
        extraSettings: JSON.stringify({
          workerPause: { "stream-monitor": true },
          minknowStream: { enabled: false, host: "old", grpcPort: 1 },
        }),
      });

      await saveMinknowConfig(next);

      const written = JSON.parse(
        mocks.db.siteSettings.upsert.mock.calls[0][0].update.extraSettings as string,
      );
      expect(written).toEqual({
        workerPause: { "stream-monitor": true },
        minknowStream: next,
      });
    });

    it("recovers when existing extraSettings is invalid JSON", async () => {
      mocks.db.siteSettings.findUnique.mockResolvedValue({ extraSettings: "{not-json" });

      await saveMinknowConfig(next);

      const written = JSON.parse(
        mocks.db.siteSettings.upsert.mock.calls[0][0].update.extraSettings as string,
      );
      expect(written).toEqual({ minknowStream: next });
    });

  });
});
