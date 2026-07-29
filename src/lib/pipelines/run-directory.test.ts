import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPipelineRunFolder,
  buildSeqDeskSlurmJobName,
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
