import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stageHelperLibrary } from "./loader";

describe("stageHelperLibrary", () => {
  let runFolder: string;

  beforeEach(async () => {
    runFolder = await fs.mkdtemp(path.join(os.tmpdir(), "explore-stage-"));
  });

  afterEach(async () => {
    await fs.rm(runFolder, { recursive: true, force: true });
  });

  it("copies the helper package into the run folder without caches", async () => {
    const libDir = await stageHelperLibrary(runFolder);
    expect(libDir).toBe(path.join(runFolder, "lib"));
    const pkg = path.join(libDir, "python", "seqdesk_explore");
    expect(await fs.readFile(path.join(pkg, "__init__.py"), "utf8")).toContain("def load_dataset(");
    const entries = await fs.readdir(pkg);
    expect(entries).not.toContain("__pycache__");
    expect(entries.some((entry) => entry.endsWith(".pyc"))).toBe(false);
  });

  it("replaces a stale copy on a second staging", async () => {
    await stageHelperLibrary(runFolder);
    const stale = path.join(runFolder, "lib", "python", "seqdesk_explore", "stale.py");
    await fs.writeFile(stale, "old = True\n");
    await stageHelperLibrary(runFolder);
    await expect(fs.access(stale)).rejects.toThrow();
  });
});
