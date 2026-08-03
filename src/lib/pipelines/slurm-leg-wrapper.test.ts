import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const temporaryRoots: string[] = [];
const wrappers = [
  { pipelineId: "mag", scriptName: "mag-slurm-leg.sh" },
  { pipelineId: "metaxpath", scriptName: "metaxpath-slurm-leg.sh" },
] as const;

type RuntimeOutcome = "success" | "skipped" | "no-state";

function writeExecutable(filePath: string, contents: string): void {
  fs.writeFileSync(filePath, contents, "utf8");
  fs.chmodSync(filePath, 0o755);
}

function runWrapper(
  wrapper: (typeof wrappers)[number],
  outcome: RuntimeOutcome
): { output: string; status: number | null; error?: Error } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seqdesk-slurm-leg-"));
  temporaryRoots.push(root);

  const workspace = path.join(root, "workspace");
  const workspaceScripts = path.join(workspace, "scripts");
  const runnerTemp = path.join(root, "runner-temp");
  const runRoot = path.join(root, "runs");
  const commandBin = path.join(root, "bin");
  fs.mkdirSync(workspaceScripts, { recursive: true });
  fs.mkdirSync(runnerTemp, { recursive: true });
  fs.mkdirSync(runRoot, { recursive: true });
  fs.mkdirSync(commandBin, { recursive: true });

  fs.writeFileSync(
    path.join(workspaceScripts, "run-pipeline-runtime-e2e.mjs"),
    `
import fs from "node:fs";

const args = process.argv.slice(2);
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const pipelineId = valueFor("--pipeline-id");
const stateFile = valueFor("--run-state-file");
const outcome = process.env.SEQDESK_TEST_RUNTIME_OUTCOME;

if (outcome === "skipped") {
  const state = { skipped: true, reason: "pipeline-not-enabled", pipelineId };
  fs.writeFileSync(stateFile, JSON.stringify(state));
  process.stdout.write(JSON.stringify(state) + "\\n");
  process.exit(0);
}

if (outcome === "success") {
  const state = {
    pipelineId,
    runId: pipelineId + "-run-1",
    jobId: "12345",
    runFolder: process.env.SEQDESK_TEST_RUN_FOLDER,
    requestedExecutionMode: "slurm",
    resolvedExecutionMode: "slurm",
  };
  fs.writeFileSync(stateFile, JSON.stringify(state));
  process.stdout.write(JSON.stringify({ success: true }) + "\\n");
  process.exit(0);
}

process.stdout.write(JSON.stringify({ success: true, stateWritten: false }) + "\\n");
process.exit(0);
`,
    "utf8"
  );

  writeExecutable(path.join(commandBin, "sleep"), "#!/bin/sh\nexit 0\n");
  writeExecutable(path.join(commandBin, "squeue"), "#!/bin/sh\nexit 0\n");
  writeExecutable(
    path.join(commandBin, "readlink"),
    '#!/bin/sh\nif [ "$1" = "-f" ]; then\n  printf \'%s\\n\' "$2"\nelse\n  /usr/bin/readlink "$@"\nfi\n'
  );

  const runFolder = path.join(runRoot, `${wrapper.pipelineId}-run-1`);
  fs.mkdirSync(runFolder, { recursive: true });
  const result = spawnSync(
    "/bin/bash",
    [path.join(repoRoot, "scripts", wrapper.scriptName), "39999"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 5_000,
      env: {
        ...process.env,
        PATH: `${commandBin}:${process.env.PATH || ""}`,
        GITHUB_WORKSPACE: workspace,
        GITHUB_RUN_ID: "wrapper-test",
        GITHUB_RUN_ATTEMPT: "1",
        PROFILE_RUN_DIR: runRoot,
        RUNNER_TEMP: runnerTemp,
        SEQDESK_TEST_RUNTIME_OUTCOME: outcome,
        SEQDESK_TEST_RUN_FOLDER: runFolder,
      },
    }
  );

  return {
    output: `${result.stdout || ""}${result.stderr || ""}`,
    status: result.status,
    error: result.error,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("optional SLURM leg wrappers", () => {
  it.each(wrappers)(
    "$pipelineId prints OK only with a proven SLURM run state",
    (wrapper) => {
      const result = runWrapper(wrapper, "success");

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.output).toContain(`${wrapper.pipelineId} SLURM leg OK`);
    }
  );

  it.each(wrappers)(
    "$pipelineId reports a disabled pipeline as SKIPPED, never OK",
    (wrapper) => {
      const result = runWrapper(wrapper, "skipped");

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.output).toContain(`${wrapper.pipelineId} SLURM leg SKIPPED`);
      expect(result.output).not.toContain(`${wrapper.pipelineId} SLURM leg OK`);
    }
  );

  it.each(wrappers)(
    "$pipelineId rejects an exit-zero harness result with no PipelineRun state",
    (wrapper) => {
      const result = runWrapper(wrapper, "no-state");

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.output).toContain(
        "runtime harness exited successfully without a proven SLURM PipelineRun state"
      );
      expect(result.output).toContain("WARN (warn-only)");
      expect(result.output).not.toContain(`${wrapper.pipelineId} SLURM leg OK`);
    }
  );
});
