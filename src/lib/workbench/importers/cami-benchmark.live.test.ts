import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { describe, expect, it } from "vitest";
import { camiBenchmarkImporter as provider } from "./cami-benchmark";

describe.runIf(process.env.SEQDESK_WORKBENCH_CAMI_LIVE === "1")("real CAMI archive", () => {
  it("downloads and prepares a real CAMI read sample", async () => {
    const input = provider.inputSchema.parse({ dataset: process.env.SEQDESK_CAMI_DATASET || "cami2-marine", technology: process.env.SEQDESK_CAMI_TECHNOLOGY || "short", sample: 0, role: "reads" });
    const preview = await provider.preview(input);
    if (!preview.assets?.length || preview.assets[0].bytes > 6 * 1024 ** 3) throw new Error("CAMI asset exceeds live-test budget");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-real-cami-"));
    try {
      const result = await provider.start({ input, preview, cacheKey: provider.getCacheKey(input, preview),
        jobId: "live-cami", userId: "local-test", workspaceId: "local-test",
        storage: { baseDir: root, cacheRoot: root, jobsRoot: root, cacheDir: root, jobDir: root, logPath: path.join(root, "log") },
        update: async update => { if (!update.phase?.startsWith("downloading")) console.info(update.phase); }, log: async () => {},
      });
      expect(result.scientificImport?.reads.length).toBe(input.technology === "short" ? 2 : 1);
      for (const file of result.scientificImport!.reads) {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(file.path)) hash.update(chunk);
        expect(file.sha256).toBe(hash.digest("hex"));
      }
      expect(result.sourceMetadata).toMatchObject({ pipelineReady: true, role: "reads", synthetic: true });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }, 1_800_000);
});
