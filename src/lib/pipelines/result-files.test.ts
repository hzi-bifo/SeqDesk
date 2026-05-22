import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPackage: vi.fn(),
}));

vi.mock("@/lib/pipelines/package-loader", () => ({
  getPackage: mocks.getPackage,
}));

import {
  buildPipelineRunResultFileSummary,
  buildPipelineRunResultFiles,
  getPipelineRunTargetKey,
  getPrimaryPipelineRunResultFile,
  MAX_RUN_RESULT_FILES,
} from "./result-files";

describe("pipeline result files", () => {
  let tempDir = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-result-files-"));
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          { id: "combined_report_html", scope: "study", destination: "study_report", type: "report" },
          { id: "dotplots", scope: "study", destination: "study_report", type: "report" },
          { id: "run_logs", scope: "run", destination: "run_artifact", type: "artifact" },
          { id: "sample_report", scope: "sample", destination: "run_artifact", type: "report" },
        ],
      },
      definition: {
        outputs: [
          { id: "combined_report_html", name: "Combined Report" },
          { id: "dotplots", name: "Dotplots" },
          { id: "run_logs", name: "Run Logs" },
        ],
      },
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("builds target keys for study and order runs", () => {
    expect(getPipelineRunTargetKey({ targetType: "study", studyId: "study-1" })).toBe(
      "study:study-1"
    );
    expect(getPipelineRunTargetKey({ targetType: "order", orderId: "order-1" })).toBe(
      "order:order-1"
    );
  });

  it("ranks combined HTML reports before PDFs, logs, and technical Nextflow reports", async () => {
    const technicalReport = path.join(tempDir, "report.html");
    await fs.writeFile(technicalReport, "<html>nextflow</html>");

    const files = await buildPipelineRunResultFiles({
      pipelineId: "metaxpath",
      runId: "run-1",
      runFolder: tempDir,
      artifacts: [
        {
          id: "log-1",
          name: "pipeline.log",
          path: path.join(tempDir, "pipeline.log"),
          type: "data",
          outputId: "run_logs",
          size: BigInt(100),
        },
        {
          id: "pdf-1",
          name: "dotplot.pdf",
          path: path.join(tempDir, "dotplot.pdf"),
          type: "report",
          outputId: "dotplots",
          size: BigInt(200),
        },
        {
          id: "html-1",
          name: "metaxpath.combined_report.top50.html",
          path: path.join(tempDir, "metaxpath.combined_report.top50.html"),
          type: "report",
          outputId: "combined_report_html",
          size: BigInt(300),
        },
      ],
    });

    expect(files.map((file) => file.id)).toEqual([
      "html-1",
      "pdf-1",
      "technical-report:run-1",
      "log-1",
    ]);
    expect(getPrimaryPipelineRunResultFile(files)?.id).toBe("html-1");
    expect(files[0]).toMatchObject({
      name: "metaxpath.combined_report.top50.html",
      outputId: "combined_report_html",
      size: 300,
      previewable: true,
    });
  });

  it("does not fail when the technical report is missing", async () => {
    const files = await buildPipelineRunResultFiles({
      pipelineId: "metaxpath",
      runId: "run-1",
      runFolder: tempDir,
      artifacts: [],
    });

    expect(files).toEqual([]);
  });

  it("uses manifest preview metadata for primary result ranking and preview disabling", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        outputs: [
          {
            id: "summary",
            scope: "run",
            destination: "run_artifact",
            type: "report",
          },
          {
            id: "multiqc_report",
            scope: "run",
            destination: "run_artifact",
            type: "report",
            result: {
              kind: "run_artifact",
              writebackPolicy: "none",
              preview: { primary: true, previewable: true },
            },
          },
          {
            id: "raw_html",
            scope: "run",
            destination: "run_artifact",
            type: "report",
            result: {
              kind: "run_artifact",
              writebackPolicy: "none",
              preview: { previewable: false },
            },
          },
        ],
      },
      definition: {
        outputs: [
          { id: "summary", name: "Summary" },
          { id: "multiqc_report", name: "MultiQC" },
          { id: "raw_html", name: "Raw HTML" },
        ],
      },
    });

    const files = await buildPipelineRunResultFiles({
      pipelineId: "read-cleaning",
      runId: "run-1",
      runFolder: tempDir,
      artifacts: [
        {
          id: "summary",
          name: "summary.html",
          path: path.join(tempDir, "summary.html"),
          type: "report",
          outputId: "summary",
          size: 10,
        },
        {
          id: "multiqc",
          name: "multiqc_report.html",
          path: path.join(tempDir, "multiqc_report.html"),
          type: "report",
          outputId: "multiqc_report",
          size: 20,
        },
        {
          id: "raw",
          name: "raw.html",
          path: path.join(tempDir, "raw.html"),
          type: "report",
          outputId: "raw_html",
          size: 30,
        },
      ],
    });

    expect(files.map((file) => file.id)).toEqual(["multiqc", "summary", "raw"]);
    expect(files.find((file) => file.id === "raw")?.previewable).toBe(false);
  });

  it("omits per-sample artifacts and caps noisy run file lists", async () => {
    const artifacts = Array.from({ length: MAX_RUN_RESULT_FILES + 3 }, (_, index) => ({
      id: `run-file-${index}`,
      name: `run-file-${index}.txt`,
      path: path.join(tempDir, `run-file-${index}.txt`),
      type: "data",
      outputId: "run_logs",
      size: 10,
    }));

    const summary = await buildPipelineRunResultFileSummary({
      pipelineId: "metaxpath",
      runId: "run-1",
      runFolder: tempDir,
      artifacts: [
        ...artifacts,
        {
          id: "sample-file-1",
          name: "sample-a.html",
          path: path.join(tempDir, "sample-a.html"),
          type: "report",
          sampleId: "sample-a",
          outputId: "sample_report",
          size: 10,
        },
      ],
    });

    expect(summary.files).toHaveLength(MAX_RUN_RESULT_FILES);
    expect(summary.omittedCount).toBe(3);
    expect(summary.omittedSampleFileCount).toBe(1);
    expect(summary.files.some((file) => file.id === "sample-file-1")).toBe(false);
  });

  it("does not mark files outside the run folder as previewable", async () => {
    const files = await buildPipelineRunResultFiles({
      pipelineId: "metaxpath",
      runId: "run-1",
      runFolder: tempDir,
      artifacts: [
        {
          id: "outside",
          name: "outside.html",
          path: path.join(os.tmpdir(), "outside-run-folder.html"),
          type: "report",
          outputId: "combined_report_html",
          size: 10,
        },
      ],
    });

    expect(files[0]).toMatchObject({ id: "outside", previewable: false });
  });
});
