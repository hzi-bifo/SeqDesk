import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const scriptPath = path.join(__dirname, "discover-outputs.mjs");

let tempDir = "";

function runScript(payload: Record<string, unknown>) {
  return new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

async function touch(filePath: string, content = "") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

describe("read-cleaning discover-outputs script", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-read-cleaning-discover-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("discovers cleaned candidates, reports, removed reads, and summary metadata", async () => {
    const outputDir = path.join(tempDir, "output");
    const s1R1 = path.join(outputDir, "filter", "filtered", "S1_R1_filtered.fastq.gz");
    const s1R2 = path.join(outputDir, "filter", "filtered", "S1_R2_filtered.fastq.gz");
    const s2Long = path.join(outputDir, "filter", "filtered", "S2_longReads_filtered.fastq.gz");
    const removed = path.join(outputDir, "filter", "removed", "S1_removed.fastq.gz");
    const summary = path.join(outputDir, "summary", "summary.tsv");
    const multiqc = path.join(outputDir, "multiqc", "multiqc_report.html");
    const trace = path.join(outputDir, "pipeline_info", "execution_trace.txt");

    await touch(s1R1);
    await touch(s1R2);
    await touch(s2Long);
    await touch(removed);
    await touch(summary, "sample\tclassified_reads\nS1\t12\nS2_longReads\t7\n");
    await touch(multiqc, "<html>report</html>");
    await touch(trace, "trace");

    const result = await runScript({
      packageId: "read-cleaning",
      runId: "run-1",
      outputDir,
      samples: [
        { id: "sample-1", sampleId: "S1" },
        { id: "sample-2", sampleId: "S2" },
      ],
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");

    const parsed = JSON.parse(result.stdout) as {
      files: Array<{
        type: string;
        path: string;
        sampleId?: string;
        outputId?: string;
        metadata?: Record<string, unknown>;
      }>;
      errors: string[];
      summary: {
        artifactsFound: number;
        reportsFound: number;
      };
    };

    expect(parsed.errors).toEqual([]);

    const s1Candidate = parsed.files.find(
      (file) => file.sampleId === "sample-1" && file.outputId === "cleaned_read_candidates",
    );
    const s2Candidate = parsed.files.find(
      (file) => file.sampleId === "sample-2" && file.outputId === "cleaned_read_candidates",
    );

    expect(s1Candidate).toMatchObject({
      type: "artifact",
      path: s1R1,
      metadata: {
        readLayout: "paired",
        sourceFile1: s1R1,
        sourceFile2: s1R2,
        classified_reads: 12,
      },
    });
    expect(s2Candidate).toMatchObject({
      type: "artifact",
      path: s2Long,
      metadata: {
        readLayout: "long",
        sourceFile1: s2Long,
        sourceFile2: null,
        classified_reads: 7,
      },
    });
    expect(parsed.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outputId: "removed_reads", path: removed }),
        expect.objectContaining({ outputId: "summary", path: summary }),
        expect.objectContaining({ outputId: "multiqc_report", path: multiqc, type: "report" }),
        expect.objectContaining({ outputId: "pipeline_info", path: trace }),
      ]),
    );
    expect(parsed.summary).toEqual({
      assembliesFound: 0,
      binsFound: 0,
      artifactsFound: 5,
      reportsFound: 1,
    });
  });
});
