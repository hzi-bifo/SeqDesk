import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MixsChecklist, MixsConfig } from "@/types/mixs-checklist";
import {
  MIXS_SETTINGS_KEY,
  MIXS_SNAPSHOTS_KEY,
  MIXS_SNAPSHOT_LIMIT,
} from "@/types/mixs-checklist";

// config.ts reads committed JSON via `import fs from "fs"`, so we mock fs and
// drive the loader branches deterministically. The DB-backed functions take a
// `Pick<PrismaClient, "siteSettings">`, so we back them with an in-memory
// singleton row instead of a real Prisma client.
const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));
vi.mock("fs", () => ({ default: fsMock, ...fsMock }));

type ConfigModule = typeof import("./config");

// Fresh module each time so the internal baselineCache does not leak across tests.
async function loadModule(): Promise<ConfigModule> {
  vi.resetModules();
  return import("./config");
}

function makeChecklist(overrides: Partial<MixsChecklist> = {}): MixsChecklist {
  return {
    name: "Test Checklist",
    description: "A checklist",
    version: "1.0",
    source: "ENA",
    category: "mixs",
    accession: "ERC000001",
    fields: [],
    ...overrides,
  };
}

function dirent(name: string, isFile: boolean) {
  return { name, isFile: () => isFile };
}

// Minimal in-memory stand-in for the SiteSettings singleton row.
function makeDb(initialExtra: Record<string, string> = {}) {
  let row:
    | { id: string; extraSettings: string }
    | null = Object.keys(initialExtra).length
    ? { id: "singleton", extraSettings: JSON.stringify(initialExtra) }
    : null;

  const findUnique = vi.fn(async () => row);
  const upsert = vi.fn(
    async ({
      update,
      create,
    }: {
      where: unknown;
      update: { extraSettings: string };
      create: { id: string; extraSettings: string };
    }) => {
      row = row ? { ...row, ...update } : create;
      return row;
    }
  );

  return {
    db: { siteSettings: { findUnique, upsert } } as never,
    findUnique,
    upsert,
    extra: () => (row ? (JSON.parse(row.extraSettings) as Record<string, string>) : {}),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // Sensible defaults: an mixs-full dir that exists with just an _index.json
  // declaring version 1 and no checklist files.
  fsMock.existsSync.mockReturnValue(true);
  fsMock.readdirSync.mockReturnValue([] as never);
  fsMock.readFileSync.mockImplementation((p: unknown) =>
    String(p).endsWith("_index.json") ? JSON.stringify({ version: 1 }) : "{}"
  );
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("sync URL helpers", () => {
  it("normalizes only valid http(s) URLs and rejects everything else", async () => {
    const { normalizeSyncUrl } = await loadModule();
    expect(normalizeSyncUrl("https://example.com/registry")).toBe(
      "https://example.com/registry"
    );
    expect(normalizeSyncUrl("http://h.test/x")).toBe("http://h.test/x");
    expect(normalizeSyncUrl("  https://trim.test/r  ")).toBe("https://trim.test/r");
    expect(normalizeSyncUrl("ftp://nope.test/x")).toBeNull();
    expect(normalizeSyncUrl("not a url")).toBeNull();
    expect(normalizeSyncUrl("")).toBeNull();
    expect(normalizeSyncUrl("   ")).toBeNull();
    expect(normalizeSyncUrl(42)).toBeNull();
    expect(normalizeSyncUrl(null)).toBeNull();
  });

  it("resolveSyncUrl prefers override, then config, then the default", async () => {
    const { resolveSyncUrl, getDefaultMixsSyncUrl } = await loadModule();
    const fallback = getDefaultMixsSyncUrl();
    expect(typeof fallback).toBe("string");
    expect(fallback.length).toBeGreaterThan(0);

    expect(resolveSyncUrl({ version: 1, checklists: [], syncUrl: "https://cfg.test/r" }, "https://override.test/r")).toBe(
      "https://override.test/r"
    );
    expect(resolveSyncUrl({ version: 1, checklists: [], syncUrl: "https://cfg.test/r" })).toBe(
      "https://cfg.test/r"
    );
    // Invalid override falls through to the config URL.
    expect(resolveSyncUrl({ version: 1, checklists: [], syncUrl: "https://cfg.test/r" }, "ftp://bad")).toBe(
      "https://cfg.test/r"
    );
    // Nothing usable anywhere -> default.
    expect(resolveSyncUrl(null, "garbage")).toBe(fallback);
    expect(resolveSyncUrl({ version: 1, checklists: [] })).toBe(fallback);
  });
});

describe("normalizeMixsConfig / parseMixsConfig", () => {
  const defaults: MixsConfig = {
    version: 3,
    checklists: [makeChecklist({ name: "Default" })],
    deprecated: [],
    syncUrl: "https://default.test/r",
  };

  it("returns a copy of defaults for null / non-object input", async () => {
    const { normalizeMixsConfig } = await loadModule();
    expect(normalizeMixsConfig(null, defaults)).toEqual(defaults);
    expect(normalizeMixsConfig(undefined, defaults)).toEqual(defaults);
    expect(normalizeMixsConfig("nope" as never, defaults)).toEqual(defaults);
  });

  it("merges raw over defaults and coerces fields", async () => {
    const { normalizeMixsConfig } = await loadModule();
    const out = normalizeMixsConfig(
      { version: 7 as never, checklists: [makeChecklist({ name: "Raw" })], syncUrl: "https://raw.test/r" },
      defaults
    );
    expect(out.version).toBe(7);
    expect(out.checklists.map((c) => c.name)).toEqual(["Raw"]);
    expect(out.deprecated).toEqual([]);
    expect(out.syncUrl).toBe("https://raw.test/r");
  });

  it("falls back to defaults for non-array checklists, bad version, and blank syncUrl", async () => {
    const { normalizeMixsConfig } = await loadModule();
    const out = normalizeMixsConfig(
      { version: "abc" as never, checklists: "x" as never, deprecated: "y" as never, syncUrl: "   " },
      defaults
    );
    expect(out.version).toBe(defaults.version);
    expect(out.checklists).toEqual(defaults.checklists);
    expect(out.deprecated).toEqual([]);
    expect(out.syncUrl).toBe(defaults.syncUrl);
  });

  it("parseMixsConfig handles strings, objects, falsy, and invalid JSON", async () => {
    const { parseMixsConfig, loadBaselineConfig } = await loadModule();
    const baseline = loadBaselineConfig();

    expect(parseMixsConfig(null)).toEqual(baseline);
    expect(parseMixsConfig("")).toEqual(baseline);
    expect(parseMixsConfig("{ not json")).toEqual(baseline);

    const fromString = parseMixsConfig(JSON.stringify({ version: 9, checklists: [makeChecklist({ name: "S" })] }));
    expect(fromString.version).toBe(9);
    expect(fromString.checklists[0].name).toBe("S");

    const fromObject = parseMixsConfig({ version: 11, checklists: [] });
    expect(fromObject.version).toBe(11);
  });
});

describe("baseline loaders (fs-backed)", () => {
  it("loadBaselineChecklists skips _-prefixed and unreadable files, defaulting available", async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValue([
      "a.json",
      "_index.json",
      "b.json",
      "broken.json",
      "notes.txt",
    ] as never);
    fsMock.readFileSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith("a.json")) return JSON.stringify(makeChecklist({ name: "A", accession: "ACC-A" }));
      if (s.endsWith("b.json")) return JSON.stringify(makeChecklist({ name: "B", accession: "ACC-B", available: false }));
      if (s.endsWith("broken.json")) return "{ this is : not json";
      throw new Error(`unexpected read ${s}`);
    });

    const { loadBaselineChecklists } = await loadModule();
    const result = loadBaselineChecklists();

    expect(result.map((c) => c.name)).toEqual(["A", "B"]);
    expect(result[0].available).toBe(true); // defaulted
    expect(result[1].available).toBe(false); // explicit override preserved
    expect(console.error).toHaveBeenCalled(); // broken.json logged
  });

  it("loadBaselineChecklists returns [] and warns when the directory is missing", async () => {
    fsMock.existsSync.mockReturnValue(false);
    const { loadBaselineChecklists } = await loadModule();
    expect(loadBaselineChecklists()).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });

  it("loadLegacyMixsTemplates returns only mixs-category files", async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValue([
      dirent("legacy-core.json", true),
      dirent("_index.json", true),
      dirent("subdir", false),
      dirent("other.json", true),
      dirent("broken.json", true),
    ] as never);
    fsMock.readFileSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith("legacy-core.json")) return JSON.stringify(makeChecklist({ name: "Legacy Core", category: "mixs" }));
      if (s.endsWith("other.json")) return JSON.stringify(makeChecklist({ name: "Other", category: "sequencing" }));
      if (s.endsWith("broken.json")) return "{ broken";
      throw new Error(`unexpected read ${s}`);
    });

    const { loadLegacyMixsTemplates } = await loadModule();
    const result = loadLegacyMixsTemplates();
    expect(result.map((c) => c.name)).toEqual(["Legacy Core"]);
    expect(result[0].available).toBe(true);
  });

  it("loadLegacyMixsTemplates returns [] when the directory is missing", async () => {
    fsMock.existsSync.mockReturnValue(false);
    const { loadLegacyMixsTemplates } = await loadModule();
    expect(loadLegacyMixsTemplates()).toEqual([]);
  });

  it("loadBaselineConfig reads the index version, caches, and uses the default sync URL", async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValue([] as never);
    fsMock.readFileSync.mockImplementation((p: unknown) =>
      String(p).endsWith("_index.json") ? JSON.stringify({ version: 7 }) : "{}"
    );

    const { loadBaselineConfig, getDefaultMixsSyncUrl } = await loadModule();
    const cfg = loadBaselineConfig();
    expect(cfg.version).toBe(7);
    expect(cfg.checklists).toEqual([]);
    expect(cfg.deprecated).toEqual([]);
    expect(cfg.syncUrl).toBe(getDefaultMixsSyncUrl());

    // Second call is memoized (same reference, no extra reads).
    fsMock.readFileSync.mockClear();
    expect(loadBaselineConfig()).toBe(cfg);
    expect(fsMock.readFileSync).not.toHaveBeenCalled();
  });

  it("loadBaselineConfig defaults version to 1 when the index is unreadable", async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValue([] as never);
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error("no index");
    });
    const { loadBaselineConfig } = await loadModule();
    expect(loadBaselineConfig().version).toBe(1);
  });
});

describe("DB-backed active config", () => {
  it("getActiveMixsConfig falls back to the baseline when nothing is stored", async () => {
    fsMock.readFileSync.mockImplementation((p: unknown) =>
      String(p).endsWith("_index.json") ? JSON.stringify({ version: 4 }) : "{}"
    );
    const { getActiveMixsConfig } = await loadModule();
    const { db, upsert } = makeDb({});
    const cfg = await getActiveMixsConfig(db);
    expect(cfg.version).toBe(4);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("getActiveMixsConfig parses the stored config when present", async () => {
    const { getActiveMixsConfig } = await loadModule();
    const stored: MixsConfig = {
      version: 12,
      checklists: [makeChecklist({ name: "Stored", accession: "ERC0DB" })],
      deprecated: [],
      syncUrl: "https://stored.test/r",
    };
    const { db } = makeDb({ [MIXS_SETTINGS_KEY]: JSON.stringify(stored) });
    const cfg = await getActiveMixsConfig(db);
    expect(cfg.version).toBe(12);
    expect(cfg.checklists[0].name).toBe("Stored");
    expect(cfg.syncUrl).toBe("https://stored.test/r");
  });

  it("getActiveMixsConfig tolerates a corrupt extraSettings blob", async () => {
    const { getActiveMixsConfig } = await loadModule();
    const db = {
      siteSettings: {
        findUnique: vi.fn(async () => ({ id: "singleton", extraSettings: "{ broken" })),
        upsert: vi.fn(),
      },
    } as never;
    const cfg = await getActiveMixsConfig(db);
    // Corrupt blob => empty extra => baseline.
    expect(cfg.version).toBe(1);
  });

  it("saveActiveMixsConfig round-trips through the singleton row", async () => {
    const { saveActiveMixsConfig, getActiveMixsConfig } = await loadModule();
    const { db, upsert } = makeDb({});
    const config: MixsConfig = {
      version: 21,
      checklists: [makeChecklist({ name: "Saved" })],
      deprecated: [],
      syncUrl: "https://saved.test/r",
    };
    await saveActiveMixsConfig(db, config);
    expect(upsert).toHaveBeenCalledTimes(1);
    const back = await getActiveMixsConfig(db);
    expect(back.version).toBe(21);
    expect(back.checklists[0].name).toBe("Saved");
  });

  it("saveActiveMixsConfig preserves other extraSettings keys", async () => {
    const { saveActiveMixsConfig } = await loadModule();
    const { db, extra } = makeDb({ someOtherKey: "keep-me" });
    await saveActiveMixsConfig(db, { version: 2, checklists: [], deprecated: [] });
    const stored = extra();
    expect(stored.someOtherKey).toBe("keep-me");
    expect(stored[MIXS_SETTINGS_KEY]).toBeDefined();
  });
});

describe("snapshotMixsConfig", () => {
  it("is a no-op for a config without a version", async () => {
    const { snapshotMixsConfig } = await loadModule();
    const { db, upsert } = makeDb({});
    await snapshotMixsConfig(db, { version: 0, checklists: [] });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("stores active + deprecated checklists under the version key", async () => {
    const { snapshotMixsConfig } = await loadModule();
    const { db, extra } = makeDb({});
    await snapshotMixsConfig(db, {
      version: 5,
      checklists: [makeChecklist({ name: "Active" })],
      deprecated: [makeChecklist({ name: "Gone", deprecated: true })],
    });
    const snaps = JSON.parse(extra()[MIXS_SNAPSHOTS_KEY]);
    expect(snaps["5"].map((c: MixsChecklist) => c.name)).toEqual(["Active", "Gone"]);
  });

  it("retains only the newest MIXS_SNAPSHOT_LIMIT versions", async () => {
    const { snapshotMixsConfig } = await loadModule();
    const { db, extra } = makeDb({});
    const total = MIXS_SNAPSHOT_LIMIT + 2;
    for (let v = 1; v <= total; v += 1) {
      await snapshotMixsConfig(db, { version: v, checklists: [makeChecklist({ name: `v${v}` })] });
    }
    const snaps = JSON.parse(extra()[MIXS_SNAPSHOTS_KEY]);
    const kept = Object.keys(snaps)
      .map(Number)
      .sort((a, b) => a - b);
    expect(kept).toHaveLength(MIXS_SNAPSHOT_LIMIT);
    expect(kept).toEqual([3, 4, 5, 6, 7]);
  });

  it("recovers from a corrupt existing snapshots blob", async () => {
    const { snapshotMixsConfig } = await loadModule();
    const { db, extra } = makeDb({ [MIXS_SNAPSHOTS_KEY]: "{ broken" });
    await snapshotMixsConfig(db, { version: 2, checklists: [makeChecklist({ name: "Fresh" })] });
    const snaps = JSON.parse(extra()[MIXS_SNAPSHOTS_KEY]);
    expect(Object.keys(snaps)).toEqual(["2"]);
  });
});

describe("getChecklistForStudy resolution order", () => {
  it("returns the pinned snapshot definition first", async () => {
    const { getChecklistForStudy } = await loadModule();
    const snapshots = {
      "3": [makeChecklist({ name: "Historical", accession: "ERC-HIST" })],
    };
    const active: MixsConfig = {
      version: 9,
      checklists: [makeChecklist({ name: "Current", accession: "ERC-HIST" })],
      deprecated: [],
    };
    const { db } = makeDb({
      [MIXS_SNAPSHOTS_KEY]: JSON.stringify(snapshots),
      [MIXS_SETTINGS_KEY]: JSON.stringify(active),
    });
    const hit = await getChecklistForStudy(db, { accession: "ERC-HIST", version: 3 });
    expect(hit?.name).toBe("Historical");
  });

  it("falls through to the active config when no snapshot matches", async () => {
    const { getChecklistForStudy } = await loadModule();
    const active: MixsConfig = {
      version: 9,
      checklists: [makeChecklist({ name: "Soil Package", accession: "ERC-SOIL" })],
      deprecated: [],
    };
    const { db } = makeDb({ [MIXS_SETTINGS_KEY]: JSON.stringify(active) });

    // Match by accession.
    expect((await getChecklistForStudy(db, { accession: "ERC-SOIL" }))?.name).toBe("Soil Package");
    // Match by case-insensitive name substring.
    expect((await getChecklistForStudy(db, { name: "soil" }))?.name).toBe("Soil Package");
    // Pinned version with no snapshot still resolves against active.
    expect((await getChecklistForStudy(db, { accession: "ERC-SOIL", version: 99 }))?.name).toBe("Soil Package");
  });

  it("falls through to deprecated, then to the baseline files", async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readdirSync.mockReturnValue(["baseline.json"] as never);
    fsMock.readFileSync.mockImplementation((p: unknown) => {
      const s = String(p);
      if (s.endsWith("_index.json")) return JSON.stringify({ version: 1 });
      if (s.endsWith("baseline.json")) return JSON.stringify(makeChecklist({ name: "Baseline Pkg", accession: "ERC-BASE" }));
      return "{}";
    });

    const { getChecklistForStudy } = await loadModule();
    const active: MixsConfig = {
      version: 9,
      checklists: [makeChecklist({ name: "Active", accession: "ERC-ACTIVE" })],
      deprecated: [makeChecklist({ name: "Old Pkg", accession: "ERC-OLD", deprecated: true })],
    };
    const { db } = makeDb({ [MIXS_SETTINGS_KEY]: JSON.stringify(active) });

    expect((await getChecklistForStudy(db, { accession: "ERC-OLD" }))?.name).toBe("Old Pkg");
    expect((await getChecklistForStudy(db, { accession: "ERC-BASE" }))?.name).toBe("Baseline Pkg");
  });

  it("tolerates a corrupt snapshots blob when resolving a pinned version", async () => {
    const { getChecklistForStudy } = await loadModule();
    const active: MixsConfig = {
      version: 9,
      checklists: [makeChecklist({ name: "Active", accession: "ERC-A" })],
      deprecated: [],
    };
    const { db } = makeDb({
      [MIXS_SNAPSHOTS_KEY]: "{ broken",
      [MIXS_SETTINGS_KEY]: JSON.stringify(active),
    });
    // Corrupt snapshots blob => readSnapshots returns {} => falls through to active.
    expect((await getChecklistForStudy(db, { accession: "ERC-A", version: 3 }))?.name).toBe("Active");
  });

  it("returns undefined when no query field matches anywhere", async () => {
    const { getChecklistForStudy } = await loadModule();
    const { db } = makeDb({ [MIXS_SETTINGS_KEY]: JSON.stringify({ version: 1, checklists: [], deprecated: [] }) });
    expect(await getChecklistForStudy(db, {})).toBeUndefined();
    expect(await getChecklistForStudy(db, { accession: "nope" })).toBeUndefined();
  });
});
