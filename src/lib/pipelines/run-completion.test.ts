import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    pipelineRun: {
      findUnique: vi.fn(),
    },
  },
  getAdapter: vi.fn(),
  registerAdapter: vi.fn(),
  createGenericAdapter: vi.fn(),
  resolveOutputs: vi.fn(),
  saveRunResults: vi.fn(),
  processSubmgRunResults: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("./adapters", () => ({
  getAdapter: mocks.getAdapter,
  registerAdapter: mocks.registerAdapter,
}));

vi.mock("./generic-adapter", () => ({
  createGenericAdapter: mocks.createGenericAdapter,
}));

vi.mock("./output-resolver", () => ({
  resolveOutputs: mocks.resolveOutputs,
  saveRunResults: mocks.saveRunResults,
}));

vi.mock("./submg/submg-runner", () => ({
  processSubmgRunResults: mocks.processSubmgRunResults,
}));

import {
  inferPipelineExitCode,
  processCompletedPipelineRun,
} from "./run-completion";

let tempDir: string;

describe("run-completion", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-run-completion-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("delegates submg runs directly to submg result processing", async () => {
    mocks.processSubmgRunResults.mockResolvedValue({});

    await processCompletedPipelineRun("run-1", "submg");

    expect(mocks.processSubmgRunResults).toHaveBeenCalledWith("run-1");
    expect(mocks.getAdapter).not.toHaveBeenCalled();
    expect(mocks.resolveOutputs).not.toHaveBeenCalled();
  });

  it("returns when no adapter is available", async () => {
    mocks.getAdapter.mockReturnValue(null);
    mocks.createGenericAdapter.mockReturnValue(null);

    await processCompletedPipelineRun("run-1", "mag");

    expect(mocks.db.pipelineRun.findUnique).not.toHaveBeenCalled();
    expect(mocks.registerAdapter).not.toHaveBeenCalled();
    expect(mocks.resolveOutputs).not.toHaveBeenCalled();
  });

  it("registers and uses a generic adapter when no static adapter exists", async () => {
    const discovered = {
      files: [
        {
          type: "artifact",
          name: "report.txt",
          path: "/tmp/report.txt",
        },
      ],
      errors: [],
      summary: {
        assembliesFound: 0,
        binsFound: 0,
        artifactsFound: 1,
        reportsFound: 0,
      },
    };
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue(discovered),
    };
    const resolved = {
      success: true,
      assembliesCreated: 0,
      binsCreated: 0,
      artifactsCreated: 1,
      errors: [],
      warnings: [],
    };

    mocks.getAdapter.mockReturnValue(null);
    mocks.createGenericAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-1",
      runFolder: "/tmp/run-1",
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      study: {
        samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }],
      },
      order: null,
    });
    mocks.resolveOutputs.mockResolvedValue(resolved);
    mocks.saveRunResults.mockResolvedValue(undefined);

    await processCompletedPipelineRun("run-1", "mag");

    expect(mocks.registerAdapter).toHaveBeenCalledWith(adapter);
    expect(adapter.discoverOutputs).toHaveBeenCalledWith({
      runId: "run-1",
      outputDir: path.join("/tmp/run-1", "output"),
      target: { type: "study", studyId: "study-1" },
      samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }],
    });
    expect(mocks.resolveOutputs).toHaveBeenCalledWith("mag", "run-1", discovered);
    expect(mocks.saveRunResults).toHaveBeenCalledWith("run-1", resolved);
  });

  it("uses order samples when processing an order-targeted run", async () => {
    const discovered = {
      files: [],
      errors: [],
      summary: {
        assembliesFound: 0,
        binsFound: 0,
        artifactsFound: 0,
        reportsFound: 0,
      },
    };
    const adapter = {
      discoverOutputs: vi.fn().mockResolvedValue(discovered),
    };

    mocks.getAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValue({
      id: "run-2",
      runFolder: "/tmp/run-2",
      targetType: "order",
      studyId: null,
      orderId: "order-9",
      study: null,
      order: {
        samples: [{ id: "sample-9", sampleId: "ORDER-SAMPLE-9" }],
      },
    });
    mocks.resolveOutputs.mockResolvedValue({
      success: true,
      assembliesCreated: 0,
      binsCreated: 0,
      artifactsCreated: 0,
      errors: [],
      warnings: [],
    });
    mocks.saveRunResults.mockResolvedValue(undefined);

    await processCompletedPipelineRun("run-2", "fastq-checksum");

    expect(adapter.discoverOutputs).toHaveBeenCalledWith({
      runId: "run-2",
      outputDir: path.join("/tmp/run-2", "output"),
      target: { type: "order", orderId: "order-9" },
      samples: [{ id: "sample-9", sampleId: "ORDER-SAMPLE-9" }],
    });
  });

  it("returns when run has no folder or no samples", async () => {
    const adapter = {
      discoverOutputs: vi.fn(),
    };
    mocks.getAdapter.mockReturnValue(adapter);
    mocks.db.pipelineRun.findUnique.mockResolvedValueOnce({
      id: "run-1",
      runFolder: null,
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      study: { samples: [{ id: "sample-1", sampleId: "SAMPLE-1" }] },
      order: null,
    });
    mocks.db.pipelineRun.findUnique.mockResolvedValueOnce({
      id: "run-1",
      runFolder: "/tmp/run-1",
      targetType: "study",
      studyId: "study-1",
      orderId: null,
      study: { samples: [] },
      order: null,
    });

    await processCompletedPipelineRun("run-1", "mag");
    await processCompletedPipelineRun("run-1", "mag");

    expect(adapter.discoverOutputs).not.toHaveBeenCalled();
    expect(mocks.resolveOutputs).not.toHaveBeenCalled();
  });

  it("extracts exit code from stdout", async () => {
    const runFolder = path.join(tempDir, "run-1");
    const logsDir = path.join(runFolder, "logs");
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(
      path.join(logsDir, "pipeline.out"),
      "...\nPipeline completed with exit code: 17\n"
    );

    const code = await inferPipelineExitCode(runFolder);
    expect(code).toBe(17);
  });

  it("falls back to stderr when stdout has no parseable code", async () => {
    const runFolder = path.join(tempDir, "run-2");
    const logsDir = path.join(runFolder, "logs");
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(path.join(logsDir, "pipeline.out"), "completed but no code");
    await fs.writeFile(path.join(logsDir, "pipeline.err"), "job exited with code 9");

    const code = await inferPipelineExitCode(runFolder);
    expect(code).toBe(9);
  });

  it("returns null when no exit code can be inferred", async () => {
    const runFolder = path.join(tempDir, "run-3");
    await fs.mkdir(path.join(runFolder, "logs"), { recursive: true });
    await fs.writeFile(path.join(runFolder, "logs", "pipeline.out"), "hello");
    await fs.writeFile(path.join(runFolder, "logs", "pipeline.err"), "world");

    const code = await inferPipelineExitCode(runFolder);
    expect(code).toBeNull();
  });
});
