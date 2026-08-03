import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  assertNoReservedSlurmPathOptions,
  buildSlurmCompletionAttestationBlock,
  buildSlurmWrapperFinalizerBlock,
  renderSlurmChdirDirective,
  WRITE_SLURM_COMPLETION_ATTESTATION_COMMAND,
} from "./slurm-completion-attestation";

const execFileAsync = promisify(execFile);

describe("SLURM completion attestation shell block", () => {
  it("renders spaces and apostrophes safely but rejects SBATCH-breaking paths", () => {
    const safePath = "/shared/SeqDesk runs/O'Brien";
    expect(renderSlurmChdirDirective(safePath)).toBe(
      `#SBATCH -D "${safePath}"`,
    );
    expect(buildSlurmWrapperFinalizerBlock(safePath)).toContain(
      `RUN_FOLDER='/shared/SeqDesk runs/O'"'"'Brien'`,
    );

    for (const unsafePath of [
      '/shared/bad"quote',
      "/shared/bad\nnewline",
      "/shared/bad`command",
      "/shared/bad$value",
      "/shared/bad\\escape",
      "/shared/bad\u0000nul",
    ]) {
      expect(() => renderSlurmChdirDirective(unsafePath)).toThrow(
        /unsafe characters for an SBATCH directive/,
      );
      expect(() => buildSlurmWrapperFinalizerBlock(unsafePath)).toThrow(
        /unsafe characters for an SBATCH directive/,
      );
    }
  });

  it("rejects admin options that can override WorkDir or capture paths", () => {
    for (const options of [
      "--output /tmp/other.out",
      "--output=/tmp/other.out",
      "-o /tmp/other.out",
      "-o/tmp/other.out",
      "--error=/tmp/other.err",
      "-e/tmp/other.err",
      "--chdir /tmp/other",
      "-D/tmp/other",
    ]) {
      expect(() => assertNoReservedSlurmPathOptions(options)).toThrow(
        /overrides SeqDesk-owned WorkDir or capture-log paths/,
      );
    }
    expect(() =>
      assertNoReservedSlurmPathOptions("--gres=gpu:1 --exclusive"),
    ).not.toThrow();
  });

  it("atomically records the actual allocation only after the success command runs", async () => {
    const runFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-slurm-attestation-"),
    );
    try {
      await fs.mkdir(path.join(runFolder, "logs"));
      const block = buildSlurmCompletionAttestationBlock({
        runId: "run-'quoted",
        runFolder,
      });
      await execFileAsync(
        "bash",
        [
          "-c",
          `${block}\nSEQDESK_CAPTURE_LOGS_COPIED=1\n${WRITE_SLURM_COMPLETION_ATTESTATION_COMMAND}\n`,
        ],
        {
          env: {
            ...process.env,
            SLURM_JOB_ID: "4711",
            SLURMD_NODENAME: "compute-01.cluster.example",
          },
        },
      );

      const attestationPath = path.join(
        runFolder,
        "logs",
        "slurm-4711.attestation",
      );
      await expect(fs.readFile(attestationPath, "utf8")).resolves.toBe(
        [
          "schema_version=1",
          "run_id=run-'quoted",
          "slurm_job_id=4711",
          "host=compute-01.cluster.example",
          "phase=completed",
          "exit_code=0",
          "",
        ].join("\n"),
      );
      const stat = await fs.stat(attestationPath);
      expect(stat.mode & 0o777).toBe(0o600);
      expect(
        (await fs.readdir(path.join(runFolder, "logs"))).filter((name) =>
          name.includes(".tmp."),
        ),
      ).toEqual([]);
    } finally {
      await fs.rm(runFolder, { recursive: true, force: true });
    }
  });

  it("writes success evidence only after the EXIT trap copies both capture logs", async () => {
    const runFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-slurm-finalizer-success-"),
    );
    const jobId = `${process.pid}91`;
    const localStdout = `/tmp/seqdesk-slurm-${jobId}.out`;
    const localStderr = `/tmp/seqdesk-slurm-${jobId}.err`;
    try {
      await fs.mkdir(path.join(runFolder, "logs"));
      await fs.writeFile(localStdout, "captured stdout\n");
      await fs.writeFile(localStderr, "captured stderr\n");
      const finalizer = buildSlurmWrapperFinalizerBlock(runFolder);
      const attestation = buildSlurmCompletionAttestationBlock({
        runId: "run-causal",
        runFolder,
      });

      expect(
        finalizer.indexOf(
          'cp -f "/tmp/seqdesk-slurm-$SLURM_JOB_ID.err"',
        ),
      ).toBeLessThan(
        finalizer.indexOf(
          `elif ! ${WRITE_SLURM_COMPLETION_ATTESTATION_COMMAND}; then`,
        ),
      );

      await execFileAsync(
        "bash",
        ["-c", ["set -euo pipefail", finalizer, attestation, "true"].join("\n")],
        {
          env: {
            ...process.env,
            SLURM_JOB_ID: jobId,
            SLURMD_NODENAME: "compute-03",
          },
        },
      );

      await expect(
        fs.readFile(path.join(runFolder, "logs", `slurm-${jobId}.out`), "utf8"),
      ).resolves.toBe("captured stdout\n");
      await expect(
        fs.readFile(path.join(runFolder, "logs", `slurm-${jobId}.err`), "utf8"),
      ).resolves.toBe("captured stderr\n");
      await expect(
        fs.readFile(
          path.join(runFolder, "logs", `slurm-${jobId}.attestation`),
          "utf8",
        ),
      ).resolves.toContain("run_id=run-causal\n");
    } finally {
      await fs.rm(localStdout, { force: true });
      await fs.rm(localStderr, { force: true });
      await fs.rm(runFolder, { recursive: true, force: true });
    }
  });

  it("fails closed instead of attesting success when capture logs cannot be copied", async () => {
    const runFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-slurm-finalizer-fail-closed-"),
    );
    const jobId = `${process.pid}92`;
    const localStdout = `/tmp/seqdesk-slurm-${jobId}.out`;
    const localStderr = `/tmp/seqdesk-slurm-${jobId}.err`;
    try {
      await fs.mkdir(path.join(runFolder, "logs"));
      await fs.rm(localStdout, { force: true });
      await fs.rm(localStderr, { force: true });
      const script = [
        "set -euo pipefail",
        buildSlurmWrapperFinalizerBlock(runFolder),
        buildSlurmCompletionAttestationBlock({
          runId: "run-no-captures",
          runFolder,
        }),
        "true",
      ].join("\n");

      await expect(
        execFileAsync("bash", ["-c", script], {
          env: {
            ...process.env,
            SLURM_JOB_ID: jobId,
            SLURMD_NODENAME: "compute-04",
          },
        }),
      ).rejects.toMatchObject({ code: 1 });
      await expect(
        fs.stat(path.join(runFolder, "logs", `slurm-${jobId}.attestation`)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        fs.readFile(path.join(runFolder, "logs", "pipeline.err"), "utf8"),
      ).resolves.toContain(
        "Failed to persist SLURM capture logs; refusing success attestation",
      );
      await expect(
        fs.readFile(path.join(runFolder, "logs", "pipeline.out"), "utf8"),
      ).resolves.toContain("Pipeline completed with exit code: 1");
    } finally {
      await fs.rm(localStdout, { force: true });
      await fs.rm(localStderr, { force: true });
      await fs.rm(runFolder, { recursive: true, force: true });
    }
  });

  it("does not create success evidence merely by loading the wrapper block", async () => {
    const runFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-slurm-attestation-"),
    );
    try {
      await fs.mkdir(path.join(runFolder, "logs"));
      const block = buildSlurmCompletionAttestationBlock({
        runId: "run-1",
        runFolder,
      });
      await execFileAsync("bash", ["-c", block], {
        env: {
          ...process.env,
          SLURM_JOB_ID: "4712",
          SLURMD_NODENAME: "compute-02",
        },
      });
      await expect(
        fs.stat(path.join(runFolder, "logs", "slurm-4712.attestation")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(runFolder, { recursive: true, force: true });
    }
  });

  it("rejects a success-attestation call before capture persistence", async () => {
    const runFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-slurm-attestation-guard-"),
    );
    try {
      await fs.mkdir(path.join(runFolder, "logs"));
      const block = buildSlurmCompletionAttestationBlock({
        runId: "run-guarded",
        runFolder,
      });
      await expect(
        execFileAsync(
          "bash",
          ["-c", `${block}\n${WRITE_SLURM_COMPLETION_ATTESTATION_COMMAND}\n`],
          {
            env: {
              ...process.env,
              SLURM_JOB_ID: "4713",
              SLURMD_NODENAME: "compute-guarded",
            },
          },
        ),
      ).rejects.toMatchObject({ code: 1 });
      await expect(
        fs.stat(path.join(runFolder, "logs", "slurm-4713.attestation")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(runFolder, { recursive: true, force: true });
    }
  });

  it("keeps apostrophes and shell commands in the run folder inert", async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-slurm-finalizer-"),
    );
    const injectedMarker = path.join(tempRoot, "injected-marker");
    const runFolder = path.join(
      tempRoot,
      "x'; touch injected-marker; #",
    );
    try {
      await fs.mkdir(path.join(runFolder, "logs"), { recursive: true });
      const script = [
        "set -euo pipefail",
        buildSlurmWrapperFinalizerBlock(runFolder),
        "false",
        "",
      ].join("\n");
      await expect(
        execFileAsync("bash", ["-c", script], {
          cwd: tempRoot,
          env: {
            ...process.env,
            SLURM_JOB_ID: "4811",
          },
        }),
      ).rejects.toMatchObject({ code: 1 });
      await expect(fs.stat(injectedMarker)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        fs.readFile(path.join(runFolder, "logs", "pipeline.out"), "utf8"),
      ).resolves.toMatch(/Pipeline completed with exit code: 1/);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
