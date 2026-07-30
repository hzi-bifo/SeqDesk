import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  PIPELINE_INSTALL_PROVENANCE_FILE,
  readPipelineInstallProvenance,
  writePipelineInstallProvenance,
} from "./pipeline-install-provenance";

describe("pipeline install provenance", () => {
  let pipelinesDir = "";

  beforeEach(async () => {
    pipelinesDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-pipeline-provenance-")
    );
    await fs.mkdir(path.join(pipelinesDir, "fixture"));
  });

  afterEach(async () => {
    await fs.rm(pipelinesDir, { recursive: true, force: true });
  });

  it("writes and reads non-secret Store provenance atomically", async () => {
    const written = await writePipelineInstallProvenance(
      {
        pipelineId: "fixture",
        version: "1.2.3",
        sourceId: "registry:https://seqdesk.org/api/registry",
        sourceKind: "registry",
        installedAt: "2026-07-30T08:00:00.000Z",
      },
      pipelinesDir
    );

    expect(written).toEqual({
      schemaVersion: 1,
      pipelineId: "fixture",
      version: "1.2.3",
      sourceId: "registry:https://seqdesk.org/api/registry",
      sourceKind: "registry",
      installedAt: "2026-07-30T08:00:00.000Z",
    });
    await expect(
      readPipelineInstallProvenance("fixture", pipelinesDir)
    ).resolves.toEqual(written);
    expect(
      (await fs.readdir(path.join(pipelinesDir, "fixture"))).filter(
        (entry) => entry.includes(".tmp-")
      )
    ).toEqual([]);
  });

  it("treats a package without provenance as bundled", async () => {
    await expect(
      readPipelineInstallProvenance("fixture", pipelinesDir)
    ).resolves.toBeNull();
  });

  it("does not follow a provenance symlink", async () => {
    if (process.platform === "win32") return;
    const outside = path.join(pipelinesDir, "outside.json");
    await fs.writeFile(
      outside,
      JSON.stringify({
        schemaVersion: 1,
        pipelineId: "fixture",
        version: "1.0.0",
        sourceId: "outside",
        sourceKind: "registry",
        installedAt: "2026-07-30T08:00:00.000Z",
      })
    );
    await fs.symlink(
      outside,
      path.join(
        pipelinesDir,
        "fixture",
        PIPELINE_INSTALL_PROVENANCE_FILE
      )
    );

    await expect(
      readPipelineInstallProvenance("fixture", pipelinesDir)
    ).resolves.toBeNull();
  });
});
