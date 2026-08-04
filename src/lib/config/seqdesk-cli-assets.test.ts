import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "npm", "seqdesk", "bin", "seqdesk.js");

let tempDir: string;

interface FakeInstallOptions {
  databaseUrl?: string;
  directUrl?: string;
  releaseLayout?: boolean;
}

async function createFakeInstall(
  scriptBody?: string,
  options: FakeInstallOptions = {}
) {
  const installDir = path.join(tempDir, `install-${Date.now()}`);
  const appDir = options.releaseLayout
    ? path.join(installDir, "current")
    : installDir;
  const databaseUrl =
    options.databaseUrl ??
    "postgresql://seqdesk:target-password@127.0.0.1:5432/seqdesk_assets";
  const directUrl = options.directUrl ?? databaseUrl;

  await fs.mkdir(path.join(appDir, "scripts"), { recursive: true });
  await fs.writeFile(
    path.join(installDir, "package.json"),
    JSON.stringify({ name: "seqdesk", version: "0.0.0-test" }, null, 2)
  );
  await fs.writeFile(
    path.join(installDir, "settings.json"),
    JSON.stringify(
      {
        runtime: {
          databaseUrl,
          directUrl,
        },
      },
      null,
      2
    )
  );
  await fs.writeFile(
    path.join(appDir, "scripts", "apply-install-profile-assets.mjs"),
    scriptBody ??
      [
        "const result = { cwd: process.cwd(), argv: process.argv.slice(2) };",
        "console.log(JSON.stringify(result));",
        "",
      ].join("\n")
  );
  return installDir;
}

async function createFetchStub(payload: unknown, capturePath?: string) {
  const preloadPath = path.join(tempDir, `fetch-stub-${Date.now()}.cjs`);
  const capture = capturePath
    ? `require("node:fs").writeFileSync(${JSON.stringify(
        capturePath
      )}, JSON.stringify({
        url: String(input),
        authorization: options.headers?.authorization || ""
      }));`
    : "";
  await fs.writeFile(
    preloadPath,
    `globalThis.fetch = async (input, options = {}) => {
      ${capture}
      return {
      ok: true,
      status: 200,
      text: async () => ${JSON.stringify(JSON.stringify(payload))}
      };
    };\n`
  );
  return preloadPath;
}

describe("seqdesk assets apply CLI", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-cli-assets-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("prints the launcher version without invoking the installer", async () => {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(repoRoot, "npm", "seqdesk", "package.json"), "utf8")
    ) as { version: string };

    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      "--version",
    ]);

    expect(stdout.trim()).toBe(packageJson.version);
  });

  it("shows the installed-service port in doctor help", async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      "doctor",
      "--help",
    ]);

    expect(stdout).toContain("http://127.0.0.1:8000");
    expect(stdout).not.toContain("http://127.0.0.1:3000");
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

  it("refuses to send profile codes over remote plain HTTP", async () => {
    const installDir = await createFakeInstall();
    const secret = "must-not-be-transmitted";
    let stderr = "";

    try {
      await execFileAsync(process.execPath, [
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
        "http://profiles.example.test/api/install-profiles",
      ]);
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr ?? "");
    }

    expect(stderr).toContain("--profile-registry-url must use HTTPS");
    expect(stderr).not.toContain(secret);
  });

  it("bounds hosted-profile fetches and refuses credential-bearing redirects", async () => {
    const source = await fs.readFile(cliPath, "utf8");

    expect(source).toContain("AbortSignal.timeout(HOSTED_PROFILE_FETCH_TIMEOUT_MS)");
    expect(source).toContain("AbortSignal.timeout(INSTALLER_FETCH_TIMEOUT_MS)");
    expect(source).toContain('redirect: "error"');
  });

  it("rejects a hosted profile whose resolved id does not match the request", async () => {
    const installDir = await createFakeInstall();
    const preloadPath = await createFetchStub({ id: "other" });

    await expect(
      execFileAsync(
        process.execPath,
        [
          cliPath,
          "assets",
          "apply",
          "--dir",
          installDir,
          "--profile",
          "dev",
          "--profile-code",
          "secret-code",
        ],
        {
          env: {
            ...process.env,
            NODE_OPTIONS: `--require=${preloadPath}`,
          },
        }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Hosted profile id mismatch: requested dev, resolved other"
      ),
    });
  });

  it("rejects assets from profiles that require a newer installed SeqDesk", async () => {
    const installDir = await createFakeInstall();
    const preloadPath = await createFetchStub({
      id: "dev",
      minSeqDeskVersion: "99.0.0",
    });

    await expect(
      execFileAsync(
        process.execPath,
        [
          cliPath,
          "assets",
          "apply",
          "--dir",
          installDir,
          "--profile",
          "dev",
          "--profile-code",
          "secret-code",
        ],
        {
          env: {
            ...process.env,
            NODE_OPTIONS: `--require=${preloadPath}`,
          },
        }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "requires SeqDesk 99.0.0 or newer"
      ),
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
    await expect(
      fs.access(
        path.join(installDir, "pipelines", ".install-profile-reload.lock")
      )
    ).rejects.toThrow();
  });

  it("does not run asset application while a profile reload holds the install lock", async () => {
    const markerPath = path.join(tempDir, "asset-worker-ran");
    const installDir = await createFakeInstall(
      `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "ran");`
    );
    const profileConfig = path.join(tempDir, "locked-profile.json");
    const lockDir = path.join(installDir, "pipelines");
    const lockPath = path.join(lockDir, ".install-profile-reload.lock");
    await fs.writeFile(profileConfig, JSON.stringify({ id: "dev" }));
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(
      lockPath,
      JSON.stringify({ ownerToken: "reload-owner", pid: process.pid })
    );

    await expect(
      execFileAsync(process.execPath, [
        cliPath,
        "assets",
        "apply",
        "--dir",
        installDir,
        "--profile-config",
        profileConfig,
        "--json",
      ])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "A hosted profile reload or asset application is already running"
      ),
    });

    await expect(fs.access(markerPath)).rejects.toThrow();
    await expect(fs.access(lockPath)).resolves.toBeUndefined();
  });

  it("uses the active release asset script while keeping the install root as cwd", async () => {
    const installDir = await createFakeInstall(
      [
        "console.log(JSON.stringify({ cwd: process.cwd(), scriptPath: process.argv[1] }));",
        "",
      ].join("\n"),
      { releaseLayout: true }
    );
    const profileConfig = path.join(tempDir, "release-profile.json");
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
    const payload = JSON.parse(stdout) as {
      cwd: string;
      scriptPath: string;
    };

    expect(payload.cwd).toBe(await fs.realpath(installDir));
    expect(await fs.realpath(payload.scriptPath)).toBe(
      await fs.realpath(
        path.join(
          installDir,
          "current",
          "scripts",
          "apply-install-profile-assets.mjs"
        )
      )
    );
  });

  it("uses database URLs from the selected install instead of the shell", async () => {
    const targetDatabaseUrl =
      "postgresql://seqdesk:target-password@db.internal:5432/seqdesk_target";
    const targetDirectUrl =
      "postgresql://seqdesk:target-direct-password@db.internal:5432/seqdesk_target";
    const installDir = await createFakeInstall(
      [
        "console.log(JSON.stringify({",
        "  databaseUrl: process.env.DATABASE_URL,",
        "  directUrl: process.env.DIRECT_URL,",
        "}));",
        "",
      ].join("\n"),
      {
        databaseUrl: targetDatabaseUrl,
        directUrl: targetDirectUrl,
      }
    );
    const profileConfig = path.join(tempDir, "database-profile.json");
    await fs.writeFile(profileConfig, JSON.stringify({ id: "dev" }));

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        cliPath,
        "assets",
        "apply",
        "--dir",
        installDir,
        "--profile-config",
        profileConfig,
        "--json",
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL:
            "postgresql://seqdesk:wrong-password@wrong.example:5432/wrong",
          DIRECT_URL:
            "postgresql://seqdesk:wrong-direct-password@wrong.example:5432/wrong",
        },
      }
    );
    const payload = JSON.parse(stdout) as {
      databaseUrl: string;
      directUrl: string;
    };

    expect(payload.databaseUrl).toBe(targetDatabaseUrl);
    expect(payload.directUrl).toBe(targetDirectUrl);
  });

  it("resolves hosted profiles without printing profile secrets", async () => {
    const installDir = await createFakeInstall(
      [
        "console.log(JSON.stringify({ success: true, argv: process.argv.slice(2) }));",
        "",
      ].join("\n")
    );
    const secret = "secret-profile-code";
    const capturePath = path.join(tempDir, "profile-fetch.json");
    const preloadPath = await createFetchStub(
      {
        id: "dev",
        privatePipelines: { metaxpath: { key: "do-not-print-this" } },
      },
      capturePath
    );
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
        "--profile-code",
        secret,
        "--json",
      ],
      {
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preloadPath}`,
        },
      }
    );
    const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as {
      url: string;
      authorization: string;
    };

    expect(capture.url).toBe(
      "https://seqdesk.org/api/install-profiles/dev/resolve"
    );
    expect(capture.authorization).toBe(`Bearer ${secret}`);
    expect(stdout).toContain('"success":true');
    expect(stdout).not.toContain(secret);
    expect(stdout).not.toContain("do-not-print-this");
  });

  it("uses the profile-specific setup code environment fallback", async () => {
    const installDir = await createFakeInstall(
      [
        "console.log(JSON.stringify({ success: true, argv: process.argv.slice(2) }));",
        "",
      ].join("\n")
    );
    const secret = "dev-env-profile-code";
    const capturePath = path.join(tempDir, "profile-env-fetch.json");
    const preloadPath = await createFetchStub({ id: "dev" }, capturePath);
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
        "--json",
      ],
      {
        env: {
          ...process.env,
          DEV_SETUP_CODE: secret,
          SEQDESK_KEY: "",
          SEQDESK_PROFILE_CODE: "",
          NODE_OPTIONS: `--require=${preloadPath}`,
        },
      }
    );
    const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as {
      authorization: string;
    };

    expect(capture.authorization).toBe(`Bearer ${secret}`);
    expect(stdout).toContain('"success":true');
    expect(stdout).not.toContain(secret);
  });
});
