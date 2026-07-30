import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { inspectDataStoragePath } from "./data-storage-path-validation";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("inspectDataStoragePath", () => {
  it("accepts an absolute readable directory and reports its canonical path", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-data-path-"));
    tempDirs.push(dir);

    await expect(inspectDataStoragePath(dir)).resolves.toMatchObject({
      valid: true,
      configuredPath: dir,
      resolvedPath: fs.realpathSync(dir),
      readable: true,
      writable: true,
    });
  });

  it("accepts a symlink to a directory without replacing the configured mount path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-data-symlink-"));
    tempDirs.push(root);
    const target = path.join(root, "target");
    const link = path.join(root, "storage");
    fs.mkdirSync(target);
    fs.symlinkSync(target, link, "dir");

    await expect(inspectDataStoragePath(link)).resolves.toMatchObject({
      valid: true,
      configuredPath: link,
      resolvedPath: fs.realpathSync(target),
    });
  });

  it.each(["", "relative/data"])("rejects an empty or relative path: %s", async (value) => {
    await expect(inspectDataStoragePath(value)).resolves.toMatchObject({
      valid: false,
      readable: false,
    });
  });

  it("rejects the canonical filesystem root, including through a symlink", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-root-link-"));
    tempDirs.push(root);
    const link = path.join(root, "storage");
    fs.symlinkSync(path.parse(root).root, link, "dir");

    await expect(inspectDataStoragePath(path.parse(root).root)).resolves.toMatchObject({
      valid: false,
      error: expect.stringMatching(/filesystem root/i),
    });
    await expect(inspectDataStoragePath(link)).resolves.toMatchObject({
      valid: false,
      error: expect.stringMatching(/filesystem root/i),
    });
  });

  it("rejects a missing path and a regular file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-data-invalid-"));
    tempDirs.push(root);
    const file = path.join(root, "reads.fastq");
    fs.writeFileSync(file, "");

    await expect(inspectDataStoragePath(path.join(root, "missing"))).resolves.toMatchObject({
      valid: false,
      error: expect.stringMatching(/does not exist/i),
    });
    await expect(inspectDataStoragePath(file)).resolves.toMatchObject({
      valid: false,
      error: expect.stringMatching(/not a directory/i),
    });
  });
});
