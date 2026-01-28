// Path utilities
export {
  ensureWithinBase,
  toRelativePath,
  safeJoin,
  hasAllowedExtension,
  extractSampleIdentifier,
  isRead1File,
  isRead2File,
  getPairedFilePath,
} from "./paths";

// Directory scanner
export {
  scanDirectory,
  clearScanCache,
  getScanCacheStats,
  checkFileExists,
} from "./scanner";
export type { FileInfo, ScanOptions } from "./scanner";

// File matcher
export {
  matchPairedEndFiles,
  findFilesForSample,
  findFilesForSamples,
  validateFilePair,
} from "./matcher";
export type {
  SampleMatchInput,
  PairedEndMatch,
  MatchStatus,
  FileMatchSuggestion,
} from "./matcher";
