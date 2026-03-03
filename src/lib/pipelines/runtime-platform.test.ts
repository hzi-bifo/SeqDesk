import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

import {
  detectRuntimePlatform,
  isMacOsArmRuntime,
  resolveCondaBin,
} from "./runtime-platform";

const createdDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

async function writeExecutable(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, { mode: 0o755 });
  await fs.chmod(filePath, 0o755);
}

async function createFakeConda(
  condaPath: string,
  jsonStdout: string,
  folder: "condabin" | "bin" = "condabin"
): Promise<string> {
  const condaBinPath = path.join(condaPath, folder, "conda");
  const script = `#!/bin/sh\nif [ "$1" = "info" ] && [ "$2" = "--json" ]; then\n  printf '%s\\n' '${jsonStdout}'\n  exit 0\nfi\nexit 1\n`;
  await writeExecutable(condaBinPath, script);
  return condaBinPath;
}

afterEach(async () => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("runtime-platform", () => {
  it("resolveCondaBin prefers condabin/conda when present", async () => {
    const condaPath = await makeTempDir("seqdesk-conda-");
    const condabinPath = await createFakeConda(condaPath, '{"subdir":"linux-64"}', "condabin");
    await createFakeConda(condaPath, '{"subdir":"linux-64"}', "bin");

    const resolved = await resolveCondaBin(condaPath);

    expect(resolved).toBe(condabinPath);
  });

  it("resolveCondaBin falls back to bin/conda", async () => {
    const condaPath = await makeTempDir("seqdesk-conda-");
    const binPath = await createFakeConda(condaPath, '{"subdir":"linux-64"}', "bin");

    const resolved = await resolveCondaBin(condaPath);

    expect(resolved).toBe(binPath);
  });

  it("detectRuntimePlatform uses conda subdir when available", async () => {
    const condaPath = await makeTempDir("seqdesk-conda-");
    await createFakeConda(condaPath, '{"subdir":"osx-arm64"}');

    const platform = await detectRuntimePlatform(condaPath);

    expect(platform).toEqual({
      os: "darwin",
      arch: "arm64",
      raw: "osx-arm64",
      source: "conda",
    });
  });

  it("supports apostrophes in conda path (shell quoting)", async () => {
    const root = await makeTempDir("seqdesk-conda-");
    const quotedCondaPath = path.join(root, "with'quote");
    await createFakeConda(quotedCondaPath, '{"subdir":"linux-64"}');

    const platform = await detectRuntimePlatform(quotedCondaPath);

    expect(platform).toEqual({
      os: "linux",
      arch: "64",
      raw: "linux-64",
      source: "conda",
    });
  });

  it("falls back to conda platform field when subdir is absent", async () => {
    const condaPath = await makeTempDir("seqdesk-conda-");
    await createFakeConda(condaPath, '{"platform":"win-64"}');

    const platform = await detectRuntimePlatform(condaPath);

    expect(platform).toEqual({
      os: "win32",
      arch: "64",
      raw: "win-64",
      source: "conda",
    });
  });

  it("falls back to node runtime for unsupported conda subdir formats", async () => {
    const condaPath = await makeTempDir("seqdesk-conda-");
    await createFakeConda(condaPath, '{"subdir":"x86_64"}');

    const platform = await detectRuntimePlatform(condaPath);

    expect(platform.source).toBe("node");
    expect(platform.os).toBe(process.platform);
    expect(platform.arch).toBe(process.arch);
    expect(platform.raw).toBe(`${process.platform}-${process.arch}`);
  });

  it("falls back to node runtime when conda JSON is invalid", async () => {
    const condaPath = await makeTempDir("seqdesk-conda-");
    await createFakeConda(condaPath, "{bad-json");

    const platform = await detectRuntimePlatform(condaPath);

    expect(platform.source).toBe("node");
    expect(platform.os).toBe(process.platform);
    expect(platform.arch).toBe(process.arch);
    expect(platform.raw).toBe(`${process.platform}-${process.arch}`);
  });

  it("falls back to node runtime when conda subdir cannot be parsed", async () => {
    const condaPath = await makeTempDir("seqdesk-conda-");
    await createFakeConda(condaPath, '{"subdir":"unknown"}');

    const platform = await detectRuntimePlatform(condaPath);

    expect(platform.source).toBe("node");
    expect(platform.os).toBe(process.platform);
    expect(platform.arch).toBe(process.arch);
  });

  it("detects macOS ARM runtime correctly", () => {
    expect(
      isMacOsArmRuntime({
        os: "darwin",
        arch: "arm64",
        raw: "osx-arm64",
        source: "conda",
      })
    ).toBe(true);

    expect(
      isMacOsArmRuntime({
        os: "darwin",
        arch: "aarch64",
        raw: "osx-aarch64",
        source: "conda",
      })
    ).toBe(true);

    expect(
      isMacOsArmRuntime({
        os: "linux",
        arch: "arm64",
        raw: "linux-aarch64",
        source: "conda",
      })
    ).toBe(false);
  });
});
