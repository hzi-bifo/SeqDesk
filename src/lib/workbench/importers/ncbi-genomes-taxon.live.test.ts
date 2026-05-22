import { describe, expect, it } from "vitest";
import {
  createMockWorkbenchImportStartContext,
  createWorkbenchTestTempRoot,
} from "@/lib/workbench/testing";
import {
  ncbiGenomesTaxonIntegrationTestSpec,
  ncbiGenomesTaxonImporter,
} from "./ncbi-genomes-taxon";

const runLive = process.env.SEQDESK_WORKBENCH_LIVE === "1";

describe.runIf(runLive)("NCBI genomes by taxon live smoke", () => {
  it(
    "previews and downloads one tiny capped public reference package",
    async () => {
      const preflight = await ncbiGenomesTaxonImporter.preflight();
      expect(
        preflight.ok,
        [
          "NCBI Datasets CLI live smoke cannot run.",
          preflight.message,
          preflight.details,
        ]
          .filter(Boolean)
          .join(" ")
      ).toBe(true);

      const input = ncbiGenomesTaxonImporter.inputSchema.parse(
        ncbiGenomesTaxonIntegrationTestSpec.liveSmoke?.input
      );
      const preview = await ncbiGenomesTaxonImporter.preview(input);
      expect(preview.genomes.length).toBeGreaterThan(0);
      expect(preview.genomes.length).toBeLessThanOrEqual(1);

      const temp = await createWorkbenchTestTempRoot("seqdesk-workbench-live-ncbi-");
      try {
        const context = await createMockWorkbenchImportStartContext({
          rootDir: temp.rootDir,
          providerId: ncbiGenomesTaxonImporter.id,
          input,
          preview,
          cacheKey: ncbiGenomesTaxonImporter.getCacheKey(input, preview),
          jobId: "live-ncbi-job",
        });

        const result = await ncbiGenomesTaxonImporter.start(context);

        expect(result.cacheKey).toBe(context.cacheKey);
        expect(result.genomeCount).toBe(preview.genomes.length);
        expect(result.sizeBytes).toBeGreaterThan(0);
        expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(result.storagePath).toBe(context.storage.cacheDir);
        expect(context.updates.map((update) => update.phase)).toEqual(
          expect.arrayContaining(["downloading", "extracting", "indexing"])
        );
      } finally {
        await temp.cleanup();
      }
    },
    ncbiGenomesTaxonIntegrationTestSpec.liveSmoke?.maxRuntimeMs ?? 120_000
  );
});

describe.skipIf(runLive)("NCBI genomes by taxon live smoke", () => {
  it("is opt-in so default CI stays fast and deterministic", () => {
    expect(process.env.SEQDESK_WORKBENCH_LIVE).not.toBe("1");
  });
});
