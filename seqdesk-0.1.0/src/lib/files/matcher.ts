import * as path from "path";
import { FileInfo } from "./scanner";
import {
  extractSampleIdentifier,
  isRead1File,
  isRead2File,
} from "./paths";

export interface SampleMatchInput {
  /** Sample ID (e.g., "SAMPLE001") */
  sampleId: string;
  /** Sample alias/name if available */
  sampleAlias?: string | null;
  /** Sample title if available (lower priority) */
  sampleTitle?: string | null;
}

export interface PairedEndMatch {
  /** Base identifier for the pair */
  identifier: string;
  /** Read 1 file (forward) */
  read1: FileInfo;
  /** Read 2 file (reverse), if found */
  read2: FileInfo | null;
  /** Whether this is a complete pair */
  isPaired: boolean;
}

export type MatchStatus = "exact" | "partial" | "ambiguous" | "none";

export interface FileMatchSuggestion {
  /** How the match was determined */
  status: MatchStatus;
  /** Suggested Read 1 file */
  read1: FileInfo | null;
  /** Suggested Read 2 file */
  read2: FileInfo | null;
  /** All potential matches if ambiguous */
  alternatives: PairedEndMatch[];
  /** Match confidence (0-1) */
  confidence: number;
  /** How the sample was matched (e.g., "sampleId", "sampleAlias") */
  matchedBy: string | null;
}

/**
 * Groups files into paired-end matches based on filename patterns.
 */
export function matchPairedEndFiles(files: FileInfo[]): PairedEndMatch[] {
  const pairs = new Map<string, { read1?: FileInfo; read2?: FileInfo }>();

  for (const file of files) {
    const identifier = extractSampleIdentifier(file.filename);
    const existing = pairs.get(identifier) || {};

    if (isRead1File(file.filename)) {
      // Prefer the first R1 file found (or warn about duplicates)
      if (!existing.read1) {
        existing.read1 = file;
      }
    } else if (isRead2File(file.filename)) {
      if (!existing.read2) {
        existing.read2 = file;
      }
    } else {
      // Single-end or ambiguous - treat as R1
      if (!existing.read1) {
        existing.read1 = file;
      }
    }

    pairs.set(identifier, existing);
  }

  const results: PairedEndMatch[] = [];
  for (const [identifier, pair] of pairs.entries()) {
    if (pair.read1) {
      results.push({
        identifier,
        read1: pair.read1,
        read2: pair.read2 || null,
        isPaired: !!pair.read2,
      });
    }
  }

  return results.sort((a, b) => a.identifier.localeCompare(b.identifier));
}

/**
 * Normalizes a string for fuzzy matching.
 */
function normalizeForMatching(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") // Remove non-alphanumeric
    .trim();
}

/**
 * Calculates match score between sample identifier and file identifier.
 */
function calculateMatchScore(
  sampleIdentifier: string,
  fileIdentifier: string
): number {
  const normalizedSample = normalizeForMatching(sampleIdentifier);
  const normalizedFile = normalizeForMatching(fileIdentifier);

  // Exact match
  if (normalizedSample === normalizedFile) {
    return 1.0;
  }

  // File contains sample identifier
  if (normalizedFile.includes(normalizedSample)) {
    // Penalize if file has much more content
    const ratio = normalizedSample.length / normalizedFile.length;
    return 0.5 + ratio * 0.4; // 0.5 to 0.9
  }

  // Sample contains file identifier (less ideal)
  if (normalizedSample.includes(normalizedFile)) {
    const ratio = normalizedFile.length / normalizedSample.length;
    return 0.3 + ratio * 0.3; // 0.3 to 0.6
  }

  return 0;
}

/**
 * Finds files matching a sample's identifiers.
 */
export function findFilesForSample(
  sample: SampleMatchInput,
  files: FileInfo[],
  allowSingleEnd: boolean = true
): FileMatchSuggestion {
  const pairedFiles = matchPairedEndFiles(files);

  // Try matching with each sample identifier
  const identifiers: Array<{ value: string; source: string }> = [];

  if (sample.sampleId) {
    identifiers.push({ value: sample.sampleId, source: "sampleId" });
  }
  if (sample.sampleAlias) {
    identifiers.push({ value: sample.sampleAlias, source: "sampleAlias" });
  }
  if (sample.sampleTitle) {
    identifiers.push({ value: sample.sampleTitle, source: "sampleTitle" });
  }

  let bestMatch: {
    pair: PairedEndMatch;
    score: number;
    source: string;
  } | null = null;
  const allMatches: Array<{ pair: PairedEndMatch; score: number; source: string }> = [];

  for (const identifier of identifiers) {
    for (const pair of pairedFiles) {
      const score = calculateMatchScore(identifier.value, pair.identifier);

      if (score > 0.3) {
        allMatches.push({ pair, score, source: identifier.source });

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { pair, score, source: identifier.source };
        }
      }
    }
  }

  // No matches found
  if (allMatches.length === 0) {
    return {
      status: "none",
      read1: null,
      read2: null,
      alternatives: [],
      confidence: 0,
      matchedBy: null,
    };
  }

  // Check for ambiguous matches (multiple high-scoring options)
  const highScoreMatches = allMatches.filter((m) => m.score >= 0.7);
  const uniquePairs = new Set(highScoreMatches.map((m) => m.pair.identifier));

  if (uniquePairs.size > 1) {
    return {
      status: "ambiguous",
      read1: null,
      read2: null,
      alternatives: highScoreMatches.map((m) => m.pair),
      confidence: 0,
      matchedBy: null,
    };
  }

  // Single best match
  if (bestMatch && bestMatch.score >= 0.7) {
    const status: MatchStatus =
      bestMatch.pair.isPaired || allowSingleEnd ? "exact" : "partial";

    return {
      status,
      read1: bestMatch.pair.read1,
      read2: bestMatch.pair.read2,
      alternatives: [],
      confidence: bestMatch.score,
      matchedBy: bestMatch.source,
    };
  }

  // Weak match - return as partial with alternatives
  return {
    status: "partial",
    read1: bestMatch?.pair.read1 || null,
    read2: bestMatch?.pair.read2 || null,
    alternatives: allMatches.map((m) => m.pair),
    confidence: bestMatch?.score || 0,
    matchedBy: bestMatch?.source || null,
  };
}

/**
 * Finds matches for multiple samples at once.
 */
export function findFilesForSamples(
  samples: SampleMatchInput[],
  files: FileInfo[],
  allowSingleEnd: boolean = true
): Map<string, FileMatchSuggestion> {
  const results = new Map<string, FileMatchSuggestion>();

  for (const sample of samples) {
    results.set(sample.sampleId, findFilesForSample(sample, files, allowSingleEnd));
  }

  return results;
}

/**
 * Validates that a file pair is consistent (both files exist and match expectations).
 */
export function validateFilePair(
  read1Path: string | null,
  read2Path: string | null,
  allowSingleEnd: boolean
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!read1Path && !read2Path) {
    errors.push("At least one file must be specified");
    return { valid: false, errors };
  }

  if (!read1Path && read2Path) {
    errors.push("Read 2 cannot be assigned without Read 1");
    return { valid: false, errors };
  }

  if (read1Path && isRead2File(path.basename(read1Path))) {
    errors.push("Read 1 file appears to be a Read 2 file based on naming");
  }

  if (read2Path && isRead1File(path.basename(read2Path))) {
    errors.push("Read 2 file appears to be a Read 1 file based on naming");
  }

  if (!allowSingleEnd && read1Path && !read2Path) {
    errors.push("Single-end assignment not allowed, but only Read 1 file provided");
  }

  return { valid: errors.length === 0, errors };
}
