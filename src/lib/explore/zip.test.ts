import fs from "fs/promises";
import os from "os";
import path from "path";
import unzipper from "unzipper";
import { describe, expect, it } from "vitest";
import { ZipWriter } from "./zip";

describe("zip writer", () => {
  it("writes deflated entries that standard readers open, with modes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zip-"));
    const target = path.join(dir, "capsule.zip");
    const zip = new ZipWriter(target, new Date(2026, 8, 24, 12, 0, 0));
    await zip.open();
    await zip.add("README.md", "# Capsule\n");
    await zip.add("reproduce", "#!/usr/bin/env bash\necho ok\n", { executable: true });
    await zip.add("steps/1-filter/inputs/counts.tsv", Buffer.from("gene\tc1\n".repeat(1000)));
    await expect(zip.add("../escape", "x")).rejects.toThrow(/Invalid/);
    await expect(zip.add("README.md", "again")).rejects.toThrow(/Duplicate/);
    await zip.close();
    const archive = await unzipper.Open.file(target);
    expect(archive.files.map((file) => file.path)).toEqual(["README.md", "reproduce", "steps/1-filter/inputs/counts.tsv"]);
    expect((await archive.files[0].buffer()).toString()).toBe("# Capsule\n");
    expect((await archive.files[2].buffer()).length).toBe(8000);
    expect((archive.files[1].externalFileAttributes >>> 16) & 0o777).toBe(0o755);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
