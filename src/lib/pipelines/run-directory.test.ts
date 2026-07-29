import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPipelineRunFolder,
  buildSeqDeskSlurmJobName,
  preparePipelineRunDirectory,
} from "./run-directory";

describe("buildPipelineRunFolder", () => {
  it("gives distinct database run IDs distinct folders for the same run number", () => {
    const root = path.resolve("/pipeline-runs");
    const runNumber = "MAG-20260729-001";

    const first = buildPipelineRunFolder(root, runNumber, "run-1");
    const second = buildPipelineRunFolder(root, runNumber, "run-2");

    expect(first).not.toBe(second);
    expect(path.dirname(first)).toBe(root);
    expect(path.dirname(second)).toBe(root);
    expect(path.basename(first)).toBe("MAG-20260729-001--id-run-1");
    expect(path.basename(second)).toBe("MAG-20260729-001--id-run-2");
  });

  it("encodes the full run ID without permitting path traversal", () => {
    const root = path.resolve("/pipeline-runs");
    const folder = buildPipelineRunFolder(
      root,
      "SUBMG-20260729-001",
      "../../run/with spaces"
    );

    expect(path.dirname(folder)).toBe(root);
    expect(path.basename(folder)).toContain("--hex-");
    expect(path.basename(folder)).not.toContain("..");
    expect(path.basename(folder)).not.toContain("/");
  });

  it("rejects a run number that could escape the configured root", () => {
    expect(() =>
      buildPipelineRunFolder("/pipeline-runs", "../MAG-001", "run-1")
    ).toThrow("Invalid pipeline run number");
  });

  it("returns the canonical real path when the configured root is a symlink", async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-run-directory-")
    );
    const physicalRoot = path.join(tempRoot, "physical-runs");
    const configuredRoot = path.join(tempRoot, "configured-runs");

    try {
      await fs.mkdir(physicalRoot);
      await fs.symlink(physicalRoot, configuredRoot, "dir");

      const runFolder = await preparePipelineRunDirectory(
        configuredRoot,
        "MAG-20260729-001",
        "run-1"
      );
      const canonicalRoot = await fs.realpath(physicalRoot);

      expect(runFolder).toBe(
        path.join(canonicalRoot, "MAG-20260729-001--id-run-1")
      );
      expect(await fs.realpath(runFolder)).toBe(runFolder);
      expect(
        (await fs.stat(path.join(runFolder, "logs"))).isDirectory()
      ).toBe(true);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects a symlink at the generated run leaf without touching its target", async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-run-directory-")
    );
    const physicalRoot = path.join(tempRoot, "physical-runs");
    const configuredRoot = path.join(tempRoot, "configured-runs");
    const outsideRoot = path.join(tempRoot, "outside");
    const runNumber = "MAG-20260729-001";
    const runId = "run-1";

    try {
      await fs.mkdir(physicalRoot);
      await fs.mkdir(outsideRoot);
      await fs.writeFile(path.join(outsideRoot, "sentinel"), "preserve\n");
      await fs.symlink(physicalRoot, configuredRoot, "dir");
      await fs.symlink(
        outsideRoot,
        buildPipelineRunFolder(configuredRoot, runNumber, runId),
        "dir"
      );

      await expect(
        preparePipelineRunDirectory(configuredRoot, runNumber, runId)
      ).rejects.toThrow(
        "Pipeline run folder must be a real directory"
      );
      await expect(
        fs.readFile(path.join(outsideRoot, "sentinel"), "utf8")
      ).resolves.toBe("preserve\n");
      await expect(
        fs.stat(path.join(outsideRoot, "logs"))
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("buildSeqDeskSlurmJobName", () => {
  it("sanitizes the run ID and keeps the complete job name bounded", () => {
    const name = buildSeqDeskSlurmJobName(
      "run/with spaces;$(unsafe)-abcdefghijklmnopqrstuvwxyz0123456789"
    );

    expect(name).toMatch(/^seqdesk-[A-Za-z0-9_-]*$/);
    expect(name.length).toBeLessThanOrEqual(56);
    expect(name).not.toContain("$(");
  });
});
