import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConfig } from "@/lib/config/types";

const mocks = vi.hoisted(() => ({
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
  loadConfig: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
  homedir: vi.fn(),
  platform: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/config/loader", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  statSync: mocks.statSync,
}));

vi.mock("node:os", () => ({
  homedir: mocks.homedir,
  platform: mocks.platform,
}));

import {
  getResolvedDataBasePath,
  resolveDataBasePathFromStoredValue,
} from "./data-base-path";

const DARWIN_HOME_DIR = "/Users/tester";
const DARWIN_TESTDATA_DIR = `${DARWIN_HOME_DIR}/testdata`;

function makeResolvedConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
  return {
    config: {
      site: {
        dataBasePath: "./data",
      },
    },
    sources: {
      "site.dataBasePath": "default",
    },
    loadedAt: new Date("2026-03-13T00:00:00Z"),
    ...overrides,
  };
}

describe("data-base-path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();

    mocks.loadConfig.mockReturnValue(makeResolvedConfig());
    mocks.platform.mockReturnValue("linux");
    mocks.homedir.mockReturnValue("/Users/test");
    mocks.existsSync.mockReturnValue(false);
    mocks.statSync.mockReturnValue({
      isDirectory: () => false,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers the stored database path", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({ dataBasePath: "/db/data" });

    const result = await getResolvedDataBasePath();

    expect(result).toEqual({
      dataBasePath: "/db/data",
      source: "database",
      isImplicit: false,
    });
  });

  it("prefers explicit file/env config over a stored database path", () => {
    mocks.loadConfig.mockReturnValue(
      makeResolvedConfig({
        config: {
          site: {
            dataBasePath: DARWIN_TESTDATA_DIR,
          },
        },
        sources: {
          "site.dataBasePath": "file",
        },
      })
    );

    const result = resolveDataBasePathFromStoredValue("/db/data");

    expect(result).toEqual({
      dataBasePath: DARWIN_TESTDATA_DIR,
      source: "file",
      isImplicit: false,
    });
  });

  it("uses an explicit env/file-configured path when no database path is stored", () => {
    mocks.loadConfig.mockReturnValue(
      makeResolvedConfig({
        config: {
          site: {
            dataBasePath: "/configured/data",
          },
        },
        sources: {
          "site.dataBasePath": "env",
        },
      })
    );

    const result = resolveDataBasePathFromStoredValue(null);

    expect(result).toEqual({
      dataBasePath: "/configured/data",
      source: "env",
      isImplicit: false,
    });
  });

  it("uses ~/testdata automatically on macOS development when nothing explicit is configured", () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.platform.mockReturnValue("darwin");
    mocks.homedir.mockReturnValue(DARWIN_HOME_DIR);
    mocks.existsSync.mockImplementation((candidate: string) => candidate === DARWIN_TESTDATA_DIR);
    mocks.statSync.mockReturnValue({
      isDirectory: () => true,
    });

    const result = resolveDataBasePathFromStoredValue(null);

    expect(result).toEqual({
      dataBasePath: DARWIN_TESTDATA_DIR,
      source: "local-dev",
      isImplicit: true,
    });
  });

  it("does not apply the local macOS fallback during tests", () => {
    vi.stubEnv("NODE_ENV", "test");
    mocks.platform.mockReturnValue("darwin");
    mocks.homedir.mockReturnValue(DARWIN_HOME_DIR);
    mocks.existsSync.mockReturnValue(true);
    mocks.statSync.mockReturnValue({
      isDirectory: () => true,
    });

    const result = resolveDataBasePathFromStoredValue(null);

    expect(result).toEqual({
      dataBasePath: null,
      source: "none",
      isImplicit: false,
    });
  });
});
