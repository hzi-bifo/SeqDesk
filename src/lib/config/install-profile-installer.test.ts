import { execFileSync, spawnSync } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const installDist = fs.readFileSync(
  path.join(repoRoot, "scripts/install-dist.sh"),
  "utf8"
);
const sourceInstaller = fs.readFileSync(
  path.join(repoRoot, "scripts/install.sh"),
  "utf8"
);
const privateMetaxPathInstaller = fs.readFileSync(
  path.join(repoRoot, "scripts/install-private-metaxpath.sh"),
  "utf8"
);
const buildRelease = fs.readFileSync(
  path.join(repoRoot, "scripts/build-release.sh"),
  "utf8"
);
const profileApplicator = fs.readFileSync(
  path.join(repoRoot, "scripts/apply-install-profile.mjs"),
  "utf8"
);
const profileApplicatorCore = fs.readFileSync(
  path.join(repoRoot, "scripts/lib/install-profile-apply-core.mjs"),
  "utf8"
);
const profileAssetsApplicator = fs.readFileSync(
  path.join(repoRoot, "scripts/apply-install-profile-assets.mjs"),
  "utf8"
);
const profileAssetsLib = fs.readFileSync(
  path.join(repoRoot, "scripts/lib/install-profile-assets.mjs"),
  "utf8"
);
const profilePipelineSmokeRunner = fs.readFileSync(
  path.join(repoRoot, "scripts/run-install-profile-pipeline-smoke.mjs"),
  "utf8"
);
const profileAssert = fs.readFileSync(
  path.join(repoRoot, "scripts/assert-install-profile-applied.mjs"),
  "utf8"
);
const profileWorkflow = fs.readFileSync(
  path.join(repoRoot, ".github/workflows/install-profile-alma.yml"),
  "utf8"
);
const hostedProfileSmokeWorkflow = fs.readFileSync(
  path.join(repoRoot, ".github/workflows/install-profile-ubuntu-smoke.yml"),
  "utf8"
);
const hostedProfileSmokeOverrides = JSON.parse(
  fs.readFileSync(
    path.join(
      repoRoot,
      ".github/fixtures/ci-runner-github-hosted-overrides.json"
    ),
    "utf8"
  )
) as Record<string, unknown>;

function processEnvironment(
  values: Record<string, string | undefined>
): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

interface GeneratedInstallConfig {
  pipelines: {
    execution: {
      mode?: string;
    };
  };
  runtime?: {
    updateServer?: string;
  };
}

function extractWriteConfigScript(installer: string): string {
  const functionMarker = "\nwrite_config() {";
  const functionStart = installer.indexOf(functionMarker) + 1;
  const marker = "node <<'NODE'\n";
  const markerStart = installer.indexOf(marker, functionStart);
  const scriptStart = markerStart + marker.length;
  const scriptEnd = installer.indexOf("\nNODE\n", scriptStart);

  expect(functionStart).toBeGreaterThan(0);
  expect(markerStart).toBeGreaterThanOrEqual(functionStart);
  expect(scriptEnd).toBeGreaterThan(scriptStart);
  return installer.slice(scriptStart, scriptEnd);
}

function extractShellFunction(installer: string, name: string): string {
  const start = installer.indexOf(`${name}() {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = installer.indexOf("\n}\n", start);
  expect(end).toBeGreaterThan(start);
  return installer.slice(start, end + 2);
}

function runWriteConfigScript(
  installer: string,
  useSlurm?: boolean,
  updateServer?: string
): GeneratedInstallConfig {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-write-config-"));
  try {
    execFileSync(process.execPath, ["-e", extractWriteConfigScript(installer)], {
      cwd: tempDir,
      env: processEnvironment({
        PATH: process.env.PATH,
        SEQDESK_INSTALL_PIPELINES_ENABLED: "true",
        SEQDESK_INSTALL_RUN_DIR: path.join(tempDir, "runs"),
        ...(useSlurm === undefined
          ? {}
          : { SEQDESK_INSTALL_EXEC_USE_SLURM: String(useSlurm) }),
        ...(updateServer
          ? { SEQDESK_INSTALL_UPDATE_SERVER: updateServer }
          : {}),
      }),
      stdio: "pipe",
    });
    return JSON.parse(
      fs.readFileSync(path.join(tempDir, "settings.json"), "utf8")
    ) as GeneratedInstallConfig;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function extractAdditionalSettingsScript(installer: string): string {
  const functionMarker = "\napply_additional_settings_to_config_path() {";
  const functionStart = installer.indexOf(functionMarker) + 1;
  const marker = "node - \"$config_path\" <<'NODE'\n";
  const markerStart = installer.indexOf(marker, functionStart);
  const scriptStart = markerStart + marker.length;
  const scriptEnd = installer.indexOf("\nNODE\n", scriptStart);

  expect(functionStart).toBeGreaterThan(0);
  expect(markerStart).toBeGreaterThanOrEqual(functionStart);
  expect(scriptEnd).toBeGreaterThan(scriptStart);
  return installer.slice(scriptStart, scriptEnd);
}

function applyAdditionalSettings(
  overrides: Record<string, unknown> | string,
  initialConfig: Record<string, unknown> = {}
): {
  result: ReturnType<typeof spawnSync>;
  config?: Record<string, unknown>;
} {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "seqdesk-additional-settings-")
  );
  const configPath = path.join(tempDir, "profile.json");
  const overridesPath = path.join(tempDir, "overrides.json");
  fs.writeFileSync(configPath, JSON.stringify(initialConfig));
  fs.writeFileSync(
    overridesPath,
    typeof overrides === "string" ? overrides : JSON.stringify(overrides)
  );
  try {
    const result = spawnSync(process.execPath, ["-", configPath], {
      input: extractAdditionalSettingsScript(installDist),
      encoding: "utf8",
      env: processEnvironment({
        PATH: process.env.PATH,
        SEQDESK_ADDITIONAL_SETTINGS_FILE_PATH: overridesPath,
        SEQDESK_ADDITIONAL_SETTINGS_BLOB: "",
      }),
    });
    const config =
      result.status === 0
        ? (JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
            string,
            unknown
          >)
        : undefined;
    return { result, config };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function extractLoadInstallConfigScript(installer: string): string {
  const functionMarker = "\nload_install_config() {";
  const functionStart = installer.indexOf(functionMarker) + 1;
  const marker = "node - \"$config_path\" >\"$temp_env\" <<'NODE'\n";
  const markerStart = installer.indexOf(marker, functionStart);
  const scriptStart = markerStart + marker.length;
  const scriptEnd = installer.indexOf("\nNODE\n", scriptStart);

  expect(functionStart).toBeGreaterThan(0);
  expect(markerStart).toBeGreaterThanOrEqual(functionStart);
  expect(scriptEnd).toBeGreaterThan(scriptStart);
  return installer.slice(scriptStart, scriptEnd);
}

function parseInstallProfileConfig(
  profile: Record<string, unknown>,
  expectedProfileId = "",
  installer = installDist
) {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "seqdesk-profile-config-")
  );
  const configPath = path.join(tempDir, "profile.json");
  fs.writeFileSync(configPath, JSON.stringify(profile));
  try {
    return spawnSync(process.execPath, ["-", configPath], {
      input: extractLoadInstallConfigScript(installer),
      encoding: "utf8",
      env: processEnvironment({
        PATH: process.env.PATH,
        SEQDESK_EXPECTED_PROFILE_ID: expectedProfileId,
      }),
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("install profile installer wiring", () => {
  it.each([
    ["distribution", installDist],
    ["source", sourceInstaller],
  ])(
    "persists the configured execution mode in the %s installer",
    (_name, installer) => {
      const slurmConfig = runWriteConfigScript(installer, true);
      const localConfig = runWriteConfigScript(installer, false);
      const pathOnlyConfig = runWriteConfigScript(installer);

      expect(slurmConfig.pipelines.execution.mode).toBe("slurm");
      expect(localConfig.pipelines.execution.mode).toBe("local");
      expect(pathOnlyConfig.pipelines.execution.mode).toBeUndefined();
    }
  );

  it.each([
    ["distribution", installDist],
    ["source", sourceInstaller],
  ])(
    "persists runtime.updateServer in the %s installer",
    (_name, installer) => {
      const updateServer = "https://updates.example.test";
      const config = runWriteConfigScript(
        installer,
        undefined,
        updateServer
      );

      expect(config.runtime?.updateServer).toBe(updateServer);
    }
  );

  it("adds hosted profile flags and aliases to the distribution installer", () => {
    expect(installDist).toContain("--profile <id>");
    expect(installDist).toContain("--profile-code <code>");
    expect(installDist).toContain("--setting <id>");
    expect(installDist).toContain("--key <code>");
    expect(installDist).toContain("--additional-setting <path=value>");
    expect(installDist).toContain("--additional-settings <path=value...>");
    expect(installDist).toContain("--additional-settings-file <path>");
    expect(installDist).toContain("SEQDESK_ADDITIONAL_SETTINGS_FILE");
    expect(installDist).toContain("SEQDESK_ADDITIONAL_SETTINGS=()");
    expect(installDist).toContain("apply_additional_settings_to_config_path");
    expect(installDist).toContain("Applied additional installer settings");
    expect(installDist).toContain("allowedRoots");
    expect(installDist).toContain('"pipelineSmokeTests",');
    expect(installDist).toContain('"seedData",');
    expect(installDist).toContain("__proto__");
    expect(installDist).toContain("Additional installer settings require --profile or --config.");
    expect(installDist).toContain("resolve_install_profile");
    expect(installDist).toContain('Authorization: Bearer ${SEQDESK_PROFILE_CODE}');
    expect(installDist).toContain("install?.dir");
    expect(installDist).toContain("install?.usePm2");
    expect(installDist).toContain("bootstrapUsers");
    expect(installDist).toContain("SEQDESK_CFG_BOOTSTRAP_ADMIN_PASSWORD");
    expect(installDist).toContain("passwordHash = hashBootstrapPassword(rawPassword)");
    expect(installDist).toContain("clear_bootstrap_plaintext_passwords");
    expect(installDist).toContain("redact_database_url");
    expect(installDist).toContain("Configured PostgreSQL is remote");
    expect(installDist).toContain("postgres_url_host");
    expect(installDist).toContain("Current DATABASE_URL: ${redacted_database_url}");
    expect(installDist).toContain("SEQDESK_INSTALL_PROFILE_CONFIG_FILE");
    expect(installDist).toContain("buildInstallProfileConfig");
    expect(installDist).toContain("config.installProfile = installProfile");
    expect(installDist).not.toContain("safeProfile.relayToken");
  });

  it("protects hosted profile access codes from insecure registry transports", () => {
    const helperStart = installDist.indexOf("is_safe_profile_registry_url() {");
    const helperEnd = installDist.indexOf(
      "\n# Large payloads with a bounded size:",
      helperStart
    );
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helper = installDist.slice(helperStart, helperEnd);
    const checkUrl = (url: string) =>
      spawnSync(
        "bash",
        [
          "-c",
          [
            "set -euo pipefail",
            helper,
            'is_safe_profile_registry_url "$1"',
          ].join("\n"),
          "bash",
          url,
        ],
        { encoding: "utf8" }
      );

    expect(checkUrl("https://seqdesk.org/api/install-profiles").status).toBe(0);
    expect(checkUrl("http://localhost:3000/api/install-profiles").status).toBe(
      0
    );
    expect(
      checkUrl("http://127.0.0.1:3000/api/install-profiles").status
    ).toBe(0);
    expect(checkUrl("http://profiles.example.test/api").status).not.toBe(0);

    const resolver = extractShellFunction(
      installDist,
      "resolve_install_profile"
    );
    expect(resolver.indexOf("is_safe_profile_registry_url")).toBeLessThan(
      resolver.indexOf("Authorization: Bearer")
    );
    expect(resolver).toContain("--max-redirs 0");
    expect(resolver).toContain("--proto-redir '=https'");
  });

  it("validates the hosted profile identity and minimum release version before install", () => {
    const valid = parseInstallProfileConfig(
      {
        id: "production",
        minSeqDeskVersion: "1.4.2",
        app: { port: 8080 },
        runtime: { updateServer: "https://updates.example.test" },
        studies: [],
      },
      "production"
    );

    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain('SEQDESK_CFG_PORT="8080"');
    expect(valid.stdout).toContain(
      'SEQDESK_CFG_PROFILE_MIN_VERSION="1.4.2"'
    );
    expect(valid.stdout).toContain(
      'SEQDESK_CFG_UPDATE_SERVER="https://updates.example.test"'
    );
    expect(installDist).toContain(
      "requires SeqDesk ${SEQDESK_PROFILE_MIN_VERSION} or newer"
    );
    expect(installDist).toContain(
      'is_truthy "$SEQDESK_RECONFIGURE" && [ -n "$SEQDESK_PROFILE_MIN_VERSION" ]'
    );

    const preflightCall = installDist.indexOf(
      "\npreflight_profile_minimum_version\n"
    );
    const postgresMutation = installDist.indexOf(
      "\nif ! preflight_local_postgres; then",
      preflightCall
    );
    const minicondaMutation = installDist.indexOf(
      '\n    print_header "Install Miniconda"',
      preflightCall
    );
    expect(preflightCall).toBeGreaterThanOrEqual(0);
    expect(preflightCall).toBeLessThan(postgresMutation);
    expect(preflightCall).toBeLessThan(minicondaMutation);
    expect(installDist).toContain(
      'SEQDESK_PREFETCHED_VERSION_INFO="$version_info"'
    );
    expect(installDist).toContain(
      'installed_version="$(read_installed_seqdesk_version "$SEQDESK_DIR"'
    );
  });

  it("compares hosted profile minimum versions numerically", () => {
    const check = (current: string, required: string) =>
      spawnSync(
        "bash",
        [
          "-c",
          [
            "set -euo pipefail",
            "export SEQDESK_INSTALL_LIB_ONLY=1",
            'source "$1"',
            'version_at_least "$2" "$3"',
          ].join("\n"),
          "bash",
          path.join(repoRoot, "scripts/install-dist.sh"),
          current,
          required,
        ],
        { encoding: "utf8" }
      );

    expect(check("1.10.0", "1.9.9").status).toBe(0);
    expect(check("v2.0.0", "1.99.99").status).toBe(0);
    expect(check("1.4.1", "1.4.2").status).not.toBe(0);
    expect(check("invalid", "1.4.2").status).not.toBe(0);
  });

  it("accepts every supported additional-settings root and rejects prototype paths", () => {
    const accepted = applyAdditionalSettings({
      access: { publicReadOnly: true },
      auth: { allowRegistration: false },
      moduleSettings: { reports: { enabled: true } },
      sequencingFiles: { scanDepth: 4 },
      studies: [{ alias: "pilot" }],
    });

    expect(accepted.result.status).toBe(0);
    expect(accepted.config).toMatchObject({
      access: { publicReadOnly: true },
      auth: { allowRegistration: false },
      moduleSettings: { reports: { enabled: true } },
      sequencingFiles: { scanDepth: 4 },
      studies: [{ alias: "pilot" }],
    });

    const prototypePath = applyAdditionalSettings(
      '{"auth":{"__proto__":{"polluted":true}}}'
    );
    expect(prototypePath.result.status).not.toBe(0);
    expect(prototypePath.result.stderr).toContain(
      'Forbidden additional setting key "__proto__"'
    );
  });

  it("accepts explicit nulls that disable inherited hosted-profile sections", () => {
    const merged = applyAdditionalSettings(hostedProfileSmokeOverrides, {
      privatePipelines: {
        metaxpath: {
          packageUrl: "https://packages.example.test/metaxpath.tar.gz",
          key: "sensitive-private-package-key",
          sha256: "a".repeat(64),
        },
      },
    });

    expect(merged.result.status).toBe(0);
    expect(merged.config?.privatePipelines).toBeNull();

    const parsed = parseInstallProfileConfig(merged.config ?? {});
    expect(parsed.status).toBe(0);
    expect(parsed.stdout).not.toContain("SEQDESK_CFG_METAXPATH_");
    expect(parsed.stdout).not.toContain("sensitive-private-package-key");
  });

  it("rejects mismatched, malformed, and unsafe hosted profile values", () => {
    const mismatched = parseInstallProfileConfig(
      { id: "other", app: { port: 8000 } },
      "production"
    );
    const malformedSection = parseInstallProfileConfig({
      pipelines: ["not", "an", "object"],
    });
    const invalidPort = parseInstallProfileConfig({
      app: { port: 70_000 },
    });
    const malformedStudies = parseInstallProfileConfig({
      studies: { alias: "not-an-array" },
    });

    expect(mismatched.status).not.toBe(0);
    expect(mismatched.stderr).toContain("Hosted profile id mismatch");
    expect(malformedSection.status).not.toBe(0);
    expect(malformedSection.stderr).toContain(
      "pipelines must be a JSON object"
    );
    expect(invalidPort.status).not.toBe(0);
    expect(invalidPort.stderr).toContain(
      "app.port must be an integer between 1 and 65535"
    );
    expect(malformedStudies.status).not.toBe(0);
    expect(malformedStudies.stderr).toContain(
      "studies must be a JSON array"
    );
  });

  it("does not install a private MetaxPath package excluded by pipeline selection", () => {
    for (const installer of [installDist, sourceInstaller]) {
      const parsed = parseInstallProfileConfig(
        {
          id: "without-metaxpath",
          pipelines: {
            enabled: true,
            enable: ["fastqc", "fastq-checksum"],
          },
          privatePipelines: {
            metaxpath: {
              packageUrl: "https://packages.example.test/metaxpath.tar.gz",
              key: "private-package-key",
              sha256: "a".repeat(64),
            },
          },
        },
        "",
        installer
      );

      expect(parsed.status).toBe(0);
      expect(parsed.stdout).not.toContain("SEQDESK_CFG_METAXPATH_PACKAGE_URL");
      expect(parsed.stdout).not.toContain("SEQDESK_CFG_METAXPATH_KEY");
      expect(parsed.stdout).not.toContain("SEQDESK_CFG_METAXPATH_SHA256");
      expect(parsed.stdout).not.toContain("private-package-key");
    }
  });

  it("cleans resolved profile secrets and release downloads on every exit", () => {
    expect(installDist).toContain("cleanup_installer_temp_files");
    expect(installDist).toContain("trap cleanup_installer_temp_files EXIT");
    expect(installDist).toContain("trap 'exit 130' INT");
    expect(installDist).toContain("trap 'exit 143' TERM");
  });

  it("expands home-relative profile storage paths before installer use", () => {
    const helper = extractShellFunction(installDist, "expand_home_relative_path");
    const output = execFileSync(
      "bash",
      [
        "-c",
        [
          "set -euo pipefail",
          helper,
          "expand_home_relative_path '~/seqdesk-data'",
        ].join("\n"),
      ],
      { encoding: "utf8" }
    );

    expect(output).toBe(path.join(os.homedir(), "seqdesk-data"));
    expect(installDist).toContain(
      'SEQDESK_DATA_PATH="$(expand_home_relative_path "$SEQDESK_DATA_PATH")"'
    );
    expect(installDist).toContain(
      'SEQDESK_RUN_DIR="$(expand_home_relative_path "$SEQDESK_RUN_DIR")"'
    );
    expect(installDist).toContain(
      'SEQDESK_PIPELINE_DATABASE_DIR="$(expand_home_relative_path "$SEQDESK_PIPELINE_DATABASE_DIR")"'
    );
  });

  it("accepts sha256-prefixed checksums for private MetaxPath packages", () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "seqdesk-private-metaxpath-")
    );
    try {
      const packageDir = path.join(tempDir, "package");
      const installDir = path.join(tempDir, "seqdesk");
      const archivePath = path.join(tempDir, "metaxpath.tar.gz");
      fs.mkdirSync(packageDir, { recursive: true });
      fs.mkdirSync(installDir, { recursive: true });
      fs.writeFileSync(
        path.join(packageDir, "manifest.json"),
        JSON.stringify({
          id: "metaxpath",
          package: { version: "0.1.1" },
          targets: { supported: ["study"] },
        })
      );
      execFileSync("tar", ["-czf", archivePath, "-C", packageDir, "."], {
        stdio: "pipe",
      });
      const checksum = createHash("sha256")
        .update(fs.readFileSync(archivePath))
        .digest("hex")
        .toUpperCase();

      execFileSync(
        "bash",
        [
          path.join(repoRoot, "scripts/install-private-metaxpath.sh"),
          "--url",
          pathToFileURL(archivePath).href,
          "--sha256",
          `sha256:${checksum}`,
          "--dir",
          installDir,
        ],
        { stdio: "pipe" }
      );

      expect(
        fs.existsSync(
          path.join(installDir, "pipelines/metaxpath/manifest.json")
        )
      ).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects remote private MetaxPath packages without a SHA256 digest before download", () => {
    const installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "seqdesk-private-metaxpath-remote-")
    );
    try {
      const result = spawnSync(
        "bash",
        [
          path.join(repoRoot, "scripts/install-private-metaxpath.sh"),
          "--url",
          "https://example.invalid/metaxpath.tar.gz",
          "--dir",
          installDir,
        ],
        { encoding: "utf8" }
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "Remote MetaxPath packages require a SHA256 checksum"
      );
      expect(result.stdout).not.toContain("Downloading private package");
    } finally {
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  });

  it("keeps private MetaxPath credentials on the original HTTPS origin", () => {
    expect(privateMetaxPathInstaller).toContain(
      "Remote MetaxPath package URLs must use HTTPS"
    );
    expect(privateMetaxPathInstaller).toContain(
      'oauth2-bearer = "${escapeCurlConfig(token, "Package token")}"'
    );
    expect(privateMetaxPathInstaller).toContain("--proto-redir '=https'");
    expect(privateMetaxPathInstaller).not.toContain(
      'header = "Authorization: Bearer'
    );

    const installDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "seqdesk-private-metaxpath-http-")
    );
    try {
      const result = spawnSync(
        "bash",
        [
          path.join(repoRoot, "scripts/install-private-metaxpath.sh"),
          "--url",
          "http://packages.example.invalid/metaxpath.tar.gz",
          "--sha256",
          "a".repeat(64),
          "--dir",
          installDir,
        ],
        { encoding: "utf8" }
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "Remote MetaxPath package URLs must use HTTPS"
      );
      expect(result.stdout).not.toContain("Downloading private package");
    } finally {
      fs.rmSync(installDir, { recursive: true, force: true });
    }
  });

  it("passes private package tokens through the environment instead of process arguments", () => {
    for (const installer of [installDist, sourceInstaller]) {
      const installerFunction = extractShellFunction(
        installer,
        "install_private_metaxpath_if_configured"
      );

      expect(installerFunction).toContain(
        'METAXPATH_PACKAGE_TOKEN="${SEQDESK_METAXPATH_KEY}"'
      );
      expect(installerFunction).not.toContain("--token");
    }
  });

  it("applies resolved profiles after database setup and includes the applicator in releases", () => {
    expect(installDist).toContain("node scripts/apply-install-profile.mjs --profile-config");
    expect(installDist).toContain("node scripts/apply-install-profile-assets.mjs --profile-config");
    expect(installDist).toContain("SEQDESK_PIPELINE_DATABASE_DIR");
    expect(buildRelease).toContain("scripts/apply-install-profile.mjs");
    expect(buildRelease).toContain("scripts/apply-install-profile-assets.mjs");
    expect(buildRelease).toContain("scripts/run-install-profile-pipeline-smoke.mjs");
    expect(buildRelease).toContain("scripts/setup-conda-env.sh");
    expect(buildRelease).toContain("data/pipeline-databases.json");
  });

  it("keeps root package metadata discoverable for release-layout installs", () => {
    expect(installDist).toContain("link_root_release_metadata");
    expect(installDist).toContain("for item in package.json package-lock.json");
    expect(installDist).toContain('ln -s "current/${item}" "$SEQDESK_DIR/${item}"');
  });

  it("retries runtime dependency installs on NFS-held Prisma client artifacts", () => {
    expect(installDist).toContain("is_nfs_prisma_busy_unlink_failure");
    expect(installDist).toContain("unlink .*node_modules");
    expect(installDist).toContain(".prisma");
    expect(installDist).toContain(".nfs");
    expect(installDist).toContain(
      "npm ci could not remove an NFS-held Prisma client artifact; retrying with npm install."
    );
    expect(installDist).toContain(
      "Runtime Node dependencies retry\" npm install --omit=dev --no-audit --no-fund"
    );
  });

  it("strips local pipeline download and activity state from release tarballs", () => {
    expect(buildRelease).toContain(".pipeline-download-status.json");
    expect(buildRelease).toContain(".pipeline-downloads.json");
    expect(buildRelease).toContain(".admin-activity-status.json");
    expect(buildRelease).toContain(".pipeline-download-logs");
    expect(buildRelease).toContain(".nextflow");
    expect(buildRelease).toContain("pipeline_runs");
    expect(buildRelease).toContain("playwright-report");
    expect(buildRelease).toContain("find \"${RELEASE_DIR}/.next/server\" -name '*.nft.json'");
  });

  it("separates browser and local health-check URLs in installer output", () => {
    expect(installDist).toContain('print_kv "Browser URL" "$(browser_app_url)"');
    expect(installDist).toContain('print_kv "Local health URL" "$(local_app_url)"');
    expect(installDist).toContain('print_kv "Bind host" "$(bind_host)"');
    expect(installDist).toContain("Use the Browser URL for login. Use the Local health URL for curl/doctor checks.");
    expect(installDist).toContain("print_success_footer\nprint_next_steps");
    expect(installDist).toContain(
      "pipelines install simulate-reads --runtime"
    );
    expect(installDist).toContain(
      "https://seqdesk.org/docs/pipelines/installing-pipelines"
    );
    expect(installDist).toContain("demo-data install");
    expect(installDist).toContain("Admin > Settings > Demo data");
    expect(installDist).toContain("Data Storage is configured and writable");
    expect(sourceInstaller).toContain("Admin > Settings > Demo data");
    expect(sourceInstaller).toContain(
      "Data Storage is configured and writable"
    );
    expect(sourceInstaller).toContain(
      "example orders, studies, samples, metadata, and synthetic FASTQ files"
    );
    expect(sourceInstaller).not.toContain(
      "seqdesk@latest demo-data install --dir"
    );
    expect(sourceInstaller).toContain("Browser URL: ${SEQDESK_NEXTAUTH_URL:-http://127.0.0.1:${SEQDESK_PORT:-8000}}");
    expect(sourceInstaller).toContain("Local health URL: http://127.0.0.1:${SEQDESK_PORT:-8000}");
  });

  it("binds standalone releases to all interfaces unless explicitly overridden", () => {
    expect(buildRelease).toContain('export HOSTNAME="${SEQDESK_BIND_HOST:-0.0.0.0}"');
    expect(sourceInstaller).toContain('export HOSTNAME="${SEQDESK_BIND_HOST:-0.0.0.0}"');
    expect(installDist).toContain("SEQDESK_BIND_HOST=0.0.0.0");
  });

  it("keeps the profile applicator scoped to settings upserts", () => {
    expect(profileApplicator).toContain("applyInstallProfile");
    expect(profileApplicator).toContain("scripts/apply-install-profile.mjs --profile-config");
    expect(profileApplicatorCore).toContain("sequencingRunSampleFormFields");
    expect(profileApplicatorCore).toContain("sequencingTechConfig");
    expect(profileApplicatorCore).toContain("installProfile");
    expect(profileApplicatorCore).toContain("installProfilePipelineAllowlist");
    expect(profileApplicatorCore).toContain("installProfileManaged");
    expect(profileApplicatorCore).toContain("mergeManagedFields");
    expect(profileApplicatorCore).toContain("pipelineConfigKeys");
    expect(profileApplicatorCore).toContain("discoverInstalledPipelineIds");
    expect(profileApplicatorCore).toContain("buildPipelineExecutionOverrides");
    expect(profileApplicatorCore).toContain("buildPipelineProfileConfig");
    expect(profileApplicatorCore).toContain("mergePipelineConfig");
    expect(profileApplicatorCore).toContain("pipelines.configs");
    expect(profileApplicatorCore).toContain("pipelines.pipelineConfigs");
    expect(profileApplicatorCore).toContain("pipelineConfig.config");
    expect(profileApplicatorCore).toContain("pipelineOverrides");
    expect(profileApplicatorCore).toContain("...Object.keys(pipelines)");
    expect(profileApplicatorCore).toContain("pipelineDatabaseDir");
    expect(profileApplicatorCore).toContain("extra.telemetry");
    expect(profileApplicatorCore).toContain("installProfileSeedData");
    expect(profileApplicatorCore).toContain("installProfilePipelineSmokeTests");
    expect(profileApplicatorCore).toContain("normalizeSequencingFilesConfig");
    expect(profileApplicatorCore).toContain("activeWriteMinAgeMs");
    expect(profileApplicatorCore).toContain("normalizeAccessSettings");
    expect(profileApplicatorCore).toContain("allowUserAssemblyDownload");
    expect(profileApplicatorCore).toContain("normalizeAuthSettings");
    expect(profileApplicatorCore).toContain("allowRegistration");
    expect(profileApplicatorCore).toContain("normalizeNotificationManagedSettings");
    expect(profileApplicatorCore).toContain("managed.notificationKeys");
    expect(profileApplicatorCore).toContain("normalizeAccountValidationSettings");
    expect(profileApplicatorCore).toContain("accountValidationSettings");
    expect(profileApplicatorCore).toContain("normalizeBillingSettings");
    expect(profileApplicatorCore).toContain("billingSettings");
    expect(profileApplicatorCore).toContain("managed.moduleSettings");
    expect(profileApplicatorCore).toContain("persistSafeInstallProfileMetadata");
    expect(profileApplicatorCore).toContain("buildSafeInstallProfileMetadata");
    expect(profileApplicatorCore).not.toContain("metadata.relayToken");
    expect(profileApplicatorCore).not.toContain("metadata.databaseUrl");
    expect(profileApplicatorCore).not.toContain("deleteMany");
  });

  it("has a second profile asset pass for DB downloads and smoke fixtures", () => {
    expect(profileAssetsApplicator).toContain("applyProfileAssets");
    expect(profileAssetsApplicator).toContain("profile-config");
    expect(profileAssetsLib).toContain("downloadedFastqBundle");
    expect(profileAssetsLib).toContain("SHA256 mismatch");
  });

  it("has an API pipeline smoke runner for profile-declared tests", () => {
    expect(profilePipelineSmokeRunner).toContain("installProfilePipelineSmokeTests");
    expect(profilePipelineSmokeRunner).toContain("/api/pipelines/runs");
    expect(profilePipelineSmokeRunner).toContain("checksum1");
    expect(profilePipelineSmokeRunner).toContain("pipelineSources");
  });

  it("has an install-profile assertion script for end-to-end canaries", () => {
    expect(profileAssert).toContain("installProfile");
    expect(profileAssert).toContain("sequencingRunSampleFormFields");
    expect(profileAssert).toContain("ont-minion-mk1d");
    expect(profileAssert).toContain("metaxpath");
    expect(profileAssert).toContain("telemetry.intervalHours");
  });

  it("defines bifo_dmz AlmaLinux canaries for plain and hosted-profile installs", () => {
    // The required lightweight install/pipeline gate is change-driven in
    // pipeline-slurm-e2e. This heavyweight real-data/profile matrix is manual.
    expect(profileWorkflow).not.toContain("schedule:");
    expect(profileWorkflow).toContain("workflow_dispatch:");
    expect(profileWorkflow).toContain('PROFILE_ID: ${{ github.event.inputs.profile_id || \'ci-runner\' }}');
    expect(profileWorkflow).toContain("PROFILE_REGISTRY_URL: ${{ github.event.inputs.profile_registry_url || 'https://seqdesk.org/api/install-profiles' }}");
    expect(profileWorkflow).toContain("group: bifo_dmz");
    expect(profileWorkflow).toContain("labels: [self-hosted, Linux, X64, db-local, twincore, alma]");
    expect(profileWorkflow).toContain("build-install-artifacts:");
    const buildJob = profileWorkflow.slice(
      profileWorkflow.indexOf("build-install-artifacts:"),
      profileWorkflow.indexOf("install-without-profile:")
    );
    expect(buildJob).toContain("group: bifo_dmz");
    expect(buildJob).not.toContain("runs-on: ubuntu-latest");
    expect(profileWorkflow).toContain("install-without-profile:");
    expect(profileWorkflow).toContain("install-with-profile:");
    expect(profileWorkflow).toContain("default: \"ci-runner\"");
    expect(profileWorkflow).toContain("SEQDESK_CI_PROFILE_CODE");
    expect(profileWorkflow).toContain("npm run sync-version");
    expect(profileWorkflow).toContain("npm pack --pack-destination");
    expect(profileWorkflow).toContain("SEQDESK_INSTALL_URL");
    expect(profileWorkflow).toContain("seqdesk \\");
    expect(profileWorkflow).toContain("scripts/assert-install-profile-applied.mjs");
    expect(profileWorkflow).toContain("scripts/run-telemetry-e2e.mjs");
    expect(profileWorkflow).toContain("TELEMETRY_JSON");
    expect(profileWorkflow).toContain("PROFILE_DATA_DIR");
    expect(profileWorkflow).toContain("PROFILE_RUN_DIR");
    expect(profileWorkflow).toContain("PIPELINE_SMOKE_JSON");
    expect(profileWorkflow).toContain("--expected-pipelines-enabled true");
    expect(profileWorkflow).toContain("scripts/run-install-profile-pipeline-smoke.mjs");
  });

  it("defines a GitHub-hosted ci-runner pipeline smoke canary", () => {
    expect(hostedProfileSmokeWorkflow).toContain("name: Hosted Profile Smoke");
    expect(hostedProfileSmokeWorkflow).toContain("runs-on: ubuntu-latest");
    expect(hostedProfileSmokeWorkflow).toContain("image: postgres:16");
    expect(hostedProfileSmokeWorkflow).toContain("POSTGRES_DB: seqdesk_profile_ubuntu");
    expect(hostedProfileSmokeWorkflow).toContain("PROFILE_ID: ci-runner");
    expect(hostedProfileSmokeWorkflow).toContain("SEQDESK_CI_PROFILE_CODE");
    expect(hostedProfileSmokeWorkflow).toContain("Setup Miniconda for pipeline tools");
    expect(hostedProfileSmokeWorkflow).toContain("--with-pipelines");
    expect(hostedProfileSmokeWorkflow).toContain(
      "ci-runner-github-hosted-overrides.json"
    );
    expect(hostedProfileSmokeWorkflow).toContain(
      '--additional-setting "site.dataBasePath=$PROFILE_DATA_DIR"'
    );
    expect(hostedProfileSmokeWorkflow).toContain(
      '--additional-setting "pipelines.execution.runDirectory=$PROFILE_RUN_DIR"'
    );
    expect(hostedProfileSmokeWorkflow).toContain(
      '--additional-setting "pipelines.databaseDirectory=$PROFILE_RUN_DIR/databases"'
    );
    expect(hostedProfileSmokeWorkflow).toContain("--expected-pipelines-enabled true");
    expect(hostedProfileSmokeWorkflow).toContain("scripts/assert-install-profile-applied.mjs");
    expect(hostedProfileSmokeWorkflow).toContain("scripts/run-install-profile-pipeline-smoke.mjs");
  });

  it("pins the GitHub-hosted profile smoke to portable assets", () => {
    expect(hostedProfileSmokeOverrides["pipelines.enabled"]).toBe(true);
    expect(hostedProfileSmokeOverrides["pipelines.enable"]).toEqual([
      "fastq-checksum",
    ]);
    expect(hostedProfileSmokeOverrides["pipelines.databases"]).toEqual({
      autoDownload: false,
      downloads: [],
    });
    expect(hostedProfileSmokeOverrides.privatePipelines).toBeNull();
    expect(hostedProfileSmokeOverrides["seedData.fixtures"]).toEqual([
      expect.objectContaining({
        id: "ci-runner-fastq-checksum-smoke",
        kind: "orderPipelineSmoke",
        source: expect.objectContaining({
          type: "downloadedFastqBundle",
          url: "https://seqdesk.org/api/install-profiles/assets/ci-runner-fastq-bundle.tar.gz",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    ]);
    expect(hostedProfileSmokeOverrides["pipelineSmokeTests.tests"]).toEqual([
      expect.objectContaining({
        pipelineId: "fastq-checksum",
        required: true,
      }),
    ]);

    const serialized = JSON.stringify(hostedProfileSmokeOverrides);
    expect(serialized).not.toContain("/net/");
    expect(serialized).not.toContain("metaxpath");
  });
});
