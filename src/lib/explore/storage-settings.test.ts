import os from "os";
import path from "path";
import fs from "fs/promises";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { normalizeStorageSettings, validateStorageSettings } from "./storage-settings";

describe("Explore storage settings", () => {
  it("normalizes and clamps", () => {
    expect(normalizeStorageSettings({})).toEqual({ exploreDir: "", pruneAfterDays: 30 });
    expect(normalizeStorageSettings({ exploreDir: "  /srv/x ", pruneAfterDays: 0 })).toEqual({ exploreDir: "/srv/x", pruneAfterDays: 1 });
  });

  it("rejects relative, root and unsafe folders and bad day counts", async () => {
    await expect(validateStorageSettings({ exploreDir: "data" })).rejects.toThrow(/absolute/);
    await expect(validateStorageSettings({ exploreDir: "/" })).rejects.toThrow(/absolute/);
    await expect(validateStorageSettings({ exploreDir: "/srv/$HOME" })).rejects.toThrow(/quotes/);
    await expect(validateStorageSettings({ pruneAfterDays: 0 })).rejects.toThrow(/1 and 3650/);
    await expect(validateStorageSettings({ pruneAfterDays: 2.5 })).rejects.toThrow(/whole number/);
  });

  it("creates a missing writable folder", async () => {
    const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "explore-settings-")), "nested", "explore");
    expect(await validateStorageSettings({ exploreDir: dir, pruneAfterDays: 14 })).toEqual({ exploreDir: dir, pruneAfterDays: 14 });
    expect((await fs.stat(dir)).isDirectory()).toBe(true);
  });
});
