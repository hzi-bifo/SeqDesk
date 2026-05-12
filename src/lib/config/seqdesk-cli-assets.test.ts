import { execFile } from "child_process";
import fs from "fs/promises";
import http from "http";
import os from "os";
import path from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "npm", "seqdesk", "bin", "seqdesk.js");

let tempDir: string;

async function createFakeInstall(scriptBody?: string) {
  const installDir = path.join(tempDir, `install-${Date.now()}`);
  await fs.mkdir(path.join(installDir, "scripts"), { recursive: true });
  await fs.writeFile(
    path.join(installDir, "package.json"),
    JSON.stringify({ name: "seqdesk", version: "0.0.0-test" }, null, 2)
  );
  await fs.writeFile(
    path.join(installDir, "scripts", "apply-install-profile-assets.mjs"),
    scriptBody ??
      [
        "const result = { cwd: process.cwd(), argv: process.argv.slice(2) };",
        "console.log(JSON.stringify(result));",
        "",
      ].join("\n")
  );
  return installDir;
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected TCP server address"));
        return;
      }
      resolve(address.port);
    });
  });
}

describe("seqdesk assets apply CLI", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-cli-assets-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("prints assets apply help", async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      "assets",
      "apply",
      "--help",
    ]);

    expect(stdout).toContain("seqdesk assets apply");
    expect(stdout).toContain("--profile-config <file>");
  });

  it("fails before applying assets when the install dir is missing", async () => {
    await expect(
      execFileAsync(process.execPath, [
        cliPath,
        "assets",
        "apply",
        "--dir",
        path.join(tempDir, "missing"),
        "--profile",
        "dev",
        "--profile-code",
        "secret-code",
      ])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Install directory does not exist"),
    });
  });

  it("requires a profile code when resolving a hosted profile", async () => {
    const installDir = await createFakeInstall();

    await expect(
      execFileAsync(process.execPath, [
        cliPath,
        "assets",
        "apply",
        "--dir",
        installDir,
        "--profile",
        "dev",
      ])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("--profile-code is required for profile 'dev'"),
    });
  });

  it("invokes the installed asset script with an explicit profile config", async () => {
    const installDir = await createFakeInstall();
    const profileConfig = path.join(tempDir, "profile.json");
    await fs.writeFile(profileConfig, JSON.stringify({ id: "dev" }));

    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      "assets",
      "apply",
      "--dir",
      installDir,
      "--profile-config",
      profileConfig,
      "--json",
    ]);
    const payload = JSON.parse(stdout);
    const realInstallDir = await fs.realpath(installDir);

    expect(payload.cwd).toBe(realInstallDir);
    expect(payload.argv).toEqual([
      "--profile-config",
      profileConfig,
      "--json",
    ]);
  });

  it("resolves hosted profiles without printing profile secrets", async () => {
    const installDir = await createFakeInstall(
      [
        "console.log(JSON.stringify({ success: true, argv: process.argv.slice(2) }));",
        "",
      ].join("\n")
    );
    const secret = "secret-profile-code";
    const server = http.createServer((req, res) => {
      expect(req.url).toBe("/api/install-profiles/dev/resolve");
      expect(req.headers.authorization).toBe(`Bearer ${secret}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "dev",
          privatePipelines: { metaxpath: { key: "do-not-print-this" } },
        })
      );
    });
    const port = await listen(server);

    try {
      const { stdout } = await execFileAsync(process.execPath, [
        cliPath,
        "assets",
        "apply",
        "--dir",
        installDir,
        "--profile",
        "dev",
        "--profile-code",
        secret,
        "--profile-registry-url",
        `http://127.0.0.1:${port}/api/install-profiles`,
        "--json",
      ]);

      expect(stdout).toContain('"success":true');
      expect(stdout).not.toContain(secret);
      expect(stdout).not.toContain("do-not-print-this");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("uses the profile-specific setup code environment fallback", async () => {
    const installDir = await createFakeInstall(
      [
        "console.log(JSON.stringify({ success: true, argv: process.argv.slice(2) }));",
        "",
      ].join("\n")
    );
    const secret = "dev-env-profile-code";
    const server = http.createServer((req, res) => {
      expect(req.url).toBe("/api/install-profiles/dev/resolve");
      expect(req.headers.authorization).toBe(`Bearer ${secret}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "dev" }));
    });
    const port = await listen(server);

    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          cliPath,
          "assets",
          "apply",
          "--dir",
          installDir,
          "--profile",
          "dev",
          "--profile-registry-url",
          `http://127.0.0.1:${port}/api/install-profiles`,
          "--json",
        ],
        {
          env: {
            ...process.env,
            DEV_SETUP_CODE: secret,
            SEQDESK_KEY: "",
            SEQDESK_PROFILE_CODE: "",
          },
        }
      );

      expect(stdout).toContain('"success":true');
      expect(stdout).not.toContain(secret);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
