import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: mocks.spawn,
}));

import { runDiscoverOutputsScript, runSamplesheetScript } from "./script-runtime";

function createMockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: {
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
  };

  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };

  return child;
}

describe("runDiscoverOutputsScript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams payload into the script and resolves valid output JSON", async () => {
    const child = createMockChild();
    mocks.spawn.mockReturnValue(child);

    const payload = {
      packageId: "mag",
      runId: "run-1",
      outputDir: "/tmp/out",
      target: { type: "study" as const, studyId: "study-1" },
      samples: [{ id: "sample-1", sampleId: "S1" }],
    };

    const promise = runDiscoverOutputsScript("/tmp/discover.mjs", payload);

    expect(mocks.spawn).toHaveBeenCalledWith(process.execPath, ["/tmp/discover.mjs"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify(payload));
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          files: [{ type: "report", name: "summary", path: "/tmp/out/report.html" }],
          errors: [],
          summary: {
            assembliesFound: 0,
            binsFound: 0,
            artifactsFound: 0,
            reportsFound: 1,
          },
        })
      )
    );
    child.emit("close", 0);

    await expect(promise).resolves.toEqual({
      files: [{ type: "report", name: "summary", path: "/tmp/out/report.html" }],
      errors: [],
      summary: {
        assembliesFound: 0,
        binsFound: 0,
        artifactsFound: 0,
        reportsFound: 1,
      },
    });
  });

  it("rejects when the script exits with a non-zero code", async () => {
    const child = createMockChild();
    mocks.spawn.mockReturnValue(child);

    const promise = runDiscoverOutputsScript("/tmp/discover.mjs", {
      packageId: "mag",
      runId: "run-1",
      outputDir: "/tmp/out",
      samples: [],
    });

    child.stderr.emit("data", Buffer.from("boom"));
    child.emit("close", 2);

    await expect(promise).rejects.toThrow(
      "Discover outputs script failed with exit code 2: boom"
    );
  });

  it("rejects when the script returns invalid JSON", async () => {
    const child = createMockChild();
    mocks.spawn.mockReturnValue(child);

    const promise = runDiscoverOutputsScript("/tmp/discover.mjs", {
      packageId: "mag",
      runId: "run-1",
      outputDir: "/tmp/out",
      samples: [],
    });

    child.stdout.emit("data", Buffer.from("{bad-json"));
    child.emit("close", 0);

    await expect(promise).rejects.toThrow(
      "Failed to parse discover outputs script response"
    );
  });

  it("rejects when the parsed payload does not match the expected result shape", async () => {
    const child = createMockChild();
    mocks.spawn.mockReturnValue(child);

    const promise = runDiscoverOutputsScript("/tmp/discover.mjs", {
      packageId: "mag",
      runId: "run-1",
      outputDir: "/tmp/out",
      samples: [],
    });

    child.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          files: [],
          errors: [],
          summary: {
            assembliesFound: "nope",
          },
        })
      )
    );
    child.emit("close", 0);

    await expect(promise).rejects.toThrow(
      "Discover outputs script returned an invalid payload"
    );
  });

  it("rejects when spawning the script errors before completion", async () => {
    const child = createMockChild();
    mocks.spawn.mockReturnValue(child);

    const promise = runDiscoverOutputsScript("/tmp/discover.mjs", {
      packageId: "mag",
      runId: "run-1",
      outputDir: "/tmp/out",
      samples: [],
    });

    child.emit("error", new Error("spawn failed"));

    await expect(promise).rejects.toThrow("spawn failed");
  });
});

describe("runSamplesheetScript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams payload into the script and resolves valid samplesheet JSON", async () => {
    const child = createMockChild();
    mocks.spawn.mockReturnValue(child);

    const payload = {
      packageId: "read-cleaning",
      target: { type: "order" as const, orderId: "order-1" },
      dataBasePath: "/data",
      config: { readType: "short" },
      samples: [
        {
          id: "sample-1",
          sampleId: "S1",
          reads: [
            {
              id: "read-1",
              file1: "reads/S1_R1.fastq.gz",
              file2: "reads/S1_R2.fastq.gz",
              dataClass: "raw",
              isActive: true,
            },
          ],
          order: { id: "order-1", platform: "Illumina", customFields: null },
        },
      ],
    };

    const promise = runSamplesheetScript("/tmp/generate-samplesheet.mjs", payload);

    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      ["/tmp/generate-samplesheet.mjs"],
      {
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify(payload));
    expect(child.stdin.end).toHaveBeenCalledTimes(1);

    child.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          content: "sample,short_reads_fastq_1\nS1,/data/reads/S1_R1.fastq.gz",
          sampleCount: 1,
          errors: [],
        })
      )
    );
    child.emit("close", 0);

    await expect(promise).resolves.toEqual({
      content: "sample,short_reads_fastq_1\nS1,/data/reads/S1_R1.fastq.gz",
      sampleCount: 1,
      errors: [],
    });
  });

  it("rejects invalid samplesheet JSON shape", async () => {
    const child = createMockChild();
    mocks.spawn.mockReturnValue(child);

    const promise = runSamplesheetScript("/tmp/generate-samplesheet.mjs", {
      packageId: "read-cleaning",
      dataBasePath: "/data",
      config: {},
      samples: [],
    });

    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ content: "", sampleCount: "one", errors: [] }))
    );
    child.emit("close", 0);

    await expect(promise).rejects.toThrow(
      "Samplesheet script returned an invalid payload"
    );
  });
});
