import { describe, expect, it } from "vitest";
import { summarizeFailureTail } from "./run-log-summary";

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
});
