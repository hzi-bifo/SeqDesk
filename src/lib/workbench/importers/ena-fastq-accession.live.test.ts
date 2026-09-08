import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe.runIf(process.env.SEQDESK_WORKBENCH_ENA_LIVE === "1")("real public ENA import", () => {
  it("resolves and validates a bounded real read file", async () => {
    const { enaFastqAccessionImporter: provider } = await import("./ena-fastq-accession");
    const input = provider.inputSchema.parse({ accession: "ERR164407", maxFiles: 2 });
    const preview = await provider.preview(input);
    expect(preview.files?.length).toBeGreaterThan(0);
    const bytes = preview.files!.reduce((sum, file) => sum + (file.bytes ?? Infinity), 0);
    if (bytes > 100 * 1024 ** 2 || preview.files!.some((file) => !file.md5)) {
      throw new Error("Real source changed beyond this test's bounded download contract");
    }
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-real-ena-"));
    try {
      const cacheDir = path.join(root, "data"), jobDir = path.join(root, "job");
      await fs.mkdir(cacheDir); await fs.mkdir(jobDir);
      const result = await provider.start({
        jobId: "live-verification", userId: "local-test", workspaceId: "local-test",
        input, preview, cacheKey: provider.getCacheKey(input, preview),
        storage: { baseDir: root, cacheRoot: root, jobsRoot: root, cacheDir, jobDir, logPath: path.join(jobDir, "log") },
        update: async () => {}, log: async () => {},
      });
      expect(result.sizeBytes).toBe(bytes);
      expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
      const metadata = result.sourceMetadata as { files: Array<{ records: number; sha256: string }> };
      expect(metadata.files.every((file) => file.records > 0 && /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
      expect(result.scientificImports?.length).toBeGreaterThan(0);
      const entry = result.scientificImports![0];
      expect(entry.readKey).toBe("ERR164407");
      for (const key of ["originalStudy", "originalSample", "originalExperiment", "originalRun"]) {
        expect(entry.metadata?.[key]).toMatchObject({ xml: expect.stringContaining("accession="), sha256: expect.stringMatching(/^[a-f0-9]{64}$/), retrievedAt: expect.any(String) });
      }
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }, 180_000);
});
