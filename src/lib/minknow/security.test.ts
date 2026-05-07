import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { validateOutputDirUnderRoot } from "./security";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stream-security-"));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("validateOutputDirUnderRoot", () => {
  it("rejects when outputRoot is empty", async () => {
    const result = await validateOutputDirUnderRoot("/data/run", "");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/outputRoot is not configured/);
  });

  it("rejects when outputDir is missing", async () => {
    const result = await validateOutputDirUnderRoot("", "/data");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/outputDir is required/);
  });

  it("rejects relative paths", async () => {
    const result = await validateOutputDirUnderRoot("relative/run", "/data");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/absolute path/);
  });

  it("accepts a directory inside the configured root", async () => {
    const root = await fs.mkdtemp(path.join(tmpRoot, "root-"));
    const child = path.join(root, "experiment", "sample", "run");
    await fs.mkdir(child, { recursive: true });
    const result = await validateOutputDirUnderRoot(child, root);
    expect(result.ok).toBe(true);
    expect(result.realpath).toBe(await fs.realpath(child));
  });

  it("rejects a directory outside the configured root", async () => {
    const root = await fs.mkdtemp(path.join(tmpRoot, "root-"));
    const sibling = await fs.mkdtemp(path.join(tmpRoot, "elsewhere-"));
    const result = await validateOutputDirUnderRoot(sibling, root);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not under the configured outputRoot/);
  });

  it("rejects symlink that points outside the root", async () => {
    const root = await fs.mkdtemp(path.join(tmpRoot, "root-"));
    const escape = await fs.mkdtemp(path.join(tmpRoot, "escape-"));
    const link = path.join(root, "link");
    await fs.symlink(escape, link);
    const result = await validateOutputDirUnderRoot(link, root);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not under the configured outputRoot/);
  });

  it("accepts symlink that points back inside the root", async () => {
    const root = await fs.mkdtemp(path.join(tmpRoot, "root-"));
    const inner = path.join(root, "inner");
    await fs.mkdir(inner);
    const link = path.join(root, "link");
    await fs.symlink(inner, link);
    const result = await validateOutputDirUnderRoot(link, root);
    expect(result.ok).toBe(true);
  });

  it("rejects when outputDir does not exist", async () => {
    const root = await fs.mkdtemp(path.join(tmpRoot, "root-"));
    const result = await validateOutputDirUnderRoot(path.join(root, "missing"), root);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not exist or is unreadable/);
  });

  it("accepts the root itself", async () => {
    const root = await fs.mkdtemp(path.join(tmpRoot, "root-"));
    const result = await validateOutputDirUnderRoot(root, root);
    expect(result.ok).toBe(true);
  });
});
