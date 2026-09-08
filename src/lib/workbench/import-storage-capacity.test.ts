import fs from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { CAMI_PREPARATION_BYTES, IMPORT_STORAGE_HEADROOM, requireImportStorage, STORAGE_UNKNOWN, STORAGE_WAITING } from "./import-storage-capacity";

afterEach(() => vi.restoreAllMocks());
it("keeps headroom and uses user-available blocks rather than reserved system blocks", async () => {
  const stat = vi.spyOn(fs, "statfs").mockResolvedValue({ bsize: 1,
    bavail: CAMI_PREPARATION_BYTES + IMPORT_STORAGE_HEADROOM - 1,
    bfree: 999 * 1024 ** 3,
  } as Awaited<ReturnType<typeof fs.statfs>>);
  await expect(requireImportStorage("/internal-test", CAMI_PREPARATION_BYTES)).rejects.toThrow(STORAGE_WAITING);
  stat.mockResolvedValue({ bsize: 1, bavail: CAMI_PREPARATION_BYTES + IMPORT_STORAGE_HEADROOM } as Awaited<ReturnType<typeof fs.statfs>>);
  await expect(requireImportStorage("/internal-test", CAMI_PREPARATION_BYTES)).resolves.toBeUndefined();
});
it.each([NaN, Infinity, -1])("treats invalid filesystem capacity %s as unknown", async bavail => {
  vi.spyOn(fs, "statfs").mockResolvedValue({ bsize: 1, bavail } as Awaited<ReturnType<typeof fs.statfs>>);
  await expect(requireImportStorage("/internal-test")).rejects.toThrow(STORAGE_UNKNOWN);
});
