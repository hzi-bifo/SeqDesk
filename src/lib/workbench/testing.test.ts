import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  assertJsonSerializable,
  assertSerializedWorkbenchDataset,
  assertSerializedWorkbenchImportJob,
  assertWorkbenchPathInsideAllowedRoots,
  createMockCommandRunner,
  createMockWorkbenchImportStartContext,
  createWorkbenchTestStoragePaths,
  createWorkbenchTestTempRoot,
  WORKBENCH_REQUIRED_TEST_LAYERS,
} from "./testing";

describe("workbench integration test helpers", () => {
  it("declares the required integration test layers", () => {
    expect(WORKBENCH_REQUIRED_TEST_LAYERS).toEqual([
      "contract",
      "execution",
      "security",
      "ui-api",
    ]);
  });

  it("creates isolated temp storage paths for fake importer contexts", async () => {
    const temp = await createWorkbenchTestTempRoot();
    try {
      const storage = await createWorkbenchTestStoragePaths({
        rootDir: temp.rootDir,
        providerId: "NCBI Genomes / Taxon",
        cacheKey: "cache-1",
        jobId: "job-1",
      });

      expect(storage.cacheDir).toBe(
        path.join(temp.rootDir, "workbench", "cache", "ncbi-genomes-taxon", "cache-1")
      );
      await expect(fs.access(storage.cacheDir)).resolves.toBeUndefined();
      await expect(fs.access(storage.jobDir)).resolves.toBeUndefined();
    } finally {
      await temp.cleanup();
    }
  });

  it("creates fake importer start contexts that capture progress and logs", async () => {
    const temp = await createWorkbenchTestTempRoot();
    try {
      const context = await createMockWorkbenchImportStartContext({
        rootDir: temp.rootDir,
        input: { taxon: "Escherichia coli" },
        preview: {
          providerId: "mock",
          summary: {
            label: "mock",
            totalFound: 1,
            selectedCount: 1,
            capped: false,
            cap: 1,
            hardMax: 1,
          },
          genomes: [{ accession: "GCF_1" }],
        },
      });

      await context.update({ status: "running", phase: "downloading", progress: 20 });
      await context.log("started");

      expect(context.updates).toEqual([
        { status: "running", phase: "downloading", progress: 20 },
      ]);
      expect(context.logs).toEqual(["started"]);
    } finally {
      await temp.cleanup();
    }
  });

  it("asserts allowed write roots and JSON-safe serialized outputs", () => {
    const root = path.join("/tmp", "seqdesk-workbench-root");
    assertWorkbenchPathInsideAllowedRoots({
      targetPath: path.join(root, "cache", "dataset"),
      allowedRoots: [root],
      label: "Dataset",
    });
    expect(() =>
      assertWorkbenchPathInsideAllowedRoots({
        targetPath: path.join("/tmp", "outside", "dataset"),
        allowedRoots: [root],
        label: "Dataset",
      })
    ).toThrow("Dataset must stay inside one of");

    assertJsonSerializable({ ok: true }, "payload");
    expect(() => assertJsonSerializable({ bad: BigInt(1) }, "payload")).toThrow(
      "payload must be JSON serializable"
    );
  });

  it("checks serialized dataset and job shapes", () => {
    assertSerializedWorkbenchDataset({
      id: "dataset-1",
      providerId: "provider",
      name: "Dataset",
      sourceType: "provider",
      status: "ready",
      createdAt: "2026-05-20T10:00:00.000Z",
      updatedAt: "2026-05-20T10:00:00.000Z",
    });
    assertSerializedWorkbenchImportJob({
      id: "job-1",
      providerId: "provider",
      status: "queued",
      createdAt: "2026-05-20T10:00:00.000Z",
      updatedAt: "2026-05-20T10:00:00.000Z",
    });
  });

  it("captures mock command invocations", async () => {
    const runner = createMockCommandRunner(({ command }) => ({
      stdout: `${command} ok`,
      exitCode: 0,
    }));

    await expect(runner.run("datasets", ["--version"])).resolves.toEqual({
      stdout: "datasets ok",
      exitCode: 0,
    });
    expect(runner.invocations).toEqual([{ command: "datasets", args: ["--version"] }]);
  });
});
