import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), execFile: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { exploreEnvironment: { findUnique: mocks.find, update: mocks.update } } }));
vi.mock("./environments", () => ({ resolveCondaExecutable: vi.fn().mockResolvedValue("/opt/conda/bin/conda") }));
vi.mock("child_process", () => ({ execFile: mocks.execFile }));

import { environmentLabel, parseLanguageVersion, pinEnvironment } from "./environment-lock";

describe("environment lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({});
  });
  it("parses language versions and writes the label", () => {
    expect(parseLanguageVersion("Python 3.12.4\n")).toBe("3.12.4");
    expect(parseLanguageVersion("R version 4.4.1 (2024-06-14) -- \"Race for Your Life\"")).toBe("4.4.1");
    expect(parseLanguageVersion(null)).toBeNull();
    expect(environmentLabel("r", "4.4.1", "5c1e9a77")).toBe("R 4.4.1 · lock 5c1e9a");
    expect(environmentLabel("python", null, null)).toBe("Python");
  });
  it("computes the lock digest once per spec hash and caches it", async () => {
    mocks.find.mockResolvedValue({ name: "env", status: "ready", prefixPath: "/envs/p", specHash: "s1", lockSpecHash: null, lockDigest: null, languageVersion: null });
    mocks.execFile.mockImplementation((command: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) =>
      callback(null, command.endsWith("conda") ? "# platform: osx-arm64\n@EXPLICIT\nhttps://x/pkg.conda#abc\n" : "Python 3.12.4\n", ""));
    const pin = await pinEnvironment("env", "python");
    expect(pin?.lockDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(pin?.label).toMatch(/^Python 3\.12\.4 · lock [a-f0-9]{6}$/);
    expect(mocks.update).toHaveBeenCalledWith({ where: { name: "env" }, data: expect.objectContaining({ lockSpecHash: "s1", languageVersion: "3.12.4" }) });

    mocks.execFile.mockClear();
    mocks.find.mockResolvedValue({ name: "env", status: "ready", prefixPath: "/envs/p", specHash: "s1", lockSpecHash: "s1", lockDigest: "d".repeat(64), languageVersion: "3.12.4" });
    expect((await pinEnvironment("env", "python"))?.lockDigest).toBe("d".repeat(64));
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
  it("returns null for environments that are not ready", async () => {
    mocks.find.mockResolvedValue({ name: "env", status: "building", prefixPath: null });
    expect(await pinEnvironment("env", "python")).toBeNull();
  });
});
