import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PIPELINE_LAUNCH_IDENTITY_FILENAME,
  writePipelineLaunchIdentity,
} from "./launch-identity";

describe("writePipelineLaunchIdentity", () => {
  it("atomically records an exact SLURM recovery identity", async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-launch-identity-")
    );

    try {
      const markerPath = await writePipelineLaunchIdentity({
        runFolder: tempRoot,
        runId: "run-1",
        kind: "slurm",
        numericId: "12345",
      });

      expect(markerPath).toBe(
        path.join(
          await fs.realpath(tempRoot),
          PIPELINE_LAUNCH_IDENTITY_FILENAME
        )
      );
      await expect(fs.readFile(markerPath, "utf8")).resolves.toBe(
        "slurm|12345|seqdesk-run-1\n"
      );
      expect(
        (await fs.readdir(tempRoot)).filter((name) => name.endsWith(".tmp"))
      ).toEqual([]);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("records a local process group without a scheduler name", async () => {
    const tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "seqdesk-launch-identity-")
    );

    try {
      await writePipelineLaunchIdentity({
        runFolder: tempRoot,
        runId: "run-1",
        kind: "local",
        numericId: 321,
      });

      await expect(
        fs.readFile(
          path.join(tempRoot, PIPELINE_LAUNCH_IDENTITY_FILENAME),
          "utf8"
        )
      ).resolves.toBe("local|321|-\n");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it.each(["0", "-1", "abc", "12|34"])(
    "rejects an unsafe numeric identity %s",
    async (numericId) => {
      await expect(
        writePipelineLaunchIdentity({
          runFolder: "/unused",
          runId: "run-1",
          kind: "slurm",
          numericId,
        })
      ).rejects.toThrow("Invalid slurm launch identity");
    }
  );
});
