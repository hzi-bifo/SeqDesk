import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before imports
vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
  },
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
}));

vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
  },
  readFile: vi.fn(),
}));

vi.mock("@/lib/config/runtime-env", () => ({
  bootstrapRuntimeEnv: vi.fn(),
}));

vi.mock("@/lib/config/version-response", () => ({
  parseUpdateCheckResponse: vi.fn(),
}));

vi.mock("./database-config", () => ({
  loadInstalledDatabaseConfig: vi.fn(),
  getDatabaseCompatibilityError: vi.fn(),
}));

import fs from "fs";
import fsPromises from "fs/promises";
import { parseUpdateCheckResponse } from "@/lib/config/version-response";
import {
  loadInstalledDatabaseConfig,
  getDatabaseCompatibilityError,
} from "./database-config";
import {
  checkForUpdates,
  getCurrentVersion,
  getInstalledVersion,
  clearUpdateCache,
} from "./checker";

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockReadFile = vi.mocked(fsPromises.readFile);
const mockParseResponse = vi.mocked(parseUpdateCheckResponse);
const mockLoadDbConfig = vi.mocked(loadInstalledDatabaseConfig);
const mockGetDbCompatError = vi.mocked(getDatabaseCompatibilityError);

beforeEach(() => {
  vi.resetAllMocks();
  clearUpdateCache();

  mockReadFileSync.mockReturnValue(
    JSON.stringify({ version: "1.2.3" })
  );
  mockLoadDbConfig.mockResolvedValue({
    databaseUrl: "file:./data/seqdesk.db",
    directUrl: null,
    provider: "sqlite",
  });
  mockGetDbCompatError.mockReturnValue(undefined);
});

// Mock global fetch
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getCurrentVersion", () => {
  it("reads version from package.json", () => {
    expect(getCurrentVersion()).toBe("1.2.3");
  });

  it("returns 0.0.0 when package.json is missing", () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(getCurrentVersion()).toBe("0.0.0");
  });

  it("returns 0.0.0 when version field is missing", () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({}));
    expect(getCurrentVersion()).toBe("0.0.0");
  });
});

describe("getInstalledVersion", () => {
  it("reads version from disk asynchronously", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ version: "2.0.0" }));
    const version = await getInstalledVersion();
    expect(version).toBe("2.0.0");
  });

  it("falls back to getCurrentVersion on read failure", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const version = await getInstalledVersion();
    expect(version).toBe("1.2.3");
  });

  it("falls back to getCurrentVersion when version field is missing", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({}));
    const version = await getInstalledVersion();
    expect(version).toBe("1.2.3");
  });
});

describe("checkForUpdates", () => {
  const latestRelease = {
    version: "2.0.0",
    channel: "stable",
    releaseDate: "2025-01-01",
    downloadUrl: "https://seqdesk.com/download/2.0.0",
    checksum: "abc123",
    releaseNotes: "Big update",
    minNodeVersion: "18.0.0",
  };

  it("returns update available when newer version exists", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    mockParseResponse.mockReturnValue({
      updateAvailable: true,
      latest: latestRelease,
    });

    const result = await checkForUpdates();

    expect(result.updateAvailable).toBe(true);
    expect(result.currentVersion).toBe("1.2.3");
    expect(result.latest).toEqual(latestRelease);
    expect(result.databaseCompatible).toBe(true);
  });

  it("returns no update available when up to date", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    mockParseResponse.mockReturnValue({
      updateAvailable: false,
      latest: null,
    });

    const result = await checkForUpdates();

    expect(result.updateAvailable).toBe(false);
    expect(result.latest).toBeNull();
  });

  it("returns cached result on second call within TTL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    mockParseResponse.mockReturnValue({
      updateAvailable: true,
      latest: latestRelease,
    });

    await checkForUpdates();
    const result = await checkForUpdates();

    expect(result.updateAvailable).toBe(true);
    // fetch should only be called once due to cache
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("bypasses cache when force is true", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    mockParseResponse.mockReturnValue({
      updateAvailable: false,
      latest: null,
    });

    await checkForUpdates();
    await checkForUpdates(true);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("handles fetch failure gracefully", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await checkForUpdates();

    expect(result.updateAvailable).toBe(false);
    expect(result.error).toContain("Network error");
    expect(result.currentVersion).toBe("1.2.3");
  });

  it("handles non-ok HTTP response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await checkForUpdates();

    expect(result.updateAvailable).toBe(false);
    expect(result.error).toContain("HTTP 500");
  });

  it("reports database compatibility error when present", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    mockParseResponse.mockReturnValue({
      updateAvailable: true,
      latest: { ...latestRelease, databaseRequirement: "postgresql" },
    });
    mockGetDbCompatError.mockReturnValue(
      "This release requires PostgreSQL."
    );

    const result = await checkForUpdates();

    expect(result.updateAvailable).toBe(true);
    expect(result.databaseCompatible).toBe(false);
    expect(result.databaseCompatibilityError).toContain("PostgreSQL");
  });

  it("includes current database provider in result", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    mockParseResponse.mockReturnValue({
      updateAvailable: false,
      latest: null,
    });

    const result = await checkForUpdates();

    expect(result.currentDatabaseProvider).toBe("sqlite");
  });
});

describe("clearUpdateCache", () => {
  it("forces next check to fetch from server", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    mockParseResponse.mockReturnValue({
      updateAvailable: false,
      latest: null,
    });

    await checkForUpdates();
    clearUpdateCache();
    await checkForUpdates();

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
