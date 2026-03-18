import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  bootstrapRuntimeEnv: vi.fn(),
}));

vi.mock("@/lib/config/runtime-env", () => ({
  bootstrapRuntimeEnv: mocks.bootstrapRuntimeEnv,
}));

import {
  getDatabaseCompatibilityError,
  loadInstalledDatabaseConfig,
} from "./database-config";

let tempDir = "";

beforeEach(async () => {
  vi.clearAllMocks();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-db-config-"));
  delete process.env.DATABASE_URL;
  delete process.env.DIRECT_URL;
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("updater database config", () => {
  it("prefers env vars and resolves DIRECT_URL from DATABASE_URL when missing", async () => {
    process.env.DATABASE_URL =
      "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk?schema=public";

    await expect(loadInstalledDatabaseConfig(tempDir)).resolves.toEqual({
      databaseUrl:
        "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk?schema=public",
      directUrl:
        "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk?schema=public",
      provider: "postgresql",
    });
    expect(mocks.bootstrapRuntimeEnv).toHaveBeenCalledWith(tempDir);
  });

  it("falls back to runtime config file values", async () => {
    await fs.writeFile(
      path.join(tempDir, "seqdesk.config.json"),
      JSON.stringify({
        runtime: {
          databaseUrl:
            "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk?schema=public",
          directUrl:
            "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk_direct?schema=public",
        },
      }),
      "utf8"
    );

    await expect(loadInstalledDatabaseConfig(tempDir)).resolves.toEqual({
      databaseUrl:
        "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk?schema=public",
      directUrl:
        "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk_direct?schema=public",
      provider: "postgresql",
    });
  });

  it("ignores invalid config files and reports unknown providers", async () => {
    await fs.writeFile(path.join(tempDir, "seqdesk.config.json"), "{bad-json", "utf8");

    await expect(loadInstalledDatabaseConfig(tempDir)).resolves.toEqual({
      databaseUrl: null,
      directUrl: null,
      provider: "unknown",
    });
  });

  it("reports compatibility errors for non-postgres installs", () => {
    expect(getDatabaseCompatibilityError("sqlite", "postgresql")).toContain(
      "requires PostgreSQL"
    );
    expect(getDatabaseCompatibilityError("postgresql", "postgresql")).toBeUndefined();
    expect(getDatabaseCompatibilityError("unknown")).toBeUndefined();
  });
});
