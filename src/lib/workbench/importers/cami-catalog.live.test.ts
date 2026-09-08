import { describe, expect, it } from "vitest";
import { camiBenchmarkImporter as provider } from "./cami-benchmark";

describe.runIf(process.env.SEQDESK_CAMI_METADATA_LIVE === "1")("real CAMI catalog metadata (no archive download)", () => {
  it.each([
    { dataset: "cami2-marine", sample: 9, technology: "short" },
    { dataset: "cami2-marine", sample: 9, technology: "long" },
    { dataset: "cami3-toy-human-gut", sample: 19, technology: "short" },
    { dataset: "cami3-toy-human-gut", sample: 19, technology: "long" },
  ])("resolves $dataset $technology sample $sample", async selection => {
    const preview = await provider.preview(provider.inputSchema.parse(selection));
    expect(preview.contractVersion).toBe(2);
    expect(preview.assets?.[0].bytes).toBeGreaterThan(0);
    expect(preview.assets?.[0].etag).toBeTruthy();
  }, 40_000);
});
