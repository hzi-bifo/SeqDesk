import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const scriptPath = path.join(process.cwd(), "scripts", "run-prisma.mjs");
const postgresEnv = {
  ...process.env,
  DATABASE_URL: "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk?schema=public",
  DIRECT_URL: "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk?schema=public",
};

let tempDir = "";

async function writeFakePrisma(version: string) {
  const binDir = path.join(tempDir, "node_modules", ".bin");
  await fs.mkdir(binDir, { recursive: true });
  const prismaPath = path.join(binDir, "prisma");
  await fs.writeFile(
    prismaPath,
    `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  console.log("prisma                  : ${version}");
  process.exit(0);
}
console.log(process.argv.slice(2).join(" "));
`,
    "utf8"
  );
  await fs.chmod(prismaPath, 0o755);
}

describe("scripts/run-prisma.mjs", () => {
  beforeEach(async () => {
    tempDir = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-run-prisma-"))
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("uses the local Prisma 5 CLI", async () => {
    await writeFakePrisma("5.22.0");

    const result = spawnSync(process.execPath, [scriptPath, "migrate", "deploy"], {
      cwd: tempDir,
      env: postgresEnv,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Prisma migrate deploy completed.");
  });

  it("fails instead of falling back to npx when local Prisma is missing", () => {
    const result = spawnSync(process.execPath, [scriptPath, "generate"], {
      cwd: tempDir,
      env: postgresEnv,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Local Prisma CLI not found");
    expect(result.stderr).toContain("npm ci --omit=dev");
  });

  it("rejects Prisma 7", async () => {
    await writeFakePrisma("7.8.0");

    const result = spawnSync(process.execPath, [scriptPath, "generate"], {
      cwd: tempDir,
      env: postgresEnv,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unsupported local Prisma CLI version 7.8.0");
    expect(result.stderr).toContain("requires Prisma CLI 5.x");
  });
});
