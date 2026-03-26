import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  bootstrapRuntimeEnv: vi.fn(),
  parseUpdateCheckResponse: vi.fn(),
  loadInstalledDatabaseConfig: vi.fn(),
  getDatabaseCompatibilityError: vi.fn(),
}));

vi.mock("@/lib/config/runtime-env", () => ({
  bootstrapRuntimeEnv: mocks.bootstrapRuntimeEnv,
}));

vi.mock("@/lib/config/version-response", () => ({
  parseUpdateCheckResponse: mocks.parseUpdateCheckResponse,
}));

vi.mock("./database-config", () => ({
  loadInstalledDatabaseConfig: mocks.loadInstalledDatabaseConfig,
  getDatabaseCompatibilityError: mocks.getDatabaseCompatibilityError,
}));

let cwd = "";
let tempDir = "";

async function loadCheckerModule() {
  vi.resetModules();
  return import("./checker");
}

beforeEach(async () => {
  vi.clearAllMocks();
  cwd = process.cwd();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-update-checker-"));
  process.chdir(tempDir);
  await fs.writeFile(
    path.join(tempDir, "package.json"),
    JSON.stringify({ version: "1.1.80" }),
    "utf8"
  );
  mocks.loadInstalledDatabaseConfig.mockResolvedValue({
    databaseUrl: null,
    directUrl: null,
    provider: "postgresql",
  });
  mocks.getDatabaseCompatibilityError.mockReturnValue(undefined);
  mocks.parseUpdateCheckResponse.mockImplementation((value) => value);
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(async () => {
  vi.unstubAllGlobals();
  process.chdir(cwd);
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("updater checker", () => {
  it("reads the current version from package.json", async () => {
    const mod = await loadCheckerModule();

    expect(mod.getCurrentVersion()).toBe("1.1.80");
    expect(await mod.getInstalledVersion()).toBe("1.1.80");
    expect(mocks.bootstrapRuntimeEnv).toHaveBeenCalledTimes(1);
  });

  it("checks for updates and reuses the cached result", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        updateAvailable: true,
        latest: {
          version: "1.2.0",
          channel: "stable",
          releaseDate: "2026-03-18",
          downloadUrl: "https://seqdesk.com/download.tgz",
          checksum: "sha256:abc",
          releaseNotes: "New release",
          minNodeVersion: "20.0.0",
        },
      }),
    } as Response);

    const mod = await loadCheckerModule();
    const first = await mod.checkForUpdates();
    const second = await mod.checkForUpdates();

    expect(first).toEqual({
      updateAvailable: true,
      currentVersion: "1.1.80",
      latest: {
        version: "1.2.0",
        channel: "stable",
        releaseDate: "2026-03-18",
        downloadUrl: "https://seqdesk.com/download.tgz",
        checksum: "sha256:abc",
        releaseNotes: "New release",
        minNodeVersion: "20.0.0",
      },
      currentDatabaseProvider: "postgresql",
      databaseCompatible: true,
      databaseCompatibilityError: undefined,
    });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports database compatibility issues from the release metadata", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        updateAvailable: true,
        latest: {
          version: "1.2.0",
          channel: "stable",
          releaseDate: "2026-03-18",
          downloadUrl: "https://seqdesk.com/download.tgz",
          checksum: "sha256:abc",
          releaseNotes: "New release",
          minNodeVersion: "20.0.0",
          databaseRequirement: "postgresql",
        },
      }),
    } as Response);
    mocks.loadInstalledDatabaseConfig.mockResolvedValue({
      databaseUrl: "file:./dev.db",
      directUrl: "file:./dev.db",
      provider: "sqlite",
    });
    mocks.getDatabaseCompatibilityError.mockReturnValue("requires PostgreSQL");

    const mod = await loadCheckerModule();

    await expect(mod.checkForUpdates(true)).resolves.toEqual({
      updateAvailable: true,
      currentVersion: "1.1.80",
      latest: {
        version: "1.2.0",
        channel: "stable",
        releaseDate: "2026-03-18",
        downloadUrl: "https://seqdesk.com/download.tgz",
        checksum: "sha256:abc",
        releaseNotes: "New release",
        minNodeVersion: "20.0.0",
        databaseRequirement: "postgresql",
      },
      currentDatabaseProvider: "sqlite",
      databaseCompatible: false,
      databaseCompatibilityError: "requires PostgreSQL",
    });
  });

  it("returns 0.0.0 when package.json is missing or invalid", async () => {
    await fs.rm(path.join(tempDir, "package.json"));

    const mod = await loadCheckerModule();

    expect(mod.getCurrentVersion()).toBe("0.0.0");
    expect(await mod.getInstalledVersion()).toBe("0.0.0");
  });

  it("returns 0.0.0 when package.json has no version field", async () => {
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test" }),
      "utf8"
    );

    const mod = await loadCheckerModule();

    expect(mod.getCurrentVersion()).toBe("0.0.0");
  });

  it("clears the update cache so the next check re-fetches", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        updateAvailable: false,
        latest: null,
      }),
    } as Response);

    const mod = await loadCheckerModule();
    await mod.checkForUpdates();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    mod.clearUpdateCache();
    await mod.checkForUpdates();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-fetches when forced even if cache is valid", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        updateAvailable: false,
        latest: null,
      }),
    } as Response);

    const mod = await loadCheckerModule();
    await mod.checkForUpdates();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await mod.checkForUpdates(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns error result when HTTP response is not ok", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    const mod = await loadCheckerModule();
    const result = await mod.checkForUpdates(true);

    expect(result.updateAvailable).toBe(false);
    expect(result.error).toContain("HTTP 503");
  });

  it("returns a structured error result when the request fails", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new Error("network down"));

    const mod = await loadCheckerModule();

    await expect(mod.checkForUpdates(true)).resolves.toEqual({
      updateAvailable: false,
      currentVersion: "1.1.80",
      latest: null,
      currentDatabaseProvider: "postgresql",
      databaseCompatible: true,
      error: "Failed to check for updates: network down",
    });
  });
});
