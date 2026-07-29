import fs from "fs";
import { load } from "js-yaml";
import path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readWorkflow = (name: string) =>
  fs.readFileSync(path.join(repoRoot, ".github", "workflows", name), "utf8");

const canonical = readWorkflow("pipeline-slurm-e2e.yml");
const mirror = readWorkflow("mirror-to-private.yml");
const almaExtended = readWorkflow("install-profile-alma.yml");
const orderPipeline = readWorkflow("order-pipeline-e2e.yml");
const studyPipeline = readWorkflow("study-pipeline-e2e.yml");
const twincoreInstall = readWorkflow("install-twincore-alma.yml");
const krakenProbe = readWorkflow("kraken-db-probe.yml");
const selfHostedWorkflows = [
  ["canonical SLURM", canonical],
  ["extended Alma install", almaExtended],
  ["order pipeline", orderPipeline],
  ["study pipeline", studyPipeline],
  ["Twincore canary install", twincoreInstall],
  ["Kraken DB probe", krakenProbe],
] as const;
const runtimeHarness = fs.readFileSync(
  path.join(repoRoot, "scripts", "run-pipeline-runtime-e2e.mjs"),
  "utf8"
);
const metaxpathSlurmLeg = fs.readFileSync(
  path.join(repoRoot, "scripts", "metaxpath-slurm-leg.sh"),
  "utf8"
);
const magSlurmLeg = fs.readFileSync(
  path.join(repoRoot, "scripts", "mag-slurm-leg.sh"),
  "utf8"
);
const almaDbCleanup = fs.readFileSync(
  path.join(repoRoot, "scripts", "cleanup-db-pipeline-runs.sh"),
  "utf8"
);
const publicOnlyWorkflows = [
  "ena-submission-e2e.yml",
  "install-e2e-ubuntu.yml",
  "install-profile-ubuntu-smoke.yml",
  "install-real-network-smoke.yml",
  "mirror-to-private.yml",
  "pipeline-submg-e2e.yml",
  "playwright.yml",
  "published-installer-drift.yml",
  "reviewer-install-matrix.yml",
  "test.yml",
] as const;

interface WorkflowDocument {
  jobs?: Record<string, { if?: string }>;
}

describe("self-hosted pipeline CI contract", () => {
  it.each(publicOnlyWorkflows)(
    "keeps every %s job out of the private CI mirror",
    (workflowName) => {
      const workflow = load(readWorkflow(workflowName)) as WorkflowDocument;
      const jobs = Object.entries(workflow.jobs || {});

      expect(jobs.length).toBeGreaterThan(0);
      for (const [jobName, job] of jobs) {
        expect(
          job.if,
          `${workflowName}/${jobName} must be guarded to the public repository`
        ).toContain("github.repository == 'hzi-bifo/SeqDesk'");
      }
    }
  );

  it.each(selfHostedWorkflows)(
    "keeps the %s workflow read-only and free of scheduled triggers",
    (_name, workflow) => {
      expect(workflow).toContain("permissions:\n  contents: read");
      expect(workflow).not.toContain("contents: write");
      expect(workflow).not.toMatch(/^\s*contents:\s*write\s*$/m);
      expect(workflow).not.toMatch(/^\s*git\b[^\n]*\bpush\b/m);
      expect(workflow).not.toContain("schedule:");
      expect(workflow).not.toContain("cron:");
    }
  );

  it("runs the canonical private acceptance gate on mirrored main changes, never a timer", () => {
    expect(canonical).toContain("push:\n    branches: [main]");
    expect(canonical).toContain("workflow_dispatch:");
    expect(canonical).not.toContain("schedule:");
    expect(canonical).not.toContain("cron:");
    expect(canonical).toContain(
      "github.repository == 'hzi-bifo/SeqDesk-ci'"
    );
  });

  it("mirrors public main changes only and fails closed when the private gate cannot be triggered", () => {
    expect(mirror).toContain("push:\n    branches: [main]");
    expect(mirror).toContain("workflow_dispatch:");
    expect(mirror).not.toContain("schedule:");
    expect(mirror).not.toContain("cron:");
    expect(mirror).toContain(
      "github.repository == 'hzi-bifo/SeqDesk'"
    );

    const missingSecretGuard = mirror.slice(
      mirror.indexOf('if [ -z "${MIRROR_SSH_KEY:-}" ]'),
      mirror.indexOf("mkdir -p ~/.ssh")
    );
    expect(missingSecretGuard).toContain("exit 1");
    expect(missingSecretGuard).not.toContain("exit 0");
    expect(missingSecretGuard).toContain(
      "the required private CI gate cannot run"
    );
  });

  it("pins supported Node 24 without adding the pipeline environment to the global PATH", () => {
    expect(canonical).toContain("nodejs=24");
    expect(canonical).toContain("SEQDESK_NODE_BIN=");
    expect(canonical).toContain("NODE_OPTIONS: --max-old-space-size=8192");
    expect(canonical).toContain("npm run build -- --webpack");
    expect(canonical).not.toContain(
      'echo "$SLURM_SHARED_CONDA_ENV/bin" >> "$GITHUB_PATH"'
    );
    expect(canonical).not.toContain(
      'echo "$CONDA_BASE/envs/$PIPELINE_CONDA_ENV/bin" >> "$GITHUB_PATH"'
    );
  });

  it("makes installation, readiness, auth, local execution, and SLURM execution required", () => {
    const installGate = canonical.slice(
      canonical.indexOf(
        "- name: Install SeqDesk + run pipelines on the installed app (required)"
      ),
      canonical.indexOf("- name: Collect SLURM + pipeline diagnostics")
    );

    expect(installGate).not.toContain("continue-on-error:");
    expect(installGate).toContain('if [ "$INSTALLED_READY" != "1" ]');
    expect(installGate).toContain("Installed SeqDesk is ready and exposes authentication.");
    expect(installGate).toContain("run_installed fastq-checksum-default");
    expect(installGate).toContain("--include-default-policy --expect-default-mode slurm");
    expect(installGate).toContain("run_installed fastq-checksum-local");
    expect(installGate).toContain('unset PORT DATABASE_URL DIRECT_URL');
    expect(installGate).toContain("unset SEQDESK_PIPELINES_DIR");
    expect(installGate).not.toContain(
      '[ -n "${SEQDESK_PIPELINES_DIR:-}" ] && export SEQDESK_PIPELINES_DIR'
    );
    expect(installGate).toContain('export SEQDESK_CONDA_CACHE_DIR="$INSTALLED_CONDA_CACHE"');
    expect(installGate).toContain(
      'if [ -f "$APP_DIR/current/scripts/apply-install-profile.mjs" ]'
    );
    expect(installGate).toContain(
      'INSTALLED_RELEASE_DIR="$(cd "$APP_DIR/current" && pwd -P)"'
    );
    expect(installGate).toContain(
      'elif [ -f "$APP_DIR/scripts/apply-install-profile.mjs" ]'
    );
    expect(installGate).toContain(
      '( cd "$INSTALLED_RELEASE_DIR" && DATABASE_URL="$INSTALLED_DB_URL"'
    );
    expect(installGate).toContain("assert.equal(config.pipelines?.enabled, true)");
    expect(installGate).toContain(
      'assert.equal(config.pipelines?.execution?.mode, "slurm")'
    );
    expect(installGate).toContain(
      "assert.equal(config.runtime?.directUrl, process.env.EXPECTED_DB_URL)"
    );
    expect(installGate).toContain("Installer persistence verified in config file and SiteSettings.");
    expect(installGate).toContain(
      'const { createRequire } = require("node:module")'
    );
    expect(installGate).toContain(
      'fs.existsSync(path.join("current", "package.json"))'
    );
    expect(installGate).toContain(
      'const { PrismaClient } = requireFromInstall("@prisma/client")'
    );
    expect(installGate).not.toContain(
      'const { PrismaClient } = require("@prisma/client")'
    );
    expect(installGate).toContain(
      'curl -fsS "http://127.0.0.1:$INSTALLED_PORT/api/version"'
    );
    expect(installGate).toContain(
      'INSTALLED_PROCESS_STATE="$(seqdesk_ci_pid_state "$INSTALLED_APP_PID")"'
    );
    expect(installGate).toContain(
      'PACKAGED_PIPELINES_ROOT="$INSTALLED_RELEASE_DIR/pipelines"'
    );
    expect(installGate).not.toContain(
      'PACKAGED_PIPELINES_ROOT="$APP_DIR/current/pipelines"'
    );
    expect(installGate).toContain(
      'grep -R -F -l --include=\'run.sh\' -- "$expected_target" "$INSTALLED_RUNS"'
    );
    expect(installGate).toContain("SEQDESK_EXEC_SLURM_TIME_LIMIT=1");
    expect(installGate).toContain("SEQDESK_RUNTIME_E2E_SLURM_TIME_LIMIT=1");
    expect(installGate).not.toContain("SEQDESK_EXEC_SLURM_TIME_LIMIT=10");
    expect(installGate).not.toContain("SEQDESK_RUNTIME_E2E_SLURM_TIME_LIMIT=10");
  });

  it("bounds cleanup to this run before switching apps or deleting shared trees", () => {
    const sourceBoot = canonical.slice(
      canonical.indexOf("- name: Boot SeqDesk app and verify readiness"),
      canonical.indexOf("- name: Run runtime pipeline E2E")
    );
    const stopSource = canonical.slice(
      canonical.indexOf("- name: Stop SeqDesk app"),
      canonical.indexOf(
        "- name: Install SeqDesk + run pipelines on the installed app (required)"
      )
    );
    const cleanup = canonical.slice(
      canonical.indexOf("- name: Cleanup resources")
    );

    expect(canonical).toContain("seqdesk_ci_process_group_identity_state()");
    expect(canonical).toContain("seqdesk_ci_process_group_state()");
    expect(canonical).toContain("seqdesk_ci_pid_state()");
    expect(canonical).toContain("seqdesk_ci_pid_identity_state()");
    expect(canonical).toContain("seqdesk_ci_slurm_job_state()");
    expect(canonical).toContain("seqdesk_ci_slurm_job_identity_state()");
    expect(canonical).toContain(
      'if ($field == script) found = 1'
    );
    expect(canonical).toContain(
      '[ "$job_name" = "$expected_job_name" ]'
    );
    expect(canonical).toContain(
      '[ "$work_dir" = "$run_folder" ]'
    );
    expect(canonical).toContain(
      "where coalesce(\\\"queueJobId\\\", '') <> ''"
    );
    expect(canonical).not.toContain(
      "where status in ('pending','queued','running')"
    );
    expect(canonical).toContain(
      '[[ "$run_folder" != "$run_root/"* ]]'
    );
    expect(canonical).toContain(
      "SEQDESK_STAGED_PIPELINES_DIR=$SHARED_BASE/ci-seqdesk-pipelines-$RUN_SUFFIX"
    );
    expect(sourceBoot).toContain(
      'SHARED_PIPELINES_DIR="$SEQDESK_STAGED_PIPELINES_DIR"'
    );
    expect(sourceBoot).not.toContain(
      'SHARED_PIPELINES_DIR="$(dirname "$SLURM_SHARED_RUN_ROOT")/pipelines"'
    );
    expect(canonical).toContain("for _ in $(seq 1 30)");
    expect(canonical).toContain(
      "while IFS='|' read -r kind queue_id run_folder expected_job_name"
    );
    expect(canonical).toContain(
      'process_state="$(seqdesk_ci_process_group_state "$queue_id")"'
    );
    expect(canonical).toContain('kill -KILL -- "-$queue_id"');
    expect(stopSource).toContain(
      'seqdesk_ci_cancel_pipeline_runs "${DB_NAME:-}" "${SEQDESK_RUN_DIR:-}"'
    );
    expect(stopSource).toContain(
      'seqdesk_ci_stop_child "${APP_PID:-}" "source SeqDesk app" "$GITHUB_WORKSPACE"'
    );
    expect(stopSource).toContain('echo "APP_PID=" >> "$GITHUB_ENV"');
    expect(cleanup).toContain('if [ "$pipeline_cleanup_fail" = 0 ]');
    expect(cleanup).toContain('"${SEQDESK_STAGED_PIPELINES_DIR:-}"');
    expect(cleanup).not.toContain(
      'rm -rf "$(dirname "$SLURM_SHARED_RUN_ROOT")/pipelines"'
    );
    expect(cleanup).toContain(
      "preserving source data/run/pipeline trees because a scoped process survived cleanup"
    );
    expect(canonical).toContain(
      "its exact run.sh identity is $identity_state; preserving the run tree"
    );
    expect(canonical).toContain("printf '%s\\n' unknown");
    expect(canonical).toContain(
      "final SLURM state for $queue_id is unknown; preserving the run tree"
    );
    expect(canonical).toContain(
      "final process-group state for $queue_id is unknown; preserving the run tree"
    );
    expect(canonical).toContain(
      "state of $label PID $pid is unknown; preserving its tree"
    );
    expect(canonical).toContain(
      'if ! processes="$(ps -eo pgid=,stat= 2>/dev/null)"; then'
    );
    expect(canonical).toContain(
      'if ! processes="$(ps -eo pid=,stat= 2>/dev/null)"; then'
    );
  });

  it("drains all active stale canonical jobs only after revalidating exact identity", () => {
    const staleCleanup = canonical.slice(
      canonical.indexOf(
        "- name: Free stale SLURM jobs from prior runs (QOS submit-slot cleanup)"
      ),
      canonical.indexOf("- name: Create pipeline Conda environment")
    );
    const ownershipGuard =
      '[[ "$work_dir" == "$SLURM_SHARED_RUN_ROOT"/ci-seqdesk-runs-*/* ]]';
    const cancelCall = 'scancel "$job_id"';

    expect(canonical).toContain(
      'SEQDESK_RUN_DIR=$SHARED_BASE/ci-seqdesk-runs-$RUN_SUFFIX'
    );
    expect(staleCleanup).not.toContain("-t PENDING");
    expect(staleCleanup).toContain("-o '%i|%j|%T'");
    expect(staleCleanup).toContain('[[ "$listed_job_name" == seqdesk-* ]]');
    expect(staleCleanup).toContain(
      'if ! info="$(scontrol show job -o "$job_id" 2>/dev/null)"; then'
    );
    expect(staleCleanup).toContain(ownershipGuard);
    expect(staleCleanup).toContain(
      'seqdesk_ci_slurm_job_identity_state'
    );
    expect(staleCleanup).toContain(cancelCall);
    expect(staleCleanup.indexOf(ownershipGuard)).toBeLessThan(
      staleCleanup.indexOf(cancelCall)
    );
    expect(staleCleanup).toContain("for _ in $(seq 1 24)");
    expect(staleCleanup).toContain('done < "$STALE_FILE"');
    expect(staleCleanup).toContain(
      "is still active after the bounded canonical-CI drain"
    );
    expect(staleCleanup).toContain(
      "could not query active SLURM jobs; refusing to start"
    );
    expect(staleCleanup).not.toContain(
      "squeue -u \"$ME\" -h -o '%i|%j|%T' 2>/dev/null || true"
    );
    expect(staleCleanup).not.toContain("xargs");
  });

  it("requires a second ownership-checked source drain before the installed app starts", () => {
    const installGate = canonical.slice(
      canonical.indexOf(
        "- name: Install SeqDesk + run pipelines on the installed app (required)"
      ),
      canonical.indexOf(
        'if [ "$(node -p \'process.versions.node.split(".")[0]\')" != "24" ]'
      )
    );
    const lines = installGate.split("\n").map((line) => line.trim());
    const requiredSequence = [
      'source "$SEQDESK_CI_CLEANUP_HELPER"',
      'seqdesk_ci_cancel_pipeline_runs "$DB_NAME" "$SEQDESK_RUN_DIR"',
      'seqdesk_ci_stop_child "${APP_PID:-}" "source SeqDesk app" "$GITHUB_WORKSPACE"',
      'seqdesk_ci_stop_monitors "$GITHUB_WORKSPACE"',
      'echo "APP_PID=" >> "$GITHUB_ENV"',
    ];

    expect(installGate).toContain("set -euo pipefail");
    let previousIndex = -1;
    for (const command of requiredSequence) {
      expect(lines).toContain(command);
      const currentIndex = lines.indexOf(command);
      expect(currentIndex).toBeGreaterThan(previousIndex);
      previousIndex = currentIndex;
    }
  });

  it("collects only this CI run's SeqDesk SLURM accounting and log paths", () => {
    const diagnostics = canonical.slice(
      canonical.indexOf("- name: Collect SLURM + pipeline diagnostics"),
      canonical.indexOf("- name: Upload SLURM pipeline E2E artifacts")
    );

    expect(diagnostics).toContain("--starttime=now-4hours");
    expect(diagnostics).toContain("$2 ~ /^seqdesk-/");
    expect(diagnostics).toContain("beneath($6, source_root)");
    expect(diagnostics).toContain("beneath($6, installed_root)");
    expect(diagnostics).toContain('done < "$CI_SLURM_IDS"');
    expect(diagnostics).not.toContain("--starttime=now-2hours");
    expect(diagnostics).not.toContain(
      'sacct -u "$USER" --starttime=now-2hours'
    );
  });

  it("keeps long infrastructure diagnostics out of the mirrored-push gate", () => {
    const readCleaningStep = canonical.slice(
      canonical.indexOf("- name: Run read-cleaning E2E"),
      canonical.indexOf("- name: Run SLURM-only pipeline smoke")
    );
    const canaryStep = canonical.slice(
      canonical.indexOf("- name: SLURM shared-filesystem canary"),
      canonical.indexOf("- name: Stop SeqDesk app")
    );

    expect(readCleaningStep).toContain(
      "github.event_name == 'workflow_dispatch'"
    );
    expect(canaryStep).toContain("github.event_name == 'workflow_dispatch'");
    expect(canaryStep).toContain(
      'CANARY_JOB_NAME="seqdesk-canary-$CANARY_SUFFIX"'
    );
    expect(canaryStep).toContain(
      'HOME_DIR="$HOME/seqdesk-ci-canary-$CANARY_SUFFIX"'
    );
    expect(canaryStep).toContain(
      'seqdesk_ci_slurm_job_identity_state'
    );
    expect(canaryStep).toContain('scancel "$job_id"');
    expect(canaryStep).toContain(
      'echo "SEQDESK_CANARY_CLEANUP_FAILED=1" >> "$GITHUB_ENV"'
    );
    expect(canaryStep).toContain(
      'preserving canary paths $HOME_DIR and $WORK_DIR'
    );
  });

  it("cancels only the exact captured read-cleaning PipelineRun after ownership checks", () => {
    const readCleaningStep = canonical.slice(
      canonical.indexOf("- name: Run read-cleaning E2E"),
      canonical.indexOf("- name: Run SLURM-only pipeline smoke")
    );

    expect(readCleaningStep).toContain(
      '--run-state-file "$RC_STATE_FILE"'
    );
    expect(readCleaningStep).toContain(
      'where id=\'$RC_RUN_ID\''
    );
    expect(readCleaningStep).toContain(
      '"$RC_JOB_ID" "$RC_DB_RUN_FOLDER" "seqdesk-$RC_RUN_ID"'
    );
    expect(readCleaningStep).toContain(
      'RC_JOB_STATE="$(seqdesk_ci_slurm_job_state "$RC_JOB_ID")"'
    );
    expect(readCleaningStep).toContain('scancel "$RC_JOB_ID"');
    expect(readCleaningStep).not.toContain("jobs_before");
    expect(readCleaningStep).not.toContain("new_jobs");
    expect(readCleaningStep).not.toContain("squeue -u");
  });

  it.each([
    ["metaxpath", metaxpathSlurmLeg],
    ["mag", magSlurmLeg],
  ])(
    "cancels only the exact captured %s PipelineRun allocation",
    (_name, script) => {
      expect(script).toContain('--run-state-file "$CURRENT_STATE_FILE"');
      expect(script).toContain("cancel_captured_run()");
      expect(script).toContain('expected_job_name="seqdesk-$safe_run_id"');
      expect(script).toContain("slurm_job_state()");
      expect(script).toContain("slurm_job_identity_state()");
      expect(script).toContain("printf '%s\\n' unknown");
      expect(script).toContain('[ "$actual_job_name" = "$expected_job_name" ]');
      expect(script).toContain('[ "$actual_work_dir" = "$run_folder" ]');
      expect(script).toContain(
        '[[ "$resolved_run" != "$profile_root/"* ]]'
      );
      expect(script).toContain('if [ -z "$job_id" ]; then');
      expect(script).toContain(
        'from \\"PipelineRun\\" where id=\'$run_id\''
      );
      expect(script).toContain('job_id="$db_job_id"');
      expect(script).toContain('run_folder="$db_run_folder"');
      expect(script).toContain("for _ in $(seq 1 24)");
      expect(script).toContain("SEQDESK_SLURM_CLEANUP_GUARD");
      expect(script).not.toContain("squeue -u");
      expect(script).not.toContain("xargs");
      expect(script).not.toContain("newjobs");
      expect(script).not.toContain('before="$(squeue');
    }
  );

  it("DB-scopes every Alma queue id and preserves trees on cleanup uncertainty", () => {
    expect(almaExtended).toContain(
      "SEQDESK_SLURM_CLEANUP_GUARD=$RUNNER_TEMP/profile-slurm-cleanup-unsafe-$RUN_SUFFIX"
    );
    expect(almaExtended).toContain(
      'bash "$GITHUB_WORKSPACE/scripts/metaxpath-slurm-leg.sh" "$PORT"'
    );
    expect(almaExtended).toContain(
      'bash "$GITHUB_WORKSPACE/scripts/mag-slurm-leg.sh" "$PORT"'
    );
    expect(almaExtended).not.toContain(
      'bash "$GITHUB_WORKSPACE/scripts/metaxpath-slurm-leg.sh" "$PORT" || true'
    );
    expect(almaExtended).not.toContain(
      'bash "$GITHUB_WORKSPACE/scripts/mag-slurm-leg.sh" "$PORT" || true'
    );
    expect(almaExtended).toContain(
      '[ -e "$SEQDESK_SLURM_CLEANUP_GUARD" ]'
    );
    expect(almaExtended).toContain(
      'if [ "$cleanup_safe" = 1 ]; then'
    );
    expect(
      almaExtended.split("scripts/cleanup-db-pipeline-runs.sh").length - 1
    ).toBe(2);
    expect(almaExtended).not.toContain("-mtime +1 -exec rm -rf");
    expect(almaDbCleanup).toContain(
      "where coalesce(\\\"queueJobId\\\", '') <> ''"
    );
    expect(almaDbCleanup).not.toContain(
      "where status in ('pending','queued','running')"
    );
    expect(almaDbCleanup).toContain("process_group_identity_state()");
    expect(almaDbCleanup).toContain("process_group_state()");
    expect(almaDbCleanup).toContain("slurm_job_state()");
    expect(almaDbCleanup).toContain("slurm_identity_state()");
    expect(almaDbCleanup).toContain("printf '%s\\n' unknown");
    expect(almaDbCleanup).toContain('kill -KILL -- "-$queue_id"');
    expect(almaDbCleanup).toContain('scancel "$queue_id"');
    expect(almaDbCleanup).toContain(
      'if [ "$job_state" != "inactive" ]; then'
    );
    expect(almaDbCleanup).toContain(
      'if [ "$process_state" != "inactive" ]; then'
    );
    expect(almaDbCleanup).toContain(
      'if ! processes="$(ps -eo pgid=,stat= 2>/dev/null)"; then'
    );
  });

  it("requires terminal, owned, allocated sacct evidence for every SLURM runtime run", () => {
    expect(runtimeHarness).toContain(
      "async function assertSlurmAccounting"
    );
    expect(runtimeHarness).toContain(
      "--format=JobIDRaw,JobName%128,State,ExitCode,WorkDir%220,NodeList"
    );
    expect(runtimeHarness).toContain(
      'latest.jobName.startsWith("seqdesk-")'
    );
    expect(runtimeHarness).toContain(
      "pathIsWithin(latest.workDir, runFolder)"
    );
    expect(runtimeHarness).toContain(
      'latest.exitCode !== "0:0"'
    );
    expect(runtimeHarness).toContain(
      'state === "COMPLETED"'
    );
    expect(runtimeHarness).toContain(
      "SLURM accounting did not record an allocated node"
    );

    const runFilesGate = runtimeHarness.slice(
      runtimeHarness.indexOf("async function assertRunFiles"),
      runtimeHarness.indexOf("const MD5_HEX")
    );
    expect(runFilesGate).toContain(
      "await assertSlurmAccounting({ jobId, runFolder })"
    );
  });

  it("attributes every mode's read writeback to the exact pipeline run", () => {
    expect(runtimeHarness).toContain(
      "sources[pipelineId] !== runId"
    );
    expect(runtimeHarness).toContain(
      'read.pipelineRunId === runId'
    );
    expect(runtimeHarness).not.toContain("checksum1-fallback");

    const defaultPolicyBlock = runtimeHarness.slice(
      runtimeHarness.indexOf("if (includeDefaultPolicy)"),
      runtimeHarness.indexOf("\n  return {", runtimeHarness.indexOf("if (includeDefaultPolicy)"))
    );
    expect(defaultPolicyBlock).toContain(
      "const writeback = await assertPipelineWriteback"
    );
    expect(defaultPolicyBlock).toContain("writeback,");
  });

  it("keeps the extended Alma matrix manual and builds it on the self-hosted runner", () => {
    expect(almaExtended).toContain("workflow_dispatch:");
    expect(almaExtended).not.toContain("schedule:");

    const buildJob = almaExtended.slice(
      almaExtended.indexOf("build-install-artifacts:"),
      almaExtended.indexOf("install-without-profile:")
    );
    expect(buildJob).toContain("group: bifo_dmz");
    expect(buildJob).not.toContain("ubuntu-latest");
  });

  it.each([
    ["order", orderPipeline],
    ["study", studyPipeline],
  ])("routes %s package tests directly to the private runner", (_name, workflow) => {
    const selfHosted = workflow.slice(workflow.indexOf("  self_hosted:"));
    expect(selfHosted).not.toContain("needs: github_hosted");
    expect(selfHosted).toContain(
      "github.repository == 'hzi-bifo/SeqDesk-ci'"
    );
    expect(selfHosted).toContain(
      "github.event_name == 'workflow_dispatch'"
    );
    expect(selfHosted).toContain("inputs.run_self_hosted");
  });
});
