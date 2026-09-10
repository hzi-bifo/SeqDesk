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
    // Internal fixture using the real detaxizer 1.3.0 unnamed-index format.
    await touch(summary, "\tclassified with kraken2\nS1\t12\nS2_longReads\t7\n");
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
        "classified with kraken2": 12,
      },
    });
    expect(s2Candidate).toMatchObject({
      type: "artifact",
      path: s2Long,
      metadata: {
        readLayout: "long",
        sourceFile1: s2Long,
        sourceFile2: null,
        "classified with kraken2": 7,
      },
    });
    expect(parsed.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outputId: "removed_reads", path: removed }),
        expect.objectContaining({ outputId: "summary", path: summary }),
        expect.objectContaining({ outputId: "report_summary", path: path.join(outputDir, "seqdesk-read-screening-summary.json") }),
        expect.objectContaining({ outputId: "multiqc_report", path: multiqc, type: "report" }),
        expect.objectContaining({ outputId: "pipeline_info", path: trace }),
      ]),
    );
    expect(parsed.summary).toEqual({
      assembliesFound: 0,
      binsFound: 0,
      artifactsFound: 6,
      reportsFound: 1,
    });
    expect(JSON.parse(await fs.readFile(path.join(outputDir, "seqdesk-read-screening-summary.json"), "utf8"))).toEqual([
      expect.objectContaining({ sample_record: "sample-1", source_sample: "S1", classified_read_ids: 12, blastn_unique_ids: null }),
      expect.objectContaining({ sample_record: "sample-2", source_sample: "S2_longReads", classified_read_ids: 7 }),
    ]);
  });

  it("is repeatable and leaves the original summary unchanged", async () => {
    const original = "\tclassified with bbduk\nS1\t0\n";
    const summary = path.join(tempDir, "summary/summary.tsv");
    await touch(summary, original);
    const payload = { outputDir: tempDir, samples: [{ id: "s1", sampleId: "S1" }] };
    const first = JSON.parse((await runScript(payload)).stdout);
    const second = JSON.parse((await runScript(payload)).stdout);
    expect(first.errors).toEqual([]);
    expect(second).toEqual(first);
    expect(await fs.readFile(summary, "utf8")).toBe(original);
    expect(JSON.parse(await fs.readFile(path.join(tempDir, "seqdesk-read-screening-summary.json"), "utf8"))[0].classified_read_ids).toBe(0);
  });

  it.each(["file", "symlink"])("does not overwrite a conflicting %s report table", async type => {
    await touch(path.join(tempDir, "summary/summary.tsv"), "\tclassified with kraken2\nS1\t1\n");
    const preserved = path.join(tempDir, "preserved.json");
    await touch(preserved, "keep me");
    const report = path.join(tempDir, "seqdesk-read-screening-summary.json");
    if (type === "symlink") await fs.symlink(preserved, report);
    else await touch(report, "keep me");
    const result = JSON.parse((await runScript({ outputDir: tempDir, samples: [{ id: "s1", sampleId: "S1" }] })).stdout);
    expect(result.files.some((file: { outputId: string }) => file.outputId === "report_summary")).toBe(false);
    expect(result.errors.join()).toContain("left unchanged");
    expect(await fs.readFile(preserved, "utf8")).toBe("keep me");
    expect(await fs.readFile(report, "utf8")).toBe("keep me");
    expect((await fs.readdir(tempDir)).some(name => name.startsWith(".seqdesk-screening-summary-"))).toBe(false);
  });

  it("publishes one complete table during concurrent output discovery", async () => {
    const samples = Array.from({ length: 2000 }, (_, i) => ({ id: `record-${i}`, sampleId: `INTERNAL_${i}` }));
    await touch(path.join(tempDir, "summary/summary.tsv"), `\tclassified with kraken2\n${samples.map(sample => `${sample.sampleId}\t12`).join("\n")}\n`);
    const results = await Promise.all(Array.from({ length: 3 }, () => runScript({ outputDir: tempDir, samples })));
    for (const result of results) {
      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.errors).toEqual([]);
      expect(parsed.files).toContainEqual(expect.objectContaining({ outputId: "report_summary" }));
    }
    expect(JSON.parse(await fs.readFile(path.join(tempDir, "seqdesk-read-screening-summary.json"), "utf8"))).toHaveLength(samples.length);
    expect((await fs.readdir(tempDir)).some(name => name.startsWith(".seqdesk-screening-summary-"))).toBe(false);
  });

  it("keeps the raw summary downloadable when normalization is unsupported", async () => {
    const summary = path.join(tempDir, "summary/summary.tsv");
    await touch(summary, "sample\tunrecognized_measurement\nS1\t12\n");
    const result = JSON.parse((await runScript({ outputDir: tempDir, samples: [{ id: "s1", sampleId: "S1" }] })).stdout);
    expect(result.files).toContainEqual(expect.objectContaining({ outputId: "summary", path: summary }));
    expect(result.files.some((file: { outputId: string }) => file.outputId === "report_summary")).toBe(false);
    expect(result.errors.join()).toContain("The original summary is still available");
  });
});
