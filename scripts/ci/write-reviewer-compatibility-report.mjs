#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function command(name, args = [], extraEnv = {}) {
  const result = spawnSync(name, args, {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    timeout: 20_000,
  });
  if (result.error || result.status !== 0) return "not available";
  return `${result.stdout || ""}\n${result.stderr || ""}`.trim().replace(/\s+/g, " ") || "available";
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function markdown(value) {
  return String(value ?? "not available")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, "<br>");
}

function assertion(value) {
  if (value === null) return "not exercised";
  return value ? "PASS" : "FAIL";
}

const outputDir = path.resolve(process.env.REVIEWER_OUTPUT_DIR || "reviewer-compatibility");
fs.mkdirSync(outputDir, { recursive: true });

const condaEnv = process.env.REVIEWER_PIPELINE_CONDA_ENV || "seqdesk-pipelines";
const pipelineSmoke = process.env.REVIEWER_PIPELINE_SMOKE === "true";
const pgEnv = {
  PGCONNECT_TIMEOUT: "5",
  PGPASSWORD: process.env.DB_PASSWORD || "seqdesk",
};
const pgArgs = [
  "-h",
  process.env.DB_HOST || "127.0.0.1",
  "-p",
  process.env.DB_PORT || "5432",
  "-U",
  process.env.DB_USER || "seqdesk",
  "-d",
  process.env.DB_NAME || "seqdesk_reviewer",
  "-Atqc",
  "SHOW server_version",
];

const osRelease = readText("/etc/os-release");
const macVersion = process.platform === "darwin" ? command("sw_vers") : "not applicable";
const providers = readJson(path.join(outputDir, "providers.json"));
const setup = readJson(path.join(outputDir, "setup.json"));

const report = {
  schemaVersion: 1,
  result: process.env.REVIEWER_RESULT || "unknown",
  failureStage: process.env.REVIEWER_STAGE || "unknown",
  completedAt: new Date().toISOString(),
  candidateVersion: process.env.REVIEWER_CANDIDATE_VERSION || "unknown",
  job: {
    label: process.env.REVIEWER_LABEL || "reviewer-install",
    declaredOS: process.env.REVIEWER_DECLARED_OS || "unknown",
    expectedArchitecture: process.env.REVIEWER_EXPECTED_ARCH || "unknown",
    expectedNode: process.env.REVIEWER_NODE_VERSION || "unknown",
    expectedPostgreSQL: process.env.REVIEWER_POSTGRES_VERSION || "unknown",
    scope: pipelineSmoke ? "application install plus packaged fastq-checksum pipeline" : "application install only",
    pipelineClaim: pipelineSmoke
      ? "The packaged Linux fastq-checksum workflow was executed with Conda, Java 17, and Nextflow."
      : "No pipeline execution claim is made by this job.",
  },
  source: {
    repository: process.env.GITHUB_REPOSITORY || "local",
    commit: process.env.GITHUB_SHA || "local",
    workflow: process.env.GITHUB_WORKFLOW || "local",
    runId: process.env.GITHUB_RUN_ID || "local",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || "local",
  },
  actual: {
    platform: process.platform,
    architecture: process.arch,
    hostname: os.hostname(),
    kernel: command("uname", ["-srm"]),
    osRelease: osRelease || "not applicable",
    macOS: macVersion,
    node: process.version,
    npm: command("npm", ["--version"]),
    postgresqlClient: command("psql", ["--version"]),
    postgresqlServer: command("psql", pgArgs, pgEnv),
    openssl: command("openssl", ["version"]),
    systemJava: command("java", ["-version"]),
    conda: command("conda", ["--version"]),
    pipelineCondaEnvironment: pipelineSmoke ? condaEnv : "not exercised",
    pipelineJava: pipelineSmoke
      ? command("conda", ["run", "-n", condaEnv, "java", "-version"])
      : "not exercised",
    nextflow: pipelineSmoke
      ? command("conda", ["run", "-n", condaEnv, "nextflow", "-version"])
      : "not exercised",
  },
  assertions: {
    candidateChecksums: fs.existsSync(path.join(outputDir, "candidate-checksums.ok")),
    credentialsProvider: Boolean(providers?.credentials),
    setupDatabaseExists: Boolean(setup?.exists),
    setupConfigured: Boolean(setup?.configured),
    adminAuthentication: fs.existsSync(path.join(outputDir, "auth-admin.ok")),
    researcherAuthentication: fs.existsSync(path.join(outputDir, "auth-researcher.ok")),
    packagedFastqChecksum: pipelineSmoke
      ? fs.existsSync(
          path.join(
            outputDir,
            "fastq-checksum-output",
            "checksum-output",
            "summary",
            "checksum-summary.tsv"
          )
        )
      : null,
  },
};

fs.writeFileSync(
  path.join(outputDir, "compatibility.json"),
  `${JSON.stringify(report, null, 2)}\n`
);

const status = report.result === "passed" ? "PASS" : "FAIL";
const lines = [
  `## Reviewer clean-install compatibility: ${status}`,
  "",
  `Candidate \`${markdown(report.candidateVersion)}\` was tested from the locally built release tarball through the locally packed npm launcher.`,
  "",
  "| Property | Observed value |",
  "|---|---|",
  `| Job | ${markdown(report.job.label)} |`,
  `| Result | **${status}** |`,
  `| Failure stage | ${markdown(report.failureStage)} |`,
  `| Declared environment | ${markdown(report.job.declaredOS)} |`,
  `| Expected architecture | ${markdown(report.job.expectedArchitecture)} |`,
  `| Expected Node | ${markdown(report.job.expectedNode)} |`,
  `| Expected PostgreSQL | ${markdown(report.job.expectedPostgreSQL)} |`,
  `| Actual platform / architecture | ${markdown(`${report.actual.platform} / ${report.actual.architecture}`)} |`,
  `| Kernel | ${markdown(report.actual.kernel)} |`,
  `| Node | ${markdown(report.actual.node)} |`,
  `| npm | ${markdown(report.actual.npm)} |`,
  `| PostgreSQL client | ${markdown(report.actual.postgresqlClient)} |`,
  `| PostgreSQL server | ${markdown(report.actual.postgresqlServer)} |`,
  `| Conda | ${markdown(report.actual.conda)} |`,
  `| Java in pipeline environment | ${markdown(report.actual.pipelineJava)} |`,
  `| Nextflow | ${markdown(report.actual.nextflow)} |`,
  `| Test scope | ${markdown(report.job.scope)} |`,
  "",
  "### Assertions",
  "",
  "| Assertion | Result |",
  "|---|---|",
  `| Build-recorded candidate checksums | ${assertion(report.assertions.candidateChecksums)} |`,
  `| Credentials provider available | ${assertion(report.assertions.credentialsProvider)} |`,
  `| Database exists | ${assertion(report.assertions.setupDatabaseExists)} |`,
  `| Database configured | ${assertion(report.assertions.setupConfigured)} |`,
  `| Facility administrator authenticated | ${assertion(report.assertions.adminAuthentication)} |`,
  `| Researcher authenticated | ${assertion(report.assertions.researcherAuthentication)} |`,
  `| Packaged FASTQ checksum pipeline | ${assertion(report.assertions.packagedFastqChecksum)} |`,
  "",
  `Pipeline statement: ${report.job.pipelineClaim}`,
  "",
  "The artifact contains the machine-readable report, endpoint responses, installer/server logs, and authentication evidence.",
  "",
];
const markdownReport = `${lines.join("\n")}\n`;
fs.writeFileSync(path.join(outputDir, "compatibility.md"), markdownReport);

const versionLines = Object.entries(report.actual).map(([key, value]) => {
  const rendered = typeof value === "string" ? value : JSON.stringify(value);
  return `${key}: ${rendered}`;
});
fs.writeFileSync(path.join(outputDir, "versions.txt"), `${versionLines.join("\n")}\n`);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdownReport);
}

console.log(`Wrote reviewer compatibility report to ${outputDir}`);
