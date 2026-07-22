import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

type WorkflowJob = {
  if?: string;
  name?: string;
  "runs-on"?: string;
  services?: Record<string, { image?: string }>;
  strategy?: {
    matrix?: {
      include?: Array<Record<string, string>>;
    };
  };
  env?: Record<string, string>;
  steps?: Array<Record<string, unknown>>;
};

type ReviewerWorkflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
};

const repoRoot = process.cwd();
const workflowPath = path.join(
  repoRoot,
  ".github/workflows/reviewer-install-matrix.yml"
);
const smokePath = path.join(
  repoRoot,
  "scripts/ci/run-reviewer-install-smoke.sh"
);
const reportPath = path.join(
  repoRoot,
  "scripts/ci/write-reviewer-compatibility-report.mjs"
);

const workflowSource = fs.readFileSync(workflowPath, "utf8");
const smokeSource = fs.readFileSync(smokePath, "utf8");
const reportSource = fs.readFileSync(reportPath, "utf8");
const installerSources = ["scripts/install.sh", "scripts/install-dist.sh"].map(
  (file) => fs.readFileSync(path.join(repoRoot, file), "utf8")
);
const distributionInstallerSource = installerSources[1];
const releaseWorkflowSource = fs.readFileSync(
  path.join(repoRoot, ".github/workflows/release.yml"),
  "utf8"
);
const workflow = yaml.load(workflowSource) as ReviewerWorkflow;

describe("reviewer installation matrix contract", () => {
  it("is valid YAML with safe public-repository triggers and permissions", () => {
    expect(workflow.on).toHaveProperty("pull_request");
    expect(workflow.on).toHaveProperty("merge_group");
    expect(workflow.on).toHaveProperty("push");
    expect(workflow.on).toHaveProperty("schedule");
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.on).toHaveProperty("workflow_call");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflowSource).not.toContain("pull_request_target");
    expect(workflowSource).not.toContain("self-hosted");
    expect(workflow.jobs["build-candidate"].if).toContain(
      "github.repository == 'hzi-bifo/SeqDesk'"
    );
  });

  it("builds the release and npm launcher once, then shares the checksummed candidate", () => {
    const buildJob = JSON.stringify(workflow.jobs["build-candidate"]);

    expect(buildJob).toContain("npm ci");
    expect(buildJob).toContain("scripts/build-release.sh");
    expect(buildJob).toContain("--webpack");
    expect(buildJob).toContain("npm pack");
    expect(buildJob).toContain("candidate.json");
    expect(buildJob).toContain("SHA256SUMS");
    expect(buildJob).toContain("reviewer-candidate");
  });

  it("keeps a stable required clean-install boundary for every change", () => {
    const required = workflow.jobs["required-ubuntu"];
    const minimum = workflow.jobs["required-minimum"];
    const gate = workflow.jobs["required-install-gate"];

    expect(required.name).toContain("Ubuntu 24.04 x64");
    expect(required["runs-on"]).toBe("ubuntu-24.04");
    expect(required.services?.postgres?.image).toBe("postgres:16");
    expect(required.env).toMatchObject({
      REVIEWER_EXPECTED_ARCH: "x64",
      REVIEWER_NODE_VERSION: "24",
      REVIEWER_POSTGRES_VERSION: "16",
      REVIEWER_PIPELINE_SMOKE: "false",
    });
    expect(required.if).toContain("pull_request");
    expect(required.if).toContain("merge_group");
    expect(required.if).toContain("push");
    expect(required.if).toContain("workflow_dispatch");
    expect(required.if).toContain("schedule");
    expect(required.if).toContain("github.repository == 'hzi-bifo/SeqDesk'");

    expect(minimum.name).toContain("Ubuntu 22.04 x64");
    expect(minimum["runs-on"]).toBe("ubuntu-22.04");
    expect(minimum.services?.postgres?.image).toBe("postgres:14");
    expect(minimum.env).toMatchObject({
      REVIEWER_EXPECTED_ARCH: "x64",
      REVIEWER_NODE_VERSION: "22.13.0",
      REVIEWER_POSTGRES_VERSION: "14",
      REVIEWER_PIPELINE_SMOKE: "false",
    });

    expect(gate.if).toContain("always()");
    expect(JSON.stringify(gate)).toContain("needs.build-candidate.result");
    expect(JSON.stringify(gate)).toContain("needs.required-ubuntu.result");
    expect(JSON.stringify(gate)).toContain("needs.required-minimum.result");
    expect(releaseWorkflowSource).toContain(
      "uses: ./.github/workflows/reviewer-install-matrix.yml"
    );
    expect(releaseWorkflowSource).toContain(
      "needs: [reviewer-install-gate, update-rollback-gate]"
    );
    expect(releaseWorkflowSource).toContain(
      "name: Download the candidate that passed the reviewer matrix"
    );
    expect(releaseWorkflowSource).toContain("sha256sum -c SHA256SUMS");
    expect(releaseWorkflowSource).not.toContain(
      'scripts/build-release.sh "$VERSION"'
    );
  });

  it("covers both Node LTS lines, PostgreSQL 14-18, OS families, and CPU architectures", () => {
    const ubuntuRows =
      workflow.jobs["extended-ubuntu"].strategy?.matrix?.include ?? [];
    const containerRows =
      workflow.jobs["extended-containers"].strategy?.matrix?.include ?? [];
    const allRows = [...ubuntuRows, ...containerRows];

    expect(allRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runner: "ubuntu-24.04-arm",
          arch: "arm64",
          node: "24",
          postgres: "17",
        }),
        expect.objectContaining({
          image: "debian:12",
          node: "22",
          postgres: "18",
        }),
        expect.objectContaining({
          image: "rockylinux:9",
          node: "24",
          postgres: "15",
        }),
      ])
    );

    const postgresMajors = new Set([
      "14",
      "16",
      ...allRows.map((row) => row.postgres),
    ]);
    expect([...postgresMajors].sort()).toEqual(["14", "15", "16", "17", "18"]);

    const macJob = JSON.stringify(workflow.jobs["extended-macos"]);
    expect(macJob).toContain("macos-15");
    expect(macJob).toContain("macos-15-intel");
    expect(macJob).toContain("arm64");
    expect(macJob).toContain("x64");
  });

  it("proves install, migration, boot, version, both login roles, and dependency boundaries", () => {
    expect(smokeSource).toContain('test ! -e "$INSTALL_DIR"');
    expect(smokeSource).toContain('CHECKSUMS_FILE="$CANDIDATE_DIR/SHA256SUMS"');
    expect(smokeSource).toContain('touch "$OUTPUT_DIR/candidate-checksums.ok"');
    expect(smokeSource).toContain("sha256:");
    expect(smokeSource).toContain("write-mock-manifest.mjs");
    expect(smokeSource).toContain("REVIEWER_NODE_VERSION");
    expect(smokeSource).toContain("REVIEWER_POSTGRES_VERSION");
    expect(smokeSource).toContain('INSTALLED_VERSION="$(');
    expect(smokeSource).toContain("/api/auth/providers");
    expect(smokeSource).toContain("/api/setup/status");
    expect(smokeSource).toContain('touch "$OUTPUT_DIR/auth-admin.ok"');
    expect(smokeSource).toContain('touch "$OUTPUT_DIR/auth-researcher.ok"');
    expect(smokeSource).toContain('"FACILITY_ADMIN"');
    expect(smokeSource).toContain('"RESEARCHER"');
  });

  it("enforces the exact Node floor and only the two tested LTS lines", () => {
    for (const installerSource of installerSources) {
      expect(installerSource).toContain('MIN_NODE_VERSION="22.13.0"');
      const inlineCheck = installerSource.match(
        /node_meets_minimum_version\(\) \{\n\s+node -e '\n([\s\S]*?)\n\s+' "\$MIN_NODE_VERSION"\n\}/
      )?.[1];
      expect(inlineCheck).toBeTruthy();

      const statusFor = (observedVersion: string) =>
        spawnSync(
          process.execPath,
          ["-e", inlineCheck ?? "process.exit(2)", "22.13.0", observedVersion],
          { encoding: "utf8" }
        ).status;

      expect(statusFor("22.12.99")).toBe(1);
      expect(statusFor("22.13.0-rc.1")).toBe(1);
      expect(statusFor("22.13.0")).toBe(0);
      expect(statusFor("23.11.0")).toBe(1);
      expect(statusFor("24.0.0")).toBe(0);
      expect(statusFor("25.0.0")).toBe(1);
    }

    expect(JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).engines.node)
      .toBe(">=22.13.0 <23 || >=24 <25");
    expect(JSON.parse(fs.readFileSync(path.join(repoRoot, "npm/seqdesk/package.json"), "utf8")).engines.node)
      .toBe(">=22.13.0 <23 || >=24 <25");
  });

  it("separates application portability from Linux pipeline and Windows support claims", () => {
    const pipelineJob = JSON.stringify(
      workflow.jobs["linux-pipeline-toolchain"]
    );
    const macJob = JSON.stringify(workflow.jobs["extended-macos"]);
    const windowsJob = JSON.stringify(
      workflow.jobs["native-windows-contract"]
    );

    expect(pipelineJob).toContain('REVIEWER_PIPELINE_SMOKE":"true"');
    expect(pipelineJob).toContain("setup-miniconda");
    expect(smokeSource).toContain(
      'bash "$WORKSPACE/scripts/run-fastq-checksum-e2e.sh"'
    );
    expect(reportSource).toContain(
      '"fastq-checksum-output",\n            "checksum-output",'
    );
    expect(macJob).toContain("application only");
    expect(windowsJob).toContain("Windows is not supported directly");
    expect(windowsJob).toContain("WSL");
  });

  it("persists an explicitly selected bind host for later manual and PM2 starts", () => {
    expect(distributionInstallerSource).toContain('.seqdesk-bind-host');
    expect(distributionInstallerSource).toContain(
      'if [[ -z "${SEQDESK_BIND_HOST:-}" ]]; then export SEQDESK_BIND_HOST=%q; fi'
    );
    expect(distributionInstallerSource).toContain(
      'persisted_bind_host="$(bind_host)"'
    );
  });

  it("writes reviewer-readable and machine-readable evidence even after failures", () => {
    expect(workflowSource).toContain("if: always()");
    expect(workflowSource).toContain("retention-days: 30");
    expect(reportSource).toContain("compatibility.json");
    expect(reportSource).toContain("compatibility.md");
    expect(reportSource).toContain("versions.txt");
    expect(reportSource).toContain("GITHUB_STEP_SUMMARY");
    expect(reportSource).toContain("auth-admin.ok");
    expect(reportSource).toContain("auth-researcher.ok");
    expect(reportSource).toContain("candidate-checksums.ok");
  });
});
