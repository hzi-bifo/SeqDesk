import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const installDistPath = path.join(repoRoot, "scripts/install-dist.sh");
const installDistSource = readFileSync(installDistPath, "utf8");

const parserStart = installDistSource.indexOf("parse_release_version_info() {");
const parserEnd = installDistSource.indexOf("\nupdate_pm2_display_cmd() {");

if (parserStart === -1 || parserEnd === -1) {
  throw new Error("Could not locate parse_release_version_info in scripts/install-dist.sh");
}

const parserFunction = installDistSource.slice(parserStart, parserEnd).trim();

function runInstallerParser(payload: unknown) {
  return spawnSync(
    "bash",
    [
      "-lc",
      `set -euo pipefail
${parserFunction}
parse_release_version_info "$PAYLOAD"`,
    ],
    {
      env: {
        ...process.env,
        PAYLOAD: JSON.stringify(payload),
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
}

function parseInstallerFields(output: string) {
  const [version, downloadUrl, checksum, size, endMarker] = output.split("\x1f");

  return {
    version,
    downloadUrl,
    checksum,
    size,
    endMarker,
  };
}

describe("install-dist release parser", () => {
  it("parses direct release payloads", () => {
    const result = runInstallerParser({
      version: "1.2.3",
      downloadUrl: "https://downloads.seqdesk.org/seqdesk-1.2.3.tar.gz",
      checksum: "sha256:deadbeef",
      size: 1048576,
    });

    expect(result.status).toBe(0);
    expect(
      parseInstallerFields(result.stdout)
    ).toEqual({
      version: "1.2.3",
      downloadUrl: "https://downloads.seqdesk.org/seqdesk-1.2.3.tar.gz",
      checksum: "sha256:deadbeef",
      size: "1048576",
      endMarker: "__SEQDESK_VERSION_INFO_END__",
    });
  });

  it("parses update-check payloads that wrap the release in latest", () => {
    const result = runInstallerParser({
      updateAvailable: false,
      currentVersion: null,
      latest: {
        version: "1.1.79",
        channel: "stable",
        releaseDate: "2026-03-04",
        downloadUrl:
          "https://hrvwvo4zhyhlyy73.public.blob.vercel-storage.com/releases/seqdesk-1.1.79.tar.gz",
        checksum: "sha256:4685e8669750ff3a9b250a2f7d1ffa15155fa0d73c3273201d284aab7af7d190",
        releaseNotes:
          "This release removes repository-tracked env-file setup references and aligns runtime/release tooling around JSON config usage.",
        minNodeVersion: "18.0.0",
      },
    });

    expect(result.status).toBe(0);
    expect(
      parseInstallerFields(result.stdout)
    ).toEqual({
      version: "1.1.79",
      downloadUrl:
        "https://hrvwvo4zhyhlyy73.public.blob.vercel-storage.com/releases/seqdesk-1.1.79.tar.gz",
      checksum: "sha256:4685e8669750ff3a9b250a2f7d1ffa15155fa0d73c3273201d284aab7af7d190",
      size: "",
      endMarker: "__SEQDESK_VERSION_INFO_END__",
    });
  });

  it("rejects payloads without release metadata", () => {
    const result = runInstallerParser({
      updateAvailable: false,
      currentVersion: null,
      latest: null,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/version must be a non-empty string/i);
  });
});

describe("install-dist release layout", () => {
  it("extracts fresh installs into a versioned release and activates current", () => {
    expect(installDistSource).toContain('RELEASE_DIR="$SEQDESK_DIR/releases/$LATEST_VERSION"');
    expect(installDistSource).toContain('sync_release_shared_paths "$RELEASE_DIR"');
    expect(installDistSource).toContain('activate_current_release "$LATEST_VERSION"');
    expect(installDistSource).toContain('APP_DIR="$SEQDESK_DIR/current"');
  });

  it("keeps startup and private pipeline installs anchored to stable paths", () => {
    expect(installDistSource).toContain(
      'pm2_exec_runtime start "$SEQDESK_DIR/start.sh" --name seqdesk'
    );
    expect(installDistSource).toContain('cd "$ROOT_DIR/current"');
    expect(installDistSource).toContain('--dir "$(pwd)"');
  });
});

// The installer exports DATABASE_URL/DIRECT_URL for its migration and seed
// steps. PM2 stores the environment of whoever starts the app and replays that
// copy forever, and both start.sh and bootstrapRuntimeEnv only fill variables
// that are not already set -- so a value captured here beats settings.json for
// the life of the process, and editing settings.json does nothing.
//
// These tests pin the correction rather than a string. The load-bearing detail
// is that PM2 is handed EMPTY values, not that the variables are absent:
// `pm2 restart --update-env` merges the current environment into the stored
// copy and cannot delete anything from it, so `env -u` leaves an already
// installed process on its old database (measured against pm2 7.0.1 with an
// isolated PM2_HOME). An empty value overwrites the stored one, and start.sh
// trims both variables and falls back to settings.json when the result is
// empty. A revert to `env -u` makes the assertions below fail: `env` prints
// nothing at all for a variable that was removed.
describe("install-dist PM2 runtime environment", () => {
  const tempDirs: string[] = [];

  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function extractShellFunction(name: string) {
    const start = installDistSource.indexOf(`${name}() {`);
    if (start === -1) {
      throw new Error(`Could not locate ${name} in scripts/install-dist.sh`);
    }
    const end = installDistSource.indexOf("\n}\n", start);
    if (end === -1) {
      throw new Error(`Could not find the end of ${name} in scripts/install-dist.sh`);
    }
    return installDistSource.slice(start, end + 2);
  }

  const pm2ExecRuntime = extractShellFunction("pm2_exec_runtime");

  // Stands in for the pm2 binary and reports what it was actually handed.
  // `env` lists only variables that are set, so an empty DATABASE_URL shows up
  // as the line "DATABASE_URL=" and a removed one does not show up at all.
  function runPm2ExecRuntime(args: string[], env: Record<string, string>) {
    const dir = mkdtempSync(path.join(tmpdir(), "seqdesk-pm2-runtime-"));
    tempDirs.push(dir);
    const stubPath = path.join(dir, "pm2-stub.sh");
    writeFileSync(
      stubPath,
      `#!/usr/bin/env bash
printf 'ARGS:%s\\n' "$*"
env | grep -E '^(DATABASE_URL|DIRECT_URL|SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED|SEQDESK_DATA_PATH)=' | sort
`
    );
    chmodSync(stubPath, 0o755);

    return spawnSync(
      "bash",
      [
        "-c",
        `set -euo pipefail
PM2_BIN=${JSON.stringify(stubPath)}
${pm2ExecRuntime}
pm2_exec_runtime "$@"`,
        "bash",
        ...args,
      ],
      {
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          DATABASE_URL: env.DATABASE_URL,
          DIRECT_URL: env.DIRECT_URL,
          SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED: env.SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED,
          SEQDESK_DATA_PATH: env.SEQDESK_DATA_PATH,
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  }

  const installerEnv = {
    DATABASE_URL: "postgresql://installer@localhost:5432/seqdesk_installer",
    DIRECT_URL: "postgresql://installer@localhost:5432/seqdesk_installer_direct",
    SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED: "0",
    SEQDESK_DATA_PATH: "/installer/data",
  };

  it("hands PM2 empty database variables instead of the installer's own", () => {
    const result = runPm2ExecRuntime(["start", "/opt/seqdesk/start.sh", "--name", "seqdesk"], installerEnv);

    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toContain("ARGS:start /opt/seqdesk/start.sh --name seqdesk");
    expect(lines).toContain("DATABASE_URL=");
    expect(lines).toContain("DIRECT_URL=");
    expect(lines).toContain("SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED=");
    expect(lines).toContain("SEQDESK_DATA_PATH=");
    expect(result.stdout).not.toContain("seqdesk_installer");
  });

  it("clears the same variables on the restart that upgrades an existing install", () => {
    const result = runPm2ExecRuntime(["restart", "seqdesk", "--update-env"], installerEnv);

    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toContain("ARGS:restart seqdesk --update-env");
    expect(lines).toContain("DATABASE_URL=");
    expect(lines).toContain("DIRECT_URL=");
    expect(lines).toContain("SEQDESK_DATA_PATH=");
    expect(result.stdout).not.toContain("seqdesk_installer");
  });

  it("routes both PM2 lifecycle calls through the wrapper", () => {
    expect(installDistSource).toContain(
      'pm2_exec_runtime start "$SEQDESK_DIR/start.sh" --name seqdesk'
    );
    expect(installDistSource).toContain("pm2_exec_runtime restart seqdesk --update-env");
    // The bare pm2_exec is for calls that do not (re)create the process:
    // describe, save, startup. Nothing may start or restart the app with it.
    expect(installDistSource).not.toMatch(/pm2_exec (start|restart)\b/);
  });

  it("prints a restart command that also works on an existing installation", () => {
    // A bare `pm2 restart seqdesk --update-env` cannot drop the DATABASE_URL an
    // older install froze into the process, which is exactly the installation
    // that needs this instruction.
    expect(installDistSource).toContain(
      'echo "  DATABASE_URL= DIRECT_URL= SEQDESK_DATA_PATH= $PM2_DISPLAY_CMD restart seqdesk --update-env"'
    );
  });
});
