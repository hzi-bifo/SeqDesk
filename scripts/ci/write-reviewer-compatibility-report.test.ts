import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const reportScript = path.join(
  repoRoot,
  "scripts/ci/write-reviewer-compatibility-report.mjs"
);
const smokeScript = path.join(
  repoRoot,
  "scripts/ci/run-reviewer-install-smoke.sh"
);
const tempDirs: string[] = [];

type Report = {
  result: string;
  requestedResult: string;
  failureStage: string;
  evidence: {
    complete: boolean;
    requiredAssertions: string[];
    failedRequiredAssertions: string[];
  };
  assertions: Record<string, boolean | null>;
};

function createOutputDir() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "seqdesk-reviewer-report-")
  );
  tempDirs.push(directory);
  return directory;
}

function writeRequiredApplicationEvidence(directory: string) {
  fs.writeFileSync(path.join(directory, "candidate-checksums.ok"), "");
  fs.writeFileSync(path.join(directory, "demo-data-cli.ok"), "");
  fs.writeFileSync(
    path.join(directory, "providers.json"),
    `${JSON.stringify({ credentials: { type: "credentials" } })}\n`
  );
  fs.writeFileSync(
    path.join(directory, "setup.json"),
    `${JSON.stringify({ exists: true, configured: true })}\n`
  );
  fs.writeFileSync(path.join(directory, "auth-admin.ok"), "");
  fs.writeFileSync(path.join(directory, "auth-researcher.ok"), "");
}

function runReport(
  directory: string,
  overrides: Record<string, string> = {}
) {
  const emptyProbePath = path.join(directory, "empty-probe-path");
  fs.mkdirSync(emptyProbePath, { recursive: true });

  return spawnSync(process.execPath, [reportScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      // The report assertions under test are based on the files above. Keep
      // unrelated host probes (notably runner-provided Conda environments)
      // deterministic and fast instead of exercising the CI machine itself.
      PATH: emptyProbePath,
      REVIEWER_OUTPUT_DIR: directory,
      REVIEWER_RESULT: "passed",
      REVIEWER_STAGE: "complete",
      REVIEWER_PIPELINE_SMOKE: "false",
      ...overrides,
    },
  });
}

function readReport(directory: string) {
  return JSON.parse(
    fs.readFileSync(path.join(directory, "compatibility.json"), "utf8")
  ) as Report;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("reviewer compatibility report", () => {
  it("reports PASS only when every required application assertion has evidence", () => {
    const directory = createOutputDir();
    writeRequiredApplicationEvidence(directory);

    const result = runReport(directory);
    const report = readReport(directory);

    expect(result.status).toBe(0);
    expect(report).toMatchObject({
      result: "passed",
      requestedResult: "passed",
      failureStage: "complete",
      evidence: {
        complete: true,
        failedRequiredAssertions: [],
      },
    });
    expect(report.evidence.requiredAssertions).not.toContain(
      "packagedFastqChecksum"
    );
    expect(report.evidence.requiredAssertions).toContain(
      "demoDataCliLifecycle"
    );
    expect(report.assertions.demoDataCliLifecycle).toBe(true);
    expect(
      fs.readFileSync(path.join(directory, "compatibility.md"), "utf8")
    ).toContain("Packaged demo-data CLI lifecycle | PASS");
  });

  it("turns a requested PASS into FAIL and exits non-zero when evidence is missing", () => {
    const directory = createOutputDir();
    writeRequiredApplicationEvidence(directory);
    fs.rmSync(path.join(directory, "auth-researcher.ok"));

    const result = runReport(directory);
    const report = readReport(directory);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "requested PASS without required evidence: researcherAuthentication"
    );
    expect(report).toMatchObject({
      result: "failed",
      requestedResult: "passed",
      failureStage: "validate-report-evidence",
      evidence: {
        complete: false,
        failedRequiredAssertions: ["researcherAuthentication"],
      },
    });
    expect(
      fs.readFileSync(path.join(directory, "compatibility.md"), "utf8")
    ).toContain("compatibility: FAIL");
  });

  it("rejects truthy lookalikes and directories as evidence", () => {
    const directory = createOutputDir();
    writeRequiredApplicationEvidence(directory);
    fs.writeFileSync(
      path.join(directory, "setup.json"),
      `${JSON.stringify({ exists: "true", configured: "true" })}\n`
    );
    fs.rmSync(path.join(directory, "auth-admin.ok"));
    fs.mkdirSync(path.join(directory, "auth-admin.ok"));

    const result = runReport(directory);
    const report = readReport(directory);

    expect(result.status).not.toBe(0);
    expect(report.assertions).toMatchObject({
      setupDatabaseExists: false,
      setupConfigured: false,
      adminAuthentication: false,
    });
    expect(report.evidence.failedRequiredAssertions).toEqual([
      "setupDatabaseExists",
      "setupConfigured",
      "adminAuthentication",
    ]);
  });

  it("requires the packaged checksum artifact only for the pipeline smoke", () => {
    const directory = createOutputDir();
    writeRequiredApplicationEvidence(directory);

    const missingResult = runReport(directory, {
      REVIEWER_PIPELINE_SMOKE: "true",
    });
    const missingReport = readReport(directory);

    expect(missingResult.status).not.toBe(0);
    expect(missingReport.evidence.failedRequiredAssertions).toEqual([
      "packagedFastqChecksum",
    ]);

    const checksum = path.join(
      directory,
      "fastq-checksum-output/checksum-output/summary/checksum-summary.tsv"
    );
    fs.mkdirSync(path.dirname(checksum), { recursive: true });
    fs.writeFileSync(checksum, "sample_id\tmd5\n");

    const passingResult = runReport(directory, {
      REVIEWER_PIPELINE_SMOKE: "true",
    });
    const passingReport = readReport(directory);

    expect(passingResult.status).toBe(0);
    expect(passingReport.result).toBe("passed");
    expect(passingReport.evidence).toMatchObject({
      complete: true,
      failedRequiredAssertions: [],
    });
    expect(passingReport.evidence.requiredAssertions).toContain(
      "packagedFastqChecksum"
    );
  });

  it("keeps an already failed smoke failed without replacing its failure stage", () => {
    const directory = createOutputDir();

    const result = runReport(directory, {
      REVIEWER_RESULT: "failed",
      REVIEWER_STAGE: "authenticate-seeded-users",
    });
    const report = readReport(directory);

    expect(result.status).toBe(0);
    expect(report).toMatchObject({
      result: "failed",
      requestedResult: "failed",
      failureStage: "authenticate-seeded-users",
      evidence: {
        complete: false,
      },
    });
  });

  it("makes a report failure override only a successful smoke exit", () => {
    const smokeSource = fs.readFileSync(smokeScript, "utf8");

    expect(smokeSource).toContain('local report_exit=0');
    expect(smokeSource).toContain(
      'node "$WORKSPACE/scripts/ci/write-reviewer-compatibility-report.mjs" || report_exit=$?'
    );
    expect(smokeSource).toContain(
      'if [ "$exit_code" -eq 0 ] && [ "$report_exit" -ne 0 ]; then'
    );
    expect(smokeSource).toContain('exit_code="$report_exit"');
    expect(smokeSource).toContain('exit "$exit_code"');
  });
});
