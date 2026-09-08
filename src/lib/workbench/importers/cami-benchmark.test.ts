import { describe, expect, it } from "vitest";
import { camiAsset, camiInputSchema, camiObjectHeaders, camiBenchmarkImporter } from "./cami-benchmark";

describe("CAMI selection contracts (no external service simulation)", () => {
  it("discards legacy user processing declarations in favor of module evidence", () => {
    expect(camiInputSchema.parse({ technology: "short", sample: 0, processingDeclaration: { state: "cleaned", details: "user guess" } }).processingDeclaration).toBeUndefined();
  });
  it("uses only the curated host and dataset paths", () => {
    expect(camiAsset({ dataset: "cami3-toy-human-gut", technology: "short", sample: 0, role: "reads" }).url)
      .toBe("https://s3.bi.denbi.de/swift/v1/cami3__human-gut-toy/short/sample_0_reads.tar.gz");
    expect(camiAsset({ dataset: "cami2-marine", technology: "long", sample: 9, role: "reads" }).url).toBe("https://frl.publisso.de/data/frl:6425521/marine/long_read/marmgCAMI2_sample_9_reads.tar.gz");
    expect(camiInputSchema.safeParse({ dataset: "cami2-marine", technology: "short", sample: 10 }).success).toBe(false);
    expect(camiInputSchema.safeParse({ technology: "short", sample: 0, role: "gsa" }).success).toBe(false);
  });
  it.each([-1, 20, 0.5, NaN])("rejects invalid sample %s", sample => {
    expect(camiInputSchema.safeParse({ technology: "short", sample }).success).toBe(false);
  });
  it("rejects arbitrary URLs and unrecognized datasets", () => {
    expect(camiInputSchema.safeParse({ technology: "short", sample: 0, url: "http://localhost" }).success).toBe(false);
    expect(camiInputSchema.safeParse({ dataset: "other", technology: "short", sample: 0 }).success).toBe(false);
  });
  it.each(["", "-1", "1.5", "0", "107374182401", "Infinity"])("rejects invalid size %s", size => {
    expect(() => camiObjectHeaders(new Headers({ "content-length": size, etag: "object-version" }))).toThrow();
  });
  it("requires version metadata without treating ETag as MD5", () => {
    expect(() => camiObjectHeaders(new Headers({ "content-length": "5" }))).toThrow();
    expect(camiObjectHeaders(new Headers({ "content-length": "5", etag: "multipart-9" }))).toEqual({ bytes: 5, etag: "multipart-9" });
  });
  it("does not require local command-line tools", async () => {
    expect(await camiBenchmarkImporter.preflight()).toEqual({ ok: true });
  });
});
