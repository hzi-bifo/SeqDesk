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

describe("lock credentials", () => {
  it("strips anaconda.org tokens, user:password and token parameters from channel URLs", async () => {
    const { stripChannelCredentials } = await import("./environment-lock");
    const lock = [
      "@EXPLICIT",
      "https://conda.anaconda.org/t/ab-12345678-aaaa-bbbb-cccc-1234567890ab/conda-forge/linux-64/zlib-1.3.1-hb9d3cd8_2.conda#c9f075ab2f33b3bbee9e62d4ad0a6cd8",
      "https://user:s3cret@repo.example.org/channel/noarch/pkg-1.0-0.tar.bz2#0123",
      "https://repo.example.org/channel/noarch/pkg-2.0-0.tar.bz2?token=abc123&x=1#0456",
    ].join("\n");
    const clean = stripChannelCredentials(lock);
    expect(clean).toContain("https://conda.anaconda.org/conda-forge/linux-64/zlib-1.3.1-hb9d3cd8_2.conda#c9f075ab2f33b3bbee9e62d4ad0a6cd8");
    expect(clean).toContain("https://repo.example.org/channel/noarch/pkg-1.0-0.tar.bz2#0123");
    expect(clean).toContain("?token=REDACTED&x=1");
    expect(clean).not.toMatch(/ab-12345678|s3cret|abc123/);
  });

  it("reads the lock from conda-meta without conda and sorts it by package", async () => {
    const fs = await import("fs/promises");
    const os = await import("os");
    const path = await import("path");
    const { readExplicitLock, lockDigestOf } = await import("./environment-lock");
    const prefix = await fs.mkdtemp(path.join(os.tmpdir(), "lock-"));
    await fs.mkdir(path.join(prefix, "conda-meta"));
    await fs.writeFile(path.join(prefix, "conda-meta", "zlib-1.json"), JSON.stringify({ name: "zlib", url: "https://conda.anaconda.org/t/xy-secret-token/conda-forge/linux-64/zlib-1.conda", md5: "aa" }));
    await fs.writeFile(path.join(prefix, "conda-meta", "bash-5.json"), JSON.stringify({ name: "bash", channel: "https://conda.anaconda.org/conda-forge", subdir: "linux-64", fn: "bash-5.conda", md5: "bb" }));
    await fs.writeFile(path.join(prefix, "conda-meta", "history"), "not json");
    const lock = await readExplicitLock(prefix);
    expect(lock).toBe("@EXPLICIT\nhttps://conda.anaconda.org/conda-forge/linux-64/bash-5.conda#bb\nhttps://conda.anaconda.org/conda-forge/linux-64/zlib-1.conda#aa\n");
    expect(lockDigestOf(lock)).toMatch(/^[0-9a-f]{64}$/);
    expect(await readExplicitLock(path.join(prefix, "missing"))).toBeNull();
    await fs.rm(prefix, { recursive: true, force: true });
  });
});

describe("prefix credential scrub", () => {
  it("rewrites conda-meta records and the build log without the channel token", async () => {
    const fs = await import("fs/promises");
    const os = await import("os");
    const path = await import("path");
    const { scrubPrefixCredentials } = await import("./conda-credentials");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scrub-"));
    const prefix = path.join(root, "env");
    await fs.mkdir(path.join(prefix, "conda-meta"), { recursive: true });
    const record = { name: "zlib", url: "https://conda.anaconda.org/t/xy-0000-secret/conda-forge/linux-64/zlib-1.conda", channel: "https://conda.anaconda.org/t/xy-0000-secret/conda-forge" };
    await fs.writeFile(path.join(prefix, "conda-meta", "zlib-1.json"), JSON.stringify(record));
    await fs.writeFile(path.join(prefix, "conda-meta", "clean-1.json"), JSON.stringify({ name: "clean", url: "https://conda.anaconda.org/conda-forge/noarch/clean-1.conda" }));
    await fs.writeFile(`${prefix}.log`, "Downloading https://conda.anaconda.org/t/xy-0000-secret/conda-forge/linux-64/zlib-1.conda\n");
    expect(await scrubPrefixCredentials(prefix, `${prefix}.log`)).toBe(2);
    const rewritten = JSON.parse(await fs.readFile(path.join(prefix, "conda-meta", "zlib-1.json"), "utf8"));
    expect(rewritten).toEqual({ name: "zlib", url: "https://conda.anaconda.org/conda-forge/linux-64/zlib-1.conda", channel: "https://conda.anaconda.org/conda-forge" });
    expect(await fs.readFile(`${prefix}.log`, "utf8")).not.toContain("secret");
    expect(await scrubPrefixCredentials(prefix, `${prefix}.log`)).toBe(0);
    await fs.rm(root, { recursive: true, force: true });
  });
});
