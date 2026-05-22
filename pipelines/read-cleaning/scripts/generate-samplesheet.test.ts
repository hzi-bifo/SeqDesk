import { spawn } from "child_process";
import path from "path";
import { describe, expect, it } from "vitest";

const scriptPath = path.join(__dirname, "generate-samplesheet.mjs");

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

describe("read-cleaning generate-samplesheet script", () => {
  it("builds nf-core/detaxizer rows from active raw or unknown reads", async () => {
    const result = await runScript({
      packageId: "read-cleaning",
      dataBasePath: "/data",
      config: { readType: "auto" },
      samples: [
        {
          id: "sample-1",
          sampleId: "S1",
          reads: [
            {
              id: "read-cleaned",
              file1: "orders/order-1/S1_cleaned.fastq.gz",
              file2: null,
              dataClass: "cleaned",
              isActive: true,
            },
            {
              id: "read-raw",
              file1: "orders/order-1/S1_R1.fastq.gz",
              file2: "orders/order-1/S1_R2.fastq.gz",
              dataClass: "raw",
              isActive: true,
            },
          ],
          order: { platform: "Illumina NovaSeq" },
        },
        {
          id: "sample-2",
          sampleId: "S2",
          reads: [
            {
              id: "read-only-cleaned",
              file1: "orders/order-1/S2.fastq.gz",
              file2: null,
              dataClass: "cleaned",
              isActive: true,
            },
          ],
          order: { platform: "Illumina" },
        },
        {
          id: "sample-3",
          sampleId: "S3",
          reads: [
            {
              id: "read-unknown",
              file1: "orders/order-1/S3.fastq.gz",
              file2: null,
              dataClass: "unknown",
              isActive: true,
            },
          ],
          order: { platform: "ONT MinION" },
        },
      ],
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");

    const parsed = JSON.parse(result.stdout) as {
      content: string;
      sampleCount: number;
      errors: string[];
    };

    expect(parsed.sampleCount).toBe(2);
    expect(parsed.errors).toEqual([
      "Sample S2: active raw or unknown read files are required",
    ]);
    expect(parsed.content).toBe(
      [
        "sample,short_reads_fastq_1,short_reads_fastq_2,long_reads_fastq_1",
        "S1,/data/orders/order-1/S1_R1.fastq.gz,/data/orders/order-1/S1_R2.fastq.gz,",
        "S3,,,/data/orders/order-1/S3.fastq.gz",
      ].join("\n"),
    );
  });

  it("can force single-end reads into the short-read column", async () => {
    const result = await runScript({
      packageId: "read-cleaning",
      dataBasePath: "/data",
      config: { readType: "short" },
      samples: [
        {
          id: "sample-1",
          sampleId: "S1",
          reads: [
            {
              id: "read-raw",
              file1: "/absolute/S1.fastq.gz",
              file2: null,
              dataClass: "raw",
              isActive: true,
            },
          ],
          order: { platform: "ONT MinION" },
        },
      ],
    });

    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as { content: string };
    expect(parsed.content).toContain("S1,/absolute/S1.fastq.gz,,");
  });
});
