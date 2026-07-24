import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const installerPaths = ["scripts/install.sh", "scripts/install-dist.sh"];

function extractSelector(source: string, installerPath: string) {
  const start = source.indexOf("select_miniconda_installer() {");
  const end = source.indexOf("\nnode_meets_minimum_version() {", start);

  if (start === -1 || end === -1) {
    throw new Error(
      `Could not locate select_miniconda_installer in ${installerPath}`
    );
  }

  return source.slice(start, end).trim();
}

function selectInstaller(selector: string, os: string, arch: string) {
  return spawnSync(
    "bash",
    ["-c", `${selector}\nselect_miniconda_installer "$1" "$2"`, "_", os, arch],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
}

describe.each(installerPaths)("%s Miniconda selection", (installerPath) => {
  const source = readFileSync(path.join(repoRoot, installerPath), "utf8");
  const selector = extractSelector(source, installerPath);

  it.each([
    ["linux", "x86_64", "Miniconda3-latest-Linux-x86_64.sh"],
    ["linux", "amd64", "Miniconda3-latest-Linux-x86_64.sh"],
    ["linux", "aarch64", "Miniconda3-latest-Linux-aarch64.sh"],
    ["linux", "arm64", "Miniconda3-latest-Linux-aarch64.sh"],
    ["macos", "x86_64", "Miniconda3-latest-MacOSX-x86_64.sh"],
    ["macos", "amd64", "Miniconda3-latest-MacOSX-x86_64.sh"],
    ["macos", "arm64", "Miniconda3-latest-MacOSX-arm64.sh"],
    ["macos", "aarch64", "Miniconda3-latest-MacOSX-arm64.sh"],
  ])("maps %s/%s to %s", (os, arch, expected) => {
    const result = selectInstaller(selector, os, arch);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(expected);
    expect(result.stderr).toBe("");
  });

  it("rejects unsupported platform pairs instead of choosing a mismatched binary", () => {
    const result = selectInstaller(selector, "linux", "riscv64");

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
  });

  it("uses the detected OS and architecture in the Miniconda download path", () => {
    expect(source).toContain(
      'CONDA_INSTALLER=$(select_miniconda_installer "$OS" "$ARCH")'
    );
    expect(source).toContain(
      '"https://repo.anaconda.com/miniconda/$CONDA_INSTALLER"'
    );
  });
});

describe("pipeline environment setup contract", () => {
  const source = readFileSync(
    path.join(repoRoot, "scripts/setup-conda-env.sh"),
    "utf8"
  );

  it("offers only supported execution modes", () => {
    expect(source).toContain("Execution mode: local|slurm");
    expect(source).not.toContain("local|slurm|kubernetes");
  });

  it("does not write the ignored conda.enabled compatibility field", () => {
    expect(source).not.toContain(
      "config.pipelines.execution.conda.enabled = true"
    );
  });
});
