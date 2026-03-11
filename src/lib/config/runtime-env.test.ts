import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

import { bootstrapRuntimeEnv } from "./runtime-env";

const TARGET_ENV_KEYS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "ANTHROPIC_API_KEY",
  "ADMIN_SECRET",
  "BLOB_READ_WRITE_TOKEN",
  "SEQDESK_UPDATE_SERVER",
] as const;

let envBefore: Record<string, string | undefined> = {};
let tempDir = "";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(dir: string, name: string, content: string): Promise<void> {
  await fs.writeFile(path.join(dir, name), content, "utf-8");
}

function resetBootstrapGuard(): void {
  delete (globalThis as { __seqdeskRuntimeEnvBootstrapped?: boolean })
    .__seqdeskRuntimeEnvBootstrapped;
}

describe("bootstrapRuntimeEnv", () => {
  beforeEach(async () => {
    resetBootstrapGuard();
    envBefore = Object.fromEntries(TARGET_ENV_KEYS.map((k) => [k, process.env[k]]));
    TARGET_ENV_KEYS.forEach((k) => delete process.env[k]);
    tempDir = await makeTempDir("seqdesk-runtime-");
  });

  afterEach(async () => {
    resetBootstrapGuard();
    for (const key of TARGET_ENV_KEYS) {
      const value = envBefore[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("does nothing when no config file exists", () => {
    bootstrapRuntimeEnv(tempDir);
    for (const key of TARGET_ENV_KEYS) {
      expect(process.env[key]).toBeUndefined();
    }
  });

  it("maps runtime values into env when missing", async () => {
    await writeFile(
      tempDir,
      "seqdesk.config.json",
      JSON.stringify({
        runtime: {
          databaseUrl: "postgres://local/db",
          directUrl: "postgres://direct/db",
          nextAuthUrl: "https://seqdesk.local",
          nextAuthSecret: "secret",
          anthropicApiKey: "anthropic-key",
          adminSecret: "admin-secret",
          blobReadWriteToken: "blob-token",
          updateServer: "https://updates.seqdesk.local",
        },
      })
    );

    bootstrapRuntimeEnv(tempDir);

    expect(process.env.DATABASE_URL).toBe("postgres://local/db");
    expect(process.env.DIRECT_URL).toBe("postgres://direct/db");
    expect(process.env.NEXTAUTH_URL).toBe("https://seqdesk.local");
    expect(process.env.NEXTAUTH_SECRET).toBe("secret");
    expect(process.env.ANTHROPIC_API_KEY).toBe("anthropic-key");
    expect(process.env.ADMIN_SECRET).toBe("admin-secret");
    expect(process.env.BLOB_READ_WRITE_TOKEN).toBe("blob-token");
    expect(process.env.SEQDESK_UPDATE_SERVER).toBe("https://updates.seqdesk.local");
  });

  it("defaults DIRECT_URL to DATABASE_URL when directUrl is omitted", async () => {
    await writeFile(
      tempDir,
      "seqdesk.config.json",
      JSON.stringify({
        runtime: {
          databaseUrl: "postgres://local/db",
        },
      })
    );

    bootstrapRuntimeEnv(tempDir);

    expect(process.env.DATABASE_URL).toBe("postgres://local/db");
    expect(process.env.DIRECT_URL).toBe("postgres://local/db");
  });

  it("does not overwrite existing env values", async () => {
    process.env.DATABASE_URL = "postgres://already/set";

    await writeFile(
      tempDir,
      "seqdesk.config.json",
      JSON.stringify({
        runtime: {
          databaseUrl: "postgres://from/config",
        },
      })
    );

    bootstrapRuntimeEnv(tempDir);

    expect(process.env.DATABASE_URL).toBe("postgres://already/set");
  });

  it("aligns DIRECT_URL with an env DATABASE_URL override", async () => {
    process.env.DATABASE_URL = "postgres://env/db";

    await writeFile(
      tempDir,
      "seqdesk.config.json",
      JSON.stringify({
        runtime: {
          databaseUrl: "postgres://from/config",
          directUrl: "file:./dev.db",
        },
      })
    );

    bootstrapRuntimeEnv(tempDir);

    expect(process.env.DATABASE_URL).toBe("postgres://env/db");
    expect(process.env.DIRECT_URL).toBe("postgres://env/db");
  });

  it("ignores invalid JSON", async () => {
    await writeFile(tempDir, "seqdesk.config.json", "{not-json");
    expect(() => bootstrapRuntimeEnv(tempDir)).not.toThrow();
    expect(process.env.DATABASE_URL).toBeUndefined();
  });

  it("ignores empty and non-string runtime values", async () => {
    await writeFile(
      tempDir,
      "seqdesk.config.json",
      JSON.stringify({
        runtime: {
          databaseUrl: "   ",
          nextAuthSecret: 123,
          adminSecret: "ok",
        },
      })
    );

    bootstrapRuntimeEnv(tempDir);

    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(process.env.DIRECT_URL).toBeUndefined();
    expect(process.env.NEXTAUTH_SECRET).toBeUndefined();
    expect(process.env.ADMIN_SECRET).toBe("ok");
  });

  it("is idempotent once bootstrapped", async () => {
    await writeFile(
      tempDir,
      "seqdesk.config.json",
      JSON.stringify({ runtime: { databaseUrl: "postgres://first" } })
    );

    bootstrapRuntimeEnv(tempDir);
    expect(process.env.DATABASE_URL).toBe("postgres://first");

    await writeFile(
      tempDir,
      "seqdesk.config.json",
      JSON.stringify({ runtime: { databaseUrl: "postgres://second" } })
    );

    bootstrapRuntimeEnv(tempDir);
    expect(process.env.DATABASE_URL).toBe("postgres://first");
  });

  it("supports alternate config filenames", async () => {
    await writeFile(
      tempDir,
      ".seqdeskrc",
      JSON.stringify({ runtime: { databaseUrl: "postgres://from-seqdeskrc" } })
    );

    bootstrapRuntimeEnv(tempDir);
    expect(process.env.DATABASE_URL).toBe("postgres://from-seqdeskrc");

    resetBootstrapGuard();
    delete process.env.DATABASE_URL;
    await fs.rm(path.join(tempDir, ".seqdeskrc"), { force: true });

    await writeFile(
      tempDir,
      ".seqdeskrc.json",
      JSON.stringify({ runtime: { databaseUrl: "postgres://from-seqdeskrc-json" } })
    );

    bootstrapRuntimeEnv(tempDir);
    expect(process.env.DATABASE_URL).toBe("postgres://from-seqdeskrc-json");
  });
});
