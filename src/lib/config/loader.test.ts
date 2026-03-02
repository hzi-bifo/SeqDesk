import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

import {
  clearConfigCache,
  getConfigValue,
  loadConfig,
  validateConfig,
} from "./loader";

const ENV_KEYS = [
  "SEQDESK_SITE_NAME",
  "SEQDESK_DATA_PATH",
  "SEQDESK_PIPELINES_ENABLED",
  "SEQDESK_PIPELINE_MODE",
  "SEQDESK_FILES_EXTENSIONS",
  "SEQDESK_FILES_SCAN_DEPTH",
  "SEQDESK_SESSION_TIMEOUT",
  "SEQDESK_ENA_TEST_MODE",
] as const;

let cwdBefore = "";
let envBefore: Record<string, string | undefined> = {};
let tempDir = "";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeConfigFile(dir: string, config: unknown): Promise<void> {
  await fs.writeFile(
    path.join(dir, "seqdesk.config.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );
}

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe("config loader", () => {
  beforeEach(async () => {
    clearConfigCache();
    cwdBefore = process.cwd();
    envBefore = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

    ENV_KEYS.forEach((key) => delete process.env[key]);

    tempDir = await makeTempDir("seqdesk-config-");
    process.chdir(tempDir);
  });

  afterEach(async () => {
    clearConfigCache();
    process.chdir(cwdBefore);
    for (const key of ENV_KEYS) {
      setEnv(key, envBefore[key]);
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("loads defaults when no file or env values are present", () => {
    const resolved = loadConfig(true);

    expect(resolved.filePath).toBeUndefined();
    expect(resolved.config.site?.name).toBe("SeqDesk");
    expect(resolved.config.sequencingFiles?.scanDepth).toBe(2);
    expect(resolved.sources["site.name"]).toBe("default");
  });

  it("applies file values over defaults", async () => {
    await writeConfigFile(tempDir, {
      site: { name: "From File" },
      sequencingFiles: { scanDepth: 4 },
    });

    const resolved = loadConfig(true);
    const expectedPath = await fs.realpath(path.join(tempDir, "seqdesk.config.json"));
    const actualPath = await fs.realpath(resolved.filePath || "");

    expect(actualPath).toBe(expectedPath);
    expect(resolved.config.site?.name).toBe("From File");
    expect(resolved.config.sequencingFiles?.scanDepth).toBe(4);
    expect(resolved.sources["site.name"]).toBe("file");
  });

  it("applies env values over file values and parses env types", async () => {
    await writeConfigFile(tempDir, {
      site: { name: "From File" },
      pipelines: { enabled: false },
      sequencingFiles: { scanDepth: 2, extensions: [".fastq.gz"] },
      auth: { sessionTimeout: 24 },
      ena: { testMode: true },
    });

    process.env.SEQDESK_SITE_NAME = "From Env";
    process.env.SEQDESK_PIPELINES_ENABLED = "true";
    process.env.SEQDESK_FILES_SCAN_DEPTH = "6";
    process.env.SEQDESK_FILES_EXTENSIONS = ".fq.gz, .fastq";
    process.env.SEQDESK_SESSION_TIMEOUT = "48";
    process.env.SEQDESK_ENA_TEST_MODE = "false";

    const resolved = loadConfig(true);

    expect(resolved.config.site?.name).toBe("From Env");
    expect(resolved.config.pipelines?.enabled).toBe(true);
    expect(resolved.config.sequencingFiles?.scanDepth).toBe(6);
    expect(resolved.config.sequencingFiles?.extensions).toEqual([".fq.gz", ".fastq"]);
    expect(resolved.config.auth?.sessionTimeout).toBe(48);
    expect(resolved.config.ena?.testMode).toBe(false);
    expect(resolved.sources["site.name"]).toBe("env");
    expect(resolved.sources["sequencingFiles.scanDepth"]).toBe("env");
  });

  it("getConfigValue returns value/source and respects fallback", () => {
    const siteName = getConfigValue<string>("site.name");
    expect(siteName.value).toBe("SeqDesk");
    expect(siteName.source).toBe("default");

    const fallback = getConfigValue<number>("runtime.missing.value", 123);
    expect(fallback.value).toBe(123);
    expect(fallback.source).toBe("default");
  });

  it("uses cache until forceReload or clearConfigCache", async () => {
    await writeConfigFile(tempDir, { site: { name: "v1" } });

    const first = loadConfig(true);
    expect(first.config.site?.name).toBe("v1");

    await writeConfigFile(tempDir, { site: { name: "v2" } });

    const cached = loadConfig();
    expect(cached.config.site?.name).toBe("v1");

    const forced = loadConfig(true);
    expect(forced.config.site?.name).toBe("v2");

    clearConfigCache();
    const reloaded = loadConfig();
    expect(reloaded.config.site?.name).toBe("v2");
  });

  it("validateConfig reports invalid values", () => {
    const invalid = validateConfig({
      site: { dataBasePath: 42 },
      pipelines: { execution: { mode: "invalid-mode" } },
      ena: { testMode: "yes" },
      sequencingFiles: { scanDepth: 99 },
    });

    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toContain("site.dataBasePath must be a string");
    expect(
      invalid.errors.some((e) => e.includes("pipelines.execution.mode must be one of"))
    ).toBe(true);
    expect(invalid.errors).toContain("ena.testMode must be a boolean");
    expect(invalid.errors).toContain(
      "sequencingFiles.scanDepth must be a number between 1 and 10"
    );
  });

  it("validateConfig accepts valid values", () => {
    const valid = validateConfig({
      site: { dataBasePath: "./data" },
      pipelines: { execution: { mode: "slurm" } },
      ena: { testMode: false },
      sequencingFiles: { scanDepth: 3 },
    });

    expect(valid.valid).toBe(true);
    expect(valid.errors).toEqual([]);
  });
});
