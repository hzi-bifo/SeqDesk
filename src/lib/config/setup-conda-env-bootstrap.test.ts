import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeExecutable(filePath: string, source: string) {
  fs.writeFileSync(filePath, source, { mode: 0o755 });
}

function createFakeBootstrapTools(testRoot: string, homeDir: string) {
  const fakeBin = path.join(testRoot, "bin");
  const fakeConda = path.join(testRoot, "fake-conda");
  const fakeInstaller = path.join(testRoot, "fake-miniconda-installer.sh");
  const curlLog = path.join(testRoot, "curl-url.txt");

  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });

  writeExecutable(
    fakeConda,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ -n "\${FAKE_CONDA_COMMAND_LOG:-}" ]]; then
  printf '%s\\n' "\$*" >> "\${FAKE_CONDA_COMMAND_LOG}"
fi
case "\${1:-}" in
  create|install)
    if [[ -n "\${FAKE_CONDA_ACTIVE_DIR:-}" ]]; then
      if ! mkdir "\${FAKE_CONDA_ACTIVE_DIR}" 2>/dev/null; then
        printf '%s\\n' "overlap: \$*" >> "\${FAKE_CONDA_OVERLAP_LOG}"
        exit 97
      fi
      trap 'rmdir "\${FAKE_CONDA_ACTIVE_DIR}" 2>/dev/null || true' EXIT
      sleep "\${FAKE_CONDA_DELAY_SECONDS:-0}"
    fi
    ;;
esac
case "\${1:-}:\${2:-}" in
  --version:*) printf '%s\\n' 'conda 25.1.0' ;;
  info:--base) printf '%s\\n' "\${FAKE_CONDA_BASE}" ;;
  env:list) printf '%s\\n' '# conda environments:' ;;
  *) exit 0 ;;
esac
`
  );

  writeExecutable(
    fakeInstaller,
    `#!/usr/bin/env bash
set -euo pipefail
[[ "\$0" == *.sh ]]
prefix=''
while [[ \$# -gt 0 ]]; do
  case "\$1" in
    -p) prefix="\${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done
[[ -n "\${prefix}" ]]
mkdir -p "\${prefix}/bin"
cp "\${FAKE_CONDA_TEMPLATE}" "\${prefix}/bin/conda"
chmod 755 "\${prefix}/bin/conda"
`
  );

  writeExecutable(
    path.join(fakeBin, "curl"),
    `#!/usr/bin/env bash
set -euo pipefail
destination=''
url=''
while [[ \$# -gt 0 ]]; do
  case "\$1" in
    -o) destination="\${2:-}"; shift 2 ;;
    http://*|https://*) url="\$1"; shift ;;
    *) shift ;;
  esac
done
[[ -n "\${destination}" && -n "\${url}" ]]
cp "\${FAKE_MINICONDA_INSTALLER}" "\${destination}"
printf '%s\\n' "\${url}" > "\${FAKE_CURL_LOG}"
`
  );

  return {
    fakeBin,
    fakeConda,
    fakeInstaller,
    curlLog,
  };
}

function runSetup(
  testRoot: string,
  homeDir: string,
  args: string[],
  environment: Record<string, string>
) {
  return spawnSync(
    "bash",
    [path.join(repoRoot, "scripts", "setup-conda-env.sh"), ...args],
    {
      cwd: testRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        // Deliberately exclude developer/runner Conda locations. These tests
        // must prove the core-only host behavior instead of reusing CI state.
        PATH: `${environment.FAKE_BIN}:/usr/bin:/bin`,
        HOME: homeDir,
        TMPDIR: testRoot,
        ...environment,
        CONDA_EXE: "",
        SEQDESK_CONDA_PATH: "",
        SEQDESK_EXEC_CONDA_PATH: "",
      },
    }
  );
}

function runSetupAsync(
  testRoot: string,
  homeDir: string,
  args: string[],
  environment: Record<string, string>
) {
  return new Promise<{
    status: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(
      "bash",
      [path.join(repoRoot, "scripts", "setup-conda-env.sh"), ...args],
      {
        cwd: testRoot,
        env: {
          ...process.env,
          PATH: `${environment.FAKE_BIN}:/usr/bin:/bin`,
          HOME: homeDir,
          TMPDIR: testRoot,
          ...environment,
          CONDA_EXE: "",
          SEQDESK_CONDA_PATH: "",
          SEQDESK_EXEC_CONDA_PATH: "",
        },
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

describe("managed pipeline runtime bootstrap", () => {
  it("installs Miniconda after a core-only install and writes the selected runtime", () => {
    const testRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "seqdesk-runtime-bootstrap-")
    );
    tempDirs.push(testRoot);

    const homeDir = path.join(testRoot, "home");
    const fakeBin = path.join(testRoot, "bin");
    const condaBase = path.join(homeDir, "managed-conda");
    const configPath = path.join(testRoot, "settings.json");
    const dataPath = path.join(testRoot, "sequencing-data");
    const runDirectory = path.join(testRoot, "pipeline-runs");
    const fakeConda = path.join(testRoot, "fake-conda");
    const fakeInstaller = path.join(testRoot, "fake-miniconda-installer.sh");
    const curlLog = path.join(testRoot, "curl-url.txt");

    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(configPath, "{}\n");

    writeExecutable(
      fakeConda,
      `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}:\${2:-}" in
  --version:*) printf '%s\\n' 'conda 25.1.0' ;;
  info:--base) printf '%s\\n' "\${FAKE_CONDA_BASE}" ;;
  env:list) printf '%s\\n' '# conda environments:' ;;
  *) exit 0 ;;
esac
`
    );

    writeExecutable(
      fakeInstaller,
      `#!/usr/bin/env bash
set -euo pipefail
[[ "\$0" == *.sh ]]
prefix=''
while [[ \$# -gt 0 ]]; do
  case "\$1" in
    -p) prefix="\${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done
[[ -n "\${prefix}" ]]
mkdir -p "\${prefix}/bin"
cp "\${FAKE_CONDA_TEMPLATE}" "\${prefix}/bin/conda"
chmod 755 "\${prefix}/bin/conda"
`
    );

    writeExecutable(
      path.join(fakeBin, "curl"),
      `#!/usr/bin/env bash
set -euo pipefail
destination=''
url=''
while [[ \$# -gt 0 ]]; do
  case "\$1" in
    -o) destination="\${2:-}"; shift 2 ;;
    http://*|https://*) url="\$1"; shift ;;
    *) shift ;;
  esac
done
[[ -n "\${destination}" && -n "\${url}" ]]
cp "\${FAKE_MINICONDA_INSTALLER}" "\${destination}"
printf '%s\\n' "\${url}" > "\${FAKE_CURL_LOG}"
`
    );

    const result = spawnSync(
      "bash",
      [
        path.join(repoRoot, "scripts", "setup-conda-env.sh"),
        "--yes",
        "--install-miniconda",
        "--conda-path",
        condaBase,
        "--env",
        "facility-pipelines",
        "--skip-tests",
        "--write-config",
        "--config-path",
        configPath,
        "--pipelines-enabled",
        "--create-dirs",
        "--data-path",
        dataPath,
        "--run-dir",
        runDirectory,
      ],
      {
        cwd: testRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH || ""}`,
          HOME: homeDir,
          TMPDIR: testRoot,
          FAKE_CONDA_BASE: condaBase,
          FAKE_CONDA_TEMPLATE: fakeConda,
          FAKE_MINICONDA_INSTALLER: fakeInstaller,
          FAKE_CURL_LOG: curlLog,
          SEQDESK_MINICONDA_BASE_URL:
            "https://mirror.example.invalid/miniconda",
          SEQDESK_MINICONDA_INSTALLER: "Pinned-Miniconda.sh",
        },
      }
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(
      `Managed Miniconda installed: ${condaBase}`
    );
    expect(fs.existsSync(path.join(condaBase, "bin", "conda"))).toBe(true);
    expect(fs.readFileSync(curlLog, "utf8").trim()).toBe(
      "https://mirror.example.invalid/miniconda/Pinned-Miniconda.sh"
    );
    expect(fs.existsSync(dataPath)).toBe(true);
    expect(fs.existsSync(runDirectory)).toBe(true);
    expect(fs.existsSync(path.join(homeDir, ".bashrc"))).toBe(false);
    expect(fs.existsSync(path.join(homeDir, ".zshrc"))).toBe(false);

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(config).toMatchObject({
      site: { dataBasePath: dataPath },
      pipelines: {
        enabled: true,
        execution: {
          runDirectory,
          conda: {
            path: condaBase,
            environment: "facility-pipelines",
          },
        },
      },
    });
  });

  it("reuses a working explicit Conda base without downloading again", () => {
    const testRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "seqdesk-runtime-reuse-")
    );
    tempDirs.push(testRoot);

    const homeDir = path.join(testRoot, "home");
    const condaBase = path.join(homeDir, "managed-conda");
    const commandLog = path.join(testRoot, "conda-commands.log");
    const tools = createFakeBootstrapTools(testRoot, homeDir);
    fs.mkdirSync(path.join(condaBase, "bin"), { recursive: true });
    fs.copyFileSync(tools.fakeConda, path.join(condaBase, "bin", "conda"));
    fs.chmodSync(path.join(condaBase, "bin", "conda"), 0o755);

    const result = runSetup(
      testRoot,
      homeDir,
      [
        "--yes",
        "--install-miniconda",
        "--conda-path",
        condaBase,
        "--skip-tests",
      ],
      {
        FAKE_BIN: tools.fakeBin,
        FAKE_CONDA_BASE: condaBase,
        FAKE_CONDA_COMMAND_LOG: commandLog,
        FAKE_CONDA_TEMPLATE: tools.fakeConda,
        FAKE_MINICONDA_INSTALLER: tools.fakeInstaller,
        FAKE_CURL_LOG: tools.curlLog,
      }
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(
      `Using conda: ${path.join(condaBase, "bin", "conda")}`
    );
    expect(result.stdout).not.toContain("Downloading Miniconda");
    expect(fs.existsSync(tools.curlLog)).toBe(false);
    const commands = fs.readFileSync(commandLog, "utf8");
    expect(commands).not.toMatch(/^config (?:--remove|--add|--set)/m);
    expect(commands).toContain(
      "create -y -n seqdesk-pipelines --strict-channel-priority --override-channels -c conda-forge -c bioconda"
    );
  });

  it("falls back safely when the default Miniconda path is occupied", () => {
    const testRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "seqdesk-runtime-fallback-")
    );
    tempDirs.push(testRoot);

    const homeDir = path.join(testRoot, "home");
    const occupiedBase = path.join(homeDir, "miniconda3");
    const fallbackBase = path.join(homeDir, "seqdesk-miniconda3");
    const marker = path.join(occupiedBase, "keep-me.txt");
    const tools = createFakeBootstrapTools(testRoot, homeDir);
    fs.mkdirSync(occupiedBase, { recursive: true });
    fs.writeFileSync(marker, "user-owned\n");

    const result = runSetup(
      testRoot,
      homeDir,
      ["--yes", "--install-miniconda", "--skip-tests"],
      {
        FAKE_BIN: tools.fakeBin,
        FAKE_CONDA_BASE: fallbackBase,
        FAKE_CONDA_TEMPLATE: tools.fakeConda,
        FAKE_MINICONDA_INSTALLER: tools.fakeInstaller,
        FAKE_CURL_LOG: tools.curlLog,
        SEQDESK_MINICONDA_BASE_URL:
          "https://mirror.example.invalid/miniconda",
        SEQDESK_MINICONDA_INSTALLER: "Pinned-Miniconda.sh",
      }
    );

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain(
      `${occupiedBase} exists but is not a working Conda base`
    );
    expect(result.stdout).toContain(
      `Managed Miniconda installed: ${fallbackBase}`
    );
    expect(fs.readFileSync(marker, "utf8")).toBe("user-owned\n");
    expect(fs.existsSync(path.join(fallbackBase, "bin", "conda"))).toBe(true);
  });

  it("refuses to overwrite an explicitly configured invalid path", () => {
    const testRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "seqdesk-runtime-invalid-explicit-")
    );
    tempDirs.push(testRoot);

    const homeDir = path.join(testRoot, "home");
    const condaBase = path.join(homeDir, "managed-conda");
    const marker = path.join(condaBase, "keep-me.txt");
    const tools = createFakeBootstrapTools(testRoot, homeDir);
    fs.mkdirSync(condaBase, { recursive: true });
    fs.writeFileSync(marker, "user-owned\n");

    const result = runSetup(
      testRoot,
      homeDir,
      [
        "--yes",
        "--install-miniconda",
        "--conda-path",
        condaBase,
        "--skip-tests",
      ],
      {
        FAKE_BIN: tools.fakeBin,
        FAKE_CONDA_BASE: condaBase,
        FAKE_CONDA_TEMPLATE: tools.fakeConda,
        FAKE_MINICONDA_INSTALLER: tools.fakeInstaller,
        FAKE_CURL_LOG: tools.curlLog,
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      `exists but is not a working Conda base: ${condaBase}`
    );
    expect(result.stdout).toContain("SEQDESK_CONDA_PATH");
    expect(fs.readFileSync(marker, "utf8")).toBe("user-owned\n");
    expect(fs.existsSync(tools.curlLog)).toBe(false);
  });

  it("fails without touching either occupied managed fallback", () => {
    const testRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "seqdesk-runtime-invalid-defaults-")
    );
    tempDirs.push(testRoot);

    const homeDir = path.join(testRoot, "home");
    const defaultBase = path.join(homeDir, "miniconda3");
    const fallbackBase = path.join(homeDir, "seqdesk-miniconda3");
    const defaultMarker = path.join(defaultBase, "keep-me.txt");
    const fallbackMarker = path.join(fallbackBase, "keep-me-too.txt");
    const tools = createFakeBootstrapTools(testRoot, homeDir);
    fs.mkdirSync(defaultBase, { recursive: true });
    fs.mkdirSync(fallbackBase, { recursive: true });
    fs.writeFileSync(defaultMarker, "default-user-owned\n");
    fs.writeFileSync(fallbackMarker, "fallback-user-owned\n");

    const result = runSetup(
      testRoot,
      homeDir,
      ["--yes", "--install-miniconda", "--skip-tests"],
      {
        FAKE_BIN: tools.fakeBin,
        FAKE_CONDA_BASE: fallbackBase,
        FAKE_CONDA_TEMPLATE: tools.fakeConda,
        FAKE_MINICONDA_INSTALLER: tools.fakeInstaller,
        FAKE_CURL_LOG: tools.curlLog,
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      `${defaultBase} and ${fallbackBase} both exist without a working conda executable`
    );
    expect(result.stdout).toContain("SEQDESK_CONDA_PATH");
    expect(fs.readFileSync(defaultMarker, "utf8")).toBe(
      "default-user-owned\n"
    );
    expect(fs.readFileSync(fallbackMarker, "utf8")).toBe(
      "fallback-user-owned\n"
    );
    expect(fs.existsSync(tools.curlLog)).toBe(false);
  });

  it("serializes concurrent setup calls for the same installation", async () => {
    const testRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "seqdesk-runtime-concurrency-")
    );
    tempDirs.push(testRoot);

    const homeDir = path.join(testRoot, "home");
    const condaBase = path.join(homeDir, "managed-conda");
    const activeDir = path.join(testRoot, "fake-conda-active");
    const overlapLog = path.join(testRoot, "fake-conda-overlap.log");
    const tools = createFakeBootstrapTools(testRoot, homeDir);
    fs.mkdirSync(path.join(condaBase, "bin"), { recursive: true });
    fs.copyFileSync(tools.fakeConda, path.join(condaBase, "bin", "conda"));
    fs.chmodSync(path.join(condaBase, "bin", "conda"), 0o755);

    const args = [
      "--yes",
      "--conda-path",
      condaBase,
      "--skip-tests",
    ];
    const environment = {
      FAKE_BIN: tools.fakeBin,
      FAKE_CONDA_BASE: condaBase,
      FAKE_CONDA_ACTIVE_DIR: activeDir,
      FAKE_CONDA_OVERLAP_LOG: overlapLog,
      FAKE_CONDA_DELAY_SECONDS: "1",
      SEQDESK_RUNTIME_SETUP_LOCK_TIMEOUT: "10",
    };

    const [first, second] = await Promise.all([
      runSetupAsync(testRoot, homeDir, args, environment),
      runSetupAsync(testRoot, homeDir, args, environment),
    ]);

    for (const result of [first, second]) {
      expect(
        result.status,
        `${result.stdout}\n${result.stderr}\nsignal=${result.signal}`
      ).toBe(0);
    }
    expect(fs.existsSync(overlapLog)).toBe(false);
    expect(
      `${first.stdout}\n${second.stdout}`
    ).toContain("Another SeqDesk runtime setup is already running");
    expect(
      fs.existsSync(path.join(testRoot, ".seqdesk-runtime-setup.lock"))
    ).toBe(false);
  });
});
