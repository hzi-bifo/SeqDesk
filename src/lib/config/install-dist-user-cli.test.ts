import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const installerPath = path.join(repoRoot, "scripts", "install-dist.sh");
const buildReleasePath = path.join(repoRoot, "scripts", "build-release.sh");
const tempDirs: string[] = [];

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-user-cli-test-"));
  tempDirs.push(root);
  const home = path.join(root, "home");
  const installDir = path.join(root, "installed seqdesk");
  const binDir = path.join(home, ".local", "bin");
  const configHome = path.join(home, ".config");
  const capturePath = path.join(root, "launcher-capture.json");
  const launcherPath = path.join(
    installDir,
    "current",
    "scripts",
    "seqdesk-launcher.js"
  );

  fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
  fs.writeFileSync(
    launcherPath,
    [
      'const fs = require("node:fs");',
      `fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ argv: process.argv.slice(2) }));`,
      "",
    ].join("\n")
  );

  return { root, home, installDir, binDir, configHome, capturePath };
}

function installUserCli(fixture: ReturnType<typeof makeFixture>) {
  return spawnSync(
    "bash",
    [
      "-c",
      [
        'SEQDESK_INSTALL_LIB_ONLY=1 source "$INSTALLER_PATH"',
        'SEQDESK_DIR="$TEST_INSTALL_DIR"',
        'SEQDESK_CLI_BIN_DIR="$TEST_BIN_DIR"',
        "install_user_cli",
        'printf "CLI=%s\\n" "$SEQDESK_USER_CLI_PATH"',
      ].join("\n"),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: fixture.home,
        XDG_CONFIG_HOME: fixture.configHome,
        INSTALLER_PATH: installerPath,
        TEST_INSTALL_DIR: fixture.installDir,
        TEST_BIN_DIR: fixture.binDir,
      },
    }
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("distribution installer user CLI", () => {
  it("atomically installs an idempotent wrapper and default-install pointer", () => {
    const fixture = makeFixture();
    const first = installUserCli(fixture);

    expect(first.status).toBe(0);
    const wrapperPath = path.join(fixture.binDir, "seqdesk");
    const pointerPath = path.join(
      fixture.configHome,
      "seqdesk",
      "default-install"
    );
    expect(fs.statSync(wrapperPath).mode & 0o111).not.toBe(0);
    expect(fs.readFileSync(wrapperPath, "utf8")).toContain(
      "# SeqDesk managed user CLI"
    );
    expect(fs.readFileSync(pointerPath, "utf8")).toBe(`${fixture.installDir}\n`);
    expect(fs.statSync(pointerPath).mode & 0o077).toBe(0);

    const firstWrapper = fs.readFileSync(wrapperPath, "utf8");
    const second = installUserCli(fixture);
    expect(second.status).toBe(0);
    expect(fs.readFileSync(wrapperPath, "utf8")).toBe(firstWrapper);

    const dispatch = spawnSync(wrapperPath, ["pipelines", "list", "--json"], {
      encoding: "utf8",
      cwd: fixture.root,
      env: {
        ...process.env,
        HOME: fixture.home,
        XDG_CONFIG_HOME: fixture.configHome,
      },
    });
    expect(dispatch.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(fixture.capturePath, "utf8"))).toEqual({
      argv: ["pipelines", "list", "--json"],
    });
  });

  it("does not overwrite an unrelated command at the user wrapper path", () => {
    const fixture = makeFixture();
    const wrapperPath = path.join(fixture.binDir, "seqdesk");
    fs.mkdirSync(fixture.binDir, { recursive: true });
    fs.writeFileSync(wrapperPath, "#!/usr/bin/env bash\necho existing\n", {
      mode: 0o755,
    });

    const result = installUserCli(fixture);

    expect(result.status).toBe(0);
    expect(fs.readFileSync(wrapperPath, "utf8")).toBe(
      "#!/usr/bin/env bash\necho existing\n"
    );
    expect(result.stdout + result.stderr).toContain(
      "is not managed by the SeqDesk installer"
    );
    expect(
      fs.readFileSync(
        path.join(fixture.configHome, "seqdesk", "default-install"),
        "utf8"
      )
    ).toBe(`${fixture.installDir}\n`);
  });

  it("ships the launcher, pipeline worker, and managed-runtime helpers together", () => {
    const buildRelease = fs.readFileSync(buildReleasePath, "utf8");
    expect(buildRelease).toContain(
      '"${ROOT_DIR}/scripts/pipeline-cli.ts",'
    );
    expect(buildRelease).toContain(
      'cp "${ROOT_DIR}/npm/seqdesk/bin/seqdesk.js" "${RELEASE_DIR}/scripts/seqdesk-launcher.js"'
    );
    expect(buildRelease).toContain(
      'chmod 755 "${RELEASE_DIR}/scripts/seqdesk-launcher.js"'
    );
    expect(buildRelease).toContain(
      'cp "${ROOT_DIR}/scripts/setup-conda-env.sh" "${RELEASE_DIR}/scripts/"'
    );
    expect(buildRelease).toContain(
      'cp -R "${ROOT_DIR}/scripts/lib" "${RELEASE_DIR}/scripts/"'
    );
    expect(buildRelease).toContain(
      'cp "${ROOT_DIR}/data/pipeline-databases.json" "${RELEASE_DIR}/data/"'
    );
  });
});
