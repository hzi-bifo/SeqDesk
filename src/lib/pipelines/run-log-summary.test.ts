import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readLogTailLines,
  summarizeFailureTail,
  summarizePipelineFailure,
} from "./run-log-summary";

describe("summarizeFailureTail", () => {
  it("extracts the concrete command error from nextflow output", () => {
    const summary = summarizeFailureTail({
      outputTail: `
Command error:
  Error: No template FASTQ pairs found in "/tmp/templates". Add files like "template_1_1.fastq.gz" and "template_1_2.fastq.gz".
      at resolveSimulationSource (file:///tmp/generate-reads.mjs:533:13)

Work dir:
  /tmp/work
      `,
      errorTail: "Nextflow 25.10.4 is available - Please consider updating your version to it",
      exitCode: 1,
    });

    expect(summary).toBe(
      'No template FASTQ pairs found in "/tmp/templates". Add files like "template_1_1.fastq.gz" and "template_1_2.fastq.gz".',
    );
  });

  it("falls back to the exit code when logs do not contain a better message", () => {
    const summary = summarizeFailureTail({
      outputTail: null,
      errorTail: null,
      exitCode: 1,
    });

    expect(summary).toBe("Pipeline exited with code 1");
  });

  it("reports unknown exit code when not provided", () => {
    expect(
      summarizeFailureTail({ outputTail: "", errorTail: null, exitCode: null }),
    ).toBe("Pipeline exited with code unknown");
  });

  it("picks the template-specific pattern over generic error heuristics", () => {
    const summary = summarizeFailureTail({
      outputTail:
        "ERROR ~ something generic\nNo template FASTQ pairs found in /data/x",
      errorTail: null,
      exitCode: 2,
    });

    expect(summary).toBe("No template FASTQ pairs found in /data/x");
  });

  it("falls through to the generic error heuristic when no specific pattern matches", () => {
    const summary = summarizeFailureTail({
      outputTail: null,
      errorTail: "Nothing to see here\nsomething failed hard",
      exitCode: 1,
    });

    expect(summary).toBe("something failed hard");
  });

  it("skips the ERROR ~ and Process ... terminated prefix lines as uninformative", () => {
    const summary = summarizeFailureTail({
      outputTail: [
        "ERROR ~ Error executing process > SIMULATE_READS",
        "Process SIMULATE_READS terminated with an error exit status (1)",
        "Command 'node generate-reads.mjs' failed with exit 1",
      ].join("\n"),
      errorTail: null,
      exitCode: 1,
    });

    expect(summary).toBe("Command 'node generate-reads.mjs' failed with exit 1");
  });

  it("strips ANSI escape codes before matching", () => {
    const summary = summarizeFailureTail({
      outputTail: "\u001B[31mError: missing input files for SAMPLE_A\u001B[0m",
      errorTail: null,
      exitCode: 3,
    });

    expect(summary).toBe("missing input files for SAMPLE_A");
  });
});

describe("readLogTailLines", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-log-tail-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns null when path is missing", async () => {
    expect(await readLogTailLines(null)).toBeNull();
    expect(await readLogTailLines(undefined)).toBeNull();
  });

  it("returns null when the path does not exist", async () => {
    expect(await readLogTailLines(path.join(tempDir, "nope.log"))).toBeNull();
  });

  it("returns null when the path is a directory, not a file", async () => {
    expect(await readLogTailLines(tempDir)).toBeNull();
  });

  it("returns the last lines of a small file", async () => {
    const filePath = path.join(tempDir, "short.log");
    await fs.writeFile(filePath, "line-1\nline-2\nline-3\n");

    const tail = await readLogTailLines(filePath);
    expect(tail).toContain("line-3");
    expect(tail).toContain("line-1");
  });

  it("caps the tail to the line limit for very large files", async () => {
    const filePath = path.join(tempDir, "big.log");
    const lines = Array.from({ length: 500 }, (_, i) => `line-${i}`);
    await fs.writeFile(filePath, lines.join("\n"));

    const tail = await readLogTailLines(filePath);
    expect(tail).not.toBeNull();
    const returnedLines = tail!.split("\n");
    expect(returnedLines.length).toBeLessThanOrEqual(150);
    expect(tail).toContain("line-499");
    expect(tail).not.toContain("line-0\n");
  });
});

describe("summarizePipelineFailure", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-pipe-fail-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("combines tailed logs and produces a summary", async () => {
    const outputPath = path.join(tempDir, "out.log");
    const errorPath = path.join(tempDir, "err.log");
    await fs.writeFile(outputPath, "startup ok\n");
    await fs.writeFile(
      errorPath,
      "Command error:\n  Error: missing input files for SAMPLE_A\n",
    );

    const result = await summarizePipelineFailure({
      outputPath,
      errorPath,
      exitCode: 1,
    });

    expect(result.outputTail).toContain("startup ok");
    expect(result.errorTail).toBe("missing input files for SAMPLE_A");
  });

  it("returns the exit-code fallback when both logs are missing", async () => {
    const result = await summarizePipelineFailure({
      outputPath: null,
      errorPath: null,
      exitCode: 137,
    });

    expect(result.outputTail).toBeNull();
    expect(result.errorTail).toBe("Pipeline exited with code 137");
  });
});
