import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  assertExactNextflowRunTarget,
  assertChecksumVerificationCoverage,
  assertExactActiveRunAttributedReadCoverage,
  assertExactAttributedReadSampleCoverage,
  assertExactSampleCoverage,
  assertFastqcArtifactCoverage,
  assertFastqcHtmlInputFilename,
  assertFastqcInputEvidenceSnapshot,
  assertFastqChecksumSummaryRows,
  assertFastqcReportWritebackCoverage,
  assertFastqcSummaryRows,
  assertMultiqcFastqcCoverage,
  assertMultiqcNanoplotMetrics,
  assertNanoplotNanoStatsGroundTruth,
  assertNanoplotSummaryRows,
  assertPipelineExitMarker,
  assertReadsQcSummaryRows,
  assertReadsQcSampleArtifactRows,
  assertRequiredRelativeOutput,
  assertRunIdentity,
  assertRuntimeProofContracts,
  assertSampleBoundQcArtifactCoverage,
  assertSimulateReadsSummaryRows,
  assertStudyDemoSummaryRows,
  assertSlurmAccountingIdentity,
  assertSlurmAccountingRecord,
  assertSlurmCompletionAttestation,
  assertSlurmLaunchIdentity,
  createUniqueProofRecord,
  deriveMultiqcExpectedSamplesFromSourceInputs,
  expectedSeqDeskJobName,
  FASTQC_INPUT_EVIDENCE_BASENAME,
  parseNanoplotNanoStatsTsv,
  parsePrimarySacctRecord,
  parsePrimarySqueueRecord,
  parseNextflowRunTarget,
  parseSlurmCompletionAttestation,
  pathIsWithin,
  pathsReferToSameLocation,
  readCanonicalPipelineExit,
  resolveLocalManifestPipelineTarget,
  SLURM_PROOF_VISIBILITY_POLL_INTERVAL_MS,
  SLURM_PROOF_VISIBILITY_TIMEOUT_MS,
  slurmCompletionAttestationPath,
  stageFilesMissing,
  writeFastqcInputEvidenceSnapshotFile,
} from "./lib/pipeline-e2e-proof.mjs";

const runId = "cm-run_123";
const runFolder = "/shared/seqdesk/runs/cm-run_123";
const jobId = "4711";
const runtimeHarness = fs.readFileSync(
  path.join(process.cwd(), "scripts/run-pipeline-runtime-e2e.mjs"),
  "utf8",
);
const legacySlurmHarness = fs.readFileSync(
  path.join(process.cwd(), "scripts/run-slurm-pipeline-e2e.mjs"),
  "utf8",
);
const failureSlurmHarness = fs.readFileSync(
  path.join(process.cwd(), "scripts/run-slurm-failure-e2e.mjs"),
  "utf8",
);
const nanoplotWorkflow = fs.readFileSync(
  path.join(process.cwd(), "pipelines/nanoplot/workflow/main.nf"),
  "utf8",
);
const nanoplotSummaryBuilder = path.join(
  process.cwd(),
  "pipelines/nanoplot/workflow/bin/build_nanoplot_summary.py",
);
const studyDemoWorkflow = fs.readFileSync(
  path.join(process.cwd(), "pipelines/study-demo-report/workflow/main.nf"),
  "utf8",
);
const readsQcWorkflow = fs.readFileSync(
  path.join(process.cwd(), "pipelines/reads-qc/workflow/main.nf"),
  "utf8",
);
const readsQcReadme = fs.readFileSync(
  path.join(process.cwd(), "pipelines/reads-qc/README.md"),
  "utf8",
);
const readsQcE2e = fs.readFileSync(
  path.join(process.cwd(), "scripts/run-reads-qc-e2e.sh"),
  "utf8",
);
const fastqcHeader = [
  "sample_id",
  "r1_pass",
  "r1_warn",
  "r1_fail",
  "r1_read_count",
  "r1_avg_quality",
  "r2_pass",
  "r2_warn",
  "r2_fail",
  "r2_read_count",
  "r2_avg_quality",
];
const readsQcHeader = [
  "sample_id",
  "read_end",
  "num_reads",
  "total_bases",
  "min_len",
  "avg_len",
  "max_len",
  "avg_quality",
  "gc_content",
  "q20_pct",
  "q30_pct",
  "n50",
];
const simulateReadsHeader = [
  "sample_id",
  "mode",
  "simulation_mode_requested",
  "simulation_mode_used",
  "quality_profile",
  "insert_mean",
  "insert_std_dev",
  "seed",
  "template_label",
  "template_dir",
  "file1",
  "file2",
  "checksum1",
  "checksum2",
  "read_count1",
  "read_count2",
  "read_length",
];

function accountingLine({
  name = expectedSeqDeskJobName(runId),
  state = "COMPLETED",
  exitCode = "0:0",
  workDir = runFolder,
  nodeList = "compute-01",
} = {}) {
  return `${jobId}|${name}|${state}|${exitCode}|${workDir}|${nodeList}|\n`;
}

describe("pipeline E2E proof helpers", () => {
  it("binds fetched runs to the exact requested pipeline and target relation", () => {
    const orderRun = {
      id: "run-order",
      pipelineId: "fastqc",
      targetType: "order",
      orderId: "order-123",
      studyId: null,
      order: { id: "order-123" },
      study: null,
    };
    expect(
      assertRunIdentity({
        run: orderRun,
        pipelineId: "fastqc",
        targetType: "order",
        orderId: "order-123",
        studyId: null,
        context: "local completion",
      }),
    ).toMatchObject({
      runId: "run-order",
      pipelineId: "fastqc",
      targetType: "order",
      orderId: "order-123",
      studyId: null,
    });

    expect(
      assertRunIdentity({
        run: {
          id: "run-study",
          pipelineId: "reads-qc",
          targetType: "study",
          orderId: null,
          studyId: "study-456",
          order: null,
          study: { id: "study-456" },
        },
        pipelineId: "reads-qc",
        targetType: "study",
        orderId: null,
        studyId: "study-456",
        context: "study completion",
      }),
    ).toMatchObject({
      pipelineId: "reads-qc",
      targetType: "study",
      orderId: null,
      studyId: "study-456",
    });

    expect(() =>
      assertRunIdentity({
        run: orderRun,
        pipelineId: "nanoplot",
        targetType: "order",
        orderId: "order-123",
        studyId: null,
        context: "wrong pipeline",
      }),
    ).toThrow(/does not match the requested pipeline target/);
    expect(() =>
      assertRunIdentity({
        run: { ...orderRun, orderId: "order-wrong" },
        pipelineId: "fastqc",
        targetType: "order",
        orderId: "order-123",
        studyId: null,
        context: "wrong order",
      }),
    ).toThrow(/does not match the requested pipeline target/);
    expect(() =>
      assertRunIdentity({
        run: { ...orderRun, study: undefined },
        pipelineId: "fastqc",
        targetType: "order",
        orderId: "order-123",
        studyId: null,
        context: "missing study relation",
      }),
    ).toThrow(/does not match the requested pipeline target/);
  });

  it("checks run identity after both completion polling and writeback refetch", () => {
    const completionBlock = runtimeHarness.slice(
      runtimeHarness.indexOf("async function createAndStartRun"),
      runtimeHarness.indexOf("async function getPipelinePolicy"),
    );
    const writebackBlock = runtimeHarness.slice(
      runtimeHarness.indexOf("async function assertPipelineWriteback"),
      runtimeHarness.indexOf("async function assertReadCleaningIntegration"),
    );
    expect(completionBlock).toContain("assertRunIdentity({");
    expect(writebackBlock).toContain("assertRunIdentity({");
  });

  it("parses and canonically matches the exact generated Nextflow run target", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-target-proof-"));
    try {
      const runDirectory = path.join(root, "runs", "run-1");
      const expectedTarget = path.join(
        root,
        "packaged pipelines",
        "fastqc",
        "workflow",
      );
      const prefixCollision = `${expectedTarget}-backup`;
      fs.mkdirSync(runDirectory, { recursive: true });
      fs.mkdirSync(expectedTarget, { recursive: true });
      fs.mkdirSync(prefixCollision, { recursive: true });

      const validScript = `#!/bin/bash
# misleading sibling: ${prefixCollision}
"\${NEXTFLOW_RUNNER[@]}" run '${expectedTarget}' \\
  --input samplesheet.csv \\
  --outdir output
`;
      expect(parseNextflowRunTarget(validScript)).toBe(expectedTarget);
      expect(
        assertExactNextflowRunTarget({
          runScript: validScript,
          runFolder: runDirectory,
          expectedTarget,
          context: "fastqc local run",
        }),
      ).toMatchObject({
        parsedTarget: expectedTarget,
        expectedTarget,
      });

      const wrongScript = validScript.replace(
        `run '${expectedTarget}'`,
        `run '${prefixCollision}'`,
      );
      expect(() =>
        assertExactNextflowRunTarget({
          runScript: wrongScript,
          runFolder: runDirectory,
          expectedTarget,
          context: "fastqc local run",
        }),
      ).toThrow(/does not match the expected packaged workflow/);
      expect(() =>
        parseNextflowRunTarget(
          `${validScript}\n"\${NEXTFLOW_RUNNER[@]}" run '${expectedTarget}'\n`,
        ),
      ).toThrow(/expected exactly one NEXTFLOW_RUNNER run target/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("derives the exact local run target from each installed package manifest", () => {
    const pipelinesRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "seqdesk-manifest-target-"),
    );
    try {
      const packageRoot = path.join(pipelinesRoot, "store-fixture");
      const workflowFile = path.join(packageRoot, "workflow", "main.nf");
      fs.mkdirSync(path.dirname(workflowFile), { recursive: true });
      fs.writeFileSync(workflowFile, "nextflow.enable.dsl=2\n");
      const manifestPath = path.join(packageRoot, "manifest.json");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          package: { id: "store-fixture" },
          execution: { pipeline: "./workflow/main.nf" },
        }),
      );

      expect(
        resolveLocalManifestPipelineTarget({
          pipelinesRoot,
          pipelineId: "store-fixture",
          context: "installed store fixture",
        }),
      ).toMatchObject({
        packageRoot: fs.realpathSync(packageRoot),
        manifestPath: fs.realpathSync(manifestPath),
        configuredTarget: "./workflow/main.nf",
        expectedTarget: fs.realpathSync(workflowFile),
      });

      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          package: { id: "different-package" },
          execution: { pipeline: "./workflow/main.nf" },
        }),
      );
      expect(() =>
        resolveLocalManifestPipelineTarget({
          pipelinesRoot,
          pipelineId: "store-fixture",
          context: "mismatched package",
        }),
      ).toThrow(/package ID does not match/);

      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          package: { id: "store-fixture" },
          execution: { pipeline: "nf-core/remote" },
        }),
      );
      expect(() =>
        resolveLocalManifestPipelineTarget({
          pipelinesRoot,
          pipelineId: "store-fixture",
          context: "remote target",
        }),
      ).toThrow(/must be an explicit local relative path/);

      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          package: { id: "store-fixture" },
          execution: { pipeline: "../outside.nf" },
        }),
      );
      fs.writeFileSync(path.join(pipelinesRoot, "outside.nf"), "workflow{}\n");
      expect(() =>
        resolveLocalManifestPipelineTarget({
          pipelinesRoot,
          pipelineId: "store-fixture",
          context: "escaping target",
        }),
      ).toThrow(/escapes the package root/);
    } finally {
      fs.rmSync(pipelinesRoot, { recursive: true, force: true });
    }
  });

  it("binds a successful outer-wrapper attestation to run, job, and allocated host", () => {
    const contents = [
      "schema_version=1",
      `run_id=${runId}`,
      `slurm_job_id=${jobId}`,
      "host=compute-01.cluster.example",
      "phase=completed",
      "exit_code=0",
      "",
    ].join("\n");
    expect(parseSlurmCompletionAttestation(contents)).toMatchObject({
      schemaVersion: "1",
      runId,
      jobId,
      host: "compute-01.cluster.example",
      phase: "completed",
      exitCode: "0",
    });
    expect(
      assertSlurmCompletionAttestation({
        contents,
        runId,
        jobId,
        nodeHosts: ["compute-01"],
        context: "successful SLURM allocation",
      }),
    ).toMatchObject({
      runId,
      jobId,
      host: "compute-01.cluster.example",
      schedulerNodeHosts: ["compute-01"],
    });
    expect(slurmCompletionAttestationPath(runFolder, jobId)).toBe(
      `${runFolder}/logs/slurm-${jobId}.attestation`,
    );

    expect(() =>
      assertSlurmCompletionAttestation({
        contents: contents.replace("exit_code=0", "exit_code=17"),
        runId,
        jobId,
        nodeHosts: ["compute-01"],
        context: "failed SLURM allocation",
      }),
    ).toThrow(/does not prove successful completion/);
    expect(() =>
      assertSlurmCompletionAttestation({
        contents,
        runId,
        jobId: "9999",
        nodeHosts: ["compute-01"],
        context: "wrong SLURM job",
      }),
    ).toThrow(/does not prove successful completion/);
    expect(() =>
      assertSlurmCompletionAttestation({
        contents,
        runId,
        jobId,
        nodeHosts: ["compute-02"],
        context: "wrong scheduler node",
      }),
    ).toThrow(/not part of the scheduler allocation/);
    expect(() =>
      assertSlurmCompletionAttestation({
        contents,
        runId,
        jobId,
        nodeHosts: ["compute-01.other.example"],
        context: "wrong scheduler FQDN",
      }),
    ).toThrow(/not part of the scheduler allocation/);
    expect(() =>
      parseSlurmCompletionAttestation(
        `${contents}host=compute-01\n`,
      ),
    ).toThrow(/duplicate field host/);
  });

  it("requires causal attestation and capture evidence after SLURM accounting", () => {
    expect(SLURM_PROOF_VISIBILITY_TIMEOUT_MS).toBe(90_000);
    expect(SLURM_PROOF_VISIBILITY_POLL_INTERVAL_MS).toBe(1_000);
    for (const harness of [
      runtimeHarness,
      legacySlurmHarness,
      failureSlurmHarness,
    ]) {
      expect(harness).toContain("SLURM_PROOF_VISIBILITY_TIMEOUT_MS");
      expect(harness).toContain("SLURM_PROOF_VISIBILITY_POLL_INTERVAL_MS");
      expect(harness).toContain(
        "visibility timeout after accounting completed",
      );
      expect(harness).not.toContain("attempt < 30");
    }
    for (const harness of [runtimeHarness, legacySlurmHarness]) {
      expect(harness).toContain('["show", "hostnames", nodeList.trim()]');
      expect(harness).toContain("assertSlurmCompletionAttestation({");
      expect(harness).toContain("slurmCompletionAttestationPath(");
      expect(harness).not.toContain(
        "SLURM capture logs not visible after wait (non-fatal)",
      );
    }

    const runtimeAccounting = runtimeHarness.indexOf(
      "await assertSlurmAccounting({",
    );
    const runtimeAttestation = runtimeHarness.indexOf(
      "await assertSlurmCompletionProof({",
      runtimeAccounting,
    );
    expect(runtimeAccounting).toBeGreaterThanOrEqual(0);
    expect(runtimeAttestation).toBeGreaterThan(runtimeAccounting);

    const legacyAccounting = legacySlurmHarness.lastIndexOf(
      "await assertSuccessfulSlurmAccounting({",
    );
    const legacyAttestation = legacySlurmHarness.indexOf(
      "await assertSlurmCompletionProof({",
      legacyAccounting,
    );
    const legacyCaptureLogs = legacySlurmHarness.indexOf(
      "await assertSlurmLogs(",
      legacyAccounting,
    );
    expect(legacyAttestation).toBeGreaterThan(legacyAccounting);
    expect(legacyCaptureLogs).toBeGreaterThan(legacyAttestation);

    const failureAccounting = failureSlurmHarness.lastIndexOf(
      "await assertFailedSlurmAccounting({",
    );
    const failureCaptureLogs = failureSlurmHarness.indexOf(
      "await waitForRequiredRegularFiles(",
      failureAccounting,
    );
    const negativeAttestation = failureSlurmHarness.indexOf(
      "unexpectedly wrote a success attestation",
      failureAccounting,
    );
    expect(failureCaptureLogs).toBeGreaterThan(failureAccounting);
    expect(negativeAttestation).toBeGreaterThan(failureCaptureLogs);
    expect(failureSlurmHarness).toContain(
      "visibility timeout after accounting completed",
    );
    expect(failureSlurmHarness).toContain("successAttestationAbsent: true");
  });

  it("rejects duplicate proof declarations before JavaScript can overwrite them", () => {
    expect(() =>
      createUniqueProofRecord(
        [
          ["reads-qc", { kind: "artifacts" }],
          ["reads-qc", { kind: "completes" }],
        ],
        "Runtime writeback proof",
      ),
    ).toThrow(/duplicate key reads-qc/);
  });

  it("validates effective runtime writeback and content-marker contracts", () => {
    expect(
      assertRuntimeProofContracts({
        writebackSpec: {
          fastqc: {
            kind: "artifacts",
            requiredOutputIds: ["report", "data"],
          },
          checksum: { kind: "checksum" },
        },
        artifactContentMarkers: {
          fastqc: {
            report: {
              markers: ["fastqc"],
              label: "FastQC report",
            },
          },
        },
      }),
    ).toEqual({
      pipelineCount: 2,
      contentMarkerPipelineCount: 1,
    });
  });

  it("rejects an overwritten writeback declaration with no effective kind", () => {
    expect(() =>
      assertRuntimeProofContracts({
        writebackSpec: {
          "reads-qc": {
            sample_stats: {
              markers: ["sample_id"],
            },
          },
        },
        artifactContentMarkers: {},
      }),
    ).toThrow(/reads-qc has unsupported or missing kind/);
  });

  it("rejects content markers that do not match required artifact outputs", () => {
    expect(() =>
      assertRuntimeProofContracts({
        writebackSpec: {
          multiqc: {
            kind: "artifacts",
            requiredOutputIds: ["multiqc_report"],
          },
        },
        artifactContentMarkers: {
          multiqc: {
            unknown_output: {
              markers: ["multiqc"],
            },
          },
        },
      }),
    ).toThrow(/multiqc\/unknown_output is not a declared required artifact/);
  });

  it("selects the exact top-level sacct row instead of a similarly prefixed step", () => {
    const record = parsePrimarySacctRecord(
      `4711.batch|batch|COMPLETED|0:0|${runFolder}|compute-01|\n${accountingLine()}`,
      jobId,
    );

    expect(record).toMatchObject({
      jobId,
      jobName: expectedSeqDeskJobName(runId),
      state: "COMPLETED",
      exitCode: "0:0",
    });
  });

  it("parses live squeue identity for a pending held cancellation target", () => {
    expect(
      parsePrimarySqueueRecord(
        `${jobId}|${expectedSeqDeskJobName(runId)}|PENDING|${runFolder}|(null)\n`,
        jobId,
      ),
    ).toMatchObject({
      jobId,
      jobName: expectedSeqDeskJobName(runId),
      state: "PENDING",
      workDir: runFolder,
    });
  });

  it("accepts a successful allocation only with exact identity, workdir, exit and node", () => {
    const record = parsePrimarySacctRecord(accountingLine(), jobId);

    expect(
      assertSlurmAccountingRecord(record, {
        runId,
        jobId,
        runFolder,
        expectedOutcome: "success",
      }),
    ).toEqual(record);
  });

  it("rejects a missing primary scheduler record with useful run context", () => {
    expect(() =>
      assertSlurmAccountingIdentity(null, { runId, jobId, runFolder }),
    ).toThrow(/no primary record for job 4711/);
  });

  it.each([
    ["wrong job name", { name: "seqdesk-another-run" }, /exact PipelineRun identity/],
    ["outside workdir", { workDir: "/shared/seqdesk/runs/another-run" }, /outside the PipelineRun folder/],
    ["nested workdir", { workDir: `${runFolder}/nested` }, /exact canonical path/],
    ["non-zero success exit", { exitCode: "1:0" }, /non-zero allocation exit/],
    ["missing node", { nodeList: "None assigned" }, /allocated compute node/],
  ])("rejects %s as success proof", (_label, overrides, pattern) => {
    const record = parsePrimarySacctRecord(accountingLine(overrides), jobId);

    expect(() =>
      assertSlurmAccountingRecord(record, {
        runId,
        jobId,
        runFolder,
        expectedOutcome: "success",
      }),
    ).toThrow(pattern);
  });

  it("requires a non-zero scheduler exit for the deliberate failure proof", () => {
    const failed = parsePrimarySacctRecord(
      accountingLine({ state: "FAILED", exitCode: "17:0" }),
      jobId,
    );
    const falseFailure = parsePrimarySacctRecord(
      accountingLine({ state: "FAILED", exitCode: "0:0" }),
      jobId,
    );

    expect(
      assertSlurmAccountingRecord(failed, {
        runId,
        jobId,
        runFolder,
        expectedOutcome: "failure",
        requireAllocatedNode: false,
      }),
    ).toEqual(failed);
    expect(() =>
      assertSlurmAccountingRecord(falseFailure, {
        runId,
        jobId,
        runFolder,
        expectedOutcome: "failure",
        requireAllocatedNode: false,
      }),
    ).toThrow(/non-zero SLURM allocation exit/);
  });

  it("proves exact accounting identity before accepting cancellation", () => {
    const cancelled = parsePrimarySacctRecord(
      accountingLine({
        state: "CANCELLED by 1000",
        exitCode: "0:15",
        nodeList: "None assigned",
      }),
      jobId,
    );

    expect(
      assertSlurmAccountingIdentity(cancelled, { runId, jobId, runFolder }),
    ).toEqual(cancelled);
    expect(
      assertSlurmAccountingRecord(cancelled, {
        runId,
        jobId,
        runFolder,
        expectedOutcome: "cancelled",
        requireAllocatedNode: false,
      }),
    ).toEqual(cancelled);
  });

  it("requires start response, DB mode, queue id and absolute run folder to agree", () => {
    expect(
      assertSlurmLaunchIdentity({
        runId,
        jobId,
        startPayload: { executionMode: "slurm", jobId },
        run: { executionMode: "slurm", queueJobId: jobId, runFolder },
      }),
    ).toEqual({
      jobId,
      runFolder,
      expectedJobName: expectedSeqDeskJobName(runId),
    });

    expect(() =>
      assertSlurmLaunchIdentity({
        runId,
        jobId,
        startPayload: { executionMode: "local", jobId },
        run: { executionMode: "slurm", queueJobId: jobId, runFolder },
      }),
    ).toThrow(/start response.*executionMode=slurm/i);
    expect(() =>
      assertSlurmLaunchIdentity({
        runId,
        jobId,
        startPayload: { executionMode: "slurm", jobId },
        run: { executionMode: "slurm", queueJobId: "9999", runFolder },
      }),
    ).toThrow(/queueJobId does not match/);
  });

  it("uses the last canonical wrapper marker and distinguishes success from failure", () => {
    const log = [
      "irrelevant exit code 99",
      "Pipeline completed with exit code: 7 at yesterday",
      "retry",
      "Pipeline completed with exit code: 0 at today",
    ].join("\n");

    expect(readCanonicalPipelineExit(log)).toBe(0);
    expect(
      assertPipelineExitMarker(log, {
        expectedOutcome: "success",
        context: "runtime",
      }),
    ).toBe(0);
    expect(() =>
      assertPipelineExitMarker(log, {
        expectedOutcome: "failure",
        context: "failure",
      }),
    ).toThrow(/exited 0/);
  });

  it("does not treat sibling run folders as descendants", () => {
    expect(pathIsWithin(`${runFolder}/logs`, runFolder)).toBe(true);
    expect(pathIsWithin(`${runFolder}-other`, runFolder)).toBe(false);
  });

  it("matches an exact scheduler WorkDir across a real run-root symlink", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-e2e-proof-"));
    try {
      const physicalRoot = path.join(root, "physical");
      const configuredRoot = path.join(root, "configured");
      const physicalRunFolder = path.join(physicalRoot, runId);
      fs.mkdirSync(physicalRunFolder, { recursive: true });
      fs.symlinkSync(physicalRoot, configuredRoot, "dir");
      const configuredRunFolder = path.join(configuredRoot, runId);

      expect(
        pathsReferToSameLocation(physicalRunFolder, configuredRunFolder),
      ).toBe(true);
      expect(
        assertSlurmAccountingIdentity(
          {
            jobId,
            jobName: expectedSeqDeskJobName(runId),
            state: "COMPLETED",
            rawState: "COMPLETED",
            exitCode: "0:0",
            workDir: physicalRunFolder,
            nodeList: "compute-01",
          },
          { runId, jobId, runFolder: configuredRunFolder },
        ),
      ).toMatchObject({ workDir: physicalRunFolder });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires output coverage for every target sample exactly once", () => {
    expect(
      assertExactSampleCoverage({
        expectedSampleIds: ["S1", "S2"],
        observedSampleIds: ["S2", "S1"],
        context: "pipeline",
      }),
    ).toMatchObject({ expectedSampleCount: 2, observedSampleCount: 2 });
    expect(() =>
      assertExactSampleCoverage({
        expectedSampleIds: ["S1", "S2"],
        observedSampleIds: ["S1"],
        context: "pipeline",
      }),
    ).toThrow(/every target sample exactly once/);
    expect(() =>
      assertExactSampleCoverage({
        expectedSampleIds: ["S1", "S2"],
        observedSampleIds: ["S1", "S1"],
        context: "pipeline",
      }),
    ).toThrow(/every target sample exactly once/);
  });

  it.each([
    ["empty observed ID", ["S1", ""]],
    ["blank observed ID", ["S1", "   "]],
    ["missing observed ID", ["S1", undefined]],
  ])("rejects an %s instead of filtering it out", (_label, observedSampleIds) => {
    expect(() =>
      assertExactSampleCoverage({
        expectedSampleIds: ["S1"],
        observedSampleIds,
        context: "pipeline",
      }),
    ).toThrow(/every target sample exactly once/);
  });

  it("rejects invalid expected IDs instead of silently shrinking the target set", () => {
    expect(() =>
      assertExactSampleCoverage({
        expectedSampleIds: ["S1", ""],
        observedSampleIds: ["S1"],
        context: "pipeline",
      }),
    ).toThrow(/every target sample exactly once/);
  });

  it("does not deduplicate attributed REPLACE reads before sample coverage", () => {
    expect(() =>
      assertExactAttributedReadSampleCoverage({
        expectedSampleIds: ["S1", "S2"],
        attributedReads: [
          { id: "read-1", sampleId: "S1" },
          { id: "read-2", sampleId: "S1" },
        ],
        context: "simulate-reads REPLACE writeback",
      }),
    ).toThrow(/every target sample exactly once/);

    expect(() =>
      assertExactAttributedReadSampleCoverage({
        expectedSampleIds: ["S1", "S2"],
        attributedReads: [{ id: "read-1", sampleId: "S1" }],
        context: "simulate-reads REPLACE writeback",
      }),
    ).toThrow(/every target sample exactly once/);

    expect(
      assertExactAttributedReadSampleCoverage({
        expectedSampleIds: ["S1", "S2"],
        attributedReads: [
          { id: "read-1", sampleId: "S2" },
          { id: "read-2", sampleId: "S1" },
        ],
        context: "simulate-reads REPLACE writeback",
      }),
    ).toMatchObject({ expectedSampleCount: 2, observedSampleCount: 2 });
  });

  it("requires exactly one active Read from the current simulation run per sample", () => {
    const currentReads = [
      { id: "read-1", sampleId: "S1", pipelineRunId: runId },
      { id: "read-2", sampleId: "S2", pipelineRunId: runId },
    ];
    expect(
      assertExactActiveRunAttributedReadCoverage({
        expectedSampleIds: ["S1", "S2"],
        activeReads: currentReads,
        runId,
        context: "simulate-reads REPLACE writeback",
      }),
    ).toMatchObject({ expectedSampleCount: 2, observedSampleCount: 2 });

    expect(() =>
      assertExactActiveRunAttributedReadCoverage({
        expectedSampleIds: ["S1", "S2"],
        activeReads: [
          ...currentReads,
          { id: "stale-read", sampleId: "S1", pipelineRunId: "older-run" },
        ],
        runId,
        context: "simulate-reads REPLACE writeback",
      }),
    ).toThrow(/every active Read must be attributed/);
    expect(() =>
      assertExactActiveRunAttributedReadCoverage({
        expectedSampleIds: ["S1", "S2"],
        activeReads: [
          currentReads[0],
          { id: "read-duplicate", sampleId: "S1", pipelineRunId: runId },
        ],
        runId,
        context: "simulate-reads REPLACE writeback",
      }),
    ).toThrow(/every target sample exactly once/);
  });

  it("keeps both REPLACE harnesses wired to raw per-read coverage", () => {
    expect(runtimeHarness).toMatch(
      /assertExactActiveRunAttributedReadCoverage\(\{\s*expectedSampleIds,\s*activeReads: reads,\s*runId,/,
    );
    expect(legacySlurmHarness).toMatch(
      /assertExactAttributedReadSampleCoverage\(\{\s*expectedSampleIds,\s*attributedReads,/,
    );
    expect(runtimeHarness).not.toMatch(/new Set\(\s*reads\.map\(\(read\) => read\.sampleId\)/);
    expect(legacySlurmHarness).not.toMatch(
      /new Set\(\s*attributedReads\.map\(\(read\) => read\.sampleId\)/,
    );
  });

  it("proves exact FastQC sample coverage and rigorous paired/single-end metrics", () => {
    expect(
      assertFastqcSummaryRows({
        header: fastqcHeader,
        rows: [
          ["S2", "7", "2", "1", "4", "35.5", "", "", "", "", ""],
          ["S1", "8", "1", "1", "4", "36.5", "7", "2", "1", "4", "34.5"],
        ],
        expectedSamples: [
          {
            sampleId: "S1",
            pairedEnd: true,
            readMetrics: {
              readCount1: 4,
              avgQuality1: 36.5,
              readCount2: 4,
              avgQuality2: 34.5,
            },
          },
          {
            sampleId: "S2",
            pairedEnd: false,
            readMetrics: {
              readCount1: 4,
              avgQuality1: 35.5,
            },
          },
        ],
        groundTruthByIdentity: undefined,
        requireBalancedPairs: true,
        context: "FastQC fixture",
      }),
    ).toMatchObject({
      expectedSampleCount: 2,
      observedSampleCount: 2,
      pairedSamples: 1,
      singleEndSamples: 1,
      checkedRows: 2,
      requireBalancedPairs: true,
    });
  });

  it("binds FastQC summary quality to the ZIP and exact integer-binned raw FASTQ value", () => {
    const expectedSamples = [
      {
        sampleId: "S1",
        pairedEnd: false,
        readMetrics: { readCount1: 10, avgQuality1: 34.8 },
      },
    ];
    const groundTruth = {
      "S1/R1": {
        readCount: 10,
        inputBasename: "S1_R1.fastq.gz",
        fastqcMeanSequenceQuality: 34.8,
        fastqcMeanSequenceQualityByOffset: {
          33: 34.8,
          64: 3.8,
        },
        fastqcData: {
          filename: "S1_R1.fastq.gz",
          totalSequences: 10,
          encoding: "Sanger / Illumina 1.9",
          qualityOffset: 33,
          meanSequenceQualityNumerator: 348,
          meanSequenceQualityDenominator: 10,
          meanSequenceQuality: 34.8,
        },
      },
    };
    const row = ["S1", "8", "1", "1", "10", "34.8", "", "", "", "", ""];

    expect(
      assertFastqcSummaryRows({
        header: fastqcHeader,
        rows: [row],
        expectedSamples,
        groundTruthByIdentity: groundTruth,
        context: "FastQC raw proof",
      }),
    ).toMatchObject({ groundTruthChecked: true, checkedRows: 1 });

    const halfEvenFastqc = {
      expectedSamples: [
        {
          sampleId: "HALF",
          pairedEnd: false,
          readMetrics: { readCount1: 4, avgQuality1: 2.2 },
        },
      ],
      groundTruthByIdentity: {
        "HALF/R1": {
          readCount: 4,
          inputBasename: "HALF_R1.fastq",
          fastqcMeanSequenceQualityByOffset: {
            33: 2.25,
            64: null,
          },
          fastqcData: {
            filename: "HALF_R1.fastq",
            totalSequences: 4,
            encoding: "Sanger / Illumina 1.9",
            qualityOffset: 33,
            meanSequenceQualityNumerator: 9,
            meanSequenceQualityDenominator: 4,
            meanSequenceQuality: 2.25,
          },
        },
      },
    };
    expect(
      assertFastqcSummaryRows({
        header: fastqcHeader,
        rows: [
          ["HALF", "1", "0", "0", "4", "2.2", "", "", "", "", ""],
        ],
        ...halfEvenFastqc,
        context: "FastQC half-even ground truth",
      }),
    ).toMatchObject({ groundTruthChecked: true });
    expect(() =>
      assertFastqcSummaryRows({
        header: fastqcHeader,
        rows: [
          ["HALF", "1", "0", "0", "4", "2.3", "", "", "", "", ""],
        ],
        expectedSamples: [
          {
            ...halfEvenFastqc.expectedSamples[0],
            readMetrics: { readCount1: 4, avgQuality1: 2.3 },
          },
        ],
        groundTruthByIdentity: halfEvenFastqc.groundTruthByIdentity,
        context: "FastQC half-even ground truth",
      }),
    ).toThrow(/fixed-precision FASTQ ground truth/);

    const binary64BoundaryFastqc = {
      expectedSamples: [
        {
          sampleId: "BINARY",
          pairedEnd: false,
          readMetrics: { readCount1: 20, avgQuality1: 1.1 },
        },
      ],
      groundTruthByIdentity: {
        "BINARY/R1": {
          readCount: 20,
          inputBasename: "BINARY_R1.fastq",
          fastqcMeanSequenceQualityByOffset: {
            33: 23 / 20,
            64: null,
          },
          fastqcData: {
            filename: "BINARY_R1.fastq",
            totalSequences: 20,
            encoding: "Sanger / Illumina 1.9",
            qualityOffset: 33,
            meanSequenceQualityNumerator: 23,
            meanSequenceQualityDenominator: 20,
            meanSequenceQuality: 23 / 20,
          },
        },
      },
    };
    expect(
      assertFastqcSummaryRows({
        header: fastqcHeader,
        rows: [
          ["BINARY", "1", "0", "0", "20", "1.1", "", "", "", "", ""],
        ],
        ...binary64BoundaryFastqc,
        context: "FastQC binary64 awk rounding ground truth",
      }),
    ).toMatchObject({ groundTruthChecked: true });
    expect(() =>
      assertFastqcSummaryRows({
        header: fastqcHeader,
        rows: [
          ["BINARY", "1", "0", "0", "20", "1.2", "", "", "", "", ""],
        ],
        expectedSamples: [
          {
            ...binary64BoundaryFastqc.expectedSamples[0],
            readMetrics: { readCount1: 20, avgQuality1: 1.2 },
          },
        ],
        groundTruthByIdentity:
          binary64BoundaryFastqc.groundTruthByIdentity,
        context: "FastQC exact-ratio false oracle regression",
      }),
    ).toThrow(/fixed-precision FASTQ ground truth/);

    expect(
      assertFastqcSummaryRows({
        header: fastqcHeader,
        rows: [
          ["Q0", "1", "0", "0", "1", "0.0", "", "", "", "", ""],
        ],
        expectedSamples: [
          {
            sampleId: "Q0",
            pairedEnd: false,
            readMetrics: { readCount1: 1, avgQuality1: 0 },
          },
        ],
        groundTruthByIdentity: {
          "Q0/R1": {
            readCount: 1,
            inputBasename: "Q0_R1.fastq",
            fastqcMeanSequenceQualityByOffset: {
              33: 0,
              64: null,
            },
            fastqcData: {
              filename: "Q0_R1.fastq",
              totalSequences: 1,
              encoding: "Sanger / Illumina 1.9",
              qualityOffset: 33,
              meanSequenceQualityNumerator: 0,
              meanSequenceQualityDenominator: 1,
              meanSequenceQuality: 0,
            },
          },
        },
        context: "FastQC valid Q0 ground truth",
      }),
    ).toMatchObject({ groundTruthChecked: true, checkedRows: 1 });

    expect(() =>
      assertFastqcSummaryRows({
        header: fastqcHeader,
        rows: [[...row.slice(0, 5), "35", ...row.slice(6)]],
        expectedSamples: [
          {
            ...expectedSamples[0],
            readMetrics: { readCount1: 10, avgQuality1: 35 },
          },
        ],
        groundTruthByIdentity: groundTruth,
        context: "FastQC raw proof",
      }),
    ).toThrow(/fixed-precision FASTQ ground truth/);
    expect(() =>
      assertFastqcSummaryRows({
        header: fastqcHeader,
        rows: [row],
        expectedSamples,
        groundTruthByIdentity: {
          "S1/R1": {
            ...groundTruth["S1/R1"],
            fastqcMeanSequenceQualityByOffset: {
              33: 34.7,
              64: 3.8,
            },
          },
        },
        context: "FastQC raw proof",
      }),
    ).toThrow(/integer-binned mean quality/);
    expect(() =>
      assertFastqcSummaryRows({
        header: fastqcHeader,
        rows: [row],
        expectedSamples,
        groundTruthByIdentity: {
          "S1/R1": {
            ...groundTruth["S1/R1"],
            inputBasename: "different.fastq.gz",
          },
        },
        context: "FastQC raw proof",
      }),
    ).toThrow(/Filename does not match/);

    expect(
      assertFastqcSummaryRows({
        header: fastqcHeader,
        rows: [["S1", "8", "1", "1", "10", "62.0", "", "", "", "", ""]],
        expectedSamples: [
          {
            sampleId: "S1",
            pairedEnd: false,
            readMetrics: { readCount1: 10, avgQuality1: 62 },
          },
        ],
        groundTruthByIdentity: {
          "S1/R1": {
            readCount: 10,
            inputBasename: "S1_R1.fastq.gz",
            fastqcMeanSequenceQualityByOffset: {
              33: 93,
              64: 62,
            },
            fastqcData: {
              filename: "S1_R1.fastq.gz",
              totalSequences: 10,
              encoding: "Illumina 1.5",
              qualityOffset: 64,
              meanSequenceQualityNumerator: 620,
              meanSequenceQualityDenominator: 10,
              meanSequenceQuality: 62,
            },
          },
        },
        context: "FastQC offset-64 raw proof",
      }),
    ).toMatchObject({ groundTruthChecked: true, checkedRows: 1 });
  });

  it("rejects missing, duplicate and unexpected FastQC sample rows", () => {
    const expectedSamples = [
      { sampleId: "S1", pairedEnd: false },
      { sampleId: "S2", pairedEnd: false },
    ];
    const row = ["S1", "8", "1", "1", "4", "36.5", "", "", "", "", ""];

    expect(() =>
      assertFastqcSummaryRows({
        header: fastqcHeader,
        rows: [row],
        expectedSamples,
        groundTruthByIdentity: undefined,
        context: "FastQC fixture",
      }),
    ).toThrow(/every target sample exactly once/);
    expect(() =>
      assertFastqcSummaryRows({
        header: fastqcHeader,
        rows: [row, row],
        expectedSamples,
        groundTruthByIdentity: undefined,
        context: "FastQC fixture",
      }),
    ).toThrow(/every target sample exactly once/);
    expect(() =>
      assertFastqcSummaryRows({
        header: fastqcHeader,
        rows: [
          row,
          ["S3", "8", "1", "1", "4", "36.5", "", "", "", "", ""],
        ],
        expectedSamples,
        groundTruthByIdentity: undefined,
        context: "FastQC fixture",
      }),
    ).toThrow(/every target sample exactly once/);
  });

  it("rejects incomplete, unbalanced, stale or non-written-back FastQC pair metrics", () => {
    const verifyPair = (
      row: string[],
      options: { pairedEnd?: boolean; requireBalancedPairs?: boolean } = {},
    ) =>
      assertFastqcSummaryRows({
        header: fastqcHeader,
        rows: [row],
        expectedSamples: [
          {
            sampleId: "S1",
            pairedEnd: options.pairedEnd ?? true,
            readMetrics: {
              readCount1: 4,
              avgQuality1: 36.5,
              readCount2: 4,
              avgQuality2: 34.5,
            },
          },
        ],
        groundTruthByIdentity: undefined,
        requireBalancedPairs: options.requireBalancedPairs ?? false,
        context: "FastQC fixture",
      });

    expect(() =>
      verifyPair([
        "S1",
        "8",
        "1",
        "1",
        "4",
        "36.5",
        "7",
        "2",
        "1",
        "",
        "34.5",
      ]),
    ).toThrow(/r2_read_count is not an integer/);
    expect(() =>
      verifyPair(
        ["S1", "8", "1", "1", "4", "36.5", "7", "2", "1", "3", "34.5"],
        { requireBalancedPairs: true },
      ),
    ).toThrow(/unequal R1\/R2 counts/);
    expect(() =>
      verifyPair(
        ["S1", "8", "1", "1", "4", "36.5", "7", "2", "1", "4", "34.5"],
        { pairedEnd: false },
      ),
    ).toThrow(/single-end sample S1 unexpectedly has R2 metrics/);
    expect(() =>
      verifyPair([
        "S1",
        "8",
        "1",
        "1",
        "5",
        "36.5",
        "7",
        "2",
        "1",
        "4",
        "34.5",
      ]),
    ).toThrow(/does not match the Read writeback/);
  });

  it("requires exactly one persisted FastQC HTML and ZIP per sample mate", () => {
    const expectedSamples = [
      {
        sampleId: "S1",
        sampleRecordId: "sample-1",
        file1: "/reads/S1_R1.fastq.gz",
        file2: "/reads/S1_R2.fastq.gz",
      },
      {
        sampleId: "S2",
        sampleRecordId: "sample-2",
        file1: "/reads/S2.fastq.gz",
        file2: null,
      },
    ];
    const artifacts = [
      ["sample_qc_reports", "sample-1", "/run/S1_R1_fastqc.html"],
      ["sample_qc_data", "sample-1", "/run/S1_R1_fastqc.zip"],
      ["sample_qc_reports", "sample-1", "/run/S1_R2_fastqc.html"],
      ["sample_qc_data", "sample-1", "/run/S1_R2_fastqc.zip"],
      ["sample_qc_reports", "sample-2", "/run/S2_R1_fastqc.html"],
      ["sample_qc_data", "sample-2", "/run/S2_R1_fastqc.zip"],
    ].map(([outputId, sampleId, artifactPath], index) => ({
      id: `artifact-${index}`,
      outputId,
      sampleId,
      path: artifactPath,
    }));

    expect(
      assertFastqcArtifactCoverage({
        artifacts,
        expectedSamples,
        context: "FastQC fixture",
      }),
    ).toEqual({
      expectedSampleMates: 3,
      expectedArtifacts: 6,
      persistedArtifacts: 6,
    });

    expect(() =>
      assertFastqcArtifactCoverage({
        artifacts: artifacts.slice(0, -1),
        expectedSamples,
        context: "FastQC fixture",
      }),
    ).toThrow(/persisted HTML\/ZIP artifact coverage/);
    expect(() =>
      assertFastqcArtifactCoverage({
        artifacts: [...artifacts, artifacts[0]],
        expectedSamples,
        context: "FastQC fixture",
      }),
    ).toThrow(/persisted HTML\/ZIP artifact coverage/);
    expect(() =>
      assertFastqcArtifactCoverage({
        artifacts: [{ ...artifacts[0], sampleId: "sample-2" }, ...artifacts.slice(1)],
        expectedSamples,
        context: "FastQC fixture",
      }),
    ).toThrow(/points at the wrong sample/);
  });

  it("binds FastQC Read report writeback to the exact persisted HTML artifact", () => {
    const r1Path = "/run/fastqc_reports/S1_R1_fastqc.html";
    const r2Path = "/run/fastqc_reports/S1_R2_fastqc.html";
    const singlePath = "/run/fastqc_reports/S2_R1_fastqc.html";
    const expectedSamples = [
      {
        sampleId: "S1",
        sampleRecordId: "sample-1",
        file1: "/reads/S1_R1.fastq.gz",
        file2: "/reads/S1_R2.fastq.gz",
        fastqcReport1: r1Path,
        fastqcReport2: r2Path,
      },
      {
        sampleId: "S2",
        sampleRecordId: "sample-2",
        file1: "/reads/S2.fastq.gz",
        file2: null,
        fastqcReport1: singlePath,
        fastqcReport2: null,
      },
    ];
    const reports = [
      {
        id: "report-1",
        outputId: "sample_qc_reports",
        sampleId: "sample-1",
        path: r1Path,
      },
      {
        id: "report-2",
        outputId: "sample_qc_reports",
        sampleId: "sample-1",
        path: r2Path,
      },
      {
        id: "report-3",
        outputId: "sample_qc_reports",
        sampleId: "sample-2",
        path: singlePath,
      },
      {
        id: "zip-1",
        outputId: "sample_qc_data",
        sampleId: "sample-1",
        path: "/run/fastqc_reports/S1_R1_fastqc.zip",
      },
    ];
    const verify = (
      samples: Array<Record<string, unknown>> = expectedSamples,
      artifacts: Array<Record<string, unknown>> = reports,
    ) =>
      assertFastqcReportWritebackCoverage({
        artifacts,
        expectedSamples: samples,
        context: "FastQC fixture",
      });

    expect(verify()).toEqual({
      expectedSampleMates: 3,
      persistedHtmlReports: 3,
      boundReadWritebacks: 3,
      pairedSamples: 1,
      singleEndSamples: 1,
    });
    expect(
      verify([
        expectedSamples[0],
        { ...expectedSamples[1], fastqcReport2: "   " },
      ]),
    ).toMatchObject({ singleEndSamples: 1 });

    expect(() =>
      verify([{ ...expectedSamples[0], fastqcReport1: null }, expectedSamples[1]]),
    ).toThrow(/fastqcReport1 does not match/);
    expect(() =>
      verify([{ ...expectedSamples[0], fastqcReport2: null }, expectedSamples[1]]),
    ).toThrow(/fastqcReport2 does not match/);
    expect(() =>
      verify([
        expectedSamples[0],
        { ...expectedSamples[1], fastqcReport2: r2Path },
      ]),
    ).toThrow(/single-end sample S2 has a non-empty fastqcReport2/);
    expect(() =>
      verify([
        {
          ...expectedSamples[0],
          fastqcReport1: r2Path,
          fastqcReport2: r1Path,
        },
        expectedSamples[1],
      ]),
    ).toThrow(/does not match the persisted HTML artifact/);

    expect(() =>
      verify(
        expectedSamples,
        reports.map((report, index) =>
          index === 0 ? { ...report, sampleId: "sample-2" } : report,
        ),
      ),
    ).toThrow(/points at the wrong sample/);
    expect(() => verify(expectedSamples, reports.slice(0, 2))).toThrow(
      /every target sample\/mate report exactly once/,
    );
    expect(() =>
      verify(expectedSamples, [...reports, reports[0]]),
    ).toThrow(/every target sample\/mate report exactly once/);
    expect(() =>
      verify(expectedSamples, [
        ...reports,
        {
          id: "report-extra",
          outputId: "sample_qc_reports",
          sampleId: "sample-2",
          path: "/run/fastqc_reports/S2_R2_fastqc.html",
        },
      ]),
    ).toThrow(/persisted FastQC HTML artifact is unexpected/);
  });

  it("binds FastQC HTML Basic Statistics to the exact escaped input basename", () => {
    const report = (filenameCell: string) =>
      `<html><head><title>decoy.fastq FastQC Report</title></head>` +
      `<body><table><tr><td>Filename</td><td>${filenameCell}</td></tr></table></body></html>`;
    expect(
      assertFastqcHtmlInputFilename({
        html: report("A&amp;B&lt;1&gt;_R1.fastq.gz"),
        expectedInputBasename: "A&B<1>_R1.fastq.gz",
        context: "FastQC HTML fixture",
      }),
    ).toEqual({
      observedInputBasename: "A&B<1>_R1.fastq.gz",
    });
    expect(() =>
      assertFastqcHtmlInputFilename({
        html: report("S2_R1.fastq.gz"),
        expectedInputBasename: "S1_R1.fastq.gz",
        context: "FastQC HTML fixture",
      }),
    ).toThrow(/does not match the exact raw input basename/);
    expect(() =>
      assertFastqcHtmlInputFilename({
        html:
          report("S1_R1.fastq.gz") +
          "<tr><td>Filename</td><td>S2_R1.fastq.gz</td></tr>",
        expectedInputBasename: "S1_R1.fastq.gz",
        context: "FastQC HTML fixture",
      }),
    ).toThrow(/exactly one Basic Statistics Filename row/);
    expect(() =>
      assertFastqcHtmlInputFilename({
        html: report("S1_R1.fastq.gz<em>decoy</em>"),
        expectedInputBasename: "S1_R1.fastq.gz",
        context: "FastQC HTML fixture",
      }),
    ).toThrow(/exactly one Basic Statistics Filename row/);
    expect(() =>
      assertFastqcHtmlInputFilename({
        html: report("S1&ampbroken;_R1.fastq.gz"),
        expectedInputBasename: "S1&broken;_R1.fastq.gz",
        context: "FastQC HTML fixture",
      }),
    ).toThrow(/invalid XML entity/);
  });

  it("binds every NanoPlot and reads-QC sample artifact to the exact sample FK", () => {
    const expectedSamples = [
      { sampleId: "S1", sampleRecordId: "sample-1" },
      { sampleId: "S2", sampleRecordId: "sample-2" },
    ];
    const nanoplotArtifacts = [
      {
        outputId: "sample_report",
        sampleId: "sample-1",
        path: "/run/nanoplot/S1_NanoPlot-report.html",
      },
      {
        outputId: "sample_stats",
        sampleId: "sample-1",
        path: "/run/nanoplot/S1_NanoStats.txt",
      },
      {
        outputId: "sample_report",
        sampleId: "sample-2",
        path: "/run/nanoplot/S2_NanoPlot-report.html",
      },
      {
        outputId: "sample_stats",
        sampleId: "sample-2",
        path: "/run/nanoplot/S2_NanoStats.txt",
      },
    ];

    expect(
      assertSampleBoundQcArtifactCoverage({
        pipelineId: "nanoplot",
        artifacts: nanoplotArtifacts,
        expectedSamples,
        context: "NanoPlot fixture",
      }),
    ).toEqual({
      pipelineId: "nanoplot",
      expectedArtifacts: 4,
      persistedArtifacts: 4,
      expectedSamples: 2,
    });
    expect(() =>
      assertSampleBoundQcArtifactCoverage({
        pipelineId: "nanoplot",
        artifacts: nanoplotArtifacts.slice(0, -1),
        expectedSamples,
        context: "NanoPlot fixture",
      }),
    ).toThrow(/every target sample\/output artifact exactly once/);
    expect(() =>
      assertSampleBoundQcArtifactCoverage({
        pipelineId: "nanoplot",
        artifacts: [...nanoplotArtifacts, nanoplotArtifacts[0]],
        expectedSamples,
        context: "NanoPlot fixture",
      }),
    ).toThrow(/every target sample\/output artifact exactly once/);
    expect(() =>
      assertSampleBoundQcArtifactCoverage({
        pipelineId: "nanoplot",
        artifacts: [
          { ...nanoplotArtifacts[0], sampleId: "sample-2" },
          ...nanoplotArtifacts.slice(1),
        ],
        expectedSamples,
        context: "NanoPlot fixture",
      }),
    ).toThrow(/wrong persisted sample/);
    expect(() =>
      assertSampleBoundQcArtifactCoverage({
        pipelineId: "nanoplot",
        artifacts: [
          ...nanoplotArtifacts,
          {
            outputId: "sample_stats",
            sampleId: "sample-1",
            path: "/run/nanoplot/EXTRA_NanoStats.txt",
          },
        ],
        expectedSamples,
        context: "NanoPlot fixture",
      }),
    ).toThrow(/unexpected output or basename/);

    const readsQcArtifacts = expectedSamples.map((sample) => ({
      outputId: "sample_stats",
      sampleId: sample.sampleRecordId,
      path: `/run/per_sample/${sample.sampleId}.tsv`,
    }));
    expect(
      assertSampleBoundQcArtifactCoverage({
        pipelineId: "reads-qc",
        artifacts: readsQcArtifacts,
        expectedSamples,
        context: "reads-QC fixture",
      }),
    ).toMatchObject({
      expectedArtifacts: 2,
      persistedArtifacts: 2,
    });
    expect(() =>
      assertSampleBoundQcArtifactCoverage({
        pipelineId: "reads-qc",
        artifacts: [
          { ...readsQcArtifacts[0], path: "/run/per_sample/S2.tsv" },
          readsQcArtifacts[1],
        ],
        expectedSamples,
        context: "reads-QC fixture",
      }),
    ).toThrow(/wrong persisted sample/);
  });

  it("keeps MultiQC provenance on historical source inputs after Read replacement", () => {
    const [expected] = deriveMultiqcExpectedSamplesFromSourceInputs({
      candidateSamples: [
        {
          sampleId: "S1",
          sampleRecordId: "sample-1",
          activeReads: [
            {
              id: "replacement-read-1",
              file1: "/reads/replacement-one.fastq.gz",
              file2: "/reads/replacement-two.fastq.gz",
            },
          ],
        },
      ],
      sourceInputSamples: [
        {
          sampleId: "S1",
          sampleRecordId: "sample-1",
          file1: "/reads/historical-one.fastq.gz",
          file2: "/reads/historical-two.fastq.gz",
        },
      ],
      context: "MultiQC historical source fixture",
    });

    expect(expected).toMatchObject({
      sampleId: "S1",
      sampleRecordId: "sample-1",
      file1: "/reads/historical-one.fastq.gz",
      file2: "/reads/historical-two.fastq.gz",
      pairedEnd: true,
    });
  });

  it("keeps write-once FastQC evidence valid after historical inputs are deleted", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "seqdesk-multiqc-history-"),
    );
    const canonicalStorage = path.join(root, "canonical-storage");
    const storage = path.join(root, "storage");
    const runFolder = path.join(root, "runs", "fastqc-run-1");
    const r1Canonical = path.join(canonicalStorage, "historical_R1.fastq.gz");
    const r2Canonical = path.join(canonicalStorage, "historical_R2.fastq.gz");
    const artifactR1 = path.join(runFolder, "S1_R1_fastqc.zip");
    const artifactR2 = path.join(runFolder, "S1_R2_fastqc.zip");
    const samplesheetPath = path.join(runFolder, "samplesheet.csv");
    const samplesheetSha256 = "c".repeat(64);
    try {
      fs.mkdirSync(canonicalStorage, { recursive: true });
      fs.mkdirSync(runFolder, { recursive: true });
      fs.symlinkSync(canonicalStorage, storage);
      fs.writeFileSync(r1Canonical, "historical-r1");
      fs.writeFileSync(r2Canonical, "historical-r2");
      fs.writeFileSync(artifactR1, "fastqc-r1");
      fs.writeFileSync(artifactR2, "fastqc-r2");

      const r1 = path.join(storage, "historical_R1.fastq.gz");
      const r2 = path.join(storage, "historical_R2.fastq.gz");
      const expectedInputs = [
        {
          identity: "S1/R1",
          sampleId: "S1",
          sampleRecordId: "sample-1",
          mate: "R1",
          inputPath: r1,
        },
        {
          identity: "S1/R2",
          sampleId: "S1",
          sampleRecordId: "sample-1",
          mate: "R2",
          inputPath: r2,
        },
      ];
      const buildInput = ({
        identity,
        mate,
        inputPath,
        canonicalPath,
        artifactPath,
        digest,
      }: {
        identity: string;
        mate: string;
        inputPath: string;
        canonicalPath: string;
        artifactPath: string;
        digest: string;
      }) => ({
        identity,
        sampleId: "S1",
        sampleRecordId: "sample-1",
        readRecordId: "historical-read-1",
        mate,
        inputPath,
        inputCanonicalPath: canonicalPath,
        storageRelativePath: path.basename(canonicalPath),
        inputBasename: path.basename(inputPath),
        inputSize: fs.statSync(canonicalPath).size,
        inputSha256: digest,
        readCount: 20,
        fastqc: {
          artifactId: `artifact-${mate.toLowerCase()}`,
          artifactPath,
          artifactBasename: path.basename(artifactPath),
          artifactSize: fs.statSync(artifactPath).size,
          artifactSha256: mate === "R1" ? "d".repeat(64) : "e".repeat(64),
          filename: path.basename(inputPath),
          totalSequences: 20,
          meanSequenceQualityNumerator: 800,
          meanSequenceQualityDenominator: 20,
        },
      });
      const snapshot = {
        schema: "seqdesk-fastqc-input-evidence",
        version: 1,
        runId: "fastqc-run-1",
        orderId: "order-1",
        samplesheet: {
          path: samplesheetPath,
          sha256: samplesheetSha256,
        },
        inputs: [
          buildInput({
            ...expectedInputs[0],
            canonicalPath: fs.realpathSync.native(r1Canonical),
            artifactPath: artifactR1,
            digest: "a".repeat(64),
          }),
          buildInput({
            ...expectedInputs[1],
            canonicalPath: fs.realpathSync.native(r2Canonical),
            artifactPath: artifactR2,
            digest: "b".repeat(64),
          }),
        ],
      };
      const validate = (requireExistingInputs = false) =>
        assertFastqcInputEvidenceSnapshot({
          snapshot,
          expectedRunId: "fastqc-run-1",
          expectedOrderId: "order-1",
          expectedRunFolder: runFolder,
          expectedSamplesheetPath: samplesheetPath,
          expectedSamplesheetSha256: samplesheetSha256,
          expectedInputs,
          dataBasePath: storage,
          requireExistingInputs,
          context: "MultiQC historical fixture",
        });

      expect(validate(true)).toMatchObject({ inputCount: 2 });
      const evidencePath = path.join(
        runFolder,
        FASTQC_INPUT_EVIDENCE_BASENAME,
      );
      const written = writeFastqcInputEvidenceSnapshotFile({
        filePath: evidencePath,
        snapshot,
        context: "FastQC historical fixture",
      });
      expect(written).toMatchObject({
        path: evidencePath,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(
        writeFastqcInputEvidenceSnapshotFile({
          filePath: evidencePath,
          snapshot,
          context: "FastQC historical fixture",
        }),
      ).toEqual(written);

      fs.rmSync(r1Canonical);
      fs.rmSync(r2Canonical);
      expect(fs.existsSync(r1)).toBe(false);
      expect(fs.existsSync(r2)).toBe(false);
      const historicalEvidence = validate();
      expect(historicalEvidence.entriesByIdentity.get("S1/R2")).toMatchObject({
        inputSha256: "b".repeat(64),
        readCount: 20,
      });
      const [historicalSample] =
        deriveMultiqcExpectedSamplesFromSourceInputs({
          candidateSamples: [
            { sampleId: "S1", sampleRecordId: "sample-1" },
          ],
          sourceInputSamples: [
            {
              sampleId: "S1",
              sampleRecordId: "sample-1",
              file1: r1,
              file2: r2,
            },
          ],
          context: "MultiQC deleted historical fixture",
        });
      expect(
        assertMultiqcFastqcCoverage({
          expectedSamples: [historicalSample],
          generalStatsData: undefined,
          fastqcData: {
            S1_R1: { "Total Sequences": 20 },
            S1_R2: { "Total Sequences": 20 },
          },
          stagedFastqcArtifacts: ["R1", "R2"].map((mate) => ({
            pipelineRunId: "fastqc-run-1",
            pipelineId: "fastqc",
            artifactId: `artifact-${mate.toLowerCase()}`,
            outputId: "sample_qc_data",
            sourcePath: path.join(runFolder, `S1_${mate}_fastqc.zip`),
            stagedPath: path.join(
              root,
              "multiqc-run",
              `S1_${mate}_fastqc.zip`,
            ),
            size: 9,
          })),
          expectedSequenceCountsByIdentity: new Map([
            ["S1/R1", 20],
            ["S1/R2", 20],
          ]),
          context: "MultiQC deleted historical fixture",
        }),
      ).toMatchObject({
        expectedSampleMates: 2,
        sequenceCountsGroundTruthChecked: true,
      });

      expect(() =>
        writeFastqcInputEvidenceSnapshotFile({
          filePath: evidencePath,
          snapshot: { ...snapshot, orderId: "different-order" },
          context: "FastQC historical fixture",
        }),
      ).toThrow(/refusing to overwrite different existing evidence/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects corrupt or cross-run FastQC evidence", () => {
    const storage = fs.realpathSync.native(os.tmpdir());
    const runFolder = path.join(storage, "seqdesk-runs", "fastqc-run-1");
    const inputPath = `${storage}/S1_R1.fastq.gz`;
    const expectedInputs = [
      {
        identity: "S1/R1",
        sampleId: "S1",
        sampleRecordId: "sample-1",
        mate: "R1",
        inputPath,
      },
    ];
    const snapshot = {
      schema: "seqdesk-fastqc-input-evidence",
      version: 1,
      runId: "fastqc-run-1",
      orderId: "order-1",
      samplesheet: {
        path: `${runFolder}/samplesheet.csv`,
        sha256: "a".repeat(64),
      },
      inputs: [
        {
          ...expectedInputs[0],
          readRecordId: "read-1",
          inputCanonicalPath: inputPath,
          storageRelativePath: "S1_R1.fastq.gz",
          inputBasename: "S1_R1.fastq.gz",
          inputSize: 100,
          inputSha256: "b".repeat(64),
          readCount: 20,
          fastqc: {
            artifactId: "artifact-1",
            artifactPath: `${runFolder}/S1_R1_fastqc.zip`,
            artifactBasename: "S1_R1_fastqc.zip",
            artifactSize: 200,
            artifactSha256: "c".repeat(64),
            filename: "S1_R1.fastq.gz",
            totalSequences: 20,
            meanSequenceQualityNumerator: 800,
            meanSequenceQualityDenominator: 20,
          },
        },
      ],
    };
    const validate = (candidate: typeof snapshot) =>
      assertFastqcInputEvidenceSnapshot({
        snapshot: candidate,
        expectedRunId: "fastqc-run-1",
        expectedOrderId: "order-1",
        expectedRunFolder: runFolder,
        expectedSamplesheetPath: `${runFolder}/samplesheet.csv`,
        expectedSamplesheetSha256: "a".repeat(64),
        expectedInputs,
        dataBasePath: storage,
        context: "FastQC corrupt evidence fixture",
      });

    expect(() => validate({ ...snapshot, version: 2 })).toThrow(
      /snapshot contract is invalid/,
    );
    expect(() => validate({ ...snapshot, schema: "unknown-schema" })).toThrow(
      /snapshot contract is invalid/,
    );
    expect(() => validate({ ...snapshot, runId: "other-run" })).toThrow(
      /binding does not match/,
    );
    expect(() =>
      validate({
        ...snapshot,
        inputs: [
          {
            ...snapshot.inputs[0],
            inputSha256: "not-a-digest",
          },
        ],
      }),
    ).toThrow(/snapshot entry is malformed/);
    expect(() =>
      validate({
        ...snapshot,
        inputs: [
          {
            ...snapshot.inputs[0],
            storageRelativePath: "../outside.fastq.gz",
          },
        ],
      }),
    ).toThrow(/snapshot entry is malformed/);
    expect(() =>
      validate({
        ...snapshot,
        inputs: [snapshot.inputs[0], snapshot.inputs[0]],
      }),
    ).toThrow(/exactly once/);
  });

  it("requires complete staged and parsed MultiQC sample/mate coverage", () => {
    const candidateSamples = [
      {
        sampleId: "S1",
        sampleRecordId: "sample-1",
      },
      {
        sampleId: "S2",
        sampleRecordId: "sample-2",
      },
    ];
    const expectedSamples = deriveMultiqcExpectedSamplesFromSourceInputs({
      candidateSamples,
      sourceInputSamples: [
      {
        sampleId: "S1",
        sampleRecordId: "sample-1",
        file1: "/reads/lane-a-one.fastq.gz",
        file2: "/reads/lane-a-two.fastq.gz",
      },
      {
        sampleId: "S2",
        sampleRecordId: "sample-2",
        file1: "/reads/explicit-real-name.fq.gz",
        file2: null,
      },
      ],
      context: "MultiQC fixture",
    });
    expect(expectedSamples).toEqual([
      expect.objectContaining({
        sampleId: "S1",
        file1: "/reads/lane-a-one.fastq.gz",
        file2: "/reads/lane-a-two.fastq.gz",
        pairedEnd: true,
      }),
      expect.objectContaining({
        sampleId: "S2",
        file1: "/reads/explicit-real-name.fq.gz",
        file2: null,
        pairedEnd: false,
      }),
    ]);
    const staged = [
      "S1_R1_fastqc.zip",
      "S1_R2_fastqc.zip",
      "S2_R1_fastqc.zip",
      // Duplicate evidence from a second completed FastQC run is valid, but
      // cannot hide a missing sample/mate.
      "S1_R1_fastqc.zip",
    ].map((basename, index) => ({
      pipelineRunId: index === 3 ? "fastqc-run-2" : "fastqc-run-1",
      pipelineId: "fastqc",
      artifactId: `artifact-${index}`,
      outputId: "sample_qc_data",
      sourcePath: `/prior/${index}/${basename}`,
      stagedPath: `/current/prior-run-inputs/${index}/${basename}`,
      size: 123,
    }));
    const generalStatsData = [
      {
        S1_R1: { total_sequences: 10 },
        "lane-a-two": { total_sequences: 10 },
        "explicit-real-name": { total_sequences: 10 },
      },
    ];

    expect(
      assertMultiqcFastqcCoverage({
        expectedSamples,
        generalStatsData,
        stagedFastqcArtifacts: staged,
        expectedSequenceCountsByIdentity: new Map([
          ["S1/R1", 10],
          ["S1/R2", 10],
          ["S2/R1", 10],
        ]),
        context: "MultiQC fixture",
      }),
    ).toMatchObject({
      expectedSampleMates: 3,
      parsedSampleNames: 3,
      stagedFastqcInputs: 4,
      stagedDuplicateInputs: 1,
      sequenceCountsByIdentity: {
        "S1/R1": 10,
        "S1/R2": 10,
        "S2/R1": 10,
      },
      sequenceCountsGroundTruthChecked: true,
      unmatchedParsedSampleNames: [],
    });

    // MultiQC 1.21 can leave report_general_stats_data empty even though its
    // FastQC module parsed the staged reports. Its saved raw module output is
    // the stable source of the exact per-sample sequence counts.
    expect(
      assertMultiqcFastqcCoverage({
        expectedSamples,
        fastqcData: {
          S1_R1: { "Total Sequences": 10 },
          "lane-a-two": { "Total Sequences": 10 },
          "explicit-real-name": { "Total Sequences": 10 },
        },
        stagedFastqcArtifacts: staged,
        expectedSequenceCountsByIdentity: new Map([
          ["S1/R1", 10],
          ["S1/R2", 10],
          ["S2/R1", 10],
        ]),
        context: "MultiQC raw-data fixture",
      }),
    ).toMatchObject({
      expectedSampleMates: 3,
      parsedSampleNames: 3,
      sequenceCountsByIdentity: {
        "S1/R1": 10,
        "S1/R2": 10,
        "S2/R1": 10,
      },
      sequenceCountsGroundTruthChecked: true,
    });

    expect(() =>
      assertMultiqcFastqcCoverage({
        expectedSamples,
        generalStatsData: [
          {
            S1_R1: {},
            S1_R2: {},
            S2_R1: {},
          },
        ],
        stagedFastqcArtifacts: staged.filter(
          (artifact) => !artifact.stagedPath.includes("S1_R2"),
        ),
        expectedSequenceCountsByIdentity: undefined,
        context: "MultiQC fixture",
      }),
    ).toThrow(/staged FastQC ZIPs do not cover every expected study sample\/mate/);
    expect(() =>
      assertMultiqcFastqcCoverage({
        expectedSamples,
        generalStatsData: [
          {
            S1_R1: { total_sequences: 10 },
            S1_R2: { total_sequences: 10 },
          },
        ],
        stagedFastqcArtifacts: staged,
        expectedSequenceCountsByIdentity: undefined,
        context: "MultiQC fixture",
      }),
    ).toThrow(/general statistics do not cover every expected study sample\/mate/);

    for (const field of ["pipelineRunId", "artifactId"] as const) {
      expect(() =>
        assertMultiqcFastqcCoverage({
          expectedSamples,
          generalStatsData,
          stagedFastqcArtifacts: [
            { ...staged[0], [field]: "   " },
            ...staged.slice(1),
          ],
          expectedSequenceCountsByIdentity: undefined,
          context: "MultiQC fixture",
        }),
      ).toThrow(/staged FastQC input is malformed or unexpected/);
    }

    expect(() =>
      assertMultiqcFastqcCoverage({
        expectedSamples,
        generalStatsData: [
          {
            S1_R1: {},
            "lane-a-two": { total_sequences: 10 },
            "explicit-real-name": { total_sequences: 10 },
          },
        ],
        stagedFastqcArtifacts: staged,
        expectedSequenceCountsByIdentity: undefined,
        context: "MultiQC fixture",
      }),
    ).toThrow(/MultiQC metrics are empty for S1\/R1/);

    expect(() =>
      assertMultiqcFastqcCoverage({
        expectedSamples,
        generalStatsData: [
          {
            S1_R1: { mean_quality: 35 },
            "lane-a-two": { total_sequences: 10 },
            "explicit-real-name": { total_sequences: 10 },
          },
        ],
        stagedFastqcArtifacts: staged,
        expectedSequenceCountsByIdentity: undefined,
        context: "MultiQC fixture",
      }),
    ).toThrow(/lack total_sequences/);

    for (const invalidCount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "10"]) {
      expect(() =>
        assertMultiqcFastqcCoverage({
          expectedSamples,
          generalStatsData: [
            {
              S1_R1: { total_sequences: invalidCount },
              "lane-a-two": { total_sequences: 10 },
              "explicit-real-name": { total_sequences: 10 },
            },
          ],
          stagedFastqcArtifacts: staged,
          expectedSequenceCountsByIdentity: undefined,
          context: "MultiQC fixture",
        }),
      ).toThrow(/total_sequences is not a positive safe integer/);
    }

    expect(() =>
      assertMultiqcFastqcCoverage({
        expectedSamples,
        generalStatsData: [
          ...generalStatsData,
          { "lane-a-one": { total_sequences: 10 } },
        ],
        stagedFastqcArtifacts: staged,
        expectedSequenceCountsByIdentity: undefined,
        context: "MultiQC fixture",
      }),
    ).toThrow(/duplicate total_sequences evidence for S1\/R1/);
    expect(() =>
      assertMultiqcFastqcCoverage({
        expectedSamples,
        generalStatsData: [
          ...generalStatsData,
          { "lane-a-one": { total_sequences: 11 } },
        ],
        stagedFastqcArtifacts: staged,
        expectedSequenceCountsByIdentity: undefined,
        context: "MultiQC fixture",
      }),
    ).toThrow(/conflicting total_sequences evidence for S1\/R1/);

    expect(() =>
      assertMultiqcFastqcCoverage({
        expectedSamples,
        generalStatsData,
        stagedFastqcArtifacts: staged,
        expectedSequenceCountsByIdentity: {
          "S1/R1": 9,
          "S1/R2": 10,
          "S2/R1": 10,
        },
        context: "MultiQC fixture",
      }),
    ).toThrow(/does not match ground truth for S1\/R1/);
    expect(() =>
      assertMultiqcFastqcCoverage({
        expectedSamples,
        generalStatsData,
        stagedFastqcArtifacts: staged,
        expectedSequenceCountsByIdentity: {
          "S1/R1": 10,
          "S1/R2": 10,
        },
        context: "MultiQC fixture",
      }),
    ).toThrow(/every target sample\/mate sequence count exactly once/);
    expect(() =>
      assertMultiqcFastqcCoverage({
        expectedSamples,
        generalStatsData,
        stagedFastqcArtifacts: staged,
        expectedSequenceCountsByIdentity: {
          "S1/R1": 0,
          "S1/R2": 10,
          "S2/R1": 10,
        },
        context: "MultiQC fixture",
      }),
    ).toThrow(/expected total_sequences is not a positive safe integer/);
  });

  it("proves MultiQC NanoStat metrics against exact staged NanoPlot TSV data", () => {
    const parse = (sampleId: string, numberOfReads: number) => ({
      sampleId,
      metrics: parseNanoplotNanoStatsTsv({
        text: [
          "Metrics\tdataset",
          `number_of_reads\t${numberOfReads}`,
          "number_of_bases\t800.0",
          "read_length_stdev\t12.7",
          "median_read_length\t80.0",
          "mean_read_length\t80.0",
          "n50\t80.0",
          "median_qual\t19.8",
          "mean_qual\t20.0",
          "top_5_read_lengths\t100,95,90,85,80",
          "top_5_qual_scores\t25.0,24.5,24.0,23.5,23.0",
          "number_of_reads_above_q10\t10",
          "",
        ].join("\n"),
        context: `${sampleId} NanoStats`,
      }),
    });
    const s1 = parse("S1", 10);
    const s2 = parse("S2", 10);
    const multiqcNanostatData = {
      S1: {
        "Number of reads_fastq": 10,
        "Total bases_fastq": 800,
        "Median read length_fastq": 80,
        "Mean read length_fastq": 80,
        "Read length N50_fastq": 80,
        "Mean read quality_fastq": 20,
      },
      S2: {
        "Number of reads_fastq": 10,
        "Total bases_fastq": 800,
        "Median read length_fastq": 80,
        "Mean read length_fastq": 80,
        "Read length N50_fastq": 80,
        "Mean read quality_fastq": 20,
      },
    };

    expect(
      assertMultiqcNanoplotMetrics({
        // Local + SLURM may stage duplicate source artifacts. They are valid
        // only when their independently parsed metrics agree exactly.
        expectedStats: [s1, s2, { ...s1 }],
        multiqcNanostatData,
        context: "MultiQC NanoPlot fixture",
      }),
    ).toEqual({
      expectedNanoPlotSamples: 2,
      parsedNanoPlotSamples: 2,
      stagedNanoStatsArtifacts: 3,
      stagedDuplicateNanoStats: 1,
    });

    expect(() =>
      assertMultiqcNanoplotMetrics({
        expectedStats: [s1],
        multiqcNanostatData: {
          S1_NanoStats: multiqcNanostatData.S1,
        },
        context: "MultiQC 1.21 sample-name fixture",
      }),
    ).toThrow(/without staged ground truth/);

    expect(() =>
      assertMultiqcNanoplotMetrics({
        expectedStats: [s1, s2],
        multiqcNanostatData: {
          S1: multiqcNanostatData.S1,
        },
        context: "MultiQC NanoPlot fixture",
      }),
    ).toThrow(/every NanoPlot sample exactly once/);
    expect(() =>
      assertMultiqcNanoplotMetrics({
        expectedStats: [s1, s2],
        multiqcNanostatData: {
          ...multiqcNanostatData,
          S2: {
            ...multiqcNanostatData.S2,
            "Mean read quality_fastq": 19.9,
          },
        },
        context: "MultiQC NanoPlot fixture",
      }),
    ).toThrow(/does not match NanoStats ground truth for S2/);
    expect(() =>
      assertMultiqcNanoplotMetrics({
        expectedStats: [s1],
        multiqcNanostatData: {
          S1: {
            ...multiqcNanostatData.S1,
            "Read length N50_fastq": undefined,
          },
        },
        context: "MultiQC NanoPlot fixture",
      }),
    ).toThrow(/does not match NanoStats ground truth for S1/);
    expect(() =>
      parseNanoplotNanoStatsTsv({
        text: [
          "Metrics\tdataset",
          "number_of_reads\t10",
          "number_of_bases\t800",
          "median_read_length\t80.0",
          "mean_read_length\t80.0",
          "n50\t80.0",
          "mean_qual\t20.0",
        ].join("\n"),
        context: "invalid NanoStats",
      }),
    ).toThrow(/fixed one-decimal representation/);
    expect(() =>
      parseNanoplotNanoStatsTsv({
        text: [
          "Metrics\tdataset",
          "number_of_reads\t10",
          "number_of_bases\t800.0",
          "median_read_length\t80.0",
          "mean_read_length\t80.0",
          "n50\t80.0",
          "n50\t80.0",
        ].join("\n"),
        context: "invalid NanoStats",
      }),
    ).toThrow(/duplicate required metric/);
  });

  it("proves exact reads-QC sample/mate coverage against the selected Read writeback", () => {
    const expectedSamples = [
      {
        sampleId: "S1",
        pairedEnd: true,
        readMetrics: {
          readCount1: 10,
          avgQuality1: 36.5,
          readCount2: 11,
          avgQuality2: 35.5,
        },
      },
      {
        sampleId: "S2",
        pairedEnd: false,
        readMetrics: {
          readCount1: 8,
          avgQuality1: 34,
        },
      },
    ];
    const rows = [
      ["S1", "R1", "10", "750", "75", "75.0", "75", "36.5", "50.0", "100", "100", "75"],
      ["S1", "R2", "11", "825", "75", "75.0", "75", "35.5", "50.0", "100", "100", "75"],
      ["S2", "R1", "8", "600", "75", "75.0", "75", "34", "50.0", "100", "100", "75"],
    ];

    expect(
      assertReadsQcSummaryRows({
        header: readsQcHeader,
        rows,
        expectedSamples,
        groundTruthByIdentity: undefined,
        context: "reads-QC fixture",
      }),
    ).toMatchObject({
      expectedSampleCount: 2,
      expectedReadEnds: 3,
      observedReadEnds: 3,
      pairedSamples: 1,
      singleEndSamples: 1,
    });

    expect(() =>
      assertReadsQcSummaryRows({
        header: readsQcHeader,
        rows: rows.filter((row) => row[1] !== "R2"),
        expectedSamples,
        groundTruthByIdentity: undefined,
        context: "reads-QC fixture",
      }),
    ).toThrow(/every target sample\/read-end exactly once/);
    expect(() =>
      assertReadsQcSummaryRows({
        header: readsQcHeader,
        rows: [rows[0], rows[0], rows[2]],
        expectedSamples,
        groundTruthByIdentity: undefined,
        context: "reads-QC fixture",
      }),
    ).toThrow(/every target sample\/read-end exactly once/);
    expect(() =>
      assertReadsQcSummaryRows({
        header: readsQcHeader,
        rows: [
          ["S1", "R1", "12", "750", "75", "75.0", "75", "36.5", "50.0", "100", "100", "75"],
          rows[1],
          rows[2],
        ],
        expectedSamples,
        groundTruthByIdentity: undefined,
        context: "reads-QC fixture",
      }),
    ).toThrow(/does not match the Read writeback/);
  });

  it("checks reads-QC against fixed SeqKit precision and independent FASTQ semantics", () => {
    const expectedSamples = [
      {
        sampleId: "S1",
        pairedEnd: false,
        readMetrics: { readCount1: 10, avgQuality1: 29.79 },
      },
    ];
    const groundTruth = {
      "S1/R1": {
        readCount: 10,
        totalBases: 750,
        minReadLength: 70,
        meanReadLength: 75,
        maxReadLength: 80,
        meanErrorProbabilityQuality: 29.787,
        seqkitMeanPerReadGcPercent: 33.33,
        seqkitPerReadGcBinary64Total: 33.33,
        seqkitPerReadGcHundredthsTotal: 3333,
        seqkitGcReadCount: 1,
        q20Percent: 98,
        q30Percent: 88.53,
        n50: 76,
      },
    };
    const row = [
      "S1",
      "R1",
      "10",
      "750",
      "70",
      "75.0",
      "80",
      "29.79",
      "33.33",
      "98.00",
      "88.53",
      "76",
    ];

    expect(
      assertReadsQcSummaryRows({
        header: readsQcHeader,
        rows: [row],
        expectedSamples,
        groundTruthByIdentity: groundTruth,
        context: "reads-QC ground truth",
      }),
    ).toMatchObject({ groundTruthChecked: true, checkedRows: 1 });

    const seqkitAverageLengthBoundary = {
      readCount: 20,
      totalBases: 23,
      minReadLength: 1,
      meanReadLength: 23 / 20,
      maxReadLength: 2,
      meanErrorProbabilityQuality: 0,
      seqkitMeanPerReadGcPercent: 0,
      seqkitPerReadGcBinary64Total: 0,
      seqkitPerReadGcHundredthsTotal: 0,
      seqkitGcReadCount: 20,
      q20Percent: 0,
      q30Percent: 0,
      n50: 1,
    };
    const seqkitAverageLengthBoundaryRow = [
      "S1",
      "R1",
      "20",
      "23",
      "1",
      "1.2",
      "2",
      "0.00",
      "0.00",
      "0.00",
      "0.00",
      "1",
    ];
    expect(
      assertReadsQcSummaryRows({
        header: readsQcHeader,
        rows: [seqkitAverageLengthBoundaryRow],
        expectedSamples: [
          {
            sampleId: "S1",
            pairedEnd: false,
            readMetrics: { readCount1: 20, avgQuality1: 0 },
          },
        ],
        groundTruthByIdentity: {
          "S1/R1": seqkitAverageLengthBoundary,
        },
        context: "SeqKit 2.8 avg_len pre-rounding ground truth",
      }),
    ).toMatchObject({ groundTruthChecked: true });
    const binary64AverageLengthRow = [
      ...seqkitAverageLengthBoundaryRow,
    ];
    binary64AverageLengthRow[5] = "1.1";
    expect(() =>
      assertReadsQcSummaryRows({
        header: readsQcHeader,
        rows: [binary64AverageLengthRow],
        expectedSamples: [
          {
            sampleId: "S1",
            pairedEnd: false,
            readMetrics: { readCount1: 20, avgQuality1: 0 },
          },
        ],
        groundTruthByIdentity: {
          "S1/R1": seqkitAverageLengthBoundary,
        },
        context: "SeqKit 2.8 avg_len binary64-only false oracle",
      }),
    ).toThrow(/fixed-precision FASTQ ground truth/);

    const seqkitPercentageBoundary = (23 / 160) * 100;
    const seqkitStatsBoundaryRow = [
      "S1",
      "R1",
      "20",
      "160",
      "8",
      "8.0",
      "8",
      "14.38",
      "0.00",
      "14.38",
      "0.00",
      "8",
    ];
    const seqkitStatsBoundaryGroundTruth = {
      readCount: 20,
      totalBases: 160,
      minReadLength: 8,
      meanReadLength: 8,
      maxReadLength: 8,
      meanErrorProbabilityQuality: seqkitPercentageBoundary,
      seqkitMeanPerReadGcPercent: 0,
      seqkitPerReadGcBinary64Total: 0,
      seqkitPerReadGcHundredthsTotal: 0,
      seqkitGcReadCount: 20,
      q20Percent: seqkitPercentageBoundary,
      q30Percent: 0,
      n50: 8,
    };
    expect(
      assertReadsQcSummaryRows({
        header: readsQcHeader,
        rows: [seqkitStatsBoundaryRow],
        expectedSamples: [
          {
            sampleId: "S1",
            pairedEnd: false,
            readMetrics: { readCount1: 20, avgQuality1: 14.38 },
          },
        ],
        groundTruthByIdentity: {
          "S1/R1": seqkitStatsBoundaryGroundTruth,
        },
        context: "SeqKit 2.8 two-decimal pre-rounding ground truth",
      }),
    ).toMatchObject({ groundTruthChecked: true });
    for (const column of [7, 9]) {
      const binary64OnlyRow = [...seqkitStatsBoundaryRow];
      binary64OnlyRow[column] = "14.37";
      expect(() =>
        assertReadsQcSummaryRows({
          header: readsQcHeader,
          rows: [binary64OnlyRow],
          expectedSamples: [
            {
              sampleId: "S1",
              pairedEnd: false,
              readMetrics: {
                readCount1: 20,
                avgQuality1: column === 7 ? 14.37 : 14.38,
              },
            },
          ],
          groundTruthByIdentity: {
            "S1/R1": seqkitStatsBoundaryGroundTruth,
          },
          context: "SeqKit 2.8 two-decimal binary64-only false oracle",
        }),
      ).toThrow(/fixed-precision FASTQ ground truth/);
    }

    const halfEvenGcRow = [...row];
    halfEvenGcRow[8] = "3.12";
    expect(
      assertReadsQcSummaryRows({
        header: readsQcHeader,
        rows: [halfEvenGcRow],
        expectedSamples,
        groundTruthByIdentity: {
          "S1/R1": {
            ...groundTruth["S1/R1"],
            seqkitMeanPerReadGcPercent: 3.125,
            seqkitPerReadGcBinary64Total: 6.25,
            seqkitPerReadGcHundredthsTotal: 625,
            seqkitGcReadCount: 2,
          },
        },
        context: "reads-QC final GC half-even ground truth",
      }),
    ).toMatchObject({ groundTruthChecked: true });
    const halfUpGcRow = [...halfEvenGcRow];
    halfUpGcRow[8] = "3.13";
    expect(() =>
      assertReadsQcSummaryRows({
        header: readsQcHeader,
        rows: [halfUpGcRow],
        expectedSamples,
        groundTruthByIdentity: {
          "S1/R1": {
            ...groundTruth["S1/R1"],
            seqkitMeanPerReadGcPercent: 3.125,
            seqkitPerReadGcBinary64Total: 6.25,
            seqkitPerReadGcHundredthsTotal: 625,
            seqkitGcReadCount: 2,
          },
        },
        context: "reads-QC final GC half-even ground truth",
      }),
    ).toThrow(/fixed-precision FASTQ ground truth/);

    for (const [column, plausibleWrongValue] of [
      [5, "75"],
      [7, "29.80"],
      [8, "34.00"],
      [9, "98"],
    ] as const) {
      const wrong = [...row];
      wrong[column] = plausibleWrongValue;
      const matchingWritebackSamples =
        column === 7
          ? [
              {
                ...expectedSamples[0],
                readMetrics: {
                  ...expectedSamples[0].readMetrics,
                  avgQuality1: Number(plausibleWrongValue),
                },
              },
            ]
          : expectedSamples;
      expect(() =>
        assertReadsQcSummaryRows({
          header: readsQcHeader,
          rows: [wrong],
          expectedSamples: matchingWritebackSamples,
          groundTruthByIdentity: groundTruth,
          context: "reads-QC ground truth",
        }),
      ).toThrow(/fixed-precision FASTQ ground truth/);
    }
    const zeroGcRow = [...row];
    zeroGcRow[8] = "0.00";
    expect(
      assertReadsQcSummaryRows({
        header: readsQcHeader,
        rows: [zeroGcRow],
        expectedSamples,
        groundTruthByIdentity: {
          "S1/R1": {
            ...groundTruth["S1/R1"],
            seqkitMeanPerReadGcPercent: 0,
            seqkitPerReadGcBinary64Total: 0,
            seqkitPerReadGcHundredthsTotal: 0,
            seqkitGcReadCount: 1,
          },
        },
        context: "reads-QC all-ambiguous ground truth",
      }),
    ).toMatchObject({ groundTruthChecked: true });
    expect(readsQcWorkflow).toContain(
      'conda "bioconda::seqkit=2.8.0"',
    );
    expect(readsQcWorkflow).toContain("sum / reads");
    expect(readsQcWorkflow).toContain("full read length");
    expect(readsQcWorkflow).not.toContain('\\$NF == "NaN"');
    expect(readsQcWorkflow).not.toContain("finite += 1");
    expect(readsQcReadme).toContain("pins SeqKit 2.8.0");
    expect(readsQcReadme).toContain("ambiguous bases remain in the");
    expect(readsQcReadme).toContain("all-`N`");
    expect(readsQcE2e).toContain(
      'PATH="$LOCAL_PATH_PREFIX:$PATH" \\\n    seqdesk_conda_run nextflow run',
    );
    expect(readsQcE2e).not.toContain(
      'env PATH="$LOCAL_PATH_PREFIX:$PATH" \\\n    seqdesk_conda_run',
    );
  });

  it("binds each reads-QC sample_stats TSV to its basename-selected sample", () => {
    const expectedSample = {
      sampleId: "S1",
      pairedEnd: false,
      readMetrics: { readCount1: 1, avgQuality1: 40 },
    };
    const groundTruth = {
      "S1/R1": {
        readCount: 1,
        totalBases: 4,
        minReadLength: 4,
        meanReadLength: 4,
        maxReadLength: 4,
        meanErrorProbabilityQuality: 40,
        seqkitMeanPerReadGcPercent: 50,
        seqkitPerReadGcBinary64Total: 50,
        seqkitPerReadGcHundredthsTotal: 5000,
        seqkitGcReadCount: 1,
        q20Percent: 100,
        q30Percent: 100,
        n50: 4,
      },
    };
    const row = [
      "S1",
      "R1",
      "1",
      "4",
      "4",
      "4.0",
      "4",
      "40.00",
      "50.00",
      "100.00",
      "100.00",
      "4",
    ];
    expect(
      assertReadsQcSampleArtifactRows({
        header: readsQcHeader,
        rows: [row],
        expectedSample,
        groundTruthByIdentity: groundTruth,
        context: "reads-QC S1.tsv",
      }),
    ).toMatchObject({ checkedRows: 1, groundTruthChecked: true });
    expect(() =>
      assertReadsQcSampleArtifactRows({
        header: [...readsQcHeader, "unexpected"],
        rows: [row],
        expectedSample,
        groundTruthByIdentity: groundTruth,
        context: "reads-QC S1.tsv",
      }),
    ).toThrow(/header is not exact/);
    expect(() =>
      assertReadsQcSampleArtifactRows({
        header: readsQcHeader,
        rows: [["S2", ...row.slice(1)]],
        expectedSample,
        groundTruthByIdentity: groundTruth,
        context: "reads-QC S1.tsv",
      }),
    ).toThrow(/every target sample\/read-end exactly once/);
    expect(() =>
      assertReadsQcSampleArtifactRows({
        header: readsQcHeader,
        rows: [[...row.slice(0, 2), "2", ...row.slice(3)]],
        expectedSample: {
          ...expectedSample,
          readMetrics: { readCount1: 2, avgQuality1: 40 },
        },
        groundTruthByIdentity: groundTruth,
        context: "reads-QC S1.tsv",
      }),
    ).toThrow(/independent FASTQ ground truth/);
  });

  it("checks NanoPlot's exact NanoMath TSV semantics and rejects conventional-N50 substitution", () => {
    const expectedSamples = [{ sampleId: "S1", pairedEnd: false }];
    const groundTruth = {
      "S1/R1": {
        readCount: 3,
        totalBases: 8,
        meanReadLength: 8 / 3,
        medianReadLength: 2,
        nanomathN50: 2,
        nanomathMeanReadQuality: 20.04,
      },
    };
    const header = [
      "sample_id",
      "num_reads",
      "total_bases",
      "mean_length",
      "median_length",
      "read_n50",
      "mean_quality",
    ];
    const row = ["S1", "3", "8.0", "2.7", "2.0", "2.0", "20.0"];

    expect(
      assertNanoplotSummaryRows({
        header,
        rows: [row],
        expectedSamples,
        groundTruthByIdentity: groundTruth,
        context: "NanoPlot ground truth",
      }),
    ).toMatchObject({ groundTruthChecked: true, checkedRows: 1 });

    const halfEvenLengthGroundTruth = {
      "S1/R1": {
        ...groundTruth["S1/R1"],
        readCount: 4,
        totalBases: 9,
        meanReadLength: 2.25,
      },
    };
    const halfEvenLengthRow = [
      "S1",
      "4",
      "9.0",
      "2.2",
      "2.0",
      "2.0",
      "20.0",
    ];
    expect(
      assertNanoplotSummaryRows({
        header,
        rows: [halfEvenLengthRow],
        expectedSamples,
        groundTruthByIdentity: halfEvenLengthGroundTruth,
        context: "NanoPlot half-even mean length",
      }),
    ).toMatchObject({ groundTruthChecked: true });
    const halfUpLengthRow = [...halfEvenLengthRow];
    halfUpLengthRow[3] = "2.3";
    expect(() =>
      assertNanoplotSummaryRows({
        header,
        rows: [halfUpLengthRow],
        expectedSamples,
        groundTruthByIdentity: halfEvenLengthGroundTruth,
        context: "NanoPlot half-even mean length",
      }),
    ).toThrow(/fixed-precision FASTQ ground truth/);

    const binary64LengthGroundTruth = {
      "S1/R1": {
        ...groundTruth["S1/R1"],
        readCount: 20,
        totalBases: 23,
        meanReadLength: 23 / 20,
        medianReadLength: 1,
        nanomathN50: 1,
      },
    };
    const binary64LengthRow = [
      "S1",
      "20",
      "23.0",
      "1.1",
      "1.0",
      "1.0",
      "20.0",
    ];
    expect(
      assertNanoplotSummaryRows({
        header,
        rows: [binary64LengthRow],
        expectedSamples,
        groundTruthByIdentity: binary64LengthGroundTruth,
        context: "NanoPlot binary64 mean length",
      }),
    ).toMatchObject({ groundTruthChecked: true });
    const exactRatioLengthRow = [...binary64LengthRow];
    exactRatioLengthRow[3] = "1.2";
    expect(() =>
      assertNanoplotSummaryRows({
        header,
        rows: [exactRatioLengthRow],
        expectedSamples,
        groundTruthByIdentity: binary64LengthGroundTruth,
        context: "NanoPlot exact-ratio false oracle regression",
      }),
    ).toThrow(/fixed-precision FASTQ ground truth/);

    for (const [column, plausibleWrongValue] of [
      [2, "8"],
      [3, "2.8"],
      [5, "4.0"],
      [6, "20"],
    ] as const) {
      const wrong = [...row];
      wrong[column] = plausibleWrongValue;
      expect(() =>
        assertNanoplotSummaryRows({
          header,
          rows: [wrong],
          expectedSamples,
          groundTruthByIdentity: groundTruth,
          context: "NanoPlot ground truth",
        }),
      ).toThrow();
    }
  });

  it("binds each NanoStats artifact to its basename-selected raw sample", () => {
    const metrics = parseNanoplotNanoStatsTsv({
      text: [
        "Metrics\tdataset",
        "number_of_reads\t4",
        "number_of_bases\t9.0",
        "mean_read_length\t2.2",
        "median_read_length\t2.0",
        "n50\t2.0",
        "mean_qual\t20.0",
      ].join("\n"),
      context: "NanoPlot S1 NanoStats",
    });
    const groundTruth = {
      readCount: 4,
      totalBases: 9,
      meanReadLength: 2.25,
      medianReadLength: 2,
      nanomathN50: 2,
      nanomathMeanReadQuality: 20.04,
    };
    expect(
      assertNanoplotNanoStatsGroundTruth({
        sampleId: "S1",
        metrics,
        groundTruth,
        context: "NanoPlot S1 NanoStats",
      }),
    ).toEqual({ sampleId: "S1", checkedMetrics: 6 });
    expect(() =>
      assertNanoplotNanoStatsGroundTruth({
        sampleId: "S1",
        metrics: { ...metrics, number_of_reads: 5 },
        groundTruth,
        context: "NanoPlot S1 NanoStats",
      }),
    ).toThrow(/number_of_reads does not match raw FASTQ ground truth/);
    expect(() =>
      assertNanoplotNanoStatsGroundTruth({
        sampleId: "S1",
        metrics: {
          ...metrics,
          mean_read_length: 3.2,
          number_of_bases: 13,
        },
        groundTruth,
        context: "NanoPlot S1 NanoStats",
      }),
    ).toThrow(/number_of_bases does not match raw FASTQ ground truth/);

    const binary64BoundaryMetrics = parseNanoplotNanoStatsTsv({
      text: [
        "Metrics\tdataset",
        "number_of_reads\t20",
        "number_of_bases\t23.0",
        "mean_read_length\t1.1",
        "median_read_length\t1.0",
        "n50\t1.0",
        "mean_qual\t20.0",
      ].join("\n"),
      context: "NanoPlot binary64 NanoStats",
    });
    expect(
      assertNanoplotNanoStatsGroundTruth({
        sampleId: "S1",
        metrics: binary64BoundaryMetrics,
        groundTruth: {
          readCount: 20,
          totalBases: 23,
          meanReadLength: 23 / 20,
          medianReadLength: 1,
          nanomathN50: 1,
          nanomathMeanReadQuality: 20.04,
        },
        context: "NanoPlot binary64 NanoStats",
      }),
    ).toEqual({ sampleId: "S1", checkedMetrics: 6 });
    expect(() =>
      assertNanoplotNanoStatsGroundTruth({
        sampleId: "S1",
        metrics: {
          ...binary64BoundaryMetrics,
          mean_read_length: 1.2,
        },
        groundTruth: {
          readCount: 20,
          totalBases: 23,
          meanReadLength: 23 / 20,
          medianReadLength: 1,
          nanomathN50: 1,
          nanomathMeanReadQuality: 20.04,
        },
        context: "NanoPlot exact-ratio NanoStats false oracle",
      }),
    ).toThrow(/mean_read_length does not match raw FASTQ ground truth/);
  });

  it("parses NanoPlot 1.42 TSV stats fail-closed with no silent zero fallback", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-nanostats-"));
    try {
      const statsPath = path.join(root, "S1_NanoStats.txt");
      const valid = [
        "Metrics\tdataset",
        "number_of_reads\t3",
        "number_of_bases\t8.0",
        "mean_read_length\t2.7",
        "median_read_length\t2.0",
        "n50\t2.0",
        "mean_qual\t20.0",
        "",
      ].join("\n");
      fs.writeFileSync(statsPath, valid);
      expect(
        execFileSync(
          "python3",
          [nanoplotSummaryBuilder, statsPath, "S1"],
          { encoding: "utf8" },
        ),
      ).toBe(
        [
          "sample_id\tnum_reads\ttotal_bases\tmean_length\tmedian_length\tread_n50\tmean_quality",
          "S1\t3\t8.0\t2.7\t2.0\t2.0\t20.0",
          "",
        ].join("\n"),
      );

      for (const malformed of [
        valid.replace("mean_qual\t20.0\n", ""),
        valid.replace(
          "mean_qual\t20.0",
          "mean_qual\t20.0\nmean_qual\t20.0",
        ),
        valid.replace("mean_qual\t20.0", "Mean read quality\t20.0"),
        valid.replace("number_of_bases\t8.0", "number_of_bases\t8"),
      ]) {
        fs.writeFileSync(statsPath, malformed);
        expect(() =>
          execFileSync(
            "python3",
            [nanoplotSummaryBuilder, statsPath, "S1"],
            { encoding: "utf8", stdio: "pipe" },
          ),
        ).toThrow();
      }
      expect(nanoplotWorkflow).toContain("--tsv_stats");
      expect(nanoplotWorkflow).toContain("build_nanoplot_summary.py");
      expect(nanoplotWorkflow).toContain("conda-forge::python=3.12");
      expect(nanoplotWorkflow).toContain("bioconda::nanoplot=1.42.0");
      expect(nanoplotWorkflow).toContain(
        "conda-forge::python-kaleido=0.2.1",
      );
      expect(nanoplotWorkflow).not.toContain(
        'conda "bioconda::nanoplot=1.42.0"',
      );
      expect(nanoplotWorkflow).not.toContain(':=0');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes unfiltered reads-QC rows to the sample/mate proof helper", () => {
    const start = runtimeHarness.indexOf(
      "async function assertReadsQcSummaryMetrics",
    );
    const end = runtimeHarness.indexOf(
      "async function assertNanoplotSummaryMetrics",
      start,
    );
    const readsQcProof = runtimeHarness.slice(start, end);

    expect(readsQcProof).toContain("assertReadsQcSummaryRows({");
    expect(readsQcProof).toContain("rows,");
    expect(readsQcProof).not.toContain(".filter(Boolean)");
  });

  it("proves paired simulation summary fields against the active replacement Read", () => {
    const checksum1 = "a".repeat(32);
    const checksum2 = "b".repeat(32);
    const config = {
      mode: "shortReadPaired",
      simulationMode: "synthetic",
      qualityProfile: "standard",
      insertMean: 350,
      insertStdDev: 30,
      seed: null,
      readCount: 10,
      readLength: 75,
    };
    const expectedReads = [
      {
        sampleId: "S1",
        file1: "/data/simulated/order-1/S1_R1.fastq.gz",
        file2: "/data/simulated/order-1/S1_R2.fastq.gz",
        checksum1,
        checksum2,
        readCount1: 10,
        readCount2: 10,
      },
    ];
    const validRow = [
      "S1",
      "shortReadPaired",
      "synthetic",
      "synthetic",
      "standard",
      "350",
      "30",
      "",
      "",
      "",
      "S1_R1.fastq.gz",
      "S1_R2.fastq.gz",
      checksum1,
      checksum2,
      "10",
      "10",
      "75",
    ];

    expect(
      assertSimulateReadsSummaryRows({
        header: simulateReadsHeader,
        rows: [validRow],
        expectedReads,
        groundTruthByIdentity: undefined,
        config,
        context: "simulate-reads fixture",
      }),
    ).toMatchObject({
      expectedSampleCount: 1,
      observedSampleCount: 1,
      checkedRows: 1,
      mode: "shortReadPaired",
      pairedEnd: true,
    });

    expect(() =>
      assertSimulateReadsSummaryRows({
        header: simulateReadsHeader,
        rows: [validRow],
        expectedReads: [{ ...expectedReads[0], file2: null }],
        groundTruthByIdentity: undefined,
        config,
        context: "simulate-reads fixture",
      }),
    ).toThrow(/paired replacement Read is incomplete/);
    expect(() =>
      assertSimulateReadsSummaryRows({
        header: simulateReadsHeader,
        rows: [[...validRow.slice(0, 13), "", ...validRow.slice(14)]],
        expectedReads,
        groundTruthByIdentity: undefined,
        config,
        context: "simulate-reads fixture",
      }),
    ).toThrow(/checksum2 does not match/);
    expect(() =>
      assertSimulateReadsSummaryRows({
        header: simulateReadsHeader,
        rows: [[...validRow.slice(0, 15), "", ...validRow.slice(16)]],
        expectedReads,
        groundTruthByIdentity: undefined,
        config,
        context: "simulate-reads fixture",
      }),
    ).toThrow(/read_count2 is not an integer/);
  });

  it("rejects plausible simulate-reads summary values that disagree with generated FASTQ bytes", () => {
    const checksum = "a".repeat(32);
    const expectedReads = [
      {
        sampleId: "S1",
        file1: "/data/S1.fastq.gz",
        file2: null,
        checksum1: checksum,
        checksum2: null,
        readCount1: 10,
        readCount2: null,
      },
    ];
    const config = {
      mode: "shortReadSingle",
      simulationMode: "synthetic",
      qualityProfile: "standard",
      insertMean: 350,
      insertStdDev: 30,
      seed: null,
      readCount: 10,
      readLength: 75,
    };
    const row = [
      "S1",
      "shortReadSingle",
      "synthetic",
      "synthetic",
      "standard",
      "350",
      "30",
      "",
      "",
      "",
      "S1.fastq.gz",
      "",
      checksum,
      "",
      "10",
      "",
      "75",
    ];
    const groundTruth = {
      "S1/R1": {
        readCount: 10,
        meanReadLength: 75,
        minReadLength: 75,
        maxReadLength: 75,
      },
    };

    expect(
      assertSimulateReadsSummaryRows({
        header: simulateReadsHeader,
        rows: [row],
        expectedReads,
        groundTruthByIdentity: groundTruth,
        config,
        context: "simulate raw proof",
      }),
    ).toMatchObject({ groundTruthChecked: true });

    const wrongCount = [...row];
    wrongCount[14] = "11";
    expect(() =>
      assertSimulateReadsSummaryRows({
        header: simulateReadsHeader,
        rows: [wrongCount],
        expectedReads: [{ ...expectedReads[0], readCount1: 11 }],
        groundTruthByIdentity: groundTruth,
        config: { ...config, readCount: 11 },
        context: "simulate raw proof",
      }),
    ).toThrow(/independent FASTQ ground truth/);
    const wrongLength = [...row];
    wrongLength[16] = "76";
    expect(() =>
      assertSimulateReadsSummaryRows({
        header: simulateReadsHeader,
        rows: [wrongLength],
        expectedReads,
        groundTruthByIdentity: groundTruth,
        config: { ...config, readLength: 76 },
        context: "simulate raw proof",
      }),
    ).toThrow(/independent FASTQ ground truth/);
  });

  it("proves the exact study-demo study fields, RFC-4180 values, order, and row numbers", () => {
    const samplesheetRows = [
      ["S2", "study-1", 'Quoted, "Study"'],
      ["S1", "study-1", 'Quoted, "Study"'],
    ];
    const summaryRows = [
      [...samplesheetRows[0], "1"],
      [...samplesheetRows[1], "2"],
    ];
    const verify = (overrides: Record<string, unknown> = {}) =>
      assertStudyDemoSummaryRows({
        samplesheetHeader: ["sample_id", "study_id", "study_title"],
        samplesheetRows,
        summaryHeader: [
          "sample_id",
          "study_id",
          "study_title",
          "row_number",
        ],
        summaryRows,
        expectedSampleIds: ["S1", "S2"],
        studyId: "study-1",
        studyTitle: 'Quoted, "Study"',
        context: "study-demo proof",
        ...overrides,
      });

    expect(verify()).toMatchObject({
      sampleCount: 2,
      samplesheetRowsChecked: 2,
      summaryRowsChecked: 2,
    });
    expect(() =>
      verify({ summaryRows: [summaryRows[1], summaryRows[0]] }),
    ).toThrow(/preserve samplesheet order/);
    expect(() =>
      verify({
        summaryRows: [
          [samplesheetRows[0][0], "wrong-study", samplesheetRows[0][2], "1"],
          summaryRows[1],
        ],
      }),
    ).toThrow(/preserve samplesheet order/);
    expect(() =>
      verify({
        summaryRows: [
          [...samplesheetRows[0], "0"],
          [...samplesheetRows[1], "2"],
        ],
      }),
    ).toThrow(/preserve samplesheet order/);
    expect(() =>
      verify({
        summaryHeader: [
          "sample_id",
          "study_id",
          "study_title",
          "row_number",
          "extra",
        ],
      }),
    ).toThrow(/exact study-demo contract/);
    expect(studyDemoWorkflow).toContain("def parseRfc4180Csv(String content)");
    expect(studyDemoWorkflow).toContain("content.charAt(index + 1) == '\"'");
    expect(studyDemoWorkflow).toContain(
      "records[0] != ['sample_id', 'study_id', 'study_title']",
    );
    expect(studyDemoWorkflow).not.toContain(".splitCsv(");
    expect(studyDemoWorkflow).not.toContain("awk -F','");
    expect(studyDemoWorkflow).not.toContain("python3");
  });

  it("proves every fastq-checksum summary row against exact path-bound independent md5", () => {
    const md5A = "a".repeat(32);
    const md5B = "b".repeat(32);
    const md5C = "c".repeat(32);
    const targets = [
      {
        readId: "read-1",
        sampleId: "S1",
        mate: "R1",
        configuredPath: "/data/S1_R1.fastq.gz",
        onDiskPath: "/data/S1_R1.fastq.gz",
        storedChecksum: md5A,
        computedChecksum: md5A,
      },
      {
        readId: "read-1",
        sampleId: "S1",
        mate: "R2",
        configuredPath: "/data/S1_R2.fastq.gz",
        onDiskPath: "/data/S1_R2.fastq.gz",
        storedChecksum: md5B,
        computedChecksum: md5B,
      },
      {
        readId: "read-2",
        sampleId: "S2",
        mate: "R1",
        configuredPath: "/data/S2_R1.fastq.gz",
        onDiskPath: "/data/S2_R1.fastq.gz",
        storedChecksum: md5C,
        computedChecksum: md5C,
      },
    ];
    const header = ["sample_id", "checksum1", "checksum2"];
    const rows = [
      ["S2", md5C, ""],
      ["S1", md5A, md5B],
    ];

    expect(
      assertFastqChecksumSummaryRows({
        header,
        rows,
        targets,
        context: "checksum summary proof",
      }),
    ).toMatchObject({
      expectedSampleCount: 2,
      checkedRows: 2,
      independentlyVerifiedFiles: 3,
      pairedSamples: 1,
      singleEndSamples: 1,
    });
    expect(() =>
      assertFastqChecksumSummaryRows({
        header,
        rows: [rows[0]],
        targets,
        context: "checksum summary proof",
      }),
    ).toThrow(/every target sample exactly once/);
    expect(() =>
      assertFastqChecksumSummaryRows({
        header,
        rows: [
          ["S2", md5C, md5B],
          rows[1],
        ],
        targets,
        context: "checksum summary proof",
      }),
    ).toThrow(/non-empty checksum2/);
    expect(() =>
      assertFastqChecksumSummaryRows({
        header,
        rows: [
          rows[0],
          ["S1", md5A, md5C],
        ],
        targets,
        context: "checksum summary proof",
      }),
    ).toThrow(/checksum2 does not match/);
    expect(() =>
      assertFastqChecksumSummaryRows({
        header,
        rows,
        targets: [
          ...targets,
          { ...targets[0], readId: "another-read" },
        ],
        context: "checksum summary proof",
      }),
    ).toThrow(/invalid or duplicate sample\/mate/);
    expect(() =>
      assertFastqChecksumSummaryRows({
        header,
        rows,
        targets: targets.map((target, index) =>
          index === 0 ? { ...target, onDiskPath: null } : target,
        ),
        context: "checksum summary proof",
      }),
    ).toThrow(/path-bound independent checksum evidence/);
  });

  it("requires every readable checksum target to be independently recomputed", () => {
    const md5A = "a".repeat(32);
    const md5B = "b".repeat(32);
    expect(
      assertChecksumVerificationCoverage({
        targets: [
          {
            readId: "read-1",
            sampleId: "S1",
            mate: "R1",
            configuredPath: "S1_R1.fastq.gz",
            onDiskPath: "/data/S1_R1.fastq.gz",
            storedChecksum: md5A,
            computedChecksum: md5A,
          },
          {
            readId: "read-1",
            sampleId: "S1",
            mate: "R2",
            configuredPath: "S1_R2.fastq.gz",
            onDiskPath: "/data/S1_R2.fastq.gz",
            storedChecksum: md5B,
            computedChecksum: md5B,
          },
          {
            readId: "read-2",
            sampleId: "S2",
            mate: "R1",
            configuredPath: "S2_R1.fastq.gz",
            onDiskPath: "/data/S2_R1.fastq.gz",
            storedChecksum: md5B,
            computedChecksum: md5B,
          },
        ],
        requireEveryConfiguredFile: true,
        context: "checksum fixture",
      }),
    ).toMatchObject({
      configuredR1: 2,
      configuredR2: 1,
      readableR1: 2,
      readableR2: 1,
      verifiedR1: 2,
      verifiedR2: 1,
      unresolved: [],
    });

    expect(() =>
      assertChecksumVerificationCoverage({
        targets: [
          {
            readId: "read-1",
            mate: "R1",
            onDiskPath: "/data/S1_R1.fastq.gz",
            storedChecksum: md5A,
            computedChecksum: md5A,
          },
          {
            readId: "read-2",
            mate: "R1",
            onDiskPath: "/data/S2_R1.fastq.gz",
            storedChecksum: md5B,
            computedChecksum: null,
          },
        ],
        context: "checksum fixture",
      }),
    ).toThrow(/readable checksum target read-2:R1 was not independently recomputed/);
  });

  it("keeps an unresolved checksum path in catch scope for fail-closed coverage", () => {
    const declaration = runtimeHarness.indexOf("let onDiskPath = null;");
    const resolution = runtimeHarness.indexOf(
      "onDiskPath = fs.realpathSync.native(target.configuredPath);",
      declaration,
    );
    const unresolvedTarget = runtimeHarness.indexOf(
      "verificationTargets.push({\n        ...target,\n        onDiskPath,\n        computedChecksum: null,",
      resolution,
    );

    expect(declaration).toBeGreaterThan(-1);
    expect(resolution).toBeGreaterThan(declaration);
    expect(unresolvedTarget).toBeGreaterThan(resolution);
    expect(runtimeHarness).not.toContain(
      "const onDiskPath = fs.realpathSync.native(target.configuredPath);",
    );
  });

  it("requires exact checksum equality for every independently recomputed file", () => {
    expect(() =>
      assertChecksumVerificationCoverage({
        targets: [
          {
            readId: "read-1",
            mate: "R1",
            onDiskPath: "/data/S1_R1.fastq.gz",
            storedChecksum: "a".repeat(32),
            computedChecksum: "b".repeat(32),
          },
        ],
        context: "checksum fixture",
      }),
    ).toThrow(/stored checksum does not match independently recomputed md5/);
  });

  it("keeps optional real-data checksum proof tolerant while seeded fixtures are strict", () => {
    const verified = {
      readId: "read-1",
      mate: "R1",
      configuredPath: "S1_R1.fastq.gz",
      onDiskPath: "/data/S1_R1.fastq.gz",
      storedChecksum: "a".repeat(32),
      computedChecksum: "a".repeat(32),
    };
    const unresolved = {
      readId: "read-1",
      mate: "R2",
      configuredPath: "external/S1_R2.fastq.gz",
      onDiskPath: null,
      storedChecksum: "b".repeat(32),
      computedChecksum: null,
      error: "not mounted on this host",
    };

    expect(
      assertChecksumVerificationCoverage({
        targets: [verified, unresolved],
        context: "real-data checksum",
      }),
    ).toMatchObject({
      verifiedR1: 1,
      verifiedR2: 0,
      requireEveryConfiguredFile: false,
      unresolved: [expect.objectContaining({ mate: "R2" })],
    });
    expect(() =>
      assertChecksumVerificationCoverage({
        targets: [verified, unresolved],
        requireEveryConfiguredFile: true,
        context: "seeded checksum",
      }),
    ).toThrow(/deterministic fixture requires every configured R1\/R2 file/);
  });

  it("proves a required relative output is non-empty and contains run-specific content", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-e2e-proof-"));
    try {
      const output = path.join(root, "output", "results", "fixture-report.txt");
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, "configured fixture label: run-specific-4q7x\n");

      expect(
        assertRequiredRelativeOutput({
          runFolder: root,
          relativePath: "output/results/fixture-report.txt",
          requiredContent: "run-specific-4q7x",
          context: "local fixture run",
        }),
      ).toMatchObject({
        relativePath: "output/results/fixture-report.txt",
        absolutePath: output,
        requiredContent: "run-specific-4q7x",
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects missing, empty, mismatched, absolute and escaping required outputs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-e2e-proof-"));
    try {
      const empty = path.join(root, "empty.txt");
      const report = path.join(root, "report.txt");
      fs.writeFileSync(empty, "");
      fs.writeFileSync(report, "actual-content\n");

      const verify = (relativePath: string, requiredContent?: string) =>
        assertRequiredRelativeOutput({
          runFolder: root,
          relativePath,
          requiredContent,
          context: "fixture run",
        });

      expect(() => verify("missing.txt")).toThrow(/output is missing/);
      expect(() => verify("empty.txt")).toThrow(/non-empty regular file/);
      expect(() => verify("report.txt", "wrong-content")).toThrow(
        /does not contain the expected content/,
      );
      expect(() => verify(report)).toThrow(/must be relative/);
      expect(() => verify("../outside.txt")).toThrow(/escapes the run folder/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a required-output symlink that escapes the run folder", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-e2e-proof-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-e2e-outside-"));
    try {
      const outsideReport = path.join(outside, "report.txt");
      const linkedReport = path.join(root, "report.txt");
      fs.writeFileSync(outsideReport, "fixture\n");
      fs.symlinkSync(outsideReport, linkedReport, "file");

      expect(() =>
        assertRequiredRelativeOutput({
          runFolder: root,
          relativePath: "report.txt",
          requiredContent: undefined,
          context: "fixture run",
        }),
      ).toThrow(/escapes the run folder/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("stages fixture files only after validating all inputs and restores them exactly", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-e2e-proof-"));
    try {
      const first = path.join(root, "first.fastq");
      const second = path.join(root, "second.fastq");
      fs.writeFileSync(first, "first-fixture\n");
      fs.writeFileSync(second, "second-fixture\n");

      const sabotage = stageFilesMissing({
        root,
        filePaths: [first, second, first],
      });
      expect(sabotage.moved).toHaveLength(2);
      expect(fs.existsSync(first)).toBe(false);
      expect(fs.existsSync(`${first}.seqdesk-e2e.bak`)).toBe(true);

      expect(sabotage.restore()).toMatchObject({ restoredCount: 2 });
      expect(fs.readFileSync(first, "utf8")).toBe("first-fixture\n");
      expect(fs.readFileSync(second, "utf8")).toBe("second-fixture\n");
      expect(fs.existsSync(`${first}.seqdesk-e2e.bak`)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not move any fixture when another requested input is already missing", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-e2e-proof-"));
    try {
      const existing = path.join(root, "existing.fastq");
      const missing = path.join(root, "missing.fastq");
      fs.writeFileSync(existing, "fixture\n");

      expect(() =>
        stageFilesMissing({
          root,
          filePaths: [existing, missing],
        }),
      ).toThrow(/already missing before sabotage/);
      expect(fs.readFileSync(existing, "utf8")).toBe("fixture\n");
      expect(fs.existsSync(`${existing}.seqdesk-e2e.bak`)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("makes a failed fixture restore a hard test failure", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-e2e-proof-"));
    try {
      const input = path.join(root, "input.fastq");
      fs.writeFileSync(input, "fixture\n");
      const sabotage = stageFilesMissing({ root, filePaths: [input] });
      fs.rmSync(`${input}.seqdesk-e2e.bak`);

      expect(() => sabotage.restore()).toThrow(/could not restore all sabotaged fixture files/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("checks every matching content artifact and derives MultiQC counts from captured raw evidence", () => {
    const artifactStart = runtimeHarness.indexOf(
      "async function assertArtifactContent",
    );
    const artifactEnd = runtimeHarness.indexOf(
      "async function assertStudyDemoSampleCoverage",
      artifactStart,
    );
    const artifactProof = runtimeHarness.slice(artifactStart, artifactEnd);
    expect(artifactProof).toContain("artifacts.filter(");
    expect(artifactProof).toContain("for (const artifact of matchingArtifacts)");
    expect(artifactProof).not.toContain("artifacts.find(");
    expect(runtimeHarness).toContain(
      'markers: ["number_of_reads", "mean_qual"]',
    );
    expect(runtimeHarness).not.toContain(
      'markers: ["number of reads", "mean read quality"]',
    );
    expect(runtimeHarness).toContain("assertFastqcHtmlInputFilename({");
    expect(runtimeHarness).toContain("assertReadsQcSampleArtifactRows({");
    expect(runtimeHarness).toContain(
      "assertNanoplotNanoStatsGroundTruth({",
    );
    expect(runtimeHarness).toContain("numericQuality < 0");
    expect(runtimeHarness).not.toContain("Number(qual) > 0");

    const multiqcStart = runtimeHarness.indexOf(
      "async function buildMultiqcFastqcGroundTruth",
    );
    const multiqcEnd = runtimeHarness.indexOf(
      "async function assertMultiqcAggregation",
      multiqcStart,
    );
    const multiqcProof = runtimeHarness.slice(multiqcStart, multiqcEnd);
    expect(multiqcProof).toContain("sourceRun?.pipelineId !== \"fastqc\"");
    expect(multiqcProof).toContain("sourceRun?.status !== \"completed\"");
    expect(multiqcProof).toContain("sha256OfFile(sourceFile.path)");
    expect(multiqcProof).toContain(
      "assertFastqcInputEvidenceSnapshot({",
    );
    expect(multiqcProof).toContain("evidenceEntry.inputSha256");
    expect(multiqcProof).toContain("evidenceEntry.readCount");
    expect(multiqcProof).not.toContain("computeCachedFastqGroundTruth(");
    expect(multiqcProof).not.toContain(
      "resolveHistoricalSequencingInputPath(",
    );
    expect(multiqcProof).not.toContain("bindExpectedSamplesToRunInputs({");
    expect(multiqcProof).not.toContain("exactly one active DB Read");
    expect(multiqcProof).toContain(
      "fastqcData.totalSequences !== evidenceEntry.readCount",
    );
    expect(multiqcProof).toContain(
      "sequenceCountsByIdentity.set(",
    );
    const multiqcAggregation = runtimeHarness.slice(
      multiqcEnd,
      runtimeHarness.indexOf(
        "async function assertChecksumReads",
        multiqcEnd,
      ),
    );
    expect(multiqcAggregation).toContain(
      "const expectedSamples = fastqcGroundTruth.expectedSamples;",
    );
    expect(multiqcAggregation).not.toContain("pairedEnd: r2Count > 0");
  });
});
