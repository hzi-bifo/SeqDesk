import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runDiscoverOutputsScript } from "./script-runtime";

describe("fastqc discover outputs script", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-fastqc-discover-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("hydrates sample read metadata from the FastQC summary", async () => {
    const reportsDir = path.join(tempDir, "fastqc_reports");
    const summaryDir = path.join(tempDir, "summary");
    await fs.mkdir(reportsDir, { recursive: true });
    await fs.mkdir(summaryDir, { recursive: true });

    await Promise.all([
      fs.writeFile(path.join(reportsDir, "SAMPLE_A_R1_fastqc.html"), ""),
      fs.writeFile(path.join(reportsDir, "SAMPLE_A_R1_fastqc.zip"), ""),
      fs.writeFile(path.join(reportsDir, "SAMPLE_A_R2_fastqc.html"), ""),
      fs.writeFile(path.join(reportsDir, "SAMPLE_A_R2_fastqc.zip"), ""),
      fs.writeFile(
        path.join(summaryDir, "fastqc-summary.tsv"),
        [
          "sample_id\tr1_pass\tr1_warn\tr1_fail\tr1_read_count\tr1_avg_quality\tr2_pass\tr2_warn\tr2_fail\tr2_read_count\tr2_avg_quality",
          "SAMPLE_A\t11\t0\t0\t42000\t37.2\t10\t1\t0\t42000\t36.9",
        ].join("\n"),
      ),
    ]);

    const result = await runDiscoverOutputsScript(
      path.join(process.cwd(), "pipelines", "fastqc", "scripts", "discover-outputs.mjs"),
      {
        packageId: "fastqc",
        runId: "run-1",
        outputDir: tempDir,
        target: { type: "order", orderId: "order-1" },
        samples: [{ id: "sample-db-1", sampleId: "SAMPLE_A" }],
      },
    );

    expect(result.errors).toEqual([]);
    expect(result.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outputId: "sample_fastqc_reads",
          sampleId: "sample-db-1",
          metadata: {
            fastqcReport1: path.join(reportsDir, "SAMPLE_A_R1_fastqc.html"),
            fastqcReport2: path.join(reportsDir, "SAMPLE_A_R2_fastqc.html"),
            readCount1: 42000,
            readCount2: 42000,
            avgQuality1: 37.2,
            avgQuality2: 36.9,
          },
        }),
        expect.objectContaining({
          outputId: "summary",
          path: path.join(summaryDir, "fastqc-summary.tsv"),
        }),
      ]),
    );
  });
});
