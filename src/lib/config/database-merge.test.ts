import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedConfig, SeqDeskConfig } from "./types";

const mocks = vi.hoisted(() => ({
  db: {
    siteSettings: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
  loadConfig: vi.fn(),
  clearConfigCache: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("./loader", () => ({
  loadConfig: mocks.loadConfig,
  clearConfigCache: mocks.clearConfigCache,
}));

import {
  mergeWithDatabase,
  getEffectiveConfig,
  saveConfigToDatabase,
  getConfigSection,
} from "./database-merge";

function makeResolvedConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
  return {
    config: {
      site: {
        name: "SeqDesk",
        dataBasePath: "./data",
        contactEmail: undefined,
      },
      pipelines: {
        enabled: false,
      },
      ena: {
        testMode: true,
        username: undefined,
        password: undefined,
      },
      sequencingFiles: {
        scanDepth: 2,
      },
      auth: {
        allowRegistration: true,
      },
    },
    sources: {
      "site.name": "default",
      "site.dataBasePath": "default",
      "site.contactEmail": "default",
      "pipelines.enabled": "default",
      "ena.testMode": "default",
      "ena.username": "default",
      "ena.password": "default",
      "ena.centerName": "default",
      "sequencingFiles.scanDepth": "default",
      "auth.allowRegistration": "default",
    },
    loadedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("database-merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns file config when database settings are missing", async () => {
    const fileConfig = makeResolvedConfig();
    mocks.loadConfig.mockReturnValue(fileConfig);
    mocks.db.siteSettings.findFirst.mockResolvedValue(null);

    const result = await mergeWithDatabase();

    expect(result).toEqual(fileConfig);
  });

  it("uses database values over defaults and tracks source as database", async () => {
    mocks.loadConfig.mockReturnValue(makeResolvedConfig());
    mocks.db.siteSettings.findFirst.mockResolvedValue({
      id: "singleton",
      siteName: "DB Site",
      dataBasePath: "/mnt/data",
      contactEmail: "db@example.com",
      enaTestMode: false,
      enaUsername: "db-user",
      enaPassword: "db-pass",
      extraSettings: JSON.stringify({
        pipelines: { enabled: true },
        sequencingFiles: { scanDepth: 7 },
        auth: { allowRegistration: false },
        ena: { centerName: "DB-CENTER" },
      }),
    });

    const result = await mergeWithDatabase();

    expect(result.config.site?.name).toBe("DB Site");
    expect(result.config.site?.dataBasePath).toBe("/mnt/data");
    expect(result.config.site?.contactEmail).toBe("db@example.com");
    expect(result.config.ena?.testMode).toBe(false);
    expect(result.config.ena?.username).toBe("db-user");
    expect(result.config.ena?.password).toBe("db-pass");
    expect(result.config.ena?.centerName).toBe("DB-CENTER");
    expect(result.config.pipelines?.enabled).toBe(true);
    expect(result.config.sequencingFiles?.scanDepth).toBe(7);
    expect(result.config.auth?.allowRegistration).toBe(false);

    expect(result.sources["site.name"]).toBe("database");
    expect(result.sources["ena.testMode"]).toBe("database");
    expect(result.sources["auth.allowRegistration"]).toBe("database");
  });

  it("keeps env/file values over database values", async () => {
    const fileConfig = makeResolvedConfig({
      config: {
        ...makeResolvedConfig().config,
        site: { ...makeResolvedConfig().config.site, name: "From File" },
        ena: { ...makeResolvedConfig().config.ena, testMode: true },
      },
      sources: {
        ...makeResolvedConfig().sources,
        "site.name": "file",
        "ena.testMode": "env",
      },
    });

    mocks.loadConfig.mockReturnValue(fileConfig);
    mocks.db.siteSettings.findFirst.mockResolvedValue({
      id: "singleton",
      siteName: "From DB",
      dataBasePath: "/db",
      contactEmail: "db@example.com",
      enaTestMode: false,
      enaUsername: "db-user",
      enaPassword: "db-pass",
      extraSettings: "{}",
    });

    const result = await mergeWithDatabase();

    expect(result.config.site?.name).toBe("From File");
    expect(result.sources["site.name"]).toBe("file");
    expect(result.config.ena?.testMode).toBe(true);
    expect(result.sources["ena.testMode"]).toBe("env");
  });

  it("falls back to file config when extraSettings JSON is invalid", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fileConfig = makeResolvedConfig();
    mocks.loadConfig.mockReturnValue(fileConfig);
    mocks.db.siteSettings.findFirst.mockResolvedValue({
      id: "singleton",
      siteName: "DB Site",
      dataBasePath: "/db",
      contactEmail: null,
      enaTestMode: true,
      enaUsername: null,
      enaPassword: null,
      extraSettings: "{not-json",
    });

    const result = await mergeWithDatabase();

    expect(result).toEqual(fileConfig);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("getEffectiveConfig returns merged config", async () => {
    mocks.loadConfig.mockReturnValue(makeResolvedConfig());
    mocks.db.siteSettings.findFirst.mockResolvedValue({
      id: "singleton",
      siteName: "DB Site",
      dataBasePath: "/db",
      contactEmail: null,
      enaTestMode: true,
      enaUsername: null,
      enaPassword: null,
      extraSettings: "{}",
    });

    const result = await getEffectiveConfig();

    expect(result.config.site?.name).toBe("DB Site");
  });

  it("saveConfigToDatabase throws when site settings are not initialized", async () => {
    mocks.db.siteSettings.findFirst.mockResolvedValue(null);

    await expect(saveConfigToDatabase({ site: { name: "X" } })).rejects.toThrow(
      "Site settings not initialized"
    );
  });

  it("saveConfigToDatabase writes top-level and extra settings, then clears cache", async () => {
    mocks.db.siteSettings.findFirst.mockResolvedValue({
      id: "singleton",
      extraSettings: JSON.stringify({
        auth: { allowRegistration: true },
        pipelines: { enabled: false },
        sequencingFiles: { scanDepth: 2 },
        ena: { centerName: "OLD" },
      }),
    });
    mocks.db.siteSettings.update.mockResolvedValue({});

    const updates: Partial<SeqDeskConfig> = {
      site: {
        name: "New Site",
        dataBasePath: "/new/data",
        contactEmail: "new@example.com",
      },
      ena: {
        testMode: false,
        username: "ena-user",
        password: "ena-pass",
        centerName: "NEW-CENTER",
      },
      auth: {
        allowRegistration: false,
      },
      pipelines: {
        enabled: true,
      },
      sequencingFiles: {
        scanDepth: 9,
      },
    };

    await saveConfigToDatabase(updates);

    expect(mocks.db.siteSettings.update).toHaveBeenCalledTimes(1);
    const callArg = mocks.db.siteSettings.update.mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };

    expect(callArg.where).toEqual({ id: "singleton" });
    expect(callArg.data.siteName).toBe("New Site");
    expect(callArg.data.dataBasePath).toBe("/new/data");
    expect(callArg.data.contactEmail).toBe("new@example.com");
    expect(callArg.data.enaTestMode).toBe(false);
    expect(callArg.data.enaUsername).toBe("ena-user");
    expect(callArg.data.enaPassword).toBe("ena-pass");

    const extra = JSON.parse(String(callArg.data.extraSettings));
    expect(extra.auth.allowRegistration).toBe(false);
    expect(extra.pipelines.enabled).toBe(true);
    expect(extra.sequencingFiles.scanDepth).toBe(9);
    expect(extra.ena.centerName).toBe("NEW-CENTER");

    expect(mocks.clearConfigCache).toHaveBeenCalledTimes(1);
  });

  it("getConfigSection returns a section from effective config", async () => {
    mocks.loadConfig.mockReturnValue(makeResolvedConfig());
    mocks.db.siteSettings.findFirst.mockResolvedValue(null);

    const site = await getConfigSection("site");

    expect(site?.name).toBe("SeqDesk");
  });
});
