import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { benchmarkReadOutputBytes, CAMI_MAX_BYTES, estimateCamiPreparationBytes, IMPORT_STORAGE_HEADROOM, readImportStorageRequirement, rememberImportStorageRequirement, requireImportStorage, STORAGE_UNKNOWN, STORAGE_WAITING } from "./import-storage-capacity";

afterEach(() => vi.restoreAllMocks());
it("keeps headroom and uses user-available blocks rather than reserved system blocks", async () => {
  const required = estimateCamiPreparationBytes(5 * 1024 ** 3);
  const stat = vi.spyOn(fs, "statfs").mockResolvedValue({ bsize: 1,
    bavail: required + IMPORT_STORAGE_HEADROOM - 1,
    bfree: 999 * 1024 ** 3,
  } as Awaited<ReturnType<typeof fs.statfs>>);
  await expect(requireImportStorage("/internal-test", required)).rejects.toMatchObject({
    message: `${STORAGE_WAITING} This import requires 16.00 GiB of free working space, including a 1 GiB reserve.`,
    additionalBytes: required,
  });
  stat.mockResolvedValue({ bsize: 1, bavail: required + IMPORT_STORAGE_HEADROOM } as Awaited<ReturnType<typeof fs.statfs>>);
  await expect(requireImportStorage("/internal-test", required)).resolves.toBeUndefined();
});
it.each([NaN, Infinity, -1])("treats invalid filesystem capacity %s as unknown", async bavail => {
  vi.spyOn(fs, "statfs").mockResolvedValue({ bsize: 1, bavail } as Awaited<ReturnType<typeof fs.statfs>>);
  await expect(requireImportStorage("/internal-test")).rejects.toThrow(STORAGE_UNKNOWN);
});

it("sizes the initial estimate from the selected download, not the global safety cap", async () => {
  const archiveBytes = 5_550_020_311;
  expect(estimateCamiPreparationBytes(archiveBytes)).toBe(archiveBytes * 3);
  expect(estimateCamiPreparationBytes(1024)).toBe(3072);
  expect(estimateCamiPreparationBytes(CAMI_MAX_BYTES)).toBe(2 * CAMI_MAX_BYTES);
  vi.spyOn(fs, "statfs").mockResolvedValue({ bsize: 1, bavail: 30 * 1024 ** 3 } as Awaited<ReturnType<typeof fs.statfs>>);
  await expect(requireImportStorage("/internal-test", estimateCamiPreparationBytes(archiveBytes))).resolves.toBeUndefined();
});

it.each([undefined, null, "5550020311", 0, -1, 0.1, NaN, Infinity, CAMI_MAX_BYTES + 1])("rejects unknown or invalid archive size %s", value => {
  expect(() => estimateCamiPreparationBytes(value)).toThrow("archive size");
});

it.each([-1, NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER])("does not bypass disk checks with an invalid requirement %s", async value => {
  const stat = vi.spyOn(fs, "statfs");
  await expect(requireImportStorage("/internal-test", value)).rejects.toThrow("Invalid import storage requirement");
  expect(stat).not.toHaveBeenCalled();
});

it("bounds compressed pair outputs from measured FASTQ bytes with gzip overhead", () => {
  expect(benchmarkReadOutputBytes(100_000)).toBe(101_000 + 64 * 1024);
  expect(benchmarkReadOutputBytes(CAMI_MAX_BYTES)).toBeGreaterThan(CAMI_MAX_BYTES);
  expect(() => benchmarkReadOutputBytes(CAMI_MAX_BYTES + 1)).toThrow();
  expect(() => benchmarkReadOutputBytes(NaN)).toThrow();
});

it("retains a learned requirement across retries without lowering it or leaving temporary files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-storage-budget-"));
  try {
    const directory = path.join(root, "job");
    expect(await readImportStorageRequirement(directory)).toBe(0);
    await rememberImportStorageRequirement(directory, 20 * 1024 ** 3);
    await rememberImportStorageRequirement(directory, 10 * 1024 ** 3);
    expect(await readImportStorageRequirement(directory)).toBe(20 * 1024 ** 3);
    expect(await fs.readdir(directory)).toEqual(["storage-requirement.json"]);
    await fs.writeFile(path.join(directory, "storage-requirement.json"), "invalid");
    await expect(readImportStorageRequirement(directory)).rejects.toThrow(STORAGE_UNKNOWN);
    await fs.writeFile(path.join(directory, "storage-requirement.json"), JSON.stringify({ additionalBytes: -1 }));
    await expect(readImportStorageRequirement(directory)).rejects.toThrow(STORAGE_UNKNOWN);
    await fs.writeFile(path.join(directory, "storage-requirement.json"), " ".repeat(1025));
    await expect(readImportStorageRequirement(directory)).rejects.toThrow(STORAGE_UNKNOWN);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
