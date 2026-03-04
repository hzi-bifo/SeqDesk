import { describe, expect, it } from "vitest";

import * as filesIndex from "./index";
import {
  ensureWithinBase,
  extractSampleIdentifier,
  getPairedFilePath,
  hasAllowedExtension,
  isRead1File,
  isRead2File,
  safeJoin,
  toRelativePath,
} from "./paths";
import {
  checkFileExists,
  clearScanCache,
  getScanCacheStats,
  scanDirectory,
} from "./scanner";
import {
  findFilesForSample,
  findFilesForSamples,
  matchPairedEndFiles,
  validateFilePair,
} from "./matcher";

describe("files index barrel exports", () => {
  it("re-exports path utilities", () => {
    expect(filesIndex.ensureWithinBase).toBe(ensureWithinBase);
    expect(filesIndex.toRelativePath).toBe(toRelativePath);
    expect(filesIndex.safeJoin).toBe(safeJoin);
    expect(filesIndex.hasAllowedExtension).toBe(hasAllowedExtension);
    expect(filesIndex.extractSampleIdentifier).toBe(extractSampleIdentifier);
    expect(filesIndex.isRead1File).toBe(isRead1File);
    expect(filesIndex.isRead2File).toBe(isRead2File);
    expect(filesIndex.getPairedFilePath).toBe(getPairedFilePath);
  });

  it("re-exports scanner utilities", () => {
    expect(filesIndex.scanDirectory).toBe(scanDirectory);
    expect(filesIndex.clearScanCache).toBe(clearScanCache);
    expect(filesIndex.getScanCacheStats).toBe(getScanCacheStats);
    expect(filesIndex.checkFileExists).toBe(checkFileExists);
  });

  it("re-exports matcher utilities", () => {
    expect(filesIndex.matchPairedEndFiles).toBe(matchPairedEndFiles);
    expect(filesIndex.findFilesForSample).toBe(findFilesForSample);
    expect(filesIndex.findFilesForSamples).toBe(findFilesForSamples);
    expect(filesIndex.validateFilePair).toBe(validateFilePair);
  });
});
